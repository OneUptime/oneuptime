import { RuleCriteriaSubject } from "../../../Types/Rules/RuleCriteriaSubject";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * THE TWO ANSWERS TO "WHAT DOES THIS RULE APPLY TO?", IN THE WORDS OF ITS
 * RECORDS.
 *
 *   (o) All incidents
 *   ( ) Only incidents that match conditions
 *
 * Every phrase is whole in the locale files, one per kind of record: "All"
 * agrees with its noun in most languages ("Tous les incidents", "Toutes les
 * alertes"), so it is never "All" + a translated noun. React-free, so the
 * workspace rules' copy (NotificationRuleCopy) and App's tests can read it.
 */
export interface RuleCriteriaSubjectCopy {
  // The answer that leaves the rule without conditions: "All incidents".
  readonly all: string;
  // The answer that opens the conditions: "Only incidents that match conditions".
  readonly matching: string;
}

export const RULE_CRITERIA_SUBJECT_COPY: Readonly<
  Record<RuleCriteriaSubject, RuleCriteriaSubjectCopy>
> = {
  [RuleCriteriaSubject.Incidents]: {
    all: translationKey("All incidents"),
    matching: translationKey("Only incidents that match conditions"),
  },
  [RuleCriteriaSubject.Alerts]: {
    all: translationKey("All alerts"),
    matching: translationKey("Only alerts that match conditions"),
  },
  [RuleCriteriaSubject.IncidentEpisodes]: {
    all: translationKey("All incident episodes"),
    matching: translationKey("Only incident episodes that match conditions"),
  },
  [RuleCriteriaSubject.AlertEpisodes]: {
    all: translationKey("All alert episodes"),
    matching: translationKey("Only alert episodes that match conditions"),
  },
  [RuleCriteriaSubject.ScheduledMaintenanceEvents]: {
    all: translationKey("All scheduled maintenance events"),
    matching: translationKey(
      "Only scheduled maintenance events that match conditions",
    ),
  },
  [RuleCriteriaSubject.Monitors]: {
    all: translationKey("All monitors"),
    matching: translationKey("Only monitors that match conditions"),
  },
  [RuleCriteriaSubject.StatusPages]: {
    all: translationKey("All status pages"),
    matching: translationKey("Only status pages that match conditions"),
  },
  [RuleCriteriaSubject.ServiceLevelObjectives]: {
    all: translationKey("All SLOs"),
    matching: translationKey("Only SLOs that match conditions"),
  },
  [RuleCriteriaSubject.NetworkDevices]: {
    all: translationKey("All network devices"),
    matching: translationKey("Only network devices that match conditions"),
  },
  [RuleCriteriaSubject.Hosts]: {
    all: translationKey("All hosts"),
    matching: translationKey("Only hosts that match conditions"),
  },
  [RuleCriteriaSubject.KubernetesClusters]: {
    all: translationKey("All Kubernetes clusters"),
    matching: translationKey("Only Kubernetes clusters that match conditions"),
  },
  [RuleCriteriaSubject.DockerHosts]: {
    all: translationKey("All Docker hosts"),
    matching: translationKey("Only Docker hosts that match conditions"),
  },
  [RuleCriteriaSubject.DockerSwarmClusters]: {
    all: translationKey("All Docker Swarm clusters"),
    matching: translationKey(
      "Only Docker Swarm clusters that match conditions",
    ),
  },
  [RuleCriteriaSubject.PodmanHosts]: {
    all: translationKey("All Podman hosts"),
    matching: translationKey("Only Podman hosts that match conditions"),
  },
  [RuleCriteriaSubject.ProxmoxClusters]: {
    all: translationKey("All Proxmox clusters"),
    matching: translationKey("Only Proxmox clusters that match conditions"),
  },
  [RuleCriteriaSubject.VMwareVCenters]: {
    all: translationKey("All vCenters"),
    matching: translationKey("Only vCenters that match conditions"),
  },
  [RuleCriteriaSubject.CephClusters]: {
    all: translationKey("All Ceph clusters"),
    matching: translationKey("Only Ceph clusters that match conditions"),
  },
  [RuleCriteriaSubject.CloudResources]: {
    all: translationKey("All cloud resources"),
    matching: translationKey("Only cloud resources that match conditions"),
  },
  [RuleCriteriaSubject.ServerlessFunctions]: {
    all: translationKey("All serverless functions"),
    matching: translationKey("Only serverless functions that match conditions"),
  },
  [RuleCriteriaSubject.Databases]: {
    all: translationKey("All databases"),
    matching: translationKey("Only databases that match conditions"),
  },
  [RuleCriteriaSubject.MessageQueues]: {
    all: translationKey("All queues"),
    matching: translationKey("Only queues that match conditions"),
  },
  [RuleCriteriaSubject.IoTFleets]: {
    all: translationKey("All IoT fleets"),
    matching: translationKey("Only IoT fleets that match conditions"),
  },
  [RuleCriteriaSubject.RumApplications]: {
    all: translationKey("All RUM applications"),
    matching: translationKey("Only RUM applications that match conditions"),
  },
  [RuleCriteriaSubject.Services]: {
    all: translationKey("All services"),
    matching: translationKey("Only services that match conditions"),
  },
  [RuleCriteriaSubject.Dashboards]: {
    all: translationKey("All dashboards"),
    matching: translationKey("Only dashboards that match conditions"),
  },
  [RuleCriteriaSubject.OnCallPolicies]: {
    all: translationKey("All on-call policies"),
    matching: translationKey("Only on-call policies that match conditions"),
  },
  [RuleCriteriaSubject.OnCallSchedules]: {
    all: translationKey("All on-call schedules"),
    matching: translationKey("Only on-call schedules that match conditions"),
  },
  [RuleCriteriaSubject.IncomingCallPolicies]: {
    all: translationKey("All incoming call policies"),
    matching: translationKey(
      "Only incoming call policies that match conditions",
    ),
  },
  [RuleCriteriaSubject.Runbooks]: {
    all: translationKey("All runbooks"),
    matching: translationKey("Only runbooks that match conditions"),
  },
  [RuleCriteriaSubject.Workflows]: {
    all: translationKey("All workflows"),
    matching: translationKey("Only workflows that match conditions"),
  },
  [RuleCriteriaSubject.StorageArrays]: {
    all: translationKey("All storage arrays"),
    matching: translationKey("Only storage arrays that match conditions"),
  },
  [RuleCriteriaSubject.DataStores]: {
    all: translationKey("All data stores"),
    matching: translationKey("Only data stores that match conditions"),
  },
};

/*
 * For a rule whose records nothing names - a model added without a subject,
 * or a builder drawn on its own: the same choice, without a noun.
 */
export const RULE_CRITERIA_ANY_SUBJECT_COPY: RuleCriteriaSubjectCopy = {
  all: translationKey("Everything"),
  matching: translationKey("Only what matches conditions"),
};

export function getRuleCriteriaSubjectCopy(
  subject: RuleCriteriaSubject | null | undefined,
): RuleCriteriaSubjectCopy {
  return (
    (subject && RULE_CRITERIA_SUBJECT_COPY[subject]) ||
    RULE_CRITERIA_ANY_SUBJECT_COPY
  );
}
