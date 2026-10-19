import PostmortemRules, {
  POSTMORTEM_DRAFT_PLAN_WITHOUT_RULES,
  POSTMORTEM_RULE_INCIDENT_SELECT,
  PostmortemDraftPlan,
} from "../../../../Server/Utils/AI/SRE/PostmortemRules";
import AIPostmortemRuleService from "../../../../Server/Services/AIPostmortemRuleService";
import IncidentPostmortemTemplateService from "../../../../Server/Services/IncidentPostmortemTemplateService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import AIPostmortemRule from "../../../../Models/DatabaseModels/AIPostmortemRule";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentPostmortemTemplate from "../../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { MAX_POSTMORTEM_RULE_TEMPLATES } from "../../../../Types/AI/PostmortemRuleTemplates";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * PostmortemRules: whether a resolved incident gets an AI postmortem draft,
 * and the templates the draft may follow.
 *
 *   - No enabled rule: every resolved incident, in the standard outline -
 *     what drafting did before rules existed.
 *   - Rules, read from the top of the list down: the FIRST that matches
 *     decides - its templates, none for the standard outline. No match: no
 *     draft.
 *   - The conditions are read by the real shared matcher, as investigation
 *     and auto remediation rules read theirs.
 *   - The templates are the project's own that still exist and have an
 *     outline, by name; below the plan templates need, none.
 *   - Rules or templates that cannot be read: no plan, so no draft.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const CRITICAL_ID: string = "44444444-4444-4444-8444-444444444441";
const MINOR_ID: string = "44444444-4444-4444-8444-444444444442";
const DATABASE_LABEL_ID: string = "55555555-5555-4555-8555-555555555551";
const TEST_LABEL_ID: string = "55555555-5555-4555-8555-555555555552";

const DATABASE_OUTAGE_ID: string = "66666666-6666-4666-8666-666666666661";
const SECURITY_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666662";
const CUSTOMER_OUTAGE_ID: string = "66666666-6666-4666-8666-666666666663";

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

let savedEnvironment: Record<string, string | undefined> = {};

function severity(id: string): IncidentSeverity {
  const model: IncidentSeverity = new IncidentSeverity();
  model._id = id;
  return model;
}

function label(id: string): Label {
  const model: Label = new Label();
  model._id = id;
  return model;
}

function templateRef(id: string): IncidentPostmortemTemplate {
  const model: IncidentPostmortemTemplate = new IncidentPostmortemTemplate();
  model._id = id;
  return model;
}

function rule(
  name: string,
  values: Partial<AIPostmortemRule> = {},
): AIPostmortemRule {
  return Object.assign(new AIPostmortemRule(), {
    _id: ObjectID.generate().toString(),
    name,
    isEnabled: true,
    ...values,
  });
}

function incident(values: Partial<Incident> = {}): Incident {
  return Object.assign(new Incident(), {
    _id: INCIDENT_ID.toString(),
    title: "Postgres primary is down",
    description: "Connections refused on the primary.",
    incidentSeverityId: new ObjectID(CRITICAL_ID),
    labels: [label(DATABASE_LABEL_ID)],
    monitors: [],
    ...values,
  });
}

// The project's postmortem templates, as the template service holds them.
const STORED_TEMPLATES: Array<IncidentPostmortemTemplate> = [
  Object.assign(new IncidentPostmortemTemplate(), {
    _id: DATABASE_OUTAGE_ID,
    templateName: "Database outage",
    templateDescription: "Database failures and failovers.",
    postmortemNote: "## Summary\n\n## Replication and failover",
  }),
  Object.assign(new IncidentPostmortemTemplate(), {
    _id: SECURITY_INCIDENT_ID,
    templateName: "Security incident",
    templateDescription: "  Anything that touched access.  ",
    postmortemNote: "## Exposure",
  }),
  Object.assign(new IncidentPostmortemTemplate(), {
    _id: CUSTOMER_OUTAGE_ID,
    templateName: "Customer-facing outage",
    templateDescription: "",
    // A template with no outline cannot be followed.
    postmortemNote: "   ",
  }),
];

/*
 * The ids an `_id: QueryHelper.any(ids)` asks for: a Raw operator, whose
 * values are its one parameter.
 */
