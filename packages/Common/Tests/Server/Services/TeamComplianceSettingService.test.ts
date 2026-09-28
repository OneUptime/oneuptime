import TeamComplianceSettingService, {
  ComplianceRuleScope,
  DeletedSeverity,
  DUPLICATE_COMPLIANCE_RULE_MESSAGE,
  TeamComplianceSettingService as TeamComplianceSettingServiceClass,
} from "../../../Server/Services/TeamComplianceSettingService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "../../../Models/DatabaseModels/TeamComplianceSetting";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import ComplianceNotificationChannel from "../../../Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
} from "../../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * TeamComplianceSettingService guards what a team compliance rule may say.
 *
 * A rule is a type (ComplianceRuleType), optionally a channel ("Call") and a
 * severity scope ("Critical"). One team may hold several rules of one type -
 * "Call for Critical incidents" and "Push for Critical incidents" are both
 * HasIncidentOnCallRules - so there is no unique index any more; the service
 * refuses EXACT duplicates instead (same type, channel and severity set).
 *
 * These tests pin, against an in-memory team of stored rules and project
 * severities:
 *
 *  - create refuses unknown rule types and channels, and anything without a
 *    project or team, before reading anything;
 *  - options a rule type does not use are cleared, per kind, so nothing is
 *    stored that looks like part of a rule without being checked;
 *  - selected severities must exist in the rule's own project, of the rule's
 *    own kind - checked in one count, as root, and never for a stray option;
 *  - duplicates are judged on content (order, repeats and id case do not
 *    matter), legacy "no channel, every severity" rows included, while a
 *    different channel, severity set, rule type or team is a different rule;
 *  - an update that only toggles `enabled` reads nothing at all;
 *  - an update that changes the scope re-validates it, compares against
 *    siblings excluding the row itself, reads only inside the caller's
 *    project, and a rule type change clears the options the new type does not
 *    use, including ones already stored on the row;
 *  - the static scope helpers the ee server can reuse (getIds, getScope,
 *    isSameScope).
 *
 * The protected hooks are called directly, as the other service tests do; a
 * last block drives updateOneById - the path the API takes - to show that what
 * the hook normalises is what reaches the write.
 *
 * The caller is a signed-in team editor (EditProjectTeam) of the project
 * unless a test says otherwise: the hooks check the caller's permission
 * before they read anything, so a caller with no say in the project learns
 * nothing about its severities or rules from what they refuse.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEAM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const SETTING_ID: string = "66666666-6666-4666-8666-000000000001";
const SIBLING_SETTING_ID: string = "66666666-6666-4666-8666-000000000002";
const OTHER_PROJECT_SETTING_ID: string = "66666666-6666-4666-8666-000000000003";

const CRITICAL_INCIDENT: string = "c1c1c1c1-0000-4000-8000-000000000001";
const MAJOR_INCIDENT: string = "c1c1c1c1-0000-4000-8000-000000000002";
const MINOR_INCIDENT: string = "c1c1c1c1-0000-4000-8000-000000000003";
const FOREIGN_INCIDENT: string = "c1c1c1c1-0000-4000-8000-000000000009";

const CRITICAL_ALERT: string = "a1a1a1a1-0000-4000-8000-000000000001";
const MAJOR_ALERT: string = "a1a1a1a1-0000-4000-8000-000000000002";
const FOREIGN_ALERT: string = "a1a1a1a1-0000-4000-8000-000000000009";

const UNKNOWN_CHANNEL_MESSAGE: (value: string) => string = (
  value: string,
): string => {
  return `"${value}" is not a notification channel a compliance rule can require.`;
};

const UNKNOWN_RULE_TYPE_MESSAGE: (value: string) => string = (
  value: string,
): string => {
  return `"${value}" is not a compliance rule type.`;
};

const FOREIGN_INCIDENT_SEVERITY_MESSAGE: string =
  "One or more of the selected incident severities do not exist in this project.";
const FOREIGN_ALERT_SEVERITY_MESSAGE: string =
  "One or more of the selected alert severities do not exist in this project.";

const ON_CALL_RULE_TYPES: Array<ComplianceRuleType> = [
  ComplianceRuleType.HasIncidentOnCallRules,
  ComplianceRuleType.HasAlertOnCallRules,
  ComplianceRuleType.HasIncidentEpisodeOnCallRules,
  ComplianceRuleType.HasAlertEpisodeOnCallRules,
];

const INCIDENT_RULE_TYPES: Array<ComplianceRuleType> = [
  ComplianceRuleType.HasIncidentOnCallRules,
  ComplianceRuleType.HasIncidentEpisodeOnCallRules,
];

const ALERT_RULE_TYPES: Array<ComplianceRuleType> = [
  ComplianceRuleType.HasAlertOnCallRules,
  ComplianceRuleType.HasAlertEpisodeOnCallRules,
];

const METHOD_RULE_TYPES: Array<ComplianceRuleType> = [
  ComplianceRuleType.HasNotificationEmailMethod,
  ComplianceRuleType.HasNotificationSMSMethod,
  ComplianceRuleType.HasNotificationCallMethod,
  ComplianceRuleType.HasNotificationPushMethod,
  ComplianceRuleType.HasNotificationWhatsAppMethod,
  ComplianceRuleType.HasNotificationTelegramMethod,
  ComplianceRuleType.HasNotificationSlackMethod,
  ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
  ComplianceRuleType.HasNotificationWebhookMethod,
];

const ALL_CHANNELS: Array<ComplianceNotificationChannel> = Object.values(
  ComplianceNotificationChannel,
);

/*
 * ---------------------------------------------------------------------------
 * The in-memory world the service reads from.
 * ---------------------------------------------------------------------------
 */

// The rules already stored, across every team and project.
let storedSettings: Array<TeamComplianceSetting> = [];

// Severity ids per project, as the severity tables hold them (lower case).
const INCIDENT_SEVERITIES_BY_PROJECT: Map<string, Array<string>> = new Map<
  string,
  Array<string>
>([
  [PROJECT_ID.toString(), [CRITICAL_INCIDENT, MAJOR_INCIDENT, MINOR_INCIDENT]],
  [OTHER_PROJECT_ID.toString(), [FOREIGN_INCIDENT]],
]);

const ALERT_SEVERITIES_BY_PROJECT: Map<string, Array<string>> = new Map<
  string,
  Array<string>
>([
  [PROJECT_ID.toString(), [CRITICAL_ALERT, MAJOR_ALERT]],
  [OTHER_PROJECT_ID.toString(), [FOREIGN_ALERT]],
]);

let settingsFindBy: jest.SpyInstance;
let settingsFindOneBy: jest.SpyInstance;
let settingsCountBy: jest.SpyInstance;
let incidentSeverityCountBy: jest.SpyInstance;
let alertSeverityCountBy: jest.SpyInstance;

/*
 * A query as DatabaseService would run it: every key must match, ids compare
 * as strings, Includes matches any of its values, and QueryHelper.notEquals -
 * a Raw "!=" carrying the excluded id as its only parameter - excludes that
 * row.
 */
const matchesQuery: (
  row: TeamComplianceSetting,
  query: JSONObject,
) => boolean = (row: TeamComplianceSetting, query: JSONObject): boolean => {
  return Object.keys(query).every((key: string): boolean => {
    const expected: unknown = query[key];
    const actual: unknown = (row as unknown as Record<string, unknown>)[key];

    if (expected instanceof Includes) {
      return expected.values
        .map((value: unknown): string => {
          return String(value);
        })
        .includes(String(actual));
    }

    if (expected instanceof FindOperator) {
      const excluded: Array<string> = Object.values(
        expected.objectLiteralParameters || {},
      ).map((value: unknown): string => {
        return String(value);
      });

      return !excluded.includes(String(actual));
    }

    return String(actual) === String(expected);
  });
};

/*
 * countBy({_id: Includes(ids), projectId}) the way Postgres answers it: the
 * number of severity ROWS in that project whose uuid is in the list, uuids
 * compared without case.
 */
const countSeverities: (
  severitiesByProject: Map<string, Array<string>>,
  query: JSONObject,
) => PositiveNumber = (
  severitiesByProject: Map<string, Array<string>>,
  query: JSONObject,
): PositiveNumber => {
  const wanted: Array<string> = (query["_id"] as Includes).values.map(
    (id: unknown): string => {
      return String(id).toLowerCase();
    },
  );

  const inProject: Array<string> =
    severitiesByProject.get(String(query["projectId"])) || [];

  return new PositiveNumber(
    inProject.filter((id: string): boolean => {
      return wanted.includes(id);
    }).length,
  );
};

