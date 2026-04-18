//! JPEG DC-only decoder.
//!
//! Extracts only the DC coefficients of each 8×8 DCT block, producing a
//! 1/8×1/8 RGBA thumbnail at ~1/64 the cost of a full decode.
//!
//! Supported:
//! - Baseline sequential (SOF0) and progressive (SOF2) JPEGs.
//! - 1 component (grayscale), 3 components (YCbCr), 4 components (YCCK/CMYK).
//! - Subsamplings: 4:4:4 / 4:2:2 / 4:4:0 / 4:2:0.
//! - Interleaved AND non-interleaved progressive DC-first scans.
//! - DRI restart markers.
//! - Byte-stuffed (0xFF 0x00) entropy streams.
//!
//! Not supported (returns `None`, caller falls back to full decode):
//! - SOF3 lossless JPEG.
//! - Arithmetic-coded JPEG (DAC marker instead of DHT).
//! - Hierarchical JPEG.
//! - Sampling factors outside {1, 2}.

use wasm_bindgen::prelude::*;

/// Small wrapper so the WASM ABI stays narrow: flat bytes + dimensions, or
/// an empty vec on failure.
#[wasm_bindgen]
pub fn dc_only_decode_jpeg(bytes: &[u8]) -> Vec<u8> {
    match decode(bytes) {
        Some(img) => {
            let mut out = Vec::with_capacity(8 + img.data.len());
            out.extend_from_slice(&(img.width as u32).to_le_bytes());
            out.extend_from_slice(&(img.height as u32).to_le_bytes());
            out.extend_from_slice(&img.data);
            out
        }
        None => Vec::new(),
    }
}

pub struct DcImage {
    pub data: Vec<u8>, // RGBA
    pub width: u32,
    pub height: u32,
}

/* --- segment markers --- */
const SOI: u8 = 0xd8;
const EOI: u8 = 0xd9;
const SOF0: u8 = 0xc0; // baseline sequential
const SOF2: u8 = 0xc2; // progressive
const DHT: u8 = 0xc4;
const DAC: u8 = 0xcc; // arithmetic coding table — reject-only marker
const DQT: u8 = 0xdb;
const DRI: u8 = 0xdd;
const SOS: u8 = 0xda;
const APP14: u8 = 0xee; // Adobe marker — tells us YCCK vs CMYK for 4-component

struct QTable {
    values: [u16; 64],
}

impl Default for QTable {
    fn default() -> Self { Self { values: [0; 64] } }
}

#[derive(Clone)]
struct HuffmanTable {
    fast: [u16; 256],
    codes: Vec<HuffCode>,
}

impl Default for HuffmanTable {
    fn default() -> Self { Self { fast: [0u16; 256], codes: Vec::new() } }
}

#[derive(Default, Clone, Copy)]
struct HuffCode { code: u32, length: u8, value: u8 }

#[derive(Clone, Copy)]
struct FrameComponent {
    id: u8,
    h: u8,
    v: u8,
    qt_id: u8,
}

struct FrameInfo {
    width: u16,
    height: u16,
    components: Vec<FrameComponent>,
    progressive: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum AdobeColorTransform {
    Unknown, // default: unspecified; 3=YCbCr, 4=CMYK per jpeg conventions
    None,    // Adobe marker with transform=0 → RGB/CMYK raw
    YCbCr,
    YCCK,
}

pub fn decode(bytes: &[u8]) -> Option<DcImage> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != SOI {
        return None;
    }

    let mut p = 2;
    let mut qts: [Option<QTable>; 4] = Default::default();
    let mut dc_huff: [Option<HuffmanTable>; 4] = Default::default();
    let mut ac_huff: [Option<HuffmanTable>; 4] = Default::default();
    let mut frame: Option<FrameInfo> = None;
    let mut restart_interval: u16 = 0;
    let mut adobe = AdobeColorTransform::Unknown;

    // Progressive DC buffers — allocated on first scan.
    let mut pass: Option<PassState> = None;

