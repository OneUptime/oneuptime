// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  SentRequest,
  settle,
} from "../../UI/Utils/API/FakeAxiosServer";
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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import axios from "axios";
import type { Mock } from "jest-mock";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import {
  FORM_FOLLOW_UP_ADD_PERSON_ROUTE,
  FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE,
  FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE,
  FORM_FOLLOW_UP_REPLY_ROUTE,
  FORM_FOLLOW_UP_ROUTE,
  FORM_FOLLOW_UP_STOP_ROUTE,
  FORM_MY_REQUESTS_ROUTE,
  FormFollowUpAuthor,
  formatFormFollowUpCredential,
} from "../../../Types/Form/FormFollowUp";
import { JSONObject } from "../../../Types/JSON";
import { StateListType } from "../../../Utils/StateListType";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import FormFollowUpView from "../../../../App/FeatureSet/Accounts/src/Components/FormFollowUp/FormFollowUpView";
import { FormFollowUpView as FollowUpView } from "../../../../App/FeatureSet/Accounts/src/Utils/FormFollowUp";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

// The reply box's Markdown editor, as a plain text box.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownEditor", () => {
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      dataTestId?: string;
      onChange: (value: string) => void;
    }): ReactElement => {
      return (
        <textarea
          data-testid={props.dataTestId}
          defaultValue={props.initialValue}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            props.onChange(event.target.value);
          }}
        />
      );
    },
  };
});

/*
 * A form's follow-up on its own page (Accounts Components/FormFollowUp),
 * driven as the person following it drives it: the real view, its real
 * requests through the form page's client, and the real English locale -
 * only the network is a stand-in. One request: what it shows, a reply, a
 * person added, Stop following and the way back; and My requests, on a
 * form that asks its visitors to sign in.
 */

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";
const SUBMISSION_ID: string = "5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";
const FOLLOWER_ID: string = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CREDENTIAL: string = formatFormFollowUpCredential({
  followerId: FOLLOWER_ID,
  token: "ab".repeat(32),
});
const BASE_URL: string = `${DASHBOARD_ORIGIN}/api/form/public/${SHARE_KEY}`;

const REQUEST_URL: string = `${BASE_URL}${FORM_FOLLOW_UP_ROUTE}`;
const REPLY_URL: string = `${BASE_URL}${FORM_FOLLOW_UP_REPLY_ROUTE}`;
const PEOPLE_URL: string = `${BASE_URL}${FORM_FOLLOW_UP_ADD_PERSON_ROUTE}`;
const STOP_URL: string = `${BASE_URL}${FORM_FOLLOW_UP_STOP_ROUTE}`;
const MINE_URL: string = `${BASE_URL}${FORM_MY_REQUESTS_ROUTE}`;

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;
let server: FakeAxiosServer;
let onOpenView: Mock<(view: FollowUpView) => void>;
let onBackToForm: Mock<() => void>;

const JANE: JSONObject = {
  id: FOLLOWER_ID,
  email: "jane@example.com",
  name: "Jane",
  isSubmitter: true,
  isYou: true,
};

const aRequest: (overrides?: JSONObject) => JSONObject = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    submissionId: SUBMISSION_ID,
    formName: "Support",
    title: "Checkout fails",
    reference: "INC-42",
    submittedAt: "2026-11-20T10:00:00.000Z",
    state: { name: "Investigating", color: "#d97706", isClosed: false },
    answers: [{ label: "Which office are you in?", value: "Berlin" }],
    messages: [
      {
        id: "m1",
        createdAt: "2026-11-20T10:05:00.000Z",
        author: FormFollowUpAuthor.Team,
        authorName: "Sam Lee",
        isYou: false,
        text: "We are looking into it.",
        files: [],
      },
      {
        id: "m2",
        createdAt: "2026-11-20T10:07:00.000Z",
        author: FormFollowUpAuthor.Requester,
        authorName: "Jane",
        isYou: true,
        text: "",
        files: [{ name: "steps.txt", size: 12 }],
      },
    ],
    people: [JANE],
    you: JANE,
    canAddPeople: true,
    ...(overrides || {}),
  };
};