beforeEach(() => {
  storedSettings = [];

  /*
   * TeamComplianceSetting is enterprise configuration, and the permission
   * check asks the licence; no test machine holds one.
   */
  jest
    .spyOn(EnterpriseEdition, "assertFeatureAvailableSync")
    .mockReturnValue(undefined);

  settingsFindBy = jest
    .spyOn(TeamComplianceSettingService, "findBy")
    .mockImplementation(((findBy: { query: JSONObject }) => {
      return Promise.resolve(
        storedSettings.filter((row: TeamComplianceSetting): boolean => {
          return matchesQuery(row, findBy.query);
        }),
      );
    }) as never);

  // The service reads through findBy only; any other read is a regression.
  settingsFindOneBy = jest
    .spyOn(TeamComplianceSettingService, "findOneBy")
    .mockRejectedValue(new Error("unexpected findOneBy") as never);
  settingsCountBy = jest
    .spyOn(TeamComplianceSettingService, "countBy")
    .mockRejectedValue(new Error("unexpected countBy") as never);

  incidentSeverityCountBy = jest
    .spyOn(IncidentSeverityService, "countBy")
    .mockImplementation(((countBy: { query: JSONObject }) => {
      return Promise.resolve(
        countSeverities(INCIDENT_SEVERITIES_BY_PROJECT, countBy.query),
      );
    }) as never);

  alertSeverityCountBy = jest
    .spyOn(AlertSeverityService, "countBy")
    .mockImplementation(((countBy: { query: JSONObject }) => {
      return Promise.resolve(
        countSeverities(ALERT_SEVERITIES_BY_PROJECT, countBy.query),
      );
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * Builders.
 * ---------------------------------------------------------------------------
 */

interface StoredRuleInput {
  id: string;
  ruleType: string;
  teamId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  notificationChannel?: string | null | undefined;
  incidentSeverityIds?: Array<string> | undefined;
  alertSeverityIds?: Array<string> | undefined;
  // Stored rules are enabled unless a test pauses one.
  enabled?: boolean | undefined;
  omitTeam?: boolean | undefined;
  omitProject?: boolean | undefined;
}

// A row as the service's findBy returns it, relations loaded as models.
const storedRule: (input: StoredRuleInput) => TeamComplianceSetting = (
  input: StoredRuleInput,
): TeamComplianceSetting => {
  const setting: TeamComplianceSetting = new TeamComplianceSetting();
  setting._id = input.id;

  if (!input.omitTeam) {
    setting.teamId = input.teamId || TEAM_ID;
  }

  if (!input.omitProject) {
    setting.projectId = input.projectId || PROJECT_ID;
  }

  (setting as unknown as Record<string, unknown>)["ruleType"] = input.ruleType;
  (setting as unknown as Record<string, unknown>)["notificationChannel"] =
    input.notificationChannel === undefined ? null : input.notificationChannel;
  setting.enabled = input.enabled === undefined ? true : input.enabled;

  setting.incidentSeverities = (input.incidentSeverityIds || []).map(
    (id: string): IncidentSeverity => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = id;
      return severity;
    },
  );

  setting.alertSeverities = (input.alertSeverityIds || []).map(
    (id: string): AlertSeverity => {
      const severity: AlertSeverity = new AlertSeverity();
      severity._id = id;
      return severity;
    },
  );

  return setting;
};

const store: (...rows: Array<StoredRuleInput>) => void = (
  ...rows: Array<StoredRuleInput>
): void => {
  for (const row of rows) {
    storedSettings.push(storedRule(row));
  }
};

interface NewRuleInput {
  ruleType?: unknown;
  notificationChannel?: unknown;
  incidentSeverities?: unknown;
  alertSeverities?: unknown;
  teamId?: ObjectID | null | undefined;
  projectId?: ObjectID | null | undefined;
}

// The payload of a create, as BaseAPI hands it over: a model, any values.
const newRule: (input: NewRuleInput) => TeamComplianceSetting = (
  input: NewRuleInput,
): TeamComplianceSetting => {
  const setting: TeamComplianceSetting = new TeamComplianceSetting();
  const target: Record<string, unknown> = setting as unknown as Record<
    string,
    unknown
  >;

  if (input.teamId !== null) {
    setting.teamId = input.teamId || TEAM_ID;
  }

  if (input.projectId !== null) {
    setting.projectId = input.projectId || PROJECT_ID;
  }

  for (const key of [
    "ruleType",
    "notificationChannel",
    "incidentSeverities",
    "alertSeverities",
  ]) {
    if (key in input) {
      target[key] = (input as Record<string, unknown>)[key];
    }
  }

  return setting;
};

// A signed-in user holding `permissions` in `project`, and nothing else.
const memberProps: (
  permissions: Array<Permission>,
  project?: ObjectID,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
  project?: ObjectID,
): DatabaseCommonInteractionProps => {
  const tenantId: ObjectID = project || PROJECT_ID;

  const tenantPermission: UserTenantAccessPermission = {
    projectId: tenantId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: tenantId,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [tenantId.toString()]: tenantPermission,
    },
  };
};

/*
 * A team editor: Edit Teams, plus Read Teams to see what they edit. (An
 * update is located by a query on the project, which only a reader of the
 * rules may filter on - the update permission check refuses Edit Teams on
 * its own, here and in _updateBy alike.)
 */
const EDITOR_PROPS: DatabaseCommonInteractionProps = memberProps([
  Permission.ReadProjectTeam,
  Permission.EditProjectTeam,
]);

/*
 * Signed in, with the project named as the tenant, but no permission in it -
 * what any user of another project can send.
 */
const OUTSIDER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
};

const createProps: DatabaseCommonInteractionProps = EDITOR_PROPS;

const createByFor: (
  data: TeamComplianceSetting,
  props?: DatabaseCommonInteractionProps,
) => CreateBy<TeamComplianceSetting> = (
  data: TeamComplianceSetting,
  props?: DatabaseCommonInteractionProps,
): CreateBy<TeamComplianceSetting> => {
  return {
    data: data,
    props: props || createProps,
  };
};

type OnBeforeCreateFunction = (
  createBy: CreateBy<TeamComplianceSetting>,
) => Promise<OnCreate<TeamComplianceSetting>>;

type OnBeforeUpdateFunction = (
  updateBy: UpdateBy<TeamComplianceSetting>,
) => Promise<OnUpdate<TeamComplianceSetting>>;

interface ServiceHooks {
  onBeforeCreate: OnBeforeCreateFunction;
  onBeforeUpdate: OnBeforeUpdateFunction;
  _onBeforeCreate: OnBeforeCreateFunction;
}

const hooks: () => ServiceHooks = (): ServiceHooks => {
  return TeamComplianceSettingService as unknown as ServiceHooks;
};

const onBeforeCreate: (
  createBy: CreateBy<TeamComplianceSetting>,
) => Promise<OnCreate<TeamComplianceSetting>> = (
  createBy: CreateBy<TeamComplianceSetting>,
): Promise<OnCreate<TeamComplianceSetting>> => {
  return hooks().onBeforeCreate(createBy);
};

const create: (
  input: NewRuleInput,
) => Promise<OnCreate<TeamComplianceSetting>> = (
  input: NewRuleInput,
): Promise<OnCreate<TeamComplianceSetting>> => {
  return onBeforeCreate(createByFor(newRule(input)));
};

const updateByFor: (
  data: Record<string, unknown>,
  options?: {
    query?: Record<string, unknown> | undefined;
    props?: DatabaseCommonInteractionProps | undefined;
  },
) => UpdateBy<TeamComplianceSetting> = (
  data: Record<string, unknown>,
  options?: {
    query?: Record<string, unknown> | undefined;
    props?: DatabaseCommonInteractionProps | undefined;
  },
): UpdateBy<TeamComplianceSetting> => {
  return {
    query: options?.query || { _id: SETTING_ID },
    data: data,
    limit: 1,
    skip: 0,
    props: options?.props || EDITOR_PROPS,
  } as unknown as UpdateBy<TeamComplianceSetting>;
};

const onBeforeUpdate: (
  updateBy: UpdateBy<TeamComplianceSetting>,
) => Promise<OnUpdate<TeamComplianceSetting>> = (
  updateBy: UpdateBy<TeamComplianceSetting>,
): Promise<OnUpdate<TeamComplianceSetting>> => {
  return hooks().onBeforeUpdate(updateBy);
};

const update: (
  data: Record<string, unknown>,
) => Promise<OnUpdate<TeamComplianceSetting>> = (
  data: Record<string, unknown>,
): Promise<OnUpdate<TeamComplianceSetting>> => {
  return onBeforeUpdate(updateByFor(data));
};

const findByCalls: () => Array<JSONObject> = (): Array<JSONObject> => {
  return settingsFindBy.mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
};

/*
 * The duplicate lookups. An update first reads the rows it changes, selecting
 * their team and project; a duplicate lookup already knows both.
 */
const siblingReads: () => Array<JSONObject> = (): Array<JSONObject> => {
  return findByCalls().filter((call: JSONObject): boolean => {
    return (call["select"] as JSONObject)["teamId"] === undefined;
  });
};

const countCalls: (spy: jest.SpyInstance) => Array<JSONObject> = (
  spy: jest.SpyInstance,
): Array<JSONObject> => {
  return spy.mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
};

const includedIds: (query: JSONObject) => Array<string> = (
  query: JSONObject,
): Array<string> => {
  return (query["_id"] as Includes).values.map((id: unknown): string => {
    return String(id);
  });
};

const expectNoReads: () => void = (): void => {
  expect(settingsFindBy).not.toHaveBeenCalled();
  expect(settingsFindOneBy).not.toHaveBeenCalled();
  expect(settingsCountBy).not.toHaveBeenCalled();
  expect(incidentSeverityCountBy).not.toHaveBeenCalled();
  expect(alertSeverityCountBy).not.toHaveBeenCalled();
};

const dataOf: (
  updateBy: UpdateBy<TeamComplianceSetting>,
) => Record<string, unknown> = (
  updateBy: UpdateBy<TeamComplianceSetting>,
): Record<string, unknown> => {
  return updateBy.data as unknown as Record<string, unknown>;
};

const modelValue: (setting: TeamComplianceSetting, key: string) => unknown = (
  setting: TeamComplianceSetting,
  key: string,
): unknown => {
  return (setting as unknown as Record<string, unknown>)[key];
};

/*
 * A severity list as the hooks leave it for the relation save: models of the
 * list's own kind, each carrying nothing but its id. Returns those ids.
 */
const writtenIds: (
  value: unknown,
  modelType: typeof IncidentSeverity | typeof AlertSeverity,
) => Array<string> = (
  value: unknown,
  modelType: typeof IncidentSeverity | typeof AlertSeverity,
): Array<string> => {
  expect(Array.isArray(value)).toBe(true);

  return (value as Array<unknown>).map((item: unknown): string => {
    expect(item).toBeInstanceOf(modelType);

    const model: IncidentSeverity | AlertSeverity = item as
      | IncidentSeverity
      | AlertSeverity;

    expect(model.name).toBeUndefined();
    expect(model.projectId).toBeUndefined();

    return String(model._id);
  });
};

/*
 * ---------------------------------------------------------------------------
 * create
 * ---------------------------------------------------------------------------
 */

describe("TeamComplianceSettingService onBeforeCreate - what may be created", () => {
  test.each(Object.values(ComplianceRuleType))(
    "accepts a %s rule on a team that has none",
    async (ruleType: ComplianceRuleType) => {
      const createBy: CreateBy<TeamComplianceSetting> = createByFor(
        newRule({ ruleType: ruleType }),
      );

      const result: OnCreate<TeamComplianceSetting> =
        await onBeforeCreate(createBy);

      // The hook hands back the very same request, nothing carried forward.
      expect(result.createBy).toBe(createBy);
      expect(result.carryForward).toBeNull();
      expect(result.createBy.data.ruleType).toBe(ruleType);
    },
  );

  test.each([
    ["a rule type from the old free-text era", "RequireTwoFactorAuth"],
    ["a near miss in case", "hasincidentoncallrules"],
    ["an empty string", ""],
    [
      "a notification rule type, not a compliance one",
      "WHEN_USER_GOES_ON_CALL",
    ],
  ])(
    "refuses %s before reading anything",
    async (_label: string, ruleType: string) => {
      await expect(create({ ruleType: ruleType })).rejects.toThrow(
        new BadDataException(UNKNOWN_RULE_TYPE_MESSAGE(ruleType)),
      );

      expectNoReads();
    },
  );

  test.each([
    ["missing", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { ruleType: "HasIncidentOnCallRules" }],
  ])(
    "refuses a rule type that is %s",
    async (_label: string, ruleType: unknown) => {
      await expect(create({ ruleType: ruleType })).rejects.toThrow(
        BadDataException,
      );

      expectNoReads();
    },
  );

  test("the refusal is a BadDataException that names the value, so the form can show it", async () => {
    await expect(create({ ruleType: "RequirePhoneNumber" })).rejects.toThrow(
      '"RequirePhoneNumber" is not a compliance rule type.',
    );
  });

  test.each(ALL_CHANNELS)(
    "accepts the %s channel on every on-call rule type and keeps it",
    async (channel: ComplianceNotificationChannel) => {
      for (const ruleType of ON_CALL_RULE_TYPES) {
        const result: OnCreate<TeamComplianceSetting> = await create({
          ruleType: ruleType,
          notificationChannel: channel,
        });

        expect({
          ruleType,
          channel: result.createBy.data.notificationChannel,
        }).toEqual({ ruleType, channel });
      }
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
  ])(
    "a %s channel is 'any channel', and is valid",
    async (_label: string, channel: unknown) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: channel,
      });

      expect(modelValue(result.createBy.data, "notificationChannel")).toBe(
        channel,
      );
    },
  );

  test.each([
    ["a channel that does not exist", "Pager"],
    ["a channel in the wrong case", "call"],
    ["an empty string", ""],
    ["a method rule type", "HasNotificationCallMethod"],
  ])(
    "refuses %s as the channel, before reading anything",
    async (_label: string, channel: string) => {
      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: channel,
        }),
      ).rejects.toThrow(new BadDataException(UNKNOWN_CHANNEL_MESSAGE(channel)));

      expectNoReads();
    },
  );

  test("refuses a channel that is not a channel even on a method rule - garbage is refused, not quietly dropped", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        notificationChannel: "Pager",
      }),
    ).rejects.toThrow(UNKNOWN_CHANNEL_MESSAGE("Pager"));
  });

  test("refuses a rule with no project, before reading anything", async () => {
    await expect(
      onBeforeCreate(
        createByFor(
          newRule({
            ruleType: ComplianceRuleType.HasNotificationEmailMethod,
            projectId: null,
          }),
          { isRoot: true },
        ),
      ),
    ).rejects.toThrow(new BadDataException("Project ID is required."));

    expectNoReads();
  });

  test("refuses a rule with no team, before reading anything", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        teamId: null,
      }),
    ).rejects.toThrow(new BadDataException("Team ID is required."));

    expectNoReads();
  });

  test("takes the project from the caller's tenant when the payload has none", async () => {
    await onBeforeCreate(
      createByFor(
        newRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          projectId: null,
          incidentSeverities: [CRITICAL_INCIDENT],
        }),
        EDITOR_PROPS,
      ),
    );

    expect(countCalls(incidentSeverityCountBy)[0]?.["query"]).toMatchObject({
      projectId: PROJECT_ID,
    });
    expect(siblingReads()[0]?.["query"]).toMatchObject({
      projectId: PROJECT_ID,
    });
  });

  test("a projectId smuggled into the payload cannot move the checks into another project", async () => {
    /*
     * DatabaseService.create stamps the tenant onto the payload before this
     * hook runs (_onBeforeCreate), so the severity check and the duplicate
     * lookup run in the caller's project, not the one the payload names.
     */
    await expect(
      hooks()._onBeforeCreate(
        createByFor(
          newRule({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            projectId: OTHER_PROJECT_ID,
            incidentSeverities: [FOREIGN_INCIDENT],
          }),
          EDITOR_PROPS,
        ),
      ),
    ).rejects.toThrow(FOREIGN_INCIDENT_SEVERITY_MESSAGE);

    expect(countCalls(incidentSeverityCountBy)[0]?.["query"]).toMatchObject({
      projectId: PROJECT_ID,
    });
  });
});

