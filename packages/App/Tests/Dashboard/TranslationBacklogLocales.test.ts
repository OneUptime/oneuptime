import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { DashboardVariableType } from "Common/Types/Dashboard/DashboardVariable";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { ROLE_NAMES } from "../../FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import {
  DASHBOARD_VARIABLE_TYPE_NAMES,
  getDashboardVariableTypeName,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariableTypeNames";
import {
  getAiAccessTestPermissionRequirement,
  getPermissionTitlesText,
} from "../../FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import { getNotYetInStateText } from "../../FeatureSet/Dashboard/src/Utils/EventOverview";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import { SLO_WINDOW_TYPE_NAMES } from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import { SLO_MULTI_MONITOR_MODE_NAMES } from "../../FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";

/*
 * THE TRANSLATION BACKLOG (#5134, #5239): LABELS THAT WERE STILL IN ENGLISH.
 *
 * About half of the Dashboard read in English in it, pt, nl, da, no, sv, ru,
 * ko, zh and hi, and pieces of it in de, fr, es and ja: Security's cases,
 * AI Insights, the monitor and SLO rules, on-call summaries, runbooks,
 * Session Replay, Discovery, Topology, VMware, the Add Trigger panel, the
 * built-in roles and more. This holds what that work fixed:
 *
 *   - a sample of every line's words is translated in every language, with
 *     the English's placeholders;
 *   - the built-in roles have names of their own in every language, one per
 *     role, and the word-for-word "Incidente Membro" kind is gone;
 *   - Swedish says larm for an alert everywhere, German Gemeldet for
 *     Declared, Japanese 非表示 (Hide) for Dismiss;
 *   - the variable sources and the permission sentences read in the
 *     reader's language;
 *   - the keys no code used any more are gone.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const LOCALES: string = path.join(DASHBOARD, "src", "Locales");
const I18N: string = path.join(DASHBOARD, "i18n");

const LANGUAGES: ReadonlyArray<string> = [
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

type Locale = Record<string, unknown>;

const localeCache: Map<string, Locale> = new Map<string, Locale>();

function readLocale(code: string): Locale {
  const cached: Locale | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const locale: Locale = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Locale;
  localeCache.set(code, locale);

  return locale;
}

function valueOf(code: string, key: string): string | undefined {
  const value: unknown = readLocale(code)[key];

  return typeof value === "string" ? value : undefined;
}

// The words a language writes as the English does: every language's, and its own.
function sameAsEnglishIn(code: string): Array<string> {
  const everyLanguage: Array<string> = JSON.parse(
    fs.readFileSync(path.join(I18N, "SameAsEnglish.json"), "utf8"),
  ) as Array<string>;
  const own: Array<string> =
    (
      JSON.parse(
        fs.readFileSync(path.join(I18N, "Progress", `${code}.json`), "utf8"),
      ) as { sameAsEnglish?: Array<string> }
    ).sameAsEnglish || [];

  return [...everyLanguage, ...own];
}

function placeholdersOf(text: string): Array<string> {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ),
  ).sort();
}

// A translator for a language, from its Dashboard locale file.
function translatorFor(code: string): Translator {
  return createTranslator((text: string): string | undefined => {
    return valueOf(code, text);
  }, code);
}

/*
 * A sample of each line's words, by the maintainer's line they come from:
 * labels, buttons, tiles, empty states and sentences, as the pages draw them.
 */
