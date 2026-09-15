import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../Project";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "./TelemetryEntityNames";
import React, { useEffect, useMemo, useRef, useState } from "react";

export interface UseTelemetryEntityNamesOptions {
  // id -> ServiceType for ids whose table the caller already knows.
  typeHints?: Record<string, ServiceType | undefined> | undefined;
  // Restrict which tables are consulted (e.g. only real Services).
  entityTypes?: Array<ServiceType> | undefined;
}

export type UseTelemetryEntityNamesFunction = (
  ids: Array<ObjectID | string | null | undefined> | undefined,
  options?: UseTelemetryEntityNamesOptions | undefined,
) => TelemetryEntityNameMap;

/*
 * React wrapper around TelemetryEntityNameResolver: resolves the given
 * telemetry entity ids (Service, RUM application, host, cluster, …) to
 * names for chips, columns and legends. Returns an id -> entity map that
 * starts empty and fills in once the lookup lands; ids that never resolve
 * are simply absent, so callers fall back to their own label.
 */
const useTelemetryEntityNames: UseTelemetryEntityNamesFunction = (
  ids: Array<ObjectID | string | null | undefined> | undefined,
  options?: UseTelemetryEntityNamesOptions | undefined,
): TelemetryEntityNameMap => {
  const [nameMap, setNameMap] = useState<TelemetryEntityNameMap>({});

  // Names are per project: re-resolve when the current project changes.
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";
  /*
   * Project + table restriction the current map was resolved for. Names
   * never carry across either: another project's names are wrong, and a
   * RUM name must not survive into a Service-only lookup.
   */
  const mapScopeRef: React.MutableRefObject<string> = useRef<string>("");

  /*
   * Stable, order-independent keys so an identical id set (re-created as
   * new ObjectID instances every render) does not re-trigger the lookup.
   */
  const idKey: string = useMemo(() => {
    return Array.from(
      new Set(
        (ids || [])
          .map((id: ObjectID | string | null | undefined): string => {
            return id ? id.toString().trim() : "";
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    )
      .sort()
      .join(",");
  }, [ids]);

  const optionsKey: string = useMemo(() => {
    const hints: Array<[string, string]> = Object.entries(
      options?.typeHints || {},
    )
      .filter((entry: [string, ServiceType | undefined]): boolean => {
        return Boolean(entry[1]);
      })
      .map((entry: [string, ServiceType | undefined]): [string, string] => {
        return [entry[0], `${entry[1]}`];
      })
      .sort((a: [string, string], b: [string, string]): number => {
        return a[0].localeCompare(b[0]);
      });
    const types: Array<string> = (options?.entityTypes || [])
      .map((type: ServiceType): string => {
        return `${type}`;
      })
      .sort();
    return JSON.stringify({ hints, types });
  }, [options?.typeHints, options?.entityTypes]);

  const restrictionKey: string = (options?.entityTypes || [])
    .map((type: ServiceType): string => {
      return `${type}`;
    })
    .sort()
    .join(",");
  const scopeKey: string = `${projectId}|${restrictionKey}`;

  useEffect(() => {
    const idList: Array<string> = idKey ? idKey.split(",") : [];
    if (idList.length === 0 || !projectId) {
      setNameMap({});
      return;
    }

    // Drop names from another scope straight away, not when the lookup lands.
    if (mapScopeRef.current && mapScopeRef.current !== scopeKey) {
      mapScopeRef.current = "";
      setNameMap({});
    }

    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const resolved: TelemetryEntityNameMap =
        await TelemetryEntityNameResolver.resolve({
          ids: idList,
          projectId: projectId,
          typeHints: options?.typeHints,
          entityTypes: options?.entityTypes,
        });
      if (isCancelled) {
        return;
      }
      /*
       * Keep a name already on screen for an id that is still requested
       * when this lookup came back without it (a failed refresh after the
       * cache TTL). Ids no longer requested are dropped.
       */
      const isSameScope: boolean = mapScopeRef.current === scopeKey;
      mapScopeRef.current = scopeKey;
      setNameMap((previous: TelemetryEntityNameMap) => {
        const next: TelemetryEntityNameMap = {};
        for (const id of idList) {
          const entity: TelemetryEntityNameMap[string] | undefined =
            resolved[id] || (isSameScope ? previous[id] : undefined);
          if (entity) {
            next[id] = entity;
          }
        }
        return next;
      });
    };

    load().catch(() => {
      // Non-critical: callers fall back to their own label.
    });

    return () => {
      isCancelled = true;
    };
    // idKey / optionsKey are the stable projections of ids / options.
  }, [idKey, optionsKey, projectId, scopeKey]);

  return nameMap;
};

export default useTelemetryEntityNames;