// Lets every answered request, and the renders it causes, finish.
async function flush(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await act(async () => {
      await settle();
    });
  }
}

async function renderView(
  view: FollowUpView,
  isSignInForm: boolean = false,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/accounts/form/${SHARE_KEY}`]}>
        <FormFollowUpView
          target={{ shareKey: SHARE_KEY }}
          view={view}
          isSignInForm={isSignInForm}
          onOpenView={onOpenView}
          onBackToForm={onBackToForm}
        />
      </MemoryRouter>,
    );
  });

  await flush();
}

async function openRequest(request: JSONObject = aRequest()): Promise<void> {
  server.on(HTTPMethod.POST, REQUEST_URL, [{ status: 200, data: request }]);

  await renderView({ kind: "request", access: { credential: CREDENTIAL } });

  await screen.findByTestId("form-request");
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });

  await flush();
}

function bodiesSentTo(url: string): Array<JSONObject> {
  return server
    .requestsTo(HTTPMethod.POST, url)
    .map((request: SentRequest): JSONObject => {
      return request.data as JSONObject;
    });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  server = new FakeAxiosServer(mockedAxios);
  onOpenView = jest.fn<(view: FollowUpView) => void>();
  onBackToForm = jest.fn<() => void>();
});

afterEach(() => {
  cleanup();
  mockedAxios.mockReset();
});

describe("a request", () => {
  test("opens with its link's credential, and nothing else", async () => {
    await openRequest();

    expect(bodiesSentTo(REQUEST_URL)).toEqual([
      { access: { credential: CREDENTIAL } },
    ]);
  });

  test("shows its title, number and state", async () => {
    await openRequest();

    expect(screen.getByTestId("form-request-title")).toHaveTextContent(
      "Checkout fails",
    );
    expect(screen.getByTestId("form-request-reference")).toHaveTextContent(
      "INC-42",
    );
    expect(screen.getByTestId("form-request-state")).toHaveTextContent(
      "Investigating",
    );
  });

  test("shows the conversation: the team by name, the reader as You, and the files sent", async () => {
    await openRequest();

    const team: HTMLElement = screen.getByTestId("form-request-message-m1");
    const mine: HTMLElement = screen.getByTestId("form-request-message-m2");

    expect(team).toHaveTextContent("Sam Lee");
    expect(team).toHaveTextContent("We are looking into it.");
    expect(mine).toHaveTextContent("You");
    expect(mine).toHaveTextContent("steps.txt");
  });

  test("names OneUptime's own state in the reader's language, and the project's own as written", async () => {
    await i18n.changeLanguage("de");

    await openRequest(
      aRequest({
        state: {
          name: "Resolved",
          list: StateListType.IncidentState,
          isClosed: true,
        },
      }),
    );

    expect(screen.getByTestId("form-request-state")).toHaveTextContent(
      "Behoben",
    );

    cleanup();

    await openRequest(
      aRequest({
        state: {
          name: "Open",
          list: StateListType.IncidentState,
          isClosed: false,
        },
      }),
    );

    expect(screen.getByTestId("form-request-state")).toHaveTextContent("Open");
  });

  test("names a state of an alert by the alert's own list", async () => {
    await i18n.changeLanguage("de");

    await openRequest(
      aRequest({
        state: { name: "Acknowledged", list: StateListType.AlertState },
      }),
    );

    expect(screen.getByTestId("form-request-state")).toHaveTextContent(
      "Bestätigt",
    );
  });

  test("says so when nobody has written yet", async () => {
    await openRequest(aRequest({ messages: [] }));

    expect(screen.getByTestId("form-request-no-messages")).toHaveTextContent(
      "No messages yet.",
    );
  });

  test("shows the people following it, and what was sent", async () => {
    await openRequest();

    const people: HTMLElement = screen.getByTestId("form-request-people-list");

    expect(people).toHaveTextContent("Jane");
    expect(people).toHaveTextContent("jane@example.com");
    expect(people).toHaveTextContent("Sent the form");
    expect(screen.getByTestId("form-request-answers")).toHaveTextContent(
      "Which office are you in?",
    );
    expect(screen.getByTestId("form-request-answers")).toHaveTextContent(
      "Berlin",
    );
  });

  test("says when it could not be opened, in the server's words, with the way back to the form", async () => {
    server.on(HTTPMethod.POST, REQUEST_URL, [
      { status: 404, data: { message: FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE } },
    ]);

    await renderView({ kind: "request", access: { credential: CREDENTIAL } });

    expect(
      await screen.findByTestId("form-request-load-failure"),
    ).toHaveTextContent(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);

    await click(screen.getByTestId("form-request-back"));

    expect(onBackToForm).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("form-request")).not.toBeInTheDocument();
  });

  test("on a form that asks its visitors to sign in, goes back to My requests", async () => {
    server.on(HTTPMethod.POST, REQUEST_URL, [
      { status: 200, data: aRequest() },
    ]);

    await renderView(
      { kind: "request", access: { submissionId: SUBMISSION_ID } },
      true,
    );

    expect(bodiesSentTo(REQUEST_URL)).toEqual([
      { access: { submissionId: SUBMISSION_ID } },
    ]);

    const back: HTMLElement = await screen.findByTestId("form-request-back");

    expect(back).toHaveTextContent("All my requests");

    await click(back);

    expect(onOpenView).toHaveBeenCalledWith({ kind: "mine" });
    expect(onBackToForm).not.toHaveBeenCalled();
  });
});

describe("a reply", () => {
  test("is sent with the request's access, and the conversation is the one the server answered with", async () => {
    await openRequest();

    server.on(HTTPMethod.POST, REPLY_URL, [
      {
        status: 200,
        data: aRequest({
          messages: [
            ...(aRequest()["messages"] as Array<JSONObject>),
            {
              id: "m3",
              createdAt: "2026-11-20T10:09:00.000Z",
              author: FormFollowUpAuthor.Requester,
              authorName: "Jane",
              isYou: true,
              text: "It fails again at payment.",
              files: [],
            },
          ],
        }),
      },
    ]);

    fireEvent.change(screen.getByTestId("form-request-reply-message"), {
      target: { value: "It fails again at payment." },
    });

    await click(screen.getByRole("button", { name: "Send" }));

    const sent: Array<JSONObject> = bodiesSentTo(REPLY_URL);

    expect(sent).toHaveLength(1);
    expect(sent[0]!["access"]).toEqual({ credential: CREDENTIAL });
    expect((sent[0]!["answers"] as JSONObject)["message"]).toBe(
      "It fails again at payment.",
    );

    expect(screen.getByTestId("form-request-message-m3")).toHaveTextContent(
      "It fails again at payment.",
    );
    // A fresh, empty box for the next message.
    expect(screen.getByTestId("form-request-reply-message")).toHaveValue("");
  });

  test("that is refused says why, in the server's words, and keeps what was written", async () => {
    await openRequest();

    server.on(HTTPMethod.POST, REPLY_URL, [
      {
        status: 400,
        data: { message: FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE },
      },
    ]);

    fireEvent.change(screen.getByTestId("form-request-reply-message"), {
      target: { value: "   " },
    });

    await click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByTestId("form-request-reply-error")).toHaveTextContent(
      FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE,
    );
    // Still the request, with its conversation.
    expect(screen.getByTestId("form-request-message-m1")).toBeInTheDocument();
  });
});

describe("adding a person", () => {
  test("asks for an email and a name, and shows them among the people following", async () => {
    await openRequest();

    server.on(HTTPMethod.POST, PEOPLE_URL, [
      {
        status: 200,
        data: aRequest({
          people: [
            JANE,
            {
              id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
              email: "sam@example.com",
              isSubmitter: false,
              isYou: false,
            },
          ],
        }),
      },
    ]);

    await click(screen.getByTestId("form-request-add-person"));

    const form: HTMLElement = screen.getByTestId("form-request-person-form");

    fireEvent.change(within(form).getByTestId("form-request-person-email"), {
      target: { value: " sam@example.com " },
    });

    await click(within(form).getByRole("button", { name: "Add" }));

    // Trimmed, and with no name when none was given.
    expect(bodiesSentTo(PEOPLE_URL)).toEqual([
      { access: { credential: CREDENTIAL }, email: "sam@example.com" },
    ]);
    expect(screen.getByTestId("form-request-people-list")).toHaveTextContent(
      "sam@example.com",
    );
    expect(
      screen.queryByTestId("form-request-person-form"),
    ).not.toBeInTheDocument();
  });

  test("is not offered once no more people can follow the request", async () => {
    await openRequest(aRequest({ canAddPeople: false }));

    expect(
      screen.queryByTestId("form-request-add-person"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("form-request")).toHaveTextContent(
      "No more people can follow this request.",
    );
  });
});

describe("Stop following", () => {
  test("asks first, and Cancel sends nothing", async () => {
    await openRequest();

    await click(screen.getByTestId("form-request-stop"));

    expect(screen.getByTestId("form-request-stop-confirm")).toHaveTextContent(
      "Stop following this request?",
    );

    await click(screen.getByTestId("form-request-stop-no"));

    expect(
      screen.queryByTestId("form-request-stop-confirm"),
    ).not.toBeInTheDocument();
    expect(bodiesSentTo(STOP_URL)).toEqual([]);
  });

  test("stops, says so, and leads back to the form", async () => {
    await openRequest();

    server.on(HTTPMethod.POST, STOP_URL, [{ status: 200, data: {} }]);

    await click(screen.getByTestId("form-request-stop"));
    await click(screen.getByTestId("form-request-stop-yes"));

    expect(bodiesSentTo(STOP_URL)).toEqual([
      { access: { credential: CREDENTIAL } },
    ]);
    expect(screen.getByTestId("form-request-stopped")).toHaveTextContent(
      "You no longer follow this request.",
    );

    await click(screen.getByRole("button", { name: "Back to the form" }));

    expect(onBackToForm).toHaveBeenCalledTimes(1);
  });
});

describe("My requests", () => {
  test("lists the requests the signed-in visitor follows, and opens one by its submission", async () => {
    server.on(HTTPMethod.GET, MINE_URL, [
      {
        status: 200,
        data: {
          formName: "Support",
          signedInAs: "jane@example.com",
          requests: [
            {
              submissionId: SUBMISSION_ID,
              title: "Checkout fails",
              reference: "INC-42",
              submittedAt: "2026-11-20T10:00:00.000Z",
              lastActivityAt: "2026-11-21T09:00:00.000Z",
              state: { name: "Investigating", isClosed: false },
            },
          ],
        },
      },
    ]);

    await renderView({ kind: "mine" }, true);

    expect(await screen.findByTestId("form-my-requests")).toHaveTextContent(
      "jane@example.com",
    );

    const row: HTMLElement = screen.getByTestId(
      `form-my-request-${SUBMISSION_ID}`,
    );

    expect(row).toHaveTextContent("INC-42");
    expect(row).toHaveTextContent("Checkout fails");

    await click(row);

    expect(onOpenView).toHaveBeenCalledWith({
      kind: "request",
      access: { submissionId: SUBMISSION_ID },
    });
  });

  test("says when there are none yet, and New request goes back to the form", async () => {
    server.on(HTTPMethod.GET, MINE_URL, [
      {
        status: 200,
        data: {
          formName: "Support",
          signedInAs: "jane@example.com",
          requests: [],
        },
      },
    ]);

    await renderView({ kind: "mine" }, true);

    expect(
      await screen.findByTestId("form-my-requests-empty"),
    ).toHaveTextContent("No requests yet.");

    await click(screen.getByTestId("form-new-request"));

    expect(onBackToForm).toHaveBeenCalledTimes(1);
  });

  test("says when they could not be loaded, with the way back to the form", async () => {
    server.on(HTTPMethod.GET, MINE_URL, [{ status: 500, data: {} }]);

    await renderView({ kind: "mine" }, true);

    expect(
      await screen.findByTestId("form-my-requests-error"),
    ).toHaveTextContent(
      "This request could not be loaded. Please try again in a few minutes.",
    );
  });
});
