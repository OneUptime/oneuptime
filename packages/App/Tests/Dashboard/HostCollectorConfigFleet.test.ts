import {
  FAILED_COUNT_TEMPLATE,
  HOST_COLLECTOR_CONFIG_ORDER_STEPS,
  HOST_COLLECTOR_CONFIG_ORDER_TITLE,
  HOST_COLLECTOR_DEFAULTS_DESCRIPTION,
  HOST_COLLECTOR_DEFAULT_SUMMARIES,
  HOST_COUNT_TEMPLATE,
  HOST_OS_TYPE_VALUES,
  HostCollectorConfigOrderStep,
  getHostsFailingConfigQuery,
  getHostsOnDefaultQuery,
  getHostsRunningConfigQuery,
  hasHostCollectorConfigFailures,
} from "../../FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorConfigFleet";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import ObjectID from "Common/Types/ObjectID";
import {
  HOST_COLLECTOR_INSTALLABLE_OS_TYPES,
  HostCollectorConfigStatus,
  HostCollectorOsType,
  getHostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import {
  HostCollectorConfigCandidate,
  HostCollectorConfigChoiceReason,
  chooseHostCollectorConfig,
} from "Common/Utils/HostCollector/HostCollectorConfigResolution";
import { getHostCollectorDefaultConfig } from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Hosts > Configuration > Collector Configs, what it says about the hosts a
 * config reaches and how a host comes to run one (HostCollectorConfigFleet):
 *
 *   - the three steps across the top of the list are the rule the server
 *     follows (chooseHostCollectorConfig), in its order;
 *   - the counts are the server's, read with the queries a config's own
 *     Hosts list reads, and a default's with the hosts that run no config;
 *   - each default's few words say what its config.yaml really collects;
 *   - every word of it is in the Dashboard's locale files, in every
 *     language.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const DASHBOARD_EN: Record<string, string> = readLocale("en");

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(".json", "");
  })
  .sort();

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const CONFIG_ID: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000001",
);

const PRODUCTION: string = "40000000-0000-4000-8000-000000000001";

const WEB_SERVERS: HostCollectorConfigCandidate = {
  id: "web-servers",
  osType: HostCollectorOsType.Linux,
  labelIds: [PRODUCTION],
  order: 1,
};
const EVERY_LINUX_HOST: HostCollectorConfigCandidate = {
  id: "every-linux-host",
  osType: HostCollectorOsType.Linux,
  labelIds: [],
  order: 2,
};
const WINDOWS_SERVERS: HostCollectorConfigCandidate = {
  id: "windows-servers",
  osType: HostCollectorOsType.Windows,
  labelIds: [],
  order: 3,
};
const LIST: Array<HostCollectorConfigCandidate> = [
  WINDOWS_SERVERS,
  EVERY_LINUX_HOST,
  WEB_SERVERS,
];

function stepOf(reason: HostCollectorConfigChoiceReason): number {
  return HOST_COLLECTOR_CONFIG_ORDER_STEPS.findIndex(
    (step: HostCollectorConfigOrderStep): boolean => {
      return step.reason === reason;
    },
  );
}

