import { describe, expect, test } from "@jest/globals";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import { NetworkAlertPolicyScopeUtil } from "../../../Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "../../../Types/ObjectID";
import NetworkDeviceMonitorTemplateUtil from "../../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
import NetworkAlertPolicyBootstrapUtil, {
  RECOMMENDED_POLICY_NAME,
  RECOMMENDED_TEMPLATE_MARKER,
  RECOMMENDED_TEMPLATE_NAME,
  RecommendedMonitorTemplateSeedIds,
} from "../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";

/*
 * The bootstrap is the one path that builds a Network Device template with
 * nobody looking at the monitor form, so nothing catches a half-filled
 * criteria before the engine clones it onto a fleet. What has to hold:
 *
 *   - the template is a Network Device template whose one step carries the
 *     alert pack, item for item;
 *   - every incident-creating item has an incident, every alert-creating
 *     item has an alert, at the severities it was given, auto-resolving;
 *   - the statuses are threaded through: offline on the incident items,
 *     online as the step's default;
 *   - the step has no device (the engine binds one per device) but has the
 *     block the engine's rebind requires;
 *   - the marker is a fixed string in the description, so the settings page
 *     finds the template again instead of minting a second one;
 *   - the recommended policy is unscoped and points at the template.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const SEED_IDS: RecommendedMonitorTemplateSeedIds = {
  projectId: PROJECT_ID,
  incidentSeverityId: INCIDENT_SEVERITY_ID,
  alertSeverityId: ALERT_SEVERITY_ID,
  onlineMonitorStatusId: ONLINE_STATUS_ID,
  offlineMonitorStatusId: OFFLINE_STATUS_ID,
};

type BuildTemplateFunction = () => MonitorTemplate;

const buildTemplate: BuildTemplateFunction = (): MonitorTemplate => {
  return NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate(
    SEED_IDS,
  );
};

type CriteriaOfFunction = (
  template: MonitorTemplate,
) => Array<MonitorCriteriaInstance>;

const criteriaOf: CriteriaOfFunction = (
  template: MonitorTemplate,
): Array<MonitorCriteriaInstance> => {
  const step: MonitorStep | undefined =
    template.monitorSteps?.data?.monitorStepsInstanceArray[0];

  return step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
};

describe("NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate", () => {
  test("is a Network Device template in the project, named and marked", () => {
    const template: MonitorTemplate = buildTemplate();

    expect(template.monitorType).toBe(MonitorType.NetworkDevice);
    expect(template.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(template.templateName).toBe(RECOMMENDED_TEMPLATE_NAME);
    expect(template.templateDescription).toContain(RECOMMENDED_TEMPLATE_MARKER);
    /*
     * Deliberately blank: a default monitor name becomes a suffix on every
     * provisioned monitor's name.
     */
    expect(template.monitorName).toBeUndefined();
  });

  /*
   * The settings page finds the template by this string. Changing it would
   * orphan every template already minted and make the action mint another.
   */
  test("the marker is a fixed, versioned string", () => {
    expect(RECOMMENDED_TEMPLATE_MARKER).toBe(
      "[oneuptime:network-alert-pack:v1]",
    );
  });

  test("has exactly one step, carrying the alert pack item for item", () => {
    const template: MonitorTemplate = buildTemplate();
    const packItems: Array<NetworkDeviceAlertPackItem> =
      NetworkDeviceAlertPackUtil.getPackItems();

    expect(template.monitorSteps?.data?.monitorStepsInstanceArray).toHaveLength(
      1,
    );

    const criteria: Array<MonitorCriteriaInstance> = criteriaOf(template);

    expect(criteria).toHaveLength(packItems.length);
    expect(
      criteria.map((criteriaInstance: MonitorCriteriaInstance): string => {
        return criteriaInstance.data?.name || "";
      }),
    ).toEqual(
      packItems.map((item: NetworkDeviceAlertPackItem): string => {
        return item.name;
      }),
    );

    for (const criteriaInstance of criteria) {
      expect(criteriaInstance.data?.isEnabled).toBe(true);
      expect(criteriaInstance.data?.filters.length).toBeGreaterThan(0);
    }
  });

  test("every pack item has either an incident or an alert filled in, never neither", () => {
    const criteria: Array<MonitorCriteriaInstance> =
      criteriaOf(buildTemplate());

    for (const criteriaInstance of criteria) {
      const incidents: number = criteriaInstance.data?.incidents.length || 0;
      const alerts: number = criteriaInstance.data?.alerts.length || 0;

      expect(incidents + alerts).toBeGreaterThan(0);

      if (criteriaInstance.data?.createIncidents) {
        expect(incidents).toBe(1);
      } else {
        expect(incidents).toBe(0);
      }

      if (criteriaInstance.data?.createAlerts) {
        expect(alerts).toBe(1);
      } else {
        expect(alerts).toBe(0);
      }
    }
  });

  test("incident items carry the incident severity, auto-resolve and are titled after the item", () => {
    const criteria: Array<MonitorCriteriaInstance> =
      criteriaOf(buildTemplate());

    const incidentItems: Array<MonitorCriteriaInstance> = criteria.filter(
      (criteriaInstance: MonitorCriteriaInstance): boolean => {
        return Boolean(criteriaInstance.data?.createIncidents);
      },
    );

    expect(incidentItems.length).toBeGreaterThan(0);

    for (const criteriaInstance of incidentItems) {
      const incident: MonitorCriteriaInstance["data"] extends infer D
        ? D extends { incidents: Array<infer I> }
          ? I
          : never
        : never = criteriaInstance.data!.incidents[0]!;

      expect(incident.incidentSeverityId?.toString()).toBe(
        INCIDENT_SEVERITY_ID.toString(),
      );
      expect(incident.autoResolveIncident).toBe(true);
      expect(incident.title).toBe(criteriaInstance.data?.name);
      expect(incident.description).toBe(criteriaInstance.data?.description);
      expect(incident.id).toBeTruthy();
      expect(incident.onCallPolicyIds).toEqual([]);
    }
  });

  test("alert items carry the alert severity, auto-resolve and are titled after the item", () => {
    const criteria: Array<MonitorCriteriaInstance> =
      criteriaOf(buildTemplate());

    const alertItems: Array<MonitorCriteriaInstance> = criteria.filter(
      (criteriaInstance: MonitorCriteriaInstance): boolean => {
        return Boolean(criteriaInstance.data?.createAlerts);
      },
    );

    expect(alertItems.length).toBeGreaterThan(0);

    for (const criteriaInstance of alertItems) {
      const alert: MonitorCriteriaInstance["data"] extends infer D
        ? D extends { alerts: Array<infer A> }
          ? A
          : never
        : never = criteriaInstance.data!.alerts[0]!;

      expect(alert.alertSeverityId?.toString()).toBe(
        ALERT_SEVERITY_ID.toString(),
      );
      expect(alert.autoResolveAlert).toBe(true);
      expect(alert.title).toBe(criteriaInstance.data?.name);
      expect(alert.description).toBe(criteriaInstance.data?.description);
      expect(alert.id).toBeTruthy();
    }
  });

  test("threads the offline status onto incident items and the online status onto the step default", () => {
    const template: MonitorTemplate = buildTemplate();

    expect(
      template.monitorSteps?.data?.defaultMonitorStatusId?.toString(),
    ).toBe(ONLINE_STATUS_ID.toString());

    for (const criteriaInstance of criteriaOf(template)) {
      expect(criteriaInstance.data?.monitorStatusId?.toString()).toBe(
        OFFLINE_STATUS_ID.toString(),
      );

      if (criteriaInstance.data?.createIncidents) {
        expect(criteriaInstance.data?.changeMonitorStatus).toBe(true);
      } else {
        // An alert is not an outage; the monitor's status stays put.
        expect(criteriaInstance.data?.changeMonitorStatus).toBe(false);
      }
    }
  });

  /*
   * The engine clones the template per device and writes the device id into
   * the step; the block it writes into has to exist, and the id has to be
   * empty so the template's reference validator skips it rather than
   * looking up a device that is not there.
   */
  test("the step carries a Network Device block with no device, and the engine can rebind it", () => {
    const template: MonitorTemplate = buildTemplate();
    const step: MonitorStep =
      template.monitorSteps!.data!.monitorStepsInstanceArray[0]!;

    expect(step.data?.networkDeviceMonitor).toBeDefined();
    expect(step.data?.networkDeviceMonitor?.networkDeviceId).toBeUndefined();

    const rebound: MonitorSteps =
      NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
        monitorSteps: template.monitorSteps,
        networkDeviceId: DEVICE_ID,
      });

    expect(
      rebound.data?.monitorStepsInstanceArray[0]?.data?.networkDeviceMonitor
        ?.networkDeviceId,
    ).toBe(DEVICE_ID.toString());
    // The template itself is not mutated by the rebind.
    expect(step.data?.networkDeviceMonitor?.networkDeviceId).toBeUndefined();
  });

  /*
   * The template reaches the server as JSON (ModelAPI serializes it) and is
   * read back through MonitorSteps.fromJSON on every use. A shape that does
   * not survive that round trip would be accepted at create and useless
   * afterwards.
   */
  test("survives a JSON round trip with its criteria and actions intact", () => {
    const template: MonitorTemplate = buildTemplate();
    const json: JSONObject = template.monitorSteps!.toJSON();
    const restored: MonitorSteps = MonitorSteps.fromJSON(json);

    expect(restored.data?.defaultMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );

    const restoredCriteria: Array<MonitorCriteriaInstance> =
      restored.data?.monitorStepsInstanceArray[0]?.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    expect(restoredCriteria).toHaveLength(
      NetworkDeviceAlertPackUtil.getPackItems().length,
    );

    for (const criteriaInstance of restoredCriteria) {
      const incidents: number = criteriaInstance.data?.incidents.length || 0;
      const alerts: number = criteriaInstance.data?.alerts.length || 0;

      expect(incidents + alerts).toBeGreaterThan(0);
    }
  });

  test("builds fresh ids on every call, so two projects never share a criteria id", () => {
    const first: Array<MonitorCriteriaInstance> = criteriaOf(buildTemplate());
    const second: Array<MonitorCriteriaInstance> = criteriaOf(buildTemplate());

    const firstIds: Set<string> = new Set<string>(
      first.map((criteriaInstance: MonitorCriteriaInstance): string => {
        return criteriaInstance.data!.id;
      }),
    );

    for (const criteriaInstance of second) {
      expect(firstIds.has(criteriaInstance.data!.id)).toBe(false);
    }
  });
});

