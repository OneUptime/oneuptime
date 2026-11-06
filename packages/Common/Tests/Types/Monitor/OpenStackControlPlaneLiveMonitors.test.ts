import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import { getOpenStackTemplateParents } from "../../../Types/Monitor/OpenStackControlPlaneAlertTemplates";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE MONITORS Tests/Ops/openstack-e2e/live-oneuptime.py MAKES ON A RUNNING ONEUPTIME.
 *
 * A person gets these from a cloud's Recommendations page, which builds each in the browser from
 * its template. That script is plain Python on a bare runner and cannot run a template, so it reads
 * what the templates build from this file, and this test holds the file to the templates: a
 * template that changes fails here until the file is written again, with
 *
 *   WRITE_LIVE_MONITORS=1 jest OpenStackControlPlaneLiveMonitors
 *
 * What a real monitor gets from its cloud and project is a placeholder here, and each `id` a
 * template makes up afresh is `__ID_n__`, which the script makes up afresh too.
 */

const FIXTURE: string = path.resolve(
  __dirname,
  "../../Fixtures/OpenStack/control-plane/live-monitors.json",
);

const LIVE_MONITOR_TEMPLATE_IDS: ReadonlyArray<string> = [
  // What each drill stops.
  "openstack-rabbitmq-down",
  "openstack-mariadb-cluster-down",
  "openstack-ovn-controller-not-running",
  // What goes with it, and has to stay quiet.
  "openstack-rabbitmq-node-down",
  "openstack-galera-node-not-ready",
  "openstack-ovs-service-down",
  "openstack-compute-service-down",
  "openstack-network-agent-down",
  "openstack-scheduler-or-conductor-down",
  "openstack-every-scheduler-or-conductor-down",
  "openstack-identity-api-down",
  "openstack-compute-api-down",
  "openstack-network-api-down",
  "openstack-cloud-stopped-reporting",
];

const PLACEHOLDER_IDS: Record<string, string> = {
  online: "11111111-1111-4111-8111-111111111111",
  offline: "22222222-2222-4222-8222-222222222222",
  incidentSeverity: "33333333-3333-4333-8333-333333333333",
  alertSeverity: "44444444-4444-4444-8444-444444444444",
};

const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/*
 * Each id a template made up, in the order they appear, so the file does not change when nothing
 * has. An id it was given stays as it was, for the script to put the project's in its place.
 */
function withStableIds(value: JSONValue, seen: Map<string, string>): JSONValue {
  if (Array.isArray(value)) {
    return value.map((item: JSONValue): JSONValue => {
      return withStableIds(item, seen);
    });
  }

  if (typeof value === "string") {
    if (!UUID.test(value) || Object.values(PLACEHOLDER_IDS).includes(value)) {
      return value;
    }
    if (!seen.has(value)) {
      seen.set(value, `__ID_${seen.size}__`);
    }
    return seen.get(value)!;
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const copy: JSONObject = {};
    for (const [key, child] of Object.entries(value as JSONObject)) {
      copy[key] = withStableIds(child as JSONValue, seen);
    }
    return copy;
  }

  return value;
}

function built(): JSONObject {
  const monitors: JSONObject = {};

  for (const id of LIVE_MONITOR_TEMPLATE_IDS) {
    const template: OpenStackAlertTemplate =
      getAllOpenStackAlertTemplates().find(
        (candidate: OpenStackAlertTemplate): boolean => {
          return candidate.id === id;
        },
      )!;
    const step: MonitorStep = template.getMonitorStep({
      cloudIdentifier: "__CLOUD__",
      onlineMonitorStatusId: new ObjectID(PLACEHOLDER_IDS["online"]!),
      offlineMonitorStatusId: new ObjectID(PLACEHOLDER_IDS["offline"]!),
      defaultIncidentSeverityId: new ObjectID(
        PLACEHOLDER_IDS["incidentSeverity"]!,
      ),
      defaultAlertSeverityId: new ObjectID(PLACEHOLDER_IDS["alertSeverity"]!),
      monitorName: "__MONITOR__",
    });
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: new ObjectID(PLACEHOLDER_IDS["online"]!),
    };

    monitors[id] = {
      name: template.name,
      parents: getOpenStackTemplateParents(id).filter(
        (parent: string): boolean => {
          return LIVE_MONITOR_TEMPLATE_IDS.includes(parent);
        },
      ),
      monitorSteps: withStableIds(
        JSON.parse(JSON.stringify(steps.toJSON())) as JSONValue,
        new Map<string, string>(),
      ),
    };
  }

  return { placeholders: PLACEHOLDER_IDS, monitors };
}

describe("the monitors the live replay makes", () => {
  test("are what the templates build today", () => {
    const expected: string = `${JSON.stringify(built(), null, 1)}\n`;

    if (process.env["WRITE_LIVE_MONITORS"]) {
      fs.writeFileSync(FIXTURE, expected);
    }

    expect(fs.readFileSync(FIXTURE, "utf8")).toBe(expected);
  });

  test("come back through the API's own reading of them", () => {
    const monitors: JSONObject = (
      JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as JSONObject
    )["monitors"] as JSONObject;

    for (const id of LIVE_MONITOR_TEMPLATE_IDS) {
      const steps: MonitorSteps = MonitorSteps.fromJSON(
        (monitors[id] as JSONObject)["monitorSteps"] as JSONObject,
      );

      expect(steps.data!.monitorStepsInstanceArray).toHaveLength(1);
      expect(
        steps.data!.monitorStepsInstanceArray[0]!.data!.openstackMonitor
          ?.cloudIdentifier,
      ).toBe("__CLOUD__");
    }
  });
});
