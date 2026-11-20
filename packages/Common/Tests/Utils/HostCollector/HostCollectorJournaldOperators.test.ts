import { describe, expect, test } from "@jest/globals";
import yaml from "js-yaml";
import HostCollectorConfigPolicy from "../../../Server/Utils/HostCollector/HostCollectorConfigPolicy";
import { HostCollectorOsType } from "../../../Types/HostCollector/HostCollector";
import {
  ALL_HOST_FEATURES,
  JOURNALD_RECEIVER,
  JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
  UNKNOWN_HOST_FEATURES,
  getHostCollectorDefaultConfig,
} from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import {
  JournaldOperatorsState,
  addJournaldOperators,
  checkJournaldOperators,
  getDefaultJournaldOperators,
} from "../../../Utils/HostCollector/HostCollectorJournaldOperators";

/*
 * A COLLECTOR CONFIG WITHOUT THE JOURNALD OPERATORS SAYS WHAT THAT COSTS,
 * AND THEY ARE ADDED WITHOUT TOUCHING THE REST OF IT (#10127).
 *
 * A Linux Collector Config a project wrote before #9926 has a journald
 * receiver with no operators: its hosts send each journal line as the
 * whole entry, under no unit, so a failed systemd unit cannot say why. The
 * config's page reads that from its YAML, and offers OneUptime's operators
 * - added into the person's own text, every other line and comment as
 * they wrote it, read back to hold exactly the default's operators before
 * it is offered. A receiver with operators of its own is never rewritten.
 */

type Config = Record<string, unknown>;

function read(text: string): Config {
  return yaml.load(text, { schema: yaml.CORE_SCHEMA, json: false }) as Config;
}

function receiversOf(text: string): Record<string, Config | null> {
  return read(text)["receivers"] as Record<string, Config | null>;
}

// Every line of `before` is in `after`, in order: nothing removed or reworded.
function keepsEveryLine(before: string, after: string): boolean {
  const afterLines: Array<string> = after.split(/\r?\n/);
  let at: number = 0;

  for (const line of before.split(/\r?\n/)) {
    const found: number = afterLines.indexOf(line, at);

    if (found === -1) {
      return false;
    }

    at = found + 1;
  }

  return true;
}

// A project's own Linux config, as people wrote them before #9926.
const OWN_CONFIG: string = `# Our Linux hosts: metrics, and the journal of our services.
receivers:
  host_metrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:

  # The services we run, warnings and above.
  journald:
    units: [nginx.service, checkout.service]
    priority: warning

  systemd:
    collection_interval: 30s
    units: ["*.service"]

processors:
  resource_detection:
    detectors: [system, env]
  batch:

exporters:
  otlp_http/oneuptime:
    endpoint: \${env:ONEUPTIME_URL}/otlp
    headers:
      x-oneuptime-token: \${env:ONEUPTIME_INGESTION_KEY}

service:
  pipelines:
    metrics:
      receivers: [host_metrics, systemd]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]
    logs:
      receivers: [journald]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]
`;

