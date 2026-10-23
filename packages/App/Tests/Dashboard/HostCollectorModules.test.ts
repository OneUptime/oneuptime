import {
  HOST_COLLECTOR_SILENT_AFTER_MS,
  HostCollectorState,
  HostCollectorTranslatableText,
  describeHostCollectorState,
  getHostCollectorConfigLabel,
  getHostCollectorState,
  getHostCollectorStateView,
  isHostCollectorManaged,
  summarizeCollectorError,
  COLLECTOR_ERROR_SUMMARY_MAX_LENGTH,
} from "../../FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorStatus";
import {
  AUTOMATIC_HOST_COLLECTOR_CONFIG,
  HostCollectorConfigChoiceHost,
  HostCollectorConfigChoiceOption,
  describeHostCollectorConfigChoice,
  getAutomaticHostCollectorConfigId,
  getCurrentHostCollectorConfigChoice,
  getHostCollectorConfigChoiceUpdate,
  getPickableHostCollectorConfigs,
} from "../../FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorConfigChoice";
import {
  canPutHostCollectorConfigVersionBack,
  describeHostCollectorConfigVersionChange,
  isCurrentHostCollectorConfigVersion,
} from "../../FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorConfigVersions";
import {
  DEFAULT_HOST_ADD_OPTION,
  HOST_ADD_OPTIONS,
  HOST_ADD_PLACEHOLDER_NOTE,
  HostAddOption,
  getHostAddCommand,
  getHostAddGuide,
  getHostAddOptionForOsType,
  getHostAddOptions,
  resolveHostAddOption,
} from "../../FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorGuide";
import {
  HOST_COLLECTOR_CONFIG_OS_CHOICES,
  HOST_COLLECTOR_CONFIG_SYSTEM_CREATE_DESCRIPTION,
  HOST_COLLECTOR_CONFIG_SYSTEM_EDIT_DESCRIPTION,
  describeHostCollectorConfigTarget,
  getHostCollectorConfigFormFields,
} from "../../FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorConfigForm";
import {
  COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH,
  CommandDisplayPart,
  splitCommandForDisplay,
} from "../../FeatureSet/Dashboard/src/Components/SetupGuide/CommandDisplay";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  HostCollectorConfigStatus,
  HostCollectorOsType,
  getHostCollectorConfigRestoredNote,
} from "Common/Types/HostCollector/HostCollector";
import {
  getHostCollectorInstallCommand,
  getHostCollectorServiceCommands,
} from "Common/Utils/HostCollector/HostCollectorInstallCommand";
import { fastestRun } from "Common/Tests/Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Dashboard says about the collectors OneUptime manages, from the
 * columns the server keeps: the pill on the Hosts list and a host's
 * Collector page (one rule, so they never disagree), which config a host
 * runs and how it came to, what Change config writes, a config's Versions
 * list, and the Add Host guide's command for each system.
 */

const NOW: Date = new Date("2026-10-21T08:00:00.000Z");

