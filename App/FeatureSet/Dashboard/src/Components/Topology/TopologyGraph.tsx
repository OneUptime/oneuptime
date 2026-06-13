import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  Node,
} from "reactflow";
import "reactflow/dist/style.css";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import EntityType from "Common/Types/Telemetry/EntityType";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ProjectUtil from "Common/UI/Utils/Project";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Link from "Common/UI/Components/Link/Link";
import Input from "Common/UI/Components/Input/Input";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslateValue from "Common/UI/Utils/Translation";

/*
 * Read-only topology / service map: renders the TelemetryEntityRelationship
 * co-occurrence graph (Internal/Docs/OpenTelemetryEntities.md §4). Nodes are
 * entities (resolved to display names from the registry); edges are the
 * inferred directed relationships (runs-on / member-of / hosted-on / ...).
 * Laid out in deterministic layers by entity type (cluster at top, down to
 * containers/processes) since no graph auto-layout library is bundled.
 */

// Entity type → vertical layer (0 = top). Unknowns fall to the bottom layer.
const LAYER_BY_TYPE: Record<EntityType, number> = {
  [EntityType.KubernetesCluster]: 0,
  [EntityType.ProxmoxCluster]: 0,
  [EntityType.CephCluster]: 0,
  [EntityType.Host]: 1,
  [EntityType.KubernetesNamespace]: 1,
  [EntityType.Service]: 2,
  [EntityType.KubernetesNode]: 2,
  [EntityType.KubernetesDeployment]: 2,
  [EntityType.ProxmoxNode]: 2,
  [EntityType.ServiceInstance]: 3,
  [EntityType.KubernetesPod]: 3,
  [EntityType.ProxmoxGuest]: 3,
  [EntityType.Container]: 4,
  [EntityType.Process]: 4,
  [EntityType.TelemetrySdk]: 5,
};
const FALLBACK_LAYER: number = 6;
const X_GAP: number = 240;
const Y_GAP: number = 130;
// Wrap each layer into a grid instead of one infinite horizontal row.
const NODES_PER_ROW: number = 8;
// Extra vertical breathing room between two consecutive layers.
const LAYER_GAP: number = 60;
// Only show entities seen in the last 24h by default — keeps the graph fresh.
const DEFAULT_WINDOW_HOURS: number = 24;

