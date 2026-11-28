/*
 * SNMP TRAPS FROM SENDERS THAT ARE NOT DEVICES YET: FROM THE TRAP INGEST TO
 * THE EVENTS PAGE'S CARD, WITH ADD AS DEVICE (OneUptime issue #11407).
 *
 * What the probe forwards for three traps Net-SNMP's snmptrap sent from
 * addresses no device has (Common/Tests/Helpers/Snmp/UnknownSenderSnmpTraps;
 * the probe's SnmpTrapReceiverUnknownSenders forwards the same datagrams):
 * a Brocade port state change - an enterprise trap, no event - and a
 * linkDown over v2c, and a Cisco configuration change over SNMPv3, signed
 * with a site's default credentials. Each goes through the real trap ingest
 * and the real trap log writer; only the database and the log table stand
 * in. The rows they write are the logs the Events page reads, and its card
 * lists each sender from them, as its model reads them, with the address,
 * the probe and - for the signed one - the site filled in for Add as device.
 *
 * Before #11407 the card read unmatched syslog only: none of the three was
 * listed, and the enterprise trap, which is no event, was offered to be
 * added nowhere at all.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { processSnmpTrapFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import { ProbeIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  NETWORK_QUICK_ACTION_ADDRESS_PARAM,
  NETWORK_QUICK_ACTION_PROBE_PARAM,
  NETWORK_QUICK_ACTION_QUERY_PARAM,
  NETWORK_QUICK_ACTION_SITE_PARAM,
  NetworkQuickAction,
  readAddDevicePrefill,
} from "../../FeatureSet/Dashboard/src/Components/Network/NetworkQuickActionQuery";
import {
  NetworkEventSource,
  NetworkEventSourceKind,
  buildNetworkEventTrapSourcesAttributes,
  toNetworkEventRows,
  toNetworkEventSources,
} from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsModel";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ProbeService from "Common/Server/Services/ProbeService";
import TelemetryMilestones from "Common/Server/Utils/Activation/TelemetryMilestones";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceWalkUtil from "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil";
import SnmpTrapUnmatchedHome from "Common/Server/Utils/Monitor/SnmpTrapUnmatchedHome";
import {
  UNKNOWN_SENDER_PROJECT_ID,
  UNKNOWN_SENDER_SITE_ID,
  UnknownSenderKey,
  forwardedUnknownSenderTrap,
} from "Common/Tests/Helpers/Snmp/UnknownSenderSnmpTraps";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

type DnsCache = { resolve: (hostname: string) => Promise<Array<string>> };

const PROBE_ID: ObjectID = new ObjectID("11407000-0000-4000-8000-0000000000f1");
const PROJECT_ID: ObjectID = new ObjectID(UNKNOWN_SENDER_PROJECT_ID);
const SERVICE_ID: ObjectID = new ObjectID(
  "11407000-0000-4000-8000-0000000005e1",
);

const RECEIVED_AT: Record<UnknownSenderKey, string> = {
  brocadePortChange: "2026-11-28T10:00:00.000Z",
  linkDown: "2026-11-28T10:01:00.000Z",
  ciscoConfig: "2026-11-28T10:02:00.000Z",
};

const KEYS: Array<UnknownSenderKey> = [
  "brocadePortChange",
  "linkDown",
  "ciscoConfig",
];

let writtenRows: Array<JSONObject> = [];

function trapJob(key: UnknownSenderKey): ProbeIngestJobData {
  const forwarded: Partial<SnmpTrap> = forwardedUnknownSenderTrap(key);

  return JSON.parse(
    JSON.stringify({
      jobType: "snmp-trap",
      ingestionTimestamp: new Date(RECEIVED_AT[key]),
      snmpTrap: {
        probeId: PROBE_ID.toString(),
        snmpTrap: { ...forwarded, receivedAt: RECEIVED_AT[key] },
      },
    }),
  ) as ProbeIngestJobData;
}

function theProbeIs(fields: { isGlobalProbe: boolean }): void {
  const probe: Probe = new Probe(PROBE_ID);
  probe.isGlobalProbe = fields.isGlobalProbe;

  if (!fields.isGlobalProbe) {
    probe.projectId = PROJECT_ID;
  }

  jest.spyOn(ProbeService, "findOneById").mockResolvedValue(probe as never);
}

/*
 * The rows written, as the Events page reads them back through the logs'
 * list endpoint: their time and their attributes, each value as a string,
 * as ClickHouse hands them.
 */
