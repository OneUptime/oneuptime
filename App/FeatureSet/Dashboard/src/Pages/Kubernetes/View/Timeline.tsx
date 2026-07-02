import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResourceChangeEvent from "Common/Models/DatabaseModels/KubernetesResourceChangeEvent";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import type Columns from "Common/UI/Components/Table/Types/Columns";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import {
  fetchClusterWarningEvents,
  KubernetesEvent,
} from "../Utils/KubernetesObjectFetcher";
import {
  diffSpecs,
  formatDiffEntry,
  SpecDiffEntry,
} from "../Utils/SpecDiff";

type TimelineRowType = "SpecChanged" | "Deleted" | "Warning";

interface TimelineRow {
  time: string;
  sortKey: number;
  rowType: TimelineRowType;
  kind: string;
  name: string;
  namespace: string;
  resource: string;
  summary: string;
  diffLines: Array<string>;
}

const CHANGE_EVENT_LIMIT: number = 200;
const WARNING_EVENT_LIMIT: number = 100;

/**
 * Row summary for a SpecChanged event: shows the first changed path
 * inline and expands to the full list of changed paths on demand.
 */
const SpecChangeSummary: FunctionComponent<{
  summary: string;
  diffLines: Array<string>;
}> = (props: { summary: string; diffLines: Array<string> }): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  if (props.diffLines.length === 0) {
    return <span className="text-sm text-gray-500">{props.summary}</span>;
  }

  return (
    <div>
      <span className="text-sm text-gray-900 font-mono break-all">
        {isExpanded ? props.diffLines[0] : props.summary}
      </span>
      {isExpanded &&
        props.diffLines.slice(1).map((line: string, index: number) => {
          return (
            <div
              key={index}
              className="text-sm text-gray-900 font-mono break-all mt-1"
            >
              {line}
            </div>
          );
        })}
      {props.diffLines.length > 1 && (
        <button
          type="button"
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
          aria-expanded={isExpanded}
          className="ml-2 inline-flex items-center align-baseline rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-colors"
        >
          {isExpanded
            ? "Show less"
            : `Show ${props.diffLines.length - 1} more change${
                props.diffLines.length - 1 !== 1 ? "s" : ""
              }`}
        </button>
      )}
    </div>
  );
};

