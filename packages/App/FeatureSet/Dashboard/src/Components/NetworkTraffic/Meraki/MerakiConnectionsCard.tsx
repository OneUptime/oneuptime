import { readNetworkControllerConnectionNow } from "../NetworkTrafficUsageApi";
import MerakiConnectionEditModal from "./MerakiConnectionEditModal";
import {
  ANALYSIS_OFF_NOTE,
  ANALYTICS_WAITING_NOTE,
  API_CALL_COUNT,
  APPLIANCE_COUNT,
  MERAKI_STATUS_WORDS,
  MERAKI_TONE_DOT,
  MerakiConnectionRowFacts,
  MerakiStatusWords,
  NETWORK_COUNT,
  RATE_LIMITED_NOTE,
  READING_NOW,
  drawMerakiTemplate,
  getMerakiConnectionRowFacts,
  getMerakiConnectionSentence,
  getMerakiIntervalWords,
} from "./MerakiWords";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
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
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
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
 * Traffic page: each organization with how it is doing (the same words as
 * the line over its traffic), how often it is read, what its last read
 * covered - networks, appliances, the API calls it took - and what it
 * could not do, in so many words.
 *
 * What can be done with one: read it now (the row then says it is
 * reading, and the page refreshes by itself when the read ends), edit it,
 * turn it off or on, or delete it. A connection waiting for its first read
 * is watched the same way, quietly, so the page fills in by itself after
 * connecting. Connecting another organization is the header's button.
 */

export interface ComponentProps {
  // Bumped by the page to load the list again.
  refreshKey: number;
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

const LIST_LIMIT: number = 100;

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
  const [editing, setEditing] = useState<NetworkControllerConnection | null>(
    null,
  );
  const [deleting, setDeleting] = useState<NetworkControllerConnection | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [notice, setNotice] = useState<string>("");
  // First reads watched: once each, ended or not.
  const firstReadsWatched: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

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

    try {
      await ModelAPI.updateById<NetworkControllerConnection>({
        modelType: NetworkControllerConnection,
        id: connection.id,
        data: { isEnabled },
      });

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

  if (!isLoaded || (connections.length === 0 && !error)) {
    return <></>;
  }

  const now: Date = new Date();

  return (
    <div id="traffic-meraki-connections">
      <Card
        title="Meraki"
        description="The Meraki organizations OneUptime reads traffic from, through the Meraki dashboard API."
        rightElement={
          <Button
            title="Connect Meraki"
            icon={IconProp.Add}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={props.onConnect}
            dataTestId="meraki-connect-another"
          />
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
              (model: NetworkControllerConnection): ReactElement => {
                const facts: MerakiConnectionRowFacts =
                  getMerakiConnectionRowFacts(model, now);
                const id: string = facts.connection.id;
                const watched: WatchedRead | undefined = watching[id];
                const isReading: boolean = Boolean(watched && !watched.isQuiet);
                const words: MerakiStatusWords =
                  MERAKI_STATUS_WORDS[facts.connection.status];
                const isOff: boolean =
                  facts.connection.status ===
                  NetworkControllerConnectionStatus.Off;
                const summary: MerakiConnectionRowFacts["summary"] =
                  facts.summary;
                const covered: Array<string> = summary
                  ? [
                      translator.translatePlural(
                        NETWORK_COUNT,
                        summary.networkCount,
                      ),
                      translator.translatePlural(
                        APPLIANCE_COUNT,
                        summary.applianceCount,
                      ),
                      ...(summary.requestCount > 0
                        ? [
                            translator.translatePlural(
                              API_CALL_COUNT,
                              summary.requestCount,
                            ),
                          ]
                        : []),
                    ]
                  : [];
                const notes: Array<string> = [];

                if (summary && summary.trafficAnalysisOffNetworks > 0) {
                  notes.push(
                    translator.translatePlural(
                      ANALYSIS_OFF_NOTE,
                      summary.trafficAnalysisOffNetworks,
                    ),
                  );
                }

                if (summary && summary.analyticsNetworksWaiting > 0) {
                  notes.push(
                    translator.translatePlural(
                      ANALYTICS_WAITING_NOTE,
                      summary.analyticsNetworksWaiting,
                    ),
                  );
                }

                if (summary?.wasRateLimited) {
                  notes.push(
                    translator.translateText(RATE_LIMITED_NOTE) ||
                      RATE_LIMITED_NOTE,
                  );
                }

                return (
                  <li
                    key={id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                    data-testid="meraki-connection"
                    data-status={facts.connection.status}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${MERAKI_TONE_DOT[words.tone]}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-sm font-medium text-gray-900">
                            {facts.connection.name}
                          </span>
                          <span
                            className="rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200"
                            data-testid="meraki-connection-status"
                          >
                            {translator.translateText(
                              isReading ? READING_NOW : words.label,
                            )}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {[
                            facts.connection.organizationName,
                            `${translator.translateText(facts.regionName) || facts.regionName} (${facts.regionHost})`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        <div className="mt-1 text-sm text-gray-600">
                          {drawMerakiTemplate(
                            translator,
                            getMerakiConnectionSentence(facts.connection),
                          )}{" "}
                          <span className="text-gray-500">
                            {drawMerakiTemplate(
                              translator,
                              getMerakiIntervalWords(
                                facts.connection.readIntervalInMinutes,
                              ),
                            )}
                          </span>
                        </div>
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
                        {notes.map((note: string): ReactElement => {
                          return (
                            <p
                              key={note}
                              className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-800"
                              data-testid="meraki-connection-note"
                            >
                              <Icon
                                icon={IconProp.Info}
                                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600"
                              />
                              <span>{note}</span>
                            </p>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2 sm:justify-end">
                      <Button
                        title={isReading ? READING_NOW : "Read now"}
                        icon={IconProp.Refresh}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.NORMAL}
                        disabled={isReading || isOff}
                        onClick={() => {
                          readNow(model).catch(() => {
                            // handled inside.
                          });
                        }}
                        dataTestId="meraki-connection-read-now"
                      />
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
                        {[
                          <MoreMenuItem
                            key="edit"
                            text="Edit"
                            icon={IconProp.Edit}
                            onClick={() => {
                              setEditing(model);
                            }}
                          />,
                          <MoreMenuItem
                            key="toggle"
                            text={isOff ? "Turn on" : "Turn off"}
                            icon={isOff ? IconProp.Play : IconProp.Stop}
                            onClick={() => {
                              setEnabled(model, isOff).catch(() => {
                                // handled inside.
                              });
                            }}
                          />,
                          <MoreMenuItem
                            key="delete"
                            text="Delete"
                            icon={IconProp.Trash}
                            isDestructive={true}
                            onClick={() => {
                              setDeleting(model);
                            }}
                          />,
                        ]}
                      </MoreMenu>
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        </div>
      </Card>

      {editing ? (
        <MerakiConnectionEditModal
          connection={editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
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
