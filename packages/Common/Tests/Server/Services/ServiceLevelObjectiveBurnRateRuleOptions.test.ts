import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../Server/Services/LabelService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ServiceLevelObjectiveBurnRateRuleService, {
  BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  BURN_RATE_RULE_OPTION_FLAG_DEFAULTS,
  BURN_RATE_RULE_TEMPLATE_COLUMNS,
  BURN_RATE_RULE_TITLE_TEMPLATE_MAX_LENGTH,
  OWNER_USERS_NOT_IN_PROJECT_ERROR_PREFIX,
} from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * The alert and incident options of an SLO burn rate rule, as the service
 * hooks enforce them:
 *
 *   - five option flags (private, auto-resolve, SLO owners) are coerced from the
 *     strings a public API caller can send, and default exactly like their
 *     columns, so every existing and seeded rule keeps behaving as it did;
 *   - six templates are length-limited like the columns they render into, and
 *     a blank one is stored as NULL;
 *   - labels, owner teams and on-call policies must belong to the rule's own
 *     project, and owner users must be members of it - checked for what a
 *     write INTRODUCES, never for what an update carries forward;
 *   - switching auto-resolve off is not a lifecycle event: nothing is resolved.
 *
 * The existing ServiceLevelObjectiveBurnRateRuleService suite owns the
 * windows, outputs, severities and resolve helpers; this one owns the options.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const LABEL_ID: ObjectID = new ObjectID("a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1");
const SECOND_LABEL_ID: ObjectID = new ObjectID(
  "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
);
const TEAM_ID: ObjectID = new ObjectID("b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1");
const SECOND_TEAM_ID: ObjectID = new ObjectID(
  "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
);
const POLICY_ID: ObjectID = new ObjectID(
  "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
);
const SECOND_POLICY_ID: ObjectID = new ObjectID(
  "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2",
);
const USER_ID: ObjectID = new ObjectID("d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1");
const SECOND_USER_ID: ObjectID = new ObjectID(
  "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2",
);
const OUTSIDER_USER_ID: ObjectID = new ObjectID(
  "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3",
);

const OPTION_FLAGS: Array<keyof typeof BURN_RATE_RULE_OPTION_FLAG_DEFAULTS> = [
  "isAlertPrivate",
  "autoResolveAlert",
  "isIncidentPrivate",
  "autoResolveIncident",
  "addSloOwnersAsOwners",
];

const TEMPLATE_COLUMNS: Array<string> = [
  "alertTitleTemplate",
  "alertDescriptionTemplate",
  "alertRemediationNotes",
  "incidentTitleTemplate",
  "incidentDescriptionTemplate",
  "incidentRemediationNotes",
];

const RELATION_COLUMNS: Array<string> = [
  "onCallDutyPolicies",
  "incidentOnCallDutyPolicies",
  "alertLabels",
  "incidentLabels",
  "alertOwnerTeams",
  "incidentOwnerTeams",
  "alertOwnerUsers",
  "incidentOwnerUsers",
];

type RuleFields = Record<string, unknown>;

function makeRule(fields: RuleFields): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  const writable: Record<string, unknown> = rule as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return rule;
}

function makeValidCreateBy(
  fields: RuleFields,
  props?: CreateBy<ServiceLevelObjectiveBurnRateRule>["props"],
): CreateBy<ServiceLevelObjectiveBurnRateRule> {
  return {
    data: makeRule({
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
      name: "Fast burn",
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
      ...fields,
    }),
    props: props || { isRoot: true },
  };
}

