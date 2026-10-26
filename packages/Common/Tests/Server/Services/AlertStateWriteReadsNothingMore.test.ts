import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import InvestigationRuleWait from "../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import WaitingRunsOnRecordChange from "../../../Server/Utils/OnCall/WaitingRunsOnRecordChange";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * AN ALERT'S STATE, WRITTEN BY ITS STATE CHANGE, IS NOT READ BACK FOR A FEED
 * ENTRY THAT WILL NOT BE WRITTEN (issue #5299).
 *
 * Every state change writes the alert's current state once its timeline row
 * is saved (StateChangeFollowOn). AlertService.onUpdateSuccess then read the
 * alert again - its number, for an "Alert updated" feed entry - before
 * finding the update changed nothing that entry records. A bulk Resolve of
 * thousands of alerts read each one again for nothing. Now an update that
 * changes no text, label, reminders switch, severity or monitor reads
 * nothing more, and one that does is read and recorded as before.
 *
 * onUpdateSuccess runs for real; the feed, the links and the follow-ons are
 * stubbed and watched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000001",
);
const ALERT_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";
const RESOLVED_STATE_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000b1";
const CRITICAL_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000c1";
const MINOR_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000c2";
const USER_ID: ObjectID = new ObjectID("0193c0de-aaaa-4aaa-8bbb-0000000000d1");

