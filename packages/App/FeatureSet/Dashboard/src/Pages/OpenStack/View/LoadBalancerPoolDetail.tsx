import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import { fetchOpenStackRows } from "../Utils/OpenStackPartData";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import OpenStackServicePartOverview from "../../../Components/OpenStack/Part/OpenStackServicePartOverview";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import { ResourcePartDetailRow } from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import {
  OPENSTACK_POOL_ALERT_TEMPLATE_IDS,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One pool behind a load balancer. Its operating status is what its members' health checks say, and
 * the only place a pool with every member down shows: it provisions ACTIVE, recorded. Which members it
 * has and which of them fail isn't collected, since the exporter has no series for members, so the
 * page says what to run.
 */

const MEMBERS_NOT_KNOWN: string = translationKey(
  "Which members this pool has, and which of them fail their health check, isn't collected: the exporter has no series for members. Run openstack loadbalancer member list for this pool.",
);

/*
 * A pool's members, from the rows a probe sends. The exporter has no series for members, so on a cloud
 * the agent collects there are none, and the page says what to run instead.
 */
const PoolMembers: FunctionComponent<{ part: OpenStackPart }> = (props: {
  part: OpenStackPart;
}): ReactElement => {
  const members: OpenStackRead<Array<OpenStackResource>> = useOpenStackRead<
    Array<OpenStackResource>
  >(async (): Promise<Array<OpenStackResource>> => {
    const rows: Array<OpenStackResource> = await fetchOpenStackRows({
      openStackCloudId: props.part.openStackCloudId,
      kind: OpenStackResourceKind.LoadBalancerMember,
      limit: 500,
    });
    return rows.filter((row: OpenStackResource): boolean => {
      return getOpenStackFactText(row, "poolId") === props.part.externalId;
    });
  }, [props.part.externalId, props.part.refreshToken]);

  if (!members.data || members.data.length === 0) {
    return (
      <OpenStackPartNotice
        testId="openstack-load-balancer-pool-members-note"
        text={MEMBERS_NOT_KNOWN}
      />
    );
  }

  return (
    <ul
      className="mb-6 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white"
      data-testid="openstack-load-balancer-pool-members"
    >
      {members.data.map((member: OpenStackResource): ReactElement => {
        const operating: string = getOpenStackFactText(
          member,
          "operatingStatus",
        );
        return (
          <li
            key={member.externalId}
            className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
            data-testid="openstack-load-balancer-pool-member"
          >
            <bdi className="font-medium text-gray-900">
              {member.name || member.externalId}
            </bdi>
            <bdi className="text-xs text-gray-500">
              {getOpenStackFactText(member, "address")}:
              {getOpenStackFactText(member, "protocolPort")}
            </bdi>
            <bdi
              className={
                operating === "ERROR" || operating === "OFFLINE"
                  ? "text-xs font-medium text-red-700"
                  : operating === "ONLINE"
                    ? "text-xs text-emerald-700"
                    : "text-xs text-amber-700"
              }
            >
              {operating}
            </bdi>
          </li>
        );
      })}
    </ul>
  );
};

const OpenStackCloudLoadBalancerPoolDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.LoadBalancerPool,
  );

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        const operating: string = getOpenStackFactText(row, "operatingStatus");
        const ids: unknown = (row.facts as JSONObject | undefined)?.[
          "loadBalancerIds"
        ];
        const loadBalancerIds: Array<string> = Array.isArray(ids)
          ? (ids as Array<string>)
          : [];
        const detailRows: Array<ResourcePartDetailRow> = [
          {
            key: "id",
            label: "Pool ID",
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
            description: "Octavia's work on this pool, in its own word.",
          });
        }
        if (operating) {
          detailRows.push({
            key: "operating-status",
            label: "Operating Status",
            value: operating,
            description:
              "What its members' health checks make of it: ERROR means every member fails, DEGRADED that some do.",
          });
        }
        const protocol: string = getOpenStackFactText(row, "protocol");
        if (protocol) {
          detailRows.push({
            key: "protocol",
            label: "Protocol",
            value: protocol,
          });
        }
        const algorithm: string = getOpenStackFactText(row, "algorithm");
        if (algorithm) {
          detailRows.push({
            key: "algorithm",
            label: "Algorithm",
            value: algorithm,
          });
        }
        detailRows.push({
          key: "load-balancers",
          label: "Load Balancer",
          value:
            loadBalancerIds.length === 0 ? (
              "—"
            ) : (
              <span className="flex flex-col gap-1">
                {loadBalancerIds.map((loadBalancerId: string): ReactElement => {
                  return (
                    <Link
                      key={loadBalancerId}
                      to={part.routes.getPartRoute(
                        OpenStackResourceKind.LoadBalancer,
                        loadBalancerId,
                      )}
                      className="text-indigo-600 hover:text-indigo-700 hover:underline"
                    >
                      <bdi>{loadBalancerId}</bdi>
                    </Link>
                  );
                })}
              </span>
            ),
        });
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
            : { key: "project", label: "Project", value: "—" },
        );
        if (row.regionName) {
          detailRows.push({
            key: "region",
            label: "Region",
            value: row.regionName,
          });
        }

        return (
          <OpenStackServicePartOverview
            part={part}
            row={row}
            service={OpenStackServiceType.LoadBalancer}
            slug="load-balancer-pool"
            alertTemplateIds={OPENSTACK_POOL_ALERT_TEMPLATE_IDS}
            detailRows={detailRows}
            words={{
              thisOne: translationKey("This pool"),
              attentionDescription: translationKey(
                "What about this pool is broken or needs a look.",
              ),
              openTitle: translationKey("Open on this pool"),
              openDescription: translationKey(
                "Unresolved incidents and alerts about this pool, incidents first.",
              ),
              alertsTitle: translationKey("Pool alerts"),
              alertsDescription: translationKey(
                "The cloud's alert that watches every pool, this one included: it is one monitor on the cloud.",
              ),
              detailsDescription: translationKey(
                "What Octavia reports about this pool.",
              ),
            }}
            tiles={
              <>
                <GoldenMetricTile
                  title="Operating status"
                  icon={IconProp.Activity}
                  iconColor={
                    operating === "ERROR"
                      ? "amber"
                      : operating === "DEGRADED"
                        ? "amber"
                        : "emerald"
                  }
                  value={operating || "—"}
                  description="What its members' health checks make of it, in Octavia's word."
                />
                <GoldenMetricTile
                  title="In state for"
                  icon={IconProp.Clock}
                  iconColor="slate"
                  value={
                    getOpenStackTimeInState(
                      row,
                      OneUptimeDate.getCurrentDate(),
                    ) || "—"
                  }
                  description="How long since OneUptime saw this pool's provisioning status change."
                />
              </>
            }
          >
            <PoolMembers part={part} />
          </OpenStackServicePartOverview>
        );
      }}
    />
  );
};

export default OpenStackCloudLoadBalancerPoolDetail;
