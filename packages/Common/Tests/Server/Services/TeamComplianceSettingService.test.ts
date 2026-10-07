import TeamComplianceSettingService, {
  ComplianceRuleScope,
  DeletedSeverity,
  DUPLICATE_COMPLIANCE_RULE_MESSAGE,
  OPTIONS_DIFFER_MESSAGE,
  SEVERITIES_DELETED_ENABLE_MESSAGE,
  SEVERITIES_DELETED_OPTION,
  StoredChannelColumns,
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
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * TeamComplianceSettingService guards what a team compliance rule may say.
 *
 * A rule is a type (ComplianceRuleType), optionally channels ("Call", or
 * "Call and Push" - a member needs a rule on each) and a severity scope
 * ("Critical"). One team may hold several rules of one type - "Call for
 * Critical incidents" and "Push for Critical incidents" are both
 * HasIncidentOnCallRules - so there is no unique index any more; the service
 * refuses EXACT duplicates instead (same type, channel set and severity set).
 *
 * The channels are stored twice: as the list in notificationChannels, and -
 * for API clients and builds from before the list - as the list's first
 * channel in notificationChannel. A payload may send either; the hooks write
 * both, and a stored row is read by getStoredChannels, which trusts the list
 * only while the single column still agrees with it.
 *
 * These tests pin, against an in-memory team of stored rules and project
 * severities:
 *
 *  - create refuses unknown rule types and channels (in a list or on their
 *    own), and anything without a project or team, before reading anything;
 *  - a channel list is stored canonical - catalog order, each channel once -
 *    with its first channel beside it, and a single-channel payload from an
 *    older client is stored as a one-item list;
 *  - options a rule type does not use are cleared, per kind, so nothing is
 *    stored that looks like part of a rule without being checked;
 *  - selected severities must exist in the rule's own project, of the rule's
 *    own kind - checked in one count, as root, and never for a stray option;
 *  - duplicates are judged on content (order, repeats and id case do not
 *    matter, for channels as for severities), legacy "no channel, every
 *    severity" rows and rows an older build wrote included, while a different
 *    channel set, severity set, rule type or team is a different rule;
 *  - an update that only switches a rule off reads nothing at all; one that
 *    switches it on reads only whether a severity delete left it with
 *    nothing to check, and refuses that;
 *  - a rule a severity delete emptied (options.severitiesDeleted) duplicates
 *    nothing, and any re-scope clears the mark in the same write;
 *  - an update that changes the scope re-validates it, compares against
 *    siblings excluding the row itself, reads only inside the caller's
 *    project, and a rule type change clears the options the new type does not
 *    use, including ones already stored on the row;
 *  - the static helpers the ee server can reuse (getIds, getScope,
 *    isSameScope, getStoredChannels) and the channel ones behind the hooks
 *    (resolveSentChannels, normaliseChannelFields).
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

const NOT_A_CHANNEL_LIST_MESSAGE: string =
  "The notification channels of a compliance rule must be a list of channels.";

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
  stubProjectDirectory({});
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
  /*
   * The channel columns as the row holds them. A row a current build wrote
   * has the list, and its first channel in notificationChannel - give only
   * `notificationChannels` for that. A row an older build wrote (or one from
   * before the list) has notificationChannel alone and the list NULL - give
   * only `notificationChannel`. Give both to store a pair that disagrees.
   */
  notificationChannels?: Array<string> | null | undefined;
  notificationChannel?: string | null | undefined;
  incidentSeverityIds?: Array<string> | undefined;
  alertSeverityIds?: Array<string> | undefined;
  // Stored rules are enabled unless a test pauses one.
  enabled?: boolean | undefined;
  // The row's options JSON; unset (NULL) unless a test gives it some.
  options?: JSONObject | undefined;
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
  (setting as unknown as Record<string, unknown>)["notificationChannels"] =
    input.notificationChannels === undefined
      ? null
      : input.notificationChannels;
  (setting as unknown as Record<string, unknown>)["notificationChannel"] =
    input.notificationChannel !== undefined
      ? input.notificationChannel
      : input.notificationChannels?.[0] || null;
  setting.enabled = input.enabled === undefined ? true : input.enabled;

  if (input.options !== undefined) {
    setting.options = input.options;
  }

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
  notificationChannels?: unknown;
  // The single channel of a client from before the list.
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
    "notificationChannels",
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
    ...ON_HIGHEST_PLAN,
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
  ...ON_HIGHEST_PLAN,
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

// The two channel columns a create or an update is about to write.
interface ChannelPair {
  notificationChannels: unknown;
  notificationChannel: unknown;
}

const channelsOf: (
  data: TeamComplianceSetting | Record<string, unknown>,
) => ChannelPair = (
  data: TeamComplianceSetting | Record<string, unknown>,
): ChannelPair => {
  const values: Record<string, unknown> = data as unknown as Record<
    string,
    unknown
  >;

  return {
    notificationChannels: values["notificationChannels"],
    notificationChannel: values["notificationChannel"],
  };
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
    "accepts the %s channel on every on-call rule type and keeps it, with the channel beside the list",
    async (channel: ComplianceNotificationChannel) => {
      for (const ruleType of ON_CALL_RULE_TYPES) {
        const result: OnCreate<TeamComplianceSetting> = await create({
          ruleType: ruleType,
          notificationChannels: [channel],
        });

        expect({ ruleType, ...channelsOf(result.createBy.data) }).toEqual({
          ruleType,
          notificationChannels: [channel],
          notificationChannel: channel,
        });
      }
    },
  );

  test.each([
    ["an empty list", []],
    ["null", null],
  ])(
    "channels sent as %s are 'any channel': valid, and written as an empty list with no channel beside it",
    async (_label: string, channels: unknown) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannels: channels,
      });

      expect(channelsOf(result.createBy.data)).toEqual({
        notificationChannels: [],
        notificationChannel: null,
      });
    },
  );

  test("channels not sent are 'any channel' too, and stay unsent", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannels: undefined,
    });

    expect(channelsOf(result.createBy.data)).toEqual({
      notificationChannels: undefined,
      notificationChannel: undefined,
    });
  });

  test.each([
    ["a channel that does not exist", "Pager"],
    ["a channel in the wrong case", "call"],
    ["an empty string", ""],
    ["a method rule type", "HasNotificationCallMethod"],
    ["a label rather than a value", "Push notification"],
  ])(
    "refuses %s as a channel, before reading anything - in a list, and on its own",
    async (_label: string, channel: string) => {
      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannels: [ComplianceNotificationChannel.Call, channel],
        }),
      ).rejects.toThrow(new BadDataException(UNKNOWN_CHANNEL_MESSAGE(channel)));

      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: channel,
        }),
      ).rejects.toThrow(new BadDataException(UNKNOWN_CHANNEL_MESSAGE(channel)));

      expectNoReads();
    },
  );

  test.each([
    ["one channel as a bare string", ComplianceNotificationChannel.Call],
    ["an object", { channel: ComplianceNotificationChannel.Call }],
    ["a number", 3],
  ])(
    "refuses channels sent as %s rather than a list, before reading anything",
    async (_label: string, channels: unknown) => {
      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannels: channels,
        }),
      ).rejects.toThrow(new BadDataException(NOT_A_CHANNEL_LIST_MESSAGE));

      expectNoReads();
    },
  );

  test("refuses a channel that is not a channel even on a method rule - garbage is refused, not quietly dropped", async () => {
    await expect(
      create({
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        notificationChannels: ["Pager"],
      }),
    ).rejects.toThrow(UNKNOWN_CHANNEL_MESSAGE("Pager"));

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
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      });

      expect(channelsOf(result.createBy.data)).toEqual({
        notificationChannels: [],
        notificationChannel: null,
      });
      expect(result.createBy.data.incidentSeverities).toEqual([]);
      expect(result.createBy.data.alertSeverities).toEqual([]);
    },
  );

  test.each(METHOD_RULE_TYPES)(
    "%s keeps no channel sent the old way either",
    async (ruleType: ComplianceRuleType) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ruleType,
        notificationChannel: ComplianceNotificationChannel.Call,
      });

      expect(channelsOf(result.createBy.data)).toEqual({
        notificationChannels: [],
        notificationChannel: null,
      });
    },
  );

  test.each(INCIDENT_RULE_TYPES)(
    "%s keeps its channel and incident severities, and drops alert severities",
    async (ruleType: ComplianceRuleType) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ruleType,
        notificationChannels: [ComplianceNotificationChannel.Push],
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      });

      expect(channelsOf(result.createBy.data)).toEqual({
        notificationChannels: [ComplianceNotificationChannel.Push],
        notificationChannel: ComplianceNotificationChannel.Push,
      });
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
        notificationChannels: [ComplianceNotificationChannel.SMS],
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      });

      expect(channelsOf(result.createBy.data)).toEqual({
        notificationChannels: [ComplianceNotificationChannel.SMS],
        notificationChannel: ComplianceNotificationChannel.SMS,
      });
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

    expect(result.createBy.data.notificationChannels).toBeUndefined();
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
      notificationChannels: [ComplianceNotificationChannel.Call],
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
      notificationChannels: true,
      notificationChannel: true,
      // A rule a severity delete emptied is no duplicate: see below.
      options: true,
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
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverities: [CRITICAL_INCIDENT],
      },
    ],
    [
      "the same severities in another order, with repeats",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [MAJOR_INCIDENT, CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
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
        notificationChannels: [ComplianceNotificationChannel.Push],
        alertSeverityIds: [CRITICAL_ALERT],
      },
      {
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Push],
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
        notificationChannels: [],
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
        notificationChannels: [ComplianceNotificationChannel.Call],
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
        notificationChannels: [ComplianceNotificationChannel.Webhook],
        alertSeverityIds: [MAJOR_ALERT, CRITICAL_ALERT],
      },
      {
        ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Webhook],
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
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Push],
        incidentSeverities: [CRITICAL_INCIDENT],
      },
    ],
    [
      "'any channel' next to a Call rule",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [],
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
        notificationChannels: [ComplianceNotificationChannel.Call],
      },
    ],
    [
      "a wider severity set",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverities: [CRITICAL_INCIDENT, MAJOR_INCIDENT],
      },
    ],
    [
      "every severity next to one severity",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Push],
        alertSeverityIds: [CRITICAL_ALERT],
      },
      {
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Push],
      },
    ],
    [
      "the same scope on the episode rule type",
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
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
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: "66666666-6666-4666-8666-00000000000b",
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Push],
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
        notificationChannels: [ComplianceNotificationChannel.SMS],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Push],
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
  notificationChannels: [ComplianceNotificationChannel.Call],
  incidentSeverityIds: [CRITICAL_INCIDENT],
};

