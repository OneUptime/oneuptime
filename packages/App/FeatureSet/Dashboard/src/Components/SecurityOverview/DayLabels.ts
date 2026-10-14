// "14 Oct" for a YYYY-MM-DD day, in UTC like the counts.
export function formatDayLabel(day: string): string {
  const date: Date = new Date(`${day}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return day;
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/*
 * Which day labels fit under the bars: every day for a week, then every
 * few, always the first and the last, so a month of bars stays readable.
 */
export function getLabelledDayIndexes(dayCount: number): Set<number> {
  const indexes: Set<number> = new Set<number>();

  if (dayCount <= 0) {
    return indexes;
  }

  const step: number = dayCount <= 8 ? 1 : Math.ceil(dayCount / 6);

  for (let index: number = 0; index < dayCount; index += step) {
    indexes.add(index);
  }

  indexes.add(dayCount - 1);

  return indexes;
}
