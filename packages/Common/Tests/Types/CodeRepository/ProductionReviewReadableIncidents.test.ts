import {
  ProductionReviewIncidentJSON,
  ProductionReviewPointJSON,
  ProductionReviewReport,
  ProductionReviewUtil,
} from "../../../Types/CodeRepository/ProductionReview";
import {
  NAMED_INCIDENT_ID,
  OPEN_INCIDENT_ID,
  fullReport,
} from "../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * A STORED REVIEW, AS ITS READER MAY READ IT (#9241).
 *
 * A review is worked out once and kept: an incident on it can be made
 * private afterwards. ProductionReviewUtil.keepReadableIncidents leaves out
 * every incident the reader may not read now - with its label, severity,
 * state, the changed code it names and its link - takes it off the counts,
 * and drops a point of OneUptime AI's read that rests on it. What the
 * review says otherwise stays as it was.
 */

function ids(report: ProductionReviewReport): Array<string> {
  return report.incidents.items.map(
    (incident: ProductionReviewIncidentJSON): string => {
      return incident.incidentId;
    },
  );
}

function hiding(...hidden: Array<string>): (incidentId: string) => boolean {
  return (incidentId: string): boolean => {
    return !hidden.includes(incidentId);
  };
}

describe("ProductionReviewUtil.keepReadableIncidents", () => {
  test("a review whose every incident the reader may read is the same review", () => {
    const report: ProductionReviewReport = fullReport();

    expect(ProductionReviewUtil.keepReadableIncidents(report, hiding())).toBe(
      report,
    );
  });

  test("an incident the reader may not read leaves the list and the counts", () => {
    const report: ProductionReviewReport = fullReport();

    const kept: ProductionReviewReport =
      ProductionReviewUtil.keepReadableIncidents(
        report,
        hiding(OPEN_INCIDENT_ID),
      );

    expect(ids(kept)).toEqual([NAMED_INCIDENT_ID]);
    // In all, and open: the hidden one was open.
    expect(kept.incidents.total).toBe(report.incidents.total - 1);
    expect(kept.incidents.open).toBe(report.incidents.open - 1);
    expect(JSON.stringify(kept)).not.toContain("INC-45");
    expect(JSON.stringify(kept)).not.toContain(OPEN_INCIDENT_ID);
    // What else it says stays.
    expect(kept.exceptions).toBe(report.exceptions);
    expect(kept.pullRequest).toBe(report.pullRequest);
    // The stored review is not changed: a copy is.
    expect(ids(report)).toEqual([OPEN_INCIDENT_ID, NAMED_INCIDENT_ID]);
  });

  test("a closed one leaves the open count as it was", () => {
    const report: ProductionReviewReport = fullReport();

    const kept: ProductionReviewReport =
      ProductionReviewUtil.keepReadableIncidents(
        report,
        hiding(NAMED_INCIDENT_ID),
      );

    expect(kept.incidents.open).toBe(report.incidents.open);
    expect(kept.incidents.total).toBe(report.incidents.total - 1);
    // The changed file its root cause named goes with it.
    expect(JSON.stringify(kept.incidents)).not.toContain("charge.ts");
  });

  test("its summary counts only what is left, and says so when nothing is", () => {
    const report: ProductionReviewReport = fullReport({
      exceptions: [],
      operations: [],
      hotFunctions: [],
      suspectDeploys: [],
    });

    expect(ProductionReviewUtil.summarize(report).incidentCount).toBe(2);
    expect(ProductionReviewUtil.hasSignal(report)).toBe(true);

    const none: ProductionReviewReport =
      ProductionReviewUtil.keepReadableIncidents(
        report,
        hiding(OPEN_INCIDENT_ID, NAMED_INCIDENT_ID),
      );

    expect(ProductionReviewUtil.summarize(none).incidentCount).toBe(0);
    expect(ProductionReviewUtil.summarize(none).hasSignal).toBe(false);
    expect(none.incidents.items).toEqual([]);
  });

  test("counts never go below nothing", () => {
    const report: ProductionReviewReport = fullReport();
    report.incidents.total = 1;
    report.incidents.open = 0;

    const kept: ProductionReviewReport =
      ProductionReviewUtil.keepReadableIncidents(
        report,
        hiding(OPEN_INCIDENT_ID, NAMED_INCIDENT_ID),
      );

    expect(kept.incidents.total).toBe(0);
    expect(kept.incidents.open).toBe(0);
  });

  test("ids are read whatever their case", () => {
    const report: ProductionReviewReport = fullReport();
    report.incidents.items[0]!.incidentId = OPEN_INCIDENT_ID.toUpperCase();

    const kept: ProductionReviewReport =
      ProductionReviewUtil.keepReadableIncidents(
        report,
        hiding(OPEN_INCIDENT_ID),
      );

    expect(ids(kept)).toEqual([NAMED_INCIDENT_ID]);
  });

  describe("the points of OneUptime AI's read", () => {
    function withPoints(
      points: Array<ProductionReviewPointJSON>,
    ): ProductionReviewReport {
      return fullReport({ points });
    }

    test("a point resting on a hidden incident goes; one resting on none, or on one the reader reads, stays", () => {
      const kept: ProductionReviewReport =
        ProductionReviewUtil.keepReadableIncidents(
          withPoints([
            {
              text: "An open incident names the line this edits.",
              incidentIds: [OPEN_INCIDENT_ID],
            },
            {
              text: "A past root cause names the file this edits.",
              incidentIds: [NAMED_INCIDENT_ID],
            },
            {
              text: "Both incidents name this code.",
              incidentIds: [NAMED_INCIDENT_ID, OPEN_INCIDENT_ID.toUpperCase()],
            },
            { text: "`chargeCard` throws often here.", incidentIds: [] },
          ]),
          hiding(OPEN_INCIDENT_ID),
        );

      expect(
        kept.points.map((point: ProductionReviewPointJSON): string => {
          return point.text;
        }),
      ).toEqual([
        "A past root cause names the file this edits.",
        "`chargeCard` throws often here.",
      ]);
    });

    test("a point kept before what it rests on was recorded goes when it names a hidden incident's label", () => {
      const kept: ProductionReviewReport =
        ProductionReviewUtil.keepReadableIncidents(
          withPoints([
            { text: "INC-45 is open, and this edits the line it names." },
            { text: "As in (inc-45), the card can be null." },
            // Another label that starts the same is another incident.
            { text: "INC-450 was a different outage entirely." },
            { text: "INC-31's root cause names `charge.ts`." },
            { text: "`chargeCard` throws often here." },
          ]),
          hiding(OPEN_INCIDENT_ID),
        );

      expect(
        kept.points.map((point: ProductionReviewPointJSON): string => {
          return point.text;
        }),
      ).toEqual([
        "INC-450 was a different outage entirely.",
        "INC-31's root cause names `charge.ts`.",
        "`chargeCard` throws often here.",
      ]);
    });

    test("a label with no number names no one incident: such a point stays", () => {
      const report: ProductionReviewReport = withPoints([
        { text: "An Incident on this service names the code this edits." },
      ]);
      report.incidents.items[0]!.label = "Incident";

      expect(
        ProductionReviewUtil.keepReadableIncidents(
          report,
          hiding(OPEN_INCIDENT_ID),
        ).points,
      ).toHaveLength(1);
    });
  });
});

describe("ProductionReviewUtil.getIncidentIds", () => {
  test("each incident a review lists, once, in lower case", () => {
    const report: ProductionReviewReport = fullReport();
    report.incidents.items.push({
      ...report.incidents.items[0]!,
      incidentId: OPEN_INCIDENT_ID.toUpperCase(),
    });

    expect(ProductionReviewUtil.getIncidentIds(report)).toEqual([
      OPEN_INCIDENT_ID,
      NAMED_INCIDENT_ID,
    ]);
  });

  test("none for no review, or one kept before it listed incidents", () => {
    expect(ProductionReviewUtil.getIncidentIds(undefined)).toEqual([]);
    expect(ProductionReviewUtil.getIncidentIds(null)).toEqual([]);
    expect(
      ProductionReviewUtil.getIncidentIds({
        ...fullReport(),
        incidents: undefined as never,
      }),
    ).toEqual([]);
  });
});
