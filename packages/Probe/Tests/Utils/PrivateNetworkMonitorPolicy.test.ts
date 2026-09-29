import { afterEach, describe, expect, jest, test } from "@jest/globals";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import ConfigLogLevel from "Common/Server/Types/ConfigLogLevel";
import { JSONObject } from "Common/Types/JSON";
import PrivateNetworkMonitorPolicy, {
  PRIVATE_NETWORK_MONITORS_ENV_VAR,
  PRIVATE_NETWORK_MONITORS_HELM_VALUE,
  PrivateNetworkMonitorPolicyInput,
  PrivateNetworkMonitorPolicyReason,
  PrivateNetworkMonitorStartupMessage,
  ResolvedPrivateNetworkMonitorPolicy,
} from "../../Utils/PrivateNetworkMonitorPolicy";

/*
 * Regression suite for OneUptime issue #3879.
 *
 * From 13.0.0 the probe computed its private-network opt-in as
 * `!HasRegisterProbeKey && PROBE_ALLOW_PRIVATE_NETWORK_MONITORS === "true"`.
 * Every probe the Helm chart and Docker Compose bundle registers itself with
 * REGISTER_PROBE_KEY, so every one of them silently dropped
 * probes.<name>.allowPrivateNetworkMonitors: true, and API, Website, External
 * Status Page and Custom JavaScript Code monitors pointed at RFC-1918 targets
 * broke on upgrade with no way to opt back in.
 *
 * PrivateNetworkMonitorPolicy is the pure decision that replaced that one-liner.
 * These tests pin the whole of it, input by input:
 *   - which configured values count as an opt-in (exactly "true"; anything
 *     else fails closed),
 *   - which probes honor it (every probe except a global probe on a
 *     billing-enabled, open-signup instance),
 *   - what a monitor's refusal says to whoever reads it, per probe kind,
 *   - what the probe says at startup, at which log level, and that a hostile
 *     or sloppy value cannot turn that one line into several,
 *   - what the diagnostics dump records for support.
 */

const ENV_VAR: string = "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";
const HELM_VALUE: string = "probes.<name>.allowPrivateNetworkMonitors";

/*
 * The two hints 13.0.0 shipped, byte for byte. A private probe's refusal and a
 * hosted global probe's refusal must read exactly as they did before the fix:
 * only the self-hosted global probe's hint was wrong.
 */
const PRIVATE_PROBE_HINT: string =
  " Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it.";
const HOSTED_GLOBAL_PROBE_HINT: string =
  " Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.";

interface ProbeKind {
  name: string;
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
  // What an exact "true" resolves to on this kind of probe.
  reasonWhenTrue: PrivateNetworkMonitorPolicyReason;
}

const PRIVATE_PROBE: ProbeKind = {
  name: "a private probe",
  isAutoRegisteredGlobalProbe: false,
  isBillingEnabled: false,
  reasonWhenTrue: PrivateNetworkMonitorPolicyReason.Allowed,
};

/*
 * BILLING_ENABLED only restricts global probes, which every project on the
 * instance shares. A private probe belongs to the project that deployed it.
 */
const PRIVATE_PROBE_ON_BILLING_INSTANCE: ProbeKind = {
  name: "a private probe with BILLING_ENABLED=true",
  isAutoRegisteredGlobalProbe: false,
  isBillingEnabled: true,
  reasonWhenTrue: PrivateNetworkMonitorPolicyReason.Allowed,
};

// The probes bundled with the Helm chart and Docker Compose: issue #3879.
const SELF_HOSTED_GLOBAL_PROBE: ProbeKind = {
  name: "an auto-registered global probe on a self-hosted instance",
  isAutoRegisteredGlobalProbe: true,
  isBillingEnabled: false,
  reasonWhenTrue: PrivateNetworkMonitorPolicyReason.Allowed,
};

// The hosted, open-signup product: every sign-up shares these probes.
const HOSTED_GLOBAL_PROBE: ProbeKind = {
  name: "an auto-registered global probe on a billing-enabled instance",
  isAutoRegisteredGlobalProbe: true,
  isBillingEnabled: true,
  reasonWhenTrue: PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe,
};

const PROBE_KINDS: Array<ProbeKind> = [
  PRIVATE_PROBE,
  PRIVATE_PROBE_ON_BILLING_INSTANCE,
  SELF_HOSTED_GLOBAL_PROBE,
  HOSTED_GLOBAL_PROBE,
];

type ValueCategory = "notRequested" | "exactlyTrue" | "unrecognized";

interface ConfiguredValueCase {
  value: string | undefined;
  category: ValueCategory;
}

/*
 * Every value an operator plausibly writes, including the near misses that a
 * lenient parser would have accepted. Only the exact string "true" opts in;
 * only unset, "" and "false" are the quiet default.
 */
const CONFIGURED_VALUES: Array<ConfiguredValueCase> = [
  { value: undefined, category: "notRequested" },
  { value: "", category: "notRequested" },
  { value: "false", category: "notRequested" },
  { value: "true", category: "exactlyTrue" },
  { value: "TRUE", category: "unrecognized" },
  { value: "True", category: "unrecognized" },
  { value: "1", category: "unrecognized" },
  { value: "yes", category: "unrecognized" },
  { value: "on", category: "unrecognized" },
  { value: " true", category: "unrecognized" },
  { value: "true ", category: "unrecognized" },
  { value: "true\n", category: "unrecognized" },
  { value: "False", category: "unrecognized" },
  { value: "FALSE", category: "unrecognized" },
  { value: "0", category: "unrecognized" },
];

