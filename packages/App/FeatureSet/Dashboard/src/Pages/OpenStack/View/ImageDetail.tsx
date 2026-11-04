import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import { formatOpenStackBytes } from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import {
  getOpenStackPartExplanation,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import {
  getOpenStackFact,
  getOpenStackFactNumber,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

/*
 * One Glance image: its status, size and who can use it. One left in queued is what a
 * failed upload looks like, so that is called out, and instances asking for it fail.
 */

const ImageOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: {
  part: OpenStackPart;
  row: OpenStackResource;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const timeInState: string = getOpenStackTimeInState(row, now);
  const createdAtSeconds: number | null = getOpenStackFactNumber(
    row,
    "createdAtSeconds",
  );

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Image ID",
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
      description: "The image's status in Glance's own word.",
    });
  }
  const visibility: string = getOpenStackFactText(row, "visibility");
  if (visibility) {
    detailRows.push({
      key: "visibility",
      label: "Visibility",
      value: visibility,
    });
  }
  const isHidden: unknown = getOpenStackFact(row, "isHidden");
  if (isHidden !== undefined) {
    detailRows.push({
      key: "hidden",
      label: "Hidden",
      value:
        translator.translateText(isHidden === true ? "Yes" : "No") ||
        (isHidden === true ? "Yes" : "No"),
    });
  }
  const imageType: string = getOpenStackFactText(row, "imageType");
  if (imageType) {
    detailRows.push({ key: "type", label: "Type", value: imageType });
  }
  if (createdAtSeconds !== null) {
    detailRows.push({
      key: "created",
      label: "Created",
      value: OneUptimeDate.getDateAsLocalFormattedString(
        new Date(createdAtSeconds * 1000),
      ),
    });
  }
  if (row.openStackProjectId) {
    detailRows.push({
      key: "project",
      label: "Owner",
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
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  return (
    <div data-testid="openstack-image-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-image-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-image-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Image}/${part.externalId}`,
          label: translationKey("This image"),
        }}
        description="What about this image is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="openstack-image-tiles"
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
          description="This image's size, as Glance reports it."
        />
        <GoldenMetricTile
          title="In state for"
          icon={IconProp.Clock}
          iconColor="slate"
          value={timeInState || "—"}
          description="How long since OneUptime saw this image's status change. One already in this state when OneUptime first saw it counts from then."
        />
      </div>

      <ResourcePartDetailsCard
        testId="openstack-image-details"
        description="What Glance reports about this image."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudImageDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Image);

  const badges: Array<ResourcePartBadge> = [];
  if (part.row) {
    const visibility: string = getOpenStackFactText(part.row, "visibility");
    if (visibility) {
      badges.push({
        key: "visibility",
        label: "{{visibility}}",
        values: { visibility },
        tone: "neutral",
      });
    }
  }

  return (
    <OpenStackPartPage
      part={part}
      hero={{ badges }}
      overview={(row: OpenStackResource): ReactElement => {
        return <ImageOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudImageDetail;
