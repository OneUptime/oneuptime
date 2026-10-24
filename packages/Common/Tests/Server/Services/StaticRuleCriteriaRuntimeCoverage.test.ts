import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../Types/Rules/RuleCriteriaFieldRegistry";

interface FormCoverage {
  fields: Set<string>;
  filePath: string;
}

const COMMON_ROOT: string = path.join(__dirname, "../../..");
const REPOSITORY_ROOT: string = path.join(COMMON_ROOT, "..");
const DASHBOARD_SOURCE_ROOT: string = path.join(
  REPOSITORY_ROOT,
  "App/FeatureSet/Dashboard/src",
);
const SERVICES_ROOT: string = path.join(COMMON_ROOT, "Server/Services");

const SPECIAL_EVALUATOR_FILES: Record<string, string> = {
  AlertGroupingRule: "AlertGroupingEngineService.ts",
  IncidentGroupingRule: "IncidentGroupingEngineService.ts",
  AlertReminderRule: "AlertReminderRuleService.ts",
  IncidentReminderRule: "IncidentReminderRuleService.ts",
  ScheduledMaintenanceReminderRule:
    "ScheduledMaintenanceReminderRuleService.ts",
  IncidentSlaRule: "IncidentSlaRuleService.ts",
  NetworkSiteAssignmentRule: "NetworkDeviceService.ts",
  // Which resolved incidents get an AI postmortem draft, and its templates.
  AIPostmortemRule: "../Utils/AI/SRE/PostmortemRules.ts",
};

/*
 * AI rules (investigation rules and auto remediation rules made one) and
 * Postmortem Rules read a condition the same way, so their evaluators hand
 * the matching to one shared matcher: the evaluator names it, and the
 * matcher holds the legacy fields - an incident's in doesIncidentMatch, an
 * alert's in doesAlertMatch. A rule kind is held to the fields of the
 * methods it calls: a postmortem rule, about incidents alone, to the
 * incident's.
 */
const SHARED_INCIDENT_ALERT_MATCHER: string = "IncidentAlertRuleMatcher";
const SHARED_INCIDENT_ALERT_MATCHER_FILE: string = path.join(
  COMMON_ROOT,
  "Server/Utils/Rules/IncidentAlertRuleMatcher.ts",
);
const SHARED_MATCHER_METHODS: ReadonlyArray<string> = [
  "doesIncidentMatch",
  "doesAlertMatch",
];

/*
 * The legacy fields one public method of the shared matcher reads: from its
 * declaration to the next method's.
 */
