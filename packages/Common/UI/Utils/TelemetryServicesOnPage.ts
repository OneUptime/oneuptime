import Service from "../../Models/DatabaseModels/Service";
import Select from "../../Types/BaseDatabase/Select";
import ObjectID from "../../Types/ObjectID";
import API from "./API/API";
import ProjectUtil from "./Project";
import RecordsById from "./RecordsById";
import TelemetryServiceUtil from "./TelemetryService";
import { MutableRefObject, useCallback, useRef, useState } from "react";

/*
 * THE SERVICES A PAGE OF TELEMETRY ROWS NAMES, READ BY THEIR IDS (#10764).
 *
 * The Traces and Profiles tables read the project's first 10,000 services
 * by name and named each row's service from them: a row whose service
 * sorted past them read "Unknown", or a type over a short id. The rows name
 * their services from a read of the services they hold instead, as each
 * page of rows arrives (a table's onFetchSuccess): each id read once, in
 * pages (RecordsById), within the reader's reach.
 *
 * In Common since #11072, where the logs explorer (LogsViewer) reads the
 * services its rows, facets and chips name the same way.
 *
 * The project's own id stands for the telemetry that named no service: it
 * is the synthetic "Unknown Service" (TelemetryService), never read.
 */

/*
 * What a row's service is drawn with (ServiceElement): its name and colour -
 * and whether it is archived, which a chip naming it says (#11213).
 */
export const TELEMETRY_ROW_SERVICE_SELECT: Select<Service> = {
  name: true,
  serviceColor: true,
  isArchived: true,
};

type RowEntityId = ObjectID | string | null | undefined;

export interface TelemetryServicesOnPage {
  // The service behind a row's id, once read.
  getService: (id: RowEntityId) => Service | undefined;
  // Whether a row's service is being read: its cell waits for it.
  isReading: (id: RowEntityId) => boolean;
  /*
   * Whether a read of this id has answered - with its service, or with no
   * service at all (the id names a RUM application, a host, or nothing the
   * reader may see) - so another lookup of it need not wait any longer.
   * False before it is asked for, while it is read, and after a read of it
   * failed.
   */
  isAnswered: (id: RowEntityId) => boolean;
  /*
   * Reads the services behind these ids, the ones not read already, and
   * answers every service known then, by lower-cased id.
   */
  readServicesOf: (ids: Array<RowEntityId>) => Promise<Map<string, Service>>;
  /*
   * Every service read so far, by lower-cased id: the same map until a read
   * lands, so what a page derives from it is not rebuilt on every render.
   */
  knownServices: Map<string, Service>;
  // Why the last read failed, in the reader's words; "" when none did.
  error: string;
  // Reads again what the failed reads asked for.
  retry: () => Promise<void>;
}

const keyOf: (id: RowEntityId) => string = (id: RowEntityId): string => {
  return id ? id.toString().trim().toLowerCase() : "";
};

export function useTelemetryServicesOnPage(): TelemetryServicesOnPage {
  const [services, setServices] = useState<Map<string, Service>>(new Map());
  const [reading, setReading] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>("");

  // What is known, as the reads land: what a read answers its caller.
  const servicesRef: MutableRefObject<Map<string, Service>> = useRef<
    Map<string, Service>
  >(new Map());
  const requestedRef: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );
  const failedRef: MutableRefObject<Array<string>> = useRef<Array<string>>([]);

  const readServicesOf: (
    ids: Array<RowEntityId>,
  ) => Promise<Map<string, Service>> = useCallback(
    async (ids: Array<RowEntityId>): Promise<Map<string, Service>> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const toRead: Array<string> = RecordsById.getValuesToRead({
        ids: ids.filter((id: RowEntityId): id is ObjectID | string => {
          return Boolean(id);
        }),
      }).filter((id: string): boolean => {
        return (
          !requestedRef.current.has(id) &&
          !TelemetryServiceUtil.isUnknownServiceId(id, projectId)
        );
      });

      if (toRead.length === 0) {
        return servicesRef.current;
      }

      for (const id of toRead) {
        requestedRef.current.add(id);
      }

      setReading((current: Set<string>): Set<string> => {
        return new Set<string>([...Array.from(current), ...toRead]);
      });

      try {
        const records: Array<Service> = await RecordsById.read<Service>({
          modelType: Service,
          ids: toRead,
          select: TELEMETRY_ROW_SERVICE_SELECT,
        });
        const next: Map<string, Service> = new Map(servicesRef.current);

        for (const record of records) {
          const id: string = keyOf(record.id || record._id);

          if (id) {
            next.set(id, record);
          }
        }

        servicesRef.current = next;
        setServices(next);
        setAnswered((current: Set<string>): Set<string> => {
          return new Set<string>([...Array.from(current), ...toRead]);
        });
        setError("");
      } catch (err) {
        // Unread, they are asked for again on Try again.
        for (const id of toRead) {
          requestedRef.current.delete(id);
        }

        failedRef.current = Array.from(
          new Set<string>([...failedRef.current, ...toRead]),
        );
        setError(API.getFriendlyErrorMessage(err as Error));
      } finally {
        setReading((current: Set<string>): Set<string> => {
          const next: Set<string> = new Set<string>(current);

          for (const id of toRead) {
            next.delete(id);
          }

          return next;
        });
      }

      return servicesRef.current;
    },
    [],
  );

  return {
    getService: (id: RowEntityId): Service | undefined => {
      const key: string = keyOf(id);

      if (!key) {
        return undefined;
      }

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (TelemetryServiceUtil.isUnknownServiceId(key, projectId)) {
        return TelemetryServiceUtil.getUnknownService(projectId!);
      }

      return services.get(key);
    },
    isReading: (id: RowEntityId): boolean => {
      const key: string = keyOf(id);

      return Boolean(key) && reading.has(key);
    },
    isAnswered: (id: RowEntityId): boolean => {
      const key: string = keyOf(id);

      return Boolean(key) && answered.has(key);
    },
    readServicesOf: readServicesOf,
    knownServices: services,
    error: error,
    retry: async (): Promise<void> => {
      const ids: Array<string> = failedRef.current;

      failedRef.current = [];
      setError("");
      await readServicesOf(ids);
    },
  };
}
