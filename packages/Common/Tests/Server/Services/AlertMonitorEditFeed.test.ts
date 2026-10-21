import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import MonitorService from "../../../Server/Services/MonitorService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AlertService.onBeforeUpdate hands onUpdateSuccess the monitor each alert
 * had before the write (see AlertMonitorEditGuard.test.ts). From it the
 * "Alert updated" feed item says what happened to the monitor - set, changed
 * or removed, each monitor linked - and the alert's metrics, which are stamped
 * with the monitor's id and name, are refreshed. An alert whose monitor did
 * not move gets neither.
 *
 * onUpdateSuccess runs for real; the feed, the dashboard links, the monitor
 * names and the metric refreshes are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000001",
);
const ALERT_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a1";
const SECOND_ALERT_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a2";
const OLD_MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b1";
const NEW_MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b2";
const USER_ID: ObjectID = new ObjectID("0193c0de-eeee-4aaa-8bbb-0000000000c1");

const MONITOR_NAMES: Record<string, string> = {
  [OLD_MONITOR_ID]: "Developer portal",
  [NEW_MONITOR_ID]: "Payments API",
};

type OnUpdateSuccess = (
  onUpdate: OnUpdate<Alert>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Alert>>;

interface MonitorChangeShape {
  oldMonitorId: ObjectID | null;
  newMonitorId: ObjectID | null;
}

function monitorLink(monitorId: string): string {
  return `https://oneuptime.example/${PROJECT_ID.toString()}/monitors/${monitorId}`;
}

function linked(monitorId: string): string {
  return `[${MONITOR_NAMES[monitorId]!}](${monitorLink(monitorId)})`;
}

function change(
  oldMonitorId: string | null,
  newMonitorId: string | null,
): MonitorChangeShape {
  return {
    oldMonitorId: oldMonitorId ? new ObjectID(oldMonitorId) : null,
    newMonitorId: newMonitorId ? new ObjectID(newMonitorId) : null,
  };
}

let createFeedItem: jest.SpyInstance;
let monitorFindBy: jest.SpyInstance;
let refreshMetrics: jest.SpyInstance;
let recomputeMeasurements: jest.SpyInstance;
// The monitors the stubbed table holds; a test can delete one.
let storedMonitorIds: Array<string> = [];

beforeEach(() => {
  storedMonitorIds = [OLD_MONITOR_ID, NEW_MONITOR_ID];

  createFeedItem = jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  jest.spyOn(AlertService, "findOneById").mockImplementation(((args: {
    id: ObjectID;
  }): Promise<Alert> => {
    const alert: Alert = new Alert();
    alert._id = args.id.toString();
    alert.projectId = PROJECT_ID;
    alert.alertNumber = 12;
    alert.alertNumberWithPrefix = "ALR-12";
    return Promise.resolve(alert);
  }) as never);

  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/alerts/12"));

  jest.spyOn(MonitorService, "getMonitorLinkInDashboard").mockImplementation(((
    projectId: ObjectID,
    monitorId: ObjectID,
  ): Promise<URL> => {
    return Promise.resolve(
      URL.fromString(
        `https://oneuptime.example/${projectId.toString()}/monitors/${monitorId.toString()}`,
      ),
    );
  }) as never);

  monitorFindBy = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation((async (): Promise<Array<Monitor>> => {
      return storedMonitorIds.map((id: string): Monitor => {
        const monitor: Monitor = new Monitor();
        monitor._id = id;
        monitor.name = MONITOR_NAMES[id]!;
        return monitor;
      });
    }) as never);

  refreshMetrics = jest
    .spyOn(AlertService, "refreshAlertMetrics")
    .mockResolvedValue(undefined as never);

  recomputeMeasurements = jest
    .spyOn(AlertMeasurementValueService, "recomputeForAlert")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function runUpdateSuccess(data: {
  payload: JSONObject;
  monitorChanges?: Record<string, MonitorChangeShape> | undefined;
  carryForward?: unknown;
  updatedAlertIds?: Array<string> | undefined;
}): Promise<OnUpdate<Alert>> {
  return (
    AlertService as unknown as { onUpdateSuccess: OnUpdateSuccess }
  ).onUpdateSuccess(
    {
      updateBy: {
        query: { _id: ALERT_ID },
        data: data.payload,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<Alert>,
      carryForward:
        data.carryForward !== undefined
          ? data.carryForward
          : { monitorChanges: data.monitorChanges || {} },
    },
    (data.updatedAlertIds || [ALERT_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

function feedMarkdown(): string {
  expect(createFeedItem).toHaveBeenCalledTimes(1);

  return (createFeedItem.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

describe("AlertService.onUpdateSuccess: the feed says what happened to the monitor", () => {
  test("a monitor set on an alert that had none", async () => {
    await runUpdateSuccess({
      payload: { monitor: { _id: NEW_MONITOR_ID } },
      monitorChanges: { [ALERT_ID]: change(null, NEW_MONITOR_ID) },
    });

    const markdown: string = feedMarkdown();

    expect(markdown).toContain(
      `**🌎 Monitor**: set to ${linked(NEW_MONITOR_ID)}`,
    );
    expect(markdown).not.toContain("changed from");
    expect(markdown).not.toContain("removed");
  });

  test("a monitor changed, naming both", async () => {
    await runUpdateSuccess({
      payload: { monitor: { _id: NEW_MONITOR_ID } },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID) },
    });

    expect(feedMarkdown()).toContain(
      `**🌎 Monitor**: changed from ${linked(OLD_MONITOR_ID)} to ${linked(NEW_MONITOR_ID)}`,
    );
  });

  test("a monitor removed", async () => {
    await runUpdateSuccess({
      payload: { monitor: null },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, null) },
    });

    const markdown: string = feedMarkdown();

    expect(markdown).toContain(
      `**🗑️ Monitor**: ${linked(OLD_MONITOR_ID)} removed`,
    );
    expect(markdown).not.toContain("set to");
  });

  test("is the Alert updated item, by the editor, in the alert's project", async () => {
    await runUpdateSuccess({
      payload: { monitorId: NEW_MONITOR_ID },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID) },
    });

    const item: {
      alertId: ObjectID;
      projectId: ObjectID;
      alertFeedEventType: AlertFeedEventType;
      userId?: ObjectID;
      feedInfoInMarkdown: string;
    } = createFeedItem.mock.calls[0]![0] as {
      alertId: ObjectID;
      projectId: ObjectID;
      alertFeedEventType: AlertFeedEventType;
      userId?: ObjectID;
      feedInfoInMarkdown: string;
    };

    expect(item.alertId.toString()).toBe(ALERT_ID);
    expect(item.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(item.alertFeedEventType).toBe(AlertFeedEventType.AlertUpdated);
    expect(item.userId?.toString()).toBe(USER_ID.toString());
    expect(item.feedInfoInMarkdown).toContain(
      "[Alert ALR-12](https://oneuptime.example/alerts/12) was updated.",
    );
  });

  test("a monitor re-saved unchanged writes no feed item at all", async () => {
    // What the Affected Resources modal sends when nothing was touched.
    await runUpdateSuccess({
      payload: { monitor: { _id: OLD_MONITOR_ID }, hosts: [], services: [] },
      monitorChanges: {},
    });

    expect(createFeedItem).not.toHaveBeenCalled();
    expect(monitorFindBy).not.toHaveBeenCalled();
  });

  test("a monitor change alongside another field records both", async () => {
    await runUpdateSuccess({
      payload: {
        title: "Checkout is failing",
        monitor: { _id: NEW_MONITOR_ID },
      },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID) },
    });

    const markdown: string = feedMarkdown();

    expect(markdown).toContain("**Title**:");
    expect(markdown).toContain("Checkout is failing");
    expect(markdown).toContain(
      `changed from ${linked(OLD_MONITOR_ID)} to ${linked(NEW_MONITOR_ID)}`,
    );
  });

  test("another field changed with the monitor untouched says nothing about the monitor", async () => {
    await runUpdateSuccess({
      payload: { title: "Checkout is failing" },
      monitorChanges: {},
    });

    expect(feedMarkdown()).not.toContain("Monitor");
    expect(monitorFindBy).not.toHaveBeenCalled();
  });

  test("monitor names are read once, as root, by id", async () => {
    await runUpdateSuccess({
      payload: { monitorId: NEW_MONITOR_ID },
      monitorChanges: {
        [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID),
        [SECOND_ALERT_ID]: change(null, NEW_MONITOR_ID),
      },
      updatedAlertIds: [ALERT_ID, SECOND_ALERT_ID],
    });

    expect(monitorFindBy).toHaveBeenCalledTimes(1);

    const read: {
      query: {
        _id: { objectLiteralParameters: Record<string, Array<string>> };
      };
      select: JSONObject;
      props: JSONObject;
    } = monitorFindBy.mock.calls[0]![0] as {
      query: {
        _id: { objectLiteralParameters: Record<string, Array<string>> };
      };
      select: JSONObject;
      props: JSONObject;
    };

    // QueryHelper.any: an IN over the ids, carried as the Raw's parameter.
    const requestedIds: Array<string> = Object.values(
      read.query._id.objectLiteralParameters,
    )
      .flat()
      .sort();

    // Each monitor once, though two alerts moved to the same one.
    expect(requestedIds).toEqual([OLD_MONITOR_ID, NEW_MONITOR_ID].sort());
    expect(read.select).toEqual({ _id: true, name: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("each alert of a multi-row update gets its own line", async () => {
    await runUpdateSuccess({
      payload: { monitorId: NEW_MONITOR_ID },
      monitorChanges: {
        [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID),
        [SECOND_ALERT_ID]: change(null, NEW_MONITOR_ID),
      },
      updatedAlertIds: [ALERT_ID, SECOND_ALERT_ID],
    });

    expect(createFeedItem).toHaveBeenCalledTimes(2);

    const markdownFor: (alertId: string) => string = (
      alertId: string,
    ): string => {
      const call: Array<unknown> | undefined = createFeedItem.mock.calls.find(
        (feedCall: Array<unknown>): boolean => {
          return (
            (feedCall[0] as { alertId: ObjectID }).alertId.toString() ===
            alertId
          );
        },
      );

      return (call![0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
    };

    expect(markdownFor(ALERT_ID)).toContain("changed from");
    expect(markdownFor(SECOND_ALERT_ID)).toContain(
      `set to ${linked(NEW_MONITOR_ID)}`,
    );
  });

  test("a monitor deleted before the feed was written is still reported, unlinked", async () => {
    storedMonitorIds = [NEW_MONITOR_ID];

    await runUpdateSuccess({
      payload: { monitorId: NEW_MONITOR_ID },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID) },
    });

    expect(feedMarkdown()).toContain(
      `changed from an unknown monitor to ${linked(NEW_MONITOR_ID)}`,
    );
  });

  test("an update handed no carry-forward at all still succeeds", async () => {
    await runUpdateSuccess({
      payload: { title: "Checkout is failing" },
      carryForward: null,
    });

    expect(feedMarkdown()).not.toContain("Monitor");
    expect(refreshMetrics).not.toHaveBeenCalled();
  });
});

describe("AlertService.onUpdateSuccess: the alert's metrics follow its monitor", () => {
  test("a moved monitor refreshes the alert's metrics and measurements", async () => {
    await runUpdateSuccess({
      payload: { monitorId: NEW_MONITOR_ID },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID) },
    });

    expect(refreshMetrics).toHaveBeenCalledTimes(1);
    expect(
      (
        refreshMetrics.mock.calls[0]![0] as { alertId: ObjectID }
      ).alertId.toString(),
    ).toBe(ALERT_ID);
    expect(recomputeMeasurements).toHaveBeenCalledTimes(1);
    expect(
      (
        recomputeMeasurements.mock.calls[0]![0] as { alertId: ObjectID }
      ).alertId.toString(),
    ).toBe(ALERT_ID);
  });

  test("a cleared monitor refreshes them too", async () => {
    await runUpdateSuccess({
      payload: { monitor: null },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, null) },
    });

    expect(refreshMetrics).toHaveBeenCalledTimes(1);
    expect(recomputeMeasurements).toHaveBeenCalledTimes(1);
  });

  test("a monitor re-saved unchanged refreshes nothing", async () => {
    await runUpdateSuccess({
      payload: { monitor: { _id: OLD_MONITOR_ID } },
      monitorChanges: {},
    });

    expect(refreshMetrics).not.toHaveBeenCalled();
    expect(recomputeMeasurements).not.toHaveBeenCalled();
  });

  test("only the alerts whose monitor moved are refreshed", async () => {
    await runUpdateSuccess({
      payload: { monitorId: NEW_MONITOR_ID },
      monitorChanges: { [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID) },
      updatedAlertIds: [ALERT_ID, SECOND_ALERT_ID],
    });

    expect(
      refreshMetrics.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { alertId: ObjectID }).alertId.toString();
      }),
    ).toEqual([ALERT_ID]);
  });

  /*
   * The measurements used to be recomputed only when the metric refresh
   * failed, so a corrected impactStartedAt left every measurement value
   * anchored on it stale whenever the refresh worked.
   */
  test("a corrected impactStartedAt recomputes the measurements even when the refresh works", async () => {
    await runUpdateSuccess({
      payload: { impactStartedAt: new Date("2026-09-14T18:00:00.000Z") },
      monitorChanges: {},
    });

    expect(refreshMetrics).toHaveBeenCalledTimes(1);
    expect(recomputeMeasurements).toHaveBeenCalledTimes(1);
  });

  test("a failed metric refresh neither fails the edit nor skips the measurements", async () => {
    const loggedError: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {}) as never);

    refreshMetrics.mockRejectedValue(new Error("ClickHouse is down") as never);

    await expect(
      runUpdateSuccess({
        payload: { monitorId: NEW_MONITOR_ID },
        monitorChanges: {
          [ALERT_ID]: change(OLD_MONITOR_ID, NEW_MONITOR_ID),
        },
      }),
    ).resolves.toBeDefined();

    expect(recomputeMeasurements).toHaveBeenCalledTimes(1);

    // Not awaited by the edit, so the failure is logged a tick later.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(loggedError).toHaveBeenCalledWith(new Error("ClickHouse is down"));
  });
});
