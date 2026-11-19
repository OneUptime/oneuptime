import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  AddMonitorsToStatusPageTool,
  PublishStatusPageTool,
  SETUP_PLAN_ORDER,
  SETUP_TOOL_NAMES,
  SETUP_TOOLS,
  SetUpPagingTool,
  SetUpWebsiteMonitoringTool,
  SetupReachMethod,
  countMonitorsSetUpInPlan,
  describeProbeAgreementForPerson,
  describeReachForPerson,
  describeWebsiteMonitoringForPerson,
  getMonitorNamesSetUpInPlan,
  getMonitoringIntervalForMinutes,
  pagesPeopleAlready,
  readCheckEveryMinutes,
  readNames,
  readPreparedResponders,
  readReachMethods,
  readSetupRecordsLanguage,
} from "../../../../../Server/Utils/AI/Toolbox/SetupTools";
import UserLanguage from "../../../../../Server/Utils/Notification/UserLanguage";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../../../Server/Utils/ServerTranslation";
import UserService from "../../../../../Server/Services/UserService";
import {
  ObservabilityTool,
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertOnCallRuleService from "../../../../../Server/Services/AlertOnCallRuleService";
import AlertSeverityService from "../../../../../Server/Services/AlertSeverityService";
import IncidentOnCallRuleService from "../../../../../Server/Services/IncidentOnCallRuleService";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import MonitorProbeService from "../../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import {
  ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  getNameTakenRefusalText,
} from "../../../../../Types/Database/UniqueName";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "../../../../../Server/Services/PayAsYouGoBillingService";
import ActiveMonitorLimit from "../../../../../Server/Utils/Billing/ActiveMonitorLimit";
import OnCallReadinessService, {
  ReadinessMethodType,
  ReadinessStatus,
  UserReadiness,
} from "../../../../../Server/Services/OnCallReadinessService";
import ProbeService from "../../../../../Server/Services/ProbeService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../../Server/Services/TeamService";
import AlertOnCallRule from "../../../../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import IncidentOnCallRule from "../../../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import {
  AIChatCitationTargetType,
  AIToolRefusal,
} from "../../../../../Types/AI/AIChatTypes";
import {
  AI_ACTION_CARD_KINDS,
  AI_ACTION_LINES,
  AIActionSentence,
  describeAIActionCardWords,
  describeAIActionSentence,
  isKnownAIActionCardWords,
  isKnownAIActionSentence,
} from "../../../../../Types/AI/AIActionWords";
import {
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
  AI_SETUP_ACTION_TOOL_NAMES,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
} from "../../../../../Types/AI/AISetupActions";
import Email from "../../../../../Types/Email";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import {
  EVERY_NEW_EVENT_RULES_LANGUAGE_KEY,
  getEveryNewIncidentRuleName,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
} from "../../../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  getFirstOnCallPolicyName,
  GUIDED_SETUP_POLICY_NAME,
} from "../../../../../Utils/GuidedSetup/OnCallPolicyRecords";
import { GUIDED_SETUP_RESOURCE_OPTIONS } from "../../../../../Utils/GuidedSetup/StatusPageRecords";
import {
  GUIDED_SETUP_MONITORING_INTERVAL,
  buildWebsiteMonitor,
  parseWebsiteAddress,
} from "../../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import { Translator } from "../../../../../Types/Translator";
import {
  getProbeAgreementSentence,
  PROBE_AGREEMENT_SENTENCES,
} from "../../../../../Utils/Monitor/ProbeAgreementRule";
import {
  actionLineText,
  actionTitleText,
} from "../../../../Helpers/AIActionText";
import { dashboardTranslator } from "../../../../Helpers/DashboardLocales";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ASK AI SETS THINGS UP (issue #6829): each setup action, on its own.
 *
 * Every action is held to what it promises the person on the approval card
 * and to what it makes once approved:
 *
 *   - the card says, in the module's sentences, what will exist: what is
 *     checked and how often, from where, what happens when it goes down,
 *     who is paged and what is missing for the person to be reached, what a
 *     status page shows - a monitor the same plan sets up first included;
 *   - what cannot be made is said before any card (checkBeforeApproval):
 *     an address that is not one, a plan with no room for the monitors,
 *     paging the project has already, nobody to page, monitors or a status
 *     page that do not exist;
 *   - once approved, the records are the guided setups' (built in
 *     Common/Utils/GuidedSetup), written through the services as the
 *     person (props: ctx.props), with a card that links the record and
 *     offers the test page.
 *
 * The services are stubbed; nothing reaches a database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("abababab-abab-4bab-8bab-abababababab");
const ANA_ID: string = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
const TEAM_ID: string = "efefefef-efef-4fef-8fef-efefefefefef";
const OPERATIONAL_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";
const API_MONITOR_ID: string = "66666666-6666-4666-8666-666666666666";
const POLICY_ID: string = "77777777-7777-4777-8777-777777777777";
const STATUS_PAGE_ID: string = "88888888-8888-4888-8888-888888888888";
const ANA_MEMBERSHIP_ID: string = "99999999-9999-4999-8999-999999999999";
const MY_MEMBERSHIP_ID: string = "abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

// The project's statuses and severities, as Create Monitor reads them.
function stubSeeds(options?: { missing?: boolean }): void {
  jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue(
    (options?.missing
      ? []
      : [
          model(MonitorStatus, {
            _id: OPERATIONAL_ID.toString(),
            isOperationalState: true,
          }),
          model(MonitorStatus, {
            _id: OFFLINE_ID.toString(),
            isOfflineState: true,
          }),
        ]) as never,
  );
  jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([
    model(IncidentSeverity, {
      _id: ObjectID.generate().toString(),
      name: "Archived",
      isArchived: true,
    }),
    model(IncidentSeverity, {
      _id: INCIDENT_SEVERITY_ID.toString(),
      name: "Critical Incident",
      isArchived: false,
    }),
  ] as never);
  jest.spyOn(IncidentSeverityService, "findOneById").mockResolvedValue(
    model(IncidentSeverity, {
      _id: INCIDENT_SEVERITY_ID.toString(),
      name: "Critical Incident",
    }) as never,
  );
  jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue([
    model(AlertSeverity, {
      _id: ALERT_SEVERITY_ID.toString(),
      isArchived: false,
    }),
  ] as never);
}

/*
 * The project may pay as you go, so the plan's room is what is asked next.
 * Said by the test: with billing on, as Common Test runs, the real check
 * reads the project's billing from a database there is none of.
 */
function payAsYouGoIsSetUp(): void {
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(true as never);
}

// The probes a new monitor starts with: two global ones and none of the project's.
function stubLocations(data?: {
  global?: number;
  project?: number;
  skipGlobal?: boolean;
}): Spy {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
    model(Project, {
      _id: PROJECT_ID.toString(),
      name: "Acme",
      doNotAddGlobalProbesByDefaultOnNewMonitors: Boolean(data?.skipGlobal),
    }) as never,
  );

  return jest.spyOn(ProbeService, "countBy").mockImplementation((async (args: {
    query: { isGlobalProbe: boolean };
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(
      args.query.isGlobalProbe ? data?.global ?? 2 : data?.project ?? 0,
    );
  }) as never);
}

function stubMonitorCreate(): Spy {
  return jest.spyOn(MonitorService, "create").mockImplementation((async (args: {
    data: Monitor;
  }): Promise<Monitor> => {
    const created: Monitor = args.data;
    created._id = MONITOR_ID;
    return created;
  }) as never);
}

/*
 * The project's paging, as its database holds it: each policy archived or
 * not, and each on-call rule with the policies it runs, archived or not.
 * The fake answers as the services do: a count of the policies the query
 * matches, and the rules read with their policies (#8518).
 */
function servePaging(project: {
  policies: Array<boolean>;
  incidentRules?: Array<Array<boolean>>;
  alertRules?: Array<Array<boolean>>;
}): { policyCount: Spy; incidentRules: Spy; alertRules: Spy } {
  const rulesOf: <T extends IncidentOnCallRule | AlertOnCallRule>(
    type: { new (): T },
    rules: Array<Array<boolean>>,
  ) => Array<T> = <T extends IncidentOnCallRule | AlertOnCallRule>(
    type: { new (): T },
    rules: Array<Array<boolean>>,
  ): Array<T> => {
    return rules.map((policiesArchived: Array<boolean>): T => {
      const rule: T = new type();
      rule._id = ObjectID.generate().toString();
      rule.onCallDutyPolicies = policiesArchived.map(
        (isArchived: boolean): OnCallDutyPolicy => {
          const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
          policy._id = ObjectID.generate().toString();
          policy.isArchived = isArchived;
          return policy;
        },
      );
      return rule;
    });
  };

  return {
    policyCount: jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<PositiveNumber> => {
        return new PositiveNumber(
          project.policies.filter((isArchived: boolean): boolean => {
            return (
              !("isArchived" in args.query) ||
              args.query["isArchived"] === isArchived
            );
          }).length,
        );
      }) as never),
    incidentRules: jest
      .spyOn(IncidentOnCallRuleService, "findBy")
      .mockResolvedValue(
        rulesOf(IncidentOnCallRule, project.incidentRules || []) as never,
      ),
    alertRules: jest
      .spyOn(AlertOnCallRuleService, "findBy")
      .mockResolvedValue(
        rulesOf(AlertOnCallRule, project.alertRules || []) as never,
      ),
  };
}

// A project with this many policies in service, and rules that run one.
function stubPagingCounts(counts: {
  policies: number;
  incidentRules: number;
  alertRules: number;
}): void {
  servePaging({
    policies: new Array<boolean>(counts.policies).fill(false),
    incidentRules: new Array<Array<boolean>>(counts.incidentRules).fill([
      false,
    ]),
    alertRules: new Array<Array<boolean>>(counts.alertRules).fill([false]),
  });
}

