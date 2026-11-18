import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import ProjectReferenceCheck from "../../../../Server/Utils/Database/ProjectReferenceCheck";
import OnCallPolicyRunMessage from "../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import WorkspaceLiveMessages from "../../../../Server/Utils/Workspace/LiveMessages/WorkspaceLiveMessages";
import OnCallFireDrillService from "../../../../Server/Services/OnCallFireDrillService";
import OnCallTestPageService from "../../../../Server/Services/OnCallTestPageService";
import WhoIsToldService from "../../../../Server/Services/WhoIsToldService";
import OnCallTestPageEvents from "../../../../Server/Utils/OnCall/OnCallTestPageEvents";
import { getOnCallFireDrillEventKey } from "../../../../Types/OnCallDutyPolicy/OnCallFireDrill";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallTestPageRecordKind } from "../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A TEST PAGE TOUCHES NOTHING PUBLIC OR PERMANENT (#6811's "Done when").
 *
 * A test is an on-call run with no incident or alert behind it (decision
 * (b)): what never existed cannot show on a status page, be emailed to a
 * subscriber, or move a monitor's status, uptime or SLOs. These pin that:
 *
 *   - the modules a test page runs through write to no service of records,
 *     monitors, status pages, subscribers, workflows or workspace channels -
 *     only to the on-call run's own logs and to the person's own methods;
 *   - starting one writes an on-call run, and creates no incident or alert;
 *   - a test of a policy says nothing in any record's feed;
 *   - its run posts no message to a Slack or Microsoft Teams channel: the run
 *     message tells only of a run about an incident, alert or episode.
 *
 * Workflows (OnCallTestPageRunStart.test.ts), owners' undeliverable-page
 * emails (UserOnCallLogTestPage.test.ts) and OneUptime AI's on-call history
 * (OnCallTools.test.ts) are pinned where they are decided.
 */

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

const TEST_PAGE_MODULES: Array<string> = [
  "Server/Services/OnCallTestPageService.ts",
  "Server/Utils/OnCall/OnCallTestPageDelivery.ts",
  "Server/Utils/OnCall/OnCallTestPageRuns.ts",
  "Server/Utils/OnCall/OnCallTestPageEvents.ts",
  "Server/Utils/OnCall/OnCallTestPageAcknowledge.ts",
  "Server/API/OnCallTestPageAPI.ts",
  "Types/OnCallDutyPolicy/OnCallTestPage.ts",
  "Types/OnCallDutyPolicy/OnCallTestPageWords.ts",
  /*
   * A monitor's fire drill (#7012): one test of each policy its failure
   * pages. It reads which policies through When this goes down
   * (WhoIsToldService), which only reads - and writes nothing itself.
   */
  "Server/Services/OnCallFireDrillService.ts",
  "Types/OnCallDutyPolicy/OnCallFireDrill.ts",
];

/*
 * What a test page must never write to: records and their feeds, monitors
 * and what is derived from them, status pages and their subscribers,
 * workflows, workspace channels, and AI's investigations.
 */
const PUBLIC_OR_PERMANENT: RegExp =
  /\b(IncidentService|AlertService|IncidentEpisodeService|AlertEpisodeService|IncidentFeedService|AlertFeedService|IncidentStateTimelineService|AlertStateTimelineService|MonitorService|MonitorStatusTimelineService|MonitorStatusService|StatusPage\w*Service|\w*SubscriberService|ScheduledMaintenance\w*Service|WorkflowService|WorkspaceNotificationRuleService|WorkspaceLiveMessages|OnCallPolicyRunMessage|AiFirstResponder\w*|ServiceLevelObjective\w*Service)\b/;

const PROJECT_ID: ObjectID = new ObjectID(
  "7e5b0000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "7e5b0000-0000-4000-8000-000000000002",
);
const RUN_ID: ObjectID = new ObjectID("7e5b0000-0000-4000-8000-000000000003");
const SEVERITY_ID: ObjectID = new ObjectID(
  "7e5b0000-0000-4000-8000-000000000004",
);
const SENDER_ID: ObjectID = new ObjectID(
  "7e5b0000-0000-4000-8000-0000000000a1",
);

let incidentCreate: jest.SpyInstance;
let alertCreate: jest.SpyInstance;
let incidentFeed: jest.SpyInstance;
let alertFeed: jest.SpyInstance;