const BACKLOG_WORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "Security: cases, detections and connections": [
    "Case",
    "Assignee",
    "Verdict",
    "Opened By",
    "Open For",
    "Time to Acknowledge",
    "Assign to Me",
    "Run Playbook",
    "Close Case",
    "Low",
    "Medium",
    "Detections",
    "Connections",
    "True Positive",
    "False Positive",
    "Incident {{number}}",
  ],
  "AI Insights": [
    "Needs Attention",
    "Fix Opened",
    "Seen any time",
    "Details",
    "AI Insights",
    "seen {{count}} times",
    "Open insight",
    "Confirmed",
    "Evidence",
    "Last seen {{time}}",
    "Search insights",
    "Search insights by title...",
    "Filter by insight type",
    "Filter by severity",
    "Filter by when last seen",
    "Sort insights",
  ],
  "Monitors and SLOs": [
    "{{count}} filters",
    "Monitor Rules",
    "Burn Rate Rules",
    "Rolling",
    "Calendar Month",
    "Any Monitor Down",
    "SLOs",
    "Archived By",
    "Service Level Objectives",
    "Click to configure a query",
    "No data for the selected time range",
    "Data Source Gauge",
    "Gauge Widget",
    "Error Budget",
    "Burn Rate",
    "Error budget",
  ],
  "On-call layer and escalation summaries": [
    "{{count}} of {{total}}",
    "Teams",
    "Delete Rule",
    "Disconnect",
    "Unreachable",
    "Clear filters",
    "{{items}} and {{last}}",
    "Handle",
    "{{minutes}} min",
    "15 min",
    "How many days back the calendar reaches (0 to {{max}}).",
    "How far ahead the calendar reaches ({{min}} to {{max}}).",
    "Google Calendar",
    "{{policy}}: You are added to escalation rule {{rule}} for this policy.",
    "Describe who this level notifies and why.",
    "a team",
  ],
  "Evaluation Logs": [
    "Evaluation Logs",
    "Criteria {{number}}",
    "This criterion was not evaluated.",
    "Not evaluated",
    "Condition: {{condition}}",
    "Not evaluated because {{criteria}} matched first.",
    "{{name}}: Met",
    "{{name}}: Not Met",
    "Met",
    "Not Met",
    "Partial",
    "Checks: {{checks}}",
    "Conditions: {{conditions}}",
    "Thresholds: {{thresholds}}",
    "{{count}} matching checks",
    "Action at {{time}}",
  ],
  Runbooks: [
    "Step {{number}}",
    "Started {{date}}",
    "Runbooks",
    "Port",
    "Runbook",
    "Progress",
    "Webhook",
    "No matches",
    "No runbooks yet",
    "Create a runbook first, then come back to attach one.",
    "Try a different search term.",
    "Untitled runbook",
    "Starting...",
    "Auto-attach runbooks when matching incidents are created.",
    "Match incidents and start runbooks automatically.",
  ],
  "Session Replay": [
    "Session Replay",
    "Decisions",
    "Privacy",
    "Copied",
    "trace",
    "logs",
    "traces",
    "Error logs",
    "Explain it",
    "Session replay",
    "unknown",
    "Span",
    "Spans",
    "Location",
    "log",
    "Live",
  ],
  Profiler: [
    "Profiler",
    "Samples",
    "Reset zoom",
    "Called by",
    "Reset Zoom",
    "{{minutes}}-minute window around this capture",
    "last {{minutes}} minutes",
    "“what regressed since the last deploy?”",
    "Most regressed functions",
    "Most improved functions",
    "Most regressed",
    "Most improved",
    "No functions regressed beyond the noise floor between these windows.",
    "No functions improved beyond the noise floor between these windows.",
    "{{delta}} pp",
    "self",
  ],
  Discovery: [
    "Scanning - {{swept}} of {{total}} addresses swept so far",
    "{{responded}} of {{scanned}} hosts answered ping",
    "{{responded}} of {{scanned}} hosts",
    "Final checks",
    "Scanning",
    "{{covered}} of {{count}} addresses swept",
    "{{count}} addresses swept",
    "{{count}} addresses queued",
    "Waiting for the probe",
    "Waiting for the first progress update",
    "Stopped after {{duration}}",
    "Finished in {{duration}}",
    "{{scan}} address sweep progress",
    "Discovery scan address sweep progress",
    "{{progress}}. Final checks are still running.",
    "Waiting for the probe to start.",
  ],
  Topology: [
    "Grid",
    "Map",
    "Database",
    "Resource",
    "Open alerts",
    "Request rate",
    "device",
    "Proxmox Clusters",
    "Ceph Clusters",
    "Network Sites",
    "Proxmox Cluster",
    "Ceph Cluster",
    "+ {{count}} more",
    "Unnamed resource",
  ],
  VMware: [
    "{{count}} clusters",
    "Without Docker",
    "Free",
    "How do you want to install the agent?",
    "Max",
    "Disk",
    "Password",
    "Throughput",
    "Probe {{id}}",
    "Install the agent",
    "How much of this host's memory was in use.",
    "Packets dropped per second by this host's network adapters.",
    "CPU Ready",
    "Production vCenter Server in the US East datacenter",
    "{{count}} datacenters",
  ],
  "Facets and filter chips": [
    "{{field}} is not",
    "Close (Esc)",
    "Search {{name}}...",
    "Click or drag to zoom",
    "Drag to zoom",
    "Remove {{key}}: {{value}}",
    "Search syntax",
    "+{{count}} more...",
    "Double-click to reset",
    "Saved Views",
    "Saved views",
    "Clear view",
    "No saved views yet.",
    "No matches found",
    "default",
    "+ Save Current View",
  ],
  "Auto-refresh and browser ingestion keys": [
    "Auto-refresh",
    "Server",
    "Allowed Origins",
    "Pinned Service Name",
    "Give this key a name you will recognize later.",
    "Describe where this key will be used.",
    "No browser ingestion keys yet",
    "Ingestion Token",
    "Create Browser Ingestion Key",
  ],
  "The Add Trigger panel": [
    "All resources",
    "No triggers match.",
    "No components match.",
    "Best {{shown}} of {{total}} matches.",
    "{{count}} matches.",
    "No triggers match “{{search}}”",
    "No components match “{{search}}”",
    "Matching triggers",
    "Matching components",
    "No triggers to show.",
    "No components to show.",
    "Popular",
    "More triggers",
    "More components",
    "Components",
    "OneUptime resources",
  ],
  "Add Widget": [
    "Label",
    "Network Map",
    "Search widgets",
    "Search widgets by name, e.g. chart, logs, pods...",
    "Widget categories",
    "All widgets",
    "{{count}} widgets match “{{term}}”. Press Enter to add the first one.",
    "No widgets match “{{term}}”.",
    "Editing",
    "Reset the dashboard to the time range it had before the zoom",
    "More dashboard options",
    "Edit Dashboard",
    "Full Screen",
    "Loading project labels…",
    "Allowed project labels",
    "Choose labels for this variable",
  ],
  "Time ranges": [
    "Duration",
    "Pick a start date and time.",
    "Pick an end date and time.",
    "The end must be after the start. Adjust either end of the range.",
    "Custom Time Range",
    "Quick fill",
    "Start date & time",
    "End date & time",
    "Quick ranges",
    "Pick the exact start and end date & time.",
    "Showing {{duration}} of data.",
    "Relative to now — updates every time the dashboard loads.",
    "Click to change the date and time range of data on this dashboard.",
    "Choose a quick range or set an exact start and end date & time.",
    "Start date should be before end date",
    "End date should be after start date",
  ],
  "Bulk actions and form steps": [
    "Step {{current}} of {{total}}",
    "Add Labels",
    "Add Owner",
    "Summary",
    "In Progress",
    "Remove Labels",
    "These labels will be added to each selected item.",
    "No Labels to Remove",
    "The selected items don't have any labels to remove.",
    "These labels will be removed from each selected item.",
    "Remove Owner",
  ],
  "Twilio and incoming calls": [
    "Twilio Account SID",
    "Twilio Auth Token",
    "Canada (+1)",
    "Australia (+61)",
    "Austria (+43)",
    "Portugal (+351)",
    "Finland (+358)",
    "Japan (+81)",
    "Singapore (+65)",
    "Hong Kong (+852)",
    "New Zealand (+64)",
    "Mexico (+52)",
    "Israel (+972)",
    "The selected phone number could not be found.",
    "{{phoneNumber}} has been released back to Twilio.",
    "The phone number has been released back to Twilio.",
  ],
  Code: [
    "GitHub Trigger Label",
    "Pull Requests",
    "Respond to GitHub Commands",
    "Max Open Fix Pull Requests",
  ],
  "The auto-remediation card": [
    "Open the cluster's AI agent page",
    "Why:",
    "What to do:",
    "What auto-remediation did",
    "What OneUptime did to fix this automatically, or why it did nothing.",
    "Waiting for investigation",
    "Action taken",
    "No action taken",
    "Open its AI agent page",
    "AI settings",
    "LLM providers",
    "Link {{monitorName}}",
    "the monitor",
    "This {{signal}} is not linked to a Kubernetes cluster.",
    'Cluster "{{clusterName}}" already has an AI fix for this {{signal}}.',
    'Rule "{{ruleName}}" already proposed a fix for this {{signal}}.',
  ],
  "Built-in role names": [
    "Project Owner",
    "Incident Admin",
    "Incident Viewer",
    "Alert Admin",
    "Alert Member",
    "Alert Viewer",
    "Monitor Admin",
    "Monitor Member",
    "Monitor Viewer",
    "Status Page Admin",
    "Status Page Member",
    "Status Page Viewer",
    "On-Call Admin",
    "On-Call Member",
    "On-Call Viewer",
  ],
  "Charts and stat tiles": [
    "In",
    "Out",
    "{{stateName}} in",
    "Not yet {{stateName}}",
    "Create Twilio Config",
    "Disk %",
    "Avg CPU %",
    "Peak CPU %",
    "Avg Memory %",
    "Peak Memory %",
    "Filesystem %",
    "Storage Used",
    "Transmitted",
    "Declared",
    "Declared At",
    "Declared By",
  ],
};
const EVERY_WORD: Array<string> = Object.values(BACKLOG_WORDS).flat();

