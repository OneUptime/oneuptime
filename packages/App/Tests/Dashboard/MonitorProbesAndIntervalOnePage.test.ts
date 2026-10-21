import ProbesAndIntervalCopy, {
  PROBE_AGREEMENT_SENTENCE,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/ProbesAndIntervalCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A monitor's probes, its interval and how many of its probes must agree
 * before its status changes are set on one page: Probes & Interval
 * (MONITOR_VIEW_PROBES), as Create Monitor asks for them on one step.
 *
 * They were three places: an Interval page holding one card whose Edit
 * dialog held one dropdown, offering every interval to every type; the
 * Probes page with the table; and a "Probe Agreement Settings" card on the
 * monitor's Settings page.
 *
 * This checks the page holds the three cards in that order, that no other
 * monitor page edits the interval or the agreement again, that every form
 * asking for an interval takes the one per-type list, that the Interval
 * page is gone with its URL kept as a redirect (and the menu, the route
 * table and the breadcrumbs agree), and that the new strings are translated
 * in all seventeen Dashboard locales.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MONITOR_VIEW_DIR: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Monitor",
  "View",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
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

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function readDashboard(file: string): string {
  return readSource(path.join(DASHBOARD_SRC, file));
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "Locales") {
        continue;
      }

      found.push(...listSources(full));
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ALL_SOURCES: Array<string> = listSources(DASHBOARD_SRC);

// The raw list imported as it is, rather than one of the helpers.
const IMPORTS_THE_LIST: RegExp =
  /import MonitoringInterval[\s,][^;]*MonitorIntervalDropdownOptions/;

// The old page's path segment, as a route would spell it.
const NAMES_THE_INTERVAL_PATH: RegExp = /["'`/]interval["'`]/;

describe("the Probes & Interval page", () => {
  const page: string = readDashboard("Pages/Monitor/View/Probes.tsx");

  test("is the interval, then the probes, then how many of them must agree", () => {
    const interval: number = page.indexOf("<MonitoringIntervalCard");
    const table: number = page.indexOf("{getProbesTable()}");
    const agreement: number = page.indexOf("<ProbeAgreementCard");

    expect(interval).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(interval);
    expect(agreement).toBeGreaterThan(table);

    // The table is the one it always was: the same name, saved filters and rows.
    expect(page).toContain('name="Monitor > Monitor Probes"');
    expect(page).toContain("<ModelTable<MonitorProbe>");
    expect(page).toContain('userPreferencesKey="monitor-probes-table"');
  });

  test("reads what its cards start from with the monitor's type, in one read", () => {
    expect(page).toContain(
      "select: { monitorType: true, monitoringInterval: true, minimumProbeAgreement: true, },",
    );
    expect(page).toContain("initialInterval={monitor.monitoringInterval}");
    expect(page).toContain("initialValue={monitor.minimumProbeAgreement}");
  });

  test("reads again for another monitor, since the page stays mounted when the reader moves to one", () => {
    expect(page).toContain("}, [modelIdString]);");
    expect(page).toContain("if (read !== readRef.current) { return; }");
    expect(page).toContain("key={`interval-${modelIdString}`}");
    expect(page).toContain("key={`agreement-${modelIdString}`}");
  });

  test("is only for a monitor that probes check: any other is told why it has neither", () => {
    expect(page).toContain(
      "if (!MonitorTypeHelper.isProbableMonitor(monitorType)) {",
    );
    expect(page).toContain("ProbesAndIntervalCopy.manualMonitorTitle");
    expect(page).toContain("ProbesAndIntervalCopy.notCheckedByProbesTitle");
  });

  test("shows why a monitor could not be read instead of loading for good", () => {
    expect(page.indexOf("if (error) {")).toBeGreaterThan(-1);
    expect(page.indexOf("if (error) {")).toBeLessThan(
      page.indexOf("<ComponentLoader />"),
    );
  });

  test("keeps the banner of a monitor that is not being checked", () => {
    expect(page).toContain("<DisabledWarning monitorId={modelId} />");
  });
});

describe("the Monitoring Interval card", () => {
  const card: string = readDashboard(
    "Components/Monitor/MonitoringIntervalCard.tsx",
  );

  test("offers what Create offers the type, and the interval the monitor has", () => {
    expect(card).toContain(
      "getMonitoringIntervalOptions({ monitorType: props.monitorType, currentInterval: savedValue, })",
    );
  });

  test("saves the interval alone, the moment it is picked, with no Edit dialog", () => {
    expect(card).toContain(
      "await ModelAPI.updateById<Monitor>({ modelType: Monitor, id: props.monitorId, data: { monitoringInterval: interval, }, });",
    );
    expect(card).not.toContain("CardModelDetail");
    expect(card).not.toContain("ModelForm");
    expect(card).toContain("isClearable={false}");
  });

  test("is locked only for someone who may not change the interval, never while it saves", () => {
    expect(card).toContain(
      'PermissionGate.checkColumnUpdate( monitor, "monitoringInterval", );',
    );
    // Read on every render: permissions arrive after a fresh sign-in's first paint.
    expect(card).not.toMatch(/useMemo\(\(\): PermissionGateResult/);
    expect(card).toContain("disabled={!updateGate.isAllowed}");
    expect(card).toContain("<SaveStatus");
  });
});

describe("the Probe Agreement card", () => {
  const card: string = readDashboard(
    "Components/Monitor/ProbeAgreementCard.tsx",
  );

  test("is one sentence with the number typed into it", () => {
    expect(card).toContain("template={PROBE_AGREEMENT_SENTENCE}");
    expect(card).toContain("type={InputType.NUMBER}");
    expect(card).toContain(
      "placeholder={ProbesAndIntervalCopy.agreementBoxPlaceholder}",
    );
    expect(PROBE_AGREEMENT_SENTENCE.other).toContain("{{count}}");
    expect(PROBE_AGREEMENT_SENTENCE.one).toContain("{{count}}");
  });

  test("saves the number alone, null for all probes, when the box is left or Enter is pressed", () => {
    expect(card).toContain(
      "await ModelAPI.updateById<Monitor>({ modelType: Monitor, id: props.monitorId, data: { minimumProbeAgreement: parsed.value, }, });",
    );
    expect(card).toContain("onEnterPress={(): void => { void save(); }}");
    expect(card).toContain("onBlur={(): void => { void save(); }}");
    expect(card).not.toContain("CardModelDetail");
  });

  test("is locked for someone who may not change it", () => {
    expect(card).toContain(
      'PermissionGate.checkColumnUpdate( monitor, "minimumProbeAgreement", );',
    );
    expect(card).not.toMatch(/useMemo\(\(\): PermissionGateResult/);
  });
});

describe("one place for each setting", () => {
  test("no other monitor page asks for the interval or the probe agreement", () => {
    const asking: Array<string> = listSources(MONITOR_VIEW_DIR)
      .filter((file: string): boolean => {
        const source: string = readSource(file);

        return (
          source.includes("field: { monitoringInterval: true") ||
          source.includes("field: { minimumProbeAgreement: true") ||
          source.includes("<MonitoringIntervalCard") ||
          source.includes("<ProbeAgreementCard")
        );
      })
      .map(relative);

    expect(asking).toEqual(["Pages/Monitor/View/Probes.tsx"]);
  });

  test("Settings has no probe agreement card left", () => {
    const settings: string = readDashboard("Pages/Monitor/View/Settings.tsx");

    expect(settings).not.toContain("minimumProbeAgreement");
    expect(settings).not.toContain("Probe Agreement");
    expect(settings).not.toContain("alertRefreshToggle");
    expect(settings).toContain("<DisabledWarning monitorId={modelId} />");
  });

  test("every form that asks for an interval takes the one per-type list", () => {
    const intervalForms: Array<string> = ALL_SOURCES.filter(
      (file: string): boolean => {
        const source: string = readSource(file);

        return (
          source.includes("field: { monitoringInterval: true, },") &&
          source.includes("fieldType: FormFieldSchemaType.Dropdown")
        );
      },
    ).map(relative);

    expect(intervalForms.sort()).toEqual([
      "Pages/Monitor/Create.tsx",
      "Pages/Monitor/Settings/MonitorTemplates.tsx",
      "Pages/Monitor/Settings/MonitorTemplatesView.tsx",
    ]);

    for (const file of intervalForms) {
      const source: string = readDashboard(file);

      expect([file, source.includes("getMonitoringIntervalOptions({")]).toEqual(
        [file, true],
      );
      expect([file, source.includes("...MonitoringInterval")]).toEqual([
        file,
        false,
      ]);
    }
  });

  test("a new monitor is offered only what its type is offered; a template's dialog keeps the template's own interval", () => {
    const create: string = readDashboard("Pages/Monitor/Create.tsx");
    const templateCreate: string = readDashboard(
      "Pages/Monitor/Settings/MonitorTemplates.tsx",
    );
    const templateView: string = readDashboard(
      "Pages/Monitor/Settings/MonitorTemplatesView.tsx",
    );

    for (const source of [create, templateCreate]) {
      const call: string = source.slice(
        source.indexOf("getMonitoringIntervalOptions({"),
        source.indexOf("})", source.indexOf("getMonitoringIntervalOptions({")),
      );

      expect(call).not.toContain("currentInterval");
    }

    expect(templateView).toContain(
      "getMonitoringIntervalOptions({ monitorType: monitorType, currentInterval: item?.monitoringInterval as | string | undefined, })",
    );
  });

  test("no file keeps a copy of the per-type filter, or of the list", () => {
    const filtering: Array<string> = ALL_SOURCES.filter(
      (file: string): boolean => {
        return readSource(file).includes('"*/2 * * * *"');
      },
    ).map(relative);

    expect(filtering).toEqual(["Utils/MonitorIntervalDropdownOptions.ts"]);

    const importingTheList: Array<string> = ALL_SOURCES.filter(
      (file: string): boolean => {
        return IMPORTS_THE_LIST.test(readSource(file));
      },
    ).map(relative);

    expect(importingTheList).toEqual([]);
  });

  test("a template shows its interval in words, not as the cron it is stored as", () => {
    const templateView: string = readDashboard(
      "Pages/Monitor/Settings/MonitorTemplatesView.tsx",
    );

    expect(templateView).toContain(
      "<MonitoringIntervalElement monitoringInterval={item.monitoringInterval} />",
    );
  });
});

describe("the old Interval page", () => {
  test("is gone, with no page key or route of its own", () => {
    expect(fs.existsSync(path.join(MONITOR_VIEW_DIR, "Interval.tsx"))).toBe(
      false,
    );

    for (const file of ["Utils/PageMap.ts", "Utils/RouteMap.ts"]) {
      const source: string = readDashboard(file);

      expect(source).not.toContain("MONITOR_VIEW_INTERVAL");
      expect(source).not.toContain("/interval`");
    }
  });

  test("its URL forwards to Probes & Interval, and only the monitor routes name it", () => {
    const routes: string = readDashboard("Routes/MonitorsRoutes.tsx");

    expect(routes).toContain(
      'export const MOVED_MONITOR_INTERVAL_PATH: string = "interval";',
    );
    expect(routes).toContain(
      "<PageRoute path={MOVED_MONITOR_INTERVAL_PATH} element={<MovedPageRedirect pageMap={PageMap.MONITOR_VIEW_PROBES} />} />",
    );
    expect(routes).not.toContain("View/Interval");

    const naming: Array<string> = ALL_SOURCES.filter(
      (file: string): boolean => {
        return NAMES_THE_INTERVAL_PATH.test(readSource(file));
      },
    ).map(relative);

    expect(naming).toEqual(["Routes/MonitorsRoutes.tsx"]);
  });

  test("the menu has one entry for the page, only for a monitor that probes check", () => {
    const menu: string = readDashboard("Pages/Monitor/View/SideMenu.tsx");

    expect(menu).toContain(
      'if (isProbeableMonitor) { configurationItems.push({ link: { title: "Probes & Interval", to: RouteUtil.populateRouteParams( RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route, { modelId: props.modelId }, ), }, icon: IconProp.Signal, }); }',
    );
    expect(menu).not.toContain('title: "Interval"');
    expect(menu).not.toContain('title: "Probes",');
  });

  test("the page's breadcrumb is its name", () => {
    const breadcrumbs: string = readDashboard(
      "Utils/Breadcrumbs/MonitorBreadcrumbs.ts",
    );

    expect(breadcrumbs).toContain(
      '...BuildBreadcrumbLinksByTitles(PageMap.MONITOR_VIEW_PROBES, [ "Project", "Monitors", "View Monitor", "Probes & Interval", ]),',
    );
    expect(breadcrumbs).not.toContain('"Interval"');
  });
});

describe("translations", () => {
  const sentences: Array<string> = [
    ProbesAndIntervalCopy.pageTitle,
    ProbesAndIntervalCopy.intervalCardDescription,
    ProbesAndIntervalCopy.agreementCardTitle,
    ProbesAndIntervalCopy.agreementCardDescription,
    ProbesAndIntervalCopy.agreementBoxLabel,
    ProbesAndIntervalCopy.agreementBoxPlaceholder,
    ProbesAndIntervalCopy.agreementNote,
    ProbesAndIntervalCopy.agreementInvalid,
    ProbesAndIntervalCopy.manualMonitorTitle,
    ProbesAndIntervalCopy.manualMonitorDescription,
    ProbesAndIntervalCopy.notCheckedByProbesTitle,
    ProbesAndIntervalCopy.notCheckedByProbesDescription,
    PROBE_AGREEMENT_SENTENCE.other,
  ];

  // Strings every locale already had.
  const names: Array<string> = [
    ProbesAndIntervalCopy.intervalCardTitle,
    ProbesAndIntervalCopy.intervalLabel,
    ProbesAndIntervalCopy.intervalPlaceholder,
    ProbesAndIntervalCopy.saving,
    ProbesAndIntervalCopy.saved,
  ];

  test("en.json maps every string to itself, and the sentence's one form", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...sentences, ...names]) {
      expect([text, english[text]]).toEqual([text, text]);
    }

    expect(english[`${PROBE_AGREEMENT_SENTENCE.other}_one`]).toBe(
      PROBE_AGREEMENT_SENTENCE.one,
    );
  });

  test("the retired cards' strings are gone from en.json", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [
      "Probe Agreement Settings",
      "Edit Probe Agreement",
      "Edit Monitoring Interval",
      "Here is how often we will check your monitor status.",
      "No Monitoring Interval for Manual Monitors",
    ]) {
      expect([text, english[text]]).toEqual([text, undefined]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every new string",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of names) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }

      for (const text of sentences) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      // The sentence the box is typed into keeps its box, in both forms.
      for (const key of [
        PROBE_AGREEMENT_SENTENCE.other,
        `${PROBE_AGREEMENT_SENTENCE.other}_one`,
      ]) {
        expect([key, translations[key]]).toEqual([
          key,
          expect.stringContaining("{{count}}"),
        ]);
      }
    },
  );
});
