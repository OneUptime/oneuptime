import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";

/*
 * THE TWO-FACTOR, TOPOLOGY, STATUS PAGE, SLO AND WORKSPACE TEXTS (#6658), IN
 * EVERY LANGUAGE - read from the Dashboard's shipped locale files.
 *
 * Each file below used to draw some of its sentences as written, or glue
 * them together from English pieces. Now every one is looked up whole, so
 * each must be worded in every language the Dashboard ships: a sentence
 * left in English is a German, Japanese or Arabic reader meeting English
 * again. A word a language keeps as written ("VLAN {{vlanId}}", the French
 * "sites") is one its progress file records so.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();
const REPOSITORY_ROOT: string = CONTEXT.repositoryRoot;
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);

// Every language besides English.
const LANGUAGES: Array<string> = CONTEXT.locales.slice();

// Languages with one plural form: their "_one" keys are never read.
const ONE_FORM_LANGUAGES: ReadonlySet<string> = new Set([
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
]);

const DASHBOARD_FILES: Array<string> = [
  "Components/Slo/SloActiveBurnEventsCard.tsx",
  "Components/Slo/SloBudgetBar.tsx",
  "Components/Slo/SloBudgetBurnDownCard.tsx",
  "Components/Slo/SloBurnRateRulesSummaryCard.tsx",
  "Components/Slo/SloConfigurationSummaryCard.tsx",
  "Components/Slo/SloHistoryCharts.tsx",
  "Components/Slo/SloKpiStrip.tsx",
  "Components/Slo/SloMetricsQueryConfig.ts",
  "Components/Slo/SloMonitorsSummaryCard.tsx",
  "Components/Slo/SloOverviewEmptyState.tsx",
  "Components/Slo/SloOverviewGettingStartedCard.tsx",
  "Components/Slo/SloOverviewHero.tsx",
  "Components/Slo/SloOverviewTextInLanguage.ts",
  "Components/Slo/SloStatusSummaryCards.tsx",
  "Components/StatusPage/AxisValuesInput.tsx",
  "Components/StatusPage/BulkAddStatusPageMonitorsModal.tsx",
  "Components/StatusPage/ImportGroupsFromCsvModal.tsx",
  "Components/StatusPage/StatusPageResourcePanel.tsx",
  "Components/StatusPage/StatusPageResourcePanelText.ts",
  "Components/Topology/AddNeighborToMonitoringModal.tsx",
  "Components/Topology/EdgeDetailPanel.tsx",
  "Components/Topology/EntityDetailPanel.tsx",
  "Components/Topology/HierarchyTopologyViewModel.ts",
  "Components/Topology/InfrastructureGraph.tsx",
  "Components/Topology/LinkRuleWarningUtil.ts",
  "Components/Topology/NetworkDeviceDetailPanel.tsx",
  "Components/Topology/NetworkDeviceGraph.tsx",
  "Components/Topology/NetworkLinkDetailPanel.tsx",
  "Components/Topology/NetworkTopologyExplorer.tsx",
  "Components/Topology/NetworkTopologyLiveView.tsx",
  "Components/Topology/NetworkTopologyMeta.ts",
  "Components/Topology/NetworkTopologyToolbar.tsx",
  "Components/TwoFactorAuth/BackupCodes.tsx",
  "Components/TwoFactorAuth/TwoFactorStatus.tsx",
  "Components/TwoFactorAuth/WebAuthnCredentials.tsx",
  "Components/Workspace/NotificationRuleForm/NotificationRuleForm.tsx",
  "Components/Workspace/SendTestNotificationButton.tsx",
  "Components/Workspace/WorkspaceNotificationRulesTable.tsx",
  "Components/Workspace/WorkspaceSummaryCopy.ts",
  "Components/Workspace/WorkspaceSummaryTable.tsx",
  "Pages/Global/UserProfile/TwoFactorAuth.tsx",
  "Utils/StatusPageGroupCsv.ts",
];

/*
 * The files the UI review of #6680 routed through the translator: every key
 * they look up is worded in every language, not only German, Spanish and
 * Japanese - a Korean or a Danish SLO overview, topology or resources pane
 * reads no English either.
 */
