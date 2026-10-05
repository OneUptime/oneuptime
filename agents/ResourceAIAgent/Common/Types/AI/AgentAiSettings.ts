/*
 * What OneUptime AI may do on a cluster or resource, set in its AI agent's
 * own configuration: whether AI may run read-only commands there while it
 * investigates (investigation), and how it may apply a fix (fixes).
 *
 * "These options should depend on the agent itself. If I say
 * investigation = true, the agent should be turned on automatically here.
 * The same with the fixes." The agent reads them from its environment —
 * the kubernetes-agent chart sets them from aiAgent.investigation and
 * aiAgent.fixes, a resource AI agent takes them from its .env — and reports
 * them on registration and on every heartbeat (its posture's aiSettings).
 * OneUptime applies them to the cluster or resource; they are then changed
 * in one place, the agent's configuration, and the AI agent page shows them
 * read-only, with the command that changes them.
 *
 * An agent whose configuration names neither setting reports its defaults
 * (investigation on; fixes "ask-for-approval" when it may write, else off)
 * with isConfigured false. OneUptime applies those only to a cluster or
 * resource whose AI settings nobody chose on its AI agent page: settings an
 * operator chose there are never replaced by defaults nobody chose, only by
 * a configuration that names them. An agent built before these settings
 * reports nothing, and the settings stay where they are chosen today.
 *
 * NO imports on purpose: the Kubernetes AI agent and the resource AI agent
 * (agents/KubernetesAIAgent, agents/ResourceAIAgent) each carry a
 * byte-identical copy of this file (their Scripts/CommonCopies.json) and
 * compile without the rest of Common.
 */

/*
 * How AI may apply a fix — the stored values of KubernetesAiRemediationMode
 * and ResourceAiRemediationMode (a Common test pins all three together), so
 * a reported mode is written to a cluster or resource as it is.
 */
export type AgentAiFixesMode =
  | "Disabled"
  | "RequireApproval"
  | "Automatic"
  | "BypassApproval";

// Every fixes mode, least autonomy first.
export const AGENT_AI_FIXES_MODES: ReadonlyArray<AgentAiFixesMode> = [
  "Disabled",
  "RequireApproval",
  "Automatic",
  "BypassApproval",
];

/*
 * How each mode is written in an agent's configuration — the chart's
 * aiAgent.fixes and the agents' ONEUPTIME_AI_FIXES — in the words the AI
 * agent page uses for them (Off, Ask for approval, Automatic, Bypass
 * approval).
 */
export const AGENT_AI_FIXES_SETTING_VALUES: Readonly<
  Record<AgentAiFixesMode, string>
> = {
  Disabled: "off",
  RequireApproval: "ask-for-approval",
  Automatic: "automatic",
  BypassApproval: "bypass-approval",
};

// Each mode's name, as the AI agent page and the feeds write it.
export const AGENT_AI_FIXES_LABELS: Readonly<Record<AgentAiFixesMode, string>> =
  {
    Disabled: "Off",
    RequireApproval: "Ask for approval",
    Automatic: "Automatic",
    BypassApproval: "Bypass approval",
  };

/*
 * The environment both agents read. The kubernetes-agent chart sets them
 * from aiAgent.investigation and aiAgent.fixes; a resource AI agent takes
 * them from the .env it shares with its collector.
 */
export const AI_INVESTIGATION_ENV: string = "ONEUPTIME_AI_INVESTIGATION";
export const AI_FIXES_ENV: string = "ONEUPTIME_AI_FIXES";

// What an agent's configuration lets OneUptime AI do.
export interface AgentAiSettings {
  // AI may run read-only commands while it investigates.
  investigation: boolean;
  fixes: AgentAiFixesMode;
  /*
   * The configuration names at least one of the two settings. False: these
   * are the agent's defaults, which OneUptime applies only where nobody
   * chose the settings on the AI agent page.
   */
  isConfigured: boolean;
}