describe("what a config's journald receiver costs", () => {
  test("OneUptime's default for Linux files each line under its unit", () => {
    expect(
      checkJournaldOperators(
        getHostCollectorDefaultConfig(
          HostCollectorOsType.Linux,
          ALL_HOST_FEATURES,
        ),
      ),
    ).toEqual({ state: JournaldOperatorsState.FilesUnderUnit, receivers: [] });
  });

  test("a config that reads no journal misses nothing", () => {
    for (const config of [
      getHostCollectorDefaultConfig(
        HostCollectorOsType.Linux,
        UNKNOWN_HOST_FEATURES,
      ),
      getHostCollectorDefaultConfig(HostCollectorOsType.Windows),
      getHostCollectorDefaultConfig(HostCollectorOsType.MacOS),
    ]) {
      expect(checkJournaldOperators(config).state).toBe(
        JournaldOperatorsState.NoJournal,
      );
    }
  });

  test("a journald receiver with no operators is flagged, by its name", () => {
    expect(checkJournaldOperators(OWN_CONFIG)).toEqual({
      state: JournaldOperatorsState.Missing,
      receivers: ["journald"],
    });
  });

  test("so is an empty receiver, and an empty list of operators", () => {
    expect(
      checkJournaldOperators("receivers:\n  journald:\n").receivers,
    ).toEqual(["journald"]);
    expect(checkJournaldOperators("receivers:\n  journald: null\n").state).toBe(
      JournaldOperatorsState.Missing,
    );
    expect(
      checkJournaldOperators(
        "receivers:\n  journald:\n    priority: info\n    operators: []\n",
      ).state,
    ).toBe(JournaldOperatorsState.Missing);
  });

  test("each named journald receiver is read, and only those that miss them are named", () => {
    const withDefault: string = getHostCollectorDefaultConfig(
      HostCollectorOsType.Linux,
      ALL_HOST_FEATURES,
    ).replace(
      "receivers:\n",
      "receivers:\n  journald/kernel:\n    matches:\n      - _TRANSPORT: kernel\n\n",
    );

    expect(checkJournaldOperators(withDefault)).toEqual({
      state: JournaldOperatorsState.Missing,
      receivers: ["journald/kernel"],
    });
  });

  test("operators of a person's own that file no line under its unit say so", () => {
    const own: string = `receivers:
  journald:
    operators:
      - type: json_parser
        parse_from: body.MESSAGE
`;

    expect(checkJournaldOperators(own)).toEqual({
      state: JournaldOperatorsState.OwnOperators,
      receivers: ["journald"],
    });
  });

  test("operators of a person's own that do file each line under its unit are left in peace", () => {
    const own: string = `receivers:
  journald:
    operators:
      - type: move
        from: body._SYSTEMD_UNIT
        to: attributes["${JOURNALD_SYSTEMD_UNIT_ATTRIBUTE}"]
`;

    expect(checkJournaldOperators(own).state).toBe(
      JournaldOperatorsState.FilesUnderUnit,
    );
  });

  test("a config that does not read says nothing: its editor says why", () => {
    for (const config of [
      "",
      "receivers: [",
      "just a sentence",
      "receivers:\n  journald:\n  journald:\n",
      null,
      undefined,
    ]) {
      expect(checkJournaldOperators(config).state).toBe(
        JournaldOperatorsState.Unreadable,
      );
    }
  });
});