/*
 * "Call for Critical incidents" after Critical was deleted: the join row
 * cascaded away, and pauseRulesLeftWithoutSeverities paused and marked it.
 */
const EMPTIED_BY_DELETE: StoredRuleInput = {
  id: SETTING_ID,
  ruleType: ComplianceRuleType.HasIncidentOnCallRules,
  notificationChannels: [ComplianceNotificationChannel.Call],
  enabled: false,
  options: { [SEVERITIES_DELETED_OPTION]: true },
};

describe("TeamComplianceSettingService onBeforeUpdate - updates that do not touch the scope", () => {
  test.each([
    ["switching a rule off", { enabled: false }],
    ["switching a paused rule off again", { enabled: false, options: {} }],
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

  test("a disable never fails on a rule a severity delete emptied either, and reads nothing", async () => {
    store({ ...EMPTIED_BY_DELETE });

    await expect(update({ enabled: false })).resolves.toBeDefined();
    expectNoReads();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rules a severity delete left with nothing to check.
 * ---------------------------------------------------------------------------
 *
 * pauseRulesLeftWithoutSeverities pauses such a rule and marks it
 * (options.severitiesDeleted). With no severities left it is stored exactly
 * like a rule for EVERY severity of its kind, so turned back on as it is it
 * would check every severity - and it would look like a duplicate of the
 * team's real "every severity" rule of the same type and channel.
 */

describe("TeamComplianceSettingService onBeforeUpdate - turning a rule on", () => {
  test("a rule a severity delete emptied cannot be turned back on as it is", async () => {
    store({ ...EMPTIED_BY_DELETE });

    await expect(update({ enabled: true })).rejects.toThrow(
      new BadDataException(SEVERITIES_DELETED_ENABLE_MESSAGE),
    );
    expect(SEVERITIES_DELETED_ENABLE_MESSAGE).toBe(
      "Every severity this rule was scoped to has been deleted. Edit the rule to choose new severities before turning it back on.",
    );
  });

  test("an ordinary rule - scoped, or for every severity - is turned on", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      enabled: false,
    });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      enabled: true,
    });

    await expect(onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(dataOf(updateBy)).toEqual({ enabled: true });

    await expect(
      onBeforeUpdate(
        updateByFor({ enabled: true }, { query: { _id: SIBLING_SETTING_ID } }),
      ),
    ).resolves.toBeDefined();
  });

  test("reads only the rows being turned on, inside the caller's project, as root, with what the check needs", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      enabled: true,
    });

    await onBeforeUpdate(updateBy);

    expect(settingsFindBy).toHaveBeenCalledTimes(1);

    const read: JSONObject = findByCalls()[0]!;
    expect(read["query"]).toEqual({ _id: SETTING_ID, projectId: PROJECT_ID });
    expect(read["select"]).toEqual({
      _id: true,
      ruleType: true,
      options: true,
      incidentSeverities: { _id: true },
      alertSeverities: { _id: true },
    });
    expect(read["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(read["props"]).toEqual({ isRoot: true });
    // The caller's own query object is left alone.
    expect(updateBy.query).toEqual({ _id: SETTING_ID });
    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
  });

  test("a marked rule in another project is not read, so it does not block the caller", async () => {
    store({
      ...EMPTIED_BY_DELETE,
      projectId: OTHER_PROJECT_ID,
      teamId: OTHER_TEAM_ID,
    });

    await expect(update({ enabled: true })).resolves.toBeDefined();
  });

  test("root is held to it too: nothing may turn such a rule into an every-severity rule", async () => {
    store({ ...EMPTIED_BY_DELETE });

    await expect(
      onBeforeUpdate(
        updateByFor({ enabled: true }, { props: { isRoot: true } }),
      ),
    ).rejects.toThrow(SEVERITIES_DELETED_ENABLE_MESSAGE);
  });

  test("a bulk switch-on is refused when any row it matches was emptied", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      ...EMPTIED_BY_DELETE,
      id: SIBLING_SETTING_ID,
    });

    await expect(
      onBeforeUpdate(
        updateByFor(
          { enabled: true },
          { query: { teamId: TEAM_ID }, props: { isRoot: true } },
        ),
      ),
    ).rejects.toThrow(SEVERITIES_DELETED_ENABLE_MESSAGE);
  });

  test.each<[string, StoredRuleInput]>([
    [
      "a stale mark on a rule that has severities again",
      { ...EMPTIED_BY_DELETE, incidentSeverityIds: [MAJOR_INCIDENT] },
    ],
    [
      "a mark on a method rule, which has no severities to lose",
      {
        id: SETTING_ID,
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: false,
        options: { [SEVERITIES_DELETED_OPTION]: true },
      },
    ],
    [
      "a mark that is not `true`",
      { ...EMPTIED_BY_DELETE, options: { [SEVERITIES_DELETED_OPTION]: "yes" } },
    ],
  ])(
    "%s does not block turning the rule on",
    async (_label: string, row: StoredRuleInput) => {
      store(row);

      await expect(update({ enabled: true })).resolves.toBeDefined();
    },
  );

  test("an alert rule emptied by an alert severity delete is held to it too", async () => {
    store({
      id: SETTING_ID,
      ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Push],
      enabled: false,
      options: { [SEVERITIES_DELETED_OPTION]: true },
      // A stray severity of the other kind is not a scope.
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(update({ enabled: true })).rejects.toThrow(
      SEVERITIES_DELETED_ENABLE_MESSAGE,
    );
  });
});

describe("TeamComplianceSettingService onBeforeUpdate - re-scoping a rule a severity delete emptied", () => {
  test("the edit form's save - new severities, and enabled - is accepted and clears the mark in the same write", async () => {
    store({ ...EMPTIED_BY_DELETE });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [{ _id: MAJOR_INCIDENT }],
      alertSeverities: [],
      enabled: true,
    });

    await expect(onBeforeUpdate(updateBy)).resolves.toBeDefined();

    expect(dataOf(updateBy)["enabled"]).toBe(true);
    expect(dataOf(updateBy)["options"]).toBeNull();
    expect(
      writtenIds(dataOf(updateBy)["incidentSeverities"], IncidentSeverity),
    ).toEqual([MAJOR_INCIDENT]);
  });

  test.each<[string, Record<string, unknown>]>([
    ["new severities", { incidentSeverities: [MAJOR_INCIDENT] }],
    [
      "deliberately every severity, from the edit form",
      { incidentSeverities: [], enabled: true },
    ],
    [
      "a new channel",
      { notificationChannels: [ComplianceNotificationChannel.Push] },
    ],
    [
      "a new rule type",
      { ruleType: ComplianceRuleType.HasNotificationEmailMethod },
    ],
  ])(
    "%s clears the mark",
    async (_label: string, data: Record<string, unknown>) => {
      store({ ...EMPTIED_BY_DELETE });

      const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
        ...data,
      });

      await onBeforeUpdate(updateBy);

      expect(dataOf(updateBy)["options"]).toBeNull();
    },
  );

  test("every other option the rule carries is kept", async () => {
    store({
      ...EMPTIED_BY_DELETE,
      options: { [SEVERITIES_DELETED_OPTION]: true, note: "keep me" },
    });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      incidentSeverities: [MAJOR_INCIDENT],
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)["options"]).toEqual({ note: "keep me" });
  });

  test("options sent with the re-scope are written, without the mark", async () => {
    store({ ...EMPTIED_BY_DELETE });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      incidentSeverities: [MAJOR_INCIDENT],
      options: { [SEVERITIES_DELETED_OPTION]: true, note: "sent" },
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)["options"]).toEqual({ note: "sent" });
  });

  test("a re-scope of an unmarked rule leaves its options alone", async () => {
    store({ ...INCIDENT_CALL_CRITICAL, options: { note: "untouched" } });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      incidentSeverities: [MAJOR_INCIDENT],
    });

    await onBeforeUpdate(updateBy);

    expect("options" in dataOf(updateBy)).toBe(false);
  });

  test("a re-scope over rows that disagree on their options is refused rather than overwrite one row's options with another's", async () => {
    store(
      { ...EMPTIED_BY_DELETE },
      {
        ...INCIDENT_CALL_CRITICAL,
        id: SIBLING_SETTING_ID,
        notificationChannels: [ComplianceNotificationChannel.SMS],
        options: { note: "the sibling's own" },
      },
    );

    await expect(
      onBeforeUpdate(
        updateByFor(
          { incidentSeverities: [MINOR_INCIDENT] },
          { query: { teamId: TEAM_ID }, props: { isRoot: true } },
        ),
      ),
    ).rejects.toThrow(new BadDataException(OPTIONS_DIFFER_MESSAGE));
  });

  test("the re-scoped rule is still checked for duplicates, and refused like any other", async () => {
    store(
      { ...EMPTIED_BY_DELETE },
      {
        ...INCIDENT_CALL_CRITICAL,
        id: SIBLING_SETTING_ID,
        incidentSeverityIds: [MAJOR_INCIDENT],
      },
    );

    await expect(
      update({ incidentSeverities: [MAJOR_INCIDENT], enabled: true }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });
});

