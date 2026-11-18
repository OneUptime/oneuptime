import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TELEMETRY_RECOMMENDATION_MILESTONES,
  TELEMETRY_RECOMMENDED_TEMPLATES,
  TELEMETRY_RECOMMENDED_TEMPLATE_IDS,
  TELEMETRY_SETUP,
  TelemetryRecommendedTemplate,
  TELEMETRY_SETUP_COPY,
  TELEMETRY_SETUP_STEPS,
  TelemetrySetupProgressFacts,
  describeWhoIsToldAboutAlerts,
  getAlertDoneLine,
  getInitialPick,
  getTelemetryRecommendedTemplateIds,
  getTelemetrySetupProgress,
  isAlertDone,
  isTelemetrySetupFinished,
  joinMonitorIds,
  splitMonitorIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetup";
import { getFirstOpenStepKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import { WhoIsToldMode } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import {
  ServiceAlertTemplate,
  getServiceAlertTemplateById,
} from "../../../Types/Monitor/ServiceAlertTemplates";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * The telemetry guided setup's rules and words (issue #6806): which
 * monitors it offers, which step a returning person lands on, that "not
 * now" ends it too, and that every word is translated.
 */

const english: Translator = createTranslator(undefined, "en");

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const facts: (
  values: Partial<TelemetrySetupProgressFacts>,
) => TelemetrySetupProgressFacts = (
  values: Partial<TelemetrySetupProgressFacts>,
): TelemetrySetupProgressFacts => {
  return {
    hasReportingService: false,
    monitorCount: 0,
    isAlertSkipped: false,
    isAlertConfirmed: false,
    ...values,
  };
};

describe("the setup", () => {
  test("is named telemetry in its events, with two steps: send, then alert", () => {
    expect(TELEMETRY_SETUP).toBe("telemetry");
    expect(TELEMETRY_SETUP_STEPS).toEqual(["send", "alert"]);
  });
});

describe("the monitors offered", () => {
  test("are failing requests, slow requests and unhandled exceptions, from the Service catalog", () => {
    expect(TELEMETRY_RECOMMENDED_TEMPLATE_IDS).toEqual([
      "service-error-burst",
      "service-latency-p95",
      "service-unhandled-exceptions",
    ]);

    for (const templateId of TELEMETRY_RECOMMENDED_TEMPLATE_IDS) {
      expect(getServiceAlertTemplateById(templateId)).toBeDefined();
    }
  });

  test("apply to every service, whatever its runtime", () => {
    for (const templateId of TELEMETRY_RECOMMENDED_TEMPLATE_IDS) {
      const template: ServiceAlertTemplate =
        getServiceAlertTemplateById(templateId)!;
      expect({ templateId, language: template.language }).toEqual({
        templateId,
        language: undefined,
      });
    }
  });

  /*
   * #7146: each reads one kind of data, and is offered once the project's
   * first data of that kind arrived; a monitor of data the service never
   * sends never fires.
   */
  test("each is a template of every service, and reads the data its monitor type counts", () => {
    const kindsOfMonitor: Record<string, Array<ActivationMilestone>> = {
      [MonitorType.Traces]: [ActivationMilestone.FirstTracesReceived],
      [MonitorType.Metrics]: [ActivationMilestone.FirstMetricsReceived],
      [MonitorType.Logs]: [ActivationMilestone.FirstLogsReceived],
      // Exceptions come with traces and with logs.
      [MonitorType.Exceptions]: [
        ActivationMilestone.FirstExceptionsReceived,
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstLogsReceived,
      ],
    };

    expect(
      TELEMETRY_RECOMMENDED_TEMPLATES.map(
        (template: TelemetryRecommendedTemplate): string => {
          return template.templateId;
        },
      ),
    ).toEqual([
      "service-error-burst",
      "service-latency-p95",
      "service-unhandled-exceptions",
      "service-error-log-spike",
    ]);

    for (const recommended of TELEMETRY_RECOMMENDED_TEMPLATES) {
      const template: ServiceAlertTemplate | undefined =
        getServiceAlertTemplateById(recommended.templateId);

      expect(template).toBeDefined();
      expect(template!.language).toBeUndefined();
      expect({
        templateId: recommended.templateId,
        reads: [...recommended.readsFirstDataOf].sort(),
      }).toEqual({
        templateId: recommended.templateId,
        reads: [...kindsOfMonitor[template!.monitorType]!].sort(),
      });
    }
  });

  test("are read from the first logs, traces, metrics and exceptions, each once", () => {
    expect([...TELEMETRY_RECOMMENDATION_MILESTONES].sort()).toEqual(
      [
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstMetricsReceived,
        ActivationMilestone.FirstExceptionsReceived,
        ActivationMilestone.FirstLogsReceived,
      ].sort(),
    );
  });

  test.each([
    [
      "logs only",
      [ActivationMilestone.FirstLogsReceived],
      ["service-unhandled-exceptions", "service-error-log-spike"],
    ],
    [
      "traces only",
      [ActivationMilestone.FirstTracesReceived],
      ["service-error-burst", "service-unhandled-exceptions"],
    ],
    [
      "metrics only",
      [ActivationMilestone.FirstMetricsReceived],
      ["service-latency-p95"],
    ],
    [
      "exceptions only",
      [ActivationMilestone.FirstExceptionsReceived],
      ["service-unhandled-exceptions"],
    ],
    [
      "every kind",
      [
        ActivationMilestone.FirstProfilesReceived,
        ActivationMilestone.FirstLogsReceived,
        ActivationMilestone.FirstExceptionsReceived,
        ActivationMilestone.FirstMetricsReceived,
        ActivationMilestone.FirstTracesReceived,
      ],
      [
        "service-error-burst",
        "service-latency-p95",
        "service-unhandled-exceptions",
        "service-error-log-spike",
      ],
    ],
  ])(
    "%s: offered in the setup's order",
    (
      _name: string,
      reached: Array<ActivationMilestone>,
      expected: Array<string>,
    ) => {
      expect(getTelemetryRecommendedTemplateIds(reached)).toEqual(expected);
    },
  );

  test("nothing known - not read, none kept, or only profiles - offers the setup's three", () => {
    for (const reached of [
      null,
      undefined,
      [],
      [ActivationMilestone.FirstProfilesReceived],
      [ActivationMilestone.FirstMonitorCreated],
    ]) {
      expect(getTelemetryRecommendedTemplateIds(reached)).toEqual([
        "service-error-burst",
        "service-latency-p95",
        "service-unhandled-exceptions",
      ]);
    }
  });

  test("start ticked, except the ones the service has already", () => {
    expect(
      getInitialPick({ recommendationIds: ["a", "b", "c"], coveredIds: [] }),
    ).toEqual(["a", "b", "c"]);
    expect(
      getInitialPick({ recommendationIds: ["a", "b", "c"], coveredIds: ["b"] }),
    ).toEqual(["a", "c"]);
    expect(
      getInitialPick({
        recommendationIds: ["a", "b"],
        coveredIds: ["a", "b"],
      }),
    ).toEqual([]);
  });
});

describe("the run's monitors", () => {
  test("are kept as one comma-separated value and read back", () => {
    expect(joinMonitorIds(["m1", "m2"])).toBe("m1,m2");
    expect(joinMonitorIds(["m1", "", "m2"])).toBe("m1,m2");
    expect(splitMonitorIds("m1, m2,,")).toEqual(["m1", "m2"]);
  });

  test("anything else in storage is no monitors", () => {
    expect(splitMonitorIds(undefined)).toEqual([]);
    expect(splitMonitorIds(true)).toEqual([]);
    expect(splitMonitorIds("")).toEqual([]);
  });
});

describe("which step is done", () => {
  test("nothing, until a service has reported", () => {
    expect(getTelemetrySetupProgress(facts({}))).toEqual([
      { key: "send", isDone: false },
      { key: "alert", isDone: false },
    ]);
    expect(
      getTelemetrySetupProgress(facts({ isAlertSkipped: true }))[1]!.isDone,
    ).toBe(false);
  });

  test("once data arrived, the alert step opens", () => {
    expect(
      getFirstOpenStepKey(
        getTelemetrySetupProgress(facts({ hasReportingService: true })),
      ),
    ).toBe("alert");
  });

  test("a monitor on the data ends it", () => {
    const done: TelemetrySetupProgressFacts = facts({
      hasReportingService: true,
      monitorCount: 1,
    });

    expect(isAlertDone(done)).toBe(true);
    expect(isTelemetrySetupFinished(done)).toBe(true);
    expect(getFirstOpenStepKey(getTelemetrySetupProgress(done))).toBeNull();
  });

  test("so does saying not now, or confirming the monitors it has already", () => {
    expect(
      isTelemetrySetupFinished(
        facts({ hasReportingService: true, isAlertSkipped: true }),
      ),
    ).toBe(true);
    expect(
      isTelemetrySetupFinished(
        facts({ hasReportingService: true, isAlertConfirmed: true }),
      ),
    ).toBe(true);
  });

  test("monitors that are gone are not counted: the step opens again", () => {
    expect(
      isTelemetrySetupFinished(
        facts({ hasReportingService: true, monitorCount: 0 }),
      ),
    ).toBe(false);
  });
});

describe("the words it says", () => {
  test("step 2's line counts the monitors, or says not now", () => {
    expect(
      getAlertDoneLine({
        translator: english,
        serviceName: "checkout",
        monitorCount: 1,
        isSkipped: false,
      }),
    ).toBe("1 monitor watches checkout.");
    expect(
      getAlertDoneLine({
        translator: english,
        serviceName: "checkout",
        monitorCount: 3,
        isSkipped: true,
      }),
    ).toBe("3 monitors watch checkout.");
    expect(
      getAlertDoneLine({
        translator: english,
        serviceName: "checkout",
        monitorCount: 0,
        isSkipped: true,
      }),
    ).toBe("Not now");
    expect(
      getAlertDoneLine({
        translator: english,
        serviceName: "checkout",
        monitorCount: 0,
        isSkipped: false,
      }),
    ).toBe("checkout is already watched by these monitors.");
  });

  test("who is told: the project's on-call rules, or its owners by email", () => {
    expect(
      describeWhoIsToldAboutAlerts({
        translator: english,
        mode: WhoIsToldMode.ExistingPolicy,
      }),
    ).toBe(TELEMETRY_SETUP_COPY.whoExisting);

    for (const mode of [
      WhoIsToldMode.CreatePolicy,
      WhoIsToldMode.OwnerEmailOnly,
    ]) {
      expect(
        describeWhoIsToldAboutAlerts({ translator: english, mode: mode }),
      ).toBe(TELEMETRY_SETUP_COPY.whoOwners);
    }
  });

  test("alerts are said to be for the team, and an incident for customers", () => {
    expect(TELEMETRY_SETUP_COPY.alertsNotIncidents).toMatch(/alerts/);
    expect(TELEMETRY_SETUP_COPY.alertsNotIncidents).toMatch(/status page/);
    expect(TELEMETRY_SETUP_COPY.alertsNotIncidents).toMatch(/incident/);
  });
});

describe("the words", () => {
  const languages: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string) => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string) => {
      return file.replace(/\.json$/, "");
    });

  const words: Array<string> = [
    ...Object.values(TELEMETRY_SETUP_COPY),
    "{{service}} is sending data.",
    "{{count}} monitors watch {{service}}.",
    "{{count}} monitors watch {{service}}._one",
    "Create {{count}} monitors",
    "Create {{count}} monitors_one",
    "Confirm that you understand these monitors are billed before creating them.",
    "Wait for the first data",
  ];

  test("are translated in every language, keeping their placeholders", () => {
    expect(languages.length).toBe(17);
    const englishTable: Record<string, string> = readLocale("en");

    for (const word of words) {
      expect({ word, isKnown: word in englishTable }).toEqual({
        word,
        isKnown: true,
      });
    }

    for (const language of languages) {
      const table: Record<string, string> = readLocale(language);

      for (const word of words) {
        const value: string = table[word] || "";
        expect({
          language,
          word,
          isTranslated: Boolean(value) && value !== word,
        }).toEqual({
          language,
          word,
          isTranslated: true,
        });

        const placeholders: Array<string> =
          word.replace(/_one$/, "").match(/{{\w+}}/g) || [];

        for (const placeholder of placeholders) {
          if (word.endsWith("_one") && placeholder === "{{count}}") {
            continue;
          }

          expect({
            language,
            word,
            placeholder,
            kept: value.includes(placeholder),
          }).toEqual({
            language,
            word,
            placeholder,
            kept: true,
          });
        }
      }
    }
  });
});