const DASHBOARD_EN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../FeatureSet/Dashboard/src/Locales/en.json"),
    "utf8",
  ),
) as Record<string, string>;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("where a host's collector stands", () => {
  test("a collector installed by hand is not one OneUptime manages", () => {
    expect(isHostCollectorManaged({})).toBe(false);
    expect(getHostCollectorState({}, NOW)).toBe(HostCollectorState.NotManaged);
    expect(
      getHostCollectorState(
        {
          collectorConfigStatus: HostCollectorConfigStatus.Applied,
          collectorLastContactAt: NOW,
        },
        NOW,
      ),
    ).toBe(HostCollectorState.NotManaged);
  });

  test.each([
    [undefined, true, HostCollectorState.Waiting],
    [HostCollectorConfigStatus.Waiting, true, HostCollectorState.Waiting],
    [HostCollectorConfigStatus.Applying, true, HostCollectorState.Applying],
    [HostCollectorConfigStatus.Applied, true, HostCollectorState.Running],
    [HostCollectorConfigStatus.Applied, null, HostCollectorState.Running],
    [HostCollectorConfigStatus.Applied, false, HostCollectorState.Unhealthy],
    [HostCollectorConfigStatus.Failed, true, HostCollectorState.Failed],
    [HostCollectorConfigStatus.Failed, false, HostCollectorState.Failed],
  ])(
    "config status %p, healthy %p: %p",
    (
      status: HostCollectorConfigStatus | undefined,
      isHealthy: boolean | null,
      expected: HostCollectorState,
    ) => {
      expect(
        getHostCollectorState(
          {
            collectorInstanceUid: "uid",
            collectorLastContactAt: minutesAgo(1),
            collectorConfigStatus: status,
            isCollectorHealthy: isHealthy,
          },
          NOW,
        ),
      ).toBe(expected);
    },
  );

  test("a host quiet for more than 15 minutes is not reporting, whatever it said last", () => {
    expect(HOST_COLLECTOR_SILENT_AFTER_MS).toBe(15 * 60 * 1000);

    const host: Parameters<typeof getHostCollectorState>[0] = {
      collectorInstanceUid: "uid",
      collectorConfigStatus: HostCollectorConfigStatus.Applied,
      isCollectorHealthy: true,
    };

    expect(
      getHostCollectorState(
        { ...host, collectorLastContactAt: minutesAgo(15) },
        NOW,
      ),
    ).toBe(HostCollectorState.Running);
    expect(
      getHostCollectorState(
        { ...host, collectorLastContactAt: minutesAgo(16) },
        NOW,
      ),
    ).toBe(HostCollectorState.Silent);
    expect(
      getHostCollectorState(
        {
          ...host,
          collectorConfigStatus: HostCollectorConfigStatus.Failed,
          collectorLastContactAt: minutesAgo(60),
        },
        NOW,
      ),
    ).toBe(HostCollectorState.Silent);
  });

  test("a last contact sent as text is read as a date; one that is not a date is ignored", () => {
    expect(
      getHostCollectorState(
        {
          collectorInstanceUid: "uid",
          collectorLastContactAt: minutesAgo(30).toISOString(),
          collectorConfigStatus: HostCollectorConfigStatus.Applied,
        },
        NOW,
      ),
    ).toBe(HostCollectorState.Silent);
    expect(
      getHostCollectorState(
        {
          collectorInstanceUid: "uid",
          collectorLastContactAt: "yesterday",
          collectorConfigStatus: HostCollectorConfigStatus.Applied,
        },
        NOW,
      ),
    ).toBe(HostCollectorState.Running);
  });

  test("every state has a pill whose label the Dashboard translates", () => {
    const tones: Record<string, string> = {};

    for (const state of Object.values(HostCollectorState)) {
      const statusFor: Record<
        HostCollectorState,
        Parameters<typeof getHostCollectorState>[0]
      > = {
        [HostCollectorState.NotManaged]: {},
        [HostCollectorState.Waiting]: { collectorInstanceUid: "u" },
        [HostCollectorState.Applying]: {
          collectorInstanceUid: "u",
          collectorConfigStatus: HostCollectorConfigStatus.Applying,
        },
        [HostCollectorState.Running]: {
          collectorInstanceUid: "u",
          collectorConfigStatus: HostCollectorConfigStatus.Applied,
        },
        [HostCollectorState.Failed]: {
          collectorInstanceUid: "u",
          collectorConfigStatus: HostCollectorConfigStatus.Failed,
        },
        [HostCollectorState.Unhealthy]: {
          collectorInstanceUid: "u",
          collectorConfigStatus: HostCollectorConfigStatus.Applied,
          isCollectorHealthy: false,
        },
        [HostCollectorState.Silent]: {
          collectorInstanceUid: "u",
          collectorLastContactAt: minutesAgo(60),
        },
      };

      const view: ReturnType<typeof getHostCollectorStateView> =
        getHostCollectorStateView(statusFor[state], NOW);

      expect(view.state).toBe(state);
      expect(DASHBOARD_EN[view.label]).toBeDefined();
      tones[state] = view.tone;
    }

    expect(tones[HostCollectorState.Running]).toBe("success");
    expect(tones[HostCollectorState.Failed]).toBe("danger");
    expect(tones[HostCollectorState.NotManaged]).toBe("neutral");
    expect(tones[HostCollectorState.Unhealthy]).toBe("warning");
    expect(tones[HostCollectorState.Silent]).toBe("warning");
  });

  test("a collector connected and starting says Starting, as the list's Status column does", () => {
    const view: ReturnType<typeof getHostCollectorStateView> =
      getHostCollectorStateView({ collectorInstanceUid: "u" }, NOW);

    expect(view.state).toBe(HostCollectorState.Waiting);
    expect(view.label).toBe("Starting");
    // Not "Connecting": the supervisor has connected, or there would be no host.
    expect(view.tone).toBe("info");
  });

  test("the sentence for each state names the config, and is a Dashboard string", () => {
    const states: Array<Parameters<typeof getHostCollectorState>[0]> = [
      {},
      { collectorInstanceUid: "u" },
      {
        collectorInstanceUid: "u",
        collectorConfigStatus: HostCollectorConfigStatus.Applying,
      },
      {
        collectorInstanceUid: "u",
        collectorConfigStatus: HostCollectorConfigStatus.Applied,
      },
      {
        collectorInstanceUid: "u",
        collectorConfigStatus: HostCollectorConfigStatus.Failed,
      },
      {
        collectorInstanceUid: "u",
        collectorConfigStatus: HostCollectorConfigStatus.Applied,
        isCollectorHealthy: false,
      },
      { collectorInstanceUid: "u", collectorLastContactAt: minutesAgo(60) },
    ];

    for (const host of states) {
      const text: HostCollectorTranslatableText = describeHostCollectorState({
        host,
        configName: "Web servers",
        now: NOW,
      });

      expect(DASHBOARD_EN[text.template]).toBeDefined();
      if (text.template.includes("{{config}}")) {
        expect(text.values["config"]).toBe("Web servers");
      }
    }
  });
});