function readiness(data: {
  status?: ReadinessStatus;
  verified?: Array<string>;
}): UserReadiness {
  return {
    userId: USER_ID,
    userName: "Me",
    userEmail: "me@acme.example",
    status: data.status ?? ReadinessStatus.Ready,
    methods: (data.verified || []).map((methodType: string) => {
      return {
        methodId: ObjectID.generate(),
        methodType: methodType,
        maskedIdentifier: "•••",
        isVerified: true,
      };
    }),
    coverage: [],
    reasons: [],
    reachedVia: [],
    teams: [],
  };
}

/*
 * The project's members, Ana and the person asking. Each read gets what it
 * selects, as from the database: a member's user only when it asks for it.
 */
function stubMembers(): Spy {
  const memberships: Array<{ id: string; userId: ObjectID; user: User }> = [
    {
      id: ANA_MEMBERSHIP_ID,
      userId: new ObjectID(ANA_ID),
      user: model(User, {
        _id: ANA_ID,
        name: new Name("Ana Lopez"),
        email: new Email("ana@acme.example"),
      }),
    },
    {
      id: MY_MEMBERSHIP_ID,
      userId: USER_ID,
      user: model(User, {
        _id: USER_ID.toString(),
        name: new Name("Me Myself"),
        email: new Email("me@acme.example"),
      }),
    },
  ];

  return jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((async (args: {
      select: JSONObject;
    }): Promise<Array<TeamMember>> => {
      return memberships.map(
        (membership: { id: string; userId: ObjectID; user: User }) => {
          return model(TeamMember, {
            _id: membership.id,
            userId: membership.userId,
            ...(args.select["user"] ? { user: membership.user } : {}),
          });
        },
      );
    }) as never);
}

function stubTeams(): Spy {
  return jest
    .spyOn(TeamService, "findBy")
    .mockResolvedValue([
      model(Team, { _id: TEAM_ID, name: "Platform" }),
    ] as never);
}

// The project's plan has room for the status pages a plan publishes (#7250).
function planAllowsStatusPages(): Spy {
  return jest
    .spyOn(StatusPageService, "getCreateRefusal")
    .mockResolvedValue(null as never);
}

// The project's Website and API monitors, read as the person: none (#7292).
function noMonitorChecksAnAddress(): Spy {
  return jest.spyOn(MonitorService, "findBy").mockResolvedValue([] as never);
}

function monitorsNamed(names: Array<{ id: string; name: string }>): Spy {
  return jest.spyOn(MonitorService, "findBy").mockResolvedValue(
    names.map((each: { id: string; name: string }) => {
      return model(Monitor, { _id: each.id, name: each.name });
    }) as never,
  );
}

function line(sentences: Array<AIActionSentence> | undefined): string {
  return actionLineText(sentences) || "";
}

describe("the setup actions, together", () => {
  test("are the toolbox's mutations, each a setup action with its check, under the names the Dashboard knows them by", () => {
    expect(
      SETUP_TOOLS.map((tool: ObservabilityTool) => {
        return tool.name;
      }),
    ).toEqual([...SETUP_TOOL_NAMES]);
    expect([...SETUP_TOOL_NAMES]).toEqual([...AI_SETUP_ACTION_TOOL_NAMES]);
    expect(SETUP_TOOL_NAMES).toEqual([
      "invite_people",
      SET_UP_PAGING_TOOL_NAME,
      "add_to_on_call_policy",
      "set_how_to_reach_me",
      SET_UP_WEBSITE_MONITORING_TOOL_NAME,
      "set_up_service_monitor",
      PUBLISH_STATUS_PAGE_TOOL_NAME,
      ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
    ]);
    // In the order a plan runs them, as analytics names its parts.
    expect(
      SETUP_TOOLS.map((tool: ObservabilityTool): number => {
        return tool.setupAction!.planOrder;
      }),
    ).toEqual(
      [...SETUP_TOOLS]
        .map((tool: ObservabilityTool): number => {
          return tool.setupAction!.planOrder;
        })
        .sort((a: number, b: number): number => {
          return a - b;
        }),
    );

    for (const tool of SETUP_TOOLS) {
      expect(AIToolbox.getToolByName(tool.name)).toBe(tool);
      expect(tool.isMutation).toBe(true);
      expect(tool.setupAction).toBeDefined();
      expect(typeof tool.checkBeforeApproval).toBe("function");
      expect(typeof tool.prepareMutation).toBe("function");
      expect(AIToolbox.isSetupAction(tool.name)).toBe(true);
    }
  });

  test("run in their plan's order: who is paged, what is checked, where it is shown", () => {
    expect(SETUP_PLAN_ORDER.paging).toBeLessThan(
      SETUP_PLAN_ORDER.websiteMonitoring,
    );
    expect(SETUP_PLAN_ORDER.websiteMonitoring).toBeLessThan(
      SETUP_PLAN_ORDER.statusPage,
    );
    expect(SETUP_PLAN_ORDER.statusPage).toBeLessThan(
      SETUP_PLAN_ORDER.statusPageMonitors,
    );
    expect(AIToolbox.getSetupPlanOrder("set_up_paging")).toBe(
      SETUP_PLAN_ORDER.paging,
    );
    expect(AIToolbox.getSetupPlanOrder("create_incident")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(AIToolbox.isSetupAction("create_incident")).toBe(false);
    expect(AIToolbox.isSetupAction("who_is_told")).toBe(false);
  });
});

describe("reading the arguments", () => {
  test("reads how often to check as Create Monitor's nearest interval, five minutes by default", () => {
    expect(readCheckEveryMinutes({})).toBe(5);
    expect(readCheckEveryMinutes({ checkEveryMinutes: 1 })).toBe(1);
    expect(readCheckEveryMinutes({ checkEveryMinutes: "2" })).toBe(2);
    expect(readCheckEveryMinutes({ checkEveryMinutes: 7 })).toBe(5);
    expect(readCheckEveryMinutes({ checkEveryMinutes: 12 })).toBe(10);
    expect(readCheckEveryMinutes({ checkEveryMinutes: 90 })).toBe(60);
    expect(readCheckEveryMinutes({ checkEveryMinutes: 0 })).toBe(1);
    expect(readCheckEveryMinutes({ checkEveryMinutes: "soon" })).toBe(5);

    expect(getMonitoringIntervalForMinutes(1)).toBe("* * * * *");
    expect(getMonitoringIntervalForMinutes(5)).toBe(
      GUIDED_SETUP_MONITORING_INTERVAL,
    );
    expect(getMonitoringIntervalForMinutes(60)).toBe("0 * * * *");
    expect(getMonitoringIntervalForMinutes(7)).toBe(
      GUIDED_SETUP_MONITORING_INTERVAL,
    );
  });

  test("reads names trimmed, each once without regard to case, at most 25", () => {
    expect(
      readNames(
        { names: [" Ana ", "ana", "Bob", "", 7] } as JSONObject,
        "names",
      ),
    ).toEqual(["Ana", "Bob"]);

    const many: Array<string> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): string => {
        return `m${index}`;
      },
    );
    expect(readNames({ names: many }, "names")).toHaveLength(25);
    expect(readNames({}, "names")).toEqual([]);
  });

  test("reads how the person asked to be reached, each once, and nothing else", () => {
    expect(
      readReachMethods({ reachMeBy: ["SMS", "sms", "call", "pigeon", "push"] }),
    ).toEqual([
      SetupReachMethod.SMS,
      SetupReachMethod.Call,
      SetupReachMethod.Push,
    ]);
    expect(readReachMethods({})).toEqual([]);
  });

  test("names the monitors a plan sets up by the name each will have", () => {
    expect(
      getMonitorNamesSetUpInPlan([
        {
          name: "set_up_website_monitoring",
          arguments: { address: "https://www.example.com/" },
        },
        { name: "set_up_website_monitoring", arguments: { address: "nope" } },
        {
          name: "set_up_website_monitoring",
          arguments: { address: "example.com" },
        },
        { name: "publish_status_page", arguments: { monitors: ["x.com"] } },
      ]),
    ).toEqual(["example.com"]);
    expect(getMonitorNamesSetUpInPlan(undefined)).toEqual([]);
  });

  test("reads who a prepared paging call pages, ids only where they are ids, addresses only where they are addresses", () => {
    expect(
      readPreparedResponders({
        userIds: [USER_ID.toString(), "not-an-id"],
        teamIds: [TEAM_ID],
        otherPeople: ["Ana Lopez"],
        pagedTeams: ["Platform"],
        invitedEmails: ["Bo@Acme.Example", "not an address"],
      }),
    ).toEqual({
      userIds: [USER_ID.toString()],
      teamIds: [TEAM_ID],
      otherPeople: ["Ana Lopez"],
      pagedTeams: ["Platform"],
      invitedEmails: ["bo@acme.example"],
    });
  });
});

