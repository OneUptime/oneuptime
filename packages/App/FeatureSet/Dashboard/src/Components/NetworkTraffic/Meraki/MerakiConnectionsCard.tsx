import { readNetworkControllerConnectionNow } from "../NetworkTrafficUsageApi";
import MerakiConnectionEditModal from "./MerakiConnectionEditModal";
import { MERAKI_CONNECTIONS_ANCHOR } from "./MerakiUrlState";
import {
  ANALYSIS_OFF_NOTE,
  ANALYTICS_WAITING_NOTE,
  API_CALL_COUNT,
  APPLIANCE_COUNT,
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
} from "./MerakiWords";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { DEFAULT_MERAKI_REGION } from "Common/Types/NetworkController/MerakiRegion";
import { NetworkControllerConnectionStatus } from "Common/Types/NetworkController/NetworkControllerConnectionHealth";
import ObjectID from "Common/Types/ObjectID";
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
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
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
 * Its menu has Edit, Turn off (or on) and Delete. A read started here (or a
 * connection waiting for its first) is watched, and the list and the page
 * refresh by themselves when it ends. Connecting another organization is
 * the header's button.
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
  const [notice, setNotice] = useState<string>("");
  // First reads watched: once each, ended or not.
  const firstReadsWatched: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

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
        <Icon
          icon={IconProp.Cloud}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
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
    <div id={MERAKI_CONNECTIONS_ANCHOR} className="scroll-mt-4">
      <Card
        title="Meraki"
        description="The Meraki organizations OneUptime reads traffic from, through the Meraki dashboard API."
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
                              note.isToActOn ? "text-amber-800" : "text-gray-500"
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