describe("the reason a config did not start", () => {
  test("is the last Error line of the collector's log", () => {
    expect(
      summarizeCollectorError(
        [
          "2026-10-21T08:00:00Z info service started",
          "Error: first problem",
          "2026-10-21T08:00:01Z error collector failed",
          'Error: cannot start pipelines: failed to start "systemd" receiver: dial unix /run/dbus/system_bus_socket',
          "more context",
        ].join("\n"),
      ),
    ).toBe(
      'cannot start pipelines: failed to start "systemd" receiver: dial unix /run/dbus/system_bus_socket',
    );
  });

  test("else its first line", () => {
    expect(summarizeCollectorError("invalid config\nat line 3")).toBe(
      "invalid config",
    );
    expect(summarizeCollectorError("  ")).toBeNull();
    expect(summarizeCollectorError(null)).toBeNull();
  });

  test("is cut to a line people can read", () => {
    const summary: string | null = summarizeCollectorError(
      `Error: ${"x".repeat(1000)}`,
    );

    expect(summary?.length).toBe(COLLECTOR_ERROR_SUMMARY_MAX_LENGTH + 1);
  });

  test("is found quickly in any log a host sends", () => {
    const logs: Array<string> = [
      "Error: ".repeat(60000),
      "x\n".repeat(200000),
      "E".repeat(400000),
    ];

    for (const log of logs) {
      expect(
        fastestRun({
          run: (): string | null => {
            return summarizeCollectorError(log);
          },
          limitInMs: 2000,
        }).inMs,
      ).toBeLessThan(2000);
    }
  });
});