describe("TeamComplianceSettingService onBeforeCreate - options a rule type does not use are cleared", () => {
  test.each(METHOD_RULE_TYPES)(
    "%s keeps no channel and no severities of either kind",
    async (ruleType: ComplianceRuleType) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ruleType,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      });

      expect(
        modelValue(result.createBy.data, "notificationChannel"),
      ).toBeNull();
      expect(result.createBy.data.incidentSeverities).toEqual([]);
      expect(result.createBy.data.alertSeverities).toEqual([]);
    },
  );

  test.each(INCIDENT_RULE_TYPES)(
    "%s keeps its channel and incident severities, and drops alert severities",
    async (ruleType: ComplianceRuleType) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ruleType,
        notificationChannel: ComplianceNotificationChannel.Push,
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      });

      expect(result.createBy.data.notificationChannel).toBe(
        ComplianceNotificationChannel.Push,
      );
      expect(
        writtenIds(
          modelValue(result.createBy.data, "incidentSeverities"),
          IncidentSeverity,
        ),
      ).toEqual([CRITICAL_INCIDENT]);
      expect(result.createBy.data.alertSeverities).toEqual([]);
    },
  );

  test.each(ALERT_RULE_TYPES)(
    "%s keeps its channel and alert severities, and drops incident severities",
    async (ruleType: ComplianceRuleType) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ruleType,
        notificationChannel: ComplianceNotificationChannel.SMS,
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      });

      expect(result.createBy.data.notificationChannel).toBe(
        ComplianceNotificationChannel.SMS,
      );
      expect(
        writtenIds(
          modelValue(result.createBy.data, "alertSeverities"),
          AlertSeverity,
        ),
      ).toEqual([CRITICAL_ALERT]);
      expect(result.createBy.data.incidentSeverities).toEqual([]);
    },
  );

  test("a stray option is dropped, not validated: a foreign severity on a method rule is not an error", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasNotificationPushMethod,
        incidentSeverities: [FOREIGN_INCIDENT],
        alertSeverities: ["not-a-uuid"],
      }),
    ).resolves.toBeDefined();

    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
    expect(alertSeverityCountBy).not.toHaveBeenCalled();
  });

  test("a stray severity of the other kind is dropped, not validated", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        alertSeverities: [FOREIGN_ALERT],
      }),
    ).resolves.toBeDefined();

    expect(alertSeverityCountBy).not.toHaveBeenCalled();
  });

  test("options that were not sent are left unset rather than invented", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    });

    expect(result.createBy.data.notificationChannel).toBeUndefined();
    expect(result.createBy.data.incidentSeverities).toBeUndefined();
    expect(result.createBy.data.alertSeverities).toBeUndefined();
  });
});

describe("TeamComplianceSettingService onBeforeCreate - severities must belong to the project", () => {
  test.each(INCIDENT_RULE_TYPES)(
    "%s counts its incident severities in the rule's project, once, as root",
    async (ruleType: ComplianceRuleType) => {
      await create({
        ruleType: ruleType,
        incidentSeverities: [MAJOR_INCIDENT, CRITICAL_INCIDENT],
      });

      expect(incidentSeverityCountBy).toHaveBeenCalledTimes(1);
      expect(alertSeverityCountBy).not.toHaveBeenCalled();

      const countBy: JSONObject = countCalls(incidentSeverityCountBy)[0]!;
      expect(includedIds(countBy["query"] as JSONObject)).toEqual(
        [CRITICAL_INCIDENT, MAJOR_INCIDENT].sort(),
      );
      expect((countBy["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
      expect(Object.keys(countBy["query"] as JSONObject).sort()).toEqual([
        "_id",
        "projectId",
      ]);
      expect(countBy["props"]).toEqual({ isRoot: true });
    },
  );

  test.each(ALERT_RULE_TYPES)(
    "%s counts its alert severities in the rule's project, once, as root",
    async (ruleType: ComplianceRuleType) => {
      await create({
        ruleType: ruleType,
        alertSeverities: [CRITICAL_ALERT, MAJOR_ALERT],
      });

      expect(alertSeverityCountBy).toHaveBeenCalledTimes(1);
      expect(incidentSeverityCountBy).not.toHaveBeenCalled();

      const countBy: JSONObject = countCalls(alertSeverityCountBy)[0]!;
      expect(includedIds(countBy["query"] as JSONObject)).toEqual(
        [CRITICAL_ALERT, MAJOR_ALERT].sort(),
      );
      expect((countBy["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
      expect(countBy["props"]).toEqual({ isRoot: true });
    },
  );

  test.each(INCIDENT_RULE_TYPES)(
    "%s refuses an incident severity from another project",
    async (ruleType: ComplianceRuleType) => {
      await expect(
        create({
          ruleType: ruleType,
          incidentSeverities: [CRITICAL_INCIDENT, FOREIGN_INCIDENT],
        }),
      ).rejects.toThrow(
        new BadDataException(FOREIGN_INCIDENT_SEVERITY_MESSAGE),
      );

      // Refused before the duplicate lookup.
      expect(settingsFindBy).not.toHaveBeenCalled();
    },
  );

  test.each(ALERT_RULE_TYPES)(
    "%s refuses an alert severity from another project",
    async (ruleType: ComplianceRuleType) => {
      await expect(
        create({
          ruleType: ruleType,
          alertSeverities: [FOREIGN_ALERT],
        }),
      ).rejects.toThrow(new BadDataException(FOREIGN_ALERT_SEVERITY_MESSAGE));
    },
  );

  test("an alert severity id is not an incident severity: the kinds are checked against their own table", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverities: [CRITICAL_ALERT],
      }),
    ).rejects.toThrow(FOREIGN_INCIDENT_SEVERITY_MESSAGE);

    expect(alertSeverityCountBy).not.toHaveBeenCalled();
  });

  test("refuses an id that is not a uuid, without querying with it", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverities: [CRITICAL_INCIDENT, "not-a-uuid"],
      }),
    ).rejects.toThrow(/Invalid ID format: "not-a-uuid"/);

    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
    expect(settingsFindBy).not.toHaveBeenCalled();
  });

  test("a repeated severity is one severity, and is counted once", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverities: [
          CRITICAL_INCIDENT,
          CRITICAL_INCIDENT,
          CRITICAL_INCIDENT.toUpperCase(),
        ],
      }),
    ).resolves.toBeDefined();

    expect(
      includedIds(
        countCalls(incidentSeverityCountBy)[0]!["query"] as JSONObject,
      ),
    ).toEqual([CRITICAL_INCIDENT]);
  });

  test("every shape a relation value arrives in is understood", async () => {
    const asModel: IncidentSeverity = new IncidentSeverity();
    asModel._id = MINOR_INCIDENT;

    await create({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      incidentSeverities: [
        CRITICAL_INCIDENT,
        new ObjectID(MAJOR_INCIDENT),
        { _id: MINOR_INCIDENT },
        { id: CRITICAL_INCIDENT },
        asModel,
      ],
    });

    expect(
      includedIds(
        countCalls(incidentSeverityCountBy)[0]!["query"] as JSONObject,
      ),
    ).toEqual([CRITICAL_INCIDENT, MAJOR_INCIDENT, MINOR_INCIDENT].sort());
  });

  test.each([
    ["not sent", undefined],
    ["null", null],
    ["empty", []],
  ])(
    "severities %s mean every severity, and read no severity table",
    async (_label: string, severities: unknown) => {
      await create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverities: severities,
      });

      expect(incidentSeverityCountBy).not.toHaveBeenCalled();
      expect(alertSeverityCountBy).not.toHaveBeenCalled();
    },
  );
});