interface DecisionRow {
  configuredValue: string | undefined;
  kind: ProbeKind;
  expectedReason: PrivateNetworkMonitorPolicyReason;
  expectedAllowed: boolean;
}

function describeValue(value: string | undefined): string {
  return value === undefined ? "an unset value" : JSON.stringify(value);
}

function expectedReasonFor(
  category: ValueCategory,
  kind: ProbeKind,
): PrivateNetworkMonitorPolicyReason {
  if (category === "notRequested") {
    return PrivateNetworkMonitorPolicyReason.NotRequested;
  }

  if (category === "unrecognized") {
    return PrivateNetworkMonitorPolicyReason.UnrecognizedValue;
  }

  return kind.reasonWhenTrue;
}

function buildDecisionRows(): Array<DecisionRow> {
  const rows: Array<DecisionRow> = [];

  for (const valueCase of CONFIGURED_VALUES) {
    for (const kind of PROBE_KINDS) {
      const expectedReason: PrivateNetworkMonitorPolicyReason =
        expectedReasonFor(valueCase.category, kind);

      rows.push({
        configuredValue: valueCase.value,
        kind: kind,
        expectedReason: expectedReason,
        expectedAllowed:
          expectedReason === PrivateNetworkMonitorPolicyReason.Allowed,
      });
    }
  }

  return rows;
}

const DECISION_ROWS: Array<DecisionRow> = buildDecisionRows();

// [title, row] tuples, so each case gets its own readable test name.
const DECISION_TABLE: Array<[string, DecisionRow]> = DECISION_ROWS.map(
  (row: DecisionRow): [string, DecisionRow] => {
    return [
      `${describeValue(row.configuredValue)} on ${row.kind.name} resolves to ${row.expectedReason} (allowed: ${String(row.expectedAllowed)})`,
      row,
    ];
  },
);

function inputFor(
  configuredValue: string | undefined,
  kind: ProbeKind,
): PrivateNetworkMonitorPolicyInput {
  return {
    configuredValue: configuredValue,
    isAutoRegisteredGlobalProbe: kind.isAutoRegisteredGlobalProbe,
    isBillingEnabled: kind.isBillingEnabled,
  };
}

function resolveFor(
  configuredValue: string | undefined,
  kind: ProbeKind,
): ResolvedPrivateNetworkMonitorPolicy {
  return PrivateNetworkMonitorPolicy.resolve(inputFor(configuredValue, kind));
}

function startupMessageFor(
  configuredValue: string | undefined,
  kind: ProbeKind,
): PrivateNetworkMonitorStartupMessage {
  return PrivateNetworkMonitorPolicy.getStartupMessage(
    resolveFor(configuredValue, kind),
  );
}

function kindTable(): Array<[string, ProbeKind]> {
  return PROBE_KINDS.map((kind: ProbeKind): [string, ProbeKind] => {
    return [kind.name, kind];
  });
}

describe("PrivateNetworkMonitorPolicy.resolve decision table", () => {
  test.each(DECISION_TABLE)("%s", (_title: string, row: DecisionRow) => {
    const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
      row.configuredValue,
      row.kind,
    );

    expect(policy.allowed).toBe(row.expectedAllowed);
    expect(policy.reason).toBe(row.expectedReason);
  });

  test("the table crosses every configured value with every probe kind", () => {
    expect(DECISION_ROWS).toHaveLength(
      CONFIGURED_VALUES.length * PROBE_KINDS.length,
    );
    expect(DECISION_ROWS).toHaveLength(60);
  });

  test("the table exercises every reason the policy can give", () => {
    const reasonsSeen: Set<PrivateNetworkMonitorPolicyReason> = new Set(
      DECISION_ROWS.map(
        (row: DecisionRow): PrivateNetworkMonitorPolicyReason => {
          return row.expectedReason;
        },
      ),
    );

    expect(Array.from(reasonsSeen).sort()).toEqual(
      Object.values(PrivateNetworkMonitorPolicyReason).sort(),
    );
  });

  test("only the exact string true is ever allowed, and only on a probe that honors it", () => {
    const allowedRows: Array<DecisionRow> = DECISION_ROWS.filter(
      (row: DecisionRow): boolean => {
        return resolveFor(row.configuredValue, row.kind).allowed;
      },
    );

    expect(
      allowedRows.map((row: DecisionRow): string | undefined => {
        return row.configuredValue;
      }),
    ).toEqual(["true", "true", "true"]);
    expect(
      allowedRows.map((row: DecisionRow): string => {
        return row.kind.name;
      }),
    ).toEqual([
      PRIVATE_PROBE.name,
      PRIVATE_PROBE_ON_BILLING_INSTANCE.name,
      SELF_HOSTED_GLOBAL_PROBE.name,
    ]);
  });
});