describe("the name of the config a host runs", () => {
  test("a Collector Config's own name, never looked up as a translation", () => {
    const translator: { translateTemplate: (text: string) => string } = {
      translateTemplate: (text: string): string => {
        return `translated:${text}`;
      },
    };

    expect(
      getHostCollectorConfigLabel(
        { configName: "Web servers", osType: "linux" },
        translator,
      ),
    ).toBe("Web servers");
  });

  test("OneUptime's default for the host's system, translated", () => {
    const translator: { translateTemplate: (text: string) => string } = {
      translateTemplate: (text: string): string => {
        return `translated:${text}`;
      },
    };

    expect(getHostCollectorConfigLabel({ osType: "windows" }, translator)).toBe(
      "translated:OneUptime default for Windows",
    );
    expect(getHostCollectorConfigLabel({ osType: "darwin" })).toBe(
      "OneUptime default for macOS",
    );
    expect(getHostCollectorConfigLabel({ osType: "freebsd" })).toBe(
      "OneUptime default",
    );
    expect(DASHBOARD_EN["OneUptime default for Linux"]).toBeDefined();
  });
});

describe("Change config", () => {
  const configs: Array<HostCollectorConfigChoiceOption> = [
    {
      id: "production-web",
      name: "Production web",
      osType: HostCollectorOsType.Linux,
      labelIds: ["production"],
      order: 0,
    },
    {
      id: "windows",
      name: "Windows",
      osType: HostCollectorOsType.Windows,
      labelIds: [],
      order: 1,
    },
    {
      id: "every-host",
      name: "Every host",
      osType: HostCollectorOsType.Any,
      labelIds: [],
      order: 2,
    },
  ];

  const linuxHost: HostCollectorConfigChoiceHost = {
    osType: "linux",
    labelIds: ["production"],
    collectorConfigId: "production-web",
    isCollectorConfigPinned: false,
  };

  test("offers the configs for the host's system and for any system", () => {
    expect(
      getPickableHostCollectorConfigs({ configs, host: linuxHost }).map(
        (config: HostCollectorConfigChoiceOption): string => {
          return config.id;
        },
      ),
    ).toEqual(["production-web", "every-host"]);
    expect(
      getPickableHostCollectorConfigs({
        configs,
        host: { ...linuxHost, osType: null },
      }).map((config: HostCollectorConfigChoiceOption): string => {
        return config.id;
      }),
    ).toEqual(["every-host"]);
  });

  test("starts on the picked config, or Automatic", () => {
    expect(getCurrentHostCollectorConfigChoice(linuxHost)).toBe(
      AUTOMATIC_HOST_COLLECTOR_CONFIG,
    );
    expect(
      getCurrentHostCollectorConfigChoice({
        ...linuxHost,
        collectorConfigId: "every-host",
        isCollectorConfigPinned: true,
      }),
    ).toBe("every-host");
  });

  test("picking a config pins it to the host", () => {
    expect(
      getHostCollectorConfigChoiceUpdate({
        choice: "every-host",
        configs,
        host: linuxHost,
      }),
    ).toEqual({
      collectorConfigId: "every-host",
      isCollectorConfigPinned: true,
    });
  });

  test("Automatic gives the host back to the list, at the config the list gives it now", () => {
    expect(
      getHostCollectorConfigChoiceUpdate({
        choice: AUTOMATIC_HOST_COLLECTOR_CONFIG,
        configs,
        host: { ...linuxHost, isCollectorConfigPinned: true },
      }),
    ).toEqual({
      collectorConfigId: "production-web",
      isCollectorConfigPinned: false,
    });
    expect(
      getHostCollectorConfigChoiceUpdate({
        choice: AUTOMATIC_HOST_COLLECTOR_CONFIG,
        configs: [configs[1]!],
        host: linuxHost,
      }),
    ).toEqual({ collectorConfigId: null, isCollectorConfigPinned: false });
  });

  test("a config for another system cannot be pinned: it falls back to Automatic", () => {
    expect(
      getHostCollectorConfigChoiceUpdate({
        choice: "windows",
        configs,
        host: linuxHost,
      }),
    ).toEqual({
      collectorConfigId: "production-web",
      isCollectorConfigPinned: false,
    });
  });

  test("the automatic config follows the server's rule", () => {
    expect(
      getAutomaticHostCollectorConfigId({
        configs,
        host: { ...linuxHost, labelIds: [] },
      }),
    ).toBe("every-host");
  });

  test("says how the host came to run its config", () => {
    expect(
      describeHostCollectorConfigChoice({
        collectorConfigId: "x",
        isCollectorConfigPinned: true,
      }).template,
    ).toBe("Picked for this host");
    expect(
      describeHostCollectorConfigChoice({
        collectorConfigId: "x",
        isCollectorConfigPinned: false,
      }).template,
    ).toBe("The first Collector Config that applies");
    expect(
      describeHostCollectorConfigChoice({
        collectorConfigId: null,
        isCollectorConfigPinned: false,
      }).template,
    ).toBe("No Collector Config applies to this host");
  });
});