    while p + 1 < bytes.len() {
        if bytes[p] != 0xff {
            return None;
        }
        let marker = bytes[p + 1];
        p += 2;

        // Standalone markers (no length).
        if (0xd0..=0xd7).contains(&marker) || marker == 0x01 || marker == 0x00 {
            continue;
        }
        if marker == EOI {
            break;
        }

        if p + 2 > bytes.len() {
            return None;
        }
        let len = ((bytes[p] as usize) << 8) | (bytes[p + 1] as usize);
        let payload_start = p + 2;
        let payload_end = p + len;
        if payload_end > bytes.len() {
            return None;
        }
        let payload = &bytes[payload_start..payload_end];

        match marker {
            DQT => parse_dqt(payload, &mut qts)?,
            SOF0 => frame = Some(parse_sof(payload, false)?),
            SOF2 => frame = Some(parse_sof(payload, true)?),
            DHT => parse_dht(payload, &mut dc_huff, &mut ac_huff)?,
            DAC => return None, // arithmetic-coded JPEG — explicit refuse
            DRI => {
                if payload.len() < 2 {
                    return None;
                }
                restart_interval = ((payload[0] as u16) << 8) | (payload[1] as u16);
            }
            APP14 => adobe = parse_adobe_app14(payload),
            SOS => {
                let fr = frame.as_ref()?;
                if pass.is_none() {
                    pass = Some(PassState::new(fr));
                }
                let state = pass.as_mut().unwrap();
                let entropy_consumed = process_scan(
                    fr,
                    &qts,
                    &dc_huff,
                    &ac_huff,
                    payload,
                    &bytes[payload_end..],
                    restart_interval,
                    state,
                )?;
                p = payload_end + entropy_consumed;
                if state.all_done() {
                    break;
                }
                continue;
            }
            // SOF3 lossless / SOF5..SOF15 hierarchical / rare — reject.
            0xc3 | 0xc5..=0xcf => return None,
            _ => { /* ignore APPn (except APP14 above), COM, etc. */ }
        }

        p = payload_end;
    }

    let fr = frame?;
    let state = pass?;
    state.into_rgba(&fr, adobe)
}

fn parse_adobe_app14(payload: &[u8]) -> AdobeColorTransform {
    // "Adobe\0" + version(2) + flags0(2) + flags1(2) + transform(1)
    if payload.len() < 12 {
        return AdobeColorTransform::Unknown;
    }
    if &payload[0..5] != b"Adobe" {
        return AdobeColorTransform::Unknown;
    }
    match payload[11] {
        0 => AdobeColorTransform::None,
        1 => AdobeColorTransform::YCbCr,
        2 => AdobeColorTransform::YCCK,
        _ => AdobeColorTransform::Unknown,
    }
}

fn parse_dqt(payload: &[u8], qts: &mut [Option<QTable>; 4]) -> Option<()> {
    let mut p = 0;
    while p < payload.len() {
        let b = payload[p];
        let precision = b >> 4;
        let id = (b & 0x0f) as usize;
        p += 1;
        if id >= 4 { return None; }
        let mut q = QTable::default();
        if precision == 0 {
            if p + 64 > payload.len() { return None; }
            for k in 0..64 { q.values[k] = payload[p + k] as u16; }
            p += 64;
        } else {
            if p + 128 > payload.len() { return None; }
            for k in 0..64 {
                q.values[k] = ((payload[p + k * 2] as u16) << 8) | (payload[p + k * 2 + 1] as u16);
            }
            p += 128;
        }
        qts[id] = Some(q);
    }
    Some(())
}

fn parse_sof(payload: &[u8], progressive: bool) -> Option<FrameInfo> {
    if payload.len() < 6 { return None; }
    let precision = payload[0];
    if precision != 8 { return None; }
    let height = ((payload[1] as u16) << 8) | (payload[2] as u16);
    let width = ((payload[3] as u16) << 8) | (payload[4] as u16);
    let nf = payload[5] as usize;
    if nf != 1 && nf != 3 && nf != 4 { return None; }
    if payload.len() < 6 + nf * 3 { return None; }
    let mut components = Vec::with_capacity(nf);
    for i in 0..nf {
        let base = 6 + i * 3;
        let id = payload[base];
        let sampling = payload[base + 1];
        let h = sampling >> 4;
        let v = sampling & 0x0f;
        let qt_id = payload[base + 2];
        // Sanity: reject sampling factors outside what we support.
        if h == 0 || v == 0 || h > 2 || v > 2 { return None; }
        components.push(FrameComponent { id, h, v, qt_id });
    }
    Some(FrameInfo { width, height, components, progressive })
}

