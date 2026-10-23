import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  BULK_SWITCH_CONSEQUENCES,
  BulkSwitchConsequence,
  getBulkSwitchConsequence,
} from "../../../UI/Components/BulkUpdate/BulkSwitchConsequences";

/*
 * Every bulk switch says what it does to the records it turns - "A disabled
 * workflow does not run when its trigger fires" - from one catalog
 * (BulkSwitchConsequences), the way every Delete says what goes with a
 * record. A sentence there is a promise to the person about to change many
 * records at once, so:
 *
 *   - it is about a real model's real switch: a boolean column of it;
 *   - it is about the kind, so it reads the same for one row and for many;
 *   - it is a Dashboard translation key, translated in every locale;
 *   - and what it claims is held to the code that makes it true - the query
 *     that leaves a disabled record out, the refusal that turns a run away,
 *     the route that still lets a person run one by hand.
 *
 * Change one of those, and the sentence that describes it has to change too.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../..");
const APP_ROOT: string = path.resolve(COMMON_ROOT, "..", "App");
const DASHBOARD_LOCALES: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

type ModelClass = { new (): BaseModel };

const modelsByTable: Map<string, ModelClass> = new Map();

for (const modelType of AllModelTypes as Array<ModelClass>) {
  const tableName: string | null = new modelType().tableName;

  if (tableName) {
    modelsByTable.set(tableName, modelType);
  }
}

interface CatalogEntry {
  tableName: string;
  column: string;
  side: "on" | "off";
  sentence: string;
}

const ENTRIES: Array<CatalogEntry> = Object.entries(
  BULK_SWITCH_CONSEQUENCES,
).flatMap(
  ([tableName, columns]: [
    string,
    Readonly<Record<string, BulkSwitchConsequence>>,
  ]) => {
    return Object.entries(columns).flatMap(
      ([column, consequence]: [string, BulkSwitchConsequence]) => {
        const entries: Array<CatalogEntry> = [];

        if (consequence.on) {
          entries.push({
            tableName,
            column,
            side: "on",
            sentence: consequence.on,
          });
        }

        if (consequence.off) {
          entries.push({
            tableName,
            column,
            side: "off",
            sentence: consequence.off,
          });
        }

        return entries;
      },
    );
  },
);

const readSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.resolve(COMMON_ROOT, "..", relativePath), "utf8");
};

describe("BulkSwitchConsequences: the catalog", () => {
  test("covers the switches the lists turn in bulk", () => {
    expect(
      ENTRIES.map((entry: CatalogEntry) => {
        return `${entry.tableName}.${entry.column}:${entry.side}`;
      }).sort(),
    ).toEqual(
      [
        "Monitor.disableActiveMonitoring:on",
        "Workflow.isEnabled:on",
        "Workflow.isEnabled:off",
        "Runbook.isEnabled:off",
        "ServiceLevelObjective.isEnabled:off",
        "IncomingCallPolicy.isEnabled:off",
        "DetectionRule.isEnabled:off",
        "SecurityPlaybook.isEnabled:off",
        "LogPipeline.isEnabled:off",
        "TracePipeline.isEnabled:off",
        "LogDropFilter.isEnabled:off",
        "TraceDropFilter.isEnabled:off",
        "MonitorProbe.isEnabled:off",
        "StatusPageSubscriber.isUnsubscribed:on",
      ].sort(),
    );
  });

  test.each(
    ENTRIES.map((entry: CatalogEntry): [string, CatalogEntry] => {
      return [`${entry.tableName}.${entry.column}`, entry];
    }),
  )(
    "%s is a boolean column of a real model",
    (_name: string, entry: CatalogEntry) => {
      const modelType: ModelClass | undefined = modelsByTable.get(
        entry.tableName,
      );

      expect(modelType).toBeDefined();

      const metadata: TableColumnMetadata | null | undefined =
        new modelType!().getTableColumnMetadata(entry.column) as
          | TableColumnMetadata
          | null
          | undefined;

      expect(metadata?.type).toBe(TableColumnType.Boolean);
    },
  );

  test.each(
    ENTRIES.map((entry: CatalogEntry): [string, CatalogEntry] => {
      return [entry.sentence, entry];
    }),
  )(
    "%s is about the kind, as one sentence or two ending in a full stop",
    (_sentence: string, entry: CatalogEntry) => {
      expect(entry.sentence).toMatch(
        /^(A disabled |An enabled |Unsubscribed )/,
      );
      expect(entry.sentence.endsWith(".")).toBe(true);
    },
  );
});

describe("BulkSwitchConsequences: getBulkSwitchConsequence", () => {
  test("answers the sentence for the side the action writes", () => {
    expect(
      getBulkSwitchConsequence({
        tableName: "Workflow",
        column: "isEnabled",
        value: true,
      }),
    ).toBe(BULK_SWITCH_CONSEQUENCES["Workflow"]!["isEnabled"]!.on);
    expect(
      getBulkSwitchConsequence({
        tableName: "Workflow",
        column: "isEnabled",
        value: false,
      }),
    ).toBe(BULK_SWITCH_CONSEQUENCES["Workflow"]!["isEnabled"]!.off);
  });

  test("a side, a column or a kind with nothing to add says nothing", () => {
    expect(
      getBulkSwitchConsequence({
        tableName: "Runbook",
        column: "isEnabled",
        value: true,
      }),
    ).toBe("");
    expect(
      getBulkSwitchConsequence({
        tableName: "Workflow",
        column: "isArchived",
        value: true,
      }),
    ).toBe("");
    expect(
      getBulkSwitchConsequence({
        tableName: "Label",
        column: "isArchived",
        value: true,
      }),
    ).toBe("");
    expect(
      getBulkSwitchConsequence({
        tableName: null,
        column: "isEnabled",
        value: false,
      }),
    ).toBe("");
  });
});

describe("BulkSwitchConsequences: the words", () => {
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, "en.json"), "utf8"),
  ) as Record<string, string>;

  const locales: Record<string, Record<string, string>> = Object.fromEntries(
    LANGUAGES.map((language: string) => {
      return [
        language,
        JSON.parse(
          fs.readFileSync(
            path.join(DASHBOARD_LOCALES, `${language}.json`),
            "utf8",
          ),
        ) as Record<string, string>,
      ];
    }),
  );

  test.each(
    ENTRIES.map((entry: CatalogEntry) => {
      return [entry.sentence];
    }),
  )(
    "%s is a Dashboard key, translated in every language",
    (sentence: string) => {
      expect(english[sentence]).toBe(sentence);

      for (const language of LANGUAGES) {
        expect({ language, translated: locales[language]![sentence] }).toEqual({
          language,
          translated: expect.any(String),
        });
        expect(locales[language]![sentence]).not.toBe(sentence);
      }
    },
  );

  test("Japanese and Chinese sentences end the way those languages end one", () => {
    for (const entry of ENTRIES) {
      for (const language of ["ja", "zh-CN", "zh-TW"]) {
        expect(locales[language]![entry.sentence]!.endsWith("。")).toBe(true);
      }
    }
  });
});

describe("BulkSwitchConsequences: what the sentences claim", () => {
  test("a disabled monitor is not checked and opens nothing: probes fetch only enabled monitors, and results for a disabled one are refused", () => {
    const monitorService: string = readSource(
      "Common/Server/Services/MonitorService.ts",
    );

    expect(monitorService).toContain(
      "disableActiveMonitoring: false, // do not fetch if disabled is true.",
    );
    expect(
      readSource("App/FeatureSet/Telemetry/API/ProbeIngest/Monitor.ts"),
    ).toContain("...MonitorService.getEnabledMonitorQuery(),");
    expect(
      readSource("Common/Server/Utils/Monitor/MonitorResource.ts"),
    ).toContain(
      "throw new BadDataException(ExceptionMessages.MonitorDisabled);",
    );
  });

  test("a disabled workflow does not run on its trigger, and a person can still run it from the Builder (a test run)", () => {
    const queue: string = readSource(
      "App/FeatureSet/Workflow/Services/QueueWorkflow.ts",
    );

    expect(queue).toContain(
      "if (!workflow.isEnabled && !startedByUserId) {\n      throw new BadDataException(WORKFLOW_TURNED_OFF_MESSAGE);",
    );
    expect(queue).toContain("const isTestRun: boolean = !workflow.isEnabled;");
  });

  test("a disabled runbook is turned away by the one way every run starts", () => {
    const starter: string = readSource(
      "Common/Server/Utils/Runbook/RunbookStarter.ts",
    );

    expect(starter).toContain("THE ONE WAY A RUNBOOK RUN STARTS.");
    expect(starter).toContain(
      "if (runbook.isEnabled === false) {\n      return { isStarted: false, refusal: RunbookStartRefusal.TurnedOff };",
    );
  });

  test("a disabled SLO is not evaluated", () => {
    expect(
      readSource("App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts"),
    ).toContain(
      "return current.isEnabled === true && current.isArchived === false;",
    );
  });

  test("a disabled incoming call policy hangs up with a message and pages nobody", () => {
    const incomingCall: string = readSource(
      "App/FeatureSet/Notification/API/IncomingCall.ts",
    );
    const branch: string =
      incomingCall
        .split("if (!policy.isEnabled) {")[1]
        ?.split("return res.send(twiml);")[0] || "";

    expect(branch).toContain("IncomingCallStatusMessage.PolicyDisabled");
    expect(branch).toContain("provider.generateHangupResponse(");
  });

  test("a disabled detection rule is left out of every evaluation", () => {
    const evaluator: string = readSource(
      "Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator.ts",
    );

    expect(
      evaluator.split("query: {\n        isEnabled: true,\n      },").length,
    ).toBeGreaterThan(1);
    expect(evaluator).toContain(
      "query: {\n        projectId,\n        isEnabled: true,\n      },",
    );
  });

  test("a disabled playbook does not run on its own, and runs by hand from a case", () => {
    const description: string | undefined = (
      new (modelsByTable.get("SecurityPlaybook")!)().getTableColumnMetadata(
        "isEnabled",
      ) as TableColumnMetadata
    ).description;

    expect(description).toContain(
      "A disabled playbook can still be run by hand from a case.",
    );
  });

  test.each([
    ["LogPipeline", "App/FeatureSet/Telemetry/Services/LogPipelineService.ts"],
    [
      "TracePipeline",
      "App/FeatureSet/Telemetry/Services/TracePipelineService.ts",
    ],
    [
      "LogDropFilter",
      "App/FeatureSet/Telemetry/Services/LogDropFilterService.ts",
    ],
    [
      "TraceDropFilter",
      "App/FeatureSet/Telemetry/Services/TraceDropFilterService.ts",
    ],
  ])(
    "%s: ingest applies only the enabled ones",
    (_tableName: string, service: string) => {
      expect(readSource(service)).toContain("isEnabled: true,");
    },
  );

  test("a disabled probe stops checking the monitor: a probe fetches only the rows enabled for it", () => {
    expect(
      readSource("App/FeatureSet/Telemetry/API/ProbeIngest/Monitor.ts"),
    ).toContain("probeId: probeId,\n    isEnabled: true,");
  });

  test("an unsubscribed subscriber gets nothing more, and stays in the list for its Edit form", () => {
    expect(
      readSource("Common/Server/Services/StatusPageSubscriberService.ts"),
    ).toContain("statusPageId: statusPageId,\n        isUnsubscribed: false,");

    const choices: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices.ts",
    );

    // The Edit form's Status offers Subscribed again.
    expect(choices).toContain('Subscribed = "subscribed",');
    expect(choices).toContain('Unsubscribed = "unsubscribed",');
  });
});
