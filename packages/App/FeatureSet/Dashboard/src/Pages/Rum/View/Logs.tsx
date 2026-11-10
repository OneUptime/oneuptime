import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import {
  buildSavedViewScope,
  SavedViewScopeKind,
} from "Common/Utils/Telemetry/SavedViewScope";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  diagnoseRumSignal,
  RumSignalDiagnosis,
} from "../../../Components/Rum/SetupCheck/RumSignalDiagnosis";
import {
  getRumApplicationArrivalFacts,
  getRumClientKind,
  getRumRetentionInDays,
  RUM_SIGNAL_APPLICATION_SELECT,
  toDateOrNull,
} from "../../../Components/Rum/SetupCheck/RumSignalFacts";
import {
  getRumSignalEmptyCopy,
  RumSignalEmptyCopy,
} from "../../../Components/Rum/SetupCheck/RumSignalWords";
import RumSignalEmptyState from "../../../Components/Rum/SetupCheck/RumSignalEmptyState";
import RumSignalSetupModal from "../../../Components/Rum/SetupCheck/RumSignalSetupModal";
import RumKeySetupModal from "../../../Components/Rum/SetupCheck/RumKeySetupModal";
import {
  IngestRefusalFact,
  getRumKindRefusal,
} from "../../../Components/Rum/SetupCheck/RumIngestRefusals";
import useRecentIngestRefusals from "../../../Components/Rum/SetupCheck/useRecentIngestRefusals";

/*
 * A RUM application's Logs. Empty and unfiltered, the list says why
 * (issue #5770): the browser SDK sends no logs on its own, so for most
 * applications "no logs" means "not set up" - with the dialog that sets
 * them up - and for one that did send logs, when the last arrived and a
 * longer range that shows it. The page holds the viewer's window
 * (timeRangeOverride) so that range is one click away. Logs refused at
 * ingest since the last one arrived (issue #6378) say so instead, with
 * the fix.
 */

const RumApplicationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });
  const [isSetUpOpen, setIsSetUpOpen] = useState<boolean>(false);
  const [isPickingKey, setIsPickingKey] = useState<boolean>(false);
  const refusals: Array<IngestRefusalFact> | null = useRecentIngestRefusals(0);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: RumApplication | null = await ModelAPI.getItem({
        modelType: RumApplication,
        id: modelId,
        select: {
          appIdentifier: true,
          name: true,
          // What has arrived, kind by kind: why the list is empty.
          ...RUM_SIGNAL_APPLICATION_SELECT,
        },
      });

      if (!item?.appIdentifier) {
        setError("RUM application not found.");
        setIsLoading(false);
        return;
      }

      setRumApplication(item);
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

  if (!rumApplication) {
    return <ErrorMessage message="RUM application not found." />;
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const rangeDates: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

  // The list is empty whenever this is drawn: nothing in the range.
  const diagnosis: RumSignalDiagnosis = diagnoseRumSignal({
    inRange: { count: 0 },
    lastArrival: {
      at: toDateOrNull(rumApplication.logsLastReceivedAt),
      failed: false,
    },
    trackedSince: toDateOrNull(rumApplication.signalArrivalsTrackedSince),
    app: getRumApplicationArrivalFacts(rumApplication),
    range: {
      timeRange: timeRange,
      start: rangeDates.startValue,
      end: rangeDates.endValue,
    },
    retentionInDays: getRumRetentionInDays(rumApplication),
    now,
  });

  const client: "browser" | "mobile" = getRumClientKind(rumApplication);

  const copy: RumSignalEmptyCopy | null = getRumSignalEmptyCopy({
    signal: "logs",
    diagnosis,
    client,
    refusal: getRumKindRefusal({
      refusals,
      kind: "logs",
      lastArrivalAt: toDateOrNull(rumApplication.logsLastReceivedAt),
      app: {
        client,
        appIdentifier: (rumApplication.appIdentifier as string) || null,
      },
      now,
    }),
    translator,
    now,
  });

  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION] as Route,
    { modelId: modelId },
  );

  return (
    <Fragment>
      {/*
       * Telemetry for a RUM application carries the RumApplication id in
       * primaryEntityId, not a Service id. Tell the viewer so the locked
       * scope chip reads "RUM Application: <name>" instead of
       * "Service: <uuid>".
       */}
      <DashboardLogsViewer
        id={`rum-application-logs-${modelId.toString()}`}
        savedViewScope={buildSavedViewScope(
          SavedViewScopeKind.RumApplication,
          modelId,
        )}
        serviceIds={[modelId]}
        scopeEntityType={ServiceType.RealUserMonitor}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="Logs appear here as soon as this application sends them."
        timeRangeOverride={timeRange}
        onTimeRangeChange={setTimeRange}
        emptyContentWhenUnfiltered={
          copy ? (
            <RumSignalEmptyState
              signal="logs"
              state={diagnosis.state}
              copy={copy}
              variant="page"
              documentationRoute={documentationRoute}
              onSetUp={(): void => {
                setIsSetUpOpen(true);
              }}
              onRangeChange={setTimeRange}
              onPickKey={(): void => {
                setIsPickingKey(true);
              }}
            />
          ) : undefined
        }
      />

      {isSetUpOpen ? (
        <RumSignalSetupModal
          signal="logs"
          appName={
            (rumApplication.appIdentifier as string) ||
            (rumApplication.name as string) ||
            ""
          }
          onClose={(): void => {
            setIsSetUpOpen(false);
          }}
        />
      ) : (
        <></>
      )}

      {isPickingKey ? (
        <RumKeySetupModal
          clientType={client}
          onClose={(): void => {
            setIsPickingKey(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RumApplicationLogs;
