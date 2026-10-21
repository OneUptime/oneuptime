import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
  getCloudConnectionReadIntervalInMinutes,
  READ_INTERVAL_FIELD_KEY,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionReadSummary,
  readCloudConnectionReadSummary,
} from "Common/Types/CloudConnection/CloudConnectionTest";
import OneUptimeDate from "Common/Types/Date";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import AppLink from "../../AppLink/AppLink";
import {
  READ_NOW_GIVE_UP_MS,
  READ_NOW_POLL_MS,
  cloudConnectionDocsUrl,
  getLastReadKey,
  hasCloudConnectionReadEnded,
  readCloudConnectionNow,
} from "./CloudConnectApi";
import CloudConnectionLogo from "./CloudConnectionLogo";
import CloudConnectionTestDialog from "./CloudConnectionTestDialog";
import {
  CloudConnectionHealth,
  CloudWords,
  LAST_READ_AT,
  MORE_COUNT,
  NOT_READ_YET,
  READING_NOW,
  doesNameSayCloud,
  drawCloudTemplate,
  getAccountsNotInName,
  getCloudConnectionHealth,
  getCloudReadFailureWords,
  getCloudReadIntervalWords,
  getCloudRegionNames,
  getResourceCountWords,
} from "./CloudConnectionWords";

/*
 * The project's cloud connections, a row each, in three columns: the
 * account (its cloud and what it reads); how it is doing, when it was last
 * read and how often it is; and what its last read found - how many
 * resources, a way to them, and where. Kept to what fits beside the side
 * menu at 1280px in every language: what a read found by service is the
 * test's to say, and All Resources lists the resources themselves.
 *
 * What can be done with a connection: read it now (the row then says it
 * is reading, and the list catches up by itself when the read ends), test
 * it, see why it failed, turn it off or on, edit or remove it. A
 * connection waiting for its first read is watched the same way, quietly:
 * its row shows what the read found once it ends. Create and
 * edit go through CloudConnectionFormModal (opened by the page): its
 * fields depend on the cloud and its secrets are write-only, which
 * ModelTable's own form cannot express.
 */

export interface ComponentProps {
  refreshToggle: string;
  updateGate: PermissionGateResult;
  // Where the resources are listed: Cloud > All Resources.
  resourcesRoute: Route;
  onEdit: (connection: CloudConnection) => void;
  // Each time the list loads: how many connections it found.
  onConnectionsLoaded: (totalCount: number) => void;
}

// A read started from the list: when the connection was last read before it.
interface ReadInProgress {
  before: string;
  startedAt: number;
  /*
   * A first read the list watches on its own: the row says nothing more
   * than "Waiting for the first read" until it ends. A read someone started
   * (Read now) says "Reading now..." and locks Read now.
   */
  isQuiet: boolean;
}

const CloudConnectionsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [testItem, setTestItem] = useState<CloudConnection | null>(null);
  const [testRun, setTestRun] = useState<number>(0);
  const [errorItem, setErrorItem] = useState<CloudConnection | null>(null);
  const [notice, setNotice] = useState<
    { type: AlertType; text: string } | undefined
  >(undefined);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  // The reads watched that have not ended yet, by connection id.
  const [reading, setReading] = useState<Record<string, ReadInProgress>>({});
  // Connections whose first read was watched: once is enough, ended or not.
  const firstReadsWatched: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  const refresh: () => void = (): void => {
    setRefreshCounter((value: number): number => {
      return value + 1;
    });
  };

  /*
   * While a read started here runs, ask now and then whether it has ended,
   * and load the list again once one has: the row then says how it went.
   * Asked of the one connection, so the list itself does not flicker.
   */
  useEffect(() => {
    const ids: Array<string> = Object.keys(reading);

    if (ids.length === 0) {
      return;
    }

    let isCurrent: boolean = true;

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void (async (): Promise<void> => {
        const ended: Array<string> = [];

        for (const id of ids) {
          const read: ReadInProgress | undefined = reading[id];

          if (!read || Date.now() - read.startedAt > READ_NOW_GIVE_UP_MS) {
            ended.push(id);
            continue;
          }

          try {
            if (
              await hasCloudConnectionReadEnded({
                connectionId: new ObjectID(id),
                before: read.before,
              })
            ) {
              ended.push(id);
            }
          } catch {
            // Asked again at the next tick.
          }
        }

        if (!isCurrent || ended.length === 0) {
          return;
        }

        setReading(
          (
            current: Record<string, ReadInProgress>,
          ): Record<string, ReadInProgress> => {
            const next: Record<string, ReadInProgress> = { ...current };

            for (const id of ended) {
              delete next[id];
            }

            return next;
          },
        );
        refresh();
      })();
    }, READ_NOW_POLL_MS);

    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [reading]);

  // A read someone started from the list, not yet ended.
  const isReading: (item: CloudConnection) => boolean = (
    item: CloudConnection,
  ): boolean => {
    const read: ReadInProgress | undefined = item.id
      ? reading[item.id.toString()]
      : undefined;

    return Boolean(read && !read.isQuiet);
  };

  /*
   * Each load: a connection waiting for its first read - one just
   * connected - is watched quietly, once, so its row shows the read as soon
   * as it ends.
   */
  const watchFirstReads: (connections: Array<CloudConnection>) => void = (
    connections: Array<CloudConnection>,
  ): void => {
    const waiting: Array<CloudConnection> = connections.filter(
      (item: CloudConnection): boolean => {
        return (
          Boolean(item.id) &&
          !firstReadsWatched.current.has(item.id!.toString()) &&
          getCloudConnectionHealth(item).key === "waiting"
        );
      },
    );

    if (waiting.length === 0) {
      return;
    }

    for (const item of waiting) {
      firstReadsWatched.current.add(item.id!.toString());
    }

    setReading(
      (
        current: Record<string, ReadInProgress>,
      ): Record<string, ReadInProgress> => {
        const next: Record<string, ReadInProgress> = { ...current };

        for (const item of waiting) {
          const id: string = item.id!.toString();

          if (!next[id]) {
            next[id] = {
              before: getLastReadKey(item.lastPulledAt),
              startedAt: Date.now(),
              isQuiet: true,
            };
          }
        }

        return next;
      },
    );
  };

  const setEnabled: (
    item: CloudConnection,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
  ) => Promise<void> = async (
    item: CloudConnection,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById<CloudConnection>({
        modelType: CloudConnection,
        id: item.id!,
        data: { isEnabled },
      });
      setNotice(undefined);
      refresh();
    } catch (err) {
      setNotice({
        type: AlertType.DANGER,
        text: API.getFriendlyErrorMessage(err as Error),
      });
    }
    onCompleteAction();
  };

  /*
   * Why a read failed, in the words a test uses for the same failure - what
   * went wrong and what to do - with the cloud's own answer under them, and
   * the cloud's step-by-step guide.
   */
  const renderLastError: (item: CloudConnection) => ReactElement = (
    item: CloudConnection,
  ): ReactElement => {
    const definition: CloudConnectionDefinition | undefined =
      getCloudConnectionDefinition(item.provider);
    const words: CloudWords | undefined = getCloudReadFailureWords(item);

    return (
      <div className="space-y-4">
        {words ? (
          <div data-testid="cloud-connection-error-words">
            <div className="flex items-start gap-2 text-sm font-medium text-red-800">
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-shrink-0"
              />
              <span>{translator.translateText(words.headline)}</span>
            </div>
            {words.advice ? (
              <div className="mt-1 pl-6 text-sm text-gray-700">
                {translator.translateText(words.advice)}
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        <div>
          <div className="text-xs font-medium text-gray-500">
            {translator.translateText("Details")}
          </div>
          <pre
            aria-label={translator.translateText("Full error message")}
            tabIndex={0}
            className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm text-gray-800"
            data-testid="cloud-connection-error"
          >
            {item.lastError}
          </pre>
        </div>

        {definition ? (
          <a
            href={cloudConnectionDocsUrl(definition.docsPath).toString()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <Icon icon={IconProp.Book} className="h-4 w-4" />
            <span>{translator.translateText("Step-by-step guide")}</span>
          </a>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Fragment>
      <div className="space-y-6">
        {notice ? (
          <Alert
            type={notice.type}
            title={notice.text}
            dataTestId="cloud-connections-notice"
            onClose={() => {
              setNotice(undefined);
            }}
          />
        ) : (
          <></>
        )}

        <ModelTable<CloudConnection>
          modelType={CloudConnection}
          refreshToggle={`${props.refreshToggle}-${refreshCounter}`}
          id="cloud-connections-table"
          name="Cloud > Connect > Connected accounts"
          userPreferencesKey="cloud-connections-table"
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          selectMoreFields={{
            provider: true,
            config: true,
            isEnabled: true,
            lastPulledAt: true,
            lastSuccessfulPullAt: true,
            lastPullResult: true,
            lastError: true,
          }}
          onFetchSuccess={(
            data: Array<CloudConnection>,
            totalCount: number,
          ) => {
            props.onConnectionsLoaded(totalCount);
            watchFirstReads(data);
          }}
          isDeleteable={true}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          sortBy="name"
          sortOrder={SortOrder.Ascending}
          showRefreshButton={true}
          cardProps={{
            title: "Connected accounts",
            description:
              "Each is read on a schedule: its resources appear under All Resources, with their key metrics.",
          }}
          noItemsMessage="No cloud account connected yet. Pick one above."
          filters={[
            {
              field: { name: true },
              type: FieldType.Text,
              title: "Name",
            },
          ]}
          actionButtons={[
            /*
             * The row's button: View error while it is not working, else
             * Read now - kept there, locked, while a read it started runs,
             * rather than handing its place to the next action.
             */
            {
              title: "View error",
              buttonStyleType: ButtonStyleType.OUTLINE,
              icon: IconProp.Error,
              placement: ActionButtonPlacement.Primary,
              isVisible: (item: CloudConnection): boolean => {
                return getCloudConnectionHealth(item).key === "failing";
              },
              onClick: (
                item: CloudConnection,
                onCompleteAction: VoidFunction,
              ): void => {
                setErrorItem(item);
                onCompleteAction();
              },
            },
            {
              title: "Read now",
              icon: IconProp.Refresh,
              buttonStyleType: ButtonStyleType.OUTLINE,
              placement: ActionButtonPlacement.Primary,
              isVisible: (item: CloudConnection): boolean => {
                return item.isEnabled !== false;
              },
              /*
               * Not again while the row says it is reading - locked where it
               * is, so the next button does not slide under the finger.
               */
              getDisabledReason: (
                item: CloudConnection,
              ): string | undefined => {
                return isReading(item) ? READING_NOW : undefined;
              },
              disabled: !props.updateGate.isAllowed,
              tooltip: props.updateGate.isAllowed
                ? "Read it now instead of at its next scheduled read."
                : props.updateGate.disabledReason,
              onClick: async (
                item: CloudConnection,
                onCompleteAction: VoidFunction,
              ): Promise<void> => {
                try {
                  await readCloudConnectionNow(item.id!);
                  setNotice(undefined);
                  // The row says it is reading until the read ends.
                  setReading(
                    (
                      current: Record<string, ReadInProgress>,
                    ): Record<string, ReadInProgress> => {
                      return {
                        ...current,
                        [item.id!.toString()]: {
                          before: getLastReadKey(item.lastPulledAt),
                          startedAt: Date.now(),
                          isQuiet: false,
                        },
                      };
                    },
                  );
                } catch (err) {
                  setNotice({
                    type: AlertType.DANGER,
                    text: API.getFriendlyErrorMessage(err as Error),
                  });
                }
                onCompleteAction();
              },
            },
            /*
             * Before Test: the first action a row shows is its button, and a
             * connection that is off is turned on before anything else.
             */
            {
              title: "Turn on",
              icon: IconProp.Play,
              buttonStyleType: ButtonStyleType.OUTLINE,
              isVisible: (item: CloudConnection): boolean => {
                return item.isEnabled === false;
              },
              disabled: !props.updateGate.isAllowed,
              tooltip: props.updateGate.isAllowed
                ? "Read it again"
                : props.updateGate.disabledReason,
              onClick: (
                item: CloudConnection,
                onCompleteAction: VoidFunction,
              ): Promise<void> => {
                return setEnabled(item, true, onCompleteAction);
              },
            },
            {
              title: "Test",
              icon: IconProp.Play,
              buttonStyleType: ButtonStyleType.OUTLINE,
              disabled: !props.updateGate.isAllowed,
              tooltip: props.updateGate.isAllowed
                ? "Check its saved settings with a small read. Nothing is imported."
                : props.updateGate.disabledReason,
              onClick: (
                item: CloudConnection,
                onCompleteAction: VoidFunction,
              ): void => {
                setTestRun((value: number): number => {
                  return value + 1;
                });
                setTestItem(item);
                onCompleteAction();
              },
            },
            {
              title: "Turn off",
              icon: IconProp.Stop,
              buttonStyleType: ButtonStyleType.OUTLINE,
              isVisible: (item: CloudConnection): boolean => {
                return item.isEnabled !== false;
              },
              disabled: !props.updateGate.isAllowed,
              tooltip: props.updateGate.isAllowed
                ? "Stop reading it. What it brought in stays."
                : props.updateGate.disabledReason,
              onClick: (
                item: CloudConnection,
                onCompleteAction: VoidFunction,
              ): Promise<void> => {
                return setEnabled(item, false, onCompleteAction);
              },
            },
            {
              title: "Edit",
              icon: IconProp.Edit,
              buttonStyleType: ButtonStyleType.OUTLINE,
              disabled: !props.updateGate.isAllowed,
              tooltip: props.updateGate.isAllowed
                ? "Change its settings. Credentials stay unless you enter new ones."
                : props.updateGate.disabledReason,
              onClick: (
                item: CloudConnection,
                onCompleteAction: VoidFunction,
              ): void => {
                props.onEdit(item);
                onCompleteAction();
              },
            },
          ]}
          columns={[
            {
              field: { name: true },
              title: "Account",
              type: FieldType.Element,
              getElement: (item: CloudConnection): ReactElement => {
                const definition: CloudConnectionDefinition | undefined =
                  getCloudConnectionDefinition(item.provider);
                const summary: CloudConnectionReadSummary | undefined =
                  readCloudConnectionReadSummary(item.lastPullResult);
                /*
                 * Under the name, one quiet line: its cloud, then what it
                 * reads - each only when the name does not say it already
                 * ("Microsoft Azure", "AWS 123456789012").
                 */
                const accounts: Array<string> = getAccountsNotInName({
                  name: item.name,
                  accounts: summary?.accounts || [],
                });
                const cloudTitle: string = definition
                  ? translator.translateText(definition.title) ||
                    definition.title
                  : item.provider || "";
                const cloud: string | undefined =
                  definition &&
                  doesNameSayCloud({
                    name: item.name,
                    cloudTitle: definition.title,
                  })
                    ? undefined
                    : cloudTitle;
                const subtitle: string = [cloud, accounts.join(", ")]
                  .filter((part: string | undefined): boolean => {
                    return Boolean(part);
                  })
                  .join(" · ");

                return (
                  <div className="flex items-center gap-3">
                    <CloudConnectionLogo provider={item.provider} size="md" />
                    {/* A long name or account list is cut, not the table widened. */}
                    <div className="min-w-0 max-w-[15rem]">
                      <div
                        className="truncate text-sm font-medium text-gray-900"
                        title={item.name || ""}
                      >
                        {item.name}
                      </div>
                      {subtitle ? (
                        <div
                          className="truncate text-xs text-gray-500"
                          title={subtitle}
                          data-testid="cloud-connection-subtitle"
                        >
                          {cloud || ""}
                          {accounts.length > 0 ? (
                            <span data-testid="cloud-connection-accounts">
                              {cloud ? " · " : ""}
                              {accounts.join(", ")}
                            </span>
                          ) : (
                            <></>
                          )}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                );
              },
            },
            /*
             * How it is doing, then when it was last read and how often it
             * is: one column, so the row fits beside the side menu.
             */
            {
              field: { lastError: true },
              title: "Status",
              type: FieldType.Element,
              getElement: (item: CloudConnection): ReactElement => {
                const health: CloudConnectionHealth =
                  getCloudConnectionHealth(item);
                const definition: CloudConnectionDefinition | undefined =
                  getCloudConnectionDefinition(item.provider);

                let lastRead: ReactElement = <></>;

                if (isReading(item)) {
                  lastRead = (
                    <div
                      className="flex items-center gap-1.5 text-xs text-gray-700"
                      data-testid="cloud-connection-reading"
                    >
                      <Icon
                        icon={IconProp.Spinner}
                        className="h-3 w-3 flex-shrink-0 animate-spin text-gray-400"
                      />
                      <span>{translator.translateText(READING_NOW)}</span>
                    </div>
                  );
                } else if (item.lastSuccessfulPullAt) {
                  lastRead = (
                    <div
                      className="text-xs text-gray-500"
                      data-testid="cloud-connection-last-read"
                      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        item.lastSuccessfulPullAt,
                      )}
                    >
                      {translator.translateTemplate(LAST_READ_AT, {
                        time: OneUptimeDate.getDateAsLocalShortDateTimeString(
                          item.lastSuccessfulPullAt,
                        ),
                      })}
                    </div>
                  );
                } else if (health.key !== "waiting") {
                  // Waiting says it already.
                  lastRead = (
                    <div
                      className="text-xs text-gray-500"
                      data-testid="cloud-connection-last-read"
                    >
                      {translator.translateText(NOT_READ_YET)}
                    </div>
                  );
                }

                return (
                  <div className="min-w-0 space-y-1">
                    <Pill
                      color={health.color}
                      text={health.label}
                      tooltip={
                        health.tooltipIsError
                          ? health.tooltip
                          : translator.translateText(health.tooltip)
                      }
                    />
                    {lastRead}
                    {/* How often it is read - not while it is turned off. */}
                    {definition && item.isEnabled !== false ? (
                      <div
                        className="text-xs text-gray-500"
                        data-testid="cloud-connection-read-interval"
                      >
                        {drawCloudTemplate(
                          translator,
                          getCloudReadIntervalWords(
                            getCloudConnectionReadIntervalInMinutes(
                              definition,
                              item.config?.[READ_INTERVAL_FIELD_KEY],
                            ),
                          ),
                        )}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              field: { lastPullResult: true },
              title: "Resources",
              type: FieldType.Element,
              // Two short lines: a phone's card has room for them too.
              getElement: (item: CloudConnection): ReactElement => {
                const summary: CloudConnectionReadSummary | undefined =
                  readCloudConnectionReadSummary(item.lastPullResult);

                if (!summary || summary.resourceCount === 0) {
                  return (
                    <span className="text-sm text-gray-500">
                      {translator.translateText("None yet")}
                    </span>
                  );
                }

                const regions: { names: Array<string>; more: number } =
                  getCloudRegionNames(summary.regions);

                // How many, as the way to them; where, under it.
                return (
                  <div className="min-w-0">
                    <AppLink
                      to={props.resourcesRoute}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      <span data-testid="cloud-connection-resource-count">
                        {drawCloudTemplate(
                          translator,
                          getResourceCountWords(summary.resourceCount),
                        )}
                      </span>
                    </AppLink>
                    {regions.names.length > 0 ? (
                      <div
                        className="text-xs text-gray-500"
                        data-testid="cloud-connection-regions"
                      >
                        {regions.names.join(", ")}
                        {regions.more > 0
                          ? ` ${translator.translatePlural(MORE_COUNT, regions.more)}`
                          : ""}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      </div>

      {testItem && (
        <CloudConnectionTestDialog
          key={`${testItem.id?.toString()}-${testRun}`}
          connection={testItem}
          onClose={(): void => {
            setTestItem(null);
          }}
        />
      )}

      {errorItem && (
        <Modal
          title="Last error"
          description={translator.translateTemplate(
            "Why the last read of {{name}} failed. Credentials are removed from it.",
            { name: errorItem.name || "" },
          )}
          modalWidth={ModalWidth.Medium}
          closeButtonText="Close"
          onClose={(): void => {
            setErrorItem(null);
          }}
          leftFooterElement={
            <CopyTextButton
              textToBeCopied={errorItem.lastError || ""}
              label="Copy error"
              size="md"
              variant="soft"
            />
          }
        >
          {renderLastError(errorItem)}
        </Modal>
      )}
    </Fragment>
  );
};

export default CloudConnectionsTable;
