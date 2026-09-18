import { JSONObject } from "Common/Types/JSON";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";

/*
 * Whether this probe's API, Website, External Status Page and Custom
 * JavaScript Code monitors may reach private network addresses (RFC-1918,
 * CGNAT, IPv6 unique-local), and what the probe says about that decision: in
 * the refusal a monitor reports, and once at startup.
 *
 * Every input is passed in, so the whole decision table is testable without
 * re-importing Config.ts under a different environment. Config.ts resolves it
 * once, from this process's own environment.
 *
 * WHO decides: whoever deploys the probe, through PROBE_ALLOW_PRIVATE_NETWORK_MONITORS
 * in the probe's own environment. No monitor, project member or tenant can
 * change a process's environment, so the setting cannot be loosened by
 * monitor data.
 *
 * That includes the probes bundled with the Helm chart and Docker Compose.
 * They auto-register with REGISTER_PROBE_KEY and so become GLOBAL probes, and
 * 12.0.34 / 13.0.0 made every such probe ignore the setting (OneUptime issue
 * #3879). On a self-hosted instance the person who deploys the bundled probe
 * is the person who operates the instance, and before that API and Website
 * monitors on those probes reached private targets with no check at all, so
 * an instance monitoring its internal services broke on upgrade with no way
 * to opt back in. probes.<name>.allowPrivateNetworkMonitors was accepted by the
 * chart and then dropped here without a word.
 *
 * The one place a global probe still refuses is when BILLING_ENABLED=true is
 * in its own environment: the hosted product, where anyone can sign up and
 * every project shares the global probes. There a stray opt-in would hand
 * every sign-up a route into the network the probe runs in, so it stays
 * refused, and the probe says so at startup instead of dropping it silently.
 * The same BILLING_ENABLED signal already decides whether external data
 * sources may reach private ranges (DataSourceEgressGuard.shouldBlockPrivateAddresses).
 * The bundled Helm and Compose probes are given the instance's value.
 *
 * "Global" here means auto-registered with REGISTER_PROBE_KEY, the only
 * signal the probe has: the server's /alive answer carries no probe data. A
 * global probe created in the Admin Dashboard and run with PROBE_ID and
 * PROBE_KEY looks private from in here, and honors the opt-in like one.
 *
 * Loopback, link-local and the cloud metadata endpoint are not governed here:
 * the egress guards refuse them on every probe, whatever this decides.
 */

export const PRIVATE_NETWORK_MONITORS_ENV_VAR: string =
  "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";

export const PRIVATE_NETWORK_MONITORS_HELM_VALUE: string =
  "probes.<name>.allowPrivateNetworkMonitors";

// Bounds what an unrecognized value echoes into the startup log.
const MAX_ECHOED_VALUE_LENGTH: number = 64;

export enum PrivateNetworkMonitorPolicyReason {
  // Unset, empty or "false": the default, public-only policy.
  NotRequested = "NotRequested",
  // Exactly "true", on a probe that honors it.
  Allowed = "Allowed",
  // Set to something other than "true" or "false", e.g. "TRUE" or "1".
  UnrecognizedValue = "UnrecognizedValue",
  // "true" on an auto-registered global probe of a billing-enabled instance.
  RefusedOnHostedGlobalProbe = "RefusedOnHostedGlobalProbe",
}

export interface PrivateNetworkMonitorPolicyInput {
  // The raw PROBE_ALLOW_PRIVATE_NETWORK_MONITORS value, undefined when unset.
  configuredValue: string | undefined;
  // REGISTER_PROBE_KEY is set, so this probe registers itself as global.
  isAutoRegisteredGlobalProbe: boolean;
  // BILLING_ENABLED=true: the hosted, open-signup product.
  isBillingEnabled: boolean;
}

export interface ResolvedPrivateNetworkMonitorPolicy {
  allowed: boolean;
  reason: PrivateNetworkMonitorPolicyReason;
  configuredValue: string | null;
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
  /*
   * Appended to a private-tier refusal. The guards' default sentence names
   * the API server's webhook settings, which this process never reads.
   */
  refusalHint: string;
}

export interface PrivateNetworkMonitorStartupMessage {
  level: "info" | "warn";
  message: string;
}

export default class PrivateNetworkMonitorPolicy {
  public static resolve(
    input: PrivateNetworkMonitorPolicyInput,
  ): ResolvedPrivateNetworkMonitorPolicy {
    const configuredValue: string | null =
      input.configuredValue === undefined ? null : input.configuredValue;

    const base: Omit<
      ResolvedPrivateNetworkMonitorPolicy,
      "allowed" | "reason"
    > = {
      configuredValue: configuredValue,
      isAutoRegisteredGlobalProbe: input.isAutoRegisteredGlobalProbe,
      isBillingEnabled: input.isBillingEnabled,
      refusalHint: this.getRefusalHint(input),
    };

    // Exact match only: anything else fails closed, as it always has.
    if (
      configuredValue === null ||
      configuredValue === "" ||
      configuredValue === "false"
    ) {
      return {
        ...base,
        allowed: false,
        reason: PrivateNetworkMonitorPolicyReason.NotRequested,
      };
    }

    if (configuredValue !== "true") {
      return {
        ...base,
        allowed: false,
        reason: PrivateNetworkMonitorPolicyReason.UnrecognizedValue,
      };
    }

    if (this.isHostedGlobalProbe(input)) {
      return {
        ...base,
        allowed: false,
        reason: PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe,
      };
    }

    return {
      ...base,
      allowed: true,
      reason: PrivateNetworkMonitorPolicyReason.Allowed,
    };
  }

