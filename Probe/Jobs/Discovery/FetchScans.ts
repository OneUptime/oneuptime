import { PROBE_INGEST_URL } from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import SubnetScanner, {
  SubnetScanResult,
} from "../../Utils/Discovery/SubnetScanner";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import ProxyConfig from "../../Utils/ProxyConfig";

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:DiscoveryScanFetch",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        await fetchAndRunScans();
      } catch (err) {
        logger.error("Discovery scan fetch failed");
        logger.error(err);
      }
    },
  });
};

async function fetchAndRunScans(): Promise<void> {
  const listUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/discovery-scan/list",
  );

  const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
    await API.fetch<JSONArray>({
      method: HTTPMethod.POST,
      url: listUrl,
      data: {
        ...ProbeAPIRequest.getDefaultRequestBody(),
      },
      headers: {},
      options: { ...ProxyConfig.getRequestProxyAgents(listUrl) },
    });

  const scans: Array<NetworkDeviceDiscoveryScan> = BaseModel.fromJSONArray(
    result.data as JSONArray,
    NetworkDeviceDiscoveryScan,
  );

  for (const scan of scans) {
    await runScan(scan);
  }
}

async function runScan(scan: NetworkDeviceDiscoveryScan): Promise<void> {
  const resultUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/discovery-scan/result",
  );

  try {
    logger.debug(
      `Running discovery scan ${scan.id?.toString()} on ${scan.cidr}`,
    );

    const scanResult: SubnetScanResult = await SubnetScanner.scan({
      cidr: scan.cidr || "",
      snmpVersion: scan.snmpVersion,
      snmpCommunityString: scan.snmpCommunityString,
      snmpPort: scan.snmpPort,
    });

    await API.fetch<JSONArray>({
      method: HTTPMethod.POST,
      url: resultUrl,
      data: {
        ...ProbeAPIRequest.getDefaultRequestBody(),
        scanId: scan.id?.toString(),
        success: true,
        discoveredDevices: scanResult.discoveredHosts as unknown as JSONArray,
        scannedHostCount: scanResult.scannedHostCount,
      },
      headers: {},
      options: { ...ProxyConfig.getRequestProxyAgents(resultUrl) },
    });

    logger.debug(
      `Discovery scan ${scan.id?.toString()} found ${scanResult.discoveredHosts.length} SNMP hosts`,
    );
  } catch (err) {
    logger.error(`Discovery scan ${scan.id?.toString()} failed: ${err}`);

    // Report the failure so the scan doesn't sit In Progress forever.
    try {
      await API.fetch<JSONArray>({
        method: HTTPMethod.POST,
        url: resultUrl,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          scanId: scan.id?.toString(),
          success: false,
          statusMessage: (err as Error).message || String(err),
          discoveredDevices: [],
        },
        headers: {},
        options: { ...ProxyConfig.getRequestProxyAgents(resultUrl) },
      });
    } catch (reportErr) {
      logger.error(
        `Failed to report discovery scan failure for ${scan.id?.toString()}: ${reportErr}`,
      );
    }
  }
}

export default InitJob;