describe("issue #3879 regression", () => {
  test("ISSUE #3879: a global probe bundled with the Helm chart or Docker Compose honors PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on a self-hosted instance", () => {
    /*
     * The exact input 13.0.0 got wrong: REGISTER_PROBE_KEY set (so the probe
     * is global), BILLING_ENABLED off (self-hosted), and the operator's
     * probes.<name>.allowPrivateNetworkMonitors: true rendered as "true".
     */
    const policy: ResolvedPrivateNetworkMonitorPolicy =
      PrivateNetworkMonitorPolicy.resolve({
        configuredValue: "true",
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: false,
      });

    expect(policy.allowed).toBe(true);
    expect(policy.reason).toBe(PrivateNetworkMonitorPolicyReason.Allowed);
    expect(policy.isAutoRegisteredGlobalProbe).toBe(true);
    expect(policy.isBillingEnabled).toBe(false);
  });

  test("ISSUE #3879: a bundled global probe stays public-only until its operator opts in", () => {
    // Fixing the opt-in must not turn private monitoring on by default.
    const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
      undefined,
      SELF_HOSTED_GLOBAL_PROBE,
    );

    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe(PrivateNetworkMonitorPolicyReason.NotRequested);
  });

  test("the false that the Helm chart and Docker Compose render by default is the quiet default, not an unrecognized value", () => {
    const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
      "false",
      SELF_HOSTED_GLOBAL_PROBE,
    );

    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe(PrivateNetworkMonitorPolicyReason.NotRequested);
    expect(PrivateNetworkMonitorPolicy.getStartupMessage(policy).level).toBe(
      "info",
    );
  });

  test("the hosted product's shared global probes still refuse the opt-in", () => {
    const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
      "true",
      HOSTED_GLOBAL_PROBE,
    );

    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe(
      PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe,
    );
  });

  test("a bundled global probe's refusal tells the operator the Helm value that was being dropped", () => {
    const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
      undefined,
      SELF_HOSTED_GLOBAL_PROBE,
    );

    expect(policy.refusalHint).toContain(HELM_VALUE);
    expect(policy.refusalHint).toContain(`${ENV_VAR}=true`);
  });
});

describe("what resolve() keeps about its input", () => {
  test("an unset value is reported as null, distinct from an empty string", () => {
    const unset: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
      undefined,
      PRIVATE_PROBE,
    );
    const empty: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
      "",
      PRIVATE_PROBE,
    );

    expect(unset.configuredValue).toBeNull();
    expect(empty.configuredValue).toBe("");
    // Both are the default policy; only what was configured differs.
    expect(unset.reason).toBe(PrivateNetworkMonitorPolicyReason.NotRequested);
    expect(empty.reason).toBe(PrivateNetworkMonitorPolicyReason.NotRequested);
  });

  test.each([["TRUE"], [" true"], ["true "], ["true\n"], ["yes"]])(
    "keeps the configured value %p verbatim, without trimming or lower-casing it",
    (value: string) => {
      expect(resolveFor(value, PRIVATE_PROBE).configuredValue).toBe(value);
    },
  );

  test.each(kindTable())(
    "passes the probe kind of %s through unchanged",
    (_name: string, kind: ProbeKind) => {
      const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
        "true",
        kind,
      );

      expect(policy.isAutoRegisteredGlobalProbe).toBe(
        kind.isAutoRegisteredGlobalProbe,
      );
      expect(policy.isBillingEnabled).toBe(kind.isBillingEnabled);
    },
  );

  test("decides from its input alone and never reads this process's environment", () => {
    const keys: Array<string> = [
      ENV_VAR,
      "REGISTER_PROBE_KEY",
      "BILLING_ENABLED",
    ];
    const originals: Array<string | undefined> = keys.map(
      (key: string): string | undefined => {
        return process.env[key];
      },
    );

    try {
      process.env[ENV_VAR] = "true";
      process.env["REGISTER_PROBE_KEY"] =
        "11111111-2222-3333-4444-555555555555";
      process.env["BILLING_ENABLED"] = "true";

      const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
        undefined,
        PRIVATE_PROBE,
      );

      expect(policy.allowed).toBe(false);
      expect(policy.reason).toBe(
        PrivateNetworkMonitorPolicyReason.NotRequested,
      );
      expect(policy.configuredValue).toBeNull();
      expect(policy.isAutoRegisteredGlobalProbe).toBe(false);
      expect(policy.isBillingEnabled).toBe(false);
    } finally {
      keys.forEach((key: string, index: number) => {
        const original: string | undefined = originals[index];
        if (original === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = original;
        }
      });
    }
  });

  test("does not modify its input and gives the same answer every time", () => {
    const input: PrivateNetworkMonitorPolicyInput = Object.freeze({
      configuredValue: "true",
      isAutoRegisteredGlobalProbe: true,
      isBillingEnabled: false,
    });

    const first: ResolvedPrivateNetworkMonitorPolicy =
      PrivateNetworkMonitorPolicy.resolve(input);
    const second: ResolvedPrivateNetworkMonitorPolicy =
      PrivateNetworkMonitorPolicy.resolve(input);

    expect(second).toEqual(first);
    expect(input).toEqual({
      configuredValue: "true",
      isAutoRegisteredGlobalProbe: true,
      isBillingEnabled: false,
    });
  });

  test.each(DECISION_TABLE)(
    "carries the refusal hint for its probe kind: %s",
    (_title: string, row: DecisionRow) => {
      expect(resolveFor(row.configuredValue, row.kind).refusalHint).toBe(
        PrivateNetworkMonitorPolicy.getRefusalHint({
          isAutoRegisteredGlobalProbe: row.kind.isAutoRegisteredGlobalProbe,
          isBillingEnabled: row.kind.isBillingEnabled,
        }),
      );
    },
  );
});