const REVIEWED_FILES: Array<string> = [
  "Components/Slo/SloBurnRateRulesSummaryCard.tsx",
  "Components/Slo/SloFeed.tsx",
  "Components/Slo/SloKpiStrip.tsx",
  "Components/Slo/SloMetricsQueryConfig.ts",
  "Components/Slo/SloOverviewHero.tsx",
  "Components/Slo/SloOverviewTextInLanguage.ts",
  "Components/StatusPage/BulkAddStatusPageMonitorsModal.tsx",
  "Components/StatusPage/StatusPageResourcePanel.tsx",
  "Components/StatusPage/StatusPageResourcePanelText.ts",
  "Components/Topology/AddNeighborToMonitoringModal.tsx",
  "Components/Topology/EntityDetailPanel.tsx",
  "Components/Topology/InfrastructureGraph.tsx",
  "Components/Topology/NetworkLinkDetailPanel.tsx",
  "Components/Topology/NetworkTopologyExplorer.tsx",
  "Components/Workspace/SendTestNotificationButton.tsx",
  "Utils/StatusPageGroupCsv.ts",
];

// Common's passkey helper: its errors are keys the passkey cards look up.
const COMMON_FILES: Array<string> = [
  "packages/Common/UI/Utils/WebAuthn.ts",
  // A resource group navigator row's count tooltip.
  "packages/Common/UI/Components/StatusPage/ResourceGroupNavigatorText.ts",
];

/*
 * Words the sentences above put inside them - a count of sites, a site with
 * no name, the SLO's target - so they read in every language too.
 */
