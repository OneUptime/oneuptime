import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FIRST_RECORD_POLL_INTERVAL_MS,
  FIRST_RUN_GUIDE_DESCRIPTION,
  getCountAfterCheck,
  getFirstRunEmptyState,
  getFirstRunTopContent,
  isWatchingForFirstRecord,
} from "../../FeatureSet/Dashboard/src/Components/Infrastructure/FirstRecordWatch";

/*
 * The first run of the fifteen infrastructure lists, held in the source.
 *
 * - One hook, useFirstRecordWatch, counts each list and - while it is
 *   empty - watches for the first record, then hands the table a new
 *   refreshToggle so the row shows without a reload. No page counts or
 *   polls on its own any more: six used to hide the guide while leaving
 *   the table empty, and nine never looked again.
 * - The guide under an empty table says one shared sentence of what to do;
 *   the table above already says "No X yet" and what the list is for.
 * - While a list waits for its first record its filter chips are put away:
 *   there is nothing to filter, and the guide is the one thing to do.
 * - A first count that failed can be tried again from the error (Refresh).
 * - The words it added are in every language, and the ones it retired are
 *   in none.
 *
 * App has no renderer: the React-free rules are called and the pages read
 * as text. Common's InfrastructureListFirstRun renders every page.
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

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Comments out, whitespace squashed: the code as prettier may wrap it.
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const LIST_PAGES: Array<string> = [
  "Pages/Host/Hosts.tsx",
  "Pages/Kubernetes/Clusters.tsx",
  "Pages/Docker/Hosts.tsx",
  "Pages/Podman/Hosts.tsx",
  "Pages/DockerSwarm/Clusters.tsx",
  "Pages/Proxmox/Clusters.tsx",
  "Pages/VMware/VCenters.tsx",
  "Pages/Ceph/Clusters.tsx",
  "Pages/StorageArray/StorageArrays.tsx",
  "Pages/IoT/Fleets.tsx",
  "Pages/Database/Databases.tsx",
  "Pages/MessageQueue/MessageQueues.tsx",
  "Pages/Serverless/ServerlessFunctions.tsx",
  "Pages/Cloud/CloudResources.tsx",
  "Pages/Cloud/MonitoredResources.tsx",
];

// The lists that draw filter chips over their table.
const LISTS_WITH_CHIPS: Array<string> = [
  "Pages/Host/Hosts.tsx",
  "Pages/Kubernetes/Clusters.tsx",
  "Pages/Docker/Hosts.tsx",
  "Pages/Podman/Hosts.tsx",
  "Pages/DockerSwarm/Clusters.tsx",
  "Pages/Proxmox/Clusters.tsx",
  "Pages/VMware/VCenters.tsx",
  "Pages/Ceph/Clusters.tsx",
  "Pages/StorageArray/StorageArrays.tsx",
  "Pages/IoT/Fleets.tsx",
  "Pages/Database/Databases.tsx",
  "Pages/MessageQueue/MessageQueues.tsx",
  "Pages/Serverless/ServerlessFunctions.tsx",
  "Pages/Cloud/CloudResources.tsx",
  "Pages/Cloud/MonitoredResources.tsx",
];

describe("the first-run rules", () => {
  test("only an empty list is watched", () => {
    expect(isWatchingForFirstRecord(0)).toBe(true);
    expect(isWatchingForFirstRecord(null)).toBe(false);
    expect(isWatchingForFirstRecord(1)).toBe(false);
  });

  test("a background check never takes a count back, and a failed one changes nothing", () => {
    expect(getCountAfterCheck({ current: 0, checked: 3 })).toBe(3);
    expect(getCountAfterCheck({ current: 0, checked: 0 })).toBe(0);
    expect(getCountAfterCheck({ current: 0, checked: null })).toBe(0);
    expect(getCountAfterCheck({ current: 2, checked: 0 })).toBe(2);
  });

  test("Create is hidden from an empty table only while the list is empty, and never where adding by hand connects", () => {
    expect(
      getFirstRunEmptyState({ emptyState: undefined, count: 0 })
        .hideCreateButton,
    ).toBe(true);
    expect(
      getFirstRunEmptyState({ emptyState: undefined, count: 1 })
        .hideCreateButton,
    ).toBeUndefined();
    expect(
      getFirstRunEmptyState({
        emptyState: undefined,
        count: 0,
        isAddedByHand: true,
      }).hideCreateButton,
    ).toBeUndefined();
    // Not yet counted: the page shows its loader, not the table.
    expect(
      getFirstRunEmptyState({ emptyState: undefined, count: null })
        .hideCreateButton,
    ).toBeUndefined();
  });

  test("the filter chips are put away only while the list waits for its first record", () => {
    const chips: { kind: string } = { kind: "chips" };

    expect(getFirstRunTopContent({ topContent: chips, count: 0 })).toBe(
      undefined,
    );
    expect(getFirstRunTopContent({ topContent: chips, count: 1 })).toBe(chips);
    expect(getFirstRunTopContent({ topContent: chips, count: 12 })).toBe(chips);
    // Not yet counted: the page shows its loader, not the table.
    expect(getFirstRunTopContent({ topContent: chips, count: null })).toBe(
      chips,
    );
  });

  test("an empty list looks again every ten seconds", () => {
    expect(FIRST_RECORD_POLL_INTERVAL_MS).toBe(10000);
  });

  test("the rules are React-free; the hook is the only part that is not", () => {
    const rules: string = read("Components/Infrastructure/FirstRecordWatch.ts");
    const hook: string = code(
      "Components/Infrastructure/UseFirstRecordWatch.ts",
    );

    expect(rules).not.toMatch(/from "react"/);
    expect(rules).not.toContain("ModelAPI");
    expect(hook).toContain('from "./FirstRecordWatch";');
    expect(hook).toContain("isWatchingForFirstRecord(count)");
    expect(hook).toContain("getCountAfterCheck({");
    expect(hook).toContain("}, FIRST_RECORD_POLL_INTERVAL_MS);");
    expect(hook).toContain("clearInterval(timer);");
  });

  test("retry counts again: it clears the error and asks for the first count anew", () => {
    const hook: string = code(
      "Components/Infrastructure/UseFirstRecordWatch.ts",
    );

    expect(hook).toContain("retry: () => void;");
    expect(hook).toContain(
      'retry: (): void => { setError(""); setAttempts((value: number): number => { return value + 1; }); },',
    );
    // The first count runs again whenever attempts changes.
    expect(hook).toContain("}, [attempts]);");
  });
});

/*
 * A list whose rows also arrive another way reads them again then too: a
 * list with an Add dialog (Add Host, Add Kubernetes Cluster, ...), when the
 * dialog sees one connect (Components/ResourceOnboarding).
 */
