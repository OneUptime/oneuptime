import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import DockerHostService from "../../Services/DockerHostService";
import HostService from "../../Services/HostService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import PodmanHostService from "../../Services/PodmanHostService";
import ServiceService from "../../Services/ServiceService";
import { LogAttributes } from "../Logger";
import MonitorRuleCriteriaCache from "./MonitorRuleCriteriaCache";
import RuleRecordScope from "./RuleRecordScope";

/*
 * WHAT A PROJECT'S LABEL RULES ADD TO ONE INCIDENT OR ALERT, before anything
 * is written (#7212).
 *
 * An incident or alert label rule that matches adds the labels it lists and,
 * with its Inherit Labels switches, every label of the record's monitors,
 * hosts, Kubernetes clusters, Docker and Podman hosts and services - the
 * project's own labels only (RuleRecordScope). Every rule is matched on the
 * record as it is: a label one rule adds does not make another match in the
 * same pass.
 *
 * The create carries the plan out (applyRulesToIncident, applyRulesToAlert:
 * the labels the record lacks are added, and the record held in memory takes
 * them, so its on-call rules match on them next), and "When this goes down"
 * (WhoIsToldService) reads the same plan of the incident or alert a
 * monitor's criteria would open - so an on-call rule that pages for a label
 * a label rule adds pages on the card as it does for a real record.
 */

// A resource a label rule inherits labels from.
export type LabelRuleInheritSource =
  | "monitors"
  | "hosts"
  | "kubernetesClusters"
  | "dockerHosts"
  | "podmanHosts"
  | "services";

// The switches of a label rule, as both incident and alert label rules have them.
export interface LabelRuleLike {
  labelsToAdd?: Array<{ id?: ObjectID | null | undefined }> | undefined;
  inheritLabelsFromMonitors?: boolean | undefined;
  inheritLabelsFromHosts?: boolean | undefined;
  inheritLabelsFromKubernetesClusters?: boolean | undefined;
  inheritLabelsFromDockerHosts?: boolean | undefined;
  inheritLabelsFromPodmanHosts?: boolean | undefined;
  inheritLabelsFromServices?: boolean | undefined;
}

// The ids of a record's resources of each kind.
export interface LabelInheritableResources {
  monitorIds: Array<ObjectID>;
  hostIds: Array<ObjectID>;
  kubernetesClusterIds: Array<ObjectID>;
  dockerHostIds: Array<ObjectID>;
  podmanHostIds: Array<ObjectID>;
  serviceIds: Array<ObjectID>;
}

// One matched rule, and the labels it adds.
export interface LabelRulePlanEntry<TRule> {
  rule: TRule;
  // The project's labels it names or inherits, each once, in order.
  labelIds: Array<string>;
}

export interface LabelRulePlan<TRule> {
  // The rules that match, in the order they are read.
  matchedRules: Array<TRule>;
  // Each of them, with the labels it adds.
  entries: Array<LabelRulePlanEntry<TRule>>;
  // Every label they add, each once, in order: the project's own only.
  labelIds: Array<string>;
}

export function getNoLabelRulePlan<TRule>(): LabelRulePlan<TRule> {
  return { matchedRules: [], entries: [], labelIds: [] };
}

// The resources a rule inherits labels from.
export function getLabelRuleInheritSources(
  rule: LabelRuleLike,
): Array<LabelRuleInheritSource> {
  const sources: Array<LabelRuleInheritSource> = [];

  if (rule.inheritLabelsFromMonitors) {
    sources.push("monitors");
  }

  if (rule.inheritLabelsFromHosts) {
    sources.push("hosts");
  }

  if (rule.inheritLabelsFromKubernetesClusters) {
    sources.push("kubernetesClusters");
  }

  if (rule.inheritLabelsFromDockerHosts) {
    sources.push("dockerHosts");
  }

  if (rule.inheritLabelsFromPodmanHosts) {
    sources.push("podmanHosts");
  }

  if (rule.inheritLabelsFromServices) {
    sources.push("services");
  }

  return sources;
}

// Whether any of these rules inherits labels from a resource other than the monitor.
export function doLabelRulesInheritFromResources(
  rules: ReadonlyArray<LabelRuleLike>,
): boolean {
  return rules.some((rule: LabelRuleLike): boolean => {
    return getLabelRuleInheritSources(rule).some(
      (source: LabelRuleInheritSource): boolean => {
        return source !== "monitors";
      },
    );
  });
}

// The ids of related rows a record was handed, each once.
export function getLabelResourceIds(
  resources:
    | Array<{ id?: ObjectID | null | undefined } | null | undefined>
    | null
    | undefined,
): Array<ObjectID> {
  const ids: Array<ObjectID> = [];
  const seen: Set<string> = new Set<string>();

  for (const resource of resources || []) {
    const id: ObjectID | null | undefined = resource?.id;

    if (id && !seen.has(id.toString())) {
      seen.add(id.toString());
      ids.push(id);
    }
  }

  return ids;
}

function labelIdsOf(
  labels: Array<{ id?: ObjectID | null | undefined }> | null | undefined,
): Array<string> {
  return (labels || [])
    .map((label: { id?: ObjectID | null | undefined }): string => {
      return label.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });
}

