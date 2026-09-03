/** Which season the window shows, from the local calendar month (Northern hemisphere). */

export type Season = "winter" | "spring" | "summer" | "autumn";

const BY_MONTH: Season[] = [
  "winter", // Jan
  "winter", // Feb
  "spring", // Mar
  "spring", // Apr
  "spring", // May
  "summer", // Jun
  "summer", // Jul
  "summer", // Aug
  "autumn", // Sep
  "autumn", // Oct
  "autumn", // Nov
  "winter", // Dec
];

export function seasonAt(d: Date): Season {
  return BY_MONTH[d.getMonth()]!;
}
