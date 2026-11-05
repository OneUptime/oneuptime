import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackBlastRadius } from "Common/Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "../../../Components/OpenStack/Part/OpenStackPartActivity";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import { fetchOpenStackBlastRadius } from "../Utils/OpenStackPartData";
import {
  OPENSTACK_CONTAINER_CLUSTER_ALERT_TEMPLATE_IDS,
  getOpenStackContainerClusterNodeCounts,
  getOpenStackPartExplanation,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Kubernetes cluster Magnum built: its status in Magnum's word, the Heat stack it was built with,
 * and whose it is. The exporter has no project for a cluster, recorded on every scene, so that comes
 * from its stack where this credential can read Heat, and otherwise the page says it isn't known.
 * Magnum's own read of a cluster says why it failed, what it was built from and how healthy it is,
 * and only a probe makes it.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "The agent's exporter doesn't read why a cluster failed. Run openstack coe cluster show for this cluster, or collect this cloud with a probe, which reads it from Magnum.",
);

const NO_PROJECT_DESCRIPTION: string = translationKey(
  "Magnum says whose a cluster is only on that cluster's own read, which the agent's exporter doesn't make. OneUptime takes it from the cluster's Heat stack, which this credential can't read.",
);

const ContainerClusterOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const radius: OpenStackRead<OpenStackBlastRadius> =
    useOpenStackRead<OpenStackBlastRadius>(() => {
      return fetchOpenStackBlastRadius({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.ContainerCluster,
        externalId: part.externalId,
      });
    }, [part.externalId, part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const reason: string = getOpenStackFactText(row, "statusReason");
  const stackId: string = getOpenStackFactText(row, "stackId");
  const stackName: string | null | undefined = radius.data?.belongsTo?.find(
    (owner: { externalId: string }): boolean => {
      return owner.externalId === stackId;
    },
  )?.name;
  const { controlPlane, workers } = getOpenStackContainerClusterNodeCounts(row);

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Cluster ID",
      value: part.externalId,
      mono: true,
      copyText: part.externalId,
    },
  ];
  if (row.status) {
    detailRows.push({
      key: "status",
      label: "Status",
      value: row.status,
      description: "The cluster's status in Magnum's own word.",
    });
  }
  if (reason) {
    detailRows.push({
      key: "reason",
      label: "Why",
      value: <bdi>{reason}</bdi>,
      description: "What Magnum recorded about this cluster, in its own words.",
    });
  }
  const healthStatus: string = getOpenStackFactText(row, "healthStatus");
  if (healthStatus) {
    detailRows.push({
      key: "health",
      label: "Health",
      value: healthStatus,
      description:
        "What Magnum says of a cluster it can reach. UNKNOWN is what it says of one it can't.",
    });
  }
  if (stackId) {
    detailRows.push({
      key: "stack",
      label: "Heat Stack",
      value: (
        <Link
          to={part.routes.getPartRoute(OpenStackResourceKind.Stack, stackId)}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{stackName || stackId}</bdi>
        </Link>
      ),
      description:
        "Magnum builds a cluster with a Heat stack, so a cluster that failed usually says why there.",
    });
  }
  const templateName: string = getOpenStackFactText(row, "clusterTemplateName");
  const templateId: string = getOpenStackFactText(row, "clusterTemplateId");
  if (templateName || templateId) {
    detailRows.push({
      key: "template",
      label: "Cluster Template",
      value: <bdi>{templateName || templateId}</bdi>,
    });
  }
  const coeVersion: string = getOpenStackFactText(row, "coeVersion");
  if (coeVersion) {
    detailRows.push({
      key: "version",
      label: "Kubernetes Version",
      value: coeVersion,
    });
  }
  detailRows.push(
    row.openStackProjectId
      ? {
          key: "project",
          label: "Project",
          value: (
            <Link
              to={part.routes.getPartRoute(
                OpenStackResourceKind.Project,
                row.openStackProjectId,
              )}
              className="text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              <bdi>{row.openStackProjectId}</bdi>
            </Link>
          ),
        }
      : {
          key: "project",
          label: "Project",
          value: "—",
          description: NO_PROJECT_DESCRIPTION,
        },
  );
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  return (
    <div data-testid="openstack-container-cluster-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-container-cluster-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-container-cluster-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.ContainerCluster}/${part.externalId}`,
          label: translationKey("This cluster"),
        }}
        description="What about this cluster is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3"
        data-testid="openstack-container-cluster-tiles"
      >
        <GoldenMetricTile
          title="Control plane nodes"
          icon={IconProp.ServerStack}
          iconColor="blue"
          value={controlPlane === null ? "—" : `${controlPlane}`}
          description="How many this cluster was asked for, which is what Magnum reports whether or not they came up."
        />
        <GoldenMetricTile
          title="Worker nodes"
          icon={IconProp.ServerStack}
          iconColor="blue"
          value={workers === null ? "—" : `${workers}`}
          description="How many this cluster was asked for, which is what Magnum reports whether or not they came up."
        />
        <GoldenMetricTile
          title="In state for"
          icon={IconProp.Clock}
          iconColor="slate"
          value={getOpenStackTimeInState(row, now) || "—"}
          description="How long since OneUptime saw this cluster's status change. One already in this state when OneUptime first saw it counts from then."
        />
      </div>

      {attention.length > 0 && !reason ? (
        <OpenStackPartNotice
          testId="openstack-container-cluster-why-not-known"
          text={WHY_NOT_KNOWN}
        />
      ) : (
        <></>
      )}

      <OpenStackPartOpenEvents
        testId="openstack-container-cluster-open"
        title="Open on this cluster"
        description="Unresolved incidents and alerts about this cluster, incidents first."
        part={part}
        row={row}
      />

      <OpenStackPartAlerts
        testId="openstack-container-cluster-alerts"
        title="Cluster alerts"
        description="The cloud's alerts that watch every cluster, this one included: each is one monitor on the cloud."
        templateIds={OPENSTACK_CONTAINER_CLUSTER_ALERT_TEMPLATE_IDS}
        context={{ openStackServices: [OpenStackServiceType.ContainerInfra] }}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-container-cluster-details"
        description="What Magnum reports about this cluster."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudContainerClusterDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.ContainerCluster,
  );

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        return <ContainerClusterOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudContainerClusterDetail;