const WORDS_INSIDE_THE_SENTENCES: Array<string> = [
  "{{count}} sites",
  "{{count}} sites_one",
  "{{count}} devices",
  "{{count}} devices_one",
  "{{count}} monitors",
  "{{count}} monitors_one",
  "{{count}} day",
  "{{count}} days",
  "{{count}} days_one",
  "Unnamed site",
  "Target {{target}}%",
  "Line {{line}}: {{message}}",
  "Set up {{name}}",
  "sites",
  "site",
];

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLocale(language: string): Record<string, string> {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const GLOBAL_SAME_AS_ENGLISH: Array<string> = readJson(
  path.join(DASHBOARD, "i18n/SameAsEnglish.json"),
) as Array<string>;

// What reads the same as English in every language, and in this one.
function keptAsWritten(language: string): Set<string> {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(DASHBOARD, `i18n/Progress/${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return new Set([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(progress.sameAsEnglish || []),
  ]);
}

// Every key the files look up: a plural's general sentence and its "_one".
function getKeys(
  dashboardFiles: Array<string> = DASHBOARD_FILES,
  commonFiles: Array<string> = COMMON_FILES,
): Array<string> {
  const keys: Set<string> = new Set<string>();
  const files: Array<string> = [
    ...dashboardFiles.map((file: string): string => {
      return path.join(DASHBOARD, "src", file);
    }),
    ...commonFiles.map((file: string): string => {
      return path.join(REPOSITORY_ROOT, file);
    }),
  ];

  for (const file of files) {
    const strings: Array<ExtractedString> = scanSourceText(
      path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
      fs.readFileSync(file, "utf8"),
      { kind: "ui" },
    ).strings;

    for (const entry of strings) {
      keys.add(entry.text);

      if (entry.pluralOne !== undefined) {
        keys.add(`${entry.text}_one`);
      }
    }
  }

  return [...keys].sort();
}

const KEYS: Array<string> = getKeys();

// The keys a language still holds in English, without recording them so.
function untranslated(language: string, keys: Array<string>): Array<string> {
  const locale: Record<string, string> = readLocale(language);
  const same: Set<string> = keptAsWritten(language);

  return keys.filter((key: string): boolean => {
    if (ENGLISH[key] === undefined) {
      return false;
    }

    if (ONE_FORM_LANGUAGES.has(language) && key.endsWith("_one")) {
      return false;
    }

    // The progress files record the English a language keeps, not its key.
    return locale[key] === ENGLISH[key] && !same.has(ENGLISH[key]!);
  });
}

const PLACEHOLDER: RegExp = /\{\{\s*([^}\s]+)\s*\}\}/g;

function placeholders(text: string): Array<string> {
  return [
    ...new Set(
      [...text.matchAll(PLACEHOLDER)].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    ),
  ].sort();
}

/*
 * The files' sentences most readers meet, and that this change worded:
 * each is listed so a key renamed in the source without a translation
 * fails here by name, not only as a count.
 */
const SENTENCES_THIS_CHANGE_WORDED: Array<string> = [
  // Two-factor authentication.
  "Passkey added. Use it the next time you sign in.",
  "Passkeys require a secure connection. Open OneUptime using HTTPS, or sign in with your password.",
  "Security keys require a secure connection. Open OneUptime using HTTPS, or sign in with your password.",
  "This browser does not support passkeys. Use a supported browser or sign in with your password.",
  "This browser does not support security keys. Use a supported browser or sign in with your password.",
  "Passkey registration was canceled or timed out. Try again when you are ready.",
  "Security key registration was canceled or timed out. Try again when you are ready.",
  "This authenticator is already registered. Choose a different authenticator or use your existing passkey.",
  "This authenticator is already registered. Choose a different authenticator or use your existing security key.",
  "Unable to complete passkey registration. Please try again.",
  "Unable to complete security key registration. Please try again.",
  "{{unused}} of {{total}} backup codes remaining",
  "OneUptime two-factor authentication backup codes",
  "Keep this file somewhere safe, separate from your authenticator or security key.",
  "Each code can be used once after entering your password.",
  "Your two-factor authentication status could not be loaded.",
  "Authenticator app added. It is ready to use for two-factor authentication.",
  "Enter a name for your authenticator app.",
  "This authenticator could not be loaded. Close this window and choose Finish setup to try again.",
  // Topology.
  "Showing {{visible}} of {{count}} devices",
  "Showing {{visible}} of {{count}} devices_one",
  "{{levelSize}} at this level. Open one to see the devices in it.",
  "{{matched}} of {{levelSize}} need a look. Open one for its topology.",
  "Nothing at this level matches — all {{levelSize}} look fine.",
  "Every {{children}} at this level.",
  "Open {{site}}, the first {{child}} that needs a look",
  "{{site}} — no device carries the parent labels, so {{count}} devices have no uplink",
  "{{site}} — no device carries the parent labels, so {{count}} devices have no uplink_one",
  "Show the {{count}} sites that need attention",
  "Show the {{count}} sites that need attention_one",
  "{{learner}} learned {{learned}}'s MAC address in its forwarding or ARP table",
  "{{parent}} is the parent of {{child}} — declared, not inferred. The Parent-Child view draws {{childName}} beneath it.",
  'Nothing matches "{{search}}" — the whole map is dimmed',
  "Add {{name}} to monitoring",
  "Network device: {{name}}",
  "Unknown interface",
  "Busy (over {{percent}}%)",
  "Attached via {{device}} {{port}}",
  "{{visible}} of {{total}} {{children}} · Updates every minute",
  // Status pages.
  'Are you sure you want to remove "{{name}}" from this status page? The monitor itself is not deleted.',
  "Add a monitor to {{name}} and visitors will see its status here.",
  "This group is laid out as a grid, but it has no rows or columns yet.",
  "Showing the first {{shown}} of {{total}} resources in this group.",
  "Import {{count}} Groups",
  "Import {{count}} Groups_one",
  "{{count}} groups ready to import.",
  "{{count}} groups ready to import._one",
  "Status hidden",
  "Status shown",
  "{{axis}} (Row)",
  "{{axis}} (Column)",
  // SLOs.
  "Rolling {{count}} days",
  "Rolling {{count}} days_one",
  "the last {{count}} days",
  "the last {{count}} days_one",
  "this calendar month ({{timezone}})",
  "No monitors",
  "Evaluated {{time}}",
  "Within error budget",
  "Error budget running low",
  "Error budget exhausted",
  "Waiting for monitors",
  "Monitor uptime",
  "When {{percent}} or less of the error budget is left",
  "{{duration}} of downtime allowed this calendar month",
  "{{duration}} of downtime allowed per rolling {{count}} days",
  "{{duration}} of downtime allowed per rolling {{count}} days_one",
  "At {{rate}} or faster over {{longWindow}} and {{shortWindow}}",
  "Kept in sync by {{count}} monitor rules",
  "Kept in sync by {{count}} monitor rules_one",
  "{{count}} of {{monitors}} need attention",
  "{{count}} of {{monitors}} need attention_one",
  "All {{monitors}} operational",
  "View all {{monitors}}",
  "At risk ({{percent}})",
  "Target {{target}} · not evaluated yet",
  "{{status}}: {{count}}. Activate to filter the SLO list below to these SLOs.",
  "OneUptime evaluates SLOs every {{count}} minutes. The SLI, error budget and burn-down appear on this page after the first evaluation.",
  "OneUptime evaluates SLOs every {{count}} minutes. The SLI, error budget and burn-down appear on this page after the first evaluation._one",
  // Slack, Microsoft Teams and Mattermost.
  "Incident Summary - {{workspace}}",
  "Alert Episode Summary - {{workspace}}",
  "Set up recurring incident summary reports posted to {{workspace}}. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of incidents with links.",
  "No alert summary rules configured yet. Create one to start receiving periodic reports.",
  "Weekly Incident Episode Summary",
  "e.g., Weekly alert summary for the engineering team.",
  "Send test notification to {{destination}}",
  "Test notification sent to {{destination}}. Check {{workspace}} to confirm it arrived.",
  "OneUptime could not send a test notification to {{destination}} in {{workspace}}.",
  'Send the "{{name}}" summary to {{workspace}} now, with the last {{count}} days of data. The regular schedule is not affected.',
  'Send the "{{name}}" summary to {{workspace}} now, with the last {{count}} days of data. The regular schedule is not affected._one',
  "{{chat}} (1:1 chat)",
];

describe("the two-factor, topology, status page, SLO and workspace texts in every language", () => {
  test("the files are read: hundreds of keys, every one in en.json", () => {
    expect(KEYS.length).toBeGreaterThan(500);

    const notInEnglish: Array<string> = KEYS.filter((key: string): boolean => {
      return ENGLISH[key] === undefined;
    });

    expect(notInEnglish).toEqual([]);
  });

  test("Arabic words every key the files look up", () => {
    expect(untranslated("ar", KEYS)).toEqual([]);
  });

  test("German, Spanish and Japanese word every key the files look up", () => {
    for (const language of ["de", "es", "ja"]) {
      expect({ language, missing: untranslated(language, KEYS) }).toEqual({
        language,
        missing: [],
      });
    }
  });

  test("every language words each sentence this change worded, with its placeholders", () => {
    // The list names keys that exist.
    const unknown: Array<string> = SENTENCES_THIS_CHANGE_WORDED.filter(
      (key: string): boolean => {
        return ENGLISH[key] === undefined || !KEYS.includes(key);
      },
    );

    expect(unknown).toEqual([]);

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        missing: untranslated(language, SENTENCES_THIS_CHANGE_WORDED),
      }).toEqual({ language, missing: [] });

      for (const key of SENTENCES_THIS_CHANGE_WORDED) {
        if (ONE_FORM_LANGUAGES.has(language) && key.endsWith("_one")) {
          continue;
        }

        expect({
          language,
          key,
          placeholders: placeholders(locale[key]!),
        }).toEqual({
          language,
          key,
          placeholders: placeholders(ENGLISH[key]!),
        });
      }
    }
  });

  test("every language words every key the files the UI review touched look up", () => {
    const reviewedKeys: Array<string> = getKeys(REVIEWED_FILES, [
      "packages/Common/UI/Components/StatusPage/ResourceGroupNavigatorText.ts",
    ]);

    // The KPI strip's runway, the explorer's search and the CSV import's errors.
    for (const key of [
      "Until exhausted, at the burn rate of the last {{window}}",
      "Search sites by name — anywhere in your network",
      'Unknown {{column}} "{{value}}". Valid values: {{values}}.',
    ]) {
      expect({ key, read: reviewedKeys.includes(key) }).toEqual({
        key,
        read: true,
      });
    }

    // Every language's gaps at once, so a failure names them all.
    const missing: Record<string, Array<string>> = {};

    for (const language of LANGUAGES) {
      const keys: Array<string> = untranslated(language, reviewedKeys);

      if (keys.length > 0) {
        missing[language] = keys;
      }
    }

    expect(missing).toEqual({});
  });

  test("every language words what the sentences put inside them", () => {
    for (const language of LANGUAGES) {
      expect({
        language,
        missing: untranslated(language, WORDS_INSIDE_THE_SENTENCES),
      }).toEqual({ language, missing: [] });
    }
  });

  test("the Arabic counted sentences read right for every count: a label and its count, or the count of the things", () => {
    const arabic: Record<string, string> = readLocale("ar");

    for (const key of SENTENCES_THIS_CHANGE_WORDED) {
      if (!key.endsWith("_one") || !ENGLISH[key]!.includes("{{count}}")) {
        continue;
      }

      // The "_one" form names its count, as the English one does.
      expect({ key, one: arabic[key]!.includes("{{count}}") }).toEqual({
        key,
        one: true,
      });
    }

    // The general forms, read for 0, 2-10, 11-99 and 100 and up.
    expect(arabic["Showing {{visible}} of {{count}} devices"]).toBe(
      "عرض الأجهزة: {{visible}} من أصل {{count}}",
    );
    expect(arabic["Rolling {{count}} days"]).toBe(
      "نافذة متحركة (الأيام: {{count}})",
    );
    expect(arabic["{{count}} groups ready to import."]).toBe(
      "المجموعات الجاهزة للاستيراد: {{count}}.",
    );
  });
});