describe("TeamComplianceSettingService - a rule a severity delete emptied duplicates nothing", () => {
  test("the team's real 'every severity' rule of the same type and channel can still be saved from its edit form", async () => {
    // What the delete left: no severities, paused, marked.
    store(
      { ...EMPTIED_BY_DELETE, id: SIBLING_SETTING_ID },
      {
        id: SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
      },
    );

    await expect(
      update({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverities: [],
        alertSeverities: [],
        enabled: false,
      }),
    ).resolves.toBeDefined();
  });

  test("a new 'every severity' rule of the same type and channel may be added beside it", async () => {
    store({ ...EMPTIED_BY_DELETE, id: SIBLING_SETTING_ID });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
      }),
    ).resolves.toBeDefined();
  });

  test("an unmarked rule with no severities - a real 'every severity' rule, paused or not - is still a duplicate", async () => {
    store({
      ...EMPTIED_BY_DELETE,
      id: SIBLING_SETTING_ID,
      options: undefined,
    });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });

  test("a stale mark on a rule that has severities again does not hide it from the duplicate check", async () => {
    store({
      ...EMPTIED_BY_DELETE,
      id: SIBLING_SETTING_ID,
      incidentSeverityIds: [MAJOR_INCIDENT],
    });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverities: [MAJOR_INCIDENT],
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
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

    await update({
      notificationChannels: [ComplianceNotificationChannel.Push],
    });

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
      notificationChannels: true,
      notificationChannel: true,
      options: true,
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
      notificationChannels: [ComplianceNotificationChannel.Push],
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
      notificationChannels: [ComplianceNotificationChannel.Push],
    });

    await expect(
      onBeforeUpdate(
        updateByFor(
          { notificationChannels: [ComplianceNotificationChannel.Push] },
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
        { notificationChannels: [ComplianceNotificationChannel.Push] },
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

    await update({
      notificationChannels: [ComplianceNotificationChannel.Push],
    });

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
        notificationChannels: [ComplianceNotificationChannel.Call],
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
      notificationChannels: [ComplianceNotificationChannel.Push],
    });

    await expect(
      update({ notificationChannels: [ComplianceNotificationChannel.Push] }),
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
      notificationChannels: [ComplianceNotificationChannel.SMS],
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(
      update({ notificationChannels: [ComplianceNotificationChannel.SMS] }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });

  test("clearing the channel back to 'any channel' is a scope change and is checked", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(update({ notificationChannels: [] })).rejects.toThrow(
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
      notificationChannels: [ComplianceNotificationChannel.Call],
    });

    await expect(
      update({ notificationChannels: [ComplianceNotificationChannel.Push] }),
    ).resolves.toBeDefined();

    expect(siblingReads()).toEqual([]);
    expect(incidentSeverityCountBy).not.toHaveBeenCalled();
  });

  /*
   * The relation save writes a sent list to the row whatever its type, so
   * the list is checked by its own kind against the row's project even when
   * the row's type is one this build does not recognise.
   */
  test.each<[string, Record<string, unknown>, string]>([
    [
      "incident",
      { incidentSeverities: [{ _id: FOREIGN_INCIDENT }] },
      FOREIGN_INCIDENT_SEVERITY_MESSAGE,
    ],
    [
      "alert",
      { alertSeverities: [{ _id: FOREIGN_ALERT }] },
      FOREIGN_ALERT_SEVERITY_MESSAGE,
    ],
  ])(
    "another project's %s severity sent to a rule whose stored type is not recognised is refused",
    async (_label: string, data: Record<string, unknown>, message: string) => {
      store({ id: SETTING_ID, ruleType: "LegacyRule" });

      await expect(update({ ...data })).rejects.toThrow(
        new BadDataException(message),
      );
      expect(siblingReads()).toEqual([]);
    },
  );

  test("this project's severities sent to such a rule are checked against the row's project and accepted", async () => {
    store({ id: SETTING_ID, ruleType: "LegacyRule" });

    await expect(
      update({
        incidentSeverities: [CRITICAL_INCIDENT],
        alertSeverities: [CRITICAL_ALERT],
      }),
    ).resolves.toBeDefined();

    expect(
      countCalls(incidentSeverityCountBy).map((call: JSONObject) => {
        return [
          String((call["query"] as JSONObject)["projectId"]),
          includedIds(call["query"] as JSONObject),
        ];
      }),
    ).toEqual([[PROJECT_ID.toString(), [CRITICAL_INCIDENT]]]);
    expect(
      countCalls(alertSeverityCountBy).map((call: JSONObject) => {
        return includedIds(call["query"] as JSONObject);
      }),
    ).toEqual([[CRITICAL_ALERT]]);
  });

  test("a root update over rows of two projects checks a sent list against each project, once per project", async () => {
    store(
      { id: SETTING_ID, ruleType: "LegacyRule" },
      {
        id: OTHER_PROJECT_SETTING_ID,
        ruleType: "LegacyRule",
        projectId: OTHER_PROJECT_ID,
        teamId: OTHER_TEAM_ID,
      },
      { id: SIBLING_SETTING_ID, ruleType: "LegacyRule" },
    );

    await expect(
      onBeforeUpdate(
        updateByFor(
          { incidentSeverities: [CRITICAL_INCIDENT] },
          { query: { ruleType: "LegacyRule" }, props: { isRoot: true } },
        ),
      ),
    ).rejects.toThrow(FOREIGN_INCIDENT_SEVERITY_MESSAGE);

    expect(
      countCalls(incidentSeverityCountBy).map((call: JSONObject): string => {
        return String((call["query"] as JSONObject)["projectId"]);
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
  });

  test("a list the update sends is checked once, not again as the row's scope", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await update({ incidentSeverities: [MAJOR_INCIDENT] });

    expect(incidentSeverityCountBy).toHaveBeenCalledTimes(1);
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
            { notificationChannels: [ComplianceNotificationChannel.Push] },
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
        { notificationChannels: [ComplianceNotificationChannel.Push] },
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
      notificationChannels: [],
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
      notificationChannels: [ComplianceNotificationChannel.Call],
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
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [CRITICAL_INCIDENT],
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      notificationChannels: [],
      notificationChannel: null,
      incidentSeverities: [],
    });
  });

  test("options the type does use are kept, the severities as the ids they name", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannels: [ComplianceNotificationChannel.Push],
      incidentSeverities: [{ _id: MAJOR_INCIDENT }],
    });

    await onBeforeUpdate(updateBy);

    expect(Object.keys(dataOf(updateBy)).sort()).toEqual([
      "incidentSeverities",
      "notificationChannel",
      "notificationChannels",
    ]);
    expect(channelsOf(dataOf(updateBy))).toEqual({
      notificationChannels: [ComplianceNotificationChannel.Push],
      notificationChannel: ComplianceNotificationChannel.Push,
    });
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
      notificationChannels: [ComplianceNotificationChannel.Call],
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
      notificationChannels: [ComplianceNotificationChannel.Push],
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
        notificationChannels: [ComplianceNotificationChannel.Call],
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

const EDITORS_OF_EMPTIED_RULES: Array<
  [string, DatabaseCommonInteractionProps]
> = [
  ["a team editor", EDITOR_PROPS],
  ["a project admin", memberProps([Permission.ProjectAdmin])],
];

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
              notificationChannels: [ComplianceNotificationChannel.Call],
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
              notificationChannels: [ComplianceNotificationChannel.Call],
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
        notificationChannels: [ComplianceNotificationChannel.Push],
      });

      for (const data of [
        { incidentSeverities: [FOREIGN_INCIDENT] },
        { notificationChannels: [ComplianceNotificationChannel.Push] },
      ]) {
        await expect(
          onBeforeUpdate(updateByFor({ ...data }, { props: props })),
        ).rejects.toThrow(NotAuthorizedException);
      }

      expectNoReads();
    },
  );

  test.each(OUTSIDERS)(
    "update: %s switching a rule off gets nothing from this hook - it reads nothing, and _updateBy's own check refuses the write",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      store(INCIDENT_CALL_CRITICAL);

      await expect(
        onBeforeUpdate(updateByFor({ enabled: false }, { props: props })),
      ).resolves.toBeDefined();

      expectNoReads();
    },
  );

  test.each(OUTSIDERS)(
    "update: %s switching a rule on is refused before anything is read, so the refusal cannot tell an emptied rule from any other",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      store({ ...EMPTIED_BY_DELETE });

      await expect(
        onBeforeUpdate(updateByFor({ enabled: true }, { props: props })),
      ).rejects.toThrow(NotAuthorizedException);

      expectNoReads();
    },
  );

  test.each(EDITORS_OF_EMPTIED_RULES)(
    "update: %s re-scoping an emptied rule writes options the update check _updateBy repeats allows",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      store({ ...EMPTIED_BY_DELETE });

      const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor(
        { incidentSeverities: [MAJOR_INCIDENT], enabled: true },
        { props: props },
      );

      await onBeforeUpdate(updateBy);

      expect("options" in dataOf(updateBy)).toBe(true);

      await expect(
        ModelPermission.checkUpdateQueryPermissions(
          TeamComplianceSetting,
          { _id: SETTING_ID },
          updateBy.data,
          props,
        ),
      ).resolves.toBeDefined();
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
          notificationChannels: [ComplianceNotificationChannel.SMS],
          incidentSeverities: [FOREIGN_INCIDENT],
          alertSeverities: [FOREIGN_ALERT],
        },
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannels: [ComplianceNotificationChannel.Call],
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
          notificationChannels: [ComplianceNotificationChannel.Push],
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
        { notificationChannels: [] },
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
        { notificationChannels: [ComplianceNotificationChannel.Push] },
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
 * which rules reference what they are about to delete, and once the delete
 * has happened pause and mark those left with no severity.
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
const RULE_MAJOR_ONLY: string = "77777777-7777-4777-8777-000000000009";

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

const MARKED: JSONObject = { [SEVERITIES_DELETED_OPTION]: true };

