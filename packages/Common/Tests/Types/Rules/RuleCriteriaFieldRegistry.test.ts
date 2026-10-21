import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import RULE_CRITERIA_FIELDS_BY_MODEL, {
  RULE_CRITERIA_FIELDS_BY_MODEL as NAMED_RULE_CRITERIA_FIELDS_BY_MODEL,
  RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION,
  getRuleCriteriaFieldsForModel,
  isRuleCriteriaConditionRequired,
} from "../../../Types/Rules/RuleCriteriaFieldRegistry";

const DATABASE_MODELS_ROOT: string = path.join(
  __dirname,
  "../../../Models/DatabaseModels",
);

const MODEL_NAMES: Array<string> = Object.keys(RULE_CRITERIA_FIELDS_BY_MODEL);

/*
 * Fields that describe what a rule DOES rather than what it matches. None of
 * them may ever become an allowlisted match predicate: a filter on
 * "ownerUsers" would let an API caller make a rule match on its own action.
 */
const ACTION_OR_BOOKKEEPING_FIELDS: Array<string> = [
  "_id",
  "id",
  "projectId",
  "project",
  "name",
  "description",
  "isEnabled",
  "priority",
  "order",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "createdByUser",
  "createdByUserId",
  "deletedByUser",
  "deletedByUserId",
  "ownerUsers",
  "ownerTeams",
  "labelsToAdd",
  "onCallDutyPolicies",
  "criteria",
];

function readModelSource(modelName: string): string {
  return fs.readFileSync(
    path.join(DATABASE_MODELS_ROOT, `${modelName}.ts`),
    "utf8",
  );
}

