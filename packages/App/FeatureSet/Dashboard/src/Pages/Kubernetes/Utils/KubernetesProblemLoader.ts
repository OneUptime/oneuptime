import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import {
  KubernetesHealthRow,
  KubernetesHealthSeverity,
} from "Common/Types/Kubernetes/KubernetesHealth";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { fetchKubernetesEvents } from "../../../Components/Kubernetes/KubernetesEventsApi";
import {
  KubernetesEventRow,
  KubernetesEventsTypeFilter,
} from "../../../Components/Kubernetes/KubernetesEventsModel";
import { ResourceAttentionDialogRead } from "../../../Components/ResourcePart/ResourceAttentionDialog";
import {
  KubernetesProblemKind,
  KubernetesProblemQuery,
  buildKubernetesProblemItems,
  getKubernetesProblemObjectKind,
  selectKubernetesProblemPods,
} from "./KubernetesProblemItems";
import { getKubernetesPartRoute } from "./KubernetesPartRoutes";

/*
 * Reads what a count on the cluster's hero is about, when its dialog opens
 * (KubernetesProblemItems says what each row shows): the pods or nodes of
 * that count from the inventory - through the inventory's own list, with
 * the access every Kubernetes page has - and the warning Events Kubernetes
 * reported about them, in one more read. Events are a supplement: when
 * they cannot be read, the rows still say why from the objects' status.
 */

// The most objects one dialog lists: the newest first.
export const KUBERNETES_PROBLEM_ROW_LIMIT: number = 200;

/*
 * How far back their Events are read: from an hour before the oldest of
 * them started failing, to now - a week at most, a day when none says when.
 */
export const KUBERNETES_PROBLEM_EVENTS_MAX_DAYS: number = 7;
export const KUBERNETES_PROBLEM_EVENTS_DEFAULT_HOURS: number = 24;
export const KUBERNETES_PROBLEM_EVENTS_LIMIT: number = 1000;

/*
 * What the inventory's list is asked for: the rows of the count, narrowed
 * as far as a column can. The rules then keep exactly the count's pods
 * (selectKubernetesProblemPods): a Pending pod whose image will not pull is
 * counted under ImagePullBackOff, never Pending too.
 */
export function getKubernetesProblemModelQuery(data: {
  clusterId: ObjectID;
  query: KubernetesProblemQuery;
}): Query<KubernetesResourceModel> {
  const base: Query<KubernetesResourceModel> = {
    kubernetesClusterId: data.clusterId,
  };

  switch (data.query.kind) {
    case KubernetesProblemKind.NodesNotReady:
      return { ...base, kind: "Node", isReady: false };
    case KubernetesProblemKind.CannotRun:
      // Exactly the pods ingest found a container of cannot run.
      return {
        ...base,
        kind: "Pod",
        healthSeverity: KubernetesHealthSeverity.Critical,
      };
    case KubernetesProblemKind.Pending:
      return { ...base, kind: "Pod", phase: "Pending" };
    case KubernetesProblemKind.Failed:
      return { ...base, kind: "Pod", phase: "Failed" };
    case KubernetesProblemKind.Unknown:
    default:
      return { ...base, kind: "Pod", phase: "Unknown" };
  }
}

/*
 * The window the Events are read in: an hour before the oldest of the rows
 * began failing (a pod that failed three days ago was evicted then), at
 * most a week back; a day back when none of them says when.
 */
export function getKubernetesProblemEventsWindow(data: {
  sinceTimes: Array<number>;
  now: Date;
}): InBetween<Date> {
  const end: Date = data.now;
  const earliestAllowed: number =
    end.getTime() - KUBERNETES_PROBLEM_EVENTS_MAX_DAYS * 24 * 60 * 60 * 1000;
  const known: Array<number> = data.sinceTimes.filter((time: number) => {
    return Number.isFinite(time);
  });
  const start: number =
    known.length > 0
      ? Math.max(Math.min(...known) - 60 * 60 * 1000, earliestAllowed)
      : end.getTime() -
        KUBERNETES_PROBLEM_EVENTS_DEFAULT_HOURS * 60 * 60 * 1000;
  return new InBetween<Date>(new Date(Math.min(start, end.getTime())), end);
}

