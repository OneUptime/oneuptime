import {
  storedInstantToWallClockInput,
  wallClockInputToStoredInstant,
} from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeAnchorUtil";

/*
 * Guards the fix for the rotation-start / hand-off timezone asymmetry: what the
 * admin types must be enforced as wall-clock in the SCHEDULE timezone, exactly
 * like the restriction times, regardless of the admin's browser zone. These
 * assertions are machine-timezone independent: `new Date(y, m, d, h, ...)`
 * builds a value whose LOCAL wall-clock is the typed time, and the helpers only
 * ever move wall-clock components between zones.
 */
describe("LayerDateTimeAnchorUtil", () => {
  // An admin types "2026-07-09 09:00" into the datetime-local input.
  const typedWallClock: () => Date = (): Date => {
    return new Date(2026, 6, 9, 9, 0, 0); // month is 0-indexed -> July
  };

  const NEW_YORK: string = "America/New_York";
  const KOLKATA: string = "Asia/Kolkata";

  describe("wallClockInputToStoredInstant + storedInstantToWallClockInput", () => {
    test("enforced wall-clock in the schedule zone equals the typed time", () => {
      const stored: Date = wallClockInputToStoredInstant(
        typedWallClock(),
        NEW_YORK,
      );

      // Reading the stored instant back in the schedule zone must show 09:00.
      const backInScheduleZone: Date | undefined =
        storedInstantToWallClockInput(stored, NEW_YORK);

      expect(backInScheduleZone).toBeDefined();
      expect(backInScheduleZone!.getHours()).toBe(9);
      expect(backInScheduleZone!.getMinutes()).toBe(0);
    });

    test("the same typed time anchors to DIFFERENT instants per schedule zone", () => {
      // If the anchoring were removed (plain instant), these would be equal.
      const storedNy: Date = wallClockInputToStoredInstant(
        typedWallClock(),
        NEW_YORK,
      );
      const storedKolkata: Date = wallClockInputToStoredInstant(
        typedWallClock(),
        KOLKATA,
      );

      expect(storedNy.getTime()).not.toBe(storedKolkata.getTime());

      // ...yet each still reads 09:00 in its own schedule zone.
      expect(
        storedInstantToWallClockInput(storedNy, NEW_YORK)!.getHours(),
      ).toBe(9);
      expect(
        storedInstantToWallClockInput(storedKolkata, KOLKATA)!.getHours(),
      ).toBe(9);
    });

    test("round-trips a stored instant back to the same typed wall-clock", () => {
      const stored: Date = wallClockInputToStoredInstant(
        typedWallClock(),
        NEW_YORK,
      );

      const display: Date | undefined = storedInstantToWallClockInput(
        stored,
        NEW_YORK,
      );

      expect(display!.getHours()).toBe(9);
      expect(display!.getMinutes()).toBe(0);
    });

    test("accepts an ISO string input as well as a Date", () => {
      const iso: string = typedWallClock().toISOString();
      const fromString: Date = wallClockInputToStoredInstant(iso, NEW_YORK);
      const fromDate: Date = wallClockInputToStoredInstant(
        typedWallClock(),
        NEW_YORK,
      );

      expect(fromString.getTime()).toBe(fromDate.getTime());
    });
  });

  describe("legacy behavior when no schedule timezone is set", () => {
    test("wallClockInputToStoredInstant keeps the raw browser instant", () => {
      const typed: Date = typedWallClock();
      const stored: Date = wallClockInputToStoredInstant(typed, undefined);
      expect(stored.getTime()).toBe(typed.getTime());
    });

    test("storedInstantToWallClockInput returns the instant unchanged", () => {
      const typed: Date = typedWallClock();
      const display: Date | undefined = storedInstantToWallClockInput(
        typed,
        undefined,
      );
      expect(display!.getTime()).toBe(typed.getTime());
    });
  });

  describe("empty / missing values", () => {
    test("undefined, null and empty string display as undefined", () => {
      expect(
        storedInstantToWallClockInput(undefined, NEW_YORK),
      ).toBeUndefined();
      expect(storedInstantToWallClockInput(null, NEW_YORK)).toBeUndefined();
      expect(storedInstantToWallClockInput("", NEW_YORK)).toBeUndefined();
    });
  });
});
