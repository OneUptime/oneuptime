import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import { formatOpenStackBytes } from "../../../Components/OpenStack/OpenStackResourceList";
import { getOpenStackMetricQuery } from "../../../Components/OpenStack/Part/OpenStackMetricQueries";
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
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import { fetchOpenStackNames } from "../Utils/OpenStackPartData";
import {
  OPENSTACK_VOLUME_ALERT_TEMPLATE_IDS,
  getOpenStackPartExplanation,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import {
  getOpenStackFact,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

/*
 * One volume: its status in Cinder's word, how long it has been there, what holds it and
 * whose it is. The exporter doesn't say which pool a volume is on, so that is said to be
 * not collected rather than left out, because it is the next thing someone looks for.
 */
const POOL_NOT_COLLECTED: string = translationKey(
  "Not collected: neither the agent's exporter nor a probe says which pool a volume is on. openstack volume show has it, for a credential that can read it.",
);

const VolumeOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: {
  part: OpenStackPart;
  row: OpenStackResource;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();
  const attachedTo: string = getOpenStackFactText(row, "attachedToInstance");

  const instanceNames: OpenStackRead<Record<string, string>> = useOpenStackRead<
    Record<string, string>
  >(() => {
    return fetchOpenStackNames({
      openStackCloudId: part.openStackCloudId,
      kind: OpenStackResourceKind.Instance,
      externalIds: attachedTo ? [attachedTo] : [],
    });
  }, [attachedTo, part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const timeInState: string = getOpenStackTimeInState(row, now);
  const attachedName: string = attachedTo
    ? instanceNames.data?.[attachedTo] || attachedTo
    : "";

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Volume ID",
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
      description: "The volume's status in Cinder's own word.",
    });
  }
  const volumeType: string = getOpenStackFactText(row, "volumeType");
  if (volumeType) {
    detailRows.push({ key: "type", label: "Type", value: volumeType });
  }
  detailRows.push({
    key: "attached-to",
    label: "Attached to",
    value: attachedTo ? (
      <Link
        to={part.routes.getPartRoute(
          OpenStackResourceKind.Instance,
          attachedTo,
        )}
        className="text-indigo-600 hover:text-indigo-700 hover:underline"
      >
        <bdi>{attachedName}</bdi>
      </Link>
    ) : (
      translator.translateText("Nothing") || "Nothing"
    ),
  });
  detailRows.push({
    key: "pool",
    label: "Storage pool",
    value: (
      <span className="text-gray-500">
        {translator.translateText(POOL_NOT_COLLECTED) || POOL_NOT_COLLECTED}
      </span>
    ),
  });
  const isBootable: unknown = getOpenStackFact(row, "isBootable");
  if (isBootable !== undefined) {
    detailRows.push({
      key: "bootable",
      label: "Bootable",
      value:
        translator.translateText(isBootable === true ? "Yes" : "No") ||
        (isBootable === true ? "Yes" : "No"),
    });
  }
  if (row.openStackProjectId) {
    detailRows.push({
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
    });
  }
  if (row.availabilityZone) {
    detailRows.push({
      key: "zone",
      label: "Availability Zone",
      value: row.availabilityZone,
    });
  }
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  return (
    <div data-testid="openstack-volume-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-volume-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-volume-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Volume}/${part.externalId}`,
          label: translationKey("This volume"),
        }}
        description="What about this volume is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="openstack-volume-tiles"
      >
        <GoldenMetricTile
          title="Size"
          icon={IconProp.Database}
          iconColor="amber"
          value={
            row.diskCapacityBytes === undefined ||
            row.diskCapacityBytes === null
              ? "—"
              : formatOpenStackBytes(row.diskCapacityBytes)
          }
          description="What this volume holds room for, as Cinder reports it."
        />
        <GoldenMetricTile
          title="In state for"
          icon={IconProp.Clock}
          iconColor="slate"
          value={timeInState || "—"}
          description="How long since OneUptime saw this volume's status change. One already in this state when OneUptime first saw it counts from then."
        />
      </div>

      <OpenStackPartOpenEvents
        testId="openstack-volume-open"
        title="Open on this volume"
        description="Unresolved incidents and alerts about this volume, incidents first."
        part={part}
        row={row}
      />

      <OpenStackPartAlerts
        testId="openstack-volume-alerts"
        title="Volume alerts"
        description="The cloud's alerts that watch every volume, this one included: each is one monitor on the cloud."
        templateIds={OPENSTACK_VOLUME_ALERT_TEMPLATE_IDS}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-volume-details"
        description="What Cinder reports about this volume, and what it doesn't."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudVolumeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Volume);
  const row: OpenStackResource | null = part.row;

  const badges: Array<ResourcePartBadge> = [];
  if (row) {
    const volumeType: string = getOpenStackFactText(row, "volumeType");
    if (volumeType) {
      badges.push({
        key: "type",
        label: "{{type}}",
        values: { type: volumeType },
        tone: "neutral",
      });
    }
  }

  return (
    <OpenStackPartPage
      part={part}
      hero={{ badges }}
      overview={(overviewRow: OpenStackResource): ReactElement => {
        return <VolumeOverview part={part} row={overviewRow} />;
      }}
      tabs={(): Array<Tab> => {
        return [
          {
            name: "Metrics",
            children: (
              <Card
                title="Size over time"
                description="What this volume has held room for, over the selected time range. It moves when it is extended."
              >
                <ResourceMetricsTab
                  queryConfigs={[
                    getOpenStackMetricQuery({
                      part,
                      variable: "volume_size",
                      title: "Volume size",
                      description: "This volume's size, as Cinder reports it.",
                      metricName: "openstack_cinder_volume_gb",
                      legend: "Size",
                      legendUnit: "GiB",
                      attributes: { id: part.externalId },
                    }),
                  ]}
                />
              </Card>
            ),
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudVolumeDetail;