function idsAskedFor(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    ((operator || {}) as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {};

  return (
    (Object.values(parameters)[0] as Array<unknown> | undefined) || []
  ).map((id: unknown): string => {
    return String(id);
  });
}

let rulesRead: ReturnType<typeof jest.spyOn>;
let templatesRead: ReturnType<typeof jest.spyOn>;
let planRead: ReturnType<typeof jest.spyOn>;
let errorLog: ReturnType<typeof jest.spyOn>;

function storeRules(rules: Array<AIPostmortemRule>): void {
  rulesRead.mockResolvedValue(rules as never);
}

function onPlan(plan: PlanType | null): void {
  planRead.mockResolvedValue({
    plan,
    isSubscriptionUnpaid: false,
  } as never);
}

async function planFor(
  values: Partial<Incident> = {},
): Promise<PostmortemDraftPlan | null> {
  return await PostmortemRules.getIncidentDraftPlan({
    projectId: PROJECT_ID,
    incident: incident(values),
  });
}

function templateNames(plan: PostmortemDraftPlan | null): Array<string> {
  return (plan?.templates || []).map((template: { name: string }): string => {
    return template.name;
  });
}

beforeEach(() => {
  savedEnvironment = {};

  for (const [key, value] of Object.entries(PLAN_ENVIRONMENT)) {
    savedEnvironment[key] = process.env[key];
    process.env[key] = value;
  }

  rulesRead = jest
    .spyOn(AIPostmortemRuleService, "findBy")
    .mockResolvedValue([] as never);
  templatesRead = jest
    .spyOn(IncidentPostmortemTemplateService, "findBy")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const query: { _id?: unknown } = ((
        data as {
          query?: unknown;
        }
      ).query || {}) as { _id?: unknown };
      const asked: Array<string> = idsAskedFor(query._id).map(
        (id: string): string => {
          return id.toLowerCase();
        },
      );

      return STORED_TEMPLATES.filter(
        (template: IncidentPostmortemTemplate): boolean => {
          return asked.includes(String(template._id).toLowerCase());
        },
      ).sort(
        (
          first: IncidentPostmortemTemplate,
          second: IncidentPostmortemTemplate,
        ): number => {
          return (first.templateName || "").localeCompare(
            second.templateName || "",
          );
        },
      ) as never;
    });
  planRead = jest.spyOn(ProjectService, "getCurrentPlan");
  onPlan(PlanType.Growth);
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.restoreAllMocks();
});

describe("PostmortemRules.getIncidentDraftPlan - no rule", () => {
  it("drafts every resolved incident in the standard outline, as before rules existed", async () => {
    const plan: PostmortemDraftPlan | null = await planFor();

    expect(plan).toEqual({
      isInScope: true,
      rulesChecked: 0,
      rule: null,
      templates: [],
    });
    expect(plan).toBe(POSTMORTEM_DRAFT_PLAN_WITHOUT_RULES);
    expect(templatesRead).not.toHaveBeenCalled();
    expect(planRead).not.toHaveBeenCalled();
  });

  it("reads the project's enabled rules as root, top of the list first, with what matching and drafting need", async () => {
    await planFor();

    expect(rulesRead).toHaveBeenCalledTimes(1);
    expect(rulesRead).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID, isEnabled: true },
      select: {
        _id: true,
        name: true,
        order: true,
        createdAt: true,
        criteria: true,
        titlePattern: true,
        descriptionPattern: true,
        monitors: { _id: true },
        incidentSeverities: { _id: true },
        labels: { _id: true },
        monitorLabels: { _id: true },
        postmortemTemplates: { _id: true },
      },
      sort: { order: SortOrder.Ascending, createdAt: SortOrder.Ascending },
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  });

  it("the incident read for matching holds every field a rule matches on", () => {
    expect(POSTMORTEM_RULE_INCIDENT_SELECT).toEqual({
      title: true,
      description: true,
      incidentSeverityId: true,
      labels: { _id: true },
      monitors: { _id: true },
    });
  });
});

