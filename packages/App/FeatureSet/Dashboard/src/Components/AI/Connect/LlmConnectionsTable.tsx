import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  LlmConnectionDefinition,
  LlmConnectionKind,
  getLlmConnectionDefinition,
  getLlmConnectionDefinitionsOfKind,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import { LlmConnectionTestResult } from "Common/Types/LlmObservability/LlmConnectionTest";
import LlmConversationReaders from "Common/Types/LlmObservability/LlmConversationReaders";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import {
  llmConnectionDocsUrl,
  readLlmConnectionNow,
  runLlmConnectionTest,
} from "./LlmConnectApi";
import {
  LlmConnectionHealth,
  getLlmConnectionHealth,
  getLlmConnectionLastReadSummary,
} from "./LlmConnectionHealth";
import LlmConnectionLogo from "./LlmConnectionLogo";
import LlmConnectionTestPanel from "./LlmConnectionTestPanel";
import {
  LlmConnectionTestWords,
  getLlmConnectionReadFailureWords,
} from "./LlmConnectionTestWords";

/*
 * The project's connections of one kind: how each is doing, when it was
 * last read and what that read brought in, and what can be done with it -
 * read it now, test it, turn it off or on, edit or delete it. Create and
 * edit go through LlmConnectionFormModal (opened by the page): its fields
 * depend on the provider and its secrets are write-only, which ModelTable's
 * own form cannot express.
 */

export interface ComponentProps {
  kind: LlmConnectionKind;
  refreshToggle: string;
  updateGate: PermissionGateResult;
  onEdit: (connection: LlmObservabilityConnection) => void;
  /*
   * Each time the list loads: how many connections it found, all pages
   * and its search counted.
   */
  onConnectionsLoaded: (kind: LlmConnectionKind, totalCount: number) => void;
}

const LlmConnectionsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [testItem, setTestItem] = useState<LlmObservabilityConnection | null>(
    null,
  );
  const [testRun, setTestRun] = useState<number>(0);
  const [errorItem, setErrorItem] = useState<LlmObservabilityConnection | null>(
    null,
  );
  const [notice, setNotice] = useState<
    { type: AlertType; text: string } | undefined
  >(undefined);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  const isTool: boolean = props.kind === LlmConnectionKind.CompanyTool;
  const providers: Array<LlmConnectionProvider> =
    getLlmConnectionDefinitionsOfKind(props.kind).map(
      (definition: LlmConnectionDefinition): LlmConnectionProvider => {
        return definition.provider;
      },
    );

  const refresh: () => void = (): void => {
    setRefreshCounter((value: number): number => {
      return value + 1;
    });
  };

  const setEnabled: (
    item: LlmObservabilityConnection,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
  ) => Promise<void> = async (
    item: LlmObservabilityConnection,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById<LlmObservabilityConnection>({
        modelType: LlmObservabilityConnection,
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
   * went wrong and what to do - with the provider's own answer under them,
   * and the provider's step-by-step guide.
   */
  const renderLastError: (item: LlmObservabilityConnection) => ReactElement = (
    item: LlmObservabilityConnection,
  ): ReactElement => {
    const definition: LlmConnectionDefinition | undefined =
      getLlmConnectionDefinition(item.provider);
    const words: LlmConnectionTestWords | undefined =
      getLlmConnectionReadFailureWords({
        definition,
        lastPullResult: item.lastPullResult,
      });

    return (
      <div className="space-y-4">
        {words ? (
          <div data-testid="llm-connection-error-words">
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
            data-testid="llm-connection-error"
          >
            {item.lastError}
          </pre>
        </div>

        {definition ? (
          <a
            href={llmConnectionDocsUrl(definition.docsPath).toString()}
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
      {notice ? (
        <Alert
          type={notice.type}
          title={notice.text}
          dataTestId="llm-connections-notice"
          onClose={() => {
            setNotice(undefined);
          }}
        />
      ) : (
        <></>
      )}

      <ModelTable<LlmObservabilityConnection>
        modelType={LlmObservabilityConnection}
        refreshToggle={`${props.refreshToggle}-${refreshCounter}`}
        id={`llm-connections-table-${props.kind}`}
        name={
          isTool
            ? "AI / LLM > Connect > Company AI tools"
            : "AI / LLM > Connect > Provider accounts"
        }
        userPreferencesKey={`llm-connections-table-${props.kind}`}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          provider: new Includes(providers),
        }}
        selectMoreFields={{
          provider: true,
          config: true,
          isEnabled: true,
          storeConversationText: true,
          conversationReaders: true,
          lastPulledAt: true,
          lastSuccessfulPullAt: true,
          lastPullResult: true,
          lastError: true,
        }}
        onFetchSuccess={(
          _data: Array<LlmObservabilityConnection>,
          totalCount: number,
        ) => {
          props.onConnectionsLoaded(props.kind, totalCount);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        cardProps={{
          title: isTool ? "Connected AI tools" : "Connected provider accounts",
          description: isTool
            ? "Read every 15 minutes. Each answer arrives as an AI call of the person who asked, in Conversations."
            : "Read every 15 minutes. Usage and cost arrive in Usage, under Provider accounts, and a budget can count them.",
        }}
        noItemsMessage={
          isTool
            ? "No AI tool connected yet. Pick one above."
            : "No provider account connected yet. Pick one above."
        }
        filters={[
          {
            field: { name: true },
            type: FieldType.Text,
            title: "Name",
          },
        ]}
        actionButtons={[
          {
            title: "View error",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
            isVisible: (item: LlmObservabilityConnection): boolean => {
              return getLlmConnectionHealth(item).key === "failing";
            },
            onClick: (
              item: LlmObservabilityConnection,
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
            isVisible: (item: LlmObservabilityConnection): boolean => {
              return item.isEnabled !== false;
            },
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Read it now instead of at its next scheduled read."
              : props.updateGate.disabledReason,
            onClick: async (
              item: LlmObservabilityConnection,
              onCompleteAction: VoidFunction,
            ): Promise<void> => {
              try {
                await readLlmConnectionNow(item.id!);
                // The list does not watch the read: say how to see it end.
                setNotice({
                  type: AlertType.SUCCESS,
                  text: translator.translateTemplate(
                    "Reading {{name}} now. Refresh the list in a minute to see how it went.",
                    { name: item.name || "" },
                  ),
                });
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
            isVisible: (item: LlmObservabilityConnection): boolean => {
              return item.isEnabled === false;
            },
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Read it again, starting with what it missed while it was off."
              : props.updateGate.disabledReason,
            onClick: (
              item: LlmObservabilityConnection,
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
              item: LlmObservabilityConnection,
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
            isVisible: (item: LlmObservabilityConnection): boolean => {
              return item.isEnabled !== false;
            },
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Stop reading it. What it brought in stays."
              : props.updateGate.disabledReason,
            onClick: (
              item: LlmObservabilityConnection,
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
              item: LlmObservabilityConnection,
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
            title: "Connection",
            type: FieldType.Element,
            getElement: (item: LlmObservabilityConnection): ReactElement => {
              const definition: LlmConnectionDefinition | undefined =
                getLlmConnectionDefinition(item.provider);

              return (
                <div className="flex items-center gap-3">
                  <LlmConnectionLogo provider={item.provider} size="md" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {item.name}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {definition
                        ? translator.translateText(definition.title)
                        : item.provider}
                    </div>
                  </div>
                </div>
              );
            },
          },
          {
            field: { lastError: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: LlmObservabilityConnection): ReactElement => {
              const health: LlmConnectionHealth = getLlmConnectionHealth(item);

              return (
                <Pill
                  color={health.color}
                  text={health.label}
                  tooltip={
                    health.tooltipIsError
                      ? health.tooltip
                      : translator.translateText(health.tooltip)
                  }
                />
              );
            },
          },
          {
            field: { lastSuccessfulPullAt: true },
            title: "Last read",
            type: FieldType.Element,
            getElement: (item: LlmObservabilityConnection): ReactElement => {
              const summary:
                | { template: string; values: Record<string, string> }
                | undefined = getLlmConnectionLastReadSummary(item);

              if (!item.lastSuccessfulPullAt) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Not yet")}
                  </span>
                );
              }

              return (
                <div className="min-w-0">
                  <div className="text-sm text-gray-900">
                    {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      item.lastSuccessfulPullAt,
                    )}
                  </div>
                  {summary ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateTemplate(
                        summary.template,
                        summary.values,
                      )}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          ...(isTool
            ? [
                {
                  field: { conversationReaders: true },
                  title: "Who can read",
                  type: FieldType.Element,
                  // "Everyone who can read AI calls" runs long in German.
                  wrapContent: true,
                  wrapMaxWidthClassName: "max-w-xs",
                  getElement: (
                    item: LlmObservabilityConnection,
                  ): ReactElement => {
                    return (
                      <div className="min-w-0">
                        <div className="text-sm text-gray-900">
                          {item.conversationReaders ===
                          LlmConversationReaders.Everyone
                            ? translator.translateText(
                                "Everyone who can read AI calls",
                              )
                            : translator.translateText(
                                "Project owners and admins",
                              )}
                        </div>
                        {item.storeConversationText === false ? (
                          <div className="text-xs text-gray-500">
                            {translator.translateText(
                              "What was written is not kept",
                            )}
                          </div>
                        ) : (
                          <></>
                        )}
                      </div>
                    );
                  },
                },
              ]
            : []),
        ]}
      />

      {testItem && (
        <Modal
          title={translator.translateTemplate("Test {{name}}", {
            name: testItem.name || "",
          })}
          description="A small read with the saved settings. Nothing is imported or stored."
          modalWidth={ModalWidth.Medium}
          closeButtonText="Close"
          onClose={(): void => {
            setTestItem(null);
          }}
        >
          {getLlmConnectionDefinition(testItem.provider) ? (
            <LlmConnectionTestPanel
              key={`${testItem.id?.toString()}-${testRun}`}
              definition={getLlmConnectionDefinition(testItem.provider)!}
              startImmediately={true}
              runTest={(): Promise<LlmConnectionTestResult> => {
                return runLlmConnectionTest({
                  connectionId: testItem.id!.toString(),
                });
              }}
            />
          ) : (
            <></>
          )}
        </Modal>
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

export default LlmConnectionsTable;
