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
  OPENSTACK_STACK_ALERT_TEMPLATE_IDS,
  getOpenStackPartExplanation,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Heat stack: its status in Heat's word, whose it is, and the Kubernetes cluster it was built
 * for when Magnum built it. Why it failed is only known to a probe, which reads it from Heat; the
 * agent's exporter never asks, so the page says what to run instead. Which instances and volumes it
 * owns takes a read of its resources, which nothing makes yet, and the page says so.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "The agent's exporter doesn't read why a stack failed. Run openstack stack failures list for this stack, or collect this cloud with a probe, which reads it from Heat.",
);

const WHAT_IT_OWNS_NOT_KNOWN: string = translationKey(
  "Which instances and volumes this stack owns isn't collected yet. Run openstack stack resource list to see them.",
);

const NO_PROJECT_DESCRIPTION: string = translationKey(
  "Heat only says whose a stack is to an admin. This credential sees its own project's stacks with no project on them.",
);

const StackOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const radius: OpenStackRead<OpenStackBlastRadius> =
    useOpenStackRead<OpenStackBlastRadius>(() => {
      return fetchOpenStackBlastRadius({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.Stack,
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

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Stack ID",
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
      description: "The stack's status in Heat's own word.",
    });
  }
  if (reason) {
    detailRows.push({
      key: "reason",
      label: "Why",
      value: <bdi>{reason}</bdi>,
      description: "What Heat recorded about its last action, in its own words.",
    });
  }
  for (const owner of radius.data?.belongsTo || []) {
    detailRows.push({
      key: `belongs-to-${owner.externalId}`,
      label: "Built for",
      value: (
        <Link
          to={part.routes.getPartRoute(
            OpenStackResourceKind.ContainerCluster,
            owner.externalId,
          )}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{owner.name || owner.externalId}</bdi>
        </Link>
      ),
      description:
        "The Kubernetes cluster Magnum built this stack for. A failure here is a failure of that cluster.",
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
    <div data-testid="openstack-stack-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-stack-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-stack-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Stack}/${part.externalId}`,
          label: translationKey("This stack"),
        }}
        description="What about this stack is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="openstack-stack-tiles"
      >
        <GoldenMetricTile
          title="In state for"
          icon={IconProp.Clock}
          iconColor="slate"
          value={getOpenStackTimeInState(row, now) || "—"}
          description="How long since OneUptime saw this stack's status change. One already in this state when OneUptime first saw it counts from then."
        />
      </div>

      {attention.length > 0 && !reason ? (
        <OpenStackPartNotice
          testId="openstack-stack-why-not-known"
          text={WHY_NOT_KNOWN}
        />
      ) : (
        <></>
      )}

      <OpenStackPartOpenEvents
        testId="openstack-stack-open"
        title="Open on this stack"
        description="Unresolved incidents and alerts about this stack, incidents first."
        part={part}
        row={row}
      />

      <OpenStackPartAlerts
        testId="openstack-stack-alerts"
        title="Stack alerts"
        description="The cloud's alerts that watch every stack, this one included: each is one monitor on the cloud."
        templateIds={OPENSTACK_STACK_ALERT_TEMPLATE_IDS}
        context={{ openStackServices: [OpenStackServiceType.Orchestration] }}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-stack-details"
        description="What Heat reports about this stack."
        rows={detailRows}
      />

      <OpenStackPartNotice
        testId="openstack-stack-owns-not-known"
        text={WHAT_IT_OWNS_NOT_KNOWN}
      />
    </div>
  );
};

const OpenStackCloudStackDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Stack);

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        return <StackOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudStackDetail;