describe("a config's Versions list", () => {
  test("says what each version changed, in the reader's language", () => {
    expect(describeHostCollectorConfigVersionChange("Created")).toEqual({
      template: "Created",
      values: {},
    });
    expect(describeHostCollectorConfigVersionChange("Changed")).toEqual({
      template: "Changed",
      values: {},
    });
    expect(
      describeHostCollectorConfigVersionChange(
        getHostCollectorConfigRestoredNote(3),
      ),
    ).toEqual({
      template: "Put version {{number}} back",
      values: { number: "3" },
    });
    expect(describeHostCollectorConfigVersionChange(null).template).toBe(
      "Changed",
    );

    for (const key of ["Created", "Changed", "Put version {{number}} back"]) {
      expect(DASHBOARD_EN[key]).toBeDefined();
    }
  });

  test("marks the version the config is on now", () => {
    expect(
      isCurrentHostCollectorConfigVersion({
        versionNumber: 3,
        currentVersionNumber: 3,
      }),
    ).toBe(true);
    expect(
      isCurrentHostCollectorConfigVersion({
        versionNumber: 2,
        currentVersionNumber: 3,
      }),
    ).toBe(false);
    expect(
      isCurrentHostCollectorConfigVersion({
        versionNumber: undefined,
        currentVersionNumber: undefined,
      }),
    ).toBe(false);
  });

  test("offers Put back only for a version whose YAML is not the config's now", () => {
    expect(
      canPutHostCollectorConfigVersionBack({
        versionConfigHash: "a",
        currentConfigHash: "b",
      }),
    ).toBe(true);
    expect(
      canPutHostCollectorConfigVersionBack({
        versionConfigHash: "a",
        currentConfigHash: "a",
      }),
    ).toBe(false);
    expect(
      canPutHostCollectorConfigVersionBack({
        versionConfigHash: null,
        currentConfigHash: "a",
      }),
    ).toBe(false);
  });
});