fn parse_dht(
    payload: &[u8],
    dc_huff: &mut [Option<HuffmanTable>; 4],
    ac_huff: &mut [Option<HuffmanTable>; 4],
) -> Option<()> {
    let mut p = 0;
    while p < payload.len() {
        let b = payload[p];
        let class = b >> 4;
        let id = (b & 0x0f) as usize;
        p += 1;
        if id >= 4 { return None; }
        if p + 16 > payload.len() { return None; }
        let counts: [u8; 16] = payload[p..p + 16].try_into().ok()?;
        p += 16;
        let total: usize = counts.iter().map(|&c| c as usize).sum();
        if p + total > payload.len() { return None; }
        let values = &payload[p..p + total];
        p += total;

        let mut codes = Vec::with_capacity(total);
        let mut fast = [0u16; 256];
        let mut code: u32 = 0;
        let mut vi = 0usize;
        for length in 1u8..=16 {
            let n = counts[(length - 1) as usize];
            for _ in 0..n {
                codes.push(HuffCode { code, length, value: values[vi] });
                if length <= 8 {
                    let shifted = (code << (8 - length)) as usize;
                    let fill = 1usize << (8 - length);
                    let entry = ((length as u16) << 8) | (values[vi] as u16);
                    for k in 0..fill { fast[shifted + k] = entry; }
                }
                vi += 1;
                code += 1;
            }
            code <<= 1;
        }

        let table = HuffmanTable { fast, codes };
        if class == 0 { dc_huff[id] = Some(table); }
        else { ac_huff[id] = Some(table); }
    }
    Some(())
}

/* -------------------------- pass state + scan ---------------------------- */

/// Per-component DC buffers accumulated across one or more scans.
struct PassState {
    // Component order follows FrameInfo.components.
    out_w: usize,
    out_h: usize,
    luma: Vec<u8>,
    chroma_b: Vec<u8>, // Cb (or grayscale: unused)
    chroma_r: Vec<u8>, // Cr
    k_channel: Vec<u8>, // CMYK K (only for 4-component)
    done: [bool; 4],
    ncomp: usize,
}

impl PassState {
    fn new(fr: &FrameInfo) -> Self {
        let out_w = (fr.width as usize + 7) / 8;
        let out_h = (fr.height as usize + 7) / 8;
        let size = out_w * out_h;
        Self {
            out_w,
            out_h,
            luma: vec![0u8; size],
            chroma_b: vec![128u8; size],
            chroma_r: vec![128u8; size],
            k_channel: vec![255u8; size],
            done: [false; 4],
            ncomp: fr.components.len(),
        }
    }

    fn all_done(&self) -> bool {
        (0..self.ncomp).all(|i| self.done[i])
    }

