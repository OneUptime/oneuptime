import { JSONObject } from "Common/Types/JSON";
import {
  StorageArrayCollectionJob,
  StorageArrayConnectionTestJob,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import {
  StorageArrayPollerDependencies,
  StorageArrayTransportHandle,
} from "../../../../../../Utils/StorageArray/StorageArrayTransport";
import FakeUnisphere, {
  FakeArray,
  FakeUnisphereOptions,
} from "./FakeUnisphere";
import {
  BE_DIRECTOR_INSTANCES,
  CLASSIC_DIRECTOR_IDS,
  HEALTH,
  REALTIME_HELP_METRICS,
  SRP_1,
  VERSION_10_4,
  alert,
  classicDirector,
  enhancedDirectors,
  enhancedPorts,
  enhancedRdfGroups,
  enhancedStorageGroup,
  enhancedVolume,
  registrationDetails,
  sloProvisioningSymmetrix,
  systemSymmetrix,
} from "./UnisphereRecordings";

/*
 * ONE UNISPHERE AND THE ARRAYS IT MANAGES, FOR THE POLLER'S TESTS (#11004):
 *
 *   - 000220200269, a PowerMax 8500 on PowerMaxOS 10 (6079): every kind,
 *     performance and real-time collection on, an SRDF/S group in sync and
 *     an SRDF/A group whose pairs are suspended, a director offline, an
 *     iSCSI port offline in a masking view, and open alerts of every
 *     severity;
 *   - 000297900330, a PowerMax 2000 on PowerMaxOS 5978: performance
 *     collection off, capacity reported per pool only, no health scores;
 *   - 000220002429, the remote array of the SRDF groups, seen through SRDF
 *     only: never collected here.
 *
 * Every answer is one of Dell's documented examples (UnisphereRecordings).
 */

export const ARRAY_V4: string = "000220200269";
export const ARRAY_V3: string = "000297900330";
export const ARRAY_REMOTE: string = "000220002429";

export const USERNAME: string = "oneuptime-monitor";
// A password no log line, report or error may ever contain.
export const PASSWORD: string = "Uni$phere-R3ad-0nly-2026!";

export const NOW_MS: number = Date.parse("2026-11-26T10:00:00.000Z");

export const ADDRESS: string = "https://unisphere.example.com:8443";

export function v4Array(): FakeArray {
  const id: string = ARRAY_V4;
  return {
    symmetrixId: id,
    details: systemSymmetrix({
      symmetrixId: id,
      model: "PowerMax_8500",
      microcode: "6079.275.0",
      local: true,
    }),
    provisioning: sloProvisioningSymmetrix(id),
    srps: { SRP_1: SRP_1 },
    health: HEALTH,
    alerts: [
      alert({
        alertId: "7b15910a-16e0-4b57-989a-d918efcba116",
        symmetrixId: id,
        severity: "CRITICAL",
        object: "OR-2C",
        objectType: "Director",
        description: "Director OR-2C is offline.",
        createdMs: NOW_MS - 3_600_000,
      }),
      alert({
        alertId: "d38a65d0-3a54-4170-9621-c876e0fe9ca4",
        symmetrixId: id,
        severity: "WARNING",
        type: "PERFORMANCE",
        object: "Oracle_PROD_SG",
        objectType: "Storage Group",
        description:
          "Response time of storage group Oracle_PROD_SG exceeded its service level.",
      }),
      alert({
        alertId: "0602a024-d95f-414c-8ea8-5c3808945ff9",
        symmetrixId: id,
        severity: "MINOR",
      }),
      alert({
        alertId: "5f4a2c1e-0000-4000-8000-000000000004",
        symmetrixId: id,
        severity: "INFORMATION",
      }),
      alert({
        alertId: "5f4a2c1e-0000-4000-8000-000000000005",
        symmetrixId: id,
        severity: "FATAL",
        acknowledged: true,
        state: "ACKNOWLEDGED",
      }),
    ],
    classicDirectors: {},
    registration: registrationDetails({
      symmetrixId: id,
      realtime: true,
      diagnostic: true,
      selectedSGs: "Oracle_PROD_SG",
    }),
    storageGroups: [
      enhancedStorageGroup({
        id: "PF_PMUNI-16037_1",
        symmetrixId: id,
        volumes: 2,
        capGb: 100,
        usedGb: 40,
        rdf: {
          states: ["Synchronized"],
          modes: ["Synchronous"],
          localGroup: "88",
          remoteGroup: "88",
          remoteSystem: ARRAY_REMOTE,
        },
      }),
      enhancedStorageGroup({
        id: "Oracle_PROD_SG",
        symmetrixId: id,
        serviceLevel: "Diamond",
        volumes: 2,
        capGb: 2048,
        usedGb: 1536,
      }),
      enhancedStorageGroup({
        id: "VMware_DS_SG",
        symmetrixId: id,
        serviceLevel: "Gold",
        volumes: 8,
        capGb: 4096,
        usedGb: 1024,
        rdf: {
          states: ["Suspended"],
          modes: ["Asynchronous"],
          localGroup: "12",
          remoteGroup: "12",
          remoteSystem: ARRAY_REMOTE,
        },
      }),
      enhancedStorageGroup({
        id: "Empty_SG",
        symmetrixId: id,
        volumes: 0,
        capGb: 0,
        usedGb: 0,
      }),
    ],
    volumes: [
      enhancedVolume({
        id: "006E7",
        symmetrixId: id,
        capGb: 50,
        usedGb: 20,
        storageGroups: ["PF_PMUNI-16037_1"],
      }),
      enhancedVolume({
        id: "006E8",
        symmetrixId: id,
        capGb: 50,
        usedGb: 20,
        storageGroups: ["PF_PMUNI-16037_1"],
      }),
      enhancedVolume({
        id: "00847",
        symmetrixId: id,
        identifier: "ora_data_01",
        capGb: 1024,
        usedGb: 768,
        storageGroups: ["Oracle_PROD_SG"],
      }),
      enhancedVolume({
        id: "00848",
        symmetrixId: id,
        identifier: "ora_redo_01",
        capGb: 1024,
        usedGb: 768,
        storageGroups: ["Oracle_PROD_SG"],
      }),
      // A gatekeeper, in no storage group: not a volume hosts see.
      enhancedVolume({
        id: "00001",
        symmetrixId: id,
        capGb: 0.01,
        usedGb: 0,
        storageGroups: [],
      }),
    ],
    directors: [
      ...enhancedDirectors(id),
      {
        id: "OR-2C",
        resource_type: "directors",
        system: { id: id, resource_type: "systems" },
        type: "OSHostAndRDF",
        status: "Offline",
        director_number: 34,
        engine_number: 1,
        slot_number: 2,
        num_of_ports: 0,
        ports: [],
      },
    ],
    ports: enhancedPorts(id),
    rdfGroups: enhancedRdfGroups(id, ARRAY_REMOTE),
    performance: {
      Array: [
        {
          id: id,
          metrics: [
            {
              HostIOs: 1200,
              HostMBs: 300,
              PercentReads: 75,
              PercentWrites: 25,
              ReadResponseTime: 0.25,
              WriteResponseTime: 0.5,
              PercentHit: 92.5,
              PercentCacheWP: 3.5,
              FEUtilization: 18,
              BEUtilization: 9,
              RDFUtilization: 4,
              timestamp: NOW_MS - 600_000,
            },
            // The newest 5-minute sample wins.
            {
              HostIOs: 1500,
              HostMBs: 375,
              PercentReads: 80,
              PercentWrites: 20,
              ReadResponseTime: 0.2,
              WriteResponseTime: 0.4,
              PercentHit: 93,
              PercentCacheWP: 4,
              FEUtilization: 20,
              BEUtilization: 10,
              RDFUtilization: 5,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
      ],
      StorageGroup: [
        {
          id: "Oracle_PROD_SG",
          metrics: [
            {
              ResponseTime: 4.2,
              ReadResponseTime: 3.1,
              WriteResponseTime: 6.5,
              HostIOs: 800,
              HostReads: 600,
              HostWrites: 200,
              HostMBs: 120,
              HostMBReads: 90,
              HostMBWritten: 30,
              PercentHit: 88,
              HostIOLimitPercentTimeExceeded: 0,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
        {
          id: "PF_PMUNI-16037_1",
          metrics: [
            {
              ResponseTime: 0.35,
              ReadResponseTime: 0.3,
              WriteResponseTime: 0.4,
              HostIOs: 50,
              HostReads: 25,
              HostWrites: 25,
              HostMBs: 5,
              HostMBReads: 2.5,
              HostMBWritten: 2.5,
              PercentHit: 99,
              HostIOLimitPercentTimeExceeded: 0,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
      ],
      SRP: [
        {
          id: "SRP_1",
          metrics: [
            {
              ResponseTime: 0.6,
              HostIOs: 1500,
              HostMBs: 375,
              BEReqs: 210,
              BEMBTransferred: 40,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
      ],
      FEDirector: [
        {
          id: "OR-1C",
          metrics: [
            {
              PercentBusy: 12.5,
              HostIOs: 700,
              HostMBs: 150,
              Reqs: 650,
              ReadResponseTime: 0.13,
              WriteResponseTime: 0.33,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
      ],
      BEDirector: BE_DIRECTOR_INSTANCES,
      FEPort: [
        {
          id: "OR-3C:35",
          metrics: [
            {
              PercentBusy: 7,
              IOs: 320,
              MBRead: 40,
              MBWritten: 12,
              MBs: 52,
              ResponseTime: 0.48414138,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
      ],
      RDFA: [
        {
          id: "12",
          metrics: [
            {
              AvgCycleTime: 30,
              RDF_R1_R2_MBs: 12.5,
              RdfResponseTime: 1.5,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
      ],
      RDFS: [
        {
          id: "88",
          metrics: [
            {
              HostMBWritten: 3.25,
              RDFS_WriteResponseTime: 0.9,
              timestamp: NOW_MS - 300_000,
            },
          ],
        },
      ],
    },
    realtimeMetrics: REALTIME_HELP_METRICS,
    realtime: {
      Oracle_PROD_SG: [
        {
          HostIOs: 810,
          HostMBs: 121,
          ReadResponseTime: 3,
          WriteResponseTime: 6,
          HostReads: 600,
          HostWrites: 210,
          timestamp: NOW_MS - 10_000,
        },
        {
          HostIOs: 820,
          HostMBs: 122,
          ReadResponseTime: 3.2,
          WriteResponseTime: 6.4,
          HostReads: 610,
          HostWrites: 210,
          timestamp: NOW_MS - 5_000,
        },
        // Older than a collection reads: left out of the window.
        {
          HostIOs: 100,
          HostMBs: 10,
          ReadResponseTime: 1,
          WriteResponseTime: 1,
          HostReads: 50,
          HostWrites: 50,
          timestamp: NOW_MS - 3_600_000,
        },
      ],
    },
    volumeMetrics: [
      {
        volumeId: "00847",
        storageGroups: "Oracle_PROD_SG",
        points: [
          {
            IoRate: 380,
            HostMBs: 60,
            ResponseTime: 4,
            ReadResponseTime: 3,
            WriteResponseTime: 6,
            timestamp: NOW_MS - 600_000,
          },
          {
            IoRate: 400,
            HostMBs: 64,
            ResponseTime: 4.4,
            ReadResponseTime: 3.2,
            WriteResponseTime: 6.6,
            timestamp: NOW_MS - 300_000,
          },
        ],
      },
      {
        volumeId: "00848",
        storageGroups: "Oracle_PROD_SG",
        points: [
          {
            IoRate: 410,
            HostMBs: 58,
            ResponseTime: 4.1,
            ReadResponseTime: 3,
            WriteResponseTime: 6.2,
            timestamp: NOW_MS - 300_000,
          },
        ],
      },
    ],
  };
}

export function v3Array(): FakeArray {
  const id: string = ARRAY_V3;
  const srp2: JSONObject = {
    ...SRP_1,
    srpId: "SRP_2",
    srp_capacity: {
      subscribed_allocated_tb: 10,
      subscribed_total_tb: 40,
      usable_used_tb: 5,
      usable_total_tb: 20,
      effective_used_capacity_percent: 25,
    },
  };
  return {
    symmetrixId: id,
    details: systemSymmetrix({
      symmetrixId: id,
      model: "PowerMax_2000",
      microcode: "5978.669.669",
      local: true,
    }),
    // Capacity per pool only: the array's own answer has no system_capacity.
    provisioning: {
      symmetrixId: id,
      model: "PowerMax_2000",
      microcode: "5978.669.669",
      local: true,
      system_efficiency: { data_reduction_ratio_to_one: 3 },
    },
    srps: { SRP_1: SRP_1, SRP_2: srp2 },
    health: null,
    alerts: [],
    classicDirectors: {},
    registration: registrationDetails({
      symmetrixId: id,
      realtime: false,
      diagnostic: false,
      selectedSGs: "",
    }),
    storageGroups: [
      enhancedStorageGroup({
        id: "Exchange_SG",
        symmetrixId: id,
        serviceLevel: "Optimized",
        volumes: 1,
        capGb: 500,
        usedGb: 250,
      }),
      enhancedStorageGroup({
        id: "Backup_SG",
        symmetrixId: id,
        serviceLevel: "Bronze",
        volumes: 1,
        capGb: 1000,
        usedGb: 900,
      }),
    ],
    volumes: [
      enhancedVolume({
        id: "0A001",
        symmetrixId: id,
        capGb: 500,
        usedGb: 250,
        storageGroups: ["Exchange_SG"],
      }),
      enhancedVolume({
        id: "0A002",
        symmetrixId: id,
        capGb: 1000,
        usedGb: 900,
        storageGroups: ["Backup_SG"],
      }),
    ],
    directors: [
      {
        id: "FA-1D",
        resource_type: "directors",
        system: { id: id, resource_type: "systems" },
        type: "FibreChannel",
        status: "Online",
        director_number: 49,
        engine_number: 1,
        slot_number: 4,
      },
      {
        id: "DF-1C",
        resource_type: "directors",
        system: { id: id, resource_type: "systems" },
        type: "DiskFlash",
        status: "Online",
        director_number: 33,
        engine_number: 1,
        slot_number: 3,
      },
    ],
    ports: [
      {
        id: "RkEtMUQ6NA",
        resource_type: "ports",
        port_number: "4",
        director: { id: "FA-1D", resource_type: "directors" },
        system: { resource_type: "systems", id: id },
        type: "FibreChannel",
        protocol: "FC",
        port_status: "ON",
        negotiated_speed: 32,
        num_of_port_groups: 1,
        num_of_masking_views: 1,
      },
    ],
    rdfGroups: [],
    performance: {},
    realtimeMetrics: REALTIME_HELP_METRICS,
    realtime: {},
    volumeMetrics: [],
  };
}

export function remoteArray(): FakeArray {
  return {
    symmetrixId: ARRAY_REMOTE,
    details: systemSymmetrix({
      symmetrixId: ARRAY_REMOTE,
      model: "PowerMax_8500",
      microcode: "6079.275.0",
      local: false,
    }),
    provisioning: null,
    srps: {},
    health: null,
    alerts: [],
    classicDirectors: {},
    registration: null,
    storageGroups: [],
    volumes: [],
    directors: [],
    ports: [],
    rdfGroups: [],
    performance: {},
    realtimeMetrics: [],
    realtime: {},
    volumeMetrics: [],
  };
}

// The 10.1 / 10.2 directors, one by one: Dell's classic list, all online but one.
export function withClassicDirectors(array: FakeArray): FakeArray {
  const directors: Record<string, JSONObject> = {};
  for (const id of CLASSIC_DIRECTOR_IDS) {
    directors[id] = classicDirector(id, id === "FA-3D" ? "Offline" : "Online");
  }
  return { ...array, classicDirectors: directors };
}

export function makeUnisphere(
  overrides: Partial<FakeUnisphereOptions> = {},
): FakeUnisphere {
  return new FakeUnisphere({
    version: VERSION_10_4,
    users: {
      [USERNAME]: { password: PASSWORD, roles: ["Monitor", "PerfMonitor"] },
      "monitor-only": { password: PASSWORD, roles: ["Monitor"] },
      "no-roles": { password: PASSWORD, roles: [] },
      "locked-out": { password: PASSWORD, roles: [], isLockedOut: true },
      // Unisphere gives roles per array: this one may read the 8500 only.
      "one-array": {
        password: PASSWORD,
        roles: [],
        arrayRoles: { [ARRAY_V4]: ["Monitor", "PerfMonitor"] },
      },
    },
    arrays: [v4Array(), v3Array(), remoteArray()],
    ...overrides,
  });
}

export interface PollerHarness {
  unisphere: FakeUnisphere;
  dependencies: Partial<StorageArrayPollerDependencies>;
  transports: Array<{
    host: string;
    port: number;
    pinnedAddresses: Array<string>;
    trustedFingerprint: string | null;
  }>;
  closed: () => number;
}

// The poller's dependencies, serving `unisphere` in memory, on a fixed clock.
export function harness(unisphere: FakeUnisphere): PollerHarness {
  const transports: PollerHarness["transports"] = [];
  let closed: number = 0;
  return {
    unisphere,
    transports,
    closed: (): number => {
      return closed;
    },
    dependencies: {
      resolve: async (): Promise<Array<string>> => {
        return ["192.0.2.10"];
      },
      createTransport: (data: {
        address: { host: string; port: number };
        pinnedAddresses: Array<string>;
        trustedFingerprint: string | null;
      }): StorageArrayTransportHandle => {
        transports.push({
          host: data.address.host,
          port: data.address.port,
          pinnedAddresses: data.pinnedAddresses,
          trustedFingerprint: data.trustedFingerprint,
        });
        return {
          transport: unisphere.transport(),
          close: (): void => {
            closed++;
          },
        };
      },
      now: (): Date => {
        return new Date(NOW_MS);
      },
      sleep: async (): Promise<void> => {},
      scopeVersion: "test",
    },
  };
}

export function collectionJob(
  overrides: Partial<StorageArrayCollectionJob> = {},
): StorageArrayCollectionJob {
  return {
    storageArrayConnectionId: "c0ffee00-0000-4000-8000-000000000001",
    connectionName: "Unisphere DC1",
    storageSystem: "dell.powermax",
    address: ADDRESS,
    username: USERNAME,
    password: PASSWORD,
    collectionIntervalInMinutes: 5,
    settingsVersion: 7,
    ...overrides,
  };
}

export function testJob(
  overrides: Partial<StorageArrayConnectionTestJob> = {},
): StorageArrayConnectionTestJob {
  return {
    storageArrayConnectionTestId: "7e570000-0000-4000-8000-000000000001",
    storageSystem: "dell.powermax",
    address: ADDRESS,
    username: USERNAME,
    password: PASSWORD,
    ...overrides,
  };
}
