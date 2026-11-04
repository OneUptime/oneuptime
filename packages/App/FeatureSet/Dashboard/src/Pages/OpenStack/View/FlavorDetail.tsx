import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import { OpenStackInstanceList } from "../../../Components/OpenStack/OpenStackLists";
import { formatOpenStackBytes } from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import { countOpenStackRows } from "../Utils/OpenStackPartData";
import { getOpenStackFlavorId } from "../Utils/OpenStackPartFacts";
import { getOpenStackFact } from "../Utils/OpenStackResourceUtils";

/*
 * A flavor: its size, and how many instances are that size. Its numbers are what an
 * instance of it asks for, so nothing here says allocated or used. How many more of it fit
 * is the capacity page's, because it takes counting per host.
 */

function flavorInstanceQuery(row: OpenStackResource): {
  facts: JSONObject;
  regionName?: string;
} {
  return {
    facts: { flavorId: getOpenStackFlavorId(row) },
    ...(row.regionName ? { regionName: row.regionName } : {}),
  };
}

const FlavorOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: {
  part: OpenStackPart;
  row: OpenStackResource;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;

  const instances: OpenStackRead<number> = useOpenStackRead<number>(() => {
    return countOpenStackRows({
      openStackCloudId: part.openStackCloudId,
      kind: OpenStackResourceKind.Instance,
      query: flavorInstanceQuery(row),
    });
  }, [part.externalId, part.refreshToken]);

  const isPublic: unknown = getOpenStackFact(row, "isPublic");

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "flavor-id",
      label: "Flavor ID",
      value: getOpenStackFlavorId(row),
      mono: true,
      copyText: getOpenStackFlavorId(row),
    },
  ];
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }
  if (isPublic !== undefined) {
    detailRows.push({
      key: "visibility",
      label: "Visibility",
      value:
        translator.translateText(isPublic === true ? "Public" : "Private") ||
        (isPublic === true ? "Public" : "Private"),
    });
  }

  return (
    <div data-testid="openstack-flavor-overview">
      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="openstack-flavor-tiles"
      >
        <GoldenMetricTile
          title="vCPUs"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={
            row.vcpuCapacity === undefined || row.vcpuCapacity === null
              ? "—"
              : translator.formatNumber(row.vcpuCapacity)
          }
          description="What an instance of this flavor asks for."
        />
        <GoldenMetricTile
          title="Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={
            row.memoryCapacityBytes === undefined ||
            row.memoryCapacityBytes === null
              ? "—"
              : formatOpenStackBytes(row.memoryCapacityBytes)
          }
          description="What an instance of this flavor asks for."
        />
        <GoldenMetricTile
          title="Disk"
          icon={IconProp.Database}
          iconColor="amber"
          value={
            row.diskCapacityBytes === undefined ||
            row.diskCapacityBytes === null
              ? "—"
              : formatOpenStackBytes(row.diskCapacityBytes)
          }
          description="What an instance of this flavor asks for, on its hypervisor's local disk."
        />
        <GoldenMetricTile
          title="Instances"
          icon={IconProp.Cube}
          iconColor="sky"
          value={
            instances.data === null ? "—" : translator.formatNumber(instances.data)
          }
          sublabel="of this flavor"
          description="How many instances this credential can see that are this flavor."
        />
      </div>

      <ResourcePartDetailsCard
        testId="openstack-flavor-details"
        description="What Nova reports about this flavor."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudFlavorDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Flavor);
  const isPublic: unknown = part.row
    ? getOpenStackFact(part.row, "isPublic")
    : undefined;

  const badges: Array<ResourcePartBadge> =
    isPublic === undefined
      ? []
      : [
          {
            key: "visibility",
            label: isPublic === true ? "Public" : "Private",
            tone: "neutral",
          },
        ];

  return (
    <OpenStackPartPage
      part={part}
      hero={{ badges }}
      overview={(row: OpenStackResource): ReactElement => {
        return <FlavorOverview part={part} row={row} />;
      }}
      tabs={(row: OpenStackResource): Array<Tab> => {
        return [
          {
            name: "Instances",
            children: (
              <OpenStackInstanceList
                openStackCloudId={part.openStackCloudId}
                query={flavorInstanceQuery(row)}
                tableId="openstack-flavor-instances-table"
                title="Instances of this flavor"
                description="Every instance of this flavor this credential can see, a page at a time."
                emptyTitle="No instances of this flavor"
                emptyDescription="Nothing uses this flavor, or this credential can't see what does. Only the Full view credential sees every project's."
              />
            ),
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudFlavorDetail;