/*
 * Where a cluster's or resource's investigation and fixes are set:
 *
 * agent_configuration: its AI agent's configuration names them. OneUptime
 *                      applies them, and refuses a change made anywhere
 *                      else (the AI agent page, the API, Terraform).
 * agent_defaults:      its AI agent reports its defaults and nobody chose
 *                      the settings on the AI agent page: the same, until
 *                      someone sets them in the agent's configuration.
 * oneuptime:           they are chosen in OneUptime — the agent is older
 *                      than these settings, or uses its defaults where
 *                      someone already chose them on the AI agent page, or
 *                      AI reaches the cluster through a Runner an operator
 *                      bound, or no agent connected yet.
 */
export type AgentAiSettingsSource =
  | "agent_configuration"
  | "agent_defaults"
  | "oneuptime";

// The agent's settings decide (agent_configuration or agent_defaults).
export function isAgentAiSettingsSourceAgent(source: unknown): boolean {
  return source === "agent_configuration" || source === "agent_defaults";
}

// What an agent made of its environment.
export interface ResolvedAgentAiSettings {
  // What it reports, defaults included.
  settings: AgentAiSettings;
  /*
   * Whether the agent may run writes at all: its own write switch, and
   * never while its configuration turns fixes off — an agent configured not
   * to fix anything refuses every write itself, whatever it is sent.
   */
  allowWrites: boolean;
  // Worth saying once at start-up (a value it could not read, a mismatch).
  warnings: Array<string>;
}

// What a setting's spelling may vary in: case, spaces, dashes, underscores.
const SETTING_SEPARATORS_REGEX: RegExp = /[\s_-]+/g;

// "Ask for approval", "ask_for_approval" and "AskForApproval" read alike.
function squash(value: string): string {
  return value.trim().toLowerCase().replace(SETTING_SEPARATORS_REGEX, "");
}

/*
 * A fixes setting as written in a configuration, or null when it is not
 * one: off, ask-for-approval, automatic or bypass-approval (the stored
 * mode names, Disabled, RequireApproval and BypassApproval, read too).
 */
export function parseAgentAiFixesSetting(
  value: string | null | undefined,
): AgentAiFixesMode | null {
  const squashed: string = squash(value || "");

  for (const mode of AGENT_AI_FIXES_MODES) {
    if (
      squashed === squash(AGENT_AI_FIXES_SETTING_VALUES[mode]) ||
      squashed === squash(mode)
    ) {
      return mode;
    }
  }

  return null;
}

// An investigation setting: true or false, else null.
export function parseAgentAiInvestigationSetting(
  value: string | null | undefined,
): boolean | null {
  const squashed: string = squash(value || "");

  if (squashed === "true") {
    return true;
  }

  if (squashed === "false") {
    return false;
  }

  return null;
}

function isSet(value: string | null | undefined): boolean {
  return (value || "").trim().length > 0;
}

/*
 * The settings an agent reports, from its environment.
 *
 * - Investigation on unless set; fixes, unless set, follow the write
 *   switch: "ask-for-approval" when writes are allowed, "off" otherwise —
 *   what OneUptime picked for a new cluster or resource whose agent
 *   connected that way.
 * - isConfigured: either variable is set.
 * - A value the agent cannot read fails closed: investigation off, fixes
 *   off, and a warning that says what was not understood.
 * - Fixes set to off keep the agent read-only even when its write switch
 *   is on. Fixes left unset never change what the write switch allows.
 */
