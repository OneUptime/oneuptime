import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  LLM_MONITOR_TEMPLATE_COPY,
  LlmMonitorTemplateCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmMonitorTemplateCopy";
import {
  LLM_MONITOR_WINDOW_LABELS,
  getLlmMonitorWindowLabel,
  getLlmMonitorWindowOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmMonitorWindow";
import {
  LlmMonitorFormValues,
  getLlmIssueOptions,
  toLlmMonitorConfig,
  toLlmMonitorFormValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LlmMonitor/LlmMonitorStepForm";
import { LLM_ISSUE_STYLES } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationCopy";
import LlmMonitorTemplates, {
  LlmMonitorTemplate,
  LlmMonitorTemplateFilter,
  LlmMonitorTemplateId,
} from "../../../Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import MonitorStepLlmMonitor, {
  LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
  LLM_MONITOR_MAX_WINDOW_SECONDS,
  LLM_MONITOR_WINDOW_OPTIONS,
  MonitorStepLlmMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLlmMonitor";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "../../../Types/Telemetry/LlmAnswerIssue";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The AI alert cards promise things in words - "more than 5% of answers in
 * 15 minutes" - and the templates do them in numbers. Nothing ties the two
 * but these tests: change a window or a threshold without the sentence (or
 * the other way round) and a card promises an alert the monitor never
 * raises.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const PROGRESS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/Progress",
);
const LOCALES: Array<string> = [
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

// The English translator: every lookup reads back the English it was given.
const ENGLISH: Translator = createTranslator(undefined, "en");

// A sentence that names a time window: "in 15 minutes".
const NAMES_A_WINDOW: RegExp = /\d+ minutes/;

function filterOf(
  filters: Array<LlmMonitorTemplateFilter>,
  checkOn: CheckOn,
): LlmMonitorTemplateFilter | undefined {
  return filters.find((filter: LlmMonitorTemplateFilter): boolean => {
    return filter.checkOn === checkOn;
  });
}

function minutes(seconds: number): string {
  return `${seconds / 60} minutes`;
}

describe("every template has its words", () => {
  test("one card per template, nothing extra", () => {
    expect(Object.keys(LLM_MONITOR_TEMPLATE_COPY).sort()).toEqual(
      Object.values(LlmMonitorTemplateId).sort(),
    );
  });

  test("titles and monitor names are distinct", () => {
    const copies: Array<LlmMonitorTemplateCopy> = Object.values(
      LLM_MONITOR_TEMPLATE_COPY,
    );

    for (const field of [
      "title",
      "monitorName",
      "description",
      "alertDescription",
    ]) {
      const values: Array<string> = copies.map(
        (copy: LlmMonitorTemplateCopy): string => {
          return copy[field as keyof LlmMonitorTemplateCopy] as string;
        },
      );

      expect({ field, distinct: new Set(values).size }).toEqual({
        field,
        distinct: values.length,
      });
    }
  });

  test("a card says when it tells you; a monitor's description says what it alerts on", () => {
    for (const copy of Object.values(LLM_MONITOR_TEMPLATE_COPY)) {
      expect(copy.description).toMatch(/^(When|As soon as) /);
      expect(copy.monitorDescription).toMatch(/^Alerts you when /);
      expect(copy.alertDescription.endsWith(".")).toBe(true);
    }
  });
});

describe("the words match what the template does", () => {
  test.each(
    LlmMonitorTemplates.getAll().map(
      (
        template: LlmMonitorTemplate,
      ): [LlmMonitorTemplateId, LlmMonitorTemplate] => {
        return [template.id, template];
      },
    ),
  )("%s", (_id: LlmMonitorTemplateId, template: LlmMonitorTemplate) => {
    const copy: LlmMonitorTemplateCopy = LLM_MONITOR_TEMPLATE_COPY[template.id];
    const window: string = minutes(template.step.lastXSecondsOfCalls);
    const share: LlmMonitorTemplateFilter | undefined = filterOf(
      template.unhealthyFilters,
      CheckOn.LlmBadAnswerPercent,
    );
    const count: LlmMonitorTemplateFilter | undefined = filterOf(
      template.unhealthyFilters,
      CheckOn.LlmBadAnswerCount,
    );

    // The window, in every sentence that names one ("15 minutes" is not "5 minutes").
    for (const sentence of [
      copy.description,
      copy.monitorDescription,
      copy.alertDescription,
    ]) {
      if (NAMES_A_WINDOW.test(sentence)) {
        expect({
          sentence,
          window: new RegExp(`\\b${window}`).test(sentence),
        }).toEqual({
          sentence,
          window: true,
        });
      }
    }

    if (share) {
      // "more than 5%": a share, strictly greater.
      expect(share.filterType).toBe(FilterType.GreaterThan);
      expect(copy.description).toContain(`more than ${share.value}%`);
      expect(copy.monitorDescription).toContain(`more than ${share.value}%`);
      expect(copy.alertDescription).toContain(`ore than ${share.value}%`);
    }

    if (count && !share) {
      // A plain count: "3 or more", or one is enough.
      expect(count.filterType).toBe(FilterType.GreaterThanOrEqualTo);

      if (count.value > 1) {
        expect(copy.description).toContain(`${count.value} or more`);
        expect(copy.monitorDescription).toContain(`${count.value} or more`);
      }
    }
  });

  test("bad answers: every problem, more than 5% of answers in 15 minutes", () => {
    const template: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.BadAnswers,
    )!;

    expect(template.step.issues).toEqual(LlmAnswerIssueUtil.getAllIssues());
    expect(template.step.lastXSecondsOfCalls).toBe(900);
    expect(LLM_MONITOR_TEMPLATE_COPY[template.id].description).toContain(
      "15 minutes",
    );
    expect(LLM_MONITOR_TEMPLATE_COPY[template.id].description).toContain(
      "fail, are refused, cut off, empty or flagged",
    );
  });

  test("failed calls: failures only, in 5 minutes", () => {
    const template: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.FailedCalls,
    )!;

    expect(template.step.issues).toEqual([LlmAnswerIssue.Failed]);
    expect(template.step.lastXSecondsOfCalls).toBe(300);
    expect(LLM_MONITOR_TEMPLATE_COPY[template.id].description).toContain(
      "in 5 minutes",
    );
  });

  test("slow answers: no problem counted, only answers over 30 seconds", () => {
    const template: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.SlowAnswers,
    )!;

    expect(MonitorStepLlmMonitorUtil.getBadAnswerRule(template.step)).toEqual({
      issues: [],
      slowAnswerMs: 30_000,
    });
    expect(LLM_MONITOR_TEMPLATE_COPY[template.id].description).toContain(
      "longer than 30 seconds",
    );
  });

  test("the AI stops answering: no answers in 30 minutes", () => {
    const template: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.NoAnswers,
    )!;

    expect(template.unhealthyFilters).toEqual([
      {
        checkOn: CheckOn.LlmAnswerCount,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ]);
    expect(template.step.lastXSecondsOfCalls).toBe(1800);
    expect(LLM_MONITOR_TEMPLATE_COPY[template.id].description).toContain(
      "for 30 minutes",
    );
  });

  test("flagged answers: one is enough", () => {
    const template: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.FlaggedAnswers,
    )!;

    expect(template.step.issues).toEqual([LlmAnswerIssue.Flagged]);
    expect(template.unhealthyFilters).toEqual([
      {
        checkOn: CheckOn.LlmBadAnswerCount,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      },
    ]);
    expect(LLM_MONITOR_TEMPLATE_COPY[template.id].description).toContain(
      "As soon as",
    );
  });
});

