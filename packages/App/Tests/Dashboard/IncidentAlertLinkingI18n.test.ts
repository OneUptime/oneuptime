import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { getFeedEventTypeLabel } from "Common/UI/Components/Feed/FeedOptions";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Linking alerts to incidents added pages, a bulk dialog, create-page banners,
 * a settings card and four feed event labels to the dashboard. Every one of
 * those strings reaches the screen through a component that looks it up in
 * the Dashboard locale files by its English text (SideMenuItem, Breadcrumbs,
 * Card, Modal, ConfirmModal, ErrorMessage, FormField, Dropdown, TableHeader,
 * Detail, the Alert banner, the feed's event-type checklist). A string with
 * no entry silently stays English, so this pins both halves:
 *
 *   - the source still renders exactly these strings (a reworded string
 *     would leave its translations orphaned and the new wording untranslated);
 *   - en.json maps each to itself, and all sixteen other locales carry a real,
 *     non-empty translation in the same place in the file.
 *
 * Strings built at runtime from variables (the 50-alert cap tooltips, the
 * bulk delete confirmation that appends a warning, "Alert #42" references,
 * permission messages) cannot be looked up by their English text and are
 * deliberately not listed here.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const INCIDENT_SIDE_MENU: string = "Pages/Incidents/View/SideMenu.tsx";
const ALERT_SIDE_MENU: string = "Pages/Alerts/View/SideMenu.tsx";
const INCIDENT_BREADCRUMBS: string = "Utils/Breadcrumbs/IncidentBreadcrumbs.ts";
const ALERT_BREADCRUMBS: string = "Utils/Breadcrumbs/AlertBreadcrumbs.ts";
const INCIDENT_PAGE: string = "Pages/Incidents/View/Alerts.tsx";
const ALERT_PAGE: string = "Pages/Alerts/View/Incidents.tsx";
const BULK_HOOK: string = "Components/Alert/BulkIncidentLinkActions.tsx";
const CREATE_PAGE: string = "Pages/Incidents/Create.tsx";
const SETTINGS_PAGE: string =
  "Pages/Incidents/Settings/IncidentMoreSettings.tsx";

interface SourceString {
  text: string;
  // Dashboard files that must still contain the string as a "literal".
  sources: Array<string>;
}

/*
 * Every new string the feature hands to a translating component, with the
 * files that render it. In UI order: menus and breadcrumbs, the two linked
 * pages, the alerts-table dialog, the create page, the settings card.
 */
const SOURCE_STRINGS: Array<SourceString> = [
  {
    text: "Linked Alerts",
    sources: [
      INCIDENT_SIDE_MENU,
      INCIDENT_BREADCRUMBS,
      INCIDENT_PAGE,
      SETTINGS_PAGE,
    ],
  },
  {
    text: "Linked Incidents",
    sources: [ALERT_SIDE_MENU, ALERT_BREADCRUMBS, ALERT_PAGE],
  },
  { text: "Linked By", sources: [INCIDENT_PAGE, ALERT_PAGE] },

  // Incident > Linked Alerts
  {
    text: "Alerts linked to this incident. Link the alerts this incident is responding to so the whole response is tracked in one place.",
    sources: [INCIDENT_PAGE],
  },
  { text: "No alerts are linked to this incident.", sources: [INCIDENT_PAGE] },
  {
    text: "Select an alert to link to this incident.",
    sources: [INCIDENT_PAGE],
  },
  { text: "Select an alert", sources: [INCIDENT_PAGE] },
  { text: "Unlink Alert", sources: [INCIDENT_PAGE] },
  {
    text: "Unlink this alert from the incident? The alert itself is not deleted, and it stays linked to any other incidents.",
    sources: [INCIDENT_PAGE],
  },

  // Alert > Linked Incidents
  {
    text: "Incidents this alert is linked to. Link the alert to an incident that is already open, or declare a new incident from it.",
    sources: [ALERT_PAGE],
  },
  {
    text: "This alert is not linked to any incidents.",
    sources: [ALERT_PAGE],
  },
  {
    text: "Select an incident to link this alert to.",
    sources: [ALERT_PAGE],
  },
  { text: "Select an incident", sources: [ALERT_PAGE, BULK_HOOK] },
  { text: "Unlink Incident", sources: [ALERT_PAGE] },
  {
    text: "Unlink this alert from the incident? The incident itself is not deleted, and the alert stays linked to any other incidents.",
    sources: [ALERT_PAGE],
  },

  // Alerts table > Link to Incident dialog
  { text: "Link to Incident", sources: [BULK_HOOK] },
  {
    text: "Link the selected alerts to an incident that is already open. Alerts that are already linked to it are left as they are.",
    sources: [BULK_HOOK],
  },
  { text: "Link Alerts", sources: [BULK_HOOK] },
  {
    text: "Recent incidents are listed with their number. Type to search every incident by title.",
    sources: [BULK_HOOK],
  },

  // Incidents > Create, declared from alerts
  { text: "Declaring this incident from alerts", sources: [CREATE_PAGE] },
  { text: "The alerts could not be found", sources: [CREATE_PAGE] },
  {
    text: "None of the alerts this incident was being declared from could be found, so none will be linked. They may have been deleted, or you may not have access to them.",
    sources: [CREATE_PAGE],
  },

  // Incidents > Settings > More Settings > Linked Alerts
  {
    text: "Choose whether the alerts linked to an incident follow it when the incident is acknowledged or resolved. Both are off by default. Alerts are never moved back to an earlier state, and reopening an incident does not reopen its alerts.",
    sources: [SETTINGS_PAGE],
  },
  {
    text: "Acknowledge Linked Alerts When Incident Is Acknowledged",
    sources: [SETTINGS_PAGE],
  },
  {
    text: "When the incident is acknowledged, acknowledge every alert linked to it. This stops those alerts' on-call escalations and reminders. Alerts linked to an incident that is already acknowledged are acknowledged as they are linked.",
    sources: [SETTINGS_PAGE],
  },
  {
    text: "Resolve Linked Alerts When Incident Is Resolved",
    sources: [SETTINGS_PAGE],
  },
  {
    text: "When the incident is resolved, resolve every alert linked to it - except alerts that are still linked to another incident that is not resolved yet. Alerts linked to an incident that is already resolved are resolved as they are linked.",
    sources: [SETTINGS_PAGE],
  },
];

interface ComposedString {
  text: string;
  page: string;
  singularName: string;
  form: "modalTitle" | "submitButton";
}

/*
 * ModelTable builds its create modal's title and submit button from the
 * page's createVerb and singularName, and Modal looks the whole result up.
 * Both pages pass createVerb "Link", so these four are fixed per page.
 */
const COMPOSED_STRINGS: Array<ComposedString> = [
  {
    text: "Link New Alert",
    page: INCIDENT_PAGE,
    singularName: "Alert",
    form: "modalTitle",
  },
  {
    text: "Link Alert",
    page: INCIDENT_PAGE,
    singularName: "Alert",
    form: "submitButton",
  },
  {
    text: "Link New Incident",
    page: ALERT_PAGE,
    singularName: "Incident",
    form: "modalTitle",
  },
  {
    text: "Link Incident",
    page: ALERT_PAGE,
    singularName: "Incident",
    form: "submitButton",
  },
];

interface FeedLabel {
  text: string;
  eventType: string;
}

const FEED_LABELS: Array<FeedLabel> = [
  {
    text: "Linked to Incident",
    eventType: AlertFeedEventType.LinkedToIncident,
  },
  {
    text: "Unlinked from Incident",
    eventType: AlertFeedEventType.UnlinkedFromIncident,
  },
  { text: "Alert Linked", eventType: IncidentFeedEventType.AlertLinked },
  { text: "Alert Unlinked", eventType: IncidentFeedEventType.AlertUnlinked },
];

// Every key this feature added to the locale files.
const NEW_KEYS: Array<string> = [
  ...SOURCE_STRINGS.map((entry: SourceString): string => {
    return entry.text;
  }),
  ...COMPOSED_STRINGS.map((entry: ComposedString): string => {
    return entry.text;
  }),
  ...FEED_LABELS.map((entry: FeedLabel): string => {
    return entry.text;
  }),
];

/*
 * Strings the feature renders that were already in every locale. Pinned so
 * a cleanup of "unused" keys cannot take one of them away from these pages.
 */
const REUSED_KEYS: Array<string> = [
  "Link",
  "Unlink",
  "Alert",
  "Alerts",
  "Incident",
  "Incidents",
  "Alert #",
  "Incident #",
  "Title",
  "Current State",
  "Linked At",
  "View Alert",
  "View Incident",
  "Declare Incident",
  "Update",
];

// What a sentence may end with, per script.
const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

// Comments removed (they may quote copy), whitespace squashed.
function readCode(relativePath: string): string {
  return readRaw(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function readCommon(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(COMMON_ROOT, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
}

/*
 * The source from `start` to `end` (or to the end of the file). Throws
 * rather than returning empty: a marker that moved would otherwise let the
 * guard below pass vacuously.
 */
function sectionFrom(source: string, start: string, end?: string): string {
  const startsAt: number = source.indexOf(start);

  if (startsAt < 0) {
    throw new Error(`Expected to find ${start}`);
  }

  if (!end) {
    return source.slice(startsAt);
  }

  const endsAt: number = source.indexOf(end, startsAt + start.length);

  if (endsAt < 0) {
    throw new Error(`Expected to find ${end} after ${start}`);
  }

  return source.slice(startsAt, endsAt);
}

/*
 * Literal values of the props the translating components look up: card,
 * modal, confirmation, form-field and column titles, descriptions,
 * placeholders, banner titles, empty-table messages and button texts, in
 * both the `prop: "…"` and the JSX `prop="…"` spelling.
 */
function translatedPropLiterals(code: string): Array<string> {
  const literals: Array<string> = [];
  const pattern: RegExp =
    /\b(?:title|description|placeholder|noItemsMessage|strongTitle|submitButtonText|deleteButtonText|editButtonText|createVerb|singularName|pluralName)\s*[:=]\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null = pattern.exec(code);

  while (match !== null) {
    literals.push(JSON.parse(`"${match[1] as string}"`) as string);
    match = pattern.exec(code);
  }

  return literals;
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set<string>(values)).sort();
}

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

const nonEnglishLocaleFiles: Array<string> = localeFiles.filter(
  (file: string): boolean => {
    return file !== "en.json";
  },
);

const english: Record<string, unknown> = readLocale("en.json");
const englishKeys: Array<string> = Object.keys(english);

// The keys on either side of `key` in a locale file, in file order.
function neighboursOf(
  keys: Array<string>,
  key: string,
): { before: string | undefined; after: string | undefined } {
  const index: number = keys.indexOf(key);

  return {
    before: index > 0 ? keys[index - 1] : undefined,
    after: index >= 0 ? keys[index + 1] : undefined,
  };
}

describe("Linking alerts to incidents: Dashboard translations", () => {
  test("the lists are well formed", () => {
    expect(new Set<string>(NEW_KEYS).size).toBe(NEW_KEYS.length);
    expect(NEW_KEYS.length).toBe(35);

    for (const key of REUSED_KEYS) {
      expect(NEW_KEYS).not.toContain(key);
    }

    // Exactly 17 Dashboard locales: English and the sixteen translations.
    expect(localeFiles.length).toBe(17);
  });

  test("every listed string is still rendered by the file that shows it", () => {
    const missing: Array<string> = [];

    for (const entry of SOURCE_STRINGS) {
      for (const source of entry.sources) {
        if (!readRaw(source).includes(`"${entry.text}"`)) {
          missing.push(`${source}: ${entry.text}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("the create modal's title and button are built from the page's createVerb and singularName", () => {
    const modelTable: string = readCommon(
      "UI",
      "Components",
      "ModelTable",
      "ModelTable.tsx",
    );

    // The two templates ModelTable renders, whose result Modal translates.
    expect(modelTable).toContain(
      '`${props.createVerb || "Create"} New ${ props.singularName || model.singularName }`',
    );
    expect(modelTable).toContain(
      '`${props.createVerb || "Create"} ${ props.singularName || model.singularName }`',
    );

    for (const entry of COMPOSED_STRINGS) {
      const page: string = readCode(entry.page);

      expect(page).toContain('createVerb="Link"');
      expect(page).toContain(`singularName="${entry.singularName}"`);

      const rendered: string =
        entry.form === "modalTitle"
          ? `Link New ${entry.singularName}`
          : `Link ${entry.singularName}`;

      expect(rendered).toBe(entry.text);
    }
  });

  test("the four feed event labels are exactly what the feed checklist shows", () => {
    for (const label of FEED_LABELS) {
      expect(getFeedEventTypeLabel(label.eventType)).toBe(label.text);
    }
  });

  /*
   * The guard against a new string skipping translation: every literal these
   * files hand to a translating prop - in the two new pages and the bulk
   * hook, the create page's two banners and the settings card - must be a
   * key in en.json. Only fully new code is walked; the rest of the create
   * and settings pages predates the feature.
   */
  test("every literal the feature hands to a translating prop is in en.json", () => {
    const createPage: string = readCode(CREATE_PAGE);
    const settingsPage: string = readCode(SETTINGS_PAGE);

    const walked: Array<string> = unique([
      ...translatedPropLiterals(readCode(INCIDENT_PAGE)),
      ...translatedPropLiterals(readCode(ALERT_PAGE)),
      ...translatedPropLiterals(readCode(BULK_HOOK)),
      ...translatedPropLiterals(
        sectionFrom(
          createPage,
          'dataTestId="incident-create-alerts-to-link"',
          "<ModelForm<Incident>",
        ),
      ),
      ...translatedPropLiterals(
        sectionFrom(settingsPage, 'name="Linked Alerts"'),
      ),
    ]);

    // Sanity: the walker really reaches every surface.
    expect(walked).toEqual(
      expect.arrayContaining([
        "Unlink Alert",
        "Declare Incident",
        "Link to Incident",
        "The alerts could not be found",
        "Resolve Linked Alerts When Incident Is Resolved",
      ]),
    );

    const untranslated: Array<string> = walked.filter(
      (text: string): boolean => {
        return english[text] !== text;
      },
    );

    expect(untranslated).toEqual([]);
  });

  test("en.json maps every new and reused string to itself", () => {
    const missing: Array<string> = [...NEW_KEYS, ...REUSED_KEYS].filter(
      (key: string): boolean => {
        return english[key] !== key;
      },
    );

    expect(missing).toEqual([]);
  });

  test.each(nonEnglishLocaleFiles)(
    "%s translates every new string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const problems: Array<string> = [];

      for (const key of [...NEW_KEYS, ...REUSED_KEYS]) {
        const value: unknown = locale[key];

        if (typeof value !== "string" || value.trim().length === 0) {
          problems.push(`missing: ${key}`);
          continue;
        }

        if (value.includes("{{") || value.includes("}}")) {
          problems.push(`stray placeholder: ${key}`);
        }
      }

      /*
       * None of the new strings is a brand or loanword, so a value identical
       * to English is a copy someone forgot to translate.
       */
      for (const key of NEW_KEYS) {
        if (locale[key] === key) {
          problems.push(`left in English: ${key}`);
        }
      }

      expect(problems).toEqual([]);
    },
  );

  /*
   * Sentences stay sentences and labels stay labels: a description that lost
   * its full stop, or a button that gained one, reads as a slip.
   */
  test.each(nonEnglishLocaleFiles)(
    "%s keeps sentence endings as English has them",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const problems: Array<string> = [];

      for (const key of NEW_KEYS) {
        const value: string = String(locale[key] || "").trim();
        const isSentence: boolean = key.endsWith(".");
        const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
          (ending: string): boolean => {
            return value.endsWith(ending);
          },
        );

        if (isSentence !== endsLikeSentence) {
          problems.push(key);
        }
      }

      expect(problems).toEqual([]);
    },
  );

  /*
   * Every locale file keeps en.json's key order. New keys sit next to the
   * same neighbours everywhere, so each file's diff for the feature lines up.
   */
  test.each(nonEnglishLocaleFiles)(
    "%s places every new key between the same neighbours as en.json",
    (file: string) => {
      const keys: Array<string> = Object.keys(readLocale(file));
      const misplaced: Array<string> = NEW_KEYS.filter(
        (key: string): boolean => {
          return (
            JSON.stringify(neighboursOf(keys, key)) !==
            JSON.stringify(neighboursOf(englishKeys, key))
          );
        },
      );

      expect(misplaced).toEqual([]);
    },
  );

  /*
   * The feed labels live in the alphabetical event-label block and the
   * "Linked …" labels in the alphabetical "Linked …" run, so a sorted
   * neighbourhood stays sorted.
   */
  test("the sorted blocks the new keys joined stay sorted in en.json", () => {
    const run: (from: string, to: string) => Array<string> = (
      from: string,
      to: string,
    ): Array<string> => {
      return englishKeys.slice(
        englishKeys.indexOf(from),
        englishKeys.indexOf(to) + 1,
      );
    };

    const linkedRun: Array<string> = run("Linked Alerts", "Linked Resources");
    expect(linkedRun).toEqual([
      "Linked Alerts",
      "Linked At",
      "Linked By",
      "Linked Incidents",
      "Linked Monitors",
      "Linked Resources",
    ]);

    const eventLabels: Array<string> = run(
      "Added to Episode",
      "VMware vCenter Updated",
    );

    for (const label of FEED_LABELS) {
      expect(eventLabels).toContain(label.text);
    }

    expect(eventLabels).toEqual([...eventLabels].sort());
  });

  test("the components that show these strings look them up by their English text", () => {
    const expectations: Array<[Array<string>, string]> = [
      [
        ["UI", "Components", "SideMenu", "SideMenuItem.tsx"],
        "translateString(props.link.title)",
      ],
      [
        ["UI", "Components", "Breadcrumbs", "Breadcrumbs.tsx"],
        "translateString(link.title)",
      ],
      [
        ["UI", "Components", "Card", "Card.tsx"],
        "translateValue( props.title, )",
      ],
      [
        ["UI", "Components", "Card", "Card.tsx"],
        "translateValue(props.description)",
      ],
      [
        ["UI", "Components", "Modal", "Modal.tsx"],
        "translateString(props.title)",
      ],
      [
        ["UI", "Components", "Modal", "Modal.tsx"],
        "translateString( props.description, )",
      ],
      [
        ["UI", "Components", "Modal", "Modal.tsx"],
        "translateString( props.submitButtonText, )",
      ],
      [
        ["UI", "Components", "Modal", "ConfirmModal.tsx"],
        "translateValue(props.description)",
      ],
      [
        ["UI", "Components", "ErrorMessage", "ErrorMessage.tsx"],
        "translateValue(props.message)",
      ],
      [
        ["UI", "Components", "Alerts", "Alert.tsx"],
        "translateString( props.strongTitle, )",
      ],
      [
        ["UI", "Components", "Alerts", "Alert.tsx"],
        "translateValue( props.title, )",
      ],
      [
        ["UI", "Components", "Forms", "Fields", "FormField.tsx"],
        "translateString(props.field.title)",
      ],
      [
        ["UI", "Components", "Forms", "Fields", "FormField.tsx"],
        "translateValue(props.field.description)",
      ],
      [
        ["UI", "Components", "Forms", "Fields", "FormField.tsx"],
        "translateString( props.field.placeholder, )",
      ],
      [
        ["UI", "Components", "Table", "TableHeader.tsx"],
        "translateString(column.title)",
      ],
      [
        ["UI", "Components", "Dropdown", "Dropdown.tsx"],
        "tx(props.placeholder)",
      ],
      [
        ["UI", "Components", "Detail", "Detail.tsx"],
        "translateString(field.title)",
      ],
      [
        ["UI", "Components", "Feed", "FeedOptionsButton.tsx"],
        "translateString",
      ],
    ];

    const missing: Array<string> = expectations
      .filter(([relativePath, snippet]: [Array<string>, string]): boolean => {
        return !readCommon(...relativePath).includes(snippet);
      })
      .map(([relativePath, snippet]: [Array<string>, string]): string => {
        return `${relativePath.join("/")}: ${snippet}`;
      });

    expect(missing).toEqual([]);
  });
});
