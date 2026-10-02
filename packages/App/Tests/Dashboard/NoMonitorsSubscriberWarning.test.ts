import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Can we please remove this warning banner as well?"
 *
 * Under 'Notify Status Page Subscribers' on Declare Incident, the dashboard
 * showed an amber banner on every incident declared without a monitor: "No
 * status page subscribers will be notified: no monitors are attached.
 * Subscribers hear about an incident through the monitors their status pages
 * list." Most incidents have no monitor, and a project that does not use
 * status pages saw it every time.
 *
 * The "Will notify" summary under a "notify subscribers" checkbox now speaks
 * only when it has something to say: who will be notified, or that the
 * incident's status page scope keeps pages that list its monitors from
 * being told. Its two siblings that only repeated a box right beside it went
 * too: "'Notify Status Page Subscribers' is off" and "private incidents are
 * hidden from all status pages". The confirmation before a notification is
 * sent again still always says who it would reach, no one included.
 *
 * These rules keep it that way:
 *
 *   1. no source in the dashboards, Common's UI or ee carries the three
 *      notices, their copy keys or the prop that showed two of them, and no
 *      locale file of any frontend carries their text;
 *   2. every audience summary in the dashboard is one this test knows, and
 *      says whether it is under a checkbox (quiet when nobody is notified)
 *      or in a confirmation (always answers);
 *   3. Declare Incident asks nothing while notifying is off, the incident
 *      will be private, or neither a monitor nor a status page is picked;
 *      its summary step says Yes or No as every other box does, and offers
 *      the preview only when something can be sent;
 *   4. picking status pages without a monitor - what the banner caught that
 *      matters - is still warned about, under the picker.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const REPO_ROOT: string = path.join(PACKAGES, "..");
const FEATURE_SETS: string = path.join(PACKAGES, "App", "FeatureSet");
const DASHBOARD_SRC: string = path.join(FEATURE_SETS, "Dashboard", "src");

const SCAN_ROOTS: Array<string> = [
  DASHBOARD_SRC,
  path.join(FEATURE_SETS, "AdminDashboard", "src"),
  path.join(FEATURE_SETS, "StatusPage", "src"),
  path.join(FEATURE_SETS, "Accounts", "src"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "Common", "Types"),
  path.join(REPO_ROOT, "ee", "Dashboard"),
  path.join(REPO_ROOT, "ee", "AdminDashboard"),
];

// Every locale directory i18n:validate checks (Scripts/I18n/ValidateLocales.js).
const LOCALE_DIRS: Array<string> = [
  path.join(DASHBOARD_SRC, "Locales"),
  path.join(FEATURE_SETS, "AdminDashboard", "src", "Locales"),
  path.join(FEATURE_SETS, "StatusPage", "src", "Locales"),
  path.join(FEATURE_SETS, "Accounts", "src", "Locales"),
  path.join(FEATURE_SETS, "Docs", "Locales"),
  path.join(FEATURE_SETS, "APIReference", "Locales"),
];

// What the notices and the prop that showed two of them were called.
const REMOVED_NAMES: Array<string> = [
  "audienceNoMonitors",
  "audienceNotifyOff",
  "audiencePrivateIncident",
  "quietReason",
  "getAudienceQuietReason",
];

/*
 * Their English text. The notification preview dialog keeps reasons of its
 * own for "nothing would be sent" (SubscriberNotificationPreviewCopy): it is
 * opened on purpose, and answers what was asked. These are the summary's.
 */
const REMOVED_TEXT: Array<string> = [
  "No status page subscribers will be notified: no monitors are attached",
  "Status page subscribers will not be notified: 'Notify Status Page Subscribers' is off",
  "Nothing will be sent: private incidents are hidden from all status pages",
];

/*
 * Every audience summary in the dashboard: where it is, its test id, and
 * whether it always answers (a confirmation before sending again) or stays
 * quiet when nobody will be notified (under a "notify" checkbox).
 */