describe("set_up_website_monitoring", () => {
  // No monitor of the project checks the address yet (#7292).
  beforeEach(() => {
    noMonitorChecksAnAddress();
  });

  test("its card is titled by the address the person knows", () => {
    expect(
      actionTitleText(
        SetUpWebsiteMonitoringTool.buildActionTitle!({
          address: "https://www.example.com/",
        }),
      ),
    ).toBe("Set up monitoring for example.com");
    expect(
      actionTitleText(SetUpWebsiteMonitoringTool.buildActionTitle!({})),
    ).toBe("Set up monitoring for a website");
  });

  test("the card says what is checked, how often, from where, what happens when it goes down, and who is emailed", async () => {
    stubSeeds();
    stubLocations({ global: 2 });

    const prepared: PreparedMutation =
      await SetUpWebsiteMonitoringTool.prepareMutation!(
        { address: "example.com", checkEveryMinutes: 1 },
        ctx,
      );

    expect(prepared.arguments).toEqual({
      address: "example.com",
      checkEveryMinutes: 1,
      isApi: false,
    });
    expect(line(prepared.description)).toBe(
      "A website monitor checks https://example.com every minute. It is checked from 2 locations. If it does not answer, or answers with an error, OneUptime opens an incident (Critical Incident). A status change needs both connected probes to agree. You own this monitor, so you are emailed when its status changes.",
    );
    expect(prepared.describedArguments).toEqual([
      "address",
      "isApi",
      "checkEveryMinutes",
    ]);

    for (const sentence of prepared.description || []) {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
    }
  });

  /*
   * A probe-based monitor's status changes only when its probes agree, and
   * a new monitor's minimum is not set: every location must find the site
   * down. The card said an incident opens when it does not answer, so the
   * person expected one failing region to open one (#8245).
   */
  test.each<[number, Array<string>]>([
    [
      1,
      [
        "A website monitor checks https://example.com every 5 minutes.",
        "It is checked from 1 location.",
        "If it does not answer, or answers with an error, OneUptime opens an incident (Critical Incident).",
        "You own this monitor, so you are emailed when its status changes.",
      ],
    ],
    [
      2,
      [
        "A website monitor checks https://example.com every 5 minutes.",
        "It is checked from 2 locations.",
        "If it does not answer, or answers with an error, OneUptime opens an incident (Critical Incident).",
        "A status change needs both connected probes to agree.",
        "You own this monitor, so you are emailed when its status changes.",
      ],
    ],
    [
      3,
      [
        "A website monitor checks https://example.com every 5 minutes.",
        "It is checked from 3 locations.",
        "If it does not answer, or answers with an error, OneUptime opens an incident (Critical Incident).",
        "A status change needs all 3 connected probes to agree.",
        "You own this monitor, so you are emailed when its status changes.",
      ],
    ],
  ])(
    "checked from %i location(s), the card says how many must agree before an incident opens",
    async (locations: number, sentences: Array<string>) => {
      stubSeeds();
      stubLocations({ global: locations });

      const prepared: PreparedMutation =
        await SetUpWebsiteMonitoringTool.prepareMutation!(
          { address: "example.com" },
          ctx,
        );

      expect(
        (prepared.description || []).map((sentence: AIActionSentence) => {
          return actionTitleText(sentence);
        }),
      ).toEqual(sentences);

      for (const sentence of prepared.description || []) {
        expect(isKnownAIActionSentence(sentence)).toBe(true);
      }
    },
  );

  test("the agreement line is the probes card's own sentence, its counts figures", () => {
    expect(
      describeProbeAgreementForPerson({
        minimumProbeAgreement: null,
        locationCount: 3,
      }),
    ).toEqual({
      template: AI_ACTION_LINES.probeAgreementAll,
      values: { count: { figure: 3 } },
    });
    expect(
      describeProbeAgreementForPerson({
        minimumProbeAgreement: undefined,
        locationCount: 2,
      }),
    ).toEqual({ template: AI_ACTION_LINES.probeAgreementBoth });
    // A minimum below all of them: how many of how many.
    expect(
      describeProbeAgreementForPerson({
        minimumProbeAgreement: 2,
        locationCount: 4,
      }),
    ).toEqual({
      template: AI_ACTION_LINES.probeAgreementSome,
      values: { required: { figure: 2 }, count: { figure: 4 } },
    });
    // Nothing to agree on: one location, none, or a minimum of one.
    expect(
      describeProbeAgreementForPerson({
        minimumProbeAgreement: null,
        locationCount: 1,
      }),
    ).toBeNull();
    expect(
      describeProbeAgreementForPerson({
        minimumProbeAgreement: null,
        locationCount: 0,
      }),
    ).toBeNull();
    expect(
      describeProbeAgreementForPerson({
        minimumProbeAgreement: 1,
        locationCount: 3,
      }),
    ).toBeNull();
    // The keys the probes card is worded by, one copy.
    expect([
      AI_ACTION_LINES.probeAgreementSome,
      AI_ACTION_LINES.probeAgreementBoth,
      AI_ACTION_LINES.probeAgreementAll,
    ]).toEqual([
      PROBE_AGREEMENT_SENTENCES.some,
      PROBE_AGREEMENT_SENTENCES.both,
      PROBE_AGREEMENT_SENTENCES.all,
    ]);
  });

  test("a monitor that goes Offline rather than opening an incident says the agreement too", () => {
    expect(
      describeWebsiteMonitoringForPerson({
        address: {
          url: "https://example.com",
          host: "example.com",
          monitorName: "example.com",
        },
        isApi: false,
        minutes: 5,
        locationCount: 4,
        incidentSeverityName: null,
      }).map((sentence: AIActionSentence) => {
        return actionTitleText(sentence);
      }),
    ).toEqual([
      "A website monitor checks https://example.com every 5 minutes.",
      "It is checked from 4 locations.",
      "If it does not answer, or answers with an error, its status changes to Offline.",
      "A status change needs all 4 connected probes to agree.",
      "You own this monitor, so you are emailed when its status changes.",
    ]);
  });

  test.each(["de", "ar", "fa"])(
    "in %s, the agreement line reads as the probes card reads it, its count in the reader's digits",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const sentence: AIActionSentence = describeProbeAgreementForPerson({
        minimumProbeAgreement: null,
        locationCount: 3,
      })!;
      const worded: string = describeAIActionSentence(sentence, translator);

      expect(worded).toBe(
        getProbeAgreementSentence({
          minimumProbeAgreement: null,
          activeProbeCount: 3,
          translator,
        }),
      );
      expect(worded).not.toContain("connected probes");
      expect(worded).toContain(translator.formatNumber(3));
    },
  );

  test("an API is said to be one, every five minutes by default", async () => {
    stubSeeds();
    stubLocations({ global: 0, project: 1 });

    const prepared: PreparedMutation =
      await SetUpWebsiteMonitoringTool.prepareMutation!(
        { address: "https://api.example.com/health", isApi: true },
        ctx,
      );

    expect(prepared.arguments["checkEveryMinutes"]).toBe(5);
    expect(line(prepared.description)).toContain(
      "An API monitor checks https://api.example.com/health every 5 minutes. It is checked from 1 location.",
    );
  });

  test("a project that adds no probe to new monitors is told nothing would check it", async () => {
    stubSeeds();
    stubLocations({ global: 3, project: 0, skipGlobal: true });

    const prepared: PreparedMutation =
      await SetUpWebsiteMonitoringTool.prepareMutation!(
        { address: "example.com" },
        ctx,
      );

    expect(line(prepared.description)).toContain(
      "No location checks example.com yet. Probes are added under Monitors > Settings > Probes.",
    );
  });

  test("what cannot be read is left unsaid, never guessed", () => {
    expect(
      describeWebsiteMonitoringForPerson({
        address: {
          url: "https://example.com",
          host: "example.com",
          monitorName: "example.com",
        },
        isApi: false,
        minutes: 5,
        locationCount: null,
        incidentSeverityName: null,
      }).map((sentence: AIActionSentence) => {
        return actionTitleText(sentence);
      }),
    ).toEqual([
      "A website monitor checks https://example.com every 5 minutes.",
      "If it does not answer, or answers with an error, its status changes to Offline.",
      "You own this monitor, so you are emailed when its status changes.",
    ]);
  });

  test("an address that is not one is not proposed, and says what to ask for", async () => {
    const refused: SetupActionRefusal | null =
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "my website" },
        ctx,
      );

    expect(refused?.toldModel).toContain(
      "That is not a web address a website monitor can check",
    );
  });

  test("a project without its statuses or severities is not proposed", async () => {
    stubSeeds({ missing: true });

    const refused: SetupActionRefusal | null =
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        ctx,
      );

    expect(refused?.toldModel).toContain(
      "missing its monitor statuses or severities",
    );
  });

  test("a project whose plan has no room for the monitors its plan sets up is told the plan's own sentence, before any card", async () => {
    stubSeeds();
    payAsYouGoIsSetUp();
    const room: Spy = jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockResolvedValue(
        "This project has 4 active monitors and the Free plan allows 5, so it has room for 1 more, not 2. Upgrade the plan in Project Settings > Billing to add more." as never,
      );

    const refused: SetupActionRefusal | null =
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        {
          ...ctx,
          plannedCalls: [
            {
              name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
              arguments: { address: "example.com" },
            },
            {
              name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
              arguments: { address: "api.example.com", isApi: true },
            },
            // Not an address: never made, so never counted.
            {
              name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
              arguments: { address: "my website" },
            },
            { name: SET_UP_PAGING_TOOL_NAME, arguments: {} },
          ],
        },
      );

    // Asked for every monitor the plan sets up, not only the one checked.
    expect(room).toHaveBeenCalledWith({ projectId: PROJECT_ID, adding: 2 });
    expect(refused?.toldModel).toContain(
      "so it has room for 1 more, not 2. Upgrade the plan in Project Settings > Billing to add more.",
    );
    expect(refused?.refusal).toBe(AIToolRefusal.Plan);
  });

  test("a project with no payment method for paid monitoring on OneUptime Cloud is told to add one, before any card", async () => {
    stubSeeds();
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(false as never);
    const room: Spy = jest.spyOn(ActiveMonitorLimit, "getRefusal");

    const refused: SetupActionRefusal | null =
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        ctx,
      );

    expect(refused?.toldModel).toContain(
      PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
    );
    expect(refused?.refusal).toBe(AIToolRefusal.Plan);
    expect(room).not.toHaveBeenCalled();
  });

  test("room in the plan, or an install with no plans, lets the card show", async () => {
    stubSeeds();

    // This install bills nothing: no plan, so no limit.
    expect(
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        ctx,
      ),
    ).toBeNull();

    payAsYouGoIsSetUp();
    const room: Spy = jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockResolvedValue(null as never);

    expect(
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        ctx,
      ),
    ).toBeNull();
    // Checked on its own, the monitor is one.
    expect(room).toHaveBeenCalledWith({ projectId: PROJECT_ID, adding: 1 });
    expect(countMonitorsSetUpInPlan(undefined)).toBe(1);
  });

  test("a plan that cannot be read lets the card show: running it says why", async () => {
    stubSeeds();
    payAsYouGoIsSetUp();
    const room: Spy = jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockRejectedValue(new Error("down") as never);

    expect(
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        ctx,
      ),
    ).toBeNull();
    expect(room).toHaveBeenCalled();
  });

  test("a check that cannot read the project lets the card show", async () => {
    jest
      .spyOn(MonitorStatusService, "findBy")
      .mockRejectedValue(new Error("down") as never);

    expect(
      await SetUpWebsiteMonitoringTool.checkBeforeApproval!(
        { address: "example.com" },
        ctx,
      ),
    ).toBeNull();
  });

  test("approved, it creates the guided setup's monitor as the person, and its card links it and offers a test page to them", async () => {
    stubSeeds();
    stubLocations();
    const create: Spy = stubMonitorCreate();
    jest
      .spyOn(MonitorProbeService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult =
      await SetUpWebsiteMonitoringTool.execute(
        { address: "example.com", checkEveryMinutes: 1, isApi: false },
        ctx,
      );

    expect(create).toHaveBeenCalledTimes(1);
    const args: { data: Monitor; props: unknown } = create.mock
      .calls[0]![0] as { data: Monitor; props: unknown };
    expect(args.props).toBe(ctx.props);
    expect(args.data.name).toBe("example.com");
    expect(args.data.monitorType).toBe(MonitorType.Website);
    expect(args.data.monitoringInterval).toBe("* * * * *");
    expect(args.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    const step: MonitorStep | undefined =
      args.data.monitorSteps?.data?.monitorStepsInstanceArray[0];
    // The address as Create Monitor stores it (Types/API/URL).
    expect(step?.data?.monitorDestination?.toString()).toBe(
      "https://example.com/",
    );
    expect(
      args.data.monitorSteps?.data?.defaultMonitorStatusId?.toString(),
    ).toBe(OPERATIONAL_ID.toString());

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: MONITOR_ID },
    });
    expect(result.dataForLlm).toContain(
      'Created the Website monitor "example.com", checking https://example.com every minute from 2 locations.',
    );
    expect(result.dataForLlm).toContain(
      "opens an incident (Critical Incident). A status change needs both connected probes to agree. The person owns it",
    );
    expect(result.dataForLlm).toContain("never say one was sent");
    expect(result.widget?.data.testPage).toEqual({ kind: "self" });
    expect(result.widget?.data.link).toEqual(result.citationTarget);
    expect(isKnownAIActionCardWords(result.widget?.data.words)).toBe(true);
    expect(describeAIActionCardWords(result.widget!.data.words!)).toEqual({
      kind: AI_ACTION_CARD_KINDS.monitor,
      line: "Checked every minute",
      facts: [{ label: "Address", value: "https://example.com" }],
    });
  });

  test("an API monitor is made as one", async () => {
    stubSeeds();
    stubLocations();
    const create: Spy = stubMonitorCreate();
    jest
      .spyOn(MonitorProbeService, "countBy")
      .mockRejectedValue(new Error("no") as never);

    const result: ToolExecutionResult =
      await SetUpWebsiteMonitoringTool.execute(
        { address: "api.example.com/v1", isApi: true },
        ctx,
      );

    const data: Monitor = (create.mock.calls[0]![0] as { data: Monitor }).data;
    expect(data.monitorType).toBe(MonitorType.API);
    expect(data.name).toBe("api.example.com/v1");
    expect(data.monitoringInterval).toBe(GUIDED_SETUP_MONITORING_INTERVAL);
    // How many locations could not be read: left unsaid.
    expect(result.dataForLlm).toContain(
      "checking https://api.example.com/v1 every 5 minutes. ",
    );
  });

  /*
   * "You own this monitor, so you are emailed when its status changes" was
   * said to a master admin, whom the server never makes the owner of what
   * they create (#7409): the action makes them one, as the guided setup
   * does.
   */
  test("approved by a master admin, it makes them the monitor's owner, quietly, as the card says", async () => {
    stubSeeds();
    stubLocations();
    stubMonitorCreate();
    jest
      .spyOn(MonitorProbeService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    const addOwners: Spy = jest
      .spyOn(MonitorService, "addOwners")
      .mockResolvedValue(undefined as never);
    const asMasterAdmin: ToolContext = {
      ...ctx,
      props: { ...ctx.props, isMasterAdmin: true },
    };

    const result: ToolExecutionResult =
      await SetUpWebsiteMonitoringTool.execute(
        { address: "example.com" },
        asMasterAdmin,
      );

    expect(addOwners).toHaveBeenCalledTimes(1);
    const [
      projectId,
      monitorId,
      userIds,
      teamIds,
      notifyOwners,
      props,
    ]: Array<unknown> = addOwners.mock.calls[0] as Array<unknown>;

    expect(String(projectId)).toBe(PROJECT_ID.toString());
    expect(String(monitorId)).toBe(MONITOR_ID);
    expect((userIds as Array<ObjectID>).map(String)).toEqual([
      USER_ID.toString(),
    ]);
    expect(teamIds).toEqual([]);
    // Their own row: nobody is told they were made an owner.
    expect(notifyOwners).toBe(false);
    expect(props).toBe(asMasterAdmin.props);
    expect(result.dataForLlm).toContain(
      "The person owns it, so they are emailed when its status changes.",
    );
  });

  test("approved by anyone else, the server made them the owner already: nothing more is added", async () => {
    stubSeeds();
    stubLocations();
    stubMonitorCreate();
    jest
      .spyOn(MonitorProbeService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    const addOwners: Spy = jest
      .spyOn(MonitorService, "addOwners")
      .mockResolvedValue(undefined as never);

    await SetUpWebsiteMonitoringTool.execute({ address: "example.com" }, ctx);

    expect(addOwners).not.toHaveBeenCalled();
  });

  test("a master admin who cannot be made the owner still gets the monitor", async () => {
    stubSeeds();
    stubLocations();
    const create: Spy = stubMonitorCreate();
    jest
      .spyOn(MonitorProbeService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    jest
      .spyOn(MonitorService, "addOwners")
      .mockRejectedValue(new Error("not a member") as never);

    const result: ToolExecutionResult =
      await SetUpWebsiteMonitoringTool.execute(
        { address: "example.com" },
        { ...ctx, props: { ...ctx.props, isMasterAdmin: true } },
      );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: MONITOR_ID },
    });
  });

  test("approved with an address that is not one, or without the project's statuses, it makes nothing and says why", async () => {
    const create: Spy = stubMonitorCreate();

    await expect(
      SetUpWebsiteMonitoringTool.execute({ address: "mailto:x" }, ctx),
    ).rejects.toThrow(BadDataException);

    stubSeeds({ missing: true });

    await expect(
      SetUpWebsiteMonitoringTool.execute({ address: "example.com" }, ctx),
    ).rejects.toThrow("missing its monitor statuses or severities");
    expect(create).not.toHaveBeenCalled();
  });
});

