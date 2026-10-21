import {
  AGENT_AI_FIXES_LABELS,
  AGENT_AI_FIXES_MODES,
  AGENT_AI_FIXES_SETTING_VALUES,
  AI_FIXES_ENV,
  AI_INVESTIGATION_ENV,
  AgentAiFixesMode,
  AgentAiSettings,
  AgentAiSettingsSource,
  ResolvedAgentAiSettings,
  getAgentAiSettingsSource,
  isAgentAiSettingsSourceAgent,
  isSameAgentAiSettings,
  parseAgentAiFixesSetting,
  parseAgentAiInvestigationSetting,
  parseReportedAgentAiSettings,
  resolveAgentAiSettings,
} from "../../../Types/AI/AgentAiSettings";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * The contract both AI agents and the server share for "what OneUptime AI
 * may do here": the agent reads it from its configuration, reports it, and
 * the server writes it to the cluster or resource. The agents carry
 * byte-identical copies of this file (their own suites test those); this
 * suite holds the source.
 */

const ALL_OFF: AgentAiSettings = {
  investigation: false,
  fixes: "Disabled",
  isConfigured: false,
};

describe("the fixes modes", () => {
  /*
   * A reported mode is written to the cluster or resource as it is, so the
   * three spellings must be the same four values.
   */
  test("are the stored values of both remediation modes", () => {
    expect([...AGENT_AI_FIXES_MODES].sort()).toEqual(
      Object.values(KubernetesAiRemediationMode).sort(),
    );
    expect([...AGENT_AI_FIXES_MODES].sort()).toEqual(
      Object.values(ResourceAiRemediationMode).sort(),
    );
  });

  test("run from least autonomy to most", () => {
    expect(AGENT_AI_FIXES_MODES).toEqual([
      "Disabled",
      "RequireApproval",
      "Automatic",
      "BypassApproval",
    ]);
  });

  test("are written in a configuration the way the AI agent page names them", () => {
    expect(AGENT_AI_FIXES_SETTING_VALUES).toEqual({
      Disabled: "off",
      RequireApproval: "ask-for-approval",
      Automatic: "automatic",
      BypassApproval: "bypass-approval",
    });
    expect(AGENT_AI_FIXES_LABELS).toEqual({
      Disabled: "Off",
      RequireApproval: "Ask for approval",
      Automatic: "Automatic",
      BypassApproval: "Bypass approval",
    });
  });

  test("the variables the agents read", () => {
    expect(AI_INVESTIGATION_ENV).toBe("ONEUPTIME_AI_INVESTIGATION");
    expect(AI_FIXES_ENV).toBe("ONEUPTIME_AI_FIXES");
  });
});

describe("parseAgentAiFixesSetting", () => {
  test.each([
    ["off", "Disabled"],
    ["ask-for-approval", "RequireApproval"],
    ["automatic", "Automatic"],
    ["bypass-approval", "BypassApproval"],
    // Case, spaces, dashes and underscores do not matter.
    ["Ask for approval", "RequireApproval"],
    ["ASK_FOR_APPROVAL", "RequireApproval"],
    ["  bypass approval ", "BypassApproval"],
    // The stored mode names read too.
    ["Disabled", "Disabled"],
    ["RequireApproval", "RequireApproval"],
    ["BypassApproval", "BypassApproval"],
  ])("%s → %s", (value: string, expected: string) => {
    expect(parseAgentAiFixesSetting(value)).toBe(expected);
  });

  test.each([["yes"], ["on"], ["true"], ["everything"], [""], ["   "]])(
    "%j is not a fixes setting",
    (value: string) => {
      expect(parseAgentAiFixesSetting(value)).toBeNull();
    },
  );

  test("nothing is not a fixes setting", () => {
    expect(parseAgentAiFixesSetting(undefined)).toBeNull();
    expect(parseAgentAiFixesSetting(null)).toBeNull();
  });
});

describe("parseAgentAiInvestigationSetting", () => {
  test.each([
    ["true", true],
    ["TRUE", true],
    [" true ", true],
    ["false", false],
    ["False", false],
  ])("%j → %s", (value: string, expected: boolean) => {
    expect(parseAgentAiInvestigationSetting(value)).toBe(expected);
  });

  test.each([["yes"], ["1"], ["on"], [""]])(
    "%j is neither",
    (value: string) => {
      expect(parseAgentAiInvestigationSetting(value)).toBeNull();
    },
  );
});

