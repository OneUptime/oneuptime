import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { isSlackHuddleVideoCallSource } from "Common/Types/Workspace/NotificationRules/VideoCallNotificationRule";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import VideoCallProviderLogo from "../../VideoCall/VideoCallProviderLogo";

/*
 * A rule's video call in its list entry: where the call is held, with the
 * provider's mark, or a warning when the connection it names is gone.
 */

export interface ComponentProps {
  rule: IncidentNotificationRule;
  connections: Array<VideoCallConnection>;
}

const VideoCallRuleSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const source: string = props.rule.videoCallSource || "";

  if (isSlackHuddleVideoCallSource(source)) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <VideoCallProviderLogo
          provider={VideoCallProvider.SlackHuddle}
          size="sm"
        />
        <span>
          {translator.translateText(
            "Starts the Slack huddle of the event's channel",
          )}
        </span>
      </div>
    );
  }

  const connection: VideoCallConnection | undefined = props.connections.find(
    (item: VideoCallConnection): boolean => {
      return item.id?.toString() === source;
    },
  );

  if (!connection) {
    return (
      <div className="text-sm text-gray-500">
        {translator.translateText(
          "Starts a video call with a connection that no longer exists. Edit the rule to pick another one.",
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <VideoCallProviderLogo
        provider={connection.provider}
        joinUrl={connection.config?.["joinUrl"] as string | undefined}
        size="sm"
      />
      <span>
        {translator.translateTemplate(
          "Starts a {{provider}} call with {{name}}",
          {
            provider: getVideoCallProviderDisplayName(connection.provider),
            name: connection.name || "",
          },
        )}
      </span>
    </div>
  );
};

export default VideoCallRuleSummary;