describe("RULE_CRITERIA_FIELDS_BY_MODEL", () => {
  test("the default export and the named export are the same object", () => {
    expect(RULE_CRITERIA_FIELDS_BY_MODEL).toBe(
      NAMED_RULE_CRITERIA_FIELDS_BY_MODEL,
    );
  });

  test("registers a non-trivial number of rule models", () => {
    expect(MODEL_NAMES.length).toBeGreaterThanOrEqual(70);
  });

  test("every registered name is a *Rule model name", () => {
    for (const modelName of MODEL_NAMES) {
      expect(modelName).toMatch(/^[A-Z][A-Za-z0-9]*Rule$/);
    }
  });

  test.each(MODEL_NAMES)(
    "%s has at least one criteria field",
    (modelName: string) => {
      const fields: ReadonlyArray<string> | undefined =
        RULE_CRITERIA_FIELDS_BY_MODEL[modelName];

      expect(Array.isArray(fields)).toBe(true);
      expect(fields!.length).toBeGreaterThan(0);
    },
  );

  test.each(MODEL_NAMES)(
    "%s lists each field exactly once",
    (modelName: string) => {
      const fields: ReadonlyArray<string> =
        RULE_CRITERIA_FIELDS_BY_MODEL[modelName]!;

      expect(new Set(fields).size).toBe(fields.length);
    },
  );

  test.each(MODEL_NAMES)(
    "%s only lists camelCase identifiers",
    (modelName: string) => {
      for (const field of RULE_CRITERIA_FIELDS_BY_MODEL[modelName]!) {
        expect(field).toMatch(/^[a-z][A-Za-z0-9]*$/);
      }
    },
  );

  test.each(MODEL_NAMES)(
    "%s never allowlists an action or bookkeeping field as a match predicate",
    (modelName: string) => {
      for (const field of RULE_CRITERIA_FIELDS_BY_MODEL[modelName]!) {
        expect(ACTION_OR_BOOKKEEPING_FIELDS).not.toContain(field);
      }
    },
  );

  test.each(MODEL_NAMES)(
    "%s names a database model that declares every registered field",
    (modelName: string) => {
      const modelPath: string = path.join(
        DATABASE_MODELS_ROOT,
        `${modelName}.ts`,
      );

      expect(fs.existsSync(modelPath)).toBe(true);

      const source: string = readModelSource(modelName);

      for (const field of RULE_CRITERIA_FIELDS_BY_MODEL[modelName]!) {
        const declaration: RegExp = new RegExp(
          `public\\s+${field}\\??\\s*[:=]`,
        );

        expect({
          modelName,
          field,
          declared: declaration.test(source),
        }).toEqual({ modelName, field, declared: true });
      }
    },
  );

  test("Label/Owner/OnCall/Privacy sibling rules for the same entity share one criteria contract", () => {
    const siblingSuffixes: Array<string> = [
      "LabelRule",
      "OwnerRule",
      "OnCallRule",
      "PrivacyRule",
      "GroupingRule",
    ];
    const groups: Map<string, Array<string>> = new Map<string, Array<string>>();

    for (const modelName of MODEL_NAMES) {
      const suffix: string | undefined = siblingSuffixes.find(
        (candidate: string) => {
          return modelName.endsWith(candidate);
        },
      );

      if (!suffix) {
        continue;
      }

      const entity: string = modelName.slice(0, -suffix.length);
      const members: Array<string> = groups.get(entity) || [];
      members.push(modelName);
      groups.set(entity, members);
    }

    let comparedGroups: number = 0;

    for (const [, members] of groups) {
      if (members.length < 2) {
        continue;
      }

      comparedGroups++;
      const expected: ReadonlyArray<string> =
        RULE_CRITERIA_FIELDS_BY_MODEL[members[0]!]!;

      for (const member of members.slice(1)) {
        expect({
          member,
          fields: RULE_CRITERIA_FIELDS_BY_MODEL[member],
        }).toEqual({ member, fields: expected });
      }
    }

    expect(comparedGroups).toBeGreaterThan(20);
  });

  test("alert rules match on alert severities and incident rules on incident severities, never the other way round", () => {
    for (const modelName of MODEL_NAMES) {
      const fields: ReadonlyArray<string> =
        RULE_CRITERIA_FIELDS_BY_MODEL[modelName]!;

      if (modelName.startsWith("Alert")) {
        expect(fields).not.toContain("incidentSeverities");
      }

      if (modelName.startsWith("Incident")) {
        expect(fields).not.toContain("alertSeverities");
      }
    }
  });

  /*
   * The three tables that serve incident and alert rules alike, told apart
   * by their triggerEntityType. Each rule still uses only its own trigger's
   * severities (the auto-remediation, investigation and runbook rule forms
   * offer one or the other, and AIInvestigationRuleService and
   * RunbookRuleService refuse the other).
   */
  test("only the trigger-entity rules can match both incident and alert severities", () => {
    const both: Array<string> = MODEL_NAMES.filter((modelName: string) => {
      const fields: ReadonlyArray<string> =
        RULE_CRITERIA_FIELDS_BY_MODEL[modelName]!;
      return (
        fields.includes("incidentSeverities") &&
        fields.includes("alertSeverities")
      );
    });

    expect(both).toEqual([
      "AIInvestigationRule",
      "AutoRemediationRule",
      "RunbookRule",
    ]);
  });

  test("pins a few representative contracts exactly", () => {
    expect(RULE_CRITERIA_FIELDS_BY_MODEL["AlertReminderRule"]).toEqual([
      "alertSeverities",
      "labels",
    ]);
    expect(
      RULE_CRITERIA_FIELDS_BY_MODEL["ScheduledMaintenanceReminderRule"],
    ).toEqual(["labels"]);
    expect(RULE_CRITERIA_FIELDS_BY_MODEL["NetworkSiteAssignmentRule"]).toEqual([
      "subnetCidr",
      "hostnamePattern",
    ]);
    // What incident, alert and scheduled maintenance rules match on, together.
    expect(RULE_CRITERIA_FIELDS_BY_MODEL["RunbookRule"]).toEqual([
      "monitors",
      "incidentSeverities",
      "alertSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
      "monitorNamePattern",
      "monitorDescriptionPattern",
    ]);
    // IncidentSlaRule deliberately carries no monitor name/description patterns.
    expect(RULE_CRITERIA_FIELDS_BY_MODEL["IncidentSlaRule"]).not.toContain(
      "monitorNamePattern",
    );
    // An infrastructure resource matches on its labels, then its name and description.
    expect(RULE_CRITERIA_FIELDS_BY_MODEL["StorageArrayLabelRule"]).toEqual([
      "storageArrayLabels",
      "storageArrayNamePattern",
      "storageArrayDescriptionPattern",
    ]);
    expect(RULE_CRITERIA_FIELDS_BY_MODEL["StorageArrayOwnerRule"]).toEqual(
      RULE_CRITERIA_FIELDS_BY_MODEL["StorageArrayLabelRule"],
    );
  });
});

