import {
  ConnectCallbackNoticeText,
  getConnectCallbackNotice,
} from "../../Utils/Workspace/ConnectCallbackMessage";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import ObjectID from "Common/Types/ObjectID";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import ConnectCallbackUtil, {
  CONNECT_CONNECTED_QUERY_PARAM,
  CONNECT_ERROR_QUERY_PARAM,
  CONNECT_NOTICE_QUERY_PARAM,
  CONNECT_PROVIDER_QUERY_PARAM,
  ConnectProvider,
  ConnectProviderNotice,
} from "Common/Types/Workspace/ConnectCallback";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * What a sign-in to Zoom, Google or Microsoft came back to the Video Calls
 * page with: the connection it made (`?connected=`), or why none was made
 * (`?error=` and a code, ConnectCallbackMessage), for the provider
 * `?provider=` names. Read once when the page opens and taken off the
 * address at once, so a reload or a shared link does not say it again.
 *
 * A connection made is named with the account it signed in as, next to a
 * test meeting - the one check that proves the provider lets that account
 * create meetings.
 *
 * A sign-in Zoom started itself, from the Zoom App Marketplace, comes back
 * with a notice instead (`?notice=`, ConnectProviderNotice.ZoomAdded): it
 * said nothing of which project it was for, so nothing was connected. The
 * page says OneUptime is added to the Zoom account and offers Connect, the
 * same sign-in the provider's own Connect starts - or, to someone who may
 * not connect providers, why they cannot.
 */

export interface VideoCallConnectResult {
  provider: ConnectProvider | null;
  error: string | null;
  connectedId: string | null;
  notice: ConnectProviderNotice | null;
}

export function readVideoCallConnectResult(): VideoCallConnectResult {
  const named: ConnectProvider | null = ConnectCallbackUtil.readProvider(
    Navigation.getQueryStringByName(CONNECT_PROVIDER_QUERY_PARAM),
  );

  // Only a video call provider comes back to this page.
  const provider: ConnectProvider | null =
    named && ConnectCallbackUtil.isVideoCallProvider(named) ? named : null;

  return {
    provider: provider,
    error: Navigation.getQueryStringByName(CONNECT_ERROR_QUERY_PARAM),
    connectedId: Navigation.getQueryStringByName(CONNECT_CONNECTED_QUERY_PARAM),
    // Only a notice of the provider's own, and only one this page knows.
    notice: provider
      ? ConnectCallbackUtil.readNotice(
          provider,
          Navigation.getQueryStringByName(CONNECT_NOTICE_QUERY_PARAM),
        )
      : null,
  };
}

export interface ComponentProps {
  onStartTest: (connection: VideoCallConnection) => void;
  // Starts connecting a provider, as the provider's own Connect does.
  onConnect: (provider: VideoCallProvider) => void;
  // Whether the person may connect video call providers in this project.
  canConnect: boolean;
  // Why they may not, in their language, when they may not.
  connectDisabledReason?: string | undefined;
}

const VideoCallConnectNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [result, setResult] = useState<VideoCallConnectResult>(() => {
    return readVideoCallConnectResult();
  });
  const [connection, setConnection] = useState<VideoCallConnection | null>(
    null,
  );

  useEffect(() => {
    if (result.error || result.connectedId || result.provider) {
      Navigation.setQueryString({
        [CONNECT_ERROR_QUERY_PARAM]: null,
        [CONNECT_CONNECTED_QUERY_PARAM]: null,
        [CONNECT_PROVIDER_QUERY_PARAM]: null,
        [CONNECT_NOTICE_QUERY_PARAM]: null,
      });
    }

    if (
      !result.error &&
      result.connectedId &&
      ObjectID.isValidUUID(result.connectedId)
    ) {
      ModelAPI.getItem<VideoCallConnection>({
        modelType: VideoCallConnection,
        id: new ObjectID(result.connectedId),
        select: {
          name: true,
          provider: true,
          connectedAccount: true,
        },
      })
        .then((item: VideoCallConnection | null) => {
          setConnection(item);
        })
        .catch(() => {
          setConnection(null);
        });
    }
  }, []);

  const dismiss: () => void = (): void => {
    setResult({ provider: null, error: null, connectedId: null, notice: null });
    setConnection(null);
  };

  if (result.error && result.provider) {
    const notice: ConnectCallbackNoticeText | null = getConnectCallbackNotice({
      provider: result.provider,
      error: result.error,
      translator,
    });

    if (!notice) {
      return <></>;
    }

    return (
      <div className="mb-5">
        <Alert
          type={AlertType.DANGER}
          strongTitle={notice.title}
          title={notice.message}
          onClose={dismiss}
          dataTestId="video-call-connect-error"
        />
      </div>
    );
  }

  if (result.notice === ConnectProviderNotice.ZoomAdded) {
    // What to do next, when there is something to say: Connect Zoom, or why not.
    const zoomAddedTitle: ReactElement | undefined = props.canConnect ? (
      <TranslatedSentence
        template="{{connectZoom}} to start this project's calls in Zoom."
        slots={{
          connectZoom: (
            <button
              type="button"
              data-testid="video-call-zoom-added-connect"
              onClick={(): void => {
                dismiss();
                props.onConnect(VideoCallProvider.Zoom);
              }}
              className="font-semibold underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {translator.translateTemplate("Connect {{provider}}", {
                provider: getVideoCallProviderDisplayName(
                  VideoCallProvider.Zoom,
                ),
              })}
            </button>
          ),
        }}
      />
    ) : props.connectDisabledReason ? (
      // Already in the reader's language: drawn as it is.
      <span>{props.connectDisabledReason}</span>
    ) : undefined;

    return (
      <div className="mb-5">
        <Alert
          type={AlertType.INFO}
          strongTitle="OneUptime is added to your Zoom account"
          {...(zoomAddedTitle ? { title: zoomAddedTitle } : {})}
          onClose={dismiss}
          dataTestId="video-call-zoom-added"
        />
      </div>
    );
  }

  if (!connection || !connection.provider) {
    return <></>;
  }

  const providerTitle: string = getVideoCallProviderDisplayName(
    connection.provider,
  );

  return (
    <div className="mb-5">
      <Alert
        type={AlertType.SUCCESS}
        strongTitle={translator.translateTemplate("{{provider}} is connected", {
          provider: providerTitle,
        })}
        title={
          <span>
            {connection.connectedAccount
              ? translator.translateTemplate(
                  "Every meeting is created as {{account}}. Start a test meeting, then pick {{name}} in a Slack or Microsoft Teams notification rule.",
                  {
                    account: connection.connectedAccount,
                    name: connection.name || providerTitle,
                  },
                )
              : translator.translateTemplate(
                  "Start a test meeting, then pick {{name}} in a Slack or Microsoft Teams notification rule.",
                  { name: connection.name || providerTitle },
                )}{" "}
            <button
              type="button"
              data-testid="video-call-connected-test"
              onClick={(): void => {
                props.onStartTest(connection);
              }}
              className="font-semibold underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {translator.translateText("Start a test meeting")}
            </button>
          </span>
        }
        onClose={dismiss}
        dataTestId="video-call-connected"
      />
    </div>
  );
};

export default VideoCallConnectNotice;
