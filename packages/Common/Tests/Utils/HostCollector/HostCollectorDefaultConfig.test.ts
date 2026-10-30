import {
  ALL_HOST_FEATURES,
  HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES,
  HOST_COLLECTOR_FILESYSTEM_EXCLUSION,
  HostCollectorHostFeatures,
  UNKNOWN_HOST_FEATURES,
  getHostCollectorDefaultConfig,
  hostCollectorHostFeaturesFromText,
  hostCollectorHostFeaturesToText,
  readHostCollectorHostFeatures,
} from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import {
  HOST_COLLECTOR_EXPORTER_ENDPOINT,
  HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
  HostCollectorOsType,
} from "../../../Types/HostCollector/HostCollector";
import HostCollectorConfigPolicy, {
  HostCollectorConfigCheckResult,
} from "../../../Server/Utils/HostCollector/HostCollectorConfigPolicy";
import yaml from "js-yaml";
import { describe, expect, test } from "@jest/globals";

/*
 * OneUptime's default config for each system: what a host runs when no
 * Collector Config applies to it, and what a new Collector Config starts
 * from. Every default must pass the rules OneUptime holds configs to, send
 * only to the host's own OneUptime with its own key, and on Linux read only
 * what the host has - a receiver that cannot start stops the collector.
 */

interface Pipeline {
  receivers: Array<string>;
  processors?: Array<string>;
  exporters: Array<string>;
}

interface ParsedConfig {
  receivers: Record<string, unknown>;
  processors: Record<string, unknown>;
  exporters: Record<string, Record<string, unknown>>;
  service: { pipelines: Record<string, Pipeline> };
}

function parse(text: string): ParsedConfig {
  return yaml.load(text, { schema: yaml.CORE_SCHEMA }) as ParsedConfig;
}

const LINUX_FEATURE_SETS: Array<[string, HostCollectorHostFeatures]> = [
  ["nothing", { journald: false, systemd: false }],
  ["the journal", { journald: true, systemd: false }],
  ["systemd units", { journald: false, systemd: true }],
  ["both", { journald: true, systemd: true }],
];

function everyDefault(): Array<[string, string]> {
  return [
    ...LINUX_FEATURE_SETS.map(
      ([label, features]: [string, HostCollectorHostFeatures]): [
        string,
        string,
      ] => {
        return [
          `Linux with ${label}`,
          getHostCollectorDefaultConfig(HostCollectorOsType.Linux, features),
        ];
      },
    ),
    ["Windows", getHostCollectorDefaultConfig(HostCollectorOsType.Windows)],
    ["macOS", getHostCollectorDefaultConfig(HostCollectorOsType.MacOS)],
    ["any system", getHostCollectorDefaultConfig(HostCollectorOsType.Any)],
  ];
}