/*
 * #7247: the monitor's criteria, and the incident and alert they open, are
 * named in the language the person reads the Dashboard in - the one the
 * request that approved it said, else the one saved on their account, else
 * English - worded as the Dashboard words them for the guided setup.
 */
describe("set_up_website_monitoring, in the person's language", () => {
  beforeEach(() => {
    noMonitorChecksAnAddress();
  });

  // Each criteria's name and description, and what it opens, as written.
  const criteriaWords: (monitor: Monitor) => Array<string> = (
    monitor: Monitor,
  ): Array<string> => {
    const words: Array<string> = [];

    for (const step of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      for (const criteria of step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray || []) {
        words.push(criteria.data!.name, criteria.data!.description);

        for (const opened of [
          ...(criteria.data!.incidents || []),
          ...(criteria.data!.alerts || []),
        ]) {
          words.push(opened.title, opened.description);
        }
      }
    }

    return words;
  };

  // The words Create Monitor's builders write for example.com with no reader.
  const englishWords: () => Array<string> = (): Array<string> => {
    return criteriaWords(
      buildWebsiteMonitor({
        address: parseWebsiteAddress("example.com")!,
        isApi: false,
        seeds: {
          operationalStatusId: OPERATIONAL_ID,
          offlineStatusId: OFFLINE_ID,
          incidentSeverityId: INCIDENT_SEVERITY_ID,
          alertSeverityId: ALERT_SEVERITY_ID,
        },
        monitoringInterval: GUIDED_SETUP_MONITORING_INTERVAL,
      }),
    );
  };

  const setUp: (context: ToolContext) => Promise<Monitor> = async (
    context: ToolContext,
  ): Promise<Monitor> => {
    stubSeeds();
    stubLocations();
    const create: Spy = stubMonitorCreate();
    jest
      .spyOn(MonitorProbeService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    await SetUpWebsiteMonitoringTool.execute(
      { address: "example.com", isApi: false },
      context,
    );

    return (create.mock.calls[0]![0] as { data: Monitor }).data;
  };

  test("reads the language the Dashboard sent before the one saved on the account, and only a code OneUptime writes in", async () => {
    const saved: Spy = jest
      .spyOn(UserLanguage, "getLanguage")
      .mockResolvedValue("fr" as never);

    expect(await readSetupRecordsLanguage({ ...ctx, language: "de" })).toBe(
      "de",
    );
    expect(await readSetupRecordsLanguage({ ...ctx, language: "zh-TW" })).toBe(
      "zh-TW",
    );
    expect(await readSetupRecordsLanguage({ ...ctx, language: "fa" })).toBe(
      "fa",
    );
    expect(saved).not.toHaveBeenCalled();

    // Anything else is no language at all: the saved one is read.
    for (const sent of [
      undefined,
      "",
      "de-AT",
      "DE",
      " de",
      "xx",
      "<script>de</script>",
      "de; drop table",
      42,
      ["de"],
      { language: "de" },
    ]) {
      expect([
        sent,
        await readSetupRecordsLanguage({ ...ctx, language: sent as never }),
      ]).toEqual([sent, "fr"]);
    }

    expect(saved).toHaveBeenCalledWith(USER_ID);
  });

  test("with no language sent and none saved, or a saved one that cannot be read, it is English", async () => {
    const find: Spy = jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(model(User, { language: null }) as never);

    expect(await readSetupRecordsLanguage(ctx)).toBe("en");
    // The person's own language, read as OneUptime: nothing else of theirs.
    expect(find).toHaveBeenCalledWith({
      id: USER_ID,
      select: { language: true },
      props: { isRoot: true },
    });

    find.mockResolvedValue(model(User, { language: "ja" }) as never);
    expect(await readSetupRecordsLanguage(ctx)).toBe("ja");

    find.mockResolvedValue(model(User, { language: "tlh" }) as never);
    expect(await readSetupRecordsLanguage(ctx)).toBe("en");

    find.mockRejectedValue(new Error("The database is slow") as never);
    expect(await readSetupRecordsLanguage(ctx)).toBe("en");

    // No person at all: English, nothing read.
    find.mockClear();
    expect(
      await readSetupRecordsLanguage({ projectId: PROJECT_ID, props: {} }),
    ).toBe("en");
    expect(find).not.toHaveBeenCalled();
  });

  test("approved by a person reading the Dashboard in German, the criteria and the incident and alert they open are German, as the Dashboard words them", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);

    const monitor: Monitor = await setUp({ ...ctx, language: "de" });
    const words: Array<string> = criteriaWords(monitor);
    const english: Array<string> = englishWords();
    const german: Translator = dashboardTranslator("de");

    expect(words).toHaveLength(english.length);
    expect(words[0]).toBe(
      german.translateTemplate("Check if {{monitorName}} is offline", {
        monitorName: "example.com",
      }),
    );
    expect(words).toContain(
      german.translateTemplate("{{monitorName}} is offline", {
        monitorName: "example.com",
      }),
    );
    expect(words).toContain(
      german.translateTemplate("Check if {{monitorName}} is online", {
        monitorName: "example.com",
      }),
    );

    words.forEach((word: string, index: number) => {
      expect([index, word]).not.toEqual([index, english[index]]);
      expect(word).toContain("example.com");
    });

    // The rest of the monitor is the one English makes.
    expect(monitor.name).toBe("example.com");
    expect(monitor.monitorType).toBe(MonitorType.Website);
  });

  test.each(["ar", "fa"])(
    "approved by a person reading it in %s, the criteria are in it, the address whole and no invisible marks in the record",
    async (language: string) => {
      jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);

      const words: Array<string> = criteriaWords(
        await setUp({ ...ctx, language: language }),
      );

      expect(words[0]).toBe(
        dashboardTranslator(language).translateTemplate(
          "Check if {{monitorName}} is offline",
          { monitorName: "example.com" },
        ),
      );

      for (const word of words) {
        expect(word).toContain("example.com");
        expect(word).not.toContain(FIRST_STRONG_ISOLATE);
        expect(word).not.toContain(POP_DIRECTIONAL_ISOLATE);
      }
    },
  );

  test("approved with a language OneUptime does not write in, and none saved, the monitor reads exactly as before: English, word for word", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);

    expect(criteriaWords(await setUp({ ...ctx, language: "xx" }))).toEqual(
      englishWords(),
    );

    jest.restoreAllMocks();

    expect(criteriaWords(await setUp({ ...ctx, language: "en" }))).toEqual(
      englishWords(),
    );
  });

  test("approved with no language sent, the person's saved one words it", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("ja" as never);

    const words: Array<string> = criteriaWords(await setUp(ctx));

    expect(words[0]).toBe(
      dashboardTranslator("ja").translateTemplate(
        "Check if {{monitorName}} is offline",
        { monitorName: "example.com" },
      ),
    );
  });

  test("the card and what the model is told are as before: the card is worded by the Dashboard, the model reads English", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
    stubSeeds();
    stubLocations();
    stubMonitorCreate();
    jest
      .spyOn(MonitorProbeService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult =
      await SetUpWebsiteMonitoringTool.execute(
        { address: "example.com", isApi: false },
        { ...ctx, language: "de" },
      );

    expect(result.dataForLlm).toContain(
      'Created the Website monitor "example.com"',
    );
    expect(describeAIActionCardWords(result.widget!.data.words!)).toEqual({
      kind: AI_ACTION_CARD_KINDS.monitor,
      line: "Checked every 5 minutes",
      facts: [{ label: "Address", value: "https://example.com" }],
    });
  });
});

