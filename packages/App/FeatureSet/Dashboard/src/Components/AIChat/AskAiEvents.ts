import EventName from "../../Utils/EventName";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";

/*
 * How the rest of the Dashboard opens Ask AI.
 *
 * Ask AI is one dialog, mounted once for the whole app (AskAiDialog). Every
 * way in - the header's Ask AI, Ctrl/Cmd + I, the command palette, an
 * "Explain with AI" or "Ask about this case" on a page, the chat's own
 * address under Products -> AI -> Chat - reaches it through the
 * AI_CHAT_TOGGLE event:
 *
 *   - no detail: open it, or close it when it is open (the header button
 *     and the keyboard);
 *   - a prompt: open it on a new conversation with this question in the
 *     composer, unsent, so the person reads it first;
 *   - a conversationId: open it on that conversation.
 *
 * A request is also kept until the dialog reads it, so one made before the
 * dialog is listening (the chat's address, opened on its own) is not lost.
 */
export interface AskAiRequest {
  // A question for the composer of a new conversation, left unsent.
  prompt?: string | undefined;
  // The conversation to open.
  conversationId?: string | undefined;
  /*
   * The chat's own address asked, and is passing the browser on to the
   * page underneath: that navigation is not the person leaving the dialog.
   */
  isForwarded?: boolean | undefined;
}

export interface AskAiEventRead {
  // A plain toggle: no detail asked for anything in particular.
  isToggle: boolean;
  request: AskAiRequest;
}

let pendingRequest: AskAiRequest | null = null;

// Opens Ask AI (never closes it), as the request asks.
export function openAskAi(request: AskAiRequest = {}): void {
  pendingRequest = { ...request };

  GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, {
    ...request,
    open: true,
  } as JSONObject);
}

// Opens Ask AI, or closes it when it is open.
export function toggleAskAi(): void {
  GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE);
}

// The request made before the dialog read it, once.
export function takePendingAskAiRequest(): AskAiRequest | null {
  const request: AskAiRequest | null = pendingRequest;
  pendingRequest = null;
  return request;
}

function readText(detail: Record<string, unknown>, key: string): string {
  const value: unknown = detail[key];
  return typeof value === "string" ? value.trim() : "";
}

/*
 * What an AI_CHAT_TOGGLE event asks for. Anything a page put in the detail
 * other than these is ignored, and a conversation id that is not one is
 * dropped rather than requested.
 */
export function readAskAiEvent(event: CustomEvent | undefined): AskAiEventRead {
  const detail: Record<string, unknown> =
    event?.detail && typeof event.detail === "object"
      ? (event.detail as Record<string, unknown>)
      : {};

  const prompt: string = readText(detail, "prompt");
  const conversationId: string = readText(detail, "conversationId");
  const request: AskAiRequest = {
    ...(prompt ? { prompt: prompt } : {}),
    ...(conversationId && ObjectID.isValidUUID(conversationId)
      ? { conversationId: conversationId }
      : {}),
    ...(detail["isForwarded"] === true ? { isForwarded: true } : {}),
  };

  return {
    isToggle:
      detail["open"] !== true && !request.prompt && !request.conversationId,
    request: request,
  };
}
