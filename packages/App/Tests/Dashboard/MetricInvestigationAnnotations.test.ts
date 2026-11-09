import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  getReferenceLinesInWindow,
  getReferenceRegionsInWindow,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationAnnotations";

/*
 * A metric investigation marks only what falls in the window on screen
 * (issue #5954): a mark outside it would be drawn at the chart's edge, as if
 * it had happened there.
 */

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:00:00.000Z"),
  new Date("2026-11-05T06:00:00.000Z"),
);

function line(iso: string, label: string): ChartTimeReferenceLineProps {
  return { date: new Date(iso), label: label };
}

function region(
  startIso: string,
  endIso: string,
  label: string,
): ChartReferenceRegionProps {
  return {
    startDate: new Date(startIso),
    endDate: new Date(endIso),
    label: label,
  };
}

function labels(
  marks: Array<ChartTimeReferenceLineProps | ChartReferenceRegionProps>,
): Array<string> {
  return marks.map(
    (mark: ChartTimeReferenceLineProps | ChartReferenceRegionProps): string => {
      return mark.label || "";
    },
  );
}

describe("getReferenceLinesInWindow", () => {
  test("keeps the moments inside the window, its two ends included", () => {
    expect(
      labels(
        getReferenceLinesInWindow(
          [
            line("2026-11-05T04:59:59.999Z", "just before"),
            line("2026-11-05T05:00:00.000Z", "at the start"),
            line("2026-11-05T05:30:00.000Z", "inside"),
            line("2026-11-05T06:00:00.000Z", "at the end"),
            line("2026-11-05T06:00:00.001Z", "just after"),
          ],
          WINDOW,
        ),
      ),
    ).toEqual(["at the start", "inside", "at the end"]);
  });

  test("a moment whose time cannot be read is not drawn", () => {
    expect(
      getReferenceLinesInWindow(
        [{ date: new Date("nonsense"), label: "unreadable" }],
        WINDOW,
      ),
    ).toEqual([]);
  });

  test("a moment stored as a string is read as the instant it names", () => {
    expect(
      labels(
        getReferenceLinesInWindow(
          [
            {
              date: "2026-11-05T05:30:00.000Z" as unknown as Date,
              label: "stored",
            },
          ],
          WINDOW,
        ),
      ),
    ).toEqual(["stored"]);
  });

  test("no window, or one that cannot be shown, draws nothing", () => {
    const moments: Array<ChartTimeReferenceLineProps> = [
      line("2026-11-05T05:30:00.000Z", "inside"),
    ];

    expect(getReferenceLinesInWindow(moments, null)).toEqual([]);
    expect(
      getReferenceLinesInWindow(
        moments,
        new InBetween<Date>(WINDOW.endValue, WINDOW.startValue),
      ),
    ).toEqual([]);
  });

  test("a kept moment is the very same object (seeded)", () => {
    const random: SeededRandom = seededRandom(5954);
    const startMs: number = WINDOW.startValue.getTime();
    const endMs: number = WINDOW.endValue.getTime();

    for (let draw: number = 0; draw < 200; draw++) {
      const moments: Array<ChartTimeReferenceLineProps> = [];

      for (let index: number = 0; index < 10; index++) {
        moments.push({
          date: new Date(startMs - 3600000 + random(3 * 3600000)),
          label: `moment ${index}`,
        });
      }

      const kept: Array<ChartTimeReferenceLineProps> =
        getReferenceLinesInWindow(moments, WINDOW);

      for (const moment of moments) {
        const time: number = moment.date.getTime();
        expect(kept.includes(moment)).toBe(time >= startMs && time <= endMs);
      }
    }
  });
});

describe("getReferenceRegionsInWindow", () => {
  test("keeps every span that shares an instant with the window", () => {
    expect(
      labels(
        getReferenceRegionsInWindow(
          [
            region(
              "2026-11-05T04:00:00.000Z",
              "2026-11-05T04:59:59.999Z",
              "all before",
            ),
            region(
              "2026-11-05T04:30:00.000Z",
              "2026-11-05T05:00:00.000Z",
              "touches the start",
            ),
            region(
              "2026-11-05T04:30:00.000Z",
              "2026-11-05T05:15:00.000Z",
              "over the start",
            ),
            region(
              "2026-11-05T05:20:00.000Z",
              "2026-11-05T05:25:00.000Z",
              "inside",
            ),
            region(
              "2026-11-05T04:00:00.000Z",
              "2026-11-05T07:00:00.000Z",
              "around it all",
            ),
            region(
              "2026-11-05T06:00:00.000Z",
              "2026-11-05T06:30:00.000Z",
              "touches the end",
            ),
            region(
              "2026-11-05T06:00:00.001Z",
              "2026-11-05T06:30:00.000Z",
              "all after",
            ),
          ],
          WINDOW,
        ),
      ),
    ).toEqual([
      "touches the start",
      "over the start",
      "inside",
      "around it all",
      "touches the end",
    ]);
  });

  test("a span that ends before it starts, or cannot be read, is not shaded", () => {
    expect(
      getReferenceRegionsInWindow(
        [
          region(
            "2026-11-05T05:30:00.000Z",
            "2026-11-05T05:20:00.000Z",
            "backwards",
          ),
          {
            startDate: new Date("nonsense"),
            endDate: new Date("2026-11-05T05:20:00.000Z"),
            label: "unreadable",
          },
        ],
        WINDOW,
      ),
    ).toEqual([]);
  });

  test("no window draws nothing", () => {
    expect(
      getReferenceRegionsInWindow(
        [
          region(
            "2026-11-05T05:20:00.000Z",
            "2026-11-05T05:25:00.000Z",
            "inside",
          ),
        ],
        undefined,
      ),
    ).toEqual([]);
  });
});
