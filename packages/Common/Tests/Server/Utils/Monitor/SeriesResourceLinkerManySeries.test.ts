/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../../Server/Services/HostService";
import IoTFleetService from "../../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import ServiceService from "../../../../Server/Services/ServiceService";
import StorageArrayService from "../../../../Server/Services/StorageArrayService";
import VMwareVCenterService from "../../../../Server/Services/VMwareVCenterService";
import UUIDColumnFilter from "../../../../Server/Types/Database/UUIDColumnFilter";
import EventLoop from "../../../../Server/Utils/EventLoop";
import logger from "../../../../Server/Utils/Logger";
import SeriesResourceLinker, {
  SeriesLinkableModel,
  SeriesResolvedResourceIds,
  SeriesResourcesOfEvaluation,
} from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import Includes from "../../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE SERIES OF ONE EVALUATION, RESOLVED TOGETHER (issue #10315).
 *
 * Every record a grouped monitor opens is linked to the resources its
 * series names. Each series used to read them on its own: an evaluation
 * that opened alerts for 700 series of a fleet read the Host table 700
 * times, one after another. resolveManySeries reads every series'
 * identifiers at once and hands each series its part.
 *
 * The tables below are read as Postgres reads them - the project's rows
 * only, an id in any form Postgres takes a uuid in, a name byte for byte as
 * the client sends it, a NUL refused, newest first - so the one series' path
 * (resolveResourcesFromSeriesLabels, unchanged) is the oracle: for every
 * series of a fleet drawn with every spelling, form and failure a label can
 * hold, the many series' path must give the same ids in the same order, and
 * a record linked from it must hold the same resources, or fail the same
 * way. And it must do it in one read per kind (by id, by name) whatever the
 * number of series, handing the event loop back as it goes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