describe("set_up_paging", () => {
  test("its card names the policy the guided setup makes", () => {
    expect(actionTitleText(SetUpPagingTool.buildActionTitle!({}))).toBe(
      `Create on-call policy "${GUIDED_SETUP_POLICY_NAME}"`,
    );
  });

  test("it pages you by default, and says nothing more when you can be reached", async () => {
    jest
      .spyOn(OnCallReadinessService, "getReadinessForUser")
      .mockResolvedValue(
        readiness({ verified: [ReadinessMethodType.Email] }) as never,
      );

    const prepared: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      {},
      ctx,
    );

    expect(line(prepared.description)).toBe(
      "Pages you for every new incident and alert.",
    );
    expect(prepared.arguments).toEqual({
      includeMe: true,
      userIds: [USER_ID.toString()],
      teamIds: [],
      otherPeople: [],
      pagedTeams: [],
    });
    expect(prepared.describedArguments).toEqual(
      expect.arrayContaining(["userIds", "teamIds", "reachMeBy"]),
    );
  });

  test("it names the members and teams it pages, matched by name or email, and says who it could not find", async () => {
    const members: Spy = stubMembers();
    const teams: Spy = stubTeams();
    jest
      .spyOn(OnCallReadinessService, "getReadinessForUser")
      .mockResolvedValue(readiness({}) as never);

    const prepared: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      {
        alsoPage: ["ana@acme.example", "Zed"],
        teams: ["platform", "Nobody"],
      },
      ctx,
    );

    expect(line(prepared.description)).toBe(
      "Pages you and Ana Lopez, the Platform team for every new incident and alert. Not in this project, so not paged: Zed, Nobody.",
    );
    expect(prepared.arguments["userIds"]).toEqual([USER_ID.toString(), ANA_ID]);
    expect(prepared.arguments["teamIds"]).toEqual([TEAM_ID]);
    expect(prepared.arguments["otherPeople"]).toEqual(["Ana Lopez"]);
    expect(prepared.arguments["pagedTeams"]).toEqual(["Platform"]);

    // Read as the person.
    expect((members.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
    expect((teams.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
    /*
     * The person's read selects only what every reader of a membership may
     * read; who each member is comes after, as OneUptime, for the members
     * that read found, in this project (CallerReadsReadableColumns).
     */
    expect((members.mock.calls[0]![0] as { select: unknown }).select).toEqual({
      _id: true,
      userId: true,
    });
    const whoTheyAre: {
      query: { _id: unknown; projectId: unknown };
      props: unknown;
    } = members.mock.calls[1]![0] as never;
    const theirIds: { _objectLiteralParameters: JSONObject } = whoTheyAre.query
      ._id as never;
    expect(whoTheyAre.props).toEqual({ isRoot: true });
    expect(whoTheyAre.query.projectId).toBe(PROJECT_ID);
    expect(Object.values(theirIds._objectLiteralParameters)).toEqual([
      [ANA_MEMBERSHIP_ID, MY_MEMBERSHIP_ID],
    ]);
    expect(members).toHaveBeenCalledTimes(2);
  });

  test("naming yourself is you, once; paging others only leaves you out", async () => {
    stubMembers();
    jest
      .spyOn(OnCallReadinessService, "getReadinessForUser")
      .mockResolvedValue(readiness({}) as never);

    const withMe: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      { includeMe: false, alsoPage: ["Me Myself"] },
      ctx,
    );
    expect(withMe.arguments["userIds"]).toEqual([USER_ID.toString()]);
    expect(line(withMe.description)).toBe(
      "Pages you for every new incident and alert.",
    );

    const others: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      { includeMe: false, alsoPage: ["Ana Lopez"] },
      ctx,
    );
    expect(others.arguments["userIds"]).toEqual([ANA_ID]);
    expect(line(others.description)).toBe(
      "Pages Ana Lopez for every new incident and alert.",
    );
  });

  test("what is missing for you to be reached the way you asked is on the card", async () => {
    jest
      .spyOn(OnCallReadinessService, "getReadinessForUser")
      .mockResolvedValue(
        readiness({ verified: [ReadinessMethodType.Email] }) as never,
      );

    const prepared: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      { reachMeBy: ["sms", "call", "push"] },
      ctx,
    );

    expect(line(prepared.description)).toBe(
      "Pages you for every new incident and alert. You have no verified phone number for texts yet. Add one in Notification Methods, and pages reach you by SMS too. You have no verified phone number for calls yet. Add one in Notification Methods, and pages can call you too. The mobile app is not set up for you yet. Set it up from Notification Methods to get push notifications.",
    );
  });

  test("a verified number says nothing; nothing at all reaching you is said", () => {
    expect(
      describeReachForPerson({
        asked: [SetupReachMethod.SMS],
        readiness: readiness({ verified: [ReadinessMethodType.SMS] }),
      }),
    ).toEqual([]);
    expect(
      describeReachForPerson({
        asked: [],
        readiness: readiness({ status: ReadinessStatus.NotReachable }),
      }).map((sentence: AIActionSentence) => {
        return actionTitleText(sentence);
      }),
    ).toEqual([
      "Nothing reaches you yet. Add a notification method in Notification Methods.",
    ]);
    expect(
      describeReachForPerson({
        asked: [SetupReachMethod.SMS],
        readiness: null,
      }),
    ).toEqual([]);
  });

  test("a project that pages people already keeps its own policies and rules: nothing is proposed", async () => {
    stubPagingCounts({ policies: 1, incidentRules: 0, alertRules: 0 });

    const refused: SetupActionRefusal | null =
      await SetUpPagingTool.checkBeforeApproval!(
        { userIds: [USER_ID.toString()] },
        ctx,
      );

    expect(refused?.toldModel).toContain(
      "this project already pages people through its on-call policies and on-call rules (1 on-call policy, 0 on-call rules)",
    );
    expect(refused?.refusal).toBeUndefined();

    expect(
      pagesPeopleAlready({
        policyCount: 0,
        incidentRuleCount: 0,
        alertRuleCount: 1,
      }),
    ).toBe(true);
    expect(
      pagesPeopleAlready({
        policyCount: 0,
        incidentRuleCount: 0,
        alertRuleCount: 0,
      }),
    ).toBe(false);
  });

  test("a person who may not read the project's paging is told who can set it up", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockRejectedValue(new Error("not allowed") as never);

    const refused: SetupActionRefusal | null =
      await SetUpPagingTool.checkBeforeApproval!(
        { userIds: [USER_ID.toString()] },
        ctx,
      );

    expect(refused?.refusal).toBe(AIToolRefusal.Permission);
    expect(refused?.toldModel).toContain("a Project Admin can set up paging");
  });

  test("nobody to page is not proposed", async () => {
    stubPagingCounts({ policies: 0, incidentRules: 0, alertRules: 0 });

    const refused: SetupActionRefusal | null =
      await SetUpPagingTool.checkBeforeApproval!(
        { userIds: [], teamIds: [] },
        ctx,
      );

    expect(refused?.toldModel).toContain("nobody named is a member or a team");
    expect(
      await SetUpPagingTool.checkBeforeApproval!(
        { userIds: [USER_ID.toString()] },
        ctx,
      ),
    ).toBeNull();
  });

  test("approved, it creates the guided setup's policy as the person, paging who the card named for every new incident and alert", async () => {
    stubPagingCounts({ policies: 0, incidentRules: 0, alertRules: 0 });
    // No language sent, none saved: English, as it always was.
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
    const create: Spy = jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        const created: OnCallDutyPolicy = args.data;
        created._id = POLICY_ID;
        return created;
      }) as never);

    const result: ToolExecutionResult = await SetUpPagingTool.execute(
      {
        userIds: [USER_ID.toString(), ANA_ID],
        teamIds: [TEAM_ID],
        otherPeople: ["Ana Lopez"],
        pagedTeams: ["Platform"],
      },
      ctx,
    );

    const args: {
      data: OnCallDutyPolicy;
      miscDataProps: JSONObject;
      props: unknown;
    } = create.mock.calls[0]![0] as {
      data: OnCallDutyPolicy;
      miscDataProps: JSONObject;
      props: unknown;
    };
    expect(args.props).toBe(ctx.props);
    expect(args.data.name).toBe(GUIDED_SETUP_POLICY_NAME);
    expect(args.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(args.miscDataProps).toEqual({
      users: [USER_ID.toString(), ANA_ID],
      teams: [TEAM_ID],
      [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true,
      // The server words the two rules in the person's language (#7995).
      [EVERY_NEW_EVENT_RULES_LANGUAGE_KEY]: "en",
    });

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicyView,
      params: { onCallDutyPolicyId: POLICY_ID },
    });
    expect(result.widget?.data.testPage).toEqual({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: GUIDED_SETUP_POLICY_NAME,
    });
    expect(describeAIActionCardWords(result.widget!.data.words!).line).toBe(
      "Pages you and Ana Lopez, the Platform team for every new incident and alert",
    );
    expect(result.dataForLlm).toContain(
      "pages the person asking, Ana Lopez, the Platform team",
    );
    expect(result.dataForLlm).toContain(
      'find_dashboard_page "Notification Methods"',
    );
  });

  /*
   * #9742: a policy's name is one policy's. While another has the guided
   * setup's name - an archived one, or one the person may not see - the
   * policy is made numbered, as Duplicate numbers a copy, and the card, its
   * test page and the model's answer name it as it was made.
   */
  test("approved while another policy has its name, it makes the policy numbered and says it by that name", async () => {
    stubPagingCounts({ policies: 0, incidentRules: 0, alertRules: 0 });
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
    const tried: Array<string> = [];
    const create: Spy = jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        tried.push(args.data.name || "");

        if (tried.length === 1) {
          throw new BadDataException(
            getNameTakenRefusalText(
              ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
              args.data.name,
            ),
          );
        }

        const created: OnCallDutyPolicy = args.data;
        created._id = POLICY_ID;
        return created;
      }) as never);

    const result: ToolExecutionResult = await SetUpPagingTool.execute(
      { userIds: [USER_ID.toString()] },
      ctx,
    );

    expect(tried).toEqual([
      GUIDED_SETUP_POLICY_NAME,
      `${GUIDED_SETUP_POLICY_NAME} 2`,
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.widget?.data.testPage).toEqual({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: `${GUIDED_SETUP_POLICY_NAME} 2`,
    });
    expect(result.dataForLlm).toContain(
      `Created the on-call policy "${GUIDED_SETUP_POLICY_NAME} 2"`,
    );
  });

  test("approved, any other refusal of the policy is the person's to read, and nothing is tried again", async () => {
    stubPagingCounts({ policies: 0, incidentRules: 0, alertRules: 0 });
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
    const create: Spy = jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockRejectedValue(
        new BadDataException(
          "You do not have permission to create an on-call policy.",
        ) as never,
      );

    await expect(
      SetUpPagingTool.execute({ userIds: [USER_ID.toString()] }, ctx),
    ).rejects.toThrow(
      "You do not have permission to create an on-call policy.",
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  /*
   * #7995: the policy is named in the language the person reads the
   * Dashboard in, as the guided setup names it, and its create carries
   * that language so the server words its two rules in it. Its card, its
   * citation and its test page name it as it was made.
   */
  test.each(["de", "ar", "fa", "ja"])(
    "approved by a reader of %s, it names the policy in their language, and asks for its rules in it",
    async (language: string) => {
      stubPagingCounts({ policies: 0, incidentRules: 0, alertRules: 0 });
      const saved: Spy = jest
        .spyOn(UserLanguage, "getLanguage")
        .mockResolvedValue("en" as never);
      const create: Spy = jest
        .spyOn(OnCallDutyPolicyService, "create")
        .mockImplementation((async (args: {
          data: OnCallDutyPolicy;
        }): Promise<OnCallDutyPolicy> => {
          const created: OnCallDutyPolicy = args.data;
          created._id = POLICY_ID;
          return created;
        }) as never);

      const result: ToolExecutionResult = await SetUpPagingTool.execute(
        { userIds: [USER_ID.toString()], teamIds: [] },
        { ...ctx, language: language },
      );

      const args: { data: OnCallDutyPolicy; miscDataProps: JSONObject } = create
        .mock.calls[0]![0] as {
        data: OnCallDutyPolicy;
        miscDataProps: JSONObject;
      };
      const name: string = getFirstOnCallPolicyName(
        dashboardTranslator(language),
      );

      expect(name).not.toBe(GUIDED_SETUP_POLICY_NAME);
      expect(args.data.name).toBe(name);
      expect(args.miscDataProps[EVERY_NEW_EVENT_RULES_LANGUAGE_KEY]).toBe(
        language,
      );
      // The Dashboard's language decides: the saved one is not read.
      expect(saved).not.toHaveBeenCalled();
      expect(result.widget?.data.testPage).toEqual({
        kind: "policy",
        policyId: POLICY_ID,
        policyName: name,
      });
      expect(result.citationLabel).toBe(`Created on-call policy "${name}"`);
      expect(result.dataForLlm).toContain(
        `Created the on-call policy "${name}"`,
      );
    },
  );

  test("its approval card names the policy as it will be made: in the reader's language", async () => {
    jest
      .spyOn(OnCallReadinessService, "getReadinessForUser")
      .mockResolvedValue(
        readiness({ verified: [ReadinessMethodType.Email] }) as never,
      );
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);

    const english: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      {},
      ctx,
    );
    const german: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      {},
      { ...ctx, language: "de" },
    );

    expect(actionTitleText(english.title!)).toBe(
      `Create on-call policy "${GUIDED_SETUP_POLICY_NAME}"`,
    );
    expect(actionTitleText(german.title!)).toBe(
      `Create on-call policy "${getFirstOnCallPolicyName(dashboardTranslator("de"))}"`,
    );
    // The rule the server then adds names it as it was made.
    expect(
      getEveryNewIncidentRuleName(
        getFirstOnCallPolicyName(dashboardTranslator("de")),
        dashboardTranslator("de"),
      ),
    ).toContain(getFirstOnCallPolicyName(dashboardTranslator("de")));
  });

  test("approved after a policy was made elsewhere, it makes no second one", async () => {
    stubPagingCounts({ policies: 1, incidentRules: 1, alertRules: 1 });
    const create: Spy = jest.spyOn(OnCallDutyPolicyService, "create");

    await expect(
      SetUpPagingTool.execute({ userIds: [USER_ID.toString()] }, ctx),
    ).rejects.toThrow("already pages people");
    expect(create).not.toHaveBeenCalled();
  });

  test("approved with nobody to page, it makes nothing", async () => {
    stubPagingCounts({ policies: 0, incidentRules: 0, alertRules: 0 });
    const create: Spy = jest.spyOn(OnCallDutyPolicyService, "create");

    await expect(
      SetUpPagingTool.execute({ userIds: ["nope"] }, ctx),
    ).rejects.toThrow("nobody named is a member or a team");
    expect(create).not.toHaveBeenCalled();
  });

  /*
   * ONLY WHAT PAGES PEOPLE COUNTS (#8518), as the website-down guided setup
   * counts a project (#8234, #8433). An archived policy pages no one, and
   * an on-call rule pages people only through a policy in service: a
   * project whose only policy was archived, with the rules that run it, was
   * told "this project already pages people", and nobody was paged when
   * its monitor opened an incident.
   */
  describe("archived policies, and rules that run only archived ones (#8518)", () => {
    const propose: () => Promise<SetupActionRefusal | null> =
      async (): Promise<SetupActionRefusal | null> => {
        return await SetUpPagingTool.checkBeforeApproval!(
          { userIds: [USER_ID.toString()] },
          ctx,
        );
      };

    test("the policies are counted as the On-Call Policies list shows them: archived ones left out, as the person", async () => {
      const spies: { policyCount: Spy; incidentRules: Spy; alertRules: Spy } =
        servePaging({ policies: [] });

      await propose();

      expect(spies.policyCount).toHaveBeenCalledTimes(1);
      expect(spies.policyCount.mock.calls[0]![0]).toEqual({
        query: { projectId: PROJECT_ID, isArchived: false },
        props: ctx.props,
      });
    });

    test("the rules are read with each policy's archived flag, one list each, as the person - never just counted", async () => {
      const spies: { policyCount: Spy; incidentRules: Spy; alertRules: Spy } =
        servePaging({ policies: [] });
      const ruleCounts: Array<Spy> = [
        jest.spyOn(IncidentOnCallRuleService, "countBy"),
        jest.spyOn(AlertOnCallRuleService, "countBy"),
      ];

      await propose();

      for (const spy of [spies.incidentRules, spies.alertRules]) {
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![0]).toEqual({
          query: { projectId: PROJECT_ID },
          select: {
            _id: true,
            onCallDutyPolicies: { _id: true, isArchived: true },
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: ctx.props,
        });
      }

      for (const spy of ruleCounts) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    test("the issue's project: its only policy archived, with the two rules that run it - Ask AI proposes paging", async () => {
      servePaging({
        policies: [true],
        incidentRules: [[true]],
        alertRules: [[true]],
      });

      expect(await propose()).toBeNull();
    });

    test("approved for that project, it makes the guided setup's policy", async () => {
      servePaging({
        policies: [true],
        incidentRules: [[true]],
        alertRules: [[true]],
      });
      jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
      const create: Spy = jest
        .spyOn(OnCallDutyPolicyService, "create")
        .mockImplementation((async (args: {
          data: OnCallDutyPolicy;
        }): Promise<OnCallDutyPolicy> => {
          const created: OnCallDutyPolicy = args.data;
          created._id = POLICY_ID;
          return created;
        }) as never);

      await SetUpPagingTool.execute({ userIds: [USER_ID.toString()] }, ctx);

      expect(create).toHaveBeenCalledTimes(1);
    });

    test("several archived policies, and rules that run only them, are still none", async () => {
      servePaging({
        policies: [true, true, true],
        incidentRules: [[true, true], [true]],
        alertRules: [[true]],
      });

      expect(await propose()).toBeNull();
    });

    test("a rule that runs no policy at all pages no one, and does not count", async () => {
      servePaging({ policies: [], incidentRules: [[]], alertRules: [[]] });

      expect(await propose()).toBeNull();
    });

    test("a rule running a policy in service beside an archived one: the project pages people already", async () => {
      servePaging({
        policies: [true, false],
        incidentRules: [[true, false]],
      });

      const refused: SetupActionRefusal | null = await propose();

      expect(refused?.toldModel).toContain(
        "this project already pages people through its on-call policies and on-call rules (1 on-call policy, 1 on-call rule)",
      );
    });

    test("the counts it says are of what pages people: archived policies and their rules left out", async () => {
      servePaging({
        policies: [true, false, false],
        incidentRules: [[false], [true], []],
        alertRules: [[false], [true, false], [true]],
      });

      const refused: SetupActionRefusal | null = await propose();

      expect(refused?.toldModel).toContain(
        "(2 on-call policies, 3 on-call rules)",
      );
    });

    test("approved after a policy was archived elsewhere, it still makes one: execute counts the same way", async () => {
      servePaging({ policies: [false], incidentRules: [[false]] });
      expect((await propose())?.toldModel).toContain("already pages people");

      // Archived meanwhile: the card's approval finds no policy in service.
      servePaging({ policies: [true], incidentRules: [[true]] });
      jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
      const create: Spy = jest
        .spyOn(OnCallDutyPolicyService, "create")
        .mockImplementation((async (args: {
          data: OnCallDutyPolicy;
        }): Promise<OnCallDutyPolicy> => {
          const created: OnCallDutyPolicy = args.data;
          created._id = POLICY_ID;
          return created;
        }) as never);

      await SetUpPagingTool.execute({ userIds: [USER_ID.toString()] }, ctx);

      expect(create).toHaveBeenCalledTimes(1);
    });

    test("rules that cannot be read are unknown, never none: the person is told who can set it up", async () => {
      servePaging({ policies: [] });
      jest
        .spyOn(AlertOnCallRuleService, "findBy")
        .mockRejectedValue(new Error("not allowed") as never);

      const refused: SetupActionRefusal | null = await propose();

      expect(refused?.refusal).toBe(AIToolRefusal.Permission);
    });
  });
});

