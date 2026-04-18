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
const SOF0: u8 = 0xc0;
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

#[derive(Default, Clone)]
struct HuffmanTable {
    /// huffman codes sorted by length, indexed lane-by-lane
    codes: Vec<HuffCode>,
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
            SOF0 => frame = Some(parse_sof0(payload)?),
            DHT => parse_dht(payload, &mut dc_huff, &mut ac_huff)?,
            DRI => {
                if payload.len() < 2 {
                    return None;
                }
                restart_interval = ((payload[0] as u16) << 8) | (payload[1] as u16);
            }
            SOS => {
                let frame = frame.as_ref()?;
                return decode_scan(
                    frame,
                    &qts,
                    &dc_huff,
                    &ac_huff,
                    payload,
                    &bytes[payload_end..],
                    restart_interval,
                );
            }
            // SOF2 (progressive) and friends: unsupported.
            0xc2 | 0xc3 | 0xc5..=0xcf => return None,
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

fn parse_sof0(payload: &[u8]) -> Option<FrameInfo> {
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
    if nf != 3 {
        // Only YCbCr/RGB triples for now — gray/CMYK unsupported.
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
    Some(FrameInfo { width, height, components })
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
                vi += 1;
                code += 1;
            }
            code <<= 1;
        }

        let table = HuffmanTable { codes };
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

    // Only YCbCr (3 components) where Y carries the luma info we actually
    // use for palette color. We still decode Cb/Cr because the MCU bit
    // stream interleaves them.
    if comps.len() != 3 {
        return None;
    }

    // Max sampling factors determine MCU size.
    let h_max = comps.iter().map(|c| c.h).max()?;
    let v_max = comps.iter().map(|c| c.v).max()?;

    // We support 4:4:4 (h_max=1, v_max=1) and 4:2:0 (h_max=2, v_max=2).
    let subsample = match (h_max, v_max) {
        (1, 1) => Subsampling::S444,
        (2, 2) => Subsampling::S420,
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
    let q_dc: [u16; 3] = [
        qts[comps[0].qt_id as usize].as_ref()?.values[0],
        qts[comps[1].qt_id as usize].as_ref()?.values[0],
        qts[comps[2].qt_id as usize].as_ref()?.values[0],
    ];

    let dc_tables: [&HuffmanTable; 3] = [
        dc_huff[comps[0].dc_huff_id as usize].as_ref()?,
        dc_huff[comps[1].dc_huff_id as usize].as_ref()?,
        dc_huff[comps[2].dc_huff_id as usize].as_ref()?,
    ];
    let ac_tables: [&HuffmanTable; 3] = [
        ac_huff[comps[0].ac_huff_id as usize].as_ref()?,
        ac_huff[comps[1].ac_huff_id as usize].as_ref()?,
        ac_huff[comps[2].ac_huff_id as usize].as_ref()?,
    ];

    let mut reader = BitReader::new(entropy);
    let mut dc_prev = [0i32; 3];
    let mut mcu_counter: u16 = 0;

    for my in 0..mcus_y {
        for mx in 0..mcus_x {
            // Each MCU: for each component, H*V blocks in row-major order.
            for (ci, comp) in comps.iter().enumerate() {
                let blocks = (comp.h * comp.v) as usize;
                for bi in 0..blocks {
                    let dc = decode_block_dc(&mut reader, dc_tables[ci], &mut dc_prev[ci])?;
                    if ci == 0 {
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
                        // 4:4:4: chroma at same resolution as luma.
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
                        // 4:2:0: one chroma block covers a 2×2 luma region.
                        if bi == 0 {
                            let value = dequantize_and_levelshift(dc, q_dc[ci]);
                            // Fill 2×2 luma-resolution positions with this value.
                            for dy in 0..2 {
                                for dx in 0..2 {
                                    let ox = mx * 2 + dx;
                                    let oy = my * 2 + dy;
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

    // YCbCr → RGB at output resolution.
    let mut rgba = vec![0u8; out_w * out_h * 4];
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

    Some(DcImage {
        data: rgba,
        width: out_w as u32,
        height: out_h as u32,
    })
}

enum Subsampling {
    S444,
    S420,
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
    let mut code: u32 = 0;
    let mut length: u8 = 0;
    // Worst-case 16 bits per symbol.
    for _ in 0..16 {
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
    bit_pos: u8, // 0..=7, next bit to read (from MSB)
    cur: u8,
    started: bool,
}

impl<'a> BitReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0, bit_pos: 0, cur: 0, started: false }
    }

    fn read_bit(&mut self) -> Option<u8> {
        if !self.started || self.bit_pos == 0 {
            if self.started && self.bit_pos == 0 {
                // Need to fetch the next byte.
            }
            if self.pos >= self.bytes.len() {
                return None;
            }
            self.cur = self.bytes[self.pos];
            self.pos += 1;
            // Byte stuffing: 0xFF 0x00 is a literal 0xFF.
            if self.cur == 0xff {
                if self.pos >= self.bytes.len() {
                    return None;
                }
                let stuffed = self.bytes[self.pos];
                if stuffed == 0x00 {
                    self.pos += 1;
                } else {
                    // Unexpected marker — treat as end of scan.
                    return None;
                }
            }
            self.bit_pos = 8;
            self.started = true;
        }
        self.bit_pos -= 1;
        let bit = (self.cur >> self.bit_pos) & 1;
        Some(bit)
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
