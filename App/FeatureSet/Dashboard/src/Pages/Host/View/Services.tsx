import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

interface ServiceRow {
  key: string;
  name: string;
  statusCode: number | null;
  startupMode: string | null;
}

/*
 * The OTel `windowsservicereceiver` emits one `windows.service.status`
 * gauge per Windows service, with the service identity attached to the
 * *datapoint* (not the resource). OneUptime's metric ingest prefixes only
 * resource attributes with `resource.`, so the host identity lands as
 * `resource.host.name` (matching the Processes page) while the datapoint
 * attributes `name` and `startup_mode` are stored unprefixed.
 */
const METRIC_NAME: string = "windows.service.status";
const SERVICE_NAME_ATTR: string = "name";
const SERVICE_STARTUP_MODE_ATTR: string = "startup_mode";

/*
 * The receiver records the raw Win32 Service Control Manager state
 * (SERVICE_STATUS.dwCurrentState, 1–7) as the gauge value. Map it to the
 * labels Windows' own Services console uses.
 */
const statusMeta: (code: number | null) => {
  label: string;
  dot: string;
  pill: string;
} = (code: number | null): { label: string; dot: string; pill: string } => {
  switch (code) {
    case 4: // SERVICE_RUNNING
      return {
        label: "Running",
        dot: "bg-green-500",
        pill: "bg-green-50 text-green-700 ring-green-600/20",
      };
    case 1: // SERVICE_STOPPED
      return {
        label: "Stopped",
        dot: "bg-gray-400",
        pill: "bg-gray-50 text-gray-600 ring-gray-500/20",
      };
    case 7: // SERVICE_PAUSED
      return {
        label: "Paused",
        dot: "bg-amber-500",
        pill: "bg-amber-50 text-amber-700 ring-amber-600/20",
      };
    case 2: // SERVICE_START_PENDING
      return {
        label: "Start pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
      };
    case 3: // SERVICE_STOP_PENDING
      return {
        label: "Stop pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
      };
    case 5: // SERVICE_CONTINUE_PENDING
      return {
        label: "Continue pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
      };
    case 6: // SERVICE_PAUSE_PENDING
      return {
        label: "Pause pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
      };
    default:
      return {
        label: code === null ? "Unknown" : `Status ${code}`,
        dot: "bg-gray-300",
        pill: "bg-gray-50 text-gray-500 ring-gray-500/20",
      };
  }
};

// The receiver emits the SCM startup mode; surface the Services-console wording.
const startupModeLabel: (mode: string | null) => string = (
  mode: string | null,
): string => {
  switch (mode) {
    case "auto_start":
      return "Automatic";
    case "demand_start":
      return "Manual";
    case "disabled":
      return "Disabled";
    case "boot_start":
      return "Boot";
    case "system_start":
      return "System";
    default:
      return mode || "—";
  }
};

/*
 * Like processes, service status is a point-in-time sample re-emitted on
 * every collector scrape (30s in the OneUptime config). A 15-minute window
 * shows the latest state of every service without surfacing stale ghosts
 * from services that were removed a while ago. Refresh re-queries.
 */
const SERVICE_LOOKBACK_MINUTES: number = 15;

const HostServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [rows, setRows] = useState<Array<ServiceRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [latestSampleAt, setLatestSampleAt] = useState<Date | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
          osType: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -SERVICE_LOOKBACK_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {
        modelType: Metric,
        query: {
          projectId: projectId,
          name: METRIC_NAME,
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "resource.host.name": item.hostIdentifier,
          },
        },
        limit: 2000,
        skip: 0,
        select: {
          time: true,
          value: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };

      const result: ListResult<Metric> =
        await AnalyticsModelAPI.getList<Metric>(query);

      const byKey: Map<string, ServiceRow> = new Map();
      let newestSample: Date | null = null;

      // Datapoints arrive newest-first; the first row per service wins.
      for (const m of result.data) {
        if (m.time) {
          const t: Date = new Date(m.time as unknown as string | Date);
          if (
            !Number.isNaN(t.getTime()) &&
            (newestSample === null || t > newestSample)
          ) {
            newestSample = t;
          }
        }

        const attrs: Record<string, unknown> =
          (m.attributes as Record<string, unknown>) || {};
        const name: string =
          (attrs[SERVICE_NAME_ATTR] as string | undefined) || "";
        if (!name) {
          continue;
        }
        if (byKey.has(name)) {
          // Already captured the most recent sample for this service.
          continue;
        }

        const statusCode: number | null =
          m.value === undefined || m.value === null ? null : Number(m.value);

        byKey.set(name, {
          key: name,
          name,
          statusCode,
          startupMode:
            (attrs[SERVICE_STARTUP_MODE_ATTR] as string | undefined) || null,
        });
      }

      const sorted: Array<ServiceRow> = Array.from(byKey.values()).sort(
        (a: ServiceRow, b: ServiceRow) => {
          return a.name.localeCompare(b.name, undefined, {
            sensitivity: "base",
          });
        },
      );

      setRows(sorted);
      setLatestSampleAt(newestSample);
      setRefreshedAt(OneUptimeDate.getCurrentDate());
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

  const tableColumns: Array<Column<ServiceRow>> = useMemo(() => {
    return [
      {
        title: "Service",
        type: FieldType.Element,
        key: "name",
        disableSort: true,
        getElement: (row: ServiceRow): ReactElement => {
          return (
            <span className="text-sm font-medium text-gray-900 truncate">
              {row.name}
            </span>
          );
        },
      },
      {
        title: "Startup",
        type: FieldType.Element,
        key: "startupMode",
        disableSort: true,
        hideOnMobile: true,
        getElement: (row: ServiceRow): ReactElement => {
          return (
            <span className="text-sm text-gray-600">
              {startupModeLabel(row.startupMode)}
            </span>
          );
        },
      },
      {
        title: "Status",
        type: FieldType.Element,
        key: "statusCode",
        disableSort: true,
        getElement: (row: ServiceRow): ReactElement => {
          const meta: { label: string; dot: string; pill: string } = statusMeta(
            row.statusCode,
          );
          return (
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${meta.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          );
        },
      },
    ];
  }, []);

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

  const description: ReactElement = (() => {
    const parts: Array<string> = [
      `Windows services on this host (last ${SERVICE_LOOKBACK_MINUTES} minutes), sorted by name.`,
    ];
    if (latestSampleAt) {
      parts.push(`Latest sample ${OneUptimeDate.fromNow(latestSampleAt)}.`);
    }
    if (refreshedAt) {
      parts.push(`Refreshed ${OneUptimeDate.fromNow(refreshedAt)}.`);
    }
    return <span>{parts.join(" ")}</span>;
  })();

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const noItemsMessage: string = `No Windows service metrics in the last ${SERVICE_LOOKBACK_MINUTES} minutes. Service status comes from the "windows_service" receiver, which isn't in the upstream prebuilt collector (alpha, Windows-only). The easiest fix is to run the prebuilt OneUptime Host Collector, which already includes it — see the Documentation tab for the download and setup steps (or build your own with ocb).`;

  return (
    <Card
      title="Windows Services"
      description={description}
      buttons={cardButtons}
    >
      <Table<ServiceRow>
        id="host-services-table"
        columns={tableColumns}
        data={rows}
        singularLabel="Service"
        pluralLabel="Services"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={rows.length}
        itemsOnPage={rows.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage={noItemsMessage}
      />
    </Card>
  );
};

export default HostServices;