describe("refusal hints", () => {
  function hintFor(kind: ProbeKind): string {
    return PrivateNetworkMonitorPolicy.getRefusalHint({
      isAutoRegisteredGlobalProbe: kind.isAutoRegisteredGlobalProbe,
      isBillingEnabled: kind.isBillingEnabled,
    });
  }

  test.each([
    [PRIVATE_PROBE.name, PRIVATE_PROBE],
    [PRIVATE_PROBE_ON_BILLING_INSTANCE.name, PRIVATE_PROBE_ON_BILLING_INSTANCE],
  ])(
    "the hint on %s is byte-for-byte the one 13.0.0 shipped",
    (_name: string, kind: ProbeKind) => {
      expect(hintFor(kind)).toBe(PRIVATE_PROBE_HINT);
    },
  );

  test("a private probe's hint says nothing about global probes or other projects", () => {
    const hint: string = hintFor(PRIVATE_PROBE);

    expect(hint).not.toMatch(/global/i);
    expect(hint).not.toContain("every project");
  });

  test("a hosted global probe's hint is byte-for-byte the one 13.0.0 shipped", () => {
    expect(hintFor(HOSTED_GLOBAL_PROBE)).toBe(HOSTED_GLOBAL_PROBE_HINT);
  });

  test("a hosted global probe's hint never tells anyone to set the probe's environment variable", () => {
    /*
     * Setting it would be IGNORED there, and the reader is a project member
     * of a shared instance who cannot change the probe anyway.
     */
    const hint: string = hintFor(HOSTED_GLOBAL_PROBE);

    expect(hint).not.toContain(ENV_VAR);
    expect(hint).not.toContain("=true");
    expect(hint).not.toContain(HELM_VALUE);
    expect(hint).not.toMatch(/\bSet\b/);
  });

  test("a self-hosted global probe's hint names the environment variable and where to set it", () => {
    const hint: string = hintFor(SELF_HOSTED_GLOBAL_PROBE);

    expect(hint).toContain(`${ENV_VAR}=true`);
    expect(hint).toContain("on the probe running this monitor");
  });

  test("a self-hosted global probe's hint names the Helm value the chart renders into that variable", () => {
    expect(hintFor(SELF_HOSTED_GLOBAL_PROBE)).toContain(HELM_VALUE);
  });

  test("a self-hosted global probe's hint warns that allowing it applies to every project on the instance", () => {
    const hint: string = hintFor(SELF_HOSTED_GLOBAL_PROBE);

    expect(hint).toContain("every project");
    expect(hint).toContain("this instance");
    expect(hint).toContain("global probe");
  });

  test("a self-hosted global probe's hint offers a private probe as the alternative", () => {
    expect(hintFor(SELF_HOSTED_GLOBAL_PROBE)).toContain("private probe");
  });

  test("a self-hosted global probe's hint does not claim that global probes cannot monitor private addresses", () => {
    // That was the 13.0.0 message, and on a self-hosted instance it is false.
    const hint: string = hintFor(SELF_HOSTED_GLOBAL_PROBE);

    expect(hint).not.toMatch(/cannot/i);
    expect(hint).not.toBe(HOSTED_GLOBAL_PROBE_HINT);
    expect(hint).not.toBe(PRIVATE_PROBE_HINT);
  });

  test("private, self-hosted global and hosted global probes get three distinct hints", () => {
    const hints: Set<string> = new Set(
      PROBE_KINDS.map((kind: ProbeKind): string => {
        return hintFor(kind);
      }),
    );

    expect(hints.size).toBe(3);
  });

  test.each(kindTable())(
    "the hint on %s depends only on the probe kind, never on the configured value",
    (_name: string, kind: ProbeKind) => {
      const hints: Set<string> = new Set(
        CONFIGURED_VALUES.map((valueCase: ConfiguredValueCase): string => {
          return resolveFor(valueCase.value, kind).refusalHint;
        }),
      );

      expect(Array.from(hints)).toEqual([hintFor(kind)]);
    },
  );

  test.each(kindTable())(
    "the hint on %s starts with exactly one space, because it is appended to a sentence",
    (_name: string, kind: ProbeKind) => {
      const hint: string = hintFor(kind);
      const refusal: string = `Requests to private network addresses are not allowed.${hint}`;

      expect(hint).toMatch(/^ \S/);
      expect(hint.endsWith(".")).toBe(true);
      expect(refusal).not.toContain("  ");
      expect(refusal).not.toMatch(/[\r\n]/);
    },
  );

  test.each(kindTable())(
    "the hint on %s never points at the API server's webhook setting, which this process never reads",
    (_name: string, kind: ProbeKind) => {
      expect(hintFor(kind)).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
    },
  );
});