interface AudienceSummaryUse {
  page: string;
  dataTestId: string;
  isConfirmation: boolean;
}

const AUDIENCE_SUMMARIES: Array<AudienceSummaryUse> = [
  {
    page: "Pages/Incidents/Create.tsx",
    dataTestId: "incident-create-subscriber-audience",
    isConfirmation: false,
  },
  {
    page: "Pages/Incidents/View/PublicNote.tsx",
    dataTestId: "incident-public-note-audience",
    isConfirmation: false,
  },
  {
    page: "Pages/Incidents/View/PublicNote.tsx",
    dataTestId: "incident-public-note-resend-audience",
    isConfirmation: true,
  },
  {
    page: "Pages/Incidents/View/Index.tsx",
    dataTestId: "incident-created-resend-audience",
    isConfirmation: true,
  },
  {
    page: "Pages/Incidents/View/Index.tsx",
    dataTestId: "incident-created-retry-audience",
    isConfirmation: true,
  },
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Locales",
];

interface SourceFile {
  relativePath: string;
  source: string;
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

const SOURCES: Array<SourceFile> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
).map((fullPath: string): SourceFile => {
  return {
    relativePath: toPosix(path.relative(REPO_ROOT, fullPath)),
    source: fs.readFileSync(fullPath, "utf8"),
  };
});

function filesContaining(text: string): Array<string> {
  return SOURCES.filter((file: SourceFile): boolean => {
    return file.source.includes(text);
  }).map((file: SourceFile): string => {
    return file.relativePath;
  });
}

// A dashboard source with its whitespace collapsed, as the other wiring tests read them.
function readDashboardSource(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath.split("/")), "utf8")
    .replace(/\s+/g, " ");
}

interface LocaleFile {
  relativePath: string;
  entries: unknown;
}

const LOCALE_FILES: Array<LocaleFile> = LOCALE_DIRS.flatMap(
  (directory: string): Array<LocaleFile> => {
    if (!fs.existsSync(directory)) {
      return [];
    }

    return fs
      .readdirSync(directory)
      .filter((name: string): boolean => {
        return name.endsWith(".json");
      })
      .map((name: string): LocaleFile => {
        const fullPath: string = path.join(directory, name);

        return {
          relativePath: toPosix(path.relative(REPO_ROOT, fullPath)),
          entries: JSON.parse(fs.readFileSync(fullPath, "utf8")) as unknown,
        };
      });
  },
);

// Every string a locale file holds, keys and values, however deeply nested.
function allStrings(node: unknown): Array<string> {
  if (typeof node === "string") {
    return [node];
  }

  if (node && typeof node === "object" && !Array.isArray(node)) {
    return Object.entries(node as Record<string, unknown>).flatMap(
      ([key, value]: [string, unknown]): Array<string> => {
        return [key, ...allStrings(value)];
      },
    );
  }

  return [];
}

/*
 * The JSX element <SubscriberAudienceSummary ... /> that carries a test id,
 * from its opening "<" to its "/>", whitespace collapsed.
 */
function audienceSummaryElement(source: string, dataTestId: string): string {
  const marker: string = `dataTestId="${dataTestId}"`;
  const at: number = source.indexOf(marker);

  expect(at).toBeGreaterThan(-1);

  const start: number = source.lastIndexOf("<SubscriberAudienceSummary", at);
  const end: number = source.indexOf("/>", at);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(at);

  return source.slice(start, end + 2);
}

