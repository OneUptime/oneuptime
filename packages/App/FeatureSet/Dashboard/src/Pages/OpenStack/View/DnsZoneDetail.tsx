import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import { OpenStackDnsRecordsetList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import OpenStackServicePartOverview from "../../../Components/OpenStack/Part/OpenStackServicePartOverview";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import { ResourcePartDetailRow } from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import {
  OPENSTACK_DNS_ZONE_ALERT_TEMPLATE_IDS,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Designate zone: its status in Designate's word, how many recordsets it holds, and the ones among them
 * that aren't ACTIVE, which only those have rows. Why it failed is in designate-worker's log: nothing the
 * exporter or the API says it.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "Nothing Designate's API says why a zone failed. Check that the DNS servers in its pool are answering, then designate-worker's log.",
);

const OpenStackCloudDnsZoneDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.DnsZone);

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        const recordsets: JSONValue | undefined = ((row.facts as
          | JSONObject
          | undefined) || {})["recordsetCount"];
        const zoneType: string = getOpenStackFactText(row, "zoneType");
        const action: string = getOpenStackFactText(row, "action");

        const detailRows: Array<ResourcePartDetailRow> = [
          {
            key: "id",
            label: "Zone ID",
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
            description: "The zone's status in Designate's own word.",
          });
        }
        if (action) {
          detailRows.push({
            key: "action",
            label: "Action",
            value: action,
            description:
              "What Designate's worker was last asked to do with it.",
          });
        }
        if (zoneType) {
          detailRows.push({
            key: "type",
            label: "Type",
            value: zoneType,
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
            service={OpenStackServiceType.Dns}
            slug="dns-zone"
            alertTemplateIds={OPENSTACK_DNS_ZONE_ALERT_TEMPLATE_IDS}
            detailRows={detailRows}
            whyNotKnown={WHY_NOT_KNOWN}
            words={{
              thisOne: translationKey("This zone"),
              attentionDescription: translationKey(
                "What about this zone is broken or needs a look.",
              ),
              openTitle: translationKey("Open on this zone"),
              openDescription: translationKey(
                "Unresolved incidents and alerts about this zone, incidents first.",
              ),
              alertsTitle: translationKey("DNS alerts"),
              alertsDescription: translationKey(
                "The cloud's alerts that watch every zone, this one included: each is one monitor on the cloud.",
              ),
              detailsDescription: translationKey(
                "What Designate reports about this zone.",
              ),
            }}
            tiles={
              <>
                <GoldenMetricTile
                  title="Recordsets"
                  icon={IconProp.List}
                  iconColor="sky"
                  value={typeof recordsets === "number" ? `${recordsets}` : "—"}
                  description="How many recordsets this zone holds, its own SOA and NS among them."
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
                  description="How long since OneUptime saw this zone's status change. One already in this state when OneUptime first saw it counts from then."
                />
              </>
            }
          >
            <OpenStackDnsRecordsetList
              openStackCloudId={part.openStackCloudId}
              query={{
                facts: { zoneId: part.externalId } as JSONObject,
              }}
              tableId="openstack-dns-zone-recordsets-table"
            />
          </OpenStackServicePartOverview>
        );
      }}
    />
  );
};

export default OpenStackCloudDnsZoneDetail;