describe("resolveAgentAiSettings", () => {
  function resolve(data: {
    investigation?: string;
    fixes?: string;
    allowWrites: boolean;
  }): ResolvedAgentAiSettings {
    return resolveAgentAiSettings({
      investigationSetting: data.investigation,
      fixesSetting: data.fixes,
      allowWrites: data.allowWrites,
      allowWritesName: "ONEUPTIME_AI_ALLOW_WRITES",
    });
  }

  test("nothing set: the defaults, not configured — investigation on, fixes following the write switch", () => {
    expect(resolve({ allowWrites: false })).toEqual({
      settings: {
        investigation: true,
        fixes: "Disabled",
        isConfigured: false,
      },
      allowWrites: false,
      warnings: [],
    });
    expect(resolve({ allowWrites: true }).settings).toEqual({
      investigation: true,
      fixes: "RequireApproval",
      isConfigured: false,
    });
    expect(resolve({ allowWrites: true }).allowWrites).toBe(true);
  });

  test("either variable set is a configuration", () => {
    expect(
      resolve({ investigation: "false", allowWrites: false }).settings
        .isConfigured,
    ).toBe(true);
    expect(
      resolve({ fixes: "off", allowWrites: false }).settings.isConfigured,
    ).toBe(true);
  });

  test("a blank variable is not set", () => {
    expect(
      resolve({ investigation: "  ", fixes: "", allowWrites: false }).settings
        .isConfigured,
    ).toBe(false);
  });

  test("fixes on with the write switch: the agent may write", () => {
    const resolved: ResolvedAgentAiSettings = resolve({
      fixes: "automatic",
      allowWrites: true,
    });
    expect(resolved.settings.fixes).toBe("Automatic");
    expect(resolved.allowWrites).toBe(true);
    expect(resolved.warnings).toEqual([]);
  });

  test("fixes off keeps the agent read-only even with the write switch on, and says so", () => {
    const resolved: ResolvedAgentAiSettings = resolve({
      fixes: "off",
      allowWrites: true,
    });
    expect(resolved.allowWrites).toBe(false);
    expect(resolved.warnings.join(" ")).toContain("stays read-only");
  });

  test("fixes on without the write switch: reported as configured, but the agent stays read-only and says what to set", () => {
    const resolved: ResolvedAgentAiSettings = resolve({
      fixes: "bypass-approval",
      allowWrites: false,
    });
    expect(resolved.settings.fixes).toBe("BypassApproval");
    expect(resolved.allowWrites).toBe(false);
    expect(resolved.warnings.join(" ")).toContain(
      "ONEUPTIME_AI_ALLOW_WRITES=true",
    );
  });

  test("a value it cannot read fails closed, with a warning naming it", () => {
    const resolved: ResolvedAgentAiSettings = resolve({
      investigation: "yes",
      fixes: "everything",
      allowWrites: true,
    });
    expect(resolved.settings).toEqual({
      investigation: false,
      fixes: "Disabled",
      isConfigured: true,
    });
    expect(resolved.allowWrites).toBe(false);
    expect(resolved.warnings.join(" ")).toContain(
      'ONEUPTIME_AI_INVESTIGATION="yes"',
    );
    expect(resolved.warnings.join(" ")).toContain(
      'ONEUPTIME_AI_FIXES="everything"',
    );
  });
});