describe("startup message", () => {
  const INFO: PrivateNetworkMonitorStartupMessage["level"] = "info";
  const WARN: PrivateNetworkMonitorStartupMessage["level"] = "warn";

  /*
   * Global + Allowed warns because it opens private ranges to every project;
   * everything the operator probably did not intend (a value that did not
   * parse, an opt-in that is being ignored) warns too.
   */
  const LEVEL_TABLE: Array<
    [
      string,
      string | undefined,
      ProbeKind,
      PrivateNetworkMonitorStartupMessage["level"],
    ]
  > = [
    [
      "allowed on a self-hosted global probe",
      "true",
      SELF_HOSTED_GLOBAL_PROBE,
      WARN,
    ],
    ["allowed on a private probe", "true", PRIVATE_PROBE, INFO],
    [
      "allowed on a private probe with BILLING_ENABLED=true",
      "true",
      PRIVATE_PROBE_ON_BILLING_INSTANCE,
      INFO,
    ],
    ["refused on a hosted global probe", "true", HOSTED_GLOBAL_PROBE, WARN],
    ["unrecognized on a private probe", "TRUE", PRIVATE_PROBE, WARN],
    [
      "unrecognized on a private probe with BILLING_ENABLED=true",
      "1",
      PRIVATE_PROBE_ON_BILLING_INSTANCE,
      WARN,
    ],
    [
      "unrecognized on a self-hosted global probe",
      "yes",
      SELF_HOSTED_GLOBAL_PROBE,
      WARN,
    ],
    [
      "unrecognized on a hosted global probe",
      " true",
      HOSTED_GLOBAL_PROBE,
      WARN,
    ],
    ["not requested on a private probe", undefined, PRIVATE_PROBE, INFO],
    [
      "not requested on a private probe with BILLING_ENABLED=true",
      "",
      PRIVATE_PROBE_ON_BILLING_INSTANCE,
      INFO,
    ],
    [
      "not requested on a self-hosted global probe",
      "false",
      SELF_HOSTED_GLOBAL_PROBE,
      INFO,
    ],
    [
      "not requested on a hosted global probe",
      undefined,
      HOSTED_GLOBAL_PROBE,
      INFO,
    ],
  ];

  test.each(LEVEL_TABLE)(
    "is logged as expected when %s",
    (
      _title: string,
      value: string | undefined,
      kind: ProbeKind,
      expectedLevel: PrivateNetworkMonitorStartupMessage["level"],
    ) => {
      expect(startupMessageFor(value, kind).level).toBe(expectedLevel);
    },
  );

  test.each(DECISION_TABLE)(
    "is a single, bounded line for %s",
    (_title: string, row: DecisionRow) => {
      const message: string = startupMessageFor(
        row.configuredValue,
        row.kind,
      ).message;

      expect(message).not.toMatch(/[\r\n]/);
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThan(600);
    },
  );

  test("warns that a global probe with the opt-in honored exposes private addresses to every project", () => {
    const startup: PrivateNetworkMonitorStartupMessage = startupMessageFor(
      "true",
      SELF_HOSTED_GLOBAL_PROBE,
    );

    expect(startup.level).toBe("warn");
    expect(startup.message).toContain(`${ENV_VAR}=true`);
    expect(startup.message).toContain("global probe");
    expect(startup.message).toContain("every project");
    expect(startup.message).toContain("ON");
  });

  test("says a private probe's opt-in is on without claiming other projects share it", () => {
    const startup: PrivateNetworkMonitorStartupMessage = startupMessageFor(
      "true",
      PRIVATE_PROBE,
    );

    expect(startup.level).toBe("info");
    expect(startup.message).toContain(`${ENV_VAR}=true`);
    expect(startup.message).toContain("ON");
    expect(startup.message).not.toContain("every project");
    expect(startup.message).not.toMatch(/global/i);
  });

  test.each([
    [PRIVATE_PROBE.name, PRIVATE_PROBE],
    [PRIVATE_PROBE_ON_BILLING_INSTANCE.name, PRIVATE_PROBE_ON_BILLING_INSTANCE],
    [SELF_HOSTED_GLOBAL_PROBE.name, SELF_HOSTED_GLOBAL_PROBE],
  ])(
    "when private monitoring is allowed on %s, the message says loopback, link-local and metadata addresses stay blocked",
    (_name: string, kind: ProbeKind) => {
      const message: string = startupMessageFor("true", kind).message;

      expect(message).toContain("Loopback");
      expect(message).toContain("link-local");
      expect(message).toContain("metadata");
      expect(message).toContain("stay blocked");
    },
  );

  test("says a hosted global probe's opt-in is IGNORED, and why", () => {
    const startup: PrivateNetworkMonitorStartupMessage = startupMessageFor(
      "true",
      HOSTED_GLOBAL_PROBE,
    );

    expect(startup.level).toBe("warn");
    expect(startup.message).toContain(`${ENV_VAR}=true is IGNORED`);
    expect(startup.message).toContain("REGISTER_PROBE_KEY");
    expect(startup.message).toContain("BILLING_ENABLED=true");
    expect(startup.message).toContain("private probe");
    expect(startup.message).not.toContain("stay blocked");
  });

  test.each(DECISION_TABLE)(
    "says IGNORED only for the hosted refusal: %s",
    (_title: string, row: DecisionRow) => {
      const message: string = startupMessageFor(
        row.configuredValue,
        row.kind,
      ).message;

      if (
        row.expectedReason ===
        PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe
      ) {
        expect(message).toContain("IGNORED");
      } else {
        expect(message).not.toContain("IGNORED");
      }
    },
  );

  test.each([
    [PRIVATE_PROBE.name, PRIVATE_PROBE],
    [PRIVATE_PROBE_ON_BILLING_INSTANCE.name, PRIVATE_PROBE_ON_BILLING_INSTANCE],
    [SELF_HOSTED_GLOBAL_PROBE.name, SELF_HOSTED_GLOBAL_PROBE],
  ])(
    "the default message on %s says private monitoring is off and how to turn it on",
    (_name: string, kind: ProbeKind) => {
      const message: string = startupMessageFor(undefined, kind).message;

      expect(message).toContain("off");
      expect(message).toContain(`${ENV_VAR}=true`);
    },
  );

  /*
   * Every probe the Helm chart deploys registers as a global probe, so a
   * private probe is always a custom one the chart value cannot reach.
   * getRefusalHint draws the same line.
   */
  test.each([
    [PRIVATE_PROBE.name, PRIVATE_PROBE],
    [PRIVATE_PROBE_ON_BILLING_INSTANCE.name, PRIVATE_PROBE_ON_BILLING_INSTANCE],
  ])(
    "the default message on %s does not point at a Helm value that cannot configure it",
    (_name: string, kind: ProbeKind) => {
      expect(startupMessageFor(undefined, kind).message).not.toContain(
        HELM_VALUE,
      );
    },
  );

  test("the default message on a self-hosted global probe names the Helm value that turns it on", () => {
    expect(
      startupMessageFor(undefined, SELF_HOSTED_GLOBAL_PROBE).message,
    ).toContain(`${HELM_VALUE} in the Helm chart`);
  });

  test("the default message on a hosted global probe does not suggest an opt-in that would be ignored", () => {
    const message: string = startupMessageFor(
      undefined,
      HOSTED_GLOBAL_PROBE,
    ).message;

    expect(message).toContain("off");
    expect(message).toContain("global probe");
    expect(message).not.toContain(ENV_VAR);
    expect(message).not.toContain(HELM_VALUE);
  });

  test.each(DECISION_TABLE)(
    "names the environment variable unless the opt-in could not work there: %s",
    (_title: string, row: DecisionRow) => {
      const message: string = startupMessageFor(
        row.configuredValue,
        row.kind,
      ).message;
      const isHostedDefault: boolean =
        row.kind === HOSTED_GLOBAL_PROBE &&
        row.expectedReason === PrivateNetworkMonitorPolicyReason.NotRequested;

      if (isHostedDefault) {
        expect(message).not.toContain(ENV_VAR);
      } else {
        expect(message).toContain(ENV_VAR);
      }
    },
  );

  describe("an unrecognized value", () => {
    test("is echoed JSON-quoted and named as the reason private monitoring stays OFF", () => {
      const startup: PrivateNetworkMonitorStartupMessage = startupMessageFor(
        "TRUE",
        PRIVATE_PROBE,
      );

      expect(startup.level).toBe("warn");
      expect(startup.message).toContain(`${ENV_VAR} is set to "TRUE"`);
      expect(startup.message).toContain("stays OFF");
      expect(startup.message).toContain('exactly "true"');
    });

    test.each([PRIVATE_PROBE, SELF_HOSTED_GLOBAL_PROBE])(
      'on $name, tells the operator to set exactly "true", which would turn it on',
      (kind: ProbeKind) => {
        expect(startupMessageFor("TRUE", kind).message).toContain(
          'Set it to exactly "true" to turn it on.',
        );
      },
    );

    test('on a hosted global probe, never suggests "true", which is ignored there too', () => {
      const startup: PrivateNetworkMonitorStartupMessage = startupMessageFor(
        "TRUE",
        HOSTED_GLOBAL_PROBE,
      );

      expect(startup.level).toBe("warn");
      expect(startup.message).toContain(`${ENV_VAR} is set to "TRUE"`);
      expect(startup.message).toContain("stays OFF");
      expect(startup.message).not.toContain("to turn it on");
      expect(startup.message).toContain("BILLING_ENABLED=true");
      expect(startup.message).toContain("public-only");
    });

    test.each([
      [" true", '" true"'],
      ["true ", '"true "'],
      ["\ttrue", '"\\ttrue"'],
    ])(
      "shows the operator the stray whitespace in %p",
      (value: string, echoed: string) => {
        expect(
          startupMessageFor(value, SELF_HOSTED_GLOBAL_PROBE).message,
        ).toContain(`is set to ${echoed},`);
      },
    );

    test("with a trailing newline is escaped, so the warning stays on one line", () => {
      const message: string = startupMessageFor(
        "true\n",
        SELF_HOSTED_GLOBAL_PROBE,
      ).message;

      expect(message).toContain('is set to "true\\n",');
      expect(message).not.toMatch(/[\r\n]/);
    });

    test("carrying a forged log line cannot split the startup warning", () => {
      // Short enough to be echoed in full, so it can be parsed back below.
      const forged: string =
        "yes\n2026-09-18T00:00:00Z INFO monitoring is ON\r\n";
      const message: string = startupMessageFor(
        forged,
        SELF_HOSTED_GLOBAL_PROBE,
      ).message;

      expect(message).not.toMatch(/[\r\n]/);
      expect(message).toContain("yes\\n2026-09-18T00:00:00Z");
      expect(message).toContain("\\r\\n");
      // The echo is one JSON string literal: it parses back to the value.
      const echoed: RegExpMatchArray | null = message.match(
        /is set to ("(?:[^"\\]|\\.)*"),/,
      );
      expect(echoed).not.toBeNull();
      expect(JSON.parse(echoed![1]!)).toBe(forged);
    });

    test("containing quotes cannot break out of its JSON quoting", () => {
      const message: string = startupMessageFor(
        'true", which is fine. "',
        PRIVATE_PROBE,
      ).message;

      expect(message).toContain('is set to "true\\", which is fine. \\"",');
    });

    test("of reasonable length is echoed in full, without a truncation marker", () => {
      const value: string = "enabled-for-the-internal-network";
      const message: string = startupMessageFor(value, PRIVATE_PROBE).message;

      expect(message).toContain(`is set to "${value}",`);
      expect(message).not.toContain('...",');
    });

    test("that is very long is truncated, so the warning stays bounded", () => {
      const value: string = "a".repeat(100000);
      const shortMessage: string = startupMessageFor(
        "a",
        PRIVATE_PROBE,
      ).message;
      const message: string = startupMessageFor(value, PRIVATE_PROBE).message;

      expect(message).toContain('...",');
      expect(message).not.toContain("a".repeat(200));
      expect(message.length).toBeLessThan(shortMessage.length + 200);
      expect(message).not.toMatch(/[\r\n]/);
    });

    test.each([
      ["newlines", "\n"],
      ["carriage returns", "\r"],
      ["NUL characters", String.fromCharCode(0)],
      ["escape characters", String.fromCharCode(27)],
    ])(
      "made of 100,000 %s stays bounded and on one line",
      (_name: string, character: string) => {
        const message: string = startupMessageFor(
          character.repeat(100000),
          SELF_HOSTED_GLOBAL_PROBE,
        ).message;

        expect(message).not.toMatch(/[\r\n]/);
        // Escaped by the JSON quoting, never written raw into the log.
        expect(message).not.toContain(character);
        expect(message.length).toBeLessThan(1000);
      },
    );
  });
});