describe("the alert words in every language", () => {
  function words(): Array<string> {
    const all: Array<string> = [];

    for (const copy of Object.values(LLM_MONITOR_TEMPLATE_COPY)) {
      all.push(
        copy.title,
        copy.description,
        copy.monitorName,
        copy.monitorDescription,
        copy.alertDescription,
      );
    }

    return all.concat(Object.values(LLM_MONITOR_WINDOW_LABELS));
  }

  test.each(LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
    ) as Record<string, unknown>;
    const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
      fs.readFileSync(path.join(PROGRESS_DIR, `${locale}.json`), "utf8"),
    ) as { sameAsEnglish?: Array<string> };
    const untranslated: Array<string> = words().filter(
      (word: string): boolean => {
        const value: unknown = translations[word];

        return (
          typeof value !== "string" ||
          (value === word && !(progress.sameAsEnglish || []).includes(word))
        );
      },
    );

    expect(untranslated).toEqual([]);
  });
});

describe("the time window's words", () => {
  test("every window the form offers has a label", () => {
    for (const seconds of LLM_MONITOR_WINDOW_OPTIONS) {
      expect(LLM_MONITOR_WINDOW_LABELS[seconds]).toBeTruthy();
      expect(getLlmMonitorWindowLabel(seconds, ENGLISH)).toBe(
        LLM_MONITOR_WINDOW_LABELS[seconds],
      );
    }

    expect(getLlmMonitorWindowLabel(900, ENGLISH)).toBe("Last 15 minutes");
    expect(getLlmMonitorWindowLabel(3600, ENGLISH)).toBe("Last 1 hour");
  });

  test("a window set through the API reads as a duration", () => {
    expect(getLlmMonitorWindowLabel(120, ENGLISH)).toBe("Last 2m 00s");
    expect(getLlmMonitorWindowLabel(7200, ENGLISH)).toBe("Last 2h 00m");
  });

  test("the standard windows, shortest first", () => {
    expect(
      getLlmMonitorWindowOptions(900).map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([...LLM_MONITOR_WINDOW_OPTIONS]);
  });

  test("a window set through the API keeps its place, so editing never drops it", () => {
    const options: Array<DropdownOption> = getLlmMonitorWindowOptions(2700);

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([300, 900, 1800, 2700, 3600, 21600, 86400]);
    expect(options[3]?.label).toBe("45m 00s");
  });

  test("a nonsense current window adds nothing", () => {
    for (const current of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getLlmMonitorWindowOptions(current)).toHaveLength(
        LLM_MONITOR_WINDOW_OPTIONS.length,
      );
    }
  });

  test("the dropdown's labels are the English keys the dropdown translates", () => {
    expect(getLlmMonitorWindowOptions(900)[1]).toEqual({
      label: "Last 15 minutes",
      value: 900,
    });
  });
});

