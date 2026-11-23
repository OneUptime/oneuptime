import Project from "../../../Models/DatabaseModels/Project";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Includes from "../../../Types/BaseDatabase/Includes";
import { TelemetryRetentionSignal } from "../../../Types/DataSecurity/ComplianceFacts";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { readTelemetryDataStoreKeyOwnerId } from "../../../Types/DataSecurity/DataStoreKey";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import TelemetryRetentionConfig, {
  resolveTelemetryRetentionInDays,
  TelemetryPillar,
} from "../../../Types/Telemetry/TelemetryRetentionConfig";
import ProjectService from "../../Services/ProjectService";
import RumApplicationService from "../../Services/RumApplicationService";
import ServiceService from "../../Services/ServiceService";
import { resolveSessionReplayRetentionInDays } from "../SessionReplay/SessionReplayRetention";

/*
 * HOW LONG ONEUPTIME KEEPS A TELEMETRY STORE'S RECORDS, BY PLAIN CODE
 * (#10375).
 *
 * A store of a service's logs, traces, exceptions, metrics or AI
 * conversations - or a RUM application's session replays - is kept in
 * OneUptime, for the retention set for it: the service's own, else the
 * project's (Settings > Telemetry), each by kind of record where some are
 * kept longer, as ingest stamps them (resolveTelemetryRetentionInDays); a
 * replay's from its application, clamped as replays are
 * (resolveSessionReplayRetentionInDays). So the record of processing never
 * asks OneUptime AI for a telemetry store's retention: it is read here,
 * when the record is, and a change in Settings shows at once.
 */

export interface StoreTelemetryRetention {
  signal: TelemetryRetentionSignal;
  // What most of its records are kept for.
  days: number;
  // The longest a kind of its records is kept, when some are kept longer.
  maxDays?: number | undefined;
}

// What retention each telemetry kind of store is kept by.
export function getTelemetryRetentionSignal(
  kind: string | undefined,
): TelemetryRetentionSignal | null {
  switch (kind) {
    case DataStoreKind.TelemetryLogs:
      return TelemetryRetentionSignal.Logs;
    // Exceptions and AI conversations are spans: the traces' retention keeps them.
    case DataStoreKind.TelemetryTraces:
    case DataStoreKind.TelemetryExceptions:
    case DataStoreKind.TelemetryAiConversations:
      return TelemetryRetentionSignal.Traces;
    case DataStoreKind.TelemetryMetrics:
      return TelemetryRetentionSignal.Metrics;
    case DataStoreKind.TelemetrySessionReplays:
      return TelemetryRetentionSignal.SessionReplays;
    default:
      return null;
  }
}

const PILLARS: Readonly<
  Record<
    Exclude<TelemetryRetentionSignal, TelemetryRetentionSignal.SessionReplays>,
    TelemetryPillar
  >
> = {
  [TelemetryRetentionSignal.Logs]: "logs",
  [TelemetryRetentionSignal.Traces]: "traces",
  [TelemetryRetentionSignal.Metrics]: "metrics",
};

// The kinds of record a pillar keeps for a time of their own.
function bucketsOf(
  pillar: TelemetryPillar,
): Array<LogSeverity | SpanStatus | null> {
  if (pillar === "logs") {
    return [null, ...Object.values(LogSeverity)];
  }

  if (pillar === "traces") {
    return [null, SpanStatus.Unset, SpanStatus.Ok, SpanStatus.Error];
  }

  return [null];
}

/*
 * A store's retention from its service's (or application's) settings and
 * the project's: what most of its records are kept for, and the longest
 * any kind of them is - both as ingest stamps them.
 */
export function resolveStoreTelemetryRetention(data: {
  signal: TelemetryRetentionSignal;
  project: {
    telemetryRetentionConfig?: TelemetryRetentionConfig | null | undefined;
    defaultTelemetryRetentionInDays?: number | null | undefined;
  };
  service?:
    | {
        telemetryRetentionConfig?: TelemetryRetentionConfig | null | undefined;
        retainTelemetryDataForDays?: number | null | undefined;
      }
    | null
    | undefined;
  rumApplication?:
    | {
        telemetryRetentionConfig?: TelemetryRetentionConfig | null | undefined;
        sessionReplayRetentionInDays?: number | null | undefined;
      }
    | null
    | undefined;
}): StoreTelemetryRetention {
  if (data.signal === TelemetryRetentionSignal.SessionReplays) {
    return {
      signal: data.signal,
      days: resolveSessionReplayRetentionInDays({
        applicationRetentionInDays:
          data.rumApplication?.sessionReplayRetentionInDays,
        applicationConfig: data.rumApplication?.telemetryRetentionConfig,
        projectConfig: data.project.telemetryRetentionConfig,
      }),
    };
  }

  const pillar: TelemetryPillar = PILLARS[data.signal];
  const keptFor: Array<number> = bucketsOf(pillar).map(
    (bucketKey: LogSeverity | SpanStatus | null): number => {
      return resolveTelemetryRetentionInDays({
        pillar,
        bucketKey,
        serviceConfig: data.service?.telemetryRetentionConfig,
        serviceRetentionInDays: data.service?.retainTelemetryDataForDays,
        projectConfig: data.project.telemetryRetentionConfig,
        projectRetentionInDays: data.project.defaultTelemetryRetentionInDays,
      });
    },
  );
  const days: number = keptFor[0]!;
  const maxDays: number = Math.max(...keptFor);

  return maxDays > days
    ? { signal: data.signal, days, maxDays }
    : { signal: data.signal, days };
}