describe("every default config", () => {
  test.each(everyDefault())(
    "%s passes the rules every config OneUptime sends is held to",
    (_label: string, text: string) => {
      const result: HostCollectorConfigCheckResult =
        HostCollectorConfigPolicy.check(text);

      expect(result.problems).toEqual([]);
      expect(result.isValid).toBe(true);
    },
  );

  test.each(everyDefault())(
    "%s sends every pipeline to this OneUptime only, with the host's own key",
    (_label: string, text: string) => {
      const config: ParsedConfig = parse(text);

      expect(Object.keys(config.exporters)).toEqual(["otlp_http/oneuptime"]);
      expect(config.exporters["otlp_http/oneuptime"]).toEqual({
        endpoint: HOST_COLLECTOR_EXPORTER_ENDPOINT,
        headers: {
          "x-oneuptime-token": HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
        },
      });

      for (const pipeline of Object.values(config.service.pipelines)) {
        expect(pipeline.exporters).toEqual(["otlp_http/oneuptime"]);
        // host.name, host.id and os.type file everything under the host.
        expect(pipeline.processors).toEqual(["resource_detection", "batch"]);
      }
    },
  );

  test.each(everyDefault())(
    "%s holds no key, no address and no file of its own",
    (_label: string, text: string) => {
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toContain("${file:");
      expect(text).not.toContain("_file:");
    },
  );

  test("each system's default reads host metrics", () => {
    for (const [, text] of everyDefault()) {
      const config: ParsedConfig = parse(text);
      expect(config.service.pipelines["metrics"]?.receivers).toContain(
        "host_metrics",
      );
    }
  });

  /*
   * Read-only images (snap packages on Ubuntu, CDs, DVDs and ISO images) and
   * macOS's /dev are 100% used for as long as they are mounted. The default
   * used to measure them, so High Filesystem Usage fired on every Ubuntu host
   * with a snap and on every Mac, and never recovered.
   */
  test.each(everyDefault())(
    "%s leaves the file systems that are full by design out of the filesystem scraper",
    (_label: string, text: string) => {
      const config: ParsedConfig = parse(text);
      const filesystem: Record<string, unknown> = (
        (config.receivers["host_metrics"] as Record<string, unknown>)[
          "scrapers"
        ] as Record<string, Record<string, unknown>>
      )["filesystem"]!;

      expect(filesystem["exclude_fs_types"]).toEqual({
        fs_types: [...HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES],
        match_type: "strict",
      });
      /*
       * An exclusion, not an allowlist: every other file system the scraper
       * reports (ext4, XFS, APFS, NTFS, ReFS, ...) is still measured.
       */
      expect(Object.keys(filesystem).sort()).toEqual([
        "exclude_fs_types",
        "metrics",
      ]);
      // The template still reads the utilization of every other mount.
      expect(filesystem["metrics"]).toEqual({
        "system.filesystem.utilization": { enabled: true },
      });
    },
  );
});

describe("the file systems every default leaves out", () => {
  test.each([
    ["snap packages on Linux", "squashfs"],
    ["CDs and ISO images on Linux, cloud-init config drives", "iso9660"],
    ["DVDs on Linux and macOS", "udf"],
    ["read-only EROFS images", "erofs"],
    ["/dev on macOS", "devfs"],
    ["the automounter's maps, which macOS lists", "autofs"],
    ["CDs and ISO images on macOS", "cd9660"],
    ["CDs on Windows", "CDFS"],
    ["DVDs on Windows", "UDF"],
  ])("%s (%s)", (_what: string, fsType: string) => {
    expect(HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES).toContain(fsType);
  });

  test("are only those: a file system that holds data is always measured", () => {
    expect([...HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES].sort()).toEqual(
      [
        "autofs",
        "cd9660",
        "CDFS",
        "devfs",
        "erofs",
        "iso9660",
        "squashfs",
        "udf",
        "UDF",
      ].sort(),
    );
    for (const holdsData of [
      "ext4",
      "xfs",
      "btrfs",
      "zfs",
      "vfat",
      "apfs",
      "hfs",
      "NTFS",
      "ReFS",
      "FAT32",
      "nfs",
    ]) {
      expect(HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES).not.toContain(holdsData);
    }
  });

  test("the block every config carries is valid YAML with the exclusion, comments aside", () => {
    const parsed: Record<string, unknown> = yaml.load(
      `filesystem:\n${HOST_COLLECTOR_FILESYSTEM_EXCLUSION}`,
      { schema: yaml.CORE_SCHEMA },
    ) as Record<string, unknown>;

    expect(parsed).toEqual({
      filesystem: {
        exclude_fs_types: {
          fs_types: [...HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES],
          match_type: "strict",
        },
      },
    });
  });
});