const KubernetesClusterTimeline: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rows, setRows] = useState<Array<TimelineRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const cluster: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
        },
      });

      if (!cluster?.clusterIdentifier) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      // Fetch change events (Postgres) and warning events (ClickHouse)
      // in parallel — they come from independent stores.
      const [changeEventsResult, warningEvents]: [
        ListResult<KubernetesResourceChangeEvent>,
        Array<KubernetesEvent>,
      ] = await Promise.all([
        ModelAPI.getList<KubernetesResourceChangeEvent>({
          modelType: KubernetesResourceChangeEvent,
          query: {
            kubernetesClusterId: modelId,
          },
          select: {
            kind: true,
            namespaceKey: true,
            name: true,
            changeType: true,
            oldSpec: true,
            newSpec: true,
            occurredAt: true,
          },
          sort: {
            occurredAt: SortOrder.Descending,
          },
          limit: CHANGE_EVENT_LIMIT,
          skip: 0,
        }),
        fetchClusterWarningEvents({
          clusterIdentifier: cluster.clusterIdentifier,
          limit: WARNING_EVENT_LIMIT,
        }),
      ]);

      const mergedRows: Array<TimelineRow> = [];

      for (const changeEvent of changeEventsResult.data) {
        const occurredAt: Date | null = changeEvent.occurredAt
          ? OneUptimeDate.fromString(changeEvent.occurredAt)
          : null;

        const rowType: TimelineRowType =
          changeEvent.changeType === "Deleted" ? "Deleted" : "SpecChanged";

        let summary: string = "";
        let diffLines: Array<string> = [];

        if (rowType === "Deleted") {
          summary = "Resource removed from the cluster.";
        } else {
          const diffEntries: Array<SpecDiffEntry> = diffSpecs(
            changeEvent.oldSpec,
            changeEvent.newSpec,
          );
          diffLines = diffEntries.map((entry: SpecDiffEntry) => {
            return formatDiffEntry(entry);
          });
          summary = diffLines[0] || "Spec changed.";
        }

        mergedRows.push({
          time: occurredAt
            ? OneUptimeDate.getDateAsLocalFormattedString(occurredAt)
            : "",
          sortKey: occurredAt ? occurredAt.getTime() : 0,
          rowType: rowType,
          kind: changeEvent.kind || "Unknown",
          name: changeEvent.name || "Unknown",
          namespace: changeEvent.namespaceKey || "",
          resource: `${changeEvent.kind || "Unknown"}/${
            changeEvent.name || "Unknown"
          }`,
          summary: summary,
          diffLines: diffLines,
        });
      }

      for (const warningEvent of warningEvents) {
        let sortKey: number = 0;
        if (warningEvent.timestamp) {
          const parsed: Date = new Date(warningEvent.timestamp);
          if (!isNaN(parsed.getTime())) {
            sortKey = parsed.getTime();
          }
        }

        mergedRows.push({
          time: warningEvent.timestamp,
          sortKey: sortKey,
          rowType: "Warning",
          kind: warningEvent.objectKind || "Unknown",
          name: warningEvent.objectName || "Unknown",
          namespace: warningEvent.namespace || "",
          resource: `${warningEvent.objectKind || "Unknown"}/${
            warningEvent.objectName || "Unknown"
          }`,
          summary: warningEvent.reason
            ? `${warningEvent.reason}: ${warningEvent.message}`
            : warningEvent.message,
          diffLines: [],
        });
      }

      mergedRows.sort((a: TimelineRow, b: TimelineRow) => {
        return b.sortKey - a.sortKey;
      });

      setRows(mergedRows);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const columns: Columns<TimelineRow> = [
    {
      title: "Time",
      type: FieldType.Element,
      key: "time",
      getElement: (row: TimelineRow): ReactElement => {
        return (
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {row.time || "—"}
          </span>
        );
      },
    },
    {
      title: "Type",
      type: FieldType.Element,
      key: "rowType",
      getElement: (row: TimelineRow): ReactElement => {
        if (row.rowType === "Deleted") {
          return <StatusBadge text="Deleted" type={StatusBadgeType.Danger} />;
        }
        if (row.rowType === "Warning") {
          return (
            <StatusBadge text="Warning event" type={StatusBadgeType.Warning} />
          );
        }
        return <StatusBadge text="Spec changed" type={StatusBadgeType.Info} />;
      },
    },
    {
      title: "Resource",
      type: FieldType.Element,
      key: "resource",
      getElement: (row: TimelineRow): ReactElement => {
        return (
          <div>
            <span className="text-gray-900">
              {row.kind} {row.name}
            </span>
            {row.namespace ? (
              <span className="ml-2 inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
                {row.namespace}
              </span>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "Summary",
      type: FieldType.Element,
      key: "summary",
      getElement: (row: TimelineRow): ReactElement => {
        if (row.rowType === "SpecChanged") {
          return (
            <SpecChangeSummary summary={row.summary} diffLines={row.diffLines} />
          );
        }
        return <span className="text-sm text-gray-500">{row.summary}</span>;
      },
    },
  ];

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        fetchData().catch(() => {});
      },
      icon: IconProp.Refresh,
    },
  ];

  return (
    <Card
      title="Cluster Timeline"
      description="What changed in this cluster: spec changes, deletions, and recent warning events, most recent first."
      buttons={cardButtons}
    >
      {rows.length === 0 ? (
        <div className="text-gray-500 text-sm p-4">
          No changes or warning events found for this cluster yet. Spec changes
          and deletions will appear here as the kubernetes-agent reports them.
        </div>
      ) : (
        <LocalTable<TimelineRow>
          id="kubernetes-cluster-timeline-table"
          data={rows}
          columns={columns}
          singularLabel="Timeline Item"
          pluralLabel="Timeline Items"
        />
      )}
    </Card>
  );
};

export default KubernetesClusterTimeline;
