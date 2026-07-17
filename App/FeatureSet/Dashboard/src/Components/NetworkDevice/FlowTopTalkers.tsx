import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * Top talkers for one network device, aggregated from NetFlow v5 records
 * the device exported to a probe: top source IPs, top destination IPs and
 * top protocol/port pairs by bytes over the last hour, plus window totals.
 * Standalone — fetches its own data from the top-talkers endpoint for the
 * given device.
 */

export interface ComponentProps {
  networkDeviceId: ObjectID;
}

interface TopEntry {
  key: string;
  octets: number;
  packets: number;
}

interface TopProtocolPortEntry {
  protocolNumber: number;
  destinationPort: number;
  octets: number;
  packets: number;
}

interface TopTalkersData {
  totalOctets: number;
  totalPackets: number;
  totalFlows: number;
  topSources: Array<TopEntry>;
  topDestinations: Array<TopEntry>;
  topProtocolPorts: Array<TopProtocolPortEntry>;
}

// Common IP protocol numbers → names; anything else shows the number.
const PROTOCOL_NAMES: { [protocolNumber: number]: string } = {
  1: "ICMP",
  2: "IGMP",
  6: "TCP",
  17: "UDP",
  47: "GRE",
  50: "ESP",
  58: "ICMPv6",
  89: "OSPF",
  132: "SCTP",
};

const protocolLabel: (protocolNumber: number) => string = (
  protocolNumber: number,
): string => {
  return PROTOCOL_NAMES[protocolNumber] || `Protocol ${protocolNumber}`;
};

// 1234567 -> "1.23 MB" — flows are byte counters, keep units human.
const formatBytes: (octets: number) => string = (octets: number): string => {
  if (octets < 1024) {
    return `${octets} B`;
  }
  const units: Array<string> = ["KB", "MB", "GB", "TB", "PB"];
  let value: number = octets;
  let unitIndex: number = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

const formatCount: (value: number) => string = (value: number): string => {
  return value.toLocaleString();
};

const parseTopEntries: (value: unknown) => Array<TopEntry> = (
  value: unknown,
): Array<TopEntry> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as JSONArray).map((row: unknown): TopEntry => {
    const entry: JSONObject = (row || {}) as JSONObject;
    return {
      key: String(entry["key"] ?? ""),
      octets: Number(entry["octets"]) || 0,
      packets: Number(entry["packets"]) || 0,
    };
  });
};

const parseResponse: (data: JSONObject | undefined) => TopTalkersData = (
  data: JSONObject | undefined,
): TopTalkersData => {
  const rawProtocolPorts: JSONArray = Array.isArray(data?.["topProtocolPorts"])
    ? (data!["topProtocolPorts"] as JSONArray)
    : [];

  return {
    totalOctets: Number(data?.["totalOctets"]) || 0,
    totalPackets: Number(data?.["totalPackets"]) || 0,
    totalFlows: Number(data?.["totalFlows"]) || 0,
    topSources: parseTopEntries(data?.["topSources"]),
    topDestinations: parseTopEntries(data?.["topDestinations"]),
    topProtocolPorts: rawProtocolPorts.map(
      (row: unknown): TopProtocolPortEntry => {
        const entry: JSONObject = (row || {}) as JSONObject;
        return {
          protocolNumber: Number(entry["protocolNumber"]) || 0,
          destinationPort: Number(entry["destinationPort"]) || 0,
          octets: Number(entry["octets"]) || 0,
          packets: Number(entry["packets"]) || 0,
        };
      },
    ),
  };
};

const TopEntryTable: FunctionComponent<{
  title: string;
  keyHeader: string;
  entries: Array<TopEntry>;
}> = (props: {
  title: string;
  keyHeader: string;
  entries: Array<TopEntry>;
}): ReactElement => {
  return (
    <div>
      <div className="text-sm font-medium text-gray-900 mb-2">
        {props.title}
      </div>
      <table className="min-w-full">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
              {props.keyHeader}
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
              Bytes
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
              Packets
            </th>
          </tr>
        </thead>
        <tbody>
          {props.entries.map((entry: TopEntry, index: number) => {
            return (
              <tr key={index}>
                <td className="px-3 py-2 text-sm text-gray-900 border-b border-gray-100 font-mono">
                  {entry.key}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                  {formatBytes(entry.octets)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                  {formatCount(entry.packets)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const FlowTopTalkers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [data, setData] = useState<TopTalkersData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchTopTalkers: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/network-device/flow/top-talkers",
        );

        /*
         * Project scoping is attached automatically via the tenantid header
         * that ModelAPI.getCommonHeaders() sets from the current project.
         * The endpoint defaults the window to the last hour.
         */
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url,
            data: {
              projectId: ProjectUtil.getCurrentProjectId()?.toString(),
              networkDeviceId: props.networkDeviceId.toString(),
            },
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setData(parseResponse(response.data));
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    }, [props.networkDeviceId]);

  useEffect(() => {
    fetchTopTalkers().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchTopTalkers]);

  return (
    <Card
      title="Top Talkers"
      description="Who this device saw talking over the last hour, aggregated from the NetFlow records it exported: top sources, destinations and protocol/port pairs by bytes."
    >
      {isLoading ? <ComponentLoader /> : <></>}

      {!isLoading && error ? <ErrorMessage message={error} /> : <></>}

      {!isLoading && !error && data && data.totalFlows === 0 ? (
        <div className="flex items-center justify-center py-16 px-6">
          <div className="text-center max-w-md">
            <div className="text-sm font-medium text-gray-900">
              No flow data yet.
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Flow export is not configured for this device, or nothing has
              arrived in the last hour. Point the device&apos;s NetFlow v5
              export at your probe&apos;s IP on UDP port 2055 (and set
              PROBE_NETFLOW_RECEIVER_ENABLED=true on the probe).
            </p>
          </div>
        </div>
      ) : (
        <></>
      )}

      {!isLoading && !error && data && data.totalFlows > 0 ? (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Total Traffic
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatBytes(data.totalOctets)}
              </div>
            </div>
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Packets
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatCount(data.totalPackets)}
              </div>
            </div>
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Flows
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatCount(data.totalFlows)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TopEntryTable
              title="Top Sources"
              keyHeader="Source IP"
              entries={data.topSources}
            />
            <TopEntryTable
              title="Top Destinations"
              keyHeader="Destination IP"
              entries={data.topDestinations}
            />
          </div>

          <div className="mt-6">
            <div className="text-sm font-medium text-gray-900 mb-2">
              Top Protocols &amp; Ports
            </div>
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                    Protocol
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                    Destination Port
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                    Bytes
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                    Packets
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topProtocolPorts.map(
                  (entry: TopProtocolPortEntry, index: number) => {
                    return (
                      <tr key={index}>
                        <td className="px-3 py-2 text-sm text-gray-900 border-b border-gray-100">
                          {protocolLabel(entry.protocolNumber)}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-900 border-b border-gray-100 font-mono">
                          {entry.destinationPort}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                          {formatBytes(entry.octets)}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                          {formatCount(entry.packets)}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default FlowTopTalkers;