describe("the backlog's words", () => {
  test("are every one a key the Dashboard's English has", () => {
    const missing: Array<string> = EVERY_WORD.filter(
      (word: string): boolean => {
        return valueOf("en", word) !== word;
      },
    );

    expect(missing).toEqual([]);
  });

  test.each(LANGUAGES)("are all translated in %s", (code: string) => {
    const same: Array<string> = sameAsEnglishIn(code);
    const untranslated: Record<string, Array<string>> = {};

    for (const [line, words] of Object.entries(BACKLOG_WORDS)) {
      const left: Array<string> = words.filter((word: string): boolean => {
        const value: string | undefined = valueOf(code, word);

        return (
          !value || !value.trim() || (value === word && !same.includes(word))
        );
      });

      if (left.length > 0) {
        untranslated[line] = left;
      }
    }

    expect(untranslated).toEqual({});
  });

  test.each(LANGUAGES)("keep their placeholders in %s", (code: string) => {
    for (const word of EVERY_WORD) {
      expect({
        word,
        placeholders: placeholdersOf(valueOf(code, word) || ""),
      }).toEqual({ word, placeholders: placeholdersOf(word) });
    }
  });
});

describe("the built-in roles' names", () => {
  const roles: Array<PermissionProps> =
    PermissionHelper.getRolePermissionProps();

  test("are a key for every role, named as Common/Types/Permission titles it", () => {
    const named: Array<string> = roles.map((props: PermissionProps): string => {
      return ROLE_NAMES[props.permission] || "";
    });

    expect(named).toEqual(
      roles.map((props: PermissionProps): string => {
        return props.title;
      }),
    );
    expect(Object.keys(ROLE_NAMES).length).toBe(roles.length);
  });

  test.each(LANGUAGES)("are all translated in %s", (code: string) => {
    const same: Array<string> = sameAsEnglishIn(code);
    const untranslated: Array<string> = Object.values(ROLE_NAMES).filter(
      (name: string | undefined): boolean => {
        const value: string | undefined = valueOf(code, name || "");

        return !value || (value === name && !same.includes(name));
      },
    ) as Array<string>;

    expect(untranslated).toEqual([]);
  });

  test.each(LANGUAGES)(
    "name every role apart in %s: no two roles read the same",
    (code: string) => {
      const byValue: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >();

      for (const name of Object.values(ROLE_NAMES) as Array<string>) {
        const value: string = valueOf(code, name) || name;
        byValue.set(value, [...(byValue.get(value) || []), name]);
      }

      const shared: Array<Array<string>> = Array.from(byValue.values()).filter(
        (names: Array<string>): boolean => {
          return names.length > 1;
        },
      );

      expect(shared).toEqual([]);
    },
  );

  test("no longer read word for word, the area's name and then the level's", () => {
    // What Incident Member read before: two words side by side, untouched.
    const wordForWord: Record<string, string> = {
      it: "Incidente Membro",
      pt: "Incidente Membro",
      nl: "Incident Lid",
      da: "Hændelse Medlem",
      no: "Hendelse Medlem",
      sv: "Incident Medlem",
      ru: "Инцидент Участник",
      "zh-CN": "事件 成员",
      "zh-TW": "事件 成員",
    };

    for (const [code, old] of Object.entries(wordForWord)) {
      expect({ code, value: valueOf(code, "Incident Member") }).not.toEqual({
        code,
        value: old,
      });
    }

    // Each area's three roles share the area's word, as the picker groups them.
    expect(valueOf("de", "Incident Admin")).toBe("Vorfall-Administrator");
    expect(valueOf("de", "Incident Member")).toBe("Vorfall-Mitglied");
    expect(valueOf("de", "Incident Viewer")).toBe("Vorfall-Betrachter");
    expect(valueOf("fr", "Status Page Viewer")).toBe(
      "Lecteur des pages de statut",
    );
    expect(valueOf("ja", "On-Call Admin")).toBe("オンコール管理者");
    expect(valueOf("sv", "Alert Admin")).toBe("Larmadministratör");
  });

  test("Norwegian reads the Viewer role as Leser, a person, not Viser", () => {
    expect(valueOf("no", "Viewer")).toBe("Leser");
    expect(valueOf("no", "Telemetry Viewer")).toBe("Telemetrileser");
  });
});

