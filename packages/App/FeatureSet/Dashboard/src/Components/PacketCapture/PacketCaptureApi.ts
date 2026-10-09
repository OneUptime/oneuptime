import { decodeDownload } from "./PacketCaptureViewModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import MimeType from "Common/Types/File/MimeType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The two packet capture calls that are not the table's own CRUD
 * (Common/Server/API/PacketCaptureAPI): stop a running capture, and fetch a
 * finished one's file. Both carry the project's headers; a refusal is
 * thrown, so the table shows it with API.getFriendlyMessage.
 */

export const PACKET_CAPTURE_ROUTES: {
  stop: (packetCaptureId: string) => string;
  download: (packetCaptureId: string) => string;
} = {
  stop: (packetCaptureId: string): string => {
    return `/packet-capture/${encodeURIComponent(packetCaptureId)}/stop`;
  },
  download: (packetCaptureId: string): string => {
    return `/packet-capture/${encodeURIComponent(packetCaptureId)}/download`;
  },
};

export interface PacketCaptureFile {
  fileName: string;
  fileType: string;
  bytes: Uint8Array;
}

async function post(route: string): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

export async function stopPacketCapture(
  packetCaptureId: ObjectID,
): Promise<void> {
  await post(PACKET_CAPTURE_ROUTES.stop(packetCaptureId.toString()));
}

export async function downloadPacketCapture(
  packetCaptureId: ObjectID,
): Promise<PacketCaptureFile> {
  const body: JSONObject = await post(
    PACKET_CAPTURE_ROUTES.download(packetCaptureId.toString()),
  );

  const base64: unknown = body["base64"];

  if (typeof base64 !== "string" || !base64) {
    throw new Error("The capture file could not be downloaded.");
  }

  return {
    fileName:
      typeof body["fileName"] === "string" && body["fileName"]
        ? body["fileName"]
        : "packet-capture.pcap",
    fileType:
      typeof body["fileType"] === "string" && body["fileType"]
        ? body["fileType"]
        : MimeType.pcap,
    bytes: decodeDownload(base64),
  };
}
