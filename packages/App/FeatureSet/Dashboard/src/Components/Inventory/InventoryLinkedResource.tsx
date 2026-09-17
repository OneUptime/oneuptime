import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";
import Host from "Common/Models/DatabaseModels/Host";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { JSONObject } from "Common/Types/JSON";
import useInventoryItem, { UseInventoryItemResult } from "./useInventoryItem";
import {
  LinkedResource,
  LinkedResourceKind,
  describeMissingLink,
  getLinkedResourceKindForEntityType,
} from "./LinkedResource";
import EntityType from "Common/Types/Telemetry/EntityType";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The shared body of an inventory item's Incidents / Alerts / Maintenance
 * tabs.
 *
 * Each of those pages differs only in which table it renders, so the whole of
 * the interesting part — resolve the item, resolve the typed row it points
 * at, and say something useful when there is not one — lives here once.
 *
 * The empty state is the point of the component. An item with no typed row
 * genuinely has no incidents, and an empty table would read as "nothing is
 * wrong" when the truth is "you are looking in the wrong place".
 */

export interface ComponentProps {
  modelId: ObjectID;
  /** Plural noun for this page: "incidents", "alerts", "maintenance windows". */
  signal: string;
  children: (resource: LinkedResource) => ReactElement;
}

type ResolveFunction = (
  item: InventoryItem,
  kind: LinkedResourceKind,
) => Promise<ObjectID | null>;

/*
 * The registry stamps `(resourceType, resourceId)` at reconcile time, so use
 * it when present. Rows written before that existed — and host / cluster rows,
 * which never carried it — fall back to the natural identity the entity key
 * was hashed from.
 */
const resolveResourceId: ResolveFunction = async (
  item: InventoryItem,
  kind: LinkedResourceKind,
): Promise<ObjectID | null> => {
  if (item.resourceType === kind && item.resourceId) {
    return new ObjectID(item.resourceId.toString());
  }

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return null;
  }

  const identifying: JSONObject = (item.identifyingAttributes ||
    {}) as JSONObject;

  if (kind === LinkedResourceKind.Service) {
    const name: string | undefined =
      (identifying["service.name"] as string | undefined) || item.displayName;

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

    return id ? new ObjectID(id) : null;
  }

  if (kind === LinkedResourceKind.Host) {
    const hostIdentifier: string | undefined =
      (identifying["host.name"] as string | undefined) || item.displayName;

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

    return id ? new ObjectID(id) : null;
  }

  const clusterIdentifier: string | undefined =
    (identifying["k8s.cluster.name"] as string | undefined) || item.displayName;

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

  return id ? new ObjectID(id) : null;
};

const InventoryLinkedResource: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { item, isLoading, error }: UseInventoryItemResult = useInventoryItem(
    props.modelId,
  );

  const [resource, setResource] = useState<LinkedResource | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(true);

  useEffect(() => {
    if (!item) {
      return;
    }

    let isCancelled: boolean = false;

    const resolve: () => Promise<void> = async (): Promise<void> => {
      setIsResolving(true);

      const kind: LinkedResourceKind | null =
        getLinkedResourceKindForEntityType(item.entityType);

      if (!kind) {
        if (!isCancelled) {
          setResource(null);
          setIsResolving(false);
        }

        return;
      }

      try {
        const id: ObjectID | null = await resolveResourceId(item, kind);

        if (!isCancelled) {
          setResource(id ? { kind, id } : null);
        }
      } catch {
        // Resolution is best-effort; the empty state covers a failure.
        if (!isCancelled) {
          setResource(null);
        }
      }

      if (!isCancelled) {
        setIsResolving(false);
      }
    };

    void resolve();

    return () => {
      isCancelled = true;
    };
  }, [item]);

  if (isLoading || isResolving) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!item) {
    return <ErrorMessage message="This inventory item could not be found." />;
  }

  if (!resource) {
    /*
     * Two different reasons land here and they deserve different sentences:
     * a pod can never have its own incidents, whereas a service that we
     * simply failed to resolve might.
     */
    const canEverLink: boolean = Boolean(
      getLinkedResourceKindForEntityType(item.entityType),
    );

    return (
      <EmptyState
        id="inventory-linked-resource-empty-state"
        icon={IconProp.Alert}
        showSolidBackground={true}
        title={`No ${props.signal} for this item`}
        description={
          canEverLink
            ? `This item looks like a ${
                item.entityType === EntityType.Service ? "service" : "resource"
              } OneUptime monitors, but no matching record was found, so there are no ${
                props.signal
              } to show.`
            : describeMissingLink(item.entityType, props.signal)
        }
      />
    );
  }

  return props.children(resource);
};

export default InventoryLinkedResource;
