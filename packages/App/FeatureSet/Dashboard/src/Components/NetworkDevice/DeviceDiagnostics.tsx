import TracerouteHopsTable from "./TracerouteHopsTable";
import {
  DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES,
  DIAGNOSTIC_MAX_POLL_ATTEMPTS,
  DIAGNOSTIC_POLL_INTERVAL_IN_MS,
  DiagnosticRow,
  PingResultSummary,
  PingResultTone,
  TraceRouteSummary,
  describePingResult,
  describeTraceRoute,
  diagnosticTimeoutMessage,
} from "./DeviceDiagnosticsViewModel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  NetworkDeviceDiagnosticStatus,
  isNetworkDeviceDiagnosticSettled,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Link from "Common/UI/Components/Link/Link";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  networkDeviceId: ObjectID;
  /*
   * Test seam, the same one ModelTable and ModelDetail expose: the real
   * ModelAPI reads `window` at import and talks to the network, and a test
   * of "what does the drawer show while the probe works" needs neither.
   */
  modelAPI?: typeof ModelAPI | undefined;
}

type OutcomeKind = "completed" | "failed" | "timeout" | "error";

interface DiagnosticOutcome {
  kind: OutcomeKind;
  type: NetworkDeviceDiagnosticType;
  row?: NetworkDeviceDiagnostic | undefined;
  message?: string | undefined;
}

interface PollData {
  // Bumped per run; a poll whose runId is stale belongs to a superseded run.
  runId: number;
  diagnosticId: ObjectID;
  type: NetworkDeviceDiagnosticType;
  attempt: number;
  // Rejected reads in a row. A read that returns a row resets it.
  consecutiveFailures: number;
}

const GONE_MESSAGE: string =
  "This diagnostic no longer exists. The device or its probe may have been deleted.";

const NO_PROBE_MESSAGE: string =
  "This device has no probe assigned, so there is nothing to ping or trace it from.";

const TONE_CLASS_NAMES: Record<PingResultTone, string> = {
  up: "text-green-700",
  down: "text-red-700",
  degraded: "text-amber-700",
};

/*
 * Ping / Traceroute on demand, from the device's own probe (issue #3745).
 *
 * Follows the MonitorTest pattern rather than a synchronous endpoint: the
 * probe is the only thing that can reach the device, and the probe pulls
 * work — so the dashboard creates a NetworkDeviceDiagnostic row and reads it
 * back every few seconds until the probe has written a result into it.
 *
 * The device itself is read once per device, for two facts the buttons
 * need: whether there is a probe to run from at all, and the hostname and
 * probe name the result and the timeout message are labelled with. That
 * read is the only request made before a button is pressed — the topology
 * drawer mounts this for every managed device it opens, and a drawer that
 * fired a ping on open would run one per click across the map. A device
 * with no probe gets a note pointing at Settings instead of two buttons
 * whose every press would fail with the same sentence.
 */
