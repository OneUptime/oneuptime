import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { isVideoCallOAuth } from "Common/Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import { getVideoCallProviderDefinition } from "Common/Types/VideoCall/VideoCallProviderCatalog";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import {
  VideoCallTestResult,
  isVideoCallOAuthAvailable,
  runVideoCallConnectionTest,
} from "./VideoCallApi";
import VideoCallProviderLogo from "./VideoCallProviderLogo";
import VideoCallTestPanel from "./VideoCallTestPanel";

/*
 * The project's video call connections. Create and edit go through
 * VideoCallConnectionFormModal (opened by the page): its fields depend on the
 * provider, the credentials are one encrypted column the form assembles, and
 * the form can start a test meeting before saving - none of which
 * ModelTable's generated form can express.
 */

export interface VideoCallConnectionHealth {
  label: string;
  color: Color;
  tooltip: string;
}

/*
 * How a connection is doing, from the last call it started or failed to
 * start. A failure newer than the last success is what to look at.
 */
export function getVideoCallConnectionHealth(
  connection: VideoCallConnection,
): VideoCallConnectionHealth {
  const lastErrorAt: Date | undefined = connection.lastErrorAt
    ? OneUptimeDate.fromString(connection.lastErrorAt)
    : undefined;
  const lastCallStartedAt: Date | undefined = connection.lastCallStartedAt
    ? OneUptimeDate.fromString(connection.lastCallStartedAt)
    : undefined;

  if (
    connection.lastError &&
    (!lastCallStartedAt ||
      (lastErrorAt && lastErrorAt.getTime() >= lastCallStartedAt.getTime()))
  ) {
    /*
     * A sign-in is also checked every day, without a call, so its error is
     * not always a call's.
     */
    return {
      label: isVideoCallOAuth(connection.authMethod)
        ? translationKey("Not working")
        : translationKey("Last call failed"),
      color: Red,
      tooltip: connection.lastError,
    };
  }

  if (lastCallStartedAt) {
    return {
      label: translationKey("Working"),
      color: Green,
      tooltip: translationKey("Its last call started without a problem."),
    };
  }

  return {
    label: translationKey("Not used yet"),
    color: Gray500,
    tooltip: translationKey(
      "No call has been started with it yet. Use Test to start a test meeting.",
    ),
  };
}

export interface ComponentProps {
  refreshToggle: string;
  createGate: PermissionGateResult;
  updateGate: PermissionGateResult;
  onEdit: (connection: VideoCallConnection) => void;
  // Signs a connection made by signing in in again.
  onReconnect: (connection: VideoCallConnection) => void;
  onAdd: () => void;
  onConnectionsLoaded: (connections: Array<VideoCallConnection>) => void;
}

const VideoCallConnectionsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [testItem, setTestItem] = useState<VideoCallConnection | null>(null);
  const [testRun, setTestRun] = useState<number>(0);
  const [errorItem, setErrorItem] = useState<VideoCallConnection | null>(null);

  return (
    <Fragment>
      <ModelTable<VideoCallConnection>
        modelType={VideoCallConnection}
        refreshToggle={props.refreshToggle}
        id="video-call-connections-table"
        name="Settings > Video Calls > Connections"
        userPreferencesKey="video-call-connections-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          provider: true,
          authMethod: true,
          connectedAccount: true,
          description: true,
          config: true,
          lastError: true,
          lastErrorAt: true,
          lastCallStartedAt: true,
        }}
        onFetchSuccess={(data: Array<VideoCallConnection>) => {
          props.onConnectionsLoaded(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        cardProps={{
          title: "Connections",
          description:
            "The Zoom, Google Meet and Microsoft Teams accounts and the standing meeting links this project starts calls with. Pick one in a Slack or Microsoft Teams notification rule, or when you start a call from an incident.",
          buttons: [
            {
              title: "Add connection",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              disabled: !props.createGate.isAllowed,
              tooltip: props.createGate.isAllowed
                ? undefined
                : props.createGate.disabledReason,
              onClick: props.onAdd,
            },
          ],
        }}
        noItemsMessage="No video call connections yet. Pick a provider above to connect one."
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
        ]}
        actionButtons={[
          {
            title: "View error",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
            isVisible: (item: VideoCallConnection): boolean => {
              return Boolean(item.lastError);
            },
            onClick: (
              item: VideoCallConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setErrorItem(item);
              onCompleteAction();
            },
          },
          {
            title: "Test",
            icon: IconProp.Play,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Start a test meeting with this connection and get its join link."
              : props.updateGate.disabledReason,
            onClick: (
              item: VideoCallConnection,
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
            title: "Reconnect",
            icon: IconProp.Refresh,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: VideoCallConnection): boolean => {
              return (
                isVideoCallOAuth(item.authMethod) &&
                isVideoCallOAuthAvailable(item.provider)
              );
            },
            disabled: !props.updateGate.isAllowed,
            tooltip: props.updateGate.isAllowed
              ? "Sign in again - after the account removed OneUptime or its sign-in expired, or to create meetings as another account."
              : props.updateGate.disabledReason,
            onClick: (
              item: VideoCallConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              props.onReconnect(item);
              onCompleteAction();
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
              item: VideoCallConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              props.onEdit(item);
              onCompleteAction();
            },
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Connection",
            type: FieldType.Element,
            getElement: (item: VideoCallConnection): ReactElement => {
              return (
                <div className="flex items-center gap-3">
                  <VideoCallProviderLogo
                    provider={item.provider}
                    joinUrl={
                      item.provider === VideoCallProvider.CustomLink
                        ? (item.config?.["joinUrl"] as string | undefined)
                        : undefined
                    }
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {item.name}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {isVideoCallOAuth(item.authMethod)
                        ? item.connectedAccount
                          ? translator.translateTemplate(
                              "Signed in as {{account}}",
                              { account: item.connectedAccount },
                            )
                          : translator.translateText(
                              "Signed out - reconnect to start calls",
                            )
                        : item.description ||
                          getVideoCallProviderDisplayName(item.provider)}
                    </p>
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              provider: true,
            },
            title: "Provider",
            type: FieldType.Text,
            getElement: (item: VideoCallConnection): ReactElement => {
              return (
                <span>{getVideoCallProviderDisplayName(item.provider)}</span>
              );
            },
          },
          {
            field: {
              lastError: true,
            },
            title: "Health",
            type: FieldType.Element,
            getElement: (item: VideoCallConnection): ReactElement => {
              const health: VideoCallConnectionHealth =
                getVideoCallConnectionHealth(item);

              return (
                <Pill
                  color={health.color}
                  text={health.label}
                  tooltip={translator.translateText(health.tooltip)}
                />
              );
            },
          },
          {
            field: {
              lastCallStartedAt: true,
            },
            title: "Last call started",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
        ]}
      />

      {testItem && (
        <Modal
          title={
            testItem.name
              ? translator.translateTemplate("Test {{name}}", {
                  name: testItem.name,
                })
              : "Test connection"
          }
          description="OneUptime starts a real test meeting with this connection's saved settings. If it works, the connection is ready to use."
          modalWidth={ModalWidth.Medium}
          closeButtonText="Close"
          onClose={(): void => {
            setTestItem(null);
          }}
        >
          <VideoCallTestPanel
            key={`${testItem.id?.toString()}-${testRun}`}
            providerTitle={
              getVideoCallProviderDefinition(testItem.provider)?.title ||
              getVideoCallProviderDisplayName(testItem.provider)
            }
            startImmediately={true}
            runTest={(): Promise<VideoCallTestResult> => {
              return runVideoCallConnectionTest({
                connectionId: testItem.id!.toString(),
              });
            }}
          />
        </Modal>
      )}

      {errorItem && (
        <Modal
          title="Last error"
          description={
            errorItem.name
              ? translator.translateTemplate(
                  "Why {{name}} could not start its last call. Credentials are redacted.",
                  { name: errorItem.name },
                )
              : "Why this connection could not start its last call. Credentials are redacted."
          }
          modalWidth={ModalWidth.Large}
          closeButtonText="Close"
          onClose={(): void => {
            setErrorItem(null);
          }}
          leftFooterElement={
            <CopyTextButton
              textToBeCopied={errorItem.lastError || ""}
              label="Copy error"
              size="md"
              variant="solid"
            />
          }
        >
          <pre
            aria-label={translator.translateText("Full error message")}
            tabIndex={0}
            className="whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm text-gray-800"
          >
            {errorItem.lastError}
          </pre>
        </Modal>
      )}
    </Fragment>
  );
};

export default VideoCallConnectionsTable;
