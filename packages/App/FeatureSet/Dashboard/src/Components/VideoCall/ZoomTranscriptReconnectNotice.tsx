import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import IconProp from "Common/Types/Icon/IconProp";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  fetchZoomConnectionsToReconnect,
  isVideoCallOAuthAvailable,
} from "./VideoCallApi";

/*
 * THE ZOOM CONNECTIONS TO SIGN IN AGAIN FOR CALL TRANSCRIPTS (#9269).
 *
 * A Zoom connection signed in before OneUptime's Zoom app could read call
 * transcripts cannot read them, and 90 days after the app's update went
 * live Zoom stops accepting its sign-in: the weekly keep-alive fails and it
 * starts no call until it is reconnected. This says so first on Project
 * Settings > Workspace > Video Calls, with Reconnect for each such
 * connection, and goes away once each one is signed in again.
 *
 * The server decides which connections those are (ZoomTranscriptReconnect),
 * and names none until its Zoom app grants the transcript scopes: before
 * Zoom approves the update, signing in again would grant them no more.
 * Asked only where this server connects Zoom by signing in, the one place
 * Reconnect is offered, and quiet when the server cannot be asked: the
 * connection keeps starting calls until Zoom stops accepting it, and its
 * row says so the day it does.
 */

export interface ComponentProps {
  // Changes when the page's connections may have changed, to ask again.
  refreshToggle: string;
  updateGate: PermissionGateResult;
  // Opens the Reconnect dialog for the connection.
  onReconnect: (connection: VideoCallConnection) => void;
}

// What the notice says, in the reader's language.
export interface ZoomTranscriptReconnectCopy {
  title: string;
  message: string;
}

// A connection as the page names it: its name, or the provider's for one without.
function getConnectionName(connection: VideoCallConnection): string {
  return connection.name || "Zoom";
}

/*
 * The words for the connections to reconnect, or null when there are none.
 * A connection's name goes in the title and on its button only: a one-click
 * connection is called "Zoom", and "Zoom was signed in to Zoom" says
 * nothing.
 */
export function getZoomTranscriptReconnectCopy(data: {
  connections: Array<VideoCallConnection>;
  translator: Translator;
}): ZoomTranscriptReconnectCopy | null {
  const { connections, translator } = data;

  if (connections.length === 0) {
    return null;
  }

  if (connections.length === 1) {
    return {
      title: translator.translateTemplate(
        "Reconnect {{name}} to keep starting calls",
        { name: getConnectionName(connections[0]!) },
      ),
      message: joinSentences([
        translator.translateText(
          "This Zoom connection was signed in before OneUptime could read call transcripts, so it cannot read them.",
        ) || "",
        translator.translateText(
          "90 days after OneUptime's Zoom app was updated, Zoom stops accepting this connection's sign-in, and the connection stops starting calls.",
        ) || "",
        translator.translateText(
          "Click Reconnect, then allow OneUptime to read recordings and transcripts when Zoom asks.",
        ) || "",
      ]),
    };
  }

  return {
    title:
      translator.translateText(
        "Reconnect these Zoom connections to keep starting calls",
      ) || "",
    message: joinSentences([
      translator.translateText(
        "These Zoom connections were signed in before OneUptime could read call transcripts, so they cannot read them.",
      ) || "",
      translator.translateText(
        "90 days after OneUptime's Zoom app was updated, Zoom stops accepting their sign-ins, and the connections stop starting calls.",
      ) || "",
      translator.translateText(
        "Click Reconnect for each connection, then allow OneUptime to read recordings and transcripts when Zoom asks.",
      ) || "",
    ]),
  };
}

const ZoomTranscriptReconnectNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connections, setConnections] = useState<Array<VideoCallConnection>>(
    [],
  );

  useEffect(() => {
    if (!isVideoCallOAuthAvailable(VideoCallProvider.Zoom)) {
      return;
    }

    let isCurrent: boolean = true;

    fetchZoomConnectionsToReconnect()
      .then((found: Array<VideoCallConnection>) => {
        if (isCurrent) {
          setConnections(found);
        }
      })
      .catch(() => {
        /*
         * Quiet: a heads-up. The connection keeps starting calls until Zoom
         * stops accepting its sign-in, and its row says so that day.
         */
      });

    return () => {
      isCurrent = false;
    };
  }, [props.refreshToggle]);

  const copy: ZoomTranscriptReconnectCopy | null =
    getZoomTranscriptReconnectCopy({ connections, translator });

  if (!copy) {
    return <></>;
  }

  return (
    <div className="mb-5">
      <Alert
        type={AlertType.WARNING}
        dataTestId="zoom-transcript-reconnect"
        strongTitle={copy.title}
        title={
          <div className="space-y-3">
            <p data-testid="zoom-transcript-reconnect-message">
              {copy.message}
            </p>
            <div className="flex flex-wrap gap-2">
              {connections.map(
                (connection: VideoCallConnection): ReactElement => {
                  return (
                    <Button
                      key={connection.id?.toString()}
                      title={translator.translateTemplate(
                        "Reconnect {{name}}",
                        {
                          name: getConnectionName(connection),
                        },
                      )}
                      isTitleTranslated={true}
                      icon={IconProp.Refresh}
                      buttonStyle={ButtonStyleType.NORMAL}
                      dataTestId={`zoom-transcript-reconnect-${connection.id?.toString()}`}
                      disabled={!props.updateGate.isAllowed}
                      tooltip={
                        props.updateGate.isAllowed
                          ? undefined
                          : props.updateGate.disabledReason
                      }
                      onClick={(): void => {
                        props.onReconnect(connection);
                      }}
                    />
                  );
                },
              )}
            </div>
          </div>
        }
      />
    </div>
  );
};

export default ZoomTranscriptReconnectNotice;
