import { readNetworkControllerConnectionNow } from "../NetworkTrafficUsageApi";
import MerakiAddDevicesModal from "./MerakiAddDevicesModal";
import {
  ADDED_DEVICES_NOTE,
  ADDED_SITES_NOTE,
  ADDING_DEVICES,
  ADDING_DEVICES_PROGRESS,
  ADD_DEVICES_ACTION,
  ADD_FAILED_NOTE,
  ADD_STOPPED_NOTE,
  ADD_THE_REST_ACTION,
  DEVICE_ADD_FAILURES_SHOWN,
  DeviceAddStanding,
  FAILED_DEVICES_NOTE,
  NOTHING_ADDED_NOTE,
  NOT_ADDED_DEVICES_NOTE,
  REMAINING_DEVICES_NOTE,
  getDeviceAddStanding,
  getOfferedDeviceCount,
} from "./MerakiAddDevicesWords";
import MerakiConnectionEditModal from "./MerakiConnectionEditModal";
import { MERAKI_CONNECTIONS_ANCHOR } from "./MerakiUrlState";
import {
  ANALYSIS_OFF_NOTE,
  ANALYTICS_WAITING_NOTE,
  API_CALL_COUNT,
  APPLIANCE_COUNT,
  DESCRIBED_DEVICES_NOTE,
  DEVICE_COUNT,
  LINKED_DEVICES_NOTE,
  PLACED_CLIENTS_NOTE,
  UNPLACED_DEVICES_NOTE,
  MERAKI_CONNECTION_NAME,
  MERAKI_STATUS_WORDS,
  MERAKI_TONE_PILL,
  MerakiConnectionAction,
  MerakiConnectionRowFacts,
  MerakiStatusWords,
  NETWORK_COUNT,
  RATE_LIMITED_NOTE,
  READING_NOW,
  drawMerakiTemplate,
  getMerakiConnectionAction,
  getMerakiConnectionRowFacts,
  getMerakiConnectionSentence,
  getMerakiIntervalWords,
  getMerakiReadTime,
} from "./MerakiWords";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { DEFAULT_MERAKI_REGION } from "Common/Types/NetworkController/MerakiRegion";
import { NetworkControllerConnectionStatus } from "Common/Types/NetworkController/NetworkControllerConnectionHealth";
import {
  NetworkControllerDeviceAddFailure,
  NetworkControllerDeviceAddState,
  isNetworkControllerDeviceAddUnderWay,
  readNetworkControllerDeviceAddState,
  toNetworkControllerDeviceAddStateJson,
} from "Common/Types/NetworkController/NetworkControllerDeviceAdd";
import ObjectID from "Common/Types/ObjectID";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import {
  ReadingDirection,
  getTextReadingDirectionByMostLetters,
} from "Common/Types/ReadingDirection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Pill from "Common/UI/Components/Pill/Pill";
import ProviderLogoImage from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  bringPageAnchorIntoView,
  getPageAnchor,
  markPageAnchorLanded,
} from "Common/UI/Utils/PageAnchor";
import ProjectUtil from "Common/UI/Utils/Project";
import { SentenceOptions, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The project's Meraki connections, at the foot of the whole network's
 * Traffic page: each organization with how it is doing - a status pill in
 * the words Cloud Connect's list uses, and the same sentence as the line
 * over its traffic - then how often it is read and what its last read
 * covered (networks, appliances, the API calls it took), and what it could
 * not do, in so many words: amber for what to act on (traffic analysis
 * off), grey for what OneUptime handles by itself (networks still to read,
 * Meraki asking it to slow down).
 *
 * Each row has one button, the next thing to do: Read now - Turn on for a
 * connection that is off, Update API key for one whose key Meraki refused.
 * Its menu has Edit, Add devices, Turn off (or on) and Delete. A read
 * started here (or a connection waiting for its first) is watched, and the
 * list and the page refresh by themselves when it ends. Connecting another
 * organization is the header's button.
 *
 * Under its notes, one line about the organization's devices that are no
 * network device here (Add Meraki devices, MerakiAddDevicesModal): how many
 * of the kinds it would add there are, with Add devices beside them; while
 * an ask runs, how far it got - followed every few seconds, from any tab -
 * and for a day after, how it went: what it added, the sites it added, and
 * the devices it could not add, with why.
 *
 * What a reader may not do is not offered (PermissionGate): only project
 * owners and admins add, change or read connections. Anyone else sees the
 * list without its buttons, and under it, in words, why - as the LLM and
 * Cloud Connect pages say it (a disabled button's tooltip never shows on a
 * phone).
 *
 * A project without a connection gets no card at all - only, on a page that
 * shows its flow records, one quiet line at the foot that Meraki can be
 * read too (the page still setting up offers it in its guide instead).
 */

export interface ComponentProps {
  // Bumped by the page to load the list again.
  refreshKey: number;
  // Offer Meraki in one line when the project has no connection.
  offerWhenEmpty?: boolean | undefined;
  // A read ended, or a connection changed: the page reads its traffic again.
  onChanged: () => void;
  onConnect: () => void;
}

// How often a read started here is asked about, and for how long.
export const READ_NOW_POLL_MS: number = 5000;
export const READ_NOW_GIVE_UP_MS: number = 7 * 60 * 1000;

interface WatchedRead {
  before: string;
  startedAt: number;
  isQuiet: boolean;
}

interface EditingConnection {
  model: NetworkControllerConnection;
  focusKey: boolean;
}

interface RowNote {
  text: string;
  // Something to act on (amber), or what OneUptime handles itself (grey).
  isToActOn: boolean;
}

const LIST_LIMIT: number = 100;

// One line about adding the organization's devices (drawDeviceAddLines).
type DeviceAddTone = "info" | "done" | "act" | "error" | "progress";

interface DeviceAddLine {
  // Stable within the row, and the line's data-state.
  key: string;
  tone: DeviceAddTone;
  text: string;
  // Drawn after the text: Add devices (or Add the rest), for who may.
  after?: ReactElement | undefined;
  // A line each under it: the devices that could not be added, with why.
  details?: Array<NetworkControllerDeviceAddFailure> | undefined;
}

/*
 * A device an ask could not add: its name, then why - the server's words,
 * in their own language. Read the way most of its letters are (an isolate),
 * so on a Persian page an English reason keeps its full stop at its end,
 * and the name stands out to scan the list by.
 */
const DeviceAddFailureLine: FunctionComponent<{
  failure: NetworkControllerDeviceAddFailure;
}> = (props: { failure: NetworkControllerDeviceAddFailure }): ReactElement => {
  const direction: ReadingDirection | null =
    getTextReadingDirectionByMostLetters(
      props.failure.name
        ? `${props.failure.name}: ${props.failure.reason}`
        : props.failure.reason,
    );

  return (
    <bdi dir={direction || undefined}>
      {props.failure.name ? (
        <>
          <span className="font-medium">{props.failure.name}</span>:{" "}
        </>
      ) : (
        <></>
      )}
      {props.failure.reason}
    </bdi>
  );
};

/*
 * A line's values - a count, a time, a reason - set apart in a sentence
 * read right to left, so they read where the sentence puts them.
 */
const IN_SENTENCE: SentenceOptions = { setsValuesApart: true };

const DEVICE_ADD_TONE_TEXT: Record<DeviceAddTone, string> = {
  info: "text-gray-500",
  progress: "text-gray-600",
  done: "text-emerald-700",
  act: "text-amber-800",
  error: "text-red-700",
};

const DEVICE_ADD_TONE_ICON_CLASS: Record<DeviceAddTone, string> = {
  info: "text-gray-400",
  progress: "text-gray-400",
  done: "text-emerald-600",
  act: "text-amber-600",
  error: "text-red-600",
};

const DEVICE_ADD_TONE_ICON: Record<DeviceAddTone, IconProp> = {
  info: IconProp.Info,
  progress: IconProp.Clock,
  done: IconProp.CheckCircle,
  act: IconProp.ExclaimationCircle,
  error: IconProp.ExclaimationCircle,
};

/*
 * Clears Button's dialog-footer margin (md:ml-3) inside a row: the gap
 * spaces the row's controls, and a locked button sits in a tooltip's span.
 */
const ROW_BUTTONS_CLASS_NAME: string =
  "[&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0";

const MerakiConnectionsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connections, setConnections] = useState<
    Array<NetworkControllerConnection>
  >([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [watching, setWatching] = useState<Record<string, WatchedRead>>({});
  const [editing, setEditing] = useState<EditingConnection | null>(null);
  const [deleting, setDeleting] = useState<NetworkControllerConnection | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [addingDevicesOf, setAddingDevicesOf] =
    useState<NetworkControllerConnection | null>(null);
  const [notice, setNotice] = useState<string>("");
  // First reads watched: once each, ended or not.
  const firstReadsWatched: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );
  const cardRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const hasConnections: boolean = connections.length > 0;

  const model: NetworkControllerConnection = new NetworkControllerConnection();
  const gateOptions: PermissionGateOptions = {
    singularName: MERAKI_CONNECTION_NAME,
  };
  const canCreate: boolean = PermissionGate.check(
    model,
    ModelAction.Create,
    gateOptions,
  ).isAllowed;
  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
    gateOptions,
  );
  const canUpdate: boolean = updateGate.isAllowed;
  const canDelete: boolean = PermissionGate.check(
    model,
    ModelAction.Delete,
    gateOptions,
  ).isAllowed;
  /*
   * Add devices: for who may change the connection and create network
   * devices - the devices are added as them.
   */
  const canAddDevices: boolean =
    canUpdate &&
    PermissionGate.check(new NetworkDevice(), ModelAction.Create).isAllowed;

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<NetworkControllerConnection> =
          await ModelAPI.getList<NetworkControllerConnection>({
            modelType: NetworkControllerConnection,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
            select: {
              _id: true,
              name: true,
              provider: true,
              config: true,
              isEnabled: true,
              createdAt: true,
              lastPulledAt: true,
              lastSuccessfulPullAt: true,
              lastError: true,
              lastPullResult: true,
              lastDeviceAdd: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            limit: LIST_LIMIT,
            skip: 0,
          });

        if (isCurrent) {
          setConnections(result.data);
          setError("");
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (isCurrent) {
          setIsLoaded(true);
        }
      }
    };

    load().catch(() => {
      // handled inside.
    });

    return () => {
      isCurrent = false;
    };
  }, [props.refreshKey, reloadKey]);

  /*
   * Opened at the connections (#traffic-meraki-connections) - from a
   * device's or a site's Traffic page, or a device Meraki has not read: the
   * card is brought into view once it is drawn, under the page's header,
   * and kept there while the traffic above it loads, and marked for a
   * moment (Utils/PageAnchor).
   */
  useEffect(() => {
    if (
      !isLoaded ||
      !hasConnections ||
      !cardRef.current ||
      getPageAnchor() !== MERAKI_CONNECTIONS_ANCHOR
    ) {
      return;
    }

    const element: HTMLDivElement = cardRef.current;
    const stopBringingIntoView: () => void = bringPageAnchorIntoView(element);
    const unmark: () => void = markPageAnchorLanded(element);

    return () => {
      stopBringingIntoView();
      unmark();
    };
  }, [isLoaded, hasConnections]);

  // A connection never read yet is watched once, quietly, until it is.
  useEffect(() => {
    const unread: Array<NetworkControllerConnection> = connections.filter(
      (connection: NetworkControllerConnection): boolean => {
        const id: string = connection.id?.toString() || "";

        return (
          Boolean(id) &&
          connection.isEnabled !== false &&
          !connection.lastPulledAt &&
          !firstReadsWatched.current.has(id)
        );
      },
    );

    if (unread.length === 0) {
      return;
    }

    setWatching((current: Record<string, WatchedRead>) => {
      const next: Record<string, WatchedRead> = { ...current };

      for (const connection of unread) {
        const id: string = connection.id!.toString();
        firstReadsWatched.current.add(id);
        next[id] = { before: "", startedAt: Date.now(), isQuiet: true };
      }

      return next;
    });
  }, [connections]);

  /*
   * While a read watched here runs, ask now and then whether it ended - of
   * the one connection, so the list does not flicker - and load the list
   * and the page's traffic again once it has.
   */
  useEffect(() => {
    const ids: Array<string> = Object.keys(watching);

    if (ids.length === 0) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      const check: () => Promise<void> = async (): Promise<void> => {
        for (const id of ids) {
          const read: WatchedRead | undefined = watching[id];

          if (!read) {
            continue;
          }

          let ended: boolean =
            Date.now() - read.startedAt > READ_NOW_GIVE_UP_MS;

          if (!ended) {
            try {
              const item: NetworkControllerConnection | null =
                await ModelAPI.getItem<NetworkControllerConnection>({
                  modelType: NetworkControllerConnection,
                  id: new ObjectID(id),
                  select: { _id: true, lastPulledAt: true },
                });
              const last: string = item?.lastPulledAt
                ? new Date(item.lastPulledAt).toISOString()
                : "";

              ended = Boolean(last) && last !== read.before;
            } catch {
              ended = false;
            }
          }

          if (ended) {
            setWatching((current: Record<string, WatchedRead>) => {
              const next: Record<string, WatchedRead> = { ...current };
              delete next[id];
              return next;
            });
            setReloadKey((value: number): number => {
              return value + 1;
            });
            props.onChanged();
          }
        }
      };

      check().catch(() => {
        // the next tick asks again.
      });
    }, READ_NOW_POLL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [watching]);

  /*
   * While devices are being added from a connection, ask now and then how
   * far it got - of that connection alone, so the list does not flicker -
   * and load the list and the page again once it is done: the devices are
   * on the page by then.
   */
  const addingIds: Array<string> = connections
    .filter((connection: NetworkControllerConnection): boolean => {
      return isNetworkControllerDeviceAddUnderWay(
        readNetworkControllerDeviceAddState(connection.lastDeviceAdd),
        new Date(),
      );
    })
    .map((connection: NetworkControllerConnection): string => {
      return connection.id?.toString() || "";
    })
    .filter(Boolean);

  useEffect(() => {
    if (addingIds.length === 0) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      const check: () => Promise<void> = async (): Promise<void> => {
        let isAnyDone: boolean = false;

        for (const id of addingIds) {
          try {
            const item: NetworkControllerConnection | null =
              await ModelAPI.getItem<NetworkControllerConnection>({
                modelType: NetworkControllerConnection,
                id: new ObjectID(id),
                select: { _id: true, lastDeviceAdd: true },
              });

            if (!item) {
              continue;
            }

            setConnections(
              (
                current: Array<NetworkControllerConnection>,
              ): Array<NetworkControllerConnection> => {
                return current.map(
                  (
                    connection: NetworkControllerConnection,
                  ): NetworkControllerConnection => {
                    if (
                      connection.id?.toString() === id &&
                      item.lastDeviceAdd
                    ) {
                      connection.lastDeviceAdd = item.lastDeviceAdd;
                    }

                    return connection;
                  },
                );
              },
            );

            if (
              !isNetworkControllerDeviceAddUnderWay(
                readNetworkControllerDeviceAddState(item.lastDeviceAdd),
                new Date(),
              )
            ) {
              isAnyDone = true;
            }
          } catch {
            // the next tick asks again.
          }
        }

        if (isAnyDone) {
          setReloadKey((value: number): number => {
            return value + 1;
          });
          props.onChanged();
        }
      };

      check().catch(() => {
        // the next tick asks again.
      });
    }, READ_NOW_POLL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [addingIds.join(",")]);

  /*
   * A connection saved or turned back on is read again within a minute
   * (its service clears its next read): watched quietly, so its row and
   * the page show that read by themselves.
   */
  const watchNextRead: (connection: NetworkControllerConnection) => void = (
    connection: NetworkControllerConnection,
  ): void => {
    const id: string = connection.id?.toString() || "";

    if (!id) {
      return;
    }

    setWatching((current: Record<string, WatchedRead>) => {
      return {
        ...current,
        [id]: {
          before: connection.lastPulledAt
            ? new Date(connection.lastPulledAt).toISOString()
            : "",
          startedAt: Date.now(),
          isQuiet: true,
        },
      };
    });
  };

  const readNow: (
    connection: NetworkControllerConnection,
  ) => Promise<void> = async (
    connection: NetworkControllerConnection,
  ): Promise<void> => {
    if (!connection.id) {
      return;
    }

    const id: string = connection.id.toString();

    setNotice("");

    try {
      await readNetworkControllerConnectionNow(connection.id);

      setWatching((current: Record<string, WatchedRead>) => {
        return {
          ...current,
          [id]: {
            before: connection.lastPulledAt
              ? new Date(connection.lastPulledAt).toISOString()
              : "",
            startedAt: Date.now(),
            isQuiet: false,
          },
        };
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  const setEnabled: (
    connection: NetworkControllerConnection,
    isEnabled: boolean,
  ) => Promise<void> = async (
    connection: NetworkControllerConnection,
    isEnabled: boolean,
  ): Promise<void> => {
    if (!connection.id) {
      return;
    }

    setNotice("");

    try {
      await ModelAPI.updateById<NetworkControllerConnection>({
        modelType: NetworkControllerConnection,
        id: connection.id,
        data: { isEnabled },
      });

      if (isEnabled) {
        watchNextRead(connection);
      }

      setReloadKey((value: number): number => {
        return value + 1;
      });
      props.onChanged();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  const remove: () => Promise<void> = async (): Promise<void> => {
    if (!deleting?.id) {
      return;
    }

    setIsDeleting(true);

    try {
      await ModelAPI.deleteItem<NetworkControllerConnection>({
        modelType: NetworkControllerConnection,
        id: deleting.id,
      });

      setDeleting(null);
      setReloadKey((value: number): number => {
        return value + 1;
      });
      props.onChanged();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  /*
   * The line about the organization's devices that are no network device
   * here - see the header. Nothing for a connection that is off, or one
   * nothing is to be said about. While Meraki refuses the connection's key,
   * the count is said but Add devices is not offered: every ask would fail
   * on that key, and the row's one button is Update API key.
   */
  const drawDeviceAddLines: (data: {
    connectionModel: NetworkControllerConnection;
    isOff: boolean;
    isKeyRefused: boolean;
    summary: MerakiConnectionRowFacts["summary"];
    now: Date;
  }) => ReactElement = (data: {
    connectionModel: NetworkControllerConnection;
    isOff: boolean;
    isKeyRefused: boolean;
    summary: MerakiConnectionRowFacts["summary"];
    now: Date;
  }): ReactElement => {
    const state: NetworkControllerDeviceAddState | undefined =
      readNetworkControllerDeviceAddState(data.connectionModel.lastDeviceAdd);
    const standing: DeviceAddStanding = getDeviceAddStanding(state, data.now);
    const lastPulledAt: number = data.connectionModel.lastPulledAt
      ? new Date(data.connectionModel.lastPulledAt).getTime()
      : 0;
    /*
     * An outcome newer than the last read: the read's counts are from
     * before the devices were added, so the row says what was added, not
     * what the read counted.
     */
    const isOutcomeNewer: boolean = Boolean(
      state?.finishedAt && Date.parse(state.finishedAt) > lastPulledAt,
    );
    const offered: number = getOfferedDeviceCount({
      counts: data.summary?.unaddedDevices,
      last: state,
    });
    const lines: Array<ReactElement> = [];

    /*
     * The way on, after a line's sentence: Add devices - or Add the rest,
     * after an ask that added some and ended with more to add. Both open
     * the dialog, for who may add devices.
     */
    const drawAction: (title: string) => ReactElement = (
      title: string,
    ): ReactElement => {
      return canAddDevices && !data.isOff && !data.isKeyRefused ? (
        <button
          type="button"
          className="ml-1 font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
          onClick={() => {
            setNotice("");
            setAddingDevicesOf(data.connectionModel);
          }}
          data-testid="meraki-connection-add-devices"
        >
          {translator.translateText(title) || title}
        </button>
      ) : (
        <></>
      );
    };
    const action: ReactElement = drawAction(ADD_DEVICES_ACTION);

    const addLine: (lineData: DeviceAddLine) => void = (
      lineData: DeviceAddLine,
    ): void => {
      lines.push(
        <div
          key={lineData.key}
          className={`mt-1.5 flex items-start gap-1.5 text-xs ${DEVICE_ADD_TONE_TEXT[lineData.tone]}`}
          data-testid="meraki-connection-device-add"
          data-state={lineData.key}
          data-tone={lineData.tone}
          role={lineData.tone === "progress" ? "status" : undefined}
          aria-live={lineData.tone === "progress" ? "polite" : undefined}
        >
          <Icon
            icon={DEVICE_ADD_TONE_ICON[lineData.tone]}
            className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${DEVICE_ADD_TONE_ICON_CLASS[lineData.tone]}`}
          />
          <div className="min-w-0">
            <span>{lineData.text}</span>
            {lineData.after || <></>}
            {lineData.details && lineData.details.length > 0 ? (
              <ul
                className="mt-1 space-y-0.5"
                data-testid="meraki-connection-device-add-failures"
              >
                {lineData.details.map(
                  (
                    failure: NetworkControllerDeviceAddFailure,
                    index: number,
                  ): ReactElement => {
                    return (
                      <li key={index} className="break-words">
                        <DeviceAddFailureLine failure={failure} />
                      </li>
                    );
                  },
                )}
              </ul>
            ) : (
              <></>
            )}
          </div>
        </div>,
      );
    };

    if (standing === DeviceAddStanding.UnderWay && state) {
      addLine({
        key: "adding",
        tone: "progress",
        text:
          state.toAddCount > 0
            ? translator.translateTemplate(
                ADDING_DEVICES_PROGRESS,
                {
                  added: translator.formatNumber(state.addedCount),
                  total: translator.formatNumber(state.toAddCount),
                },
                IN_SENTENCE,
              )
            : translator.translateText(ADDING_DEVICES) || ADDING_DEVICES,
      });

      return <>{lines}</>;
    }

    /*
     * What an ask that ended added, when it added any: said whether it
     * finished, failed half way (the person lost the right to add devices)
     * or stopped (its worker went quiet) - the devices are here either way.
     * When: when it ended, or when its worker last wrote.
     */
    const addAddedLine: (ended: NetworkControllerDeviceAddState) => void = (
      ended: NetworkControllerDeviceAddState,
    ): void => {
      addLine({
        key: "added",
        tone: "done",
        text: translator.translatePlural(
          ADDED_DEVICES_NOTE,
          ended.addedCount,
          {
            time: getMerakiReadTime(ended.finishedAt || ended.updatedAt, {
              language: translator.language,
              now: data.now,
            }),
          },
          IN_SENTENCE,
        ),
      });
    };

    if (standing === DeviceAddStanding.Done && state) {
      const when: string = getMerakiReadTime(state.finishedAt, {
        language: translator.language,
        now: data.now,
      });

      if (state.addedCount > 0) {
        addAddedLine(state);
      } else if (state.failedCount === 0) {
        addLine({
          key: "nothing-added",
          tone: "info",
          text: translator.translateTemplate(
            NOTHING_ADDED_NOTE,
            { time: when },
            IN_SENTENCE,
          ),
        });
      }

      if (state.createdSiteCount > 0) {
        addLine({
          key: "sites-added",
          tone: "info",
          text: translator.translatePlural(
            ADDED_SITES_NOTE,
            state.createdSiteCount,
            {},
            IN_SENTENCE,
          ),
        });
      }

      if (state.failedCount > 0) {
        addLine({
          key: "failed-devices",
          tone: "act",
          text: translator.translatePlural(
            FAILED_DEVICES_NOTE,
            state.failedCount,
            {},
            IN_SENTENCE,
          ),
          details: state.failures.slice(0, DEVICE_ADD_FAILURES_SHOWN),
        });
      }

      if (state.remainingCount > 0 && isOutcomeNewer) {
        addLine({
          key: "remaining",
          tone: "act",
          text: translator.translatePlural(
            REMAINING_DEVICES_NOTE,
            state.remainingCount,
            {},
            IN_SENTENCE,
          ),
          after: drawAction(ADD_THE_REST_ACTION),
        });
      }
    }

    if (standing === DeviceAddStanding.Failed && state) {
      if (state.addedCount > 0) {
        addAddedLine(state);
      }

      addLine({
        key: "add-failed",
        tone: "error",
        text: translator.translateTemplate(
          ADD_FAILED_NOTE,
          { reason: state.message || "" },
          IN_SENTENCE,
        ),
      });
    }

    if (standing === DeviceAddStanding.Stopped && state) {
      if (state.addedCount > 0) {
        addAddedLine(state);
      }

      addLine({
        key: "add-stopped",
        tone: "act",
        text: translator.translateText(ADD_STOPPED_NOTE) || ADD_STOPPED_NOTE,
        // The rest, after what it added; else what it set out to add.
        after:
          state.addedCount > 0
            ? drawAction(ADD_THE_REST_ACTION)
            : drawAction(ADD_DEVICES_ACTION),
      });
    }

    /*
     * What a read counted that is not here: offered, unless an ask that
     * ended since the read already said what it did about them.
     */
    if (
      !data.isOff &&
      offered > 0 &&
      standing !== DeviceAddStanding.Stopped &&
      !(standing !== DeviceAddStanding.None && isOutcomeNewer)
    ) {
      addLine({
        key: "not-added",
        tone: "info",
        text: translator.translatePlural(
          NOT_ADDED_DEVICES_NOTE,
          offered,
          {},
          IN_SENTENCE,
        ),
        after: action,
      });
    }

    return <>{lines}</>;
  };

  if (!isLoaded) {
    return <></>;
  }

  if (connections.length === 0 && !error) {
    // An offer to connect, for who may connect.
    if (!props.offerWhenEmpty || !canCreate) {
      return <></>;
    }

    /*
     * The page shows its flows and the project reads no Meraki dashboard:
     * one quiet line that it can, where Cloud Connect's page says what else
     * there is - never a card of its own on every network's page.
     */
    return (
      <div
        className="mb-5 flex items-start gap-2 px-1 text-sm text-gray-500"
        data-testid="meraki-offer"
      >
        {/*
          Meraki is Cisco's, and is shown by Cisco's official logo - the
          words beside it name it, so it is not read out.
        */}
        <ProviderLogoImage
          logo={ProviderLogo.Cisco}
          isBare={true}
          size={16}
          isDecorative={true}
          className="mt-0.5"
        />
        <span>
          {translator.translateText("Using Cisco Meraki?")}{" "}
          <button
            type="button"
            className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
            onClick={props.onConnect}
            data-testid="meraki-offer-connect"
          >
            {translator.translateText("Connect Meraki")}
          </button>
        </span>
      </div>
    );
  }

  const now: Date = new Date();

  return (
    <div id={MERAKI_CONNECTIONS_ANCHOR} ref={cardRef} className="scroll-mt-4">
      <Card
        title="Meraki"
        description="The Meraki organizations OneUptime reads traffic and device details from, through the Meraki dashboard API."
        rightElement={
          canCreate ? (
            <Button
              title="Connect Meraki"
              icon={IconProp.Add}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={props.onConnect}
              dataTestId="meraki-connect-another"
            />
          ) : (
            <></>
          )
        }
      >
        <div data-testid="meraki-connections">
          {error ? (
            <div
              role="alert"
              className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
            >
              {error}
            </div>
          ) : (
            <></>
          )}
          {notice ? (
            <div
              role="status"
              className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200"
            >
              {notice}
            </div>
          ) : (
            <></>
          )}
          <ul className="divide-y divide-gray-100">
            {connections.map(
              (connectionModel: NetworkControllerConnection): ReactElement => {
                const facts: MerakiConnectionRowFacts =
                  getMerakiConnectionRowFacts(connectionModel, now);
                const id: string = facts.connection.id;
                const watched: WatchedRead | undefined = watching[id];
                const isReading: boolean = Boolean(watched && !watched.isQuiet);
                const words: MerakiStatusWords =
                  MERAKI_STATUS_WORDS[facts.connection.status];
                const isOff: boolean =
                  facts.connection.status ===
                  NetworkControllerConnectionStatus.Off;
                const isWaiting: boolean =
                  facts.connection.status ===
                  NetworkControllerConnectionStatus.Waiting;
                const summary: MerakiConnectionRowFacts["summary"] =
                  facts.summary;
                const action: MerakiConnectionAction =
                  getMerakiConnectionAction(facts);

                // The organization when it is not the name; a region not global.
                const where: Array<string> = [
                  facts.connection.organizationName !== facts.connection.name
                    ? facts.connection.organizationName
                    : "",
                  facts.region !== DEFAULT_MERAKI_REGION
                    ? `${translator.translateText(facts.regionName) || facts.regionName} (${facts.regionHost})`
                    : "",
                ].filter(Boolean);

                // How often (unless off), then what the last read covered.
                const covered: Array<string> = [
                  isOff
                    ? ""
                    : drawMerakiTemplate(
                        translator,
                        getMerakiIntervalWords(
                          facts.connection.readIntervalInMinutes,
                        ),
                      ),
                  ...(summary
                    ? [
                        translator.translatePlural(
                          NETWORK_COUNT,
                          summary.networkCount,
                        ),
                        // Every device, when the read counted them.
                        summary.deviceCount !== undefined
                          ? translator.translatePlural(
                              DEVICE_COUNT,
                              summary.deviceCount,
                            )
                          : "",
                        translator.translatePlural(
                          APPLIANCE_COUNT,
                          summary.applianceCount,
                        ),
                        summary.requestCount > 0
                          ? translator.translatePlural(
                              API_CALL_COUNT,
                              summary.requestCount,
                            )
                          : "",
                      ]
                    : []),
                ].filter(Boolean);

                const notes: Array<RowNote> = [];

                /*
                 * What the read did for Inventory: the devices here that are
                 * Meraki devices, with what they take from it.
                 */
                if (summary && (summary.describedDeviceCount || 0) > 0) {
                  notes.push({
                    text: translator.translatePlural(
                      DESCRIBED_DEVICES_NOTE,
                      summary.describedDeviceCount || 0,
                    ),
                    isToActOn: false,
                  });
                }

                /*
                 * And what it did for the map: the clients it put on their
                 * ports, the links it drew, and the Meraki devices that have
                 * clients on them and nothing here to hang them from.
                 */
                if (summary && (summary.placedClientCount || 0) > 0) {
                  notes.push({
                    text: translator.translatePlural(
                      PLACED_CLIENTS_NOTE,
                      summary.placedClientCount || 0,
                    ),
                    isToActOn: false,
                  });
                }

                if (summary && (summary.linkedDeviceCount || 0) > 0) {
                  notes.push({
                    text: translator.translatePlural(
                      LINKED_DEVICES_NOTE,
                      summary.linkedDeviceCount || 0,
                    ),
                    isToActOn: false,
                  });
                }

                if (summary && (summary.unplacedDeviceCount || 0) > 0) {
                  notes.push({
                    text: translator.translatePlural(
                      UNPLACED_DEVICES_NOTE,
                      summary.unplacedDeviceCount || 0,
                    ),
                    isToActOn: true,
                  });
                }

                if (summary && summary.trafficAnalysisOffNetworks > 0) {
                  notes.push({
                    text: translator.translatePlural(
                      ANALYSIS_OFF_NOTE,
                      summary.trafficAnalysisOffNetworks,
                    ),
                    isToActOn: true,
                  });
                }

                if (summary && summary.analyticsNetworksWaiting > 0) {
                  notes.push({
                    text: translator.translatePlural(
                      ANALYTICS_WAITING_NOTE,
                      summary.analyticsNetworksWaiting,
                    ),
                    isToActOn: false,
                  });
                }

                if (summary?.wasRateLimited) {
                  notes.push({
                    text:
                      translator.translateText(RATE_LIMITED_NOTE) ||
                      RATE_LIMITED_NOTE,
                    isToActOn: false,
                  });
                }

                // Meraki refuses its key: nothing can be read or added.
                const isKeyRefused: boolean =
                  action === MerakiConnectionAction.UpdateKey;

                const deviceAdd: ReactElement = drawDeviceAddLines({
                  connectionModel,
                  isOff,
                  isKeyRefused,
                  summary,
                  now,
                });

                const primary: ReactElement = ((): ReactElement => {
                  if (!canUpdate) {
                    return <></>;
                  }

                  if (action === MerakiConnectionAction.TurnOn) {
                    return (
                      <Button
                        title="Turn on"
                        icon={IconProp.Play}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.NORMAL}
                        onClick={() => {
                          setEnabled(connectionModel, true).catch(() => {
                            // handled inside.
                          });
                        }}
                        dataTestId="meraki-connection-turn-on"
                      />
                    );
                  }

                  if (action === MerakiConnectionAction.UpdateKey) {
                    return (
                      <Button
                        title="Update API key"
                        icon={IconProp.Key}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.NORMAL}
                        onClick={() => {
                          setNotice("");
                          setEditing({
                            model: connectionModel,
                            focusKey: true,
                          });
                        }}
                        dataTestId="meraki-connection-update-key"
                      />
                    );
                  }

                  return (
                    <Button
                      title="Read now"
                      icon={IconProp.Refresh}
                      buttonSize={ButtonSize.Small}
                      buttonStyle={ButtonStyleType.NORMAL}
                      isLoading={isReading}
                      onClick={() => {
                        readNow(connectionModel).catch(() => {
                          // handled inside.
                        });
                      }}
                      dataTestId="meraki-connection-read-now"
                    />
                  );
                })();

                const menuItems: Array<ReactElement> = [];

                if (canUpdate) {
                  menuItems.push(
                    <MoreMenuItem
                      key="edit"
                      text="Edit"
                      icon={IconProp.Edit}
                      onClick={() => {
                        setNotice("");
                        setEditing({ model: connectionModel, focusKey: false });
                      }}
                    />,
                  );
                }

                /*
                 * Add devices, whenever it can be asked for: the dialog
                 * says when there is nothing left to add. Not while Meraki
                 * refuses the key - Update API key comes first.
                 */
                if (
                  canAddDevices &&
                  !isOff &&
                  !isKeyRefused &&
                  !addingIds.includes(facts.connection.id)
                ) {
                  menuItems.push(
                    <MoreMenuItem
                      key="add-devices"
                      text={ADD_DEVICES_ACTION}
                      icon={IconProp.Add}
                      onClick={() => {
                        setNotice("");
                        setAddingDevicesOf(connectionModel);
                      }}
                    />,
                  );
                }

                if (canUpdate) {
                  menuItems.push(
                    <MoreMenuItem
                      key="toggle"
                      text={isOff ? "Turn on" : "Turn off"}
                      icon={isOff ? IconProp.Play : IconProp.Stop}
                      onClick={() => {
                        setEnabled(connectionModel, isOff).catch(() => {
                          // handled inside.
                        });
                      }}
                    />,
                  );
                }

                if (canDelete) {
                  menuItems.push(
                    <MoreMenuItem
                      key="delete"
                      text="Delete"
                      icon={IconProp.Trash}
                      isDestructive={true}
                      onClick={() => {
                        setDeleting(connectionModel);
                      }}
                    />,
                  );
                }

                return (
                  <li
                    key={id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                    data-testid="meraki-connection"
                    data-status={facts.connection.status}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                          {facts.connection.name}
                        </span>
                        <span data-testid="meraki-connection-status">
                          <Pill
                            text={isReading ? READING_NOW : words.label}
                            color={MERAKI_TONE_PILL[words.tone]}
                            isPulsing={isReading}
                          />
                        </span>
                      </div>
                      {where.length > 0 ? (
                        <div
                          className="mt-0.5 text-xs text-gray-500"
                          data-testid="meraki-connection-organization"
                        >
                          {where.join(" · ")}
                        </div>
                      ) : (
                        <></>
                      )}
                      {/*
                       * Waiting for its first read: the pill says so, and
                       * its sentence would say it again.
                       */}
                      {isWaiting ? (
                        <></>
                      ) : (
                        <div
                          className="mt-1 text-sm text-gray-600"
                          data-testid="meraki-connection-sentence"
                        >
                          {drawMerakiTemplate(
                            translator,
                            getMerakiConnectionSentence(facts.connection, {
                              language: translator.language,
                            }),
                          )}
                        </div>
                      )}
                      {covered.length > 0 ? (
                        <div
                          className="mt-0.5 text-xs text-gray-500"
                          data-testid="meraki-connection-covered"
                        >
                          {covered.join(" · ")}
                        </div>
                      ) : (
                        <></>
                      )}
                      {facts.connection.status ===
                        NetworkControllerConnectionStatus.Failing &&
                      facts.connection.lastError ? (
                        <p
                          className="mt-1.5 break-words text-xs text-red-700"
                          data-testid="meraki-connection-error"
                        >
                          {facts.connection.lastError}
                        </p>
                      ) : (
                        <></>
                      )}
                      {notes.map((note: RowNote): ReactElement => {
                        return (
                          <div
                            key={note.text}
                            className={`mt-1.5 flex items-start gap-1.5 text-xs ${
                              note.isToActOn
                                ? "text-amber-800"
                                : "text-gray-500"
                            }`}
                            data-testid="meraki-connection-note"
                            data-tone={note.isToActOn ? "act" : "info"}
                          >
                            <Icon
                              icon={IconProp.Info}
                              className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
                                note.isToActOn
                                  ? "text-amber-600"
                                  : "text-gray-400"
                              }`}
                            />
                            <span>{note.text}</span>
                          </div>
                        );
                      })}
                      {deviceAdd}
                    </div>
                    <div
                      className={`flex flex-shrink-0 items-center gap-2 sm:justify-end ${ROW_BUTTONS_CLASS_NAME}`}
                    >
                      {primary}
                      {menuItems.length > 0 ? (
                        <MoreMenu
                          menuIcon={IconProp.EllipsisHorizontal}
                          text=""
                          ariaLabel={translator.translateTemplate(
                            "More actions for {{name}}",
                            { name: facts.connection.name },
                          )}
                          isAriaLabelTranslated={true}
                          elementToBeShownInsteadOfButton={
                            <button
                              type="button"
                              aria-label={translator.translateTemplate(
                                "More actions for {{name}}",
                                { name: facts.connection.name },
                              )}
                              data-testid="meraki-connection-more"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                            >
                              <Icon
                                icon={IconProp.EllipsisHorizontal}
                                className="h-5 w-5"
                              />
                            </button>
                          }
                        >
                          {menuItems}
                        </MoreMenu>
                      ) : (
                        <></>
                      )}
                    </div>
                  </li>
                );
              },
            )}
          </ul>
          {!canUpdate && updateGate.disabledReason ? (
            <div
              className="mt-2 flex items-start gap-2 border-t border-gray-100 pt-3 text-sm text-gray-600"
              data-testid="meraki-connections-locked"
            >
              <Icon
                icon={IconProp.Lock}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
              />
              <span>{updateGate.disabledReason}</span>
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {editing ? (
        <MerakiConnectionEditModal
          connection={editing.model}
          focusKey={editing.focusKey}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            watchNextRead(editing.model);
            setEditing(null);
            setNotice(
              translator.translateText(
                "Saved. The connection is read again within a minute.",
              ) || "",
            );
            setReloadKey((value: number): number => {
              return value + 1;
            });
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}

      {addingDevicesOf ? (
        <MerakiAddDevicesModal
          connection={addingDevicesOf}
          onClose={() => {
            setAddingDevicesOf(null);
          }}
          onAsked={(state: NetworkControllerDeviceAddState | undefined) => {
            const asked: NetworkControllerConnection = addingDevicesOf;
            setAddingDevicesOf(null);

            /*
             * The row says "Adding devices" at once, and follows the ask
             * from there (the watch above).
             */
            if (state) {
              setConnections(
                (
                  current: Array<NetworkControllerConnection>,
                ): Array<NetworkControllerConnection> => {
                  return current.map(
                    (
                      connection: NetworkControllerConnection,
                    ): NetworkControllerConnection => {
                      if (connection.id?.toString() === asked.id?.toString()) {
                        connection.lastDeviceAdd =
                          toNetworkControllerDeviceAddStateJson(state);
                      }

                      return connection;
                    },
                  );
                },
              );
            } else {
              setReloadKey((value: number): number => {
                return value + 1;
              });
            }
          }}
        />
      ) : (
        <></>
      )}

      {deleting ? (
        <ConfirmModal
          title="Delete this connection?"
          description={translator.translateTemplate(
            "OneUptime stops reading {{name}}. The traffic it read stays on the Traffic pages until it is 30 days old.",
            { name: deleting.name || "" },
          )}
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            remove().catch(() => {
              // handled inside.
            });
          }}
          onClose={() => {
            setDeleting(null);
          }}
          isLoading={isDeleting}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default MerakiConnectionsCard;
