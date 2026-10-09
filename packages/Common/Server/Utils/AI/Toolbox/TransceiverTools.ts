import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { NetworkDeviceTransceiver } from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import TransceiverHealthUtil from "../../../../Utils/NetworkDevice/TransceiverHealthUtil";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import NetworkTransceiverContext from "../SRE/NetworkTransceiverContext";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC,
 * and resolved lazily for the same circular-import reason as MonitorTools.
 */
let cachedReadPermissions: Array<Permission> | null = null;

const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new NetworkDevice().getReadPermissions();
    }
    return cachedReadPermissions;
  };

export const QueryNetworkTransceiversTool: ObservabilityTool = {
  name: "query_network_transceivers",
  description:
    "Transceiver (SFP, SFP+, QSFP optics) health of one network device, port by port: whether the optic is still detected (and since when it is missing), who made it (vendor, part number, serial), its temperature, supply voltage, laser bias current and transmit and receive power against the device's own warning and alarm thresholds, any fault the device flags, and the received power trend - daily averages for up to the last 30 days, the best day and how far the latest reading is below it. Use it when a network device's interface is down, flapping or logging errors, to tell a pulled or failed optic, a dark or dirty fibre (received power falling for weeks) or an overheating optic apart. Resolve the device's ID with query_telemetry_resources (resourceType NetworkDevice). Problems are listed first.",
  inputSchema: {
    type: "object",
    properties: {
      networkDeviceId: {
        type: "string",
        description:
          "OneUptime NetworkDevice UUID, resolved with query_telemetry_resources.",
      },
      interfaceName: {
        type: "string",
        description:
          "Only the optic in this port, matched by interface name or alias (case-insensitive).",
      },
      problemsOnly: {
        type: "boolean",
        description:
          "true = only optics that are not detected, past a warning or alarm threshold.",
      },
    },
    required: ["networkDeviceId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const networkDeviceIdText: string | undefined = ToolArgs.getString(
      args,
      "networkDeviceId",
    );

    if (!networkDeviceIdText || !ObjectID.isValidUUID(networkDeviceIdText)) {
      throw new BadDataException(
        "networkDeviceId must be a valid OneUptime UUID. Resolve device names with query_telemetry_resources.",
      );
    }

    const networkDeviceId: ObjectID = new ObjectID(networkDeviceIdText);

    // projectId pinned to the tenant: the id is an untrusted model argument.
    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: {
        _id: networkDeviceId.toString(),
        projectId: ctx.projectId,
      },
      select: {
        _id: true,
        name: true,
        transceiverSnapshot: true,
      },
      props: ctx.props,
    });

    if (!device) {
      throw new BadDataException(
        "Network device not found or you do not have access to it.",
      );
    }

    const interfaceName: string | undefined = ToolArgs.getString(
      args,
      "interfaceName",
    )?.toLowerCase();
    const problemsOnly: boolean = ToolArgs.getBoolean(args, "problemsOnly") === true;

    const transceivers: Array<NetworkDeviceTransceiver> =
      TransceiverHealthUtil.sortForDisplay(
        (Array.isArray(device.transceiverSnapshot)
          ? device.transceiverSnapshot
          : []
        ).filter((transceiver: NetworkDeviceTransceiver) => {
          if (
            interfaceName &&
            transceiver.interfaceName?.toLowerCase() !== interfaceName &&
            transceiver.interfaceAlias?.toLowerCase() !== interfaceName
          ) {
            return false;
          }

          return (
            !problemsOnly || NetworkTransceiverContext.hasProblem(transceiver)
          );
        }),
      );

    const rows: Array<JSONObject> = transceivers.map(
      (transceiver: NetworkDeviceTransceiver) => {
        return NetworkTransceiverContext.toRow(transceiver);
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const note: string =
      rows.length === 0
        ? Array.isArray(device.transceiverSnapshot) &&
          device.transceiverSnapshot.length > 0
          ? "No transceiver matches the filters."
          : "This device reports no transceivers: it has no optics, or it does not report transceiver health over SNMP (OneUptime reads ENTITY-SENSOR-MIB and the Cisco, Arista, Juniper, MikroTik, HPE Comware, HPE Aruba ProCurve and Cambium cnMatrix transceiver tables), or it has not been walked yet."
        : "Readings are from the device's last poll, in degrees C, volts, milliamps and dBm. Health is judged against the thresholds the device reports; an optic the device reports no thresholds for is not judged.";

    return {
      dataForLlm: `${serialized.text || "No matching data."}\n${note}`,
      rowCount: serialized.rowCount,
      citationLabel: `${device.name || "Network device"} transceivers`,
      citationTarget: {
        type: AIChatCitationTargetType.TelemetryResourceView,
        params: {
          resourceType: AIResourceType.NetworkDevice,
          resourceId: networkDeviceId.toString(),
        },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};
