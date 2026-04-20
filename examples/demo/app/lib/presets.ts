/**
 * A handful of Unsplash presets spanning different chromatic ranges so the
 * extractor has varied input to show off. Kept small on purpose — the demo
 * is about the library, not the gallery.
 */

export interface Preset {
  id: string;
  label: string;
  url: string;
  thumb: string;
}

const u = (id: string, w: number) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=80&fm=jpg&auto=format&fit=crop`;

export const PRESETS: Preset[] = [
  { id: "1506744038136-46273834b3fb", label: "Mountain lake", url: u("1506744038136-46273834b3fb", 1400), thumb: u("1506744038136-46273834b3fb", 320) },
  { id: "1469334031218-e382a71b716b", label: "Abstract paint", url: u("1469334031218-e382a71b716b", 1400), thumb: u("1469334031218-e382a71b716b", 320) },
  { id: "1502082553048-f009c37129b9", label: "Autumn forest", url: u("1502082553048-f009c37129b9", 1400), thumb: u("1502082553048-f009c37129b9", 320) },
  { id: "1513151233558-d860c5398176", label: "Crimson blooms", url: u("1513151233558-d860c5398176", 1400), thumb: u("1513151233558-d860c5398176", 320) },
  { id: "1518791841217-8f162f1e1131", label: "Cat pastels", url: u("1518791841217-8f162f1e1131", 1400), thumb: u("1518791841217-8f162f1e1131", 320) },
  { id: "1470770841072-f978cf4d019e", label: "Fjord dusk", url: u("1470770841072-f978cf4d019e", 1400), thumb: u("1470770841072-f978cf4d019e", 320) },
];
