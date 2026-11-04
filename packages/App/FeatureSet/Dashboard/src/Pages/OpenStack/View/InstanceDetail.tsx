import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import { OpenStackVolumeList } from "../../../Components/OpenStack/OpenStackLists";
import { formatOpenStackBytes } from "../../../Components/OpenStack/OpenStackResourceList";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "../../../Components/OpenStack/Part/OpenStackPartActivity";
import OpenStackInstanceLinksCard from "../../../Components/OpenStack/Part/OpenStackInstanceLinksCard";
import OpenStackInstanceUsageTiles, {
  OpenStackInstanceUsageCharts,
} from "../../../Components/OpenStack/Part/OpenStackInstanceUsage";
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
import {
  fetchOpenStackComputeServiceOf,
  fetchOpenStackRow,
} from "../Utils/OpenStackPartData";
import {
  OPENSTACK_INSTANCE_ALERT_TEMPLATE_IDS,
  getOpenStackFlavorExternalId,
  getOpenStackHostGroupId,
  getOpenStackInstanceAddresses,
  getOpenStackPartExplanation,
  getOpenStackTimeInState,
  isOpenStackInstanceUnplaced,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One instance: its status in Nova's word, whose it is, where it runs and how long it has
 * been in its state. An instance that failed before it was placed has no hypervisor, which
 * is its story and not a gap.
 *
 * What neither collector says is said to be not collected, with where to look instead: an
 * instance's fixed addresses and its image. A failed instance's fault only comes from a
 * probe. The exporter's address labels are empty on a real cloud, and an empty cell would
 * read as an instance with no address.
 */

const LINK_CLASS_NAME: string =
  "text-indigo-600 hover:text-indigo-700 hover:underline";

const ADDRESSES_NOT_COLLECTED: string = translationKey(
  "Not collected: the agent's exporter leaves these empty. openstack server show {{id}} has them.",
);
const IMAGE_NOT_COLLECTED: string = translationKey(
  "Not collected: neither the agent's exporter nor a probe says which image an instance booted from. openstack server show {{id}} has it.",
);
const FAULT_NOT_COLLECTED: string = translationKey(
  "Not collected: only a probe reads what Nova recorded. openstack server show {{id}} has it.",
);

interface InstanceSurroundings {
  flavor: OpenStackResource | null;
  // What says its hypervisor is down.
  computeService: OpenStackResource | null;
}

const InstanceOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();
  const facts: JSONObject = (row.facts as JSONObject | undefined) || {};
  const flavorId: string = getOpenStackFactText(row, "flavorId");

  const around: OpenStackRead<InstanceSurroundings> =
    useOpenStackRead<InstanceSurroundings>(async () => {
      const [flavor, computeService]: [
        OpenStackResource | null,
        OpenStackResource | null,
      ] = await Promise.all([
        flavorId
          ? fetchOpenStackRow({
              openStackCloudId: part.openStackCloudId,
              kind: OpenStackResourceKind.Flavor,
              externalId: getOpenStackFlavorExternalId(
                row.regionName,
                flavorId,
              ),
            })
          : Promise.resolve(null),
        row.hypervisorName
          ? fetchOpenStackComputeServiceOf({
              openStackCloudId: part.openStackCloudId,
              hypervisorName: row.hypervisorName,
              regionName: row.regionName,
            })
          : Promise.resolve(null),
      ]);
      return { flavor, computeService };
    }, [part.externalId, part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [
      row,
      ...(around.data?.computeService ? [around.data.computeService] : []),
    ],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const flavor: OpenStackResource | null = around.data?.flavor || null;
  const timeInState: string = getOpenStackTimeInState(row, now);
  const addresses: ReturnType<typeof getOpenStackInstanceAddresses> =
    getOpenStackInstanceAddresses(row);
  const notCollected: (text: string) => ReactElement = (
    text: string,
  ): ReactElement => {
    return (
      <span className="text-gray-500">
        {translator.translateTemplate(text, { id: part.externalId })}
      </span>
    );
  };

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Instance ID",
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
      description: "The instance's status in Nova's own word.",
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
          className={LINK_CLASS_NAME}
        >
          <bdi>{row.openStackProjectId}</bdi>
        </Link>
      ),
    });
  }
  if (flavorId) {
    detailRows.push({
      key: "flavor",
      label: "Flavor",
      value: (
        <Link
          to={part.routes.getPartRoute(
            OpenStackResourceKind.Flavor,
            getOpenStackFlavorExternalId(row.regionName, flavorId),
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{flavor?.name || flavorId}</bdi>
        </Link>
      ),
    });
  }
  detailRows.push({
    key: "hypervisor",
    label: "Hypervisor",
    value: row.hypervisorName ? (
      <Link
        to={part.routes.getHypervisorRoute(row.regionName, row.hypervisorName)}
        className={LINK_CLASS_NAME}
      >
        <bdi>{row.hypervisorName}</bdi>
      </Link>
    ) : (
      <span className="text-gray-500">
        {translator.translateText("Not placed on a hypervisor")}
      </span>
    ),
  });
  if (row.availabilityZone) {
    detailRows.push({
      key: "zone",
      label: "Availability Zone",
      value: (
        <Link
          to={part.routes.getZoneRoute(
            getOpenStackHostGroupId(row.regionName, row.availabilityZone),
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{row.availabilityZone}</bdi>
        </Link>
      ),
    });
  }
  detailRows.push({
    key: "addresses",
    label: "Addresses",
    value: addresses.isKnown
      ? [addresses.ipv4, addresses.ipv6]
          .filter((address: string): boolean => {
            return Boolean(address);
          })
          .join(", ")
      : notCollected(ADDRESSES_NOT_COLLECTED),
  });
  detailRows.push({
    key: "image",
    label: "Image",
    value: notCollected(IMAGE_NOT_COLLECTED),
  });
  if (row.status === "ERROR") {
    detailRows.push({
      key: "fault",
      label: "Why it failed",
      value:
        typeof facts["faultMessage"] === "string"
          ? (facts["faultMessage"] as string)
          : notCollected(FAULT_NOT_COLLECTED),
    });
  }
  if (typeof facts["taskState"] === "string") {
    detailRows.push({
      key: "task-state",
      label: "Task",
      value: facts["taskState"] as string,
      description: "What Nova says it is doing. Only a probe reads this.",
    });
  }
  if (typeof facts["libvirtName"] === "string") {
    detailRows.push({
      key: "libvirt-name",
      label: "libvirt name",
      value: facts["libvirtName"] as string,
      mono: true,
      copyText: facts["libvirtName"] as string,
    });
  }
  if (typeof facts["userId"] === "string") {
    detailRows.push({
      key: "user",
      label: "User ID",
      value: facts["userId"] as string,
      mono: true,
    });
  }

  return (
    <div data-testid="openstack-instance-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-instance-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-instance-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Instance}/${part.externalId}`,
          label: translationKey("This instance"),
        }}
        description="What about this instance, and the host it runs on, is broken or needs a look."
        error={around.error}
        onRetry={around.reload}
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="openstack-instance-tiles"
      >
        <GoldenMetricTile
          title="In state for"
          icon={IconProp.Clock}
          iconColor="slate"
          value={timeInState || "—"}
          sublabel={row.status ? undefined : "Not reported"}
          description="How long since OneUptime saw this instance's status change. One already in this state when OneUptime first saw it counts from then."
        />
        {flavor ? (
          <GoldenMetricTile
            title="vCPUs"
            icon={IconProp.ChartBar}
            iconColor="blue"
            value={
              flavor.vcpuCapacity === undefined || flavor.vcpuCapacity === null
                ? "—"
                : translator.formatNumber(flavor.vcpuCapacity)
            }
            sublabel="from its flavor"
            description="What this instance's flavor asks for. This is what is promised, not how busy it is."
          />
        ) : (
          <></>
        )}
        {flavor ? (
          <GoldenMetricTile
            title="Memory"
            icon={IconProp.SquareStack}
            iconColor="violet"
            value={
              flavor.memoryCapacityBytes === undefined ||
              flavor.memoryCapacityBytes === null
                ? "—"
                : formatOpenStackBytes(flavor.memoryCapacityBytes)
            }
            sublabel="from its flavor"
            description="What this instance's flavor asks for. This is what is promised, not what is in use."
          />
        ) : (
          <></>
        )}
        {flavor ? (
          <GoldenMetricTile
            title="Disk"
            icon={IconProp.Database}
            iconColor="amber"
            value={
              flavor.diskCapacityBytes === undefined ||
              flavor.diskCapacityBytes === null
                ? "—"
                : formatOpenStackBytes(flavor.diskCapacityBytes)
            }
            sublabel="from its flavor"
            description="What this instance's flavor asks for. A boot-from-volume instance's disk is its volume instead."
          />
        ) : (
          <></>
        )}
      </div>

      <OpenStackInstanceUsageTiles part={part} row={row} flavor={flavor} />

      <OpenStackInstanceLinksCard
        openStackCloudId={part.openStackCloudId}
        instanceId={part.externalId}
        refreshToken={part.refreshToken}
      />

      <OpenStackPartOpenEvents
        testId="openstack-instance-open"
        title="Open on this instance"
        description="Unresolved incidents and alerts about this instance, incidents first."
        part={part}
        row={row}
      />

      <OpenStackPartAlerts
        testId="openstack-instance-alerts"
        title="Instance alerts"
        description="The cloud's alerts that watch every instance, this one included: each is one monitor on the cloud."
        templateIds={OPENSTACK_INSTANCE_ALERT_TEMPLATE_IDS}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-instance-details"
        description="What Nova reports about this instance, and what it doesn't."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudInstanceDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Instance);
  const row: OpenStackResource | null = part.row;

  const cloudLink: ReactElement = (
    <Link
      to={part.routes.cloudRoute}
      className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
    >
      {part.cloudName}
    </Link>
  );

  return (
    <OpenStackPartPage
      part={part}
      hero={{
        location: row?.hypervisorName ? (
          <TranslatedSentence
            template="On hypervisor {{hypervisor}} of cloud {{cloud}}"
            slots={{
              hypervisor: (
                <Link
                  to={part.routes.getHypervisorRoute(
                    row.regionName,
                    row.hypervisorName,
                  )}
                  className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  <bdi>{row.hypervisorName}</bdi>
                </Link>
              ),
              cloud: cloudLink,
            }}
          />
        ) : row && isOpenStackInstanceUnplaced(row) ? (
          <TranslatedSentence
            template="Not placed on a hypervisor, in cloud {{cloud}}"
            slots={{ cloud: cloudLink }}
          />
        ) : undefined,
      }}
      overview={(overviewRow: OpenStackResource): ReactElement => {
        return <InstanceOverview part={part} row={overviewRow} />;
      }}
      tabs={(): Array<Tab> => {
        const facts: JSONObject = { attachedToInstance: part.externalId };
        return [
          {
            name: "Usage",
            children: <OpenStackInstanceUsageCharts part={part} />,
          },
          {
            name: "Volumes",
            children: (
              <OpenStackVolumeList
                openStackCloudId={part.openStackCloudId}
                query={{ facts: facts }}
                tableId="openstack-instance-volumes-table"
                title="Attached volumes"
                description="The Cinder volumes attached to this instance."
                emptyTitle="No volumes attached"
                emptyDescription="Cinder says no volume is attached to this instance, or this credential can't see the ones that are. Only the Full view credential sees every project's."
              />
            ),
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudInstanceDetail;