describe("the permission sentences", () => {
  const german: Translator = translatorFor("de");

  test("name a role in the sentence's language, and a permission as given", () => {
    expect(
      getPermissionTitlesText(["Project Owner", "Read Monitor"], german),
    ).toBe("Projektinhaber, Read Monitor");
    expect(
      getPermissionTitlesText(
        ["Project Owner", "Read Monitor"],
        translatorFor("en"),
      ),
    ).toBe("Project Owner, Read Monitor");
  });

  test("the connection test's lock names the roles in the reader's words", () => {
    const sentence: string = getAiAccessTestPermissionRequirement(
      {
        noun: "cluster",
        permissionTitles: [
          PermissionHelper.getTitle(Permission.ProjectOwner),
          PermissionHelper.getTitle(Permission.ProjectAdmin),
        ],
      },
      german,
    );

    expect(sentence).toContain("Projektinhaber, Projektadministrator");
    expect(sentence).not.toContain("Project Owner");
  });
});

describe("Swedish says larm for an alert", () => {
  const swedish: Locale = readLocale("sv");
  const ALERT_WORD: RegExp = /\balerts?\b/i;
  const WARNING_WORD: RegExp = /warn/i;
  const VARNING_WORD: RegExp = /varning/i;

  test("in every value whose English names an alert, not a warning", () => {
    const saysVarning: Array<string> = Object.keys(swedish).filter(
      (key: string): boolean => {
        const english: string = key.replace(/_one$/, "");
        const value: unknown = swedish[key];

        return (
          ALERT_WORD.test(english) &&
          !WARNING_WORD.test(english) &&
          typeof value === "string" &&
          VARNING_WORD.test(value)
        );
      },
    );

    expect(saysVarning).toEqual([]);
  });

  test("with the neuter's articles and endings", () => {
    expect(valueOf("sv", "Alerts")).toBe("Larm");
    expect(valueOf("sv", "Alert")).toBe("Larm");
    expect(valueOf("sv", "Active Alerts")).toBe("Aktiva larm");
    expect(valueOf("sv", "Create Alert")).toBe("Skapa larm");
    expect(valueOf("sv", "Critical alert")).toBe("Kritiskt larm");
    expect(valueOf("sv", "{{count}} active alerts_one")).toBe(
      "{{count}} aktivt larm",
    );
    expect(valueOf("sv", "Describe the alert...")).toBe("Beskriv larmet ...");
    expect(valueOf("sv", "When filters match, create an alert.")).toBe(
      "När filter matchar, skapa ett larm.",
    );
  });

  test("and keeps varning for a warning", () => {
    expect(valueOf("sv", "Warnings")).toBe("Varningar");
  });
});