const ADD_DIALOG_REFRESH_TOGGLE: string =
  "refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}";

const REFRESH_TOGGLES: Record<string, string> = {
  "Pages/Host/Hosts.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/Kubernetes/Clusters.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/Docker/Hosts.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/Podman/Hosts.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/DockerSwarm/Clusters.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/Proxmox/Clusters.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/Ceph/Clusters.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/StorageArray/StorageArrays.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/IoT/Fleets.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/Serverless/ServerlessFunctions.tsx": ADD_DIALOG_REFRESH_TOGGLE,
  "Pages/Cloud/CloudResources.tsx": ADD_DIALOG_REFRESH_TOGGLE,
};

describe.each(LIST_PAGES)("%s", (page: string) => {
  const source: string = code(page);

  test("counts and watches through the shared hook, with no count or poll of its own", () => {
    expect(source).toContain("useFirstRecordWatch<");
    expect(source).toContain(
      REFRESH_TOGGLES[page] || "refreshToggle={firstRecordWatch.refreshToken}",
    );
    expect(source).not.toContain("ModelAPI.count(");
    expect(source).not.toContain("setInterval(");
    expect(source).not.toMatch(/useState<number \| null>\(null\)/);
  });

  test("the guide says the shared sentence, not a sentence of its own", () => {
    expect(source).toContain("{firstRecordWatch.count === 0 && (");
    expect(source).toContain("description={FIRST_RUN_GUIDE_DESCRIPTION}");
  });

  test("a failed first count offers Refresh, which counts again", () => {
    expect(source).toContain(
      "<ErrorMessage message={firstRecordWatch.error} onRefreshClick={firstRecordWatch.retry} />",
    );
  });
});

describe.each(LISTS_WITH_CHIPS)("%s's filter chips", (page: string) => {
  const source: string = code(page);

  test("wait for the first record: none over a new project's empty table", () => {
    expect(source).toContain(
      "topContent={getFirstRunTopContent({ topContent: filterBar, count: firstRecordWatch.count, })}",
    );
    expect(source).not.toContain("topContent={filterBar}");
  });
});

test("every list with chips is held to that, and the lists without have none", () => {
  for (const page of LIST_PAGES) {
    expect({
      page,
      hasChips: code(page).includes("filterBar"),
    }).toEqual({ page, hasChips: LISTS_WITH_CHIPS.includes(page) });
  }
});

