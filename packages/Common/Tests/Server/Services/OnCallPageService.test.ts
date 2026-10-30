import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import {
  OnCallNotPagedReason,
  OnCallPagingOutcome,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallPageService, {
  ON_CALL_DIRECT_PAGE_NOT_ALLOWED_MESSAGE,
  ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS,
  ON_CALL_PAGE_RECORD_SETUP_AGE_IN_MS,
  ON_CALL_PAGE_RECORD_SETUP_POLL_INTERVAL_IN_MS,
  OnCallPageAbout,
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
} from "../../../Server/Services/OnCallPageService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { MAX_ON_CALL_DIRECT_PAGE_TARGETS } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import Permission from "../../../Types/Permission";
import Sleep from "../../../Types/Sleep";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
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
 * PAGING PEOPLE: THE ONE CALL (OnCallPageService.page).
 *
 * A workflow's Page steps, and whatever pages people next, make one call:
 * who to page, about what, as whom. This suite runs that call with the
 * project's records in memory - its people, teams, schedules, policies,
 * incidents, alerts and severities, read through the real services and the
 * real permission checks - and stands in only for what the call hands on to:
 * the creation of a new alert, the start of a policy's run and the start of
 * a direct page, each of which has its own suite.
 *
 * It holds: what a request must say; who may page, and that somebody who may
 * not learns nothing; that every id named is looked for in the caller's own
 * project, as the caller; who is paged for each kind of target; what the
 * page is about, and the alert a page about something new becomes; what the
 * caller is told; and how long a page waits for a record created a moment
 * ago.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);

const JANE: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const JOHN: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const ALEX: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000003");
const NO_NAME: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000004");
// Has an account, and is no member of the project.
const OUTSIDER: ObjectID = new ObjectID("50000000-0000-4000-8000-000000000005");
const NOBODY: ObjectID = new ObjectID("60000000-0000-4000-8000-000000000006");

const TEAM_PLATFORM: ObjectID = new ObjectID(
  "7eae0000-0000-4000-8000-000000000001",
);
const TEAM_EMPTY: ObjectID = new ObjectID(
  "7eae0000-0000-4000-8000-000000000002",
);
const TEAM_ELSEWHERE: ObjectID = new ObjectID(
  "7eae0000-0000-4000-8000-000000000009",
);
const SCHEDULE_PRIMARY: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000001",
);
const SCHEDULE_SECONDARY: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000002",
);
const SCHEDULE_ELSEWHERE: ObjectID = new ObjectID(
  "5c4e0000-0000-4000-8000-000000000009",
);
const POLICY_CRITICAL: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);
const POLICY_DATABASE: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000002",
);
const POLICY_ARCHIVED: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000003",
);
const POLICY_ELSEWHERE: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000009",
);
const INCIDENT: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000001");
const INCIDENT_NO_PREFIX: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);
const INCIDENT_ELSEWHERE: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000009",
);
const ALERT: ObjectID = new ObjectID("cccccccc-0000-4000-8000-000000000001");
const ALERT_ELSEWHERE: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000009",
);
const NEW_ALERT: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-0000000000aa",
);
const SEVERITY_CRITICAL: ObjectID = new ObjectID(
  "5e5e0000-0000-4000-8000-000000000001",
);
const SEVERITY_LOW: ObjectID = new ObjectID(
  "5e5e0000-0000-4000-8000-000000000002",
);
const SEVERITY_ELSEWHERE: ObjectID = new ObjectID(
  "5e5e0000-0000-4000-8000-000000000009",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "f1f1f1f1-0000-4000-8000-000000000001",
);
const RUN_ID: ObjectID = new ObjectID("eeeeeeee-0000-4000-8000-000000000001");

const DASHBOARD: string = "https://oneuptime.test/dashboard";

// Long before any page here: no record is "just created" unless a test says so.
const LONG_AGO: string = "2026-01-01T00:00:00.000Z";