describe("NetworkAlertPolicyBootstrapUtil.buildRecommendedPolicy", () => {
  test("is an enabled, unscoped policy on the template in the project", () => {
    const policy: NetworkAlertPolicy =
      NetworkAlertPolicyBootstrapUtil.buildRecommendedPolicy({
        projectId: PROJECT_ID,
        monitorTemplateId: TEMPLATE_ID,
      });

    expect(policy.name).toBe(RECOMMENDED_POLICY_NAME);
    expect(policy.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(policy.monitorTemplateId?.toString()).toBe(TEMPLATE_ID.toString());
    expect(policy.isEnabled).toBe(true);
    expect(policy.description).toBeTruthy();
    expect(NetworkAlertPolicyScopeUtil.isUnscoped(policy.scope)).toBe(true);
    expect(NetworkAlertPolicyScopeUtil.describe(policy.scope)).toBe(
      "All devices",
    );
  });

  /*
   * The policy's description is what an operator reads on the settings page
   * against a policy that covers everything, and four of the pack's five
   * items read an SNMP walk. A device with no credentials is pinged rather
   * than walked, so on it those four are never evaluated — describing the
   * pack without that caveat promises interface and walk alerting that a
   * ping-only estate will never see.
   */
  test("its description says a ping-only device only gets the reachability item", () => {
    const policy: NetworkAlertPolicy =
      NetworkAlertPolicyBootstrapUtil.buildRecommendedPolicy({
        projectId: PROJECT_ID,
        monitorTemplateId: TEMPLATE_ID,
      });

    expect(policy.description).toContain("pinged rather than walked");
    expect(policy.description).toContain("only the reachability item can fire");
  });
});

describe("NetworkAlertPolicyBootstrapUtil.isRecommendedTemplate / findRecommendedTemplate", () => {
  test("recognises the template it built, and only by its marker", () => {
    expect(
      NetworkAlertPolicyBootstrapUtil.isRecommendedTemplate(buildTemplate()),
    ).toBe(true);

    const renamed: MonitorTemplate = buildTemplate();
    renamed.templateName = "Our alert pack";
    expect(NetworkAlertPolicyBootstrapUtil.isRecommendedTemplate(renamed)).toBe(
      true,
    );

    const sameNameNoMarker: MonitorTemplate = new MonitorTemplate();
    sameNameNoMarker.templateName = RECOMMENDED_TEMPLATE_NAME;
    sameNameNoMarker.templateDescription = "Hand made.";
    expect(
      NetworkAlertPolicyBootstrapUtil.isRecommendedTemplate(sameNameNoMarker),
    ).toBe(false);

    expect(NetworkAlertPolicyBootstrapUtil.isRecommendedTemplate(null)).toBe(
      false,
    );
    expect(
      NetworkAlertPolicyBootstrapUtil.isRecommendedTemplate(
        new MonitorTemplate(),
      ),
    ).toBe(false);
  });

  test("finds the first marked template in a list, and null when there is none", () => {
    const plain: MonitorTemplate = new MonitorTemplate();
    plain.templateDescription = "Reachability only.";

    const marked: MonitorTemplate = buildTemplate();
    const alsoMarked: MonitorTemplate = buildTemplate();

    expect(
      NetworkAlertPolicyBootstrapUtil.findRecommendedTemplate([
        plain,
        marked,
        alsoMarked,
      ]),
    ).toBe(marked);

    expect(
      NetworkAlertPolicyBootstrapUtil.findRecommendedTemplate([plain]),
    ).toBeNull();

    expect(
      NetworkAlertPolicyBootstrapUtil.findRecommendedTemplate([]),
    ).toBeNull();
  });

  /*
   * An operator may rewrite the prose; the marker sits on its own line at
   * the end so it survives an edit to the sentence above it.
   */
  test("the marker sits on its own last line of the description", () => {
    const description: string =
      NetworkAlertPolicyBootstrapUtil.buildRecommendedTemplateDescription();

    const lines: Array<string> = description.trim().split("\n");

    expect(lines[lines.length - 1]).toBe(RECOMMENDED_TEMPLATE_MARKER);
  });
});
