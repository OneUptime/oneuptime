import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import RULE_CRITERIA_FIELDS_BY_MODEL, {
  RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION,
} from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import RuleCriteriaSubject, {
  getRuleCriteriaSubjectForModel,
  resolveRuleCriteriaSubject,
  RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE,
  RULE_CRITERIA_SUBJECT_BY_MODEL,
} from "../../../Types/Rules/RuleCriteriaSubject";
import { RULE_CRITERIA_SUBJECT_COPY } from "../../../UI/Components/RuleCriteria/RuleCriteriaSubjectCopy";

/*
 * Which records each rule model's conditions are about: what its form's
 * choice names - "All hosts" / "Only hosts that match conditions" - and
 * what its Match Criteria cell says once it has no conditions.
 */

const DATABASE_MODELS_ROOT: string = path.join(
  __dirname,
  "../../../Models/DatabaseModels",
);

const REGISTERED_MODELS: Array<string> = Object.keys(
  RULE_CRITERIA_FIELDS_BY_MODEL,
).sort();

const MODELS_WITHOUT_A_SUBJECT: Array<string> = [
  ...RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION,
  ...RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE,
].sort();

const MODELS_WITH_A_SUBJECT: Array<string> = REGISTERED_MODELS.filter(
  (model: string): boolean => {
    return !MODELS_WITHOUT_A_SUBJECT.includes(model);
  },
);

// What a rule model's name ends with after the kind of record it is about.
const RULE_KIND_SUFFIX: RegExp =
  /(?:Label|Owner|OnCall|Grouping|Privacy|Reminder|Sla)Rule$/;

const PLURAL_NAME: RegExp = /pluralName:\s*"([^"]+)"/;

/*
 * The kinds of record the product calls something shorter than their
 * model's plural name, as the rest of the Dashboard does.
 */
const SHORTER_NAMES: Record<string, string> = {
  // "DockerSwarm Clusters": the product writes the name in two words.
  DockerSwarmCluster: "docker swarm clusters",
  // "On-Call Duty Policies": the Dashboard says on-call policies.
  OnCallDutyPolicy: "on-call policies",
  // "On-Call Duty Policy Schedules": the Dashboard says on-call schedules.
  OnCallDutyPolicySchedule: "on-call schedules",
  // "Service Level Objectives": the SLO pages say SLOs.
  ServiceLevelObjective: "slos",
};

/*
 * Rule models whose name does not end in the record they are about: a
 * postmortem rule decides about resolved incidents.
 */
const RECORD_MODEL_OF_RULE: Record<string, string> = {
  AIPostmortemRule: "Incident",
};

function recordModelOf(ruleModel: string): string {
  return (
    RECORD_MODEL_OF_RULE[ruleModel] || ruleModel.replace(RULE_KIND_SUFFIX, "")
  );
}

function pluralNameOf(modelName: string): string {
  const source: string = fs.readFileSync(
    path.join(DATABASE_MODELS_ROOT, `${modelName}.ts`),
    "utf8",
  );
  const match: RegExpMatchArray | null = source.match(PLURAL_NAME);

  if (!match) {
    throw new Error(`${modelName} names no pluralName`);
  }

  return match[1]!;
}

