import { PROBE_INGEST_URL, PROBE_PACKET_CAPTURE_SETTINGS } from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import { listCaptureInterfaces } from "../../Utils/PacketCapture/NetworkInterfaces";
import { PacketCaptureSettings } from "../../Utils/PacketCapture/PacketCaptureSettings";
import {
  CaptureToolInfo,
  detectCaptureTool,
} from "../../Utils/PacketCapture/PacketCaptureRunner";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  PacketCaptureCapability,
  PacketCaptureInterface,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import API from "Common/Utils/API";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";

/*
 * Tells OneUptime what this probe can capture on: whether its operator
 * turned packet capture on, whether tcpdump is installed, its network
 * interfaces and its limits. Sent when the probe starts and every five
 * minutes (interfaces come and go), so the dashboard's Start Packet Capture
 * form offers what this probe can do right now - and says "turned off" for
 * a probe that is, instead of "not reported".
 *
 * A probe with captures off reports exactly that and nothing about its
 * interfaces: its operator did not ask for them to be shown.
 */

// What the probe needs to say what it can capture on; replaced in tests.
export interface CapabilityDependencies {
  settings: PacketCaptureSettings;
  detectTool: () => Promise<CaptureToolInfo>;
  listInterfaces: () => Array<PacketCaptureInterface>;
}

const DEFAULT_DEPENDENCIES: CapabilityDependencies = {
  settings: PROBE_PACKET_CAPTURE_SETTINGS,
  detectTool: (): Promise<CaptureToolInfo> => {
    return detectCaptureTool();
  },
  listInterfaces: (): Array<PacketCaptureInterface> => {
    return listCaptureInterfaces();
  },
};

export async function buildPacketCaptureCapability(
  dependencies: CapabilityDependencies = DEFAULT_DEPENDENCIES,
): Promise<PacketCaptureCapability> {
  const settings: PacketCaptureSettings = dependencies.settings;

  if (!settings.isEnabled) {
    return {
      isEnabled: false,
      isToolAvailable: false,
      interfaces: [],
      limits: settings.limits,
    };
  }

  const tool: CaptureToolInfo = await dependencies.detectTool();

  const capability: PacketCaptureCapability = {
    isEnabled: true,
    isToolAvailable: tool.isAvailable,
    interfaces: dependencies.listInterfaces(),
    limits: settings.limits,
  };

  if (tool.version) {
    capability.toolVersion = tool.version;
  }

  return capability;
}

/*
 * The last thing the server said that the operator should hear - a global
 * probe's captures stay off - so it is logged once, not every five minutes.
 */
let lastServerMessage: string | null = null;

// Exported for tests.
export function resetReportedServerMessage(): void {
  lastServerMessage = null;
}

export async function reportPacketCaptureCapability(
  dependencies: CapabilityDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const url: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/packet-capture/capability",
  );

  try {
    const capability: PacketCaptureCapability =
      await buildPacketCaptureCapability(dependencies);

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: url,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          packetCaptureCapability: capability as unknown as JSONObject,
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(url),
      });

    if (result instanceof HTTPErrorResponse) {
      logger.warn(
        `Packet capture report was not accepted: HTTP ${result.statusCode}${result.message ? ` - ${result.message}` : ""}. A server older than packet capture answers 404 here; upgrade it to start captures from the dashboard.`,
      );
      return;
    }

    const message: unknown = (result.data as JSONObject)?.["message"];

    if (
      capability.isEnabled &&
      typeof message === "string" &&
      message !== lastServerMessage
    ) {
      lastServerMessage = message;
      logger.warn(`Packet capture: ${message}`);
    }
  } catch (err) {
    logger.error("Failed to report this probe's packet capture capability");
    logger.error(err);
  }
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:ReportPacketCaptureCapability",
    options: {
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: true,
    },
    runFunction: async (): Promise<void> => {
      await reportPacketCaptureCapability();
    },
  });
};

export default InitJob;
