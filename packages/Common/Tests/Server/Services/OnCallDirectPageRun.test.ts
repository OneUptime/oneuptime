import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallNotPagedReason,
  OnCallPagingOutcome,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService, {
  OnCallDirectPageRun,
  OnCallDirectPageStartedBy,
} from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import { OnCallDirectPagePager } from "../../../Server/Utils/OnCall/OnCallFeedText";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green500, Red500, Yellow500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  MAX_ON_CALL_DIRECT_PAGE_TARGETS,
  ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES,
  ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_POLICY_REQUIRED_MESSAGE,
  OnCallDirectPageTargets,
} from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import Permission from "../../../Types/Permission";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  stubReadableParents,
  stubRecordLabels,
  stubRecordsInProject,
} from "../TestingUtils/ReadableParents";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A DIRECT PAGE IS A RUN WITH NO POLICY, AND ONLY ONEUPTIME STARTS ONE.
 *
 * OnCallDutyPolicyExecutionLogService keeps every page: an on-call policy's
 * run, and now a direct page - people, a team or a schedule paged with no
 * policy behind the page (Types/OnCallDutyPolicy/OnCallDirectPage). This
 * suite runs the service's whole create and update - its hooks, the
 * permission checks and the success hooks - on tables in memory, and holds:
 *
 *   - a run that names no policy is created by OneUptime alone: a member, an
 *     admin, an API key and a workflow's own step are told to name the
 *     policy, as they always were, and nothing is written;
 *   - a run a workflow's step started records the workflow, and nobody can
 *     write that record themselves;
 *   - startDirectPage: what it refuses, the run it writes, the statuses the
 *     run passes through, and what it does when paging fails;
 *   - a direct page ends when every one of its pages is over;
 *   - the record's feed says how a direct page ended in the words of a
 *     direct page, and a policy's run still says it in a policy's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("eeeeeeee-0000-4000-8000-000000000001");
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000002");
const WORKFLOW_ID: ObjectID = new ObjectID(
  "f1f1f1f1-0000-4000-8000-000000000001",
);
const OTHER_WORKFLOW_ID: ObjectID = new ObjectID(
  "f1f1f1f1-0000-4000-8000-000000000002",
);
const JANE: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const JOHN: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const TEAM_PLATFORM: ObjectID = new ObjectID(
  "7eae0000-0000-4000-8000-000000000001",
);
const SCHEDULE_PRIMARY: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000001",
);

const POLICY_URL: string = "https://oneuptime.test/policy";

interface FeedEntry {
  recordId: string;
  projectId: string;
  type: string;
  color: Color;
  markdown: string;
  userId: string | undefined;
}

function pagedPerson(userId: ObjectID): OnCallPagingOutcome["paged"][number] {
  return {
    userId: userId,
    coveringForUserId: null,
    teamId: null,
    scheduleId: null,
  };
}

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function apiKey(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      isApiKey: true,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// A workflow's step, as ComponentCode.getStepProps builds its props.
function workflowStep(
  workflowName?: string | undefined,
): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: WORKFLOW_ID,
      workflowName: workflowName,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected a refusal, but the call went through.");
}

