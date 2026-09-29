import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import MonitorStatusHistoryUtil, {
  MonitorStatusChangeRow,
} from "../../../Utils/Monitor/MonitorStatusHistoryUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The hero's "Operational for 3 days" and the "Recent status changes" card
 * both read the newest few timeline rows. These pin when a duration may be
 * claimed at all, and how an orphaned open row is kept from reading as
 * still running.
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const OPERATIONAL_ID: string = "22222222-2222-4222-8222-222222222222";
const OFFLINE_ID: string = "44444444-4444-4444-8444-444444444444";

const row: (data: {
  id: string;
  statusId: string;
  statusName?: string;
  color?: string;
  startsAt: string;
  endsAt?: string | undefined;
}) => MonitorStatusTimeline = (data: {
  id: string;
  statusId: string;
  statusName?: string;
  color?: string;
  startsAt: string;
  endsAt?: string | undefined;
}): MonitorStatusTimeline => {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline._id = data.id;
  timeline.monitorStatusId = new ObjectID(data.statusId);
  timeline.startsAt = new Date(data.startsAt);

  if (data.endsAt) {
    timeline.endsAt = new Date(data.endsAt);
  }

  if (data.statusName) {
    const status: MonitorStatus = new MonitorStatus();
    status.name = data.statusName;

    if (data.color) {
      status.color = new Color(data.color);
    }

    timeline.monitorStatus = status;
  }

  return timeline;
};

const OPEN_OPERATIONAL: MonitorStatusTimeline = row({
  id: "row-3",
  statusId: OPERATIONAL_ID,
  statusName: "Operational",
  color: "#10B981",
  startsAt: "2026-09-18T08:00:00.000Z",
});

