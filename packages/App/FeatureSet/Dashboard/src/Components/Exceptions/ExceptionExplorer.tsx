import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Span from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import ProjectUtil from "Common/UI/Utils/Project";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Select from "Common/Types/BaseDatabase/Select";
import API from "Common/UI/Utils/API/API";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "Common/Types/Telemetry/SourceMap";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { parseFramesJson } from "../../Utils/SourceMapFrames";
import ReplayCard from "../SessionReplay/ReplayCard";
import ExceptionDetail from "./ExceptionDetail";
import StackFrameViewer from "./StackFrameViewer";
import BreadcrumbTimeline, { BreadcrumbEvent } from "./BreadcrumbTimeline";
import ExceptionOccurrences from "./ExceptionOccurrences";
import ExceptionDetailSection from "./ExceptionDetailSection";
import ExceptionSummary from "./ExceptionSummary";
import ExceptionTriageActions, {
  ExceptionTriageActionId,
} from "./ExceptionTriageActions";
import ExceptionOccurrenceTrend from "./ExceptionOccurrenceTrend";
import ExceptionLatestOccurrence from "./ExceptionLatestOccurrence";
import ExceptionOccurrenceAttributes from "./ExceptionOccurrenceAttributes";
import ExceptionLogs from "./ExceptionLogs";
import ExceptionAIAssistance from "./ExceptionAIAssistance";
import ExceptionSettings from "./ExceptionSettings";
import { getExceptionTriageWrite } from "./ExceptionRowActions";
import {
  buildBreadcrumbEventsFromSpans,
  buildExceptionOccurrenceQuery,
  ExceptionDetailDataPlan,
  getExceptionDetailDataPlan,
} from "../../Utils/ExceptionDetailData";
import { ExceptionTriageAction } from "../../Utils/ExceptionDetailPresentation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Dictionary from "Common/Types/Dictionary";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { getTelemetryMonitorLinkParams } from "../../Utils/Form/Monitor/TelemetryRule/TelemetryMonitorLink";

export interface ComponentProps {
  telemetryExceptionId: ObjectID;
  section: ExceptionDetailSection;
}

interface EmptySectionProps {
  title: string;
  description: string;
  icon: IconProp;
  message: string;
  testId: string;
}

const EmptySection: FunctionComponent<EmptySectionProps> = (
  props: EmptySectionProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <Card title={props.title} description={props.description}>
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 px-6 py-10 text-center"
        data-testid={props.testId}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={props.icon} className="h-5 w-5 text-gray-400" />
        </div>
        <p className="mt-3 max-w-md text-sm text-gray-600">
          {translator.translateText(props.message)}
        </p>
      </div>
    </Card>
  );
};

const ExceptionExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dataPlan: ExceptionDetailDataPlan = getExceptionDetailDataPlan(
    props.section,
  );
  const [telemetryException, setTelemetryException] = useState<
    TelemetryException | undefined
  >(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [services, setServices] = useState<Array<Service>>([]);
  const [pendingActionId, setPendingActionId] = useState<
    ExceptionTriageActionId | undefined
  >(undefined);
  // Resolve/archive failures render inline — never a page takeover.
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [latestInstance, setLatestInstance] = useState<
    ExceptionInstance | undefined
  >(undefined);
  /*
   * True until the latest occurrence (and, per page, its resolved frames or
   * breadcrumbs) has been read. Only the pages that use it wait on it.
   */
  const [isOccurrenceLoading, setIsOccurrenceLoading] = useState<boolean>(
    dataPlan.loadLatestOccurrence,
  );
  const [resolvedFrames, setResolvedFrames] = useState<
    Array<ResolvedStackFrame> | undefined
  >(undefined);
  const [skippedSourceMapCount, setSkippedSourceMapCount] = useState<number>(0);
  const [breadcrumbEvents, setBreadcrumbEvents] = useState<
    Array<BreadcrumbEvent>
  >([]);

  /*
   * Ask the server to resolve the instance's parsed frames against the
   * source maps uploaded for its (service, release). Best-effort: any
   * failure just leaves the minified frames on screen.
   */
  const resolveStackFrames: (
    instance: ExceptionInstance,
  ) => Promise<void> = async (instance: ExceptionInstance): Promise<void> => {
    setResolvedFrames(undefined);

    try {
      if (
        !instance.parsedFrames ||
        !instance.release ||
        !instance.primaryEntityId
      ) {
        return;
      }

      const frames: Array<MinifiedStackFrame> = parseFramesJson(
        instance.parsedFrames,
      );

      if (frames.length === 0) {
        return;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/exceptions/resolve-stack-trace",
          ),
          data: {
            serviceId: instance.primaryEntityId.toString(),
            serviceVersion: instance.release,
            frames: frames as unknown as JSONArray,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const responseFrames: unknown = (response.data as JSONObject)["frames"];

      if (Array.isArray(responseFrames)) {
        setResolvedFrames(
          responseFrames as unknown as Array<ResolvedStackFrame>,
        );
      }

      const skipped: unknown = (response.data as JSONObject)[
        "sourceMapsSkippedForSize"
      ];
      setSkippedSourceMapCount(
        typeof skipped === "number" && skipped > 0 ? skipped : 0,
      );
    } catch {
      // Best-effort — the minified stack trace still renders.
      setResolvedFrames(undefined);
      setSkippedSourceMapCount(0);
    }
  };

  const loadTraceBreadcrumbs: (traceId: string) => Promise<void> = async (
    traceId: string,
  ): Promise<void> => {
    try {
      const spanResult: ListResult<Span> =
        await AnalyticsModelAPI.getList<Span>({
          modelType: Span,
          query: {
            traceId: traceId,
          },
          limit: 50,
          skip: 0,
          select: {
            events: true,
            name: true,
            startTime: true,
          },
          sort: {
            startTime: SortOrder.Descending,
          },
        });

      setBreadcrumbEvents(buildBreadcrumbEventsFromSpans(spanResult.data));
    } catch {
      // Supplementary: the Context page still shows logs and replay.
      setBreadcrumbEvents([]);
    }
  };

  /*
   * Everything below the header is page-specific and loads behind its own
   * loader, so the exception itself paints as soon as the group is read.
   */
  const loadSupplementaryData: (exception: TelemetryException) => void = (
    exception: TelemetryException,
  ): void => {
    /*
     * A group references at most one OpenTelemetry Service. Resolve that
     * single row instead of loading every Service in the project.
     * Infrastructure resource types render from their discriminator.
     */
    if (
      dataPlan.loadServices &&
      exception.primaryEntityId &&
      (!exception.primaryEntityType ||
        exception.primaryEntityType === ServiceType.OpenTelemetry)
    ) {
      void ModelAPI.getItem<Service>({
        id: exception.primaryEntityId,
        modelType: Service,
        select: { _id: true, name: true, serviceColor: true },
      })
        .then((service: Service | null): void => {
          setServices(service ? [service] : []);
        })
        .catch((): void => {
          // Non-fatal: the header falls back to "Not recorded".
          setServices([]);
        });
    }

    if (!dataPlan.loadLatestOccurrence) {
      return;
    }

    if (!exception.fingerprint) {
      setIsOccurrenceLoading(false);
      return;
    }

    const loadOccurrence: () => Promise<void> = async (): Promise<void> => {
      try {
        const instanceResult: ListResult<ExceptionInstance> =
          await AnalyticsModelAPI.getList<ExceptionInstance>({
            modelType: ExceptionInstance,
            query: buildExceptionOccurrenceQuery({
              projectId: ProjectUtil.getCurrentProjectId()!,
              fingerprint: exception.fingerprint!,
              primaryEntityId: exception.primaryEntityId,
            }),
            limit: 1,
            skip: 0,
            select: {
              /* The occurrence id becomes the replay link's ?signal=exc:<id>. */
              _id: true,
              ...(dataPlan.resolveStackFrames ? { parsedFrames: true } : {}),
              ...(dataPlan.loadOccurrenceAttributes
                ? { attributes: true }
                : {}),
              release: true,
              environment: true,
              traceId: true,
              spanId: true,
              spanName: true,
              escaped: true,
              sessionId: true,
              primaryEntityId: true,
              time: true,
            } as Select<ExceptionInstance>,
            sort: {
              time: SortOrder.Descending,
            },
          });

        const instance: ExceptionInstance | undefined = instanceResult.data[0];

        if (instance) {
          setLatestInstance(instance);

          if (dataPlan.resolveStackFrames) {
            await resolveStackFrames(instance);
          }

          if (dataPlan.loadTraceBreadcrumbs && instance.traceId) {
            await loadTraceBreadcrumbs(instance.traceId.toString());
          }
        }
      } catch {
        // Supplementary: each page shows its own empty state instead.
      }

      setIsOccurrenceLoading(false);
    };

    void loadOccurrence();
  };

  const loadException: () => Promise<TelemetryException> =
    async (): Promise<TelemetryException> => {
      const exception: TelemetryException | null =
        await ModelAPI.getItem<TelemetryException>({
          id: props.telemetryExceptionId,
          modelType: TelemetryException,
          select: {
            _id: true,
            exceptionType: true,
            message: true,
            ...(dataPlan.loadStackTrace ? { stackTrace: true } : {}),
            fingerprint: true,
            firstSeenAt: true,
            lastSeenAt: true,
            occuranceCount: true,
            isArchived: true,
            isResolved: true,
            firstSeenInRelease: true,
            lastSeenInRelease: true,
            environment: true,
            primaryEntityId: true,
            primaryEntityType: true,
            unhandled: true,
            errorClass: true,
            regressedAt: true,
            resolvedInReleaseAfter: true,
            ...(dataPlan.loadTriageHistory
              ? {
                  markedAsResolvedAt: true,
                  markedAsArchivedAt: true,
                  markedAsResolvedByUser: { name: true, email: true },
                  markedAsArchivedByUser: { name: true, email: true },
                }
              : {}),
          } as Select<TelemetryException>,
        });

      if (!exception) {
        throw new Error("Exception not found");
      }

      setTelemetryException(exception);

      return exception;
    };

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        setIsLoading(true);
        const exception: TelemetryException = await loadException();
        loadSupplementaryData(exception);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

    void load();
  }, []);

  const onTriageAction: (action: ExceptionTriageAction) => void = useCallback(
    (action: ExceptionTriageAction): void => {
      const run: () => Promise<void> = async (): Promise<void> => {
        setPendingActionId(action.id);
        setActionError(undefined);

        try {
          /*
           * Only the switch is sent - and, to resolve in the next release,
           * the release it waits out: the server records who turned it, and
           * when.
           */
          await ModelAPI.updateById<TelemetryException>({
            id: props.telemetryExceptionId,
            modelType: TelemetryException,
            data: getExceptionTriageWrite(action.id, {
              lastSeenInRelease: action.release,
            }),
          });

          await loadException();
        } catch (err) {
          setActionError(API.getFriendlyMessage(err));
        }

        setPendingActionId(undefined);
      };

      void run();
    },
    [props.telemetryExceptionId],
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!telemetryException) {
    return <ErrorMessage message="Exception not found" />;
  }

  const isResolved: boolean = Boolean(telemetryException.isResolved);
  const isArchived: boolean = Boolean(telemetryException.isArchived);

  const getExceptionRoute: (pageMap: PageMap) => Route = (
    pageMap: PageMap,
  ): Route => {
    return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
      modelId: props.telemetryExceptionId,
    });
  };

  const errorTimeUnixMs: number | undefined = latestInstance?.time
    ? new Date(latestInstance.time).getTime()
    : telemetryException.lastSeenAt
      ? new Date(telemetryException.lastSeenAt).getTime()
      : undefined;

  /*
   * "Create monitor": an Exceptions monitor for this exception's type in
   * its service, alerting when it happens again (TelemetryMonitorLink).
   * Only for a reader who may create one.
   */
  const canCreateMonitor: boolean = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  ).isAllowed;

  const navigateToCreateMonitor: () => void = (): void => {
    const params: Dictionary<string> = getTelemetryMonitorLinkParams({
      monitorType: MonitorType.Exceptions,
      query: {
        serviceIds: telemetryException.primaryEntityId
          ? [telemetryException.primaryEntityId.toString()]
          : undefined,
        exceptionTypes: telemetryException.exceptionType
          ? [telemetryException.exceptionType]
          : undefined,
      },
    });

    const currentUrl: URL = Navigation.getCurrentURL();
    const targetUrl: URL = new URL(
      currentUrl.protocol,
      currentUrl.hostname,
      RouteUtil.populateRouteParams(RouteMap[PageMap.MONITOR_CREATE]!),
    );

    for (const paramName of Object.keys(params)) {
      targetUrl.addQueryParam(paramName, params[paramName] as string, true);
    }

    Navigation.navigate(targetUrl);
  };

  const renderSectionLoader: (title: string) => ReactElement = (
    title: string,
  ): ReactElement => {
    return (
      <Card title={title}>
        <div className="flex h-32 items-center justify-center">
          <ComponentLoader />
        </div>
      </Card>
    );
  };

  return (
    <div className="mb-10 space-y-5">
      <ExceptionSummary
        exception={telemetryException}
        services={services}
        {...(dataPlan.showHeaderActions
          ? {
              actions: (
                <>
                  <ExceptionTriageActions
                    isResolved={isResolved}
                    isArchived={isArchived}
                    lastSeenInRelease={telemetryException.lastSeenInRelease}
                    pendingActionId={pendingActionId}
                    onAction={onTriageAction}
                  />
                  {canCreateMonitor ? (
                    <Button
                      title="Create monitor"
                      icon={IconProp.Bell}
                      buttonSize={ButtonSize.Small}
                      buttonStyle={ButtonStyleType.NORMAL}
                      dataTestId="exception-create-monitor"
                      tooltip="Get alerted when this exception happens again."
                      onClick={navigateToCreateMonitor}
                    />
                  ) : (
                    <></>
                  )}
                </>
              ),
            }
          : {})}
      />

      {actionError && dataPlan.showHeaderActions && (
        <div
          className="flex items-start gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-600/10"
          role="alert"
          data-testid="exception-triage-error"
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 flex-shrink-0"
          />
          <p className="min-w-0 flex-1">
            <span className="font-medium">
              {translator.translateText("Could not update this exception.")}
            </span>{" "}
            {actionError}
          </p>
          <button
            type="button"
            className="text-xs font-medium text-red-700 hover:text-red-900"
            onClick={() => {
              setActionError(undefined);
            }}
          >
            {translator.translateText("Dismiss")}
          </button>
        </div>
      )}

      {props.section === ExceptionDetailSection.Overview && (
        <>
          <ExceptionOccurrenceTrend
            fingerprint={telemetryException.fingerprint}
            primaryEntityId={telemetryException.primaryEntityId}
          />
          {/*
           * The exception and its latest occurrence side by side where the
           * page has the room, the shorter card as tall as the other
           * (CardGrid).
           */}
          <CardGrid columns={2} dataTestId="exception-overview-cards">
            <ExceptionDetail {...telemetryException} services={services} />
            <ExceptionLatestOccurrence
              instance={latestInstance}
              isLoading={isOccurrenceLoading}
              links={[
                {
                  title: "View stack trace",
                  to: getExceptionRoute(PageMap.EXCEPTIONS_VIEW_STACK_TRACE),
                  icon: IconProp.Code,
                },
                {
                  title: "All occurrences",
                  to: getExceptionRoute(PageMap.EXCEPTIONS_VIEW_OCCURRENCES),
                  icon: IconProp.List,
                },
              ]}
            />
          </CardGrid>
        </>
      )}

      {props.section === ExceptionDetailSection.StackTrace && (
        <>
          {!telemetryException.stackTrace ? (
            <EmptySection
              title="Stack Trace"
              description="No stack trace was recorded for this exception."
              icon={IconProp.Code}
              message="Future occurrences will show their stack trace here when the telemetry source sends one."
              testId="exception-stack-trace-empty"
            />
          ) : isOccurrenceLoading ? (
            renderSectionLoader("Stack Trace")
          ) : (
            <StackFrameViewer
              stackTrace={telemetryException.stackTrace}
              {...(latestInstance?.parsedFrames
                ? { parsedFrames: latestInstance.parsedFrames }
                : {})}
              {...(resolvedFrames ? { resolvedFrames: resolvedFrames } : {})}
              skippedSourceMapCount={skippedSourceMapCount}
            />
          )}
        </>
      )}

      {props.section === ExceptionDetailSection.Occurrences && (
        <>
          {telemetryException.fingerprint ? (
            <ExceptionOccurrences
              exception={telemetryException}
              fingerprint={telemetryException.fingerprint}
            />
          ) : (
            <EmptySection
              title="Occurrences"
              description="No fingerprint is available to group occurrences for this exception."
              icon={IconProp.List}
              message="Occurrences will appear after the telemetry source supplies a stable exception fingerprint."
              testId="exception-occurrences-empty"
            />
          )}
        </>
      )}

      {props.section === ExceptionDetailSection.Context && (
        <>
          {(latestInstance || isOccurrenceLoading) && (
            <ExceptionLatestOccurrence
              instance={latestInstance}
              isLoading={isOccurrenceLoading}
              description="The session replay and breadcrumbs below come from this occurrence."
              links={[
                {
                  title: "View logs",
                  to: getExceptionRoute(PageMap.EXCEPTIONS_VIEW_LOGS),
                  icon: IconProp.Logs,
                },
                {
                  title: "View stack trace",
                  to: getExceptionRoute(PageMap.EXCEPTIONS_VIEW_STACK_TRACE),
                  icon: IconProp.Code,
                },
              ]}
            />
          )}

          {(latestInstance || isOccurrenceLoading) && (
            <ExceptionOccurrenceAttributes
              instance={latestInstance}
              isLoading={isOccurrenceLoading}
            />
          )}

          {telemetryException.fingerprint && (
            <ReplayCard
              fingerprint={telemetryException.fingerprint}
              primaryEntityId={telemetryException.primaryEntityId}
              primaryEntityType={telemetryException.primaryEntityType}
              /*
               * The occurrence's own session and id let the card pin the
               * search to that recording and link into the moment of error.
               */
              {...(latestInstance?.sessionId
                ? { sessionId: latestInstance.sessionId.toString() }
                : {})}
              {...(latestInstance?.id
                ? { exceptionInstanceId: latestInstance.id.toString() }
                : {})}
              {...(errorTimeUnixMs !== undefined ? { errorTimeUnixMs } : {})}
            />
          )}

          {breadcrumbEvents.length > 0 && (
            <BreadcrumbTimeline
              events={breadcrumbEvents}
              {...(latestInstance?.time
                ? { exceptionTime: new Date(latestInstance.time) }
                : telemetryException.lastSeenAt
                  ? { exceptionTime: new Date(telemetryException.lastSeenAt) }
                  : {})}
            />
          )}

          {!latestInstance && !isOccurrenceLoading && (
            <EmptySection
              title="No Recent Occurrence Context"
              description="No recent trace or breadcrumb data is available for this exception."
              icon={IconProp.Activity}
              message="A session replay can still appear above when a matching recording is available. New context will appear when another occurrence includes a trace or an application session."
              testId="exception-context-empty"
            />
          )}
        </>
      )}

      {props.section === ExceptionDetailSection.Logs && (
        <ExceptionLogs
          instance={latestInstance}
          isLoading={isOccurrenceLoading}
          primaryEntityType={telemetryException.primaryEntityType}
        />
      )}

      {props.section === ExceptionDetailSection.AIAssistance && (
        <ExceptionAIAssistance
          telemetryExceptionId={props.telemetryExceptionId}
          isResolved={isResolved}
          isArchived={isArchived}
        />
      )}

      {props.section === ExceptionDetailSection.Settings && (
        <ExceptionSettings
          exception={telemetryException}
          telemetryExceptionId={props.telemetryExceptionId}
          pendingActionId={pendingActionId}
          actionError={actionError}
          onDismissActionError={() => {
            setActionError(undefined);
          }}
          onAction={onTriageAction}
        />
      )}
    </div>
  );
};

export default ExceptionExplorer;