describe("how a host gets its config, across the top of the list", () => {
  test("three steps, one for each reason the server gives, each once", () => {
    expect(
      HOST_COLLECTOR_CONFIG_ORDER_STEPS.map(
        (
          step: HostCollectorConfigOrderStep,
        ): HostCollectorConfigChoiceReason => {
          return step.reason;
        },
      ),
    ).toEqual([
      HostCollectorConfigChoiceReason.Pinned,
      HostCollectorConfigChoiceReason.Matched,
      HostCollectorConfigChoiceReason.Default,
    ]);
    expect(new Set(Object.values(HostCollectorConfigChoiceReason)).size).toBe(
      HOST_COLLECTOR_CONFIG_ORDER_STEPS.length,
    );
  });

  test("a config picked for the host comes first: it wins over a config of the list that applies", () => {
    const choice: { configId: string | null; reason: string } =
      chooseHostCollectorConfig(LIST, {
        osType: HostCollectorOsType.Linux,
        labelIds: [PRODUCTION],
        pinnedConfigId: WINDOWS_SERVERS.id,
      });

    expect(choice.configId).toBe(WINDOWS_SERVERS.id);
    expect(stepOf(HostCollectorConfigChoiceReason.Pinned)).toBe(0);
    expect(stepOf(choice.reason as HostCollectorConfigChoiceReason)).toBe(0);
  });

  test("then the first config that applies, checked from the top of the list, by system and labels", () => {
    // Both Linux configs apply to a production web server: the higher one wins.
    const labelled: { configId: string | null; reason: string } =
      chooseHostCollectorConfig(LIST, {
        osType: HostCollectorOsType.Linux,
        labelIds: [PRODUCTION],
      });
    expect(labelled.configId).toBe(WEB_SERVERS.id);
    expect(stepOf(labelled.reason as HostCollectorConfigChoiceReason)).toBe(1);

    // Without the label, the next one down applies.
    const unlabelled: { configId: string | null; reason: string } =
      chooseHostCollectorConfig(LIST, {
        osType: HostCollectorOsType.Linux,
        labelIds: [],
      });
    expect(unlabelled.configId).toBe(EVERY_LINUX_HOST.id);
    expect(stepOf(unlabelled.reason as HostCollectorConfigChoiceReason)).toBe(
      1,
    );
  });

  test("last, OneUptime's default for the host's system, when no config applies", () => {
    const choice: { configId: string | null; reason: string } =
      chooseHostCollectorConfig(LIST, {
        osType: HostCollectorOsType.MacOS,
        labelIds: [PRODUCTION],
      });

    expect(choice.configId).toBeNull();
    expect(stepOf(choice.reason as HostCollectorConfigChoiceReason)).toBe(2);
  });

  test("a picked config that is gone does not count: the host goes on to the list", () => {
    const choice: { configId: string | null; reason: string } =
      chooseHostCollectorConfig(LIST, {
        osType: HostCollectorOsType.Windows,
        labelIds: [],
        pinnedConfigId: "deleted-config",
      });

    expect(choice.configId).toBe(WINDOWS_SERVERS.id);
    expect(stepOf(choice.reason as HostCollectorConfigChoiceReason)).toBe(1);
  });

  test("every step's title and sentence, and the strip's title, are Dashboard words", () => {
    expect(DASHBOARD_EN[HOST_COLLECTOR_CONFIG_ORDER_TITLE]).toBe(
      HOST_COLLECTOR_CONFIG_ORDER_TITLE,
    );
    for (const step of HOST_COLLECTOR_CONFIG_ORDER_STEPS) {
      expect(DASHBOARD_EN[step.title]).toBe(step.title);
      expect(DASHBOARD_EN[step.description]).toBe(step.description);
      // A sentence ends with a full stop; a title does not.
      expect(step.description.endsWith(".")).toBe(true);
      expect(step.title.endsWith(".")).toBe(false);
    }
  });
});

describe("the hosts a config reaches, counted by the server", () => {
  test("the hosts that run a config: the ones the server sends it to, out of the archive", () => {
    expect(
      getHostsRunningConfigQuery({
        projectId: PROJECT_ID,
        configId: CONFIG_ID,
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      collectorConfigId: CONFIG_ID,
      isArchived: false,
    });
  });

  test("those it failed on: the same hosts, whose config did not start", () => {
    expect(
      getHostsFailingConfigQuery({
        projectId: PROJECT_ID,
        configId: CONFIG_ID,
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      collectorConfigId: CONFIG_ID,
      isArchived: false,
      collectorConfigStatus: HostCollectorConfigStatus.Failed,
    });
  });

  test.each(
    HOST_COLLECTOR_INSTALLABLE_OS_TYPES.map((osType: HostCollectorOsType) => {
      return [osType];
    }),
  )(
    "a default's hosts (%s): managed by OneUptime, running no config, of its system",
    (osType: HostCollectorOsType) => {
      const query: Record<string, unknown> = getHostsOnDefaultQuery({
        projectId: PROJECT_ID,
        osType,
      }) as Record<string, unknown>;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["isArchived"]).toBe(false);
      // A host set up by hand has no instance: it runs a config.yaml of its own.
      expect(query["collectorInstanceUid"]).toBeInstanceOf(NotNull);
      expect(query["collectorConfigId"]).toBeInstanceOf(IsNull);
      expect(query["osType"]).toBeInstanceOf(Includes);
      expect((query["osType"] as Includes).values).toEqual(
        HOST_OS_TYPE_VALUES[osType],
      );
    },
  );

  test("each system's os.type values are the ones read as that system, and macOS is both of its names", () => {
    for (const osType of HOST_COLLECTOR_INSTALLABLE_OS_TYPES) {
      const values: Array<string> = HOST_OS_TYPE_VALUES[osType];
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(getHostCollectorOsType(value)).toBe(osType);
      }
    }
    expect(HOST_OS_TYPE_VALUES[HostCollectorOsType.MacOS]).toEqual([
      "darwin",
      "macos",
    ]);

    // No value is two systems'.
    const all: Array<string> = HOST_COLLECTOR_INSTALLABLE_OS_TYPES.flatMap(
      (osType: HostCollectorOsType): Array<string> => {
        return HOST_OS_TYPE_VALUES[osType];
      },
    );
    expect(new Set(all).size).toBe(all.length);
  });

  test("a config failed somewhere only when one of its hosts says so", () => {
    expect(hasHostCollectorConfigFailures(undefined)).toBe(false);
    expect(hasHostCollectorConfigFailures({ hosts: 0, failed: 0 })).toBe(false);
    expect(hasHostCollectorConfigFailures({ hosts: 4, failed: 0 })).toBe(false);
    expect(hasHostCollectorConfigFailures({ hosts: 4, failed: 1 })).toBe(true);
  });

  test("the counts are plural Dashboard words, with their one forms", () => {
    expect(DASHBOARD_EN[HOST_COUNT_TEMPLATE.other]).toBe("{{count}} hosts");
    expect(DASHBOARD_EN[`${HOST_COUNT_TEMPLATE.other}_one`]).toBe(
      HOST_COUNT_TEMPLATE.one,
    );
    expect(DASHBOARD_EN[FAILED_COUNT_TEMPLATE.other]).toBe("{{count}} failed");
    expect(DASHBOARD_EN[`${FAILED_COUNT_TEMPLATE.other}_one`]).toBe(
      FAILED_COUNT_TEMPLATE.one,
    );
  });
});