/*
 * Docker Compose ships LOG_LEVEL=ERROR, and Logger.warn prints nothing there.
 * A warning about a setting being ignored that only prints at WARN would be
 * the silent drop issue #3879 is about, so the warn-level lines go through
 * logger.error with EXTERNAL_FAULT: printed at every LOG_LEVEL, exported at
 * WARN severity, never turned into an Issue. The routine on/off line is an
 * ordinary info line.
 */
describe("logStartupMessage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface LoggerSpies {
    warn: ReturnType<typeof jest.spyOn>;
    info: ReturnType<typeof jest.spyOn>;
    error: ReturnType<typeof jest.spyOn>;
    debug: ReturnType<typeof jest.spyOn>;
  }

  function spyOnLogger(): LoggerSpies {
    return {
      warn: jest.spyOn(logger, "warn").mockImplementation((): void => {}),
      info: jest.spyOn(logger, "info").mockImplementation((): void => {}),
      error: jest.spyOn(logger, "error").mockImplementation((): void => {}),
      debug: jest.spyOn(logger, "debug").mockImplementation((): void => {}),
    };
  }

  test.each(DECISION_TABLE)(
    "logs the startup message exactly once, through the path its level needs, for %s",
    (_title: string, row: DecisionRow) => {
      const spies: LoggerSpies = spyOnLogger();

      const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
        row.configuredValue,
        row.kind,
      );
      const expected: PrivateNetworkMonitorStartupMessage =
        PrivateNetworkMonitorPolicy.getStartupMessage(policy);

      PrivateNetworkMonitorPolicy.logStartupMessage(policy);

      if (expected.level === "warn") {
        expect(spies.error).toHaveBeenCalledTimes(1);
        expect(spies.error).toHaveBeenCalledWith(
          expected.message,
          EXTERNAL_FAULT,
        );
        expect(spies.info).not.toHaveBeenCalled();
      } else {
        expect(spies.info).toHaveBeenCalledTimes(1);
        expect(spies.info).toHaveBeenCalledWith(expected.message);
        expect(spies.error).not.toHaveBeenCalled();
      }
      expect(spies.warn).not.toHaveBeenCalled();
      expect(spies.debug).not.toHaveBeenCalled();
    },
  );

  test("ISSUE #3879: a bundled global probe that honors the opt-in says so once, on the always-visible path", () => {
    const spies: LoggerSpies = spyOnLogger();

    PrivateNetworkMonitorPolicy.logStartupMessage(
      resolveFor("true", SELF_HOSTED_GLOBAL_PROBE),
    );

    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(String(spies.error.mock.calls[0]![0])).toContain("every project");
    expect(spies.error.mock.calls[0]![1]).toBe(EXTERNAL_FAULT);
    expect(spies.info).not.toHaveBeenCalled();
  });

  test("a hosted global probe that drops the opt-in says so, instead of dropping it silently", () => {
    const spies: LoggerSpies = spyOnLogger();

    PrivateNetworkMonitorPolicy.logStartupMessage(
      resolveFor("true", HOSTED_GLOBAL_PROBE),
    );

    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(String(spies.error.mock.calls[0]![0])).toContain("IGNORED");
    expect(spies.error.mock.calls[0]![1]).toBe(EXTERNAL_FAULT);
  });

  test("the quiet default is logged at info, not as a warning", () => {
    const spies: LoggerSpies = spyOnLogger();

    PrivateNetworkMonitorPolicy.logStartupMessage(
      resolveFor(undefined, PRIVATE_PROBE),
    );

    expect(spies.info).toHaveBeenCalledTimes(1);
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
  });

  describe("through the real Logger at LOG_LEVEL=ERROR, as Docker Compose ships it", () => {
    interface ConsoleSpies {
      warn: ReturnType<typeof jest.spyOn>;
      info: ReturnType<typeof jest.spyOn>;
      error: ReturnType<typeof jest.spyOn>;
    }

    function atErrorLogLevel(): ConsoleSpies {
      jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.ERROR);
      return {
        warn: jest.spyOn(console, "warn").mockImplementation((): void => {}),
        info: jest.spyOn(console, "info").mockImplementation((): void => {}),
        error: jest.spyOn(console, "error").mockImplementation((): void => {}),
      };
    }

    test.each([
      [
        "an unrecognized value on a global probe",
        "TRUE",
        SELF_HOSTED_GLOBAL_PROBE,
      ],
      ["an unrecognized value on a private probe", "1", PRIVATE_PROBE],
      [
        "the opt-in ignored on a hosted global probe",
        "true",
        HOSTED_GLOBAL_PROBE,
      ],
      [
        "ISSUE #3879: the opt-in honored on a global probe",
        "true",
        SELF_HOSTED_GLOBAL_PROBE,
      ],
    ])(
      "still prints %s, once, as a console warning rather than an error",
      (_title: string, value: string, kind: ProbeKind) => {
        const consoleSpies: ConsoleSpies = atErrorLogLevel();
        const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
          value,
          kind,
        );

        PrivateNetworkMonitorPolicy.logStartupMessage(policy);

        expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
        expect(consoleSpies.warn).toHaveBeenCalledWith(
          PrivateNetworkMonitorPolicy.getStartupMessage(policy).message,
        );
        expect(consoleSpies.error).not.toHaveBeenCalled();
        expect(consoleSpies.info).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["the default on a global probe", undefined, SELF_HOSTED_GLOBAL_PROBE],
      ["the opt-in honored on a private probe", "true", PRIVATE_PROBE],
    ])(
      "leaves %s, a routine info line, to LOG_LEVEL",
      (_title: string, value: string | undefined, kind: ProbeKind) => {
        const consoleSpies: ConsoleSpies = atErrorLogLevel();

        PrivateNetworkMonitorPolicy.logStartupMessage(resolveFor(value, kind));

        expect(consoleSpies.warn).not.toHaveBeenCalled();
        expect(consoleSpies.info).not.toHaveBeenCalled();
        expect(consoleSpies.error).not.toHaveBeenCalled();
      },
    );
  });
});