describe("German says Gemeldet for Declared", () => {
  test("on the tiles, the lists and the create form", () => {
    expect(valueOf("de", "Declared")).toBe("Gemeldet");
    expect(valueOf("de", "Declared At")).toBe("Gemeldet am");
    expect(valueOf("de", "Declared By")).toBe("Gemeldet von");
    expect(valueOf("de", "Declared {{time}}")).toBe("Gemeldet {{time}}");
  });

  test("and nowhere Erklärt", () => {
    const german: Locale = readLocale("de");
    const DECLARE_WORD: RegExp = /declare/i;
    const ERKLAERT_WORD: RegExp = /erklärt/i;
    const erklaert: Array<string> = Object.keys(german).filter(
      (key: string): boolean => {
        const value: unknown = german[key];

        return (
          DECLARE_WORD.test(key) &&
          typeof value === "string" &&
          ERKLAERT_WORD.test(value)
        );
      },
    );

    expect(erklaert).toEqual([]);
  });
});

describe("Japanese Dismiss", () => {
  /*
   * 非表示 (Hide): it sets a suggestion aside and closes an error banner.
   * 却下 (Reject) read wrong on the banners (TranslatedLabelsReadRight).
   */
  test("reads 非表示, to put something away, never 閉じる (Close)", () => {
    expect(valueOf("ja", "Dismiss")).toBe("非表示");
    expect(valueOf("ja", "Dismiss")).not.toBe(valueOf("ja", "Close"));
  });
});

