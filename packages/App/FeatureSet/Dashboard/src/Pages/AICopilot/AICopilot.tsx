import PageComponentProps from "../PageComponentProps";
import { openAskAi } from "../../Components/AIChat/AskAiEvents";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import UiAnalytics from "Common/UI/Utils/Analytics";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";

/*
 * The chat's own address: Products -> AI -> Chat, and /ai/chat/<id> for one
 * conversation, as bookmarks and links in incident channels have it.
 *
 * Ask AI used to have a full page here as well as its side panel: two
 * designs of one conversation. It has one now, the dialog (AskAiDialog),
 * and this address opens it - on the conversation the address names, if
 * it names one - over the page the person came from, or over Home when the
 * address was opened on its own. The address itself passes the browser on
 * (Back skips it), so closing the dialog leaves the person where they
 * were, never on an empty page.
 */

// Whether the browser has a page of this app to go back to.
export function hasPageToGoBackTo(): boolean {
  const state: unknown =
    typeof window !== "undefined" ? window.history.state : null;
  const index: unknown =
    state && typeof state === "object"
      ? (state as Record<string, unknown>)["idx"]
      : undefined;

  return typeof index === "number" && index > 0;
}

// The conversation an /ai/chat/<id> address names, if it names one.
export function getAddressedConversationId(): string | undefined {
  // The bare /ai/chat route ends in "chat" — only a UUID is a conversation.
  const lastParam: string = Navigation.getLastParamAsString().replace("/", "");

  return lastParam && ObjectID.isValidUUID(lastParam) ? lastParam : undefined;
}

const AICopilot: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // Passed on once, however often the effect runs.
  const hasForwardedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (hasForwardedRef.current) {
      return;
    }

    hasForwardedRef.current = true;

    UiAnalytics.capture("dashboard/ai-copilot", {
      projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
    });

    const conversationId: string | undefined = getAddressedConversationId();

    openAskAi({
      ...(conversationId ? { conversationId: conversationId } : {}),
      isForwarded: true,
    });

    if (hasPageToGoBackTo()) {
      Navigation.goBack();
      return;
    }

    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      { replace: true },
    );
  }, []);

  return <></>;
};

export default AICopilot;
