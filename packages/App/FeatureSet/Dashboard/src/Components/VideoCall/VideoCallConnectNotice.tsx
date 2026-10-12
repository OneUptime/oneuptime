import {
  ConnectCallbackNoticeText,
  getConnectCallbackNotice,
} from "../../Utils/Workspace/ConnectCallbackMessage";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import ObjectID from "Common/Types/ObjectID";
import { getVideoCallProviderDisplayName } from "Common/Types/VideoCall/VideoCallProvider";
import ConnectCallbackUtil, {
  CONNECT_CONNECTED_QUERY_PARAM,
  CONNECT_ERROR_QUERY_PARAM,
  CONNECT_PROVIDER_QUERY_PARAM,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
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
 */

export interface VideoCallConnectResult {
  provider: ConnectProvider | null;
  error: string | null;
  connectedId: string | null;
}

export function readVideoCallConnectResult(): VideoCallConnectResult {
  const provider: ConnectProvider | null = ConnectCallbackUtil.readProvider(
    Navigation.getQueryStringByName(CONNECT_PROVIDER_QUERY_PARAM),
  );

  return {
    // Only a video call provider comes back to this page.
    provider:
      provider && ConnectCallbackUtil.isVideoCallProvider(provider)
        ? provider
        : null,
    error: Navigation.getQueryStringByName(CONNECT_ERROR_QUERY_PARAM),
    connectedId: Navigation.getQueryStringByName(CONNECT_CONNECTED_QUERY_PARAM),
  };
}

export interface ComponentProps {
  onStartTest: (connection: VideoCallConnection) => void;
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
    setResult({ provider: null, error: null, connectedId: null });
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