beforeEach(() => {
  incidentCreate = jest
    .spyOn(IncidentService, "create")
    .mockResolvedValue(undefined as never);
  alertCreate = jest
    .spyOn(AlertService, "create")
    .mockResolvedValue(undefined as never);
  incidentFeed = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  alertFeed = jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the modules a test page runs through", () => {
  test.each(
    TEST_PAGE_MODULES.map((file: string): [string] => {
      return [file];
    }),
  )("%s writes to nothing public or permanent", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(COMMON_ROOT, file),
      "utf8",
    );

    const imports: Array<string> = source
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("import ") || line.startsWith("} from ");
      });

    const reached: Array<string> = imports.filter((line: string): boolean => {
      return PUBLIC_OR_PERMANENT.test(line);
    });

    expect(reached).toEqual([]);
  });
});

describe("starting a test page", () => {
  beforeEach(() => {
    jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicyExecutionLog;
      }) => {
        args.data.id = RUN_ID;
        return args.data;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
      return undefined;
    });
  });

  test("to people writes an on-call run, and no incident or alert", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startDirectPage")
      .mockResolvedValue({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
      } as never);

    await OnCallDutyPolicyExecutionLogService.startTestPage({
      projectId: PROJECT_ID,
      userIds: [SENDER_ID],
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY_ID,
      startedByUserId: SENDER_ID,
    });

    expect(incidentCreate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
  });

  test("of a policy pages its first level and says nothing in any record's feed", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue({
        id: new ObjectID("7e5b0000-0000-4000-8000-000000000005"),
      } as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockResolvedValue({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: false,
      } as never);

    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.id = RUN_ID;
    run.projectId = PROJECT_ID;
    run.onCallDutyPolicyId = POLICY_ID;
    run.status = OnCallDutyPolicyStatus.Scheduled;
    run.userNotificationEventType = UserNotificationEventType.TestPage;
    run.testPageRecordKind = OnCallTestPageRecordKind.Incident;
    run.testPageSeverityId = SEVERITY_ID;

    await (
      OnCallDutyPolicyExecutionLogService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          createdItem: OnCallDutyPolicyExecutionLog,
        ) => Promise<OnCallDutyPolicyExecutionLog>;
      }
    ).onCreateSuccess(
      { createBy: { props: { isRoot: true } }, carryForward: null },
      run,
    );

    expect(incidentFeed).not.toHaveBeenCalled();
    expect(alertFeed).not.toHaveBeenCalled();
    expect(incidentCreate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
  });
});

/*
 * A FIRE DRILL (#7012) is the same test, once for each policy a monitor's
 * failure pages: it writes on-call runs, each a test page - and creates no
 * incident or alert, so no status page, subscriber, channel, workflow or
 * record's feed is ever told of it.
 */
