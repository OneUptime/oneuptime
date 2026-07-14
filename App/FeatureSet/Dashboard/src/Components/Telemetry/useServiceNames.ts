import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useMemo, useState } from "react";

/*
 * Resolve a set of Service ids to their human-readable names for display in
 * read-only scope chips — e.g. the "Service: <name>" chip on the per-service
 * telemetry tabs (Metrics / Logs / Traces / Exceptions).
 *
 * Telemetry is still *filtered* by the service's stable id (primaryEntityId) —
 * that id is the canonical link, not the mutable `service.name`. This hook only
 * maps the id to a friendly label so the chip shows the service name instead of
 * a raw UUID. Ids that don't resolve (deleted service, list not yet loaded) are
 * simply absent from the map, so callers fall back to the id string.
 */
const useServiceNames: (
  serviceIds: Array<ObjectID> | undefined,
) => Record<string, string> = (
  serviceIds: Array<ObjectID> | undefined,
): Record<string, string> => {
  const [serviceNameMap, setServiceNameMap] = useState<Record<string, string>>(
    {},
  );

  /*
   * Stable, order-independent dependency so an identical set of ids (re-created
   * as new ObjectID instances every render) doesn't re-trigger the fetch.
   */
  const idKey: string = useMemo(() => {
    return (serviceIds || [])
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .sort()
      .join(",");
  }, [serviceIds]);

  useEffect(() => {
    const ids: Array<ObjectID> = (serviceIds || []).filter(
      (id: ObjectID): boolean => {
        return Boolean(id && id.toString());
      },
    );
    if (ids.length === 0) {
      setServiceNameMap({});
      return;
    }

    const loadNames: () => Promise<void> = async () => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }
        const result: ListResult<Service> = await ModelAPI.getList({
          modelType: Service,
          query: {
            projectId,
            _id: new Includes(ids),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });
        const map: Record<string, string> = {};
        for (const service of result.data || []) {
          if (service.id && service.name) {
            map[service.id.toString()] = service.name.toString();
          }
        }
        setServiceNameMap(map);
      } catch {
        // Non-critical: the chip falls back to the raw id string.
      }
    };
    void loadNames();
    // idKey is the stable projection of serviceIds; depend on it, not the array.
  }, [idKey]);

  return serviceNameMap;
};

export default useServiceNames;