export function resolveAgentAiSettings(data: {
  investigationSetting: string | null | undefined;
  fixesSetting: string | null | undefined;
  // The agent's write switch as it reads it.
  allowWrites: boolean;
  // The write switch's variable, for the warnings.
  allowWritesName: string;
}): ResolvedAgentAiSettings {
  const warnings: Array<string> = [];
  const isConfigured: boolean =
    isSet(data.investigationSetting) || isSet(data.fixesSetting);

  let investigation: boolean = true;

  if (isSet(data.investigationSetting)) {
    const parsed: boolean | null = parseAgentAiInvestigationSetting(
      data.investigationSetting,
    );

    if (parsed === null) {
      warnings.push(
        `${AI_INVESTIGATION_ENV}="${(data.investigationSetting || "").trim()}" is not "true" or "false", so AI investigation stays off. Set it to "true" or "false".`,
      );
    }

    investigation = parsed === true;
  }

  let fixes: AgentAiFixesMode = data.allowWrites
    ? "RequireApproval"
    : "Disabled";

  if (isSet(data.fixesSetting)) {
    const parsed: AgentAiFixesMode | null = parseAgentAiFixesSetting(
      data.fixesSetting,
    );

    if (parsed === null) {
      warnings.push(
        `${AI_FIXES_ENV}="${(data.fixesSetting || "").trim()}" is not one of ${AGENT_AI_FIXES_MODES.map(
          (mode: AgentAiFixesMode): string => {
            return AGENT_AI_FIXES_SETTING_VALUES[mode];
          },
        ).join(", ")}, so AI fixes stay off.`,
      );
    }

    fixes = parsed || "Disabled";

    if (fixes !== "Disabled" && !data.allowWrites) {
      warnings.push(
        `${AI_FIXES_ENV}=${AGENT_AI_FIXES_SETTING_VALUES[fixes]}, but ${data.allowWritesName} is not "true": the agent stays read-only, so no fix can run. Set ${data.allowWritesName}=true as well.`,
      );
    }

    if (fixes === "Disabled" && data.allowWrites) {
      warnings.push(
        `${data.allowWritesName}=true, but AI fixes are off (${AI_FIXES_ENV}): the agent stays read-only.`,
      );
    }
  }

  return {
    settings: { investigation, fixes, isConfigured },
    allowWrites: data.allowWrites && fixes !== "Disabled",
    warnings,
  };
}

/*
 * The settings an agent reported (its posture's aiSettings), as OneUptime
 * reads them: undefined when it reported none. Reported but unreadable
 * fails closed, field by field — investigation is on only for the boolean
 * true, fixes must be a known mode, else off, and isConfigured is true
 * only for the boolean true — so a value this build does not understand
 * can never let AI do more.
 */
export function parseReportedAgentAiSettings(
  value: unknown,
): AgentAiSettings | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { investigation: false, fixes: "Disabled", isConfigured: false };
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const fixes: unknown = raw["fixes"];

  return {
    investigation: raw["investigation"] === true,
    fixes: (AGENT_AI_FIXES_MODES as ReadonlyArray<unknown>).includes(fixes)
      ? (fixes as AgentAiFixesMode)
      : "Disabled",
    isConfigured: raw["isConfigured"] === true,
  };
}

// The same settings, or both absent.
export function isSameAgentAiSettings(
  left: AgentAiSettings | null | undefined,
  right: AgentAiSettings | null | undefined,
): boolean {
  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.investigation === right.investigation &&
    left.fixes === right.fixes &&
    left.isConfigured === right.isConfigured
  );
}

/*
 * Where the settings are set, from what decides it: the agent's report
 * (undefined: it reports none), whether someone chose them on the AI agent
 * page (an operator's write stamps aiAccessConfiguredAt), and whether the
 * agent is the executor at all (false with a Runner an operator bound).
 */
export function getAgentAiSettingsSource(data: {
  reported: AgentAiSettings | undefined;
  isChosenInOneUptime: boolean;
  isAgentTheExecutor: boolean;
}): AgentAiSettingsSource {
  if (!data.reported || !data.isAgentTheExecutor) {
    return "oneuptime";
  }

  if (data.reported.isConfigured) {
    return "agent_configuration";
  }

  return data.isChosenInOneUptime ? "oneuptime" : "agent_defaults";
}