function asTheLogsListReturnsThem(): Array<{
  time: Date;
  body: unknown;
  attributes: JSONObject;
}> {
  return writtenRows.map((row: JSONObject) => {
    const attributes: JSONObject = {};

    for (const [key, value] of Object.entries(
      (row["attributes"] as JSONObject) || {},
    )) {
      attributes[key] = String(value);
    }

    return {
      time: new Date(
        Number(BigInt(row["timeUnixNano"] as string) / BigInt(1000000)),
      ),
      body: row["body"],
      attributes: attributes,
    };
  });
}

// Whether a log row matches the attribute filter the card reads traps by.
function readByTheCard(log: { attributes: JSONObject }): boolean {
  return Object.entries(buildNetworkEventTrapSourcesAttributes()).every(
    ([key, value]: [string, string]): boolean => {
      return log.attributes[key] === value;
    },
  );
}

// What the card's Add as device opens: Add Device, with what it fills in.
function addAsDevice(
  source: NetworkEventSource,
): ReturnType<typeof readAddDevicePrefill> & { opens: string | null } {
  const search: URLSearchParams = new URLSearchParams({
    [NETWORK_QUICK_ACTION_QUERY_PARAM]: NetworkQuickAction.AddDevice,
    [NETWORK_QUICK_ACTION_ADDRESS_PARAM]: source.address,
    ...(source.probeId
      ? { [NETWORK_QUICK_ACTION_PROBE_PARAM]: source.probeId }
      : {}),
    ...(source.siteId
      ? { [NETWORK_QUICK_ACTION_SITE_PARAM]: source.siteId }
      : {}),
  });

  return {
    opens: search.get(NETWORK_QUICK_ACTION_QUERY_PARAM),
    ...readAddDevicePrefill(`?${search.toString()}`),
  };
}

beforeEach(() => {
  writtenRows = [];
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
  SnmpTrapUnmatchedHome.clearCache();

  // No device on the probe has any of the three addresses.
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(
      (NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache })
        .dnsCache,
      "resolve",
    )
    .mockResolvedValue([] as never);
  jest
    .spyOn(NetworkDeviceWalkUtil, "findMonitorsWatchingDevices")
    .mockResolvedValue([] as never);

  // The project uses the probe, and the site whose default signed the trap names it.
  jest
    .spyOn(NetworkDeviceService, "findProbeUseByProject")
    .mockImplementation((async (data: { siteIds: Array<string> }) => {
      return {
        isUsed: true,
        siteIds: data.siteIds.filter((id: string): boolean => {
          return id === UNKNOWN_SENDER_SITE_ID;
        }),
      };
    }) as never);

  // Only the log table and the service lookup stand in for the writer.
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never);
  jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
    rows: Array<JSONObject>,
  ): Promise<void> => {
    writtenRows.push(...rows);
  }) as never);
  jest
    .spyOn(TelemetryMilestones, "markInserted")
    .mockReturnValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
  SnmpTrapUnmatchedHome.clearCache();
});

async function ingestTheThree(): Promise<void> {
  for (const key of KEYS) {
    await processSnmpTrapFromQueue(trapJob(key));
  }
}

