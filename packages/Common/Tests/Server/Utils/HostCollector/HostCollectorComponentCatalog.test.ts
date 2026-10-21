import {
  FILE_SETTINGS_ALLOWED,
  FORBIDDEN_COMPONENT_SETTINGS,
  HostCollectorComponentKind,
  getAllowedComponentNames,
  getAllowedComponentType,
  isForbiddenFileSetting,
} from "../../../../Server/Utils/HostCollector/HostCollectorComponentCatalog";
import {
  getHostCollectorConfigHash,
  hostCollectorConfigHashFromBytes,
  hostCollectorConfigHashToBytes,
} from "../../../../Server/Utils/HostCollector/HostCollectorConfigHash";
import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * The components a config OneUptime sends to hosts may use: an allowlist
 * per kind, so a component a new collector release adds is refused until
 * someone has looked at it. Both spellings of an allowed component work:
 * release 0.161.0 renamed many (hostmetrics became host_metrics) and still
 * reads the old names most configs in the wild use.
 */

describe("the allowlist", () => {
  test.each([
    [HostCollectorComponentKind.Receiver, "hostmetrics", "host_metrics"],
    [HostCollectorComponentKind.Receiver, "host_metrics", "host_metrics"],
    [HostCollectorComponentKind.Receiver, "filelog", "file_log"],
    [
      HostCollectorComponentKind.Receiver,
      "windowseventlog",
      "windows_event_log",
    ],
    [HostCollectorComponentKind.Receiver, "journald", "journald"],
    [HostCollectorComponentKind.Receiver, "otlp", "otlp"],
    [
      HostCollectorComponentKind.Processor,
      "resourcedetection",
      "resource_detection",
    ],
    [HostCollectorComponentKind.Processor, "batch", "batch"],
    [HostCollectorComponentKind.Exporter, "otlphttp", "otlp_http"],
    [HostCollectorComponentKind.Exporter, "otlp_http", "otlp_http"],
    [HostCollectorComponentKind.Extension, "file_storage", "file_storage"],
    [HostCollectorComponentKind.Connector, "spanmetrics", "span_metrics"],
  ])(
    "%s: %s is %s",
    (kind: HostCollectorComponentKind, name: string, expected: string) => {
      expect(getAllowedComponentType(kind, name)).toBe(expected);
    },
  );

  test.each([
    [HostCollectorComponentKind.Receiver, "receiver_creator"],
    [HostCollectorComponentKind.Receiver, "receivercreator"],
    [HostCollectorComponentKind.Receiver, "sql_query"],
    [HostCollectorComponentKind.Receiver, "prometheus"],
    [HostCollectorComponentKind.Receiver, "k8s_cluster"],
    [HostCollectorComponentKind.Receiver, "aws_ecs_container_metrics"],
    [HostCollectorComponentKind.Processor, "k8s_attributes"],
    [HostCollectorComponentKind.Processor, "remotetap"],
    [HostCollectorComponentKind.Exporter, "otlp"],
    [HostCollectorComponentKind.Exporter, "file"],
    [HostCollectorComponentKind.Exporter, "kafka"],
    [HostCollectorComponentKind.Extension, "opamp"],
    [HostCollectorComponentKind.Extension, "pprof"],
    [HostCollectorComponentKind.Extension, "zpages"],
    [HostCollectorComponentKind.Extension, "oauth2client"],
    [HostCollectorComponentKind.Connector, "otlp"],
  ])(
    "%s: %s is not allowed",
    (kind: HostCollectorComponentKind, name: string) => {
      expect(getAllowedComponentType(kind, name)).toBeNull();
    },
  );

  test("a name is allowed only in its own kind", () => {
    expect(
      getAllowedComponentType(
        HostCollectorComponentKind.Exporter,
        "host_metrics",
      ),
    ).toBeNull();
    expect(
      getAllowedComponentType(HostCollectorComponentKind.Receiver, "otlp_http"),
    ).toBeNull();
    expect(
      getAllowedComponentType(HostCollectorComponentKind.Receiver, "batch"),
    ).toBeNull();
  });

  test("names are matched exactly", () => {
    expect(
      getAllowedComponentType(
        HostCollectorComponentKind.Receiver,
        "HostMetrics",
      ),
    ).toBeNull();
    expect(
      getAllowedComponentType(
        HostCollectorComponentKind.Receiver,
        "host_metrics ",
      ),
    ).toBeNull();
    expect(
      getAllowedComponentType(HostCollectorComponentKind.Receiver, ""),
    ).toBeNull();
    expect(
      getAllowedComponentType(
        HostCollectorComponentKind.Receiver,
        "constructor",
      ),
    ).toBeNull();
    expect(
      getAllowedComponentType(HostCollectorComponentKind.Receiver, "__proto__"),
    ).toBeNull();
  });

  test("the only exporters are otlphttp, debug and nop", () => {
    expect(
      getAllowedComponentNames(HostCollectorComponentKind.Exporter),
    ).toEqual(["otlp_http", "debug", "nop"]);
  });

  test("the only extensions are health_check and file_storage", () => {
    expect(
      getAllowedComponentNames(HostCollectorComponentKind.Extension),
    ).toEqual(["health_check", "file_storage"]);
  });

  test("each kind lists each component once, by its 0.161.0 name", () => {
    for (const kind of Object.values(HostCollectorComponentKind)) {
      const names: Array<string> = getAllowedComponentNames(kind);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) {
        expect(getAllowedComponentType(kind, name)).toBe(name);
      }
    }
  });
});