describe("Create Collector Config", () => {
  test("asks for a name, a system and labels; the name needs no description beside its placeholder", () => {
    const fields: ReturnType<typeof getHostCollectorConfigFormFields> =
      getHostCollectorConfigFormFields();

    expect(
      fields.map((field: { title?: string | undefined }): string => {
        return field.title || "";
      }),
    ).toEqual(["Name", "System", "Host Labels"]);
    expect(fields[0]!.placeholder).toBe("Web servers");
    expect(fields[0]!.description).toBeUndefined();
    // Nor the column's description, which is written for the API reference.
    expect(fields[0]!.hideColumnDescription).toBe(true);
    expect(fields[2]!.required).toBe(false);
  });

  test("creating, the system says where config.yaml starts; editing, that config.yaml stays", () => {
    expect(getHostCollectorConfigFormFields()[1]!.description).toBe(
      HOST_COLLECTOR_CONFIG_SYSTEM_CREATE_DESCRIPTION,
    );
    expect(
      getHostCollectorConfigFormFields({ isEditing: false })[1]!.description,
    ).toBe(HOST_COLLECTOR_CONFIG_SYSTEM_CREATE_DESCRIPTION);
    expect(
      getHostCollectorConfigFormFields({ isEditing: true })[1]!.description,
    ).toBe(HOST_COLLECTOR_CONFIG_SYSTEM_EDIT_DESCRIPTION);

    for (const key of [
      HOST_COLLECTOR_CONFIG_SYSTEM_CREATE_DESCRIPTION,
      HOST_COLLECTOR_CONFIG_SYSTEM_EDIT_DESCRIPTION,
    ]) {
      expect(DASHBOARD_EN[key]).toBe(key);
    }
  });

  test("asks for Linux, Windows, macOS or any system, Linux first", () => {
    expect(
      HOST_COLLECTOR_CONFIG_OS_CHOICES.map(
        (choice: { value: string }): string => {
          return choice.value;
        },
      ),
    ).toEqual(["linux", "windows", "darwin", "any"]);
  });

  test("says which hosts a config is for", () => {
    expect(
      describeHostCollectorConfigTarget({ osType: "linux", labelNames: [] }),
    ).toEqual({ template: "Linux hosts", labels: "" });
    expect(
      describeHostCollectorConfigTarget({
        osType: "windows",
        labelNames: ["env:production", "team:web"],
      }),
    ).toEqual({
      template: "Windows hosts with {{labels}}",
      labels: "env:production, team:web",
    });
    expect(
      describeHostCollectorConfigTarget({ osType: "any", labelNames: [] })
        .template,
    ).toBe("Hosts on any system");

    // Its labels in natural order, as labels are listed everywhere.
    expect(
      describeHostCollectorConfigTarget({
        osType: "linux",
        labelNames: ["team:web", "10. Edge", "2. Core", "env:production"],
      }).labels,
    ).toBe("2. Core, 10. Edge, env:production, team:web");

    for (const key of [
      "Linux hosts",
      "Linux hosts with {{labels}}",
      "Windows hosts",
      "macOS hosts with {{labels}}",
      "Hosts on any system with {{labels}}",
    ]) {
      expect(DASHBOARD_EN[key]).toBeDefined();
    }
  });
});

