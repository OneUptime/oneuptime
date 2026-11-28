import { mockRouter } from "Common/Tests/Server/API/Helpers";
import {
  DNS_NAMED_ACME_PROJECT_ID,
  DNS_NAMED_DEVICES,
  DNS_NAMED_GLOBEX_PROJECT_ID,
  DNS_NAMED_RECEIVER_USERS,
  DnsNamedDevice,
  DnsNamedDeviceKey,
  dnsNamedProbeReport,
  resolveDnsNamedDevice,
} from "Common/Tests/Helpers/Snmp/DnsNamedDeviceSnmpV3Traps";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import GlobalProbeSnmpTrapReportService from "Common/Server/Services/GlobalProbeSnmpTrapReportService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProbeService from "Common/Server/Services/ProbeService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import SnmpTrapReceiverUsers from "Common/Server/Utils/Monitor/SnmpTrapReceiverUsers";
import Response from "Common/Server/Utils/Response";
import IP from "Common/Types/IP/IP";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
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
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

import "../../FeatureSet/Telemetry/API/ProbeIngest/SnmpTrapReceiver";

/*
 * A PROBE'S REFUSED SNMPv3 TRAPS FROM DEVICES ADDED BY DNS NAMES, THROUGH
 * THE REPORT ROUTE (OneUptime issue #11406).
 *
 * What a probe reports for five SNMPv3 traps Net-SNMP 5.9.4 sent, each from
 * an address of its own (Common/Tests/Helpers/Snmp/DnsNamedDeviceSnmpV3Traps;
 * the probe's SnmpTrapReceiverDnsNamedDevices refuses the same datagrams),
 * posted to POST /probe/snmp-trap/receiver and kept by the real
 * SnmpTrapReceiverReports. Only the database reads and the resolver stand
 * in: the devices on the probe as the SQL returns them, and each DNS name
 * resolving to the address its device sends from.
 *
 * Before #11406, a refusal was matched to a device's typed addresses only:
 * Acme's and Globex's DNS-named devices got none of theirs, and the address
 * Acme typed in that Globex's name resolves to went to Acme.
 */

type RouteStep = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type DnsCache = { resolve: (hostname: string) => Promise<Array<string>> };

const URI: string = "/probe/snmp-trap/receiver";
const PROBE_ID: ObjectID = new ObjectID("11406000-0000-4000-8000-0000000000f1");

const ACME: string = DNS_NAMED_ACME_PROJECT_ID;
const GLOBEX: string = DNS_NAMED_GLOBEX_PROJECT_ID;

const responseUtil: {
  sendErrorResponse: Mock;
  sendJsonObjectResponse: Mock;
} = Response as unknown as {
  sendErrorResponse: Mock;
  sendJsonObjectResponse: Mock;
};

let keptOnProbe: Mock;
let recordShares: Mock;
let resolve: Mock;

function asDevice(recorded: DnsNamedDevice): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(new ObjectID(recorded.id));
  device.projectId = new ObjectID(recorded.projectId);
  device.name = recorded.name;
  device.hostname = recorded.hostname;
  return device;
}

/*
 * The devices on the probe, as the two reads return them: by the typed
 * addresses the refusals came from, and those added by a DNS name.
 */
function theProbeHas(keys: Array<DnsNamedDeviceKey>): void {
  const devices: Array<NetworkDevice> = keys.map(
    (key: DnsNamedDeviceKey): NetworkDevice => {
      return asDevice(DNS_NAMED_DEVICES[key]);
    },
  );

  jest
    .spyOn(NetworkDeviceService, "findDevicesAtAddressesOnProbe")
    .mockImplementation((async (data: {
      addresses: Array<string>;
    }): Promise<Array<NetworkDevice>> => {
      return devices.filter((device: NetworkDevice): boolean => {
        return data.addresses.includes(device.hostname || "");
      });
    }) as never);

  jest
    .spyOn(NetworkDeviceService, "findDnsNamedDevicesOnProbe")
    .mockImplementation((async (): Promise<Array<NetworkDevice>> => {
      return devices.filter((device: NetworkDevice): boolean => {
        return !IP.isIP(device.hostname || "");
      });
    }) as never);
}

function theProbeIs(fields: { isGlobalProbe: boolean }): void {
  keptOnProbe.mockResolvedValue({
    isKept: true,
    isGlobalProbe: fields.isGlobalProbe,
  } as never);
}

async function post(body: JSONObject): Promise<void> {
  const route: { handlerFunction: RouteStep } = mockRouter.match("post", URI);
  const req: JSONObject = { body: body, probe: new Probe(PROBE_ID) };

  await route.handlerFunction(
    req as unknown as ExpressRequest,
    {} as ExpressResponse,
    jest.fn() as unknown as NextFunction,
  );

  expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
}