describe("TeamComplianceSettingService - a severity delete pauses and marks the rules it leaves with no severity", () => {
  let settingsUpdateBy: jest.SpyInstance;

  beforeEach(() => {
    settingsUpdateBy = jest
      .spyOn(TeamComplianceSettingService, "updateBy")
      .mockResolvedValue(1 as never);

    store(
      {
        id: RULE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: RULE_EPISODE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.SMS],
        incidentSeverityIds: [CRITICAL_INCIDENT],
      },
      {
        id: RULE_CRITICAL_AND_MAJOR,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Push],
        incidentSeverityIds: [CRITICAL_INCIDENT, MAJOR_INCIDENT],
      },
      {
        id: RULE_EVERY_SEVERITY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Email],
      },
      {
        id: RULE_PAUSED,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Slack],
        incidentSeverityIds: [CRITICAL_INCIDENT],
        enabled: false,
      },
      {
        id: RULE_ALERT,
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
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
      {
        id: RULE_MAJOR_ONLY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.WhatsApp],
        incidentSeverityIds: [MAJOR_INCIDENT],
      },
    );
    stubProjectDirectory({});
  });

  /*
   * ANY reference, not only rules scoped to nothing but what this delete
   * removes: two deletes side by side each still see the other's severity
   * attached, and a rule neither carried would be left empty and enabled.
   */
  test("finds every rule of the severity's kind that references a severity being deleted - paused ones too", async () => {
    expect(
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
        severityKind: ComplianceSeverityKind.Incident,
        severities: deleting([CRITICAL_INCIDENT]),
      }),
    ).toEqual([
      RULE_CRITICAL_ONLY,
      RULE_EPISODE_CRITICAL_ONLY,
      RULE_CRITICAL_AND_MAJOR,
      RULE_PAUSED,
    ]);

    expect(
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
        severityKind: ComplianceSeverityKind.Incident,
        severities: deleting([MAJOR_INCIDENT.toUpperCase()]),
      }),
    ).toEqual([RULE_CRITICAL_AND_MAJOR, RULE_MAJOR_ONLY]);

    expect(
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
        severityKind: ComplianceSeverityKind.Alert,
        severities: deleting([CRITICAL_ALERT]),
      }),
    ).toEqual([RULE_ALERT]);

    // A severity no rule names carries nothing.
    expect(
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
        severityKind: ComplianceSeverityKind.Incident,
        severities: deleting([MINOR_INCIDENT]),
      }),
    ).toEqual([]);
  });

  test("reads the project's rules of that kind's types, enabled or not, as root, with their severities", async () => {
    await TeamComplianceSettingService.getRulesScopedToAnyOf({
      severityKind: ComplianceSeverityKind.Alert,
      severities: deleting([CRITICAL_ALERT]),
    });

    expect(settingsFindBy).toHaveBeenCalledTimes(1);

    const read: JSONObject = findByCalls()[0]!;
    const query: JSONObject = read["query"] as JSONObject;

    expect(Object.keys(query).sort()).toEqual(["projectId", "ruleType"]);
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect((query["ruleType"] as Includes).values).toEqual([
      ComplianceRuleType.HasAlertOnCallRules,
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
    ]);
    expect(read["select"]).toEqual({
      _id: true,
      ruleType: true,
      incidentSeverities: { _id: true },
      alertSeverities: { _id: true },
    });
    expect(read["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(read["props"]).toEqual({ isRoot: true });
  });

  test("a delete across projects checks each project's rules against its own severities", async () => {
    expect(
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
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
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
        severityKind: ComplianceSeverityKind.Incident,
        severities: [{ _id: CRITICAL_INCIDENT }, { projectId: PROJECT_ID }],
      }),
    ).toEqual([]);

    expect(settingsFindBy).not.toHaveBeenCalled();
  });

  test("after the delete: pauses and marks, as root, the named rules left with no severity of their kind", async () => {
    // What the cascade leaves behind.
    storedSettings = [];
    store(
      {
        id: RULE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
      },
      {
        id: RULE_EPISODE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      },
      {
        // Another of its severities is still there.
        id: RULE_CRITICAL_AND_MAJOR,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverityIds: [MAJOR_INCIDENT],
      },
      {
        // Paused by an admin before the delete: marked all the same.
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
    ).toEqual([RULE_CRITICAL_ONLY, RULE_EPISODE_CRITICAL_ONLY, RULE_PAUSED]);

    const read: JSONObject = findByCalls()[0]!;
    expect((read["query"] as JSONObject)["_id"]).toBeInstanceOf(Includes);
    expect(read["select"]).toEqual({
      _id: true,
      ruleType: true,
      enabled: true,
      options: true,
      incidentSeverities: { _id: true },
      alertSeverities: { _id: true },
    });
    expect(read["props"]).toEqual({ isRoot: true });

    // Rules with the same options are paused in one write.
    expect(settingsUpdateBy).toHaveBeenCalledTimes(1);

    const write: JSONObject = settingsUpdateBy.mock.calls[0]![0] as JSONObject;
    expect(((write["query"] as JSONObject)["_id"] as Includes).values).toEqual([
      RULE_CRITICAL_ONLY,
      RULE_EPISODE_CRITICAL_ONLY,
      RULE_PAUSED,
    ]);
    expect(write["data"]).toEqual({ enabled: false, options: MARKED });
    expect(write["limit"]).toBe(3);
    expect(write["props"]).toEqual({ isRoot: true });
  });

  test("the mark is added to whatever else a rule's options hold, one write per set of options", async () => {
    storedSettings = [];
    store(
      {
        id: RULE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        options: { note: "first" },
      },
      {
        id: RULE_EPISODE_CRITICAL_ONLY,
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        options: { note: "second" },
      },
    );

    await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
      severityKind: ComplianceSeverityKind.Incident,
      settingIds: [RULE_CRITICAL_ONLY, RULE_EPISODE_CRITICAL_ONLY],
    });

    expect(
      settingsUpdateBy.mock.calls.map((call: Array<unknown>) => {
        const write: JSONObject = call[0] as JSONObject;
        return [
          ((write["query"] as JSONObject)["_id"] as Includes).values,
          write["data"],
        ];
      }),
    ).toEqual([
      [
        [RULE_CRITICAL_ONLY],
        { enabled: false, options: { note: "first", ...MARKED } },
      ],
      [
        [RULE_EPISODE_CRITICAL_ONLY],
        { enabled: false, options: { note: "second", ...MARKED } },
      ],
    ]);
  });

  test("a rule already paused and marked is not written again", async () => {
    storedSettings = [];
    store({
      id: RULE_CRITICAL_ONLY,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: false,
      options: MARKED,
    });

    expect(
      await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
        severityKind: ComplianceSeverityKind.Incident,
        settingIds: [RULE_CRITICAL_ONLY],
      }),
    ).toEqual([]);
    expect(settingsUpdateBy).not.toHaveBeenCalled();
  });

  test("the pause write reads nothing through the update hook, so it cannot fail on the rule's configuration", async () => {
    storedSettings = [];
    store({
      id: RULE_CRITICAL_ONLY,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    });

    const pauseWrite: UpdateBy<TeamComplianceSetting> = {
      query: { _id: new Includes([RULE_CRITICAL_ONLY]) },
      data: { enabled: false, options: MARKED },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    } as unknown as UpdateBy<TeamComplianceSetting>;

    settingsFindBy.mockClear();

    await onBeforeUpdate(pauseWrite);

    expect(settingsFindBy).not.toHaveBeenCalled();
    expect(dataOf(pauseWrite)).toEqual({ enabled: false, options: MARKED });
  });

  /*
   * Two deletes side by side, of the two severities of a "Critical and
   * Major" rule: both look the rule up before either deletes, so each sees
   * the other's severity still attached. Only the delete that finishes last
   * sees the rule empty - and it pauses it.
   */
  test("two deletes that both look up before either deletes: the rule is paused exactly once, by the last", async () => {
    const lookups: Array<Array<string>> = [
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
        severityKind: ComplianceSeverityKind.Incident,
        severities: deleting([CRITICAL_INCIDENT]),
      }),
      await TeamComplianceSettingService.getRulesScopedToAnyOf({
        severityKind: ComplianceSeverityKind.Incident,
        severities: deleting([MAJOR_INCIDENT]),
      }),
    ];

    for (const lookup of lookups) {
      expect(lookup).toContain(RULE_CRITICAL_AND_MAJOR);
    }

    // Critical's delete commits first: Major is still attached.
    storedSettings = [];
    store({
      id: RULE_CRITICAL_AND_MAJOR,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Push],
      incidentSeverityIds: [MAJOR_INCIDENT],
    });

    expect(
      await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
        severityKind: ComplianceSeverityKind.Incident,
        settingIds: lookups[0]!,
      }),
    ).toEqual([]);

    // Then Major's: nothing is left.
    storedSettings = [];
    store({
      id: RULE_CRITICAL_AND_MAJOR,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Push],
    });

    expect(
      await TeamComplianceSettingService.pauseRulesLeftWithoutSeverities({
        severityKind: ComplianceSeverityKind.Incident,
        settingIds: lookups[1]!,
      }),
    ).toEqual([RULE_CRITICAL_AND_MAJOR]);

    expect(settingsUpdateBy).toHaveBeenCalledTimes(1);
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

