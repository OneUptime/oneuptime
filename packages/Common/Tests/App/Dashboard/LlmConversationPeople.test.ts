import { describe, expect, test } from "@jest/globals";
import {
  getLlmConversationPeople,
  getLlmConversationRowPerson,
  getLlmConversationSpeaker,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationPeople";
import { LLM_USAGE_HIDDEN_GROUP_KEY } from "../../../Types/Telemetry/LlmUsageApi";

/*
 * WHO A CONVERSATION WAS WITH, AS ITS PAGES SAY IT (#10631).
 *
 * The server names each call's person past what a scrub rule left, and
 * everyone a rule hid as the one hidden key. These pin what the list's row,
 * the conversation's header and its transcript make of those people: a
 * name is a name, anyone hidden is said once as hidden, and nothing a rule
 * left - from this server or one that read people before #10631 - is ever
 * taken for a name.
 */

const H: string = LLM_USAGE_HIDDEN_GROUP_KEY;

describe("a conversation's people", () => {
  test("are its names, in the server's order, each once", () => {
    expect(
      getLlmConversationPeople(["ada@example.com", "u-7", "ada@example.com"]),
    ).toEqual({ names: ["ada@example.com", "u-7"], hasHidden: false });
  });

  test("say once that a scrub rule hid someone, however many it hid", () => {
    expect(getLlmConversationPeople([H, "u-7", H])).toEqual({
      names: ["u-7"],
      hasHidden: true,
    });
  });

  // What a server that read the person before #10631 answered.
  test.each([
    ["[REDACTED]"],
    ["j***@***.com"],
    ["[HASHED:3f9a1c0e7b2d4a68]"],
    ["auth0|[HASHED:3f9a1c0e]"],
  ])("take what a rule left, %s, for someone hidden", (placeholder: string) => {
    expect(getLlmConversationPeople([placeholder])).toEqual({
      names: [],
      hasHidden: true,
    });
  });

  test("leave out blanks, and trim a name", () => {
    expect(getLlmConversationPeople(["", "  ", " u-7 "])).toEqual({
      names: ["u-7"],
      hasHidden: false,
    });
    expect(getLlmConversationPeople([])).toEqual({
      names: [],
      hasHidden: false,
    });
  });
});

describe("the person a list row names", () => {
  test("is someone named, ahead of anyone hidden", () => {
    expect(getLlmConversationRowPerson([H, "ada@example.com"])).toEqual({
      name: "ada@example.com",
      isHidden: false,
    });
  });

  test("is hidden when a rule hid everyone in the conversation", () => {
    expect(getLlmConversationRowPerson([H])).toEqual({
      name: "",
      isHidden: true,
    });
    expect(getLlmConversationRowPerson(["j***@***.com"])).toEqual({
      name: "",
      isHidden: true,
    });
  });

  // Unknown and withheld are told apart.
  test("is nobody when the conversation names nobody", () => {
    expect(getLlmConversationRowPerson([])).toEqual({
      name: "",
      isHidden: false,
    });
  });
});

describe("who speaks the person's messages", () => {
  test("is the conversation's person when nobody in it was hidden", () => {
    expect(getLlmConversationSpeaker(["u-7"])).toBe("u-7");
    expect(getLlmConversationSpeaker(["ada@example.com", "u-7"])).toBe(
      "ada@example.com",
    );
  });

  /*
   * A message is not tied to the call that sent it: once a rule hid anyone
   * in a conversation, any message could be theirs, so none is put to a
   * name - the transcript says "User".
   */
  test("is nobody, so 'User', once a rule hid anyone in the conversation", () => {
    expect(getLlmConversationSpeaker([H])).toBe("");
    expect(getLlmConversationSpeaker(["ada@example.com", H])).toBe("");
    expect(getLlmConversationSpeaker([H, "ada@example.com"])).toBe("");
    expect(getLlmConversationSpeaker(["[HASHED:3f9a1c0e7b2d4a68]"])).toBe("");
  });

  test("is nobody when the conversation names nobody", () => {
    expect(getLlmConversationSpeaker([])).toBe("");
  });
});
