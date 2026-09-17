import {
  getEventOverlayScope,
  EventOverlayScope,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/EventOverlayScope";
import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Query from "../../../../Types/BaseDatabase/Query";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import ColumnType from "../../../../Types/Database/ColumnType";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, EntityMetadata, FindOptionsWhere } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * Opt in with RUN_POSTGRES_EVENT_OVERLAY_TESTS=true and config.env loaded.
 * Common Test CI enables this after test-setup.sh starts its Postgres service.
 * The default localhost:5400 endpoint matches docker-compose.dev.yml; set
 * EVENT_OVERLAY_TEST_DATABASE_HOST / EVENT_OVERLAY_TEST_DATABASE_PORT to use
 * another endpoint. Credentials come from DATABASE_USERNAME,
 * DATABASE_PASSWORD and DATABASE_NAME.
 * Uses actual entity/junction metadata and the API query serialization path.
 * Every table and row lives in a unique schema that is dropped afterwards;
 * this suite also runs against an empty Postgres database.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EVENT_OVERLAY_TESTS"] === "true"
    ? describe
    : describe.skip;

interface ResourceRelationDefinition {
  attribute: string;
  relation: string;
}

interface NaturalIdentityDefinition extends ResourceRelationDefinition {
  column: string;
  extra?: Record<string, string> | undefined;
}

interface DescendantIdentityDefinition {
  relation: string;
  parentKey: string;
  childKey: string;
  extra?: Record<string, string> | undefined;
}

const RELATIONS: Array<ResourceRelationDefinition> = [
  { attribute: "monitorId", relation: "monitors" },
  { attribute: "hostId", relation: "hosts" },
  { attribute: "kubernetesClusterId", relation: "kubernetesClusters" },
  { attribute: "kubernetesResourceId", relation: "kubernetesResources" },
  { attribute: "kubernetesContainerId", relation: "kubernetesContainers" },
  { attribute: "dockerHostId", relation: "dockerHosts" },
  { attribute: "podmanHostId", relation: "podmanHosts" },
  { attribute: "proxmoxClusterId", relation: "proxmoxClusters" },
  { attribute: "vmwareVCenterId", relation: "vmwareVCenters" },
  { attribute: "iotFleetId", relation: "iotFleets" },
  { attribute: "dockerSwarmClusterId", relation: "dockerSwarmClusters" },
  { attribute: "cephClusterId", relation: "cephClusters" },
  { attribute: "dockerResourceId", relation: "dockerResources" },
  { attribute: "podmanResourceId", relation: "podmanResources" },
  { attribute: "serviceId", relation: "services" },
  { attribute: "serviceLevelObjectiveId", relation: "serviceLevelObjectives" },
];
const NATURAL_IDENTITIES: Array<NaturalIdentityDefinition> = [
  { attribute: "resource.service.name", relation: "services", column: "name" },
  { attribute: "resource.host.id", relation: "hosts", column: "hostId" },
  {
    attribute: "resource.proxmox.cluster.name",
    relation: "proxmoxClusters",
    column: "name",
  },
  {
    attribute: "resource.vmware.vcenter.name",
    relation: "vmwareVCenters",
    column: "name",
  },
  {
    attribute: "resource.ceph.cluster.name",
    relation: "cephClusters",
    column: "name",
  },
  {
    attribute: "resource.docker.swarm.cluster.name",
    relation: "dockerSwarmClusters",
    column: "name",
  },
  {
    attribute: "resource.iot.fleet.name",
    relation: "iotFleets",
    column: "name",
  },
  {
    attribute: "resource.host.name",
    relation: "hosts",
    column: "hostIdentifier",
  },
  {
    attribute: "resource.k8s.cluster.name",
    relation: "kubernetesClusters",
    column: "clusterIdentifier",
  },
  {
    attribute: "resource.host.name",
    relation: "dockerHosts",
    column: "hostIdentifier",
    extra: { "resource.container.runtime": "docker" },
  },
  {
    attribute: "resource.host.name",
    relation: "podmanHosts",
    column: "hostIdentifier",
    extra: { "resource.container.runtime": "podman" },
  },
];

const DESCENDANT_IDENTITIES: Array<DescendantIdentityDefinition> = [
  ...[
    "vcenter.vm_template.id",
    "vcenter.vm_template.name",
    "vcenter.resource_pool.inventory_path",
  ].map((childKey: string): DescendantIdentityDefinition => {
    return {
      relation: "vmwareVCenters",
      parentKey: "resource.vmware.vcenter.name",
      childKey,
    };
  }),
  {
    relation: "dockerHosts",
    parentKey: "resource.host.name",
    childKey: "container.image.name",
    extra: { "resource.container.runtime": "docker" },
  },
  {
    relation: "services",
    parentKey: "resource.service.name",
    childKey: "service.instance.id",
  },
].flatMap(
  (
    definition: DescendantIdentityDefinition,
  ): Array<DescendantIdentityDefinition> => {
    return [
      definition,
      { ...definition, childKey: `resource.${definition.childKey}` },
    ];
  },
);