export interface TelemetryStoreRef {
  id: string;
  kind?: string | undefined;
  serviceId?: ObjectID | null | undefined;
  storeKey?: string | null | undefined;
}

export default class StoreTelemetryRetention {
  /*
   * The retention of each telemetry store of a project, by the store's id:
   * the project read once, and every service and RUM application its
   * stores belong to read together. A store that is no telemetry store is
   * left out.
   */
  public static async readForStores(data: {
    projectId: ObjectID;
    stores: ReadonlyArray<TelemetryStoreRef>;
  }): Promise<Map<string, StoreTelemetryRetention>> {
    const retention: Map<string, StoreTelemetryRetention> = new Map();
    const telemetry: Array<{
      store: TelemetryStoreRef;
      signal: TelemetryRetentionSignal;
      ownerId: string;
    }> = [];

    for (const store of data.stores) {
      const signal: TelemetryRetentionSignal | null =
        getTelemetryRetentionSignal(store.kind);

      if (!signal) {
        continue;
      }

      // A replay store's key names its RUM application; any other its service.
      const ownerId: string = (
        store.serviceId?.toString() ||
        readTelemetryDataStoreKeyOwnerId(store.storeKey) ||
        ""
      ).toLowerCase();

      telemetry.push({ store, signal, ownerId });
    }

    if (telemetry.length === 0) {
      return retention;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        _id: true,
        telemetryRetentionConfig: true,
        defaultTelemetryRetentionInDays: true,
      },
      props: { isRoot: true },
    });
    const ownerIds: (signal: "service" | "rum") => Array<ObjectID> = (
      signal: "service" | "rum",
    ): Array<ObjectID> => {
      return [
        ...new Set(
          telemetry
            .filter(
              (entry: {
                signal: TelemetryRetentionSignal;
                ownerId: string;
              }): boolean => {
                return (
                  ObjectID.isValidUUID(entry.ownerId) &&
                  (signal === "rum") ===
                    (entry.signal === TelemetryRetentionSignal.SessionReplays)
                );
              },
            )
            .map((entry: { ownerId: string }): string => {
              return entry.ownerId;
            }),
        ),
      ].map((id: string): ObjectID => {
        return new ObjectID(id);
      });
    };
    const serviceIds: Array<ObjectID> = ownerIds("service");
    const applicationIds: Array<ObjectID> = ownerIds("rum");
    const [services, applications]: [Array<Service>, Array<RumApplication>] =
      await Promise.all([
        serviceIds.length > 0
          ? ServiceService.findBy({
              query: { projectId: data.projectId, _id: new Includes(serviceIds) },
              select: {
                _id: true,
                telemetryRetentionConfig: true,
                retainTelemetryDataForDays: true,
              },
              skip: 0,
              limit: serviceIds.length,
              props: { isRoot: true },
            })
          : Promise.resolve([]),
        applicationIds.length > 0
          ? RumApplicationService.findBy({
              query: {
                projectId: data.projectId,
                _id: new Includes(applicationIds),
              },
              select: {
                _id: true,
                telemetryRetentionConfig: true,
                sessionReplayRetentionInDays: true,
              },
              skip: 0,
              limit: applicationIds.length,
              props: { isRoot: true },
            })
          : Promise.resolve([]),
      ]);
    const serviceById: Map<string, Service> = new Map(
      services.map((service: Service): [string, Service] => {
        return [service.id?.toString().toLowerCase() || "", service];
      }),
    );
    const applicationById: Map<string, RumApplication> = new Map(
      applications.map(
        (application: RumApplication): [string, RumApplication] => {
          return [application.id?.toString().toLowerCase() || "", application];
        },
      ),
    );

    for (const entry of telemetry) {
      retention.set(
        entry.store.id.toLowerCase(),
        resolveStoreTelemetryRetention({
          signal: entry.signal,
          project: {
            telemetryRetentionConfig: project?.telemetryRetentionConfig,
            defaultTelemetryRetentionInDays:
              project?.defaultTelemetryRetentionInDays,
          },
          service: serviceById.get(entry.ownerId),
          rumApplication: applicationById.get(entry.ownerId),
        }),
      );
    }

    return retention;
  }
}

/*
 * A telemetry store's retention as the record writes it, in the English an
 * auditor files it under: "15 days", "15 days, some records up to 90 days".
 * The Dashboard says the same in the reader's language.
 */
export function getTelemetryRetentionText(
  retention: StoreTelemetryRetention,
): string {
  const days: (count: number) => string = (count: number): string => {
    return `${count} ${count === 1 ? "day" : "days"}`;
  };

  return retention.maxDays && retention.maxDays > retention.days
    ? `${days(retention.days)}, some records up to ${days(retention.maxDays)}`
    : days(retention.days);
}