    fn into_rgba(self, fr: &FrameInfo, adobe: AdobeColorTransform) -> Option<DcImage> {
        if !self.all_done() {
            return None;
        }

        let (out_w, out_h) = (self.out_w, self.out_h);
        let mut rgba = vec![0u8; out_w * out_h * 4];

        match self.ncomp {
            1 => {
                for i in 0..(out_w * out_h) {
                    let y = self.luma[i];
                    rgba[i * 4] = y;
                    rgba[i * 4 + 1] = y;
                    rgba[i * 4 + 2] = y;
                    rgba[i * 4 + 3] = 255;
                }
            }
            3 => {
                for i in 0..(out_w * out_h) {
                    let y = self.luma[i] as i32;
                    let cb_v = self.chroma_b[i] as i32 - 128;
                    let cr_v = self.chroma_r[i] as i32 - 128;
                    let r = clamp_byte(y + (45 * cr_v >> 5));
                    let g = clamp_byte(y - (11 * cb_v + 23 * cr_v >> 5));
                    let b = clamp_byte(y + (113 * cb_v >> 6));
                    rgba[i * 4] = r;
                    rgba[i * 4 + 1] = g;
                    rgba[i * 4 + 2] = b;
                    rgba[i * 4 + 3] = 255;
                }
            }
            4 => {
                // 4-component: YCCK or plain CMYK.
                let is_ycck = matches!(adobe, AdobeColorTransform::YCCK)
                    || matches!(adobe, AdobeColorTransform::Unknown);
                for i in 0..(out_w * out_h) {
                    let c1 = self.luma[i] as i32;
                    let c2 = self.chroma_b[i] as i32;
                    let c3 = self.chroma_r[i] as i32;
                    let c4 = self.k_channel[i] as i32; // K (inverted)

                    let (r, g, b) = if is_ycck {
                        // YCCK -> CMY then -> RGB. YCbCr portion maps to CMY
                        // in "inverted" form per Adobe conventions.
                        let cb_v = c2 - 128;
                        let cr_v = c3 - 128;
                        let cy = clamp_byte(255 - (c1 + (45 * cr_v >> 5)));
                        let cm = clamp_byte(255 - (c1 - (11 * cb_v + 23 * cr_v >> 5)));
                        let cy_b = clamp_byte(255 - (c1 + (113 * cb_v >> 6)));
                        // Then CMY + K → RGB using Adobe inverted-K convention.
                        let k = c4 as i32;
                        let r = clamp_byte((k * (255 - cy as i32)) / 255);
                        let g = clamp_byte((k * (255 - cm as i32)) / 255);
                        let b = clamp_byte((k * (255 - cy_b as i32)) / 255);
                        (r, g, b)
                    } else {
                        // Plain CMYK (Adobe transform = 0). Values are already
                        // 0..255 inverted: RGB = K * (255-C) / 255 etc.
                        let r = clamp_byte((c4 * (255 - c1)) / 255);
                        let g = clamp_byte((c4 * (255 - c2)) / 255);
                        let b = clamp_byte((c4 * (255 - c3)) / 255);
                        (r, g, b)
                    };
                    rgba[i * 4] = r;
                    rgba[i * 4 + 1] = g;
                    rgba[i * 4 + 2] = b;
                    rgba[i * 4 + 3] = 255;
                }
            }
            _ => {
                let _ = fr;
                return None;
            }
        }

        Some(DcImage { data: rgba, width: out_w as u32, height: out_h as u32 })
    }
}

#[derive(Clone, Copy)]
struct ScanComponent {
    frame_index: usize, // index into FrameInfo.components
    h: u8,
    v: u8,
    qt_id: u8,
    dc_huff_id: u8,
    ac_huff_id: u8,
}