describe("a direct page's run", () => {
  let runs: InMemoryTable;
  let pagesOut: InMemoryTable;
  let refreshed: Array<string>;
  let incidentFeed: Array<FeedEntry>;
  let alertFeed: Array<FeedEntry>;
  let outcome: OnCallPagingOutcome;
  let pagingError: Error | null;
  let statusesWhilePaging: Array<unknown>;
  let directPage: SpyInstance<
    typeof OnCallDutyPolicyEscalationRuleService.startDirectPage
  >;
  let firstRule: SpyInstance<
    typeof OnCallDutyPolicyEscalationRuleService.findOneBy
  >;
  let ruleExecution: SpyInstance<
    typeof OnCallDutyPolicyEscalationRuleService.startRuleExecution
  >;
  let policyRead: SpyInstance<typeof OnCallDutyPolicyService.findOneById>;

  // A run about the incident that names no policy, as a request would send it.
  function policylessRun(): OnCallDutyPolicyExecutionLog {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    run.projectId = PROJECT_ID;
    run.triggeredByIncidentId = INCIDENT_ID;
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;

    return run;
  }

  function policyRun(): OnCallDutyPolicyExecutionLog {
    const run: OnCallDutyPolicyExecutionLog = policylessRun();

    run.onCallDutyPolicyId = POLICY_ID;

    return run;
  }

  async function create(
    run: OnCallDutyPolicyExecutionLog,
    props: DatabaseCommonInteractionProps,
  ): Promise<OnCallDutyPolicyExecutionLog> {
    return await OnCallDutyPolicyExecutionLogService.create({
      data: run,
      props: props,
    });
  }

  function targets(
    data: Partial<OnCallDirectPageTargets>,
  ): OnCallDirectPageTargets {
    return {
      userIds: data.userIds || [],
      teamIds: data.teamIds || [],
      onCallScheduleIds: data.onCallScheduleIds || [],
    };
  }

  async function startDirectPage(
    data?:
      | {
          targets?: Partial<OnCallDirectPageTargets> | undefined;
          about?: "incident" | "alert" | "both" | "neither" | undefined;
          startedBy?: OnCallDirectPageStartedBy | undefined;
        }
      | undefined,
  ): Promise<OnCallDirectPageRun> {
    const about: string = data?.about || "incident";

    return await OnCallDutyPolicyExecutionLogService.startDirectPage({
      projectId: PROJECT_ID,
      targets: targets(data?.targets || { userIds: [JANE, JOHN] }),
      ...(about === "incident" || about === "both"
        ? { triggeredByIncidentId: INCIDENT_ID }
        : {}),
      ...(about === "alert" || about === "both"
        ? { triggeredByAlertId: ALERT_ID }
        : {}),
      ...(data?.startedBy ? { startedBy: data.startedBy } : {}),
    });
  }

  function onlyRun(): StoredRow {
    expect(runs.rows).toHaveLength(1);
    return runs.rows[0]!;
  }

  function text(value: unknown): string | undefined {
    return value === undefined || value === null ? undefined : String(value);
  }

  // Every status the run was given, in order, with what it said.
  function statusHistory(): Array<[unknown, unknown]> {
    const created: StoredRow | undefined = runs.inserts[0];

    return [
      ...(created
        ? [[created["status"], created["statusMessage"]] as [unknown, unknown]]
        : []),
      ...runs.updates
        .filter((update: { set: StoredRow }): boolean => {
          return update.set["status"] !== undefined;
        })
        .map((update: { set: StoredRow }): [unknown, unknown] => {
          return [update.set["status"], update.set["statusMessage"]];
        }),
    ];
  }

  beforeEach(() => {
    refreshed = [];
    incidentFeed = [];
    alertFeed = [];
    pagingError = null;
    statusesWhilePaging = [];
    outcome = {
      paged: [pagedPerson(JANE), pagedPerson(JOHN)],
      notPaged: [],
      hadScheduleGap: false,
    };

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    stubProjectDirectory({});
    stubReadableParents();
    stubRecordsInProject();
    stubRecordLabels();

    runs = useInMemoryTable(OnCallDutyPolicyExecutionLogService, []);
    pagesOut = useInMemoryTable(UserOnCallLogService, []);
    useInMemoryTable(OnCallDutyPolicyService, [
      {
        _id: POLICY_ID.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Critical",
        isArchived: false,
      },
    ]);

    policyRead = jest.spyOn(OnCallDutyPolicyService, "findOneById");

    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(POLICY_URL as never);

    jest
      .spyOn(OnCallPolicyRunMessage, "refresh")
      .mockImplementation((id: ObjectID | string | null | undefined) => {
        refreshed.push(String(id));
      });

    directPage = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startDirectPage")
      .mockImplementation(async (): Promise<OnCallPagingOutcome> => {
        // What the run says while its people are being paged.
        statusesWhilePaging.push(runs.rows[0]?.["status"]);

        if (pagingError) {
          throw pagingError;
        }

        return outcome;
      });

    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.id = RULE_ID;

    firstRule = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(rule);

    ruleExecution = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: {
        incidentId: ObjectID;
        projectId: ObjectID;
        incidentFeedEventType: IncidentFeedEventType;
        displayColor: Color;
        feedInfoInMarkdown: string;
        userId?: ObjectID | undefined;
      }) => {
        incidentFeed.push({
          recordId: data.incidentId.toString(),
          projectId: data.projectId.toString(),
          type: data.incidentFeedEventType,
          color: data.displayColor,
          markdown: data.feedInfoInMarkdown,
          userId: data.userId?.toString(),
        });
      }) as never);

    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation((async (data: {
        alertId: ObjectID;
        projectId: ObjectID;
        alertFeedEventType: AlertFeedEventType;
        displayColor: Color;
        feedInfoInMarkdown: string;
        userId?: ObjectID | undefined;
      }) => {
        alertFeed.push({
          recordId: data.alertId.toString(),
          projectId: data.projectId.toString(),
          type: data.alertFeedEventType,
          color: data.displayColor,
          markdown: data.feedInfoInMarkdown,
          userId: data.userId?.toString(),
        });
      }) as never);

    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation(async (data: { userId: ObjectID }) => {
        return mdText`[Jane Doe](https://oneuptime.test/users/${data.userId.toString()})`;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a run that names no policy is OneUptime's to create", () => {
    const CALLERS: Array<[string, () => DatabaseCommonInteractionProps]> = [
      [
        "a project owner",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.ProjectOwner]);
        },
      ],
      [
        "a project admin",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.ProjectAdmin]);
        },
      ],
      [
        "a project member",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.ProjectMember]);
        },
      ],
      [
        "an on-call admin",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.OnCallAdmin]);
        },
      ],
      [
        "an API key that may create execution logs",
        (): DatabaseCommonInteractionProps => {
          return apiKey([
            Permission.CreateProjectOnCallDutyPolicyExecutionLog,
            Permission.ReadProjectOnCallDutyPolicy,
          ]);
        },
      ],
      [
        "a workflow's Create One step",
        (): DatabaseCommonInteractionProps => {
          return workflowStep("Page the on-call engineer");
        },
      ],
      [
        "a master admin",
        (): DatabaseCommonInteractionProps => {
          return { ...member([]), isMasterAdmin: true };
        },
      ],
    ];

    test.each(CALLERS)(
      "%s is told to name the policy, and nothing is written",
      async (
        _who: string,
        getProps: () => DatabaseCommonInteractionProps,
      ): Promise<void> => {
        const error: Error = await refusalOf(
          create(policylessRun(), getProps()),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(ON_CALL_POLICY_REQUIRED_MESSAGE);
        expect(runs.rows).toEqual([]);
        expect(refreshed).toEqual([]);
        expect(incidentFeed).toEqual([]);
        expect(directPage).not.toHaveBeenCalled();
        expect(ruleExecution).not.toHaveBeenCalled();
      },
    );

    test.each(CALLERS)(
      "%s still starts a policy's run by naming the policy",
      async (
        _who: string,
        getProps: () => DatabaseCommonInteractionProps,
      ): Promise<void> => {
        await create(policyRun(), getProps());

        const run: StoredRow = onlyRun();

        expect(text(run["onCallDutyPolicyId"])).toBe(POLICY_ID.toString());
        expect(run["status"]).toBe(OnCallDutyPolicyStatus.Executing);
        expect(ruleExecution).toHaveBeenCalledTimes(1);
        expect(ruleExecution.mock.calls[0]![0].toString()).toBe(
          RULE_ID.toString(),
        );
      },
    );

    test("the policy named by its relation alone counts as named", async () => {
      const run: OnCallDutyPolicyExecutionLog = policylessRun();

      run.onCallDutyPolicy = { _id: POLICY_ID.toString() } as never;

      await create(run, member([Permission.ProjectAdmin]));

      expect(text(onlyRun()["onCallDutyPolicyId"])).toBe(POLICY_ID.toString());
      expect(ruleExecution).toHaveBeenCalledTimes(1);
    });

    test("OneUptime's own create of one goes through, and starts no escalation", async () => {
      const created: OnCallDutyPolicyExecutionLog = await create(
        policylessRun(),
        { isRoot: true },
      );

      const run: StoredRow = onlyRun();

      expect(run["onCallDutyPolicyId"]).toBeUndefined();
      expect(run["onCallDutyPolicy"]).toBeUndefined();
      expect(text(run["projectId"])).toBe(PROJECT_ID.toString());
      expect(text(run["triggeredByIncidentId"])).toBe(INCIDENT_ID.toString());
      expect(run["status"]).toBe(OnCallDutyPolicyStatus.Scheduled);
      expect(run["statusMessage"]).toBe("Scheduled.");
      expect(run["onCallPolicyExecutionRepeatCount"]).toBe(1);

      // No policy is read, no first rule is looked for, nothing is executed.
      expect(policyRead).not.toHaveBeenCalled();
      expect(firstRule).not.toHaveBeenCalled();
      expect(ruleExecution).not.toHaveBeenCalled();
      // Its people's pages are its feed entries: the run itself adds none.
      expect(incidentFeed).toEqual([]);
      // Its Slack and Microsoft Teams message is asked for like any run's.
      expect(refreshed).toEqual([created.id!.toString()]);
      // Nothing the create left behind says it failed.
      expect(runs.updates).toEqual([]);
    });
  });

  describe("the workflow that started a run is recorded by OneUptime", () => {
    test("a step's run records the workflow's id and the name it has now", async () => {
      await create(policyRun(), workflowStep("  Page the on-call engineer  "));

      const run: StoredRow = onlyRun();

      expect(text(run["triggeredByWorkflowId"])).toBe(WORKFLOW_ID.toString());
      expect(run["triggeredByWorkflowName"]).toBe("Page the on-call engineer");
      // No person started it.
      expect(run["triggeredByUserId"]).toBeUndefined();
    });

    test("the record's feed says the workflow started the policy", async () => {
      await create(policyRun(), workflowStep("Page the on-call engineer"));

      expect(incidentFeed).toEqual([
        {
          recordId: INCIDENT_ID.toString(),
          projectId: PROJECT_ID.toString(),
          type: IncidentFeedEventType.OnCallPolicy,
          color: Yellow500,
          markdown: `Workflow **Page the on-call engineer** started on-call policy **[Critical](${POLICY_URL})**.`,
          userId: undefined,
        },
      ]);
    });

    test("a workflow with no name is recorded by its id alone", async () => {
      await create(policyRun(), workflowStep());

      const run: StoredRow = onlyRun();

      expect(text(run["triggeredByWorkflowId"])).toBe(WORKFLOW_ID.toString());
      expect(run["triggeredByWorkflowName"]).toBeUndefined();
      // And its feed entry reads as a run nobody started by hand.
      expect(incidentFeed[0]!.markdown).toBe(
        `On-call policy **[Critical](${POLICY_URL})** started paging.`,
      );
    });

    test("a person's run records no workflow, and is credited to them", async () => {
      const props: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
      ]);

      await create(policyRun(), props);

      const run: StoredRow = onlyRun();

      expect(run["triggeredByWorkflowId"]).toBeUndefined();
      expect(run["triggeredByWorkflowName"]).toBeUndefined();
      expect(text(run["triggeredByUserId"])).toBe(props.userId!.toString());
      expect(incidentFeed[0]!.markdown).toBe(
        `started on-call policy **[Critical](${POLICY_URL})**.`,
      );
      expect(incidentFeed[0]!.userId).toBe(props.userId!.toString());
    });

    test.each([
      [
        "a project owner",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.ProjectOwner]);
        },
      ],
      [
        "a project member",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.ProjectMember]);
        },
      ],
      [
        "an API key",
        (): DatabaseCommonInteractionProps => {
          return apiKey([
            Permission.CreateProjectOnCallDutyPolicyExecutionLog,
            Permission.ReadProjectOnCallDutyPolicy,
          ]);
        },
      ],
      [
        "a workflow's own step",
        (): DatabaseCommonInteractionProps => {
          return workflowStep("Page the on-call engineer");
        },
      ],
    ])(
      "%s cannot say a workflow started the run: the create is refused",
      async (
        _who: string,
        getProps: () => DatabaseCommonInteractionProps,
      ): Promise<void> => {
        for (const spoof of [
          (run: OnCallDutyPolicyExecutionLog): void => {
            run.triggeredByWorkflowId = OTHER_WORKFLOW_ID;
          },
          (run: OnCallDutyPolicyExecutionLog): void => {
            run.triggeredByWorkflowName = "Somebody else's workflow";
          },
        ]) {
          const run: OnCallDutyPolicyExecutionLog = policyRun();

          spoof(run);

          const error: Error = await refusalOf(create(run, getProps()));

          expect(error.message).toContain("not allowed to create");
          expect(runs.rows).toEqual([]);
          expect(ruleExecution).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe("starting a direct page", () => {
    test.each([
      ["both an incident and an alert", "both" as const],
      ["neither", "neither" as const],
    ])(
      "a page about %s is refused before anything is written",
      async (_what: string, about: "both" | "neither"): Promise<void> => {
        const error: Error = await refusalOf(startDirectPage({ about: about }));

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(
          "A page is about one incident or one alert. Name one of them.",
        );
        expect(runs.rows).toEqual([]);
        expect(directPage).not.toHaveBeenCalled();
      },
    );

    test("a page that names nobody is refused before anything is written", async () => {
      const error: Error = await refusalOf(startDirectPage({ targets: {} }));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "A page needs somebody to page: a person, a team or an on-call schedule.",
      );
      expect(runs.rows).toEqual([]);
      expect(directPage).not.toHaveBeenCalled();
    });

    test("a page that names more than a hundred targets is refused, with the count", async () => {
      const tooMany: Array<ObjectID> = Array.from(
        { length: MAX_ON_CALL_DIRECT_PAGE_TARGETS - 1 },
        (): ObjectID => {
          return ObjectID.generate();
        },
      );

      const error: Error = await refusalOf(
        startDirectPage({
          targets: {
            userIds: tooMany,
            teamIds: [TEAM_PLATFORM],
            onCallScheduleIds: [SCHEDULE_PRIMARY],
          },
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "A page names at most 100 people, teams and on-call schedules. This one names 101.",
      );
      expect(runs.rows).toEqual([]);
      expect(directPage).not.toHaveBeenCalled();
    });

    test("a hundred targets is a page", async () => {
      const hundred: Array<ObjectID> = Array.from(
        { length: MAX_ON_CALL_DIRECT_PAGE_TARGETS },
        (): ObjectID => {
          return ObjectID.generate();
        },
      );

      await startDirectPage({ targets: { userIds: hundred } });

      expect(runs.rows).toHaveLength(1);
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("a page about an incident is a run in the project with no policy, paged at once", async () => {
      const started: OnCallDirectPageRun = await startDirectPage({
        targets: {
          userIds: [JANE],
          teamIds: [TEAM_PLATFORM],
          onCallScheduleIds: [SCHEDULE_PRIMARY],
        },
      });

      const run: StoredRow = onlyRun();

      expect(text(run["_id"])).toBe(started.executionLogId.toString());
      expect(text(run["projectId"])).toBe(PROJECT_ID.toString());
      expect(run["onCallDutyPolicyId"]).toBeUndefined();
      expect(text(run["triggeredByIncidentId"])).toBe(INCIDENT_ID.toString());
      expect(run["triggeredByAlertId"]).toBeUndefined();
      expect(run["userNotificationEventType"]).toBe(
        UserNotificationEventType.IncidentCreated,
      );
      expect(run["onCallPolicyExecutionRepeatCount"]).toBe(1);

      expect(directPage).toHaveBeenCalledTimes(1);

      const paging: Parameters<
        typeof OnCallDutyPolicyEscalationRuleService.startDirectPage
      >[0] = directPage.mock.calls[0]![0];

      expect(paging.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(paging.triggeredByIncidentId?.toString()).toBe(
        INCIDENT_ID.toString(),
      );
      expect(paging.triggeredByAlertId).toBeUndefined();
      expect(paging.userNotificationEventType).toBe(
        UserNotificationEventType.IncidentCreated,
      );
      expect(paging.onCallPolicyExecutionLogId.toString()).toBe(
        started.executionLogId.toString(),
      );
      expect(paging.targets).toEqual({
        userIds: [JANE],
        teamIds: [TEAM_PLATFORM],
        onCallScheduleIds: [SCHEDULE_PRIMARY],
      });

      // What came of it is handed back as the paging reported it.
      expect(started.outcome).toBe(outcome);
    });

    test("a page about an alert is an alert's run", async () => {
      await startDirectPage({ about: "alert" });

      const run: StoredRow = onlyRun();

      expect(text(run["triggeredByAlertId"])).toBe(ALERT_ID.toString());
      // An alert's page names no incident.
      expect(run["triggeredByIncidentId"]).toBeUndefined();
      expect(run["userNotificationEventType"]).toBe(
        UserNotificationEventType.AlertCreated,
      );

      const paging: Parameters<
        typeof OnCallDutyPolicyEscalationRuleService.startDirectPage
      >[0] = directPage.mock.calls[0]![0];

      expect(paging.triggeredByAlertId?.toString()).toBe(ALERT_ID.toString());
      expect(paging.triggeredByIncidentId).toBeUndefined();
      expect(paging.userNotificationEventType).toBe(
        UserNotificationEventType.AlertCreated,
      );
    });

    test("the run goes from scheduled to started to paging, and stays open while people are paged", async () => {
      await startDirectPage();

      expect(statusHistory()).toEqual([
        [OnCallDutyPolicyStatus.Scheduled, "Scheduled."],
        [OnCallDutyPolicyStatus.Started, "Paging started..."],
        [OnCallDutyPolicyStatus.Executing, "2 people were paged."],
      ]);
      // It said "started" before anybody was paged.
      expect(statusesWhilePaging).toEqual([OnCallDutyPolicyStatus.Started]);
      expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Executing);
      // None of those statuses is news for the record's feed.
      expect(incidentFeed).toEqual([]);
    });

    test("one person paged is said in the singular", async () => {
      outcome = {
        paged: [pagedPerson(JANE)],
        notPaged: [],
        hadScheduleGap: false,
      };

      await startDirectPage({ targets: { userIds: [JANE] } });

      expect(onlyRun()["statusMessage"]).toBe("1 person was paged.");
    });

    test("a page that reaches nobody is still a run: ended at once, and its record's feed says so", async () => {
      outcome = {
        paged: [],
        notPaged: [
          {
            reason: OnCallNotPagedReason.NobodyOnCall,
            userId: null,
            teamId: null,
            scheduleId: SCHEDULE_PRIMARY,
            awayUntil: null,
          },
        ],
        hadScheduleGap: true,
      };

      const started: OnCallDirectPageRun = await startDirectPage({
        targets: { onCallScheduleIds: [SCHEDULE_PRIMARY] },
        startedBy: {
          workflowId: WORKFLOW_ID,
          workflowName: "Page the on-call engineer",
        },
      });

      expect(started.outcome.paged).toEqual([]);
      expect(statusHistory()).toEqual([
        [OnCallDutyPolicyStatus.Scheduled, "Scheduled."],
        [OnCallDutyPolicyStatus.Started, "Paging started..."],
        [
          OnCallDutyPolicyStatus.CompletedWithNoNotifications,
          ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
        ],
      ]);
      expect(incidentFeed).toEqual([
        {
          recordId: INCIDENT_ID.toString(),
          projectId: PROJECT_ID.toString(),
          type: IncidentFeedEventType.OnCallPolicy,
          color: Yellow500,
          markdown: "Workflow **Page the on-call engineer** paged nobody.",
          userId: undefined,
        },
      ]);
    });

    test("paging that fails leaves the run saying what went wrong, and tells the caller", async () => {
      pagingError = new BadDataException(
        "User notification rules could not be read.",
      );

      const error: Error = await refusalOf(
        startDirectPage({
          about: "alert",
          startedBy: {
            workflowId: WORKFLOW_ID,
            workflowName: "Page the on-call engineer",
          },
        }),
      );

      expect(error).toBe(pagingError);
      expect(statusHistory()).toEqual([
        [OnCallDutyPolicyStatus.Scheduled, "Scheduled."],
        [OnCallDutyPolicyStatus.Started, "Paging started..."],
        [
          OnCallDutyPolicyStatus.Error,
          "User notification rules could not be read.",
        ],
      ]);
      expect(alertFeed).toEqual([
        {
          recordId: ALERT_ID.toString(),
          projectId: PROJECT_ID.toString(),
          type: AlertFeedEventType.OnCallPolicy,
          color: Red500,
          markdown:
            "Workflow **Page the on-call engineer** stopped with an error.\n\nUser notification rules could not be read.",
          userId: undefined,
        },
      ]);
    });

    test("a failure with no message of its own is given one", async () => {
      pagingError = new Error("");

      await refusalOf(startDirectPage());

      expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Error);
      expect(onlyRun()["statusMessage"]).toBe(
        "Error occurred while paging the people this page names.",
      );
    });

    test("every change to the run asks for its Slack and Microsoft Teams message", async () => {
      const started: OnCallDirectPageRun = await startDirectPage();

      // Created, started, paging.
      expect(refreshed).toEqual([
        started.executionLogId.toString(),
        started.executionLogId.toString(),
        started.executionLogId.toString(),
      ]);
    });

    describe("who started it", () => {
      test("a workflow's step: the workflow is recorded, and no person", async () => {
        await startDirectPage({
          startedBy: {
            workflowId: WORKFLOW_ID,
            workflowName: "Page the on-call engineer",
          },
        });

        const run: StoredRow = onlyRun();

        expect(text(run["triggeredByWorkflowId"])).toBe(WORKFLOW_ID.toString());
        expect(run["triggeredByWorkflowName"]).toBe(
          "Page the on-call engineer",
        );
        expect(run["triggeredByUserId"]).toBeUndefined();
      });

      test("a person: they are who triggered the run, and no workflow is recorded", async () => {
        await startDirectPage({ startedBy: { userId: JANE } });

        const run: StoredRow = onlyRun();

        expect(text(run["triggeredByUserId"])).toBe(JANE.toString());
        expect(run["triggeredByWorkflowId"]).toBeUndefined();
        expect(run["triggeredByWorkflowName"]).toBeUndefined();
      });

      test("nobody named: neither is recorded", async () => {
        await startDirectPage();

        const run: StoredRow = onlyRun();

        expect(run["triggeredByUserId"]).toBeUndefined();
        expect(run["triggeredByWorkflowId"]).toBeUndefined();
        expect(run["triggeredByWorkflowName"]).toBeUndefined();
      });

      test("a workflow's name with no workflow is not recorded", async () => {
        await startDirectPage({
          startedBy: { workflowName: "A name and no workflow" },
        });

        const run: StoredRow = onlyRun();

        expect(run["triggeredByWorkflowId"]).toBeUndefined();
        expect(run["triggeredByWorkflowName"]).toBeUndefined();
      });
    });
  });

  describe("a direct page ends once it has waited and every one of its pages is over", () => {
    let runId: ObjectID;
    const PAGING_STARTED_AT: Date = new Date("2026-10-08T17:15:00.000Z");

    function minutesIn(minutes: number): Date {
      return new Date(PAGING_STARTED_AT.getTime() + minutes * 60 * 1000);
    }

    // The worker's tick, so many minutes after paging started.
    async function tick(
      minutes: number = ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES,
    ): Promise<boolean> {
      return await OnCallDutyPolicyExecutionLogService.endDirectPageIfItsPagesAreOver(
        {
          executionLogId: runId,
          pagingStartedAt: PAGING_STARTED_AT,
          at: minutesIn(minutes),
        },
      );
    }

    function pageOut(
      status: UserNotificationExecutionStatus,
      executionLogId?: ObjectID | undefined,
    ): void {
      pagesOut.rows.push({
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyExecutionLogId: (executionLogId || runId).toString(),
        status: status,
      });
    }

    beforeEach(async () => {
      runId = (
        await startDirectPage({
          startedBy: {
            workflowId: WORKFLOW_ID,
            workflowName: "Page the on-call engineer",
          },
        })
      ).executionLogId;
    });

    test("it waits as long as a new escalation rule waits before the next level is paged", () => {
      expect(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES).toBe(
        DEFAULT_ESCALATE_AFTER_IN_MINUTES,
      );
      expect(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES).toBe(30);
    });

    test.each([0, 1, 5, ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES - 1])(
      "%d minutes in, with every page already sent, it stays open: nobody could have acknowledged yet",
      async (minutes: number): Promise<void> => {
        pageOut(UserNotificationExecutionStatus.Completed);

        expect(await tick(minutes)).toBe(false);
        expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Executing);
        expect(onlyRun()["statusMessage"]).toBe("2 people were paged.");
        expect(incidentFeed).toEqual([]);
        // Its pages are not even counted until it has waited.
        expect(pagesOut.repository.count).not.toHaveBeenCalled();
      },
    );

    test.each([
      UserNotificationExecutionStatus.Scheduled,
      UserNotificationExecutionStatus.Started,
      UserNotificationExecutionStatus.Executing,
    ])(
      "after the wait, a page that is %s keeps it open",
      async (status: UserNotificationExecutionStatus): Promise<void> => {
        pageOut(UserNotificationExecutionStatus.Completed);
        pageOut(status);

        expect(await tick()).toBe(false);
        // However long after: a call due in two hours is still a page going out.
        expect(await tick(600)).toBe(false);
        expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Executing);
        expect(onlyRun()["statusMessage"]).toBe("2 people were paged.");
        expect(incidentFeed).toEqual([]);
      },
    );

    test("after the wait, with every page over, it is completed in the words of a run nobody acknowledged", async () => {
      for (const status of Object.values(
        UserNotificationExecutionStatus,
      ).filter((value: UserNotificationExecutionStatus): boolean => {
        return ![
          UserNotificationExecutionStatus.Scheduled,
          UserNotificationExecutionStatus.Started,
          UserNotificationExecutionStatus.Executing,
        ].includes(value);
      })) {
        pageOut(status);
      }

      expect(pagesOut.rows.length).toBeGreaterThanOrEqual(2);

      expect(await tick()).toBe(true);
      expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Completed);
      expect(onlyRun()["statusMessage"]).toBe(
        ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      );
      expect(incidentFeed).toEqual([
        {
          recordId: INCIDENT_ID.toString(),
          projectId: PROJECT_ID.toString(),
          type: IncidentFeedEventType.OnCallPolicy,
          color: Green500,
          markdown:
            "Workflow **Page the on-call engineer** stopped paging: nobody acknowledged.",
          userId: undefined,
        },
      ]);
    });

    test("another run's pages do not keep it open", async () => {
      pageOut(UserNotificationExecutionStatus.Completed);
      pageOut(UserNotificationExecutionStatus.Executing, ObjectID.generate());

      expect(await tick()).toBe(true);
      expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Completed);
    });

    test("a run with no pages left at all is over once it has waited", async () => {
      expect(await tick()).toBe(true);
      expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Completed);
    });

    test.each([
      ["no start on record", undefined],
      ["an empty start", null],
      ["a start that is not a date", new Date("not a date")],
    ])(
      "a run with %s is not held open by it",
      async (
        _what: string,
        pagingStartedAt: Date | null | undefined,
      ): Promise<void> => {
        expect(
          await OnCallDutyPolicyExecutionLogService.endDirectPageIfItsPagesAreOver(
            {
              executionLogId: runId,
              pagingStartedAt: pagingStartedAt,
              at: minutesIn(0),
            },
          ),
        ).toBe(true);
      },
    );

    test("asked with no moment, it asks about now", async () => {
      // Paging started an hour ago by the real clock: it has waited.
      expect(
        await OnCallDutyPolicyExecutionLogService.endDirectPageIfItsPagesAreOver(
          {
            executionLogId: runId,
            pagingStartedAt: new Date(Date.now() - 60 * 60 * 1000),
          },
        ),
      ).toBe(true);
    });

    test("and paging that started just now has not waited", async () => {
      expect(
        await OnCallDutyPolicyExecutionLogService.endDirectPageIfItsPagesAreOver(
          {
            executionLogId: runId,
            pagingStartedAt: new Date(),
          },
        ),
      ).toBe(false);
      expect(onlyRun()["status"]).toBe(OnCallDutyPolicyStatus.Executing);
    });
  });

  describe("how a direct page's ending reads in the record's feed", () => {
    async function end(
      runId: ObjectID,
      status: OnCallDutyPolicyStatus,
      statusMessage: string,
    ): Promise<void> {
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: runId,
        data: { status: status, statusMessage: statusMessage },
        props: { isRoot: true },
      });
    }

    test("acknowledged or resolved: it stopped paging, and why", async () => {
      const started: OnCallDirectPageRun = await startDirectPage({
        startedBy: {
          workflowId: WORKFLOW_ID,
          workflowName: "Page the on-call engineer",
        },
      });

      await end(
        started.executionLogId,
        OnCallDutyPolicyStatus.Completed,
        `${ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START} incident is acknowledged or resolved.`,
      );

      expect(incidentFeed).toEqual([
        {
          recordId: INCIDENT_ID.toString(),
          projectId: PROJECT_ID.toString(),
          type: IncidentFeedEventType.OnCallPolicy,
          color: Green500,
          markdown:
            "Workflow **Page the on-call engineer** stopped paging because the incident is acknowledged or resolved.",
          userId: undefined,
        },
      ]);
      // No policy is read for a run that has none.
      expect(policyRead).not.toHaveBeenCalled();
    });

    test("started by a person, it names them as a link", async () => {
      const started: OnCallDirectPageRun = await startDirectPage({
        about: "alert",
        startedBy: { userId: JANE },
      });

      await end(
        started.executionLogId,
        OnCallDutyPolicyStatus.Completed,
        ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      );

      expect(alertFeed).toHaveLength(1);
      expect(alertFeed[0]!.markdown).toBe(
        `**[Jane Doe](https://oneuptime.test/users/${JANE.toString()})** stopped paging: nobody acknowledged.`,
      );
      expect(UserService.getUserMarkdownString).toHaveBeenCalledWith({
        userId: expect.objectContaining({ id: JANE.toString() }),
        projectId: expect.objectContaining({ id: PROJECT_ID.toString() }),
      });
      expect(incidentFeed).toEqual([]);
    });

    test("a policy's run still ends in a policy's words, read with its policy", async () => {
      const created: OnCallDutyPolicyExecutionLog = await create(policyRun(), {
        isRoot: true,
      });

      incidentFeed.length = 0;
      policyRead.mockClear();

      await end(
        created.id!,
        OnCallDutyPolicyStatus.Completed,
        ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      );

      expect(incidentFeed).toEqual([
        {
          recordId: INCIDENT_ID.toString(),
          projectId: PROJECT_ID.toString(),
          type: IncidentFeedEventType.OnCallPolicy,
          color: Green500,
          markdown: `On-call policy **[Critical](${POLICY_URL})** went through every escalation rule and stopped paging.`,
          userId: undefined,
        },
      ]);
      expect(policyRead).toHaveBeenCalledTimes(1);
    });
  });

  describe("who a direct page's feed entries name", () => {
    async function pager(run: {
      projectId?: ObjectID | undefined;
      triggeredByWorkflowName?: string | undefined;
      triggeredByUserId?: ObjectID | undefined;
    }): Promise<OnCallDirectPagePager> {
      return await OnCallDutyPolicyExecutionLogService.getDirectPagePager(run);
    }

    test("the workflow, by the name the run recorded", async () => {
      expect(
        await pager({
          projectId: PROJECT_ID,
          triggeredByWorkflowName: "  Page the on-call engineer ",
        }),
      ).toEqual({ workflowName: "Page the on-call engineer" });
      expect(UserService.getUserMarkdownString).not.toHaveBeenCalled();
    });

    test("the workflow rather than a person, when the run records both", async () => {
      expect(
        await pager({
          projectId: PROJECT_ID,
          triggeredByWorkflowName: "Page the on-call engineer",
          triggeredByUserId: JANE,
        }),
      ).toEqual({ workflowName: "Page the on-call engineer" });
      expect(UserService.getUserMarkdownString).not.toHaveBeenCalled();
    });

    test("the person, as a link to them in the run's project", async () => {
      const named: OnCallDirectPagePager = await pager({
        projectId: PROJECT_ID,
        triggeredByUserId: JANE,
      });

      expect(named.workflowName).toBeUndefined();
      expect(named.startedByUser?.toString()).toBe(
        `[Jane Doe](https://oneuptime.test/users/${JANE.toString()})`,
      );
      expect(UserService.getUserMarkdownString).toHaveBeenCalledWith({
        userId: JANE,
        projectId: PROJECT_ID,
      });
    });

    test("nobody, when the run records neither - or a person and no project to read them in", async () => {
      expect(await pager({ projectId: PROJECT_ID })).toEqual({});
      expect(await pager({ triggeredByUserId: JANE })).toEqual({});
      expect(
        await pager({ projectId: PROJECT_ID, triggeredByWorkflowName: "   " }),
      ).toEqual({});
      expect(UserService.getUserMarkdownString).not.toHaveBeenCalled();
    });
  });
});