// A uuid as Postgres writes it back: lower case, 8-4-4-4-12.
function asPostgresWritesIt(id: string): string {
  const hex: string = id.replace(/[{}-]/g, "").toLowerCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

interface FakeRow {
  _id: string;
  projectId: string;
  createdAt: Date;
  name: string;
}

/*
 * One resource table, read as a service reads it through Postgres.
 */
class FakeTable {
  public rows: Array<FakeRow> = [];
  public reads: Array<JSONObject> = [];
  public failNextReads: number = 0;

  public constructor(public readonly nameColumn: string) {}

  public async findBy(args: {
    query: JSONObject;
    select: JSONObject;
    skip: number;
    limit: number;
  }): Promise<Array<JSONObject>> {
    this.reads.push(args.query);
    await Promise.resolve();

    if (this.failNextReads > 0) {
      this.failNextReads--;
      throw new Error("Connection terminated unexpectedly");
    }

    let rows: Array<FakeRow> = this.rows.filter((row: FakeRow): boolean => {
      return row.projectId === String(args.query["projectId"]);
    });

    for (const [column, value] of Object.entries(args.query)) {
      if (column === "projectId") {
        continue;
      }

      const values: Array<string> = (value as Includes).values.map(
        (item: unknown): string => {
          return String(item);
        },
      );

      if (column === "_id") {
        // UUIDColumnFilter refuses any id that is no uuid before Postgres.
        for (const id of values) {
          if (!UUIDColumnFilter.isUUIDText(id)) {
            throw new BadDataException(
              `Invalid ID for "_id" in the query: "${id}".`,
            );
          }
        }

        const wanted: Set<string> = new Set(values.map(asPostgresWritesIt));
        rows = rows.filter((row: FakeRow): boolean => {
          return wanted.has(row._id);
        });
        continue;
      }

      expect(column).toBe(this.nameColumn);

      for (const name of values) {
        if (name.includes("\u0000")) {
          throw new Error('invalid byte sequence for encoding "UTF8": 0x00');
        }
      }

      // The client sends text as UTF-8: a lone surrogate arrives as U+FFFD.
      const wanted: Set<string> = new Set(
        values.map((name: string): string => {
          return Buffer.from(name, "utf8").toString("utf8");
        }),
      );
      rows = rows.filter((row: FakeRow): boolean => {
        return wanted.has(row.name);
      });
    }

    // The services' own order: newest first.
    rows = [...rows].sort((a: FakeRow, b: FakeRow): number => {
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return rows
      .slice(args.skip, args.skip + args.limit)
      .map((row: FakeRow): JSONObject => {
        return {
          _id: row._id,
          createdAt: row.createdAt,
          [this.nameColumn]: row.name,
        };
      });
  }
}

interface TableUnderTest {
  relation: keyof SeriesLinkableModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  table: FakeTable;
}

let tables: Map<keyof SeriesLinkableModel, TableUnderTest>;

function tableOf(relation: keyof SeriesLinkableModel): FakeTable {
  return tables.get(relation)!.table;
}

function readsOf(relation: keyof SeriesLinkableModel): number {
  return tableOf(relation).reads.length;
}

function totalReads(): number {
  let total: number = 0;
  for (const entry of tables.values()) {
    total += entry.table.reads.length;
  }
  return total;
}

function resetReads(): void {
  for (const entry of tables.values()) {
    entry.table.reads = [];
  }
}

const TABLES: Array<{
  relation: keyof SeriesLinkableModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  nameColumn: string;
}> = [
  { relation: "hosts", service: HostService, nameColumn: "hostIdentifier" },
  {
    relation: "dockerHosts",
    service: DockerHostService,
    nameColumn: "hostIdentifier",
  },
  {
    relation: "podmanHosts",
    service: PodmanHostService,
    nameColumn: "hostIdentifier",
  },
  {
    relation: "kubernetesClusters",
    service: KubernetesClusterService,
    nameColumn: "clusterIdentifier",
  },
  { relation: "services", service: ServiceService, nameColumn: "name" },
  {
    relation: "proxmoxClusters",
    service: ProxmoxClusterService,
    nameColumn: "name",
  },
  {
    relation: "openStackClouds",
    service: OpenStackCloudService,
    nameColumn: "name",
  },
  {
    relation: "vmwareVCenters",
    service: VMwareVCenterService,
    nameColumn: "name",
  },
  { relation: "cephClusters", service: CephClusterService, nameColumn: "name" },
  {
    relation: "dockerSwarmClusters",
    service: DockerSwarmClusterService,
    nameColumn: "name",
  },
  { relation: "iotFleets", service: IoTFleetService, nameColumn: "name" },
  {
    relation: "databaseServers",
    service: DatabaseServerService,
    nameColumn: "name",
  },
  {
    relation: "storageArrays",
    service: StorageArrayService,
    nameColumn: "name",
  },
  {
    relation: "networkDevices",
    service: NetworkDeviceService,
    nameColumn: "name",
  },
  {
    relation: "cloudResources",
    service: CloudResourceService,
    nameColumn: "name",
  },
];

// Each relation's label keys: by id, and by name.
const LABEL_KEYS: Partial<
  Record<
    keyof SeriesLinkableModel,
    { ids: Array<string>; names: Array<string> }
  >
> = {
  hosts: {
    ids: ["resource.oneuptime.host.id", "oneuptime.host.id"],
    names: [
      "resource.oneuptime.host.name",
      "oneuptime.host.name",
      "resource.host.name",
      "host.name",
    ],
  },
  dockerHosts: {
    ids: ["resource.oneuptime.docker.host.id", "oneuptime.docker.host.id"],
    names: [
      "resource.oneuptime.docker.host.name",
      "oneuptime.docker.host.name",
    ],
  },
  podmanHosts: {
    ids: ["resource.oneuptime.podman.host.id", "oneuptime.podman.host.id"],
    names: [
      "resource.oneuptime.podman.host.name",
      "oneuptime.podman.host.name",
    ],
  },
  kubernetesClusters: {
    ids: [
      "resource.oneuptime.kubernetes.cluster.id",
      "oneuptime.kubernetes.cluster.id",
    ],
    names: [
      "resource.oneuptime.kubernetes.cluster.name",
      "oneuptime.kubernetes.cluster.name",
      "resource.k8s.cluster.name",
      "k8s.cluster.name",
    ],
  },
  services: {
    ids: ["resource.oneuptime.service.id", "oneuptime.service.id"],
    names: [
      "resource.oneuptime.service.name",
      "oneuptime.service.name",
      "resource.service.name",
      "service.name",
    ],
  },
  proxmoxClusters: {
    ids: [],
    names: ["resource.proxmox.cluster.name", "proxmox.cluster.name"],
  },
  openStackClouds: {
    ids: [],
    names: ["resource.openstack.cloud.name", "openstack.cloud.name"],
  },
  vmwareVCenters: {
    ids: [],
    names: ["resource.vmware.vcenter.name", "vmware.vcenter.name"],
  },
  cephClusters: {
    ids: [],
    names: ["resource.ceph.cluster.name", "ceph.cluster.name"],
  },
  dockerSwarmClusters: {
    ids: [],
    names: ["resource.docker.swarm.cluster.name", "docker.swarm.cluster.name"],
  },
  iotFleets: { ids: [], names: ["resource.iot.fleet.name", "iot.fleet.name"] },
  databaseServers: {
    ids: [
      "resource.oneuptime.database.server.id",
      "oneuptime.database.server.id",
    ],
    names: [],
  },
  storageArrays: {
    ids: [],
    names: ["resource.storage.array.name", "storage.array.name"],
  },
};

// Names a resource can have: every script, and text a label can carry.
const NAME_TEXTS: Array<string> = [
  "docker-host-0001.prod.fleet.internal",
  "checkout-api",
  "中文服务-東京",
  "خدمة الدفع",
  "é-combining",
  "🇩🇪-fleet",
  "trailing-space ",
  "Mixed-Case",
];

let nextRowNumber: number = 0;

function newId(random: SeededRandom): string {
  const hex: string = Array.from({ length: 32 }, (): string => {
    return random(16).toString(16);
  }).join("");
  return asPostgresWritesIt(hex);
}

/*
 * Each table's rows: names in this project and in another, newest last
 * (createdAt), one name now and then held by a row of each project.
 */
function seedTables(random: SeededRandom, perTable: number): void {
  for (const entry of tables.values()) {
    for (let index: number = 0; index < perTable; index++) {
      const text: string = NAME_TEXTS[index % NAME_TEXTS.length]!;
      const name: string = `${text}-${entry.relation}-${index}`;

      for (const projectId of [PROJECT_ID, OTHER_PROJECT_ID]) {
        if (projectId === OTHER_PROJECT_ID && random(3) !== 0) {
          continue;
        }

        entry.table.rows.push({
          _id: newId(random),
          projectId: projectId.toString(),
          createdAt: new Date(Date.UTC(2026, 0, 1) + nextRowNumber++ * 1000),
          name: name,
        });
      }
    }

    // What a label with a lone surrogate names, as the client sends it.
    entry.table.rows.push({
      _id: newId(random),
      projectId: PROJECT_ID.toString(),
      createdAt: new Date(Date.UTC(2026, 0, 1) + nextRowNumber++ * 1000),
      name: "\ufffd-lone-surrogate",
    });
  }
}

function rowsOfProject(
  relation: keyof SeriesLinkableModel,
  projectId: ObjectID,
): Array<FakeRow> {
  return tableOf(relation).rows.filter((row: FakeRow): boolean => {
    return row.projectId === projectId.toString();
  });
}

// An id as a label may write it: as stored, in capitals, braced, unhyphenated.
function spelledId(id: string, random: SeededRandom): string {
  switch (random(4)) {
    case 0:
      return id.toUpperCase();
    case 1:
      return `{${id}}`;
    case 2:
      return id.split("-").join("");
    default:
      return id;
  }
}

/*
 * A value a series' label holds for a relation: a name or an id of this
 * project's, another project's, one no row has, two at once, text the
 * client sends otherwise (a lone surrogate) - and, once in a while, what a
 * read refuses: an id that is no uuid, a name with a NUL.
 */
function labelValue(
  relation: keyof SeriesLinkableModel,
  byId: boolean,
  random: SeededRandom,
): unknown {
  const own: Array<FakeRow> = rowsOfProject(relation, PROJECT_ID);
  const others: Array<FakeRow> = rowsOfProject(relation, OTHER_PROJECT_ID);
  const pick: number = random(40);

  if (pick === 0) {
    return byId ? "not-a-uuid" : "nul\u0000name";
  }

  if (pick === 1) {
    return byId ? newId(random) : "no-such-resource";
  }

  if (pick === 2 && others.length > 0) {
    const row: FakeRow = others[random(others.length)]!;
    return byId ? row._id : row.name;
  }

  if (pick === 3) {
    return byId ? "" : "\ud800-lone-surrogate";
  }

  const first: FakeRow = own[random(own.length)]!;

  if (pick <= 7) {
    const second: FakeRow = own[random(own.length)]!;
    return byId
      ? [spelledId(first._id, random), spelledId(second._id, random)]
      : [first.name, second.name];
  }

  return byId ? spelledId(first._id, random) : first.name;
}

// A fleet's series: each names a few relations, by id or by name or both.
function fleetLabels(count: number, random: SeededRandom): Array<JSONObject> {
  const relations: Array<keyof SeriesLinkableModel> = Object.keys(
    LABEL_KEYS,
  ) as Array<keyof SeriesLinkableModel>;
  const fleet: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    const labels: JSONObject = {
      "resource.container.name": `container-${index}`,
    };

    for (let named: number = random(4); named > 0; named--) {
      const relation: keyof SeriesLinkableModel =
        relations[random(relations.length)]!;
      const keys: { ids: Array<string>; names: Array<string> } =
        LABEL_KEYS[relation]!;
      const byId: boolean =
        keys.names.length === 0 || (keys.ids.length > 0 && random(3) === 0);
      const keyList: Array<string> = byId ? keys.ids : keys.names;

      labels[keyList[random(keyList.length)]!] = labelValue(
        relation,
        byId,
        random,
      ) as JSONObject[string];
    }

    fleet.push(labels);
  }

  return fleet;
}

// What the one series' path made of a series: its ids, or how it failed.
async function aloneOutcome(
  labels: JSONObject,
  monitorType: MonitorType,
): Promise<SeriesResolvedResourceIds | { failed: string }> {
  try {
    return await SeriesResourceLinker.resolveResourcesFromSeriesLabels({
      seriesLabels: labels,
      projectId: PROJECT_ID,
      monitorType: monitorType,
    });
  } catch (error) {
    return { failed: (error as Error).message };
  }
}

// A record's linked resources, relation by relation, in their order.
function linkedOn(model: SeriesLinkableModel): JSONObject {
  const linked: JSONObject = {};

  for (const entry of TABLES) {
    const items: Array<{ _id?: string | undefined }> | undefined = model[
      entry.relation
    ] as Array<{ _id?: string | undefined }> | undefined;

    linked[entry.relation] = items
      ? items.map((item: { _id?: string | undefined }): string => {
          return String(item._id);
        })
      : null;
  }

  return linked;
}

async function linkOutcome(work: () => Promise<void>): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/*
 * Whether a series names an identifier one read of every series would fail
 * on: an id that is no uuid, a name with a NUL. A Docker or Podman monitor's
 * host labels name nothing (the linker drops them), and a database id that
 * is no uuid is dropped as it is read (extractDatabaseServerIds).
 */
function hasIdentifierReadAlone(
  labels: JSONObject,
  monitorType: MonitorType = MonitorType.Metrics,
): boolean {
  const ignored: Set<string> = new Set<string>([
    ...LABEL_KEYS.databaseServers!.ids,
    ...(monitorType === MonitorType.Docker || monitorType === MonitorType.Podman
      ? [...LABEL_KEYS.hosts!.ids, ...LABEL_KEYS.hosts!.names]
      : []),
  ]);

  return Object.entries(labels).some(
    ([key, value]: [string, unknown]): boolean => {
      if (ignored.has(key)) {
        return false;
      }

      const values: Array<unknown> = Array.isArray(value) ? value : [value];
      return values.some((item: unknown): boolean => {
        return item === "not-a-uuid" || item === "nul\u0000name";
      });
    },
  );
}

beforeEach(() => {
  tables = new Map<keyof SeriesLinkableModel, TableUnderTest>();
  nextRowNumber = 0;

  for (const entry of TABLES) {
    const table: FakeTable = new FakeTable(entry.nameColumn);
    tables.set(entry.relation, {
      relation: entry.relation,
      service: entry.service,
      table: table,
    });
    jest
      .spyOn(entry.service, "findBy")
      .mockImplementation((args: unknown): Promise<unknown> => {
        return table.findBy(
          args as {
            query: JSONObject;
            select: JSONObject;
            skip: number;
            limit: number;
          },
        );
      });
  }

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("resolveManySeries gives each series what it would read alone", () => {
  test.each([MonitorType.Metrics, MonitorType.Docker, MonitorType.Podman])(
    "%s: 3,000 series of every spelling, form and failure, id for id and in order",
    async (monitorType: MonitorType) => {
      const random: SeededRandom = seededRandom(10315);
      seedTables(random, 40);
      const fleet: Array<JSONObject> = fleetLabels(3_000, random);

      const resolutions: Map<JSONObject, SeriesResolvedResourceIds> =
        await SeriesResourceLinker.resolveManySeries({
          seriesLabels: fleet,
          projectId: PROJECT_ID,
          monitorType: monitorType,
        });

      let compared: number = 0;
      let named: number = 0;

      for (const labels of fleet) {
        const alone: SeriesResolvedResourceIds | { failed: string } =
          await aloneOutcome(labels, monitorType);

        if (!resolutions.has(labels)) {
          // Left to be read alone: exactly what one read of all would fail on.
          expect(hasIdentifierReadAlone(labels, monitorType)).toBe(true);
          continue;
        }

        expect(hasIdentifierReadAlone(labels, monitorType)).toBe(false);
        expect("failed" in alone).toBe(false);
        expect(resolutions.get(labels)).toEqual(alone);
        compared++;

        if (
          Object.values(alone as SeriesResolvedResourceIds).some(
            (ids: Array<string>): boolean => {
              return ids.length > 1;
            },
          )
        ) {
          named++;
        }
      }

      // The draws reach every case: most series compared, many naming several.
      expect(compared).toBeGreaterThan(2_500);
      expect(named).toBeGreaterThan(100);
    },
  );

  test("a record linked from the evaluation's answer holds what one linked alone holds, or fails as it failed", async () => {
    const random: SeededRandom = seededRandom(8118);
    seedTables(random, 30);
    const fleet: Array<JSONObject> = fleetLabels(1_500, random);

    const evaluation: SeriesResourcesOfEvaluation =
      new SeriesResourcesOfEvaluation({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Metrics,
      });
    await evaluation.resolve(fleet);

    let failures: number = 0;

    for (const labels of fleet) {
      const before: Alert = new Alert();
      const after: Alert = new Alert();

      const beforeOutcome: string | null = await linkOutcome(() => {
        return SeriesResourceLinker.linkSeriesResourcesToModel({
          model: before,
          seriesLabels: labels,
          projectId: PROJECT_ID,
          monitorType: MonitorType.Metrics,
        });
      });
      const afterOutcome: string | null = await linkOutcome(() => {
        return evaluation.linkSeriesResourcesToModel({
          model: after,
          seriesLabels: labels,
        });
      });

      expect(afterOutcome).toBe(beforeOutcome);
      expect(linkedOn(after)).toEqual(linkedOn(before));

      if (beforeOutcome) {
        failures++;
      }
    }

    // The series a read refuses still fail, each on its own.
    expect(failures).toBeGreaterThan(0);
  });

  test("a series with nothing to link resolves to nothing, without a read", async () => {
    seedTables(seededRandom(1), 5);

    const resolutions: Map<JSONObject, SeriesResolvedResourceIds> =
      await SeriesResourceLinker.resolveManySeries({
        seriesLabels: [
          { "resource.container.name": "web-1" },
          { "resource.container.name": "web-2" },
        ],
        projectId: PROJECT_ID,
      });

    expect(totalReads()).toBe(0);
    expect(Array.from(resolutions.values())).toEqual([
      await aloneOutcome(
        { "resource.container.name": "web-1" },
        MonitorType.Metrics,
      ),
      await aloneOutcome(
        { "resource.container.name": "web-2" },
        MonitorType.Metrics,
      ),
    ]);
  });

  test("nothing to resolve reads nothing", async () => {
    expect(
      (
        await SeriesResourceLinker.resolveManySeries({
          seriesLabels: [],
          projectId: PROJECT_ID,
        })
      ).size,
    ).toBe(0);
    expect(totalReads()).toBe(0);
  });
});

describe("resolveManySeries reads each kind once, whatever the number of series", () => {
  // The #10108 fleet's labels: a container on one of its 35-a-host hosts.
  function containerFleet(count: number): Array<JSONObject> {
    const own: Array<FakeRow> = rowsOfProject("hosts", PROJECT_ID);

    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return {
        "resource.host.name": own[Math.floor(index / 35) % own.length]!.name,
        "resource.container.name": `container-${index}`,
      };
    });
  }

  test.each([10, 1_000, 16_250])(
    "%s containers over their hosts: one read of the Host table, and none of any other",
    async (count: number) => {
      seedTables(seededRandom(10108), 470);
      const fleet: Array<JSONObject> = containerFleet(count);

      const resolutions: Map<JSONObject, SeriesResolvedResourceIds> =
        await SeriesResourceLinker.resolveManySeries({
          seriesLabels: fleet,
          projectId: PROJECT_ID,
        });

      expect(readsOf("hosts")).toBe(1);
      expect(totalReads()).toBe(1);
      expect(resolutions.size).toBe(count);

      // The same ids a series reads alone: a sample of them, read after.
      resetReads();
      for (const labels of fleet.filter(
        (_labels: JSONObject, index: number) => {
          return index % 97 === 0;
        },
      )) {
        expect(resolutions.get(labels)).toEqual(
          await aloneOutcome(labels, MonitorType.Metrics),
        );
      }

      // Each series alone is a read of its own.
      expect(readsOf("hosts")).toBe(Math.ceil(count / 97));
    },
  );

  test("hosts named by id and by name across the fleet: one read by id, one by name", async () => {
    seedTables(seededRandom(2), 100);
    const own: Array<FakeRow> = rowsOfProject("hosts", PROJECT_ID);
    const fleet: Array<JSONObject> = Array.from(
      { length: 5_000 },
      (_value: unknown, index: number): JSONObject => {
        const host: FakeRow = own[index % own.length]!;
        return index % 2 === 0
          ? { "oneuptime.host.id": host._id.toUpperCase() }
          : { "oneuptime.host.name": host.name, "oneuptime.host.id": host._id };
      },
    );

    await SeriesResourceLinker.resolveManySeries({
      seriesLabels: fleet,
      projectId: PROJECT_ID,
    });

    expect(readsOf("hosts")).toBe(2);
    const columns: Array<Array<string>> = tableOf("hosts").reads.map(
      (query: JSONObject): Array<string> => {
        return Object.keys(query).sort();
      },
    );
    expect(columns).toEqual([
      ["_id", "projectId"],
      ["hostIdentifier", "projectId"],
    ]);
  });

  test("each identifier is read once, and every read is held to the project", async () => {
    seedTables(seededRandom(3), 50);
    const fleet: Array<JSONObject> = containerFleet(2_000);

    await SeriesResourceLinker.resolveManySeries({
      seriesLabels: fleet,
      projectId: PROJECT_ID,
    });

    const read: JSONObject = tableOf("hosts").reads[0]!;
    const names: Array<unknown> = (read["hostIdentifier"] as Includes).values;

    expect(String(read["projectId"])).toBe(PROJECT_ID.toString());
    expect(names.length).toBe(new Set(names).size);
    expect(new Set(names)).toEqual(
      new Set(
        fleet.map((labels: JSONObject): unknown => {
          return labels["resource.host.name"];
        }),
      ),
    );
  });

  test("past 10,000 names a kind takes a read per 10,000, and every series reads as alone", async () => {
    const random: SeededRandom = seededRandom(4);
    const hosts: FakeTable = tableOf("hosts");

    for (let index: number = 0; index < 12_500; index++) {
      hosts.rows.push({
        _id: newId(random),
        projectId: PROJECT_ID.toString(),
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
        name: `host-${index}`,
      });
    }

    /*
     * A host a series for the first read's worth, then series that each
     * name a host of either read: their rows come from two reads, and are
     * still in the order one read of them gives - newest first.
     */
    const fleet: Array<JSONObject> = [];

    for (let index: number = 0; index < 9_999; index++) {
      fleet.push({ "host.name": `host-${index}` });
    }

    fleet.push({ "host.name": ["host-9999", "host-10000"] });

    for (let index: number = 10_001; index < 12_500; index++) {
      fleet.push({ "host.name": [`host-${index - 10_001}`, `host-${index}`] });
    }

    const resolutions: Map<JSONObject, SeriesResolvedResourceIds> =
      await SeriesResourceLinker.resolveManySeries({
        seriesLabels: fleet,
        projectId: PROJECT_ID,
      });

    expect(readsOf("hosts")).toBe(2);

    const straddling: Array<JSONObject> = fleet.filter(
      (labels: JSONObject): boolean => {
        return Array.isArray(labels["host.name"]);
      },
    );
    expect(straddling).toHaveLength(2_500);

    for (const labels of [
      ...straddling.filter((_labels: JSONObject, index: number) => {
        return index % 50 === 0;
      }),
      ...fleet.filter((_labels: JSONObject, index: number) => {
        return index % 997 === 0;
      }),
    ]) {
      const alone: SeriesResolvedResourceIds | { failed: string } =
        await aloneOutcome(labels, MonitorType.Metrics);

      expect(resolutions.get(labels)).toEqual(alone);
    }

    // The newer host first, as one read of the two answers.
    expect(resolutions.get(straddling[0]!)!.hostIds).toEqual(
      ["host-10000", "host-9999"].map((name: string): string => {
        return hosts.rows.find((row: FakeRow): boolean => {
          return row.name === name;
        })!._id;
      }),
    );
  });
});

describe("resolveManySeries hands the event loop back between series", () => {
  test("about every 20 ms of work, as the create pass around it does", async () => {
    seedTables(seededRandom(5), 20);
    let now: number = 0;
    let handBacks: number = 0;

    jest.spyOn(EventLoop, "now").mockImplementation((): number => {
      now += 0.5;
      return now;
    });
    jest
      .spyOn(EventLoop, "yieldToEventLoop")
      .mockImplementation(async (): Promise<void> => {
        handBacks++;
      });

    await SeriesResourceLinker.resolveManySeries({
      seriesLabels: fleetLabels(4_000, seededRandom(6)),
      projectId: PROJECT_ID,
    });

    // Two looks a series - reading it, then answering it - at 0.5 ms each.
    expect(handBacks).toBeGreaterThanOrEqual(150);
    expect(handBacks).toBeLessThan(8_000);
  });
});

describe("SeriesResourcesOfEvaluation", () => {
  test("keeps what it resolved for the evaluation: its incidents and alerts read once", async () => {
    seedTables(seededRandom(7), 30);
    const fleet: Array<JSONObject> = fleetLabels(500, seededRandom(8)).filter(
      (labels: JSONObject): boolean => {
        return !hasIdentifierReadAlone(labels);
      },
    );

    const evaluation: SeriesResourcesOfEvaluation =
      new SeriesResourcesOfEvaluation({ projectId: PROJECT_ID });

    await evaluation.resolve(fleet);
    const readsOnce: number = totalReads();
    expect(readsOnce).toBeGreaterThan(0);

    // The alert pass, after the incident pass, for the same series.
    await evaluation.resolve(fleet);
    for (const labels of fleet) {
      await evaluation.linkSeriesResourcesToModel({
        model: new Alert(),
        seriesLabels: labels,
      });
    }

    expect(totalReads()).toBe(readsOnce);
  });

  test("a series it was not handed is read on its own when its record is linked", async () => {
    seedTables(seededRandom(9), 10);
    const host: FakeRow = rowsOfProject("hosts", PROJECT_ID)[0]!;
    const evaluation: SeriesResourcesOfEvaluation =
      new SeriesResourcesOfEvaluation({ projectId: PROJECT_ID });
    const alert: Alert = new Alert();

    await evaluation.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "host.name": host.name },
    });

    expect(readsOf("hosts")).toBe(1);
    expect(linkedOn(alert)["hosts"]).toEqual([host._id]);
  });

  test("a read that fails resolves nothing: each record then reads its own, and links what it always did", async () => {
    seedTables(seededRandom(10), 20);
    const own: Array<FakeRow> = rowsOfProject("hosts", PROJECT_ID);
    const fleet: Array<JSONObject> = own.map((host: FakeRow): JSONObject => {
      return { "host.name": host.name };
    });

    tableOf("hosts").failNextReads = 1;

    const evaluation: SeriesResourcesOfEvaluation =
      new SeriesResourcesOfEvaluation({ projectId: PROJECT_ID });
    await evaluation.resolve(fleet);

    expect(logger.error).toHaveBeenCalled();

    for (const labels of fleet) {
      expect(evaluation.isResolved(labels)).toBe(false);

      const alert: Alert = new Alert();
      await evaluation.linkSeriesResourcesToModel({
        model: alert,
        seriesLabels: labels,
      });

      const host: FakeRow = own.find((row: FakeRow): boolean => {
        return row.name === labels["host.name"];
      })!;
      expect(linkedOn(alert)["hosts"]).toEqual([host._id]);
    }

    // The failed read, then one of each series' own.
    expect(readsOf("hosts")).toBe(1 + fleet.length);
  });

  test("a series whose id is no uuid fails its own record, and only its own", async () => {
    seedTables(seededRandom(11), 10);
    const host: FakeRow = rowsOfProject("hosts", PROJECT_ID)[0]!;
    const bad: JSONObject = { "oneuptime.host.id": "not-a-uuid" };
    const good: JSONObject = { "host.name": host.name };

    const evaluation: SeriesResourcesOfEvaluation =
      new SeriesResourcesOfEvaluation({ projectId: PROJECT_ID });
    await evaluation.resolve([bad, good]);

    expect(evaluation.isResolved(bad)).toBe(false);
    expect(evaluation.isResolved(good)).toBe(true);

    await expect(
      evaluation.linkSeriesResourcesToModel({
        model: new Alert(),
        seriesLabels: bad,
      }),
    ).rejects.toThrow('Invalid ID for "_id" in the query: "not-a-uuid".');

    const alert: Alert = new Alert();
    await evaluation.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: good,
    });
    expect(linkedOn(alert)["hosts"]).toEqual([host._id]);
  });

  test("with no project it reads nothing up front, as the records' own reads never could", async () => {
    seedTables(seededRandom(12), 5);
    const evaluation: SeriesResourcesOfEvaluation =
      new SeriesResourcesOfEvaluation({ projectId: undefined });

    await evaluation.resolve([{ "host.name": "anything" }]);

    expect(totalReads()).toBe(0);
  });
});