describe("TeamComplianceSettingService.hasSeveritiesDeletedMark / isLeftWithoutSeverities", () => {
  test("only a `true` under the key is the mark", () => {
    expect(SEVERITIES_DELETED_OPTION).toBe("severitiesDeleted");

    for (const options of [
      undefined,
      null,
      {},
      { severitiesDeleted: false },
      { severitiesDeleted: "true" },
      [true],
      "severitiesDeleted",
    ]) {
      expect(
        TeamComplianceSettingServiceClass.hasSeveritiesDeletedMark(options),
      ).toBe(false);
    }

    expect(
      TeamComplianceSettingServiceClass.hasSeveritiesDeletedMark({
        severitiesDeleted: true,
        note: "x",
      }),
    ).toBe(true);
  });

  test("a rule is left without severities only when marked, scoped by severity, and empty of its own kind", () => {
    const isLeft: (input: StoredRuleInput) => boolean = (
      input: StoredRuleInput,
    ): boolean => {
      return TeamComplianceSettingServiceClass.isLeftWithoutSeverities(
        storedRule(input),
      );
    };

    expect(isLeft({ ...EMPTIED_BY_DELETE })).toBe(true);
    // Enabled or not: the mark is about the scope, not the switch.
    expect(isLeft({ ...EMPTIED_BY_DELETE, enabled: true })).toBe(true);
    // A severity of the other kind is not a scope.
    expect(
      isLeft({ ...EMPTIED_BY_DELETE, alertSeverityIds: [CRITICAL_ALERT] }),
    ).toBe(true);
    expect(
      isLeft({ ...EMPTIED_BY_DELETE, incidentSeverityIds: [MAJOR_INCIDENT] }),
    ).toBe(false);
    expect(isLeft({ ...EMPTIED_BY_DELETE, options: undefined })).toBe(false);
    expect(
      isLeft({
        ...EMPTIED_BY_DELETE,
        ruleType: ComplianceRuleType.HasNotificationCallMethod,
      }),
    ).toBe(false);
    expect(isLeft({ ...EMPTIED_BY_DELETE, ruleType: "LegacyRule" })).toBe(
      false,
    );
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
          notificationChannels: [ComplianceNotificationChannel.Call],
          incidentSeverities: [CRITICAL_INCIDENT],
          alertSeverities: [CRITICAL_ALERT],
        }),
      ).toEqual({
        ruleType: ruleType,
        notificationChannels: [],
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
          notificationChannels: [ComplianceNotificationChannel.Call],
          incidentSeverities: [MAJOR_INCIDENT, CRITICAL_INCIDENT],
          alertSeverities: [CRITICAL_ALERT],
        }),
      ).toEqual({
        ruleType: ruleType,
        notificationChannels: [ComplianceNotificationChannel.Call],
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
          notificationChannels: [],
          incidentSeverities: [CRITICAL_INCIDENT],
          alertSeverities: [MAJOR_ALERT],
        }),
      ).toEqual({
        ruleType: ruleType,
        notificationChannels: [],
        severityKind: ComplianceSeverityKind.Alert,
        severityIds: [MAJOR_ALERT],
      });
    },
  );

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["an empty list", []],
    ["one channel as a bare string, not a list", "Call"],
    ["a list of an unknown channel", ["Pager"]],
    ["a list of a channel in the wrong case", ["call"]],
    ["a list of a number", [3]],
    ["a number", 3],
  ])("reads %s as 'any channel'", (_label: string, channels: unknown) => {
    expect(
      TeamComplianceSettingServiceClass.getScope({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: channels,
        incidentSeverities: undefined,
        alertSeverities: undefined,
      }).notificationChannels,
    ).toEqual([]);
  });

  test("an on-call rule's channels are read canonical: known ones only, each once, in catalog order", () => {
    expect(
      TeamComplianceSettingServiceClass.getScope({
        ruleType: ComplianceRuleType.HasAlertOnCallRules,
        notificationChannels: [
          ComplianceNotificationChannel.Webhook,
          "Pager",
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Webhook,
        ],
        incidentSeverities: undefined,
        alertSeverities: undefined,
      }).notificationChannels,
    ).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Webhook,
    ]);
  });

  test.each(METHOD_RULE_TYPES)(
    "%s has no channels, however many are passed",
    (ruleType: ComplianceRuleType) => {
      expect(
        TeamComplianceSettingServiceClass.getScope({
          ruleType: ruleType,
          notificationChannels: ALL_CHANNELS,
          incidentSeverities: undefined,
          alertSeverities: undefined,
        }).notificationChannels,
      ).toEqual([]);
    },
  );

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
          notificationChannels: [ComplianceNotificationChannel.Slack],
          incidentSeverities: [CRITICAL_INCIDENT],
          alertSeverities: [CRITICAL_ALERT],
        });

      expect(scope.severityKind).toBe(
        ComplianceRule.getSeverityKind(ruleType) || null,
      );
      expect(scope.notificationChannels).toEqual(
        ComplianceRule.supportsChannel(ruleType)
          ? [ComplianceNotificationChannel.Slack]
          : [],
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
    notificationChannels: [ComplianceNotificationChannel.Call],
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
        notificationChannels: [ComplianceNotificationChannel.Call],
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
      { notificationChannels: [ComplianceNotificationChannel.Push] },
    ],
    ["'any channel' against one channel", { notificationChannels: [] }],
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
 * Channels: a list, with its first channel beside it.
 * ---------------------------------------------------------------------------
 *
 * A rule insists on the channels in notificationChannels - a member needs a
 * rule on every one of them. notificationChannel, the column the list
 * replaced, is kept equal to the list's first channel for whatever only knows
 * that one column: an API client or a Dashboard bundle from before the list,
 * or a replica of an older build still serving during an upgrade. The hooks
 * write the pair from whichever field a payload sends, and a stored row is
 * read back by getStoredChannels.
 */

// Every subset of the nine channels, each in catalog order.
const everyChannelSubset: () => Array<
  Array<ComplianceNotificationChannel>
> = (): Array<Array<ComplianceNotificationChannel>> => {
  const subsets: Array<Array<ComplianceNotificationChannel>> = [];

  for (let mask: number = 0; mask < 1 << ALL_CHANNELS.length; mask++) {
    subsets.push(
      ALL_CHANNELS.filter(
        (_channel: ComplianceNotificationChannel, index: number): boolean => {
          return (mask & (1 << index)) !== 0;
        },
      ),
    );
  }

  return subsets;
};

// "Call and Push for Critical incidents", as a current build stores it.
const CALL_AND_PUSH_FOR_CRITICAL: StoredRuleInput = {
  id: SIBLING_SETTING_ID,
  ruleType: ComplianceRuleType.HasIncidentOnCallRules,
  notificationChannels: [
    ComplianceNotificationChannel.Call,
    ComplianceNotificationChannel.Push,
  ],
  incidentSeverityIds: [CRITICAL_INCIDENT],
};

describe("TeamComplianceSettingService.resolveSentChannels", () => {
  test("null is no channels - 'any channel'", () => {
    expect(TeamComplianceSettingServiceClass.resolveSentChannels(null)).toEqual(
      [],
    );
  });

  test("an empty list is no channels", () => {
    expect(TeamComplianceSettingServiceClass.resolveSentChannels([])).toEqual(
      [],
    );
  });

  test("keeps each channel once, in catalog order, whatever order they were picked in", () => {
    expect(
      TeamComplianceSettingServiceClass.resolveSentChannels([
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]),
    ).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(
      TeamComplianceSettingServiceClass.resolveSentChannels(
        [...ALL_CHANNELS].reverse(),
      ),
    ).toEqual(ALL_CHANNELS);
  });

  test("leaves the list it was sent alone", () => {
    const sent: Array<ComplianceNotificationChannel> = [
      ComplianceNotificationChannel.Webhook,
      ComplianceNotificationChannel.Call,
    ];

    const resolved: Array<ComplianceNotificationChannel> =
      TeamComplianceSettingServiceClass.resolveSentChannels(sent);

    expect(resolved).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Webhook,
    ]);
    expect(sent).toEqual([
      ComplianceNotificationChannel.Webhook,
      ComplianceNotificationChannel.Call,
    ]);
  });

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["one channel as a bare string", ComplianceNotificationChannel.Call],
    ["a comma-separated string", "Call,Push"],
    ["an object", { 0: ComplianceNotificationChannel.Call }],
    ["a number", 3],
    ["true", true],
  ])(
    "refuses %s, which is not a list, and says what it must be",
    (_label: string, value: unknown) => {
      expect(() => {
        TeamComplianceSettingServiceClass.resolveSentChannels(value);
      }).toThrow(new BadDataException(NOT_A_CHANNEL_LIST_MESSAGE));
    },
  );

  /*
   * Refused, never dropped: a list that silently lost a channel checks less
   * than the admin asked for, and one that lost its only channel checks
   * every channel.
   */
  test.each<[string, unknown, string]>([
    ["an unknown channel", "Pager", UNKNOWN_CHANNEL_MESSAGE("Pager")],
    ["a channel in the wrong case", "push", UNKNOWN_CHANNEL_MESSAGE("push")],
    [
      "a label rather than a value",
      "Microsoft Teams",
      UNKNOWN_CHANNEL_MESSAGE("Microsoft Teams"),
    ],
    ["an empty string", "", UNKNOWN_CHANNEL_MESSAGE("")],
    ["null", null, UNKNOWN_CHANNEL_MESSAGE("null")],
    ["a number", 7, UNKNOWN_CHANNEL_MESSAGE("7")],
  ])(
    "refuses a list holding %s, by name",
    (_label: string, item: unknown, message: string) => {
      expect(() => {
        TeamComplianceSettingServiceClass.resolveSentChannels([
          ComplianceNotificationChannel.Call,
          item,
        ]);
      }).toThrow(new BadDataException(message));
    },
  );

  test("refuses a list of nothing but garbage rather than read it as 'any channel'", () => {
    expect(() => {
      TeamComplianceSettingServiceClass.resolveSentChannels(["Pager"]);
    }).toThrow(UNKNOWN_CHANNEL_MESSAGE("Pager"));
  });
});

