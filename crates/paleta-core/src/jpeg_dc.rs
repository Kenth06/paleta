//! JPEG DC-only decoder.
//!
//! For palette extraction we don't need the fine detail from AC coefficients.
//! The DC coefficient of each 8×8 DCT block already encodes that block's
//! average luminance/chrominance — so if we Huffman-decode just DCs and skip
//! IDCT entirely, we get a 1/8×1/8 downsampled image for roughly 1/64 the
//! work of a full decode.
//!
//! Supported:
//! - Baseline sequential JPEGs (SOF0 = 0xFFC0)
//! - 3-component YCbCr with 4:4:4 or 4:2:0 subsampling
//! - Restart markers (DRI)
//!
//! Not supported (returns `None`, pipeline falls back to full decode):
//! - Progressive JPEGs (SOF2)
//! - Lossless / arithmetic-coded JPEGs
//! - Grayscale or CMYK JPEGs
//! - 4:2:2, 4:1:1, or other rare subsampling layouts
//!
//! Output: `Some(DecodedImage)` with `data` = RGBA at (width/8, height/8)
//! rounded up. `None` when we can't handle the input and the caller must
//! fall back.

use wasm_bindgen::prelude::*;

/// Small wrapper so the WASM ABI stays narrow: flat bytes + dimensions, or
/// an empty vec on failure. Caller treats zero-length as "unsupported".
#[wasm_bindgen]
pub fn dc_only_decode_jpeg(bytes: &[u8]) -> Vec<u8> {
    match decode(bytes) {
        Some(img) => {
            let mut out = Vec::with_capacity(8 + img.data.len());
            // 4-byte LE width, 4-byte LE height, then RGBA bytes.
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
const DQT: u8 = 0xdb;
const DRI: u8 = 0xdd;
const SOS: u8 = 0xda;

struct QTable {
    values: [u16; 64],
}

impl Default for QTable {
    fn default() -> Self {
        Self { values: [0; 64] }
    }
}

#[derive(Clone)]
struct HuffmanTable {
    /// Fast 256-entry lookup indexed by the next 8 bits of the stream.
    /// Each entry: high byte = code length (or 0xFF if > 8 bits), low byte = value.
    fast: [u16; 256],
    /// Full code table, used only when fast lookup signals overflow (code > 8 bits).
    codes: Vec<HuffCode>,
}

impl Default for HuffmanTable {
    fn default() -> Self {
        Self {
            fast: [0u16; 256],
            codes: Vec::new(),
        }
    }
}

#[derive(Default, Clone, Copy)]
struct HuffCode {
    code: u32,
    length: u8,
    value: u8,
}

struct ComponentInfo {
    id: u8,
    h: u8,        // horizontal sampling factor
    v: u8,        // vertical sampling factor
    qt_id: u8,
    dc_huff_id: u8,
    ac_huff_id: u8,
}

struct FrameInfo {
    width: u16,
    height: u16,
    components: Vec<ComponentInfo>,
    progressive: bool,
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

    while p + 1 < bytes.len() {
        if bytes[p] != 0xff {
            return None;
        }
        let marker = bytes[p + 1];
        p += 2;

        // Standalone markers (no length): RST0..RST7, TEM, 0x01, 0xFF fill.
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
            DRI => {
                if payload.len() < 2 {
                    return None;
                }
                restart_interval = ((payload[0] as u16) << 8) | (payload[1] as u16);
            }
            SOS => {
                let fr = frame.as_ref()?;
                if fr.progressive {
                    // Progressive: the DC-first scan (Ss=0, Se=0, Ah=0) is
                    // what we want. Subsequent scans refine or carry AC —
                    // we ignore them since palette extraction doesn't need
                    // the extra precision.
                    return decode_progressive_dc_scan(
                        fr,
                        &qts,
                        &dc_huff,
                        payload,
                        &bytes[payload_end..],
                        restart_interval,
                    );
                }
                return decode_scan(
                    fr,
                    &qts,
                    &dc_huff,
                    &ac_huff,
                    payload,
                    &bytes[payload_end..],
                    restart_interval,
                );
            }
            // Other SOF variants (SOF3 lossless, SOF5..SOF15 etc.) — unsupported.
            0xc3 | 0xc5..=0xcf => return None,
            _ => { /* ignore APPn, COM, etc. */ }
        }

        p = payload_end;
    }
    None
}

fn parse_dqt(payload: &[u8], qts: &mut [Option<QTable>; 4]) -> Option<()> {
    let mut p = 0;
    while p < payload.len() {
        let b = payload[p];
        let precision = b >> 4; // 0 = 8-bit, 1 = 16-bit
        let id = (b & 0x0f) as usize;
        p += 1;
        if id >= 4 {
            return None;
        }
        let mut q = QTable::default();
        if precision == 0 {
            if p + 64 > payload.len() {
                return None;
            }
            for k in 0..64 {
                q.values[k] = payload[p + k] as u16;
            }
            p += 64;
        } else {
            if p + 128 > payload.len() {
                return None;
            }
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
    if payload.len() < 6 {
        return None;
    }
    let precision = payload[0];
    if precision != 8 {
        return None; // only 8-bit samples
    }
    let height = ((payload[1] as u16) << 8) | (payload[2] as u16);
    let width = ((payload[3] as u16) << 8) | (payload[4] as u16);
    let nf = payload[5] as usize;
    if nf != 1 && nf != 3 {
        // Supported: grayscale (1 component) and YCbCr/RGB (3 components).
        // CMYK (4) and weird layouts fall through to the regular decoder.
        return None;
    }
    if payload.len() < 6 + nf * 3 {
        return None;
    }
    let mut components = Vec::with_capacity(nf);
    for i in 0..nf {
        let base = 6 + i * 3;
        let id = payload[base];
        let sampling = payload[base + 1];
        let h = sampling >> 4;
        let v = sampling & 0x0f;
        let qt_id = payload[base + 2];
        components.push(ComponentInfo {
            id,
            h,
            v,
            qt_id,
            dc_huff_id: 0,
            ac_huff_id: 0,
        });
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
        let class = b >> 4; // 0=DC, 1=AC
        let id = (b & 0x0f) as usize;
        p += 1;
        if id >= 4 {
            return None;
        }
        if p + 16 > payload.len() {
            return None;
        }
        let counts: [u8; 16] = payload[p..p + 16].try_into().ok()?;
        p += 16;
        let total: usize = counts.iter().map(|&c| c as usize).sum();
        if p + total > payload.len() {
            return None;
        }
        let values = &payload[p..p + total];
        p += total;

        let mut codes = Vec::with_capacity(total);
        let mut fast = [0u16; 256];
        let mut code: u32 = 0;
        let mut vi = 0usize;
        for length in 1u8..=16 {
            let n = counts[(length - 1) as usize];
            for _ in 0..n {
                codes.push(HuffCode {
                    code,
                    length,
                    value: values[vi],
                });
                // Populate the fast-lookup table. For codes of length ≤ 8,
                // every 8-bit prefix that starts with the code maps to this
                // entry. There are 2^(8-length) such prefixes.
                if length <= 8 {
                    let shifted = (code << (8 - length)) as usize;
                    let fill = 1usize << (8 - length);
                    let entry = ((length as u16) << 8) | (values[vi] as u16);
                    for k in 0..fill {
                        fast[shifted + k] = entry;
                    }
                }
                vi += 1;
                code += 1;
            }
            code <<= 1;
        }

        let table = HuffmanTable { fast, codes };
        if class == 0 {
            dc_huff[id] = Some(table);
        } else {
            ac_huff[id] = Some(table);
        }
    }
    Some(())
}

fn decode_scan(
    frame: &FrameInfo,
    qts: &[Option<QTable>; 4],
    dc_huff: &[Option<HuffmanTable>; 4],
    ac_huff: &[Option<HuffmanTable>; 4],
    sos_header: &[u8],
    entropy: &[u8],
    restart_interval: u16,
) -> Option<DcImage> {
    if sos_header.is_empty() {
        return None;
    }
    let ns = sos_header[0] as usize;
    if ns != frame.components.len() || 1 + ns * 2 > sos_header.len() {
        return None;
    }

    // Pair SOS component selectors with frame components and capture their
    // DC Huffman table ids.
    let mut comps: Vec<ComponentInfo> = frame
        .components
        .iter()
        .map(|c| ComponentInfo {
            id: c.id,
            h: c.h,
            v: c.v,
            qt_id: c.qt_id,
            dc_huff_id: 0,
            ac_huff_id: 0,
        })
        .collect();

    for i in 0..ns {
        let sel = sos_header[1 + i * 2];
        let table_ids = sos_header[2 + i * 2];
        let dc_id = table_ids >> 4;
        let ac_id = table_ids & 0x0f;
        let c = comps.iter_mut().find(|c| c.id == sel)?;
        c.dc_huff_id = dc_id;
        c.ac_huff_id = ac_id;
    }

    if comps.len() != 1 && comps.len() != 3 {
        return None;
    }
    let grayscale = comps.len() == 1;

    // Max sampling factors determine MCU size.
    let h_max = comps.iter().map(|c| c.h).max()?;
    let v_max = comps.iter().map(|c| c.v).max()?;

    // Supported layouts (luma sampling per MCU, chroma is always 1×1 except
    // grayscale which is 1 component total):
    //   4:4:4   h=1, v=1   grayscale or color
    //   4:2:2   h=2, v=1   color only
    //   4:4:0   h=1, v=2   color only (rare)
    //   4:2:0   h=2, v=2   color only
    let subsample = match (h_max, v_max, grayscale) {
        (1, 1, _) => Subsampling::S444,
        (2, 1, false) => Subsampling::S422,
        (1, 2, false) => Subsampling::S440,
        (2, 2, false) => Subsampling::S420,
        _ => return None,
    };

    // Output size = one pixel per 8×h_max × 8×v_max block region (MCU).
    let mcu_w = 8 * h_max as usize;
    let mcu_h = 8 * v_max as usize;
    let mcus_x = (frame.width as usize + mcu_w - 1) / mcu_w;
    let mcus_y = (frame.height as usize + mcu_h - 1) / mcu_h;

    // Output: one pixel per 8×8 Y-block, so (width/8, height/8) rounded up.
    let out_w = (frame.width as usize + 7) / 8;
    let out_h = (frame.height as usize + 7) / 8;
    let mut luma = vec![0u8; out_w * out_h];
    let mut cb = vec![128u8; out_w * out_h];
    let mut cr = vec![128u8; out_w * out_h];

    // Dequant constants: DC element is index 0 of the zigzag-natural order.
    let mut q_dc = [0u16; 3];
    let mut dc_tables: Vec<&HuffmanTable> = Vec::with_capacity(comps.len());
    let mut ac_tables: Vec<&HuffmanTable> = Vec::with_capacity(comps.len());
    for (i, c) in comps.iter().enumerate() {
        q_dc[i] = qts[c.qt_id as usize].as_ref()?.values[0];
        dc_tables.push(dc_huff[c.dc_huff_id as usize].as_ref()?);
        ac_tables.push(ac_huff[c.ac_huff_id as usize].as_ref()?);
    }

    let mut reader = BitReader::new(entropy);
    let mut dc_prev = [0i32; 3];
    let mut mcu_counter: u16 = 0;
    let ncomp = comps.len();

    for my in 0..mcus_y {
        for mx in 0..mcus_x {
            // Each MCU: for each component, H*V blocks in row-major order.
            for (ci, comp) in comps.iter().enumerate() {
                let blocks = (comp.h * comp.v) as usize;
                for bi in 0..blocks {
                    let dc = decode_block_dc(&mut reader, dc_tables[ci], &mut dc_prev[ci])?;
                    if ncomp == 1 {
                        // Grayscale: one-block-per-MCU, Y only.
                        let out_x = mx;
                        let out_y = my;
                        if out_x < out_w && out_y < out_h {
                            let value = dequantize_and_levelshift(dc, q_dc[0]);
                            luma[out_y * out_w + out_x] = value;
                        }
                    } else if ci == 0 {
                        // Y component: store DC at the sub-block's position.
                        let bx_in_mcu = bi % comp.h as usize;
                        let by_in_mcu = bi / comp.h as usize;
                        let out_x = mx * comp.h as usize + bx_in_mcu;
                        let out_y = my * comp.v as usize + by_in_mcu;
                        if out_x < out_w && out_y < out_h {
                            let value = dequantize_and_levelshift(dc, q_dc[0]);
                            luma[out_y * out_w + out_x] = value;
                        }
                    } else if matches!(subsample, Subsampling::S444) {
                        // 4:4:4: chroma at same resolution as luma (1 block per MCU).
                        if bi == 0 {
                            let out_x = mx;
                            let out_y = my;
                            if out_x < out_w && out_y < out_h {
                                let value = dequantize_and_levelshift(dc, q_dc[ci]);
                                if ci == 1 {
                                    cb[out_y * out_w + out_x] = value;
                                } else {
                                    cr[out_y * out_w + out_x] = value;
                                }
                            }
                        }
                    } else {
                        // Subsampled chroma: one chroma block covers (h_max × v_max)
                        // luma-resolution positions per MCU. We compute the MCU's
                        // top-left luma coordinate and fill a (h_max × v_max) patch.
                        if bi == 0 {
                            let value = dequantize_and_levelshift(dc, q_dc[ci]);
                            let hm = h_max as usize;
                            let vm = v_max as usize;
                            for dy in 0..vm {
                                for dx in 0..hm {
                                    let ox = mx * hm + dx;
                                    let oy = my * vm + dy;
                                    if ox < out_w && oy < out_h {
                                        if ci == 1 {
                                            cb[oy * out_w + ox] = value;
                                        } else {
                                            cr[oy * out_w + ox] = value;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Skip AC coefficients for this block.
                    skip_ac(&mut reader, ac_tables[ci])?;
                }
            }

            // Restart-marker handling: when we finish `restart_interval` MCUs,
            // align to byte boundary and expect 0xFF 0xD0..D7, then reset DC
            // predictors.
            mcu_counter += 1;
            if restart_interval > 0 && mcu_counter % restart_interval == 0 {
                reader.align_to_byte();
                reader.skip_restart_marker()?;
                dc_prev = [0; 3];
            }
        }
    }

    // Produce RGBA. Grayscale: broadcast Y to all channels.
    let mut rgba = vec![0u8; out_w * out_h * 4];
    if ncomp == 1 {
        for i in 0..(out_w * out_h) {
            let y = luma[i];
            rgba[i * 4] = y;
            rgba[i * 4 + 1] = y;
            rgba[i * 4 + 2] = y;
            rgba[i * 4 + 3] = 255;
        }
    } else {
        for i in 0..(out_w * out_h) {
            let y = luma[i] as i32;
            let cb_v = cb[i] as i32 - 128;
            let cr_v = cr[i] as i32 - 128;
            let r = clamp_byte(y + (45 * cr_v >> 5));
            let g = clamp_byte(y - (11 * cb_v + 23 * cr_v >> 5));
            let b = clamp_byte(y + (113 * cb_v >> 6));
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = 255;
        }
    }

    Some(DcImage {
        data: rgba,
        width: out_w as u32,
        height: out_h as u32,
    })
}

/// Decode a progressive-JPEG "DC first" scan (Ss=0, Se=0, Ah=0).
///
/// Progressive JPEGs split coefficients across multiple scans. The very first
/// scan always carries DC values (possibly with a successive-approximation
/// shift Al > 0, meaning "top N-Al bits only"). Later scans refine DC and
/// add AC — we ignore them since palette extraction doesn't need that
/// precision.
///
/// On unsupported scan types (AC scan, DC refinement) returns `None` so the
/// caller falls back to the full decoder.
fn decode_progressive_dc_scan(
    frame: &FrameInfo,
    qts: &[Option<QTable>; 4],
    dc_huff: &[Option<HuffmanTable>; 4],
    sos_header: &[u8],
    entropy: &[u8],
    restart_interval: u16,
) -> Option<DcImage> {
    // SOS format: Ns + (Cs,Ta) * Ns + Ss + Se + Ah|Al (3 bytes tail)
    if sos_header.is_empty() {
        return None;
    }
    let ns = sos_header[0] as usize;
    if ns == 0 || ns > 3 || 1 + ns * 2 + 3 > sos_header.len() {
        return None;
    }
    let tail_off = 1 + ns * 2;
    let ss = sos_header[tail_off];
    let se = sos_header[tail_off + 1];
    let ah_al = sos_header[tail_off + 2];
    let ah = ah_al >> 4;
    let al = ah_al & 0x0f;

    // Only accept DC-first scans.
    if ss != 0 || se != 0 || ah != 0 {
        return None;
    }

    // Pair components.
    let mut comps: Vec<ComponentInfo> = Vec::with_capacity(ns);
    for i in 0..ns {
        let sel = sos_header[1 + i * 2];
        let table_ids = sos_header[2 + i * 2];
        let dc_id = table_ids >> 4;
        let frame_c = frame.components.iter().find(|c| c.id == sel)?;
        comps.push(ComponentInfo {
            id: sel,
            h: frame_c.h,
            v: frame_c.v,
            qt_id: frame_c.qt_id,
            dc_huff_id: dc_id,
            ac_huff_id: 0,
        });
    }

    // In progressive JPEGs, scans can be non-interleaved (one component per
    // scan). Only interleaved scans need the multi-component MCU handling.
    // We support both paths below.
    let ncomp = comps.len();
    let all_components = ncomp == frame.components.len();

    // Only support grayscale (1 comp) and YCbCr (3 comps) as in baseline.
    if frame.components.len() != 1 && frame.components.len() != 3 {
        return None;
    }
    let grayscale = frame.components.len() == 1;

    // For the progressive DC-first scan, we expect all components to be
    // interleaved so we recover DC for all of them in one pass. If it's
    // non-interleaved we'd need multi-pass coordination (not worth it for
    // palette extraction).
    if !all_components {
        return None;
    }

    let h_max = frame.components.iter().map(|c| c.h).max()?;
    let v_max = frame.components.iter().map(|c| c.v).max()?;

    let subsample = match (h_max, v_max, grayscale) {
        (1, 1, _) => Subsampling::S444,
        (2, 1, false) => Subsampling::S422,
        (1, 2, false) => Subsampling::S440,
        (2, 2, false) => Subsampling::S420,
        _ => return None,
    };
    let _ = subsample; // Same sub-block handling as baseline below.

    let mcu_w = 8 * h_max as usize;
    let mcu_h = 8 * v_max as usize;
    let mcus_x = (frame.width as usize + mcu_w - 1) / mcu_w;
    let mcus_y = (frame.height as usize + mcu_h - 1) / mcu_h;

    let out_w = (frame.width as usize + 7) / 8;
    let out_h = (frame.height as usize + 7) / 8;
    let mut luma = vec![0u8; out_w * out_h];
    let mut cb = vec![128u8; out_w * out_h];
    let mut cr = vec![128u8; out_w * out_h];

    let mut q_dc = [0u16; 3];
    let mut dc_tables: Vec<&HuffmanTable> = Vec::with_capacity(ncomp);
    for (i, c) in comps.iter().enumerate() {
        q_dc[i] = qts[c.qt_id as usize].as_ref()?.values[0];
        dc_tables.push(dc_huff[c.dc_huff_id as usize].as_ref()?);
    }

    let mut reader = BitReader::new(entropy);
    let mut dc_prev = [0i32; 3];
    let mut mcu_counter: u16 = 0;

    for my in 0..mcus_y {
        for mx in 0..mcus_x {
            for (ci, comp) in comps.iter().enumerate() {
                let blocks = (comp.h * comp.v) as usize;
                for bi in 0..blocks {
                    let dc = decode_block_dc(&mut reader, dc_tables[ci], &mut dc_prev[ci])?;
                    // Successive approximation: for DC-first, the stored value
                    // is `real_dc >> al`, so recover by left-shifting.
                    let dc_shifted = dc << (al as u32);

                    if ncomp == 1 {
                        let ox = mx;
                        let oy = my;
                        if ox < out_w && oy < out_h {
                            luma[oy * out_w + ox] = dequantize_and_levelshift(dc_shifted, q_dc[0]);
                        }
                    } else if ci == 0 {
                        let bx = bi % comp.h as usize;
                        let by = bi / comp.h as usize;
                        let ox = mx * comp.h as usize + bx;
                        let oy = my * comp.v as usize + by;
                        if ox < out_w && oy < out_h {
                            luma[oy * out_w + ox] = dequantize_and_levelshift(dc_shifted, q_dc[0]);
                        }
                    } else if bi == 0 {
                        let value = dequantize_and_levelshift(dc_shifted, q_dc[ci]);
                        let hm = h_max as usize;
                        let vm = v_max as usize;
                        for dy in 0..vm {
                            for dx in 0..hm {
                                let ox = mx * hm + dx;
                                let oy = my * vm + dy;
                                if ox < out_w && oy < out_h {
                                    if ci == 1 {
                                        cb[oy * out_w + ox] = value;
                                    } else {
                                        cr[oy * out_w + ox] = value;
                                    }
                                }
                            }
                        }
                    }
                    // No AC skipping — progressive DC-first scan contains only
                    // DC coefficients, so each block ends after its DC symbol.
                }
            }
            mcu_counter += 1;
            if restart_interval > 0 && mcu_counter % restart_interval == 0 {
                reader.align_to_byte();
                reader.skip_restart_marker()?;
                dc_prev = [0; 3];
            }
        }
    }

    let mut rgba = vec![0u8; out_w * out_h * 4];
    if ncomp == 1 {
        for i in 0..(out_w * out_h) {
            let y = luma[i];
            rgba[i * 4] = y;
            rgba[i * 4 + 1] = y;
            rgba[i * 4 + 2] = y;
            rgba[i * 4 + 3] = 255;
        }
    } else {
        for i in 0..(out_w * out_h) {
            let y = luma[i] as i32;
            let cb_v = cb[i] as i32 - 128;
            let cr_v = cr[i] as i32 - 128;
            let r = clamp_byte(y + (45 * cr_v >> 5));
            let g = clamp_byte(y - (11 * cb_v + 23 * cr_v >> 5));
            let b = clamp_byte(y + (113 * cb_v >> 6));
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = 255;
        }
    }

    Some(DcImage {
        data: rgba,
        width: out_w as u32,
        height: out_h as u32,
    })
}

enum Subsampling {
    S444,
    S422, // h=2, v=1
    S440, // h=1, v=2
    S420, // h=2, v=2
}

fn clamp_byte(v: i32) -> u8 {
    if v < 0 {
        0
    } else if v > 255 {
        255
    } else {
        v as u8
    }
}

fn dequantize_and_levelshift(dc: i32, q: u16) -> u8 {
    // DC coefficient of an 8x8 DCT block is 8*mean (DCT normalized so DC =
    // sum/8). After dequantization (× q), we divide by 8 to get the mean
    // pixel value of the 8x8 block, then level-shift by +128.
    let raw = (dc as i64) * (q as i64);
    let mean = (raw / 8) + 128;
    if mean < 0 {
        0
    } else if mean > 255 {
        255
    } else {
        mean as u8
    }
}

fn decode_block_dc(reader: &mut BitReader, table: &HuffmanTable, prev: &mut i32) -> Option<i32> {
    let s = huffman_decode(reader, table)?;
    let diff = receive_extend(reader, s)?;
    *prev += diff;
    Some(*prev)
}

/// Advance the bit reader past all 63 AC coefficients of one 8×8 block.
///
/// JPEG AC coefficients are run-length encoded as (R, S) pairs where R is
/// the count of preceding zeros (0..=15) and S is the bit-size of the next
/// non-zero value (0..=10). The RS byte is itself Huffman-coded. Two sentinel
/// RS values: 0x00 ends the block (EOB), 0xF0 means "16 zeros and continue".
fn skip_ac(reader: &mut BitReader, table: &HuffmanTable) -> Option<()> {
    let mut k = 1; // AC coefficients indexed 1..=63
    while k <= 63 {
        let rs = huffman_decode(reader, table)?;
        let r = rs >> 4;
        let s = rs & 0x0f;
        if s == 0 {
            if r == 15 {
                // ZRL: 16 zeros, then continue.
                k += 16;
                continue;
            }
            // EOB — rest of block is zeros.
            return Some(());
        }
        // Skip past (r zeros, then s-bit value).
        k += r as usize + 1;
        // Read and discard the value's s bits.
        for _ in 0..s {
            reader.read_bit()?;
        }
    }
    Some(())
}

fn huffman_decode(reader: &mut BitReader, table: &HuffmanTable) -> Option<u8> {
    // Fast path: peek 8 bits, look up in 256-entry table.
    let prefix = reader.peek_bits(8)?;
    let entry = table.fast[prefix as usize];
    let len = (entry >> 8) as u8;
    if len > 0 {
        // Matched a ≤ 8-bit code. Consume exactly `len` bits and return value.
        reader.consume_bits(len);
        return Some((entry & 0xff) as u8);
    }
    // Slow path: code is longer than 8 bits. We already know the first 8 bits
    // in `prefix`; continue bit by bit up to 16 total, scanning `codes`.
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
    if s == 0 {
        return Some(0);
    }
    let mut v: i32 = 0;
    for _ in 0..s {
        v = (v << 1) | (reader.read_bit()? as i32);
    }
    let half = 1i32 << (s - 1);
    if v < half {
        Some(v - (1 << s) + 1)
    } else {
        Some(v)
    }
}

struct BitReader<'a> {
    bytes: &'a [u8],
    pos: usize,
    bit_pos: u8,
    cur: u8,
    started: bool,
}

impl<'a> BitReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0, bit_pos: 0, cur: 0, started: false }
    }

    #[inline]
    fn read_bit(&mut self) -> Option<u8> {
        if !self.started || self.bit_pos == 0 {
            if self.pos >= self.bytes.len() {
                return None;
            }
            self.cur = self.bytes[self.pos];
            self.pos += 1;
            if self.cur == 0xff {
                if self.pos >= self.bytes.len() {
                    return None;
                }
                let stuffed = self.bytes[self.pos];
                if stuffed == 0x00 {
                    self.pos += 1;
                } else {
                    return None;
                }
            }
            self.bit_pos = 8;
            self.started = true;
        }
        self.bit_pos -= 1;
        Some((self.cur >> self.bit_pos) & 1)
    }

    /// Peek the next up-to-8 bits without consuming. Returns the bits
    /// left-aligned (MSB is the next bit of the stream). Shorter reads
    /// happen near EOF — caller should fall back to read_bit().
    #[inline]
    fn peek_bits(&mut self, bits: u8) -> Option<u32> {
        let mut out: u32 = 0;
        let mut taken: u8 = 0;
        // Save reader state to rewind on short read.
        let saved_pos = self.pos;
        let saved_bit = self.bit_pos;
        let saved_cur = self.cur;
        let saved_started = self.started;
        while taken < bits {
            match self.read_bit() {
                Some(b) => {
                    out = (out << 1) | (b as u32);
                    taken += 1;
                }
                None => {
                    // Pad remaining with zeros; caller has to accept that or
                    // fall back.
                    out <<= bits - taken;
                    break;
                }
            }
        }
        // Rewind — peek is non-consumptive.
        self.pos = saved_pos;
        self.bit_pos = saved_bit;
        self.cur = saved_cur;
        self.started = saved_started;
        Some(out)
    }

    fn consume_bits(&mut self, bits: u8) {
        for _ in 0..bits {
            let _ = self.read_bit();
        }
    }

    fn align_to_byte(&mut self) {
        self.bit_pos = 0;
    }

    fn skip_restart_marker(&mut self) -> Option<()> {
        if self.pos + 1 >= self.bytes.len() {
            return None;
        }
        if self.bytes[self.pos] != 0xff {
            return None;
        }
        let m = self.bytes[self.pos + 1];
        if !(0xd0..=0xd7).contains(&m) {
            return None;
        }
        self.pos += 2;
        self.started = false;
        self.cur = 0;
        Some(())
    }
}
