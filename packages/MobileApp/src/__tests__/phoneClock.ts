import { jest } from "@jest/globals";

/*
 * Stands in for the phone's 12- or 24-hour clock (Android: Use 24-hour
 * format; iOS: 24-Hour Time), with its language left as it is: Intl's
 * report of the clock is replaced, which is what utils/date reads
 * (uses12HourClock). Undone by jest.restoreAllMocks().
 *
 * Deliberately not named *.test.ts: a helper, not a suite.
 */
export function onAPhoneThatReads(twelveHour: boolean): void {
  const resolvedOptions: () => Intl.ResolvedDateTimeFormatOptions =
    Intl.DateTimeFormat.prototype.resolvedOptions;

  jest
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockImplementation(function (
      this: Intl.DateTimeFormat,
    ): Intl.ResolvedDateTimeFormatOptions {
      return { ...resolvedOptions.call(this), hour12: twelveHour };
    });
}

// A space, a no-break space or a narrow one: the same to a reader.
export function withPlainSpaces(text: string): string {
  return text.replace(/\s/g, " ");
}
