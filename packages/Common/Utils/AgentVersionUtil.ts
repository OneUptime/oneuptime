import VersionUtil, { ParsedVersion } from "./VersionUtil";

/*
 * Is an agent's self-reported version behind the newest one?
 *
 * Agents report their version on every heartbeat (the
 * `oneuptime.agent.version` resource attribute, or the Runner's and the AI
 * agents' registration). The Dashboard shows that version on each resource,
 * and a sign beside it when a newer agent is available. This is the one
 * place that decides "newer", so every resource answers it the same way.
 *
 * Deliberately conservative - a wrong "outdated" sends someone to upgrade an
 * agent that is fine, so every uncertain case is Unknown, never Outdated:
 *
 *   - a missing or unparsable agent version ("", "unknown", "14.0", a dev
 *     build) is Unknown;
 *   - a placeholder an agent reports before it knows its own version (the
 *     Runner and the Kubernetes agent chart say "1.0.0" when built without
 *     a release version) is Unknown;
 *   - a missing or unparsable latest version (a dev server built without
 *     APP_VERSION) is Unknown;
 *   - a latest version that is a pre-release is Unknown: the upgrade
 *     commands pull the newest stable release, which would never reach a
 *     release candidate, so the sign could never go away;
 *   - an agent level with or ahead of the latest is UpToDate (a self-hosted
 *     server can be older than the agent image it pulled).
 *
 * Versions compare as semantic versions (VersionUtil), never as strings:
 * 14.0.9 is older than 14.0.10, and 14.0.14-rc.1 is older than 14.0.14.
 */

export enum AgentVersionStatus {
  Outdated = "outdated",
  UpToDate = "up-to-date",
  Unknown = "unknown",
}

export interface AgentVersionComparison {
  // What the agent reported, as stored.
  agentVersion: unknown;
  // The newest version of this agent, or nothing when it cannot be known.
  latestVersion: unknown;
  // Versions that mean "not reported yet" for this agent.
  placeholderVersions?: ReadonlyArray<string> | undefined;
}

export default class AgentVersionUtil {
  public static getStatus(data: AgentVersionComparison): AgentVersionStatus {
    const agent: ParsedVersion | null = VersionUtil.parse(data.agentVersion);

    if (!agent) {
      return AgentVersionStatus.Unknown;
    }

    if (this.isPlaceholder(data.agentVersion, data.placeholderVersions)) {
      return AgentVersionStatus.Unknown;
    }

    const latest: ParsedVersion | null = VersionUtil.parse(data.latestVersion);

    if (!latest || latest.prerelease) {
      return AgentVersionStatus.Unknown;
    }

    const comparison: number | null = VersionUtil.compare(
      data.agentVersion,
      data.latestVersion,
    );

    if (comparison === null) {
      return AgentVersionStatus.Unknown;
    }

    return comparison < 0
      ? AgentVersionStatus.Outdated
      : AgentVersionStatus.UpToDate;
  }

  public static isOutdated(data: AgentVersionComparison): boolean {
    return this.getStatus(data) === AgentVersionStatus.Outdated;
  }

  /*
   * Compared in canonical form, so "v1.0.0" and "1.0.0+build" are the
   * placeholder "1.0.0" too.
   */
  private static isPlaceholder(
    agentVersion: unknown,
    placeholderVersions: ReadonlyArray<string> | undefined,
  ): boolean {
    if (!placeholderVersions || placeholderVersions.length === 0) {
      return false;
    }

    const canonical: string | null = VersionUtil.canonicalize(agentVersion);

    if (!canonical) {
      return false;
    }

    return placeholderVersions.some((placeholder: string): boolean => {
      return VersionUtil.canonicalize(placeholder) === canonical;
    });
  }
}