describe("a stat tile before its state is reached", () => {
  test("is one sentence in the reader's language, the state named in it", () => {
    expect(getNotYetInStateText("Acknowledged", translatorFor("en"))).toBe(
      "Not yet acknowledged",
    );
    expect(getNotYetInStateText("Acknowledged", translatorFor("de"))).toBe(
      "Noch nicht „Bestätigt“",
    );
    expect(getNotYetInStateText("Resolved", translatorFor("fr"))).toBe(
      "Pas encore résolu",
    );
    expect(getNotYetInStateText("Acknowledged", translatorFor("ru"))).toBe(
      "Ещё не подтверждён",
    );
  });

  test.each(LANGUAGES)(
    "never reads the English 'Not yet' in %s",
    (code: string) => {
      expect(
        getNotYetInStateText("Acknowledged", translatorFor(code)),
      ).not.toMatch(/^Not yet/);
    },
  );
});

describe("the dashboard variables' sources", () => {
  test("are named by their stored values, so English reads as before", () => {
    for (const type of Object.values(DashboardVariableType)) {
      expect(getDashboardVariableTypeName(type)).toBe(type);
      expect(DASHBOARD_VARIABLE_TYPE_NAMES[type]).toBe(type);
    }
  });

  test.each(LANGUAGES)("are each a word of %s", (code: string) => {
    const same: Array<string> = sameAsEnglishIn(code);

    for (const type of Object.values(DashboardVariableType)) {
      const name: string = getDashboardVariableTypeName(type);
      const value: string | undefined = valueOf(code, name);

      expect({ name, translated: Boolean(value) }).toEqual({
        name,
        translated: true,
      });

      if (value === name) {
        expect(same).toContain(name);
      }
    }
  });

  test("the Source dropdown draws the names, not the raw enum", () => {
    const modal: string = fs.readFileSync(
      path.join(
        DASHBOARD,
        "src",
        "Components",
        "Dashboard",
        "Toolbar",
        "DashboardVariablesModal.tsx",
      ),
      "utf8",
    );

    expect(modal).toContain("label: getDashboardVariableTypeName(type)");
    expect(modal).toContain(
      "label: getDashboardVariableTypeName(variable.type)",
    );
    expect(modal).not.toMatch(/label: type,/);
  });
});