describe("parseReportedAgentAiSettings", () => {
  test("nothing reported: undefined (an agent older than these settings)", () => {
    expect(parseReportedAgentAiSettings(undefined)).toBeUndefined();
    expect(parseReportedAgentAiSettings(null)).toBeUndefined();
  });

  test("a well-formed report reads as it is", () => {
    const reported: AgentAiSettings = {
      investigation: true,
      fixes: "BypassApproval",
      isConfigured: true,
    };
    expect(parseReportedAgentAiSettings({ ...reported })).toEqual(reported);
  });

  test.each([["yes"], [42], [["investigation"]], [true]])(
    "a report that is not an object (%j) reads as everything off",
    (value: unknown) => {
      expect(parseReportedAgentAiSettings(value)).toEqual(ALL_OFF);
    },
  );

  test.each([
    ["investigation", { investigation: "true" }, { investigation: false }],
    ["investigation", { investigation: 1 }, { investigation: false }],
    ["fixes", { fixes: "automatic" }, { fixes: "Disabled" }],
    ["fixes", { fixes: "Everything" }, { fixes: "Disabled" }],
    ["isConfigured", { isConfigured: "true" }, { isConfigured: false }],
  ])(
    "an unreadable %s fails closed on its own: %j",
    (
      _field: string,
      value: Record<string, unknown>,
      expected: Record<string, unknown>,
    ) => {
      const parsed: AgentAiSettings | undefined = parseReportedAgentAiSettings({
        investigation: true,
        fixes: "Automatic",
        isConfigured: true,
        ...value,
      });
      expect(parsed).toMatchObject(expected);
    },
  );

  test("the other fields of a partly unreadable report are kept", () => {
    expect(
      parseReportedAgentAiSettings({
        investigation: "yes",
        fixes: "Automatic",
        isConfigured: true,
      }),
    ).toEqual({ investigation: false, fixes: "Automatic", isConfigured: true });
  });
});

describe("isSameAgentAiSettings", () => {
  const SETTINGS: AgentAiSettings = {
    investigation: true,
    fixes: "Automatic",
    isConfigured: true,
  };

  test("the same three fields are the same", () => {
    expect(isSameAgentAiSettings(SETTINGS, { ...SETTINGS })).toBe(true);
  });

  test.each([
    ["investigation", { investigation: false }],
    ["fixes", { fixes: "BypassApproval" as AgentAiFixesMode }],
    ["isConfigured", { isConfigured: false }],
  ])(
    "a different %s is different",
    (_field: string, change: Partial<AgentAiSettings>) => {
      expect(isSameAgentAiSettings(SETTINGS, { ...SETTINGS, ...change })).toBe(
        false,
      );
    },
  );

  test("both absent are the same; one absent is different", () => {
    expect(isSameAgentAiSettings(undefined, null)).toBe(true);
    expect(isSameAgentAiSettings(SETTINGS, undefined)).toBe(false);
    expect(isSameAgentAiSettings(null, SETTINGS)).toBe(false);
  });
});

describe("getAgentAiSettingsSource", () => {
  const CONFIGURED: AgentAiSettings = {
    investigation: true,
    fixes: "Automatic",
    isConfigured: true,
  };
  const DEFAULTS: AgentAiSettings = { ...CONFIGURED, isConfigured: false };

  test.each([
    // reported, chosen in OneUptime, agent is the executor → source
    ["a configuration decides", CONFIGURED, false, true, "agent_configuration"],
    [
      "a configuration decides over an operator's choice",
      CONFIGURED,
      true,
      true,
      "agent_configuration",
    ],
    [
      "the defaults decide where nobody chose",
      DEFAULTS,
      false,
      true,
      "agent_defaults",
    ],
    [
      "the defaults never replace an operator's choice",
      DEFAULTS,
      true,
      true,
      "oneuptime",
    ],
    [
      "an agent that reports nothing leaves it to OneUptime",
      undefined,
      false,
      true,
      "oneuptime",
    ],
    [
      "a Runner an operator bound: the agent is not the executor",
      CONFIGURED,
      false,
      false,
      "oneuptime",
    ],
  ])(
    "%s",
    (
      _label: string,
      reported: AgentAiSettings | undefined,
      isChosenInOneUptime: boolean,
      isAgentTheExecutor: boolean,
      expected: string,
    ) => {
      expect(
        getAgentAiSettingsSource({
          reported,
          isChosenInOneUptime,
          isAgentTheExecutor,
        }),
      ).toBe(expected);
    },
  );
});

describe("isAgentAiSettingsSourceAgent", () => {
  test.each([
    ["agent_configuration", true],
    ["agent_defaults", true],
    ["oneuptime", false],
    [undefined, false],
    ["something else", false],
  ])("%s → %s", (source: unknown, expected: boolean) => {
    expect(isAgentAiSettingsSourceAgent(source as AgentAiSettingsSource)).toBe(
      expected,
    );
  });
});
