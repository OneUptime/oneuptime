import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
  getOpenStackDatabaseVolumePercent,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  formatOpenStackBytes,
  formatOpenStackPercent,
} from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import OpenStackServicePartOverview from "../../../Components/OpenStack/Part/OpenStackServicePartOverview";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import { ResourcePartDetailRow } from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import {
  OPENSTACK_DATABASE_INSTANCE_ALERT_TEMPLATE_IDS,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Trove database: its status in Trove's word, what it runs and how full its volume is. Why it failed
 * is on Trove's mgmt API, which only a probe reads. The agent's exporter reads that same API and never
 * asks for the fault, so the page says what to run. An instance that isn't running reads 0 of its volume
 * used, recorded, and that is no reading.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "The agent's exporter doesn't read why a database failed. Run openstack database instance show for this one, or collect this cloud with a probe, which reads Trove's own fault.",
);

const OpenStackCloudDatabaseInstanceDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.DatabaseInstance,
  );

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        const fault: string = getOpenStackFactText(row, "faultMessage");
        const task: string = getOpenStackFactText(row, "taskDescription");
        const datastore: string = getOpenStackFactText(row, "datastoreType");
        const version: string = getOpenStackFactText(row, "datastoreVersion");
        const health: string = getOpenStackFactText(row, "healthStatus");
        const percent: number | null = getOpenStackDatabaseVolumePercent({
          usedBytes: row.diskAllocatedBytes,
          sizeBytes: row.diskCapacityBytes,
        });

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
            description: "The instance's status in Trove's own word.",
          });
        }
        if (datastore) {
          detailRows.push({
            key: "datastore",
            label: "Datastore",
            value: <bdi>{version ? `${datastore} ${version}` : datastore}</bdi>,
          });
        }
        if (health) {
          detailRows.push({
            key: "health",
            label: "Health",
            value: <bdi>{health}</bdi>,
            description: "What Trove says of the database in its guest.",
          });
        }
        if (task) {
          detailRows.push({
            key: "task",
            label: "Task",
            value: <bdi>{task}</bdi>,
            description: "What Trove says it was last doing.",
          });
        }
        if (fault) {
          detailRows.push({
            key: "fault",
            label: "Why",
            value: <bdi>{fault}</bdi>,
            description:
              "What Trove recorded about why it failed, in its own words.",
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
            service={OpenStackServiceType.Database}
            slug="database-instance"
            alertTemplateIds={OPENSTACK_DATABASE_INSTANCE_ALERT_TEMPLATE_IDS}
            detailRows={detailRows}
            whyNotKnown={fault ? undefined : WHY_NOT_KNOWN}
            words={{
              thisOne: translationKey("This database"),
              attentionDescription: translationKey(
                "What about this database is broken or needs a look.",
              ),
              openTitle: translationKey("Open on this database"),
              openDescription: translationKey(
                "Unresolved incidents and alerts about this database, incidents first.",
              ),
              alertsTitle: translationKey("Database alerts"),
              alertsDescription: translationKey(
                "The cloud's alerts that watch every database, this one included: each is one monitor on the cloud.",
              ),
              detailsDescription: translationKey(
                "What Trove reports about this database.",
              ),
            }}
            tiles={
              <>
                <GoldenMetricTile
                  title="Volume used"
                  icon={IconProp.Disc}
                  iconColor="emerald"
                  value={
                    percent === null ? "—" : formatOpenStackPercent(percent)
                  }
                  percent={percent}
                  thresholds={{
                    warn: OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
                    danger: OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
                  }}
                  sublabel={
                    row.diskCapacityBytes === null ||
                    row.diskCapacityBytes === undefined
                      ? undefined
                      : formatOpenStackBytes(row.diskCapacityBytes)
                  }
                  isSublabelAsWritten={true}
                  description="What its database has used of its volume, as its guest reports. One that isn't running has nothing to report, however full it is."
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
                  description="How long since OneUptime saw this database's status change. One already in this state when OneUptime first saw it counts from then."
                />
              </>
            }
          />
        );
      }}
    />
  );
};

export default OpenStackCloudDatabaseInstanceDetail;