function member(
  permissions: Array<Permission>,
  options?: { labelIds?: Array<ObjectID> | undefined } | undefined,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      labelIds: options?.labelIds,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// A workflow's step, as ComponentCode.getStepProps builds its props.
function workflowStep(): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: WORKFLOW_ID,
      workflowName: "Page the on-call engineer",
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

function ids(list: Array<ObjectID> | undefined): Array<string> {
  return (list || []).map((id: ObjectID): string => {
    return id.toString();
  });
}

/*
 * A read of incidents or alerts by somebody who is not a project owner or
 * admin carries the rule for private records: only their owners see them.
 * The rule is SQL over the owner tables, which a table in memory cannot
 * answer, so it is answered here the way the database would: a private
 * record is found only for a caller the test says owns it. Whether the rule
 * was asked at all is kept, so a test can hold that it was.
 */
interface PrivateRecordRule {
  // How many reads carried the rule.
  asked: number;
  // Whether the caller owns the private records of the table.
  callerOwnsPrivateRecords: boolean;
}

function answerPrivateRecordRule(table: InMemoryTable): PrivateRecordRule {
  const rule: PrivateRecordRule = { asked: 0, callerOwnsPrivateRecords: false };

  for (const method of ["find", "count"] as const) {
    const read: (options: { where?: unknown }) => Promise<unknown> =
      table.repository[method].getMockImplementation() as (options: {
        where?: unknown;
      }) => Promise<unknown>;

    table.repository[method].mockImplementation(
      async (options: { where?: unknown }): Promise<unknown> => {
        const where: StoredRow = { ...((options.where as StoredRow) || {}) };

        if (where["isPrivate"] === undefined) {
          return await read(options);
        }

        rule.asked++;
        delete where["isPrivate"];

        if (!rule.callerOwnsPrivateRecords) {
          // Postgres stores the switch as false or leaves it empty.
          where["isPrivate"] = false;

          const hidden: Array<StoredRow> = table.rows.filter(
            (row: StoredRow): boolean => {
              return row["isPrivate"] === true;
            },
          );

          table.rows = table.rows.filter((row: StoredRow): boolean => {
            return !hidden.includes(row);
          });

          for (const row of table.rows) {
            if (row["isPrivate"] === undefined) {
              row["isPrivate"] = false;
            }
          }

          try {
            return await read({ ...options, where: where });
          } finally {
            table.rows.push(...hidden);
          }
        }

        return await read({ ...options, where: where });
      },
    );
  }

  return rule;
}

describe("OnCallPageService.page", () => {
  let users: InMemoryTable;
  let teams: InMemoryTable;
  let schedules: InMemoryTable;
  let policies: InMemoryTable;
  let incidents: InMemoryTable;
  let alerts: InMemoryTable;
  let severities: InMemoryTable;
  let incidentFeed: InMemoryTable;
  let alertFeed: InMemoryTable;
  let incidentPrivacy: PrivateRecordRule;
  let alertPrivacy: PrivateRecordRule;
  let members: Set<string>;
  let outcome: OnCallPagingOutcome;
  let policyStartError: Record<string, Error>;
  let membershipRead: SpyInstance<typeof ProjectMembership.getMemberUserIds>;
  let alertCreate: SpyInstance<typeof AlertService.create>;
  let policyStart: SpyInstance<
    typeof OnCallDutyPolicyExecutionLogService.create
  >;
  let directPage: SpyInstance<
    typeof OnCallDutyPolicyExecutionLogService.startDirectPage
  >;
  let sleep: SpyInstance<typeof Sleep.sleep>;

  // Every table the call reads, for "nothing was read".
  function tablesRead(): number {
    return [
      users,
      teams,
      schedules,
      policies,
      incidents,
      alerts,
      severities,
      incidentFeed,
      alertFeed,
    ].reduce((count: number, table: InMemoryTable): number => {
      return (
        count +
        table.repository.find.mock.calls.length +
        table.repository.count.mock.calls.length
      );
    }, 0);
  }

  function nothingWasStarted(): void {
    expect(alertCreate).not.toHaveBeenCalled();
    expect(policyStart).not.toHaveBeenCalled();
    expect(directPage).not.toHaveBeenCalled();
  }

  async function page(data: {
    targets: OnCallPageTargets;
    about?: OnCallPageAbout | undefined;
    props?: DatabaseCommonInteractionProps | undefined;
    maxWaitForRecordInMs?: number | undefined;
  }): Promise<OnCallPageResult> {
    return await OnCallPageService.page({
      projectId: PROJECT_ID,
      targets: data.targets,
      about: data.about || { incidentId: INCIDENT },
      props: data.props || member([Permission.ProjectMember]),
      ...(data.maxWaitForRecordInMs !== undefined
        ? { maxWaitForRecordInMs: data.maxWaitForRecordInMs }
        : {}),
    });
  }

  // What the direct page was asked to do.
  function directPageAsked(): Parameters<
    typeof OnCallDutyPolicyExecutionLogService.startDirectPage
  >[0] {
    expect(directPage).toHaveBeenCalledTimes(1);
    return directPage.mock.calls[0]![0];
  }

  beforeEach(() => {
    members = new Set<string>(
      [JANE, JOHN, ALEX, NO_NAME].map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    outcome = { paged: [], notPaged: [], hadScheduleGap: false };
    policyStartError = {};

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    stubProjectDirectory({});
    stubReadableParents();
    stubRecordsInProject();
    stubRecordLabels();

    users = useInMemoryTable(UserService, [
      { _id: JANE.toString(), name: "Jane Doe", email: "jane@example.com" },
      { _id: JOHN.toString(), name: "John Roe", email: "john@example.com" },
      { _id: ALEX.toString(), name: "Alex Kim", email: "alex@example.com" },
      { _id: NO_NAME.toString(), email: "noname@example.com" },
      {
        _id: OUTSIDER.toString(),
        name: "Olive Outsider",
        email: "olive@elsewhere.example",
      },
    ]);

    teams = useInMemoryTable(TeamService, [
      {
        _id: TEAM_PLATFORM.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Platform",
      },
      {
        _id: TEAM_EMPTY.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Night Shift",
      },
      {
        _id: TEAM_ELSEWHERE.toString(),
        projectId: OTHER_PROJECT_ID.toString(),
        name: "Somebody else's team",
      },
    ]);

    schedules = useInMemoryTable(OnCallDutyPolicyScheduleService, [
      {
        _id: SCHEDULE_PRIMARY.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Primary",
      },
      {
        _id: SCHEDULE_SECONDARY.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Secondary",
      },
      {
        _id: SCHEDULE_ELSEWHERE.toString(),
        projectId: OTHER_PROJECT_ID.toString(),
        name: "Somebody else's schedule",
      },
    ]);

    policies = useInMemoryTable(OnCallDutyPolicyService, [
      {
        _id: POLICY_CRITICAL.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Critical",
        isArchived: false,
      },
      {
        _id: POLICY_DATABASE.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Database",
        isArchived: false,
      },
      {
        _id: POLICY_ARCHIVED.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Old rota",
        isArchived: true,
      },
      {
        _id: POLICY_ELSEWHERE.toString(),
        projectId: OTHER_PROJECT_ID.toString(),
        name: "Somebody else's policy",
        isArchived: false,
      },
    ]);

    incidents = useInMemoryTable(IncidentService, [
      {
        _id: INCIDENT.toString(),
        projectId: PROJECT_ID.toString(),
        title: "Checkout is down",
        incidentNumber: 8,
        incidentNumberWithPrefix: "INC-8",
        createdAt: new Date(LONG_AGO),
      },
      {
        _id: INCIDENT_NO_PREFIX.toString(),
        projectId: PROJECT_ID.toString(),
        title: "Slow search",
        incidentNumber: 9,
        createdAt: new Date(LONG_AGO),
      },
      {
        _id: INCIDENT_ELSEWHERE.toString(),
        projectId: OTHER_PROJECT_ID.toString(),
        title: "Somebody else's incident",
        incidentNumber: 1,
        createdAt: new Date(LONG_AGO),
      },
    ]);

    alerts = useInMemoryTable(AlertService, [
      {
        _id: ALERT.toString(),
        projectId: PROJECT_ID.toString(),
        title: "Disk is filling up",
        alertNumber: 12,
        alertNumberWithPrefix: "AL-12",
        createdAt: new Date(LONG_AGO),
      },
      {
        _id: ALERT_ELSEWHERE.toString(),
        projectId: OTHER_PROJECT_ID.toString(),
        title: "Somebody else's alert",
        alertNumber: 1,
        createdAt: new Date(LONG_AGO),
      },
    ]);

    // As the database stores them: none archived.
    severities = useInMemoryTable(AlertSeverityService, [
      {
        _id: SEVERITY_LOW.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Low",
        order: 2,
        isArchived: false,
      },
      {
        _id: SEVERITY_CRITICAL.toString(),
        projectId: PROJECT_ID.toString(),
        name: "Critical",
        order: 1,
        isArchived: false,
      },
      {
        _id: SEVERITY_ELSEWHERE.toString(),
        projectId: OTHER_PROJECT_ID.toString(),
        name: "Somebody else's severity",
        order: 0,
        isArchived: false,
      },
    ]);

    incidentFeed = useInMemoryTable(IncidentFeedService, []);
    alertFeed = useInMemoryTable(AlertFeedService, []);

    incidentPrivacy = answerPrivateRecordRule(incidents);
    alertPrivacy = answerPrivateRecordRule(alerts);

    membershipRead = jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          if (data.projectId.toString() !== PROJECT_ID.toString()) {
            return new Set<string>();
          }

          return new Set<string>(
            data.userIds
              .map((userId: ObjectID | string): string => {
                return userId.toString().toLowerCase();
              })
              .filter((userId: string): boolean => {
                return members.has(userId);
              }),
          );
        },
      );

    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockImplementation(async (projectId: ObjectID, incidentId: ObjectID) => {
        return URL.fromString(
          `${DASHBOARD}/${projectId.toString()}/incidents/${incidentId.toString()}`,
        );
      });

    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockImplementation(async (projectId: ObjectID, alertId: ObjectID) => {
        return URL.fromString(
          `${DASHBOARD}/${projectId.toString()}/alerts/${alertId.toString()}`,
        );
      });

    /*
     * A new alert: kept as it was asked for, given its number, and - as its
     * own service does a moment after creating one - its "created" entry
     * written to its feed (the last block here holds what happens while
     * that entry is not there yet).
     */
    alertCreate = jest
      .spyOn(AlertService, "create")
      .mockImplementation(async (createBy: { data: Alert }): Promise<Alert> => {
        const alert: Alert = createBy.data;

        alert.id = NEW_ALERT;
        alert.alertNumber = 13;
        alert.createdAt = new Date();

        alerts.rows.push({
          _id: NEW_ALERT.toString(),
          projectId: PROJECT_ID.toString(),
          title: alert.title,
          alertNumber: 13,
          createdAt: alert.createdAt,
        });

        alertFeed.rows.push({
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
          alertId: NEW_ALERT.toString(),
          alertFeedEventType: AlertFeedEventType.AlertCreated,
        });

        return alert;
      });

    policyStart = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation(
        async (createBy: {
          data: OnCallDutyPolicyExecutionLog;
        }): Promise<OnCallDutyPolicyExecutionLog> => {
          const error: Error | undefined =
            policyStartError[createBy.data.onCallDutyPolicyId!.toString()];

          if (error) {
            throw error;
          }

          return createBy.data;
        },
      );

    directPage = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "startDirectPage")
      .mockImplementation(async () => {
        return { executionLogId: RUN_ID, outcome: outcome };
      });

    sleep = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("what a request must say", () => {
    test("who to page: a page that names nobody is refused before anything is read", async () => {
      for (const targets of [
        {},
        { userIds: [], userEmails: [], teamIds: [] },
        { onCallScheduleIds: [], onCallDutyPolicyIds: [] },
      ]) {
        const error: Error = await refusalOf(page({ targets: targets }));

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(
          "A page needs somebody to page: a person, a team, an on-call schedule or an on-call policy.",
        );
      }

      expect(tablesRead()).toBe(0);
      nothingWasStarted();
    });

    test("no more than a hundred targets of every kind together, and it says how many it was given", async () => {
      const many: Array<ObjectID> = Array.from({ length: 60 }, (): ObjectID => {
        return ObjectID.generate();
      });

      const error: Error = await refusalOf(
        page({
          targets: {
            userIds: many,
            userEmails: Array.from({ length: 38 }, (_: unknown, i: number) => {
              return `person${i}@example.com`;
            }),
            teamIds: [TEAM_PLATFORM],
            onCallScheduleIds: [SCHEDULE_PRIMARY],
            onCallDutyPolicyIds: [POLICY_CRITICAL],
          },
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "A page names at most 100 people, teams, on-call schedules and on-call policies. This one names 101.",
      );
      expect(tablesRead()).toBe(0);
      nothingWasStarted();
    });

    test("a hundred is a page", async () => {
      const hundred: Array<ObjectID> = [
        JANE,
        ...Array.from(
          { length: MAX_ON_CALL_DIRECT_PAGE_TARGETS - 1 },
          (): ObjectID => {
            return ObjectID.generate();
          },
        ),
      ];

      const result: OnCallPageResult = await page({
        targets: { userIds: hundred },
      });

      expect(ids(directPageAsked().targets.userIds)).toEqual([JANE.toString()]);
      // The ninety-nine nobody has are each said.
      expect(result.notPaged).toHaveLength(99);
    });

    test.each<[string, OnCallPageAbout, string]>([
      [
        "nothing",
        {},
        "A page is about an incident, an alert, or something new with a title. Name one of them.",
      ],
      [
        "an incident and an alert",
        { incidentId: INCIDENT, alertId: ALERT },
        "A page is about one thing: an incident, an alert, or something new with a title. Name only one of them.",
      ],
      [
        "an incident and something new",
        { incidentId: INCIDENT, newAlert: { title: "Look at this" } },
        "A page is about one thing: an incident, an alert, or something new with a title. Name only one of them.",
      ],
      [
        "all three",
        {
          incidentId: INCIDENT,
          alertId: ALERT,
          newAlert: { title: "Look at this" },
        },
        "A page is about one thing: an incident, an alert, or something new with a title. Name only one of them.",
      ],
      [
        "something new with no title",
        { newAlert: { title: "   " } },
        "A page about something new needs a title: it is what the people paged are told.",
      ],
    ])(
      "what it is about, once: a page about %s is refused before anything is read",
      async (_what: string, about: OnCallPageAbout, message: string) => {
        const error: Error = await refusalOf(
          OnCallPageService.page({
            projectId: PROJECT_ID,
            targets: { userIds: [JANE] },
            about: about,
            props: member([Permission.ProjectMember]),
          }),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(message);
        expect(tablesRead()).toBe(0);
        nothingWasStarted();
      },
    );
  });

  describe("who may page", () => {
    const MAY: Array<[string, () => DatabaseCommonInteractionProps]> = [
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
          return member([Permission.OnCallAdmin, Permission.ProjectMember]);
        },
      ],
      [
        "a workflow's step",
        (): DatabaseCommonInteractionProps => {
          return workflowStep();
        },
      ],
      [
        "OneUptime itself",
        (): DatabaseCommonInteractionProps => {
          return { isRoot: true };
        },
      ],
    ];

    test.each(MAY)(
      "%s pages a person, a team and a schedule about an incident",
      async (_who: string, getProps: () => DatabaseCommonInteractionProps) => {
        await page({
          targets: {
            userIds: [JANE],
            teamIds: [TEAM_PLATFORM],
            onCallScheduleIds: [SCHEDULE_PRIMARY],
          },
          props: getProps(),
        });

        const asked: Parameters<
          typeof OnCallDutyPolicyExecutionLogService.startDirectPage
        >[0] = directPageAsked();

        expect(ids(asked.targets.userIds)).toEqual([JANE.toString()]);
        expect(ids(asked.targets.teamIds)).toEqual([TEAM_PLATFORM.toString()]);
        expect(ids(asked.targets.onCallScheduleIds)).toEqual([
          SCHEDULE_PRIMARY.toString(),
        ]);
      },
    );

    const MAY_NOT: Array<[string, () => DatabaseCommonInteractionProps]> = [
      [
        "a viewer",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.Viewer]);
        },
      ],
      [
        "an on-call viewer",
        (): DatabaseCommonInteractionProps => {
          return member([Permission.OnCallViewer]);
        },
      ],
      [
        "somebody who may only read on-call runs",
        (): DatabaseCommonInteractionProps => {
          return member([
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
            Permission.ReadProjectOnCallDutyPolicy,
          ]);
        },
      ],
      [
        "somebody with no permission in the project",
        (): DatabaseCommonInteractionProps => {
          return member([]);
        },
      ],
      [
        "a project member signed in with a read-only credential",
        (): DatabaseCommonInteractionProps => {
          return {
            ...member([Permission.ProjectMember]),
            isReadOnlyCredential: true,
          };
        },
      ],
    ];

    test.each(MAY_NOT)(
      "%s is refused, and learns nothing: no id they named is looked for",
      async (_who: string, getProps: () => DatabaseCommonInteractionProps) => {
        for (const targets of [
          { userIds: [JANE] },
          { userEmails: ["jane@example.com"] },
          { teamIds: [TEAM_PLATFORM] },
          { onCallScheduleIds: [SCHEDULE_PRIMARY] },
          { onCallDutyPolicyIds: [POLICY_CRITICAL] },
          // An id nobody has is answered no differently.
          { userIds: [NOBODY], teamIds: [TEAM_ELSEWHERE] },
        ]) {
          const error: Error = await refusalOf(
            page({ targets: targets, props: getProps() }),
          );

          expect(error).toBeInstanceOf(NotAuthorizedException);
          expect(error.message).not.toContain("Nobody was paged");
          expect(error.message).not.toContain("has the ID");
        }

        expect(tablesRead()).toBe(0);
        expect(membershipRead).not.toHaveBeenCalled();
        nothingWasStarted();
      },
    );

    test("the refusal is the one a create of an on-call run meets", async () => {
      const props: DatabaseCommonInteractionProps = member([Permission.Viewer]);

      const fromPage: Error = await refusalOf(
        page({ targets: { userIds: [JANE] }, props: props }),
      );

      policyStart.mockRestore();
      useInMemoryTable(OnCallDutyPolicyExecutionLogService, []);

      const run: OnCallDutyPolicyExecutionLog =
        new OnCallDutyPolicyExecutionLog();
      run.projectId = PROJECT_ID;
      run.onCallDutyPolicyId = POLICY_CRITICAL;
      run.triggeredByIncidentId = INCIDENT;
      run.userNotificationEventType = UserNotificationEventType.IncidentCreated;

      const fromCreate: Error = await refusalOf(
        OnCallDutyPolicyExecutionLogService.create({
          data: run,
          props: member([Permission.Viewer]),
        }),
      );

      expect(fromPage.message).toBe(fromCreate.message);
      expect(fromPage.constructor).toBe(fromCreate.constructor);
    });

    describe("somebody allowed to start only the policies under one label", () => {
      const LABEL: ObjectID = new ObjectID(
        "1abe1000-0000-4000-8000-000000000001",
      );

      function limited(): DatabaseCommonInteractionProps {
        return member([Permission.OnCallMember], { labelIds: [LABEL] });
      }

      test.each<[string, OnCallPageTargets]>([
        ["a person", { userIds: [JANE] }],
        ["a person by email", { userEmails: ["jane@example.com"] }],
        ["a team", { teamIds: [TEAM_PLATFORM] }],
        ["a schedule", { onCallScheduleIds: [SCHEDULE_PRIMARY] }],
        [
          "a person along with a policy",
          { userIds: [JANE], onCallDutyPolicyIds: [POLICY_CRITICAL] },
        ],
      ])(
        "cannot page %s with no policy behind the page, and learns nothing",
        async (_what: string, targets: OnCallPageTargets) => {
          const error: Error = await refusalOf(
            page({ targets: targets, props: limited() }),
          );

          expect(error).toBeInstanceOf(NotAuthorizedException);
          expect(error.message).not.toContain("Nobody was paged");
          expect(tablesRead()).toBe(0);
          expect(membershipRead).not.toHaveBeenCalled();
          nothingWasStarted();
        },
      );

      test("is told why in the words a run with no policy is refused in", async () => {
        const error: Error = await refusalOf(
          page({ targets: { userIds: [JANE] }, props: limited() }),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        // What it is about first, in plain words; then why.
        expect(
          error.message.indexOf(ON_CALL_DIRECT_PAGE_NOT_ALLOWED_MESSAGE),
        ).toBe(0);
        expect(ON_CALL_DIRECT_PAGE_NOT_ALLOWED_MESSAGE).toBe(
          "Paging people, teams or on-call schedules directly takes access to every on-call policy of the project.",
        );
        expect(error.message).toContain(
          "your access to On-Call Duty Policies covers only some of them.",
        );
      });

      test("an on-call policy they name is theirs to start, as it always was: the page goes on to read it as them", async () => {
        const policyRead: SpyInstance<typeof OnCallDutyPolicyService.findBy> =
          jest.spyOn(OnCallDutyPolicyService, "findBy").mockResolvedValue([]);

        const props: DatabaseCommonInteractionProps = limited();
        const error: Error = await refusalOf(
          page({
            targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
            props: props,
          }),
        );

        // Past the check for a direct page, and held to what they can read.
        expect(policyRead).toHaveBeenCalledTimes(1);
        expect(policyRead.mock.calls[0]![0].props).toBe(props);
        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(
          `Nobody was paged. No on-call policy has the ID ${POLICY_CRITICAL.toString()}.`,
        );
      });
    });

    test("a project on a plan without on-call is refused where billing decides, and pages as before where it does not", async () => {
      const props: DatabaseCommonInteractionProps = {
        ...member([Permission.ProjectMember]),
        currentPlan: PlanType.Free,
      };

      if (IsBillingEnabled) {
        const error: Error = await refusalOf(
          page({ targets: { userIds: [JANE] }, props: props }),
        );

        expect(error).not.toBeInstanceOf(BadDataException);
        expect(tablesRead()).toBe(0);
        nothingWasStarted();

        return;
      }

      await page({ targets: { userIds: [JANE] }, props: props });

      expect(directPage).toHaveBeenCalledTimes(1);
    });
  });

  describe("people", () => {
    test("by id: each a member of the project, once, in the order named", async () => {
      await page({
        targets: { userIds: [JOHN, JANE, JOHN, ALEX, JANE] },
      });

      expect(ids(directPageAsked().targets.userIds)).toEqual(
        [JOHN, JANE, ALEX].map(String),
      );
    });

    test("by the email address they sign in with, whatever its case and the spaces around it", async () => {
      const result: OnCallPageResult = await page({
        targets: {
          userEmails: ["  Jane@Example.com ", "JOHN@EXAMPLE.COM", "", "   "],
        },
      });

      expect(ids(directPageAsked().targets.userIds)).toEqual(
        [JANE, JOHN].map(String),
      );
      expect(result.notPaged).toEqual([]);
    });

    test("somebody named by id and by email is paged once", async () => {
      await page({
        targets: {
          userIds: [JANE],
          userEmails: ["jane@example.com", "john@example.com"],
        },
      });

      expect(ids(directPageAsked().targets.userIds)).toEqual(
        [JANE, JOHN].map(String),
      );
    });

    test("an id written in upper case is the person it is", async () => {
      await page({
        targets: { userIds: [new ObjectID(JANE.toString().toUpperCase())] },
      });

      expect(ids(directPageAsked().targets.userIds)).toEqual([JANE.toString()]);
    });

    test("whether each is a member is read once, for the project the page is made in", async () => {
      await page({
        targets: {
          userIds: [JANE, OUTSIDER],
          userEmails: ["john@example.com"],
        },
      });

      expect(membershipRead).toHaveBeenCalledTimes(1);

      const asked: { projectId: ObjectID; userIds: Array<ObjectID | string> } =
        membershipRead.mock.calls[0]![0];

      expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(asked.userIds.map(String).sort()).toEqual(
        [JANE, OUTSIDER, JOHN].map(String).sort(),
      );
    });

    test.each<[string, ObjectID]>([
      ["somebody with an account who is not a member", OUTSIDER],
      ["an id that is nobody's", NOBODY],
      ["a member who has left", ALEX],
      ["something that is not an id at all", new ObjectID("Jane Doe")],
    ])(
      "%s is not paged, and each is answered in the same words",
      async (_who: string, userId: ObjectID) => {
        members.delete(ALEX.toString());

        const result: OnCallPageResult = await page({
          targets: { userIds: [JANE, userId] },
        });

        expect(ids(directPageAsked().targets.userIds)).toEqual([
          JANE.toString(),
        ]);
        expect(result.notPaged).toEqual([
          `No member of this project has the ID ${userId.toString()}.`,
        ]);
      },
    );

    test("something that is not an id is never asked of the database", async () => {
      await page({
        targets: { userIds: [JANE, new ObjectID("'; DROP TABLE users; --")] },
      });

      const asked: Array<string> = (
        membershipRead.mock.calls[0]![0] as { userIds: Array<ObjectID> }
      ).userIds.map(String);

      expect(asked).toEqual([JANE.toString()]);
    });

    test("an email address nobody in the project has is said, lower-cased, and the others are paged", async () => {
      const result: OnCallPageResult = await page({
        targets: {
          userEmails: [
            "Olive@Elsewhere.example",
            "who@example.com",
            "jane@example.com",
          ],
        },
      });

      expect(ids(directPageAsked().targets.userIds)).toEqual([JANE.toString()]);
      expect(result.notPaged).toEqual([
        "No member of this project has the email olive@elsewhere.example.",
        "No member of this project has the email who@example.com.",
      ]);
    });

    test("a member of another project only is not a member of this one", async () => {
      const error: Error = await refusalOf(
        OnCallPageService.page({
          projectId: OTHER_PROJECT_ID,
          targets: { userIds: [JANE] },
          about: { newAlert: { title: "Look at this" } },
          props: { isRoot: true },
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        `Nobody was paged. No member of this project has the ID ${JANE.toString()}.`,
      );
      nothingWasStarted();
    });
  });

  describe("teams, on-call schedules and on-call policies", () => {
    test("those of the project are paged, by what each is", async () => {
      await page({
        targets: {
          teamIds: [TEAM_PLATFORM, TEAM_EMPTY, TEAM_PLATFORM],
          onCallScheduleIds: [SCHEDULE_SECONDARY, SCHEDULE_PRIMARY],
          onCallDutyPolicyIds: [POLICY_CRITICAL],
        },
      });

      const asked: Parameters<
        typeof OnCallDutyPolicyExecutionLogService.startDirectPage
      >[0] = directPageAsked();

      expect(ids(asked.targets.teamIds)).toEqual(
        [TEAM_PLATFORM, TEAM_EMPTY].map(String),
      );
      expect(ids(asked.targets.onCallScheduleIds)).toEqual(
        [SCHEDULE_SECONDARY, SCHEDULE_PRIMARY].map(String),
      );
      // A policy is no part of a direct page: it runs as itself.
      expect(asked.targets.userIds).toEqual([]);
      expect(policyStart).toHaveBeenCalledTimes(1);
    });

    test.each<[string, OnCallPageTargets, string]>([
      [
        "a team",
        { teamIds: [TEAM_ELSEWHERE] },
        `No team has the ID ${TEAM_ELSEWHERE.toString()}.`,
      ],
      [
        "an on-call schedule",
        { onCallScheduleIds: [SCHEDULE_ELSEWHERE] },
        `No on-call schedule has the ID ${SCHEDULE_ELSEWHERE.toString()}.`,
      ],
      [
        "an on-call policy",
        { onCallDutyPolicyIds: [POLICY_ELSEWHERE] },
        `No on-call policy has the ID ${POLICY_ELSEWHERE.toString()}.`,
      ],
    ])(
      "%s of another project is not found, in the words of one that is not there",
      async (_what: string, targets: OnCallPageTargets, sentence: string) => {
        const result: OnCallPageResult = await page({
          targets: { ...targets, userIds: [JANE] },
        });

        expect(result.notPaged).toEqual([sentence]);

        const asked: Parameters<
          typeof OnCallDutyPolicyExecutionLogService.startDirectPage
        >[0] = directPageAsked();

        expect(asked.targets.teamIds).toEqual([]);
        expect(asked.targets.onCallScheduleIds).toEqual([]);
        expect(policyStart).not.toHaveBeenCalled();

        // And an id nobody has reads no differently.
        const missing: ObjectID = ObjectID.generate();
        const key: string = Object.keys(targets)[0]!;
        directPage.mockClear();

        const again: OnCallPageResult = await page({
          targets: { [key]: [missing], userIds: [JANE] },
        });

        expect(again.notPaged).toEqual([
          sentence.replace(
            (targets as Record<string, Array<ObjectID>>)[key]![0]!.toString(),
            missing.toString(),
          ),
        ]);
      },
    );

    test("each is read as the caller, in the caller's project", async () => {
      const teamRead: SpyInstance<typeof TeamService.findBy> = jest.spyOn(
        TeamService,
        "findBy",
      );
      const scheduleRead: SpyInstance<
        typeof OnCallDutyPolicyScheduleService.findBy
      > = jest.spyOn(OnCallDutyPolicyScheduleService, "findBy");
      const policyRead: SpyInstance<typeof OnCallDutyPolicyService.findBy> =
        jest.spyOn(OnCallDutyPolicyService, "findBy");

      const props: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
      ]);

      await page({
        targets: {
          teamIds: [TEAM_PLATFORM],
          onCallScheduleIds: [SCHEDULE_PRIMARY],
          onCallDutyPolicyIds: [POLICY_CRITICAL],
        },
        props: props,
      });

      for (const read of [teamRead, scheduleRead, policyRead]) {
        expect(read).toHaveBeenCalledTimes(1);

        const findBy: { props: unknown; query: Record<string, unknown> } = (
          read as unknown as SpyInstance<(findBy: unknown) => unknown>
        ).mock.calls[0]![0] as {
          props: unknown;
          query: Record<string, unknown>;
        };

        expect(findBy.props).toBe(props);
        expect(String(findBy.query["projectId"])).toBe(PROJECT_ID.toString());
      }
    });

    test("people are read by OneUptime, as no member can read the list of every account - and held to the project's members", async () => {
      const userRead: SpyInstance<typeof UserService.findBy> = jest.spyOn(
        UserService,
        "findBy",
      );

      await page({ targets: { userIds: [JANE, OUTSIDER] } });

      expect(userRead.mock.calls[0]![0].props).toEqual({ isRoot: true });
      expect(ids(directPageAsked().targets.userIds)).toEqual([JANE.toString()]);
    });

    test("something that is not an id finds nothing, and is never asked of the database", async () => {
      const result: OnCallPageResult = await page({
        targets: {
          userIds: [JANE],
          teamIds: [new ObjectID("Platform")],
          onCallScheduleIds: [new ObjectID("Primary")],
          onCallDutyPolicyIds: [new ObjectID("Critical")],
        },
      });

      expect(result.notPaged).toEqual([
        "No team has the ID Platform.",
        "No on-call schedule has the ID Primary.",
        "No on-call policy has the ID Critical.",
      ]);
      expect(teams.repository.find).not.toHaveBeenCalled();
      expect(schedules.repository.find).not.toHaveBeenCalled();
      expect(policies.repository.find).not.toHaveBeenCalled();
    });

    test("an archived policy pages no one, and the page says so", async () => {
      const result: OnCallPageResult = await page({
        targets: {
          onCallDutyPolicyIds: [POLICY_ARCHIVED, POLICY_CRITICAL],
        },
      });

      expect(policyStart).toHaveBeenCalledTimes(1);
      expect(
        policyStart.mock.calls[0]![0].data.onCallDutyPolicyId!.toString(),
      ).toBe(POLICY_CRITICAL.toString());
      expect(result.notPaged).toEqual([
        "On-call policy Old rota is archived, so it pages no one.",
      ]);
      expect(result.startedPolicies).toEqual([
        { onCallDutyPolicyId: POLICY_CRITICAL, name: "Critical" },
      ]);
    });
  });

  describe("a page that names nothing that can be paged", () => {
    test("creates nothing, starts nothing, and says why for everything it named", async () => {
      const error: Error = await refusalOf(
        page({
          targets: {
            userIds: [OUTSIDER],
            userEmails: ["who@example.com"],
            teamIds: [TEAM_ELSEWHERE],
            onCallScheduleIds: [SCHEDULE_ELSEWHERE],
            onCallDutyPolicyIds: [POLICY_ELSEWHERE, POLICY_ARCHIVED],
          },
          about: { newAlert: { title: "Look at this" } },
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        [
          "Nobody was paged.",
          `No member of this project has the ID ${OUTSIDER.toString()}.`,
          "No member of this project has the email who@example.com.",
          `No team has the ID ${TEAM_ELSEWHERE.toString()}.`,
          `No on-call schedule has the ID ${SCHEDULE_ELSEWHERE.toString()}.`,
          `No on-call policy has the ID ${POLICY_ELSEWHERE.toString()}.`,
          "On-call policy Old rota is archived, so it pages no one.",
        ].join(" "),
      );
      nothingWasStarted();
      // Not even the record is read: there is nobody to page about it.
      expect(incidents.repository.find).not.toHaveBeenCalled();
      expect(severities.repository.find).not.toHaveBeenCalled();
    });
  });

  describe("a page about an incident", () => {
    test("is about the incident, read as the caller in the caller's project", async () => {
      const incidentRead: SpyInstance<typeof IncidentService.findOneBy> =
        jest.spyOn(IncidentService, "findOneBy");
      const props: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
      ]);

      const result: OnCallPageResult = await page({
        targets: { userIds: [JANE] },
        about: { incidentId: INCIDENT },
        props: props,
      });

      expect(result.record).toEqual({
        type: OnCallPageRecordType.Incident,
        id: expect.objectContaining({ id: INCIDENT.toString() }),
        label: "Incident INC-8",
        title: "Checkout is down",
        url: URL.fromString(
          `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${INCIDENT.toString()}`,
        ),
        isNew: false,
      });

      const findOneBy: { props: unknown; query: Record<string, unknown> } =
        incidentRead.mock.calls[0]![0] as unknown as {
          props: unknown;
          query: Record<string, unknown>;
        };

      expect(findOneBy.props).toBe(props);
      expect(String(findOneBy.query["projectId"])).toBe(PROJECT_ID.toString());

      const asked: Parameters<
        typeof OnCallDutyPolicyExecutionLogService.startDirectPage
      >[0] = directPageAsked();

      expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(asked.triggeredByIncidentId!.toString()).toBe(INCIDENT.toString());
      expect(asked.triggeredByAlertId).toBeUndefined();
      expect(alertCreate).not.toHaveBeenCalled();
    });

    test("an incident with no prefix of its own is named by its number", async () => {
      const result: OnCallPageResult = await page({
        targets: { userIds: [JANE] },
        about: { incidentId: INCIDENT_NO_PREFIX },
      });

      expect(result.record.label).toBe("Incident #9");
    });

    test.each<[string, ObjectID]>([
      ["another project's", INCIDENT_ELSEWHERE],
      ["one nobody has", NOBODY],
      ["something that is not an id", new ObjectID("INC-8")],
    ])(
      "%s is not found: nobody is paged, and nothing is started",
      async (_which: string, incidentId: ObjectID) => {
        const error: Error = await refusalOf(
          page({
            targets: {
              userIds: [JANE],
              onCallDutyPolicyIds: [POLICY_CRITICAL],
            },
            about: { incidentId: incidentId },
          }),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(
          `Nobody was paged. No incident has the ID ${incidentId.toString()}.`,
        );
        nothingWasStarted();
      },
    );

    test("a private incident the caller does not own is not found either", async () => {
      incidents.get(INCIDENT)!["isPrivate"] = true;

      const error: Error = await refusalOf(
        page({ targets: { userIds: [JANE] }, about: { incidentId: INCIDENT } }),
      );

      expect(incidentPrivacy.asked).toBeGreaterThan(0);
      expect(error.message).toBe(
        `Nobody was paged. No incident has the ID ${INCIDENT.toString()}.`,
      );
      nothingWasStarted();

      // Its owner may page about it.
      incidentPrivacy.callerOwnsPrivateRecords = true;

      const result: OnCallPageResult = await page({
        targets: { userIds: [JANE] },
        about: { incidentId: INCIDENT },
      });

      expect(result.record.label).toBe("Incident INC-8");
    });
  });

  describe("a page about an alert", () => {
    test("is about the alert, read as the caller in the caller's project", async () => {
      const alertRead: SpyInstance<typeof AlertService.findOneBy> = jest.spyOn(
        AlertService,
        "findOneBy",
      );
      const props: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
      ]);

      const result: OnCallPageResult = await page({
        targets: { userIds: [JANE] },
        about: { alertId: ALERT },
        props: props,
      });

      expect(result.record).toEqual({
        type: OnCallPageRecordType.Alert,
        id: expect.objectContaining({ id: ALERT.toString() }),
        label: "Alert AL-12",
        title: "Disk is filling up",
        url: URL.fromString(
          `${DASHBOARD}/${PROJECT_ID.toString()}/alerts/${ALERT.toString()}`,
        ),
        isNew: false,
      });

      const findOneBy: { props: unknown; query: Record<string, unknown> } =
        alertRead.mock.calls[0]![0] as unknown as {
          props: unknown;
          query: Record<string, unknown>;
        };

      expect(findOneBy.props).toBe(props);
      expect(String(findOneBy.query["projectId"])).toBe(PROJECT_ID.toString());

      const asked: Parameters<
        typeof OnCallDutyPolicyExecutionLogService.startDirectPage
      >[0] = directPageAsked();

      expect(asked.triggeredByAlertId!.toString()).toBe(ALERT.toString());
      expect(asked.triggeredByIncidentId).toBeUndefined();
      expect(alertCreate).not.toHaveBeenCalled();
    });

    test.each<[string, ObjectID]>([
      ["another project's", ALERT_ELSEWHERE],
      ["one nobody has", NOBODY],
      ["something that is not an id", new ObjectID("AL-12")],
    ])(
      "%s is not found: nobody is paged, and nothing is started",
      async (_which: string, alertId: ObjectID) => {
        const error: Error = await refusalOf(
          page({
            targets: { userIds: [JANE] },
            about: { alertId: alertId },
          }),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(
          `Nobody was paged. No alert has the ID ${alertId.toString()}.`,
        );
        nothingWasStarted();
      },
    );

    test("a private alert the caller does not own is not found either", async () => {
      alerts.get(ALERT)!["isPrivate"] = true;

      const error: Error = await refusalOf(
        page({ targets: { userIds: [JANE] }, about: { alertId: ALERT } }),
      );

      expect(alertPrivacy.asked).toBeGreaterThan(0);
      expect(error.message).toBe(
        `Nobody was paged. No alert has the ID ${ALERT.toString()}.`,
      );
      nothingWasStarted();
    });
  });

  describe("a page about something new", () => {
    async function pageAboutSomethingNew(data?: {
      targets?: OnCallPageTargets | undefined;
      newAlert?: Partial<NonNullable<OnCallPageAbout["newAlert"]>> | undefined;
      props?: DatabaseCommonInteractionProps | undefined;
    }): Promise<OnCallPageResult> {
      return await page({
        targets: data?.targets || { userIds: [JANE] },
        about: {
          newAlert: {
            title: "Payments are failing",
            ...(data?.newAlert || {}),
          },
        },
        ...(data?.props ? { props: data.props } : {}),
      });
    }

    function alertAsked(): Alert {
      expect(alertCreate).toHaveBeenCalledTimes(1);
      return alertCreate.mock.calls[0]![0].data;
    }

    test("becomes an alert in the project, created as the caller", async () => {
      const props: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
      ]);

      const result: OnCallPageResult = await pageAboutSomethingNew({
        props: props,
        newAlert: {
          title: "  Payments are failing  ",
          description: "  Card payments **fail** at checkout.  ",
        },
      });

      const alert: Alert = alertAsked();

      expect(alertCreate.mock.calls[0]![0].props).toBe(props);
      expect(alert.projectId!.toString()).toBe(PROJECT_ID.toString());
      expect(alert.title).toBe("Payments are failing");
      expect(alert.description).toBe("Card payments **fail** at checkout.");

      expect(result.record).toEqual({
        type: OnCallPageRecordType.Alert,
        id: expect.objectContaining({ id: NEW_ALERT.toString() }),
        label: "Alert #13",
        title: "Payments are failing",
        url: URL.fromString(
          `${DASHBOARD}/${PROJECT_ID.toString()}/alerts/${NEW_ALERT.toString()}`,
        ),
        isNew: true,
      });
    });

    test("the people are paged about that alert", async () => {
      await pageAboutSomethingNew();

      const asked: Parameters<
        typeof OnCallDutyPolicyExecutionLogService.startDirectPage
      >[0] = directPageAsked();

      expect(asked.triggeredByAlertId!.toString()).toBe(NEW_ALERT.toString());
      expect(asked.triggeredByIncidentId).toBeUndefined();
    });

    test("with no severity named it is the project's most severe - never another project's", async () => {
      await pageAboutSomethingNew();

      expect(alertAsked().alertSeverityId!.toString()).toBe(
        SEVERITY_CRITICAL.toString(),
      );
    });

    test("with no severity named it is never an archived one", async () => {
      // Critical is archived: nobody may pick it for a new alert.
      severities.rows = severities.rows.map(
        (row: Record<string, unknown>): Record<string, unknown> => {
          return String(row["_id"]) === SEVERITY_CRITICAL.toString()
            ? { ...row, isArchived: true }
            : row;
        },
      );

      await pageAboutSomethingNew();

      expect(alertAsked().alertSeverityId!.toString()).toBe(
        SEVERITY_LOW.toString(),
      );
    });

    test("with a severity of the project named, it is that one", async () => {
      await pageAboutSomethingNew({
        newAlert: { alertSeverityId: SEVERITY_LOW },
      });

      expect(alertAsked().alertSeverityId!.toString()).toBe(
        SEVERITY_LOW.toString(),
      );
    });

    test.each<[string, ObjectID]>([
      ["another project's severity", SEVERITY_ELSEWHERE],
      ["a severity nobody has", NOBODY],
      ["something that is not an id", new ObjectID("Critical")],
    ])(
      "%s is not found: no alert is created and nobody is paged",
      async (_which: string, alertSeverityId: ObjectID) => {
        const error: Error = await refusalOf(
          pageAboutSomethingNew({
            newAlert: { alertSeverityId: alertSeverityId },
          }),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(
          `Nobody was paged. No alert severity has the ID ${alertSeverityId.toString()}.`,
        );
        nothingWasStarted();
      },
    );

    test("a project with no alert severities cannot page about something new, and is told what to add", async () => {
      severities.rows = severities.rows.filter(
        (row: Record<string, unknown>): boolean => {
          return row["projectId"] !== PROJECT_ID.toString();
        },
      );

      const error: Error = await refusalOf(pageAboutSomethingNew());

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "Nobody was paged. This project has no alert severities, and a page about something new is an alert. Add one in Project Settings.",
      );
      nothingWasStarted();
    });

    test("a description that is empty is left off the alert", async () => {
      await pageAboutSomethingNew({ newAlert: { description: "   " } });

      expect(alertAsked().description).toBeUndefined();
    });

    test("a workflow's alert says which workflow created it, and why", async () => {
      await pageAboutSomethingNew({ props: workflowStep() });

      expect(alertAsked().rootCause).toBe(
        "Created by workflow **Page the on-call engineer** to page people.",
      );
    });

    test("the workflow's name there is text: it cannot be a link or formatting of its own", async () => {
      await pageAboutSomethingNew({
        props: {
          ...workflowStep(),
          workflowName: "[click](https://evil.example) **now**",
        },
      });

      const rootCause: string = alertAsked().rootCause!;

      expect(rootCause).not.toContain("[click](https://evil.example)");
      expect(rootCause).toContain("\\[click\\](https://evil.example)");
    });

    test("a person's alert says nothing of a workflow", async () => {
      await pageAboutSomethingNew();

      expect(alertAsked().rootCause).toBeUndefined();
    });

    /*
     * A page from a chat (`/oneuptime page`) says where it came from in its
     * own words: who paged, from which chat.
     */
    test("an alert a page names its own root cause for takes it, as given", async () => {
      await pageAboutSomethingNew({
        newAlert: {
          rootCause: "Created by **Jane Doe** from Slack to page people.",
        },
      });

      expect(alertAsked().rootCause).toBe(
        "Created by **Jane Doe** from Slack to page people.",
      );
    });

    test("a root cause the page names wins over the workflow's", async () => {
      await pageAboutSomethingNew({
        props: workflowStep(),
        newAlert: { rootCause: "From chat." },
      });

      expect(alertAsked().rootCause).toBe("From chat.");
    });

    test("a root cause of only spaces is none: a workflow's alert still names the workflow", async () => {
      await pageAboutSomethingNew({
        props: workflowStep(),
        newAlert: { rootCause: "   " },
      });

      expect(alertAsked().rootCause).toBe(
        "Created by workflow **Page the on-call engineer** to page people.",
      );
    });

    test("an on-call policy the page names is the new alert's own: the alert starts it, and the page does not start it again", async () => {
      const result: OnCallPageResult = await pageAboutSomethingNew({
        targets: {
          userIds: [JANE],
          onCallDutyPolicyIds: [POLICY_CRITICAL, POLICY_DATABASE],
        },
      });

      expect(
        (alertAsked().onCallDutyPolicies || []).map(
          (policy: { id: ObjectID | null }) => {
            return policy.id!.toString();
          },
        ),
      ).toEqual([POLICY_CRITICAL, POLICY_DATABASE].map(String));
      expect(policyStart).not.toHaveBeenCalled();
      expect(result.startedPolicies).toEqual([
        { onCallDutyPolicyId: POLICY_CRITICAL, name: "Critical" },
        { onCallDutyPolicyId: POLICY_DATABASE, name: "Database" },
      ]);
      expect(result.isAnyonePaged).toBe(true);
    });

    test("only policies named: the alert is created with them, and no direct page is started", async () => {
      const result: OnCallPageResult = await pageAboutSomethingNew({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
      });

      expect(alertCreate).toHaveBeenCalledTimes(1);
      expect(directPage).not.toHaveBeenCalled();
      expect(result.directPageExecutionLogId).toBeNull();
      expect(result.summary).toBe(
        "Started on-call policy Critical for Alert #13.",
      );
    });

    test("an archived policy is not put on the new alert", async () => {
      await pageAboutSomethingNew({
        targets: { userIds: [JANE], onCallDutyPolicyIds: [POLICY_ARCHIVED] },
      });

      expect(alertAsked().onCallDutyPolicies).toBeUndefined();
    });

    test("an alert the caller may not create is not created, and nobody is paged", async () => {
      const refusal: Error = new Error(
        "You do not have permissions to create Alert.",
      );
      alertCreate.mockRejectedValue(refusal);

      const error: Error = await refusalOf(pageAboutSomethingNew());

      expect(error).toBe(refusal);
      expect(directPage).not.toHaveBeenCalled();
      expect(policyStart).not.toHaveBeenCalled();
    });
  });

  describe("on-call policies, for a record that is already there", () => {
    test("each is started as the caller, as the Dashboard's Execute On-Call Policy starts one", async () => {
      const props: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
      ]);

      const result: OnCallPageResult = await page({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL, POLICY_DATABASE] },
        about: { incidentId: INCIDENT },
        props: props,
      });

      expect(policyStart).toHaveBeenCalledTimes(2);

      for (const [index, policyId] of [
        POLICY_CRITICAL,
        POLICY_DATABASE,
      ].entries()) {
        const createBy: {
          data: OnCallDutyPolicyExecutionLog;
          props: unknown;
        } = policyStart.mock.calls[index]![0];

        expect(createBy.props).toBe(props);
        expect(createBy.data.projectId!.toString()).toBe(PROJECT_ID.toString());
        expect(createBy.data.onCallDutyPolicyId!.toString()).toBe(
          policyId.toString(),
        );
        expect(createBy.data.triggeredByIncidentId!.toString()).toBe(
          INCIDENT.toString(),
        );
        expect(createBy.data.triggeredByAlertId).toBeUndefined();
        expect(createBy.data.userNotificationEventType).toBe(
          UserNotificationEventType.IncidentCreated,
        );
      }

      expect(result.startedPolicies).toEqual([
        { onCallDutyPolicyId: POLICY_CRITICAL, name: "Critical" },
        { onCallDutyPolicyId: POLICY_DATABASE, name: "Database" },
      ]);
      expect(result.paged).toEqual([]);
      expect(result.isAnyonePaged).toBe(true);
      expect(result.directPageExecutionLogId).toBeNull();
      expect(directPage).not.toHaveBeenCalled();
      expect(result.summary).toBe(
        "Started on-call policies Critical and Database for Incident INC-8.",
      );
    });

    test("for an alert, the run is an alert's", async () => {
      await page({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
        about: { alertId: ALERT },
      });

      const run: OnCallDutyPolicyExecutionLog =
        policyStart.mock.calls[0]![0].data;

      expect(run.triggeredByAlertId!.toString()).toBe(ALERT.toString());
      expect(run.triggeredByIncidentId).toBeUndefined();
      expect(run.userNotificationEventType).toBe(
        UserNotificationEventType.AlertCreated,
      );
    });

    test("one that cannot be started does not stop the others, and the page says which and why", async () => {
      policyStartError[POLICY_CRITICAL.toString()] = new BadDataException(
        "You do not have permissions to create On-Call Duty Execution Log",
      );

      const result: OnCallPageResult = await page({
        targets: {
          userIds: [JANE],
          onCallDutyPolicyIds: [POLICY_CRITICAL, POLICY_DATABASE],
        },
      });

      expect(policyStart).toHaveBeenCalledTimes(2);
      expect(result.startedPolicies).toEqual([
        { onCallDutyPolicyId: POLICY_DATABASE, name: "Database" },
      ]);
      expect(result.notPaged).toEqual([
        "On-call policy Critical could not be started: You do not have permissions to create On-Call Duty Execution Log.",
      ]);
      // And the people are still paged.
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("when none can be started and nobody else was named, nobody was paged", async () => {
      policyStartError[POLICY_CRITICAL.toString()] = new Error("");

      const result: OnCallPageResult = await page({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
      });

      expect(result.isAnyonePaged).toBe(false);
      expect(result.startedPolicies).toEqual([]);
      expect(result.summary).toBe(
        "Nobody was paged about Incident INC-8. On-call policy Critical could not be started: an error occurred.",
      );
    });
  });

  /*
   * A page about an incident or an alert that is there already - from its
   * own Slack or Teams channel - carries what the person who paged wrote:
   * the page's message, kept on each run it starts (pageMessage), where the
   * run's chat message quotes it and the people paged read it.
   */
  describe("the page's own message, for a record that is already there", () => {
    test("goes with the people's direct page, on one line", async () => {
      await page({
        targets: { userIds: [JANE] },
        about: {
          incidentId: INCIDENT,
          message: "  Can you check\nthe   database? ",
        },
      });

      expect(directPageAsked().pageMessage).toBe(
        "Can you check the database?",
      );
      expect(alertCreate).not.toHaveBeenCalled();
    });

    test("about an alert too", async () => {
      await page({
        targets: { userIds: [JANE] },
        about: { alertId: ALERT, message: "Disk is at 98%" },
      });

      expect(directPageAsked().pageMessage).toBe("Disk is at 98%");
      expect(directPageAsked().triggeredByAlertId!.toString()).toBe(
        ALERT.toString(),
      );
    });

    test("no message, or only white space: none is kept", async () => {
      await page({
        targets: { userIds: [JANE] },
        about: { incidentId: INCIDENT, message: " \n " },
      });

      expect("pageMessage" in directPageAsked()).toBe(false);
    });

    test("a policy the page starts keeps it too, written as OneUptime once the caller's run is made", async () => {
      const policyRunId: ObjectID = ObjectID.generate();

      policyStart.mockImplementation(
        async (createBy: {
          data: OnCallDutyPolicyExecutionLog;
        }): Promise<OnCallDutyPolicyExecutionLog> => {
          createBy.data.id = policyRunId;
          return createBy.data;
        },
      );

      const written: SpyInstance<
        typeof OnCallDutyPolicyExecutionLogService.updateOneById
      > = jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await page({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
        about: { incidentId: INCIDENT, message: "Checkout is down again" },
      });

      // Created as the caller, without the column no caller may write...
      expect(policyStart.mock.calls[0]![0].data.pageMessage).toBeUndefined();
      // ... and the message written as OneUptime.
      expect(written).toHaveBeenCalledWith({
        id: policyRunId,
        data: { pageMessage: "Checkout is down again" },
        props: { isRoot: true },
      });
    });

    test("a message that cannot be written never stops the policy", async () => {
      policyStart.mockImplementation(
        async (createBy: {
          data: OnCallDutyPolicyExecutionLog;
        }): Promise<OnCallDutyPolicyExecutionLog> => {
          createBy.data.id = ObjectID.generate();
          return createBy.data;
        },
      );
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
        .mockRejectedValue(new Error("Database is busy"));

      const result: OnCallPageResult = await page({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
        about: { incidentId: INCIDENT, message: "Checkout is down again" },
      });

      expect(result.startedPolicies).toEqual([
        { onCallDutyPolicyId: POLICY_CRITICAL, name: "Critical" },
      ]);
      expect(result.notPaged).toEqual([]);
    });

    test("a page about something new says it in its alert's title: a message beside it is refused before anything is read", async () => {
      const error: Error = await refusalOf(
        page({
          targets: { userIds: [JANE] },
          about: {
            newAlert: { title: "Checkout is down" },
            message: "and the database too",
          },
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "A page about something new says what it is about in its alert's title. Leave the message out.",
      );
      expect(tablesRead()).toBe(0);
      nothingWasStarted();
    });

    test("a page about something new with an empty message beside it is a page", async () => {
      const result: OnCallPageResult = await page({
        targets: { userIds: [JANE] },
        about: { newAlert: { title: "Checkout is down" }, message: "  " },
      });

      expect(result.record.isNew).toBe(true);
      // The new alert's title is the message: the run carries none of its own.
      expect("pageMessage" in directPageAsked()).toBe(false);
    });
  });

  describe("the direct page", () => {
    test("names who started it from the caller: a workflow's step", async () => {
      await page({ targets: { userIds: [JANE] }, props: workflowStep() });

      expect(directPageAsked().startedBy).toEqual({
        userId: undefined,
        workflowId: expect.objectContaining({ id: WORKFLOW_ID.toString() }),
        workflowName: "Page the on-call engineer",
      });
    });

    test("names who started it from the caller: a person", async () => {
      const props: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
      ]);

      await page({ targets: { userIds: [JANE] }, props: props });

      expect(directPageAsked().startedBy).toEqual({
        userId: props.userId,
        workflowId: undefined,
        workflowName: undefined,
      });
    });

    test("is not started when only policies are named", async () => {
      await page({ targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] } });

      expect(directPage).not.toHaveBeenCalled();
    });

    test("a failure to page is the caller's to hear", async () => {
      const failure: Error = new Error("The run could not be written.");
      directPage.mockRejectedValue(failure);

      expect(await refusalOf(page({ targets: { userIds: [JANE] } }))).toBe(
        failure,
      );
    });
  });

  describe("what the caller is told", () => {
    test("everybody paged, by name, with the team or schedule they were paged through and whom they cover", async () => {
      outcome = {
        paged: [
          {
            userId: JANE,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
          {
            userId: JOHN,
            coveringForUserId: null,
            teamId: TEAM_PLATFORM,
            scheduleId: null,
          },
          {
            userId: ALEX,
            coveringForUserId: JANE,
            teamId: null,
            scheduleId: SCHEDULE_PRIMARY,
          },
          {
            userId: NO_NAME,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
        notPaged: [],
        hadScheduleGap: false,
      };

      const result: OnCallPageResult = await page({
        targets: {
          userIds: [JANE, NO_NAME],
          teamIds: [TEAM_PLATFORM],
          onCallScheduleIds: [SCHEDULE_PRIMARY],
        },
      });

      expect(result.paged).toEqual([
        {
          userId: JANE,
          name: "Jane Doe",
          email: "jane@example.com",
          teamName: null,
          scheduleName: null,
          coveringForName: null,
        },
        {
          userId: JOHN,
          name: "John Roe",
          email: "john@example.com",
          teamName: "Platform",
          scheduleName: null,
          coveringForName: null,
        },
        {
          userId: ALEX,
          name: "Alex Kim",
          email: "alex@example.com",
          teamName: null,
          scheduleName: "Primary",
          coveringForName: "Jane Doe",
        },
        {
          userId: NO_NAME,
          // Somebody with no name is named by their email address.
          name: "noname@example.com",
          email: "noname@example.com",
          teamName: null,
          scheduleName: null,
          coveringForName: null,
        },
      ]);
      expect(result.isAnyonePaged).toBe(true);
      expect(result.directPageExecutionLogId).toBe(RUN_ID);
      expect(result.summary).toBe(
        "Paged Jane Doe, John Roe (member of Platform), Alex Kim (on call in Primary, covering for Jane Doe) and noname@example.com about Incident INC-8.",
      );
    });

    test("who was not paged and why, each as a sentence", async () => {
      outcome = {
        paged: [],
        notPaged: [
          {
            reason: OnCallNotPagedReason.Away,
            userId: ALEX,
            teamId: null,
            scheduleId: null,
            awayUntil: new Date("2026-10-17T09:00:00.000Z"),
          },
          {
            reason: OnCallNotPagedReason.Away,
            userId: JOHN,
            teamId: null,
            scheduleId: null,
            awayUntil: null,
          },
          {
            reason: OnCallNotPagedReason.NotAProjectMember,
            userId: OUTSIDER,
            teamId: TEAM_PLATFORM,
            scheduleId: null,
            awayUntil: null,
          },
          {
            reason: OnCallNotPagedReason.NobodyOnCall,
            userId: null,
            teamId: null,
            scheduleId: SCHEDULE_SECONDARY,
            awayUntil: null,
          },
          {
            reason: OnCallNotPagedReason.EmptyTeam,
            userId: null,
            teamId: TEAM_EMPTY,
            scheduleId: null,
            awayUntil: null,
          },
        ],
        hadScheduleGap: true,
      };

      const result: OnCallPageResult = await page({
        targets: {
          userIds: [ALEX, JOHN],
          teamIds: [TEAM_PLATFORM, TEAM_EMPTY],
          onCallScheduleIds: [SCHEDULE_SECONDARY],
        },
      });

      expect(result.notPaged).toEqual([
        "Alex Kim was not paged: they are away until 2026-10-17 09:00 UTC, and nobody is named to cover for them.",
        "John Roe was not paged: they are away, and nobody is named to cover for them.",
        "Olive Outsider was not paged: they are not a member of this project.",
        "Nobody is on call in schedule Secondary right now.",
        "Team Night Shift has no members.",
      ]);
      expect(result.paged).toEqual([]);
      expect(result.isAnyonePaged).toBe(false);
      // The page was tried, and the record says so: its run is handed back.
      expect(result.directPageExecutionLogId).toBe(RUN_ID);
      expect(result.summary).toBe(
        `Nobody was paged about Incident INC-8. ${result.notPaged.join(" ")}`,
      );
    });

    test("what was not found comes first, then what the page itself found", async () => {
      outcome = {
        paged: [
          {
            userId: JANE,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
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

      const result: OnCallPageResult = await page({
        targets: {
          userIds: [JANE, NOBODY],
          onCallScheduleIds: [SCHEDULE_PRIMARY],
        },
      });

      expect(result.notPaged).toEqual([
        `No member of this project has the ID ${NOBODY.toString()}.`,
        "Nobody is on call in schedule Primary right now.",
      ]);
      expect(result.summary).toBe(
        `Paged Jane Doe about Incident INC-8. No member of this project has the ID ${NOBODY.toString()}. Nobody is on call in schedule Primary right now.`,
      );
    });

    test("the same thing is said once, however many targets it is true of", async () => {
      outcome = {
        paged: [],
        notPaged: [
          {
            reason: OnCallNotPagedReason.Away,
            userId: ALEX,
            teamId: TEAM_PLATFORM,
            scheduleId: null,
            awayUntil: new Date("2026-10-17T09:00:00.000Z"),
          },
          {
            reason: OnCallNotPagedReason.Away,
            userId: ALEX,
            teamId: null,
            scheduleId: null,
            awayUntil: new Date("2026-10-17T09:00:00.000Z"),
          },
        ],
        hadScheduleGap: false,
      };

      const result: OnCallPageResult = await page({
        targets: { userIds: [ALEX], teamIds: [TEAM_PLATFORM] },
      });

      expect(result.notPaged).toHaveLength(1);
    });

    test("people and policies together", async () => {
      outcome = {
        paged: [
          {
            userId: JANE,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
          {
            userId: JOHN,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
        notPaged: [],
        hadScheduleGap: false,
      };

      const result: OnCallPageResult = await page({
        targets: {
          userIds: [JANE, JOHN],
          onCallDutyPolicyIds: [POLICY_CRITICAL],
        },
        about: { alertId: ALERT },
      });

      expect(result.summary).toBe(
        "Paged Jane Doe and John Roe about Alert AL-12. Started on-call policy Critical for Alert AL-12.",
      );
    });

    test("more than five people are named up to five, and counted after", async () => {
      const crowd: Array<ObjectID> = [];

      for (let i: number = 1; i <= 7; i++) {
        const id: ObjectID = ObjectID.generate();

        crowd.push(id);
        members.add(id.toString());
        users.rows.push({
          _id: id.toString(),
          name: `Person ${i}`,
          email: `person${i}@example.com`,
        });
      }

      outcome = {
        paged: crowd.map((userId: ObjectID) => {
          return {
            userId: userId,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          };
        }),
        notPaged: [],
        hadScheduleGap: false,
      };

      const result: OnCallPageResult = await page({
        targets: { userIds: crowd },
      });

      expect(result.paged).toHaveLength(7);
      expect(result.summary).toBe(
        "Paged Person 1, Person 2, Person 3, Person 4, Person 5 and 2 others about Incident INC-8.",
      );
    });

    test("somebody paged whose account cannot be read is still counted, as someone", async () => {
      outcome = {
        paged: [
          {
            userId: NOBODY,
            coveringForUserId: null,
            teamId: TEAM_PLATFORM,
            scheduleId: null,
          },
        ],
        notPaged: [],
        hadScheduleGap: false,
      };

      const result: OnCallPageResult = await page({
        targets: { teamIds: [TEAM_PLATFORM] },
      });

      expect(result.paged).toEqual([
        {
          userId: NOBODY,
          name: "Someone",
          email: null,
          teamName: "Platform",
          scheduleName: null,
          coveringForName: null,
        },
      ]);
    });
  });

  describe("a record created a moment ago is given time to get its channels", () => {
    let clock: number;

    // The record was created so long ago, and its "created" entry is in its feed or not.
    function justCreated(data: {
      table: InMemoryTable;
      id: ObjectID;
      secondsAgo: number;
    }): void {
      data.table.get(data.id)!["createdAt"] = new Date(
        clock - data.secondsAgo * 1000,
      );
    }

    function createdEntry(record: "incident" | "alert"): void {
      if (record === "incident") {
        incidentFeed.rows.push({
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
          incidentId: INCIDENT.toString(),
          incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
        });

        return;
      }

      alertFeed.rows.push({
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        alertId: ALERT.toString(),
        alertFeedEventType: AlertFeedEventType.AlertCreated,
      });
    }

    function feedReads(): number {
      return (
        incidentFeed.repository.find.mock.calls.length +
        alertFeed.repository.find.mock.calls.length
      );
    }

    beforeEach(() => {
      clock = new Date("2026-10-13T12:00:00.000Z").getTime();

      // The one clock the wait reads.
      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockImplementation((): Date => {
          return new Date(clock);
        });

      // Waiting moves the clock on, and nothing else.
      sleep.mockImplementation(async (ms: number): Promise<void> => {
        clock += ms;
      });
    });

    test("a record that is not new is paged about at once: its feed is not even looked at", async () => {
      await page({ targets: { userIds: [JANE] } });

      expect(feedReads()).toBe(0);
      expect(sleep).not.toHaveBeenCalled();
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("one just over two minutes old is not new", async () => {
      justCreated({
        table: incidents,
        id: INCIDENT,
        secondsAgo: ON_CALL_PAGE_RECORD_SETUP_AGE_IN_MS / 1000 + 1,
      });

      await page({ targets: { userIds: [JANE] } });

      expect(feedReads()).toBe(0);
      expect(sleep).not.toHaveBeenCalled();
    });

    test("a new record whose 'created' entry is in its feed is paged about at once", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 2 });
      createdEntry("incident");

      await page({ targets: { userIds: [JANE] } });

      expect(feedReads()).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("a new record with no 'created' entry yet is waited for, looking twice a second, and paged about when the entry is there", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

      let looks: number = 0;

      sleep.mockImplementation(async (ms: number): Promise<void> => {
        clock += ms;
        looks++;

        // Its channels are ready a second and a half in.
        if (looks === 3) {
          createdEntry("incident");
        }
      });

      await page({ targets: { userIds: [JANE] } });

      expect(
        sleep.mock.calls.map((call: Array<unknown>): unknown => {
          return call[0];
        }),
      ).toEqual([
        ON_CALL_PAGE_RECORD_SETUP_POLL_INTERVAL_IN_MS,
        ON_CALL_PAGE_RECORD_SETUP_POLL_INTERVAL_IN_MS,
        ON_CALL_PAGE_RECORD_SETUP_POLL_INTERVAL_IN_MS,
      ]);
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("it is the record's own 'created' entry that is waited for, not any entry of its feed or another record's", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

      incidentFeed.rows.push(
        {
          _id: ObjectID.generate().toString(),
          incidentId: INCIDENT.toString(),
          incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
        },
        {
          _id: ObjectID.generate().toString(),
          incidentId: INCIDENT_NO_PREFIX.toString(),
          incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
        },
      );

      await page({ targets: { userIds: [JANE] }, maxWaitForRecordInMs: 1000 });

      // Neither counted: it waited its whole second.
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    test("it waits twenty seconds at most unless told otherwise, and then pages anyway", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

      const startedAt: number = clock;

      await page({ targets: { userIds: [JANE] } });

      expect(clock - startedAt).toBe(
        ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS,
      );
      expect(sleep).toHaveBeenCalledTimes(
        ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS /
          ON_CALL_PAGE_RECORD_SETUP_POLL_INTERVAL_IN_MS,
      );
      // A page that is late in a channel is better than one late on a phone.
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("a caller with less time is held to what it has, to the millisecond", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

      const startedAt: number = clock;

      await page({ targets: { userIds: [JANE] }, maxWaitForRecordInMs: 1200 });

      expect(clock - startedAt).toBe(1200);
      expect(
        sleep.mock.calls.map((call: Array<unknown>): unknown => {
          return call[0];
        }),
      ).toEqual([500, 500, 200]);
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test.each([0, -1])(
      "a caller with no time (%d) does not wait, and reads nothing for it",
      async (maxWaitForRecordInMs: number) => {
        justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

        await page({
          targets: { userIds: [JANE] },
          maxWaitForRecordInMs: maxWaitForRecordInMs,
        });

        expect(feedReads()).toBe(0);
        expect(sleep).not.toHaveBeenCalled();
        expect(directPage).toHaveBeenCalledTimes(1);
      },
    );

    test("an alert is waited for by its own feed", async () => {
      justCreated({ table: alerts, id: ALERT, secondsAgo: 1 });

      sleep.mockImplementation(async (ms: number): Promise<void> => {
        clock += ms;
        createdEntry("alert");
      });

      await page({ targets: { userIds: [JANE] }, about: { alertId: ALERT } });

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(incidentFeed.repository.find).not.toHaveBeenCalled();
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("the alert a page about something new creates is new: its people are paged once it has its channels", async () => {
      sleep.mockImplementation(async (ms: number): Promise<void> => {
        clock += ms;

        alertFeed.rows.push({
          _id: ObjectID.generate().toString(),
          alertId: NEW_ALERT.toString(),
          alertFeedEventType: AlertFeedEventType.AlertCreated,
        });
      });

      // The alert is created "now", by the suite's clock.
      alertCreate.mockImplementation(
        async (createBy: { data: Alert }): Promise<Alert> => {
          const alert: Alert = createBy.data;

          alert.id = NEW_ALERT;
          alert.alertNumber = 13;

          alerts.rows.push({
            _id: NEW_ALERT.toString(),
            projectId: PROJECT_ID.toString(),
            title: alert.title,
            alertNumber: 13,
            createdAt: new Date(clock),
          });

          return alert;
        },
      );

      await page({
        targets: { userIds: [JANE] },
        about: { newAlert: { title: "Payments are failing" } },
      });

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(directPage).toHaveBeenCalledTimes(1);
    });

    test("a new alert with only policies to run is not waited for: the alert starts them itself when it is ready", async () => {
      await page({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
        about: { newAlert: { title: "Payments are failing" } },
      });

      expect(feedReads()).toBe(0);
      expect(sleep).not.toHaveBeenCalled();
    });

    test("policies for a record that is already there wait for it like a direct page", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

      await page({
        targets: { onCallDutyPolicyIds: [POLICY_CRITICAL] },
        maxWaitForRecordInMs: 500,
      });

      expect(sleep).toHaveBeenCalledTimes(1);
      // Started after the wait, not before it.
      expect(sleep.mock.invocationCallOrder[0]!).toBeLessThan(
        policyStart.mock.invocationCallOrder[0]!,
      );
    });

    test("the people are paged after the wait, not before it", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

      await page({ targets: { userIds: [JANE] }, maxWaitForRecordInMs: 500 });

      expect(sleep.mock.invocationCallOrder[0]!).toBeLessThan(
        directPage.mock.invocationCallOrder[0]!,
      );
    });

    test("a feed that cannot be read is never a reason not to page", async () => {
      justCreated({ table: incidents, id: INCIDENT, secondsAgo: 1 });

      incidentFeed.repository.find.mockRejectedValue(
        new Error("The feed could not be read."),
      );

      await page({ targets: { userIds: [JANE] } });

      expect(directPage).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    test("a record that is gone by the time it is looked at is not waited for", async () => {
      await OnCallPageService.waitUntilRecordIsSetUp({
        record: { type: OnCallPageRecordType.Incident, id: NOBODY },
        maxWaitInMs: 5000,
      });

      expect(feedReads()).toBe(0);
      expect(sleep).not.toHaveBeenCalled();
    });
  });
});
