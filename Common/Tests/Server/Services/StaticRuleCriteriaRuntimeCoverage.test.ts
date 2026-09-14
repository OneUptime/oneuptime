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

function extractMatchFields(source: string): Set<string> {
  const fields: Set<string> = new Set<string>();
  const matchFieldPattern: RegExp =
    /field\s*:\s*\{\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*true\s*,?\s*\}\s*,(?:(?!stepId\s*:)[\s\S])*?stepId\s*:\s*["']match-criteria["']/g;

  for (const match of source.matchAll(matchFieldPattern)) {
    fields.add(match[1]!);
  }

  return fields;
}

function discoverStaticRuleForms(): {
  formFiles: Array<string>;
  formsByModel: Map<string, FormCoverage>;
  metricPipelineFile: string;
} {
  const formFiles: Array<string> = listTypescriptReactFiles(
    DASHBOARD_SOURCE_ROOT,
  ).filter((filePath: string): boolean => {
    return (
      fs
        .readFileSync(filePath, "utf8")
        .match(/id\s*:\s*["']match-criteria["']/) !== null
    );
  });
  const metricPipelineFile: string = path.join(
    DASHBOARD_SOURCE_ROOT,
    "Pages/Metrics/Settings/PipelineRules.tsx",
  );
  const formsByModel: Map<string, FormCoverage> = new Map();
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
      const fields: Set<string> = extractMatchFields(
        source.slice(sourceStart, sourceEnd),
      );

      expect(fields.size).toBeGreaterThan(0);
      expect(formsByModel.has(modelName)).toBe(false);
      formsByModel.set(modelName, { fields, filePath });
    }
  }

  return {
    formFiles,
    formsByModel,
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
  const { formFiles, formsByModel, metricPipelineFile } =
    discoverStaticRuleForms();
  const inheritedRuleModelNames: Array<string> = getInheritedRuleModelNames();

  test("all 61 static match-criteria forms route their 73 rule models through ModelForm", () => {
    expect(formFiles).toHaveLength(61);
    expect(formsByModel.size).toBe(73);
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

      expect([...registeredFields].sort()).toEqual([...form.fields].sort());

      const source: string = fs.readFileSync(form.filePath, "utf8");
      const modelTypeOffset: number = source.indexOf(
        `modelType={${modelName}}`,
      );
      const openingTag: string = source.slice(
        Math.max(0, modelTypeOffset - 100),
        modelTypeOffset,
      );

      expect(openingTag).toMatch(/<(?:ModelTable|LabelRuleTable)<[^>]+>\s*$/);
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

      expect(evaluatorSource).toMatch(
        /RuleCriteriaMatcher\.matchesWithLegacy(?:Sync)?\(/,
      );
      expect([...extractLegacyFields(evaluatorSource)].sort()).toEqual(
        [...form.fields].sort(),
      );
    },
  );

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
