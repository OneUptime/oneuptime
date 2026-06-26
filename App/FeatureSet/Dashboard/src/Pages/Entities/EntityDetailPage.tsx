import PageComponentProps from "../PageComponentProps";
import TracesViewer from "../../Components/Traces/TracesViewer";
import LogsViewer from "../../Components/Logs/LogsViewer";
import MetricsViewer from "../../Components/Metrics/MetricsViewer";
import ExceptionsTable from "../../Components/Exceptions/ExceptionsTable";
import ProfileTable from "../../Components/Profiles/ProfileTable";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import Page from "Common/UI/Components/Page/Page";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import EntityType from "Common/Types/Telemetry/EntityType";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import Service from "Common/Models/DatabaseModels/Service";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/**
 * Entity detail — the cross-cutting "everything about this entity" view.
 * Beyond metadata + its relationships, it surfaces the entity's telemetry
 * via the `entityKeys` membership read (`hasAny(entityKeys, [key])`), so you
 * see e.g. every span that touched a k8s pod — even spans primarily owned by
 * a service. This is the payoff of the entity model's read path.
 */

interface RelationshipRow {
  direction: "outgoing" | "incoming";
  relationshipType: string;
  otherEntityKey: string;
  lastSeenAt?: Date | undefined;
}

interface TypedRowLink {
  route: Route;
  label: string;
}

/*
 * Cheap interim cross-link to the rich typed detail page: resolve by natural
 * identity (the same identity the entity key is hashed from) instead of the
 * registry's (resourceType, resourceId) pointer, which is not populated yet.
 */
async function resolveTypedRowLink(
  entity: TelemetryEntity,
): Promise<TypedRowLink | null> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId) {
    return null;
  }

  const identifying: JSONObject = (entity.identifyingAttributes ||
    {}) as JSONObject;

  try {
    if (entity.entityType === EntityType.Service) {
      const name: string | undefined =
        (identifying["service.name"] as string | undefined) ||
        entity.displayName;
      if (!name) {
        return null;
      }
      const result: ListResult<Service> = await ModelAPI.getList<Service>({
        modelType: Service,
        query: { projectId, name },
        select: { _id: true },
        sort: {},
        skip: 0,
        limit: 1,
      });
      const id: string | undefined = result.data[0]?._id;
      if (!id) {
        return null;
      }
      return {
        route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICE_VIEW]!, {
          modelId: new ObjectID(id),
        }),
        label: "View Service",
      };
    }

    if (entity.entityType === EntityType.Host) {
      const hostIdentifier: string | undefined =
        (identifying["host.name"] as string | undefined) || entity.displayName;
      if (!hostIdentifier) {
        return null;
      }
      const result: ListResult<Host> = await ModelAPI.getList<Host>({
        modelType: Host,
        query: { projectId, hostIdentifier },
        select: { _id: true },
        sort: {},
        skip: 0,
        limit: 1,
      });
      const id: string | undefined = result.data[0]?._id;
      if (!id) {
        return null;
      }
      return {
        route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOST_VIEW]!, {
          modelId: new ObjectID(id),
        }),
        label: "View Host",
      };
    }

    if (entity.entityType === EntityType.KubernetesCluster) {
      const clusterIdentifier: string | undefined =
        (identifying["k8s.cluster.name"] as string | undefined) ||
        entity.displayName;
      if (!clusterIdentifier) {
        return null;
      }
      const result: ListResult<KubernetesCluster> =
        await ModelAPI.getList<KubernetesCluster>({
          modelType: KubernetesCluster,
          query: { projectId, clusterIdentifier },
          select: { _id: true },
          sort: {},
          skip: 0,
          limit: 1,
        });
      const id: string | undefined = result.data[0]?._id;
      if (!id) {
        return null;
      }
      return {
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW]!,
          {
            modelId: new ObjectID(id),
          },
        ),
        label: "View Cluster",
      };
    }
  } catch {
    // Cross-link is best-effort — skip silently when resolution fails.
  }

  return null;
}

const EntityDetailPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const { translateString } = useTranslateValue();

  const [entity, setEntity] = useState<TelemetryEntity | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [relationshipRows, setRelationshipRows] = useState<
    Array<RelationshipRow>
  >([]);
  const [relatedEntityByKey, setRelatedEntityByKey] = useState<
    Record<string, TelemetryEntity>
  >({});
  const [relationshipsLoading, setRelationshipsLoading] =
    useState<boolean>(true);

  const [typedRowLink, setTypedRowLink] = useState<TypedRowLink | null>(null);

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const item: TelemetryEntity | null =
          await ModelAPI.getItem<TelemetryEntity>({
            modelType: TelemetryEntity,
            id: modelId,
            select: {
              entityType: true,
              displayName: true,
              entityKey: true,
              identifyingAttributes: true,
              descriptiveAttributes: true,
              firstSeenAt: true,
              lastSeenAt: true,
            },
          });
        setEntity(item);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  /*
   * Relationships are queried in BOTH directions (this entity as the edge
   * source and as the edge target) and every other-end key is batch-resolved
   * to its registry row so rows render display names, not 16-hex hashes.
   */
  useEffect(() => {
    if (!entity || !entity.entityKey) {
      return;
    }
    const entityKey: string = entity.entityKey;

    const loadRelationships: () => Promise<void> = async (): Promise<void> => {
      setRelationshipsLoading(true);
      try {
        const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
        const [outgoingResult, incomingResult]: [
          ListResult<TelemetryEntityRelationship>,
          ListResult<TelemetryEntityRelationship>,
        ] = await Promise.all([
          ModelAPI.getList<TelemetryEntityRelationship>({
            modelType: TelemetryEntityRelationship,
            query: { projectId, fromEntityKey: entityKey },
            select: {
              fromEntityKey: true,
              toEntityKey: true,
              relationshipType: true,
              lastSeenAt: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
          ModelAPI.getList<TelemetryEntityRelationship>({
            modelType: TelemetryEntityRelationship,
            query: { projectId, toEntityKey: entityKey },
            select: {
              fromEntityKey: true,
              toEntityKey: true,
              relationshipType: true,
              lastSeenAt: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
        ]);

        const rows: Array<RelationshipRow> = [];
        for (const rel of outgoingResult.data) {
          if (!rel.toEntityKey) {
            continue;
          }
          rows.push({
            direction: "outgoing",
            relationshipType: rel.relationshipType || "",
            otherEntityKey: rel.toEntityKey,
            lastSeenAt: rel.lastSeenAt,
          });
        }
        for (const rel of incomingResult.data) {
          if (!rel.fromEntityKey) {
            continue;
          }
          rows.push({
            direction: "incoming",
            relationshipType: rel.relationshipType || "",
            otherEntityKey: rel.fromEntityKey,
            lastSeenAt: rel.lastSeenAt,
          });
        }

        // Batch-resolve every other-end key to its TelemetryEntity row.
        const otherKeys: Array<string> = Array.from(
          new Set(
            rows.map((row: RelationshipRow): string => {
              return row.otherEntityKey;
            }),
          ),
        );

        const resolved: Record<string, TelemetryEntity> = {};
        if (otherKeys.length > 0) {
          const entitiesResult: ListResult<TelemetryEntity> =
            await ModelAPI.getList<TelemetryEntity>({
              modelType: TelemetryEntity,
              query: {
                projectId,
                entityKey: new Includes(otherKeys),
              },
              select: {
                _id: true,
                entityKey: true,
                displayName: true,
                entityType: true,
              },
              sort: {},
              skip: 0,
              limit: LIMIT_PER_PROJECT,
            });
          for (const related of entitiesResult.data) {
            if (related.entityKey) {
              resolved[related.entityKey] = related;
            }
          }
        }

        setRelationshipRows(rows);
        setRelatedEntityByKey(resolved);
      } catch {
        // Relationships are non-critical to the page — degrade silently.
        setRelationshipRows([]);
        setRelatedEntityByKey({});
      } finally {
        setRelationshipsLoading(false);
      }
    };

    const loadTypedRowLink: () => Promise<void> = async (): Promise<void> => {
      const link: TypedRowLink | null = await resolveTypedRowLink(entity);
      setTypedRowLink(link);
    };

    void loadRelationships();
    void loadTypedRowLink();
  }, [entity]);

  if (isLoading) {
    return (
      <Page title="Entity" breadcrumbLinks={[]}>
        <ComponentLoader />
      </Page>
    );
  }

  if (error || !entity || !entity.entityKey) {
    return (
      <Page title="Entity" breadcrumbLinks={[]}>
        <ErrorMessage message={error || "Entity not found."} />
      </Page>
    );
  }

  const entityKey: string = entity.entityKey;

  const identifyingAttributes: JSONObject = (entity.identifyingAttributes ||
    {}) as JSONObject;
  const descriptiveAttributes: JSONObject = (entity.descriptiveAttributes ||
    {}) as JSONObject;

  type RenderAttributeRowsFunction = (attributes: JSONObject) => ReactElement;
  const renderAttributeRows: RenderAttributeRowsFunction = (
    attributes: JSONObject,
  ): ReactElement => {
    return (
      <dl className="divide-y divide-gray-100">
        {Object.keys(attributes)
          .sort()
          .map((key: string): ReactElement => {
            return (
              <div
                key={key}
                className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-1"
              >
                <dt className="text-sm font-medium text-gray-500 break-all">
                  {key}
                </dt>
                <dd className="text-sm text-gray-900 sm:col-span-2 break-all">
                  {String(attributes[key])}
                </dd>
              </div>
            );
          })}
      </dl>
    );
  };

  const directionLabel: Record<RelationshipRow["direction"], string> = {
    outgoing: translateString("Outgoing") || "Outgoing",
    incoming: translateString("Incoming") || "Incoming",
  };

  return (
    <Page title={entity.displayName || "Entity"} breadcrumbLinks={[]}>
      <Fragment>
        <Card
          title={entity.displayName || entityKey}
          description={entity.entityType || "unknown"}
          rightElement={
            typedRowLink ? (
              <Link
                to={typedRowLink.route}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                {translateString(typedRowLink.label) || typedRowLink.label}
              </Link>
            ) : undefined
          }
        >
          <dl className="divide-y divide-gray-100">
            <div className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-1">
              <dt className="text-sm font-medium text-gray-500">
                {translateString("Entity Type") || ""}
              </dt>
              <dd className="text-sm text-gray-900 sm:col-span-2">
                {entity.entityType || "unknown"}
              </dd>
            </div>
            <div className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-1">
              <dt className="text-sm font-medium text-gray-500">
                {translateString("Entity Key") || ""}
              </dt>
              <dd className="text-sm text-gray-900 sm:col-span-2 font-mono break-all">
                {entityKey}
              </dd>
            </div>
            {entity.firstSeenAt && (
              <div className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-1">
                <dt className="text-sm font-medium text-gray-500">
                  {translateString("First Seen") || ""}
                </dt>
                <dd className="text-sm text-gray-900 sm:col-span-2">
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    entity.firstSeenAt,
                  )}
                </dd>
              </div>
            )}
            {entity.lastSeenAt && (
              <div className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-1">
                <dt className="text-sm font-medium text-gray-500">
                  {translateString("Last Seen") || ""}
                </dt>
                <dd className="text-sm text-gray-900 sm:col-span-2">
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    entity.lastSeenAt,
                  )}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        {(Object.keys(identifyingAttributes).length > 0 ||
          Object.keys(descriptiveAttributes).length > 0) && (
          <Card
            title="Identifying Attributes"
            description="The immutable attribute set this entity's identity (and key) is derived from. Descriptive attributes are mutable metadata and never part of the identity."
          >
            <div>
              {Object.keys(identifyingAttributes).length > 0 &&
                renderAttributeRows(identifyingAttributes)}
              {Object.keys(descriptiveAttributes).length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {translateString("Descriptive Attributes") || ""}
                  </h3>
                  {renderAttributeRows(descriptiveAttributes)}
                </div>
              )}
            </div>
          </Card>
        )}

        <Card
          title="Relationships"
          description="How this entity relates to others (runs-on, member-of, hosted-on, part-of, depends-on), inferred from telemetry co-occurrence. Both directions are shown."
        >
          {relationshipsLoading ? (
            <ComponentLoader />
          ) : relationshipRows.length === 0 ? (
            <p className="text-sm text-gray-500">
              {translateString(
                "No relationships discovered for this entity yet.",
              ) || ""}
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              <div className="py-2 grid grid-cols-4 gap-2 text-xs font-semibold text-gray-500 uppercase">
                <div>{translateString("Direction") || ""}</div>
                <div>{translateString("Relationship") || ""}</div>
                <div>{translateString("Entity") || ""}</div>
                <div>{translateString("Last Seen") || ""}</div>
              </div>
              {relationshipRows.map(
                (row: RelationshipRow, index: number): ReactElement => {
                  const related: TelemetryEntity | undefined =
                    relatedEntityByKey[row.otherEntityKey];
                  const relatedLabel: string =
                    related?.displayName ||
                    `${row.otherEntityKey.substring(0, 16)}`;
                  return (
                    <div
                      key={`${row.direction}-${row.relationshipType}-${row.otherEntityKey}-${index}`}
                      className="py-2 grid grid-cols-4 gap-2 items-center"
                    >
                      <div>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.direction === "outgoing"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {directionLabel[row.direction]}
                        </span>
                      </div>
                      <div className="text-sm text-gray-700">
                        {row.relationshipType}
                      </div>
                      <div className="text-sm">
                        {related?._id ? (
                          <Link
                            to={RouteUtil.populateRouteParams(
                              RouteMap[PageMap.ENTITIES_VIEW]!,
                              { modelId: new ObjectID(related._id) },
                            )}
                            className="font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            {relatedLabel}
                          </Link>
                        ) : (
                          <span className="font-mono text-gray-700">
                            {relatedLabel}
                          </span>
                        )}
                        {related?.entityType && (
                          <span className="ml-2 text-xs text-gray-400">
                            {related.entityType}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {row.lastSeenAt
                          ? OneUptimeDate.getDateAsLocalFormattedString(
                              row.lastSeenAt,
                            )
                          : "-"}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </Card>

        <Card
          title="Telemetry"
          description="All telemetry that belongs to this entity — found via entityKeys membership, so it includes signals primarily owned by other entities (e.g. a service-owned span that ran on this host/pod)."
        />
        <Tabs
          onTabChange={() => {
            // no-op: each tab self-fetches on render
          }}
          tabs={
            [
              {
                name: "Traces",
                children: <TracesViewer entityKeysFilter={[entityKey]} />,
              },
              {
                name: "Logs",
                children: (
                  <LogsViewer
                    id="entity-logs"
                    logQuery={
                      {
                        entityKeys: new Includes([entityKey]),
                      } as Query<Log>
                    }
                  />
                ),
              },
              {
                name: "Metrics",
                children: <MetricsViewer entityKeysFilter={[entityKey]} />,
              },
              {
                name: "Exceptions",
                children: (
                  <ExceptionsTable
                    query={{}}
                    title="Exceptions"
                    description="Exception groups whose instances belong to this entity (matched via entityKeys membership)."
                    entityKeys={[entityKey]}
                  />
                ),
              },
              {
                name: "Profiles",
                children: <ProfileTable entityKeys={[entityKey]} />,
              },
            ] as Array<Tab>
          }
        />
      </Fragment>
    </Page>
  );
};

export default EntityDetailPage;