fn process_scan(
    frame: &FrameInfo,
    qts: &[Option<QTable>; 4],
    dc_huff: &[Option<HuffmanTable>; 4],
    ac_huff: &[Option<HuffmanTable>; 4],
    sos_header: &[u8],
    entropy: &[u8],
    restart_interval: u16,
    state: &mut PassState,
) -> Option<usize> {
    if sos_header.is_empty() { return None; }
    let ns = sos_header[0] as usize;
    if ns == 0 || ns > frame.components.len() || 1 + ns * 2 + (if frame.progressive { 3 } else { 3 }) > sos_header.len() {
        return None;
    }

    let mut scan_comps = Vec::with_capacity(ns);
    for i in 0..ns {
        let sel = sos_header[1 + i * 2];
        let table_ids = sos_header[2 + i * 2];
        let dc_id = table_ids >> 4;
        let ac_id = table_ids & 0x0f;
        let (fi, fc) = frame
            .components
            .iter()
            .enumerate()
            .find(|(_, c)| c.id == sel)?;
        scan_comps.push(ScanComponent {
            frame_index: fi,
            h: fc.h,
            v: fc.v,
            qt_id: fc.qt_id,
            dc_huff_id: dc_id,
            ac_huff_id: ac_id,
        });
    }

    // SOS tail: Ss, Se, Ah|Al (always 3 bytes).
    let tail = 1 + ns * 2;
    let ss = sos_header[tail];
    let se = sos_header[tail + 1];
    let ah_al = sos_header[tail + 2];
    let ah = ah_al >> 4;
    let al = ah_al & 0x0f;

    let is_dc_first_scan = ss == 0 && se == 0 && ah == 0;

    // Build decoder tables for the components actually in this scan.
    let mut dc_tables: Vec<&HuffmanTable> = Vec::with_capacity(ns);
    let mut ac_tables: Vec<&HuffmanTable> = Vec::with_capacity(ns);
    let mut q_dc = [0u16; 4];
    for (i, sc) in scan_comps.iter().enumerate() {
        dc_tables.push(dc_huff[sc.dc_huff_id as usize].as_ref()?);
        if !frame.progressive {
            ac_tables.push(ac_huff[sc.ac_huff_id as usize].as_ref()?);
        }
        q_dc[i] = qts[sc.qt_id as usize].as_ref()?.values[0];
    }

    // For baseline JPEGs, we expect ns == frame.components.len() (interleaved)
    // and we need to decode DCs plus skip ACs.
    // For progressive JPEGs, we only decode DC-first scans. Other scans we
    // walk past without decoding.
    let entropy_len = scan_payload_length(entropy);

    if frame.progressive && !is_dc_first_scan {
        // Ignore refinement and AC scans — palette doesn't need them.
        return Some(entropy_len);
    }

    // Max sampling factors across all frame components.
    let h_max = frame.components.iter().map(|c| c.h).max()?;
    let v_max = frame.components.iter().map(|c| c.v).max()?;

    let mcu_w = 8 * h_max as usize;
    let mcu_h = 8 * v_max as usize;
    let mcus_x = (frame.width as usize + mcu_w - 1) / mcu_w;
    let mcus_y = (frame.height as usize + mcu_h - 1) / mcu_h;

    let mut reader = BitReader::new(entropy);
    let mut dc_prev = [0i32; 4];
    let mut mcu_counter: u16 = 0;

    // Non-interleaved progressive: ns == 1. MCU layout is per-component:
    // each MCU contains exactly one block of that component.
    let non_interleaved = ns == 1 && frame.progressive;

    if non_interleaved {
        let sc = scan_comps[0];
        let comp_w = (frame.width as usize * sc.h as usize + 8 * h_max as usize - 1)
            / (8 * h_max as usize);
        let comp_h = (frame.height as usize * sc.v as usize + 8 * v_max as usize - 1)
            / (8 * v_max as usize);
        // Grid for this component — component dimensions in blocks.
        let blocks_x = (frame.width as usize * sc.h as usize + 8 * h_max as usize - 1)
            / (8 * h_max as usize);
        let blocks_y = (frame.height as usize * sc.v as usize + 8 * v_max as usize - 1)
            / (8 * v_max as usize);
        let _ = (comp_w, comp_h);

        // Walk blocks_x × blocks_y in scan order.
        for by in 0..blocks_y {
            for bx in 0..blocks_x {
                let dc = decode_block_dc(&mut reader, dc_tables[0], &mut dc_prev[0])?;
                let dc_shifted = dc << (al as u32);
                store_dc(frame, state, &sc, bx, by, dc_shifted, q_dc[0]);
                mcu_counter += 1;
                if restart_interval > 0 && mcu_counter % restart_interval == 0 {
                    reader.align_to_byte();
                    reader.skip_restart_marker()?;
                    dc_prev = [0; 4];
                }
            }
        }
        state.done[sc.frame_index] = true;
        return Some(entropy_len);
    }

    // Interleaved scan: all components present, standard MCU layout.
    for my in 0..mcus_y {
        for mx in 0..mcus_x {
            for (ci, sc) in scan_comps.iter().enumerate() {
                let blocks = (sc.h * sc.v) as usize;
                for bi in 0..blocks {
                    let dc = decode_block_dc(&mut reader, dc_tables[ci], &mut dc_prev[ci])?;
                    let dc_shifted = if frame.progressive { dc << (al as u32) } else { dc };

                    let bx_in_mcu = bi % sc.h as usize;
                    let by_in_mcu = bi / sc.h as usize;
                    // Block coordinate for this component.
                    let bx = mx * sc.h as usize + bx_in_mcu;
                    let by = my * sc.v as usize + by_in_mcu;
                    store_dc(frame, state, sc, bx, by, dc_shifted, q_dc[ci]);

                    // Baseline: must skip AC coefficients. Progressive DC-
                    // first has no AC in this scan.
                    if !frame.progressive {
                        skip_ac(&mut reader, ac_tables[ci])?;
                    }
                }
            }
            mcu_counter += 1;
            if restart_interval > 0 && mcu_counter % restart_interval == 0 {
                reader.align_to_byte();
                reader.skip_restart_marker()?;
                dc_prev = [0; 4];
            }
        }
    }

    for sc in &scan_comps {
        state.done[sc.frame_index] = true;
    }
    Some(entropy_len)
}

