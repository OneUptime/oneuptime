import { ProbeConnectionStatus } from "../../Models/DatabaseModels/Probe";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import { MonitorStepProbeStatusMonitorUtil } from "../../Types/Monitor/MonitorStepProbeStatusMonitor";
import ProbeStatusMonitorResponse, {
  ProbeStatusMonitorProbe,
} from "../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";

// The fields of a probe a Probe Status monitor is judged from.
export interface ProbeStatusSource {
  id: string;
  name?: string | undefined;
  isGlobalProbe?: boolean | undefined;
  connectionStatus?: ProbeConnectionStatus | string | undefined;
  lastAlive?: Date | undefined;
}

/*
 * The pure half of the Probe Status monitor: from the probes a step names
 * and the probes the project may see, what its criteria judge. The server
 * evaluates with it every minute (ProbeStatusMonitorEvaluator) and the
 * monitor's page draws the same answer from the probes it reads, so the two
 * cannot disagree about which probes count or how.
 */
export default class ProbeStatusMonitorUtil {
  /*
   * Connected exactly when Probe:UpdateConnectionStatus last stamped the
   * probe Connected. Anything else - Disconnected, or a probe no tick has
   * stamped yet - is not connected, which is how the dashboard's status
   * badge shows it.
   */
  public static isConnected(
    connectionStatus: ProbeConnectionStatus | string | undefined | null,
  ): boolean {
    return connectionStatus === ProbeConnectionStatus.Connected;
  }