describe("MonitorStatusHistoryUtil.getStatusSince", () => {
  it("since only for a matching open newest row", () => {
    expect(
      MonitorStatusHistoryUtil.getStatusSince({
        currentStatusId: OPERATIONAL_ID,
        latestRow: OPEN_OPERATIONAL,
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-09-18T08:00:00.000Z");

    // Another status in the newest row: drift, so no duration is claimed.
    expect(
      MonitorStatusHistoryUtil.getStatusSince({
        currentStatusId: OFFLINE_ID,
        latestRow: OPEN_OPERATIONAL,
        now: NOW,
      }),
    ).toBeUndefined();

    // A closed newest row does not describe the current status.
    expect(
      MonitorStatusHistoryUtil.getStatusSince({
        currentStatusId: OPERATIONAL_ID,
        latestRow: row({
          id: "row-closed",
          statusId: OPERATIONAL_ID,
          startsAt: "2026-09-18T08:00:00.000Z",
          endsAt: "2026-09-19T08:00:00.000Z",
        }),
        now: NOW,
      }),
    ).toBeUndefined();

    expect(
      MonitorStatusHistoryUtil.getStatusSince({
        currentStatusId: OPERATIONAL_ID,
        latestRow: undefined,
        now: NOW,
      }),
    ).toBeUndefined();

    expect(
      MonitorStatusHistoryUtil.getStatusSince({
        currentStatusId: undefined,
        latestRow: OPEN_OPERATIONAL,
        now: NOW,
      }),
    ).toBeUndefined();
  });

  it("since clamps future dates", () => {
    expect(
      MonitorStatusHistoryUtil.getStatusSince({
        currentStatusId: OPERATIONAL_ID,
        latestRow: row({
          id: "row-future",
          statusId: OPERATIONAL_ID,
          startsAt: "2026-09-21T12:05:00.000Z",
        }),
        now: NOW,
      })?.toISOString(),
    ).toBe(NOW.toISOString());
  });
});

describe("MonitorStatusHistoryUtil.hasStatusDrift", () => {
  it("drift on mismatch", () => {
    expect(
      MonitorStatusHistoryUtil.hasStatusDrift({
        currentStatusId: OFFLINE_ID,
        latestRow: OPEN_OPERATIONAL,
      }),
    ).toBe(true);
    expect(
      MonitorStatusHistoryUtil.hasStatusDrift({
        currentStatusId: undefined,
        latestRow: OPEN_OPERATIONAL,
      }),
    ).toBe(true);
  });

  it("no drift when they agree or there is no row", () => {
    expect(
      MonitorStatusHistoryUtil.hasStatusDrift({
        currentStatusId: OPERATIONAL_ID,
        latestRow: OPEN_OPERATIONAL,
      }),
    ).toBe(false);
    expect(
      MonitorStatusHistoryUtil.hasStatusDrift({
        currentStatusId: OPERATIONAL_ID,
        latestRow: undefined,
      }),
    ).toBe(false);
  });
});

describe("MonitorStatusHistoryUtil.getStatusChangeRows", () => {
  it("the newest open row is ongoing", () => {
    const rows: Array<MonitorStatusChangeRow> =
      MonitorStatusHistoryUtil.getStatusChangeRows([
        OPEN_OPERATIONAL,
        row({
          id: "row-2",
          statusId: OFFLINE_ID,
          statusName: "Offline",
          color: "#EF4444",
          startsAt: "2026-09-18T07:30:00.000Z",
          endsAt: "2026-09-18T08:00:00.000Z",
        }),
      ]);

    expect(rows).toEqual([
      {
        id: "row-3",
        statusName: "Operational",
        statusColor: "#10B981",
        startsAt: new Date("2026-09-18T08:00:00.000Z"),
        endsAt: undefined,
        isOngoing: true,
      },
      {
        id: "row-2",
        statusName: "Offline",
        statusColor: "#EF4444",
        startsAt: new Date("2026-09-18T07:30:00.000Z"),
        endsAt: new Date("2026-09-18T08:00:00.000Z"),
        isOngoing: false,
      },
    ]);
  });

  it("an orphan open row is capped at its successor's start", () => {
    const rows: Array<MonitorStatusChangeRow> =
      MonitorStatusHistoryUtil.getStatusChangeRows([
        OPEN_OPERATIONAL,
        // Left open by a missed close: it ended when the newer row began.
        row({
          id: "row-orphan",
          statusId: OFFLINE_ID,
          statusName: "Offline",
          startsAt: "2026-09-17T08:00:00.000Z",
        }),
      ]);

    expect(rows[1]!.isOngoing).toBe(false);
    expect(rows[1]!.endsAt?.toISOString()).toBe("2026-09-18T08:00:00.000Z");
    expect(rows[0]!.isOngoing).toBe(true);
  });

  it("a closed newest row is not ongoing", () => {
    const rows: Array<MonitorStatusChangeRow> =
      MonitorStatusHistoryUtil.getStatusChangeRows([
        row({
          id: "row-closed",
          statusId: OPERATIONAL_ID,
          startsAt: "2026-09-18T08:00:00.000Z",
          endsAt: "2026-09-19T08:00:00.000Z",
        }),
      ]);

    expect(rows[0]!.isOngoing).toBe(false);
    expect(rows[0]!.statusName).toBe("Unknown status");
    expect(rows[0]!.statusColor).toBeUndefined();
  });

  it("skips a row with no start and returns nothing for no rows", () => {
    const undated: MonitorStatusTimeline = new MonitorStatusTimeline();
    undated._id = "row-undated";

    expect(
      MonitorStatusHistoryUtil.getStatusChangeRows([undated, OPEN_OPERATIONAL])
        .length,
    ).toBe(1);
    expect(MonitorStatusHistoryUtil.getStatusChangeRows([])).toEqual([]);
  });
});

describe("MonitorStatusHistoryUtil.getStatusFingerprint", () => {
  it("fingerprint changes when the newest row closes", () => {
    const open: string = MonitorStatusHistoryUtil.getStatusFingerprint({
      currentStatusId: OPERATIONAL_ID,
      latestRow: OPEN_OPERATIONAL,
    });

    expect(open).toBe(`${OPERATIONAL_ID}|row-3|`);

    const closed: string = MonitorStatusHistoryUtil.getStatusFingerprint({
      currentStatusId: OPERATIONAL_ID,
      latestRow: row({
        id: "row-3",
        statusId: OPERATIONAL_ID,
        startsAt: "2026-09-18T08:00:00.000Z",
        endsAt: "2026-09-21T11:00:00.000Z",
      }),
    });

    expect(closed).toBe(`${OPERATIONAL_ID}|row-3|2026-09-21T11:00:00.000Z`);
    expect(closed).not.toBe(open);
  });

  it("fingerprint changes with the current status and the newest row", () => {
    const base: string = MonitorStatusHistoryUtil.getStatusFingerprint({
      currentStatusId: OPERATIONAL_ID,
      latestRow: OPEN_OPERATIONAL,
    });

    expect(
      MonitorStatusHistoryUtil.getStatusFingerprint({
        currentStatusId: OFFLINE_ID,
        latestRow: OPEN_OPERATIONAL,
      }),
    ).not.toBe(base);
    expect(
      MonitorStatusHistoryUtil.getStatusFingerprint({
        currentStatusId: OPERATIONAL_ID,
        latestRow: row({
          id: "row-4",
          statusId: OPERATIONAL_ID,
          startsAt: "2026-09-21T11:00:00.000Z",
        }),
      }),
    ).not.toBe(base);
    expect(
      MonitorStatusHistoryUtil.getStatusFingerprint({
        currentStatusId: undefined,
        latestRow: undefined,
      }),
    ).toBe("||");
  });
});

describe("MonitorStatusHistoryUtil.normalizeColor", () => {
  it("normalizeColor handles Color and string", () => {
    expect(MonitorStatusHistoryUtil.normalizeColor(new Color("#10B981"))).toBe(
      "#10B981",
    );
    expect(MonitorStatusHistoryUtil.normalizeColor("  #abc ")).toBe("#abc");
    expect(MonitorStatusHistoryUtil.normalizeColor("rgb(16, 185, 129)")).toBe(
      "rgb(16, 185, 129)",
    );
    expect(MonitorStatusHistoryUtil.normalizeColor("red")).toBe("red");
    expect(
      MonitorStatusHistoryUtil.normalizeColor({
        _type: "Color",
        value: "#EF4444",
      } as unknown as Color),
    ).toBe("#EF4444");
  });

  it("empty or invalid gives undefined", () => {
    expect(MonitorStatusHistoryUtil.normalizeColor(undefined)).toBeUndefined();
    expect(MonitorStatusHistoryUtil.normalizeColor(null)).toBeUndefined();
    expect(MonitorStatusHistoryUtil.normalizeColor("")).toBeUndefined();
    expect(
      MonitorStatusHistoryUtil.normalizeColor(new Color("")),
    ).toBeUndefined();
    expect(MonitorStatusHistoryUtil.normalizeColor("#12345")).toBeUndefined();
    expect(
      MonitorStatusHistoryUtil.normalizeColor("red; background: url(x)"),
    ).toBeUndefined();
    expect(
      MonitorStatusHistoryUtil.normalizeColor("expression(alert(1))"),
    ).toBeUndefined();
  });
});
