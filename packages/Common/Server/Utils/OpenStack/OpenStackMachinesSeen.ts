import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../Types/JSON";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import ObjectID from "../../../Types/ObjectID";
import { OPENSTACK_EXPORTER_HOST_LABEL } from "../../../Types/OpenStack/OpenStackControlPlane";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";

/*
 * ONLY A MACHINE SOMETHING WAS SEEN ON CAN LOSE IT.
 *
 * A host of only OVN's databases reads exactly as one whose Open vSwitch stopped, so a monitor
 * cannot tell the two from the window it reads. The cloud's inventory can: its scan keeps, on
 * each machine's row, when each of these was last there (OPENSTACK_NETWORK_FACTS), which is what
 * the pages read too. So a template that looks for something going away is held to the machines
 * that have had it (MonitorStepOpenStackMonitor.onlyWhereSeen), and one that never had it is not
 * judged at all. A machine someone took it off for good goes on reading as having lost it, as
 * its page says, until its exporter is taken out of the agent's targets.
 *
 * A read that fails throws, as the metric reads beside it do, and the evaluation waits for the
 * next one: judging every machine would page for the ones that never had it, and judging none
 * would resolve what is open.
 */

// A cloud has a few machines of each thing it stands on, so a page of them is all of them.
const CONTROL_PLANE_ROWS_READ: number = 1000;

function machineKey(region: unknown, host: unknown): string {
  return `${typeof region === "string" ? region : ""}/${typeof host === "string" ? host : ""}`;
}

export function keepSeriesOfMachines(data: {
  series: Array<MetricSeriesResult>;
  machines: ReadonlySet<string>;
}): Array<MetricSeriesResult> {
  return data.series.filter((series: MetricSeriesResult): boolean => {
    const labels: JSONObject = series.labels as JSONObject;

    return data.machines.has(
      machineKey(
        labels[OPENSTACK_REGION_ATTRIBUTE],
        labels[OPENSTACK_EXPORTER_HOST_LABEL],
      ),
    );
  });
}

export function getMachinesSeenWith(data: {
  rows: Array<OpenStackResource>;
  fact: string;
}): Set<string> {
  const machines: Set<string> = new Set<string>();

  for (const row of data.rows) {
    const facts: JSONObject = (row.facts as JSONObject | undefined) || {};

    if (typeof facts[data.fact] === "string") {
      machines.add(machineKey(row.regionName, row.name));
    }
  }

  return machines;
}

export default class OpenStackMachinesSeen {
  public static async keepMachinesSeenWith(data: {
    projectId: ObjectID;
    cloudIdentifier: string;
    fact: string;
    series: Array<MetricSeriesResult>;
  }): Promise<Array<MetricSeriesResult>> {
    const cloud: OpenStackCloud | null = await OpenStackCloudService.findOneBy({
      query: { projectId: data.projectId, name: data.cloudIdentifier },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!cloud?.id) {
      return [];
    }

    const rows: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: cloud.id,
          kind: OpenStackResourceKind.ControlPlane,
        },
        select: { name: true, regionName: true, facts: true },
        limit: CONTROL_PLANE_ROWS_READ,
        skip: 0,
        props: { isRoot: true },
      });

    return keepSeriesOfMachines({
      series: data.series,
      machines: getMachinesSeenWith({ rows, fact: data.fact }),
    });
  }
}
