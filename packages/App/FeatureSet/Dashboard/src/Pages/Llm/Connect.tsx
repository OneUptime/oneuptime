import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import LlmAppsPath from "../../Components/AI/Connect/LlmAppsPath";
import LlmConnectionFormModal from "../../Components/AI/Connect/LlmConnectionFormModal";
import { getLlmConnectionHealth } from "../../Components/AI/Connect/LlmConnectionHealth";
import LlmConnectionTiles from "../../Components/AI/Connect/LlmConnectionTiles";
import LlmConnectionsTable from "../../Components/AI/Connect/LlmConnectionsTable";
import LlmConnectWayPicker, {
  getLlmConnectWayPanelId,
  getLlmConnectWayTabId,
  llmConnectWayChoice,
} from "../../Components/AI/Connect/LlmConnectWayPicker";
import {
  LLM_CONNECT_WAY_QUERY_PARAM,
  LlmConnectWayKey,
  LlmConnectWayStatus,
  readLlmConnectWay,
} from "../../Components/AI/Connect/LlmConnectWays";
import LlmOtherAiTools from "../../Components/AI/Connect/LlmOtherAiTools";
import LlmTellYourPeopleNote from "../../Components/AI/Connect/LlmTellYourPeopleNote";
import Span from "Common/Models/AnalyticsModels/Span";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  LlmConnectionKind,
  isCompanyToolProvider,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import AnalyticsListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
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

/*
 * AI / LLM > Connect: the three ways AI comes into OneUptime, picked at the
 * top, one shown at a time with its shortest path.
 *
 *   Your apps                 the AI calls your own code makes, sent with
 *                             OpenTelemetry (snippets, a key, a gateway);
 *   Your AI provider accounts what an OpenAI, Anthropic, Azure, Bedrock or
 *                             Vertex AI account used and cost - a key, no
 *                             code;
 *   Your company's AI tools   what your people ask Claude Enterprise or
 *                             Microsoft 365 Copilot, by person, readable by
 *                             owners and admins unless you say otherwise.
 *
 * Each way ticks itself from what is true in the project (AI calls in the
 * last week, connections and whether they work), and once one is working
 * the page suggests the next step: a daily budget.
 *
 * Replaces Setup, whose snippets live on under "Your apps".
 */

// The facts read when the page opens; undefined is "not known yet".
export interface LlmConnectFacts {
  hasAiCalls: boolean | undefined;
  hasBudget: boolean | undefined;
}

/*
 * The project's connections, with what their health is read from;
 * undefined when the read fails.
 */
async function readLlmConnections(
  projectId: ObjectID,
): Promise<Array<LlmObservabilityConnection> | undefined> {
  try {
    const result: ListResult<LlmObservabilityConnection> =
      await ModelAPI.getList<LlmObservabilityConnection>({
        modelType: LlmObservabilityConnection,
        query: { projectId },
        select: {
          _id: true,
          provider: true,
          serviceId: true,
          isEnabled: true,
          lastPulledAt: true,
          lastSuccessfulPullAt: true,
          lastError: true,
        },
        limit: 100,
        skip: 0,
        sort: {},
      });

    return result.data;
  } catch {
    return undefined;
  }
}

const LlmConnectPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [way, setWay] = useState<LlmConnectWayKey>(() => {
    return readLlmConnectWay({
      fromAddress: Navigation.getQueryStringByName(LLM_CONNECT_WAY_QUERY_PARAM),
      remembered: llmConnectWayChoice.read(),
    });
  });
  const [formState, setFormState] = useState<
    | {
        provider: LlmConnectionProvider;
        connection?: LlmObservabilityConnection;
      }
    | undefined
  >(undefined);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  /*
   * The project's connections, every one of them (not a list's page): the
   * ways' ticks, the tiles' counts and whether a list shows come from them.
   * Read on opening, after a save, and again whenever a list reloads - a
   * connection deleted or turned off there is counted as such at once.
   */
  const [known, setKnown] = useState<
    Array<LlmObservabilityConnection> | undefined
  >(undefined);
  const [knownVersion, setKnownVersion] = useState<number>(0);
  // The lists that have shown a row: a list filtered to nothing stays.
  const [listsWithRows, setListsWithRows] = useState<
    Partial<Record<LlmConnectionKind, boolean>>
  >({});
  // The lists that have loaded once, so a later load is a change.
  const loadedLists: MutableRefObject<Set<LlmConnectionKind>> = useRef<
    Set<LlmConnectionKind>
  >(new Set<LlmConnectionKind>());
  const [facts, setFacts] = useState<LlmConnectFacts>({
    hasAiCalls: undefined,
    hasBudget: undefined,
  });
  // Set when a way is tapped: its path is then brought into view.
  const bringPanelIntoView: MutableRefObject<boolean> = useRef<boolean>(false);

  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  /*
   * Every write here goes through ModelAPI directly, which ModelTable's own
   * gating never sees, so the affordances are gated up front.
   */
  const createGate: PermissionGateResult = PermissionGate.check(
    new LlmObservabilityConnection(),
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    new LlmObservabilityConnection(),
    ModelAction.Update,
  );

  useEffect(() => {
    if (disableTelemetryForThisProject) {
      return;
    }

    let isCurrent: boolean = true;
    const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

    const loadFacts: () => Promise<void> = async (): Promise<void> => {
      const connections: Array<LlmObservabilityConnection> | undefined =
        await readLlmConnections(projectId);

      const toolServiceIds: Array<ObjectID> = (connections || [])
        .filter((connection: LlmObservabilityConnection): boolean => {
          return isCompanyToolProvider(connection.provider);
        })
        .map((connection: LlmObservabilityConnection): ObjectID | undefined => {
          return connection.serviceId;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

      const [hasAiCalls, hasBudget] = await Promise.all([
        (async (): Promise<boolean | undefined> => {
          try {
            // An app's AI call in the last week, a company tool's chats aside.
            const query: Query<Span> = {
              projectId,
              isLlmSpan: true,
              startTime: new InBetween(
                OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -7),
                OneUptimeDate.getCurrentDate(),
              ),
            };

            if (toolServiceIds.length > 0) {
              query.primaryEntityId = new IncludesNone(toolServiceIds) as never;
            }

            const result: AnalyticsListResult<Span> =
              await AnalyticsModelAPI.getList<Span>({
                modelType: Span,
                query,
                select: { spanId: true },
                limit: 1,
                skip: 0,
                sort: {},
              });

            return result.data.length > 0;
          } catch {
            return undefined;
          }
        })(),
        (async (): Promise<boolean | undefined> => {
          try {
            const count: number = await ModelAPI.count<LlmCostBudget>({
              modelType: LlmCostBudget,
              query: { projectId },
            });
            return count > 0;
          } catch {
            return undefined;
          }
        })(),
      ]);

      if (!isCurrent) {
        return;
      }

      setKnown(connections);
      setFacts({ hasAiCalls, hasBudget });
    };

    void loadFacts();

    return () => {
      isCurrent = false;
    };
  }, [refreshCounter, disableTelemetryForThisProject]);

  // A list reloaded after a change: read the connections again.
  useEffect(() => {
    if (knownVersion === 0 || disableTelemetryForThisProject) {
      return;
    }

    let isCurrent: boolean = true;

    void readLlmConnections(ProjectUtil.getCurrentProjectId()!).then(
      (connections: Array<LlmObservabilityConnection> | undefined) => {
        if (isCurrent && connections) {
          setKnown(connections);
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [knownVersion]);

  /*
   * On a phone the three ways fill the screen, so the path a tap opens
   * starts below it: it is scrolled into view. Where it already shows (a
   * desktop), nothing moves.
   */
  useEffect(() => {
    if (!bringPanelIntoView.current) {
      return;
    }

    bringPanelIntoView.current = false;

    const panel: HTMLElement | null = document.getElementById(
      getLlmConnectWayPanelId(way),
    );

    if (panel && panel.getBoundingClientRect().top > window.innerHeight - 160) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [way]);

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  const pickWay: (key: LlmConnectWayKey, withKeyboard: boolean) => void = (
    key: LlmConnectWayKey,
    withKeyboard: boolean,
  ): void => {
    bringPanelIntoView.current = !withKeyboard;
    setWay(key);
    llmConnectWayChoice.write(key);
    Navigation.setQueryString({ [LLM_CONNECT_WAY_QUERY_PARAM]: key });
  };

  const onConnectionsLoaded: (
    kind: LlmConnectionKind,
    totalCount: number,
  ) => void = (kind: LlmConnectionKind, totalCount: number): void => {
    if (totalCount > 0) {
      setListsWithRows(
        (
          previous: Partial<Record<LlmConnectionKind, boolean>>,
        ): Partial<Record<LlmConnectionKind, boolean>> => {
          return previous[kind] ? previous : { ...previous, [kind]: true };
        },
      );
    }

    if (loadedLists.current.has(kind)) {
      setKnownVersion((value: number): number => {
        return value + 1;
      });
    }

    loadedLists.current.add(kind);
  };

  // The project's connections of a kind; undefined until they are read.
  const connectionsOf: (
    kind: LlmConnectionKind,
  ) => Array<LlmObservabilityConnection> | undefined = (
    kind: LlmConnectionKind,
  ): Array<LlmObservabilityConnection> | undefined => {
    if (known === undefined) {
      return undefined;
    }

    return known.filter((connection: LlmObservabilityConnection): boolean => {
      return (
        Boolean(connection.provider) &&
        isCompanyToolProvider(connection.provider) ===
          (kind === LlmConnectionKind.CompanyTool)
      );
    });
  };

  const statusOf: (kind: LlmConnectionKind) => LlmConnectWayStatus = (
    kind: LlmConnectionKind,
  ): LlmConnectWayStatus => {
    const connections: Array<LlmObservabilityConnection> | undefined =
      connectionsOf(kind);

    if (connections === undefined) {
      return { isSetUp: undefined, connected: 0, failing: 0 };
    }

    return {
      isSetUp: connections.length > 0,
      connected: connections.length,
      failing: connections.filter(
        (connection: LlmObservabilityConnection): boolean => {
          return getLlmConnectionHealth(connection).key === "failing";
        },
      ).length,
    };
  };

  const statuses: Record<LlmConnectWayKey, LlmConnectWayStatus> = {
    apps: { isSetUp: facts.hasAiCalls, connected: 0, failing: 0 },
    providers: statusOf(LlmConnectionKind.ProviderAccount),
    tools: statusOf(LlmConnectionKind.CompanyTool),
  };

  const connectionCounts: Partial<Record<LlmConnectionProvider, number>> = {};

  for (const connection of known || []) {
    if (connection.provider) {
      connectionCounts[connection.provider] =
        (connectionCounts[connection.provider] || 0) + 1;
    }
  }

  /*
   * A list shows once there is something in it: until then the tiles
   * above it are the way in, and an empty table under them would only
   * repeat "nothing connected yet". Once it has shown a row it stays, so a
   * search that finds nothing can still be cleared.
   */
  const showsList: (kind: LlmConnectionKind) => boolean = (
    kind: LlmConnectionKind,
  ): boolean => {
    return (
      (connectionsOf(kind) || []).length > 0 || Boolean(listsWithRows[kind])
    );
  };

  /*
   * The next step once AI is coming in: a daily budget. Said only when
   * something is working and the project has no budget yet.
   */
  const suggestsBudget: boolean =
    facts.hasBudget === false &&
    (statuses.apps.isSetUp === true ||
      statuses.providers.isSetUp === true ||
      statuses.tools.isSetUp === true);

  const budgetsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.LLM_BUDGETS] as Route,
  );

  /*
   * A way's path: every one stays mounted (its list keeps loading, its
   * snippet tab stays picked), and only the picked one shows.
   */
  const panelProps: (key: LlmConnectWayKey) => {
    id: string;
    role: string;
    "aria-labelledby": string;
    hidden: boolean;
    className: string;
    "data-testid": string;
  } = (key: LlmConnectWayKey) => {
    return {
      id: getLlmConnectWayPanelId(key),
      role: "tabpanel",
      "aria-labelledby": getLlmConnectWayTabId(key),
      hidden: way !== key,
      className: "scroll-mt-4",
      "data-testid": getLlmConnectWayPanelId(key),
    };
  };

  /*
   * Who may not connect is told so under the tiles, in words: a disabled
   * tile's tooltip never shows on a phone.
   */
  const lockedNote: ReactElement =
    !createGate.isAllowed && createGate.disabledReason ? (
      <div
        className="mt-4 flex items-start gap-2 text-sm text-gray-600"
        data-testid="llm-connect-locked"
      >
        <Icon
          icon={IconProp.Lock}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span>{createGate.disabledReason}</span>
      </div>
    ) : (
      <></>
    );

  const editConnection: (connection: LlmObservabilityConnection) => void = (
    connection: LlmObservabilityConnection,
  ): void => {
    if (connection.provider) {
      setFormState({ provider: connection.provider, connection });
    }
  };

  return (
    <Fragment>
      <div className="space-y-6" data-testid="llm-connect-page">
        <Card
          title="Connect AI to OneUptime"
          description="Three ways to bring AI in. Use one, two or all three: everything lands in the same Conversations, Usage, Alerts and Budgets."
        >
          <div>
            <LlmConnectWayPicker
              value={way}
              statuses={statuses}
              onChange={pickWay}
            />

            {suggestsBudget ? (
              <div
                className="mt-4 flex flex-col gap-3 rounded-lg bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="llm-connect-budget-hint"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Icon
                    icon={IconProp.CurrencyDollar}
                    className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                      {translator.translateText("Set a daily budget")}
                    </div>
                    <div className="text-sm text-gray-600">
                      {translator.translateText(
                        "Get told when a day's AI spend passes what you planned.",
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="llm-connect-budget-open"
                  onClick={() => {
                    Navigation.navigate(budgetsRoute);
                  }}
                  className="inline-flex flex-shrink-0 items-center gap-1 self-end text-sm font-medium text-indigo-600 hover:text-indigo-700 sm:self-auto"
                >
                  {translator.translateText("Open Budgets")}
                  <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <></>
            )}
          </div>
        </Card>

        <div {...panelProps("apps")}>
          <Card
            title="Your apps"
            description="Send the AI calls your own apps make, as they happen: the conversation, the person, the prompt and the answer, tokens, cost and errors."
          >
            <LlmAppsPath />
          </Card>
        </div>

        <div {...panelProps("providers")}>
          <div className="space-y-6">
            <Card
              title="Your AI provider accounts"
              description="What each account used and what it cost, by day, model, project, key and person. A key and a click, no code. Usage arrives in Usage, under Provider accounts."
            >
              <div>
                <LlmConnectionTiles
                  kind={LlmConnectionKind.ProviderAccount}
                  connectionCounts={connectionCounts}
                  canConnect={createGate.isAllowed}
                  connectDisabledReason={createGate.disabledReason}
                  onConnect={(provider: LlmConnectionProvider) => {
                    setFormState({ provider });
                  }}
                />
                {lockedNote}
              </div>
            </Card>

            <div
              className={
                showsList(LlmConnectionKind.ProviderAccount) ? "" : "hidden"
              }
            >
              <LlmConnectionsTable
                kind={LlmConnectionKind.ProviderAccount}
                refreshToggle={String(refreshCounter)}
                updateGate={updateGate}
                onEdit={editConnection}
                onConnectionsLoaded={onConnectionsLoaded}
              />
            </div>
          </div>
        </div>

        <div {...panelProps("tools")}>
          <div className="space-y-6">
            <Card
              title="Your company's AI tools"
              description="What your people ask the AI tools your company pays for, as conversations by person. Only project owners and admins can read them, unless you choose otherwise."
            >
              <div className="space-y-5">
                <div>
                  <LlmConnectionTiles
                    kind={LlmConnectionKind.CompanyTool}
                    connectionCounts={connectionCounts}
                    canConnect={createGate.isAllowed}
                    connectDisabledReason={createGate.disabledReason}
                    onConnect={(provider: LlmConnectionProvider) => {
                      setFormState({ provider });
                    }}
                  />
                  {lockedNote}
                </div>
                <LlmTellYourPeopleNote />
                <LlmOtherAiTools />
              </div>
            </Card>

            <div
              className={
                showsList(LlmConnectionKind.CompanyTool) ? "" : "hidden"
              }
            >
              <LlmConnectionsTable
                kind={LlmConnectionKind.CompanyTool}
                refreshToggle={String(refreshCounter)}
                updateGate={updateGate}
                onEdit={editConnection}
                onConnectionsLoaded={onConnectionsLoaded}
              />
            </div>
          </div>
        </div>
      </div>

      {formState ? (
        <LlmConnectionFormModal
          provider={formState.provider}
          connection={formState.connection}
          onClose={() => {
            setFormState(undefined);
          }}
          onSaved={() => {
            setFormState(undefined);
            setRefreshCounter((value: number): number => {
              return value + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default LlmConnectPage;