describe("adding OneUptime's operators to a config's own text", () => {
  const added: string = addJournaldOperators(OWN_CONFIG)!;

  test("the receiver gets exactly the default's operators", () => {
    expect(added).not.toBeNull();
    expect(receiversOf(added)["journald"]!["operators"]).toEqual(
      getDefaultJournaldOperators(),
    );
    // The default's are the ones its own config sends with.
    expect(getDefaultJournaldOperators()).toEqual(
      (receiversOf(`receivers:\n${JOURNALD_RECEIVER}\n`)["journald"] as Config)[
        "operators"
      ],
    );
    expect(getDefaultJournaldOperators().length).toBeGreaterThan(5);
  });

  test("nothing else of the config changes: its keys, values, other receivers and pipelines", () => {
    const before: Config = read(OWN_CONFIG);
    const after: Config = read(added);
    const journald: Config = {
      ...(after["receivers"] as Record<string, Config>)["journald"]!,
    };

    delete journald["operators"];

    expect(journald).toEqual({
      units: ["nginx.service", "checkout.service"],
      priority: "warning",
    });
    expect({ ...after, receivers: undefined }).toEqual({
      ...before,
      receivers: undefined,
    });
    expect(
      (after["receivers"] as Record<string, Config>)["host_metrics"],
    ).toEqual((before["receivers"] as Record<string, Config>)["host_metrics"]);
    expect((after["receivers"] as Record<string, Config>)["systemd"]).toEqual(
      (before["receivers"] as Record<string, Config>)["systemd"],
    );
  });

  test("every line the person wrote stays, comments included, in its place", () => {
    expect(keepsEveryLine(OWN_CONFIG, added)).toBe(true);
    expect(added).toContain(
      "# Our Linux hosts: metrics, and the journal of our services.",
    );
    expect(added).toContain("  # The services we run, warnings and above.");
    // The operators go under the receiver, before the next receiver.
    expect(added.indexOf("    operators:")).toBeGreaterThan(
      added.indexOf("    priority: warning"),
    );
    expect(added.indexOf("    operators:")).toBeLessThan(
      added.indexOf("  systemd:"),
    );
    // With the default's own comments, so the person reads what each does.
    expect(added).toContain(
      "      # Why a unit failed, in systemd's words: its result and how its process ended.",
    );
  });

  test("the config with them added passes the check every save makes", () => {
    expect(HostCollectorConfigPolicy.check(added)).toEqual({
      isValid: true,
      problems: [],
    });
  });

  test("once added, nothing is flagged or offered again", () => {
    expect(checkJournaldOperators(added).state).toBe(
      JournaldOperatorsState.FilesUnderUnit,
    );
    expect(addJournaldOperators(added)).toBeNull();
  });

  test("an empty receiver, and one written as null, become the block the operators go in", () => {
    for (const receiver of [
      "  journald:",
      "  journald: null",
      "  journald: ~",
    ]) {
      const config: string = `receivers:\n${receiver}\nservice:\n  pipelines: {}\n`;
      const result: string | null = addJournaldOperators(config);

      expect({ receiver, added: result !== null }).toEqual({
        receiver,
        added: true,
      });
      expect(receiversOf(result!)["journald"]).toEqual({
        operators: getDefaultJournaldOperators(),
      });
    }
  });

  test("a config indented by four spaces gets its operators at its own depth", () => {
    const config: string =
      "receivers:\n    journald:\n        priority: info\n\nservice:\n    pipelines: {}\n";
    const result: string = addJournaldOperators(config)!;

    expect(result).toContain("\n        operators:\n");
    expect(receiversOf(result)["journald"]).toEqual({
      priority: "info",
      operators: getDefaultJournaldOperators(),
    });
  });

  test("every journald receiver that misses them gets them; one that has them keeps its own", () => {
    const config: string = `receivers:
  journald/system:
    priority: info
  journald/kernel:
    matches:
      - _TRANSPORT: kernel
  journald/app:
    operators:
      - type: move
        from: body._SYSTEMD_UNIT
        to: attributes["systemd.unit.name"]
`;
    const result: string = addJournaldOperators(config)!;
    const receivers: Record<string, Config | null> = receiversOf(result);

    expect(receivers["journald/system"]!["operators"]).toEqual(
      getDefaultJournaldOperators(),
    );
    expect(receivers["journald/kernel"]!["operators"]).toEqual(
      getDefaultJournaldOperators(),
    );
    expect(receivers["journald/app"]).toEqual(
      receiversOf(config)["journald/app"],
    );
    expect(keepsEveryLine(config, result)).toBe(true);
  });

  test("a config with Windows line ends keeps them", () => {
    const config: string = OWN_CONFIG.split("\n").join("\r\n");
    const result: string = addJournaldOperators(config)!;

    expect(result).not.toBeNull();
    expect(result.split("\r\n").length).toBe(result.split("\n").length);
    expect(receiversOf(result)["journald"]!["operators"]).toEqual(
      getDefaultJournaldOperators(),
    );
  });

  test("a comment after the receiver, at the receivers' depth, stays after the operators", () => {
    const config: string = `receivers:
  journald:
    priority: info
  # Next: the units' states.
  systemd:
    units: ["*.service"]
`;
    const result: string = addJournaldOperators(config)!;

    expect(result.indexOf("  # Next: the units' states.")).toBeGreaterThan(
      result.lastIndexOf("on_error: send_quiet"),
    );
  });
});

describe("what is never rewritten for someone", () => {
  test.each([
    [
      "operators of their own",
      "receivers:\n  journald:\n    operators:\n      - type: json_parser\n        parse_from: body.MESSAGE\n",
    ],
    [
      "a receiver written on one line",
      "receivers:\n  journald: { priority: info }\n",
    ],
    ["an alias", "x: &j\n  priority: info\nreceivers:\n  journald: *j\n"],
    [
      "an operators key with nothing under it",
      "receivers:\n  journald:\n    operators:\n",
    ],
    ["receivers written on one line", "receivers: { journald: {} }\n"],
    ["a tab in the config", "receivers:\n  journald:\n\tpriority: info\n"],
    [
      "a config that reads no journal",
      getHostCollectorDefaultConfig(HostCollectorOsType.Windows),
    ],
    [
      "OneUptime's default",
      getHostCollectorDefaultConfig(HostCollectorOsType.Linux),
    ],
    ["a config that does not read", "receivers: ["],
  ])("%s: nothing is offered", (_name: string, config: string) => {
    expect(addJournaldOperators(config)).toBeNull();
  });
});