  /*
   * The step's probes in the step's order, each once. A probe the step
   * names but `probes` does not hold (deleted, or not one this project may
   * watch) is listed under missingProbeIds and counted neither way.
   */
  public static buildResponse(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    monitorStepId: ObjectID;
    probeIds: Array<string>;
    probes: Array<ProbeStatusSource>;
    checkedAt: Date;
  }): ProbeStatusMonitorResponse {
    const probesById: Map<string, ProbeStatusSource> = new Map<
      string,
      ProbeStatusSource
    >();

    for (const probe of data.probes) {
      if (probe.id) {
        probesById.set(probe.id.toString().toLowerCase(), probe);
      }
    }

    const watched: Array<ProbeStatusMonitorProbe> = [];
    const missingProbeIds: Array<string> = [];

    for (const probeId of MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(
      data.probeIds,
    )) {
      const probe: ProbeStatusSource | undefined = probesById.get(
        probeId.toLowerCase(),
      );

      if (!probe) {
        missingProbeIds.push(probeId);
        continue;
      }

      const watchedProbe: ProbeStatusMonitorProbe = {
        probeId: probe.id.toString(),
        probeName: probe.name?.trim() || "Probe",
        isGlobalProbe: Boolean(probe.isGlobalProbe),
        isConnected: ProbeStatusMonitorUtil.isConnected(probe.connectionStatus),
      };

      if (probe.lastAlive) {
        watchedProbe.lastAliveAt = probe.lastAlive;
      }

      watched.push(watchedProbe);
    }

    const connectedProbeCount: number = watched.filter(
      (probe: ProbeStatusMonitorProbe): boolean => {
        return probe.isConnected;
      },
    ).length;

    return {
      projectId: data.projectId,
      monitorId: data.monitorId,
      monitorStepId: data.monitorStepId,
      probes: watched,
      connectedProbeCount: connectedProbeCount,
      disconnectedProbeCount: watched.length - connectedProbeCount,
      missingProbeIds: missingProbeIds,
      checkedAt: data.checkedAt,
    };
  }

  /*
   * Every probe the monitor's steps watch, each once, in step order. The
   * dashboard reads the count from it; the server evaluates step by step.
   */
  public static getWatchedProbeIds(
    monitorSteps: MonitorSteps | undefined | null,
  ): Array<string> {
    const probeIds: Array<string> = [];

    for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      probeIds.push(
        ...MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(
          monitorStep?.data?.probeStatusMonitor?.probeIds,
        ),
      );
    }

    return MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(probeIds);
  }

  /*
   * A Probe Status evaluation read back from JSON - the evaluation log's
   * body, a snapshot stored on an incident - or null when it is not one.
   * Every field is read defensively: the JSON may come from an older build.
   */
  public static parseResponse(
    value: unknown,
  ): ProbeStatusMonitorResponse | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;

    if (!Array.isArray(json["probes"])) {
      return null;
    }

    const probes: Array<ProbeStatusMonitorProbe> = [];

    for (const item of json["probes"] as Array<JSONValue>) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const probeJson: JSONObject = item as JSONObject;
      const probeId: string = ProbeStatusMonitorUtil.readId(
        probeJson["probeId"],
      );

      if (!probeId) {
        continue;
      }

      const probe: ProbeStatusMonitorProbe = {
        probeId: probeId,
        probeName:
          typeof probeJson["probeName"] === "string" &&
          (probeJson["probeName"] as string).trim()
            ? (probeJson["probeName"] as string)
            : "Probe",
        isGlobalProbe: probeJson["isGlobalProbe"] === true,
        isConnected: probeJson["isConnected"] === true,
      };

      const lastAliveAt: Date | undefined = ProbeStatusMonitorUtil.readDate(
        probeJson["lastAliveAt"],
      );

      if (lastAliveAt) {
        probe.lastAliveAt = lastAliveAt;
      }

      probes.push(probe);
    }

    const connectedProbeCount: number = probes.filter(
      (probe: ProbeStatusMonitorProbe): boolean => {
        return probe.isConnected;
      },
    ).length;

    return {
      projectId: new ObjectID(ProbeStatusMonitorUtil.readId(json["projectId"])),
      monitorId: new ObjectID(ProbeStatusMonitorUtil.readId(json["monitorId"])),
      monitorStepId: new ObjectID(
        ProbeStatusMonitorUtil.readId(json["monitorStepId"]),
      ),
      probes: probes,
      connectedProbeCount: connectedProbeCount,
      disconnectedProbeCount: probes.length - connectedProbeCount,
      missingProbeIds: Array.isArray(json["missingProbeIds"])
        ? (json["missingProbeIds"] as Array<JSONValue>)
            .map((id: JSONValue): string => {
              return ProbeStatusMonitorUtil.readId(id);
            })
            .filter((id: string): boolean => {
              return Boolean(id);
            })
        : [],
      checkedAt:
        ProbeStatusMonitorUtil.readDate(json["checkedAt"]) || new Date(0),
    };
  }

  // An id as JSON carries one: a string, or { _type: "ObjectID", value }.
  private static readId(value: JSONValue | undefined): string {
    if (typeof value === "string") {
      return value;
    }

    if (value instanceof ObjectID) {
      return value.toString();
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const inner: JSONValue | undefined = (value as JSONObject)["value"];

      if (typeof inner === "string") {
        return inner;
      }
    }

    return "";
  }

  // A date as JSON carries one: ISO text, or { _type: "DateTime", value }.
  private static readDate(value: JSONValue | undefined): Date | undefined {
    let raw: JSONValue | undefined = value;

    if (raw instanceof Date) {
      return isNaN(raw.getTime()) ? undefined : raw;
    }

    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      raw = (raw as JSONObject)["value"];
    }

    if (typeof raw !== "string" || !raw) {
      return undefined;
    }

    const date: Date = new Date(raw);

    return isNaN(date.getTime()) ? undefined : date;
  }

  public static getConnectedProbes(
    response: Pick<ProbeStatusMonitorResponse, "probes">,
  ): Array<ProbeStatusMonitorProbe> {
    return (response.probes || []).filter(
      (probe: ProbeStatusMonitorProbe): boolean => {
        return probe.isConnected;
      },
    );
  }

  public static getDisconnectedProbes(
    response: Pick<ProbeStatusMonitorResponse, "probes">,
  ): Array<ProbeStatusMonitorProbe> {
    return (response.probes || []).filter(
      (probe: ProbeStatusMonitorProbe): boolean => {
        return !probe.isConnected;
      },
    );
  }

  // "EU Probe, US Probe", or "" for none. Plain text: escape where shown.
  public static joinProbeNames(probes: Array<ProbeStatusMonitorProbe>): string {
    return probes
      .map((probe: ProbeStatusMonitorProbe): string => {
        return probe.probeName;
      })
      .join(", ");
  }

  // "1 probe", "3 probes".
  public static getProbeCountLabel(count: number): string {
    return count === 1 ? "1 probe" : `${count} probes`;
  }

  /*
   * One sentence for a person: which probes are disconnected, or that every
   * one is connected. Used where an evaluation is explained.
   */
  public static describe(
    response: Pick<
      ProbeStatusMonitorResponse,
      "probes" | "connectedProbeCount" | "disconnectedProbeCount"
    >,
  ): string {
    const total: number =
      response.connectedProbeCount + response.disconnectedProbeCount;

    if (total === 0) {
      return "This monitor watches no probe that still exists.";
    }

    if (response.disconnectedProbeCount === 0) {
      return total === 1
        ? `${ProbeStatusMonitorUtil.joinProbeNames(response.probes)} is connected.`
        : `All ${total} probes are connected.`;
    }

    const disconnected: Array<ProbeStatusMonitorProbe> =
      ProbeStatusMonitorUtil.getDisconnectedProbes(response);
    const names: string = ProbeStatusMonitorUtil.joinProbeNames(disconnected);

    if (total === 1) {
      return `${names} is disconnected.`;
    }

    return `${response.disconnectedProbeCount} of ${total} probes ${
      response.disconnectedProbeCount === 1 ? "is" : "are"
    } disconnected: ${names}.`;
  }
}
