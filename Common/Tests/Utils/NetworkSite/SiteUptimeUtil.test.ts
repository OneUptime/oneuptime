import SiteUptimeUtil, {
  SiteStatusTimelineRow,
} from "../../../Utils/NetworkSite/SiteUptimeUtil";

const WINDOW_START: Date = new Date("2026-07-22T00:00:00Z");
const WINDOW_END: Date = new Date("2026-07-23T00:00:00Z"); // 24h window

function hoursAfterStart(hours: number): Date {
  return new Date(WINDOW_START.getTime() + hours * 60 * 60 * 1000);
}

function row(data: {
  startsAt: Date;
  endsAt: Date | null;
  isOperationalState: boolean;
  priority?: number;
}): SiteStatusTimelineRow {
  return {
    monitorStatusId: data.isOperationalState ? "operational" : "down",
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    priority: data.priority ?? (data.isOperationalState ? 1 : 3),
    isOperationalState: data.isOperationalState,
  };
}

describe("SiteUptimeUtil.calculateUptimePercent", () => {
  it("is 100 with no timeline rows", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent([], WINDOW_START, WINDOW_END),
    ).toBe(100);
  });

  it("is 100 when every row is operational", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_START,
            endsAt: null,
            isOperationalState: true,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("is 0 when a non-operational row covers the whole window", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_START,
            endsAt: WINDOW_END,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(0);
  });

  it("an open row (endsAt null) extends to the window end", () => {
    // Down from hour 18 onwards -> 6h down of 24h -> 75% up.
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: hoursAfterStart(18),
            endsAt: null,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(75);
  });

  it("clamps rows that extend beyond both window edges", () => {
    // Down row spans well beyond the window on both sides -> 0% up.
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: new Date("2026-07-20T00:00:00Z"),
            endsAt: new Date("2026-07-25T00:00:00Z"),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(0);
  });

  it("clamps a row that starts before the window", () => {
    // Down until hour 6 -> 18h up of 24h -> 75%.
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: new Date("2026-07-21T12:00:00Z"),
            endsAt: hoursAfterStart(6),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(75);
  });

  it("ignores rows entirely outside the window", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: new Date("2026-07-20T00:00:00Z"),
            endsAt: new Date("2026-07-21T00:00:00Z"),
            isOperationalState: false,
          }),
          row({
            startsAt: new Date("2026-07-24T00:00:00Z"),
            endsAt: new Date("2026-07-25T00:00:00Z"),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("merges overlapping down rows so no second is counted twice", () => {
    // [2h, 8h] and [6h, 12h] overlap -> merged 10h down -> ~58.33% up.
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(2),
          endsAt: hoursAfterStart(8),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(6),
          endsAt: hoursAfterStart(12),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBeCloseTo(((24 - 10) / 24) * 100, 10);
  });

  it("merges a row contained inside another", () => {
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(2),
          endsAt: hoursAfterStart(12),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(4),
          endsAt: hoursAfterStart(6),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBeCloseTo(((24 - 10) / 24) * 100, 10);
  });

  it("sums disjoint down rows", () => {
    // 3h + 3h down -> 18h up -> 75%.
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(1),
          endsAt: hoursAfterStart(4),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(10),
          endsAt: hoursAfterStart(13),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBe(75);
  });

  it("interleaves operational and non-operational rows correctly", () => {
    // Operational rows never subtract, whatever they overlap.
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: WINDOW_START,
          endsAt: hoursAfterStart(12),
          isOperationalState: true,
        }),
        row({
          startsAt: hoursAfterStart(12),
          endsAt: hoursAfterStart(18),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(18),
          endsAt: null,
          isOperationalState: true,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBe(75);
  });

  it("a zero-length down row contributes nothing", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: hoursAfterStart(5),
            endsAt: hoursAfterStart(5),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("returns 100 for a zero-length or inverted window", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent([], WINDOW_START, WINDOW_START),
    ).toBe(100);
    expect(
      SiteUptimeUtil.calculateUptimePercent([], WINDOW_END, WINDOW_START),
    ).toBe(100);
  });

  it("an open down row starting exactly at windowEnd contributes nothing", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_END,
            endsAt: null,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("non-operational status of ANY priority counts as down (degraded too)", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_START,
            endsAt: hoursAfterStart(6),
            isOperationalState: false,
            priority: 2, // degraded
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(75);
  });
});