  public static getRefusalHint(
    input: Omit<PrivateNetworkMonitorPolicyInput, "configuredValue">,
  ): string {
    if (this.isHostedGlobalProbe(input)) {
      return " Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.";
    }

    if (input.isAutoRegisteredGlobalProbe) {
      /*
       * Two audiences read this: a project member, who can only pick another
       * probe, and the instance operator, who can open this one. Say what
       * opening it means, since a global probe serves every project.
       */
      return ` Set ${PRIVATE_NETWORK_MONITORS_ENV_VAR}=true on the probe running this monitor to allow it (${PRIVATE_NETWORK_MONITORS_HELM_VALUE} in the Helm chart). This is a global probe, so that allows it for every project on this instance; otherwise, select a private probe deployed on that network.`;
    }

    return ` Set ${PRIVATE_NETWORK_MONITORS_ENV_VAR}=true on the probe running this monitor to allow it.`;
  }

  public static getStartupMessage(
    policy: ResolvedPrivateNetworkMonitorPolicy,
  ): PrivateNetworkMonitorStartupMessage {
    const monitors: string =
      "API, Website, External Status Page and Custom JavaScript Code monitors";
    const alwaysBlocked: string =
      "Loopback, link-local and cloud metadata addresses stay blocked.";

    switch (policy.reason) {
      case PrivateNetworkMonitorPolicyReason.Allowed:
        if (policy.isAutoRegisteredGlobalProbe) {
          return {
            level: "warn",
            message: `Private network monitoring is ON for this global probe (${PRIVATE_NETWORK_MONITORS_ENV_VAR}=true): ${monitors} from every project on this OneUptime instance can reach private network addresses through it. ${alwaysBlocked}`,
          };
        }
        return {
          level: "info",
          message: `Private network monitoring is ON (${PRIVATE_NETWORK_MONITORS_ENV_VAR}=true): ${monitors} on this probe can reach private network addresses. ${alwaysBlocked}`,
        };

      case PrivateNetworkMonitorPolicyReason.UnrecognizedValue:
        // "Set it to true" would be wrong advice where "true" is ignored too.
        return {
          level: "warn",
          message: `${PRIVATE_NETWORK_MONITORS_ENV_VAR} is set to ${this.echoValue(policy.configuredValue)}, which is neither "true" nor "false", so private network monitoring stays OFF. ${
            this.isHostedGlobalProbe(policy)
              ? "A global probe on an instance with BILLING_ENABLED=true stays public-only whatever it is set to."
              : 'Set it to exactly "true" to turn it on.'
          }`,
        };

      case PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe:
        return {
          level: "warn",
          message: `${PRIVATE_NETWORK_MONITORS_ENV_VAR}=true is IGNORED: this is a global probe (REGISTER_PROBE_KEY is set) on an instance with BILLING_ENABLED=true, where anyone can sign up and share it, so its ${monitors} stay public-only. Deploy a private probe for monitors that target an internal network.`,
        };

      case PrivateNetworkMonitorPolicyReason.NotRequested:
      default:
        if (this.isHostedGlobalProbe(policy)) {
          return {
            level: "info",
            message: `Private network monitoring is off: ${monitors} on this global probe refuse private network addresses.`,
          };
        }
        // Only a global probe can be one the Helm chart deployed.
        return {
          level: "info",
          message: `Private network monitoring is off: ${monitors} on this probe refuse private network addresses. Set ${PRIVATE_NETWORK_MONITORS_ENV_VAR}=true on this probe${
            policy.isAutoRegisteredGlobalProbe
              ? ` (${PRIVATE_NETWORK_MONITORS_HELM_VALUE} in the Helm chart)`
              : ""
          } to allow them.`,
        };
    }
  }

  public static logStartupMessage(
    policy: ResolvedPrivateNetworkMonitorPolicy,
  ): void {
    const startupMessage: PrivateNetworkMonitorStartupMessage =
      this.getStartupMessage(policy);

    if (startupMessage.level === "warn") {
      /*
       * Deliberately logger.error with EXTERNAL_FAULT, not logger.warn: the
       * Docker Compose config ships LOG_LEVEL=ERROR, which drops warn(), and
       * these are the lines an operator needs — a value that is being ignored,
       * or a global probe opened to every project. EXTERNAL_FAULT prints them
       * with console.warn at any LOG_LEVEL and exports them at WARN severity,
       * so they never become an Issue: the cause is the probe's configuration.
       */
      logger.error(startupMessage.message, EXTERNAL_FAULT);
      return;
    }

    // The routine on/off line follows LOG_LEVEL like the rest of startup.

    logger.info(startupMessage.message);
  }

  // For the startup environment dump that support asks for in bug reports.
  public static getDiagnosticsSnapshot(
    policy: ResolvedPrivateNetworkMonitorPolicy,
  ): JSONObject {
    return {
      allowed: policy.allowed,
      reason: policy.reason,
      configuredValue: policy.configuredValue,
      autoRegisteredGlobalProbe: policy.isAutoRegisteredGlobalProbe,
      billingEnabled: policy.isBillingEnabled,
    };
  }

  private static isHostedGlobalProbe(input: {
    isAutoRegisteredGlobalProbe: boolean;
    isBillingEnabled: boolean;
  }): boolean {
    return input.isAutoRegisteredGlobalProbe && input.isBillingEnabled;
  }

  private static echoValue(value: string | null): string {
    const text: string = value === null ? "" : value;
    const bounded: string =
      text.length > MAX_ECHOED_VALUE_LENGTH
        ? `${text.slice(0, MAX_ECHOED_VALUE_LENGTH)}...`
        : text;
    // JSON quoting keeps a stray newline from forging a second log line.
    return JSON.stringify(bounded);
  }
}
