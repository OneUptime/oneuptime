import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../Models/DatabaseModels/NetworkAlertPolicy";
import { CriteriaAlert } from "../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import { MonitorStepNetworkDeviceMonitorUtil } from "../../Types/Monitor/MonitorStepNetworkDeviceMonitor";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil from "../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import { NetworkAlertPolicyScopeUtil } from "../../Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "../../Types/ObjectID";

/*
 * The "one click to alerting" path for network devices.
 *
 * An alert policy is only useful once it has a Network Device monitor
 * template to clone, and building one by hand means walking the monitor
 * template form: pick the type, add a step, add five criteria, fill in a
 * severity and a status on each. Most operators want exactly the Recommended
 * Alert Pack (NetworkDeviceAlertPack) on every device, so this util builds
 * that template and the policy that applies it to the whole project, and the
 * settings page find-or-creates the pair from its empty state.
 *
 * FIND-OR-CREATE BY MARKER. The template carries RECOMMENDED_TEMPLATE_MARKER
 * in its description. The name is what an operator renames; the marker is
 * what the bootstrap looks for, so clicking "create the recommended policy"
 * twice — or after the recommended policy was deleted and its template kept
 * — reuses the template instead of minting a second one, and instead of
 * tripping the policy service's "another policy already uses this template"
 * refusal on a duplicate nobody meant to make.
 *
 * WHY THE ITEMS ARE FILLED IN HERE. NetworkDeviceAlertPackUtil deliberately
 * leaves severities and on-call policies for the user to complete on the
 * monitor form. A policy's monitors are never opened in that form — the
 * engine clones them — so a criteria whose `createIncidents` is on but whose
 * `incidents` list is empty would clone into monitors that fire nothing.
 * Every incident-creating item therefore gets one CriteriaIncident and every
 * alert-creating item one CriteriaAlert, both auto-resolving, at the
 * project's lowest-order severity (PingMonitorSeedIds resolves that).
 *
 * NO DEVICE ON THE TEMPLATE STEP. A Network Device step names the device it
 * watches; a template step is a placeholder the engine rebinds per device
 * (NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps), which requires the
 * `networkDeviceMonitor` block to exist and ignores what id it holds. The
 * step is built with the block present and the id unset, which the
 * template's reference validator skips rather than rejects.
 *
 * Pure: no database, no permissions. The caller persists both rows through
 * ModelAPI / the services so tenancy, billing and the policy engine's hooks
 * all run.
 */

export const RECOMMENDED_TEMPLATE_MARKER: string =
  "[oneuptime:network-alert-pack:v1]";

export const RECOMMENDED_TEMPLATE_NAME: string =
  "Network device alert pack (recommended)";

export const RECOMMENDED_POLICY_NAME: string = "Alert on every device";

export interface RecommendedMonitorTemplateSeedIds {
  projectId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
}

export interface RecommendedPolicySeedIds {
  projectId: ObjectID;
  monitorTemplateId: ObjectID;
}

/*
 * The slice of a MonitorTemplate the marker check reads. Kept to one
 * optional field so a caller that listed templates with a narrow `select`
 * can still ask.
 */
export interface RecommendedTemplateCandidate {
  templateDescription?: string | undefined;
}