function makeUpdateBy(
  data: RuleFields,
  props?: Record<string, unknown>,
): UpdateBy<ServiceLevelObjectiveBurnRateRule> {
  return {
    query: { _id: RULE_ID.toString() },
    data: data,
    props: props || { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ServiceLevelObjectiveBurnRateRule>;
}

function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveBurnRateRuleService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(ServiceLevelObjectiveBurnRateRuleService, args);
}

async function createdData(
  createBy: CreateBy<ServiceLevelObjectiveBurnRateRule>,
): Promise<Record<string, unknown>> {
  const result: OnCreate<ServiceLevelObjectiveBurnRateRule> = (await callHook(
    "onBeforeCreate",
    createBy,
  )) as OnCreate<ServiceLevelObjectiveBurnRateRule>;

  return result.createBy.data as unknown as Record<string, unknown>;
}

async function updatedData(
  updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule>,
): Promise<Record<string, unknown>> {
  const result: OnUpdate<ServiceLevelObjectiveBurnRateRule> = (await callHook(
    "onBeforeUpdate",
    updateBy,
  )) as OnUpdate<ServiceLevelObjectiveBurnRateRule>;

  return result.updateBy.data as unknown as Record<string, unknown>;
}

async function expectBadData(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await expect(promise).rejects.toThrow(BadDataException);
  await expect(promise).rejects.toThrow(message);
}

function withId<
  TModel extends { _id?: string | undefined; id?: ObjectID | null | undefined },
>(model: TModel, id: ObjectID): TModel {
  model._id = id.toString();
  model.id = id;
  return model;
}

function label(id: ObjectID): Label {
  return withId(new Label(), id);
}

function team(id: ObjectID): Team {
  return withId(new Team(), id);
}

function policy(id: ObjectID): OnCallDutyPolicy {
  return withId(new OnCallDutyPolicy(), id);
}

function user(id: ObjectID): User {
  return withId(new User(), id);
}

function membership(userId: ObjectID): TeamMember {
  const member: TeamMember = new TeamMember();
  member.userId = userId;
  member.projectId = PROJECT_ID;
  return member;
}

interface ValidatedReferences {
  projectId: ObjectID | undefined;
  subject: string | undefined;
  references: Array<{
    modelName: string;
    id: ObjectID | string | undefined;
    service: unknown;
  }>;
}

function validatedReferencesAt(
  spy: jest.SpyInstance,
  index: number,
): ValidatedReferences {
  return spy.mock.calls[index]![0] as ValidatedReferences;
}

// The references of one validator call, reduced to what the tests compare.
function referencesAt(
  spy: jest.SpyInstance,
  index: number,
): Array<{ modelName: string; id: string; service: unknown }> {
  return validatedReferencesAt(spy, index).references.map(
    (reference: {
      modelName: string;
      id: ObjectID | string | undefined;
      service: unknown;
    }) => {
      return {
        modelName: reference.modelName,
        id: String(reference.id),
        service: reference.service,
      };
    },
  );
}

interface MembershipLookup {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

function membershipLookupAt(
  spy: jest.SpyInstance,
  index: number,
): MembershipLookup {
  return spy.mock.calls[index]![0] as MembershipLookup;
}

/*
 * The ids bound into QueryHelper.any's Raw operator (typeorm keeps the bound
 * parameters on the FindOperator).
 */
function boundIdsOf(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> | undefined = (
    operator as { objectLiteralParameters?: Record<string, unknown> }
  ).objectLiteralParameters;

  expect(parameters).toBeDefined();

  const values: Array<unknown> = Object.values(parameters!);

  expect(values).toHaveLength(1);

  return values[0] as Array<string>;
}

/*
 * Every create in this file names SLO_ID, and the check that the SLO belongs
 * to the rule's project reads the database, so it is stubbed file-wide.
 * ServiceLevelObjectiveChildRowTenancy.test.ts drives the real check.
 */
beforeEach(() => {
  jest
    .spyOn(
      SloRecordReferenceValidator,
      "validateServiceLevelObjectivesBelongToProject",
    )
    .mockResolvedValue(undefined);
});

describe("ServiceLevelObjectiveBurnRateRuleService - option flags", () => {
  beforeEach(() => {
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("defaults every flag exactly like its column", () => {
    const model: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();

    expect(Object.keys(BURN_RATE_RULE_OPTION_FLAG_DEFAULTS).sort()).toEqual(
      [...OPTION_FLAGS].sort(),
    );

    for (const flag of OPTION_FLAGS) {
      const metadata: TableColumnMetadata = model.getTableColumnMetadata(flag);

      expect({ flag, type: metadata.type }).toEqual({
        flag,
        type: TableColumnType.Boolean,
      });
      expect({
        flag,
        default: BURN_RATE_RULE_OPTION_FLAG_DEFAULTS[flag],
      }).toEqual({ flag, default: metadata.defaultValue });
    }

    // And those defaults are today's behaviour, spelled out.
    expect(BURN_RATE_RULE_OPTION_FLAG_DEFAULTS).toEqual({
      isAlertPrivate: false,
      autoResolveAlert: true,
      isIncidentPrivate: false,
      autoResolveIncident: true,
      addSloOwnersAsOwners: false,
    });
  });

  it("writes every flag a create payload never mentions as its default", async () => {
    const data: Record<string, unknown> = await createdData(
      makeValidCreateBy({}),
    );

    for (const flag of OPTION_FLAGS) {
      expect({ flag, value: data[flag] }).toEqual({
        flag,
        value: BURN_RATE_RULE_OPTION_FLAG_DEFAULTS[flag],
      });
    }
  });

  /*
   * [value sent, what a default-TRUE flag becomes, what a default-FALSE flag
   * becomes]. BaseModel.fromJSON does not coerce Boolean columns, so every one
   * of these reaches the hook from the public API as-is.
   */
  const COERCION_CASES: Array<[unknown, boolean, boolean]> = [
    [true, true, true],
    [false, false, false],
    ["true", true, true],
    ["false", false, false],
    [" FALSE ", false, false],
    ["0", false, false],
    ["1", true, true],
    // Blank and null mean "no value": the column default.
    ["", true, false],
    ["   ", true, false],
    [null, true, false],
  ];

  it.each(COERCION_CASES)(
    "on create, coerces %p to a real boolean",
    async (
      sent: unknown,
      defaultTrueResult: boolean,
      defaultFalseResult: boolean,
    ) => {
      const fields: RuleFields = {};

      for (const flag of OPTION_FLAGS) {
        fields[flag] = sent;
      }

      const data: Record<string, unknown> = await createdData(
        makeValidCreateBy(fields),
      );

      for (const flag of OPTION_FLAGS) {
        const expected: boolean = BURN_RATE_RULE_OPTION_FLAG_DEFAULTS[flag]
          ? defaultTrueResult
          : defaultFalseResult;

        expect({ flag, value: data[flag] }).toEqual({ flag, value: expected });
      }
    },
  );

  it.each(COERCION_CASES)(
    "on update, coerces %p to a real boolean",
    async (
      sent: unknown,
      defaultTrueResult: boolean,
      defaultFalseResult: boolean,
    ) => {
      const fields: RuleFields = {};

      for (const flag of OPTION_FLAGS) {
        fields[flag] = sent;
      }

      const data: Record<string, unknown> = await updatedData(
        makeUpdateBy(fields),
      );

      for (const flag of OPTION_FLAGS) {
        const expected: boolean = BURN_RATE_RULE_OPTION_FLAG_DEFAULTS[flag]
          ? defaultTrueResult
          : defaultFalseResult;

        expect({ flag, value: data[flag] }).toEqual({ flag, value: expected });
      }
    },
  );

  /*
   * The update-path half of "an absent flag means the default": it must NOT
   * mean that on update, or a form that saves only the rule's name would switch
   * auto-resolve back on and un-private every alert.
   */
  it("on update, leaves every flag the payload does not mention out of it", async () => {
    const data: Record<string, unknown> = await updatedData(
      makeUpdateBy({ name: "Renamed" }),
    );

    for (const flag of OPTION_FLAGS) {
      expect({
        flag,
        present: Object.prototype.hasOwnProperty.call(data, flag),
      }).toEqual({ flag, present: false });
    }
  });

  it("on update, coerces only the flags that are present", async () => {
    const data: Record<string, unknown> = await updatedData(
      makeUpdateBy({ autoResolveIncident: "false" }),
    );

    expect(data["autoResolveIncident"]).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(data, "autoResolveAlert")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(data, "isAlertPrivate")).toBe(
      false,
    );
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService - templates", () => {
  beforeEach(() => {
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("limits exactly the six template columns, titles to their column's length", () => {
    const model: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();

    expect(
      BURN_RATE_RULE_TEMPLATE_COLUMNS.map((template: { column: string }) => {
        return template.column;
      }),
    ).toEqual(TEMPLATE_COLUMNS);

    // The varchar the title columns - and Alert.title / Incident.title - use.
    expect(BURN_RATE_RULE_TITLE_TEMPLATE_MAX_LENGTH).toBe(
      ColumnLength.LongText,
    );
    expect(BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH).toBe(50000);

    for (const template of BURN_RATE_RULE_TEMPLATE_COLUMNS) {
      const metadata: TableColumnMetadata = model.getTableColumnMetadata(
        template.column,
      );
      const isTitle: boolean = template.column.endsWith("TitleTemplate");

      expect({ column: template.column, type: metadata.type }).toEqual({
        column: template.column,
        type: isTitle ? TableColumnType.LongText : TableColumnType.Markdown,
      });
      expect({ column: template.column, max: template.maxLength }).toEqual({
        column: template.column,
        max: isTitle
          ? BURN_RATE_RULE_TITLE_TEMPLATE_MAX_LENGTH
          : BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH,
      });
    }
  });

  it.each(BURN_RATE_RULE_TEMPLATE_COLUMNS)(
    "accepts $column at exactly its limit and rejects one character more",
    async (template: { column: string; title: string; maxLength: number }) => {
      const atLimit: string = "x".repeat(template.maxLength);

      const data: Record<string, unknown> = await createdData(
        makeValidCreateBy({ [template.column]: atLimit }),
      );

      expect(data[template.column]).toBe(atLimit);

      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeValidCreateBy({ [template.column]: `${atLimit}x` }),
        ),
        `${template.title} must be ${template.maxLength} characters or fewer. It is ${template.maxLength + 1} characters long.`,
      );

      // And the same limit on the update path.
      await expectBadData(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ [template.column]: `${atLimit}x` }),
        ),
        `${template.title} must be ${template.maxLength} characters or fewer.`,
      );
    },
  );

  it("stores a blank template as NULL, on create and on update", async () => {
    const blanks: RuleFields = {};

    for (const column of TEMPLATE_COLUMNS) {
      blanks[column] = "  \n\t ";
    }

    const created: Record<string, unknown> = await createdData(
      makeValidCreateBy(blanks),
    );
    const updated: Record<string, unknown> = await updatedData(
      makeUpdateBy(blanks),
    );

    for (const column of TEMPLATE_COLUMNS) {
      expect({ column, created: created[column] }).toEqual({
        column,
        created: null,
      });
      expect({ column, updated: updated[column] }).toEqual({
        column,
        updated: null,
      });
    }
  });

  it("never trims a real template: whitespace is meaningful in markdown", async () => {
    const template: string = "  ## {{sloName}}\n\n    indented code\n";

    const data: Record<string, unknown> = await createdData(
      makeValidCreateBy({ alertDescriptionTemplate: template }),
    );

    expect(data["alertDescriptionTemplate"]).toBe(template);
  });

  it("does not reject a variable it does not know - a newer template must still save", async () => {
    const data: Record<string, unknown> = await createdData(
      makeValidCreateBy({ incidentTitleTemplate: "{{notAVariableYet}}" }),
    );

    expect(data["incidentTitleTemplate"]).toBe("{{notAVariableYet}}");
  });

  // One-element rows, so jest.each never spreads the array-valued case.
  it.each([[42], [true], [{ text: "hi" }], [["a"]]])(
    "rejects a template that is not text (%p)",
    async (value: unknown) => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeValidCreateBy({ alertTitleTemplate: value }),
        ),
        "Alert title template must be text.",
      );
    },
  );

  it("leaves templates the update does not carry untouched", async () => {
    const data: Record<string, unknown> = await updatedData(
      makeUpdateBy({ name: "Renamed" }),
    );

    for (const column of TEMPLATE_COLUMNS) {
      expect(Object.prototype.hasOwnProperty.call(data, column)).toBe(false);
    }
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeCreate - labels, teams, on-call and owners", () => {
  let validatorSpy: jest.SpyInstance;
  let membershipSpy: jest.SpyInstance;

  beforeEach(() => {
    validatorSpy = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
    membershipSpy = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("looks nothing up for a rule that attaches nothing", async () => {
    await createdData(makeValidCreateBy({}));

    expect(validatorSpy).not.toHaveBeenCalled();
    expect(membershipSpy).not.toHaveBeenCalled();
  });

  it("validates every on-call policy, label and team against the rule's project, in one call, whatever shape the ids arrive in", async () => {
    await createdData(
      makeValidCreateBy({
        onCallDutyPolicies: [policy(POLICY_ID)],
        incidentOnCallDutyPolicies: [{ _id: SECOND_POLICY_ID.toString() }],
        alertLabels: [LABEL_ID.toString()],
        incidentLabels: [SECOND_LABEL_ID],
        // The same team twice in one list is one reference.
        alertOwnerTeams: [team(TEAM_ID), team(TEAM_ID)],
        incidentOwnerTeams: [{ _id: SECOND_TEAM_ID.toString().toUpperCase() }],
      }),
    );

    expect(validatorSpy).toHaveBeenCalledTimes(1);
    expect(validatedReferencesAt(validatorSpy, 0).projectId).toEqual(
      PROJECT_ID,
    );
    expect(validatedReferencesAt(validatorSpy, 0).subject).toBe(
      "SLO burn rate rule",
    );

    expect(referencesAt(validatorSpy, 0)).toEqual([
      {
        modelName: "On-Call Duty Policy",
        id: POLICY_ID.toString(),
        service: OnCallDutyPolicyService,
      },
      {
        modelName: "On-Call Duty Policy",
        id: SECOND_POLICY_ID.toString(),
        service: OnCallDutyPolicyService,
      },
      { modelName: "Label", id: LABEL_ID.toString(), service: LabelService },
      {
        modelName: "Label",
        id: SECOND_LABEL_ID.toString(),
        service: LabelService,
      },
      { modelName: "Team", id: TEAM_ID.toString(), service: TeamService },
      // Echoed as the caller sent it, so the error names their input.
      {
        modelName: "Team",
        id: SECOND_TEAM_ID.toString().toUpperCase(),
        service: TeamService,
      },
    ]);

    // Nothing named a user, so membership is never looked up.
    expect(membershipSpy).not.toHaveBeenCalled();
  });

  /*
   * Two calls rather than one merged list, so the pre-existing severity check -
   * and every assertion on its exact references - is untouched by the new
   * lists, and each rejection still names only its own kind of record.
   */
  it("keeps the severity check and the routing check as separate calls", async () => {
    await createdData(
      makeValidCreateBy({
        alertSeverityId: ALERT_SEVERITY_ID,
        alertLabels: [label(LABEL_ID)],
      }),
    );

    expect(validatorSpy).toHaveBeenCalledTimes(2);
    expect(validatedReferencesAt(validatorSpy, 0).references).toHaveLength(2);
    expect(validatedReferencesAt(validatorSpy, 0).references[0]!.service).toBe(
      AlertSeverityService,
    );
    expect(validatedReferencesAt(validatorSpy, 0).references[1]!.service).toBe(
      IncidentSeverityService,
    );
    expect(referencesAt(validatorSpy, 1)).toEqual([
      { modelName: "Label", id: LABEL_ID.toString(), service: LabelService },
    ]);
  });

  it("falls back to the caller's tenant when the payload carries no project", async () => {
    await createdData(
      makeValidCreateBy(
        { projectId: undefined, alertOwnerTeams: [team(TEAM_ID)] },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    );

    expect(validatorSpy).toHaveBeenCalledTimes(1);
    expect(validatedReferencesAt(validatorSpy, 0).projectId).toEqual(
      PROJECT_ID,
    );
  });

  it("checks nothing when neither the payload nor the caller names a project", async () => {
    await createdData(
      makeValidCreateBy({
        projectId: undefined,
        alertLabels: [label(LABEL_ID)],
        alertOwnerUsers: [user(OUTSIDER_USER_ID)],
      }),
    );

    expect(validatorSpy).not.toHaveBeenCalled();
    expect(membershipSpy).not.toHaveBeenCalled();
  });

  it("lets a cross-project team abort the create", async () => {
    validatorSpy.mockRejectedValue(
      new BadDataException(
        'This SLO burn rate rule references records that belong to a different project: Team "Other team".',
      ),
    );

    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeValidCreateBy({ incidentOwnerTeams: [team(TEAM_ID)] }),
      ),
      "belong to a different project",
    );
  });

  it("accepts owner users who are members of the project, in one lookup across both lists", async () => {
    membershipSpy.mockResolvedValue([
      membership(USER_ID),
      // A user in two teams comes back twice; that is still one member.
      membership(SECOND_USER_ID),
      membership(SECOND_USER_ID),
    ]);

    await createdData(
      makeValidCreateBy({
        alertOwnerUsers: [user(USER_ID)],
        incidentOwnerUsers: [
          { _id: USER_ID.toString().toUpperCase() },
          user(SECOND_USER_ID),
        ],
      }),
    );

    expect(membershipSpy).toHaveBeenCalledTimes(1);

    const lookup: MembershipLookup = membershipLookupAt(membershipSpy, 0);

    expect(lookup.query["projectId"]).toEqual(PROJECT_ID);
    // Deduplicated case-insensitively, and asked for in one query.
    expect(boundIdsOf(lookup.query["userId"])).toEqual([
      USER_ID.toString(),
      SECOND_USER_ID.toString(),
    ]);
    expect(lookup.select).toEqual({ userId: true });
    expect(lookup.props).toEqual({ isRoot: true });

    /*
     * Pending invitations count: the dashboard's owner picker lists team
     * members whether or not they have accepted yet, and refusing a user the
     * picker just offered would fail a save nobody could explain.
     */
    expect(lookup.query).not.toHaveProperty("hasAcceptedInvitation");

    // Users are not project-scoped rows, so the reference validator is not the check.
    expect(validatorSpy).not.toHaveBeenCalled();
  });

  it("rejects an owner user who is not a member, naming only the ids that failed", async () => {
    membershipSpy.mockResolvedValue([membership(USER_ID)]);

    const promise: Promise<unknown> = callHook(
      "onBeforeCreate",
      makeValidCreateBy({
        alertOwnerUsers: [user(USER_ID), user(OUTSIDER_USER_ID)],
      }),
    );

    await expectBadData(
      promise,
      `${OWNER_USERS_NOT_IN_PROJECT_ERROR_PREFIX} "${OUTSIDER_USER_ID.toString()}". Please pick users from this project and try again.`,
    );

    await promise.catch((err: Error) => {
      expect(err.message).not.toContain(USER_ID.toString());
    });
  });

  it("matches membership case-insensitively", async () => {
    membershipSpy.mockResolvedValue([membership(USER_ID)]);

    await expect(
      callHook(
        "onBeforeCreate",
        makeValidCreateBy({
          alertOwnerUsers: [USER_ID.toString().toUpperCase()],
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects an owner user when the project has no members matching at all", async () => {
    membershipSpy.mockResolvedValue([]);

    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeValidCreateBy({ incidentOwnerUsers: [user(OUTSIDER_USER_ID)] }),
      ),
      OWNER_USERS_NOT_IN_PROJECT_ERROR_PREFIX,
    );
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeUpdate - labels, teams, on-call and owners", () => {
  let validatorSpy: jest.SpyInstance;
  let membershipSpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    validatorSpy = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
    membershipSpy = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([]);
    findBySpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads and validates nothing when the update carries no list", async () => {
    await updatedData(
      makeUpdateBy(
        { alertTitleTemplate: "{{sloName}}", autoResolveAlert: false },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    );

    expect(findBySpy).not.toHaveBeenCalled();
    expect(validatorSpy).not.toHaveBeenCalled();
    expect(membershipSpy).not.toHaveBeenCalled();
  });

  it("a list cleared to null needs no validation", async () => {
    await updatedData(
      makeUpdateBy(
        { alertLabels: null, incidentOwnerUsers: null },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    );

    expect(findBySpy).not.toHaveBeenCalled();
    expect(validatorSpy).not.toHaveBeenCalled();
    expect(membershipSpy).not.toHaveBeenCalled();
  });

  it("reads back only the lists the update carries, to know what is already stored", async () => {
    /*
     * The owner is a project member, so the update is legal and this case is
     * only about the read; membership rejection has its own cases below.
     */
    membershipSpy.mockResolvedValue([membership(USER_ID)]);

    await updatedData(
      makeUpdateBy(
        { alertLabels: [LABEL_ID], incidentOwnerUsers: [USER_ID] },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    );

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const read: { query: unknown; select: unknown; props: unknown } = findBySpy
      .mock.calls[0]![0] as { query: unknown; select: unknown; props: unknown };

    expect(read.query).toEqual({ _id: RULE_ID.toString() });
    expect(read.select).toEqual({
      _id: true,
      projectId: true,
      alertLabels: { _id: true },
      incidentOwnerUsers: { _id: true },
    });
    expect(read.props).toEqual({ isRoot: true });
  });

  /*
   * The dashboard re-submits every list on every save. Re-validating what a rule
   * already holds would refuse to save a rule - even a rename - because an owner
   * left the project after being added, with the user unable to see why.
   */
  it("validates only what the update introduces, carrying stored ids forward", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
        alertLabels: [label(LABEL_ID)],
        alertOwnerUsers: [user(OUTSIDER_USER_ID)],
      }),
    ]);
    membershipSpy.mockResolvedValue([membership(SECOND_USER_ID)]);

    await updatedData(
      makeUpdateBy(
        {
          alertLabels: [
            LABEL_ID.toString().toUpperCase(),
            SECOND_LABEL_ID.toString(),
          ],
          alertOwnerUsers: [OUTSIDER_USER_ID, SECOND_USER_ID],
        },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    );

    expect(validatorSpy).toHaveBeenCalledTimes(1);
    expect(referencesAt(validatorSpy, 0)).toEqual([
      {
        modelName: "Label",
        id: SECOND_LABEL_ID.toString(),
        service: LabelService,
      },
    ]);

    expect(membershipSpy).toHaveBeenCalledTimes(1);
    expect(
      boundIdsOf(membershipLookupAt(membershipSpy, 0).query["userId"]),
    ).toEqual([SECOND_USER_ID.toString()]);
  });

  it("an owner who has since left the project does not block saving the rule", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
        incidentOwnerUsers: [user(OUTSIDER_USER_ID)],
      }),
    ]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy(
          { incidentOwnerUsers: [user(OUTSIDER_USER_ID)] },
          { isRoot: true, tenantId: PROJECT_ID },
        ),
      ),
    ).resolves.toBeDefined();

    expect(membershipSpy).not.toHaveBeenCalled();
  });

  it("stored ids of one column never excuse the same id in another", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
        alertLabels: [label(LABEL_ID)],
        incidentLabels: [],
      }),
    ]);

    await updatedData(
      makeUpdateBy(
        { alertLabels: [LABEL_ID], incidentLabels: [LABEL_ID] },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    );

    expect(referencesAt(validatorSpy, 0)).toEqual([
      { modelName: "Label", id: LABEL_ID.toString(), service: LabelService },
    ]);
  });

  it("without a tenant, validates against each matched rule's own project and that project's stored ids", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
        alertOwnerTeams: [team(TEAM_ID)],
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        projectId: OTHER_PROJECT_ID,
        alertOwnerTeams: [],
      }),
    ]);

    await updatedData(
      makeUpdateBy({ alertOwnerTeams: [team(TEAM_ID)] }, { isRoot: true }),
    );

    /*
     * The first project already holds the team, so there is nothing to check
     * there; the second does not, so the team is checked against IT - which is
     * exactly how a team from another project gets caught on a bulk update.
     */
    expect(validatorSpy).toHaveBeenCalledTimes(1);
    expect(validatedReferencesAt(validatorSpy, 0).projectId).toEqual(
      OTHER_PROJECT_ID,
    );
    expect(referencesAt(validatorSpy, 0)).toEqual([
      { modelName: "Team", id: TEAM_ID.toString(), service: TeamService },
    ]);
  });

  it("an update that matches no rule and names no tenant validates nothing", async () => {
    await updatedData(
      makeUpdateBy({ alertLabels: [label(LABEL_ID)] }, { isRoot: true }),
    );

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(validatorSpy).not.toHaveBeenCalled();
  });

  it("lets a newly introduced cross-project policy abort the update", async () => {
    validatorSpy.mockRejectedValue(
      new BadDataException(
        'This SLO burn rate rule references records that belong to a different project: On-Call Duty Policy "Other rota".',
      ),
    );

    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy(
          { incidentOnCallDutyPolicies: [policy(POLICY_ID)] },
          { isRoot: true, tenantId: PROJECT_ID },
        ),
      ),
      "belong to a different project",
    );
  });

  it("lets a newly introduced non-member owner abort the update", async () => {
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy(
          { alertOwnerUsers: [user(OUTSIDER_USER_ID)] },
          { isRoot: true, tenantId: PROJECT_ID },
        ),
      ),
      `${OWNER_USERS_NOT_IN_PROJECT_ERROR_PREFIX} "${OUTSIDER_USER_ID.toString()}"`,
    );
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.onUpdateSuccess - the auto-resolve switches", () => {
  let findOneByIdSpy: jest.SpyInstance;
  let resolveAlertsSpy: jest.SpyInstance;
  let resolveIncidentsSpy: jest.SpyInstance;
  let clearStateSpy: jest.SpyInstance;

  beforeEach(() => {
    findOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findOneById")
      .mockResolvedValue(
        makeRule({
          _id: RULE_ID.toString(),
          id: RULE_ID,
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
        }),
      );
    resolveAlertsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);
    resolveIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenIncidentsForRule",
      )
      .mockResolvedValue(undefined);
    clearStateSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "clearOpenOutputStateForRule",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const OPTION_ONLY_UPDATES: Array<[string, RuleFields]> = [
    ["alert auto-resolve switched off", { autoResolveAlert: false }],
    ["incident auto-resolve switched off", { autoResolveIncident: false }],
    [
      "both switched off",
      { autoResolveAlert: false, autoResolveIncident: false },
    ],
    [
      "both switched back on",
      { autoResolveAlert: true, autoResolveIncident: true },
    ],
    [
      "privacy, SLO owners and templates changed",
      {
        isAlertPrivate: true,
        isIncidentPrivate: true,
        addSloOwnersAsOwners: true,
        alertTitleTemplate: "{{sloName}} is burning",
      },
    ],
  ];

  it.each(OPTION_ONLY_UPDATES)(
    "%s: resolves nothing and forgets nothing",
    async (_label: string, data: RuleFields) => {
      await callHook(
        "onUpdateSuccess",
        { updateBy: makeUpdateBy(data), carryForward: null },
        [RULE_ID],
      );

      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(resolveAlertsSpy).not.toHaveBeenCalled();
      expect(resolveIncidentsSpy).not.toHaveBeenCalled();
      expect(clearStateSpy).not.toHaveBeenCalled();
    },
  );

  it('a string "false" sent through the API is a real false before the hook reads it, and still resolves nothing', async () => {
    const updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule> = makeUpdateBy({
      autoResolveAlert: "false",
      autoResolveIncident: "false",
    });

    const before: OnUpdate<ServiceLevelObjectiveBurnRateRule> = (await callHook(
      "onBeforeUpdate",
      updateBy,
    )) as OnUpdate<ServiceLevelObjectiveBurnRateRule>;

    expect(
      (before.updateBy.data as unknown as Record<string, unknown>)[
        "autoResolveAlert"
      ],
    ).toBe(false);

    await callHook("onUpdateSuccess", before, [RULE_ID]);

    expect(resolveAlertsSpy).not.toHaveBeenCalled();
    expect(resolveIncidentsSpy).not.toHaveBeenCalled();
  });

  /*
   * The switches describe what happens when a burn RECOVERS. Disabling the rule
   * is an administrator ending its lifecycle, and a rule that no longer runs
   * cannot justify anything it has open - so the switches are ignored.
   */
  it("disabling the rule still resolves both outputs with auto-resolve off", async () => {
    await callHook(
      "onUpdateSuccess",
      {
        updateBy: makeUpdateBy({
          isEnabled: false,
          autoResolveAlert: false,
          autoResolveIncident: false,
        }),
        carryForward: null,
      },
      [RULE_ID],
    );

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(1);
    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(1);
    expect(clearStateSpy).toHaveBeenCalledWith({
      burnRateRuleId: RULE_ID,
      clearAlert: true,
      clearIncident: true,
    });
  });

  it("switching the alert output off resolves the alert whatever its auto-resolve switch says", async () => {
    await callHook(
      "onUpdateSuccess",
      {
        updateBy: makeUpdateBy({
          shouldCreateAlert: false,
          autoResolveAlert: false,
        }),
        carryForward: null,
      },
      [RULE_ID],
    );

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(1);
    expect(resolveIncidentsSpy).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveService - seeded default rules keep today's behaviour", () => {
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = ALERT_SEVERITY_ID.toString();
    severity.id = ALERT_SEVERITY_ID;

    jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue(severity);

    createSpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
      .mockResolvedValue(new ServiceLevelObjectiveBurnRateRule());

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function seedDefaultRules(): Promise<
    Array<ServiceLevelObjectiveBurnRateRule>
  > {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo._id = SLO_ID.toString();
    slo.id = SLO_ID;
    slo.projectId = PROJECT_ID;
    slo.windowType = SloWindowType.Rolling;
    slo.windowDays = 30;

    const service: Record<string, (...args: Array<unknown>) => Promise<void>> =
      ServiceLevelObjectiveService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<void>
      >;

    await service["seedDefaultBurnRateRules"]!.apply(
      ServiceLevelObjectiveService,
      [slo],
    );

    return createSpy.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>).data;
    });
  }

  it("seeds rules that set none of the new options", async () => {
    const seeded: Array<ServiceLevelObjectiveBurnRateRule> =
      await seedDefaultRules();

    expect(seeded).toHaveLength(2);

    for (const rule of seeded) {
      const fields: Record<string, unknown> = rule as unknown as Record<
        string,
        unknown
      >;

      for (const column of [
        ...OPTION_FLAGS,
        ...TEMPLATE_COLUMNS,
        ...RELATION_COLUMNS,
      ]) {
        expect({ rule: rule.name, column, value: fields[column] }).toEqual({
          rule: rule.name,
          column,
          value: undefined,
        });
      }
    }
  });

  /*
   * And run through the create hook, a seeded rule comes out exactly as a rule
   * always did: public, auto-resolving, no templates, no owners - with no
   * routing lookups on the SLO-create path.
   */
  it("pass through onBeforeCreate as auto-resolving, public rules with no extra lookups", async () => {
    const seeded: Array<ServiceLevelObjectiveBurnRateRule> =
      await seedDefaultRules();

    const validatorSpy: jest.SpyInstance = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
    const membershipSpy: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([]);

    for (const rule of seeded) {
      const data: Record<string, unknown> = await createdData({
        data: rule,
        props: { isRoot: true },
      });

      expect(data).toMatchObject({
        shouldCreateAlert: true,
        shouldCreateIncident: false,
        isAlertPrivate: false,
        autoResolveAlert: true,
        isIncidentPrivate: false,
        autoResolveIncident: true,
        addSloOwnersAsOwners: false,
      });

      for (const column of TEMPLATE_COLUMNS) {
        expect(data[column]).toBeUndefined();
      }
    }

    // One severity check per seeded rule, and nothing else.
    expect(validatorSpy).toHaveBeenCalledTimes(seeded.length);

    for (let index: number = 0; index < seeded.length; index++) {
      expect(
        validatedReferencesAt(validatorSpy, index).references.map(
          (reference: { modelName: string }) => {
            return reference.modelName;
          },
        ),
      ).toEqual(["Alert Severity", "Incident Severity"]);
    }

    expect(membershipSpy).not.toHaveBeenCalled();
  });
});