describe("TeamComplianceSettingService.normaliseChannelFields", () => {
  const normalised: (
    data: Record<string, unknown>,
  ) => Record<string, unknown> = (
    data: Record<string, unknown>,
  ): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...data };

    TeamComplianceSettingServiceClass.normaliseChannelFields(
      copy as JSONObject,
    );

    return copy;
  };

  test("a payload that sends neither channel field is left exactly as it was", () => {
    const written: Record<string, unknown> = normalised({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: true,
    });

    expect(written).toEqual({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: true,
    });
    expect("notificationChannels" in written).toBe(false);
    expect("notificationChannel" in written).toBe(false);
  });

  test.each<[string, Record<string, unknown>, ChannelPair]>([
    [
      "a list",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ],
      },
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
    ],
    [
      "a list of one",
      { notificationChannels: [ComplianceNotificationChannel.Webhook] },
      {
        notificationChannels: [ComplianceNotificationChannel.Webhook],
        notificationChannel: ComplianceNotificationChannel.Webhook,
      },
    ],
    [
      "a list of every channel, backwards",
      { notificationChannels: [...ALL_CHANNELS].reverse() },
      {
        notificationChannels: ALL_CHANNELS,
        notificationChannel: ComplianceNotificationChannel.Call,
      },
    ],
    [
      "a list with a repeat",
      {
        notificationChannels: [
          ComplianceNotificationChannel.SMS,
          ComplianceNotificationChannel.SMS,
        ],
      },
      {
        notificationChannels: [ComplianceNotificationChannel.SMS],
        notificationChannel: ComplianceNotificationChannel.SMS,
      },
    ],
    [
      "an empty list",
      { notificationChannels: [] },
      { notificationChannels: [], notificationChannel: null },
    ],
    [
      "a null list",
      { notificationChannels: null },
      { notificationChannels: [], notificationChannel: null },
    ],
    [
      "one channel, the old way",
      { notificationChannel: ComplianceNotificationChannel.SMS },
      {
        notificationChannels: [ComplianceNotificationChannel.SMS],
        notificationChannel: ComplianceNotificationChannel.SMS,
      },
    ],
    [
      "no channel, the old way",
      { notificationChannel: null },
      { notificationChannels: [], notificationChannel: null },
    ],
    [
      "a list, and the stale single channel a client read it with",
      {
        notificationChannels: [ComplianceNotificationChannel.Push],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      {
        notificationChannels: [ComplianceNotificationChannel.Push],
        notificationChannel: ComplianceNotificationChannel.Push,
      },
    ],
    [
      "an empty list, and a stale single channel",
      {
        notificationChannels: [],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      { notificationChannels: [], notificationChannel: null },
    ],
    [
      "a list, and no single channel",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: null,
      },
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
    ],
    [
      "a list, and the single channel that agrees with it - a rule sent back as it was read",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
    ],
  ])(
    "%s is written as the list and its first channel",
    (_label: string, sent: Record<string, unknown>, written: ChannelPair) => {
      expect(channelsOf(normalised(sent))).toEqual(written);
    },
  );

  test("a single channel that is garbage is refused, even beside a good list", () => {
    expect(() => {
      normalised({
        notificationChannels: [ComplianceNotificationChannel.Call],
        notificationChannel: "Pager",
      });
    }).toThrow(new BadDataException(UNKNOWN_CHANNEL_MESSAGE("Pager")));
  });

  test("a refused list leaves the payload as it was sent", () => {
    const data: Record<string, unknown> = {
      notificationChannels: [ComplianceNotificationChannel.Call, "Pager"],
    };

    expect(() => {
      TeamComplianceSettingServiceClass.normaliseChannelFields(
        data as JSONObject,
      );
    }).toThrow(UNKNOWN_CHANNEL_MESSAGE("Pager"));

    expect(data).toEqual({
      notificationChannels: [ComplianceNotificationChannel.Call, "Pager"],
    });
  });

  test("channels that are not a list are refused", () => {
    expect(() => {
      normalised({ notificationChannels: ComplianceNotificationChannel.Call });
    }).toThrow(new BadDataException(NOT_A_CHANNEL_LIST_MESSAGE));
  });

  test("touches nothing but the two channel fields", () => {
    const severities: Array<string> = [CRITICAL_INCIDENT];
    const options: JSONObject = { note: "kept" };

    const written: Record<string, unknown> = normalised({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      incidentSeverities: severities,
      options: options,
      enabled: false,
      notificationChannels: [ComplianceNotificationChannel.Push],
    });

    expect(Object.keys(written).sort()).toEqual(
      [
        "enabled",
        "incidentSeverities",
        "notificationChannel",
        "notificationChannels",
        "options",
        "ruleType",
      ].sort(),
    );
    expect(written["incidentSeverities"]).toBe(severities);
    expect(written["options"]).toBe(options);
    expect(written["enabled"]).toBe(false);
  });

  test("writes a new list: the one the caller sent is not changed or shared", () => {
    const sent: Array<ComplianceNotificationChannel> = [
      ComplianceNotificationChannel.Push,
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ];
    const data: Record<string, unknown> = { notificationChannels: sent };

    TeamComplianceSettingServiceClass.normaliseChannelFields(
      data as JSONObject,
    );

    expect(sent).toEqual([
      ComplianceNotificationChannel.Push,
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(data["notificationChannels"]).not.toBe(sent);
  });

  test("works on the model a create hands over as well as on an update's JSON", () => {
    const setting: TeamComplianceSetting = new TeamComplianceSetting();
    setting.notificationChannels = [
      ComplianceNotificationChannel.Push,
      ComplianceNotificationChannel.Call,
    ];

    TeamComplianceSettingServiceClass.normaliseChannelFields(setting);

    expect(setting.notificationChannels).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(setting.notificationChannel).toBe(
      ComplianceNotificationChannel.Call,
    );
  });

  test("every set of channels, sent as a list in any order, is read back as itself", () => {
    for (const subset of everyChannelSubset()) {
      const data: Record<string, unknown> = {
        notificationChannels: [...subset].reverse(),
      };

      TeamComplianceSettingServiceClass.normaliseChannelFields(
        data as JSONObject,
      );

      expect(channelsOf(data)).toEqual({
        notificationChannels: subset,
        notificationChannel: subset[0] || null,
      });
      expect(TeamComplianceSettingServiceClass.getStoredChannels(data)).toEqual(
        subset,
      );
    }
  });
});

describe("TeamComplianceSettingService.getStoredChannels", () => {
  /*
   * A current build writes the pair together; an older build writes only the
   * single column and leaves the list as it was. So the list is what the rule
   * says while the single column still agrees with its first channel, and the
   * single column is what the rule says once it does not - or when there is
   * no list at all.
   */
  test.each<
    [string, StoredChannelColumns, Array<ComplianceNotificationChannel>]
  >([
    [
      "a pair a current build wrote",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.Push],
    ],
    [
      "one channel a current build wrote",
      {
        notificationChannels: [ComplianceNotificationChannel.SMS],
        notificationChannel: ComplianceNotificationChannel.SMS,
      },
      [ComplianceNotificationChannel.SMS],
    ],
    [
      "'any channel' a current build wrote",
      { notificationChannels: [], notificationChannel: null },
      [],
    ],
    [
      "every channel",
      {
        notificationChannels: ALL_CHANNELS,
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      ALL_CHANNELS,
    ],
    [
      "a row from before the list, with a channel",
      {
        notificationChannels: null,
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      [ComplianceNotificationChannel.Call],
    ],
    [
      "a row from before the list, with no channel",
      { notificationChannels: null, notificationChannel: null },
      [],
    ],
    [
      "a row an older build created, its list never written",
      {
        notificationChannels: undefined,
        notificationChannel: ComplianceNotificationChannel.Push,
      },
      [ComplianceNotificationChannel.Push],
    ],
    [
      "a list an older build re-pointed to another channel",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.SMS,
      },
      [ComplianceNotificationChannel.SMS],
    ],
    [
      "a list an older build cleared to 'any channel'",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: null,
      },
      [],
    ],
    [
      "'any channel' an older build put a channel on",
      {
        notificationChannels: [],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      [ComplianceNotificationChannel.Call],
    ],
    [
      "a list whose rule an older build re-saved without touching its channel",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.Push],
    ],
    [
      "a list a newer build wrote, led by a channel this one does not know",
      {
        notificationChannels: ["Pager", ComplianceNotificationChannel.Call],
        notificationChannel: "Pager",
      },
      [ComplianceNotificationChannel.Call],
    ],
    [
      "a list stored out of catalog order that agrees with its own first channel",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ],
        notificationChannel: ComplianceNotificationChannel.Push,
      },
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.Push],
    ],
    [
      "a list holding a channel twice",
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.Push],
    ],
    [
      "no list, and a single channel this build does not know",
      { notificationChannels: null, notificationChannel: "Pager" },
      [],
    ],
    [
      "a list column holding a bare string",
      {
        notificationChannels: ComplianceNotificationChannel.Push,
        notificationChannel: ComplianceNotificationChannel.Push,
      },
      [ComplianceNotificationChannel.Push],
    ],
    ["neither column", {}, []],
  ])(
    "reads %s",
    (
      _label: string,
      row: StoredChannelColumns,
      channels: Array<ComplianceNotificationChannel>,
    ) => {
      expect(TeamComplianceSettingServiceClass.getStoredChannels(row)).toEqual(
        channels,
      );
    },
  );

  test("an older build's single channel wins over every list it disagrees with", () => {
    const lists: Array<Array<ComplianceNotificationChannel>> = [
      [],
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.Push],
      ALL_CHANNELS,
    ];

    for (const channel of ALL_CHANNELS) {
      for (const list of lists) {
        if ((list[0] || null) === channel) {
          continue;
        }

        expect({
          list,
          channel,
          read: TeamComplianceSettingServiceClass.getStoredChannels({
            notificationChannels: list,
            notificationChannel: channel,
          }),
        }).toEqual({ list, channel, read: [channel] });
      }
    }
  });

  test("reads a row as findBy hands it over", () => {
    expect(
      TeamComplianceSettingServiceClass.getStoredChannels(
        storedRule({ ...CALL_AND_PUSH_FOR_CRITICAL }),
      ),
    ).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(
      TeamComplianceSettingServiceClass.getStoredChannels(
        storedRule({
          id: SETTING_ID,
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
      ),
    ).toEqual([ComplianceNotificationChannel.Push]);
  });

  test("changes nothing on the row it reads", () => {
    const row: StoredChannelColumns = {
      notificationChannels: [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
      ],
      notificationChannel: ComplianceNotificationChannel.Push,
    };

    TeamComplianceSettingServiceClass.getStoredChannels(row);

    expect(row).toEqual({
      notificationChannels: [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
      ],
      notificationChannel: ComplianceNotificationChannel.Push,
    });
  });
});