describe("TeamComplianceSettingService onBeforeCreate - exact duplicates are refused", () => {
  test("the duplicate lookup reads the team's rules of that type in the project, as root", async () => {
    await create({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
    });

    expect(settingsFindBy).toHaveBeenCalledTimes(1);

    const findBy: JSONObject = findByCalls()[0]!;
    expect(findBy["query"]).toEqual({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    });
    expect(findBy["select"]).toEqual({
      _id: true,
      ruleType: true,
      notificationChannel: true,
      incidentSeverities: { _id: true },
      alertSeverities: { _id: true },
    });
    expect(findBy["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(findBy["skip"]).toBe(0);
    // The existing row may be one the caller cannot see.
    expect(findBy["props"]).toEqual({ isRoot: true });
  });

  test("the message tells the user what to do instead", () => {
    expect(DUPLICATE_COMPLIANCE_RULE_MESSAGE).toBe(
      "This team already has a compliance rule that checks exactly the same thing. Edit that rule instead of adding another.",
    );
  });

  test.each<[string, StoredRuleInput, NewRuleInput]>([
    [
      "the same channel and severities",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL_INCIDENT],
      },
    ],
    [
      "the same severities in another order, with repeats",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [MAJOR_INCIDENT, CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [
          { _id: CRITICAL_INCIDENT },
          { _id: MAJOR_INCIDENT },
          { _id: CRITICAL_INCIDENT },
        ],
      },
    ],
    [
      "the same severity ids in upper case",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
        alertSeverityIds: [CRITICAL_ALERT],
      },
      {
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
        alertSeverities: [CRITICAL_ALERT.toUpperCase()],
      },
    ],
    [
      "a legacy rule: no channel, every severity",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      },
    ],
    [
      "a legacy rule, with the options sent explicitly empty",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
      },
      {
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: null,
        alertSeverities: [],
      },
    ],
    [
      "a legacy method rule",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      },
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      },
    ],
    [
      "a method rule sent with a stray channel and severities, which it does not use",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasNotificationCallMethod,
      },
      {
        ruleType: ComplianceRuleType.HasNotificationCallMethod,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      },
    ],
    [
      "a stored rule carrying stray options of the other kind, which never counted",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        alertSeverityIds: [CRITICAL_ALERT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      },
    ],
    [
      "a stored rule whose channel is garbage, which reads as 'any channel'",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: "Pager",
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      },
    ],
    [
      "the same episode rule",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Webhook,
        alertSeverityIds: [MAJOR_ALERT, CRITICAL_ALERT],
      },
      {
        ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Webhook,
        alertSeverities: [CRITICAL_ALERT, MAJOR_ALERT],
      },
    ],
  ])(
    "refuses %s",
    async (
      _label: string,
      existing: StoredRuleInput,
      incoming: NewRuleInput,
    ) => {
      store(existing);

      await expect(create(incoming)).rejects.toThrow(
        new BadDataException(DUPLICATE_COMPLIANCE_RULE_MESSAGE),
      );
    },
  );

  test.each<[string, StoredRuleInput, NewRuleInput]>([
    [
      "another channel for the same severities",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
        incidentSeverities: [CRITICAL_INCIDENT],
      },
    ],
    [
      "'any channel' next to a Call rule",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: null,
        incidentSeverities: [CRITICAL_INCIDENT],
      },
    ],
    [
      "a Call rule next to a legacy 'any channel' rule",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
      },
    ],
    [
      "a wider severity set",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL_INCIDENT, MAJOR_INCIDENT],
      },
    ],
    [
      "every severity next to one severity",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
        alertSeverityIds: [CRITICAL_ALERT],
      },
      {
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
      },
    ],
    [
      "the same scope on the episode rule type",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL_INCIDENT],
      },
    ],
    [
      "the same rule on another team",
      {
        id: SIBLING_SETTING_ID,
        teamId: OTHER_TEAM_ID,
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      },
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      },
    ],
    [
      "another method rule",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      },
      {
        ruleType: ComplianceRuleType.HasNotificationSMSMethod,
      },
    ],
  ])(
    "allows %s",
    async (
      _label: string,
      existing: StoredRuleInput,
      incoming: NewRuleInput,
    ) => {
      store(existing);

      await expect(create(incoming)).resolves.toBeDefined();
    },
  );

  test("a team with the same team id in another project does not block the rule", async () => {
    store({
      id: OTHER_PROJECT_SETTING_ID,
      projectId: OTHER_PROJECT_ID,
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    });

    await expect(
      create({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
    ).resolves.toBeDefined();
  });

  test("several rules of one type can live side by side, and only the exact one is refused", async () => {
    store(
      {
        id: "66666666-6666-4666-8666-00000000000a",
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: "66666666-6666-4666-8666-00000000000b",
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: "66666666-6666-4666-8666-00000000000c",
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      },
    );

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.SMS,
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });
});

/*
 * ---------------------------------------------------------------------------
 * update
 * ---------------------------------------------------------------------------
 */

const INCIDENT_CALL_CRITICAL: StoredRuleInput = {
  id: SETTING_ID,
  ruleType: ComplianceRuleType.HasIncidentOnCallRules,
  notificationChannel: ComplianceNotificationChannel.Call,
  incidentSeverityIds: [CRITICAL_INCIDENT],
};

describe("TeamComplianceSettingService onBeforeUpdate - updates that do not touch the scope", () => {
  test.each([
    ["switching a rule off", { enabled: false }],
    ["switching a rule on", { enabled: true }],
    ["editing the unused options JSON", { options: { note: "x" } }],
  ])(
    "%s reads nothing and passes the update through untouched",
    async (_label: string, data: Record<string, unknown>) => {
      store(INCIDENT_CALL_CRITICAL);

      const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
        ...data,
      });

      const result: OnUpdate<TeamComplianceSetting> =
        await onBeforeUpdate(updateBy);

      expect(result.updateBy).toBe(updateBy);
      expect(result.carryForward).toBeNull();
      expect(dataOf(result.updateBy)).toEqual(data);
      expectNoReads();
    },
  );

  test("a disable never fails because of the rule's configuration - even on a rule whose stored type is garbage", async () => {
    store({ id: SETTING_ID, ruleType: "RequireTwoFactorAuth" });

    await expect(update({ enabled: false })).resolves.toBeDefined();
    expectNoReads();
  });
});

describe("TeamComplianceSettingService onBeforeUpdate - refusals before any read", () => {
  test.each([
    ["an unknown rule type", { ruleType: "RequireTwoFactorAuth" }],
    ["a null rule type", { ruleType: null }],
    ["an unknown channel", { notificationChannel: "Pager" }],
    ["a channel in the wrong case", { notificationChannel: "push" }],
  ])("refuses %s", async (_label: string, data: Record<string, unknown>) => {
    store(INCIDENT_CALL_CRITICAL);

    await expect(update(data)).rejects.toThrow(BadDataException);
    expectNoReads();
  });
});

describe("TeamComplianceSettingService onBeforeUpdate - scope changes", () => {
  test("reads the rows being changed inside the caller's project, as root, with what their scope needs", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await update({ notificationChannel: ComplianceNotificationChannel.Push });

    const existingRead: JSONObject = findByCalls()[0]!;
    expect(existingRead["query"]).toEqual({
      _id: SETTING_ID,
      projectId: PROJECT_ID,
    });
    expect(existingRead["select"]).toEqual({
      _id: true,
      teamId: true,
      projectId: true,
      ruleType: true,
      notificationChannel: true,
      incidentSeverities: { _id: true },
      alertSeverities: { _id: true },
    });
    expect(existingRead["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(existingRead["skip"]).toBe(0);
    expect(existingRead["props"]).toEqual({ isRoot: true });
  });

  test("does not copy the caller's own query object when adding the project", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannel: ComplianceNotificationChannel.Push,
    });

    await onBeforeUpdate(updateBy);

    expect(updateBy.query).toEqual({ _id: SETTING_ID });
  });

  test("a rule in another project is invisible: nothing is checked, nothing leaks", async () => {
    store({
      ...INCIDENT_CALL_CRITICAL,
      id: OTHER_PROJECT_SETTING_ID,
      projectId: OTHER_PROJECT_ID,
    });
    // A rule in the caller's project that the other one would duplicate.
    store({
      ...INCIDENT_CALL_CRITICAL,
      id: SIBLING_SETTING_ID,
      notificationChannel: ComplianceNotificationChannel.Push,
    });

    await expect(
      onBeforeUpdate(
        updateByFor(
          { notificationChannel: ComplianceNotificationChannel.Push },
          { query: { _id: OTHER_PROJECT_SETTING_ID } },
        ),
      ),
    ).resolves.toBeDefined();

    expect(findByCalls()[0]?.["query"]).toEqual({
      _id: OTHER_PROJECT_SETTING_ID,
      projectId: PROJECT_ID,
    });
    expect(siblingReads()).toEqual([]);
    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
  });

  test("a root update without a tenant reads by the update's own query", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await onBeforeUpdate(
      updateByFor(
        { notificationChannel: ComplianceNotificationChannel.Push },
        { props: { isRoot: true } },
      ),
    );

    expect(findByCalls()[0]?.["query"]).toEqual({ _id: SETTING_ID });
    // The row's own project scopes the checks.
    expect(siblingReads()[0]?.["query"]).toMatchObject({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
    });
  });

  test("compares against the team's other rules, never against the row itself", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await update({ notificationChannel: ComplianceNotificationChannel.Push });

    const siblings: Array<JSONObject> = siblingReads();
    expect(siblings).toHaveLength(1);

    const query: JSONObject = siblings[0]!["query"] as JSONObject;
    expect(String(query["teamId"])).toBe(TEAM_ID.toString());
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query["ruleType"]).toBe(ComplianceRuleType.HasIncidentOnCallRules);

    const excluded: unknown = query["_id"];
    expect(excluded).toBeInstanceOf(FindOperator);
    expect(
      Object.values(
        (excluded as FindOperator<unknown>).objectLiteralParameters || {},
      ),
    ).toEqual([SETTING_ID]);
    expect(siblings[0]!["props"]).toEqual({ isRoot: true });
  });

  test("re-saving a rule unchanged - what the edit form does - is not a duplicate of itself", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await expect(
      update({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [{ _id: CRITICAL_INCIDENT }],
        alertSeverities: [],
        enabled: true,
      }),
    ).resolves.toBeDefined();
  });

  test("refuses a change that makes the rule identical to another rule of the team", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      ...INCIDENT_CALL_CRITICAL,
      id: SIBLING_SETTING_ID,
      notificationChannel: ComplianceNotificationChannel.Push,
    });

    await expect(
      update({ notificationChannel: ComplianceNotificationChannel.Push }),
    ).rejects.toThrow(new BadDataException(DUPLICATE_COMPLIANCE_RULE_MESSAGE));
  });

  test("the scope is the update merged over what is stored: a severity change keeps the stored channel", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      ...INCIDENT_CALL_CRITICAL,
      id: SIBLING_SETTING_ID,
      incidentSeverityIds: [MAJOR_INCIDENT],
    });

    // Call + [Major] exists already; changing only the severities collides.
    await expect(
      update({ incidentSeverities: [MAJOR_INCIDENT] }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

    // Call + [Minor] does not.
    await expect(
      update({ incidentSeverities: [MINOR_INCIDENT] }),
    ).resolves.toBeDefined();
  });

  test("a channel change keeps the stored severities", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.SMS,
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(
      update({ notificationChannel: ComplianceNotificationChannel.SMS }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });

  test("clearing the channel back to 'any channel' is a scope change and is checked", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(update({ notificationChannel: null })).rejects.toThrow(
      DUPLICATE_COMPLIANCE_RULE_MESSAGE,
    );
  });

  test("new severities are validated against the rule's project", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await expect(
      update({ incidentSeverities: [FOREIGN_INCIDENT] }),
    ).rejects.toThrow(new BadDataException(FOREIGN_INCIDENT_SEVERITY_MESSAGE));

    expect(countCalls(incidentSeverityCountBy)[0]?.["query"]).toMatchObject({
      projectId: PROJECT_ID,
    });
    expect(siblingReads()).toEqual([]);
  });

  test("an invalid severity id in an update is refused", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await expect(
      update({ incidentSeverities: ["not-a-uuid"] }),
    ).rejects.toThrow(/Invalid ID format/);
  });

  test("a rule whose stored type is not recognised is skipped, not failed", async () => {
    store({
      id: SETTING_ID,
      ruleType: "RequireTwoFactorAuth",
      notificationChannel: ComplianceNotificationChannel.Call,
    });

    await expect(
      update({ notificationChannel: ComplianceNotificationChannel.Push }),
    ).resolves.toBeDefined();

    expect(siblingReads()).toEqual([]);
    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
  });

  test.each([
    ["no team", { omitTeam: true }],
    ["no project", { omitProject: true }],
  ])(
    "a stored row with %s is skipped",
    async (_label: string, broken: Partial<StoredRuleInput>) => {
      store({ ...INCIDENT_CALL_CRITICAL, ...broken });

      await expect(
        onBeforeUpdate(
          updateByFor(
            { notificationChannel: ComplianceNotificationChannel.Push },
            { props: { isRoot: true } },
          ),
        ),
      ).resolves.toBeDefined();

      expect(siblingReads()).toEqual([]);
    },
  );

  test("every row an update matches is checked against its own team", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      ...INCIDENT_CALL_CRITICAL,
      id: SIBLING_SETTING_ID,
      teamId: OTHER_TEAM_ID,
    });

    await onBeforeUpdate(
      updateByFor(
        { notificationChannel: ComplianceNotificationChannel.Push },
        {
          query: {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          },
        },
      ),
    );

    expect(
      siblingReads().map((read: JSONObject): string => {
        return String((read["query"] as JSONObject)["teamId"]);
      }),
    ).toEqual([TEAM_ID.toString(), OTHER_TEAM_ID.toString()]);
  });
});

