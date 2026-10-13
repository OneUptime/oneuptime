import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PacketCapture from "../../Models/DatabaseModels/PacketCapture";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";

/*
 * The request the dashboard's Start Capture button sends: the capture
 * StartPacketCaptureModal builds, as ModelAPI.create puts it on the wire
 * (`{ data: <the model's JSON>, miscDataProps: {} }`).
 *
 * One definition for both ends of it. The dashboard's component suite
 * (Tests/App/Dashboard/StartPacketCaptureModal) holds the body the modal
 * really sends to this one, and the server suite
 * (Tests/Server/API/PacketCaptureCrudAsMember) sends this one to the real
 * create route as each member the docs name. So a start the form makes is a
 * start the server takes: a column the form starts sending that a member
 * may not write fails one suite or the other.
 */

// Every column the form writes; networkDeviceId only from a device's page.
export const DASHBOARD_START_COLUMNS: ReadonlyArray<string> = [
  "probeId",
  "networkDeviceId",
  "interfaceName",
  "bpfFilter",
  "maxDurationInSeconds",
  "maxPackets",
  "maxFileSizeInMB",
];

export interface DashboardStartValues {
  probeId: ObjectID;
  networkDeviceId?: ObjectID | undefined;
  interfaceName: string;
  bpfFilter: string;
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInMB: number;
}

// The capture the modal builds from what the form holds.
export function dashboardStartCapture(
  values: DashboardStartValues,
): PacketCapture {
  const capture: PacketCapture = new PacketCapture();
  capture.probeId = values.probeId;
  capture.interfaceName = values.interfaceName;
  capture.bpfFilter = values.bpfFilter;
  capture.maxDurationInSeconds = values.maxDurationInSeconds;
  capture.maxPackets = values.maxPackets;
  capture.maxFileSizeInMB = values.maxFileSizeInMB;

  if (values.networkDeviceId) {
    capture.networkDeviceId = values.networkDeviceId;
  }

  return capture;
}

// ModelAPI.create's request body for that capture.
export function dashboardStartBody(values: DashboardStartValues): JSONObject {
  return {
    data: JSONFunctions.serialize(
      BaseModel.toJSON(dashboardStartCapture(values), PacketCapture),
    ),
    miscDataProps: {},
  };
}