describe("the SLO window types and multi-monitor modes", () => {
  const NAMES: Record<string, string> = {
    ...SLO_WINDOW_TYPE_NAMES,
    ...SLO_MULTI_MONITOR_MODE_NAMES,
  };

  test("are named by their stored values, so English and the API read as before", () => {
    for (const type of Object.values(SloWindowType)) {
      expect(SLO_WINDOW_TYPE_NAMES[type]).toBe(type);
    }

    for (const mode of Object.values(SloMultiMonitorMode)) {
      expect(SLO_MULTI_MONITOR_MODE_NAMES[mode]).toBe(mode);
    }
  });

  test.each(LANGUAGES)("are each a word of %s", (code: string) => {
    const same: Array<string> = sameAsEnglishIn(code);

    for (const name of Object.values(NAMES)) {
      const value: string | undefined = valueOf(code, name);

      expect({ name, translated: Boolean(value) }).toEqual({
        name,
        translated: true,
      });

      if (value === name) {
        expect(same).toContain(name);
      }
    }
  });
});

describe("the VMware charts' descriptions", () => {
  const FILES: ReadonlyArray<string> = [
    "Pages/VMware/View/ClusterDetail.tsx",
    "Pages/VMware/View/VirtualMachineDetail.tsx",
    "Pages/VMware/View/DatastoreDetail.tsx",
    "Pages/VMware/View/Insights.tsx",
    "Components/VMware/Host/VMwareHostMetricsTab.tsx",
  ];
  const DESCRIPTION: RegExp =
    /description:\s*(?:translator\.translateTemplate\(\s*)?"((?:[^"\\]|\\.)*)"/g;

  const descriptions: Array<{ file: string; text: string }> = FILES.flatMap(
    (file: string): Array<{ file: string; text: string }> => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD, "src", file),
        "utf8",
      );

      return Array.from(source.matchAll(DESCRIPTION)).map(
        (match: RegExpMatchArray): { file: string; text: string } => {
          return { file, text: (match[1] as string).replace(/\\"/g, '"') };
        },
      );
    },
  );

  test("are found in every page that draws the charts", () => {
    for (const file of FILES) {
      expect({
        file,
        found: descriptions.some((entry: { file: string }): boolean => {
          return entry.file === file;
        }),
      }).toEqual({ file, found: true });
    }
  });

  test("say what each chart shows in plain words, never a receiver metric's name", () => {
    const METRIC_NAME: RegExp = /\b(vcenter|vsphere|vmware)\.[a-z_]+/i;
    const technical: Array<{ file: string; text: string }> =
      descriptions.filter((entry: { text: string }): boolean => {
        return METRIC_NAME.test(entry.text);
      });

    expect(technical).toEqual([]);
  });

  test("are keys the Dashboard's English has", () => {
    const missing: Array<string> = descriptions
      .map((entry: { text: string }): string => {
        return entry.text;
      })
      .filter((text: string): boolean => {
        return valueOf("en", text) !== text;
      });

    expect(missing).toEqual([]);
  });

  test.each(LANGUAGES)("are all translated in %s", (code: string) => {
    const untranslated: Array<string> = descriptions
      .map((entry: { text: string }): string => {
        return entry.text;
      })
      .filter((text: string): boolean => {
        const value: string | undefined = valueOf(code, text);

        return !value || value === text;
      });

    expect(untranslated).toEqual([]);
  });
});

/*
 * The overview heroes' last-seen line: "Last seen 5 minutes ago", or "Never
 * seen" for a resource that has never reported. They used to fill the shared
 * "Last seen {{time}}" with an English "never", which is why most languages
 * had left that sentence English. Now it is one whole sentence either way,
 * in every language.
 */
