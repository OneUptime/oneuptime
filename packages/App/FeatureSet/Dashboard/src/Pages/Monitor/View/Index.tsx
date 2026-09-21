import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";
import DependencySuppressionWarning from "../../../Components/Monitor/DependencySuppressionWarning";
import MonitorActivityCard from "../../../Components/Monitor/Overview/MonitorActivityCard";
import MonitorConnectionCard from "../../../Components/Monitor/Overview/MonitorConnectionCard";
import MonitorManualGuideCard from "../../../Components/Monitor/Overview/MonitorManualGuideCard";
import MonitorOpenWorkCard from "../../../Components/Monitor/Overview/MonitorOpenWorkCard";
import MonitorOverviewDetailsCard from "../../../Components/Monitor/Overview/MonitorOverviewDetailsCard";
import MonitorOverviewHero from "../../../Components/Monitor/Overview/MonitorOverviewHero";
import {
  getTelemetryLastCheckedAt,
  getTelemetryLastCheckedLabel,
  toPresentationInput,
} from "../../../Components/Monitor/Overview/MonitorOverviewInput";
import MonitorOverviewStatBar from "../../../Components/Monitor/Overview/MonitorOverviewStatBar";
import {
  MonitorOpenWork,
  MonitorOverviewProbeData,
} from "../../../Components/Monitor/Overview/MonitorOverviewTypes";
import MonitorProbesCard from "../../../Components/Monitor/Overview/MonitorProbesCard";
import MonitorResponseTimeCard from "../../../Components/Monitor/Overview/MonitorResponseTimeCard";
import MonitorSetupCard from "../../../Components/Monitor/Overview/MonitorSetupCard";
import MonitorStatusChangesCard from "../../../Components/Monitor/Overview/MonitorStatusChangesCard";
import MonitorTelemetryPreview from "../../../Components/Monitor/Overview/MonitorTelemetryPreview";
import MonitorUptimeHistoryCard from "../../../Components/Monitor/Overview/MonitorUptimeHistoryCard";
import useMonitorOpenWork from "../../../Components/Monitor/Overview/useMonitorOpenWork";
import useMonitorOverviewData, {
  MONITOR_OVERVIEW_NOT_FOUND_MESSAGE,
  MONITOR_OVERVIEW_UPTIME_POLLS_PER_RELOAD,
  UseMonitorOverviewDataResult,
} from "../../../Components/Monitor/Overview/useMonitorOverviewData";
import useMonitorOwners, {
  UseMonitorOwnersResult,
} from "../../../Components/Monitor/Overview/useMonitorOwners";
import useMonitorUptimeSummary, {
  UseMonitorUptimeSummaryResult,
} from "../../../Components/Monitor/Overview/useMonitorUptimeSummary";
import Summary from "../../../Components/Monitor/SummaryView/Summary";
import PageComponentProps from "../../PageComponentProps";
import MonitorViewOutletContext from "./MonitorViewOutletContext";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import Probe from "Common/Models/DatabaseModels/Probe";
import OneUptimeDate from "Common/Types/Date";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewSections,
} from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorEvaluationByProbe } from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import { MonitorUptimeCaveat } from "Common/Utils/Monitor/MonitorUptimeSummaryUtil";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { useOutletContext } from "react-router-dom";

/*
 * Monitor Overview: "is this monitor healthy, and is it actually checking?"
 *
 * Top to bottom: the dependency notice; the hero, which owns the state (run
 * state, status, what is checked and when, owners); the uptime and open-work
 * stat bar; then the house two-thirds / one-third grid. The main column
 * holds what the monitor measured (setup while it waits for data, 90 days of
 * uptime, response time, the latest summary, a telemetry preview, activity);
 * the side column holds what is open, recent status changes, the family's
 * own card (probes, connection or the manual guide), the editable details
 * and custom fields.
 *
 * Which sections a monitor gets is decided by the pure presentation model in
 * Common (MonitorOverviewPresentationUtil), per monitor family, so nothing
 * type-specific is decided here.
 *
 * Data comes from ONE poll (useMonitorOverviewData). The uptime, open-work
 * and owner hooks have no timers of their own; they reload on tokens derived
 * from that poll below. Everything but the Monitor row is a section that can
 * be forbidden or fail on its own, so Viewer, MonitorViewer and
 * ReadProjectMonitor can all open the page.
 */