type OnUpdateSuccess = (
  onUpdate: OnUpdate<Alert>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Alert>>;

let findOneById: ReturnType<typeof jest.spyOn>;
let createFeedItem: ReturnType<typeof jest.spyOn>;
let refreshReminders: ReturnType<typeof jest.spyOn>;
let startWaitingRuns: ReturnType<typeof jest.spyOn>;
let tryFixAgain: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  findOneById = jest
    .spyOn(AlertService, "findOneById")
    .mockImplementation(((args: { id: ObjectID }): Promise<Alert> => {
      const alert: Alert = new Alert();
      alert._id = args.id.toString();
      alert.projectId = PROJECT_ID;
      alert.alertNumber = 7;
      alert.alertNumberWithPrefix = "ALT-7";
      return Promise.resolve(alert);
    }) as never);

  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/alerts/7"));

  createFeedItem = jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);

  refreshReminders = jest
    .spyOn(AlertService, "refreshReminderSchedule")
    .mockResolvedValue(undefined as never);

  startWaitingRuns = jest
    .spyOn(WaitingRunsOnRecordChange, "startForAlert")
    .mockResolvedValue(undefined as never);

  tryFixAgain = jest
    .spyOn(AutoRemediationRuleEngineService, "onSubjectUpdated")
    .mockResolvedValue(false as never);

  jest
    .spyOn(InvestigationRuleWait, "onSubjectChanged")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<AlertSeverity> => {
      const severity: AlertSeverity = new AlertSeverity();
      severity.name = "Critical";
      return severity;
    }) as never);

  jest
    .spyOn(AlertService, "refreshAlertMetrics")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertMeasurementValueService, "recomputeForAlert")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function runUpdateSuccess(data: {
  payload: JSONObject;
  props?: DatabaseCommonInteractionProps;
  carryForward?: unknown;
}): Promise<OnUpdate<Alert>> {
  return (
    AlertService as unknown as { onUpdateSuccess: OnUpdateSuccess }
  ).onUpdateSuccess(
    {
      updateBy: {
        query: { _id: ALERT_ID },
        data: data.payload,
        // A state change's own write: OneUptime's, carrying no project.
        props: data.props || { isRoot: true, userId: USER_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<Alert>,
      carryForward: data.carryForward ?? {
        monitorChanges: {},
        severityIdsBeforeUpdate: {},
        valuesBeforeUpdate: {},
      },
    },
    [new ObjectID(ALERT_ID)],
  );
}

describe("AlertService.onUpdateSuccess after a state change", () => {
  test("writing the state alone reads the alert no more, and writes no feed entry", async () => {
    await runUpdateSuccess({
      payload: { currentAlertStateId: RESOLVED_STATE_ID },
    });

    expect(findOneById).not.toHaveBeenCalled();
    expect(createFeedItem).not.toHaveBeenCalled();
    expect(refreshReminders).not.toHaveBeenCalled();
    expect(startWaitingRuns).not.toHaveBeenCalled();
    // A state links the alert to nothing: there is no fix to try again.
    expect(tryFixAgain).not.toHaveBeenCalled();
  });

  test("writing back the title the alert holds changes nothing either", async () => {
    await runUpdateSuccess({
      payload: {
        currentAlertStateId: RESOLVED_STATE_ID,
        title: "High CPU",
      },
      carryForward: {
        monitorChanges: {},
        severityIdsBeforeUpdate: {},
        valuesBeforeUpdate: {
          [ALERT_ID]: { title: "High CPU" },
        },
      },
    });

    expect(findOneById).not.toHaveBeenCalled();
    expect(createFeedItem).not.toHaveBeenCalled();
  });

  test("a title that really changed is read and recorded as before", async () => {
    await runUpdateSuccess({
      payload: { title: "Disk full on db-1" },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        monitorChanges: {},
        severityIdsBeforeUpdate: {},
        valuesBeforeUpdate: {
          [ALERT_ID]: { title: "High CPU" },
        },
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);

    const item: { feedInfoInMarkdown: string } = createFeedItem.mock
      .calls[0]![0] as { feedInfoInMarkdown: string };

    expect(item.feedInfoInMarkdown).toContain("was updated.");
    expect(item.feedInfoInMarkdown).toContain("Disk full on db-1");
  });

  test("a severity that really changed is read, recorded and matched against the rules again, as before", async () => {
    await runUpdateSuccess({
      payload: { alertSeverityId: CRITICAL_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        monitorChanges: {},
        severityIdsBeforeUpdate: { [ALERT_ID]: MINOR_ID },
        valuesBeforeUpdate: {},
      },
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
    expect(startWaitingRuns).toHaveBeenCalledTimes(1);
  });

  test("writing back the severity the alert holds reads nothing more", async () => {
    await runUpdateSuccess({
      payload: { alertSeverityId: MINOR_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        monitorChanges: {},
        severityIdsBeforeUpdate: { [ALERT_ID]: MINOR_ID },
        valuesBeforeUpdate: {},
      },
    });

    expect(findOneById).not.toHaveBeenCalled();
    expect(createFeedItem).not.toHaveBeenCalled();
    expect(refreshReminders).not.toHaveBeenCalled();
  });
});

/*
 * AN UPDATE THAT LINKS THE ALERT TO WHAT IT IS ABOUT STILL MAKES ONEUPTIME
 * AI TRY A FIX AGAIN (#5293).
 *
 * Linking an alert to a host, a cluster or a monitor - its Affected
 * Resources, Ask AI, the API - changes no text, label, severity or monitor
 * column the feed records, but it is what the auto-remediation engine waits
 * for after it found the alert linked to nothing (onSubjectUpdated). The
 * skip above must not swallow it: the alert is read for its project and
 * handed to the engine, as every update was before the skip.
 */
describe("AlertService.onUpdateSuccess after the alert is linked to what it is about", () => {
  const HOST_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000e1";
  const CLUSTER_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000e2";
  const MONITOR_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000e3";

  test.each([
    ["a host", { hosts: [{ _id: HOST_ID }] }],
    ["a Kubernetes cluster", { kubernetesClusters: [{ _id: CLUSTER_ID }] }],
    // Written back as it was: no monitor change, and still a link.
    ["the monitor it has", { monitorId: MONITOR_ID }],
  ])(
    "linking it to %s hands it to OneUptime AI to try a fix again",
    async (_name: string, payload: JSONObject) => {
      await runUpdateSuccess({
        payload: payload,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      });

      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(tryFixAgain).toHaveBeenCalledTimes(1);

      const handed: {
        projectId: ObjectID;
        alertId: ObjectID;
        written: unknown;
      } = tryFixAgain.mock.calls[0]![0] as {
        projectId: ObjectID;
        alertId: ObjectID;
        written: unknown;
      };

      expect(handed.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(handed.alertId.toString()).toBe(ALERT_ID);
      expect(handed.written).toEqual(payload);

      // A link is no feed entry, and no rule the alert matches changed.
      expect(createFeedItem).not.toHaveBeenCalled();
      expect(refreshReminders).not.toHaveBeenCalled();
      expect(startWaitingRuns).not.toHaveBeenCalled();
    },
  );

  test("a state written together with a link still hands the alert over", async () => {
    await runUpdateSuccess({
      payload: {
        currentAlertStateId: RESOLVED_STATE_ID,
        hosts: [{ _id: HOST_ID }],
      },
    });

    expect(tryFixAgain).toHaveBeenCalledTimes(1);
  });

  test("a link written as undefined is no link, and reads nothing more", async () => {
    await runUpdateSuccess({
      payload: {
        currentAlertStateId: RESOLVED_STATE_ID,
        hosts: undefined,
      } as unknown as JSONObject,
    });

    expect(findOneById).not.toHaveBeenCalled();
    expect(tryFixAgain).not.toHaveBeenCalled();
  });
});
