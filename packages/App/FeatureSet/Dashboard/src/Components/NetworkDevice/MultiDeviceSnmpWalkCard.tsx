import { getHandDrawnLookClassName } from "Common/UI/Components/Button/ButtonStates";
import MultiDeviceSnmpWalkResults, {
  MultiDeviceSnmpWalkNotice,
} from "./MultiDeviceSnmpWalkResults";
import {
  ComparisonTemplateTarget,
  DeviceWalk,
  DeviceWalkCounts,
  DeviceWalkStatus,
  DeviceWalkTone,
  DeviceWalkView,
  MULTI_DEVICE_SNMP_WALK_GONE_MESSAGE,
  MULTI_DEVICE_SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
  MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
  MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS,
  MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE,
  MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS,
  MULTI_DEVICE_SNMP_WALK_REQUEST_CONCURRENCY,
  MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT,
  MultiDeviceSnmpWalkDevice,
  MultiDeviceSnmpWalkQuery,
  SnmpWalkComparisonRow,
  SnmpWalkComparisonRowView,
  StoredDeviceWalk,
  compareDeviceWalks,
  countDeviceWalks,
  countWalksWithMoreToRead,
  describeDeviceWalk,
  describeMultiDeviceSnmpWalkSummary,
  getCollectedOidsByDevice,
  getWalkedAt,
  isComparableWalk,
  isDeviceWalkSettled,
  isWalkStillAwaited,
  pickLatestDeviceWalks,
  runWithConcurrency,
  toComparisonRowView,
  toDeviceWalk,
} from "./MultiDeviceSnmpWalkViewModel";
import {
  SNMP_WALK_START_POINTS,
  SnmpWalkStartPoint,
  addWalkedOid,
  getSelectedStartPoint,
  isWalkableStart,
  toWalkRoot,
} from "./SnmpWalkViewModel";
import {
  buildMultiDeviceSnmpWalkExport,
  SnmpWalkExportFile,
} from "./SnmpWalkExport";
import { DEVICE_NOT_READABLE_MESSAGE } from "./BulkDeviceReader";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray } from "Common/Types/JSON";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  SNMP_WALK_DEFAULT_ROOT_OID,
  SNMP_WALK_MAX_OIDS,
  SnmpWalkRow,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import API from "Common/UI/Utils/API/API";
import downloadFile from "Common/UI/Utils/DownloadFile";
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
  // The devices and the OID the page's address names.
  initialQuery: MultiDeviceSnmpWalkQuery;
  // Whether the reader may walk (create Network Device Diagnostics).
  canWalk: boolean;
  // Whether the reader may change devices (collect an OID on them).
  canEditDevice: boolean;
  // Whether the reader may change OID Collection Templates.
  canEditTemplate: boolean;
  /*
   * Told what was walked - the devices and the OID - when a walk starts,
   * so the page keeps it in its address for a reload or a link.
   */
  onQueryChange?: ((query: MultiDeviceSnmpWalkQuery) => void) | undefined;
  /*
   * Test seam, as the device's own SNMP Walk card has: the real ModelAPI
   * reads `window` at import and talks to the network.
   */
  modelAPI?: typeof ModelAPI | undefined;
}

interface PollData {
  runId: number;
  attempt: number;
  consecutiveFailures: number;
}

const DEVICE_SELECT: Select<NetworkDevice> = {
  _id: true,
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
  networkDeviceId: true,
  status: true,
  statusMessage: true,
  createdAt: true,
  snmpWalkRootOid: true,
  snmpWalkAfterOid: true,
  snmpWalkResult: true,
};

// What finding the last walk again reads first: every column but the result.
const WALK_SUMMARY_SELECT: Select<NetworkDeviceDiagnostic> = {
  _id: true,
  networkDeviceId: true,
  status: true,
  createdAt: true,
  snmpWalkRootOid: true,
  snmpWalkAfterOid: true,
};

function toDevice(model: NetworkDevice): MultiDeviceSnmpWalkDevice | null {
  const id: string | undefined = model._id?.toString();

  if (!id) {
    return null;
  }

  return {
    id: id,
    name: model.name || "",
    hasProbe: Boolean(model.probeId),
    probeName: model.probe?.name || undefined,
    isProbePolled: NetworkDeviceMonitoringMethodUtil.isProbePolled(
      model.monitoringMethod,
    ),
    snmpOids: (model.snmpOids as Array<SnmpOid> | undefined) || [],
    templateId: model.oidTemplateId?.toString() || undefined,
    templateName: model.oidTemplate?.name || undefined,
    templateOids: (model.oidTemplate?.oids as Array<SnmpOid> | undefined) || [],
  };
}

function toStoredWalk(row: NetworkDeviceDiagnostic): StoredDeviceWalk {
  return {
    diagnosticId: row._id?.toString() || "",
    deviceId: row.networkDeviceId?.toString() || "",
    status: row.status,
    statusMessage: row.statusMessage,
    createdAt: row.createdAt,
    rootOid: row.snmpWalkRootOid,
    afterOid: row.snmpWalkAfterOid,
    result: row.snmpWalkResult,
  };
}

const TONE_DOT_CLASS_NAMES: Record<DeviceWalkTone, string> = {
  [DeviceWalkTone.Waiting]: "bg-gray-300",
  [DeviceWalkTone.Success]: "bg-green-500",
  [DeviceWalkTone.Warning]: "bg-amber-500",
  [DeviceWalkTone.Error]: "bg-red-500",
};

/*
 * The Network's SNMP Walk page (issue #5548): walk many devices at once and
 * compare what they answer, one OID a row - which devices answer it, with
 * what, and which do not - then collect it on every device that does.
 *
 * Each device is walked as its own SNMP Walk page walks it: a Network Device
 * Diagnostic of type "SNMP Walk", run by the device's probe with the
 * device's credentials, refused by the server for a device it cannot walk.
 * This creates one per device, a few at a time, then reads them all back in
 * one request every few seconds until the last one is reported, showing
 * each device's answer as it lands. The walks are kept two days, and the
 * page's address names the devices and the OID, so a reload or a link opens
 * on the same walk.
 */
const MultiDeviceSnmpWalkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

  const [deviceIds, setDeviceIds] = useState<Array<string>>(
    props.initialQuery.deviceIds,
  );
  const [devicesById, setDevicesById] = useState<
    Map<string, MultiDeviceSnmpWalkDevice>
  >(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingDevices, setIsLoadingDevices] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  // Devices the address named that could not be read, and were left out.
  const [unreadableCount, setUnreadableCount] = useState<number>(0);

  const [startOid, setStartOid] = useState<string>(props.initialQuery.startOid);
  const [walks, setWalksState] = useState<Array<DeviceWalk>>([]);
  const [walkRootOid, setWalkRootOid] = useState<string>("");
  const [isWalking, setIsWalking] = useState<boolean>(false);
  const [walkError, setWalkError] = useState<string>("");

  const [collectingOid, setCollectingOid] = useState<string | undefined>(
    undefined,
  );
  const [collectNotice, setCollectNotice] = useState<
    MultiDeviceSnmpWalkNotice | undefined
  >(undefined);
  /*
   * OIDs collected from this page, by device: shown as collected at once,
   * whatever the read of the devices that follows the writes answers.
   */
  const [justCollected, setJustCollected] = useState<Map<string, Set<string>>>(
    new Map(),
  );

  /*
   * The walks as the async loops read them: the poll reads what the last
   * poll wrote, never what a render captured a few seconds before.
   */
  const walksRef: React.MutableRefObject<Array<DeviceWalk>> = useRef<
    Array<DeviceWalk>
  >([]);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const runIdRef: React.MutableRefObject<number> = useRef<number>(0);

  const setWalks: (next: Array<DeviceWalk>) => void = (
    next: Array<DeviceWalk>,
  ): void => {
    walksRef.current = next;
    setWalksState(next);
  };

  type UpdateWalkFunction = (data: {
    runId: number;
    deviceId: string;
    walk: DeviceWalk;
  }) => void;

  const updateWalk: UpdateWalkFunction = (data: {
    runId: number;
    deviceId: string;
    walk: DeviceWalk;
  }): void => {
    if (!isMountedRef.current || data.runId !== runIdRef.current) {
      return;
    }

    setWalks(
      walksRef.current.map((walk: DeviceWalk): DeviceWalk => {
        return walk.deviceId === data.deviceId ? data.walk : walk;
      }),
    );
  };

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

  const loadDevices: (
    ids: Array<string>,
  ) => Promise<Map<string, MultiDeviceSnmpWalkDevice>> = async (
    ids: Array<string>,
  ): Promise<Map<string, MultiDeviceSnmpWalkDevice>> => {
    const loaded: Map<string, MultiDeviceSnmpWalkDevice> = new Map();

    if (ids.length === 0) {
      return loaded;
    }

    const list: ListResult<NetworkDevice> =
      await modelAPI.getList<NetworkDevice>({
        modelType: NetworkDevice,
        query: { _id: new Includes(ids) } as Query<NetworkDevice>,
        limit: ids.length,
        skip: 0,
        select: DEVICE_SELECT,
        sort: {},
      });

    for (const model of list.data) {
      const device: MultiDeviceSnmpWalkDevice | null = toDevice(model);

      if (device) {
        loaded.set(device.id, device);
      }
    }

    return loaded;
  };

  type FinishWaitingFunction = (data: {
    runId: number;
    status: DeviceWalkStatus;
    message?: string | undefined;
  }) => void;

  // Every walk still on its way ends as `status`: the page stops waiting.
  const finishWaiting: FinishWaitingFunction = (data: {
    runId: number;
    status: DeviceWalkStatus;
    message?: string | undefined;
  }): void => {
    stopPolling();

    if (!isMountedRef.current || data.runId !== runIdRef.current) {
      return;
    }

    setWalks(
      walksRef.current.map((walk: DeviceWalk): DeviceWalk => {
        if (isDeviceWalkSettled(walk)) {
          return walk;
        }

        return { ...walk, status: data.status, message: data.message };
      }),
    );
    setIsWalking(false);
  };

  type ScheduleFunction = (data: PollData) => void;

  const scheduleNextPoll: ScheduleFunction = (data: PollData): void => {
    timerRef.current = setTimeout(() => {
      poll(data).catch(() => {
        // poll reports its own failures.
      });
    }, MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS);
  };

  type PollFunction = (data: PollData) => Promise<void>;

  /*
   * One read of every walk still on its way. A walk that settled since the
   * last read arrives with its result, once: it is not asked for again.
   */
  const poll: PollFunction = async (data: PollData): Promise<void> => {
    if (!isMountedRef.current || data.runId !== runIdRef.current) {
      return;
    }

    const waiting: Array<DeviceWalk> = walksRef.current.filter(
      (walk: DeviceWalk): boolean => {
        return (
          walk.status === DeviceWalkStatus.Walking && Boolean(walk.diagnosticId)
        );
      },
    );

    if (waiting.length === 0) {
      setIsWalking(false);
      return;
    }

    let rows: Array<NetworkDeviceDiagnostic> = [];

    try {
      const list: ListResult<NetworkDeviceDiagnostic> =
        await modelAPI.getList<NetworkDeviceDiagnostic>({
          modelType: NetworkDeviceDiagnostic,
          query: {
            _id: new Includes(
              waiting.map((walk: DeviceWalk): string => {
                return walk.diagnosticId!;
              }),
            ),
          } as Query<NetworkDeviceDiagnostic>,
          limit: waiting.length,
          skip: 0,
          select: WALK_SELECT,
          sort: {},
        });

      rows = list.data;
    } catch (err) {
      const consecutiveFailures: number = data.consecutiveFailures + 1;

      if (
        consecutiveFailures >=
          MULTI_DEVICE_SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES ||
        data.attempt >= MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS
      ) {
        if (isMountedRef.current && data.runId === runIdRef.current) {
          setWalkError(API.getFriendlyMessage(err));
        }

        finishWaiting({ runId: data.runId, status: DeviceWalkStatus.TimedOut });
        return;
      }

      scheduleNextPoll({
        ...data,
        attempt: data.attempt + 1,
        consecutiveFailures: consecutiveFailures,
      });
      return;
    }

    if (!isMountedRef.current || data.runId !== runIdRef.current) {
      return;
    }

    const rowsById: Map<string, NetworkDeviceDiagnostic> = new Map();

    for (const row of rows) {
      const id: string | undefined = row._id?.toString();

      if (id) {
        rowsById.set(id, row);
      }
    }

    const next: Array<DeviceWalk> = walksRef.current.map(
      (walk: DeviceWalk): DeviceWalk => {
        if (walk.status !== DeviceWalkStatus.Walking || !walk.diagnosticId) {
          return walk;
        }

        const row: NetworkDeviceDiagnostic | undefined = rowsById.get(
          walk.diagnosticId,
        );

        if (!row) {
          return {
            ...walk,
            status: DeviceWalkStatus.ProbeFailed,
            message: MULTI_DEVICE_SNMP_WALK_GONE_MESSAGE,
          };
        }

        const read: DeviceWalk = toDeviceWalk({
          ...toStoredWalk(row),
          deviceId: walk.deviceId,
        });

        return isDeviceWalkSettled(read)
          ? { ...read, createdAt: read.createdAt || walk.createdAt }
          : walk;
      },
    );

    setWalks(next);

    const isStillWaiting: boolean = next.some((walk: DeviceWalk): boolean => {
      return !isDeviceWalkSettled(walk);
    });

    if (!isStillWaiting) {
      setIsWalking(false);
      return;
    }

    if (data.attempt >= MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS) {
      finishWaiting({ runId: data.runId, status: DeviceWalkStatus.TimedOut });
      return;
    }

    scheduleNextPoll({
      runId: data.runId,
      attempt: data.attempt + 1,
      consecutiveFailures: 0,
    });
  };

  /*
   * The last walk of the devices the address names, under its OID, read
   * back after a reload - and followed to its end when it is still running.
   * A reader who may not read walks still gets the page, with no walk.
   */
  const restoreLastWalk: (data: {
    runId: number;
    ids: Array<string>;
    rootOid: string;
  }) => Promise<void> = async (data: {
    runId: number;
    ids: Array<string>;
    rootOid: string;
  }): Promise<void> => {
    let picked: Array<StoredDeviceWalk> = [];

    try {
      const summaries: ListResult<NetworkDeviceDiagnostic> =
        await modelAPI.getList<NetworkDeviceDiagnostic>({
          modelType: NetworkDeviceDiagnostic,
          query: {
            networkDeviceId: new Includes(data.ids),
            diagnosticType: NetworkDeviceDiagnosticType.SnmpWalk,
            snmpWalkRootOid: data.rootOid,
          } as Query<NetworkDeviceDiagnostic>,
          limit: MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT,
          skip: 0,
          select: WALK_SUMMARY_SELECT,
          sort: { createdAt: SortOrder.Descending },
        });

      picked = pickLatestDeviceWalks({
        entries: summaries.data.map(toStoredWalk),
        deviceIds: data.ids,
        rootOid: data.rootOid,
      });

      if (picked.length === 0) {
        return;
      }

      const full: ListResult<NetworkDeviceDiagnostic> =
        await modelAPI.getList<NetworkDeviceDiagnostic>({
          modelType: NetworkDeviceDiagnostic,
          query: {
            _id: new Includes(
              picked.map((entry: StoredDeviceWalk): string => {
                return entry.diagnosticId;
              }),
            ),
          } as Query<NetworkDeviceDiagnostic>,
          limit: picked.length,
          skip: 0,
          select: WALK_SELECT,
          sort: {},
        });

      const fullById: Map<string, NetworkDeviceDiagnostic> = new Map();

      for (const row of full.data) {
        const id: string | undefined = row._id?.toString();

        if (id) {
          fullById.set(id, row);
        }
      }

      if (!isMountedRef.current || data.runId !== runIdRef.current) {
        return;
      }

      const now: Date = OneUptimeDate.getCurrentDate();

      const restored: Array<DeviceWalk> = picked
        .filter((entry: StoredDeviceWalk): boolean => {
          return fullById.has(entry.diagnosticId);
        })
        .map((entry: StoredDeviceWalk): DeviceWalk => {
          const walk: DeviceWalk = toDeviceWalk({
            ...toStoredWalk(fullById.get(entry.diagnosticId)!),
            deviceId: entry.deviceId,
          });

          if (
            !isDeviceWalkSettled(walk) &&
            !isWalkStillAwaited({ createdAt: walk.createdAt, now: now })
          ) {
            return { ...walk, status: DeviceWalkStatus.TimedOut };
          }

          return walk;
        });

      if (restored.length === 0) {
        return;
      }

      setWalkRootOid(data.rootOid);
      setWalks(restored);

      if (
        restored.some((walk: DeviceWalk): boolean => {
          return !isDeviceWalkSettled(walk);
        })
      ) {
        setIsWalking(true);
        scheduleNextPoll({
          runId: data.runId,
          attempt: 1,
          consecutiveFailures: 0,
        });
      }
    } catch {
      // No walk to show: the page starts as if nothing had been walked.
    }
  };

  useEffect(() => {
    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const loaded: Map<string, MultiDeviceSnmpWalkDevice> =
          await loadDevices(props.initialQuery.deviceIds);

        if (isCancelled) {
          return;
        }

        const readable: Array<string> = props.initialQuery.deviceIds.filter(
          (id: string): boolean => {
            return loaded.has(id);
          },
        );

        setDevicesById(loaded);
        setDeviceIds(readable);
        setUnreadableCount(
          props.initialQuery.deviceIds.length - readable.length,
        );

        const rootOid: string = props.initialQuery.startOid;

        if (rootOid && readable.length > 0) {
          runIdRef.current += 1;
          await restoreLastWalk({
            runId: runIdRef.current,
            ids: readable,
            rootOid: rootOid,
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
  }, []);

  /*
   * The picker's devices. One picked now and not read yet is read before
   * it can be walked: its probe and what it collects decide what the page
   * offers for it.
   */
  const changeDevices: (ids: Array<string>) => Promise<void> = async (
    ids: Array<string>,
  ): Promise<void> => {
    setDeviceIds(ids);

    const unread: Array<string> = ids.filter((id: string): boolean => {
      return !devicesById.has(id);
    });

    if (unread.length === 0) {
      return;
    }

    setIsLoadingDevices(true);

    try {
      const loaded: Map<string, MultiDeviceSnmpWalkDevice> =
        await loadDevices(unread);

      if (isMountedRef.current) {
        setDevicesById((current: Map<string, MultiDeviceSnmpWalkDevice>) => {
          const next: Map<string, MultiDeviceSnmpWalkDevice> = new Map(current);

          for (const [id, device] of loaded) {
            next.set(id, device);
          }

          return next;
        });
        setDeviceIds((current: Array<string>) => {
          return current.filter((id: string): boolean => {
            return !unread.includes(id) || loaded.has(id);
          });
        });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setWalkError(API.getFriendlyMessage(err));
      }
    }

    if (isMountedRef.current) {
      setIsLoadingDevices(false);
    }
  };

  const startWalk: () => Promise<void> = async (): Promise<void> => {
    const rootOid: string = toWalkRoot(startOid);
    const ids: Array<string> = deviceIds.slice(
      0,
      MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
    );

    if (ids.length === 0) {
      return;
    }

    stopPolling();
    runIdRef.current += 1;
    const runId: number = runIdRef.current;

    setWalkError("");
    setCollectNotice(undefined);
    setWalkRootOid(rootOid);
    setIsWalking(true);
    props.onQueryChange?.({ deviceIds: ids, startOid: rootOid });

    /*
     * A device with no probe has nothing to walk it from: it is not asked
     * for, and says so, as its own page would.
     */
    setWalks(
      ids.map((deviceId: string): DeviceWalk => {
        return devicesById.get(deviceId)?.hasProbe
          ? { deviceId: deviceId, status: DeviceWalkStatus.Asking }
          : {
              deviceId: deviceId,
              status: DeviceWalkStatus.NotStarted,
              message: MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE,
            };
      }),
    );

    const askable: Array<string> = walksRef.current
      .filter((walk: DeviceWalk): boolean => {
        return walk.status === DeviceWalkStatus.Asking;
      })
      .map((walk: DeviceWalk): string => {
        return walk.deviceId;
      });

    await runWithConcurrency<string>({
      items: askable,
      concurrency: MULTI_DEVICE_SNMP_WALK_REQUEST_CONCURRENCY,
      step: async (deviceId: string): Promise<void> => {
        if (!isMountedRef.current || runId !== runIdRef.current) {
          return;
        }

        try {
          const diagnostic: NetworkDeviceDiagnostic =
            new NetworkDeviceDiagnostic();
          diagnostic.networkDeviceId = new ObjectID(deviceId);
          diagnostic.diagnosticType = NetworkDeviceDiagnosticType.SnmpWalk;
          diagnostic.snmpWalkRootOid = rootOid;

          const response: { data: unknown } =
            await modelAPI.create<NetworkDeviceDiagnostic>({
              model: diagnostic,
              modelType: NetworkDeviceDiagnostic,
            });

          const created: Record<string, unknown> = (response.data ||
            {}) as Record<string, unknown>;
          const diagnosticId: string = String(
            (created as unknown as NetworkDeviceDiagnostic).id?.toString() ||
              created["_id"] ||
              "",
          );

          if (!diagnosticId) {
            throw new Error(
              translator.translateText(
                "The walk was asked for, but its id did not come back.",
              ),
            );
          }

          updateWalk({
            runId: runId,
            deviceId: deviceId,
            walk: {
              deviceId: deviceId,
              status: DeviceWalkStatus.Walking,
              diagnosticId: diagnosticId,
              createdAt: OneUptimeDate.getCurrentDate(),
            },
          });
        } catch (err) {
          updateWalk({
            runId: runId,
            deviceId: deviceId,
            walk: {
              deviceId: deviceId,
              status: DeviceWalkStatus.NotStarted,
              message: API.getFriendlyMessage(err),
            },
          });
        }
      },
    });

    if (!isMountedRef.current || runId !== runIdRef.current) {
      return;
    }

    if (
      walksRef.current.some((walk: DeviceWalk): boolean => {
        return walk.status === DeviceWalkStatus.Walking;
      })
    ) {
      scheduleNextPoll({ runId: runId, attempt: 1, consecutiveFailures: 0 });
      return;
    }

    setIsWalking(false);
  };

  const getDeviceName: (deviceId: string) => string = (
    deviceId: string,
  ): string => {
    return devicesById.get(deviceId)?.name || deviceId;
  };

  const refreshDevices: () => Promise<void> = async (): Promise<void> => {
    const ids: Array<string> = Array.from(
      new Set([
        ...deviceIds,
        ...walksRef.current.map((walk: DeviceWalk): string => {
          return walk.deviceId;
        }),
      ]),
    );

    try {
      const loaded: Map<string, MultiDeviceSnmpWalkDevice> =
        await loadDevices(ids);

      if (isMountedRef.current) {
        setDevicesById(loaded);
      }
    } catch {
      // What was collected is still shown: justCollected holds it.
    }
  };

  const markCollected: (data: {
    oid: string;
    deviceIds: Array<string>;
  }) => void = (data: { oid: string; deviceIds: Array<string> }): void => {
    setJustCollected((current: Map<string, Set<string>>) => {
      const next: Map<string, Set<string>> = new Map(current);

      for (const deviceId of data.deviceIds) {
        const oids: Set<string> = new Set(next.get(deviceId) || []);
        oids.add(data.oid);
        next.set(deviceId, oids);
      }

      return next;
    });
  };

  /*
   * Adds the OID to each device's own health OIDs. The lists are read fresh
   * in one request right before the writes, so an edit made since the page
   * loaded is kept; then each device is changed on its own, with the same
   * checks as its Settings page, and one that refuses - its list is full,
   * say - is said with why while the others go ahead.
   */
  const collectOnDevices: (
    row: SnmpWalkComparisonRow,
    ids: Array<string>,
  ) => Promise<void> = async (
    row: SnmpWalkComparisonRow,
    ids: Array<string>,
  ): Promise<void> => {
    setCollectingOid(row.oid);
    setCollectNotice(undefined);

    const succeeded: Array<string> = [];
    const failures: Array<{ deviceId: string; message: string }> = [];

    try {
      const fresh: Map<string, NetworkDevice> = new Map();
      const list: ListResult<NetworkDevice> =
        await modelAPI.getList<NetworkDevice>({
          modelType: NetworkDevice,
          query: { _id: new Includes(ids) } as Query<NetworkDevice>,
          limit: ids.length,
          skip: 0,
          select: { _id: true, snmpOids: true },
          sort: {},
        });

      for (const model of list.data) {
        const id: string | undefined = model._id?.toString();

        if (id) {
          fresh.set(id, model);
        }
      }

      await runWithConcurrency<string>({
        items: ids,
        concurrency: MULTI_DEVICE_SNMP_WALK_REQUEST_CONCURRENCY,
        step: async (deviceId: string): Promise<void> => {
          const current: NetworkDevice | undefined = fresh.get(deviceId);

          if (!current) {
            failures.push({
              deviceId: deviceId,
              message: translator.translateText(DEVICE_NOT_READABLE_MESSAGE)!,
            });
            return;
          }

          try {
            await modelAPI.updateById<NetworkDevice>({
              modelType: NetworkDevice,
              id: new ObjectID(deviceId),
              data: {
                snmpOids: addWalkedOid(
                  current.snmpOids as Array<SnmpOid> | undefined,
                  row.oid,
                ) as unknown as JSONArray,
              },
            });
            succeeded.push(deviceId);
          } catch (err) {
            failures.push({
              deviceId: deviceId,
              message: API.getFriendlyMessage(err),
            });
          }
        },
      });
    } catch (err) {
      // The lists could not be read, so nothing was written.
      if (isMountedRef.current) {
        setCollectNotice({
          oid: row.oid,
          kind: "error",
          text: API.getFriendlyMessage(err),
        });
        setCollectingOid(undefined);
      }

      return;
    }

    if (!isMountedRef.current) {
      return;
    }

    markCollected({ oid: row.oid, deviceIds: succeeded });

    // Said in the order the devices were picked, not the order they answered.
    const order: Array<string> = walksRef.current.map(
      (walk: DeviceWalk): string => {
        return walk.deviceId;
      },
    );
    failures.sort(
      (
        left: { deviceId: string; message: string },
        right: { deviceId: string; message: string },
      ): number => {
        return order.indexOf(left.deviceId) - order.indexOf(right.deviceId);
      },
    );

    const failureLines: Array<{ deviceName: string; message: string }> =
      failures.map((failure: { deviceId: string; message: string }) => {
        return {
          deviceName: getDeviceName(failure.deviceId),
          message: failure.message,
        };
      });

    if (failures.length === 0) {
      setCollectNotice({
        oid: row.oid,
        kind: "success",
        text: translator.translatePlural(
          {
            one: "Collected on {{count}} device from its next poll on, and charted on its Metrics page when it is a number.",
            other:
              "Collected on {{count}} devices from their next poll on, and charted on their Metrics pages when it is a number.",
          },
          succeeded.length,
        ),
      });
    } else if (succeeded.length > 0) {
      setCollectNotice({
        oid: row.oid,
        kind: "warning",
        text: translator.translatePlural(
          {
            one: "Collected on {{collected}} of {{count}} device. Not on these:",
            other:
              "Collected on {{collected}} of {{count}} devices. Not on these:",
          },
          ids.length,
          { collected: translator.formatNumber(succeeded.length) },
        ),
        failures: failureLines,
      });
    } else {
      setCollectNotice({
        oid: row.oid,
        kind: "error",
        text: translator.translatePlural(
          {
            one: "Not collected on the device:",
            other: "Not collected on any of the {{count}} devices:",
          },
          ids.length,
        ),
        failures: failureLines,
      });
    }

    setCollectingOid(undefined);
    await refreshDevices();
  };

  /*
   * Adds the OID to an OID Collection Template, so every device linked to
   * it collects it - those walked here and every other. Read fresh before
   * the write, like the devices' own lists.
   */
  const collectOnTemplate: (
    row: SnmpWalkComparisonRow,
    target: ComparisonTemplateTarget,
  ) => Promise<void> = async (
    row: SnmpWalkComparisonRow,
    target: ComparisonTemplateTarget,
  ): Promise<void> => {
    setCollectingOid(row.oid);
    setCollectNotice(undefined);

    try {
      const template: NetworkDeviceOidTemplate | null =
        await modelAPI.getItem<NetworkDeviceOidTemplate>({
          modelType: NetworkDeviceOidTemplate,
          id: new ObjectID(target.templateId),
          select: { oids: true },
        });

      await modelAPI.updateById<NetworkDeviceOidTemplate>({
        modelType: NetworkDeviceOidTemplate,
        id: new ObjectID(target.templateId),
        data: {
          oids: addWalkedOid(
            template?.oids as Array<SnmpOid> | undefined,
            row.oid,
          ) as unknown as JSONArray,
        },
      });

      if (!isMountedRef.current) {
        return;
      }

      markCollected({
        oid: row.oid,
        deviceIds: Array.from(devicesById.values())
          .filter((device: MultiDeviceSnmpWalkDevice): boolean => {
            return device.templateId === target.templateId;
          })
          .map((device: MultiDeviceSnmpWalkDevice): string => {
            return device.id;
          }),
      });
      setCollectNotice({
        oid: row.oid,
        kind: "success",
        text: translator.translateTemplate(
          "Every device using {{template}} collects it from its next poll on.",
          { template: target.templateName },
        ),
      });
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
      await refreshDevices();
    }
  };

  const comparedWalks: Array<DeviceWalk> = useMemo(() => {
    return walks.filter(isComparableWalk);
  }, [walks]);

  const rows: Array<SnmpWalkComparisonRow> = useMemo(() => {
    return compareDeviceWalks(walks);
  }, [walks]);

  const views: Map<string, SnmpWalkComparisonRowView> = useMemo(() => {
    return new Map(
      rows.map(
        (row: SnmpWalkComparisonRow): [string, SnmpWalkComparisonRowView] => {
          return [row.oid, toComparisonRowView(row, translator)];
        },
      ),
    );
  }, [rows, translator.language]);

  const collectedOidsByDevice: Map<string, Set<string>> = useMemo(() => {
    return getCollectedOidsByDevice({
      devices: Array.from(devicesById.values()),
      justCollected: justCollected,
    });
  }, [devicesById, justCollected]);

  const counts: DeviceWalkCounts = countDeviceWalks(walks);
  const moreToReadCount: number = countWalksWithMoreToRead(walks);
  const walkedAt: Date | undefined = getWalkedAt(walks);
  const summary: string | undefined = describeMultiDeviceSnmpWalkSummary({
    rootOid: walkRootOid,
    walks: walks,
    rows: rows,
    translator: translator,
  });

  const isStartValid: boolean = isWalkableStart(startOid);
  const selectedStart: SnmpWalkStartPoint | undefined =
    getSelectedStartPoint(startOid);
  const overLimitCount: number = Math.max(
    0,
    deviceIds.length - MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
  );
  const canStart: boolean =
    deviceIds.length > 0 &&
    overLimitCount === 0 &&
    isStartValid &&
    !isWalking &&
    !isLoadingDevices;

  const getDeviceWalkRoute: (deviceId: string) => Route = (
    deviceId: string,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK] as Route,
      { modelId: new ObjectID(deviceId) },
    );
  };

  const getDeviceSettingsRoute: (deviceId: string) => Route = (
    deviceId: string,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
      { modelId: new ObjectID(deviceId) },
    );
  };

  /*
   * Saves what every device read as one CSV, grouped by device: every OID
   * of every walk, whatever the filter shows.
   */
  const downloadWalk: () => void = (): void => {
    const file: SnmpWalkExportFile = buildMultiDeviceSnmpWalkExport({
      devices: comparedWalks.map((walk: DeviceWalk) => {
        return {
          deviceName: getDeviceName(walk.deviceId),
          rows: walk.result?.rows || ([] as Array<SnmpWalkRow>),
        };
      }),
      rootOid: walkRootOid || SNMP_WALK_DEFAULT_ROOT_OID,
      exportedAt: OneUptimeDate.getCurrentDate(),
    });

    downloadFile({
      content: file.content,
      filename: file.filename,
      mimeType: file.mimeType,
    });
  };

  const getForm: () => ReactElement = (): ReactElement => {
    return (
      <div className="space-y-5" data-testid="multi-snmp-walk-form">
        <div>
          <FieldLabelElement
            title="Devices"
            htmlFor="multi-snmp-walk-devices"
            description={translator.translateTemplate(
              "Up to {{count}} at a time. Pick devices one by one, or every device with a label.",
              {
                count: translator.formatNumber(
                  MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
                ),
              },
            )}
            required={false}
          />
          <EntityDropdown
            id="multi-snmp-walk-devices"
            modelType={NetworkDevice}
            modelAPI={modelAPI}
            labelField="name"
            valueField="_id"
            isMultiSelect={true}
            query={{ isArchived: false }}
            value={deviceIds}
            placeholder="Search devices…"
            emptyListText="No devices yet."
            dataTestId="multi-snmp-walk-devices"
            disabled={isWalking}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              const ids: Array<string> = (
                Array.isArray(value) ? value : value ? [value] : []
              )
                .map((entry: DropdownValue): string => {
                  return String(entry).trim();
                })
                .filter((id: string, index: number, all: Array<string>) => {
                  return Boolean(id) && all.indexOf(id) === index;
                });

              changeDevices(ids).catch(() => {
                // changeDevices reports its own failures.
              });
            }}
          />
          {overLimitCount > 0 ? (
            <div
              className="mt-2 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
              data-testid="multi-snmp-walk-too-many"
              role="alert"
            >
              <span>
                {translator.translatePlural(
                  {
                    one: "Walk up to {{max}} devices at a time. Remove {{count}} device to walk the rest.",
                    other:
                      "Walk up to {{max}} devices at a time. Remove {{count}} devices to walk the rest.",
                  },
                  overLimitCount,
                  {
                    max: translator.formatNumber(
                      MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
                    ),
                  },
                )}
              </span>
              <div className="[&>button]:ml-0 [&>button]:md:ml-0">
                <Button
                  title={translator.translateTemplate(
                    "Keep the first {{count}}",
                    {
                      count: translator.formatNumber(
                        MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
                      ),
                    },
                  )}
                  buttonSize={ButtonSize.Small}
                  buttonStyle={ButtonStyleType.NORMAL}
                  dataTestId="multi-snmp-walk-keep-first"
                  onClick={() => {
                    setDeviceIds(
                      deviceIds.slice(0, MULTI_DEVICE_SNMP_WALK_MAX_DEVICES),
                    );
                  }}
                />
              </div>
            </div>
          ) : (
            <></>
          )}
          {unreadableCount > 0 ? (
            <p
              className="mt-2 text-sm text-gray-600"
              data-testid="multi-snmp-walk-unreadable"
            >
              {translator.translatePlural(
                {
                  one: "{{count}} device in this page's address could not be read, so it was left out. It may have been deleted.",
                  other:
                    "{{count}} devices in this page's address could not be read, so they were left out. They may have been deleted.",
                },
                unreadableCount,
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
        <div>
          <label
            htmlFor="multi-snmp-walk-start-oid"
            className="block text-sm font-medium text-gray-700"
          >
            {translator.translateText("Start at OID")}
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Input
                id="multi-snmp-walk-start-oid"
                value={startOid}
                placeholder={SNMP_WALK_DEFAULT_ROOT_OID}
                dataTestId="multi-snmp-walk-start-oid"
                ariaInvalid={!isStartValid}
                disabled={isWalking}
                onChange={(value: string) => {
                  setStartOid(value);
                }}
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter" && canStart) {
                    startWalk().catch(() => {
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
                dataTestId="multi-snmp-walk-start"
                disabled={!canStart}
                onClick={() => {
                  startWalk().catch(() => {
                    // startWalk reports its own failures.
                  });
                }}
              />
            </div>
          </div>
          {!isStartValid ? (
            <p
              className="mt-1 text-sm text-red-700"
              data-testid="multi-snmp-walk-start-invalid"
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
                    disabled={isWalking}
                    aria-pressed={isSelected}
                    title={point.oid}
                    data-testid={`multi-snmp-walk-start-point-${point.oid}`}
                    className={`rounded-full border px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnLookClassName(
                      {
                        className: isSelected
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                        isLocked: isWalking,
                      },
                    )}`}
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
            {translator.translateTemplate(
              "Each device is walked by its own probe with its own SNMP credentials, up to {{count}} OIDs a device. To check one OID, start at it.",
              { count: translator.formatNumber(SNMP_WALK_MAX_OIDS) },
            )}
          </p>
        </div>
      </div>
    );
  };

  const getRunning: () => ReactElement = (): ReactElement => {
    if (!isWalking) {
      return <></>;
    }

    return (
      <div
        className="mt-4 flex items-start gap-3 rounded-md bg-gray-50 p-3 text-sm text-gray-600"
        data-testid="multi-snmp-walk-running"
        role="status"
      >
        <div className="pt-0.5">
          <Loader loaderType={LoaderType.Beats} size={8} />
        </div>
        <div className="min-w-0">
          <p className="[overflow-wrap:anywhere]">
            {translator.translatePlural(
              {
                one: "Walking {{oid}} on {{count}} device…",
                other: "Walking {{oid}} on {{count}} devices…",
              },
              counts.total,
              { oid: walkRootOid },
            )}
          </p>
          <p
            className="mt-0.5 text-xs text-gray-500"
            data-testid="multi-snmp-walk-progress"
          >
            {translator.translatePlural(
              {
                one: "{{done}} of {{count}} walk finished. Each probe picks its walks up within ten seconds, and what they read shows here as it arrives.",
                other:
                  "{{done}} of {{count}} walks finished. Each probe picks its walks up within ten seconds, and what they read shows here as it arrives.",
              },
              counts.total,
              {
                done: translator.formatNumber(counts.total - counts.waiting),
              },
            )}
          </p>
        </div>
      </div>
    );
  };

  /*
   * One chip a device: a dot in its walk's colour, its name - a link to its
   * own SNMP Walk page, which opens on this walk of it - and what its walk
   * read, in a few words.
   */
  const getDeviceChips: () => ReactElement = (): ReactElement => {
    return (
      <ul
        className="mt-4 flex flex-wrap gap-2"
        data-testid="multi-snmp-walk-devices-status"
        aria-label={translator.translateText("Walked devices")}
      >
        {walks.map((walk: DeviceWalk): ReactElement => {
          const view: DeviceWalkView = describeDeviceWalk({
            walk: walk,
            probeName: devicesById.get(walk.deviceId)?.probeName,
            translator: translator,
          });

          return (
            <li
              key={walk.deviceId}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs"
              data-testid="multi-snmp-walk-device"
              data-device-id={walk.deviceId}
              data-status={walk.status}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  TONE_DOT_CLASS_NAMES[view.tone]
                }`}
                aria-hidden="true"
              />
              <Link
                to={getDeviceWalkRoute(walk.deviceId)}
                className="min-w-0 truncate font-medium text-gray-900 hover:text-indigo-700"
              >
                {getDeviceName(walk.deviceId)}
              </Link>
              <span className="whitespace-nowrap text-gray-500">
                {view.title}
              </span>
            </li>
          );
        })}
      </ul>
    );
  };

  /*
   * Every device whose walk did not read everything, with why and what to
   * fix: not started, refused, silent, not reported - or stopped part of
   * the way. Listed apart from the chips, so a fleet of fifty with two
   * problems reads as two lines.
   */
  const getProblems: () => ReactElement = (): ReactElement => {
    const problems: Array<{ walk: DeviceWalk; view: DeviceWalkView }> = [];

    for (const walk of walks) {
      if (!isDeviceWalkSettled(walk)) {
        continue;
      }

      const view: DeviceWalkView = describeDeviceWalk({
        walk: walk,
        probeName: devicesById.get(walk.deviceId)?.probeName,
        translator: translator,
      });

      if (
        view.tone === DeviceWalkTone.Error ||
        (view.tone === DeviceWalkTone.Warning && view.rowCount > 0)
      ) {
        problems.push({ walk: walk, view: view });
      }
    }

    if (problems.length === 0) {
      return <></>;
    }

    return (
      <div
        className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3"
        data-testid="multi-snmp-walk-problems"
        role="alert"
      >
        <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
          <Icon icon={IconProp.Alert} className="h-4 w-4 text-amber-600" />
          {translator.translatePlural(
            {
              one: "{{count}} device was not walked in full",
              other: "{{count}} devices were not walked in full",
            },
            problems.length,
          )}
        </p>
        <ul className="mt-2 space-y-2">
          {problems.map(
            (problem: {
              walk: DeviceWalk;
              view: DeviceWalkView;
            }): ReactElement => {
              return (
                <li
                  key={problem.walk.deviceId}
                  className="text-sm text-gray-700"
                  data-testid="multi-snmp-walk-problem"
                  data-device-id={problem.walk.deviceId}
                >
                  <p className="[overflow-wrap:anywhere]">
                    <Link
                      to={getDeviceWalkRoute(problem.walk.deviceId)}
                      className="font-medium text-gray-900 hover:text-indigo-700"
                    >
                      {getDeviceName(problem.walk.deviceId)}
                    </Link>
                    {": "}
                    {problem.view.title}
                  </p>
                  {problem.view.detail ? (
                    <p className="mt-0.5 text-xs text-gray-600 [overflow-wrap:anywhere]">
                      {problem.view.detail}
                    </p>
                  ) : (
                    <></>
                  )}
                  {problem.view.isFixedInSettings ? (
                    <Link
                      to={getDeviceSettingsRoute(problem.walk.deviceId)}
                      className="mt-0.5 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      dataTestId="multi-snmp-walk-problem-settings"
                    >
                      {translator.translateText("Open the device's Settings")}
                    </Link>
                  ) : (
                    <></>
                  )}
                </li>
              );
            },
          )}
        </ul>
      </div>
    );
  };

  const getResults: () => ReactElement = (): ReactElement => {
    if (walks.length === 0) {
      return <></>;
    }

    const hasRows: boolean = rows.length > 0;

    return (
      <div
        className="mt-6 border-t border-gray-100 pt-5"
        data-testid="multi-snmp-walk-result"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0 sm:grow sm:basis-72">
            {summary ? (
              <p
                className={`text-sm [overflow-wrap:anywhere] ${
                  hasRows ? "font-medium text-gray-900" : "text-gray-700"
                }`}
                data-testid="multi-snmp-walk-summary"
              >
                {summary}
              </p>
            ) : (
              <></>
            )}
            <p
              className={`text-xs text-gray-500 ${summary ? "mt-0.5" : ""}`}
              data-testid="multi-snmp-walk-meta"
            >
              {[
                translator.translatePlural(
                  {
                    one: "{{answered}} of {{count}} device answered",
                    other: "{{answered}} of {{count}} devices answered",
                  },
                  counts.total,
                  { answered: translator.formatNumber(counts.answered) },
                ),
                walkedAt
                  ? translator.translateTemplate("Walked {{time}}", {
                      time: formatRelativeTime({
                        date: OneUptimeDate.fromString(walkedAt),
                        now: OneUptimeDate.getCurrentDate(),
                        language: translator.language,
                      }),
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
          {hasRows ? (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-none sm:items-center [&>button]:ml-0 [&>button]:md:ml-0 [&>button]:sm:w-auto">
              <Button
                title="Download CSV"
                icon={IconProp.Download}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.OUTLINE}
                dataTestId="multi-snmp-walk-download"
                disabled={isWalking}
                onClick={downloadWalk}
              />
            </div>
          ) : (
            <></>
          )}
        </div>

        {getDeviceChips()}
        {getProblems()}

        {moreToReadCount > 0 ? (
          <p
            className="mt-3 text-sm text-gray-600"
            data-testid="multi-snmp-walk-more-to-read"
          >
            {translator.translatePlural(
              {
                one: "One device's walk stopped at its limit with more to read. Open the device to continue walking it, or walk a narrower OID here.",
                other:
                  "{{count}} devices' walks stopped at their limit with more to read. Open a device to continue walking it, or walk a narrower OID here.",
              },
              moreToReadCount,
            )}
          </p>
        ) : (
          <></>
        )}

        {hasRows ? (
          <div className="mt-4">
            <MultiDeviceSnmpWalkResults
              rows={rows}
              views={views}
              walks={comparedWalks}
              devicesById={devicesById}
              collectedOidsByDevice={collectedOidsByDevice}
              canCollect={props.canEditDevice}
              canCollectOnTemplate={props.canEditTemplate}
              collectingOid={collectingOid}
              notice={collectNotice}
              onCollect={(row: SnmpWalkComparisonRow, ids: Array<string>) => {
                collectOnDevices(row, ids).catch(() => {
                  // collectOnDevices reports its own failures.
                });
              }}
              onCollectOnTemplate={(
                row: SnmpWalkComparisonRow,
                target: ComparisonTemplateTarget,
              ) => {
                collectOnTemplate(row, target).catch(() => {
                  // collectOnTemplate reports its own failures.
                });
              }}
              getDeviceWalkRoute={getDeviceWalkRoute}
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
        <p
          className="text-sm text-red-700"
          data-testid="multi-snmp-walk-load-error"
        >
          {loadError}
        </p>
      );
    }

    return (
      <>
        {props.canWalk ? (
          getForm()
        ) : (
          <p
            className="text-sm text-gray-500"
            data-testid="multi-snmp-walk-read-only"
          >
            {walks.length > 0
              ? translator.translateText(
                  "You can read this walk. Walking devices needs the Create Network Device Diagnostic permission.",
                )
              : translator.translateText(
                  "Walking devices needs the Create Network Device Diagnostic permission.",
                )}
          </p>
        )}
        {getRunning()}
        {walkError ? (
          <div
            className="mt-4 flex gap-3 rounded-md border border-red-200 bg-red-50 p-3"
            data-testid="multi-snmp-walk-error"
            role="alert"
          >
            <div className="pt-0.5">
              <Icon icon={IconProp.Alert} className="h-5 w-5 text-red-600" />
            </div>
            <p className="min-w-0 text-sm text-gray-700 [overflow-wrap:anywhere]">
              {walkError}
            </p>
          </div>
        ) : (
          <></>
        )}
        {getResults()}
        {walks.length === 0 && !isWalking && props.canWalk ? (
          <p
            className="mt-6 text-sm text-gray-500"
            data-testid="multi-snmp-walk-empty"
          >
            {translator.translateText(
              "Not walked yet. Pick the devices and where to start, then walk them to see which devices answer each OID, and with what.",
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
      description="Walk many devices at once, each from its own probe with its own SNMP credentials. See which devices answer an OID and with what, then collect it on every one of them."
    >
      <div data-testid="multi-snmp-walk" aria-busy={isWalking}>
        {getBody()}
      </div>
    </Card>
  );
};

export default MultiDeviceSnmpWalkCard;