describe("settings no config may use", () => {
  test("journald may not run another program, nor read another root", () => {
    expect(FORBIDDEN_COMPONENT_SETTINGS["journald"]).toEqual([
      "journalctl_path",
      "root_path",
    ]);
  });

  test("file_storage keeps its queues where the installer made room for them", () => {
    expect(FORBIDDEN_COMPONENT_SETTINGS["file_storage"]).toEqual(["directory"]);
  });

  test.each([
    ["password_file"],
    ["bearer_token_file"],
    ["token_file"],
    ["credentials_file"],
    ["credentials_files"],
    ["file_sd_configs"],
    ["http_sd_configs"],
  ])("%s sends what a file holds", (setting: string) => {
    expect(isForbiddenFileSetting(setting)).toBe(true);
  });

  test("TLS files are for the handshake and stay allowed", () => {
    for (const setting of FILE_SETTINGS_ALLOWED) {
      expect(isForbiddenFileSetting(setting)).toBe(false);
    }
    expect([...FILE_SETTINGS_ALLOWED].sort()).toEqual([
      "ca_file",
      "cert_file",
      "client_ca_file",
      "key_file",
    ]);
  });

  test.each([["include"], ["file_log"], ["filename"], ["profile"]])(
    "%s is not a file setting",
    (setting: string) => {
      expect(isForbiddenFileSetting(setting)).toBe(false);
    },
  );
});

describe("the hash of a config", () => {
  test("is SHA-256 of its exact bytes, as 64 lowercase hex characters", () => {
    expect(getHostCollectorConfigHash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(getHostCollectorConfigHash("receivers:\n")).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(getHostCollectorConfigHash("a")).not.toBe(
      getHostCollectorConfigHash("a\n"),
    );
    // The bytes as UTF-8, which is how the config travels to the host.
    expect(getHostCollectorConfigHash("é")).toBe(
      crypto
        .createHash("sha256")
        .update(Buffer.from([0xc3, 0xa9]))
        .digest("hex"),
    );
  });

  test("travels as the 32 raw bytes OpAMP carries, and back", () => {
    const hash: string = getHostCollectorConfigHash("receivers: {}");
    const bytes: Buffer = hostCollectorConfigHashToBytes(hash);

    expect(bytes.length).toBe(32);
    expect(hostCollectorConfigHashFromBytes(new Uint8Array(bytes))).toBe(hash);
  });

  test("a hash a host reports that OneUptime could not have sent is none", () => {
    expect(hostCollectorConfigHashFromBytes(null)).toBeNull();
    expect(hostCollectorConfigHashFromBytes(undefined)).toBeNull();
    expect(hostCollectorConfigHashFromBytes(new Uint8Array())).toBeNull();
    expect(hostCollectorConfigHashFromBytes(new Uint8Array(16))).toBeNull();
    expect(hostCollectorConfigHashFromBytes(new Uint8Array(33))).toBeNull();
  });
});
