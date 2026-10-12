import PageComponentProps from "../PageComponentProps";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import {
  VideoCallProviderCatalog,
  VideoCallProviderDefinition,
  isConnectableVideoCallProvider,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
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
} from "../../Components/VideoCall/VideoCallApi";
import VideoCallConnectNotice from "../../Components/VideoCall/VideoCallConnectNotice";
import VideoCallConnectionFormModal from "../../Components/VideoCall/VideoCallConnectionFormModal";
import VideoCallConnectionsTable from "../../Components/VideoCall/VideoCallConnectionsTable";
import VideoCallOAuthConnectModal from "../../Components/VideoCall/VideoCallOAuthConnectModal";
import VideoCallProviderGallery from "../../Components/VideoCall/VideoCallProviderGallery";
import VideoCallProviderLogo from "../../Components/VideoCall/VideoCallProviderLogo";
import VideoCallTestPanel from "../../Components/VideoCall/VideoCallTestPanel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * Project Settings > Video Calls: give every incident its own call.
 *
 * The page answers three questions in order. How does it work (the steps
 * across the top)? Which providers can hold a call (the gallery, where one
 * click starts a connection)? Which connections does this project have, and
 * do they work (the table, with a test that starts a real meeting)?
 *
 * Where this server has a provider's own app (OneUptime Cloud has all
 * three), Connect signs in to the provider (VideoCallOAuthConnectModal) and
 * comes back here with the connection made (VideoCallConnectNotice).
 * Otherwise, and for anyone who asks to use their own app, it opens the
 * connection form.
 */

interface FormState {
  provider: VideoCallProvider;
  connection?: VideoCallConnection | undefined;
}

// The one-click Connect, or a reconnect of a connection made by signing in.
interface SignInState {
  provider: VideoCallProvider;
  connection?: VideoCallConnection | undefined;
}

const HowItWorks: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  const steps: Array<{ icon: IconProp; title: string; body: string }> = [
    {
      icon: IconProp.Link,
      title: translator.translateText("Connect a provider") || "",
      body:
        translator.translateText(
          "Zoom, Google Meet, Microsoft Teams or a standing meeting link. Slack huddles need nothing.",
        ) || "",
    },
    {
      icon: IconProp.Filter,
      title: translator.translateText("Turn it on in a rule") || "",
      body:
        translator.translateText(
          "In a Slack or Microsoft Teams notification rule for incidents or alerts. The rule's conditions decide which events get a call.",
        ) || "",
    },
    {
      icon: IconProp.VideoCamera,
      title: translator.translateText("Responders join in one click") || "",
      body:
        translator.translateText(
          "OneUptime starts one call per event and posts a Join button in its channels, its feed and on its page.",
        ) || "",
    },
  ];

  return (
    <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {steps.map(
        (
          step: { icon: IconProp; title: string; body: string },
          index: number,
        ): ReactElement => {
          return (
            <li
              key={step.title}
              className="flex gap-3 rounded-lg bg-gray-50 p-4 ring-1 ring-inset ring-gray-200"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Icon icon={step.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  <span className="mr-1 text-gray-400">{index + 1}.</span>
                  {step.title}
                </p>
                <p className="mt-1 text-sm text-gray-500">{step.body}</p>
              </div>
            </li>
          );
        },
      )}
    </ol>
  );
};

const VideoCallsPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [formState, setFormState] = useState<FormState | null>(null);
  const [signInState, setSignInState] = useState<SignInState | null>(null);
  const [testConnection, setTestConnection] =
    useState<VideoCallConnection | null>(null);
  const [isChoosingProvider, setIsChoosingProvider] = useState<boolean>(false);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [connectionCounts, setConnectionCounts] = useState<
    Partial<Record<VideoCallProvider, number>>
  >({});

  /*
   * Every write here goes through ModelAPI directly, which ModelTable's own
   * gating never sees, so the affordances are gated up front: a member who
   * may not change connections gets a disabled button that says why.
   */
  const createGate: PermissionGateResult = PermissionGate.check(
    new VideoCallConnection(),
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    new VideoCallConnection(),
    ModelAction.Update,
  );

  const openConnect: (provider: VideoCallProvider) => void = (
    provider: VideoCallProvider,
  ): void => {
    if (!isConnectableVideoCallProvider(provider)) {
      return;
    }

    setIsChoosingProvider(false);

    if (isVideoCallOAuthAvailable(provider)) {
      setSignInState({ provider });
      return;
    }

    setFormState({ provider });
  };

  return (
    <Fragment>
      <VideoCallConnectNotice
        onStartTest={(connection: VideoCallConnection): void => {
          setTestConnection(connection);
        }}
      />

      <Card
        title="Video Calls"
        description="Give every incident and alert its own call. OneUptime starts a dedicated meeting when a notification rule fires and posts a Join button wherever the event's updates go."
        rightElement={
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK] as Route,
            )}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            {translator.translateText("Incident notification rules")}
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </Link>
        }
      >
        <HowItWorks />
      </Card>

      <Card
        title="Providers"
        description="Where a call can be held. Connect each provider once and pick it in as many rules as you like."
      >
        <VideoCallProviderGallery
          connectionCounts={connectionCounts}
          canConnect={createGate.isAllowed}
          connectDisabledReason={createGate.disabledReason}
          onConnect={openConnect}
        />
      </Card>

      <VideoCallConnectionsTable
        refreshToggle={String(refreshCounter)}
        createGate={createGate}
        updateGate={updateGate}
        onAdd={() => {
          setIsChoosingProvider(true);
        }}
        onEdit={(connection: VideoCallConnection) => {
          if (connection.provider) {
            setFormState({ provider: connection.provider, connection });
          }
        }}
        onReconnect={(connection: VideoCallConnection) => {
          if (connection.provider) {
            setSignInState({ provider: connection.provider, connection });
          }
        }}
        onConnectionsLoaded={(connections: Array<VideoCallConnection>) => {
          const counts: Partial<Record<VideoCallProvider, number>> = {};

          for (const connection of connections) {
            if (connection.provider) {
              counts[connection.provider] =
                (counts[connection.provider] || 0) + 1;
            }
          }

          setConnectionCounts(counts);
        }}
      />

      {isChoosingProvider && (
        <Modal
          title="Add a video call connection"
          description="Pick the provider to start calls with. You can connect as many as you need."
          modalWidth={ModalWidth.Medium}
          closeButtonText="Cancel"
          onClose={() => {
            setIsChoosingProvider(false);
          }}
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {VideoCallProviderCatalog.map(
              (definition: VideoCallProviderDefinition): ReactElement => {
                return (
                  <li key={definition.provider}>
                    <button
                      type="button"
                      data-testid={`video-call-choose-${definition.provider}`}
                      onClick={() => {
                        openConnect(definition.provider);
                      }}
                      className="flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-indigo-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <VideoCallProviderLogo
                        provider={definition.provider}
                        size="md"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">
                          {definition.provider === VideoCallProvider.CustomLink
                            ? translator.translateText(definition.title)
                            : definition.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {translator.translateText(definition.description)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              },
            )}
          </ul>
        </Modal>
      )}

      {signInState && (
        <VideoCallOAuthConnectModal
          key={`${signInState.provider}-${signInState.connection?.id?.toString() || "new"}`}
          provider={signInState.provider}
          connection={signInState.connection}
          onClose={() => {
            setSignInState(null);
          }}
          onUseOwnApp={() => {
            const provider: VideoCallProvider = signInState.provider;
            setSignInState(null);
            setFormState({ provider });
          }}
        />
      )}

      {testConnection && testConnection.id && (
        <Modal
          title={translator.translateTemplate("Test {{name}}", {
            name:
              testConnection.name ||
              getVideoCallProviderDisplayName(testConnection.provider),
          })}
          description="OneUptime starts a real test meeting with this connection. If it works, the connection is ready to use."
          modalWidth={ModalWidth.Medium}
          closeButtonText="Close"
          onClose={(): void => {
            setTestConnection(null);
            setRefreshCounter((value: number): number => {
              return value + 1;
            });
          }}
        >
          <VideoCallTestPanel
            providerTitle={getVideoCallProviderDisplayName(
              testConnection.provider,
            )}
            startImmediately={true}
            runTest={(): Promise<VideoCallTestResult> => {
              return runVideoCallConnectionTest({
                connectionId: testConnection.id!.toString(),
              });
            }}
          />
        </Modal>
      )}

      {formState && (
        <VideoCallConnectionFormModal
          key={`${formState.provider}-${formState.connection?.id?.toString() || "new"}`}
          provider={formState.provider}
          connection={formState.connection}
          onClose={() => {
            setFormState(null);
          }}
          onSaved={() => {
            setFormState(null);
            setRefreshCounter((value: number): number => {
              return value + 1;
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default VideoCallsPage;