describe("publish_status_page", () => {
  test("its card says the page is public from the start, and what it shows - a monitor the same plan sets up named as new", async () => {
    stubLocations();
    const find: Spy = monitorsNamed([{ id: API_MONITOR_ID, name: "API" }]);

    const prepared: PreparedMutation =
      await PublishStatusPageTool.prepareMutation!(
        { monitors: ["api", "https://example.com", "Billing"] },
        {
          ...ctx,
          plannedCalls: [
            {
              name: "set_up_website_monitoring",
              arguments: { address: "example.com" },
            },
          ],
        },
      );

    expect(prepared.arguments["name"]).toBe("Acme Status");
    expect(actionTitleText(prepared.title)).toBe(
      'Publish status page "Acme Status"',
    );
    expect(prepared.namedArguments).toEqual(["name"]);
    expect(line(prepared.description)).toBe(
      'It is public as soon as it is created: anyone with its link sees the status of the monitors it shows. It shows "API", "example.com" (new). Not in this project, so not shown: "Billing".',
    );
    expect((find.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
    /*
     * The name it defaults to is the project's, read as OneUptime: fewer
     * people may read a project's name than the project
     * (CallerReadsReadableColumns).
     */
    expect(ProjectService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PROJECT_ID,
        select: { _id: true, name: true },
        props: { isRoot: true },
      }),
    );
  });

  test("the name the person gave is kept", async () => {
    monitorsNamed([{ id: API_MONITOR_ID, name: "API" }]);

    const prepared: PreparedMutation =
      await PublishStatusPageTool.prepareMutation!(
        { name: "Acme Uptime", monitors: ["API"] },
        ctx,
      );

    expect(prepared.arguments["name"]).toBe("Acme Uptime");
  });

  test("nothing to show, or a name too short, is not proposed; a monitor the plan sets up counts", async () => {
    monitorsNamed([]);
    planAllowsStatusPages();

    expect(
      (
        await PublishStatusPageTool.checkBeforeApproval!(
          { name: "Acme Status", monitors: ["Billing"] },
          ctx,
        )
      )?.toldModel,
    ).toContain(
      "none of the ones named (Billing) is a monitor of this project",
    );
    expect(
      (
        await PublishStatusPageTool.checkBeforeApproval!(
          { name: "A", monitors: ["Billing"] },
          ctx,
        )
      )?.toldModel,
    ).toContain("at least two characters");
    expect(
      await PublishStatusPageTool.checkBeforeApproval!(
        { name: "Acme Status", monitors: ["example.com"] },
        {
          ...ctx,
          plannedCalls: [
            {
              name: "set_up_website_monitoring",
              arguments: { address: "https://example.com" },
            },
          ],
        },
      ),
    ).toBeNull();
  });

  test("approved, it creates the guided setup's page as the person, with each monitor as Add Multiple Monitors adds it, and says what was not added", async () => {
    monitorsNamed([
      { id: MONITOR_ID, name: "example.com" },
      { id: API_MONITOR_ID, name: "API" },
    ]);
    const createPage: Spy = jest
      .spyOn(StatusPageService, "create")
      .mockImplementation((async (args: {
        data: StatusPage;
      }): Promise<StatusPage> => {
        const created: StatusPage = args.data;
        created._id = STATUS_PAGE_ID;
        return created;
      }) as never);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([] as never);
    const createResource: Spy = jest
      .spyOn(StatusPageResourceService, "create")
      .mockImplementation((async (args: {
        data: StatusPageResource;
      }): Promise<StatusPageResource> => {
        if (args.data.displayName === "API") {
          throw new Error("Status page resource limit reached.");
        }
        return args.data;
      }) as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue(
        `https://oneuptime.example/status-page/${STATUS_PAGE_ID}` as never,
      );

    const result: ToolExecutionResult = await PublishStatusPageTool.execute(
      { name: " Acme Status ", monitors: ["example.com", "API", "Gone"] },
      ctx,
    );

    const page: { data: StatusPage; props: unknown } = createPage.mock
      .calls[0]![0] as { data: StatusPage; props: unknown };
    expect(page.props).toBe(ctx.props);
    expect(page.data.name).toBe("Acme Status");
    expect(page.data.projectId?.toString()).toBe(PROJECT_ID.toString());

    expect(createResource).toHaveBeenCalledTimes(2);
    const first: { data: StatusPageResource; props: unknown } = createResource
      .mock.calls[0]![0] as { data: StatusPageResource; props: unknown };
    expect(first.props).toBe(ctx.props);
    expect(first.data.monitorId?.toString()).toBe(MONITOR_ID);
    expect(first.data.statusPageId?.toString()).toBe(STATUS_PAGE_ID);
    expect(first.data.displayName).toBe("example.com");
    expect(first.data.showCurrentStatus).toBe(
      GUIDED_SETUP_RESOURCE_OPTIONS.showCurrentStatus,
    );
    expect(first.data.showUptimePercent).toBe(true);
    expect(first.data.showStatusHistoryChart).toBe(true);

    expect(result.dataForLlm).toContain(
      `Published the status page "Acme Status" at https://oneuptime.example/status-page/${STATUS_PAGE_ID}.`,
    );
    expect(result.dataForLlm).toContain(
      'Not added: "API" (Status page resource limit reached.).',
    );
    expect(result.dataForLlm).toContain("Not found, so not shown: Gone.");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.StatusPageView,
      params: { statusPageId: STATUS_PAGE_ID },
    });
    expect(describeAIActionCardWords(result.widget!.data.words!)).toEqual({
      kind: AI_ACTION_CARD_KINDS.statusPage,
      line: "Published, public at its link",
      facts: [
        {
          label: "Public link",
          value: `https://oneuptime.example/status-page/${STATUS_PAGE_ID}`,
        },
        { label: "It shows", value: '"example.com"' },
        { label: "Not added", value: '"API"' },
      ],
    });
    expect(result.widget?.data.testPage).toBeUndefined();
  });

  test("approved when none of its monitors exists any more, it makes no empty page", async () => {
    monitorsNamed([]);
    const createPage: Spy = jest.spyOn(StatusPageService, "create");

    await expect(
      PublishStatusPageTool.execute(
        { name: "Acme Status", monitors: ["example.com"] },
        ctx,
      ),
    ).rejects.toThrow("a status page shows monitors");
    expect(createPage).not.toHaveBeenCalled();
  });
});