function extractSharedMatcherMethodFields(
  matcherSource: string,
  method: string,
): Set<string> {
  const start: number = matcherSource.indexOf(`public static async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const nextMethod: number = matcherSource.indexOf(
    "public static async ",
    start + 1,
  );
  const nextPrivate: number = matcherSource.indexOf(
    "private static async ",
    start + 1,
  );
  const ends: Array<number> = [nextMethod, nextPrivate].filter(
    (index: number): boolean => {
      return index !== -1;
    },
  );
  const end: number =
    ends.length > 0 ? Math.min(...ends) : matcherSource.length;

  return extractLegacyFields(matcherSource.slice(start, end));
}

/*
 * AI rules have a second form: a telemetry product's AI rules
 * (TelemetryAiRulesTable) - the same model, with the lane's trigger, whose
 * conditions are about a service and are evaluated by TelemetryAiRules
 * (Common/Types/AI/TelemetryAi). Between them the two forms offer every
 * field the model registers; each is held to its own evaluator.
 */
interface SecondRuleForm {
  formFile: string;
  evaluatorFile: string;
}

// An evaluator reads a rule's criteria, and hands them to the shared matcher.
const SELECTS_CRITERIA: RegExp = /criteria\s*:\s*true/;
const CALLS_SHARED_CRITERIA_MATCHER: RegExp =
  /RuleCriteriaMatcher\.matchesWithLegacy(?:Sync)?\(/;

const SECOND_RULE_FORMS: Record<string, SecondRuleForm> = {
  AutoRemediationRule: {
    formFile: path.join(
      DASHBOARD_SOURCE_ROOT,
      "Components/TelemetryAi/TelemetryAiRulesTable.tsx",
    ),
    evaluatorFile: path.join(
      COMMON_ROOT,
      "Server/Utils/AI/TelemetryAi/TelemetryAiRules.ts",
    ),
  },
};

function listTypescriptReactFiles(directoryPath: string): Array<string> {
  const result: Array<string> = [];

  for (const entry of fs.readdirSync(directoryPath, {
    withFileTypes: true,
  })) {
    const entryPath: string = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      result.push(...listTypescriptReactFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      result.push(entryPath);
    }
  }

  return result;
}

/*
 * A field object whose own stepId is "match-criteria": the stepId found
 * before the next field starts, so a column or filter written earlier on
 * the page (`field: { name: true }`, with no stepId) is never read as the
 * criterion after it.
 */
function extractMatchFields(source: string): Set<string> {
  const fields: Set<string> = new Set<string>();
  const matchFieldPattern: RegExp =
    /field\s*:\s*\{\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*true\s*,?\s*\}\s*,(?:(?!stepId\s*:|field\s*:)[\s\S])*?stepId\s*:\s*["']match-criteria["']/g;

  for (const match of source.matchAll(matchFieldPattern)) {
    fields.add(match[1]!);
  }

  return fields;
}

function extractFormMatchFields(data: {
  filePath: string;
  source: string;
  formSource: string;
}): Set<string> {
  const fields: Set<string> = extractMatchFields(data.formSource);
  const helperPattern: RegExp = /formFields=\{([A-Za-z][A-Za-z0-9]*)\(\)\}/g;

  for (const helperMatch of data.formSource.matchAll(helperPattern)) {
    const importMatch: RegExpMatchArray | null = data.source.match(
      new RegExp(`import\\s+${helperMatch[1]}\\s+from\\s+["'](\\.[^"']+)["']`),
    );
    expect(importMatch).not.toBeNull();

    const helperPath: string = path.resolve(
      path.dirname(data.filePath),
      importMatch![1]!,
    );
    const resolvedPath: string | undefined = [".ts", ".tsx"]
      .map((extension: string): string => {
        return `${helperPath}${extension}`;
      })
      .find((candidate: string): boolean => {
        return fs.existsSync(candidate);
      });
    expect(resolvedPath).toBeDefined();

    for (const field of extractMatchFields(
      fs.readFileSync(resolvedPath!, "utf8"),
    )) {
      fields.add(field);
    }
  }

  return fields;
}

/*
 * A form with a Match Criteria step: one its page writes out, or a shared
 * one - the label and owner rule form (Dashboard Utils/Form/ResourceRuleForm)
 * or the on-call, privacy, SLA, reminder and runbook rule forms
 * (Utils/Form/EventRuleForm) - whose Match step is the same "match-criteria" step and
 * whose page writes its criteria fields itself.
 */
const MATCH_CRITERIA_FORM: RegExp =
  /id\s*:\s*["']match-criteria["']|formSteps=\{get(?:Label|Owner|OnCall|Privacy|Sla|Reminder|Runbook)RuleFormSteps</;

function discoverStaticRuleForms(): {
  formFiles: Array<string>;
  formsByModel: Map<string, FormCoverage>;
  secondFormsByModel: Map<string, FormCoverage>;
  metricPipelineFile: string;
} {
  const formFiles: Array<string> = listTypescriptReactFiles(
    DASHBOARD_SOURCE_ROOT,
  ).filter((filePath: string): boolean => {
    return (
      fs.readFileSync(filePath, "utf8").match(MATCH_CRITERIA_FORM) !== null
    );
  });
  const metricPipelineFile: string = path.join(
    DASHBOARD_SOURCE_ROOT,
    "Pages/Metrics/Settings/PipelineRules.tsx",
  );
  const formsByModel: Map<string, FormCoverage> = new Map();
  const secondFormsByModel: Map<string, FormCoverage> = new Map();
  const modelTypePattern: RegExp = /modelType=\{([A-Za-z][A-Za-z0-9]*Rule)\}/g;

  for (const filePath of formFiles) {
    const source: string = fs.readFileSync(filePath, "utf8");
    const modelMatches: Array<RegExpMatchArray> = [
      ...source.matchAll(modelTypePattern),
    ];

    expect(modelMatches.length).toBeGreaterThan(0);

    for (let index: number = 0; index < modelMatches.length; index++) {
      const match: RegExpMatchArray = modelMatches[index]!;
      const nextMatch: RegExpMatchArray | undefined = modelMatches[index + 1];
      const modelName: string = match[1]!;
      const sourceStart: number = match.index!;
      const sourceEnd: number = nextMatch?.index || source.length;
      const fields: Set<string> = extractFormMatchFields({
        filePath: filePath,
        source: source,
        formSource: source.slice(sourceStart, sourceEnd),
      });

      expect(fields.size).toBeGreaterThan(0);

      if (SECOND_RULE_FORMS[modelName]?.formFile === filePath) {
        expect(secondFormsByModel.has(modelName)).toBe(false);
        secondFormsByModel.set(modelName, { fields, filePath });
        continue;
      }

      expect(formsByModel.has(modelName)).toBe(false);
      formsByModel.set(modelName, { fields, filePath });
    }
  }

  return {
    formFiles,
    formsByModel,
    secondFormsByModel,
    metricPipelineFile,
  };
}

function getEvaluatorFileName(modelName: string): string {
  return (
    SPECIAL_EVALUATOR_FILES[modelName] ||
    `${modelName.replace(/Rule$/, "")}RuleEngineService.ts`
  );
}

function extractLegacyFields(source: string): Set<string> {
  const result: Set<string> = new Set<string>();
  const legacyFieldsPattern: RegExp = /legacyFields\s*:\s*\[([\s\S]*?)\]/g;

  for (const legacyFieldsMatch of source.matchAll(legacyFieldsPattern)) {
    for (const fieldMatch of legacyFieldsMatch[1]!.matchAll(
      /["']([A-Za-z][A-Za-z0-9]*)["']/g,
    )) {
      result.add(fieldMatch[1]!);
    }
  }

  return result;
}

function getInheritedRuleModelNames(): Array<string> {
  const inheritanceTestSource: string = fs.readFileSync(
    path.join(
      COMMON_ROOT,
      "Tests/Models/DatabaseModels/StaticRuleCriteriaInheritance.test.ts",
    ),
    "utf8",
  );
  const inventoryMatch: RegExpMatchArray | null = inheritanceTestSource.match(
    /STATIC_MATCH_CRITERIA_RULE_MODEL_NAMES[^=]*=\s*\[([\s\S]*?)\];/,
  );

  expect(inventoryMatch).not.toBeNull();

  return [...inventoryMatch![1]!.matchAll(/["']([A-Za-z0-9]+)["']/g)]
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

describe("static rule criteria runtime coverage", () => {
  const { formFiles, formsByModel, secondFormsByModel, metricPipelineFile } =
    discoverStaticRuleForms();
  const inheritedRuleModelNames: Array<string> = getInheritedRuleModelNames();

  /*
   * 72 forms and 83 models: the investigation rules' form and model went
   * when they became AI rules - AiRulesTable for incidents and alerts, and
   * TelemetryAiRulesTable for the telemetry products, for the one model.
   */
  test("all 72 static match-criteria forms route their 83 rule models through ModelForm", () => {
    expect(formFiles).toHaveLength(72);
    expect(formsByModel.size).toBe(83);
    expect([...secondFormsByModel.keys()]).toEqual(
      Object.keys(SECOND_RULE_FORMS),
    );
    expect([...formsByModel.keys()].sort()).toEqual(inheritedRuleModelNames);
    expect(Object.keys(RULE_CRITERIA_FIELDS_BY_MODEL).sort()).toEqual(
      inheritedRuleModelNames,
    );

    for (const [modelName, form] of formsByModel) {
      const registeredFields: ReadonlyArray<string> | undefined =
        RULE_CRITERIA_FIELDS_BY_MODEL[
          modelName as keyof typeof RULE_CRITERIA_FIELDS_BY_MODEL
        ];

      if (!registeredFields) {
        throw new Error(`No rule criteria fields registered for ${modelName}`);
      }

      const secondForm: FormCoverage | undefined =
        secondFormsByModel.get(modelName);

      expect([...registeredFields].sort()).toEqual(
        [
          ...new Set<string>([
            ...form.fields,
            ...(secondForm ? [...secondForm.fields] : []),
          ]),
        ].sort(),
      );

      for (const coverage of secondForm ? [form, secondForm] : [form]) {
        const source: string = fs.readFileSync(coverage.filePath, "utf8");
        const modelTypeOffset: number = source.indexOf(
          `modelType={${modelName}}`,
        );
        const openingTag: string = source.slice(
          Math.max(0, modelTypeOffset - 100),
          modelTypeOffset,
        );

        /*
         * RuleTable (and LabelRuleTable, which wraps it) renders a ModelTable
         * with the same props, so its forms go through ModelForm just the same.
         */
        expect(openingTag).toMatch(
          /<(?:ModelTable|LabelRuleTable|RuleTable)<[^>]+>\s*$/,
        );
      }
    }

    const modelFormSource: string = fs.readFileSync(
      path.join(COMMON_ROOT, "UI/Components/Forms/ModelForm.tsx"),
      "utf8",
    );

    expect(modelFormSource).toContain("addRuleCriteriaToSelect");
    expect(modelFormSource).toContain("replaceLegacyRuleCriteriaFields");
  });

  test.each([...formsByModel.entries()])(
    "%s selects criteria and evaluates every form field through the shared matcher",
    (modelName: string, form: FormCoverage) => {
      const evaluatorFileName: string = getEvaluatorFileName(modelName);
      const evaluatorSource: string = fs.readFileSync(
        path.join(SERVICES_ROOT, evaluatorFileName),
        "utf8",
      );

      expect(evaluatorSource).toContain(modelName);
      expect(evaluatorSource).toMatch(/criteria\s*:\s*true/);

      if (modelName === "NetworkDeviceAutoImportRule") {
        expect(evaluatorSource).toContain("AutoImportRuleMatcher.evaluateHost");

        const matcherSource: string = fs.readFileSync(
          path.join(
            COMMON_ROOT,
            "Utils/NetworkDiscovery/AutoImportRuleMatcher.ts",
          ),
          "utf8",
        );

        expect(matcherSource).toContain("RuleCriteriaMatcher.matchesSync");
        const evaluatorFields: Set<string> = new Set<string>(
          [
            ...matcherSource.matchAll(/case\s+"([A-Za-z][A-Za-z0-9]*)"\s*:/g),
          ].map((match: RegExpMatchArray): string => {
            return match[1]!;
          }),
        );

        expect([...evaluatorFields].sort()).toEqual([...form.fields].sort());
        return;
      }

      if (modelName === "NetworkSiteAssignmentRule") {
        expect(evaluatorSource).toContain("CidrMatchUtil");

        const matcherSource: string = fs.readFileSync(
          path.join(COMMON_ROOT, "Utils/NetworkSite/CidrMatchUtil.ts"),
          "utf8",
        );

        expect(matcherSource).toContain("RuleCriteriaMatcher.matchesSync");
        const evaluatorFields: Set<string> = new Set<string>(
          [
            ...matcherSource.matchAll(
              /filter\.field\s*(?:===|!==)\s*"([A-Za-z][A-Za-z0-9]*)"/g,
            ),
          ].map((match: RegExpMatchArray): string => {
            return match[1]!;
          }),
        );

        expect([...evaluatorFields].sort()).toEqual([...form.fields].sort());
        return;
      }

      if (evaluatorSource.includes(`${SHARED_INCIDENT_ALERT_MATCHER}.`)) {
        const matcherSource: string = fs.readFileSync(
          SHARED_INCIDENT_ALERT_MATCHER_FILE,
          "utf8",
        );

        expect(matcherSource).toMatch(
          /RuleCriteriaMatcher\.matchesWithLegacy(?:Sync)?\(/,
        );

        // The fields of the matcher's methods this rule kind calls.
        const calledMethods: Array<string> = SHARED_MATCHER_METHODS.filter(
          (method: string): boolean => {
            return evaluatorSource.includes(
              `${SHARED_INCIDENT_ALERT_MATCHER}.${method}(`,
            );
          },
        );

        expect(calledMethods.length).toBeGreaterThan(0);

        const evaluatedFields: Set<string> = new Set<string>(
          calledMethods.flatMap((method: string): Array<string> => {
            return [...extractSharedMatcherMethodFields(matcherSource, method)];
          }),
        );

        expect([...evaluatedFields].sort()).toEqual([...form.fields].sort());
        return;
      }

      expect(evaluatorSource).toMatch(
        /RuleCriteriaMatcher\.matchesWithLegacy(?:Sync)?\(/,
      );
      expect([...extractLegacyFields(evaluatorSource)].sort()).toEqual(
        [...form.fields].sort(),
      );
    },
  );

  test.each(Object.entries(SECOND_RULE_FORMS))(
    "%s's second form is evaluated, every field, by its own evaluator",
    (modelName: string, second: SecondRuleForm) => {
      const form: FormCoverage | undefined = secondFormsByModel.get(modelName);

      expect(form).toBeDefined();

      const evaluatorSource: string = fs.readFileSync(
        second.evaluatorFile,
        "utf8",
      );

      expect(evaluatorSource).toContain(modelName);
      expect(evaluatorSource).toMatch(SELECTS_CRITERIA);
      expect(evaluatorSource).toMatch(CALLS_SHARED_CRITERIA_MATCHER);
      expect([...extractLegacyFields(evaluatorSource)].sort()).toEqual(
        [...form!.fields].sort(),
      );

      // And none of them is a field the first form already offers.
      const firstForm: FormCoverage | undefined = formsByModel.get(modelName);

      expect(firstForm).toBeDefined();
      expect(
        [...form!.fields].filter((field: string): boolean => {
          return firstForm!.fields.has(field);
        }),
      ).toEqual([]);
    },
  );

  test("the incident and alert rules that share a matcher evaluate every field it reads", () => {
    const sharingModels: Array<string> = [...formsByModel.keys()].filter(
      (modelName: string): boolean => {
        return fs
          .readFileSync(
            path.join(SERVICES_ROOT, getEvaluatorFileName(modelName)),
            "utf8",
          )
          .includes(`${SHARED_INCIDENT_ALERT_MATCHER}.`);
      },
    );

    expect(sharingModels.sort()).toEqual([
      "AIPostmortemRule",
      "AutoRemediationRule",
    ]);

    /*
     * An AI rule is read twice - which incidents it investigates, which it
     * fixes - and both read its conditions with the shared matcher.
     */
    expect(
      fs
        .readFileSync(
          path.join(COMMON_ROOT, "Server/Utils/AI/SRE/InvestigationRules.ts"),
          "utf8",
        )
        .includes(`${SHARED_INCIDENT_ALERT_MATCHER}.doesIncidentMatch(`),
    ).toBe(true);
    expect(
      fs
        .readFileSync(
          path.join(COMMON_ROOT, "Server/Utils/AI/SRE/InvestigationRules.ts"),
          "utf8",
        )
        .includes(`${SHARED_INCIDENT_ALERT_MATCHER}.doesAlertMatch(`),
    ).toBe(true);

    // A postmortem rule, about incidents alone, offers the incident's share.
    const matcherSource: string = fs.readFileSync(
      SHARED_INCIDENT_ALERT_MATCHER_FILE,
      "utf8",
    );

    expect([...formsByModel.get("AIPostmortemRule")!.fields].sort()).toEqual(
      [
        ...extractSharedMatcherMethodFields(matcherSource, "doesIncidentMatch"),
      ].sort(),
    );
    expect(
      fs
        .readFileSync(
          path.join(SERVICES_ROOT, getEvaluatorFileName("AIPostmortemRule")),
          "utf8",
        )
        .includes(`${SHARED_INCIDENT_ALERT_MATCHER}.doesAlertMatch(`),
    ).toBe(false);
  });

  test("leaves the existing Metric Pipeline rule builder outside the generic criteria path", () => {
    const metricPipelineSource: string = fs.readFileSync(
      metricPipelineFile,
      "utf8",
    );

    expect(metricPipelineSource).toContain("modelType={MetricPipelineRule}");
    expect(metricPipelineSource).toContain("field: { filterCondition: true }");
    expect(metricPipelineSource).toContain("field: { filters: true }");
    expect(formsByModel.has("MetricPipelineRule")).toBe(false);
    expect(inheritedRuleModelNames).not.toContain("MetricPipelineRule");
  });
});
