import PageComponentProps from "../../PageComponentProps";
import Host from "Common/Models/DatabaseModels/Host";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { readOpenStackInventories } from "Common/Types/OpenStack/OpenStackCapacity";
import {
  canOpenStackBareMetalNodeTakeAnInstance,
  isOpenStackBareMetalNodeInError,
  isOpenStackBareMetalNodeInMaintenance,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackBareMetalNotices from "../../../Components/OpenStack/OpenStackBareMetalNotices";
import OpenStackBlastRadiusCard from "../../../Components/OpenStack/Part/OpenStackBlastRadiusCard";
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
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getOpenStackAttentionItems,
  getOpenStackBareMetalPowerState,
} from "../Utils/OpenStackHealth";
import {
  fetchOpenStackHostOf,
  fetchOpenStackRow,
  fetchOpenStackRows,
} from "../Utils/OpenStackPartData";
import {
  OPENSTACK_BARE_METAL_NODE_ALERT_TEMPLATE_IDS,
  getOpenStackPartExplanation,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import {
  getOpenStackFact,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

/*
 * One machine Ironic manages: where it stands, what someone said about it, and what it would take with
 * it. Only a probe reads Ironic's API, so only there does a page know its driver, its conductor, or
 * why it failed. A page says which, rather than leaving a blank to be read as nothing wrong.
 */
const LINK_CLASS_NAME: string =
  "text-indigo-600 hover:text-indigo-700 hover:underline";

// The cloud runs Ironic, since this node is in it: so its alerts are on offer.
const REPORTS_IRONIC: { openStackServices: Array<string> } = {
  openStackServices: [OpenStackServiceType.BareMetal],
};

const NO_REASON_FROM_THE_EXPORTER: string = translationKey(
  "The agent's exporter doesn't carry why a node failed, and Ironic can empty its last_error within about a minute. Run openstack baremetal node show for this node straight away, then look in the conductor's log. A probe reads last_error and keeps the last one it saw.",
);

const STOPPED_NOTICE: string = translationKey(
  "This node's power is off because someone stopped the instance on it, which is planned. An alert reads one series and can't tell: Bare Metal Power State Unexpected fires for this too.",
);

const MAINTENANCE_NOTICE: string = translationKey(
  "Someone put this node in maintenance, which is planned, so nothing says it needs attention until it has been there a week.",
);

const REASON_EMPTIED: string = translationKey(
  "Ironic has emptied last_error since, which it can do within about a minute, so this is what it last said while this was read.",
);

const HALF_ENROLLED_NOTICE: string = translationKey(
  "This node is still in enroll, so nothing will be scheduled on it. It breaks nothing while it waits: move it on with openstack baremetal node manage once its driver details are in.",
);

const NO_CLASS_NOTICE: string = translationKey(
  "This node has no resource class, so no flavor can ask for it. Set one with openstack baremetal node set.",
);

const NOT_ON_PLACEMENT_NOTICE: string = translationKey(
  "Placement holds nothing for this node yet. Nova finds a new node on its next periodic, about a minute, and only one with a resource class.",
);

interface BareMetalReads {
  instance: OpenStackResource | null;
  provider: OpenStackResource | null;
  // OneUptime's agent on this machine, if a node's name is a host's, and only one's.
  host: Host | null;
}

function factText(row: OpenStackResource, name: string): string {
  return getOpenStackFactText(row, name);
}

const WORDS_YES: string = translationKey("Yes");
const WORDS_NO: string = translationKey("No");
const WORDS_NONE: string = translationKey("None");
const WORDS_POWER_NOT_KNOWN: string = translationKey(
  "Not known: nothing has set it yet",
);

function dateText(value: string): string {
  return value
    ? OneUptimeDate.getDateAsLocalFormattedString(new Date(value))
    : "";
}

const NodeOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const say: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();
  const isFromProbe: boolean = Boolean(factText(row, "driver"));
  const nodeId: string = part.externalId;

  /*
   * Nova names a node's instance's hypervisor by the node's UUID, and a probe also says it from
   * Ironic's side. What Placement holds of it is its own row, keyed by region. No recording holds
   * an instance on a node yet, so this join is from Nova's driver's source.
   */
  const reads: OpenStackRead<BareMetalReads> =
    useOpenStackRead<BareMetalReads>(async () => {
      const [instances, provider, host]: [
        Array<OpenStackResource>,
        OpenStackResource | null,
        Host | null,
      ] = await Promise.all([
        fetchOpenStackRows({
          openStackCloudId: part.openStackCloudId,
          kind: OpenStackResourceKind.Instance,
          query: { hypervisorName: nodeId },
          limit: 1,
        }),
        fetchOpenStackRow({
          openStackCloudId: part.openStackCloudId,
          kind: OpenStackResourceKind.PlacementProvider,
          externalId: `${row.regionName || "default"}/${nodeId}`,
        }),
        // Supplementary: the page says the same of the node, with or without its host.
        row.name
          ? fetchOpenStackHostOf({
              openStackCloudId: part.openStackCloudId,
              machineName: row.name,
            }).catch((): null => {
              return null;
            })
          : Promise.resolve(null),
      ]);
      return { instance: instances[0] || null, provider, host };
    }, [nodeId, part.refreshToken]);

  const instance: OpenStackResource | null = reads.data?.instance || null;
  const instanceId: string =
    instance?.externalId || factText(row, "instanceId");

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
    instanceStatusOnNodeFor: (): string | undefined => {
      return instance?.status;
    },
  });

  const explanation: string | null =
    attention.length > 0 ? getOpenStackPartExplanation(row, now) : null;

  const powerState: string | null = getOpenStackBareMetalPowerState(row);
  const isInMaintenance: boolean = isOpenStackBareMetalNodeInMaintenance(
    row.adminState,
  );
  const lastError: string = factText(row, "lastError");
  const lastErrorReadAt: string = factText(row, "lastErrorReadAt");
  const resourceClass: string = factText(row, "resourceClass");
  const isFailed: boolean = isOpenStackBareMetalNodeInError(row.status);
  const isStopped: boolean =
    row.status === "active" &&
    powerState === "power off" &&
    instance?.status === "SHUTOFF";

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "provision-state",
      label: "Provision State",
      value: row.status || "",
      description: "Where Ironic has this node in its state machine.",
    },
    {
      key: "time-in-state",
      label: "In This State For",
      value: getOpenStackTimeInState(row, now),
    },
    {
      key: "power-state",
      label: "Power State",
      value: powerState || say(WORDS_POWER_NOT_KNOWN),
      description:
        "An empty power state is what Ironic reads until something has set it, and Nova won't schedule on one.",
    },
    {
      key: "can-take-an-instance",
      label: "Can Take an Instance",
      value: say(
        canOpenStackBareMetalNodeTakeAnInstance({
          status: row.status,
          adminState: row.adminState,
          powerState,
          isRetired: getOpenStackFact(row, "isRetired") === true,
        })
          ? WORDS_YES
          : WORDS_NO,
      ),
      description:
        "What Nova's Ironic driver asks: in available, out of maintenance, with a power state it can read, and not retired.",
    },
    {
      key: "maintenance",
      label: "Maintenance",
      value: say(isInMaintenance ? WORDS_YES : WORDS_NO),
    },
  ];

  if (row.disabledReason) {
    detailRows.push({
      key: "maintenance-reason",
      label: "Maintenance Reason",
      value: <bdi>{row.disabledReason}</bdi>,
      description: "In the words of whoever, or whatever, put it there.",
    });
  }

  detailRows.push({
    key: "resource-class",
    label: "Resource Class",
    value: resourceClass || say(WORDS_NONE),
    description: "What a flavor asks for to be put on this node.",
  });

  if (getOpenStackFact(row, "isRetired") === true) {
    detailRows.push({
      key: "retired",
      label: "Retired",
      value: factText(row, "retiredReason") || say(WORDS_YES),
    });
  }

  const addIfSaid: (key: string, label: string, value: string) => void = (
    key: string,
    label: string,
    value: string,
  ): void => {
    if (value) {
      detailRows.push({ key, label, value: <bdi>{value}</bdi> });
    }
  };

  addIfSaid("driver", "Driver", factText(row, "driver"));
  addIfSaid("conductor", "Conductor", factText(row, "conductor"));
  addIfSaid(
    "conductor-group",
    "Conductor Group",
    factText(row, "conductorGroup"),
  );
  addIfSaid(
    "target-provision-state",
    "Going To (Provision)",
    factText(row, "targetProvisionState"),
  );
  addIfSaid(
    "target-power-state",
    "Going To (Power)",
    factText(row, "targetPowerState"),
  );
  addIfSaid("fault", "Fault", factText(row, "fault"));

  if (instanceId) {
    detailRows.push({
      key: "instance",
      label: "Instance",
      value: (
        <Link
          to={part.routes.getPartRoute(
            OpenStackResourceKind.Instance,
            instanceId,
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{instance?.name || instanceId}</bdi>
        </Link>
      ),
    });
  }

  if (reads.data?.host?.id) {
    detailRows.push({
      key: "host",
      label: "Host",
      description:
        "OneUptime's agent on this machine, when exactly one host goes by this node's name.",
      value: (
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOST_VIEW] as Route,
            { modelId: reads.data.host.id },
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{reads.data.host.name || reads.data.host.hostIdentifier}</bdi>
        </Link>
      ),
    });
  }

  if (row.openStackProjectId) {
    detailRows.push({
      key: "owner",
      label: "Owner",
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

  addIfSaid(
    "provision-updated-at",
    "Provision State Last Moved",
    dateText(factText(row, "provisionUpdatedAt")),
  );
  addIfSaid(
    "node-updated-at",
    "Record Last Changed",
    dateText(factText(row, "nodeUpdatedAt")),
  );

  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  detailRows.push({
    key: "id",
    label: "Node ID",
    value: nodeId,
    mono: true,
    copyText: nodeId,
  });

  const placementRows: Array<ResourcePartDetailRow> = [];

  if (reads.data?.provider) {
    const inventories: ReturnType<typeof readOpenStackInventories> =
      readOpenStackInventories(reads.data.provider.facts);

    for (const resourceClassName of Object.keys(inventories).sort()) {
      const inventory: ReturnType<typeof readOpenStackInventories>[string] =
        inventories[resourceClassName]!;
      placementRows.push({
        key: resourceClassName,
        label: resourceClassName,
        value: translator.translateTemplate(
          "{{total}} in all, {{reserved}} reserved, {{used}} in use",
          {
            total: `${inventory.total}`,
            reserved: `${inventory.reserved}`,
            used: `${inventory.used}`,
          },
        ),
      });
    }
  }

  return (
    <div data-testid="openstack-bare-metal-node-overview">
      <OpenStackBareMetalNotices
        openStackCloudId={part.openStackCloudId}
        onlyWhatChangesThisRow={true}
      />

      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-node-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      {isStopped ? (
        <OpenStackPartNotice testId="openstack-bare-metal-node-stopped">
          {say(STOPPED_NOTICE)}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {isInMaintenance && attention.length === 0 ? (
        <OpenStackPartNotice testId="openstack-bare-metal-node-maintenance">
          {say(MAINTENANCE_NOTICE)}
          {row.disabledReason ? (
            <>
              {" "}
              <bdi>{row.disabledReason}</bdi>
            </>
          ) : (
            <></>
          )}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {row.status === "enroll" ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-node-enroll"
          text={HALF_ENROLLED_NOTICE}
        />
      ) : !resourceClass ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-node-no-class"
          text={NO_CLASS_NOTICE}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-bare-metal-node-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.BareMetalNode}/${nodeId}`,
          label: translationKey("This node"),
        }}
        description="What about this node is broken or needs a look."
      />

      {isFailed && !lastError ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-node-no-reason"
          text={NO_REASON_FROM_THE_EXPORTER}
        />
      ) : (
        <></>
      )}

      {lastError ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-node-last-error"
          tone={isFailed ? "warning" : "neutral"}
        >
          <div className="font-medium">
            {translator.translateTemplate(
              "What Ironic last said, at {{time}}",
              {
                time: dateText(lastErrorReadAt),
              },
            )}
          </div>
          <bdi className="break-words">{lastError}</bdi>
          {isFromProbe ? (
            <div className="mt-1 text-xs">{say(REASON_EMPTIED)}</div>
          ) : (
            <></>
          )}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      <OpenStackPartOpenEvents
        testId="openstack-bare-metal-node-open"
        title="Open on this node"
        description="Unresolved incidents and alerts about this node, incidents first."
        part={part}
        row={row}
      />

      <OpenStackBlastRadiusCard
        testId="openstack-bare-metal-node-blast"
        openStackCloudId={part.openStackCloudId}
        kind={OpenStackResourceKind.BareMetalNode}
        externalId={nodeId}
        routes={part.routes}
        description="The instance Nova has on this node, and whose it is."
        refreshToken={part.refreshToken}
      />

      <OpenStackPartAlerts
        testId="openstack-bare-metal-node-alerts"
        title="Node alerts"
        description="The cloud's alerts that watch every node, this one included: each is one monitor, with one incident per node."
        templateIds={OPENSTACK_BARE_METAL_NODE_ALERT_TEMPLATE_IDS}
        part={part}
        context={REPORTS_IRONIC}
      />

      <ResourcePartDetailsCard
        testId="openstack-bare-metal-node-details"
        description={
          isFromProbe
            ? "What Ironic's API reports about this node."
            : "What the agent's exporter reports about this node. Its driver and conductor are only in Ironic's API, which a probe reads."
        }
        rows={detailRows}
      />

      {reads.isLoading || reads.error ? (
        <></>
      ) : placementRows.length > 0 ? (
        <ResourcePartDetailsCard
          testId="openstack-bare-metal-node-placement"
          title="What Placement holds"
          description="What Nova's scheduler goes by. Nova reserves all of a node it can't use, whatever Ironic says of it."
          rows={placementRows}
        />
      ) : (
        <OpenStackPartNotice
          testId="openstack-bare-metal-node-not-on-placement"
          text={NOT_ON_PLACEMENT_NOTICE}
        />
      )}
    </div>
  );
};

const OpenStackCloudBareMetalNodeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.BareMetalNode,
  );

  const badges: Array<ResourcePartBadge> = [];

  if (part.row) {
    if (isOpenStackBareMetalNodeInMaintenance(part.row.adminState)) {
      badges.push({
        key: "maintenance",
        label: translator.translateText("In maintenance") || "In maintenance",
        tone: "warning",
      });
    }
    const resourceClass: string = factText(part.row, "resourceClass");
    if (resourceClass) {
      badges.push({
        key: "resource-class",
        label: resourceClass,
        tone: "neutral",
      });
    }
  }

  return (
    <OpenStackPartPage
      part={part}
      hero={{ badges }}
      overview={(row: OpenStackResource): ReactElement => {
        return <NodeOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudBareMetalNodeDetail;