describe("the Add Host guide", () => {
  const URL: string = "https://oneuptime.example.com";
  const KEY: string = "a1b2c3d4-0000-4000-8000-00000000f00d";

  test("offers Linux, Windows and macOS, Linux first: a cluster's nodes are not a system to pick", () => {
    expect(
      HOST_ADD_OPTIONS.map((option: { key: string }): string => {
        return option.key;
      }),
    ).toEqual(["linux", "windows", "darwin"]);
    expect(DEFAULT_HOST_ADD_OPTION).toBe("linux");
    expect(resolveHostAddOption("nonsense")).toBe("linux");
    expect(resolveHostAddOption("darwin")).toBe("darwin");
    // A link to an old Kubernetes choice opens on Linux, not on a guide that is gone.
    expect(resolveHostAddOption("kubernetes")).toBe("linux");
  });

  test("a host whose system OneUptime knows gets only that system's command", () => {
    const keys: (
      osType: HostCollectorOsType | null | undefined,
    ) => Array<HostAddOption> = (
      osType: HostCollectorOsType | null | undefined,
    ): Array<HostAddOption> => {
      return getHostAddOptions(osType).map(
        (option: { key: HostAddOption }): HostAddOption => {
          return option.key;
        },
      );
    };

    expect(keys(HostCollectorOsType.Linux)).toEqual(["linux"]);
    expect(keys(HostCollectorOsType.Windows)).toEqual(["windows"]);
    expect(keys(HostCollectorOsType.MacOS)).toEqual(["darwin"]);
    // Unknown, or not one system: the reader picks.
    expect(keys(null)).toEqual(["linux", "windows", "darwin"]);
    expect(keys(undefined)).toEqual(["linux", "windows", "darwin"]);
    expect(keys(HostCollectorOsType.Any)).toEqual([
      "linux",
      "windows",
      "darwin",
    ]);
  });

  test("the key step is only the picker, and the command wraps: it carries the URL and the key", () => {
    for (const option of [
      "linux",
      "windows",
      "darwin",
    ] as Array<HostAddOption>) {
      const guide: ReturnType<typeof getHostAddGuide> = getHostAddGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        option,
      });

      expect(guide.keyStep?.hideValues).toBe(true);
      expect(guide.wrapLongLines).toBe(true);
      expect(DASHBOARD_EN[guide.keyStep!.description!]).toBeDefined();
    }
  });

  test("points to the manual guide, except where the page shows it or the collector is OneUptime's already", () => {
    const titles: (
      hideManualInstallTopic: boolean | undefined,
    ) => Array<string> = (
      hideManualInstallTopic: boolean | undefined,
    ): Array<string> => {
      return (
        getHostAddGuide({
          oneuptimeUrl: URL,
          apiKey: KEY,
          option: "linux",
          hideManualInstallTopic,
        }).advanced || []
      ).map((topic: { title: string }): string => {
        return topic.title;
      });
    };

    expect(titles(undefined)).toContain("Install the collector yourself");
    expect(titles(false)).toContain("Install the collector yourself");
    expect(titles(true)).not.toContain("Install the collector yourself");
    // Only that topic goes.
    expect(titles(true)).toHaveLength(titles(undefined).length - 1);
  });

  test("what each run step says is a Dashboard string, handing over or not", () => {
    for (const option of [
      "linux",
      "windows",
      "darwin",
    ] as Array<HostAddOption>) {
      for (const replaceExisting of [false, true]) {
        const step: ReturnType<typeof getHostAddGuide>["steps"][number] =
          getHostAddGuide({
            oneuptimeUrl: URL,
            apiKey: KEY,
            option,
            replaceExisting,
          }).steps[0]!;

        expect(DASHBOARD_EN[step.title]).toBeDefined();
        expect(DASHBOARD_EN[step.description!]).toBe(step.description);
        expect(step.description).toContain(
          option === "windows" ? "PowerShell" : "sudo",
        );
      }
    }
  });

  test("opens on a host's own system", () => {
    expect(getHostAddOptionForOsType(HostCollectorOsType.Windows)).toBe(
      "windows",
    );
    expect(getHostAddOptionForOsType(HostCollectorOsType.MacOS)).toBe("darwin");
    expect(getHostAddOptionForOsType(null)).toBe("linux");
  });

  test.each([
    ["linux", HostCollectorOsType.Linux, "bash"],
    ["windows", HostCollectorOsType.Windows, "powershell"],
    ["darwin", HostCollectorOsType.MacOS, "bash"],
  ] as Array<["linux" | "windows" | "darwin", HostCollectorOsType, string]>)(
    "%s: one step, the command for the system, with the key",
    (
      option: "linux" | "windows" | "darwin",
      osType: HostCollectorOsType,
      language: string,
    ) => {
      const command: string = getHostCollectorInstallCommand({
        osType,
        oneuptimeUrl: URL,
        ingestionKey: KEY,
      });

      expect(
        getHostAddCommand({ oneuptimeUrl: URL, apiKey: KEY, option }),
      ).toBe(command);

      const guide: ReturnType<typeof getHostAddGuide> = getHostAddGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        option,
      });

      expect(guide.steps.length).toBe(1);
      expect(guide.steps[0]!.markdown).toContain(
        `\`\`\`${language}\n${command}\n\`\`\``,
      );
      expect(guide.links).toEqual([
        { title: "Hosts documentation", url: "/docs/telemetry/hosts" },
      ]);

      const troubleshooting: string = (guide.troubleshooting || [])
        .map((topic: { markdown: string }): string => {
          return topic.markdown;
        })
        .join("\n");
      expect(troubleshooting).toContain(
        getHostCollectorServiceCommands(osType).logs,
      );
    },
  );

  test("tells the reader to pick a key while the placeholder is in the command", () => {
    const guide: ReturnType<typeof getHostAddGuide> = getHostAddGuide({
      oneuptimeUrl: URL,
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      option: "linux",
    });

    // A note under the command, in the reader's language - not in its code.
    expect(guide.steps[0]!.note).toBe(HOST_ADD_PLACEHOLDER_NOTE);
    expect(guide.steps[0]!.markdown).not.toContain("Pick an ingestion key");
    expect(guide.steps[0]!.markdown).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    // The note names the placeholder the command holds.
    expect(HOST_ADD_PLACEHOLDER_NOTE).toContain(
      `\`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\``,
    );
    expect(DASHBOARD_EN[HOST_ADD_PLACEHOLDER_NOTE]).toBe(
      HOST_ADD_PLACEHOLDER_NOTE,
    );

    // A key picked: no note.
    expect(
      getHostAddGuide({ oneuptimeUrl: URL, apiKey: KEY, option: "linux" })
        .steps[0]!.note,
    ).toBeUndefined();
  });

  test("a host set up by hand is handed over with the command that stops the old collector", () => {
    const guide: ReturnType<typeof getHostAddGuide> = getHostAddGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      option: "linux",
      replaceExisting: true,
    });

    expect(guide.steps[0]!.markdown).toContain("--replace-existing");
    expect(guide.steps[0]!.description).toContain(
      "It also stops the collector installed by hand (otelcol-contrib)",
    );
  });
});

