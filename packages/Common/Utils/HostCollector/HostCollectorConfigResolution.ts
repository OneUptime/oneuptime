import { HostCollectorOsType } from "../../Types/HostCollector/HostCollector";

/*
 * Which config a host runs. The one rule, used by the server when it answers
 * a host and by the Dashboard when it says which hosts a config reaches:
 *
 *   1. A config picked for the host on its own page wins.
 *   2. Otherwise the first Collector Config in the list (the order people
 *      drag them into) that is for the host's system and, when it names
 *      labels, for a host with at least one of them.
 *   3. Otherwise OneUptime's default for the host's system.
 *
 * A host whose system is not known yet only gets configs for any system.
 */

export interface HostCollectorConfigCandidate {
  id: string;
  osType: HostCollectorOsType;
  // The labels it is for. Empty: every host of its system.
  labelIds: Array<string>;
  // Its place in the list: lower first.
  order: number;
}

export interface HostCollectorConfigTarget {
  osType: HostCollectorOsType | null;
  labelIds: Array<string>;
  // The config picked for this host on its own page, if any.
  pinnedConfigId?: string | null | undefined;
}

export enum HostCollectorConfigChoiceReason {
  // Picked for this host on its page.
  Pinned = "pinned",
  // The first config in the list that applies to the host.
  Matched = "matched",
  // No config applies: OneUptime's default for the host's system.
  Default = "default",
}

export interface HostCollectorConfigChoice {
  // The config the host runs, or null for OneUptime's default.
  configId: string | null;
  reason: HostCollectorConfigChoiceReason;
}

// Whether a config is for this host, before its place in the list counts.
export function doesHostCollectorConfigApply(
  candidate: HostCollectorConfigCandidate,
  target: HostCollectorConfigTarget,
): boolean {
  const isForSystem: boolean =
    candidate.osType === HostCollectorOsType.Any ||
    (target.osType !== null && candidate.osType === target.osType);

  if (!isForSystem) {
    return false;
  }

  if (candidate.labelIds.length === 0) {
    return true;
  }

  return candidate.labelIds.some((labelId: string): boolean => {
    return target.labelIds.includes(labelId);
  });
}

// The candidates in list order; equal places keep the order they came in.
export function sortHostCollectorConfigCandidates(
  candidates: ReadonlyArray<HostCollectorConfigCandidate>,
): Array<HostCollectorConfigCandidate> {
  return candidates
    .map((candidate: HostCollectorConfigCandidate, index: number) => {
      return { candidate, index };
    })
    .sort(
      (
        a: { candidate: HostCollectorConfigCandidate; index: number },
        b: { candidate: HostCollectorConfigCandidate; index: number },
      ): number => {
        const byOrder: number = a.candidate.order - b.candidate.order;
        return byOrder !== 0 ? byOrder : a.index - b.index;
      },
    )
    .map(
      (item: {
        candidate: HostCollectorConfigCandidate;
        index: number;
      }): HostCollectorConfigCandidate => {
        return item.candidate;
      },
    );
}

export function chooseHostCollectorConfig(
  candidates: ReadonlyArray<HostCollectorConfigCandidate>,
  target: HostCollectorConfigTarget,
): HostCollectorConfigChoice {
  if (target.pinnedConfigId) {
    const pinned: HostCollectorConfigCandidate | undefined = candidates.find(
      (candidate: HostCollectorConfigCandidate): boolean => {
        return candidate.id === target.pinnedConfigId;
      },
    );

    if (pinned) {
      return {
        configId: pinned.id,
        reason: HostCollectorConfigChoiceReason.Pinned,
      };
    }
  }

  const match: HostCollectorConfigCandidate | undefined =
    sortHostCollectorConfigCandidates(candidates).find(
      (candidate: HostCollectorConfigCandidate): boolean => {
        return doesHostCollectorConfigApply(candidate, target);
      },
    );

  if (match) {
    return {
      configId: match.id,
      reason: HostCollectorConfigChoiceReason.Matched,
    };
  }

  return {
    configId: null,
    reason: HostCollectorConfigChoiceReason.Default,
  };
}