describe("getDiagnosticsSnapshot", () => {
  test("ISSUE #3879: records the decision, its reason and the inputs it was made from", () => {
    const snapshot: JSONObject =
      PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(
        resolveFor("true", SELF_HOSTED_GLOBAL_PROBE),
      );

    expect(snapshot).toEqual({
      allowed: true,
      reason: "Allowed",
      configuredValue: "true",
      autoRegisteredGlobalProbe: true,
      billingEnabled: false,
    });
  });

  test("records a hosted refusal with its reason", () => {
    expect(
      PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(
        resolveFor("true", HOSTED_GLOBAL_PROBE),
      ),
    ).toEqual({
      allowed: false,
      reason: "RefusedOnHostedGlobalProbe",
      configuredValue: "true",
      autoRegisteredGlobalProbe: true,
      billingEnabled: true,
    });
  });

  test("records an unrecognized value verbatim, so support can see exactly what was set", () => {
    expect(
      PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(
        resolveFor(" true", PRIVATE_PROBE),
      ),
    ).toEqual({
      allowed: false,
      reason: "UnrecognizedValue",
      configuredValue: " true",
      autoRegisteredGlobalProbe: false,
      billingEnabled: false,
    });
  });

  test("records an unset value as null, which survives JSON serialization instead of being dropped", () => {
    const snapshot: JSONObject =
      PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(
        resolveFor(undefined, PRIVATE_PROBE),
      );
    const serialized: string = JSON.stringify(snapshot);

    expect(snapshot["configuredValue"]).toBeNull();
    expect(serialized).toContain('"configuredValue":null');
    expect(JSON.parse(serialized)).toEqual(snapshot);
  });

  test("keeps an empty value distinct from an unset one", () => {
    const unset: JSONObject =
      PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(
        resolveFor(undefined, PRIVATE_PROBE),
      );
    const empty: JSONObject =
      PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(
        resolveFor("", PRIVATE_PROBE),
      );

    expect(empty["configuredValue"]).toBe("");
    expect(unset["configuredValue"]).toBeNull();
    expect(empty).not.toEqual(unset);
  });

  test.each(DECISION_TABLE)(
    "mirrors the resolved policy field for field, and round-trips through JSON: %s",
    (_title: string, row: DecisionRow) => {
      const policy: ResolvedPrivateNetworkMonitorPolicy = resolveFor(
        row.configuredValue,
        row.kind,
      );
      const snapshot: JSONObject =
        PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(policy);

      expect(snapshot).toEqual({
        allowed: policy.allowed,
        reason: policy.reason,
        configuredValue:
          row.configuredValue === undefined ? null : row.configuredValue,
        autoRegisteredGlobalProbe: row.kind.isAutoRegisteredGlobalProbe,
        billingEnabled: row.kind.isBillingEnabled,
      });
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    },
  );
});

describe("exported names", () => {
  test("the environment variable named in every message is the one the Helm chart and Docker Compose set", () => {
    expect(PRIVATE_NETWORK_MONITORS_ENV_VAR).toBe(ENV_VAR);
  });

  test("the Helm value named in the hints is the chart's per-probe setting", () => {
    expect(PRIVATE_NETWORK_MONITORS_HELM_VALUE).toBe(HELM_VALUE);
  });

  test("reasons are stable strings, because they appear in the diagnostics dump", () => {
    expect(PrivateNetworkMonitorPolicyReason.NotRequested).toBe("NotRequested");
    expect(PrivateNetworkMonitorPolicyReason.Allowed).toBe("Allowed");
    expect(PrivateNetworkMonitorPolicyReason.UnrecognizedValue).toBe(
      "UnrecognizedValue",
    );
    expect(PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe).toBe(
      "RefusedOnHostedGlobalProbe",
    );
  });
});