describe("what each of OneUptime's defaults collects, in a few words", () => {
  test("every system has its words, and they are Dashboard words", () => {
    for (const osType of Object.values(HostCollectorOsType)) {
      const summary: string = HOST_COLLECTOR_DEFAULT_SUMMARIES[osType];
      expect(summary.startsWith("Host metrics")).toBe(true);
      expect(DASHBOARD_EN[summary]).toBe(summary);
    }
    expect(DASHBOARD_EN[HOST_COLLECTOR_DEFAULTS_DESCRIPTION]).toBe(
      HOST_COLLECTOR_DEFAULTS_DESCRIPTION,
    );
  });

  test.each([
    [
      HostCollectorOsType.Linux,
      ["the journal", "systemd units"],
      ["journald", "systemd"],
    ],
    [
      HostCollectorOsType.Windows,
      ["event logs", "Windows services"],
      ["windows_event_log/system", "windows_service"],
    ],
    [
      HostCollectorOsType.MacOS,
      ["install", "Wi-Fi logs"],
      ["/var/log/install.log", "/var/log/wifi.log"],
    ],
  ])(
    "%s: what the words name is in its config.yaml",
    (
      osType: HostCollectorOsType,
      words: Array<string>,
      inConfig: Array<string>,
    ) => {
      const summary: string = HOST_COLLECTOR_DEFAULT_SUMMARIES[osType];
      const config: string = getHostCollectorDefaultConfig(osType);

      for (const word of words) {
        expect(summary).toContain(word);
      }
      for (const part of inConfig) {
        expect(config).toContain(part);
      }
      // Host metrics: every default reads the host itself.
      expect(config).toContain("host_metrics");
    },
  );
});

describe("every language says it in its own words", () => {
  const NEW_KEYS: Array<string> = [
    HOST_COLLECTOR_CONFIG_ORDER_TITLE,
    ...HOST_COLLECTOR_CONFIG_ORDER_STEPS.flatMap(
      (step: HostCollectorConfigOrderStep): Array<string> => {
        return [step.title, step.description];
      },
    ),
    ...HOST_COLLECTOR_INSTALLABLE_OS_TYPES.map(
      (osType: HostCollectorOsType): string => {
        return HOST_COLLECTOR_DEFAULT_SUMMARIES[osType];
      },
    ),
    HOST_COLLECTOR_DEFAULT_SUMMARIES[HostCollectorOsType.Any],
    HOST_COLLECTOR_DEFAULTS_DESCRIPTION,
    "Create a config from it",
    "No Collector Configs yet. Every host runs OneUptime's default for its system, shown below.",
    "The config OneUptime sends to the hosts it manages. Each host runs the first config that applies to it, from the top: drag the rows to change the order.",
    "Who this config is for, and how many hosts run it now. A host runs the first config in the list that applies to it.",
  ];

  test("the languages are the Dashboard's seventeen", () => {
    expect(LANGUAGES.length).toBe(17);
  });

  test.each(
    LANGUAGES.map((language: string) => {
      return [language];
    }),
  )("%s", (language: string) => {
    const locale: Record<string, string> = readLocale(language);

    for (const key of NEW_KEYS) {
      expect(DASHBOARD_EN[key]).toBe(key);
      const value: string | undefined = locale[key];
      expect({ key, translated: Boolean(value) && value !== key }).toEqual({
        key,
        translated: true,
      });
      // OneUptime is a name: never translated.
      if (key.includes("OneUptime")) {
        expect(value).toContain("OneUptime");
      }
    }
  });
});