describe("the monitor form's values", () => {
  const SERVICE: string = "6f1e2d3c-4b5a-4968-8776-655443322110";

  test("the problems are offered in display order, by the chip's word", () => {
    expect(getLlmIssueOptions()).toEqual(
      LlmAnswerIssueUtil.getAllIssues().map(
        (issue: LlmAnswerIssue): DropdownOption => {
          return { label: LLM_ISSUE_STYLES[issue].title, value: issue };
        },
      ),
    );
  });

  test("a new monitor's form: every problem, no slow limit, 15 minutes, every app", () => {
    expect(
      toLlmMonitorFormValues(MonitorStepLlmMonitorUtil.getDefault()),
    ).toEqual({
      issues: LlmAnswerIssueUtil.getAllIssues(),
      slowAnswerSeconds: "",
      lastXSecondsOfCalls: LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
      telemetryServiceIds: [],
      model: "",
    });
  });

  test("a saved monitor reads into the form and back unchanged", () => {
    const monitor: MonitorStepLlmMonitor = {
      telemetryServiceIds: [new ObjectID(SERVICE)],
      issues: [LlmAnswerIssue.Refused, LlmAnswerIssue.Failed],
      slowAnswerSeconds: 12.5,
      model: "gpt-4o-mini",
      lastXSecondsOfCalls: 1800,
    };

    const values: LlmMonitorFormValues = toLlmMonitorFormValues(monitor);

    expect(values).toEqual({
      // Display order, whatever order it was saved in.
      issues: [LlmAnswerIssue.Failed, LlmAnswerIssue.Refused],
      slowAnswerSeconds: 12.5,
      lastXSecondsOfCalls: 1800,
      telemetryServiceIds: [SERVICE],
      model: "gpt-4o-mini",
    });
    expect(
      MonitorStepLlmMonitorUtil.toJSON(toLlmMonitorConfig(values)),
    ).toEqual(MonitorStepLlmMonitorUtil.toJSON(monitor));
  });

  test("an empty slow-answer field is no limit, as are zero and nonsense", () => {
    for (const slowAnswerSeconds of ["", undefined, 0, "0", -5, "abc"]) {
      expect(
        toLlmMonitorConfig({
          ...toLlmMonitorFormValues(MonitorStepLlmMonitorUtil.getDefault()),
          slowAnswerSeconds: slowAnswerSeconds as number | string | undefined,
        }).slowAnswerSeconds,
      ).toBe(0);
    }
  });

  test("a slow-answer limit typed as text is read as a number", () => {
    expect(
      toLlmMonitorConfig({
        ...toLlmMonitorFormValues(MonitorStepLlmMonitorUtil.getDefault()),
        slowAnswerSeconds: "30",
      }).slowAnswerSeconds,
    ).toBe(30);
  });

  test("no problem picked stays none: with a slow limit, only slow answers count", () => {
    const config: MonitorStepLlmMonitor = toLlmMonitorConfig({
      ...toLlmMonitorFormValues(MonitorStepLlmMonitorUtil.getDefault()),
      issues: [],
      slowAnswerSeconds: 30,
    });

    expect(config.issues).toEqual([]);
    expect(MonitorStepLlmMonitorUtil.getBadAnswerRule(config).issues).toEqual(
      [],
    );
  });

  test("blank app picks and a cleared model are dropped", () => {
    const config: MonitorStepLlmMonitor = toLlmMonitorConfig({
      ...toLlmMonitorFormValues(MonitorStepLlmMonitorUtil.getDefault()),
      telemetryServiceIds: ["", SERVICE, "not-an-id"],
      model: undefined as unknown as string,
    });

    expect(
      config.telemetryServiceIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SERVICE]);
    expect(config.model).toBe("");
  });

  test("a window past the longest is held to it", () => {
    expect(
      toLlmMonitorConfig({
        ...toLlmMonitorFormValues(MonitorStepLlmMonitorUtil.getDefault()),
        lastXSecondsOfCalls: LLM_MONITOR_MAX_WINDOW_SECONDS * 4,
      }).lastXSecondsOfCalls,
    ).toBe(LLM_MONITOR_MAX_WINDOW_SECONDS);
  });

  test("an issues value that is not a list counts no problem rather than crashing", () => {
    expect(
      toLlmMonitorConfig({
        ...toLlmMonitorFormValues(MonitorStepLlmMonitorUtil.getDefault()),
        issues: "failed" as unknown as Array<string>,
      }).issues,
    ).toEqual([]);
  });
});