describe("starting a monitor's fire drill", () => {
  const MONITOR_ID: ObjectID = new ObjectID(
    "7e5b0000-0000-4000-8000-000000000010",
  );
  const OTHER_POLICY_ID: ObjectID = new ObjectID(
    "7e5b0000-0000-4000-8000-000000000011",
  );

  let created: Array<OnCallDutyPolicyExecutionLog>;
  let firstLevels: jest.SpyInstance;

  beforeEach(() => {
    created = [];

    jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicyExecutionLog;
        props: { isRoot?: boolean };
      }) => {
        // OneUptime's own write, as every test page's run is.
        expect(args.props.isRoot).toBe(true);
        args.data.id = ObjectID.generate();
        created.push(args.data);
        return args.data;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    firstLevels = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockResolvedValue({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: false,
      } as never);
    jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
      return undefined;
    });
    jest.spyOn(WhoIsToldService, "getForMonitor").mockResolvedValue({
      monitorId: MONITOR_ID.toString(),
      monitorName: "API",
      checkedAt: "2026-11-17T09:00:00.000Z",
      criteria: [
        {
          id: "criteria-offline",
          name: "Offline",
          statusName: "Offline",
          events: [
            {
              kind: OnCallTestPageRecordKind.Incident,
              id: "template-1",
              severityId: SEVERITY_ID.toString(),
              title: "API is down",
              severityName: "Critical",
              owners: {},
              ownerRules: [],
              rules: [],
              policies: [
                { id: POLICY_ID.toString(), name: "Primary" },
                { id: OTHER_POLICY_ID.toString(), name: "Platform" },
              ],
              // An incident it opens would show on a status page.
              statusPages: [{ id: "page-1", name: "Status" }],
            },
          ],
        },
      ],
      channels: {},
      breaks: [],
    } as never);
    jest
      .spyOn(OnCallTestPageService, "readPolicy")
      .mockResolvedValue({} as never);
    jest
      .spyOn(OnCallTestPageService, "readSeverity")
      .mockResolvedValue("Critical" as never);
    jest
      .spyOn(OnCallTestPageService, "claimLimitsOfEach")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallTestPageEvents, "onTestPageSent")
      .mockImplementation(() => {
        return undefined;
      });
  });

  test("writes a test page's run for each policy, and creates no incident or alert", async () => {
    await OnCallFireDrillService.start({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      sentByUserId: SENDER_ID,
      props: { userId: SENDER_ID, tenantId: PROJECT_ID },
      eventKey: getOnCallFireDrillEventKey({
        criteriaId: "criteria-offline",
        recordKind: OnCallTestPageRecordKind.Incident,
        templateId: "template-1",
        index: 0,
      }),
      assertMayTestPolicy: async (): Promise<void> => {
        return undefined;
      },
    });

    expect(created).toHaveLength(2);

    for (const run of created) {
      expect(run.userNotificationEventType).toBe(
        UserNotificationEventType.TestPage,
      );
      expect(run.testPageRecordKind).toBe(OnCallTestPageRecordKind.Incident);
      expect(run.testPageSeverityId).toEqual(SEVERITY_ID);
      expect(run.testPageWalksEscalation).toBe(false);
      // About no record: nothing a status page, a subscriber or a feed reads.
      expect(run.triggeredByIncidentId).toBeUndefined();
      expect(run.triggeredByAlertId).toBeUndefined();
      expect(run.triggeredByAlertEpisodeId).toBeUndefined();
      expect(run.triggeredByIncidentEpisodeId).toBeUndefined();
    }

    expect(
      created.map((run: OnCallDutyPolicyExecutionLog) => {
        return run.onCallDutyPolicyId?.toString();
      }),
    ).toEqual([POLICY_ID.toString(), OTHER_POLICY_ID.toString()]);
    expect(incidentCreate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
  });

  test("each run, once created, pages its policy's first level as a test and says nothing in any record's feed", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue({
        id: new ObjectID("7e5b0000-0000-4000-8000-000000000005"),
      } as never);

    for (const policyId of [POLICY_ID, OTHER_POLICY_ID]) {
      const run: OnCallDutyPolicyExecutionLog =
        new OnCallDutyPolicyExecutionLog();
      run.id = ObjectID.generate();
      run.projectId = PROJECT_ID;
      run.onCallDutyPolicyId = policyId;
      run.status = OnCallDutyPolicyStatus.Scheduled;
      run.userNotificationEventType = UserNotificationEventType.TestPage;
      run.testPageRecordKind = OnCallTestPageRecordKind.Incident;
      run.testPageSeverityId = SEVERITY_ID;
      run.testPageWalksEscalation = false;

      await (
        OnCallDutyPolicyExecutionLogService as unknown as {
          onCreateSuccess: (
            onCreate: unknown,
            createdItem: OnCallDutyPolicyExecutionLog,
          ) => Promise<OnCallDutyPolicyExecutionLog>;
        }
      ).onCreateSuccess(
        { createBy: { props: { isRoot: true } }, carryForward: null },
        run,
      );
    }

    expect(firstLevels).toHaveBeenCalledTimes(2);
    expect(incidentFeed).not.toHaveBeenCalled();
    expect(alertFeed).not.toHaveBeenCalled();
    expect(incidentCreate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
  });
});

describe("a test page's run in Slack and Microsoft Teams", () => {
  test("posts no channel message, even in a project connected to both", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue({
        id: RUN_ID,
        projectId: PROJECT_ID,
        onCallDutyPolicyId: POLICY_ID,
        status: OnCallDutyPolicyStatus.Executing,
        userNotificationEventType: UserNotificationEventType.TestPage,
      } as never);
    jest
      .spyOn(WorkspaceLiveMessages, "getConnectedWorkspaceTypes")
      .mockResolvedValue([
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ] as never);

    expect(await OnCallPolicyRunMessage.readRun(RUN_ID)).toBeNull();
  });
});
