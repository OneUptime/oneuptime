import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  AskAiEventRead,
  openAskAi,
  readAskAiEvent,
  takePendingAskAiRequest,
  toggleAskAi,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents";
import {
  getAddressedConversationId,
  hasPageToGoBackTo,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AICopilot/AICopilot";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * How the Dashboard opens Ask AI: one dialog, and one event every way in
 * sends (AskAiEvents). A plain toggle opens or closes it; a prompt opens a
 * new conversation with the question unsent; a conversation id opens that
 * conversation. And the chat's own address, which opens the dialog over
 * the page the person came from (Pages/AICopilot).
 */

const CONVERSATION_ID: string = "55555555-5555-4555-8555-555555555555";

function eventWith(detail: unknown): CustomEvent {
  return new CustomEvent(EventName.AI_CHAT_TOGGLE, { detail: detail });
}

afterEach(() => {
  // Nothing a test asked for waits for the next one.
  takePendingAskAiRequest();
  window.history.replaceState(null, "", "/");
});

describe("readAskAiEvent", () => {
  test("no detail is a plain toggle: open it, or close it when it is open", () => {
    expect(readAskAiEvent(undefined)).toEqual({ isToggle: true, request: {} });
    expect(readAskAiEvent(eventWith(null))).toEqual({
      isToggle: true,
      request: {},
    });
    expect(readAskAiEvent(eventWith({}))).toEqual({
      isToggle: true,
      request: {},
    });
  });

  test("open: true opens it and never closes it", () => {
    expect(readAskAiEvent(eventWith({ open: true }))).toEqual({
      isToggle: false,
      request: {},
    });
  });

  test("a prompt opens it, trimmed, for a new conversation", () => {
    expect(
      readAskAiEvent(eventWith({ prompt: "  Explain this error pattern.  " })),
    ).toEqual({
      isToggle: false,
      request: { prompt: "Explain this error pattern." },
    });
  });

  test("an empty prompt asks for nothing", () => {
    expect(readAskAiEvent(eventWith({ prompt: "   " }))).toEqual({
      isToggle: true,
      request: {},
    });
  });

  test("a conversation id opens that conversation", () => {
    expect(
      readAskAiEvent(eventWith({ conversationId: CONVERSATION_ID })),
    ).toEqual({
      isToggle: false,
      request: { conversationId: CONVERSATION_ID },
    });
  });

  test("an id that is not one is dropped, never requested", () => {
    for (const conversationId of ["chat", "../settings", 42, "", null]) {
      const read: AskAiEventRead = readAskAiEvent(
        eventWith({ conversationId: conversationId }),
      );

      expect({ conversationId, request: read.request }).toEqual({
        conversationId,
        request: {},
      });
    }
  });

  test("only what it knows is read: anything else a page put in is ignored", () => {
    expect(
      readAskAiEvent(
        eventWith({
          prompt: "Why?",
          isForwarded: "yes",
          permissionMode: "AutoRun",
          send: true,
        }),
      ),
    ).toEqual({ isToggle: false, request: { prompt: "Why?" } });
  });

  test("the chat's own address says it is passing the browser on", () => {
    expect(
      readAskAiEvent(eventWith({ open: true, isForwarded: true })),
    ).toEqual({ isToggle: false, request: { isForwarded: true } });
  });
});

describe("openAskAi and toggleAskAi", () => {
  let heard: Array<AskAiEventRead>;
  const listener: (event: CustomEvent) => void = (event: CustomEvent): void => {
    heard.push(readAskAiEvent(event));
  };

  beforeEach(() => {
    heard = [];
    GlobalEvents.addEventListener(EventName.AI_CHAT_TOGGLE, listener);
  });

  afterEach(() => {
    GlobalEvents.removeEventListener(EventName.AI_CHAT_TOGGLE, listener);
  });

  test("openAskAi opens it, never toggles it closed, and carries the request", () => {
    openAskAi({ conversationId: CONVERSATION_ID });
    openAskAi();

    expect(heard).toEqual([
      { isToggle: false, request: { conversationId: CONVERSATION_ID } },
      { isToggle: false, request: {} },
    ]);
  });

  test("toggleAskAi is the plain toggle the header and the keyboard send", () => {
    toggleAskAi();

    expect(heard).toEqual([{ isToggle: true, request: {} }]);
  });

  test("a request made before the dialog listens waits for it, and is taken once", () => {
    GlobalEvents.removeEventListener(EventName.AI_CHAT_TOGGLE, listener);

    openAskAi({ prompt: "What changed?" });

    expect(takePendingAskAiRequest()).toEqual({ prompt: "What changed?" });
    expect(takePendingAskAiRequest()).toBeNull();
  });

  test("the latest request is the one that waits", () => {
    openAskAi({ prompt: "First" });
    openAskAi({ conversationId: CONVERSATION_ID });

    expect(takePendingAskAiRequest()).toEqual({
      conversationId: CONVERSATION_ID,
    });
  });
});

describe("the chat's own address", () => {
  test("goes back only to a page of this app", () => {
    window.history.replaceState(null, "", "/");
    expect(hasPageToGoBackTo()).toBe(false);

    // Opened on its own: the first entry the router made.
    window.history.replaceState({ idx: 0 }, "", "/");
    expect(hasPageToGoBackTo()).toBe(false);

    window.history.replaceState({ idx: 3 }, "", "/");
    expect(hasPageToGoBackTo()).toBe(true);

    window.history.replaceState({ idx: "3" }, "", "/");
    expect(hasPageToGoBackTo()).toBe(false);
  });

  test("names a conversation only by its id", () => {
    const project: string = "11111111-1111-4111-8111-111111111111";

    window.history.replaceState(
      null,
      "",
      `/dashboard/${project}/ai/chat/${CONVERSATION_ID}`,
    );
    expect(getAddressedConversationId()).toBe(CONVERSATION_ID);

    // The bare address ends in "chat", which is no conversation.
    window.history.replaceState(null, "", `/dashboard/${project}/ai/chat`);
    expect(getAddressedConversationId()).toBeUndefined();

    window.history.replaceState(
      null,
      "",
      `/dashboard/${project}/ai/chat/not-a-conversation`,
    );
    expect(getAddressedConversationId()).toBeUndefined();
  });
});