describe("the 'no monitors are attached' warning stays removed", () => {
  test("the scan covers the dashboards and the incident pages", () => {
    const paths: Array<string> = SOURCES.map((file: SourceFile): string => {
      return file.relativePath;
    });

    expect(paths.length).toBeGreaterThan(500);

    for (const page of [
      "Pages/Incidents/Create.tsx",
      "Pages/Incidents/View/PublicNote.tsx",
      "Pages/Incidents/View/Index.tsx",
      "Components/Incident/SubscriberAudienceSummary.tsx",
      "Components/Incident/SubscriberAudienceText.ts",
      "Components/Incident/IncidentStatusPageScopeCopy.ts",
    ]) {
      expect(paths).toContain(`packages/App/FeatureSet/Dashboard/src/${page}`);
    }
  });

  test.each(REMOVED_NAMES)("no source mentions %s", (name: string) => {
    expect(filesContaining(name)).toEqual([]);
  });

  test.each(REMOVED_TEXT)("no source shows %j", (text: string) => {
    expect(filesContaining(text)).toEqual([]);
  });

  test("the shared copy has none of them", () => {
    const keys: Array<string> = Object.keys(IncidentStatusPageScopeCopy);

    for (const name of REMOVED_NAMES) {
      expect(keys).not.toContain(name);
    }

    for (const text of Object.values(IncidentStatusPageScopeCopy)) {
      for (const removed of REMOVED_TEXT) {
        expect(text).not.toContain(removed);
      }

      expect(text).not.toMatch(/no monitors are attached/i);
    }
  });

  test("the locale files of every frontend are read", () => {
    const paths: Array<string> = LOCALE_FILES.map(
      (file: LocaleFile): string => {
        return file.relativePath;
      },
    );

    expect(
      paths.filter((relativePath: string): boolean => {
        return relativePath.startsWith(
          "packages/App/FeatureSet/Dashboard/src/Locales/",
        );
      }),
    ).toHaveLength(17);
    expect(paths.length).toBeGreaterThan(17);
  });

  test("no locale file carries their text", () => {
    const offenders: Array<string> = LOCALE_FILES.filter(
      (file: LocaleFile): boolean => {
        return allStrings(file.entries).some((value: string): boolean => {
          return REMOVED_TEXT.some((removed: string): boolean => {
            return value.includes(removed);
          });
        });
      },
    ).map((file: LocaleFile): string => {
      return file.relativePath;
    });

    expect(offenders).toEqual([]);
  });

  test("the notices that are kept are still in every Dashboard locale", () => {
    const dashboardLocales: Array<LocaleFile> = LOCALE_FILES.filter(
      (file: LocaleFile): boolean => {
        return file.relativePath.startsWith(
          "packages/App/FeatureSet/Dashboard/src/Locales/",
        );
      },
    );

    for (const file of dashboardLocales) {
      const entries: Record<string, unknown> = file.entries as Record<
        string,
        unknown
      >;

      for (const kept of [
        IncidentStatusPageScopeCopy.audienceNoStatusPages,
        IncidentStatusPageScopeCopy.audienceNoSubscribers,
        IncidentStatusPageScopeCopy.audienceHiddenIncident,
      ]) {
        expect({ file: file.relativePath, kept: kept, present: true }).toEqual({
          file: file.relativePath,
          kept: kept,
          present: typeof entries[kept] === "string",
        });
      }
    }
  });
});

describe("every audience summary says whether it is a form or a confirmation", () => {
  test("the dashboard has exactly the audience summaries this test knows", () => {
    const uses: Array<string> = SOURCES.filter((file: SourceFile): boolean => {
      return file.relativePath.startsWith(
        "packages/App/FeatureSet/Dashboard/src/",
      );
    }).flatMap((file: SourceFile): Array<string> => {
      const count: number =
        file.source.split("<SubscriberAudienceSummary").length - 1;

      return Array.from({ length: count }, (): string => {
        return file.relativePath.replace(
          "packages/App/FeatureSet/Dashboard/src/",
          "",
        );
      });
    });

    expect(uses.sort()).toEqual(
      AUDIENCE_SUMMARIES.map((use: AudienceSummaryUse): string => {
        return use.page;
      }).sort(),
    );
  });

  test.each(AUDIENCE_SUMMARIES)(
    "$page ($dataTestId)",
    (use: AudienceSummaryUse) => {
      const element: string = audienceSummaryElement(
        readDashboardSource(use.page),
        use.dataTestId,
      );

      if (use.isConfirmation) {
        expect(element).toContain("saysWhenNobodyIsNotified={true}");
      } else {
        expect(element).not.toContain("saysWhenNobodyIsNotified");
      }
    },
  );

  test("the summary itself has no quiet-reason banner left to show", () => {
    const source: string = readDashboardSource(
      "Components/Incident/SubscriberAudienceSummary.tsx",
    );

    expect(source).toContain("saysWhenNobodyIsNotified?: boolean | undefined;");
    expect(source).not.toContain('data-state="quiet"');
    expect(source).toContain(
      "saysWhenNobodyIsNotified: props.saysWhenNobodyIsNotified,",
    );
  });
});

