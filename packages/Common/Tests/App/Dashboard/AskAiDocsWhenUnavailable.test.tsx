import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import AIChatUnavailableView from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatUnavailableView";
import AIChatUnavailableReason from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatAvailability";
import AskAiDocsResults, {
  DOCS_RESULTS_IN_PLACE_OF_ASK_AI,
  DOCS_RESULTS_UNDER_AN_ANSWER,
  MAX_DOCS_QUESTION_CHARS,
  toDocsQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiDocsResults";
import ChatMessageList from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatMessageList";
import AIConversationMessage from "../../../Models/DatabaseModels/AIConversationMessage";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DOCS_URL } from "../../../UI/Config";
import ProductEvents from "../../../UI/Utils/ProductEvents";

/*
 * WHEN ASK AI CANNOT ANSWER, THE PERSON STILL GETS HELP (#7063).
 *
 * Ask AI cannot answer when the plan leaves AI out, when AI is switched
 * off for the project, when no LLM provider is set up, when a daily limit
 * or the AI credits are used up, when the provider fails, and when the
 * server will not take a question (too busy, a subscription unpaid). Each
 * said why, and that was all. Now the question is also looked up in the
 * docs - the installation's own search, the one Search and the docs' box
 * ask - and the results open their pages in a new tab, above why Ask AI
 * is not answering when it is unavailable, and under the failed answer or
 * the refusal otherwise.
 */

const DOCS: string = DOCS_URL.toString().replace(/\/$/, "");

const RESULT_METHODS: JSONObject = {
  title: "Notification Methods",
  where: "Notifications › Notification Methods",
  url: "/docs/en/notifications/notification-methods",
  isSection: false,
};

const RESULT_GUIDE: JSONObject = {
  title: "Get paged when something breaks",
  where: "Guides",
  url: "/docs/en/guides/paging#text-me",
  isSection: true,
};

let asked: Array<string> = [];
let sent: Array<{ name: ProductEventName; properties: JSONObject }> = [];

// The docs search answers with these results, or fails.
const docsAnswer: (results: Array<JSONObject> | "fails") => void = (
  results: Array<JSONObject> | "fails",
): void => {
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: unknown): Promise<unknown> => {
      asked.push(String(url));

      if (results === "fails") {
        throw new Error("The docs could not be reached.");
      }

      return {
        ok: true,
        json: async (): Promise<unknown> => {
          return { query: "x", words: [], results };
        },
      };
    },
  );
};

