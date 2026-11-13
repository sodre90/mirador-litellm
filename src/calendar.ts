/** A day as the gateway buckets spend: YYYY-MM-DD in UTC. */
export type Day = string;

const DAY_MS = 86_400_000;

export const dayOf = (time: number): Day => new Date(time).toISOString().slice(0, 10);

export const addDays = (day: Day, days: number): Day => dayOf(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);

/** The Monday the day's week starts on. */
export function weekStartOf(day: Day): Day {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export const monthStartOf = (day: Day): Day => `${day.slice(0, 7)}-01`;

/** The days the statusline and the window count from, for the day `now` falls on. */
export function periodsOf(now: number) {
  const today = dayOf(now);
  return { today, week: weekStartOf(today), month: monthStartOf(today), chartFrom: addDays(today, -29) };
}

export type Periods = ReturnType<typeof periodsOf>;

/** The first day one query has to ask for to fill every period. */
export const earliestOf = ({ today, week, month, chartFrom }: Periods): Day => [today, week, month, chartFrom].sort()[0]!;

/** Every day from `from` through `to`, oldest first. */
export function daysBetween(from: Day, to: Day): Day[] {
  const count = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_, index) => addDays(from, index));
}