/*
 * #7247: a status page the person does not name is named after the project
 * in the language they read the Dashboard in, as the status page guided
 * setup starts its name for them ("Status von Acme" in German), and the
 * card and the page carry that name.
 */
describe("publish_status_page, in the person's language", () => {
  const prepareUnnamed: (
    context: ToolContext,
  ) => Promise<PreparedMutation> = async (
    context: ToolContext,
  ): Promise<PreparedMutation> => {
    stubLocations();
    monitorsNamed([{ id: API_MONITOR_ID, name: "API" }]);

    return await PublishStatusPageTool.prepareMutation!(
      { monitors: ["API"] },
      context,
    );
  };

  // The name the status page guided setup starts with, read in `language`.
  const guidedName: (language: string) => string = (
    language: string,
  ): string => {
    return dashboardTranslator(language).translateTemplate(
      "{{project}} Status",
      { project: "Acme" },
    );
  };

  test("approved by a person reading the Dashboard in German, the page the person did not name is named in German, on the card and the page", async () => {
    const saved: Spy = jest
      .spyOn(UserLanguage, "getLanguage")
      .mockResolvedValue("en" as never);

    const prepared: PreparedMutation = await prepareUnnamed({
      ...ctx,
      language: "de",
    });

    expect(guidedName("de")).toBe("Status von Acme");
    expect(prepared.arguments["name"]).toBe("Status von Acme");
    expect(actionTitleText(prepared.title)).toBe(
      'Publish status page "Status von Acme"',
    );
    // The language the Dashboard sent wins: the saved one is not read.
    expect(saved).not.toHaveBeenCalled();

    // Once approved, the page is made under the name the card showed.
    const create: Spy = jest
      .spyOn(StatusPageService, "create")
      .mockImplementation((async (args: {
        data: StatusPage;
      }): Promise<StatusPage> => {
        return model(StatusPage, { ...args.data, _id: STATUS_PAGE_ID });
      }) as never);
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("" as never);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageResourceService, "create")
      .mockImplementation((async (args: {
        data: StatusPageResource;
      }): Promise<StatusPageResource> => {
        return args.data;
      }) as never);

    await PublishStatusPageTool.execute(prepared.arguments, {
      ...ctx,
      language: "de",
    });

    expect((create.mock.calls[0]![0] as { data: StatusPage }).data.name).toBe(
      "Status von Acme",
    );
  });

  test.each(["ar", "fa", "ja", "zh-TW", "hi"])(
    "read in %s, the page is named as the guided setup names it, the project's name whole and no invisible marks in it",
    async (language: string) => {
      jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);

      const name: string = (
        await prepareUnnamed({ ...ctx, language: language })
      ).arguments["name"] as string;

      expect(name).toBe(guidedName(language));
      expect(name).not.toBe("Acme Status");
      expect(name).toContain("Acme");
      expect(name).not.toContain(FIRST_STRONG_ISOLATE);
      expect(name).not.toContain(POP_DIRECTIONAL_ISOLATE);
    },
  );

  test("with no language sent, the person's saved one names it; with none saved, or one OneUptime does not write in, it is the English name as before", async () => {
    const saved: Spy = jest
      .spyOn(UserLanguage, "getLanguage")
      .mockResolvedValue("fr" as never);

    expect((await prepareUnnamed(ctx)).arguments["name"]).toBe(
      guidedName("fr"),
    );
    expect(guidedName("fr")).not.toBe("Acme Status");
    expect(saved).toHaveBeenCalledWith(USER_ID);

    saved.mockResolvedValue("en" as never);
    expect((await prepareUnnamed(ctx)).arguments["name"]).toBe("Acme Status");
    expect(
      (await prepareUnnamed({ ...ctx, language: "xx" })).arguments["name"],
    ).toBe("Acme Status");
    expect(
      (await prepareUnnamed({ ...ctx, language: "en" })).arguments["name"],
    ).toBe("Acme Status");
  });

  test("a name the person gave is kept as they gave it, in any language", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("de" as never);
    stubLocations();
    monitorsNamed([{ id: API_MONITOR_ID, name: "API" }]);

    const prepared: PreparedMutation =
      await PublishStatusPageTool.prepareMutation!(
        { name: "Acme Uptime", monitors: ["API"] },
        { ...ctx, language: "de" },
      );

    expect(prepared.arguments["name"]).toBe("Acme Uptime");
  });

  test("a project that cannot be read, or has no name, gives the page the plain name Status, in every language", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("de" as never);
    monitorsNamed([{ id: API_MONITOR_ID, name: "API" }]);
    const project: Spy = jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("The database is slow") as never);

    expect(
      (
        await PublishStatusPageTool.prepareMutation!(
          { monitors: ["API"] },
          { ...ctx, language: "de" },
        )
      ).arguments["name"],
    ).toBe("Status");

    project.mockResolvedValue(model(Project, { name: "   " }) as never);

    expect(
      (
        await PublishStatusPageTool.prepareMutation!(
          { monitors: ["API"] },
          { ...ctx, language: "ar" },
        )
      ).arguments["name"],
    ).toBe("Status");
  });
});

