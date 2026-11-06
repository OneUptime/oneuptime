import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import { formatOpenStackBytes } from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import OpenStackServicePartOverview from "../../../Components/OpenStack/Part/OpenStackServicePartOverview";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import { ResourcePartDetailRow } from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import {
  OPENSTACK_SHARE_ALERT_TEMPLATE_IDS,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Manila share: its status in Manila's word, what it holds room for and whose it is. Why it failed
 * isn't on anything the exporter reads, and Manila keeps it in its user messages, so the page says
 * what to run. Which backend holds it, and whether its access rules are in force, only a probe says.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "Nothing OneUptime reads says why a share failed. Run openstack share message list for this share, and check manila-share's log on the backend it was asked of.",
);

const OpenStackCloudShareDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Share);

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        const detailRows: Array<ResourcePartDetailRow> = [
          {
            key: "id",
            label: "Share ID",
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
            description: "The share's status in Manila's own word.",
          });
        }
        const protocol: string = getOpenStackFactText(row, "shareProtocol");
        if (protocol) {
          detailRows.push({
            key: "protocol",
            label: "Protocol",
            value: protocol,
          });
        }
        const shareType: string = getOpenStackFactText(row, "shareType");
        if (shareType) {
          detailRows.push({
            key: "type",
            label: "Share Type",
            value: <bdi>{shareType}</bdi>,
          });
        }
        detailRows.push({
          key: "zone",
          label: "Availability Zone",
          value: row.availabilityZone ? <bdi>{row.availabilityZone}</bdi> : "—",
          description:
            "The zone of the backend that holds it. A share with none never reached a backend.",
        });
        const backend: string = getOpenStackFactText(row, "backendHost");
        if (backend) {
          detailRows.push({
            key: "backend",
            label: "Backend",
            value: <bdi>{backend}</bdi>,
            mono: true,
            description:
              "The host, backend and pool that hold this share, as Manila names them.",
          });
        }
        const accessRules: string = getOpenStackFactText(
          row,
          "accessRulesStatus",
        );
        if (accessRules) {
          detailRows.push({
            key: "access-rules",
            label: "Access Rules",
            value: accessRules,
            description:
              "Whether the share's access rules are in force on its backend, in Manila's own word.",
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
            service={OpenStackServiceType.SharedFileSystems}
            slug="share"
            alertTemplateIds={OPENSTACK_SHARE_ALERT_TEMPLATE_IDS}
            detailRows={detailRows}
            whyNotKnown={WHY_NOT_KNOWN}
            words={{
              thisOne: translationKey("This share"),
              attentionDescription: translationKey(
                "What about this share is broken or needs a look.",
              ),
              openTitle: translationKey("Open on this share"),
              openDescription: translationKey(
                "Unresolved incidents and alerts about this share, incidents first.",
              ),
              alertsTitle: translationKey("Share alerts"),
              alertsDescription: translationKey(
                "The cloud's alerts that watch every share, this one included: each is one monitor on the cloud.",
              ),
              detailsDescription: translationKey(
                "What Manila reports about this share.",
              ),
            }}
            tiles={
              <>
                <GoldenMetricTile
                  title="Size"
                  icon={IconProp.Disc}
                  iconColor="emerald"
                  value={
                    row.diskCapacityBytes === null ||
                    row.diskCapacityBytes === undefined
                      ? "—"
                      : formatOpenStackBytes(row.diskCapacityBytes)
                  }
                  description="What this share holds room for, as Manila reports it. How much of that is used only its backend knows."
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
                  description="How long since OneUptime saw this share's status change. One already in this state when OneUptime first saw it counts from then."
                />
              </>
            }
          />
        );
      }}
    />
  );
};

export default OpenStackCloudShareDetail;
