import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { getOpenStackLoadBalancersWithTwoMasters } from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import OpenStackServicePartOverview from "../../../Components/OpenStack/Part/OpenStackServicePartOverview";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import { ResourcePartDetailRow } from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { fetchOpenStackRows } from "../Utils/OpenStackPartData";
import {
  OPENSTACK_LOAD_BALANCER_ALERT_TEMPLATE_IDS,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Octavia load balancer: its provisioning status and its operating status, which are different
 * questions, its pools and amphorae, and whose it is. A load balancer in ERROR says nothing here of
 * why, since nothing OneUptime reads does: Octavia's worker log does. Its listeners and members are
 * not collected, because the exporter has no series for them.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "Nothing OneUptime reads says why a load balancer failed. Run openstack loadbalancer show for this one, and read octavia-worker's log for the request: Nova refusing the amphora is the usual cause.",
);

// More than a cloud's load balancer has, and bounded so the page reads the same on a big cloud.
const RELATED_ROWS_READ: number = 200;

interface Related {
  pools: Array<OpenStackResource>;
  amphorae: Array<OpenStackResource>;
}

function idsOfPool(pool: OpenStackResource): Array<string> {
  const ids: unknown = (pool.facts as JSONObject | undefined)?.[
    "loadBalancerIds"
  ];
  return Array.isArray(ids) ? (ids as Array<string>) : [];
}

const LoadBalancerOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const { part } = props;

  const related: OpenStackRead<Related> =
    useOpenStackRead<Related>(async (): Promise<Related> => {
      const [pools, amphorae] = await Promise.all([
        fetchOpenStackRows({
          openStackCloudId: part.openStackCloudId,
          kind: OpenStackResourceKind.LoadBalancerPool,
          limit: RELATED_ROWS_READ,
        }),
        fetchOpenStackRows({
          openStackCloudId: part.openStackCloudId,
          kind: OpenStackResourceKind.Amphora,
          limit: RELATED_ROWS_READ,
        }),
      ]);
      return {
        pools: pools.filter((pool: OpenStackResource): boolean => {
          return idsOfPool(pool).includes(part.externalId);
        }),
        amphorae: amphorae.filter((amphora: OpenStackResource): boolean => {
          return (
            getOpenStackFactText(amphora, "loadBalancerId") === part.externalId
          );
        }),
      };
    }, [part.externalId, part.refreshToken]);

  const pools: Array<OpenStackResource> = related.data?.pools || [];
  const amphorae: Array<OpenStackResource> = related.data?.amphorae || [];

  /*
   * A row alone can't say its load balancer has two masters, and its amphorae are here, so this page
   * says it by the same line Needs attention does (OpenStackResourceService.getAttentionRows).
   */
  const masters: number = getOpenStackLoadBalancersWithTwoMasters(
    amphorae.map((amphora: OpenStackResource) => {
      return {
        status: amphora.status,
        loadBalancerId: getOpenStackFactText(amphora, "loadBalancerId"),
        role: getOpenStackFactText(amphora, "role"),
      };
    }),
  ).includes(part.externalId)
    ? amphorae.filter((amphora: OpenStackResource): boolean => {
        return (
          amphora.status === "ALLOCATED" &&
          getOpenStackFactText(amphora, "role") === "MASTER"
        );
      }).length
    : 0;

  const row: OpenStackResource = Object.assign(
    new OpenStackResource(),
    props.row,
    {
      facts: {
        ...((props.row.facts as JSONObject | undefined) || {}),
        masterAmphoraCount: masters,
      },
    },
  );

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Load Balancer ID",
      value: part.externalId,
      mono: true,
      copyText: part.externalId,
    },
  ];
  if (row.status) {
    detailRows.push({
      key: "provisioning-status",
      label: "Provisioning Status",
      value: row.status,
      description:
        "Octavia's work on this load balancer, in its own word: ACTIVE, PENDING_UPDATE, ERROR.",
    });
  }
  const operating: string = getOpenStackFactText(row, "operatingStatus");
  if (operating) {
    detailRows.push({
      key: "operating-status",
      label: "Operating Status",
      value: operating,
      description:
        "What its health checks make of it. A different question from provisioning: it provisions ACTIVE while every member behind it is down.",
    });
  }
  const provider: string = getOpenStackFactText(row, "provider");
  if (provider) {
    detailRows.push({
      key: "provider",
      label: "Provider",
      value: provider,
      description:
        "amphora runs it in virtual machines; ovn runs it in the network itself, with no amphora and no traffic counters.",
    });
  }
  const vip: string = getOpenStackFactText(row, "vipAddress");
  if (vip) {
    detailRows.push({
      key: "vip",
      label: "VIP Address",
      value: vip,
      mono: true,
      copyText: vip,
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
          description: "The project that owns this load balancer.",
        }
      : { key: "project", label: "Project", value: "—" },
  );
  if (row.regionName) {
    detailRows.push({
      key: "region",
      label: "Region",
      value: row.regionName,
    });
  }
  if (related.data) {
    detailRows.push({
      key: "pools",
      label: "Pools",
      value:
        pools.length === 0 ? (
          "—"
        ) : (
          <span className="flex flex-col gap-1">
            {pools.map((pool: OpenStackResource): ReactElement => {
              return (
                <Link
                  key={pool.externalId}
                  to={part.routes.getPartRoute(
                    OpenStackResourceKind.LoadBalancerPool,
                    pool.externalId as string,
                  )}
                  className="text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  <bdi>{pool.name || pool.externalId}</bdi>
                </Link>
              );
            })}
          </span>
        ),
      description:
        "The pools behind it. Their members and the listeners in front aren't collected: the exporter has no series for them.",
    });
    if (provider !== "ovn") {
      detailRows.push({
        key: "amphorae",
        label: "Amphorae",
        value:
          amphorae.length === 0 ? (
            "—"
          ) : (
            <span className="flex flex-col gap-1">
              {amphorae.map((amphora: OpenStackResource): ReactElement => {
                return (
                  <Link
                    key={amphora.externalId}
                    to={part.routes.getPartRoute(
                      OpenStackResourceKind.Amphora,
                      amphora.externalId as string,
                    )}
                    className="text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    <bdi>
                      {getOpenStackFactText(amphora, "role")}{" "}
                      {amphora.externalId}
                    </bdi>
                  </Link>
                );
              })}
            </span>
          ),
        description:
          "The virtual machines it runs in. Only an admin may list amphorae, so a lower credential sees none here.",
      });
    }
  }

  return (
    <OpenStackServicePartOverview
      part={part}
      row={row}
      service={OpenStackServiceType.LoadBalancer}
      slug="load-balancer"
      alertTemplateIds={OPENSTACK_LOAD_BALANCER_ALERT_TEMPLATE_IDS}
      detailRows={detailRows}
      whyNotKnown={WHY_NOT_KNOWN}
      words={{
        thisOne: translationKey("This load balancer"),
        attentionDescription: translationKey(
          "What about this load balancer is broken or needs a look.",
        ),
        openTitle: translationKey("Open on this load balancer"),
        openDescription: translationKey(
          "Unresolved incidents and alerts about this load balancer, incidents first.",
        ),
        alertsTitle: translationKey("Load balancer alerts"),
        alertsDescription: translationKey(
          "The cloud's alerts that watch every load balancer, this one included: each is one monitor on the cloud.",
        ),
        detailsDescription: translationKey(
          "What Octavia reports about this load balancer.",
        ),
      }}
      tiles={
        <>
          <GoldenMetricTile
            title="Operating status"
            icon={IconProp.Activity}
            iconColor={
              operating === "ERROR" || operating === "OFFLINE"
                ? "amber"
                : operating === "DEGRADED"
                  ? "amber"
                  : "emerald"
            }
            value={operating || "—"}
            description="What its health checks make of it, in Octavia's word. Provisioning can read ACTIVE while this reads ERROR."
          />
          <GoldenMetricTile
            title="In state for"
            icon={IconProp.Clock}
            iconColor="slate"
            value={
              getOpenStackTimeInState(row, OneUptimeDate.getCurrentDate()) ||
              "—"
            }
            description="How long since OneUptime saw this load balancer's provisioning status change. One already in this state when OneUptime first saw it counts from then."
          />
        </>
      }
    />
  );
};

const OpenStackCloudLoadBalancerDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.LoadBalancer,
  );

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        return <LoadBalancerOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudLoadBalancerDetail;