const DeviceDiagnostics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [isDeviceLoading, setIsDeviceLoading] = useState<boolean>(true);
  const [deviceError, setDeviceError] = useState<string>("");

  const [runningType, setRunningType] =
    useState<NetworkDeviceDiagnosticType | null>(null);
  const [outcome, setOutcome] = useState<DiagnosticOutcome | null>(null);

  /*
   * Refs, not state: the poll loop closes over them, and a timer that reads
   * a stale `isMounted` from a closure would set state on an unmounted
   * drawer after the operator clicked the next device.
   */
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  // Bumped per run so a late poll from a superseded run is ignored.
  const runIdRef: React.MutableRefObject<number> = useRef<number>(0);

  type StopPollingFunction = () => void;
  const stopPolling: StopPollingFunction = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, []);

  const networkDeviceIdString: string = props.networkDeviceId.toString();

  /*
   * The topology drawer hands this same instance the next node the operator
   * clicks (SideOver has no backdrop and the panel is not remounted), so a
   * run started for device A must never paint its result under device B.
   * Bumping the run id orphans A's in-flight read; the panel also keys the
   * section per node, but a reused instance has to be safe on its own.
   * The device read follows the same switch, for the same reason.
   */
  useEffect(() => {
    runIdRef.current += 1;
    stopPolling();
    setOutcome(null);
    setRunningType(null);

    let isCancelled: boolean = false;

    setDevice(null);
    setDeviceError("");
    setIsDeviceLoading(true);

    modelAPI
      .getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: props.networkDeviceId,
        select: {
          hostname: true,
          probeId: true,
          probe: {
            name: true,
          },
        },
      })
      .then((item: NetworkDevice | null) => {
        if (isCancelled) {
          return;
        }

        setDevice(item);
        setIsDeviceLoading(false);
      })
      .catch((err: unknown) => {
        if (isCancelled) {
          return;
        }

        setDeviceError(API.getFriendlyMessage(err));
        setIsDeviceLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [networkDeviceIdString]);

  type FinishFunction = (result: DiagnosticOutcome) => void;
  const finish: FinishFunction = (result: DiagnosticOutcome): void => {
    stopPolling();

    if (!isMountedRef.current) {
      return;
    }

    setOutcome(result);
    setRunningType(null);
  };

  type ScheduleNextPollFunction = (data: PollData) => void;
  const scheduleNextPoll: ScheduleNextPollFunction = (data: PollData): void => {
    /*
     * Chained timeouts rather than setInterval: the next read is scheduled
     * only after this one returned, so a slow API never stacks overlapping
     * reads of the same row.
     */
    timerRef.current = setTimeout(() => {
      poll(data).catch(() => {
        // poll reports its own failures through finish().
      });
    }, DIAGNOSTIC_POLL_INTERVAL_IN_MS);
  };

  type PollFunction = (data: PollData) => Promise<void>;

  const poll: PollFunction = async (data: PollData): Promise<void> => {
    if (!isMountedRef.current || data.runId !== runIdRef.current) {
      return;
    }

    let row: NetworkDeviceDiagnostic | null = null;

    try {
      row = await modelAPI.getItem<NetworkDeviceDiagnostic>({
        modelType: NetworkDeviceDiagnostic,
        id: data.diagnosticId,
        select: {
          status: true,
          statusMessage: true,
          pingResult: true,
          traceRouteResult: true,
          hostname: true,
          completedAt: true,
        },
      });
    } catch (err) {
      if (!isMountedRef.current || data.runId !== runIdRef.current) {
        return;
      }

      const consecutiveFailures: number = data.consecutiveFailures + 1;

      /*
       * One rejected read is not a verdict on the run: the probe is still
       * working the row, and an API that just timed out will very likely
       * answer three seconds later. Only a streak of failures ends the run
       * with an error; hitting the two-minute cap mid-streak is still a
       * timeout, because that is what the operator has been waiting on.
       */
      if (consecutiveFailures >= DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES) {
        finish({
          kind: "error",
          type: data.type,
          message: API.getFriendlyMessage(err),
        });
        return;
      }

      if (data.attempt >= DIAGNOSTIC_MAX_POLL_ATTEMPTS) {
        finish({ kind: "timeout", type: data.type });
        return;
      }

      scheduleNextPoll({
        ...data,
        attempt: data.attempt + 1,
        consecutiveFailures,
      });
      return;
    }

    if (!isMountedRef.current || data.runId !== runIdRef.current) {
      return;
    }

    /*
     * Both foreign keys cascade and hard-delete: delete the device or its
     * probe mid-run and the row is gone. BaseAPI then answers {} and
     * ModelAPI builds an EMPTY model from it, not null — a row with no id
     * that would otherwise be polled as "still pending" until the cap.
     */
    if (!row || !row.id) {
      finish({
        kind: "error",
        type: data.type,
        message: translateString(GONE_MESSAGE) || GONE_MESSAGE,
      });
      return;
    }

    if (isNetworkDeviceDiagnosticSettled(row.status)) {
      finish({
        kind:
          row.status === NetworkDeviceDiagnosticStatus.Completed
            ? "completed"
            : "failed",
        type: data.type,
        row,
      });
      return;
    }

    if (data.attempt >= DIAGNOSTIC_MAX_POLL_ATTEMPTS) {
      finish({ kind: "timeout", type: data.type });
      return;
    }

    scheduleNextPoll({
      ...data,
      attempt: data.attempt + 1,
      consecutiveFailures: 0,
    });
  };

  type RunFunction = (type: NetworkDeviceDiagnosticType) => Promise<void>;
  const run: RunFunction = async (
    type: NetworkDeviceDiagnosticType,
  ): Promise<void> => {
    stopPolling();
    runIdRef.current += 1;
    const runId: number = runIdRef.current;

    setOutcome(null);
    setRunningType(type);

    try {
      const diagnostic: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic();
      diagnostic.networkDeviceId = props.networkDeviceId;
      diagnostic.diagnosticType = type;

      const response: HTTPResponse<
        | JSONObject
        | JSONArray
        | NetworkDeviceDiagnostic
        | Array<NetworkDeviceDiagnostic>
      > = await modelAPI.create<NetworkDeviceDiagnostic>({
        model: diagnostic,
        modelType: NetworkDeviceDiagnostic,
      });

      const created: NetworkDeviceDiagnostic =
        response.data as NetworkDeviceDiagnostic;
      const diagnosticId: ObjectID | null =
        created.id ||
        ((created as unknown as JSONObject)["_id"]
          ? new ObjectID(String((created as unknown as JSONObject)["_id"]))
          : null);

      if (!diagnosticId) {
        throw new Error(
          "The diagnostic was created but its id did not come back.",
        );
      }

      if (!isMountedRef.current || runId !== runIdRef.current) {
        return;
      }

      scheduleNextPoll({
        runId,
        diagnosticId,
        type,
        attempt: 1,
        consecutiveFailures: 0,
      });
    } catch (err) {
      if (runId === runIdRef.current) {
        finish({
          kind: "error",
          type,
          message: API.getFriendlyMessage(err),
        });
      }
    }
  };

  const isRunning: boolean = runningType !== null;

  type GetPingResultElementFunction = (
    row: NetworkDeviceDiagnostic,
  ) => ReactElement;

  const getPingResultElement: GetPingResultElementFunction = (
    row: NetworkDeviceDiagnostic,
  ): ReactElement => {
    if (!row.pingResult) {
      return (
        <p className="text-sm text-gray-500">
          {translateString("The probe reported no ping statistics.") ||
            "The probe reported no ping statistics."}
        </p>
      );
    }

    // The row's own hostname wins: it is what the probe actually pinged.
    const summary: PingResultSummary = describePingResult(
      row.pingResult,
      row.hostname || device?.hostname,
    );

    return (
      <div>
        <p
          className={`text-sm font-semibold ${TONE_CLASS_NAMES[summary.tone]}`}
        >
          {translateString(summary.headline) || summary.headline}
        </p>
        <dl className="mt-2 space-y-1 text-sm text-gray-600">
          {summary.rows.map(
            (diagnosticRow: DiagnosticRow, index: number): ReactElement => {
              return (
                <div key={index} className="flex justify-between gap-4">
                  <dt>
                    {translateString(diagnosticRow.label) ||
                      diagnosticRow.label}
                  </dt>
                  <dd className="font-medium text-right break-all">
                    {diagnosticRow.value}
                  </dd>
                </div>
              );
            },
          )}
        </dl>
      </div>
    );
  };

  type GetTraceRouteResultElementFunction = (
    row: NetworkDeviceDiagnostic,
  ) => ReactElement;

  const getTraceRouteResultElement: GetTraceRouteResultElementFunction = (
    row: NetworkDeviceDiagnostic,
  ): ReactElement => {
    if (!row.traceRouteResult) {
      return (
        <p className="text-sm text-gray-500">
          {translateString("The probe reported no path.") ||
            "The probe reported no path."}
        </p>
      );
    }

    const summary: TraceRouteSummary = describeTraceRoute(row.traceRouteResult);

    return (
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {summary.headline}
        </p>
        {summary.dnsLine ? (
          <p className="mt-1 text-xs text-gray-500">
            <span className="font-medium">DNS:</span> {summary.dnsLine}
          </p>
        ) : (
          <></>
        )}
        {summary.note ? (
          <p className="mt-1 text-xs text-gray-500">{summary.note}</p>
        ) : (
          <></>
        )}
        <div className="mt-2">
          <TracerouteHopsTable hops={summary.hops} />
        </div>
      </div>
    );
  };

  type GetOutcomeElementFunction = (result: DiagnosticOutcome) => ReactElement;

  const getOutcomeElement: GetOutcomeElementFunction = (
    result: DiagnosticOutcome,
  ): ReactElement => {
    if (result.kind === "timeout") {
      return (
        <p className="text-sm text-amber-700">
          {diagnosticTimeoutMessage(result.type, device?.probe?.name)}
        </p>
      );
    }

    if (result.kind === "error") {
      return (
        <p className="text-sm text-red-700">
          {result.message ||
            translateString("The diagnostic could not be started.") ||
            "The diagnostic could not be started."}
        </p>
      );
    }

    if (result.kind === "failed") {
      return (
        <p className="text-sm text-red-700">
          {result.row?.statusMessage ||
            translateString("The probe could not run this diagnostic.") ||
            "The probe could not run this diagnostic."}
        </p>
      );
    }

    if (!result.row) {
      return <></>;
    }

    return result.type === NetworkDeviceDiagnosticType.Traceroute
      ? getTraceRouteResultElement(result.row)
      : getPingResultElement(result.row);
  };

  type GetNoProbeElementFunction = () => ReactElement;

  const getNoProbeElement: GetNoProbeElementFunction = (): ReactElement => {
    const settingsRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
      { modelId: props.networkDeviceId },
    );

    return (
      <div
        className="rounded-md bg-gray-50 p-3 text-sm text-gray-600"
        data-testid="network-device-diagnostics-no-probe"
      >
        <p>{translateString(NO_PROBE_MESSAGE) || NO_PROBE_MESSAGE}</p>
        <div className="mt-2">
          <Link
            to={settingsRoute}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {translateString("Assign a probe in Settings") ||
              "Assign a probe in Settings"}
          </Link>
        </div>
      </div>
    );
  };

  type GetToolsElementFunction = () => ReactElement;

  const getToolsElement: GetToolsElementFunction = (): ReactElement => {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            title={translateString("Ping") || "Ping"}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="network-device-diagnostic-ping"
            disabled={isRunning}
            onClick={() => {
              run(NetworkDeviceDiagnosticType.Ping).catch(() => {
                // run reports its own failures through finish().
              });
            }}
          />
          <Button
            title={translateString("Traceroute") || "Traceroute"}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="network-device-diagnostic-traceroute"
            disabled={isRunning}
            onClick={() => {
              run(NetworkDeviceDiagnosticType.Traceroute).catch(() => {
                // run reports its own failures through finish().
              });
            }}
          />
        </div>

        {!isRunning && !outcome ? (
          <p className="mt-2 text-xs text-gray-500">
            {translateString("Runs from this device's probe.") ||
              "Runs from this device's probe."}
          </p>
        ) : (
          <></>
        )}

        {isRunning ? (
          <div
            className="mt-3 flex items-center gap-3 text-sm text-gray-500"
            data-testid="network-device-diagnostic-running"
          >
            <Loader loaderType={LoaderType.Beats} size={8} />
            <span>
              {translateString("Waiting for the probe…") ||
                "Waiting for the probe…"}
            </span>
          </div>
        ) : (
          <></>
        )}

        {outcome ? (
          /*
           * A live region: the result lands seconds after the click, when
           * a screen-reader user's focus is still on the button.
           */
          <div
            className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-3"
            data-testid="network-device-diagnostic-result"
            role="status"
            aria-live="polite"
          >
            {getOutcomeElement(outcome)}
          </div>
        ) : (
          <></>
        )}
      </>
    );
  };

  type GetBodyElementFunction = () => ReactElement;

  const getBodyElement: GetBodyElementFunction = (): ReactElement => {
    if (isDeviceLoading) {
      return <ComponentLoader />;
    }

    if (deviceError) {
      return (
        <p
          className="text-sm text-red-700"
          data-testid="network-device-diagnostics-error"
        >
          {deviceError}
        </p>
      );
    }

    if (!device?.probeId) {
      return getNoProbeElement();
    }

    return getToolsElement();
  };

  return (
    <div data-testid="network-device-diagnostics" aria-busy={isRunning}>
      {getBodyElement()}
    </div>
  );
};

export default DeviceDiagnostics;
