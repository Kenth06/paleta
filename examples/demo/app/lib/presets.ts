/**
 * Curated Unsplash presets — a mix of food, portraits, landscapes, product,
 * and album-art aesthetics so the palette extraction shows off a wide
 * chromatic range.
 *
 * All URLs use Unsplash's on-the-fly resizer (`?w=1200&q=80&fm=jpg`) so they
 * fit inside the worker's ALLOWED_HOSTS and stay JPEG for the DC-only path.
 */

export interface Preset {
  id: string;
  label: string;
  category: "portrait" | "food" | "landscape" | "product" | "album";
  url: string;
  thumb: string;
  credit: string;
}

const u = (id: string, w: number) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=80&fm=jpg&auto=format&fit=crop`;

export const PRESETS: Preset[] = [
  {
    id: "1506744038136-46273834b3fb",
    label: "Mountain lake",
    category: "landscape",
    url: u("1506744038136-46273834b3fb", 1400),
    thumb: u("1506744038136-46273834b3fb", 320),
    credit: "Bailey Zindel",
  },
  {
    id: "1514996937319-344454492b37",
    label: "Sunset portrait",
    category: "portrait",
    url: u("1514996937319-344454492b37", 1400),
    thumb: u("1514996937319-344454492b37", 320),
    credit: "Jake Davies",
  },
  {
    id: "1504754524776-8f4f37790ca0",
    label: "Pancakes",
    category: "food",
    url: u("1504754524776-8f4f37790ca0", 1400),
    thumb: u("1504754524776-8f4f37790ca0", 320),
    credit: "Joseph Gonzalez",
  },
  {
    id: "1469334031218-e382a71b716b",
    label: "Abstract paint",
    category: "album",
    url: u("1469334031218-e382a71b716b", 1400),
    thumb: u("1469334031218-e382a71b716b", 320),
    credit: "Pawel Czerwinski",
  },
  {
    id: "1519125323398-675f0ddb6308",
    label: "Product bottle",
    category: "product",
    url: u("1519125323398-675f0ddb6308", 1400),
    thumb: u("1519125323398-675f0ddb6308", 320),
    credit: "Unsplash",
  },
  {
    id: "1511988617509-a57c8a288659",
    label: "Brutalist architecture",
    category: "landscape",
    url: u("1511988617509-a57c8a288659", 1400),
    thumb: u("1511988617509-a57c8a288659", 320),
    credit: "Danist Soh",
  },
  {
    id: "1502082553048-f009c37129b9",
    label: "Autumn forest",
    category: "landscape",
    url: u("1502082553048-f009c37129b9", 1400),
    thumb: u("1502082553048-f009c37129b9", 320),
    credit: "Sergei Akulich",
  },
  {
    id: "1513151233558-d860c5398176",
    label: "Crimson blooms",
    category: "album",
    url: u("1513151233558-d860c5398176", 1400),
    thumb: u("1513151233558-d860c5398176", 320),
    credit: "Annie Spratt",
  },
  {
    id: "1498837167922-ddd27525d352",
    label: "Fresh produce",
    category: "food",
    url: u("1498837167922-ddd27525d352", 1400),
    thumb: u("1498837167922-ddd27525d352", 320),
    credit: "Unsplash",
  },
  {
    id: "1520975916090-3105956dac38",
    label: "Studio portrait",
    category: "portrait",
    url: u("1520975916090-3105956dac38", 1400),
    thumb: u("1520975916090-3105956dac38", 320),
    credit: "Houcine Ncib",
  },
  {
    id: "1518791841217-8f162f1e1131",
    label: "Cat pastels",
    category: "portrait",
    url: u("1518791841217-8f162f1e1131", 1400),
    thumb: u("1518791841217-8f162f1e1131", 320),
    credit: "Manja Vitolic",
  },
  {
    id: "1470770841072-f978cf4d019e",
    label: "Fjord dusk",
    category: "landscape",
    url: u("1470770841072-f978cf4d019e", 1400),
    thumb: u("1470770841072-f978cf4d019e", 320),
    credit: "Robert Lukeman",
  },
];