describe("TeamComplianceSettingService onBeforeUpdate - a rule type change", () => {
  test("to a method rule clears the channel and every severity, including the ones already stored", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      notificationChannel: null,
      incidentSeverities: [],
      alertSeverities: [],
    });
    // Nothing left to validate; the duplicate lookup is for the new type.
    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
    expect(
      (siblingReads()[0]?.["query"] as JSONObject | undefined)?.["ruleType"],
    ).toBe(ComplianceRuleType.HasNotificationEmailMethod);
  });

  test("to a method rule collides with an existing rule of that type", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    });

    await expect(
      update({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });

  test("from incident to alert drops the incident severities and keeps the channel", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      incidentSeverities: [],
    });
    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
    expect(alertSeverityCountBy).not.toHaveBeenCalled();
  });

  test("from incident to alert is judged as 'Call for every alert severity'", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
    });

    await expect(
      update({ ruleType: ComplianceRuleType.HasAlertOnCallRules }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });

  test("from incident to alert with new alert severities validates those", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await expect(
      update({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        alertSeverities: [FOREIGN_ALERT],
      }),
    ).rejects.toThrow(FOREIGN_ALERT_SEVERITY_MESSAGE);

    await expect(
      update({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        alertSeverities: [CRITICAL_ALERT],
      }),
    ).resolves.toBeDefined();
  });

  test("to the incident episode rule keeps the stored incident scope and re-validates it", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      alertSeverities: [],
    });
    expect(
      includedIds(
        countCalls(incidentSeverityCountBy)[0]!["query"] as JSONObject,
      ),
    ).toEqual([CRITICAL_INCIDENT]);
    expect(
      (siblingReads()[0]?.["query"] as JSONObject | undefined)?.["ruleType"],
    ).toBe(ComplianceRuleType.HasIncidentEpisodeOnCallRules);
  });

  test("an unknown stored type can be repaired by setting a real one", async () => {
    store({ id: SETTING_ID, ruleType: "RequireTwoFactorAuth" });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasNotificationPushMethod,
    });

    await expect(onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(siblingReads()).toHaveLength(1);
  });
});

describe("TeamComplianceSettingService onBeforeUpdate - options the stored type does not use", () => {
  test("alert severities sent for an incident rule are dropped, not stored unvalidated", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      alertSeverities: [{ _id: FOREIGN_ALERT }],
    });

    await expect(onBeforeUpdate(updateBy)).resolves.toBeDefined();

    expect(dataOf(updateBy)["alertSeverities"]).toEqual([]);
    expect(alertSeverityCountBy).not.toHaveBeenCalled();
  });

  test("a channel sent for a method rule is dropped", async () => {
    store({
      id: SETTING_ID,
      ruleType: ComplianceRuleType.HasNotificationSMSMethod,
    });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [CRITICAL_INCIDENT],
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      notificationChannel: null,
      incidentSeverities: [],
    });
  });

  test("options the type does use are kept, the severities as the ids they name", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannel: ComplianceNotificationChannel.Push,
      incidentSeverities: [{ _id: MAJOR_INCIDENT }],
    });

    await onBeforeUpdate(updateBy);

    expect(Object.keys(dataOf(updateBy)).sort()).toEqual([
      "incidentSeverities",
      "notificationChannel",
    ]);
    expect(dataOf(updateBy)["notificationChannel"]).toBe(
      ComplianceNotificationChannel.Push,
    );
    expect(
      writtenIds(dataOf(updateBy)["incidentSeverities"], IncidentSeverity),
    ).toEqual([MAJOR_INCIDENT]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The severities that are checked are the severities that are written.
 * ---------------------------------------------------------------------------
 *
 * The relation save writes whatever DatabaseService.sanitizeCreateOrUpdate
 * reads out of each list item, and inserts one join row per item. The hooks
 * used to check their OWN reading of the list and hand the list on as sent,
 * so the two could disagree: an item the save reads by its `id` was checked
 * by its `_id` or not at all - which let another project's severity through -
 * and a repeat the check counted once was inserted twice, which the join
 * table's primary key refuses.
 */

describe("TeamComplianceSettingService - the severities checked are the severities written", () => {
  test("create: repeats and case collapse to one lower-case id each, handed to the save as models", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [
        CRITICAL_INCIDENT.toUpperCase(),
        { _id: CRITICAL_INCIDENT },
        new ObjectID(MAJOR_INCIDENT),
        CRITICAL_INCIDENT,
      ],
    });

    expect(
      writtenIds(result.createBy.data.incidentSeverities, IncidentSeverity),
    ).toEqual([CRITICAL_INCIDENT, MAJOR_INCIDENT]);
    expect(
      includedIds(
        countCalls(incidentSeverityCountBy)[0]!["query"] as JSONObject,
      ),
    ).toEqual([CRITICAL_INCIDENT, MAJOR_INCIDENT]);
  });

  test("create: an alert list is written as alert severities", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      alertSeverities: [{ id: MAJOR_ALERT }, MAJOR_ALERT.toUpperCase()],
    });

    expect(
      writtenIds(result.createBy.data.alertSeverities, AlertSeverity),
    ).toEqual([MAJOR_ALERT]);
  });

  test("update: the list sent is normalised once, and each row is checked against exactly that", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      incidentSeverities: [
        { _id: MAJOR_INCIDENT },
        { _id: MAJOR_INCIDENT.toUpperCase() },
      ],
    });

    await onBeforeUpdate(updateBy);

    expect(
      writtenIds(dataOf(updateBy)["incidentSeverities"], IncidentSeverity),
    ).toEqual([MAJOR_INCIDENT]);
    expect(
      includedIds(
        countCalls(incidentSeverityCountBy)[0]!["query"] as JSONObject,
      ),
    ).toEqual([MAJOR_INCIDENT]);
  });

  test("update: a multi-row update over rows of both kinds normalises both lists it sends", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Push,
      alertSeverityIds: [CRITICAL_ALERT],
    });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor(
      {
        incidentSeverities: [MAJOR_INCIDENT, MAJOR_INCIDENT],
        alertSeverities: [MAJOR_ALERT.toUpperCase(), { _id: MAJOR_ALERT }],
      },
      { query: { teamId: TEAM_ID } },
    );

    await onBeforeUpdate(updateBy);

    expect(
      writtenIds(dataOf(updateBy)["incidentSeverities"], IncidentSeverity),
    ).toEqual([MAJOR_INCIDENT]);
    expect(
      writtenIds(dataOf(updateBy)["alertSeverities"], AlertSeverity),
    ).toEqual([MAJOR_ALERT]);
  });

  const READ_BY_ID: Array<[string, JSONObject]> = [
    ["a number _id", { _id: 1, id: FOREIGN_INCIDENT }],
    ["a boolean _id", { _id: true, id: FOREIGN_INCIDENT }],
    [
      "an ObjectID _id naming this project's own severity",
      {
        _id: new ObjectID(CRITICAL_INCIDENT) as unknown as JSONObject,
        id: FOREIGN_INCIDENT,
      },
    ],
    ["an object _id", { _id: {}, id: FOREIGN_INCIDENT }],
  ];

  test.each(READ_BY_ID)(
    "update: an item with %s is read by its id, as the save reads it - so another project's severity is refused",
    async (_label: string, item: JSONObject) => {
      store(INCIDENT_CALL_CRITICAL);

      await expect(update({ incidentSeverities: [item] })).rejects.toThrow(
        FOREIGN_INCIDENT_SEVERITY_MESSAGE,
      );

      expect(
        includedIds(
          countCalls(incidentSeverityCountBy)[0]!["query"] as JSONObject,
        ),
      ).toEqual([FOREIGN_INCIDENT]);
    },
  );

  test.each(READ_BY_ID)(
    "create: an item with %s is read by its id too",
    async (_label: string, item: JSONObject) => {
      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [item],
        }),
      ).rejects.toThrow(FOREIGN_INCIDENT_SEVERITY_MESSAGE);
    },
  );

  test("the same trick cannot dodge the duplicate check: a rule is compared by the id that would be written", async () => {
    store({ ...INCIDENT_CALL_CRITICAL, id: SIBLING_SETTING_ID });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [{ _id: 1, id: CRITICAL_INCIDENT }],
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });

  const DROPPED_BY_THE_SAVE: Array<[string, unknown]> = [
    [
      "an ObjectID _id and no id (the save drops it: the rule would become 'every severity')",
      { _id: new ObjectID(CRITICAL_INCIDENT) },
    ],
    ["a boolean _id and no id", { _id: true }],
    ["an empty object", {}],
    ["a name and no id", { name: "Critical" }],
    ["a number", 7],
    ["null", null],
    ["a nested list", [CRITICAL_INCIDENT]],
    ["a model with no id", new IncidentSeverity()],
  ];

  test.each(DROPPED_BY_THE_SAVE)(
    "create: an item that names no severity - %s - is refused before anything is read",
    async (_label: string, item: unknown) => {
      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [CRITICAL_INCIDENT, item],
        }),
      ).rejects.toThrow(
        new BadDataException(
          "Every incident severity of a compliance rule must be a severity id.",
        ),
      );

      expectNoReads();
    },
  );

  test.each(DROPPED_BY_THE_SAVE)(
    "update: an item that names no severity - %s - is refused, and nothing is checked or written",
    async (_label: string, item: unknown) => {
      store(INCIDENT_CALL_CRITICAL);

      await expect(
        update({ incidentSeverities: [MAJOR_INCIDENT, item] }),
      ).rejects.toThrow(
        "Every incident severity of a compliance rule must be a severity id.",
      );

      expect(incidentSeverityCountBy).not.toHaveBeenCalled();
      expect(siblingReads()).toEqual([]);
    },
  );

  test("the refusal names the list's own kind", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        alertSeverities: [{ _id: true }],
      }),
    ).rejects.toThrow(
      "Every alert severity of a compliance rule must be a severity id.",
    );
  });

  test.each([
    ["an id string", CRITICAL_INCIDENT],
    ["a single {_id}", { _id: CRITICAL_INCIDENT }],
    ["a number", 3],
  ])(
    "a severity 'list' that is %s is refused - the save would ignore it, the check read it as every severity",
    async (_label: string, value: unknown) => {
      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: value,
        }),
      ).rejects.toThrow(
        "The incident severities of a compliance rule must be a list of severity ids.",
      );

      store(INCIDENT_CALL_CRITICAL);

      await expect(update({ incidentSeverities: value })).rejects.toThrow(
        "The incident severities of a compliance rule must be a list of severity ids.",
      );
    },
  );

  test("null is an empty list, and is written as one", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      incidentSeverities: null,
    });

    expect(result.createBy.data.incidentSeverities).toEqual([]);
  });

  test("a list that is not sent stays unsent", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    });

    expect(modelValue(result.createBy.data, "incidentSeverities")).toBe(
      undefined,
    );
    expect(modelValue(result.createBy.data, "alertSeverities")).toBe(undefined);
  });
});

