import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { getNumberLocale } from "Common/Types/DateLanguage";
import { createTranslator, Translator } from "Common/Types/Translator";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import {
  WEBAUTHN_ALREADY_REGISTERED,
  WEBAUTHN_NEEDS_SECURE_CONNECTION,
  WEBAUTHN_NOT_SUPPORTED,
  WEBAUTHN_REGISTRATION_CANCELED,
  WEBAUTHN_REGISTRATION_FAILED,
} from "Common/UI/Utils/WebAuthn";
import { formatDurationCompact } from "Common/Utils/Slo/SloDuration";
import { SLO_EVALUATION_CADENCE_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import {
  getSloBudgetRunway,
  SloBudgetRunwayKind,
} from "Common/Utils/Slo/SloProjection";
import {
  getSliTypeText,
  getSloAtRiskText,
  getSloBudgetRemainingText,
  getSloDowntimeStatusesText,
  getSloHeadline,
  getSloMonitorCountText,
  getSloMultiMonitorModeText,
  getSloWindowPhrase,
  getSloWindowText,
  SloHeadlineData,
  SloWindowTextData,
} from "Common/Utils/Slo/SloOverviewText";
import {
  getSloMetricCategories,
  SloMetricCategory,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloMetricsQueryConfig";
import {
  getSloAllowedDowntimeTextInLanguage,
  getSloAtRiskTextInLanguage,
  getSloEvaluationCadenceText,
  getSloHeadlineInLanguage,
  getSloMonitorCountInLanguage,
  getSloWindowPhraseInLanguage,
  getSloWindowTextInLanguage,
  SLO_OVERVIEW_FIXED_TEXTS,
  sloMonitorCountValue,
  sloWindowPhraseValue,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloOverviewTextInLanguage";
import {
  buildSiteTopologyFilterOptions,
  describeSiteTopologyFilter,
  SiteTopologyFilterOption,
  SiteTopologyHealthSummary,
} from "../../FeatureSet/Dashboard/src/Components/Topology/HierarchyTopologyViewModel";
import {
  describeSiteListToggle,
  describeWarningSite,
  TopologyLinkRuleWarning,
  TopologyLinkRuleWarningSite,
} from "../../FeatureSet/Dashboard/src/Components/Topology/LinkRuleWarningUtil";
import {
  WORKSPACE_SUMMARY_TYPE_COPY,
  WorkspaceSummaryTypeCopy,
} from "../../FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryCopy";

/*
 * THE SLO OVERVIEW'S, THE TOPOLOGY'S AND THE WORKSPACE SUMMARIES' SENTENCES,
 * worded in the reader's language (#6658) - with translators built from
 * the Dashboard's shipped locale files.
 *
 * Each helper used to glue English pieces together ("Rolling " + "30 days",
 * `${typeLabel} Summary - Slack`, "12 sites need a look"), which only
 * English reads. Each now looks its sentence up whole and counts the way
 * the reader's language counts. Without a translator each still reads, word
 * for word, as the English it replaced - so the worker's feed and every
 * English page are unchanged.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

function translatorFor(language: string): Translator {
  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

const ENGLISH_LOCALE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES, "en.json"), "utf8"),
) as Record<string, string>;

const DE: Translator = translatorFor("de");
const AR: Translator = translatorFor("ar");
const RU: Translator = translatorFor("ru");
const JA: Translator = translatorFor("ja");
const FR: Translator = translatorFor("fr");

// A translator that words nothing: every sentence reads as the English.
const NOTHING_WORDED: Translator = createTranslator((): undefined => {
  return undefined;
}, "de");

const WINDOWS: Array<SloWindowTextData> = [
  { windowType: SloWindowType.Rolling, windowDays: 30 },
  { windowType: SloWindowType.Rolling, windowDays: 1 },
  { windowType: SloWindowType.Rolling, windowDays: 7 },
  { windowType: SloWindowType.Rolling, windowDays: 0 },
  { windowType: SloWindowType.Rolling, windowDays: -3 },
  { windowType: SloWindowType.Rolling, windowDays: null },
  { windowType: SloWindowType.Rolling, windowDays: Number.NaN },
  { windowType: SloWindowType.Rolling },
  {},
  { windowType: SloWindowType.CalendarMonth, timezone: "Europe/Berlin" },
  { windowType: SloWindowType.CalendarMonth, timezone: null },
  { windowType: SloWindowType.CalendarMonth },
];

// Every input getSloHeadline tells apart.
function everyHeadlineInput(): Array<SloHeadlineData> {
  const inputs: Array<SloHeadlineData> = [];

  for (const isArchived of [true, false, undefined]) {
    for (const isEnabled of [true, false, undefined]) {
      for (const sloStatus of [...Object.values(SloStatus), undefined]) {
        for (const lastEvaluatedAt of [new Date(), undefined]) {
          for (const monitorCount of [0, 3, undefined]) {
            inputs.push({
              isArchived,
              isEnabled,
              sloStatus,
              lastEvaluatedAt,
              monitorCount,
            });
          }
        }
      }
    }
  }

  // A status the type does not list yet.
  inputs.push({
    sloStatus: "Some Future Status" as SloStatus,
    lastEvaluatedAt: new Date(),
  });

  return inputs;
}

describe("the SLO overview's words without a translator read as SloOverviewText's English", () => {
  test("the window: a chip and the end of a sentence", () => {
    for (const window of WINDOWS) {
      expect(getSloWindowTextInLanguage(window)).toBe(getSloWindowText(window));
      expect(getSloWindowPhraseInLanguage(window)).toBe(
        getSloWindowPhrase(window),
      );
    }

    expect(
      getSloWindowTextInLanguage({
        windowType: SloWindowType.Rolling,
        windowDays: 1,
      }),
    ).toBe("Rolling 1 day");
    expect(
      getSloWindowPhraseInLanguage({
        windowType: SloWindowType.CalendarMonth,
      }),
    ).toBe("this calendar month (UTC)");
  });

  test("the monitor count, from none to many", () => {
    for (const count of [0, -1, Number.NaN, Infinity, 1, 2, 12, 999]) {
      expect(getSloMonitorCountInLanguage(count)).toBe(
        getSloMonitorCountText(count),
      );
    }

    // A count is written the reader's way, grouped as every other count is.
    expect(getSloMonitorCountInLanguage(1000)).toBe("1,000 monitors");
  });

  test("the headline, for every status", () => {
    for (const input of everyHeadlineInput()) {
      expect(getSloHeadlineInLanguage(input)).toBe(getSloHeadline(input));
    }
  });

  test("the at-risk threshold, with its default", () => {
    for (const threshold of [20, 12.5, 0, 100, null, undefined, Number.NaN]) {
      expect(getSloAtRiskTextInLanguage(threshold)).toBe(
        getSloAtRiskText(threshold),
      );
    }
  });

  test("the downtime the target allows, in the compact English duration", () => {
    expect(
      getSloAllowedDowntimeTextInLanguage({
        seconds: 2592,
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }),
    ).toBe(
      `${formatDurationCompact(2592)} of downtime allowed per rolling 30 days`,
    );
    expect(
      getSloAllowedDowntimeTextInLanguage({
        seconds: 86,
        windowType: SloWindowType.Rolling,
        windowDays: 1,
      }),
    ).toBe(
      `${formatDurationCompact(86)} of downtime allowed per rolling 1 day`,
    );
    expect(
      getSloAllowedDowntimeTextInLanguage({
        seconds: 2678,
        windowType: SloWindowType.CalendarMonth,
      }),
    ).toBe(
      `${formatDurationCompact(2678)} of downtime allowed this calendar month`,
    );
    // No window days: the column's default, 30.
    expect(getSloAllowedDowntimeTextInLanguage({ seconds: 60 })).toBe(
      `${formatDurationCompact(60)} of downtime allowed per rolling 30 days`,
    );
  });

  test("the evaluation cadence: the worker's, counted", () => {
    expect(getSloEvaluationCadenceText()).toBe(
      SLO_EVALUATION_CADENCE_MINUTES === 1
        ? "Runs every minute"
        : `Runs every ${SLO_EVALUATION_CADENCE_MINUTES} minutes`,
    );
  });

  test("the metrics page's categories", () => {
    const categories: Array<SloMetricCategory> = getSloMetricCategories();

    expect(
      categories.map((category: SloMetricCategory): string => {
        return category.id;
      }),
    ).toEqual(["objective", "burn", "status"]);
    expect(categories[1]!.description).toBe(
      "How fast the error budget is being spent over the trailing 60 minutes, and how much downtime the SLO can still absorb before it breaches.",
    );
  });
});

describe("every fixed answer of SloOverviewText is a key the overview looks up", () => {
  test("the list holds every answer the helpers can give, and each is in en.json", () => {
    const answers: Set<string> = new Set<string>();

    for (const input of everyHeadlineInput()) {
      answers.add(getSloHeadline(input));
    }

    for (const mode of [...Object.values(SloMultiMonitorMode), undefined]) {
      answers.add(getSloMultiMonitorModeText(mode).title);
      answers.add(getSloMultiMonitorModeText(mode).description);
    }

    for (const sliType of [...Object.values(SliType), undefined]) {
      answers.add(getSliTypeText(sliType));
    }

    answers.add(getSloDowntimeStatusesText([]));

    // The KPI strip's budget headline, past the percentages.
    for (const percentage of [-5, 0]) {
      answers.add(getSloBudgetRemainingText(percentage) as string);
    }

    // The runway's reasons for not projecting.
    for (const runway of [
      getSloBudgetRunway({
        now: new Date(),
        errorBudgetRemainingSeconds: 10,
        currentBurnRate: 1,
        multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
      }),
      getSloBudgetRunway({
        now: new Date(),
        errorBudgetRemainingSeconds: 10,
        currentBurnRate: 1,
        targetPercentage: 100,
      }),
    ]) {
      expect(runway.kind).toBe(SloBudgetRunwayKind.NotProjected);
      answers.add(runway.description);
    }

    const unlisted: Array<string> = [...answers].filter(
      (answer: string): boolean => {
        return !SLO_OVERVIEW_FIXED_TEXTS.includes(answer);
      },
    );

    expect(unlisted).toEqual([]);

    // And nothing is listed that no helper says.
    expect([...SLO_OVERVIEW_FIXED_TEXTS].sort()).toEqual([...answers].sort());

    for (const text of SLO_OVERVIEW_FIXED_TEXTS) {
      expect({ text, inEnglish: ENGLISH_LOCALE[text] }).toEqual({
        text,
        inEnglish: text,
      });
    }
  });

  test("every fixed answer reads in German and Arabic", () => {
    for (const text of SLO_OVERVIEW_FIXED_TEXTS) {
      expect({ text, de: DE.translateText(text) === text }).toEqual({
        text,
        de: false,
      });
      expect({ text, ar: AR.translateText(text) === text }).toEqual({
        text,
        ar: false,
      });
    }
  });
});

describe("the SLO overview's words in the reader's language", () => {
  test("the window, counted the way each language counts", () => {
    const rolling: (days: number) => SloWindowTextData = (
      days: number,
    ): SloWindowTextData => {
      return { windowType: SloWindowType.Rolling, windowDays: days };
    };

    expect(getSloWindowTextInLanguage(rolling(30), DE)).toBe(
      "Rollierend 30 Tage",
    );
    expect(getSloWindowTextInLanguage(rolling(1), DE)).toBe("Rollierend 1 Tag");
    expect(getSloWindowPhraseInLanguage(rolling(7), DE)).toBe(
      "die letzten 7 Tage",
    );
    expect(
      getSloWindowTextInLanguage(
        { windowType: SloWindowType.CalendarMonth, timezone: "Europe/Berlin" },
        DE,
      ),
    ).toBe("Kalendermonat (Europe/Berlin)");

    // Arabic: a label and its count for 0, 2-10, 11-99 and 100+; one is singular.
    expect(getSloWindowTextInLanguage(rolling(30), AR)).toBe(
      "نافذة متحركة (الأيام: 30)",
    );
    expect(getSloWindowTextInLanguage(rolling(2), AR)).toBe(
      "نافذة متحركة (الأيام: 2)",
    );
    expect(getSloWindowTextInLanguage(rolling(1), AR)).toBe(
      "نافذة متحركة (1 يوم)",
    );
    expect(getSloWindowPhraseInLanguage(rolling(30), AR)).toBe(
      "الأيام الـ30 الماضية",
    );

    // Russian: 21 days is its "one" form, 5 days its general one.
    expect(getSloWindowTextInLanguage(rolling(21), RU)).toBe(
      "Скользящее окно: 21 день",
    );
    expect(getSloWindowTextInLanguage(rolling(5), RU)).toBe(
      "Скользящее окно: 5 дн.",
    );

    // Japanese has one form for every count.
    expect(getSloWindowTextInLanguage(rolling(1), JA)).toBe(
      "ローリング 1 日間",
    );
  });

  test("the monitor count and the headline", () => {
    expect(getSloMonitorCountInLanguage(0, DE)).toBe("Keine Monitore");
    expect(getSloMonitorCountInLanguage(1, DE)).toBe("1 Monitor");
    expect(getSloMonitorCountInLanguage(12, DE)).toBe("12 Monitore");
    expect(getSloMonitorCountInLanguage(0, AR)).toBe("لا توجد مراقبات");
    expect(getSloMonitorCountInLanguage(12, AR)).toBe("12 من المراقبات");

    expect(
      getSloHeadlineInLanguage(
        { sloStatus: SloStatus.Healthy, lastEvaluatedAt: new Date() },
        DE,
      ),
    ).toBe("Innerhalb des Fehlerbudgets");
    expect(
      getSloHeadlineInLanguage(
        { sloStatus: SloStatus.Healthy, lastEvaluatedAt: new Date() },
        AR,
      ),
    ).toBe("ضمن ميزانية الأخطاء");
  });

  test("the at-risk threshold and the downtime the target allows", () => {
    // The threshold is written the language's way (#6695): "20 %" in German.
    expect(getSloAtRiskTextInLanguage(20, DE)).toBe(
      `Wenn 20${String.fromCharCode(0xa0)}% oder weniger des Fehlerbudgets übrig sind`,
    );
    expect(getSloAtRiskTextInLanguage(12.5, DE)).toContain("12,5");

    const arabic: string = getSloAtRiskTextInLanguage(20, AR);

    expect(arabic).toBe(
      `عندما يتبقى ${new Intl.NumberFormat(getNumberLocale("ar"), {
        style: "percent",
        maximumFractionDigits: 3,
      }).format(0.2)} أو أقل من ميزانية الأخطاء`,
    );
    // On screen, past Intl's direction marks: Latin digits, the sign after.
    expect(arabic.split(String.fromCharCode(0x200e)).join("")).toBe(
      "عندما يتبقى 20% أو أقل من ميزانية الأخطاء",
    );

    const german: string = getSloAllowedDowntimeTextInLanguage(
      { seconds: 2592, windowType: SloWindowType.Rolling, windowDays: 30 },
      DE,
    );

    expect(german).toMatch(
      /^.+ Ausfallzeit erlaubt pro rollierenden 30 Tagen$/,
    );
    // The duration is German too: never the English "43m 12s".
    expect(german).not.toContain(formatDurationCompact(2592));

    expect(
      getSloAllowedDowntimeTextInLanguage(
        { seconds: 2678, windowType: SloWindowType.CalendarMonth },
        AR,
      ),
    ).toMatch(/^وقت التوقف المسموح به هذا الشهر التقويمي: .+$/);
  });

  test("the evaluation cadence and the metrics page's burn category", () => {
    expect(getSloEvaluationCadenceText(DE)).toBe(
      `Läuft alle ${SLO_EVALUATION_CADENCE_MINUTES} Minuten`,
    );
    expect(getSloMetricCategories(DE)[1]!.description).toBe(
      DE.translatePlural(
        {
          one: "How fast the error budget is being spent over the trailing {{count}} minute, and how much downtime the SLO can still absorb before it breaches.",
          other:
            "How fast the error budget is being spent over the trailing {{count}} minutes, and how much downtime the SLO can still absorb before it breaches.",
        },
        60,
      ),
    );
    expect(getSloMetricCategories(DE)[1]!.description).toContain("60");
    expect(getSloMetricCategories(DE)[1]!.description).not.toContain(
      "How fast",
    );
  });

  test("a phrase put into another sentence is worded in that sentence's language", () => {
    const window: SloWindowTextData = {
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    };

    // Inside a German sentence: German.
    expect(
      DE.translateTemplate(
        "Error budget left over {{window}}, with the at-risk and exhausted lines this SLO is judged against.",
        { window: sloWindowPhraseValue(window) },
      ),
    ).toContain("die letzten 30 Tage");

    // Inside a sentence the language has not worded: English, whole.
    expect(
      NOTHING_WORDED.translateTemplate(
        "Error budget left over {{window}}, with the at-risk and exhausted lines this SLO is judged against.",
        { window: sloWindowPhraseValue(window) },
      ),
    ).toBe(
      "Error budget left over the last 30 days, with the at-risk and exhausted lines this SLO is judged against.",
    );
    expect(
      NOTHING_WORDED.translateTemplate("View all {{monitors}}", {
        monitors: sloMonitorCountValue(3),
      }),
    ).toBe("View all 3 monitors");
    expect(
      DE.translateTemplate("View all {{monitors}}", {
        monitors: sloMonitorCountValue(3),
      }),
    ).toContain("3 Monitore");
  });
});

describe("a workspace summary table's words", () => {
  const TYPES: Array<WorkspaceNotificationSummaryType> = Object.values(
    WorkspaceNotificationSummaryType,
  );

  test("every kind of summary has its own sentences, each in en.json", () => {
    expect(Object.keys(WORKSPACE_SUMMARY_TYPE_COPY).sort()).toEqual(
      [...TYPES].sort(),
    );

    for (const type of TYPES) {
      const copy: WorkspaceSummaryTypeCopy = WORKSPACE_SUMMARY_TYPE_COPY[type];

      for (const text of Object.values(copy)) {
        expect({ type, text, inEnglish: ENGLISH_LOCALE[text] }).toEqual({
          type,
          text,
          inEnglish: text,
        });
      }
    }
  });

  test("the English reads as the sentences it replaced, built from the kind's name", () => {
    for (const type of TYPES) {
      const copy: WorkspaceSummaryTypeCopy = WORKSPACE_SUMMARY_TYPE_COPY[type];
      const label: string = type;

      expect(copy.singularName).toBe(`${label} Summary`);
      expect(copy.pluralName).toBe(`${label} Summaries`);
      expect(
        NOTHING_WORDED.translateTemplate(copy.cardTitle, {
          workspace: "Slack",
        }),
      ).toBe(`${label} Summary - Slack`);
      expect(
        NOTHING_WORDED.translateTemplate(copy.cardDescription, {
          workspace: "Microsoft Teams",
        }),
      ).toBe(
        `Set up recurring ${label.toLowerCase()} summary reports posted to Microsoft Teams. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of ${label.toLowerCase()}s with links.`,
      );
      expect(copy.noItemsMessage).toBe(
        `No ${label.toLowerCase()} summary rules configured yet. Create one to start receiving periodic reports.`,
      );
      expect(copy.namePlaceholder).toBe(`Weekly ${label} Summary`);
      expect(copy.descriptionPlaceholder).toBe(
        `e.g., Weekly ${label.toLowerCase()} summary for the engineering team.`,
      );
    }
  });

  test("each sentence reads whole in German, French and Arabic, the workspace's name kept", () => {
    for (const translator of [DE, FR, AR]) {
      for (const type of TYPES) {
        const copy: WorkspaceSummaryTypeCopy =
          WORKSPACE_SUMMARY_TYPE_COPY[type];
        const title: string = translator.translateTemplate(copy.cardTitle, {
          workspace: "Mattermost",
        });
        const description: string = translator.translateTemplate(
          copy.cardDescription,
          { workspace: "Mattermost" },
        );

        expect(title).toContain("Mattermost");
        expect(description).toContain("Mattermost");
        expect(title).not.toContain("Summary");
        expect(description).not.toContain("Set up recurring");

        for (const text of [
          copy.singularName,
          copy.pluralName,
          copy.noItemsMessage,
          copy.namePlaceholder,
          copy.descriptionPlaceholder,
        ]) {
          expect({
            language: translator.language,
            text,
            translated: translator.translateText(text) !== text,
          }).toEqual({ language: translator.language, text, translated: true });
        }
      }
    }

    expect(
      DE.translateTemplate(
        WORKSPACE_SUMMARY_TYPE_COPY[WorkspaceNotificationSummaryType.Incident]
          .cardTitle,
        { workspace: "Slack" },
      ),
    ).toBe("Vorfallzusammenfassung – Slack");
  });
});

describe("the topology's sentences", () => {
  const SUMMARY: SiteTopologyHealthSummary = {
    total: 12,
    attention: 3,
    down: 0,
    degraded: 3,
    healthy: 9,
    unknown: 0,
    devices: { total: 340, down: 0, degraded: 7, healthy: 333, unknown: 0 },
    devicesBySiteState: {
      down: { total: 0, down: 0, degraded: 0, healthy: 0, unknown: 0 },
      degraded: { total: 40, down: 0, degraded: 7, healthy: 33, unknown: 0 },
      healthy: { total: 300, down: 0, degraded: 0, healthy: 300, unknown: 0 },
      unknown: { total: 0, down: 0, degraded: 0, healthy: 0, unknown: 0 },
    },
  };

  test("a level's summary reads in English as it did", () => {
    expect(
      describeSiteTopologyFilter({
        mode: "all",
        summary: { ...SUMMARY, devices: { ...SUMMARY.devices, total: 0 } },
        childTypeLabel: "Site",
      }),
    ).toBe("12 sites at this level. Open one to see the devices in it.");
    expect(
      describeSiteTopologyFilter({
        mode: "down",
        summary: SUMMARY,
        childTypeLabel: "Site",
      }),
    ).toBe("No sites at this level are down — but 3 sites still need a look.");
  });

  test("a level's summary in German and Arabic counts its sites in those languages", () => {
    expect(
      describeSiteTopologyFilter({
        mode: "all",
        summary: { ...SUMMARY, devices: { ...SUMMARY.devices, total: 0 } },
        childTypeLabel: "Site",
        translator: DE,
      }),
    ).toBe(
      "12 Standorte auf dieser Ebene. Öffnen Sie einen Eintrag, um seine Geräte zu sehen.",
    );
    expect(
      describeSiteTopologyFilter({
        mode: "down",
        summary: SUMMARY,
        childTypeLabel: "Site",
        translator: DE,
      }),
    ).toBe(
      "Keine Standorte auf dieser Ebene sind ausgefallen – aber 3 Standorte müssen noch geprüft werden.",
    );
    expect(
      describeSiteTopologyFilter({
        mode: "all",
        summary: { ...SUMMARY, devices: { ...SUMMARY.devices, total: 0 } },
        childTypeLabel: "Site",
        translator: AR,
      }),
    ).toBe("في هذا المستوى (المواقع: 12). افتح أحدها لرؤية الأجهزة فيه.");

    // A level of the customer's own noun keeps it as they wrote it.
    const stores: string = describeSiteTopologyFilter({
      mode: "all",
      summary: { ...SUMMARY, devices: { ...SUMMARY.devices, total: 0 } },
      childTypeLabel: "Store",
      translator: DE,
    });

    expect(stores).toContain("12 stores");
    expect(stores).toContain("auf dieser Ebene");
  });

  test("the health chips' tooltips are German, the chips' own labels stay keys", () => {
    const options: Array<SiteTopologyFilterOption> =
      buildSiteTopologyFilterOptions(SUMMARY, "Site", DE);

    expect(
      options.map((option: SiteTopologyFilterOption): string => {
        return option.label;
      }),
    ).toEqual(["All", "Needs attention", "Down", "Degraded"]);
    expect(options[0]!.description).toBe("Alle Standorte auf dieser Ebene.");

    for (const option of options) {
      expect(option.description).not.toMatch(/\bsites\b/);
    }
  });

  test("a link rule's site rows and their toggle, in German and Arabic", () => {
    const site: TopologyLinkRuleWarningSite = {
      siteId: "site-1",
      siteName: "Filiale 5",
      reason: "noParentMatched",
      strandedDeviceCount: 3,
      matchedParentCount: 0,
    };

    expect(describeWarningSite(site)).toBe(
      "Filiale 5 — no device carries the parent labels, so 3 devices have no uplink",
    );
    expect(describeWarningSite(site, DE)).toBe(
      "Filiale 5 – kein Gerät trägt die übergeordneten Labels, daher haben 3 Geräte keinen Uplink",
    );
    expect(describeWarningSite({ ...site, strandedDeviceCount: 1 }, DE)).toBe(
      "Filiale 5 – kein Gerät trägt die übergeordneten Labels, daher hat 1 Gerät keinen Uplink",
    );
    expect(describeWarningSite({ ...site, strandedDeviceCount: 3 }, AR)).toBe(
      "Filiale 5 — لا يحمل أي جهاز تسميات الأصل، لذا تبقى أجهزة بلا رابط صاعد: 3",
    );

    // An ambiguous site counts its parents in the sentence's language.
    expect(
      describeWarningSite(
        { ...site, reason: "ambiguousParent", matchedParentCount: 2 },
        DE,
      ),
    ).toBe(
      "Filiale 5 – 2 Geräte tragen die übergeordneten Labels, daher haben 3 Geräte keinen Uplink",
    );
    expect(
      describeWarningSite(
        { ...site, reason: "ambiguousParent", matchedParentCount: 2 },
        AR,
      ),
    ).toBe(
      "Filiale 5 — تحمل أجهزة متعددة تسميات الأصل (الأجهزة: 2)، لذا تبقى أجهزة بلا رابط صاعد: 3",
    );

    // A site with no name is called what it is, in the reader's language.
    expect(describeWarningSite({ ...site, siteName: undefined }, DE)).toContain(
      "Unbenannter Standort",
    );

    const warning: TopologyLinkRuleWarning = {
      ruleId: "rule-1",
      ruleName: "Router link",
      message: "",
      siteCount: 697,
      sites: [site],
    };

    expect(describeSiteListToggle(warning)).toBe(
      "Show the 697 sites that need attention",
    );
    expect(describeSiteListToggle(warning, DE)).toBe(
      "Die 697 Standorte anzeigen, die Aufmerksamkeit brauchen",
    );
    expect(describeSiteListToggle({ ...warning, siteCount: 1 }, DE)).toBe(
      "Den 1 Standort anzeigen, der Aufmerksamkeit braucht",
    );
    expect(describeSiteListToggle(warning, AR)).toBe(
      "عرض المواقع التي تحتاج إلى انتباه (697)",
    );
  });
});

describe("a passkey registration's errors", () => {
  test("are English keys, the same English as before, worded in every language", () => {
    const errors: Array<string> = [
      WEBAUTHN_NEEDS_SECURE_CONNECTION,
      WEBAUTHN_NOT_SUPPORTED,
      WEBAUTHN_REGISTRATION_CANCELED,
      WEBAUTHN_ALREADY_REGISTERED,
      WEBAUTHN_REGISTRATION_FAILED,
    ];

    expect(errors).toEqual([
      "Passkeys require a secure connection. Open OneUptime using HTTPS, or sign in with your password.",
      "This browser does not support passkeys. Use a supported browser or sign in with your password.",
      "Passkey registration was canceled or timed out. Try again when you are ready.",
      "This authenticator is already registered. Choose a different authenticator or use your existing passkey.",
      "Unable to complete passkey registration. Please try again.",
    ]);

    for (const translator of [DE, FR, RU, JA, AR]) {
      for (const error of errors) {
        expect({
          language: translator.language,
          error,
          translated: translator.translateText(error) !== error,
        }).toEqual({ language: translator.language, error, translated: true });
      }
    }
  });
});
