/** Seeded titles for pieces. Cozy, a little literary, never the same twice in a row. */
import type { FormId } from "./economy";
import { mulberry32, pick, type Rng } from "./rng";

export const KEYS = ["C", "G", "D", "A", "E", "B", "F♯", "C♯", "F", "B♭", "E♭", "A♭"] as const;
export type KeyName = (typeof KEYS)[number];
export type Mode = "major" | "minor";

const OBJECTS = [
  "a Teacup", "a Sleeping Cat", "a Rainy Window", "a Paper Boat", "an Open Drawer", "a Late Train",
  "a Borrowed Umbrella", "the Kettle", "a Quiet Street", "a Lost Glove", "a Candle Stub", "the Last Biscuit",
  "a Crooked Picture", "a Slow Clock", "an Unread Letter", "the Neighbour's Radio",
];
const MOMENTS = [
  "a Quiet Tuesday", "Early Morning", "the Last Light", "a Long Afternoon", "First Frost",
  "the Hour Before Rain", "Sunday, Slowly", "a Foggy Harbour", "the Small Hours", "Half-Past Nothing",
  "a Snow Day", "the Second Coffee", "an Empty Platform", "Late Summer",
];
const NICKNAMES = [
  "The Long Week", "The Northern Window", "The Unfinished Cup", "Small Hours", "The Lighthouse",
  "Ninety Days of Rain", "The Copper Kettle", "Winter Letters", "The Attic", "Low Tide",
  "The Pale Garden", "Paper Lanterns", "The Sleeping City", "Salt and Chalk", "The Deadline",
];
const OPERAS = [
  "The Clockmaker's Daughter", "The Lighthouse Keeper", "A Winter Wedding", "The Cartographer",
  "The Last Ferry", "The Orchard at Night", "The Bell-Founder", "Letters from the Coast",
  "The Glass Harbour", "The Sparrow King",
];

export interface TitleParts {
  key: KeyName;
  mode: Mode;
  title: string;
}

export function keyLabel(key: KeyName, mode: Mode): string {
  return `${key} ${mode}`;
}

/** Generates a title for a piece. `opus` is the opus number to append. */
export function generateTitle(formId: FormId, seed: number, opus: number): TitleParts {
  const rng: Rng = mulberry32(seed ^ 0x5eed);
  const key = pick(rng, KEYS);
  const mode: Mode = rng() < 0.45 ? "minor" : "major";
  const k = keyLabel(key, mode);
  let title: string;
  switch (formId) {
    case "bagatelle":
      title = pick(rng, [`Bagatelle in ${k}`, `Bagatelle for ${pick(rng, OBJECTS)}`, `Little Bagatelle in ${k}`]);
      break;
    case "etude":
      title = pick(rng, [`Étude in ${k}`, `Étude on ${pick(rng, MOMENTS)}`, `Study for ${pick(rng, OBJECTS)}`]);
      break;
    case "nocturne":
      title = pick(rng, [`Nocturne in ${k}`, `Nocturne for ${pick(rng, MOMENTS)}`, `Nocturne “${pick(rng, NICKNAMES)}”`]);
      break;
    case "sonata":
      title = pick(rng, [`Sonata in ${k}`, `Sonata in ${k} “${pick(rng, NICKNAMES)}”`, `Sonata for ${pick(rng, MOMENTS)}`]);
      break;
    case "concerto":
      title = pick(rng, [`Piano Concerto in ${k}`, `Concerto in ${k} “${pick(rng, NICKNAMES)}”`]);
      break;
    case "symphony":
      title = pick(rng, [`Symphony in ${k} “${pick(rng, NICKNAMES)}”`, `Symphony “${pick(rng, NICKNAMES)}”`]);
      break;
    case "opera":
      title = pick(rng, [pick(rng, OPERAS), `${pick(rng, OPERAS)}, in ${2 + Math.floor(rng() * 3)} acts`]);
      break;
  }
  return { key, mode, title: `${title}, Op. ${opus}` };
}

export const COMPOSER_NAMES = ["Pip", "Wren", "Otto", "Nell", "Ludo", "Mabel", "Fitz", "Ada"] as const;