beforeEach(() => {
  asked = [];
  sent = [];
  jest
    .spyOn(ProductEvents, "send")
    .mockImplementation(
      (name: ProductEventName, properties?: JSONObject): void => {
        sent.push({ name, properties: properties || {} });
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
});

// The question a search asked for, as the docs search's address carries it.
const questionOf: (url: string) => string = (url: string): string => {
  return new globalThis.URL(url).searchParams.get("q") || "";
};

describe("the docs Ask AI shows in its place", () => {
  test("looks the question up at once, and opens each result in a new tab", async () => {
    docsAnswer([RESULT_METHODS, RESULT_GUIDE]);

    render(
      <AskAiDocsResults
        question="How do I get a text when my site is down?"
        isInPlaceOfAskAi={true}
      />,
    );

    const links: Array<HTMLElement> = await screen.findAllByTestId(
      "ask-ai-docs-result",
    );

    expect(asked).toHaveLength(1);
    expect(questionOf(asked[0]!)).toBe(
      "How do I get a text when my site is down?",
    );
    expect(asked[0]).toContain(`limit=${DOCS_RESULTS_IN_PLACE_OF_ASK_AI}`);
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      `${DOCS}/en/notifications/notification-methods`,
    );
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[0]).toHaveTextContent("Notification Methods");
    expect(links[0]).toHaveTextContent("Notifications › Notification Methods");
    expect(screen.getByText("Find it in the docs")).toBeInTheDocument();
    // The box holds the question, to search again with other words.
    expect(screen.getByTestId("ask-ai-docs-search")).toHaveValue(
      "How do I get a text when my site is down?",
    );
  });

  test("a result opened says which docs page Ask AI sent the person to, and nothing of the question", async () => {
    docsAnswer([RESULT_METHODS]);

    render(
      <AskAiDocsResults
        question="How do I get a text when my site is down?"
        isInPlaceOfAskAi={true}
      />,
    );

    fireEvent.click(await screen.findByTestId("ask-ai-docs-result"));

    expect(sent).toEqual([
      {
        name: ProductEventName.DocsLinkOpened,
        properties: {
          page: "notifications/notification-methods",
          source: "ask_ai_unavailable",
        },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain("text");
  });

  test("with no question, searches nothing until one is typed", async () => {
    docsAnswer([RESULT_METHODS]);

    render(<AskAiDocsResults question="" isInPlaceOfAskAi={true} />);

    expect(asked).toEqual([]);
    expect(screen.queryByTestId("ask-ai-docs-result")).toBeNull();
    expect(screen.queryByTestId("ask-ai-docs-no-match")).toBeNull();

    fireEvent.change(screen.getByTestId("ask-ai-docs-search"), {
      target: { value: "add a phone number" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByTestId("ask-ai-docs-result")).toBeInTheDocument();
    expect(questionOf(asked[0]!)).toBe("add a phone number");
  });

  test("says when no page matches, and when the docs could not be read", async () => {
    docsAnswer([]);

    render(
      <AskAiDocsResults question="zzqx flux capacitor" isInPlaceOfAskAi={true} />,
    );

    expect(await screen.findByTestId("ask-ai-docs-no-match")).toHaveTextContent(
      "No docs page matches this. Try other words.",
    );

    cleanup();
    docsAnswer("fails");

    render(
      <AskAiDocsResults question="add a phone number" isInPlaceOfAskAi={true} />,
    );

    expect(
      await screen.findByTestId("ask-ai-docs-no-match"),
    ).toBeInTheDocument();
  });

  test("asks with the question on one line, cut short", () => {
    expect(toDocsQuestion("  How do I\n\nadd   a number?  ")).toBe(
      "How do I add a number?",
    );
    expect(toDocsQuestion("x".repeat(500))).toHaveLength(
      MAX_DOCS_QUESTION_CHARS,
    );
  });
});

describe("the docs under an answer or a question Ask AI could not answer", () => {
  test("its first results, under a heading of its own", async () => {
    docsAnswer([RESULT_METHODS, RESULT_GUIDE]);

    render(<AskAiDocsResults question="How do I add a phone number?" />);

    expect(await screen.findAllByTestId("ask-ai-docs-result")).toHaveLength(2);
    expect(asked[0]).toContain(`limit=${DOCS_RESULTS_UNDER_AN_ANSWER}`);
    expect(screen.getByText("From the docs")).toBeInTheDocument();
    // No box: the composer is there to ask again.
    expect(screen.queryByTestId("ask-ai-docs-search")).toBeNull();
  });

  test("nothing at all when no page matches: the reason above it is said already", async () => {
    docsAnswer([]);

    const { container } = render(
      <AskAiDocsResults question="zzqx flux capacitor" />,
    );

    await waitFor(() => {
      expect(asked).toHaveLength(1);
    });
    expect(container).toBeEmptyDOMElement();
  });
});

/*
 * EACH WAY ASK AI IS UNAVAILABLE BEFORE A QUESTION IS SENT: the plan, AI
 * switched off for the project, no LLM provider. The docs come first, for
 * the question Ask AI was opened with, then why it is not answering and
 * what turns it on.
 */
describe("Ask AI unavailable: the docs, above why", () => {
  test.each(
    Object.values(AIChatUnavailableReason) as Array<AIChatUnavailableReason>,
  )("%s", async (reason: AIChatUnavailableReason) => {
    docsAnswer([RESULT_METHODS]);

    render(
      <MemoryRouter>
        <AIChatUnavailableView
          reason={reason}
          question="How do I get a text when my site is down?"
        />
      </MemoryRouter>,
    );

    const result: HTMLElement = await screen.findByTestId("ask-ai-docs-result");
    const why: HTMLElement = screen.getByTestId("ask-ai-unavailable-reason");

    expect(questionOf(asked[0]!)).toBe(
      "How do I get a text when my site is down?",
    );
    // The docs come before the reason.
    expect(
      result.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Why, and what to do about it, are still said.
    expect(why).toHaveAttribute("role", "status");
    expect(why.querySelector("h3")?.textContent?.trim()).toBeTruthy();
    expect(why.querySelector("a")).not.toBeNull();
  });
});

/*
 * EACH WAY AN ANSWER FAILS ONCE ASKED: a daily limit, the AI credits used
 * up, the provider down or refusing. The failed answer says why and offers
 * Try again, as before, and under it the docs for its question - only for
 * the latest answer, so an old conversation searches nothing again.
 */
const message: (data: {
  role: AIChatMessageRole;
  content?: string;
  status: AIChatMessageStatus;
  errorMessage?: string;
}) => AIConversationMessage = (data: {
  role: AIChatMessageRole;
  content?: string;
  status: AIChatMessageStatus;
  errorMessage?: string;
}): AIConversationMessage => {
  const item: AIConversationMessage = new AIConversationMessage();
  item.id = ObjectID.generate();
  item.role = data.role;
  item.status = data.status;
  if (data.content) {
    item.contentInMarkdown = data.content;
  }
  if (data.errorMessage) {
    item.errorMessage = data.errorMessage;
  }
  item.createdAt = new Date();
  return item;
};

describe("an answer Ask AI could not give: why, and the docs under it", () => {
  test.each([
    "OneUptime AI has reached this project's daily limit of 200 AI requests. OneUptime AI starts again at midnight UTC.",
    "This project's OneUptime AI credits are used up. A Project Owner can add credits under Project Settings > Billing.",
    "The LLM provider did not answer. Try again in a moment.",
    "The LLM provider refused the request: the API key is not valid.",
  ])("%s", async (errorMessage: string) => {
    docsAnswer([RESULT_METHODS]);

    render(
      <ChatMessageList
        messages={[
          message({
            role: AIChatMessageRole.User,
            content: "How do I get a text when my site is down?",
            status: AIChatMessageStatus.Completed,
          }),
          message({
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Error,
            errorMessage,
          }),
        ]}
        isSubmittingApproval={false}
        onRespondToApproval={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
    expect(screen.getByTestId("ai-chat-retry")).toBeInTheDocument();
    expect(await screen.findByTestId("ask-ai-docs-result")).toHaveTextContent(
      "Notification Methods",
    );
    expect(questionOf(asked[0]!)).toBe(
      "How do I get a text when my site is down?",
    );
  });

  test("an earlier answer that failed searches nothing again", async () => {
    docsAnswer([RESULT_METHODS]);

    render(
      <ChatMessageList
        messages={[
          message({
            role: AIChatMessageRole.User,
            content: "How do I get a text when my site is down?",
            status: AIChatMessageStatus.Completed,
          }),
          message({
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Error,
            errorMessage: "The LLM provider did not answer.",
          }),
          message({
            role: AIChatMessageRole.User,
            content: "Thanks",
            status: AIChatMessageStatus.Completed,
          }),
          message({
            role: AIChatMessageRole.Assistant,
            content: "You're welcome.",
            status: AIChatMessageStatus.Completed,
          }),
        ]}
        isSubmittingApproval={false}
        onRespondToApproval={() => {}}
      />,
    );

    expect(screen.getByText("The LLM provider did not answer.")).toBeInTheDocument();
    expect(asked).toEqual([]);
    expect(screen.queryByTestId("ask-ai-docs-results")).toBeNull();
  });
});

/*
 * A QUESTION THE SERVER WOULD NOT TAKE (too busy, a subscription unpaid):
 * its error is said in the composer's banner, and the docs for it under
 * the banner, while that error is shown.
 */
describe("a refused question, wired", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/AIChat",
        file,
      ),
      "utf8",
    );
  };

  test("the chat keeps the question the server refused, with the error it refused it with", () => {
    const chat: string = read("useAiChat.ts");

    expect(chat).toContain(
      "setRefused({ question: content, error: refusal });",
    );
    expect(chat).toContain(
      "refused && error && refused.error === error ? refused.question : \"\"",
    );
    expect(chat).toContain("setRefused(null);");
  });

  test("the panel draws its docs under the error, and the question Ask AI was opened with in its place", () => {
    const panel: string = read("AskAiPanel.tsx");

    expect(panel).toContain("question={chat.refusedQuestion}");
    expect(panel).toContain("question={chat.inputValue}");
  });
});
