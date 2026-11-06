import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { getOpenStackAmphoraCertificateDaysLeft } from "Common/Types/OpenStack/OpenStackHealthRules";
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
import { ResourcePartDetailRow } from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { assessOpenStackAmphora } from "../Utils/OpenStackHealth";
import { OPENSTACK_AMPHORA_ALERT_TEMPLATE_IDS } from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";
import { ResourceAttentionSeverity } from "../../../Components/ResourcePart/ResourceAttention";

/*
 * One amphora: the virtual machine a load balancer runs in. It has no name or project of its own, so
 * its page says its role, the load balancer it carries, the instance it runs in, and when its
 * certificate ends. The certificate lasts 30 days from when it is built, recorded, and Octavia's
 * housekeeping renews it with 14 left by default, which is the line the page and the alert draw.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "Nothing OneUptime reads says why an amphora failed. Run openstack loadbalancer amphora show for this one, and read octavia-health-manager's log.",
);

const OpenStackCloudAmphoraDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Amphora);

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        const now: Date = OneUptimeDate.getCurrentDate();
        const certExpiresAt: string = getOpenStackFactText(
          row,
          "certExpiresAt",
        );
        const days: number | null = getOpenStackAmphoraCertificateDaysLeft({
          certExpiresAt,
          now,
        });
        const severity: ResourceAttentionSeverity | null =
          assessOpenStackAmphora({ row, now }).severity;
        const loadBalancerId: string = getOpenStackFactText(
          row,
          "loadBalancerId",
        );
        const computeId: string = getOpenStackFactText(row, "computeId");

        const detailRows: Array<ResourcePartDetailRow> = [
          {
            key: "id",
            label: "Amphora ID",
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
            description:
              "The amphora's status in Octavia's own word: ALLOCATED to a load balancer, READY in the spare pool, ERROR when the health manager could not replace it.",
          });
        }
        const role: string = getOpenStackFactText(row, "role");
        if (role) {
          detailRows.push({
            key: "role",
            label: "Role",
            value: role,
            description:
              "MASTER and BACKUP for an active-standby pair, STANDALONE for a load balancer on one amphora.",
          });
        }
        detailRows.push({
          key: "load-balancer",
          label: "Load Balancer",
          value: loadBalancerId ? (
            <Link
              to={part.routes.getPartRoute(
                OpenStackResourceKind.LoadBalancer,
                loadBalancerId,
              )}
              className="text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              <bdi>{loadBalancerId}</bdi>
            </Link>
          ) : (
            "—"
          ),
          description:
            "The load balancer it carries. A spare amphora waiting in the pool has none.",
        });
        detailRows.push({
          key: "instance",
          label: "Instance",
          value: computeId ? (
            <Link
              to={part.routes.getPartRoute(
                OpenStackResourceKind.Instance,
                computeId,
              )}
              className="text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              <bdi>{computeId}</bdi>
            </Link>
          ) : (
            "—"
          ),
          description:
            "The Nova instance it runs in. It sits in Octavia's own project, and the host it is on is that instance's page.",
        });
        if (certExpiresAt) {
          detailRows.push({
            key: "certificate",
            label: "Certificate Ends",
            value: <bdi>{certExpiresAt}</bdi>,
            mono: true,
            description:
              "When its certificate ends. Once it does, Octavia's controller can no longer reach the amphora.",
          });
        }
        const managementIp: string = getOpenStackFactText(row, "managementIp");
        if (managementIp) {
          detailRows.push({
            key: "management-ip",
            label: "Management Address",
            value: managementIp,
            mono: true,
            copyText: managementIp,
          });
        }
        const haIp: string = getOpenStackFactText(row, "haIp");
        if (haIp) {
          detailRows.push({
            key: "ha-ip",
            label: "VIP Address",
            value: haIp,
            mono: true,
            copyText: haIp,
          });
        }
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
            slug="amphora"
            alertTemplateIds={OPENSTACK_AMPHORA_ALERT_TEMPLATE_IDS}
            detailRows={detailRows}
            whyNotKnown={WHY_NOT_KNOWN}
            words={{
              thisOne: translationKey("This amphora"),
              attentionDescription: translationKey(
                "What about this amphora is broken or needs a look.",
              ),
              openTitle: translationKey("Open on this amphora"),
              openDescription: translationKey(
                "Unresolved incidents and alerts about this amphora, incidents first.",
              ),
              alertsTitle: translationKey("Amphora alerts"),
              alertsDescription: translationKey(
                "The cloud's alert that watches every amphora, this one included: it is one monitor on the cloud.",
              ),
              detailsDescription: translationKey(
                "What Octavia reports about this amphora.",
              ),
            }}
            tiles={
              <>
                <GoldenMetricTile
                  title="Certificate ends in"
                  icon={IconProp.Clock}
                  iconColor={
                    severity === ResourceAttentionSeverity.Critical
                      ? "amber"
                      : severity === ResourceAttentionSeverity.Warning
                        ? "amber"
                        : "emerald"
                  }
                  value={
                    days === null
                      ? "—"
                      : days < 0
                        ? `-${Math.ceil(-days)} d`
                        : `${Math.floor(days)} d`
                  }
                  description="Days until its certificate ends. One lasts 30 days from when the amphora is built, and Octavia's housekeeping renews it with 14 left by default."
                />
                <GoldenMetricTile
                  title="Role"
                  icon={IconProp.Server}
                  iconColor="slate"
                  value={role || "—"}
                  description="MASTER and BACKUP for an active-standby pair, STANDALONE for a load balancer on one amphora."
                />
              </>
            }
          />
        );
      }}
    />
  );
};

export default OpenStackCloudAmphoraDetail;