function configs(
  attributes: Record<string, string>,
): Array<MetricQueryConfigData> {
  return [
    {
      metricQueryData: {
        filterData: {
          metricName: "latency",
          attributes,
          aggegationType: MetricsAggregationType.Avg,
        },
      },
    },
  ];
}

describePostgres("resource event overlays against Postgres", (): void => {
  const schema: string = `event_overlay_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: string = ObjectID.generate().toString();
  const foreignProjectId: string = ObjectID.generate().toString();
  const selectedId: string = ObjectID.generate().toString();
  const unrelatedId: string = ObjectID.generate().toString();
  const start: Date = new Date("2026-09-01T10:00:00Z");
  const end: Date = new Date("2026-09-01T11:00:00Z");
  const selectedName: string = "checkout-prod";
  let database: DataSource;
  const resourceTables: Set<string> = new Set<string>();
  const junctionTables: Set<string> = new Set<string>();

  beforeAll(async (): Promise<void> => {
    database = new DataSource({
      type: "postgres",
      host: process.env["EVENT_OVERLAY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["EVENT_OVERLAY_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const model of [Incident, Alert]) {
      await database.query(`CREATE TABLE "${schema}"."${model.name}" (
        "_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL,
        "title" text, "createdAt" timestamptz, "deletedAt" timestamptz,
        "monitorId" uuid, "seriesLabels" jsonb
      )`);
      for (const definition of RELATIONS) {
        if (model === Alert && definition.relation === "monitors") {
          continue;
        }
        const relation: RelationMetadata = getRelation(
          model,
          definition.relation,
        );
        const resource: EntityMetadata = relation.inverseEntityMetadata;
        if (!resourceTables.has(resource.tableName)) {
          resourceTables.add(resource.tableName);
          // Natural identity columns use their real names from production metadata.
          const names: Set<string> = new Set(
            resource.columns.map((column: ColumnMetadata): string => {
              return column.databaseName;
            }),
          );
          const columns: Array<string> = [...names].filter(
            (name: string): boolean => {
              return name !== "_id" && name !== "deletedAt";
            },
          );
          await database.query(`CREATE TABLE "${schema}"."${resource.tableName}" (
            "_id" uuid PRIMARY KEY, "deletedAt" timestamptz,
            ${columns
              .map((name: string): string => {
                const column: ColumnMetadata = resource.columns.find(
                  (item: ColumnMetadata): boolean => {
                    return item.databaseName === name;
                  },
                )!;
                return `"${name}" ${column.type === ColumnType.ObjectID ? "uuid" : "text"}`;
              })
              .join(", ")}
          )`);
          const identityColumns: Array<string> = columns.filter(
            (name: string): boolean => {
              return (
                (resource.tableName === "Host" && name === "hostId") ||
                ["name", "hostIdentifier", "clusterIdentifier"].includes(name)
              );
            },
          );
          const identities: Array<[string, string]> = [
            [selectedId, selectedName],
            [unrelatedId, "unrelated-prod"],
          ];
          for (const [id, name] of identities) {
            await database.query(
              `INSERT INTO "${schema}"."${resource.tableName}" ("_id"${identityColumns
                .map((column: string): string => {
                  return `, "${column}"`;
                })
                .join("")}) VALUES ($1${identityColumns
                .map((_: string, index: number): string => {
                  return `, $${index + 2}`;
                })
                .join("")})`,
              [
                id,
                ...identityColumns.map((): string => {
                  return name;
                }),
              ],
            );
          }
        }
        const junction: EntityMetadata = relation.junctionEntityMetadata!;
        if (!junctionTables.has(junction.tableName)) {
          junctionTables.add(junction.tableName);
          await database.query(
            `CREATE TABLE "${schema}"."${junction.tableName}" (${junction.columns
              .map((column: ColumnMetadata): string => {
                return `"${column.databaseName}" uuid NOT NULL`;
              })
              .join(", ")})`,
          );
        }
      }
    }
  });

  afterAll(async (): Promise<void> => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async (): Promise<void> => {
    await database.query(
      `TRUNCATE ${["Incident", "Alert", ...junctionTables]
        .map((table: string): string => {
          return `"${schema}"."${table}"`;
        })
        .join(", ")}`,
    );
  });

  function getRelation(
    model: typeof Incident | typeof Alert,
    field: string,
  ): RelationMetadata {
    const relation: RelationMetadata | undefined = database
      .getMetadata(model)
      .relations.find((item: RelationMetadata): boolean => {
        return item.propertyName === field;
      });
    if (!relation) {
      throw new Error(`Missing ${model.name}.${field} relation`);
    }
    return relation;
  }

  async function seed(
    model: typeof Incident | typeof Alert,
    relationName: string,
    title: string,
    resourceId: string,
    options: { projectId?: string; time?: Date; deleted?: boolean } = {},
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "${schema}"."${model.name}" ("_id", "projectId", "title", "createdAt", "deletedAt", "monitorId") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        options.projectId || projectId,
        title,
        options.time || new Date("2026-09-01T10:10:00Z"),
        options.deleted ? start : null,
        model === Alert && relationName === "monitors" ? resourceId : null,
      ],
    );
    if (model === Alert && relationName === "monitors") {
      return id;
    }
    const relation: RelationMetadata = getRelation(model, relationName);
    await database.query(
      `INSERT INTO "${schema}"."${relation.junctionEntityMetadata!.tableName}" ("${relation.joinColumns[0]!.databaseName}", "${relation.inverseJoinColumns[0]!.databaseName}") VALUES ($1, $2)`,
      [id, resourceId],
    );
    return id;
  }

  async function findTitles(
    model: typeof Incident | typeof Alert,
    scope: EventOverlayScope,
  ): Promise<Array<string>> {
    const fragments: Array<Query<Incident> | Query<Alert>> =
      model === Incident ? scope.incidentQueries : scope.alertQueries;
    const titles: Set<string> = new Set<string>();
    for (const fragment of fragments) {
      const payload: JSONObject = JSON.parse(
        JSON.stringify(
          JSONFunctions.serialize({
            ...fragment,
            projectId: new ObjectID(projectId),
            createdAt: new InBetween<Date>(start, end),
          } as JSONObject),
        ),
      );
      const query: Query<Incident> = JSONFunctions.deserialize(
        payload,
      ) as Query<Incident>;
      const where: Query<Incident> = QueryUtil.serializeQuery(model, query);
      const events: Array<Incident | Alert> = await database
        .getRepository<Incident>(model)
        .find({
          select: { _id: true, title: true, createdAt: true },
          where: where as unknown as FindOptionsWhere<Incident>,
          order: { createdAt: "DESC" },
          take: 50,
          loadEagerRelations: false,
        });
      events.forEach((event: Incident | Alert): void => {
        titles.add(event.title!);
      });
    }
    return [...titles].sort();
  }

  describe.each([
    ["Incident", Incident],
    ["Alert", Alert],
  ] as const)(
    "%s",
    (_name: string, model: typeof Incident | typeof Alert): void => {
      test.each(RELATIONS)(
        "$attribute excludes unrelated, foreign-project, deleted and out-of-window events before limit",
        async ({
          attribute,
          relation,
        }: ResourceRelationDefinition): Promise<void> => {
          await seed(model, relation, "selected", selectedId);
          await seed(model, relation, "foreign", selectedId, {
            projectId: foreignProjectId,
          });
          await seed(model, relation, "deleted", selectedId, { deleted: true });
          await seed(model, relation, "before", selectedId, {
            time: new Date(start.getTime() - 1),
          });
          await seed(model, relation, "after", selectedId, {
            time: new Date(end.getTime() + 1),
          });
          for (let index: number = 0; index < 60; index++) {
            await seed(model, relation, `unrelated-${index}`, unrelatedId, {
              time: new Date("2026-09-01T10:30:00Z"),
            });
          }
          expect(
            await findTitles(
              model,
              getEventOverlayScope(configs({ [attribute]: selectedId })),
            ),
          ).toEqual(["selected"]);
          expect(
            (
              await findTitles(
                model,
                getEventOverlayScope(configs({ [attribute]: unrelatedId })),
              )
            ).length,
          ).toBe(50);
        },
      );

      test.each(NATURAL_IDENTITIES)(
        "$relation natural identity is filtered through real joins",
        async ({
          attribute,
          relation,
          extra,
        }: NaturalIdentityDefinition): Promise<void> => {
          await seed(model, relation, "selected", selectedId);
          await seed(model, relation, "unrelated", unrelatedId);
          expect(
            await findTitles(
              model,
              getEventOverlayScope(
                configs({ ...extra, [attribute]: selectedName }),
              ),
            ),
          ).toEqual(["selected"]);
        },
      );

      test("pod scope matches child-only links and excludes same-named pods in another cluster", async (): Promise<void> => {
        await database.query(
          `UPDATE "${schema}"."KubernetesResource" SET "name" = 'checkout', "kind" = 'Pod', "namespaceKey" = 'prod', "kubernetesClusterId" = "_id"`,
        );
        await seed(model, "kubernetesResources", "selected pod", selectedId);
        await seed(model, "kubernetesResources", "unrelated pod", unrelatedId);
        expect(
          await findTitles(
            model,
            getEventOverlayScope(
              configs({
                "resource.k8s.cluster.name": selectedName,
                "resource.k8s.namespace.name": "prod",
                "resource.k8s.pod.name": "checkout",
              }),
            ),
          ),
        ).toEqual(["selected pod"]);
      });

      test("Kubernetes container scope keeps cluster, namespace and pod on the same container", async (): Promise<void> => {
        await database.query(
          `UPDATE "${schema}"."KubernetesContainer" SET "name" = 'app', "podNamespaceKey" = 'prod', "podName" = 'checkout', "kubernetesClusterId" = "_id"`,
        );
        await seed(
          model,
          "kubernetesContainers",
          "selected container",
          selectedId,
        );
        await seed(
          model,
          "kubernetesContainers",
          "unrelated container",
          unrelatedId,
        );
        expect(
          await findTitles(
            model,
            getEventOverlayScope(
              configs({
                "resource.k8s.cluster.name": selectedName,
                "resource.k8s.namespace.name": "prod",
                "resource.k8s.pod.name": "checkout",
                "resource.k8s.container.name": "app",
              }),
            ),
          ),
        ).toEqual(["selected container"]);
      });

      test.each(["Docker", "Podman"])(
        "%s container scope matches its owning host without requiring a separate event-host link",
        async (runtime: string): Promise<void> => {
          const table: string = `${runtime}Resource`;
          const parentKey: string = `${runtime.toLowerCase()}HostId`;
          await database.query(
            `UPDATE "${schema}"."${table}" SET "name" = 'app', "kind" = 'Container', "${parentKey}" = "_id"`,
          );
          const relation: string = `${runtime.toLowerCase()}Resources`;
          await seed(model, relation, "selected container", selectedId);
          await seed(model, relation, "unrelated container", unrelatedId);
          expect(
            await findTitles(
              model,
              getEventOverlayScope(
                configs({
                  "resource.host.name": selectedName,
                  "resource.container.runtime": runtime.toLowerCase(),
                  "resource.container.name": "app",
                }),
              ),
            ),
          ).toEqual(["selected container"]);
        },
      );

      test.each(DESCENDANT_IDENTITIES)(
        "$childKey excludes siblings and same-named children of other parents",
        async ({
          relation,
          parentKey,
          childKey,
          extra,
        }: DescendantIdentityDefinition): Promise<void> => {
          const selected: string = await seed(
            model,
            relation,
            "selected child",
            selectedId,
          );
          const sibling: string = await seed(
            model,
            relation,
            "sibling",
            selectedId,
          );
          const otherParent: string = await seed(
            model,
            relation,
            "other parent",
            unrelatedId,
          );
          await seed(model, relation, "parent only", selectedId);
          const rows: Array<[string, string]> = [
            [selected, "selected-child"],
            [sibling, "sibling-child"],
            [otherParent, "selected-child"],
          ];
          for (const [eventId, childId] of rows) {
            await database.query(
              `UPDATE "${schema}"."${model.name}" SET "seriesLabels" = $1 WHERE "_id" = $2`,
              [
                JSON.stringify({ [childKey]: childId, extra: "retained" }),
                eventId,
              ],
            );
          }
          expect(
            await findTitles(
              model,
              getEventOverlayScope(
                configs({
                  [parentKey]: selectedName,
                  [childKey]: "selected-child",
                  ...extra,
                }),
              ),
            ),
          ).toEqual(["selected child"]);
        },
      );

      test("descendant series scope matches labels even when the event includes additional labels", async (): Promise<void> => {
        const selected: string = await seed(
          model,
          "proxmoxClusters",
          "selected VM",
          selectedId,
        );
        const unrelated: string = await seed(
          model,
          "proxmoxClusters",
          "unrelated VM",
          selectedId,
        );
        for (const [eventId, vmId] of [
          [selected, "vm/100"],
          [unrelated, "vm/200"],
        ]) {
          await database.query(
            `UPDATE "${schema}"."${model.name}" SET "seriesLabels" = $1 WHERE "_id" = $2`,
            [
              JSON.stringify({ id: vmId, node: "pve-1", extra: "retained" }),
              eventId,
            ],
          );
        }
        expect(
          await findTitles(
            model,
            getEventOverlayScope(
              configs({
                "resource.proxmox.cluster.name": selectedName,
                id: "vm/100",
              }),
            ),
          ),
        ).toEqual(["selected VM"]);
      });
    },
  );
});
