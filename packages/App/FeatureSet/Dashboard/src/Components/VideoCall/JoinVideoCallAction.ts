import IconProp from "Common/Types/Icon/IconProp";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { EventPanelAction } from "../EventView/EventStatusPanel";
import { EventVideoCall } from "./useEventVideoCalls";

/*
 * The header's Join call button: the newest of an incident's or alert's
 * calls, one click from anywhere on its page. Opened in a new tab, so the
 * page stays where the responder left it. Null without a call.
 */
export function getJoinVideoCallAction(
  calls: Array<EventVideoCall>,
): EventPanelAction | null {
  const newest: EventVideoCall | undefined = calls[0];

  if (!newest || !newest.joinUrl) {
    return null;
  }

  const joinUrl: string = newest.joinUrl;

  return {
    id: "join-video-call",
    label:
      newest.provider === VideoCallProvider.SlackHuddle
        ? translationKey("Join huddle")
        : translationKey("Join call"),
    icon: IconProp.VideoCamera,
    onClick: (): void => {
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    },
  };
}
