import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import ObjectID from "Common/Types/ObjectID";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  CEPH_CLUSTER_ATTENTION_KEY,
  CephHealthCheck,
  CephPoolPgStates,
  getCephAttentionItems,
  getCephHealthWord,
} from "../../Pages/Ceph/Utils/CephHealth";
import {
  CephHealthCheckReadings,
  CephPgStateReadings,
  loadCephHealthChecks,
  loadCephPgStates,
} from "../../Pages/Ceph/Utils/CephReadings";
import { fetchCephResources } from "../../Pages/Ceph/Utils/CephResourceUtils";
import { ResourceAttentionItem } from "../ResourcePart/ResourceAttention";
import { ResourceAttentionDialogRead } from "../ResourcePart/ResourceAttentionDialog";
import ResourceAttentionPill from "../ResourcePart/ResourceAttentionPill";
import { CephPartRoutes, getCephPartRoutes } from "./Part/CephPartRoutes";

/*
 * A CEPH CLUSTER'S "ERR" OR "WARN" ON THE CLUSTERS LIST OPENS WHY (#9751).
 *
 * The list drew Ceph's verdict alone (CephCluster.healthStatus: HEALTH_OK,
 * HEALTH_WARN, HEALTH_ERR), and reaching why took a click and a page: the
 * cluster's Overview, its Needs attention card. A verdict that says
 * something is wrong is now a pill that opens that list (the shared
 * ResourceAttentionPill): Ceph's own checks on the cluster's row, as Ceph
 * names them (OSD_DOWN, PG_DEGRADED), then each OSD, monitor and pool that
 * needs a look, with why, the most urgent first - by the rules the Overview
 * uses (getCephAttentionItems), so the two never disagree - each with View
 * to its page, the cluster's row to the cluster's Overview.
 *
 * Read when pressed, never with the list: the inventory, the checks Ceph
 * raised and the pools' placement groups, as the Overview reads them. A
 * check or a placement-group read that fails leaves the cluster's row with
 * Ceph's verdict alone, as on the Overview; an inventory that cannot be read
 * says so, with Try again.
 */

export const CEPH_CLUSTER_HEALTH_TITLE: string = translationKey(
  "Why {{cluster}} reports {{status}}",
);
export const CEPH_CLUSTER_HEALTH_HINT: string = translationKey("Show why");
export const CEPH_CLUSTER_HEALTH_EMPTY: string = translationKey(
  "Nothing needs attention now.",
);
export const CEPH_CLUSTER_HEALTH_READ_FAILED: string = translationKey(
  "Couldn't read what needs attention",
);

export interface CephClusterHealthSubject {
  id: ObjectID;
  name: string;
  // Ceph's verdict, as CephCluster.healthStatus keeps it (1 WARN, 2 ERR).
  healthStatus: number;
  capacityUsedPercent: number | null;
}

/*
 * What the pill lists: what needs attention on the cluster, as its
 * Overview's Needs attention card lists it, with View to each page.
 */
export async function loadCephClusterAttention(
  cluster: CephClusterHealthSubject,
  now: Date = new Date(),
): Promise<ResourceAttentionDialogRead> {
  const [rows, checks, pgStatesByPool]: [
    Array<CephResourceModel>,
    Array<CephHealthCheck> | null,
    Map<string, CephPoolPgStates> | null,
  ] = await Promise.all([
    fetchCephResources({
      cephClusterId: cluster.id,
      kinds: ["Osd", "Pool", "Mon"],
    }),
    // Best-effort, as on the Overview: Ceph's verdict stands without them.
    loadCephHealthChecks(cluster.name)
      .then((readings: CephHealthCheckReadings) => {
        return readings.isExported ? readings.checks : null;
      })
      .catch(() => {
        return null;
      }),
    loadCephPgStates(cluster.name)
      .then((readings: CephPgStateReadings) => {
        return readings.byPool;
      })
      .catch(() => {
        return null;
      }),
  ]);

  const routes: CephPartRoutes = getCephPartRoutes(cluster.id);

  const items: Array<ResourceAttentionItem> = getCephAttentionItems({
    rows: rows,
    cluster: {
      name: cluster.name,
      healthStatus: cluster.healthStatus,
      checks: checks,
      capacityUsedPercent: cluster.capacityUsedPercent,
    },
    pgStatesByPool: pgStatesByPool,
    routeFor: routes.getPartRoute,
    now: now,
  });

  return {
    items: items.map((item: ResourceAttentionItem): ResourceAttentionItem => {
      // From the list, the cluster's own row is a step from its Overview.
      return item.key === CEPH_CLUSTER_ATTENTION_KEY
        ? { ...item, route: routes.clusterRoute }
        : item;
    }),
  };
}

export interface ComponentProps {
  cluster: CephClusterHealthSubject;
}

const CephClusterHealthPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isError: boolean = props.cluster.healthStatus >= 2;

  return (
    <ResourceAttentionPill
      // Ceph's own word, as it writes it, in every language.
      label={isError ? "ERR" : "WARN"}
      tone={isError ? "danger" : "warning"}
      testId={`ceph-cluster-health-${props.cluster.id.toString()}`}
      hint={CEPH_CLUSTER_HEALTH_HINT}
      dialog={{
        title: translator.translateTemplate(
          CEPH_CLUSTER_HEALTH_TITLE,
          {
            cluster: props.cluster.name,
            status: getCephHealthWord(props.cluster.healthStatus) || "",
          },
          { setsValuesApart: true },
        ),
        load: () => {
          return loadCephClusterAttention(props.cluster);
        },
        emptyMessage: CEPH_CLUSTER_HEALTH_EMPTY,
        whatFailed: CEPH_CLUSTER_HEALTH_READ_FAILED,
      }}
    />
  );
};

export default CephClusterHealthPill;
