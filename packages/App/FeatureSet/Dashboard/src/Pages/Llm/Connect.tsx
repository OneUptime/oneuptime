import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import LlmAppsPath from "../../Components/AI/Connect/LlmAppsPath";
import LlmConnectChecklist, {
  LlmConnectChecklistFacts,
  LlmConnectChecklistKey,
} from "../../Components/AI/Connect/LlmConnectChecklist";
import LlmConnectionFormModal from "../../Components/AI/Connect/LlmConnectionFormModal";
import LlmConnectionTiles from "../../Components/AI/Connect/LlmConnectionTiles";
import LlmConnectionsTable from "../../Components/AI/Connect/LlmConnectionsTable";
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
import {
  LlmConnectionKind,
  isCompanyToolProvider,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import AnalyticsListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * AI / LLM > Connect: the three ways AI comes into OneUptime, with a
 * checklist that ticks itself as each one starts working.
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
 * Replaces Setup, whose snippets live on under "Your apps".
 */

const SECTION_IDS: Record<LlmConnectChecklistKey, string> = {
  apps: "llm-connect-apps-section",
  providers: "llm-connect-providers-section",
  companyTools: "llm-connect-company-tools-section",
  budget: "",
};

const LlmConnectPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [formState, setFormState] = useState<
    | {
        provider: LlmConnectionProvider;
        connection?: LlmObservabilityConnection;
      }
    | undefined
  >(undefined);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  // What each list shows, as it loads: the tiles' counts come from it.
  const [listed, setListed] = useState<
    Partial<Record<LlmConnectionKind, Array<LlmObservabilityConnection>>>
  >({});
  // Connections of each kind the project has, from the read on opening.
  const [knownCounts, setKnownCounts] = useState<
    Partial<Record<LlmConnectionKind, number>>
  >({});
  const [facts, setFacts] = useState<LlmConnectChecklistFacts>({
    hasAiCalls: undefined,
    hasProviderAccount: undefined,
    hasCompanyTool: undefined,
    hasBudget: undefined,
  });

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
      let connections: Array<LlmObservabilityConnection> | undefined =
        undefined;

      try {
        const result: ListResult<LlmObservabilityConnection> =
          await ModelAPI.getList<LlmObservabilityConnection>({
            modelType: LlmObservabilityConnection,
            query: { projectId },
            select: { _id: true, provider: true, serviceId: true },
            limit: 100,
            skip: 0,
            sort: {},
          });
        connections = result.data;
      } catch {
        connections = undefined;
      }

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

      if (connections) {
        const tools: number = connections.filter(
          (connection: LlmObservabilityConnection): boolean => {
            return isCompanyToolProvider(connection.provider);
          },
        ).length;

        setKnownCounts({
          [LlmConnectionKind.CompanyTool]: tools,
          [LlmConnectionKind.ProviderAccount]: connections.length - tools,
        });
      }

      setFacts({
        hasAiCalls,
        hasBudget,
        hasProviderAccount: connections
          ? connections.some((connection: LlmObservabilityConnection) => {
              return (
                Boolean(connection.provider) &&
                !isCompanyToolProvider(connection.provider)
              );
            })
          : undefined,
        hasCompanyTool: connections
          ? toolServiceIds.length > 0 ||
            connections.some((connection: LlmObservabilityConnection) => {
              return isCompanyToolProvider(connection.provider);
            })
          : undefined,
      });
    };

    void loadFacts();

    return () => {
      isCurrent = false;
    };
  }, [refreshCounter, disableTelemetryForThisProject]);

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  const openChecklistItem: (key: LlmConnectChecklistKey) => void = (
    key: LlmConnectChecklistKey,
  ): void => {
    if (key === "budget") {
      Navigation.navigate(
        RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_BUDGETS] as Route),
      );
      return;
    }

    document
      .getElementById(SECTION_IDS[key])
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onConnectionsLoaded: (
    kind: LlmConnectionKind,
    connections: Array<LlmObservabilityConnection>,
  ) => void = (
    kind: LlmConnectionKind,
    connections: Array<LlmObservabilityConnection>,
  ): void => {
    setListed(
      (
        previous: Partial<
          Record<LlmConnectionKind, Array<LlmObservabilityConnection>>
        >,
      ): Partial<
        Record<LlmConnectionKind, Array<LlmObservabilityConnection>>
      > => {
        return { ...previous, [kind]: connections };
      },
    );
  };

  const connectionCounts: Partial<Record<LlmConnectionProvider, number>> = {};

  for (const connections of Object.values(listed)) {
    for (const connection of connections || []) {
      if (connection.provider) {
        connectionCounts[connection.provider] =
          (connectionCounts[connection.provider] || 0) + 1;
      }
    }
  }

  /*
   * A list shows once there is something in it: until then the tiles
   * above it are the way in, and an empty table under them would only
   * repeat "nothing connected yet".
   */
  const showsList: (kind: LlmConnectionKind) => boolean = (
    kind: LlmConnectionKind,
  ): boolean => {
    return (knownCounts[kind] || 0) > 0 || (listed[kind] || []).length > 0;
  };

  /*
   * The lists are the freshest word on what is connected (a connection
   * deleted from a list is gone from it at once); the facts read when the
   * page opened stand in until a list has loaded.
   */
  const shownFacts: LlmConnectChecklistFacts = {
    ...facts,
    hasProviderAccount:
      listed[LlmConnectionKind.ProviderAccount] !== undefined
        ? listed[LlmConnectionKind.ProviderAccount]!.length > 0
        : facts.hasProviderAccount,
    hasCompanyTool:
      listed[LlmConnectionKind.CompanyTool] !== undefined
        ? listed[LlmConnectionKind.CompanyTool]!.length > 0
        : facts.hasCompanyTool,
  };

  return (
    <Fragment>
      <div className="space-y-6" data-testid="llm-connect-page">
        <Card
          title="Connect AI to OneUptime"
          description="Three ways to bring AI in. Use one, two or all three: everything lands in the same Conversations, Usage, Alerts and Budgets."
        >
          <LlmConnectChecklist facts={shownFacts} onOpen={openChecklistItem} />
        </Card>

        <div id={SECTION_IDS.apps} className="scroll-mt-4">
          <Card
            title="Your apps"
            description="Send the AI calls your own apps make, as they happen: the conversation, the person, the prompt and the answer, tokens, cost and errors."
          >
            <LlmAppsPath />
          </Card>
        </div>

        <div id={SECTION_IDS.providers} className="scroll-mt-4 space-y-6">
          <Card
            title="Your AI provider accounts"
            description="What each account used and what it cost, by day, model, project, key and person. A key and a click, no code. Usage arrives in Usage, under Provider accounts."
          >
            <LlmConnectionTiles
              kind={LlmConnectionKind.ProviderAccount}
              connectionCounts={connectionCounts}
              canConnect={createGate.isAllowed}
              connectDisabledReason={createGate.disabledReason}
              onConnect={(provider: LlmConnectionProvider) => {
                setFormState({ provider });
              }}
            />
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
              onEdit={(connection: LlmObservabilityConnection) => {
                if (connection.provider) {
                  setFormState({ provider: connection.provider, connection });
                }
              }}
              onConnectionsLoaded={onConnectionsLoaded}
            />
          </div>
        </div>

        <div id={SECTION_IDS.companyTools} className="scroll-mt-4 space-y-6">
          <Card
            title="Your company's AI tools"
            description="What your people ask the AI tools your company pays for, as conversations by person. Only project owners and admins can read them, unless you choose otherwise."
          >
            <div className="space-y-5">
              <LlmConnectionTiles
                kind={LlmConnectionKind.CompanyTool}
                connectionCounts={connectionCounts}
                canConnect={createGate.isAllowed}
                connectDisabledReason={createGate.disabledReason}
                onConnect={(provider: LlmConnectionProvider) => {
                  setFormState({ provider });
                }}
              />
              <LlmTellYourPeopleNote />
              <LlmOtherAiTools />
            </div>
          </Card>

          <div
            className={showsList(LlmConnectionKind.CompanyTool) ? "" : "hidden"}
          >
            <LlmConnectionsTable
              kind={LlmConnectionKind.CompanyTool}
              refreshToggle={String(refreshCounter)}
              updateGate={updateGate}
              onEdit={(connection: LlmObservabilityConnection) => {
                if (connection.provider) {
                  setFormState({ provider: connection.provider, connection });
                }
              }}
              onConnectionsLoaded={onConnectionsLoaded}
            />
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