const TopologyGraph: FunctionComponent = (): ReactElement => {
  const { translateString } = useTranslateValue();

  const [entities, setEntities] = useState<Array<TelemetryEntity>>([]);
  const [relationships, setRelationships] = useState<
    Array<TelemetryEntityRelationship>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTruncated, setIsTruncated] = useState<boolean>(false);

  // Entity types explicitly unchecked by the user (default: all visible).
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(
    new Set<string>(),
  );
  const [searchText, setSearchText] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const windowStart: Date = OneUptimeDate.addRemoveHours(
          OneUptimeDate.getCurrentDate(),
          -DEFAULT_WINDOW_HOURS,
        );

        const [entityResult, relResult]: [
          ListResult<TelemetryEntity>,
          ListResult<TelemetryEntityRelationship>,
        ] = await Promise.all([
          ModelAPI.getList<TelemetryEntity>({
            modelType: TelemetryEntity,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              lastSeenAt: new GreaterThanOrEqual<Date>(windowStart),
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
          }),
          ModelAPI.getList<TelemetryEntityRelationship>({
            modelType: TelemetryEntityRelationship,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              lastSeenAt: new GreaterThanOrEqual<Date>(windowStart),
            },
            select: {
              fromEntityKey: true,
              toEntityKey: true,
              relationshipType: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
        ]);

        setEntities(entityResult.data);
        setRelationships(relResult.data);
        setIsTruncated(
          entityResult.count > entityResult.data.length ||
            relResult.count > relResult.data.length,
        );
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const entityByKey: Map<string, TelemetryEntity> = useMemo(() => {
    const map: Map<string, TelemetryEntity> = new Map<
      string,
      TelemetryEntity
    >();
    for (const entity of entities) {
      if (entity.entityKey) {
        map.set(entity.entityKey, entity);
      }
    }
    return map;
  }, [entities]);

  /*
   * Entity types present among graphable nodes — drives the filter
   * checkboxes. Computed before type/search filtering so unchecking a type
   * doesn't make its checkbox disappear.
   */
  const presentTypes: Array<string> = useMemo(() => {
    const types: Set<string> = new Set<string>();
    for (const rel of relationships) {
      for (const key of [rel.fromEntityKey, rel.toEntityKey]) {
        if (!key) {
          continue;
        }
        const entity: TelemetryEntity | undefined = entityByKey.get(key);
        types.add(entity?.entityType || "unknown");
      }
    }
    return Array.from(types).sort();
  }, [relationships, entityByKey]);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node>;
    edges: Array<Edge>;
  } => {
    // Only graph entities that participate in at least one relationship.
    const nodeKeys: Set<string> = new Set<string>();
    for (const rel of relationships) {
      if (rel.fromEntityKey) {
        nodeKeys.add(rel.fromEntityKey);
      }
      if (rel.toEntityKey) {
        nodeKeys.add(rel.toEntityKey);
      }
    }

    // Apply the entity-type checkboxes + the display-name text search.
    const lowerSearch: string = searchText.trim().toLowerCase();
    const visibleKeys: Set<string> = new Set<string>();
    for (const key of nodeKeys) {
      const entity: TelemetryEntity | undefined = entityByKey.get(key);
      const typeLabel: string = entity?.entityType || "unknown";
      if (excludedTypes.has(typeLabel)) {
        continue;
      }
      if (lowerSearch) {
        const label: string = (entity?.displayName || key).toLowerCase();
        if (!label.includes(lowerSearch)) {
          continue;
        }
      }
      visibleKeys.add(key);
    }

    const keysByLayer: Map<number, Array<string>> = new Map<
      number,
      Array<string>
    >();
    for (const key of visibleKeys) {
      const entity: TelemetryEntity | undefined = entityByKey.get(key);
      const layer: number =
        entity && entity.entityType
          ? LAYER_BY_TYPE[entity.entityType] ?? FALLBACK_LAYER
          : FALLBACK_LAYER;
      const bucket: Array<string> = keysByLayer.get(layer) || [];
      bucket.push(key);
      keysByLayer.set(layer, bucket);
    }

    /*
     * Grid layout: each layer wraps into rows of NODES_PER_ROW. Layers are
     * stacked with a cumulative y offset so a layer with many rows pushes
     * the layers below it down instead of overlapping.
     */
    const builtNodes: Array<Node> = [];
    const sortedLayers: Array<number> = Array.from(keysByLayer.keys()).sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );
    let yCursor: number = 0;
    for (const layer of sortedLayers) {
      const keys: Array<string> = keysByLayer.get(layer)!;
      const layerYOffset: number = yCursor;
      keys.forEach((key: string, index: number) => {
        const entity: TelemetryEntity | undefined = entityByKey.get(key);
        const label: string = entity?.displayName || `${key.substring(0, 8)}…`;
        const typeLabel: string = entity?.entityType || "unknown";
        builtNodes.push({
          id: key,
          position: {
            x: (index % NODES_PER_ROW) * X_GAP,
            y: layerYOffset + Math.floor(index / NODES_PER_ROW) * Y_GAP,
          },
          data: {
            label: `${label}\n${typeLabel}`,
            entityId: entity?._id?.toString() || undefined,
          },
          style: {
            fontSize: "12px",
            whiteSpace: "pre-line",
            borderColor: "#6366f1",
            width: 180,
            cursor: "pointer",
          },
        });
      });
      const rows: number = Math.ceil(keys.length / NODES_PER_ROW);
      yCursor = yCursor + rows * Y_GAP + LAYER_GAP;
    }

    const builtEdges: Array<Edge> = relationships
      .filter((rel: TelemetryEntityRelationship) => {
        return (
          Boolean(rel.fromEntityKey) &&
          Boolean(rel.toEntityKey) &&
          visibleKeys.has(rel.fromEntityKey!) &&
          visibleKeys.has(rel.toEntityKey!)
        );
      })
      .map((rel: TelemetryEntityRelationship): Edge => {
        /*
         * depends-on edges are service-to-service call relationships (the
         * service-map seed) rather than infrastructure containment — render
         * them visually distinct (dashed amber, animated).
         */
        const isDependsOn: boolean =
          rel.relationshipType === EntityRelationshipType.DependsOn;
        return {
          id: `${rel.fromEntityKey}-${rel.relationshipType}-${rel.toEntityKey}`,
          source: rel.fromEntityKey!,
          target: rel.toEntityKey!,
          label: rel.relationshipType,
          type: "smoothstep",
          animated: isDependsOn,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isDependsOn ? "#f59e0b" : "#6366f1",
          },
          style: isDependsOn
            ? { stroke: "#f59e0b", strokeDasharray: "6 3" }
            : { stroke: "#6366f1" },
        };
      });

    return { nodes: builtNodes, edges: builtEdges };
  }, [relationships, entityByKey, excludedTypes, searchText]);

  const hasAnyGraphableNode: boolean = useMemo(() => {
    return relationships.some((rel: TelemetryEntityRelationship): boolean => {
      return Boolean(rel.fromEntityKey) || Boolean(rel.toEntityKey);
    });
  }, [relationships]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!hasAnyGraphableNode) {
    return (
      <EmptyState
        id="topology-empty"
        icon={IconProp.FlowDiagram}
        title="No topology discovered yet"
        description="As telemetry carrying multiple entities (e.g. a service running in a k8s pod on a node) is ingested, the inferred relationships — runs-on, member-of, hosted-on, part-of — will appear here as a graph."
        footer={
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
            )}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {translateString(
              "View telemetry setup documentation to send OpenTelemetry data",
            ) || ""}
          </Link>
        }
      />
    );
  }

  return (
    <Fragment>
      <div className="mb-3 bg-white border border-gray-200 rounded-xl shadow-sm p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="md:w-72">
            <Input
              dataTestId="topology-search"
              placeholder={translateString("Search entities by name") || ""}
              value={searchText}
              onChange={(value: string) => {
                setSearchText(value);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {presentTypes.map((typeLabel: string): ReactElement => {
              return (
                <CheckboxElement
                  key={typeLabel}
                  dataTestId={`topology-type-filter-${typeLabel}`}
                  title={typeLabel}
                  value={!excludedTypes.has(typeLabel)}
                  onChange={(checked: boolean) => {
                    setExcludedTypes((prev: Set<string>): Set<string> => {
                      const next: Set<string> = new Set<string>(prev);
                      if (checked) {
                        next.delete(typeLabel);
                      } else {
                        next.add(typeLabel);
                      }
                      return next;
                    });
                  }}
                />
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {translateString(
            "Showing entities and relationships seen in the last 24 hours.",
          ) || ""}
        </p>
      </div>

      {isTruncated && (
        <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
          {translateString(
            "The graph is truncated — showing only the first 10,000 entities and relationships. Use the search and type filters to narrow it down.",
          ) || ""}
        </div>
      )}

      {nodes.length === 0 ? (
        <EmptyState
          id="topology-filtered-empty"
          icon={IconProp.FlowDiagram}
          title="No entities match your filters"
          description="Adjust the search text or re-enable entity types to see the graph."
        />
      ) : (
        <div style={{ height: "70vh", width: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView={true}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            onNodeClick={(_event: React.MouseEvent, node: Node) => {
              const entityId: string | undefined = (
                node.data as { entityId?: string | undefined }
              )?.entityId;
              if (!entityId) {
                return;
              }
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.ENTITIES_VIEW]!,
                  {
                    modelId: new ObjectID(entityId),
                  },
                ),
              );
            }}
          >
            <Controls showInteractive={false} />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
        </div>
      )}
    </Fragment>
  );
};

export default TopologyGraph;