export default class NetworkAlertPolicyBootstrapUtil {
  /**
   * The template every device's monitor is cloned from: a Network Device
   * template whose single step carries the Recommended Alert Pack, with an
   * incident or an alert filled in on every item.
   */
  public static buildRecommendedMonitorTemplate(
    data: RecommendedMonitorTemplateSeedIds,
  ): MonitorTemplate {
    const criteriaInstances: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: data.offlineMonitorStatusId,
      });

    for (const criteriaInstance of criteriaInstances) {
      NetworkAlertPolicyBootstrapUtil.fillCriteriaActions({
        criteriaInstance: criteriaInstance,
        incidentSeverityId: data.incidentSeverityId,
        alertSeverityId: data.alertSeverityId,
      });
    }

    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = {
      monitorCriteriaInstanceArray: criteriaInstances,
    };

    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.data!.networkDeviceMonitor =
      MonitorStepNetworkDeviceMonitorUtil.getDefault();
    monitorStep.data!.monitorCriteria = monitorCriteria;

    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = {
      monitorStepsInstanceArray: [monitorStep],
      /*
       * Where the monitor goes when no pack item matches — the device is
       * reachable, its walk succeeds, its interfaces are up. Without this a
       * monitor that once went Offline would never come back.
       */
      defaultMonitorStatusId: new ObjectID(
        data.onlineMonitorStatusId.toString(),
      ),
    };

    const template: MonitorTemplate = new MonitorTemplate();
    template.projectId = new ObjectID(data.projectId.toString());
    template.templateName = RECOMMENDED_TEMPLATE_NAME;
    template.templateDescription =
      NetworkAlertPolicyBootstrapUtil.buildRecommendedTemplateDescription();
    template.monitorType = MonitorType.NetworkDevice;
    template.monitorSteps = monitorSteps;
    /*
     * Left blank on purpose: a policy's monitors are named after the device
     * alone, and a default monitor name would become a suffix on every one
     * of them (the auto-import precedent, issue #3486).
     */
    template.monitorDescription =
      "Provisioned by a Network Alert Policy. Edit the policy's template to change what this monitor alerts on; it is re-synced from the template, so edits made here are overwritten.";

    return template;
  }

  /**
   * The policy that applies the template to every device in the project.
   * Unscoped on purpose — that is what "recommended" means here, and the
   * settings table says "All devices" against it so nobody misreads the
   * reach.
   */
  public static buildRecommendedPolicy(
    data: RecommendedPolicySeedIds,
  ): NetworkAlertPolicy {
    const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
    policy.projectId = new ObjectID(data.projectId.toString());
    policy.name = RECOMMENDED_POLICY_NAME;
    policy.description =
      "Every probe-polled device in the project gets a Network Device monitor cloned from the recommended alert pack: an incident when it stops answering ping and SNMP or an interface goes down, and an alert when its SNMP walk fails, an interface saturates or an interface logs errors. A device with no SNMP credentials is pinged rather than walked, so only the reachability item can fire on it until credentials are set. Narrow the scope to sites, roles or labels to cover fewer devices.";
    policy.isEnabled = true;
    policy.monitorTemplateId = new ObjectID(data.monitorTemplateId.toString());
    policy.scope = NetworkAlertPolicyScopeUtil.normalize({});

    return policy;
  }

  /** Whether a template is the one this util minted, by its marker. */
  public static isRecommendedTemplate(
    template: RecommendedTemplateCandidate | null | undefined,
  ): boolean {
    return (template?.templateDescription || "").includes(
      RECOMMENDED_TEMPLATE_MARKER,
    );
  }

  /**
   * The recommended template among a project's templates, or null. The
   * first marked one wins so a project that somehow holds two keeps reusing
   * the same one rather than alternating.
   */
  public static findRecommendedTemplate<
    TTemplate extends RecommendedTemplateCandidate,
  >(templates: Array<TTemplate>): TTemplate | null {
    for (const template of templates) {
      if (NetworkAlertPolicyBootstrapUtil.isRecommendedTemplate(template)) {
        return template;
      }
    }

    return null;
  }

  /**
   * The description the marker lives in. The marker is on its own line at
   * the end so an operator can rewrite the prose above it without losing
   * the tag that makes the template findable.
   */
  public static buildRecommendedTemplateDescription(): string {
    return `The Recommended Alert Pack for network devices: an incident when a device stops answering ping and SNMP or an interface goes down, an alert when the SNMP walk fails, an interface runs above 80% utilization or an interface logs errors. Created by the "Create the recommended policy" action under Network > Settings > Alert Policies; edit the criteria here and every monitor the policy provisions follows. Keep the marker below so the action can find this template again.\n\n${RECOMMENDED_TEMPLATE_MARKER}`;
  }

  /*
   * One CriteriaIncident on an incident-creating item, one CriteriaAlert on
   * an alert-creating one, titled after the pack item so the incident an
   * operator is paged with reads "Device unreachable", not "Criteria 1".
   */
  private static fillCriteriaActions(data: {
    criteriaInstance: MonitorCriteriaInstance;
    incidentSeverityId: ObjectID;
    alertSeverityId: ObjectID;
  }): void {
    const criteriaData: MonitorCriteriaInstance["data"] =
      data.criteriaInstance.data;

    if (!criteriaData) {
      return;
    }

    if (criteriaData.createIncidents) {
      const incident: CriteriaIncident = {
        id: ObjectID.generate().toString(),
        title: criteriaData.name,
        description: criteriaData.description,
        incidentSeverityId: new ObjectID(data.incidentSeverityId.toString()),
        autoResolveIncident: true,
        onCallPolicyIds: [],
      };

      criteriaData.incidents = [incident];
    }

    if (criteriaData.createAlerts) {
      const alert: CriteriaAlert = {
        id: ObjectID.generate().toString(),
        title: criteriaData.name,
        description: criteriaData.description,
        alertSeverityId: new ObjectID(data.alertSeverityId.toString()),
        autoResolveAlert: true,
        onCallPolicyIds: [],
      };

      criteriaData.alerts = [alert];
    }
  }
}