/// Walk the entropy bytes to find the next real marker, returning the number
/// of bytes that belong to the current scan. Byte-stuffing (0xFF 0x00) and
/// restart markers (0xFF 0xD0..D7) are part of the scan; any other 0xFF 0x??
/// marks the end.
fn scan_payload_length(entropy: &[u8]) -> usize {
    let mut i = 0;
    while i + 1 < entropy.len() {
        if entropy[i] == 0xff {
            let next = entropy[i + 1];
            if next == 0x00 || (0xd0..=0xd7).contains(&next) {
                i += 2;
                continue;
            }
            return i;
        }
        i += 1;
    }
    entropy.len()
}

fn store_dc(
    frame: &FrameInfo,
    state: &mut PassState,
    sc: &ScanComponent,
    bx: usize,
    by: usize,
    dc: i32,
    q: u16,
) {
    let _ = frame;
    let ox = bx;
    let oy = by;
    if ox >= state.out_w || oy >= state.out_h {
        return;
    }
    let value = dequantize_and_levelshift(dc, q);
    let offset = oy * state.out_w + ox;
    match (sc.frame_index, state.ncomp) {
        (0, _) => state.luma[offset] = value,
        (1, 3) | (1, 4) => {
            // chroma Cb — subsampled: fill the 2D region this block covers.
            let h_max = frame.components.iter().map(|c| c.h).max().unwrap_or(1) as usize;
            let v_max = frame.components.iter().map(|c| c.v).max().unwrap_or(1) as usize;
            let hm = h_max / sc.h as usize;
            let vm = v_max / sc.v as usize;
            for dy in 0..vm {
                for dx in 0..hm {
                    let oxp = ox * hm + dx;
                    let oyp = oy * vm + dy;
                    if oxp < state.out_w && oyp < state.out_h {
                        state.chroma_b[oyp * state.out_w + oxp] = value;
                    }
                }
            }
        }
        (2, 3) | (2, 4) => {
            let h_max = frame.components.iter().map(|c| c.h).max().unwrap_or(1) as usize;
            let v_max = frame.components.iter().map(|c| c.v).max().unwrap_or(1) as usize;
            let hm = h_max / sc.h as usize;
            let vm = v_max / sc.v as usize;
            for dy in 0..vm {
                for dx in 0..hm {
                    let oxp = ox * hm + dx;
                    let oyp = oy * vm + dy;
                    if oxp < state.out_w && oyp < state.out_h {
                        state.chroma_r[oyp * state.out_w + oxp] = value;
                    }
                }
            }
        }
        (3, 4) => {
            // K channel — generally 1×1 sampling in 4-component.
            state.k_channel[offset] = value;
        }
        _ => {}
    }
}

fn clamp_byte(v: i32) -> u8 {
    if v < 0 { 0 } else if v > 255 { 255 } else { v as u8 }
}

fn dequantize_and_levelshift(dc: i32, q: u16) -> u8 {
    let raw = (dc as i64) * (q as i64);
    let mean = (raw / 8) + 128;
    if mean < 0 { 0 } else if mean > 255 { 255 } else { mean as u8 }
}