type SanitizeFunction = (
  data: JSONObject,
  props: DatabaseCommonInteractionProps,
  isUpdate: boolean,
) => Promise<JSONObject>;

/*
 * The valid severity ids DatabaseService.sanitizeCreateOrUpdate - what the
 * relation save writes from - reads out of an incident severity list,
 * trimmed and lower-cased.
 */
const writtenBySave: (list: Array<unknown>) => Promise<Array<string>> = async (
  list: Array<unknown>,
): Promise<Array<string>> => {
  const service: TeamComplianceSettingServiceClass =
    new TeamComplianceSettingServiceClass();

  const sanitized: JSONObject = await (
    service as unknown as { sanitizeCreateOrUpdate: SanitizeFunction }
  ).sanitizeCreateOrUpdate(
    { incidentSeverities: list } as JSONObject,
    { isRoot: true },
    true,
  );

  const written: unknown = sanitized["incidentSeverities"];

  return (Array.isArray(written) ? written : [])
    .map((item: unknown): string => {
      return String((item as { _id?: unknown })._id)
        .trim()
        .toLowerCase();
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });
};

const resolveOrNull: (item: unknown) => Array<string> | null = (
  item: unknown,
): Array<string> | null => {
  try {
    return TeamComplianceSettingServiceClass.resolveSentSeverityIds(
      [item],
      ComplianceSeverityKind.Incident,
    );
  } catch {
    return null;
  }
};

const MAJOR_INCIDENT_MODEL: IncidentSeverity = new IncidentSeverity();
MAJOR_INCIDENT_MODEL._id = MAJOR_INCIDENT;