function postReport(
  report: SnmpTrapReceiverReport = dnsNamedProbeReport(),
): Promise<void> {
  return post({ snmpTrapReceiver: report as unknown as JSONObject });
}

function shares(): Map<string, Array<SnmpTrapRefusal>> {
  return (
    recordShares.mock.calls[0]![0] as {
      sharesByProject: Map<string, Array<SnmpTrapRefusal>>;
    }
  ).sharesByProject;
}

function keptReport(): SnmpTrapReceiverReport {
  return (keptOnProbe.mock.calls[0]![0] as { report: SnmpTrapReceiverReport })
    .report;
}

function described(
  refusals: Array<SnmpTrapRefusal> | undefined,
): Array<[string, string, string, Array<string> | undefined]> {
  return (refusals || [])
    .map(
      (
        refusal: SnmpTrapRefusal,
      ): [string, string, string, Array<string> | undefined] => {
        return [
          refusal.sourceAddress,
          refusal.userName,
          refusal.reason,
          refusal.deviceIds,
        ];
      },
    )
    .sort();
}

beforeEach(() => {
  NetworkDeviceHydrationUtil.clearSourceMatchCache();

  jest
    .spyOn(SnmpTrapReceiverUsers, "getUsersForProbe")
    .mockResolvedValue(DNS_NAMED_RECEIVER_USERS as never);

  keptOnProbe = jest
    .spyOn(ProbeService, "recordSnmpTrapReceiverReport")
    .mockResolvedValue({
      isKept: true,
      isGlobalProbe: true,
    } as never) as unknown as Mock;

  recordShares = jest
    .spyOn(GlobalProbeSnmpTrapReportService, "recordShares")
    .mockResolvedValue(undefined as never) as unknown as Mock;

  resolve = jest
    .spyOn(
      (NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache })
        .dnsCache,
      "resolve",
    )
    .mockImplementation((async (hostname: string): Promise<Array<string>> => {
      try {
        return resolveDnsNamedDevice(hostname);
      } catch {
        return [];
      }
    }) as never) as unknown as Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("on a global probe serving Acme and Globex", () => {
  beforeEach(() => {
    theProbeIs({ isGlobalProbe: true });
    theProbeHas([
      "acmeCore",
      "acmeEdge",
      "globexDist",
      "acmeBranch",
      "globexNat",
      "acmeLab",
      "globexLab",
    ]);
  });

  test("Acme's devices added by DNS names get their refusals, each naming its device", async () => {
    await postReport();

    expect(described(shares().get(ACME))).toEqual([
      [
        "127.0.11.6",
        "acme-core",
        SnmpTrapRefusalReason.UnknownUser,
        [DNS_NAMED_DEVICES.acmeCore.id],
      ],
      [
        "127.0.11.7",
        "acme-edge",
        SnmpTrapRefusalReason.WrongDigest,
        [DNS_NAMED_DEVICES.acmeEdge.id],
      ],
    ]);
  });

  test("Globex's gets its own distribution switch's, and nothing of Acme's", async () => {
    await postReport();

    expect(described(shares().get(GLOBEX))).toEqual([
      [
        "127.0.11.8",
        "globex-dist",
        SnmpTrapRefusalReason.UnknownUser,
        [DNS_NAMED_DEVICES.globexDist.id],
      ],
    ]);

    const globex: string = JSON.stringify(shares().get(GLOBEX));

    for (const acmeOnly of [
      "acme-core",
      "acme-edge",
      DNS_NAMED_DEVICES.acmeCore.id,
      DNS_NAMED_DEVICES.acmeEdge.id,
      DNS_NAMED_DEVICES.acmeBranch.id,
    ]) {
      expect(globex).not.toContain(acmeOnly);
    }
  });

  test("an address Acme typed in that Globex's name resolves to, one both projects' names resolve to, and the scanner's: nobody's", async () => {
    await postReport();

    expect(Array.from(shares().keys()).sort()).toEqual([ACME, GLOBEX].sort());

    const everything: string = JSON.stringify(Array.from(shares().values()));

    for (const nobodys of [
      "127.0.11.9",
      "nat-member",
      "127.0.11.10",
      "scanner",
      DNS_NAMED_DEVICES.globexNat.id,
      DNS_NAMED_DEVICES.acmeLab.id,
      DNS_NAMED_DEVICES.globexLab.id,
    ]) {
      expect(everything).not.toContain(nobodys);
    }
  });

  test("Globex's edge user name never reads as a known one to Globex: it is Acme's", async () => {
    theProbeHas(["globexDist"]);

    await postReport({
      ...dnsNamedProbeReport(),
      refusals: [
        {
          ...dnsNamedProbeReport().refusals[1]!,
          sourceAddress: "127.0.11.8",
        },
      ],
    });

    // A wrong digest for acme-edge, from Globex's address: to Globex, an unknown user.
    expect(described(shares().get(GLOBEX))).toEqual([
      [
        "127.0.11.8",
        "acme-edge",
        SnmpTrapRefusalReason.UnknownUser,
        [DNS_NAMED_DEVICES.globexDist.id],
      ],
    ]);
  });

  test("each name is resolved once, through trap matching's cache, and only when something was refused", async () => {
    await postReport();

    expect(
      resolve.mock.calls
        .map((call: Array<unknown>) => {
          return call[0];
        })
        .sort(),
    ).toEqual(
      [
        "core-sw-01.acme.example",
        "dist-sw.globex.example",
        "edge-fw.acme.example",
        "lab-sw.acme.example",
        "lab.globex.example",
        "nat.globex.example",
      ].sort(),
    );

    resolve.mockClear();
    await postReport({ ...dnsNamedProbeReport(), refusals: [] });
    expect(resolve).not.toHaveBeenCalled();
  });

  test("a name that does not resolve gives its device nothing, and fails nothing", async () => {
    resolve.mockResolvedValue([] as never);

    await postReport();

    // Only the address Acme typed in is left, which no other project has now.
    expect(described(shares().get(ACME))).toEqual([
      [
        "127.0.11.9",
        "nat-member",
        SnmpTrapRefusalReason.UnknownUser,
        [DNS_NAMED_DEVICES.acmeBranch.id],
      ],
    ]);
    expect(shares().has(GLOBEX)).toBe(false);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  test("the probe is answered with its users all the same", async () => {
    await postReport();

    expect(
      responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject,
    ).toEqual({ users: DNS_NAMED_RECEIVER_USERS, isReportKept: true });
  });
});

describe("on Acme's own probe", () => {
  beforeEach(() => {
    theProbeIs({ isGlobalProbe: false });
    theProbeHas(["acmeCore", "acmeEdge", "acmeBranch", "acmeLab"]);
  });

  test("the whole report is kept, each refusal naming the device it came from, by its DNS name", async () => {
    await postReport();

    expect(recordShares).not.toHaveBeenCalled();
    expect(
      keptReport().refusals.map((refusal: SnmpTrapRefusal) => {
        return [refusal.sourceAddress, refusal.deviceIds];
      }),
    ).toEqual([
      ["127.0.11.6", [DNS_NAMED_DEVICES.acmeCore.id]],
      ["127.0.11.7", [DNS_NAMED_DEVICES.acmeEdge.id]],
      ["127.0.11.8", undefined],
      ["127.0.11.9", [DNS_NAMED_DEVICES.acmeBranch.id]],
      ["127.0.11.10", [DNS_NAMED_DEVICES.acmeLab.id]],
    ]);
  });

  test("each device's page then lists its own, though the page resolves no names", async () => {
    await postReport();

    // As the probe's row is read back and a device's page filters it.
    const stored: SnmpTrapReceiverReport | null =
      SnmpTrapReceiverUtil.parseReport(
        JSON.parse(JSON.stringify(keptReport())),
      );

    for (const [key, userName] of [
      ["acmeCore", "acme-core"],
      ["acmeEdge", "acme-edge"],
      ["acmeLab", "scanner"],
    ] as Array<[DnsNamedDeviceKey, string]>) {
      expect(
        SnmpTrapReceiverUtil.getRefusalsOfDevice(stored, {
          deviceId: DNS_NAMED_DEVICES[key].id,
          addresses: [DNS_NAMED_DEVICES[key].hostname],
        }).map((refusal: SnmpTrapRefusal) => {
          return refusal.userName;
        }),
      ).toEqual([userName]);
    }

    // The way the page matched before: by typed addresses only, nothing.
    expect(
      SnmpTrapReceiverUtil.getRefusalsFromAddresses(stored, [
        DNS_NAMED_DEVICES.acmeCore.hostname,
      ]),
    ).toEqual([]);
  });
});

describe("a probe cannot name devices", () => {
  beforeEach(() => {
    theProbeIs({ isGlobalProbe: false });
    theProbeHas(["acmeCore"]);
  });

  test("devices a probe puts on its refusals are dropped: only those OneUptime found are kept", async () => {
    const forged: string = "11406000-0000-4000-8000-00000000dead";

    await postReport({
      ...dnsNamedProbeReport(),
      refusals: dnsNamedProbeReport().refusals.map(
        (refusal: SnmpTrapRefusal): SnmpTrapRefusal => {
          return { ...refusal, deviceIds: [forged] };
        },
      ),
    });

    expect(JSON.stringify(keptReport())).not.toContain(forged);
    expect(keptReport().refusals[0]!.deviceIds).toEqual([
      DNS_NAMED_DEVICES.acmeCore.id,
    ]);
  });
});