describe("Linux reads what the host has", () => {
  test("the journal only where the installer found journalctl and a journal", () => {
    const withJournal: ParsedConfig = parse(
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux, {
        journald: true,
        systemd: false,
      }),
    );
    const without: ParsedConfig = parse(
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux, {
        journald: false,
        systemd: false,
      }),
    );

    expect(Object.keys(withJournal.receivers)).toContain("journald");
    expect(withJournal.service.pipelines["logs"]?.receivers).toEqual([
      "journald",
    ]);

    expect(Object.keys(without.receivers)).not.toContain("journald");
    expect(without.service.pipelines["logs"]).toBeUndefined();
  });

  test("systemd units only where the installer found the system bus", () => {
    const withUnits: ParsedConfig = parse(
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux, {
        journald: false,
        systemd: true,
      }),
    );
    const without: ParsedConfig = parse(
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux, {
        journald: false,
        systemd: false,
      }),
    );

    expect(withUnits.service.pipelines["metrics"]?.receivers).toEqual([
      "host_metrics",
      "systemd",
    ]);
    expect(without.service.pipelines["metrics"]?.receivers).toEqual([
      "host_metrics",
    ]);
    expect(Object.keys(without.receivers)).not.toContain("systemd");
  });

  test("a new Collector Config for Linux starts from everything; a host OneUptime knows nothing about reads host metrics only", () => {
    expect(getHostCollectorDefaultConfig(HostCollectorOsType.Linux)).toBe(
      getHostCollectorDefaultConfig(
        HostCollectorOsType.Linux,
        ALL_HOST_FEATURES,
      ),
    );
    expect(UNKNOWN_HOST_FEATURES).toEqual({ journald: false, systemd: false });
    expect(
      Object.keys(
        parse(
          getHostCollectorDefaultConfig(
            HostCollectorOsType.Linux,
            UNKNOWN_HOST_FEATURES,
          ),
        ).receivers,
      ),
    ).toEqual(["host_metrics"]);
  });
});

describe("Windows and macOS", () => {
  test("Windows reads the System, Application and Security logs and its services", () => {
    const config: ParsedConfig = parse(
      getHostCollectorDefaultConfig(HostCollectorOsType.Windows),
    );

    expect(Object.keys(config.receivers).sort()).toEqual([
      "host_metrics",
      "windows_event_log/application",
      "windows_event_log/security",
      "windows_event_log/system",
      "windows_service",
    ]);
    expect(config.service.pipelines["logs"]?.receivers).toEqual([
      "windows_event_log/system",
      "windows_event_log/application",
      "windows_event_log/security",
    ]);
  });

  test("macOS reads the install and Wi-Fi logs", () => {
    const config: ParsedConfig = parse(
      getHostCollectorDefaultConfig(HostCollectorOsType.MacOS),
    );

    expect(config.receivers["file_log/system"]).toEqual({
      include: ["/var/log/install.log", "/var/log/wifi.log"],
      start_at: "end",
    });
  });

  test("a host whose system is not known gets what every system can run", () => {
    expect(getHostCollectorDefaultConfig(null)).toBe(
      getHostCollectorDefaultConfig(HostCollectorOsType.Any),
    );
    expect(getHostCollectorDefaultConfig(undefined)).toBe(
      getHostCollectorDefaultConfig(HostCollectorOsType.Any),
    );
    expect(
      Object.keys(
        parse(getHostCollectorDefaultConfig(HostCollectorOsType.Any)).receivers,
      ),
    ).toEqual(["host_metrics"]);
  });
});

describe("what the installer found on a host", () => {
  test("is read from the supervisor's description, true or false", () => {
    expect(
      readHostCollectorHostFeatures({ journald: "true", systemd: "false" }),
    ).toEqual({ journald: true, systemd: false });
    expect(
      readHostCollectorHostFeatures({ journald: "false", systemd: "true" }),
    ).toEqual({ journald: false, systemd: true });
    // Anything but "true" is false.
    expect(
      readHostCollectorHostFeatures({ journald: "yes", systemd: undefined }),
    ).toEqual({ journald: false, systemd: false });
  });

  test("a supervisor OneUptime's installer did not set up says nothing", () => {
    expect(
      readHostCollectorHostFeatures({ journald: null, systemd: undefined }),
    ).toBeNull();
  });

  test("is stored as a short list, and read back the same", () => {
    for (const [, features] of LINUX_FEATURE_SETS) {
      expect(
        hostCollectorHostFeaturesFromText(
          hostCollectorHostFeaturesToText(features),
        ),
      ).toEqual(features);
    }

    expect(hostCollectorHostFeaturesToText(ALL_HOST_FEATURES)).toBe(
      "journald,systemd",
    );
    expect(hostCollectorHostFeaturesToText(UNKNOWN_HOST_FEATURES)).toBe("");
    expect(hostCollectorHostFeaturesFromText(" systemd , journald ")).toEqual(
      ALL_HOST_FEATURES,
    );
    expect(hostCollectorHostFeaturesFromText(null)).toBeNull();
    expect(hostCollectorHostFeaturesFromText(undefined)).toBeNull();
  });
});