describe("the list descriptions that named attributes say what a reader sees", () => {
  test("Hosts", () => {
    const source: string = code("Pages/Host/Hosts.tsx");

    expect(source).toContain(
      '"Hosts being monitored in this project. Add one with a single command on the host."',
    );
    expect(source).not.toContain("host.name plus a host signal");
  });

  test("Serverless Functions", () => {
    const source: string = code("Pages/Serverless/ServerlessFunctions.tsx");

    expect(source).toContain(
      '"Serverless functions being monitored in this project. A function shows up here once its OpenTelemetry data arrives."',
    );
    // The create form still names faas.name: that is what a function is matched by.
    expect(source).not.toContain(
      "auto-discovered from OpenTelemetry that carries",
    );
  });
});

describe("the Cloud lists name what they list", () => {
  test("an empty Cloud Environments list says no environments, not the model's no resources", () => {
    expect(code("Pages/Cloud/CloudResources.tsx")).toContain(
      'noItemsMessage="No cloud environments yet."',
    );
  });

  test("an empty Cloud Resources list keeps its own sentence", () => {
    expect(code("Pages/Cloud/MonitoredResources.tsx")).toContain(
      'noItemsMessage="No cloud resources discovered yet."',
    );
  });
});

describe("the words, in every language", () => {
  type Locale = Record<string, unknown>;

  const locales: Record<string, Locale> = {};

  for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
    if (file.endsWith(".json")) {
      locales[file.replace(/\.json$/, "")] = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Locale;
    }
  }

  const NON_ENGLISH: Array<string> = Object.keys(locales).filter(
    (code: string): boolean => {
      return code !== "en";
    },
  );

  const ADDED: Array<string> = [
    FIRST_RUN_GUIDE_DESCRIPTION,
    "No cloud environments yet.",
    "Hosts being monitored in this project. A host shows up here once its OpenTelemetry Collector sends data.",
    "Serverless functions being monitored in this project. A function shows up here once its OpenTelemetry data arrives.",
  ];

  test("there are sixteen languages besides English", () => {
    expect(NON_ENGLISH).toHaveLength(16);
  });

  test.each(ADDED)(
    "%s is in English and translated in every language",
    (key: string) => {
      expect(locales["en"]![key]).toBe(key);

      for (const language of NON_ENGLISH) {
        const value: unknown = locales[language]![key];

        expect({
          language,
          translated: typeof value === "string" && value !== key,
        }).toEqual({ language, translated: true });
      }
    },
  );

  test("Spanish speaks to the reader as tú", () => {
    expect(locales["es"]![FIRST_RUN_GUIDE_DESCRIPTION]).toContain("Sigue");
  });

  const RETIRED: Array<string> = [
    "Hosts being monitored in this project. Auto-discovered from any OTel telemetry that carries host.name plus a host signal (host.id, os.type, system.* metrics, etc).",
    "Serverless / FaaS functions auto-discovered from OpenTelemetry that carries faas.name (or a serverless cloud.platform like aws_lambda).",
    "No hosts connected yet. Wire up an OpenTelemetry Collector with the hostmetrics receiver using the guide below — your host will appear here automatically once the first metric batch arrives.",
    "No Kubernetes clusters connected yet. Install the agent using the guide below and your cluster will appear here automatically.",
    "No Docker hosts connected yet. Install the agent using the guide below and your host will appear here automatically.",
    "No Podman hosts connected yet. Install the agent using the guide below and your host will appear here automatically.",
    "No Docker Swarm clusters connected yet. Install the agent using the guide below and your cluster will appear here automatically.",
    "No Proxmox clusters connected yet. Connect one with the guide below — the agent or Proxmox VE 9's native push — and it will appear here automatically.",
    "No vCenters yet. Connect one above with a read-only account, or install the VMware Agent using the guide below.",
    "No Ceph clusters connected yet. Install the agent using the guide below and your cluster will appear here automatically.",
    "No storage arrays connected yet. Install the agent using the guide below and your array will appear here automatically.",
    "No databases yet. They appear when your instrumented apps query them or OneUptime finds them in your containers. You can also add one above.",
    "No queues yet. They appear once your apps use them or your broker's metrics arrive. Add one by hand above, or pick your messaging system below.",
    "No serverless functions connected yet. Instrument a function with OpenTelemetry using the guide below — it appears here automatically once the first telemetry arrives.",
    "No cloud environments yet. Point your OpenTelemetry Collector at OneUptime with a cloud resource detector, using the guide below.",
    "No IoT fleets connected yet. Send readings from your devices with OpenTelemetry or MQTT using the guide below — your fleet will appear here automatically.",
    "No cloud resources discovered yet. Run an OpenTelemetry Collector with read-only access to your cloud's monitoring API, using the guide below: every resource it reports on appears here, with its metrics.",
  ];

  test.each(RETIRED)("%s is in no language any more", (key: string) => {
    for (const language of Object.keys(locales)) {
      expect({ language, present: key in locales[language]! }).toEqual({
        language,
        present: false,
      });
    }
  });
});
