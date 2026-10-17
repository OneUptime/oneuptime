import { PROBE_ON_NEW_MONITORS_COPY } from "../../FeatureSet/Dashboard/src/Components/Probe/ProbeOnNewMonitorsCopy";
import GlobalProbesOnNewMonitorsCopy from "../../FeatureSet/Dashboard/src/Components/Probe/GlobalProbesOnNewMonitorsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Whether new monitors start with a custom probe selected
 * (Probe.shouldAutoEnableProbeOnNewMonitors) had four names on one page and
 * the next: "Enable monitoring automatically on new monitors" on the create
 * and edit forms, "Enable Monitoring on New Monitors" on the probe's page,
 * and "Enable Monitoring by Default" as the list's column and filter - while
 * the switch beside them for OneUptime's own probes says "Add global probes
 * to new monitors". It is one name now, said the same way as that switch.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
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

const LIST_PAGE: string = "Pages/Monitor/Settings/MonitorProbes.tsx";
const PROBE_PAGE: string = "Pages/Monitor/Settings/MonitorProbeView.tsx";

const RETIRED_NAMES: Array<string> = [
  "Enable monitoring automatically on new monitors",
  "Enable Monitoring on New Monitors",
  "Enable Monitoring by Default",
  "When on, this probe is pre-selected for every new monitor you create.",
];

function readDashboard(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// Every source file under the Dashboard's src, but its locales.
function listSources(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales") {
        files.push(...listSources(full));
      }
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

describe("one name for adding a probe to new monitors", () => {
  test("said the way the global probes' switch says it", () => {
    expect(PROBE_ON_NEW_MONITORS_COPY.switchTitle).toBe("Add to new monitors");
    expect(PROBE_ON_NEW_MONITORS_COPY.columnTitle).toBe(
      "Added to New Monitors",
    );
    expect(PROBE_ON_NEW_MONITORS_COPY.description).toBe(
      "New monitors start with this probe selected.",
    );

    // The same verb and object as "Add global probes to new monitors".
    expect(GlobalProbesOnNewMonitorsCopy.switchTitle).toBe(
      "Add global probes to new monitors",
    );
    expect(
      GlobalProbesOnNewMonitorsCopy.switchTitle.endsWith(
        PROBE_ON_NEW_MONITORS_COPY.switchTitle.replace("Add ", ""),
      ),
    ).toBe(true);
  });

  test("the create form's switch and the list's column and filter use it", () => {
    const list: string = readDashboard(LIST_PAGE);

    expect(list).toContain("title: PROBE_ON_NEW_MONITORS_COPY.switchTitle,");
    expect(list).toContain(
      "description: PROBE_ON_NEW_MONITORS_COPY.description,",
    );
    // The filter and the column.
    expect(
      list.split("title: PROBE_ON_NEW_MONITORS_COPY.columnTitle,").length - 1,
    ).toBe(2);
  });

  test("the probe's page - its edit form and its field - uses it", () => {
    const page: string = readDashboard(PROBE_PAGE);

    expect(page).toContain("title: PROBE_ON_NEW_MONITORS_COPY.switchTitle,");
    expect(page).toContain("title: PROBE_ON_NEW_MONITORS_COPY.columnTitle,");
    expect(
      page.split("description: PROBE_ON_NEW_MONITORS_COPY.description,")
        .length - 1,
    ).toBe(2);
  });

  test("no Dashboard source says one of the old names", () => {
    for (const file of listSources(DASHBOARD_SRC)) {
      // The copy module's own comment tells the history of the names.
      if (file.endsWith("ProbeOnNewMonitorsCopy.ts")) {
        continue;
      }

      const text: string = fs.readFileSync(file, "utf8");

      for (const name of RETIRED_NAMES) {
        expect({ file, name, found: text.includes(name) }).toEqual({
          file,
          name,
          found: false,
        });
      }
    }
  });
});

describe("the probe pages say what each kind of probe is for", () => {
  test("the cards name what they check, in plain words", () => {
    const list: string = readDashboard(LIST_PAGE);

    expect(list).toContain(
      "OneUptime's probes around the world. They check what is reachable from the internet.",
    );
    expect(list).toContain(
      "Probes you install in your own network, to check what is behind your firewall.",
    );
    // The old line had a grammar slip ("resources that is").
    expect(list).not.toContain("internal resources that is behind");
  });

  test("Reset Probe Key says what a reset breaks, and how to mend it", () => {
    const page: string = readDashboard(PROBE_PAGE);

    expect(page).toContain('title={"Reset Probe Key"}');
    expect(page).toContain(
      "The old key stops working at once. Set the new one as PROBE_KEY and restart the probe.",
    );
    expect(page).not.toContain(
      "Secret is used to authenticate probe requests.",
    );
  });
});

describe("translations", () => {
  const words: Array<string> = [
    PROBE_ON_NEW_MONITORS_COPY.switchTitle,
    PROBE_ON_NEW_MONITORS_COPY.columnTitle,
    PROBE_ON_NEW_MONITORS_COPY.description,
    "OneUptime's probes around the world. They check what is reachable from the internet.",
    "Probes you install in your own network, to check what is behind your firewall.",
    "The old key stops working at once. Set the new one as PROBE_KEY and restart the probe.",
  ];

  test("en.json carries every word as itself", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const word of words) {
      expect(en[word]).toBe(word);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s.json translates every word",
    (locale: string) => {
      const json: Record<string, unknown> = readLocale(locale);

      for (const word of words) {
        expect(typeof json[word]).toBe("string");
        expect(json[word]).not.toBe(word);
      }
    },
  );
});