describe("RULE_CRITERIA_SUBJECT_BY_MODEL", () => {
  test("names exactly the registered rule models", () => {
    expect(Object.keys(RULE_CRITERIA_SUBJECT_BY_MODEL).sort()).toEqual(
      REGISTERED_MODELS,
    );
    expect(REGISTERED_MODELS.length).toBeGreaterThanOrEqual(80);
  });

  test("names no records for a rule kind that needs a condition: it has no 'All' to offer", () => {
    expect([...RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION].length).toBe(4);

    for (const model of RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION) {
      expect({ model, subject: RULE_CRITERIA_SUBJECT_BY_MODEL[model] }).toEqual(
        { model, subject: null },
      );
    }
  });

  test("leaves the tables of several kinds of record to name their own", () => {
    expect([...RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE].sort()).toEqual([
      "AutoRemediationRule",
      "RunbookRule",
    ]);

    for (const model of RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE) {
      expect(getRuleCriteriaSubjectForModel(model)).toBeNull();
      // Each is a registered model, and none needs a condition.
      expect(REGISTERED_MODELS).toContain(model);
      expect(
        (
          RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION as ReadonlyArray<string>
        ).includes(model),
      ).toBe(false);
    }
  });

  test.each(MODELS_WITH_A_SUBJECT)(
    "%s names the records its conditions are about",
    (model: string) => {
      const subject: RuleCriteriaSubject | null =
        getRuleCriteriaSubjectForModel(model);

      expect(subject).not.toBeNull();
      expect(Object.values(RuleCriteriaSubject)).toContain(subject);
    },
  );

  test.each(MODELS_WITH_A_SUBJECT)(
    "%s's answer is its own records: 'All' + the plural of the model it matches",
    (model: string) => {
      const recordModel: string = recordModelOf(model);
      const expectedNoun: string = (
        SHORTER_NAMES[recordModel] || pluralNameOf(recordModel)
      ).toLowerCase();
      const subject: RuleCriteriaSubject =
        getRuleCriteriaSubjectForModel(model)!;

      expect({
        model,
        all: RULE_CRITERIA_SUBJECT_COPY[subject].all.toLowerCase(),
      }).toEqual({ model, all: `all ${expectedNoun}` });
    },
  );

  test("every kind of record is some rule's", () => {
    const used: Set<RuleCriteriaSubject> = new Set<RuleCriteriaSubject>();

    for (const subject of Object.values(RULE_CRITERIA_SUBJECT_BY_MODEL)) {
      if (subject) {
        used.add(subject);
      }
    }

    expect(Array.from(used).sort()).toEqual(
      [...Object.values(RuleCriteriaSubject)].sort(),
    );
  });
});

describe("getRuleCriteriaSubjectForModel", () => {
  test("answers a rule model by its table name", () => {
    expect(getRuleCriteriaSubjectForModel("IncidentOnCallRule")).toBe(
      RuleCriteriaSubject.Incidents,
    );
    expect(getRuleCriteriaSubjectForModel("AlertEpisodeOnCallRule")).toBe(
      RuleCriteriaSubject.AlertEpisodes,
    );
    expect(getRuleCriteriaSubjectForModel("HostLabelRule")).toBe(
      RuleCriteriaSubject.Hosts,
    );
    expect(
      getRuleCriteriaSubjectForModel("ScheduledMaintenanceReminderRule"),
    ).toBe(RuleCriteriaSubject.ScheduledMaintenanceEvents);
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["NotARule"],
    ["constructor"],
    ["toString"],
    ["__proto__"],
    ["hasOwnProperty"],
  ])("answers null for %p", (name: string | null | undefined) => {
    expect(getRuleCriteriaSubjectForModel(name)).toBeNull();
  });
});

describe("resolveRuleCriteriaSubject", () => {
  test("a table's own records win over the model's", () => {
    expect(
      resolveRuleCriteriaSubject({
        modelName: "RunbookRule",
        subject: RuleCriteriaSubject.ScheduledMaintenanceEvents,
      }),
    ).toBe(RuleCriteriaSubject.ScheduledMaintenanceEvents);
    expect(
      resolveRuleCriteriaSubject({
        modelName: "IncidentOnCallRule",
        subject: RuleCriteriaSubject.Alerts,
      }),
    ).toBe(RuleCriteriaSubject.Alerts);
  });

  test("without one, the model names them", () => {
    expect(resolveRuleCriteriaSubject({ modelName: "MonitorOwnerRule" })).toBe(
      RuleCriteriaSubject.Monitors,
    );
    expect(
      resolveRuleCriteriaSubject({
        modelName: "MonitorOwnerRule",
        subject: null,
      }),
    ).toBe(RuleCriteriaSubject.Monitors);
  });

  test("and nothing names the records of a table that does not say", () => {
    expect(resolveRuleCriteriaSubject({ modelName: "RunbookRule" })).toBeNull();
    expect(resolveRuleCriteriaSubject({ modelName: undefined })).toBeNull();
  });
});
