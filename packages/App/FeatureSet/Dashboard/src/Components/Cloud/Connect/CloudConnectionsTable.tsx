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
  CloudConnectionTestResult,
  readCloudConnectionReadSummary,
} from "Common/Types/CloudConnection/CloudConnectionTest";
import OneUptimeDate from "Common/Types/Date";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
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
  ReactElement,
  useState,
} from "react";
import AppLink from "../../AppLink/AppLink";
import {
  cloudConnectionDocsUrl,
  readCloudConnectionNow,
  runCloudConnectionTest,
} from "./CloudConnectApi";
import CloudConnectionLogo from "./CloudConnectionLogo";
import CloudConnectionTestPanel from "./CloudConnectionTestPanel";
import {
  CloudConnectionHealth,
  CloudTemplate,
  CloudWords,
  drawCloudTemplate,
  getCloudConnectionHealth,
  getCloudLastReadWords,
  getCloudReadFailureWords,
  getCloudReadIntervalWords,
} from "./CloudConnectionWords";
import CloudResourceGroups from "./CloudResourceGroups";

/*
 * The project's cloud connections: how each is doing, what it holds - its
 * resources by service, the accounts it reads - when it was last read,
 * and what can be done with it: read it now, test it, turn it off or on,
 * edit or remove it. Create and edit go through CloudConnectionFormModal
 * (opened by the page): its fields depend on the cloud and its secrets are
 * write-only, which ModelTable's own form cannot express.
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

  const refresh: () => void = (): void => {
    setRefreshCounter((value: number): number => {
      return value + 1;
    });
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
        onFetchSuccess={(_data: Array<CloudConnection>, totalCount: number) => {
          props.onConnectionsLoaded(totalCount);
        }}
        isDeleteable={true}
        deleteConfirmationWarning="OneUptime stops reading the account. Its resources stay, with their history, and are archived after a week without metrics."
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
          {
            title: "View error",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
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
            isVisible: (item: CloudConnection): boolean => {
              return item.isEnabled !== false;
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
              const accounts: Array<string> = summary?.accounts || [];

              return (
                <div className="flex items-center gap-3">
                  <CloudConnectionLogo provider={item.provider} size="md" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {item.name}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {definition
                        ? translator.translateText(definition.title)
                        : item.provider}
                    </div>
                    {accounts.length > 0 ? (
                      <div
                        className="truncate font-mono text-xs text-gray-500"
                        data-testid="cloud-connection-accounts"
                      >
                        {accounts.join(", ")}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            field: { lastError: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: CloudConnection): ReactElement => {
              const health: CloudConnectionHealth =
                getCloudConnectionHealth(item);

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
            field: { lastPullResult: true },
            title: "Resources",
            type: FieldType.Element,
            hideOnMobile: true,
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

              return (
                <div className="min-w-0 space-y-1">
                  <CloudResourceGroups
                    provider={item.provider || ""}
                    resourceTypes={summary.resourceTypes}
                    regions={summary.regions}
                    compact={true}
                  />
                  <AppLink
                    to={props.resourcesRoute}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <span>
                      {translator.translateText("See all resources")}
                    </span>
                  </AppLink>
                </div>
              );
            },
          },
          {
            field: { lastSuccessfulPullAt: true },
            title: "Last read",
            type: FieldType.Element,
            getElement: (item: CloudConnection): ReactElement => {
              const words: CloudTemplate | undefined =
                getCloudLastReadWords(item);
              const definition: CloudConnectionDefinition | undefined =
                getCloudConnectionDefinition(item.provider);

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
                  {words ? (
                    <div className="text-xs text-gray-500">
                      {drawCloudTemplate(translator, words)}
                    </div>
                  ) : (
                    <></>
                  )}
                  {definition ? (
                    <div className="text-xs text-gray-500">
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
          {getCloudConnectionDefinition(testItem.provider) ? (
            <CloudConnectionTestPanel
              key={`${testItem.id?.toString()}-${testRun}`}
              definition={getCloudConnectionDefinition(testItem.provider)!}
              readIntervalInMinutes={getCloudConnectionReadIntervalInMinutes(
                getCloudConnectionDefinition(testItem.provider)!,
                testItem.config?.[READ_INTERVAL_FIELD_KEY],
              )}
              startImmediately={true}
              runTest={(): Promise<CloudConnectionTestResult> => {
                return runCloudConnectionTest({
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

export default CloudConnectionsTable;