describe("a command on screen", () => {
  function join(parts: Array<CommandDisplayPart>): string {
    return parts
      .map((part: CommandDisplayPart): string => {
        return part.text;
      })
      .join("");
  }

  function keptWhole(command: string): Array<string> {
    return splitCommandForDisplay(command)
      .filter((part: CommandDisplayPart): boolean => {
        return part.isKeptWhole;
      })
      .map((part: CommandDisplayPart): string => {
        return part.text;
      });
  }

  test("is the command, character for character", () => {
    for (const command of [
      "sudo systemctl status oneuptime-collector",
      "curl -fsSL https://oneuptime.example.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --uninstall",
      "Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'oneuptime-collector' } -MaxEvents 50 | Format-List TimeCreated, Message",
      "  two  spaces\tand a tab\nand a line  ",
      "",
      " ",
    ]) {
      expect(join(splitCommandForDisplay(command))).toBe(command);
    }
  });

  test("keeps every word of a line whole, so it breaks only at a space", () => {
    expect(keptWhole("sudo sh -s -- --uninstall")).toEqual([
      "sudo",
      "sh",
      "-s",
      "--",
      "--uninstall",
    ]);
    expect(keptWhole("sudo journalctl -u oneuptime-collector -n 50")).toContain(
      "oneuptime-collector",
    );
    // Spaces are where a line may break: never kept whole.
    expect(
      splitCommandForDisplay("a  b").map((part: CommandDisplayPart): string => {
        return `${part.text}:${part.isKeptWhole}`;
      }),
    ).toEqual(["a:true", "  :false", "b:true"]);
  });

  test("lets a word longer than a phone's line break where it must", () => {
    const address: string =
      "https://oneuptime.example.com/docs/static/scripts/host-collector/install.sh";

    expect(address.length).toBeGreaterThan(COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH);
    expect(keptWhole(`curl -fsSL ${address}`)).toEqual(["curl", "-fsSL"]);
    expect(
      keptWhole("x".repeat(COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH)),
    ).toHaveLength(1);
    expect(
      keptWhole("x".repeat(COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH + 1)),
    ).toHaveLength(0);
  });

  test("is split quickly, however long the command", () => {
    for (const command of [
      "a ".repeat(200000),
      "-".repeat(400000),
      " \t\n".repeat(130000),
    ]) {
      expect(
        fastestRun({
          run: (): number => {
            return splitCommandForDisplay(command).length;
          },
          limitInMs: 2000,
        }).inMs,
      ).toBeLessThan(2000);
    }
  });
});
