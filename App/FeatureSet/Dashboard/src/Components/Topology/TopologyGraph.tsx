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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ProjectUtil from "Common/UI/Utils/Project";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";

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
  [EntityType.Host]: 1,
  [EntityType.KubernetesNamespace]: 1,
  [EntityType.Service]: 2,
  [EntityType.KubernetesNode]: 2,
  [EntityType.KubernetesDeployment]: 2,
  [EntityType.ServiceInstance]: 3,
  [EntityType.KubernetesPod]: 3,
  [EntityType.Container]: 4,
  [EntityType.Process]: 4,
  [EntityType.TelemetrySdk]: 5,
};
const FALLBACK_LAYER: number = 6;
const X_GAP: number = 240;
const Y_GAP: number = 130;

const TopologyGraph: FunctionComponent = (): ReactElement => {
  const [entities, setEntities] = useState<Array<TelemetryEntity>>([]);
  const [relationships, setRelationships] = useState<
    Array<TelemetryEntityRelationship>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const [entityResult, relResult]: [
          ListResult<TelemetryEntity>,
          ListResult<TelemetryEntityRelationship>,
        ] = await Promise.all([
          ModelAPI.getList<TelemetryEntity>({
            modelType: TelemetryEntity,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
            select: { entityKey: true, displayName: true, entityType: true },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
          ModelAPI.getList<TelemetryEntityRelationship>({
            modelType: TelemetryEntityRelationship,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
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
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node>;
    edges: Array<Edge>;
  } => {
    const entityByKey: Map<string, TelemetryEntity> = new Map<
      string,
      TelemetryEntity
    >();
    for (const entity of entities) {
      if (entity.entityKey) {
        entityByKey.set(entity.entityKey, entity);
      }
    }

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

    const keysByLayer: Map<number, Array<string>> = new Map<
      number,
      Array<string>
    >();
    for (const key of nodeKeys) {
      const entity: TelemetryEntity | undefined = entityByKey.get(key);
      const layer: number =
        entity && entity.entityType
          ? LAYER_BY_TYPE[entity.entityType] ?? FALLBACK_LAYER
          : FALLBACK_LAYER;
      const bucket: Array<string> = keysByLayer.get(layer) || [];
      bucket.push(key);
      keysByLayer.set(layer, bucket);
    }

    const builtNodes: Array<Node> = [];
    for (const [layer, keys] of keysByLayer) {
      keys.forEach((key: string, index: number) => {
        const entity: TelemetryEntity | undefined = entityByKey.get(key);
        const label: string = entity?.displayName || `${key.substring(0, 8)}…`;
        const typeLabel: string = entity?.entityType || "unknown";
        builtNodes.push({
          id: key,
          position: { x: index * X_GAP, y: layer * Y_GAP },
          data: { label: `${label}\n${typeLabel}` },
          style: {
            fontSize: "12px",
            whiteSpace: "pre-line",
            borderColor: "#6366f1",
            width: 180,
          },
        });
      });
    }

    const builtEdges: Array<Edge> = relationships
      .filter((rel: TelemetryEntityRelationship) => {
        return Boolean(rel.fromEntityKey) && Boolean(rel.toEntityKey);
      })
      .map((rel: TelemetryEntityRelationship): Edge => {
        return {
          id: `${rel.fromEntityKey}-${rel.relationshipType}-${rel.toEntityKey}`,
          source: rel.fromEntityKey!,
          target: rel.toEntityKey!,
          label: rel.relationshipType,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "#6366f1" },
        };
      });

    return { nodes: builtNodes, edges: builtEdges };
  }, [entities, relationships]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (nodes.length === 0) {
    return (
      <EmptyState
        id="topology-empty"
        icon={IconProp.FlowDiagram}
        title="No topology discovered yet"
        description="As telemetry carrying multiple entities (e.g. a service running in a k8s pod on a node) is ingested, the inferred relationships — runs-on, member-of, hosted-on, part-of — will appear here as a graph."
      />
    );
  }

  return (
    <Fragment>
      <div style={{ height: "70vh", width: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView={true}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
        >
          <Controls showInteractive={false} />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        </ReactFlow>
      </div>
    </Fragment>
  );
};

export default TopologyGraph;