describe("TeamComplianceSettingService.resolveSentSeverityIds", () => {
  test("reads an item exactly as the relation save does: id string or ObjectID, else a string _id, else a string id", () => {
    const model: IncidentSeverity = new IncidentSeverity();
    model._id = MINOR_INCIDENT;

    expect(
      TeamComplianceSettingServiceClass.resolveSentSeverityIds(
        [
          CRITICAL_INCIDENT,
          new ObjectID(MAJOR_INCIDENT),
          model,
          { _id: CRITICAL_ALERT, id: FOREIGN_INCIDENT },
          { _id: 1, id: MAJOR_ALERT },
          { _id: new ObjectID(FOREIGN_ALERT), id: FOREIGN_INCIDENT },
        ],
        ComplianceSeverityKind.Incident,
      ),
    ).toEqual([
      CRITICAL_INCIDENT,
      MAJOR_INCIDENT,
      MINOR_INCIDENT,
      CRITICAL_ALERT,
      MAJOR_ALERT,
      FOREIGN_INCIDENT,
    ]);
  });

  test("trims, lower-cases and de-duplicates, keeping the first occurrence", () => {
    expect(
      TeamComplianceSettingServiceClass.resolveSentSeverityIds(
        [
          MINOR_INCIDENT,
          ` ${CRITICAL_INCIDENT.toUpperCase()} `,
          CRITICAL_INCIDENT,
          { _id: MINOR_INCIDENT },
          MAJOR_INCIDENT,
        ],
        ComplianceSeverityKind.Incident,
      ),
    ).toEqual([MINOR_INCIDENT, CRITICAL_INCIDENT, MAJOR_INCIDENT]);
  });

  test("null and an empty list are empty", () => {
    for (const value of [null, []]) {
      expect(
        TeamComplianceSettingServiceClass.resolveSentSeverityIds(
          value,
          ComplianceSeverityKind.Alert,
        ),
      ).toEqual([]);
    }
  });

  test("an id that is not a uuid is refused by name", () => {
    expect(() => {
      TeamComplianceSettingServiceClass.resolveSentSeverityIds(
        ["not-a-uuid"],
        ComplianceSeverityKind.Incident,
      );
    }).toThrow(/Invalid ID format: "not-a-uuid"/);

    for (const blank of ["", "   "]) {
      expect(() => {
        TeamComplianceSettingServiceClass.resolveSentSeverityIds(
          [blank],
          ComplianceSeverityKind.Incident,
        );
      }).toThrow(/Invalid ID format/);
    }
  });

  /*
   * The property the hooks rely on, against the real sanitizer: whatever id
   * this reads from an item is the id the save would write for it, and an
   * item it refuses is one the save would write no severity for at all.
   */
  test.each<[string, unknown]>([
    ["an id string", CRITICAL_INCIDENT],
    ["an upper-case id string", MAJOR_INCIDENT.toUpperCase()],
    ["an ObjectID", new ObjectID(MINOR_INCIDENT)],
    ["{_id}", { _id: CRITICAL_INCIDENT }],
    ["{id}", { id: MAJOR_INCIDENT }],
    ["{_id, id}", { _id: CRITICAL_INCIDENT, id: FOREIGN_INCIDENT }],
    ["{_id: number, id}", { _id: 1, id: FOREIGN_INCIDENT }],
    ["{_id: true, id}", { _id: true, id: FOREIGN_INCIDENT }],
    [
      "{_id: ObjectID, id}",
      { _id: new ObjectID(CRITICAL_INCIDENT), id: FOREIGN_INCIDENT },
    ],
    ["{_id: {}, id}", { _id: {}, id: FOREIGN_INCIDENT }],
    ["{_id: ObjectID} alone", { _id: new ObjectID(CRITICAL_INCIDENT) }],
    ["{_id: true} alone", { _id: true }],
    ["{_id: ''} and an id", { _id: "", id: MINOR_INCIDENT }],
    ["{}", {}],
    ["{name}", { name: "Critical" }],
    ["a number", 7],
    ["null", null],
    ["a nested list", [CRITICAL_INCIDENT]],
    ["a model with an id", MAJOR_INCIDENT_MODEL],
    ["a model with no id", new IncidentSeverity()],
    ["not a uuid", "not-a-uuid"],
    ["an empty string", ""],
  ])(
    "%s: the id it reads is the id the save writes",
    async (_label: string, item: unknown) => {
      const resolved: Array<string> | null = resolveOrNull(item);
      const written: Array<string> = await writtenBySave([item]);

      expect(resolved === null ? [] : resolved).toEqual(written);
    },
  );

  test("a list the hooks have normalised is written by the save exactly as it was checked", async () => {
    const createBy: CreateBy<TeamComplianceSetting> = createByFor(
      newRule({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverities: [
          { _id: 1, id: MAJOR_INCIDENT },
          CRITICAL_INCIDENT.toUpperCase(),
          { id: CRITICAL_INCIDENT },
          new ObjectID(MAJOR_INCIDENT),
        ],
      }),
    );

    await onBeforeCreate(createBy);

    const checked: Array<string> = includedIds(
      countCalls(incidentSeverityCountBy)[0]!["query"] as JSONObject,
    );

    expect(
      await writtenBySave(
        createBy.data.incidentSeverities as unknown as Array<unknown>,
      ),
    ).toEqual([MAJOR_INCIDENT, CRITICAL_INCIDENT]);
    expect([...checked].sort()).toEqual(
      [MAJOR_INCIDENT, CRITICAL_INCIDENT].sort(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Who may ask.
 * ---------------------------------------------------------------------------
 *
 * DatabaseService checks a caller's create and update permission only AFTER
 * these hooks, and the hooks read as root in whichever project the request
 * names. Their refusals - "that severity is not in this project", "that team
 * already has this rule" - described another project's severities and rules
 * to anyone signed in who named it. The hooks now make the same permission
 * check first.
 */

describe("TeamComplianceSettingService - the caller's permission is checked before anything is read", () => {
  const OUTSIDERS: Array<[string, DatabaseCommonInteractionProps]> = [
    ["a signed-in user with no permission in the project", OUTSIDER_PROPS],
    [
      "a member who may only read the project's teams",
      memberProps([Permission.ProjectMember, Permission.ReadProjectTeam]),
    ],
    [
      "a team editor of another project who names this one",
      {
        ...memberProps(
          [Permission.ReadProjectTeam, Permission.EditProjectTeam],
          OTHER_PROJECT_ID,
        ),
        tenantId: PROJECT_ID,
      },
    ],
  ];

  test.each(OUTSIDERS)(
    "create: %s is refused before any severity or rule is read, so the refusal says nothing about the project",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      // A rule the probe below would duplicate.
      store({ ...INCIDENT_CALL_CRITICAL, id: SIBLING_SETTING_ID });

      await expect(
        onBeforeCreate(
          createByFor(
            newRule({
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: [FOREIGN_INCIDENT],
            }),
            props,
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);

      await expect(
        onBeforeCreate(
          createByFor(
            newRule({
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: [CRITICAL_INCIDENT],
            }),
            props,
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);

      expectNoReads();
    },
  );

  test.each(OUTSIDERS)(
    "update: %s changing a rule's scope is refused before anything is read",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      store(INCIDENT_CALL_CRITICAL, {
        ...INCIDENT_CALL_CRITICAL,
        id: SIBLING_SETTING_ID,
        notificationChannel: ComplianceNotificationChannel.Push,
      });

      for (const data of [
        { incidentSeverities: [FOREIGN_INCIDENT] },
        { notificationChannel: ComplianceNotificationChannel.Push },
      ]) {
        await expect(
          onBeforeUpdate(updateByFor({ ...data }, { props: props })),
        ).rejects.toThrow(NotAuthorizedException);
      }

      expectNoReads();
    },
  );

  test.each(OUTSIDERS)(
    "update: %s toggling a rule gets nothing from this hook - it reads nothing, and _updateBy's own check refuses the write",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      store(INCIDENT_CALL_CRITICAL);

      await expect(
        onBeforeUpdate(updateByFor({ enabled: false }, { props: props })),
      ).resolves.toBeDefined();

      expectNoReads();
    },
  );

  const EDITORS: Array<[string, DatabaseCommonInteractionProps]> = [
    ["a team editor", EDITOR_PROPS],
    ["a project admin", memberProps([Permission.ProjectAdmin])],
    ["a project owner", memberProps([Permission.ProjectOwner])],
  ];

  test.each(EDITORS)(
    "create: %s passes, and what the hook leaves - cleared options included - passes the create check DatabaseService repeats",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      for (const input of [
        {
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          notificationChannel: ComplianceNotificationChannel.SMS,
          incidentSeverities: [FOREIGN_INCIDENT],
          alertSeverities: [FOREIGN_ALERT],
        },
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [CRITICAL_INCIDENT, CRITICAL_INCIDENT],
          alertSeverities: [FOREIGN_ALERT],
        },
      ]) {
        const result: OnCreate<TeamComplianceSetting> = await onBeforeCreate(
          createByFor(newRule(input), props),
        );

        expect((): void => {
          ModelPermission.checkCreatePermissions(
            TeamComplianceSetting,
            result.createBy.data,
            props,
          );
        }).not.toThrow();
      }
    },
  );

  test("create: Edit Teams on its own is enough to create a rule", async () => {
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.EditProjectTeam,
    ]);

    const result: OnCreate<TeamComplianceSetting> = await onBeforeCreate(
      createByFor(
        newRule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          alertSeverities: [CRITICAL_ALERT],
          incidentSeverities: [CRITICAL_INCIDENT],
        }),
        props,
      ),
    );

    expect((): void => {
      ModelPermission.checkCreatePermissions(
        TeamComplianceSetting,
        result.createBy.data,
        props,
      );
    }).not.toThrow();
  });

  test.each(EDITORS)(
    "update: %s passes, and what the hook leaves passes the update check _updateBy repeats",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      store(INCIDENT_CALL_CRITICAL);

      for (const data of [
        { ruleType: ComplianceRuleType.HasNotificationEmailMethod },
        {
          incidentSeverities: [{ _id: MAJOR_INCIDENT }, MAJOR_INCIDENT],
          alertSeverities: [FOREIGN_ALERT],
        },
        { notificationChannel: null },
      ]) {
        const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor(
          { ...data },
          { props: props },
        );

        await onBeforeUpdate(updateBy);

        await expect(
          ModelPermission.checkUpdateQueryPermissions(
            TeamComplianceSetting,
            { _id: SETTING_ID },
            updateBy.data,
            props,
          ),
        ).resolves.toBeDefined();
      }
    },
  );

  test("root and master-admin callers are not put through it", async () => {
    const createCheck: jest.SpyInstance = jest.spyOn(
      ModelPermission,
      "checkCreatePermissions",
    );
    const updateCheck: jest.SpyInstance = jest.spyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    );

    store(INCIDENT_CALL_CRITICAL);

    await onBeforeCreate(
      createByFor(
        newRule({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
        { isRoot: true },
      ),
    );
    await onBeforeCreate(
      createByFor(
        newRule({ ruleType: ComplianceRuleType.HasNotificationPushMethod }),
        { isMasterAdmin: true, userId: USER_ID, tenantId: PROJECT_ID },
      ),
    );
    await onBeforeUpdate(
      updateByFor(
        { notificationChannel: ComplianceNotificationChannel.Push },
        { props: { isRoot: true } },
      ),
    );

    expect(createCheck).not.toHaveBeenCalled();
    expect(updateCheck).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Severity deletes.
 * ---------------------------------------------------------------------------
 *
 * A rule's severity scope lives only in join rows, which cascade away with
 * the severity, and a rule with no severity left reads as a rule for every
 * severity of its kind. IncidentSeverityService and AlertSeverityService ask
 * which rules are scoped only to what they are about to delete, and pause
 * those once the delete has happened.
 */

const RULE_CRITICAL_ONLY: string = "77777777-7777-4777-8777-000000000001";
const RULE_EPISODE_CRITICAL_ONLY: string =
  "77777777-7777-4777-8777-000000000002";
const RULE_CRITICAL_AND_MAJOR: string = "77777777-7777-4777-8777-000000000003";
const RULE_EVERY_SEVERITY: string = "77777777-7777-4777-8777-000000000004";
const RULE_PAUSED: string = "77777777-7777-4777-8777-000000000005";
const RULE_ALERT: string = "77777777-7777-4777-8777-000000000006";
const RULE_METHOD: string = "77777777-7777-4777-8777-000000000007";
const RULE_OTHER_PROJECT: string = "77777777-7777-4777-8777-000000000008";

const deleting: (
  ids: Array<string>,
  project?: ObjectID,
) => Array<DeletedSeverity> = (
  ids: Array<string>,
  project?: ObjectID,
): Array<DeletedSeverity> => {
  return ids.map((id: string): DeletedSeverity => {
    return { _id: id, projectId: project || PROJECT_ID };
  });
};

describe("TeamComplianceSettingService - a severity delete pauses the rules scoped only to it", () => {
  let settingsUpdateBy: jest.SpyInstance;

  beforeEach(() => {
    settingsUpdateBy = jest
      .spyOn(TeamComplianceSettingService, "updateBy")
      .mockResolvedValue(1 as never);

    store(
      {
        id: RULE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: RULE_EPISODE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        notificationChannel: ComplianceNotificationChannel.SMS,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: RULE_CRITICAL_AND_MAJOR,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Push,
        incidentSeverityIds: [CRITICAL_INCIDENT, MAJOR_INCIDENT],
      },
      {
        id: RULE_EVERY_SEVERITY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Email,
      },
      {
        id: RULE_PAUSED,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Slack,
        incidentSeverityIds: [CRITICAL_INCIDENT],
        enabled: false,
      },
      {
        id: RULE_ALERT,
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        alertSeverityIds: [CRITICAL_ALERT],
      },
      {
        // A stray severity on a method rule scopes nothing.
        id: RULE_METHOD,
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: RULE_OTHER_PROJECT,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        projectId: OTHER_PROJECT_ID,
        teamId: OTHER_TEAM_ID,
        incidentSeverityIds: [FOREIGN_INCIDENT],
      },
    );
  });

  test("finds the enabled rules of the severity's kind whose every selected severity is being deleted", async () => {
    expect(
      await TeamComplianceSettingService.getRulesScopedOnlyTo({
        severityKind: ComplianceSeverityKind.Incident,
        severities: deleting([CRITICAL_INCIDENT]),
      }),
    ).toEqual([RULE_CRITICAL_ONLY, RULE_EPISODE_CRITICAL_ONLY]);

    // Deleting both of a rule's severities leaves it with none too.
    expect(
      await TeamComplianceSettingService.getRulesScopedOnlyTo({
        severityKind: ComplianceSeverityKind.Incident,
        severities: deleting([MAJOR_INCIDENT.toUpperCase(), CRITICAL_INCIDENT]),
      }),
    ).toEqual([
      RULE_CRITICAL_ONLY,
      RULE_EPISODE_CRITICAL_ONLY,
      RULE_CRITICAL_AND_MAJOR,
    ]);

    expect(
      await TeamComplianceSettingService.getRulesScopedOnlyTo({
        severityKind: ComplianceSeverityKind.Alert,
        severities: deleting([CRITICAL_ALERT]),
      }),
    ).toEqual([RULE_ALERT]);
  });

  test("reads the project's enabled rules of that kind's types, as root, with their severities", async () => {
    await TeamComplianceSettingService.getRulesScopedOnlyTo({
      severityKind: ComplianceSeverityKind.Alert,
      severities: deleting([CRITICAL_ALERT]),
    });

    expect(settingsFindBy).toHaveBeenCalledTimes(1);

    const read: JSONObject = findByCalls()[0]!;
    const query: JSONObject = read["query"] as JSONObject;

    expect(Object.keys(query).sort()).toEqual([
      "enabled",
      "projectId",
      "ruleType",
    ]);
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query["enabled"]).toBe(true);
    expect((query["ruleType"] as Includes).values).toEqual([
      ComplianceRuleType.HasAlertOnCallRules,
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
    ]);
    expect(read["select"]).toEqual({
      _id: true,
      ruleType: true,
      enabled: true,
      incidentSeverities: { _id: true },
      alertSeverities: { _id: true },
    });
    expect(read["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(read["props"]).toEqual({ isRoot: true });
  });

  test("a delete across projects checks each project's rules against its own severities", async () => {
    expect(
      await TeamComplianceSettingService.getRulesScopedOnlyTo({
        severityKind: ComplianceSeverityKind.Incident,
        severities: [
          ...deleting([FOREIGN_INCIDENT]),
          ...deleting([FOREIGN_INCIDENT], OTHER_PROJECT_ID),
        ],
      }),
    ).toEqual([RULE_OTHER_PROJECT]);

    expect(settingsFindBy).toHaveBeenCalledTimes(2);
  });

  test("nothing being deleted reads nothing", async () => {
    expect(
      await TeamComplianceSettingService.getRulesScopedOnlyTo({
        severityKind: ComplianceSeverityKind.Incident,
        severities: [{ _id: CRITICAL_INCIDENT }, { projectId: PROJECT_ID }],
      }),
    ).toEqual([]);

    expect(settingsFindBy).not.toHaveBeenCalled();
  });

  test("after the delete: pauses, in one enabled-only root update, the named rules left with no severity of their kind", async () => {
    // What the cascade leaves behind.
    storedSettings = [];
    store(
      {
        id: RULE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      {
        id: RULE_EPISODE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      },
      {
        // Re-scoped in the meantime: it has a severity again.
        id: RULE_CRITICAL_AND_MAJOR,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverityIds: [MAJOR_INCIDENT],
      },
      {
        id: RULE_PAUSED,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        enabled: false,
      },
      {
        // Not of the deleted kind.
        id: RULE_ALERT,
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
      },
    );

    expect(
      await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
        severityKind: ComplianceSeverityKind.Incident,
        settingIds: [
          RULE_CRITICAL_ONLY,
          RULE_EPISODE_CRITICAL_ONLY,
          RULE_CRITICAL_AND_MAJOR,
          RULE_PAUSED,
          RULE_ALERT,
          RULE_EVERY_SEVERITY,
        ],
      }),
    ).toEqual([RULE_CRITICAL_ONLY, RULE_EPISODE_CRITICAL_ONLY]);

    const read: JSONObject = findByCalls()[0]!;
    expect((read["query"] as JSONObject)["_id"]).toBeInstanceOf(Includes);
    expect(read["props"]).toEqual({ isRoot: true });

    expect(settingsUpdateBy).toHaveBeenCalledTimes(1);

    const write: JSONObject = settingsUpdateBy.mock.calls[0]![0] as JSONObject;
    expect(((write["query"] as JSONObject)["_id"] as Includes).values).toEqual([
      RULE_CRITICAL_ONLY,
      RULE_EPISODE_CRITICAL_ONLY,
    ]);
    expect(write["data"]).toEqual({ enabled: false });
    expect(write["limit"]).toBe(2);
    expect(write["props"]).toEqual({ isRoot: true });
  });

  test("nothing named reads nothing; nothing left empty writes nothing", async () => {
    await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
      severityKind: ComplianceSeverityKind.Incident,
      settingIds: [],
    });

    expect(settingsFindBy).not.toHaveBeenCalled();

    expect(
      await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
        severityKind: ComplianceSeverityKind.Incident,
        settingIds: [RULE_CRITICAL_AND_MAJOR],
      }),
    ).toEqual([]);
    expect(settingsUpdateBy).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The static scope helpers.
 * ---------------------------------------------------------------------------
 */

describe("TeamComplianceSettingService.getIds", () => {
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a bare id string", CRITICAL_INCIDENT],
    ["an object", { _id: CRITICAL_INCIDENT }],
    ["a number", 7],
  ])(
    "is empty for %s, which is not a list",
    (_label: string, value: unknown) => {
      expect(TeamComplianceSettingServiceClass.getIds(value)).toEqual([]);
    },
  );

  test("reads ids from strings, ObjectIDs, models and {_id} / {id} JSON", () => {
    const model: AlertSeverity = new AlertSeverity();
    model._id = MAJOR_ALERT;

    expect(
      TeamComplianceSettingServiceClass.getIds([
        CRITICAL_INCIDENT,
        new ObjectID(MAJOR_INCIDENT),
        { _id: MINOR_INCIDENT },
        { id: CRITICAL_ALERT },
        { _id: new ObjectID(FOREIGN_ALERT) },
        { id: new ObjectID(FOREIGN_INCIDENT) },
        model,
      ]),
    ).toEqual(
      [
        CRITICAL_INCIDENT,
        MAJOR_INCIDENT,
        MINOR_INCIDENT,
        CRITICAL_ALERT,
        FOREIGN_ALERT,
        FOREIGN_INCIDENT,
        MAJOR_ALERT,
      ].sort(),
    );
  });

  test("prefers _id over id when an item carries both", () => {
    expect(
      TeamComplianceSettingServiceClass.getIds([
        { _id: CRITICAL_INCIDENT, id: MAJOR_INCIDENT },
      ]),
    ).toEqual([CRITICAL_INCIDENT]);
  });

  test("skips items with no usable id", () => {
    expect(
      TeamComplianceSettingServiceClass.getIds([
        null,
        undefined,
        "",
        "   ",
        12,
        true,
        {},
        { _id: 5 },
        { name: "Critical" },
        [CRITICAL_INCIDENT],
        CRITICAL_INCIDENT,
      ]),
    ).toEqual([CRITICAL_INCIDENT]);
  });

  test("trims, de-duplicates and sorts, so two lists compare by content", () => {
    expect(
      TeamComplianceSettingServiceClass.getIds([
        MINOR_INCIDENT,
        ` ${CRITICAL_INCIDENT} `,
        MAJOR_INCIDENT,
        CRITICAL_INCIDENT,
      ]),
    ).toEqual([CRITICAL_INCIDENT, MAJOR_INCIDENT, MINOR_INCIDENT].sort());
  });

  test("lower-cases, because Postgres stores and compares uuids without case", () => {
    expect(
      TeamComplianceSettingServiceClass.getIds([
        CRITICAL_INCIDENT.toUpperCase(),
        CRITICAL_INCIDENT,
        { _id: MAJOR_INCIDENT.toUpperCase() },
      ]),
    ).toEqual([CRITICAL_INCIDENT, MAJOR_INCIDENT]);
  });
});

describe("TeamComplianceSettingService.getScope", () => {
  test.each(METHOD_RULE_TYPES)(
    "%s has no channel, no severity kind and no severities, whatever is passed",
    (ruleType: ComplianceRuleType) => {
      expect(
        TeamComplianceSettingServiceClass.getScope({
          ruleType: ruleType,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [CRITICAL_INCIDENT],
          alertSeverities: [CRITICAL_ALERT],
        }),
      ).toEqual({
        ruleType: ruleType,
        notificationChannel: null,
        severityKind: null,
        severityIds: [],
      });
    },
  );

  test.each(INCIDENT_RULE_TYPES)(
    "%s is scoped by its incident severities only",
    (ruleType: ComplianceRuleType) => {
      expect(
        TeamComplianceSettingServiceClass.getScope({
          ruleType: ruleType,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [MAJOR_INCIDENT, CRITICAL_INCIDENT],
          alertSeverities: [CRITICAL_ALERT],
        }),
      ).toEqual({
        ruleType: ruleType,
        notificationChannel: ComplianceNotificationChannel.Call,
        severityKind: ComplianceSeverityKind.Incident,
        severityIds: [CRITICAL_INCIDENT, MAJOR_INCIDENT].sort(),
      });
    },
  );

  test.each(ALERT_RULE_TYPES)(
    "%s is scoped by its alert severities only",
    (ruleType: ComplianceRuleType) => {
      expect(
        TeamComplianceSettingServiceClass.getScope({
          ruleType: ruleType,
          notificationChannel: null,
          incidentSeverities: [CRITICAL_INCIDENT],
          alertSeverities: [MAJOR_ALERT],
        }),
      ).toEqual({
        ruleType: ruleType,
        notificationChannel: null,
        severityKind: ComplianceSeverityKind.Alert,
        severityIds: [MAJOR_ALERT],
      });
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an unknown channel", "Pager"],
    ["a channel in the wrong case", "call"],
    ["a number", 3],
  ])("reads %s as 'any channel'", (_label: string, channel: unknown) => {
    expect(
      TeamComplianceSettingServiceClass.getScope({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: channel,
        incidentSeverities: undefined,
        alertSeverities: undefined,
      }).notificationChannel,
    ).toBeNull();
  });

  test.each(
    COMPLIANCE_RULE_DEFINITIONS.map(
      (definition: ComplianceRuleDefinition): [ComplianceRuleType] => {
        return [definition.ruleType];
      },
    ),
  )(
    "%s: the scope agrees with the rule catalog",
    (ruleType: ComplianceRuleType) => {
      const scope: ComplianceRuleScope =
        TeamComplianceSettingServiceClass.getScope({
          ruleType: ruleType,
          notificationChannel: ComplianceNotificationChannel.Slack,
          incidentSeverities: [CRITICAL_INCIDENT],
          alertSeverities: [CRITICAL_ALERT],
        });

      expect(scope.severityKind).toBe(
        ComplianceRule.getSeverityKind(ruleType) || null,
      );
      expect(scope.notificationChannel).toBe(
        ComplianceRule.supportsChannel(ruleType)
          ? ComplianceNotificationChannel.Slack
          : null,
      );
      expect(scope.severityIds).toHaveLength(
        ComplianceRule.supportsSeverityScope(ruleType) ? 1 : 0,
      );
    },
  );
});

describe("TeamComplianceSettingService.isSameScope", () => {
  const base: ComplianceRuleScope = TeamComplianceSettingServiceClass.getScope({
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    notificationChannel: ComplianceNotificationChannel.Call,
    incidentSeverities: [CRITICAL_INCIDENT, MAJOR_INCIDENT],
    alertSeverities: undefined,
  });

  test("a scope is the same as itself and as an identical copy", () => {
    expect(TeamComplianceSettingServiceClass.isSameScope(base, base)).toBe(
      true,
    );
    expect(
      TeamComplianceSettingServiceClass.isSameScope(base, {
        ...base,
        severityIds: [...base.severityIds],
      }),
    ).toBe(true);
  });

  test("severity order, repeats and case do not matter once read through getScope", () => {
    const reordered: ComplianceRuleScope =
      TeamComplianceSettingServiceClass.getScope({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [
          MAJOR_INCIDENT.toUpperCase(),
          { _id: CRITICAL_INCIDENT },
          MAJOR_INCIDENT,
        ],
        alertSeverities: [CRITICAL_ALERT],
      });

    expect(TeamComplianceSettingServiceClass.isSameScope(base, reordered)).toBe(
      true,
    );
    expect(TeamComplianceSettingServiceClass.isSameScope(reordered, base)).toBe(
      true,
    );
  });

  test.each<[string, Partial<ComplianceRuleScope>]>([
    [
      "the rule type",
      { ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules },
    ],
    [
      "the channel",
      { notificationChannel: ComplianceNotificationChannel.Push },
    ],
    ["'any channel' against one channel", { notificationChannel: null }],
    ["a narrower severity set", { severityIds: [CRITICAL_INCIDENT] }],
    ["every severity against some", { severityIds: [] }],
    [
      "a wider severity set",
      {
        severityIds: [CRITICAL_INCIDENT, MAJOR_INCIDENT, MINOR_INCIDENT].sort(),
      },
    ],
  ])(
    "differs by %s",
    (_label: string, change: Partial<ComplianceRuleScope>) => {
      const other: ComplianceRuleScope = { ...base, ...change };

      expect(TeamComplianceSettingServiceClass.isSameScope(base, other)).toBe(
        false,
      );
      expect(TeamComplianceSettingServiceClass.isSameScope(other, base)).toBe(
        false,
      );
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Through updateOneById, the path BaseAPI takes.
 * ---------------------------------------------------------------------------
 */

type InternalFindFunction = (
  findBy: JSONObject,
) => Promise<Array<TeamComplianceSetting>>;

interface ServiceInternals {
  _findBy: InternalFindFunction;
}

describe("TeamComplianceSettingService updates reach the write normalised", () => {
  let service: TeamComplianceSettingServiceClass;
  let save: jest.Mock;
  let repositoryUpdate: jest.Mock;

  beforeEach(() => {
    service = new TeamComplianceSettingServiceClass();

    store(INCIDENT_CALL_CRITICAL);

    // The hook's reads, from the in-memory team.
    jest.spyOn(service, "findBy").mockImplementation(((findBy: {
      query: JSONObject;
    }) => {
      return Promise.resolve(
        storedSettings.filter((row: TeamComplianceSetting): boolean => {
          return matchesQuery(row, findBy.query);
        }),
      );
    }) as never);

    // _updateBy's own internal find of the row it is about to write.
    jest
      .spyOn(service as unknown as ServiceInternals, "_findBy")
      .mockImplementation((): Promise<Array<TeamComplianceSetting>> => {
        const row: TeamComplianceSetting = new TeamComplianceSetting();
        row._id = SETTING_ID;
        row.projectId = PROJECT_ID;
        return Promise.resolve([row]);
      });

    save = jest.fn((item: unknown) => {
      return Promise.resolve(item);
    });
    repositoryUpdate = jest.fn(() => {
      return Promise.resolve({ affected: 1 });
    });
    jest.spyOn(service, "getRepository").mockReturnValue({
      save: save,
      update: repositoryUpdate,
    } as never);

    // The permission layer needs a database and is not what this is about.
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(((_modelType: unknown, query: unknown) => {
        return Promise.resolve(query);
      }) as never);
    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockResolvedValue(undefined as never);
  });

  test("a toggle is a plain column update: no hook reads, no relation write", async () => {
    await service.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: { enabled: false },
      props: { isRoot: true },
    });

    expect(service.findBy).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(repositoryUpdate).toHaveBeenCalledTimes(1);
    expect(repositoryUpdate.mock.calls[0]?.[1]).toMatchObject({
      enabled: false,
    });
  });

  test("a rule type change writes the cleared channel and severities with the new type", async () => {
    await service.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: { ruleType: ComplianceRuleType.HasNotificationEmailMethod },
      props: { isRoot: true },
    });

    // The severity lists are relations, so the row goes through save().
    expect(save).toHaveBeenCalledTimes(1);

    const written: Record<string, unknown> = save.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(written["_id"]).toBe(SETTING_ID);
    expect(written["ruleType"]).toBe(
      ComplianceRuleType.HasNotificationEmailMethod,
    );
    expect(written["notificationChannel"]).toBeNull();
    expect(written["incidentSeverities"]).toEqual([]);
    expect(written["alertSeverities"]).toEqual([]);
  });

  test("a duplicate is refused before anything is written", async () => {
    store({
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Push,
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(
      service.updateOneById({
        id: new ObjectID(SETTING_ID),
        data: { notificationChannel: ComplianceNotificationChannel.Push },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

    expect(save).not.toHaveBeenCalled();
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });
  test("a repeated severity, in any case, reaches the relation save once and lower-cased", async () => {
    await service.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: {
        incidentSeverities: [
          { _id: MAJOR_INCIDENT.toUpperCase() },
          { _id: MAJOR_INCIDENT },
        ],
      } as never,
      props: { isRoot: true },
    });

    expect(save).toHaveBeenCalledTimes(1);

    const written: Record<string, unknown> = save.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(
      (written["incidentSeverities"] as Array<{ _id?: string }>).map(
        (item: { _id?: string }): string | undefined => {
          return item._id;
        },
      ),
    ).toEqual([MAJOR_INCIDENT]);
  });

  test("another project's severity named by `id` behind a non-string `_id` is refused before anything is written", async () => {
    await expect(
      service.updateOneById({
        id: new ObjectID(SETTING_ID),
        data: {
          incidentSeverities: [{ _id: 1, id: FOREIGN_INCIDENT }],
        } as never,
        props: EDITOR_PROPS,
      }),
    ).rejects.toThrow(FOREIGN_INCIDENT_SEVERITY_MESSAGE);

    expect(save).not.toHaveBeenCalled();
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });
});