const MonitorView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();

  const outlet: MonitorViewOutletContext | undefined = useOutletContext<
    MonitorViewOutletContext | undefined
  >();

  const data: UseMonitorOverviewDataResult = useMonitorOverviewData({
    monitorId: modelId,
  });

  const monitor: Monitor | null = data.monitor;

  /*
   * The moment the page is judged at: when the data on screen was
   * committed, on the server's clock.
   * - The commit, not the render: a render between polls (a refresh
   *   starting, the tab coming back after an hour) must not age results
   *   the page has not re-read yet, or the hero would flash "overdue" until
   *   the new data lands. Every poll's commit moves it on, so a real
   *   "overdue" still shows within a poll.
   * - The server's clock: every time the monitor carries was stamped by the
   *   server, so a browser clock minutes fast would read every check as late.
   * Probe results held after a failed read are judged as of that read
   * instead (getJudgedAt). Every health judgement on the page, the Probes
   * card's included, comes from presentationInput, so no card can disagree
   * with the hero; only "is the next check still ahead" is asked of the
   * commit. The ticking relative times ("2 minutes ago") keep the reader's
   * clock, like the rest of the dashboard.
   */
  const now: Date = new Date(
    (data.lastLoadedAt || OneUptimeDate.getCurrentDate()).getTime() +
      data.serverClockOffsetMs,
  );

  const presentationInput: MonitorOverviewPresentationInput | null = monitor
    ? toPresentationInput({
        monitor: monitor,
        probes: data.probes,
        statusRows: data.statusRows,
        evaluation: data.evaluation,
        now: now,
        serverClockOffsetMs: data.serverClockOffsetMs,
      })
    : null;

  let presentation: MonitorOverviewPresentation | null = null;
  let presentationError: string = "";

  if (presentationInput) {
    try {
      presentation = MonitorOverviewPresentationUtil.build(presentationInput);
    } catch (err) {
      /*
       * A monitor type this build of the dashboard does not know has no
       * overview family. The page says so below instead of going down.
       */
      presentationError = err instanceof Error ? err.message : "";
    }
  }

  /*
   * The uptime aggregate reloads every fifth poll, when the status changes
   * and on the Refresh button. It follows the status change COUNT rather
   * than the fingerprint: the fingerprint goes from "" to its first value
   * when the page loads, which would read the aggregate a second time on
   * every visit. While the page hides the uptime sections (a monitor still
   * waiting for its first data) it is read once and not reloaded. Its
   * server time is the page's measure of the server's clock.
   */
  const uptime: UseMonitorUptimeSummaryResult = useMonitorUptimeSummary({
    monitorId: modelId,
    refreshKey: [
      data.statusChangeCount,
      Math.floor(data.pollCount / MONITOR_OVERVIEW_UPTIME_POLLS_PER_RELOAD),
      data.manualRefreshCount,
    ].join("|"),
    isShown: presentation ? presentation.sections.showUptime : true,
    onServerClockOffset: data.setServerClockOffset,
  });

  /*
   * What is open changes with every check, so it reloads on every poll, on
   * a status change and on Refresh. Not on the data hook's refreshCount:
   * that moves when the first load lands, which would read both lists twice
   * on every visit.
   */
  const openWork: MonitorOpenWork = useMonitorOpenWork({
    monitorId: modelId,
    refreshToken:
      data.pollCount + data.statusChangeCount + data.manualRefreshCount,
  });

  // Owners change rarely: once per monitor, and again on Refresh.
  const ownersResult: UseMonitorOwnersResult = useMonitorOwners({
    monitorId: modelId,
    refreshToken: data.manualRefreshCount,
  });

  // Bumped when the details card saves, so the feed shows the edit.
  const [detailsSaveCount, setDetailsSaveCount] = useState<number>(0);

  /*
   * The monitor the page is on now. A save from the details card of the
   * monitor the reader just left can land after the switch; its refresh
   * would cancel this monitor's first load, so it is ignored.
   */
  const currentModelIdRef: MutableRefObject<string> =
    useRef<string>(modelIdString);

  useEffect(() => {
    currentModelIdRef.current = modelIdString;
  }, [modelIdString]);

  if (!data.hasLoaded) {
    return (
      <EventOverviewSkeleton statCount={4} loadingText="Loading monitor" />
    );
  }

  if (data.error || !monitor) {
    return (
      <ErrorMessage
        message={data.error || MONITOR_OVERVIEW_NOT_FOUND_MESSAGE}
        onRefreshClick={data.retryFirstLoad}
      />
    );
  }

  if (!presentationInput || !presentation) {
    return (
      <ErrorMessage
        message={`This monitor's overview cannot be shown. ${presentationError}`.trim()}
      />
    );
  }

  const monitorType: MonitorType = presentationInput.monitorType;
  const sections: MonitorOverviewSections = presentation.sections;

  const probeData: MonitorOverviewProbeData | null = data.probes.value;
  const evaluation: MonitorEvaluationByProbe | null = data.evaluation.value;
  const probes: Array<Probe> = probeData?.attached.probes || [];
  const disabledProbeIds: Array<string> =
    probeData?.attached.disabledProbeIds || [];

  /*
   * Probe rows that could not be read (forbidden, or failed with nothing
   * kept) are not "no probes attached", which is what the Summary card
   * would otherwise say.
   */
  const probeLoadError: string | undefined =
    !probeData &&
    (data.probes.status === "error" || data.probes.status === "forbidden")
      ? data.probes.error
      : undefined;

  /*
   * What every uptime window must add about time it counts but nothing
   * measured: paused, nothing checking, or no check completed yet. It
   * follows the run state, so a Manual monitor, which has no checks to
   * pause, never gets one.
   */
  const uptimeCaveat: MonitorUptimeCaveat | null =
    MonitorOverviewPresentationUtil.getUptimeCaveat(presentation);

  const feedRefreshToken: number =
    data.manualRefreshCount + data.statusChangeCount + detailsSaveCount;

  const onDetailsSaved: () => void = (): void => {
    if (currentModelIdRef.current !== modelIdString) {
      return;
    }

    // The hero, the page header and the feed all show what was just edited.
    data.refresh({ reason: "details-saved" });
    outlet?.refreshHeader();
    setDetailsSaveCount((count: number) => {
      return count + 1;
    });
  };

  return (
    <Fragment>
      <DependencySuppressionWarning
        monitorId={modelId}
        refreshToggle={`${data.statusChangeCount}|${data.manualRefreshCount}`}
      />

      <div className="mb-5">
        <MonitorOverviewHero
          monitorId={modelId}
          monitorType={monitorType}
          presentation={presentation}
          owners={ownersResult.owners}
          isRefreshing={data.isRefreshing}
          refreshError={data.refreshError}
          lastLoadedAt={data.lastLoadedAt}
          onRefresh={() => {
            data.refresh();
          }}
        />
      </div>

      {sections.showUptime ? (
        <MonitorOverviewStatBar
          className="mb-5"
          monitorId={modelId}
          summary={uptime.summary}
          caveat={uptimeCaveat}
          openWork={openWork}
        />
      ) : (
        <></>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {sections.setup !== null ? (
            <MonitorSetupCard
              monitorId={modelId}
              kind={sections.setup}
              monitor={monitor}
            />
          ) : (
            <></>
          )}

          {sections.showUptime ? (
            <MonitorUptimeHistoryCard
              summary={uptime.summary}
              incidents={uptime.incidents}
              monitorCreatedAt={monitor.createdAt}
              onRetry={uptime.retry}
            />
          ) : (
            <></>
          )}

          {sections.responseTimeMetric !== null ? (
            <MonitorResponseTimeCard
              monitorId={modelId}
              monitorType={monitorType}
              metric={sections.responseTimeMetric}
              probes={probes}
              responseTime={presentationInput.probes?.responseTime ?? null}
            />
          ) : (
            <></>
          )}

          {sections.summary.isShown ? (
            <Summary
              monitorType={monitorType}
              probes={probes}
              disabledProbeIds={disabledProbeIds}
              monitorSteps={monitor.monitorSteps}
              /*
               * Lets the card offer "Test Monitor" from here (issue #3867).
               * The id is what the server needs to resolve this monitor's
               * secrets for the test run, so the test exercises the same
               * request the monitor really makes.
               */
              monitorId={modelId}
              description={sections.summary.description}
              probeLoadError={probeLoadError}
              probeMonitorResponses={probeData?.attached.probeResponses}
              evaluationSummariesByProbeId={evaluation?.byProbeId}
              evaluationSummary={evaluation?.latest?.summary}
              incomingMonitorRequest={monitor.incomingMonitorRequest}
              incomingRequestMonitorHeartbeatCheckedAt={
                monitor.incomingRequestMonitorHeartbeatCheckedAt
              }
              incomingEmailMonitorRequest={
                monitor.incomingEmailMonitorRequest as
                  | IncomingEmailMonitorRequest
                  | undefined
              }
              incomingEmailMonitorHeartbeatCheckedAt={
                monitor.incomingEmailMonitorHeartbeatCheckedAt
              }
              serverMonitorResponse={monitor.serverMonitorResponse}
              /*
               * The last check is the newest evaluation in the log when
               * there is one, as in the hero: the scheduler's stamp moves
               * even when no evaluation lands.
               */
              telemetryMonitorSummary={{
                lastCheckedAt: getTelemetryLastCheckedAt({
                  monitor: monitor,
                  evaluation: data.evaluation,
                }),
                lastCheckedLabel: getTelemetryLastCheckedLabel({
                  evaluation: data.evaluation,
                }),
                nextCheckAt: monitor.telemetryMonitorNextMonitorAt,
              }}
            />
          ) : (
            <></>
          )}

          {sections.telemetryPreview !== null ? (
            <MonitorTelemetryPreview
              monitorType={monitorType}
              monitorSteps={monitor.monitorSteps}
            />
          ) : (
            <></>
          )}

          <MonitorActivityCard
            monitorId={modelId}
            refreshToken={feedRefreshToken}
          />
        </div>

        <div className="min-w-0">
          <MonitorOpenWorkCard monitorId={modelId} openWork={openWork} />

          <MonitorStatusChangesCard
            monitorId={modelId}
            statusRows={data.statusRows}
          />

          {/* The family's own card: at most one of these three. */}
          {sections.sideCard === "probes" ? (
            <MonitorProbesCard
              monitorId={modelId}
              probes={data.probes}
              summary={presentationInput.probes}
              /*
               * Row health comes from the summary. The card only asks
               * whether a row's next check is still ahead, which is a
               * question about the commit, not about when held results
               * were read.
               */
              now={now}
              minimumProbeAgreement={presentationInput.minimumProbeAgreement}
            />
          ) : (
            <></>
          )}

          {sections.sideCard === "connection" &&
          sections.connection !== null ? (
            <MonitorConnectionCard
              monitorId={modelId}
              kind={sections.connection}
              monitor={monitor}
            />
          ) : (
            <></>
          )}

          {sections.sideCard === "manual" ? (
            <MonitorManualGuideCard monitorId={modelId} />
          ) : (
            <></>
          )}

          <MonitorOverviewDetailsCard
            monitorId={modelId}
            refresher={data.manualRefreshCount % 2 === 1}
            onSaveSuccess={onDetailsSaved}
          />

          <OverviewCustomFields
            modelId={modelId}
            modelType={Monitor}
            customFieldType={MonitorCustomField}
            resourceName="Monitor"
            headerLayout="stacked"
          />
        </div>
      </div>
    </Fragment>
  );
};

export default MonitorView;