fn decode_block_dc(reader: &mut BitReader, table: &HuffmanTable, prev: &mut i32) -> Option<i32> {
    let s = huffman_decode(reader, table)?;
    let diff = receive_extend(reader, s)?;
    *prev += diff;
    Some(*prev)
}

fn skip_ac(reader: &mut BitReader, table: &HuffmanTable) -> Option<()> {
    let mut k = 1;
    while k <= 63 {
        let rs = huffman_decode(reader, table)?;
        let r = rs >> 4;
        let s = rs & 0x0f;
        if s == 0 {
            if r == 15 { k += 16; continue; }
            return Some(());
        }
        k += r as usize + 1;
        for _ in 0..s { reader.read_bit()?; }
    }
    Some(())
}

fn huffman_decode(reader: &mut BitReader, table: &HuffmanTable) -> Option<u8> {
    let prefix = reader.peek_bits(8)?;
    let entry = table.fast[prefix as usize];
    let len = (entry >> 8) as u8;
    if len > 0 {
        reader.consume_bits(len);
        return Some((entry & 0xff) as u8);
    }
    let mut code: u32 = prefix as u32;
    reader.consume_bits(8);
    let mut length: u8 = 8;
    for _ in 0..8 {
        code = (code << 1) | (reader.read_bit()? as u32);
        length += 1;
        for entry in &table.codes {
            if entry.length == length && entry.code == code {
                return Some(entry.value);
            }
        }
    }
    None
}

fn receive_extend(reader: &mut BitReader, s: u8) -> Option<i32> {
    if s == 0 { return Some(0); }
    let mut v: i32 = 0;
    for _ in 0..s { v = (v << 1) | (reader.read_bit()? as i32); }
    let half = 1i32 << (s - 1);
    if v < half { Some(v - (1 << s) + 1) } else { Some(v) }
}

struct BitReader<'a> {
    bytes: &'a [u8],
    pos: usize,
    bit_pos: u8,
    cur: u8,
    started: bool,
}

impl<'a> BitReader<'a> {
    fn new(bytes: &'a [u8]) -> Self { Self { bytes, pos: 0, bit_pos: 0, cur: 0, started: false } }

    #[inline]
    fn read_bit(&mut self) -> Option<u8> {
        if !self.started || self.bit_pos == 0 {
            if self.pos >= self.bytes.len() { return None; }
            self.cur = self.bytes[self.pos];
            self.pos += 1;
            if self.cur == 0xff {
                if self.pos >= self.bytes.len() { return None; }
                let stuffed = self.bytes[self.pos];
                if stuffed == 0x00 { self.pos += 1; }
                else { return None; }
            }
            self.bit_pos = 8;
            self.started = true;
        }
        self.bit_pos -= 1;
        Some((self.cur >> self.bit_pos) & 1)
    }

    #[inline]
    fn peek_bits(&mut self, bits: u8) -> Option<u32> {
        let saved_pos = self.pos;
        let saved_bit = self.bit_pos;
        let saved_cur = self.cur;
        let saved_started = self.started;
        let mut out: u32 = 0;
        let mut taken: u8 = 0;
        while taken < bits {
            match self.read_bit() {
                Some(b) => { out = (out << 1) | (b as u32); taken += 1; }
                None => { out <<= bits - taken; break; }
            }
        }
        self.pos = saved_pos;
        self.bit_pos = saved_bit;
        self.cur = saved_cur;
        self.started = saved_started;
        Some(out)
    }

    fn consume_bits(&mut self, bits: u8) {
        for _ in 0..bits { let _ = self.read_bit(); }
    }

    fn align_to_byte(&mut self) { self.bit_pos = 0; }

    fn skip_restart_marker(&mut self) -> Option<()> {
        if self.pos + 1 >= self.bytes.len() { return None; }
        if self.bytes[self.pos] != 0xff { return None; }
        let m = self.bytes[self.pos + 1];
        if !(0xd0..=0xd7).contains(&m) { return None; }
        self.pos += 2;
        self.started = false;
        self.cur = 0;
        Some(())
    }
}
