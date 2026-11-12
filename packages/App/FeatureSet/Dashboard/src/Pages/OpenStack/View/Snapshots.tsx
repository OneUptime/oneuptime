import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackCountRow } from "Common/Types/OpenStack/OpenStackCounts";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  OpenStackBackupList,
  OpenStackSnapshotList,
} from "../../../Components/OpenStack/OpenStackLists";
import { formatOpenStackBytes } from "../../../Components/OpenStack/OpenStackResourceList";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackProjectTotalsCard from "../../../Components/OpenStack/Part/OpenStackProjectTotalsCard";
import useOpenStackCloudName from "../../../Components/OpenStack/Part/UseOpenStackCloudName";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import {
  OpenStackLatestReading,
  countOpenStackRows,
  fetchOpenStackCounts,
  fetchOpenStackLatestByLabel,
} from "../Utils/OpenStackPartData";
import { getOpenStackCountTotals } from "../Utils/OpenStackPartFacts";

/*
 * Snapshots and backups, and which of what is here comes from where, because the two
 * collectors say very different things. The agent's exporter counts snapshots per region
 * and has nothing about backups. Each one's own status and age, and what they add up to per
 * project, only come from a probe. This page never reads the first as the second: no rows
 * through the agent is what the agent says, and not a cloud with none.
 */
const REGION_LABEL: string = "openstack.region.name";

const SOURCE_NOTE: string = translationKey(
  "The agent's exporter counts snapshots per region and has nothing on backups. Each one's own status and age, and what they add up to per project, come from a probe's collection.",
);

const OpenStackCloudSnapshots: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const cloudName: string = useOpenStackCloudName(modelId);
  const { region }: OpenStackRegionState = useOpenStackRegion();
  const inRegion: Query<OpenStackResource> | undefined = region
    ? { regionName: region }
    : undefined;

  const snapshotTotals: OpenStackRead<Array<OpenStackLatestReading>> =
    useOpenStackRead<Array<OpenStackLatestReading>>(async () => {
      return cloudName
        ? await fetchOpenStackLatestByLabel({
            cloudName,
            metricName: "openstack_cinder_snapshots",
            groupByLabel: REGION_LABEL,
            attributes: region ? { [REGION_LABEL]: region } : undefined,
          })
        : [];
    }, [cloudName, region]);

  const listed: OpenStackRead<{ snapshots: number; backups: number }> =
    useOpenStackRead<{ snapshots: number; backups: number }>(async () => {
      const [snapshots, backups]: [number, number] = await Promise.all([
        countOpenStackRows({
          openStackCloudId: modelId,
          kind: OpenStackResourceKind.Snapshot,
          query: inRegion,
        }),
        countOpenStackRows({
          openStackCloudId: modelId,
          kind: OpenStackResourceKind.Backup,
          query: inRegion,
        }),
      ]);
      return { snapshots, backups };
    }, [modelId.toString(), region]);

  const snapshotByProject: OpenStackRead<Array<OpenStackCountRow>> =
    useOpenStackRead<Array<OpenStackCountRow>>(() => {
      return fetchOpenStackCounts({
        openStackCloudId: modelId,
        kind: OpenStackResourceKind.Snapshot,
        by: "project",
      });
    }, [modelId.toString()]);

  const backupByProject: OpenStackRead<Array<OpenStackCountRow>> =
    useOpenStackRead<Array<OpenStackCountRow>>(() => {
      return fetchOpenStackCounts({
        openStackCloudId: modelId,
        kind: OpenStackResourceKind.Backup,
        by: "project",
      });
    }, [modelId.toString()]);

  const snapshotProjects: Array<OpenStackCountRow> = getOpenStackCountTotals(
    snapshotByProject.data || [],
    region,
  );
  const backupProjects: Array<OpenStackCountRow> = getOpenStackCountTotals(
    backupByProject.data || [],
    region,
  );

  const snapshotTotal: number | null =
    snapshotTotals.data && snapshotTotals.data.length > 0
      ? snapshotTotals.data.reduce(
          (sum: number, reading: OpenStackLatestReading): number => {
            return sum + reading.value;
          },
          0,
        )
      : null;

  const backupBytes: number | null =
    backupProjects.length > 0
      ? backupProjects.reduce((sum: number, row: OpenStackCountRow): number => {
          return sum + row.sizeBytes;
        }, 0)
      : null;

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Snapshot}
      />
      <OpenStackPartNotice
        testId="openstack-snapshots-source"
        tone="neutral"
        text={SOURCE_NOTE}
      />
      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="openstack-snapshots-tiles"
      >
        <GoldenMetricTile
          title="Snapshots"
          icon={IconProp.Disc}
          iconColor="sky"
          value={
            snapshotTotal !== null
              ? translator.formatNumber(snapshotTotal)
              : listed.data
                ? translator.formatNumber(listed.data.snapshots)
                : "—"
          }
          sublabel={
            snapshotTotal !== null
              ? "counted by the agent's exporter"
              : listed.data && listed.data.snapshots > 0
                ? "listed by a probe"
                : "Not reported yet"
          }
          description="How many volume snapshots this cloud has. The exporter counts them per region, and a probe lists each one."
        />
        <GoldenMetricTile
          title="Backups"
          icon={IconProp.Archive}
          iconColor="violet"
          value={
            listed.data && listed.data.backups > 0
              ? translator.formatNumber(listed.data.backups)
              : "—"
          }
          sublabel={
            backupBytes !== null
              ? translator.translateTemplate(
                  "{{size}}, listed by a probe",
                  {
                    size: formatOpenStackBytes(backupBytes),
                  },
                  // "۶٫۰ TiB" reads with its number first in a Persian sentence.
                  { setsValuesApart: true },
                )
              : "Only a probe reports backups"
          }
          description="How many volume backups this cloud has, and what they add up to. Only a probe reports these: the agent's exporter has no backups."
        />
      </div>
      <OpenStackProjectTotalsCard
        testId="openstack-snapshots-by-project"
        title="Snapshots by project"
        description="How many snapshots each project holds, and what they add up to, from a probe's collection."
        openStackCloudId={modelId}
        rows={snapshotProjects}
      />
      <OpenStackSnapshotList openStackCloudId={modelId} />
      <OpenStackProjectTotalsCard
        testId="openstack-backups-by-project"
        title="Backups by project"
        description="How many backups each project holds, and what they add up to, from a probe's collection."
        openStackCloudId={modelId}
        rows={backupProjects}
      />
      <OpenStackBackupList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudSnapshots;
