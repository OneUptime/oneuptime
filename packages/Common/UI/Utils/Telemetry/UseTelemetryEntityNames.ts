import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../Project";
import { Translator } from "../TranslateTemplate";
import useTranslator from "../UseTranslator";
import TelemetryEntityNameResolver, {
  TelemetryEntityLookupResult,
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
 * What a page knows of the entities its chips name: their names, and the
 * ids every read settled as naming nothing the reader may see - deleted
 * since a link or a saved view named them, or out of their reach (#11213).
 * An id is in `notFound` only once its lookup has answered from every table
 * it was asked of: never while that lookup is in flight, never when a
 * table failed to answer.
 */
export interface TelemetryEntityLookup {
  names: TelemetryEntityNameMap;
  notFound: ReadonlySet<string>;
}

export type UseTelemetryEntityLookupFunction = (
  ids: Array<ObjectID | string | null | undefined> | undefined,
  options?: UseTelemetryEntityNamesOptions | undefined,
) => TelemetryEntityLookup;

const NOTHING_NOT_FOUND: ReadonlySet<string> = new Set<string>();

/*
 * React wrapper around TelemetryEntityNameResolver: resolves the given
 * telemetry entity ids (Service, RUM application, host, cluster, …) to
 * names for chips, columns and legends. Returns an id -> entity map that
 * starts empty and fills in once the lookup lands, and the ids the lookup
 * settled as naming nothing; ids that never resolve are simply absent from
 * the map, so callers fall back to their own label - or, once settled, to
 * "No longer available". The stand-in for unattributed telemetry reads in
 * the reader's language; a name anything else was given stays as written.
 */
export const useTelemetryEntityLookup: UseTelemetryEntityLookupFunction = (
  ids: Array<ObjectID | string | null | undefined> | undefined,
  options?: UseTelemetryEntityNamesOptions | undefined,
): TelemetryEntityLookup => {
  const [nameMap, setNameMap] = useState<TelemetryEntityNameMap>({});
  const [notFound, setNotFound] =
    useState<ReadonlySet<string>>(NOTHING_NOT_FOUND);
  const translator: Translator = useTranslator();

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
      setNotFound(NOTHING_NOT_FOUND);
      return;
    }

    // Drop names from another scope straight away, not when the lookup lands.
    if (mapScopeRef.current && mapScopeRef.current !== scopeKey) {
      mapScopeRef.current = "";
      setNameMap({});
      setNotFound(NOTHING_NOT_FOUND);
    }

    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const looked: TelemetryEntityLookupResult =
        await TelemetryEntityNameResolver.lookup({
          ids: idList,
          projectId: projectId,
          typeHints: options?.typeHints,
          entityTypes: options?.entityTypes,
        });
      if (isCancelled) {
        return;
      }
      const resolved: TelemetryEntityNameMap = looked.names;
      /*
       * Keep a name already on screen for an id that is still requested
       * when this lookup came back without it (a failed refresh after the
       * cache TTL). Ids no longer requested are dropped.
       */
      const isSameScope: boolean = mapScopeRef.current === scopeKey;
      mapScopeRef.current = scopeKey;
      const requested: Set<string> = new Set<string>(idList);
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
      /*
       * What this lookup settled, of the ids still asked for: an id it
       * left unsettled (a table failed) is not said to be gone, even if an
       * earlier lookup said so.
       */
      const settled: Array<string> = looked.notFound.filter(
        (id: string): boolean => {
          return requested.has(id) && !resolved[id];
        },
      );
      setNotFound((previous: ReadonlySet<string>): ReadonlySet<string> => {
        if (
          settled.length === previous.size &&
          settled.every((id: string): boolean => {
            return previous.has(id);
          })
        ) {
          return previous;
        }

        return settled.length > 0
          ? new Set<string>(settled)
          : NOTHING_NOT_FOUND;
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

  const names: TelemetryEntityNameMap = useMemo(() => {
    const drawn: TelemetryEntityNameMap = {};

    for (const id of Object.keys(nameMap)) {
      const entity: TelemetryEntityNameMap[string] = nameMap[
        id
      ] as TelemetryEntityNameMap[string];

      drawn[id] =
        entity.entityType === ServiceType.Unknown
          ? { ...entity, name: translator.translateTerm(entity.name) }
          : entity;
    }

    return drawn;
    // The translator is new on every render; its language is what it adds.
  }, [nameMap, translator.language]);

  return useMemo((): TelemetryEntityLookup => {
    return { names, notFound };
  }, [names, notFound]);
};

/*
 * The names alone, for a page that draws no chip of an entity gone
 * (useTelemetryEntityLookup has both).
 */
const useTelemetryEntityNames: UseTelemetryEntityNamesFunction = (
  ids: Array<ObjectID | string | null | undefined> | undefined,
  options?: UseTelemetryEntityNamesOptions | undefined,
): TelemetryEntityNameMap => {
  return useTelemetryEntityLookup(ids, options).names;
};

export default useTelemetryEntityNames;