describe("TeamComplianceSettingService.getScope / isSameScope - channel lists", () => {
  const scopeOf: (channels: unknown) => ComplianceRuleScope = (
    channels: unknown,
  ): ComplianceRuleScope => {
    return TeamComplianceSettingServiceClass.getScope({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: channels,
      incidentSeverities: [CRITICAL_INCIDENT],
      alertSeverities: undefined,
    });
  };

  test("the same channels in another order, or with a repeat, are the same scope", () => {
    const callAndPush: ComplianceRuleScope = scopeOf([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);

    for (const channels of [
      [ComplianceNotificationChannel.Push, ComplianceNotificationChannel.Call],
      [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
    ]) {
      expect(
        TeamComplianceSettingServiceClass.isSameScope(
          callAndPush,
          scopeOf(channels),
        ),
      ).toBe(true);
    }
  });

  test.each<[string, Array<ComplianceNotificationChannel>]>([
    ["one of its channels", [ComplianceNotificationChannel.Call]],
    [
      "a channel more",
      [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Push,
      ],
    ],
    [
      "another pair",
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.SMS],
    ],
    ["any channel", []],
  ])(
    "'Call and Push' differs from %s",
    (_label: string, channels: Array<ComplianceNotificationChannel>) => {
      const callAndPush: ComplianceRuleScope = scopeOf([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]);

      expect(
        TeamComplianceSettingServiceClass.isSameScope(
          callAndPush,
          scopeOf(channels),
        ),
      ).toBe(false);
      expect(
        TeamComplianceSettingServiceClass.isSameScope(
          scopeOf(channels),
          callAndPush,
        ),
      ).toBe(false);
    },
  );

  test("two different sets of channels never compare the same", () => {
    const subsets: Array<Array<ComplianceNotificationChannel>> =
      everyChannelSubset().filter(
        (subset: Array<ComplianceNotificationChannel>): boolean => {
          return subset.length <= 2;
        },
      );

    for (const a of subsets) {
      for (const b of subsets) {
        expect({
          a,
          b,
          same: TeamComplianceSettingServiceClass.isSameScope(
            scopeOf(a),
            scopeOf([...b].reverse()),
          ),
        }).toEqual({ a, b, same: a.join(",") === b.join(",") });
      }
    }
  });
});

describe("TeamComplianceSettingService onBeforeCreate - a rule on several channels", () => {
  test("is stored as the canonical list - catalog order, each channel once - with its first channel beside it", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      incidentSeverities: [CRITICAL_INCIDENT],
    });

    expect(channelsOf(result.createBy.data)).toEqual({
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.Call,
    });
  });

  test.each(ON_CALL_RULE_TYPES)(
    "%s may insist on every channel there is",
    async (ruleType: ComplianceRuleType) => {
      const result: OnCreate<TeamComplianceSetting> = await create({
        ruleType: ruleType,
        notificationChannels: [...ALL_CHANNELS].reverse(),
      });

      expect(channelsOf(result.createBy.data)).toEqual({
        notificationChannels: ALL_CHANNELS,
        notificationChannel: ComplianceNotificationChannel.Call,
      });
    },
  );

  test("is refused as a duplicate of a rule on the same channels, picked in any order", async () => {
    store(CALL_AND_PUSH_FOR_CRITICAL);

    for (const channels of [
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.Push],
      [ComplianceNotificationChannel.Push, ComplianceNotificationChannel.Call],
      [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
    ]) {
      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannels: channels,
          incidentSeverities: [CRITICAL_INCIDENT],
        }),
      ).rejects.toThrow(
        new BadDataException(DUPLICATE_COMPLIANCE_RULE_MESSAGE),
      );
    }
  });

  test.each<[string, Array<ComplianceNotificationChannel>, Array<string>]>([
    [
      "one of its channels",
      [ComplianceNotificationChannel.Call],
      [CRITICAL_INCIDENT],
    ],
    [
      "the other of its channels",
      [ComplianceNotificationChannel.Push],
      [CRITICAL_INCIDENT],
    ],
    [
      "a channel more",
      [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Push,
      ],
      [CRITICAL_INCIDENT],
    ],
    [
      "another pair",
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.SMS],
      [CRITICAL_INCIDENT],
    ],
    ["any channel", [], [CRITICAL_INCIDENT]],
    [
      "the same channels for another severity",
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.Push],
      [MAJOR_INCIDENT],
    ],
    [
      "the same channels for every severity",
      [ComplianceNotificationChannel.Push, ComplianceNotificationChannel.Call],
      [],
    ],
  ])(
    "is a different rule from 'Call and Push for Critical' when it asks for %s",
    async (
      _label: string,
      channels: Array<ComplianceNotificationChannel>,
      severities: Array<string>,
    ) => {
      store(CALL_AND_PUSH_FOR_CRITICAL);

      await expect(
        create({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannels: channels,
          incidentSeverities: severities,
        }),
      ).resolves.toBeDefined();
    },
  );

  test("the same channels on the episode rule type are another rule", async () => {
    store(CALL_AND_PUSH_FOR_CRITICAL);

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();
  });

  test.each<[string, DatabaseCommonInteractionProps]>([
    ["a team editor", EDITOR_PROPS],
    ["Edit Teams on its own", memberProps([Permission.EditProjectTeam])],
  ])(
    "what the hook leaves - the list and the channel it adds beside it - passes the create check DatabaseService repeats, for %s",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      const result: OnCreate<TeamComplianceSetting> = await onBeforeCreate(
        createByFor(
          newRule({
            ruleType: ComplianceRuleType.HasAlertOnCallRules,
            notificationChannels: [
              ComplianceNotificationChannel.Push,
              ComplianceNotificationChannel.SMS,
            ],
            alertSeverities: [CRITICAL_ALERT],
          }),
          props,
        ),
      );

      expect(channelsOf(result.createBy.data)).toEqual({
        notificationChannels: [
          ComplianceNotificationChannel.SMS,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.SMS,
      });
      expect((): void => {
        ModelPermission.checkCreatePermissions(
          TeamComplianceSetting,
          result.createBy.data,
          props,
        );
      }).not.toThrow();
    },
  );

  test("a caller with no say in the project is refused before a list is even looked at", async () => {
    await expect(
      onBeforeCreate(
        createByFor(
          newRule({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannels: [ComplianceNotificationChannel.Call, "Pager"],
          }),
          OUTSIDER_PROPS,
        ),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    expectNoReads();
  });
});

describe("TeamComplianceSettingService onBeforeUpdate - channel lists", () => {
  test("a list is written canonical, with its first channel beside it", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannels: [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
      ],
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.Call,
    });
  });

  test("an update that sends only the list is a scope change: it is checked for duplicates, as a set", async () => {
    store(INCIDENT_CALL_CRITICAL, CALL_AND_PUSH_FOR_CRITICAL);

    await expect(
      update({
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ],
      }),
    ).rejects.toThrow(new BadDataException(DUPLICATE_COMPLIANCE_RULE_MESSAGE));

    expect(siblingReads()).toHaveLength(1);
  });

  test("an update that sends only the list is a scope change: the caller's permission is checked before anything is read", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await expect(
      onBeforeUpdate(
        updateByFor(
          { notificationChannels: [ComplianceNotificationChannel.Push] },
          { props: OUTSIDER_PROPS },
        ),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    expectNoReads();
  });

  test("adding a channel to a rule makes a rule neither it nor its one-channel sibling is", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      ...INCIDENT_CALL_CRITICAL,
      id: SIBLING_SETTING_ID,
      notificationChannels: [ComplianceNotificationChannel.Push],
    });

    await expect(
      update({
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
      }),
    ).resolves.toBeDefined();
  });

  test("a channel change keeps the stored severities when it is judged", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      ...CALL_AND_PUSH_FOR_CRITICAL,
      incidentSeverityIds: [MAJOR_INCIDENT],
    });

    // "Call and Push for Critical" - the sibling is for Major.
    await expect(
      update({
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ],
      }),
    ).resolves.toBeDefined();

    // A severity change keeps the stored channels: "Call for Major" is new too.
    await expect(
      update({ incidentSeverities: [MAJOR_INCIDENT] }),
    ).resolves.toBeDefined();
  });

  test.each<[string, Record<string, unknown>, string]>([
    [
      "a list with an unknown channel",
      { notificationChannels: [ComplianceNotificationChannel.Call, "Pager"] },
      UNKNOWN_CHANNEL_MESSAGE("Pager"),
    ],
    [
      "a list with a channel in the wrong case",
      { notificationChannels: ["push"] },
      UNKNOWN_CHANNEL_MESSAGE("push"),
    ],
    [
      "channels that are not a list",
      { notificationChannels: ComplianceNotificationChannel.Call },
      NOT_A_CHANNEL_LIST_MESSAGE,
    ],
    [
      "a garbage single channel beside a good list",
      {
        notificationChannels: [ComplianceNotificationChannel.Call],
        notificationChannel: "Pager",
      },
      UNKNOWN_CHANNEL_MESSAGE("Pager"),
    ],
  ])(
    "refuses %s before anything is read",
    async (_label: string, data: Record<string, unknown>, message: string) => {
      store(INCIDENT_CALL_CRITICAL);

      await expect(update(data)).rejects.toThrow(new BadDataException(message));
      expectNoReads();
    },
  );

  test("a type change to a method rule clears a stored list of several channels", async () => {
    store({
      ...INCIDENT_CALL_CRITICAL,
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Push,
      ],
    });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    });

    await onBeforeUpdate(updateBy);

    expect(channelsOf(dataOf(updateBy))).toEqual({
      notificationChannels: [],
      notificationChannel: null,
    });
  });

  test("a type change to another on-call rule keeps the stored channels, and judges the new rule by them", async () => {
    store(
      {
        ...INCIDENT_CALL_CRITICAL,
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
      },
      {
        ...CALL_AND_PUSH_FOR_CRITICAL,
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      },
    );

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
    });

    await expect(onBeforeUpdate(updateBy)).rejects.toThrow(
      DUPLICATE_COMPLIANCE_RULE_MESSAGE,
    );
    // Not sent, so not rewritten: the row keeps the list it has.
    expect("notificationChannels" in dataOf(updateBy)).toBe(false);
    expect("notificationChannel" in dataOf(updateBy)).toBe(false);
  });

  test("what the hook leaves for any channel payload passes the update check _updateBy repeats", async () => {
    store(INCIDENT_CALL_CRITICAL);

    for (const data of [
      {
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ],
      },
      { notificationChannels: null },
      { notificationChannel: ComplianceNotificationChannel.SMS },
      { notificationChannel: null },
    ]) {
      const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
        ...data,
      });

      await onBeforeUpdate(updateBy);

      expect(Object.keys(dataOf(updateBy)).sort()).toEqual([
        "notificationChannel",
        "notificationChannels",
      ]);
      await expect(
        ModelPermission.checkUpdateQueryPermissions(
          TeamComplianceSetting,
          { _id: SETTING_ID },
          updateBy.data,
          EDITOR_PROPS,
        ),
      ).resolves.toBeDefined();
    }
  });
});

