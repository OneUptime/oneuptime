import Entities from "../../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import { AggregateColumn } from "../../../../Server/Types/Database/AggregateBy";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import {
  INVENTORY_PLACEMENT_OPTIONS_ORDER,
  INVENTORY_PLACEMENT_OPTIONS_SELECT,
  InventoryPlacementOption,
  getInventoryPlacementOptionsGroupBy,
  readInventoryPlacementOptions,
} from "../../../../Server/Utils/Inventory/InventoryPlacementOptions";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNoneOrNull from "../../../../Types/BaseDatabase/IncludesNoneOrNull";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Query from "../../../../Types/BaseDatabase/Query";
import Search from "../../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  INVENTORY_PLACEMENT_LEVELS,
  INVENTORY_PLACEMENT_LEVEL_COLUMNS,
  InventoryPlacementLevel,
  getInventoryItemPlacementAt,
} from "../../../../Utils/Inventory/InventoryItemPlacement";
import {
  DataSource,
  FindOptionsWhere,
  QueryRunner,
  SelectQueryBuilder,
} from "typeorm";

/*
 * INVENTORY'S CLUSTER, HOST AND DATACENTER FILTERS ON POSTGRES (#11470).
 *
 * The filters are answered by the database: InventoryItem's
 * placementCluster, placementHost and placementDatacenter are the place
 * rule in SQL, so a filtered page, its count and the chip's choices are
 * worked out over every item, never over ids read first - the 10,000 a
 * filter read that way would have held. This runs them on Postgres over a
 * project of more than 10,000 VMs on one ESXi host, beside rows built to
 * sit on every edge of the rule:
 *
 *   - every row's place at every level, in SQL, is the one the list shows
 *     (getInventoryItemPlacementAt), whitespace and odd values too;
 *   - the list query of a chip holds and counts all 10,250 VMs of the host,
 *     and pages past the 10,000th;
 *   - "is not" keeps the items with no place, as every chip's does;
 *   - the chips AND: a cluster of one datacenter, of one type;
 *   - the chip's choices count every item of each place, are narrowed by
 *     what is typed, and never offer an archived item's place on the live
 *     list, or another project's.
 *
 * Opt in with RUN_POSTGRES_INVENTORY_FACET_TESTS=true and config.env
 * loaded, as InventoryStatusPostgres. Tables live in a unique temporary
 * schema; production rows are never read or changed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INVENTORY_FACET_TESTS"] === "true"
    ? describe
    : describe.skip;

const BIG_HOST: string = "esx-node-07.acme.lan";
const BIG_HOST_VMS: number = 10_250;
const SMALL_HOST: string = "esx-node-08.acme.lan";
const SMALL_HOST_VMS: number = 300;
const SOUTH_HOST: string = "esx-node-21.acme.lan";
const SOUTH_HOST_VMS: number = 120;

interface EdgeRow {
  name: string;
  entityType: string;
  identifyingAttributes: JSONObject | null;
  descriptiveAttributes: JSONObject | null;
}

// Each on an edge of the place rule; its expected place is the list's own.
const EDGE_ROWS: Array<EdgeRow> = [
  {
    name: "edge-padded",
    entityType: EntityType.VMwareVirtualMachine,
    identifyingAttributes: null,
    descriptiveAttributes: {
      "vcenter.host.name": `  ${SMALL_HOST}\t`,
      "vcenter.cluster.name": " cluster-alpha　",
      "vcenter.datacenter.name": "\nDC-NORTH\r\n",
    },
  },
  {
    name: "edge-identity-only",
    entityType: EntityType.VMwareVirtualMachine,
    identifyingAttributes: {
      "vcenter.host.name": SMALL_HOST,
      "vcenter.cluster.name": "cluster-alpha",
    },
    descriptiveAttributes: { "vcenter.vm.name": "edge-identity-only" },
  },
  {
    name: "edge-descriptive-wins",
    entityType: EntityType.VMwareHost,
    identifyingAttributes: {
      "vcenter.cluster.name": "cluster-old-spelling",
      "vcenter.datacenter.name": "dc-north",
    },
    descriptiveAttributes: {
      "vcenter.cluster.name": "cluster-alpha",
      "vcenter.datacenter.name": "DC-NORTH",
    },
  },
  {
    name: "edge-blank-falls-back",
    entityType: EntityType.VMwareVirtualMachine,
    identifyingAttributes: { "vcenter.cluster.name": "cluster-beta" },
    descriptiveAttributes: { "vcenter.cluster.name": "   " },
  },
  {
    name: "edge-not-strings",
    entityType: EntityType.VMwareVirtualMachine,
    identifyingAttributes: { "vcenter.host.name": ["esx-x"] },
    descriptiveAttributes: {
      "vcenter.host.name": 42,
      "vcenter.cluster.name": true,
      "vcenter.datacenter.name": { name: "DC-NORTH" },
    },
  },
  {
    name: "edge-zero-width-kept",
    entityType: EntityType.VMwareVirtualMachine,
    identifyingAttributes: null,
    descriptiveAttributes: { "vcenter.host.name": `${SOUTH_HOST}\u200b` },
  },
  {
    name: "edge-host-has-no-host",
    entityType: EntityType.VMwareHost,
    identifyingAttributes: null,
    descriptiveAttributes: { "vcenter.host.name": BIG_HOST },
  },
  {
    name: "edge-kubernetes-pod",
    entityType: EntityType.KubernetesPod,
    identifyingAttributes: {
      "k8s.namespace.name": "payments",
      "k8s.cluster.name": "prod-eu",
    },
    descriptiveAttributes: null,
  },
  {
    name: "edge-proxmox-guest",
    entityType: EntityType.ProxmoxGuest,
    identifyingAttributes: null,
    descriptiveAttributes: { "proxmox.cluster.name": "pve-lab" },
  },
  {
    name: "edge-openstack-instance",
    entityType: EntityType.OpenStackInstance,
    identifyingAttributes: null,
    descriptiveAttributes: {
      "openstack.hypervisor.name": "compute-03",
      "openstack.cloud.name": "prod",
    },
  },
  {
    name: "edge-kubernetes-cluster-root",
    entityType: EntityType.KubernetesCluster,
    identifyingAttributes: { "k8s.cluster.name": "prod-eu" },
    descriptiveAttributes: null,
  },
  {
    name: "edge-service",
    entityType: EntityType.Service,
    identifyingAttributes: { "service.name": "checkout" },
    descriptiveAttributes: { "vcenter.cluster.name": "cluster-alpha" },
  },
  {
    name: "edge-no-attributes",
    entityType: EntityType.VMwareDatastore,
    identifyingAttributes: null,
    descriptiveAttributes: null,
  },
  {
    name: "edge-attributes-not-an-object",
    entityType: EntityType.VMwareDatastore,
    identifyingAttributes: ["vcenter.datacenter.name"] as unknown as JSONObject,
    descriptiveAttributes: "DC-NORTH" as unknown as JSONObject,
  },
];

describePostgres("inventory placement filters against Postgres", () => {
  const schema: string = `inventory_place_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  let database: DataSource;
  let runner: QueryRunner;
  let liveTotal: number = 0;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["INVENTORY_FACET_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["INVENTORY_FACET_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    // The physical columns these queries read; the places never exist on disk.
    await database.query(`CREATE TABLE "${schema}"."InventoryItem" (
      "_id" uuid PRIMARY KEY,
      "projectId" uuid NOT NULL,
      "displayName" varchar NOT NULL,
      "entityType" varchar NOT NULL,
      "source" varchar,
      "identifyingAttributes" jsonb,
      "descriptiveAttributes" jsonb,
      "isArchived" boolean NOT NULL DEFAULT false,
      "deletedAt" timestamptz
    )`);
    runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    await seedVms(projectId, "big", BIG_HOST_VMS, {
      host: BIG_HOST,
      cluster: "cluster-alpha",
      datacenter: "DC-NORTH",
    });
    await seedVms(projectId, "small", SMALL_HOST_VMS, {
      host: SMALL_HOST,
      cluster: "cluster-alpha",
      datacenter: "DC-NORTH",
    });
    await seedVms(projectId, "south", SOUTH_HOST_VMS, {
      host: SOUTH_HOST,
      cluster: "cluster-beta",
      datacenter: "DC-SOUTH",
    });
    for (const host of [BIG_HOST, SMALL_HOST]) {
      await seed(projectId, host, EntityType.VMwareHost, null, {
        "vcenter.cluster.name": "cluster-alpha",
        "vcenter.datacenter.name": "DC-NORTH",
      });
    }
    for (const row of EDGE_ROWS) {
      await seed(
        projectId,
        row.name,
        row.entityType,
        row.identifyingAttributes,
        row.descriptiveAttributes,
      );
    }
    // Off the live list: archived, and another project's.
    await seed(
      projectId,
      "archived-vm",
      EntityType.VMwareVirtualMachine,
      null,
      {
        "vcenter.host.name": "esx-archived.acme.lan",
        "vcenter.cluster.name": "cluster-gone",
        "vcenter.datacenter.name": "DC-GONE",
      },
      true,
    );
    await seed(
      otherProjectId,
      "other-project-vm",
      EntityType.VMwareVirtualMachine,
      null,
      {
        "vcenter.host.name": "esx-other.acme.lan",
        "vcenter.cluster.name": "cluster-other",
        "vcenter.datacenter.name": "DC-OTHER",
      },
    );

    liveTotal =
      BIG_HOST_VMS + SMALL_HOST_VMS + SOUTH_HOST_VMS + 2 + EDGE_ROWS.length;
  }, 120_000);

  afterAll(async () => {
    if (runner) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
    }
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  // Many VMs in one statement: one row per number, each named by it.
  async function seedVms(
    project: ObjectID,
    prefix: string,
    count: number,
    place: { host: string; cluster: string; datacenter: string },
  ): Promise<void> {
    await runner.query(
      `INSERT INTO "${schema}"."InventoryItem" ("_id", "projectId", "displayName", "entityType", "source", "identifyingAttributes", "descriptiveAttributes")
       SELECT gen_random_uuid(), $1, $2 || '-' || lpad(n::text, 5, '0'), $3, $4,
              jsonb_build_object('vcenter.vm.id', $2 || '-' || n::text),
              jsonb_build_object('vcenter.host.name', $5::text, 'vcenter.cluster.name', $6::text, 'vcenter.datacenter.name', $7::text)
       FROM generate_series(1, $8::int) AS n`,
      [
        project.toString(),
        prefix,
        EntityType.VMwareVirtualMachine,
        EntitySource.Discovered,
        place.host,
        place.cluster,
        place.datacenter,
        count,
      ],
    );
  }

  async function seed(
    project: ObjectID,
    name: string,
    entityType: string,
    identifyingAttributes: JSONObject | null,
    descriptiveAttributes: JSONObject | null,
    isArchived: boolean = false,
  ): Promise<void> {
    await runner.query(
      `INSERT INTO "${schema}"."InventoryItem" ("_id", "projectId", "displayName", "entityType", "source", "identifyingAttributes", "descriptiveAttributes", "isArchived") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ObjectID.generate().toString(),
        project.toString(),
        name,
        entityType,
        EntitySource.Discovered,
        identifyingAttributes === null
          ? null
          : JSON.stringify(identifyingAttributes),
        descriptiveAttributes === null
          ? null
          : JSON.stringify(descriptiveAttributes),
        isArchived,
      ],
    );
  }

  function where(
    query: Query<InventoryItem> = {},
    isArchived: boolean = false,
  ): FindOptionsWhere<InventoryItem> {
    return QueryUtil.serializeQuery(InventoryItem, {
      projectId,
      isArchived,
      ...query,
    }) as unknown as FindOptionsWhere<InventoryItem>;
  }

  function place(
    level: InventoryPlacementLevel,
    value: unknown,
  ): Query<InventoryItem> {
    return {
      [INVENTORY_PLACEMENT_LEVEL_COLUMNS[level]]: value,
    } as unknown as Query<InventoryItem>;
  }

  async function count(query: Query<InventoryItem>): Promise<number> {
    return runner.manager.getRepository(InventoryItem).count({
      where: where(query),
    });
  }

  // The chip's choices, in the shape DatabaseService.aggregateBy builds.
  async function options(
    level: InventoryPlacementLevel,
    data: { search?: string; isArchived?: boolean; limit?: number } = {},
  ): Promise<Array<InventoryPlacementOption>> {
    const builder: SelectQueryBuilder<InventoryItem> = runner.manager
      .createQueryBuilder(InventoryItem, "InventoryItem")
      .setFindOptions({
        where: where(
          place(level, data.search ? new Search(data.search) : new NotNull()),
          Boolean(data.isArchived),
        ),
      });
    const columns: Array<AggregateColumn> = [
      ...getInventoryPlacementOptionsGroupBy(level),
      ...INVENTORY_PLACEMENT_OPTIONS_SELECT,
    ];
    builder.select(columns[0]!.expression, columns[0]!.alias);
    for (const column of columns.slice(1)) {
      builder.addSelect(column.expression, column.alias);
    }
    builder.groupBy(getInventoryPlacementOptionsGroupBy(level)[0]!.expression);
    for (const order of INVENTORY_PLACEMENT_OPTIONS_ORDER) {
      builder.addOrderBy(order.expression, "ASC");
    }
    builder.limit(data.limit ?? 50);
    return readInventoryPlacementOptions(await builder.getRawMany());
  }

  test("every edge row's place, at every level, is the one the list shows", async () => {
    const rows: Array<InventoryItem> = await runner.manager
      .getRepository(InventoryItem)
      .find({
        select: {
          _id: true,
          displayName: true,
          entityType: true,
          identifyingAttributes: true,
          descriptiveAttributes: true,
          placementCluster: true,
          placementHost: true,
          placementDatacenter: true,
        },
        where: where({ displayName: new Search("edge-") }),
        order: { displayName: "ASC" },
      });

    expect(rows).toHaveLength(EDGE_ROWS.length);
    for (const row of rows) {
      for (const level of INVENTORY_PLACEMENT_LEVELS) {
        const column: string = INVENTORY_PLACEMENT_LEVEL_COLUMNS[level];
        expect({
          name: row.displayName,
          level,
          place: (row as unknown as Record<string, unknown>)[column] ?? null,
        }).toEqual({
          name: row.displayName,
          level,
          place: getInventoryItemPlacementAt(
            {
              entityType: row.entityType,
              identifyingAttributes: row.identifyingAttributes as
                | Record<string, unknown>
                | undefined,
              descriptiveAttributes: row.descriptiveAttributes as
                | Record<string, unknown>
                | undefined,
            },
            level,
          ),
        });
      }
    }
  });

  test("the edges read as the issue means them", async () => {
    const byName: Map<string, InventoryItem> = new Map(
      (
        await runner.manager.getRepository(InventoryItem).find({
          select: {
            _id: true,
            displayName: true,
            placementCluster: true,
            placementHost: true,
            placementDatacenter: true,
          },
          where: where({ displayName: new Search("edge-") }),
        })
      ).map((row: InventoryItem): [string, InventoryItem] => {
        return [row.displayName!, row];
      }),
    );
    expect(byName.get("edge-padded")?.placementHost).toBe(SMALL_HOST);
    expect(byName.get("edge-padded")?.placementCluster).toBe("cluster-alpha");
    expect(byName.get("edge-padded")?.placementDatacenter).toBe("DC-NORTH");
    expect(byName.get("edge-identity-only")?.placementHost).toBe(SMALL_HOST);
    expect(byName.get("edge-descriptive-wins")?.placementCluster).toBe(
      "cluster-alpha",
    );
    expect(byName.get("edge-blank-falls-back")?.placementCluster).toBe(
      "cluster-beta",
    );
    expect(byName.get("edge-not-strings")?.placementHost ?? null).toBeNull();
    expect(byName.get("edge-zero-width-kept")?.placementHost).toBe(
      `${SOUTH_HOST}\u200b`,
    );
    // A host is in its cluster, but has no host of its own.
    expect(
      byName.get("edge-host-has-no-host")?.placementHost ?? null,
    ).toBeNull();
    expect(byName.get("edge-kubernetes-pod")?.placementCluster).toBe("prod-eu");
    expect(byName.get("edge-proxmox-guest")?.placementCluster).toBe("pve-lab");
    expect(byName.get("edge-openstack-instance")?.placementHost).toBe(
      "compute-03",
    );
    expect(
      byName.get("edge-kubernetes-cluster-root")?.placementCluster ?? null,
    ).toBeNull();
    expect(byName.get("edge-service")?.placementCluster ?? null).toBeNull();
  });

  test("one host's chip holds and counts all of its VMs, past the 10,000th", async () => {
    expect(BIG_HOST_VMS).toBeGreaterThan(10_000);
    expect(
      await count(
        place(InventoryPlacementLevel.Host, new Includes([BIG_HOST])),
      ),
    ).toBe(BIG_HOST_VMS);

    // The last page: rows 10,201 to 10,250 of the host's, in name order.
    const lastPage: Array<InventoryItem> = await runner.manager
      .getRepository(InventoryItem)
      .find({
        select: { _id: true, displayName: true, placementHost: true },
        where: where(
          place(InventoryPlacementLevel.Host, new Includes([BIG_HOST])),
        ),
        order: { displayName: "ASC" },
        skip: 10_200,
        take: 100,
      });
    expect(lastPage).toHaveLength(BIG_HOST_VMS - 10_200);
    expect(lastPage[0]!.displayName).toBe("big-10201");
    expect(lastPage[lastPage.length - 1]!.displayName).toBe("big-10250");
    for (const row of lastPage) {
      expect(row.placementHost).toBe(BIG_HOST);
    }
  });

  test("two hosts chosen are either", async () => {
    expect(
      await count(
        place(
          InventoryPlacementLevel.Host,
          new Includes([BIG_HOST, SMALL_HOST]),
        ),
      ),
    ).toBe(BIG_HOST_VMS + SMALL_HOST_VMS + 2);
  });

  test("a cluster's chip holds its hosts and the VMs on them", async () => {
    // The VMs on both hosts, both hosts, and the edge rows of the cluster.
    expect(
      await count(
        place(InventoryPlacementLevel.Cluster, new Includes(["cluster-alpha"])),
      ),
    ).toBe(BIG_HOST_VMS + SMALL_HOST_VMS + 2 + 3);
    expect(
      await count({
        ...place(
          InventoryPlacementLevel.Cluster,
          new Includes(["cluster-alpha"]),
        ),
        entityType: new Includes([EntityType.VMwareHost]),
      }),
    ).toBe(3);
  });

  test("is not keeps every item with no place there", async () => {
    expect(
      await count(
        place(InventoryPlacementLevel.Host, new IncludesNoneOrNull([BIG_HOST])),
      ),
    ).toBe(liveTotal - BIG_HOST_VMS);
  });

  test("the chips add up: a cluster of one datacenter, of one type", async () => {
    expect(
      await count({
        ...place(
          InventoryPlacementLevel.Cluster,
          new Includes(["cluster-beta"]),
        ),
        ...place(
          InventoryPlacementLevel.Datacenter,
          new Includes(["DC-SOUTH"]),
        ),
        entityType: new Includes([EntityType.VMwareVirtualMachine]),
      }),
    ).toBe(SOUTH_HOST_VMS);
  });

  test("a chip's query as the API receives it filters the same", async () => {
    const serialized: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          ...place(InventoryPlacementLevel.Host, new Includes([BIG_HOST])),
          ...place(
            InventoryPlacementLevel.Datacenter,
            new IncludesNoneOrNull(["DC-SOUTH"]),
          ),
        } as unknown as JSONObject),
      ),
    );
    expect(
      await count(
        JSONFunctions.deserialize(serialized) as Query<InventoryItem>,
      ),
    ).toBe(BIG_HOST_VMS);
  });

  test("the places need no physical column", async () => {
    const columns: Array<{ column_name: string }> = await runner.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'InventoryItem'",
      [schema],
    );
    const names: Array<string> = columns.map(
      (column: { column_name: string }): string => {
        return column.column_name;
      },
    );
    for (const level of INVENTORY_PLACEMENT_LEVELS) {
      expect(names).not.toContain(INVENTORY_PLACEMENT_LEVEL_COLUMNS[level]);
    }
  });

  test("a place no item is in holds nothing", async () => {
    expect(
      await count(
        place(InventoryPlacementLevel.Host, new Includes(["esx-nowhere"])),
      ),
    ).toBe(0);
  });

  test("the host chip offers every host the live items sit on, each counted whole, in name order", async () => {
    expect(await options(InventoryPlacementLevel.Host)).toEqual([
      { value: "compute-03", count: 1 },
      { value: BIG_HOST, count: BIG_HOST_VMS },
      { value: SMALL_HOST, count: SMALL_HOST_VMS + 2 },
      { value: SOUTH_HOST, count: SOUTH_HOST_VMS },
      { value: `${SOUTH_HOST}\u200b`, count: 1 },
    ]);
  });

  test("the cluster and datacenter chips offer theirs, of every product", async () => {
    expect(await options(InventoryPlacementLevel.Cluster)).toEqual([
      { value: "cluster-alpha", count: BIG_HOST_VMS + SMALL_HOST_VMS + 5 },
      { value: "cluster-beta", count: SOUTH_HOST_VMS + 1 },
      { value: "prod-eu", count: 1 },
      { value: "pve-lab", count: 1 },
    ]);
    expect(await options(InventoryPlacementLevel.Datacenter)).toEqual([
      {
        value: "DC-NORTH",
        count: BIG_HOST_VMS + SMALL_HOST_VMS + 2 + 2,
      },
      { value: "DC-SOUTH", count: SOUTH_HOST_VMS },
    ]);
  });

  test("what is typed narrows the choices on the server, in any case", async () => {
    expect(
      await options(InventoryPlacementLevel.Host, { search: "NODE-0" }),
    ).toEqual([
      { value: BIG_HOST, count: BIG_HOST_VMS },
      { value: SMALL_HOST, count: SMALL_HOST_VMS + 2 },
    ]);
    // A wildcard typed is a character to find, not a wildcard.
    expect(
      await options(InventoryPlacementLevel.Host, { search: "%" }),
    ).toEqual([]);
    expect(
      await options(InventoryPlacementLevel.Host, { search: "_" }),
    ).toEqual([]);
  });

  test("a page of choices is a page", async () => {
    expect(await options(InventoryPlacementLevel.Host, { limit: 2 })).toEqual([
      { value: "compute-03", count: 1 },
      { value: BIG_HOST, count: BIG_HOST_VMS },
    ]);
  });

  test("the live list never offers an archived item's place, nor another project's; the Archived list offers its own", async () => {
    const live: Array<string> = (
      await options(InventoryPlacementLevel.Datacenter)
    ).map((option: InventoryPlacementOption): string => {
      return option.value;
    });
    expect(live).not.toContain("DC-GONE");
    expect(live).not.toContain("DC-OTHER");
    expect(
      await options(InventoryPlacementLevel.Datacenter, { isArchived: true }),
    ).toEqual([{ value: "DC-GONE", count: 1 }]);
  });
});
