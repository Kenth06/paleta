# @ken0106/exif

> EXIF APP1 embedded-JPEG thumbnail extractor. Pass the output to
> [@ken0106/core](https://www.npmjs.com/package/@ken0106/core)'s
> `thumbnailExtractor` option to turn full-image decodes into ~5ms
> thumbnail decodes when the JPEG ships one.

```sh
npm install @ken0106/exif
```

## Quick start

```ts
import { extractExifThumbnail } from "@ken0106/exif";
import { getPalette } from "@ken0106/core";

const result = await getPalette(jpegUrl, {
  decoders: { jpeg: myJpegDecoder },
  thumbnailExtractor: extractExifThumbnail,
  minThumbnailDimension: 64,  // ignore smaller stubs
});

result.meta.path; // "exif-thumb" when the fast path fired
```

## What it does

Most photos from phones, digital cameras, and professional pipelines carry
an embedded JPEG thumbnail inside the EXIF APP1 segment — usually 100–300
pixels wide, under 64KB. When present, decoding *that* instead of the full
image gives you the same palette for a fraction of the cost.

This package is a standalone parser: it walks the JPEG segment list, locates
APP1, verifies the `"Exif\0\0"` identifier, parses the TIFF header, walks
IFD0 and IFD1, and returns the bytes at `JpegIFOffset` of length
`JpegIFByteCount`. No decoder needed — those bytes are themselves a JPEG.

## API

```ts
extractExifThumbnail(bytes: Uint8Array): {
  bytes: Uint8Array;   // the inner JPEG, starting with 0xFF 0xD8
  offset: number;      // offset into the outer JPEG where it starts
} | undefined;
```

Returns `undefined` for PNG/WebP/AVIF, for JPEGs without an EXIF thumbnail,
or for malformed EXIF data.

## License

MIT