describe("TeamComplianceSettingService - a payload from before the channel list", () => {
  /*
   * API clients written before a rule could require several channels, and a
   * Dashboard bundle from before the list, send notificationChannel alone. It
   * still means what it always meant: exactly that channel, or any channel.
   * Before the list existed the model had no other field, so dropping it -
   * reading such a payload as "any channel" - would silently widen the rule.
   */
  test("create: one channel is stored as a one-item list, with itself beside it", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [CRITICAL_INCIDENT],
    });

    expect(channelsOf(result.createBy.data)).toEqual({
      notificationChannels: [ComplianceNotificationChannel.Call],
      notificationChannel: ComplianceNotificationChannel.Call,
    });
  });

  test("create: null is 'any channel'", async () => {
    const result: OnCreate<TeamComplianceSetting> = await create({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannel: null,
    });

    expect(channelsOf(result.createBy.data)).toEqual({
      notificationChannels: [],
      notificationChannel: null,
    });
  });

  test("create: a channel sent the old way duplicates a rule stored with that channel alone in its list", async () => {
    store({
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).rejects.toThrow(new BadDataException(DUPLICATE_COMPLIANCE_RULE_MESSAGE));
  });

  test("create: ...but not a rule on that channel and another", async () => {
    store(CALL_AND_PUSH_FOR_CRITICAL);

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();
  });

  test("update: one channel replaces the rule's whole list", async () => {
    store({ ...CALL_AND_PUSH_FOR_CRITICAL, id: SETTING_ID });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannel: ComplianceNotificationChannel.SMS,
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      notificationChannels: [ComplianceNotificationChannel.SMS],
      notificationChannel: ComplianceNotificationChannel.SMS,
    });
  });

  test("update: null clears the list to 'any channel' - a scope change, checked for duplicates", async () => {
    store(INCIDENT_CALL_CRITICAL, {
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(update({ notificationChannel: null })).rejects.toThrow(
      DUPLICATE_COMPLIANCE_RULE_MESSAGE,
    );
  });

  test("update: a channel sent the old way is a scope change, so the caller's permission is checked before anything is read", async () => {
    store(INCIDENT_CALL_CRITICAL);

    await expect(
      onBeforeUpdate(
        updateByFor(
          { notificationChannel: ComplianceNotificationChannel.Push },
          { props: OUTSIDER_PROPS },
        ),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    expectNoReads();
  });

  test("update: a rule sent back as it was read - the list and its first channel - keeps its list", async () => {
    store({ ...CALL_AND_PUSH_FOR_CRITICAL, id: SETTING_ID });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [{ _id: CRITICAL_INCIDENT }],
      alertSeverities: [],
      enabled: true,
    });

    await expect(onBeforeUpdate(updateBy)).resolves.toBeDefined();

    expect(channelsOf(dataOf(updateBy))).toEqual({
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.Call,
    });
  });

  test("update: a list changed beside the single channel it was read with is written as the new list", async () => {
    store(INCIDENT_CALL_CRITICAL);

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannels: [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.SMS,
      ],
      // Stale: what the rule was read with.
      notificationChannel: ComplianceNotificationChannel.Call,
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      notificationChannels: [
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.SMS,
    });
  });

  test("update: a channel sent the old way to a method rule is dropped, list and all", async () => {
    store({
      id: SETTING_ID,
      ruleType: ComplianceRuleType.HasNotificationSMSMethod,
    });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannel: ComplianceNotificationChannel.Call,
    });

    await onBeforeUpdate(updateBy);

    expect(dataOf(updateBy)).toEqual({
      notificationChannels: [],
      notificationChannel: null,
    });
  });
});

describe("TeamComplianceSettingService - rules an older build wrote", () => {
  /*
   * An older replica still serving during an upgrade - or the build a site
   * rolled back to - writes only notificationChannel and leaves the list as
   * it was. Its rows are judged by what that column says, so a rule such a
   * build created or changed is neither missed by the duplicate check nor
   * read as a rule it no longer is.
   */
  test("a rule it created - no list, one channel - duplicates a new rule on that one channel", async () => {
    store({
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).rejects.toThrow(new BadDataException(DUPLICATE_COMPLIANCE_RULE_MESSAGE));

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();
  });

  test("a rule it re-pointed to another channel is that channel only, whatever its list still says", async () => {
    store({
      ...CALL_AND_PUSH_FOR_CRITICAL,
      notificationChannel: ComplianceNotificationChannel.SMS,
    });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.SMS],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();
  });

  test("a rule it cleared to 'any channel' is 'any channel', whatever its list still says", async () => {
    store({ ...CALL_AND_PUSH_FOR_CRITICAL, notificationChannel: null });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();
  });

  test("a rule it re-saved without touching the channel keeps its whole list", async () => {
    store({
      ...CALL_AND_PUSH_FOR_CRITICAL,
      notificationChannel: ComplianceNotificationChannel.Call,
    });

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

    await expect(
      create({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.Call],
        incidentSeverities: [CRITICAL_INCIDENT],
      }),
    ).resolves.toBeDefined();
  });

  test("the rule being updated is judged by its single channel when its list disagrees", async () => {
    store(
      {
        // SMS for Critical: an older build re-pointed "Call and Push".
        ...CALL_AND_PUSH_FOR_CRITICAL,
        id: SETTING_ID,
        notificationChannel: ComplianceNotificationChannel.SMS,
      },
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.SMS],
        incidentSeverityIds: [MAJOR_INCIDENT],
      },
    );

    // Re-scoped to Major it is "SMS for Major" - the sibling.
    await expect(
      update({ incidentSeverities: [MAJOR_INCIDENT] }),
    ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
  });

  test("...and by its list when the two agree", async () => {
    store(
      { ...CALL_AND_PUSH_FOR_CRITICAL, id: SETTING_ID },
      {
        id: SIBLING_SETTING_ID,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [ComplianceNotificationChannel.SMS],
        incidentSeverityIds: [MAJOR_INCIDENT],
      },
    );

    // "Call and Push for Major" is not "SMS for Major".
    await expect(
      update({ incidentSeverities: [MAJOR_INCIDENT] }),
    ).resolves.toBeDefined();
  });

  test("an update that sends the list writes the pair, so the row reads as its list again", async () => {
    store({
      ...CALL_AND_PUSH_FOR_CRITICAL,
      id: SETTING_ID,
      notificationChannel: ComplianceNotificationChannel.SMS,
    });

    const updateBy: UpdateBy<TeamComplianceSetting> = updateByFor({
      notificationChannels: [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.SMS,
      ],
    });

    await onBeforeUpdate(updateBy);

    expect(channelsOf(dataOf(updateBy))).toEqual({
      notificationChannels: [
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.SMS,
    });
    expect(
      TeamComplianceSettingServiceClass.getStoredChannels(dataOf(updateBy)),
    ).toEqual([
      ComplianceNotificationChannel.SMS,
      ComplianceNotificationChannel.Push,
    ]);
  });
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
    stubProjectDirectory({});
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
    expect(written["notificationChannels"]).toEqual([]);
    expect(written["notificationChannel"]).toBeNull();
    expect(written["incidentSeverities"]).toEqual([]);
    expect(written["alertSeverities"]).toEqual([]);
  });

  test("a duplicate is refused before anything is written", async () => {
    store({
      id: SIBLING_SETTING_ID,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Push],
      incidentSeverityIds: [CRITICAL_INCIDENT],
    });

    await expect(
      service.updateOneById({
        id: new ObjectID(SETTING_ID),
        data: { notificationChannels: [ComplianceNotificationChannel.Push] },
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

  /*
   * The channel columns are plain columns - the list is JSON, not a relation
   * - so an update that changes only them is a plain column update, and
   * reaches it as the pair the hook wrote.
   */
  test("a channel list reaches the write canonical, with its first channel beside it", async () => {
    await service.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: {
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
      } as never,
      props: { isRoot: true },
    });

    expect(save).not.toHaveBeenCalled();
    expect(repositoryUpdate).toHaveBeenCalledTimes(1);
    expect(repositoryUpdate.mock.calls[0]?.[1]).toMatchObject({
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      notificationChannel: ComplianceNotificationChannel.Call,
    });
  });

  test("a channel sent the old way reaches the write as a one-item list", async () => {
    await service.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: { notificationChannel: ComplianceNotificationChannel.SMS },
      props: { isRoot: true },
    });

    expect(repositoryUpdate).toHaveBeenCalledTimes(1);
    expect(repositoryUpdate.mock.calls[0]?.[1]).toMatchObject({
      notificationChannels: [ComplianceNotificationChannel.SMS],
      notificationChannel: ComplianceNotificationChannel.SMS,
    });
  });

  test("clearing the channels reaches the write as an empty list and no channel", async () => {
    await service.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: { notificationChannels: [] } as never,
      props: { isRoot: true },
    });

    expect(repositoryUpdate).toHaveBeenCalledTimes(1);
    expect(repositoryUpdate.mock.calls[0]?.[1]).toMatchObject({
      notificationChannels: [],
      notificationChannel: null,
    });
  });

  test("a list with a channel this build does not know is refused before anything is written", async () => {
    await expect(
      service.updateOneById({
        id: new ObjectID(SETTING_ID),
        data: {
          notificationChannels: [ComplianceNotificationChannel.Call, "Pager"],
        } as never,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(UNKNOWN_CHANNEL_MESSAGE("Pager"));

    expect(save).not.toHaveBeenCalled();
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  test("a rule type change clears a list of several channels in the same write", async () => {
    storedSettings = [];
    store({
      ...INCIDENT_CALL_CRITICAL,
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
    });

    await service.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: { ruleType: ComplianceRuleType.HasNotificationWebhookMethod },
      props: { isRoot: true },
    });

    const written: Record<string, unknown> = save.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(written["notificationChannels"]).toEqual([]);
    expect(written["notificationChannel"]).toBeNull();
  });
});