describe("the overview heroes' last-seen line", () => {
  const SRC: string = path.join(DASHBOARD, "src");
  const HEROES: ReadonlyArray<string> = [
    "Pages/Ceph/View/Index.tsx",
    "Pages/Docker/View/Overview.tsx",
    "Pages/DockerSwarm/View/Index.tsx",
    "Pages/Host/View/Overview.tsx",
    "Pages/IoT/View/Index.tsx",
    "Pages/Kubernetes/View/Index.tsx",
    "Pages/Podman/View/Overview.tsx",
    "Pages/Proxmox/View/Index.tsx",
    "Pages/StorageArray/View/Index.tsx",
    "Pages/VMware/View/Index.tsx",
  ];

  // The file's code, its comments left out and its whitespace squashed.
  const squashed: (relative: string) => string = (relative: string): string => {
    return fs
      .readFileSync(path.join(SRC, ...relative.split("/")), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/\s+/g, " ");
  };

  // Every Dashboard source file that draws the shared sentence.
  const drawers: () => Array<string> = (): Array<string> => {
    const found: Array<string> = [];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (
          (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
          fs.readFileSync(full, "utf8").includes('"Last seen {{time}}"')
        ) {
          found.push(path.relative(SRC, full).split(path.sep).join("/"));
        }
      }
    };

    walk(SRC);

    return found.sort();
  };

  test.each(HEROES)(
    "%s says Last seen with a time, or Never seen, each whole",
    (relative: string) => {
      const source: string = squashed(relative);

      expect(source).toContain(
        'translator.translateTemplate("Last seen {{time}}", { time: OneUptimeDate.fromNow(lastSeenAt), })',
      );
      expect(source).toContain('translator.translateText("Never seen")');
      // The English word the sentence was filled with is gone.
      expect(source).not.toContain(': "never";');
      expect(source).not.toContain('translateText("never")');
      expect(source).not.toContain("time: lastSeenText");
    },
  );

  test("no page fills the shared sentence with an English never", () => {
    const files: Array<string> = drawers();

    /*
     * The heroes are among the pages that draw it, and so is the hero the
     * other telemetry overviews share (services, databases, queues...).
     */
    expect(files).toEqual(
      expect.arrayContaining([
        ...HEROES,
        "Components/TelemetryResource/ResourceOverview.tsx",
      ]),
    );

    for (const file of files) {
      const source: string = squashed(file);

      expect({ file, never: source.includes('"never"') }).toEqual({
        file,
        never: false,
      });
    }
  });

  test("the shared hero has no English words around the time", () => {
    const source: string = squashed(
      "Components/TelemetryResource/ResourceOverview.tsx",
    );

    expect(source).toContain(
      'translator.translateTemplate("Last seen {{time}}", { time: OneUptimeDate.fromNow(props.lastSeenAt), })',
    );
    expect(source).toContain('translator.translateText("Never seen")');
    expect(source).not.toContain("Last seen {lastSeenText}");
    // Its pill's word is the reader's too.
    expect(source).toContain("translator.translateText(givenStatusLabel)");
  });

  test.each(LANGUAGES)("both sentences are words of %s", (code: string) => {
    const sameAsEnglish: Array<string> = sameAsEnglishIn(code);

    for (const key of [
      "Last seen {{time}}",
      "Never seen",
      "Seen recently",
      "Not seen recently",
    ]) {
      const value: string | undefined = valueOf(code, key);

      expect({ code, key, isText: typeof value === "string" }).toEqual({
        code,
        key,
        isText: true,
      });
      expect({
        code,
        key,
        english: value === key && !sameAsEnglish.includes(key),
      }).toEqual({ code, key, english: false });
    }

    expect(
      placeholdersOf(valueOf(code, "Last seen {{time}}") as string),
    ).toEqual(["time"]);
  });

  test("German reads the line whole, either way", () => {
    const german: Translator = translatorFor("de");

    expect(
      german.translateTemplate("Last seen {{time}}", { time: "vor 5 Minuten" }),
    ).toBe("Zuletzt gesehen vor 5 Minuten");
    expect(german.translateText("Never seen")).toBe("Nie gesehen");
  });
});

describe("the keys no code used any more", () => {
  const RETIRED: ReadonlyArray<string> = [
    // Home's old list error.
    "This list could not be loaded. Use Refresh above to try again.",
    // An old bulk action's title.
    "Set Priority: {{priority}}",
    // The Delete case sentence before playbook runs were deleted with it.
    "{{case}} and its detections, notes and timeline are deleted for good. To keep the record, close it with a verdict instead.",
  ];

  test.each(["en", ...LANGUAGES])("are gone from %s", (code: string) => {
    const locale: Locale = readLocale(code);

    for (const key of RETIRED) {
      expect({
        key,
        held: Object.prototype.hasOwnProperty.call(locale, key),
      }).toEqual({ key, held: false });
    }
  });

  test("the Delete case page says the sentence that replaced it", () => {
    expect(
      valueOf(
        "en",
        "{{case}} and its detections, notes, timeline and playbook runs are deleted for good. To keep the record, close it with a verdict instead.",
      ),
    ).toBeDefined();
  });
});