function toHealthRow(row: KubernetesResourceModel): KubernetesHealthRow {
  return {
    kind: row.kind,
    namespaceKey: row.namespaceKey,
    name: row.name,
    phase: row.phase,
    isReady: row.isReady,
    hasMemoryPressure: row.hasMemoryPressure,
    hasDiskPressure: row.hasDiskPressure,
    hasPidPressure: row.hasPidPressure,
    labels: row.labels,
    ownerReferences: row.ownerReferences,
    spec: row.spec,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    resourceCreationTimestamp: row.resourceCreationTimestamp,
  };
}

export async function loadKubernetesProblemItems(data: {
  clusterId: ObjectID;
  // The agent's name for the cluster, which its Events are stamped with.
  clusterIdentifier: string;
  query: KubernetesProblemQuery;
}): Promise<ResourceAttentionDialogRead> {
  const result: ListResult<KubernetesResourceModel> =
    await ModelAPI.getList<KubernetesResourceModel>({
      modelType: KubernetesResourceModel,
      query: getKubernetesProblemModelQuery({
        clusterId: data.clusterId,
        query: data.query,
      }),
      skip: 0,
      limit: KUBERNETES_PROBLEM_ROW_LIMIT,
      select: {
        kind: true,
        name: true,
        namespaceKey: true,
        phase: true,
        isReady: true,
        hasMemoryPressure: true,
        hasDiskPressure: true,
        hasPidPressure: true,
        labels: true,
        ownerReferences: true,
        spec: true,
        status: true,
        lastSeenAt: true,
        resourceCreationTimestamp: true,
      },
      sort: {
        lastSeenAt: SortOrder.Descending,
      },
    });

  const all: Array<KubernetesHealthRow> = result.data.map(toHealthRow);
  const rows: Array<KubernetesHealthRow> =
    data.query.kind === KubernetesProblemKind.NodesNotReady
      ? all
      : selectKubernetesProblemPods(all, data.query);

  const objectKind: "Pod" | "Node" = getKubernetesProblemObjectKind(data.query);
  const routeFor: (part: {
    kind: string;
    name: string;
    namespace: string;
  }) => ReturnType<typeof getKubernetesPartRoute> = (part: {
    kind: string;
    name: string;
    namespace: string;
  }) => {
    return getKubernetesPartRoute(data.clusterId, part);
  };

  // Without events first, to know when each began failing.
  const withoutEvents: ReturnType<typeof buildKubernetesProblemItems> =
    buildKubernetesProblemItems({
      rows: rows,
      query: data.query,
      routeFor: routeFor,
    });

  let events: Array<KubernetesEventRow> = [];
  const names: Array<string> = Array.from(
    new Set(
      rows
        .map((row: KubernetesHealthRow): string => {
          return row.name || "";
        })
        .filter(Boolean),
    ),
  );

  if (names.length > 0 && data.clusterIdentifier) {
    try {
      events = (
        await fetchKubernetesEvents({
          clusterIdentifier: data.clusterIdentifier,
          scope: {
            kind: "objects",
            objectKind: objectKind,
            objectNames: names,
          },
          filters: { type: KubernetesEventsTypeFilter.Warning },
          window: getKubernetesProblemEventsWindow({
            sinceTimes: withoutEvents
              .map((item: { since?: { at: Date } | undefined }): number => {
                return item.since ? item.since.at.getTime() : NaN;
              })
              .filter((time: number): boolean => {
                return Number.isFinite(time);
              }),
            now: OneUptimeDate.getCurrentDate(),
          }),
          limit: KUBERNETES_PROBLEM_EVENTS_LIMIT,
        })
      ).rows;
    } catch {
      // The rows say why from the objects' status; their Events are extra.
      events = [];
    }
  }

  return {
    items:
      events.length > 0
        ? buildKubernetesProblemItems({
            rows: rows,
            query: data.query,
            routeFor: routeFor,
            events: events,
          })
        : withoutEvents,
    isTruncated: result.count > result.data.length,
  };
}