/*
 * Most rule kinds read "no conditions" as "match everything"; a few match
 * nothing until they have one, and their services refuse to save an empty
 * condition list. The dashboard words its empty builder and its rule summary
 * from this list and asks for a condition before sending the form, so the list
 * has to name exactly the services that refuse.
 */
describe("RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION", () => {
  const SERVICES_ROOT: string = path.join(
    __dirname,
    "../../../Server/Services",
  );
  const REFUSES_EMPTY_CONDITIONS: RegExp = /at least one [a-z -]*condition/i;

  test("names exactly the rule kinds whose services refuse no conditions", () => {
    const refusing: Array<string> = fs
      .readdirSync(SERVICES_ROOT)
      .filter((file: string): boolean => {
        return (
          file.endsWith("Service.ts") &&
          REFUSES_EMPTY_CONDITIONS.test(
            fs.readFileSync(path.join(SERVICES_ROOT, file), "utf8"),
          )
        );
      })
      .map((file: string): string => {
        return file.replace(/Service\.ts$/, "");
      })
      .sort();

    expect(refusing.length).toBeGreaterThan(0);
    expect([...RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION].sort()).toEqual(
      refusing,
    );
  });

  test("every one is a registered rule model", () => {
    for (const modelName of RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION) {
      expect(MODEL_NAMES).toContain(modelName);
    }
  });

  test("isRuleCriteriaConditionRequired answers for those and no other", () => {
    for (const modelName of MODEL_NAMES) {
      expect({
        modelName,
        required: isRuleCriteriaConditionRequired(modelName),
      }).toEqual({
        modelName,
        required: (
          RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION as ReadonlyArray<string>
        ).includes(modelName),
      });
    }

    expect(isRuleCriteriaConditionRequired(null)).toBe(false);
    expect(isRuleCriteriaConditionRequired(undefined)).toBe(false);
    expect(isRuleCriteriaConditionRequired("")).toBe(false);
    expect(isRuleCriteriaConditionRequired("statuspagemonitorrule")).toBe(
      false,
    );
  });
});

describe("getRuleCriteriaFieldsForModel", () => {
  test.each(MODEL_NAMES)(
    "returns the registered fields for %s",
    (modelName: string) => {
      expect(getRuleCriteriaFieldsForModel(modelName)).toBe(
        RULE_CRITERIA_FIELDS_BY_MODEL[modelName],
      );
    },
  );

  test("returns undefined for a model that is not registered", () => {
    expect(getRuleCriteriaFieldsForModel("Monitor")).toBeUndefined();
    expect(getRuleCriteriaFieldsForModel("NotARealRule")).toBeUndefined();
    expect(getRuleCriteriaFieldsForModel("")).toBeUndefined();
  });

  test("is case-sensitive: a near-miss spelling is not registered", () => {
    expect(getRuleCriteriaFieldsForModel("alertlabelrule")).toBeUndefined();
    expect(getRuleCriteriaFieldsForModel("ALERTLABELRULE")).toBeUndefined();
    expect(getRuleCriteriaFieldsForModel(" AlertLabelRule")).toBeUndefined();
  });

  /*
   * Regression: the lookup used a plain index, so inherited Object.prototype
   * members answered with a function or object instead of undefined. A caller
   * that treats "not undefined" as "registered" would then call .includes()
   * on a function and throw a TypeError instead of rejecting the model.
   */
  test.each([
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__proto__",
    "__defineGetter__",
  ])(
    "returns undefined for the inherited property name %s",
    (modelName: string) => {
      expect(getRuleCriteriaFieldsForModel(modelName)).toBeUndefined();
    },
  );
});