describe("Declare Incident", () => {
  const source: string = readDashboardSource("Pages/Incidents/Create.tsx");

  test("asks who will be notified only when someone could be", () => {
    expect(source).toContain(
      "if (!isNotifyingSubscribers(values)) { return null; }",
    );
    expect(source).toContain(
      "if ( !hasMonitors(values) && getIdsFromFormValue(values.statusPages).length === 0 ) { return null; }",
    );
    expect(source).toContain("request={getAudienceRequest(values)}");
  });

  test("not notifying is the box unticked or the incident private", () => {
    expect(source).toContain(
      '(values as Record<string, unknown>)[ "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated" ] !== false',
    );
    expect(source).toContain(
      'isNotifyTicked(values) && (values as Record<string, unknown>)["isPrivate"] !== true',
    );
  });

  test("the summary step says Yes or No, then who, then the preview when something can be sent", () => {
    expect(source).toContain(
      'getSummaryElement: (item: FormValues<Incident>) => { return ( <> <BooleanValue value={isNotifyTicked(item)} dataTestId="incident-create-notify-subscribers-value" /> {getAudienceSummary(item)} {isNotifyingSubscribers(item) && hasMonitors(item) ? ( <SubscriberNotificationPreviewButton',
    );
    expect(source).toContain(
      'import BooleanValue from "Common/UI/Components/Detail/BooleanValue";',
    );
  });

  test("the box under the summary is still the one the maintainer saw", () => {
    expect(source).toContain(
      'title: "Notify Status Page Subscribers", stepId: "more", description: "Should status page subscribers be notified when this incident is created?", fieldType: FormFieldSchemaType.Checkbox, defaultValue: true,',
    );
  });
});

describe("picking status pages without a monitor is still caught, under the picker", () => {
  test("the picker warning asks whenever pages are picked, monitors or not", () => {
    const source: string = readDashboardSource(
      "Components/Incident/IncidentStatusPageScopeNotices.tsx",
    );

    expect(source).toContain(
      "const hasPickedPages: boolean = getIdsFromFormValue(props.statusPageIds).length > 0;",
    );
    expect(source).toContain(
      "useSubscriberAudience( hasPickedPages ? { monitorIds: props.monitorIds, statusPageIds: props.statusPageIds, } : null, );",
    );
    expect(source).not.toContain("hasBoth");
  });

  test("the incident's Settings tab waits for the incident before checking its monitors", () => {
    const source: string = readDashboardSource(
      "Pages/Incidents/View/Settings.tsx",
    );

    expect(source).toContain(
      "{scopeIncident ? ( <StatusPagesNotListingMonitorsWarning monitorIds={scopeIncident.monitors} statusPageIds={formValue} /> ) : ( <></> )}",
    );
  });

  test("the server names every picked page when the incident is on no monitor", () => {
    const source: string = fs
      .readFileSync(
        path.join(
          PACKAGES,
          "Common",
          "Server",
          "Utils",
          "StatusPage",
          "IncidentSubscriberAudienceBuilder.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(source).toContain(
      "const selectedNotListingMonitorIds: Array<string> = data.inputs.scopedStatusPageIds.filter((id: string): boolean => { return !reachedIds.includes(id); });",
    );
    expect(source).not.toContain("data.inputs.hasMonitors ?");
  });
});
