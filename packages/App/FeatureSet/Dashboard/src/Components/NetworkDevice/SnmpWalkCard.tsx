import SnmpWalkResults from "./SnmpWalkResults";
import {
  SNMP_WALK_HISTORY_LIMIT,
  SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
  SNMP_WALK_MAX_POLL_ATTEMPTS,
  SNMP_WALK_POLL_INTERVAL_IN_MS,
  SNMP_WALK_START_POINTS,
  SnmpWalkHistoryEntry,
  SnmpWalkMessage,
  SnmpWalkPage,
  SnmpWalkRowNotice,
  SnmpWalkRowView,
  SnmpWalkStartPoint,
  addWalkedOid,
  buildSnmpWalkAlertQuery,
  chainSnmpWalkPages,
  describeSnmpWalkFailure,
  describeSnmpWalkSummary,
  getCollectedOids,
  getSelectedStartPoint,
  getSnmpWalkContinueAfter,
  getSnmpWalkRows,
  isNumericSnmpWalkRow,
  isWalkableStart,
  snmpWalkTimeoutMessage,
  toSnmpWalkRowView,
  toWalkRoot,
  translateSnmpWalkServerMessage,
} from "./SnmpWalkViewModel";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import {
  NetworkDeviceDiagnosticStatus,
  isNetworkDeviceDiagnosticSettled,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_DEFAULT_ROOT_OID,
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_RUNNING_WINDOW_IN_MINUTES,
  SnmpWalkRow,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  networkDeviceId: ObjectID;
  // Whether the reader may start a walk (create a Network Device Diagnostic).
  canWalk: boolean;
  // Whether the reader may change the device (collect an OID on it).
  canEditDevice: boolean;
  // Whether the reader may change OID Collection Templates.
  canEditTemplate: boolean;
  // Whether the reader may create monitors ("Alert on it").
  canCreateMonitor: boolean;
  /*
   * Test seam, as DeviceDiagnostics has: the real ModelAPI reads `window`
   * at import and talks to the network.
   */
  modelAPI?: typeof ModelAPI | undefined;
}

interface RunningWalk {
  runId: number;
  diagnosticId: ObjectID;
  rootOid: string;
  // Set for a walk that continues the pages already shown.
  afterOid?: string | undefined;
}

interface PollData {
  runId: number;
  diagnosticId: ObjectID;
  isContinuation: boolean;
  attempt: number;
  consecutiveFailures: number;
}

const DEVICE_SELECT: Select<NetworkDevice> = {
  name: true,
  probeId: true,
  probe: { name: true },
  monitoringMethod: true,
  snmpOids: true,
  oidTemplateId: true,
  oidTemplate: { name: true, oids: true },
};

const WALK_SELECT: Select<NetworkDeviceDiagnostic> = {
  _id: true,
  status: true,
  statusMessage: true,
  createdAt: true,
  snmpWalkRootOid: true,
  snmpWalkAfterOid: true,
  snmpWalkResult: true,
};

function toHistoryEntry(row: NetworkDeviceDiagnostic): SnmpWalkHistoryEntry {
  return {
    diagnosticId: row.id?.toString() || "",
    status: row.status,
    createdAt: row.createdAt,
    rootOid: row.snmpWalkRootOid,
    afterOid: row.snmpWalkAfterOid,
    result: row.snmpWalkResult,
  };
}

/*
 * The device's SNMP Walk page (issue #5184): walk the device's OID tree from
 * its probe, with its saved credentials, and turn what it finds into
 * monitoring - collect an OID on every poll, then alert on it.
 *
 * A walk is a Network Device Diagnostic of type "SNMP Walk", like Ping and
 * Traceroute: this creates the row, then reads it back every few seconds
 * until the probe has written what it read. A walk reads at most a thousand
 * OIDs; "Continue walking" reads the next thousand, and the pages are
 * shown as one list. The last walk, and the walks it continued, come back
 * after a reload: they are kept two days.
 */
const SnmpWalkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  const [startOid, setStartOid] = useState<string>("");
  const [pages, setPages] = useState<Array<SnmpWalkPage>>([]);
  const [running, setRunning] = useState<RunningWalk | null>(null);
  const [walkError, setWalkError] = useState<string>("");

  const [collectingOid, setCollectingOid] = useState<string | undefined>(
    undefined,
  );
  // What the last Collect came to, said in its OID's row.
  const [collectNotice, setCollectNotice] = useState<
    SnmpWalkRowNotice | undefined
  >(undefined);
  /*
   * OIDs collected from this page: shown as collected at once, whatever
   * the device read that follows the write answers.
   */
  const [justCollected, setJustCollected] = useState<Array<string>>([]);

  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const runIdRef: React.MutableRefObject<number> = useRef<number>(0);

  const stopPolling: () => void = (): void => {
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

  const loadDevice: () => Promise<NetworkDevice | null> =
    async (): Promise<NetworkDevice | null> => {
      return await modelAPI.getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: props.networkDeviceId,
        select: DEVICE_SELECT,
      });
    };

  /*
   * The device's latest walks, newest first. A reader who may not read
   * diagnostics still gets the page; they just start with no walk shown.
   */
  const loadHistory: () => Promise<
    Array<NetworkDeviceDiagnostic>
  > = async (): Promise<Array<NetworkDeviceDiagnostic>> => {
    try {
      const list: ListResult<NetworkDeviceDiagnostic> =
        await modelAPI.getList<NetworkDeviceDiagnostic>({
          modelType: NetworkDeviceDiagnostic,
          query: {
            networkDeviceId: props.networkDeviceId,
            diagnosticType: NetworkDeviceDiagnosticType.SnmpWalk,
          },
          limit: SNMP_WALK_HISTORY_LIMIT,
          skip: 0,
          select: WALK_SELECT,
          sort: { createdAt: SortOrder.Descending },
        });

      return list.data;
    } catch {
      return [];
    }
  };

  type FinishFunction = (data: {
    runId: number;
    isContinuation: boolean;
    row?: NetworkDeviceDiagnostic | undefined;
    error?: string | undefined;
  }) => void;

  const finish: FinishFunction = (data: {
    runId: number;
    isContinuation: boolean;
    row?: NetworkDeviceDiagnostic | undefined;
    error?: string | undefined;
  }): void => {
    stopPolling();

    if (!isMountedRef.current || data.runId !== runIdRef.current) {
      return;
    }

    setRunning(null);

    if (data.error) {
      setWalkError(translateSnmpWalkServerMessage(data.error, translator));
      return;
    }

    const row: NetworkDeviceDiagnostic | undefined = data.row;

    if (!row) {
      return;
    }

    if (
      row.status !== NetworkDeviceDiagnosticStatus.Completed ||
      !row.snmpWalkResult
    ) {
      setWalkError(
        row.statusMessage
          ? translateSnmpWalkServerMessage(row.statusMessage, translator)
          : translator.translateText("The probe could not run this walk.")!,
      );
      return;
    }

    const page: SnmpWalkPage = {
      diagnosticId: row.id?.toString() || "",
      createdAt: row.createdAt,
      result: row.snmpWalkResult,
    };

    setPages((current: Array<SnmpWalkPage>) => {
      return data.isContinuation ? [...current, page] : [page];
    });
  };

  type ScheduleFunction = (data: PollData) => void;

  const scheduleNextPoll: ScheduleFunction = (data: PollData): void => {
    timerRef.current = setTimeout(() => {
      poll(data).catch(() => {
        // poll reports its own failures through finish().
      });
    }, SNMP_WALK_POLL_INTERVAL_IN_MS);
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
        select: WALK_SELECT,
      });
    } catch (err) {
      const consecutiveFailures: number = data.consecutiveFailures + 1;

      if (consecutiveFailures >= SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES) {
        finish({
          runId: data.runId,
          isContinuation: data.isContinuation,
          error: API.getFriendlyMessage(err),
        });
        return;
      }

      if (data.attempt >= SNMP_WALK_MAX_POLL_ATTEMPTS) {
        finish({
          runId: data.runId,
          isContinuation: data.isContinuation,
          error: snmpWalkTimeoutMessage(device?.probe?.name, translator),
        });
        return;
      }

      scheduleNextPoll({
        ...data,
        attempt: data.attempt + 1,
        consecutiveFailures: consecutiveFailures,
      });
      return;
    }

    if (!row || !row.id) {
      finish({
        runId: data.runId,
        isContinuation: data.isContinuation,
        error: translator.translateText(
          "This walk no longer exists. The device or its probe may have been deleted.",
        ),
      });
      return;
    }

    if (isNetworkDeviceDiagnosticSettled(row.status)) {
      finish({
        runId: data.runId,
        isContinuation: data.isContinuation,
        row: row,
      });
      return;
    }

    if (data.attempt >= SNMP_WALK_MAX_POLL_ATTEMPTS) {
      finish({
        runId: data.runId,
        isContinuation: data.isContinuation,
        error: snmpWalkTimeoutMessage(device?.probe?.name, translator),
      });
      return;
    }

    scheduleNextPoll({
      ...data,
      attempt: data.attempt + 1,
      consecutiveFailures: 0,
    });
  };

  useEffect(() => {
    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const [loadedDevice, history]: [
          NetworkDevice | null,
          Array<NetworkDeviceDiagnostic>,
        ] = await Promise.all([loadDevice(), loadHistory()]);

        if (isCancelled) {
          return;
        }

        setDevice(loadedDevice);

        const entries: Array<SnmpWalkHistoryEntry> =
          history.map(toHistoryEntry);
        const chain: Array<SnmpWalkPage> = chainSnmpWalkPages(entries);
        setPages(chain);

        const lastRoot: string | undefined =
          chain[chain.length - 1]?.result.rootOid;

        if (lastRoot) {
          setStartOid(lastRoot);
        }

        /*
         * A walk still running - asked for in another tab, or before a
         * reload - is followed to its end, as if it had been started here.
         */
        const newest: NetworkDeviceDiagnostic | undefined = history[0];
        const runningSince: Date = OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          -SNMP_WALK_RUNNING_WINDOW_IN_MINUTES,
        );

        if (
          newest?.id &&
          !isNetworkDeviceDiagnosticSettled(newest.status) &&
          newest.createdAt &&
          OneUptimeDate.isAfter(newest.createdAt, runningSince)
        ) {
          runIdRef.current += 1;
          const isContinuation: boolean = Boolean(
            newest.snmpWalkAfterOid &&
              chain.length > 0 &&
              getSnmpWalkContinueAfter(chain) === newest.snmpWalkAfterOid,
          );

          /*
           * A fresh walk's rows replace the last walk's when it lands; the
           * last walk stays meanwhile (hidden while the new one runs), so a
           * walk that fails brings it back rather than an empty page.
           */
          setStartOid(newest.snmpWalkRootOid || "");
          setRunning({
            runId: runIdRef.current,
            diagnosticId: newest.id,
            rootOid: newest.snmpWalkRootOid || SNMP_WALK_DEFAULT_ROOT_OID,
            afterOid: newest.snmpWalkAfterOid,
          });
          scheduleNextPoll({
            runId: runIdRef.current,
            diagnosticId: newest.id,
            isContinuation: isContinuation,
            attempt: 1,
            consecutiveFailures: 0,
          });
        }
      } catch (err) {
        if (!isCancelled) {
          setLoadError(API.getFriendlyMessage(err));
        }
      }

      if (!isCancelled) {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // load reports its own failures.
    });

    return () => {
      isCancelled = true;
    };
  }, [props.networkDeviceId.toString()]);

  type StartWalkFunction = (data: {
    rootOid: string;
    afterOid?: string | undefined;
  }) => Promise<void>;

  const startWalk: StartWalkFunction = async (data: {
    rootOid: string;
    afterOid?: string | undefined;
  }): Promise<void> => {
    stopPolling();
    runIdRef.current += 1;
    const runId: number = runIdRef.current;
    const isContinuation: boolean = Boolean(data.afterOid);

    setWalkError("");
    setCollectNotice(undefined);

    /*
     * The last walk's rows stay until this one lands - hidden while a fresh
     * walk runs - so a walk the server refuses, or the probe cannot run,
     * leaves them on the page under the reason.
     */
    setRunning({
      runId: runId,
      diagnosticId: ObjectID.generate(),
      rootOid: data.rootOid,
      afterOid: data.afterOid,
    });

    try {
      const diagnostic: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic();
      diagnostic.networkDeviceId = props.networkDeviceId;
      diagnostic.diagnosticType = NetworkDeviceDiagnosticType.SnmpWalk;
      diagnostic.snmpWalkRootOid = data.rootOid;

      if (data.afterOid) {
        diagnostic.snmpWalkAfterOid = data.afterOid;
      }

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
          translator.translateText(
            "The walk was asked for, but its id did not come back.",
          ),
        );
      }

      if (!isMountedRef.current || runId !== runIdRef.current) {
        return;
      }

      setRunning({
        runId: runId,
        diagnosticId: diagnosticId,
        rootOid: data.rootOid,
        afterOid: data.afterOid,
      });

      scheduleNextPoll({
        runId: runId,
        diagnosticId: diagnosticId,
        isContinuation: isContinuation,
        attempt: 1,
        consecutiveFailures: 0,
      });
    } catch (err) {
      finish({
        runId: runId,
        isContinuation: isContinuation,
        error: API.getFriendlyMessage(err),
      });
    }
  };

  type CollectFunction = (row: SnmpWalkRow) => Promise<void>;

  /*
   * Adds the OID to the device's own health OIDs. The list is read fresh
   * right before the write, so an edit made elsewhere since the page loaded
   * is kept. The server holds the list to its limit and says so.
   */
  const collectOnDevice: CollectFunction = async (
    row: SnmpWalkRow,
  ): Promise<void> => {
    setCollectingOid(row.oid);
    setCollectNotice(undefined);

    try {
      const current: NetworkDevice | null =
        await modelAPI.getItem<NetworkDevice>({
          modelType: NetworkDevice,
          id: props.networkDeviceId,
          select: { snmpOids: true },
        });

      const snmpOids: Array<SnmpOid> = addWalkedOid(current?.snmpOids, row.oid);

      await modelAPI.updateById<NetworkDevice>({
        modelType: NetworkDevice,
        id: props.networkDeviceId,
        data: { snmpOids: snmpOids as unknown as JSONArray },
      });

      const refreshed: NetworkDevice | null = await loadDevice();

      if (isMountedRef.current) {
        setDevice(refreshed);
        setJustCollected((current: Array<string>) => {
          return [...current, row.oid];
        });
        // The row names the OID; this says when and where it shows up.
        setCollectNotice({
          oid: row.oid,
          kind: "success",
          text: isNumericSnmpWalkRow(row)
            ? translator.translateText(
                "Collected from the next poll on, and charted on the device's Metrics page.",
              )!
            : translator.translateText(
                "Collected from the next poll on, so you can alert on its value.",
              )!,
        });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setCollectNotice({
          oid: row.oid,
          kind: "error",
          text: API.getFriendlyMessage(err),
        });
      }
    }

    if (isMountedRef.current) {
      setCollectingOid(undefined);
    }
  };

  /*
   * Adds the OID to the device's OID Collection Template, so every device
   * linked to it collects it. Read fresh before the write, like the
   * device's own list.
   */
  const collectOnTemplate: CollectFunction = async (
    row: SnmpWalkRow,
  ): Promise<void> => {
    const templateId: ObjectID | undefined = device?.oidTemplateId;

    if (!templateId) {
      return;
    }

    setCollectingOid(row.oid);
    setCollectNotice(undefined);

    try {
      const template: NetworkDeviceOidTemplate | null =
        await modelAPI.getItem<NetworkDeviceOidTemplate>({
          modelType: NetworkDeviceOidTemplate,
          id: templateId,
          select: { oids: true },
        });

      await modelAPI.updateById<NetworkDeviceOidTemplate>({
        modelType: NetworkDeviceOidTemplate,
        id: templateId,
        data: {
          oids: addWalkedOid(template?.oids, row.oid) as unknown as JSONArray,
        },
      });

      const refreshed: NetworkDevice | null = await loadDevice();

      if (isMountedRef.current) {
        setDevice(refreshed);
        setJustCollected((current: Array<string>) => {
          return [...current, row.oid];
        });
        setCollectNotice({
          oid: row.oid,
          kind: "success",
          text: translator.translateTemplate(
            "Every device using {{template}} collects it from its next poll on.",
            { template: device?.oidTemplate?.name || "" },
          ),
        });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setCollectNotice({
          oid: row.oid,
          kind: "error",
          text: API.getFriendlyMessage(err),
        });
      }
    }

    if (isMountedRef.current) {
      setCollectingOid(undefined);
    }
  };

  const rows: Array<SnmpWalkRow> = useMemo(() => {
    return getSnmpWalkRows(pages);
  }, [pages]);

  const views: Array<SnmpWalkRowView> = useMemo(() => {
    return rows.map((row: SnmpWalkRow): SnmpWalkRowView => {
      return toSnmpWalkRowView(row, translator);
    });
  }, [rows, translator.language]);

  const collectedOids: Set<string> = useMemo(() => {
    const collected: Set<string> = getCollectedOids({
      deviceOids: device?.snmpOids,
      templateOids: device?.oidTemplate?.oids,
    });

    for (const oid of justCollected) {
      collected.add(oid);
    }

    return collected;
  }, [device, justCollected]);

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
    { modelId: props.networkDeviceId },
  );

  const isProbePolled: boolean =
    !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
      device?.monitoringMethod,
    );

  const getAlertRoute: (row: SnmpWalkRow) => Route = (
    row: SnmpWalkRow,
  ): Route => {
    const createRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_CREATE] as Route,
    );

    return new Route(
      `${createRoute.toString()}?${buildSnmpWalkAlertQuery({
        networkDeviceId: props.networkDeviceId.toString(),
        row: row,
      })}`,
    );
  };

  const lastPage: SnmpWalkPage | undefined = pages[pages.length - 1];
  const lastResult: NetworkDeviceDiagnosticSnmpWalkResult | undefined =
    lastPage?.result;
  const continueAfter: string | undefined = getSnmpWalkContinueAfter(pages);
  const failureMessage: SnmpWalkMessage | undefined = lastResult?.failure
    ? describeSnmpWalkFailure(
        lastResult.failure,
        lastResult.snmpVersion,
        rows.length,
        translator,
      )
    : undefined;
  const summary: string | undefined = lastResult
    ? describeSnmpWalkSummary({ pages: pages, translator: translator })
    : undefined;
  const isStartValid: boolean = isWalkableStart(startOid);
  const selectedStart: SnmpWalkStartPoint | undefined =
    getSelectedStartPoint(startOid);

  const getForm: () => ReactElement = (): ReactElement => {
    return (
      <div data-testid="snmp-walk-form">
        <label
          htmlFor="snmp-walk-start-oid"
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText("Start at OID")}
        </label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Input
              id="snmp-walk-start-oid"
              value={startOid}
              placeholder={SNMP_WALK_DEFAULT_ROOT_OID}
              dataTestId="snmp-walk-start-oid"
              ariaInvalid={!isStartValid}
              disabled={Boolean(running)}
              onChange={(value: string) => {
                setStartOid(value);
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter" && isStartValid && !running) {
                  startWalk({ rootOid: toWalkRoot(startOid) }).catch(() => {
                    // startWalk reports its own failures.
                  });
                }
              }}
            />
          </div>
          <div className="[&>button]:ml-0 [&>button]:md:ml-0">
            <Button
              title="Walk"
              icon={IconProp.Play}
              buttonStyle={ButtonStyleType.PRIMARY}
              dataTestId="snmp-walk-start"
              disabled={!isStartValid || Boolean(running)}
              onClick={() => {
                startWalk({ rootOid: toWalkRoot(startOid) }).catch(() => {
                  // startWalk reports its own failures.
                });
              }}
            />
          </div>
        </div>
        {!isStartValid ? (
          <p
            className="mt-1 text-sm text-red-700"
            data-testid="snmp-walk-start-invalid"
          >
            {translator.translateText(
              "Use a numeric OID such as 1.3.6.1.2.1.1, not a MIB name.",
            )}
          </p>
        ) : (
          <></>
        )}
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="group"
          aria-label={translator.translateText("Common starting points")}
        >
          {SNMP_WALK_START_POINTS.map(
            (point: SnmpWalkStartPoint): ReactElement => {
              const isSelected: boolean = selectedStart?.oid === point.oid;

              return (
                <button
                  key={point.oid}
                  type="button"
                  disabled={Boolean(running)}
                  aria-pressed={isSelected}
                  title={point.oid}
                  data-testid={`snmp-walk-start-point-${point.oid}`}
                  className={`rounded-full border px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 ${
                    isSelected
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                  onClick={() => {
                    setStartOid(point.oid);
                  }}
                >
                  {translator.translateText(point.label)}
                </button>
              );
            },
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {device?.probe?.name
            ? translator.translateTemplate(
                'Runs on the probe "{{probe}}" with this device\'s SNMP credentials, up to {{count}} OIDs at a time.',
                {
                  probe: device.probe.name,
                  count: translator.formatNumber(SNMP_WALK_MAX_OIDS),
                },
              )
            : translator.translateTemplate(
                "Runs on this device's probe with its SNMP credentials, up to {{count}} OIDs at a time.",
                { count: translator.formatNumber(SNMP_WALK_MAX_OIDS) },
              )}
        </p>
      </div>
    );
  };

  const getRunning: () => ReactElement = (): ReactElement => {
    if (!running) {
      return <></>;
    }

    return (
      <div
        className="mt-4 flex items-start gap-3 rounded-md bg-gray-50 p-3 text-sm text-gray-600"
        data-testid="snmp-walk-running"
        role="status"
      >
        <div className="pt-0.5">
          <Loader loaderType={LoaderType.Beats} size={8} />
        </div>
        <div className="min-w-0">
          <p className="[overflow-wrap:anywhere]">
            {running.afterOid
              ? translator.translateTemplate(
                  "Walking on under {{oid}} from where the last walk stopped…",
                  { oid: running.rootOid },
                )
              : translator.translateTemplate("Walking {{oid}}…", {
                  oid: running.rootOid,
                })}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {translator.translateText(
              "The probe picks the walk up within ten seconds. A large subtree takes up to a minute.",
            )}
          </p>
        </div>
      </div>
    );
  };

  const getMessageBox: (data: {
    testId: string;
    title: string;
    detail?: string | undefined;
    tone: "error" | "warning";
    showSettingsLink?: boolean | undefined;
  }) => ReactElement = (data: {
    testId: string;
    title: string;
    detail?: string | undefined;
    tone: "error" | "warning";
    showSettingsLink?: boolean | undefined;
  }): ReactElement => {
    const toneClasses: Record<string, string> = {
      error: "border-red-200 bg-red-50",
      warning: "border-amber-200 bg-amber-50",
    };
    const titleClasses: Record<string, string> = {
      error: "text-red-800",
      warning: "text-amber-800",
    };
    const iconClasses: Record<string, string> = {
      error: "text-red-600",
      warning: "text-amber-600",
    };

    return (
      <div
        className={`mt-4 flex gap-3 rounded-md border p-3 ${toneClasses[data.tone]}`}
        data-testid={data.testId}
        role="alert"
      >
        <div className="pt-0.5">
          <Icon
            icon={IconProp.Alert}
            className={`h-5 w-5 ${iconClasses[data.tone]}`}
          />
        </div>
        <div className="min-w-0 text-sm">
          <p className={`font-medium ${titleClasses[data.tone]}`}>
            {data.title}
          </p>
          {data.detail ? (
            <p className="mt-1 text-gray-700 [overflow-wrap:anywhere]">
              {data.detail}
            </p>
          ) : (
            <></>
          )}
          {data.showSettingsLink ? (
            <div className="mt-2">
              <Link
                to={settingsRoute}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                dataTestId={`${data.testId}-settings`}
              >
                {translator.translateText("Open the device's Settings")}
              </Link>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  /*
   * Where a long list ends: the way on, again, so nobody scrolls back up a
   * thousand OIDs for it - and, while a walk read from here runs, that it
   * runs. The results draw it only once every OID read so far is on screen,
   * so it never sits next to "Show 100 more" of what was already read.
   */
  const getListEnd: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    if (!continueAfter || !props.canWalk || !lastResult) {
      return undefined;
    }

    return (
      <div
        className="mt-4 flex flex-col items-center gap-1 border-t border-gray-100 pt-4 text-center"
        data-testid="snmp-walk-list-end"
      >
        {running?.afterOid ? (
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Loader loaderType={LoaderType.Beats} size={8} />
            <span className="[overflow-wrap:anywhere]">
              {translator.translateTemplate(
                "Walking on under {{oid}} from where the last walk stopped…",
                { oid: running.rootOid },
              )}
            </span>
          </div>
        ) : (
          <>
            <div className="[&>button]:ml-0 [&>button]:md:ml-0">
              <Button
                title="Continue walking"
                icon={IconProp.ChevronDown}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                dataTestId="snmp-walk-continue-bottom"
                disabled={Boolean(running)}
                onClick={() => {
                  startWalk({
                    rootOid: lastResult.rootOid,
                    afterOid: continueAfter,
                  }).catch(() => {
                    // startWalk reports its own failures.
                  });
                }}
              />
            </div>
            <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
              {translator.translateTemplate(
                "Reads up to {{count}} more OIDs, after {{oid}}.",
                {
                  count: translator.formatNumber(SNMP_WALK_MAX_OIDS),
                  oid: continueAfter,
                },
              )}
            </p>
          </>
        )}
      </div>
    );
  };

  const getResults: () => ReactElement = (): ReactElement => {
    if (!lastResult) {
      return <></>;
    }

    const walkedAt: Date | undefined = lastPage?.createdAt;

    /*
     * What the last walk read and when, then - if it stopped short - why:
     * the line that says when a walk ran reads first, never left under the
     * reason as an afterthought.
     */
    return (
      <div
        className="mt-6 border-t border-gray-100 pt-5"
        data-testid="snmp-walk-result"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {/*
             * A count reads as the results' title; "nothing under it, and
             * why that may be" is an explanation, and reads as one.
             */}
            {summary ? (
              <p
                className={`text-sm [overflow-wrap:anywhere] ${
                  rows.length > 0
                    ? "font-medium text-gray-900"
                    : "text-gray-700"
                }`}
                data-testid="snmp-walk-summary"
              >
                {summary}
              </p>
            ) : (
              <></>
            )}
            <p
              className={`text-xs text-gray-500 ${summary ? "mt-0.5" : ""}`}
              data-testid="snmp-walk-meta"
            >
              {[
                walkedAt
                  ? translator.translateTemplate("Walked {{time}}", {
                      // In the reader's language: "vor 2 Minuten".
                      time: formatRelativeTime({
                        date: OneUptimeDate.fromString(walkedAt),
                        now: OneUptimeDate.getCurrentDate(),
                        language: translator.language,
                      }),
                    })
                  : undefined,
                lastResult.snmpVersion
                  ? translator.translateTemplate("SNMP v{{version}}", {
                      version: lastResult.snmpVersion,
                    })
                  : undefined,
                translator.translateText("Kept for two days"),
              ]
                .filter((part: string | undefined): part is string => {
                  return Boolean(part);
                })
                .join(" · ")}
            </p>
          </div>
          {continueAfter && props.canWalk ? (
            <div className="[&>button]:ml-0 [&>button]:md:ml-0 sm:flex-none">
              <Button
                title="Continue walking"
                icon={IconProp.ChevronDown}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                dataTestId="snmp-walk-continue"
                disabled={Boolean(running)}
                onClick={() => {
                  startWalk({
                    rootOid: lastResult.rootOid,
                    afterOid: continueAfter,
                  }).catch(() => {
                    // startWalk reports its own failures.
                  });
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>

        {failureMessage ? (
          getMessageBox({
            testId: "snmp-walk-failure",
            title: failureMessage.title,
            detail: failureMessage.detail,
            // What was read before the walk stopped is still worth reading.
            tone: rows.length > 0 ? "warning" : "error",
            showSettingsLink: failureMessage.isFixedInSettings,
          })
        ) : (
          <></>
        )}

        {rows.length > 0 ? (
          <div className="mt-4">
            <SnmpWalkResults
              rows={rows}
              views={views}
              notice={collectNotice}
              listEnd={getListEnd()}
              actions={{
                collectedOids: collectedOids,
                canCollect: props.canEditDevice && isProbePolled,
                templateName: device?.oidTemplateId
                  ? device.oidTemplate?.name
                  : undefined,
                canCollectOnTemplate:
                  props.canEditTemplate &&
                  isProbePolled &&
                  Boolean(device?.oidTemplateId),
                collectingOid: collectingOid,
                onCollect: (row: SnmpWalkRow) => {
                  collectOnDevice(row).catch(() => {
                    // collectOnDevice reports its own failures.
                  });
                },
                onCollectOnTemplate: (row: SnmpWalkRow) => {
                  collectOnTemplate(row).catch(() => {
                    // collectOnTemplate reports its own failures.
                  });
                },
                getAlertRoute: props.canCreateMonitor
                  ? getAlertRoute
                  : undefined,
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (loadError) {
      return (
        <p className="text-sm text-red-700" data-testid="snmp-walk-load-error">
          {loadError}
        </p>
      );
    }

    if (!device?.probeId) {
      return (
        <div
          className="rounded-md bg-gray-50 p-3 text-sm text-gray-600"
          data-testid="snmp-walk-no-probe"
        >
          <p>
            {translator.translateText(
              "This device has no probe assigned, so there is nothing to walk it from.",
            )}
          </p>
          <div className="mt-2">
            <Link
              to={settingsRoute}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translator.translateText("Assign a probe in Settings")}
            </Link>
          </div>
        </div>
      );
    }

    return (
      <>
        {props.canWalk ? (
          getForm()
        ) : (
          <p
            className="text-sm text-gray-500"
            data-testid="snmp-walk-read-only"
          >
            {/*
             * "You can read its last walk" only when there is one to read
             * (or one on its way): a device nobody walked says so instead.
             */}
            {lastResult || running
              ? translator.translateText(
                  "You can read this device's last walk. Walking it needs the Create Network Device Diagnostic permission.",
                )
              : translator.translateText(
                  "This device has not been walked yet. Walking it needs the Create Network Device Diagnostic permission.",
                )}
          </p>
        )}
        {getRunning()}
        {walkError ? (
          getMessageBox({
            testId: "snmp-walk-error",
            title: translator.translateText("The walk could not run")!,
            detail: walkError,
            tone: "error",
          })
        ) : (
          <></>
        )}
        {/*
         * A fresh walk's rows replace the last walk's: those are not shown
         * as if they were what it is reading. A walk continuing the last
         * one keeps them on screen - it adds to them.
         */}
        {running && !running.afterOid ? <></> : getResults()}
        {!running && !walkError && !lastResult && props.canWalk ? (
          <p
            className="mt-6 text-sm text-gray-500"
            data-testid="snmp-walk-empty"
          >
            {translator.translateText(
              "Not walked yet. Walk the device to see every OID it answers, with its type and value.",
            )}
          </p>
        ) : (
          <></>
        )}
      </>
    );
  };

  return (
    <Card
      title="SNMP Walk"
      description="Every OID this device answers, read by its probe with the device's SNMP credentials. Collect an OID to chart it and alert on it."
    >
      <div data-testid="snmp-walk" aria-busy={Boolean(running)}>
        {getBody()}
      </div>
    </Card>
  );
};

export default SnmpWalkCard;