describe("add_monitors_to_status_page", () => {
  function stubPage(): Spy {
    return jest.spyOn(StatusPageService, "findOneBy").mockResolvedValue(
      model(StatusPage, {
        _id: STATUS_PAGE_ID,
        name: "Acme Status",
      }) as never,
    );
  }

  test("its card names the page, writes it out by id, and says what it adds and what it shows already", async () => {
    const find: Spy = stubPage();
    monitorsNamed([
      { id: MONITOR_ID, name: "example.com" },
      { id: API_MONITOR_ID, name: "API" },
    ]);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([
        model(StatusPageResource, { monitorId: new ObjectID(API_MONITOR_ID) }),
      ] as never);

    const prepared: PreparedMutation =
      await AddMonitorsToStatusPageTool.prepareMutation!(
        {
          statusPage: "acme status",
          monitors: ["example.com", "API", "Gone", "new.example.com"],
        },
        {
          ...ctx,
          plannedCalls: [
            {
              name: "set_up_website_monitoring",
              arguments: { address: "new.example.com" },
            },
          ],
        },
      );

    expect(prepared.arguments["statusPageId"]).toBe(STATUS_PAGE_ID);
    expect(actionTitleText(prepared.title)).toBe(
      'Add monitors to status page "Acme Status"',
    );
    expect(line(prepared.description)).toBe(
      'Adds "example.com", "new.example.com" (new). Already on it: "API". Not in this project, so not shown: "Gone".',
    );
    expect((find.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
  });

  test("a page or monitors that do not exist are not proposed", async () => {
    jest.spyOn(StatusPageService, "findOneBy").mockResolvedValue(null as never);

    expect(
      (
        await AddMonitorsToStatusPageTool.checkBeforeApproval!(
          { statusPage: "Nope", monitors: ["API"] },
          ctx,
        )
      )?.toldModel,
    ).toContain('"Nope" is no status page of this project');

    jest.restoreAllMocks();
    stubPage();
    monitorsNamed([]);

    expect(
      (
        await AddMonitorsToStatusPageTool.checkBeforeApproval!(
          { statusPage: "Acme Status", monitors: ["Gone"] },
          ctx,
        )
      )?.toldModel,
    ).toContain("none of the ones named (Gone)");
  });

  test("approved, it adds what the page does not show yet, as the person", async () => {
    stubPage();
    monitorsNamed([
      { id: MONITOR_ID, name: "example.com" },
      { id: API_MONITOR_ID, name: "API" },
    ]);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([
        model(StatusPageResource, { monitorId: new ObjectID(API_MONITOR_ID) }),
      ] as never);
    const createResource: Spy = jest
      .spyOn(StatusPageResourceService, "create")
      .mockImplementation((async (args: {
        data: StatusPageResource;
      }): Promise<StatusPageResource> => {
        return args.data;
      }) as never);

    const result: ToolExecutionResult =
      await AddMonitorsToStatusPageTool.execute(
        { statusPageId: STATUS_PAGE_ID, monitors: ["example.com", "API"] },
        ctx,
      );

    expect(createResource).toHaveBeenCalledTimes(1);
    expect((createResource.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
    expect(result.dataForLlm).toContain(
      'Added "example.com" to the status page "Acme Status". It already showed "API".',
    );
    expect(describeAIActionCardWords(result.widget!.data.words!).line).toBe(
      'Added "example.com"',
    );
  });

  test("approved when every monitor fails to be added, it says so as a failure", async () => {
    stubPage();
    monitorsNamed([{ id: MONITOR_ID, name: "example.com" }]);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageResourceService, "create")
      .mockRejectedValue(new Error("refused") as never);

    await expect(
      AddMonitorsToStatusPageTool.execute(
        { statusPage: "Acme Status", monitors: ["example.com"] },
        ctx,
      ),
    ).rejects.toThrow(
      'No monitor was added to "Acme Status": "example.com" (refused).',
    );
  });
});
