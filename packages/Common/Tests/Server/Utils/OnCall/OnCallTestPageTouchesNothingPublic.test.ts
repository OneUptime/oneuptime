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
  "Server/API/OnCallTestPageAPI.ts",
  "Types/OnCallDutyPolicy/OnCallTestPage.ts",
  "Types/OnCallDutyPolicy/OnCallTestPageWords.ts",
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
