import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import { useMemo } from "react";

/*
 * Only real OpenTelemetry Services. Deliberately NOT the generic entity
 * resolver's default: callers such as TelemetryCompanionSignalTabs feed
 * these names into `resource.service.name` attribute scoping, and a RUM
 * application or host name there would scope charts to the wrong thing.
 * For display (chips, columns) use useTelemetryEntityNames instead.
 */
const SERVICE_ONLY: Array<ServiceType> = [ServiceType.OpenTelemetry];

/*
 * Resolve a set of Service ids to their `service.name`. Ids that don't
 * resolve (not a Service, deleted, list not yet loaded) are simply absent
 * from the map, so callers fall back to the id string.
 */
const useServiceNames: (
  serviceIds: Array<ObjectID> | undefined,
) => Record<string, string> = (
  serviceIds: Array<ObjectID> | undefined,
): Record<string, string> => {
  const entityNames: TelemetryEntityNameMap = useTelemetryEntityNames(
    serviceIds,
    { entityTypes: SERVICE_ONLY },
  );

  return useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, entity] of Object.entries(entityNames)) {
      if (entity.entityType === ServiceType.OpenTelemetry) {
        map[id] = entity.name;
      }
    }
    return map;
  }, [entityNames]);
};

export default useServiceNames;