describe("on the project's own probe", () => {
  beforeEach(() => {
    theProbeIs({ isGlobalProbe: false });
  });

  it("each trap is kept in the project as from an unknown source, the signed one with its site", async () => {
    await ingestTheThree();

    expect(
      writtenRows.map((row: JSONObject) => {
        const attributes: JSONObject = row["attributes"] as JSONObject;
        return [
          row["projectId"],
          attributes["snmpTrap.sourceIp"],
          attributes["snmpTrap.unmatched"],
          attributes["probe.id"],
          attributes["networkSite.id"],
        ];
      }),
    ).toEqual([
      [
        PROJECT_ID.toString(),
        "127.0.12.20",
        true,
        PROBE_ID.toString(),
        undefined,
      ],
      [
        PROJECT_ID.toString(),
        "127.0.12.21",
        true,
        PROBE_ID.toString(),
        undefined,
      ],
      [
        PROJECT_ID.toString(),
        "127.0.12.22",
        true,
        PROBE_ID.toString(),
        UNKNOWN_SENDER_SITE_ID,
      ],
    ]);
  });

  it("only the linkDown is an event; the enterprise traps are in Logs only - and the card reads every one", async () => {
    await ingestTheThree();

    const logs: Array<{ time: Date; body: unknown; attributes: JSONObject }> =
      asTheLogsListReturnsThem();

    expect(
      toNetworkEventRows(logs).map((row: { sourceIp?: string | undefined }) => {
        return row.sourceIp;
      }),
    ).toEqual(["127.0.12.21"]);

    expect(logs.filter(readByTheCard)).toHaveLength(3);
  });

  it("the card lists all three senders, the newest first, each as an SNMP trap sender, with its maker where its traps say", async () => {
    await ingestTheThree();

    const sources: Array<NetworkEventSource> = toNetworkEventSources(
      asTheLogsListReturnsThem().filter(readByTheCard),
    );

    expect(
      sources.map((source: NetworkEventSource) => {
        return {
          address: source.address,
          kinds: source.kinds,
          vendor: source.vendor,
          lastSeenAt: source.lastSeenAt?.toISOString(),
        };
      }),
    ).toEqual([
      {
        address: "127.0.12.22",
        kinds: [NetworkEventSourceKind.SnmpTraps],
        vendor: "Cisco",
        lastSeenAt: RECEIVED_AT.ciscoConfig,
      },
      {
        address: "127.0.12.21",
        kinds: [NetworkEventSourceKind.SnmpTraps],
        // A standard trap names no maker.
        vendor: undefined,
        lastSeenAt: RECEIVED_AT.linkDown,
      },
      {
        address: "127.0.12.20",
        kinds: [NetworkEventSourceKind.SnmpTraps],
        vendor: "Brocade",
        lastSeenAt: RECEIVED_AT.brocadePortChange,
      },
    ]);
  });

  it("Add as device fills in the address and the probe, and the site whose default credentials signed it", async () => {
    await ingestTheThree();

    const byAddress: Map<string, NetworkEventSource> = new Map(
      toNetworkEventSources(
        asTheLogsListReturnsThem().filter(readByTheCard),
      ).map((source: NetworkEventSource): [string, NetworkEventSource] => {
        return [source.address, source];
      }),
    );

    expect(addAsDevice(byAddress.get("127.0.12.22")!)).toEqual({
      opens: NetworkQuickAction.AddDevice,
      address: "127.0.12.22",
      probeId: PROBE_ID.toString(),
      siteId: UNKNOWN_SENDER_SITE_ID,
    });

    // Signed by no site's default: the address and the probe.
    for (const address of ["127.0.12.20", "127.0.12.21"]) {
      expect(addAsDevice(byAddress.get(address)!)).toEqual({
        opens: NetworkQuickAction.AddDevice,
        address: address,
        probeId: PROBE_ID.toString(),
      });
    }
  });
});

describe("on a global probe", () => {
  beforeEach(() => {
    theProbeIs({ isGlobalProbe: true });
  });

  it("only the trap signed with one project's site default is kept, in that project: the card lists that sender alone", async () => {
    await ingestTheThree();

    // v2c traps at a global probe could be anyone's: kept nowhere, as before.
    expect(writtenRows).toHaveLength(1);
    expect(writtenRows[0]!["projectId"]).toBe(PROJECT_ID.toString());

    const sources: Array<NetworkEventSource> = toNetworkEventSources(
      asTheLogsListReturnsThem().filter(readByTheCard),
    );

    expect(sources).toHaveLength(1);
    expect(addAsDevice(sources[0]!)).toEqual({
      opens: NetworkQuickAction.AddDevice,
      address: "127.0.12.22",
      probeId: PROBE_ID.toString(),
      siteId: UNKNOWN_SENDER_SITE_ID,
    });
  });
});
