import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import {
  DeviceManagementConnectionHealth,
  getDeviceManagementConnectionHealth,
} from "Common/Types/DeviceManagement/DeviceManagementConnectionHealth";
import {
  getEsperConsoleHost,
  readDeviceManagementConfig,
} from "Common/Types/DeviceManagement/DeviceManagementConnectionSettings";
import {
  DeviceManagementReadSummary,
  readDeviceManagementReadSummary,
} from "Common/Types/DeviceManagement/DeviceManagementReadSummary";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { PluralTemplate } from "Common/Types/Translator";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { readDeviceManagementConnectionNow } from "./DeviceManagementApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  DeviceManagementHealthWords,
  DeviceManagementTestWords,
  getDeviceManagementFailureWords,
  getDeviceManagementHealthWords,
} from "./DeviceManagementWords";

/*
 * The project's Esper connections: how each is doing, when it was last read
 * and what that read found, and what can be done with it - read it now, turn
 * it off or on, edit or delete it. Connect and edit go through
 * EsperConnectionFormModal (opened by the page): its key is write-only and
 * tested before it is saved, which ModelTable's own form cannot express.
 */

export interface ComponentProps {
  refreshToggle: string;
  updateGate: PermissionGateResult;
  onConnect: () => void;
  onEdit: (connection: DeviceManagementConnection) => void;
  // Each time the list loads: how many connections the project has.
  onConnectionsLoaded: (totalCount: number) => void;
}

export const DEVICE_COUNT: PluralTemplate = {
  one: "{{count}} device",
  other: "{{count}} devices",
};

// Where a connection's Set up alerts leads: its recommended monitors (#9835).
export function getConnectionRecommendationsRoute(
  connectionId: ObjectID,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      PageMap.INVENTORY_MANAGED_DEVICE_CONNECTION_RECOMMENDATIONS
    ] as Route,
    { modelId: connectionId },
  );
}

export function getConnectionHealth(
  connection: DeviceManagementConnection,
  now: Date,
): DeviceManagementConnectionHealth {
  return getDeviceManagementConnectionHealth(
    {
      isEnabled: connection.isEnabled,
      createdAt: connection.createdAt,
      lastPulledAt: connection.lastPulledAt,
      lastSuccessfulPullAt: connection.lastSuccessfulPullAt,
      lastError: connection.lastError,
      lastReadStatus: readDeviceManagementReadSummary(connection.lastPullResult)
        ?.status,
      readIntervalInMinutes: readDeviceManagementConfig(connection.config)
        .readIntervalInMinutes,
    },
    now,
  );
}

const DeviceManagementConnectionsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [errorItem, setErrorItem] = useState<DeviceManagementConnection | null>(
    null,
  );
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
    item: DeviceManagementConnection,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
  ) => Promise<void> = async (
    item: DeviceManagementConnection,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById<DeviceManagementConnection>({
        modelType: DeviceManagementConnection,
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

  const renderLastError: (item: DeviceManagementConnection) => ReactElement = (
    item: DeviceManagementConnection,
  ): ReactElement => {
    const words: DeviceManagementTestWords = getDeviceManagementFailureWords(
      readDeviceManagementReadSummary(item.lastPullResult)?.failureKind,
    );

    return (
      <div className="space-y-4">
        <div data-testid="device-management-error-words">
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

        <div>
          <div className="text-xs font-medium text-gray-500">
            {translator.translateText("Details")}
          </div>
          <pre
            aria-label={translator.translateText("Full error message")}
            tabIndex={0}
            className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm text-gray-800"
            data-testid="device-management-error"
          >
            {item.lastError}
          </pre>
        </div>
      </div>
    );
  };

  const now: Date = OneUptimeDate.getCurrentDate();

  return (
    <Fragment>
      {notice ? (
        <Alert
          type={notice.type}
          title={notice.text}
          dataTestId="device-management-connections-notice"
          onClose={() => {
            setNotice(undefined);
          }}
        />
      ) : (
        <></>
      )}

      <ModelTable<DeviceManagementConnection>
        modelType={DeviceManagementConnection}
        refreshToggle={`${props.refreshToggle}-${refreshCounter}`}
        id="device-management-connections-table"
        name="Inventory > Managed Devices > Esper Connections"
        userPreferencesKey="device-management-connections-table"
        query={{ projectId: ProjectUtil.getCurrentProjectId()! }}
        selectMoreFields={{
          provider: true,
          config: true,
          isEnabled: true,
          createdAt: true,
          lastPulledAt: true,
          lastSuccessfulPullAt: true,
          lastPullResult: true,
          lastError: true,
        }}
        onFetchSuccess={(
          _data: Array<DeviceManagementConnection>,
          totalCount: number,
        ) => {
          props.onConnectionsLoaded(totalCount);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        createVerb="Connect"
        // The header's button reads "Connect Esper".
        singularName="Esper"
        pluralName="Esper connections"
        getItemName={(item: DeviceManagementConnection): string => {
          return item.name || "";
        }}
        /*
         * Its dialog names the connection, not the table's "Esper", which
         * would read as deleting Esper itself.
         */
        getDeleteConfirmation={async (
          item: DeviceManagementConnection,
        ): Promise<DeleteConfirmation> => {
          return {
            title: translator.translateTemplate("Delete {{name}}", {
              name: item.name || "",
            }),
          };
        }}
        onCreateClick={props.onConnect}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        cardProps={{
          title: "Esper Connections",
          description:
            "Esper tenants whose Android devices are imported into Inventory and kept current. Esper sends nothing on its own, so each is read on a schedule.",
        }}
        noItemsMessage="No Esper connections yet."
        filters={[]}
        actionButtons={[
          {
            title: "View error",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
            isVisible: (item: DeviceManagementConnection): boolean => {
              return Boolean(item.lastError) && item.isEnabled !== false;
            },
            onClick: (
              item: DeviceManagementConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setErrorItem(item);
              onCompleteAction();
            },
          },
          /*
           * The connection's recommended monitors (#9835): Esper Device
           * Stopped Checking In, one alert per device. Open to everyone
           * who sees the row; creating a monitor asks its own permission.
           */
          {
            title: "Set up alerts",
            icon: IconProp.Bell,
            buttonStyleType: ButtonStyleType.OUTLINE,
            tooltip: "Get an alert when one of its devices stops checking in.",
            onClick: (
              item: DeviceManagementConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              onCompleteAction();
              Navigation.navigate(getConnectionRecommendationsRoute(item.id!));
            },
          },
          {
            title: "Read now",
            icon: IconProp.Refresh,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: DeviceManagementConnection): boolean => {
              return item.isEnabled !== false;
            },
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Read it now instead of at its next scheduled read."
              : props.updateGate.disabledReason,
            onClick: async (
              item: DeviceManagementConnection,
              onCompleteAction: VoidFunction,
            ): Promise<void> => {
              try {
                await readDeviceManagementConnectionNow(item.id!);
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
          {
            title: "Turn on",
            icon: IconProp.Play,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: DeviceManagementConnection): boolean => {
              return item.isEnabled === false;
            },
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Read it again, starting with what it missed while it was off."
              : props.updateGate.disabledReason,
            onClick: (
              item: DeviceManagementConnection,
              onCompleteAction: VoidFunction,
            ): Promise<void> => {
              return setEnabled(item, true, onCompleteAction);
            },
          },
          {
            title: "Turn off",
            icon: IconProp.Stop,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: DeviceManagementConnection): boolean => {
              return item.isEnabled !== false;
            },
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Stop reading it. What it brought in stays."
              : props.updateGate.disabledReason,
            onClick: (
              item: DeviceManagementConnection,
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
              item: DeviceManagementConnection,
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
            // The name reads its own way, the tenant's address its own.
            getLineText: drawsItsOwnLines,
            getElement: (item: DeviceManagementConnection): ReactElement => {
              return (
                <div className="min-w-0">
                  <IsolatedLine
                    text={item.name || ""}
                    className="truncate text-sm font-medium text-gray-900"
                  />
                  <IsolatedLine
                    text={getEsperConsoleHost(
                      readDeviceManagementConfig(item.config).tenant,
                    )}
                    className="truncate text-xs text-gray-500"
                  />
                </div>
              );
            },
          },
          {
            field: { lastError: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: DeviceManagementConnection): ReactElement => {
              const words: DeviceManagementHealthWords =
                getDeviceManagementHealthWords(
                  getConnectionHealth(item, now).status,
                );

              return (
                <Pill
                  tone={words.tone}
                  text={words.label}
                  tooltip={words.tooltip}
                  dataTestId="device-management-connection-status"
                />
              );
            },
          },
          {
            field: { lastSuccessfulPullAt: true },
            title: "Last read",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-sm",
            getElement: (item: DeviceManagementConnection): ReactElement => {
              const summary: DeviceManagementReadSummary | undefined =
                readDeviceManagementReadSummary(item.lastPullResult);

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
                    <div
                      className="text-xs text-gray-500"
                      data-testid="device-management-last-read-summary"
                    >
                      {translator.translatePlural(
                        DEVICE_COUNT,
                        summary.deviceCount,
                      )}
                      {" · "}
                      {translator.translateTemplate(
                        "{{online}} online, {{offline}} offline",
                        {
                          online: translator.formatNumber(summary.onlineCount),
                          offline: translator.formatNumber(
                            summary.offlineCount,
                          ),
                        },
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

export default DeviceManagementConnectionsTable;