export default class LabelRulePlanBuilder {
  /*
   * The labels of each source a matched rule inherits from, read as
   * OneUptime, once per plan: a monitor's through the matching's monitor
   * cache (its labels are among what it reads), the rest one record at a
   * time, as the engines always read them.
   */
  public static async readInheritedLabels(data: {
    sources: Set<LabelRuleInheritSource>;
    resources: LabelInheritableResources;
    monitorCache: MonitorRuleCriteriaCache;
  }): Promise<Map<LabelRuleInheritSource, Array<string>>> {
    const inherited: Map<LabelRuleInheritSource, Array<string>> = new Map();

    const add: (source: LabelRuleInheritSource, ids: Array<string>) => void = (
      source: LabelRuleInheritSource,
      ids: Array<string>,
    ): void => {
      inherited.set(source, [...(inherited.get(source) || []), ...ids]);
    };

    if (data.sources.has("monitors")) {
      for (const id of data.resources.monitorIds) {
        const monitor: Monitor | null = await data.monitorCache.getMonitor(id);
        add("monitors", labelIdsOf(monitor?.labels));
      }
    }

    if (data.sources.has("hosts")) {
      for (const id of data.resources.hostIds) {
        const host: Host | null = await HostService.findOneById({
          id: id,
          select: { labels: { _id: true } },
          props: { isRoot: true },
        });
        add("hosts", labelIdsOf(host?.labels));
      }
    }

    if (data.sources.has("kubernetesClusters")) {
      for (const id of data.resources.kubernetesClusterIds) {
        const cluster: KubernetesCluster | null =
          await KubernetesClusterService.findOneById({
            id: id,
            select: { labels: { _id: true } },
            props: { isRoot: true },
          });
        add("kubernetesClusters", labelIdsOf(cluster?.labels));
      }
    }

    if (data.sources.has("dockerHosts")) {
      for (const id of data.resources.dockerHostIds) {
        const dockerHost: DockerHost | null =
          await DockerHostService.findOneById({
            id: id,
            select: { labels: { _id: true } },
            props: { isRoot: true },
          });
        add("dockerHosts", labelIdsOf(dockerHost?.labels));
      }
    }

    if (data.sources.has("podmanHosts")) {
      for (const id of data.resources.podmanHostIds) {
        const podmanHost: PodmanHost | null =
          await PodmanHostService.findOneById({
            id: id,
            select: { labels: { _id: true } },
            props: { isRoot: true },
          });
        add("podmanHosts", labelIdsOf(podmanHost?.labels));
      }
    }

    if (data.sources.has("services")) {
      for (const id of data.resources.serviceIds) {
        const service: Service | null = await ServiceService.findOneById({
          id: id,
          select: { labels: { _id: true } },
          props: { isRoot: true },
        });
        add("services", labelIdsOf(service?.labels));
      }
    }

    return inherited;
  }

  /*
   * The plan of the rules that matched: what each adds - the labels it
   * names and those of the resources it inherits from - and all of them
   * together, the project's own only. A failed read of which labels are
   * the project's is thrown, as the engines report it.
   */
  public static async build<TRule extends LabelRuleLike>(data: {
    projectId: ObjectID;
    matchedRules: Array<TRule>;
    // Read only when a matched rule inherits from something but its monitor.
    getResources: () => Promise<LabelInheritableResources>;
    monitorIds: Array<ObjectID>;
    monitorCache: MonitorRuleCriteriaCache;
    // For the log: "labels of incident label rules".
    description: string;
    logAttributes: LogAttributes;
  }): Promise<LabelRulePlan<TRule>> {
    if (data.matchedRules.length === 0) {
      return getNoLabelRulePlan<TRule>();
    }

    const sources: Set<LabelRuleInheritSource> =
      new Set<LabelRuleInheritSource>();

    for (const rule of data.matchedRules) {
      for (const source of getLabelRuleInheritSources(rule)) {
        sources.add(source);
      }
    }

    const resources: LabelInheritableResources =
      doLabelRulesInheritFromResources(data.matchedRules)
        ? { ...(await data.getResources()), monitorIds: data.monitorIds }
        : {
            monitorIds: data.monitorIds,
            hostIds: [],
            kubernetesClusterIds: [],
            dockerHostIds: [],
            podmanHostIds: [],
            serviceIds: [],
          };

    const inherited: Map<LabelRuleInheritSource, Array<string>> = sources.size >
    0
      ? await this.readInheritedLabels({
          sources: sources,
          resources: resources,
          monitorCache: data.monitorCache,
        })
      : new Map<LabelRuleInheritSource, Array<string>>();

    const asked: Array<{ rule: TRule; labelIds: Array<string> }> =
      data.matchedRules.map((rule: TRule) => {
        const ids: Array<string> = labelIdsOf(rule.labelsToAdd);

        for (const source of getLabelRuleInheritSources(rule)) {
          ids.push(...(inherited.get(source) || []));
        }

        return { rule: rule, labelIds: Array.from(new Set<string>(ids)) };
      });

    const all: Array<string> = Array.from(
      new Set<string>(
        asked.flatMap((entry: { labelIds: Array<string> }): Array<string> => {
          return entry.labelIds;
        }),
      ),
    );

    /*
     * Only the project's own labels. The rules' lists are checked when a
     * rule is saved, but a rule saved before that can still name another
     * project's label, and the labels are attached as root.
     */
    const kept: Set<string> = new Set<string>(
      await RuleRecordScope.keepIdsInProject({
        projectId: data.projectId,
        ids: all,
        modelType: Label,
        description: data.description,
        logAttributes: data.logAttributes,
      }),
    );

    return {
      matchedRules: data.matchedRules,
      entries: asked.map(
        (entry: {
          rule: TRule;
          labelIds: Array<string>;
        }): LabelRulePlanEntry<TRule> => {
          return {
            rule: entry.rule,
            labelIds: entry.labelIds.filter((id: string): boolean => {
              return kept.has(id);
            }),
          };
        },
      ),
      labelIds: all.filter((id: string): boolean => {
        return kept.has(id);
      }),
    };
  }
}