describe("PostmortemRules.getIncidentDraftPlan - with rules", () => {
  it("a rule that matches decides the templates, by name", async () => {
    const critical: AIPostmortemRule = rule("SEV1", {
      incidentSeverities: [severity(CRITICAL_ID)],
      postmortemTemplates: [
        templateRef(SECURITY_INCIDENT_ID),
        templateRef(DATABASE_OUTAGE_ID),
      ],
    });
    storeRules([critical]);

    const plan: PostmortemDraftPlan | null = await planFor();

    expect(plan?.isInScope).toBe(true);
    expect(plan?.rulesChecked).toBe(1);
    expect(plan?.rule?.name).toBe("SEV1");
    expect(plan?.rule?.id.toString()).toBe(critical._id);
    expect(templateNames(plan)).toEqual([
      "Database outage",
      "Security incident",
    ]);
    expect(plan?.templates[0]).toEqual({
      id: new ObjectID(DATABASE_OUTAGE_ID),
      name: "Database outage",
      description: "Database failures and failovers.",
      outline: "## Summary\n\n## Replication and failover",
    });
    // Its description, trimmed.
    expect(plan?.templates[1]?.description).toBe(
      "Anything that touched access.",
    );
  });

  it("the first rule that matches wins, whatever a later one says", async () => {
    storeRules([
      rule("Database incidents", {
        labels: [label(DATABASE_LABEL_ID)],
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
      rule("Critical incidents", {
        incidentSeverities: [severity(CRITICAL_ID)],
        postmortemTemplates: [templateRef(SECURITY_INCIDENT_ID)],
      }),
    ]);

    const plan: PostmortemDraftPlan | null = await planFor();

    expect(plan?.rule?.name).toBe("Database incidents");
    expect(templateNames(plan)).toEqual(["Database outage"]);
    expect(plan?.rulesChecked).toBe(2);
  });

  it("a rule that does not match is passed over for the next", async () => {
    storeRules([
      rule("Minor incidents", {
        incidentSeverities: [severity(MINOR_ID)],
        postmortemTemplates: [templateRef(SECURITY_INCIDENT_ID)],
      }),
      rule("Database incidents", {
        labels: [label(DATABASE_LABEL_ID)],
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ]);

    const plan: PostmortemDraftPlan | null = await planFor();

    expect(plan?.rule?.name).toBe("Database incidents");
    expect(templateNames(plan)).toEqual(["Database outage"]);
  });

  it("an incident no rule matches gets no draft", async () => {
    storeRules([
      rule("Minor incidents", {
        incidentSeverities: [severity(MINOR_ID)],
      }),
      rule("Payment incidents", {
        titlePattern: "payment|checkout",
      }),
    ]);

    expect(await planFor()).toEqual({
      isInScope: false,
      rulesChecked: 2,
      rule: null,
      templates: [],
    });
    expect(templatesRead).not.toHaveBeenCalled();
  });

  it("a rule with no condition matches every incident: a catch-all at the bottom of the list", async () => {
    storeRules([
      rule("Minor incidents", {
        incidentSeverities: [severity(MINOR_ID)],
        postmortemTemplates: [templateRef(SECURITY_INCIDENT_ID)],
      }),
      rule("Everything else"),
    ]);

    const plan: PostmortemDraftPlan | null = await planFor();

    expect(plan?.isInScope).toBe(true);
    expect(plan?.rule?.name).toBe("Everything else");
    // It names no template: the standard outline.
    expect(plan?.templates).toEqual([]);
  });

  it("reads versioned conditions too: every incident but the test ones", async () => {
    storeRules([
      rule("Not tests", {
        criteria: {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "labels",
              operator: RuleCriteriaOperator.HasNoneOf,
              value: [TEST_LABEL_ID],
            },
          ],
        },
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ]);

    expect((await planFor())?.isInScope).toBe(true);
    expect((await planFor({ labels: [label(TEST_LABEL_ID)] }))?.isInScope).toBe(
      false,
    );
  });

  it("matches the incident's title and description as the other incident rules do", async () => {
    storeRules([
      rule("Postgres", {
        titlePattern: "postgres",
        descriptionPattern: "refused",
      }),
    ]);

    expect((await planFor())?.isInScope).toBe(true);
    expect((await planFor({ description: "Disk is full." }))?.isInScope).toBe(
      false,
    );
  });
});

describe("PostmortemRules.getIncidentDraftPlan - the templates", () => {
  it("reads only the project's own templates, as root, at most as many as a rule may name", async () => {
    storeRules([
      rule("SEV1", {
        postmortemTemplates: [
          templateRef(DATABASE_OUTAGE_ID),
          templateRef(SECURITY_INCIDENT_ID),
        ],
      }),
    ]);

    await planFor();

    expect(templatesRead).toHaveBeenCalledTimes(1);
    const read: Record<string, unknown> = templatesRead.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = read["query"] as Record<
      string,
      unknown
    >;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(idsAskedFor(query["_id"]).sort()).toEqual(
      [DATABASE_OUTAGE_ID, SECURITY_INCIDENT_ID].sort(),
    );
    expect(read["select"]).toEqual({
      _id: true,
      templateName: true,
      templateDescription: true,
      postmortemNote: true,
    });
    expect(read["limit"]).toBe(MAX_POSTMORTEM_RULE_TEMPLATES);
    expect(read["props"]).toEqual({ isRoot: true });
  });

  it("leaves out a template with no outline to follow", async () => {
    storeRules([
      rule("Customer outages", {
        postmortemTemplates: [
          templateRef(CUSTOMER_OUTAGE_ID),
          templateRef(DATABASE_OUTAGE_ID),
        ],
      }),
    ]);

    expect(templateNames(await planFor())).toEqual(["Database outage"]);
  });

  it("a rule whose templates are all gone drafts in the standard outline, rather than not at all", async () => {
    storeRules([
      rule("Deleted templates", {
        postmortemTemplates: [
          templateRef("77777777-7777-4777-8777-777777777777"),
        ],
      }),
    ]);

    const plan: PostmortemDraftPlan | null = await planFor();

    expect(plan?.isInScope).toBe(true);
    expect(plan?.templates).toEqual([]);
  });

  it("ignores an entry that names no template, and asks for each once", async () => {
    storeRules([
      rule("Odd entries", {
        postmortemTemplates: [
          templateRef(DATABASE_OUTAGE_ID),
          templateRef(DATABASE_OUTAGE_ID),
          templateRef("not-an-id"),
          new IncidentPostmortemTemplate(),
        ],
      }),
    ]);

    expect(templateNames(await planFor())).toEqual(["Database outage"]);

    const query: Record<string, unknown> = (
      templatesRead.mock.calls[0]![0] as Record<string, unknown>
    )["query"] as Record<string, unknown>;

    expect(idsAskedFor(query["_id"])).toEqual([DATABASE_OUTAGE_ID]);
  });

  it("below the plan postmortem templates need, the rule still decides, in the standard outline", async () => {
    onPlan(PlanType.Free);
    storeRules([
      rule("SEV1", {
        incidentSeverities: [severity(CRITICAL_ID)],
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ]);

    const plan: PostmortemDraftPlan | null = await planFor();

    expect(plan?.isInScope).toBe(true);
    expect(plan?.rule?.name).toBe("SEV1");
    expect(plan?.templates).toEqual([]);
    expect(planRead).toHaveBeenCalledWith(PROJECT_ID);
    expect(templatesRead).not.toHaveBeenCalled();
  });

  it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan, the templates are followed",
    async (plan: PlanType) => {
      onPlan(plan);
      storeRules([
        rule("SEV1", {
          postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
        }),
      ]);

      expect(templateNames(await planFor())).toEqual(["Database outage"]);
    },
  );

  it("with no plan (billing off, self-hosted), the templates are followed", async () => {
    onPlan(null);
    storeRules([
      rule("SEV1", {
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ]);

    expect(templateNames(await planFor())).toEqual(["Database outage"]);
  });

  it("a plan this install does not describe stops no draft: the rule is followed as written", async () => {
    for (const key of Object.keys(PLAN_ENVIRONMENT)) {
      delete process.env[key];
    }

    onPlan(PlanType.Free);
    storeRules([
      rule("SEV1", {
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ]);

    expect(templateNames(await planFor())).toEqual(["Database outage"]);
  });

  it("a rule naming no template never asks for the plan", async () => {
    onPlan(PlanType.Free);
    storeRules([rule("Everything")]);

    await planFor();

    expect(planRead).not.toHaveBeenCalled();
  });
});

describe("PostmortemRules.getIncidentDraftPlan - when something cannot be read", () => {
  it("no plan - so no draft - when the rules cannot be read, and the error is logged", async () => {
    rulesRead.mockRejectedValue(new Error("connection reset") as never);

    expect(await planFor()).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("could not read the postmortem rules"),
      expect.objectContaining({ projectId: PROJECT_ID.toString() }),
    );
  });

  it("no plan when the matching rule's templates cannot be read", async () => {
    storeRules([
      rule("SEV1", {
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ]);
    templatesRead.mockRejectedValue(new Error("timeout") as never);

    expect(await planFor()).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not read the templates of postmortem rule",
      ),
      expect.objectContaining({ projectId: PROJECT_ID.toString() }),
    );
  });

  it("no plan when the project's plan cannot be read", async () => {
    storeRules([
      rule("SEV1", {
        postmortemTemplates: [templateRef(DATABASE_OUTAGE_ID)],
      }),
    ]);
    planRead.mockRejectedValue(new Error("Project ID is invalid") as never);

    expect(await planFor()).toBeNull();
  });
});
