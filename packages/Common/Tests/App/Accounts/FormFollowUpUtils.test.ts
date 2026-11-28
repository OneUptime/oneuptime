// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  SentRequest,
} from "../../UI/Utils/API/FakeAxiosServer";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import { getFormCustomDomainApiUrl } from "../../../Types/Form/FormCustomDomain";
import {
  FORM_FOLLOW_UP_ADD_PERSON_ROUTE,
  FORM_FOLLOW_UP_PARAMETER,
  FORM_FOLLOW_UP_REPLY_ROUTE,
  FORM_FOLLOW_UP_ROUTE,
  FORM_FOLLOW_UP_STOP_ROUTE,
  FORM_MY_REQUESTS_PARAMETER,
  FORM_MY_REQUESTS_ROUTE,
  FORM_REQUEST_PARAMETER,
  FormFollowUpAuthor,
  PublicFormMyRequests,
  PublicFormRequest,
  formatFormFollowUpCredential,
} from "../../../Types/Form/FormFollowUp";
import {
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
} from "../../../Types/Form/FormPublic";
import { JSONObject } from "../../../Types/JSON";
import {
  FormFollowUpView,
  addPersonToFormRequest,
  getFormFollowUpUrl,
  getSubmissionFollowUpView,
  keepFormFollowUpView,
  loadFormRequest,
  loadMyFormRequests,
  readPublicFormMyRequests,
  readPublicFormRequest,
  sendFormRequestReply,
  stopFollowingFormRequest,
  takeFormFollowUpView,
} from "../../../../App/FeatureSet/Accounts/src/Utils/FormFollowUp";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * A form's follow-ups on its own page, without drawing anything
 * (Accounts Utils/FormFollowUp): which view an address opens, and that a
 * link's credential never stays in it; what the page keeps for a reload;
 * the requests it sends, through the form page's own client; and what it
 * believes of the server's answers - a request it cannot read is one that
 * could not be loaded, never one drawn half-way.
 */

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";
const OTHER_SHARE_KEY: string = "1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b";
const SUBMISSION_ID: string = "5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";
const FOLLOWER_ID: string = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CREDENTIAL: string = formatFormFollowUpCredential({
  followerId: FOLLOWER_ID,
  token: "ab".repeat(32),
});
const FORM_PATH: string = `/accounts/form/${SHARE_KEY}`;
const BASE_URL: string = `${DASHBOARD_ORIGIN}/api/form/public/${SHARE_KEY}`;

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;
let server: FakeAxiosServer;

const openAt: (address: string) => void = (address: string): void => {
  window.history.replaceState(null, "", address);
};

const you: JSONObject = {
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
    answers: [{ label: "What is wrong?", value: "Checkout fails" }],
    messages: [
      {
        id: "m1",
        createdAt: "2026-11-20T10:05:00.000Z",
        author: FormFollowUpAuthor.Team,
        authorName: "Sam",
        isYou: false,
        text: "<p>Looking into it.</p>",
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
    people: [you],
    you: you,
    canAddPeople: true,
    ...(overrides || {}),
  };
};

const onlyRequest: (method: HTTPMethod, url: string) => SentRequest = (
  method: HTTPMethod,
  url: string,
): SentRequest => {
  const sent: Array<SentRequest> = server.requestsTo(method, url);

  expect(sent).toHaveLength(1);

  return sent[0]!;
};

beforeEach(() => {
  window.sessionStorage.clear();
  openAt(FORM_PATH);
  server = new FakeAxiosServer(mockedAxios);
});

afterEach(() => {
  jest.restoreAllMocks();
  mockedAxios.mockReset();
});

describe("takeFormFollowUpView", () => {
  test("opens the request a link's credential names, and takes the credential out of the address", () => {
    openAt(`${FORM_PATH}?${FORM_FOLLOW_UP_PARAMETER}=${CREDENTIAL}`);

    expect(takeFormFollowUpView(SHARE_KEY)).toEqual({
      kind: "request",
      access: { credential: CREDENTIAL },
    });
    expect(window.location.pathname).toBe(FORM_PATH);
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(CREDENTIAL);
  });

  test("keeps every other part of the address as it was", () => {
    openAt(
      `${FORM_PATH}?template=outage&${FORM_FOLLOW_UP_PARAMETER}=${CREDENTIAL}#top`,
    );

    takeFormFollowUpView(SHARE_KEY);

    expect(window.location.search).toBe("?template=outage");
    expect(window.location.hash).toBe("#top");
  });

  test("replaces the address rather than adding one, so Back never returns to the credential", () => {
    const lengthBefore: number = window.history.length;

    openAt(`${FORM_PATH}?${FORM_FOLLOW_UP_PARAMETER}=${CREDENTIAL}`);
    takeFormFollowUpView(SHARE_KEY);

    expect(window.history.length).toBe(lengthBefore);
  });

  test("opens a signed-in visitor's request by its submission", () => {
    openAt(`${FORM_PATH}?${FORM_REQUEST_PARAMETER}=${SUBMISSION_ID}`);

    expect(takeFormFollowUpView(SHARE_KEY)).toEqual({
      kind: "request",
      access: { submissionId: SUBMISSION_ID },
    });
    expect(window.location.search).toBe("");
  });

  test("opens My requests for its parameter, whatever its value", () => {
    openAt(`${FORM_PATH}?${FORM_MY_REQUESTS_PARAMETER}=1`);

    expect(takeFormFollowUpView(SHARE_KEY)).toEqual({ kind: "mine" });
    expect(window.location.search).toBe("");
  });

  test.each([
    [
      "a credential cut short",
      `${FORM_FOLLOW_UP_PARAMETER}=${CREDENTIAL.slice(0, -1)}`,
    ],
    ["a credential that is no credential", `${FORM_FOLLOW_UP_PARAMETER}=hello`],
    ["an empty credential", `${FORM_FOLLOW_UP_PARAMETER}=`],
    ["a submission that is no id", `${FORM_REQUEST_PARAMETER}=../../admin`],
  ])(
    "opens nothing for %s, and still takes it out of the address",
    (_name: string, query: string) => {
      openAt(`${FORM_PATH}?${query}`);

      expect(takeFormFollowUpView(SHARE_KEY)).toBeNull();
      expect(window.location.search).toBe("");
    },
  );

  test("opens nothing for an address with no follow-up in it", () => {
    openAt(`${FORM_PATH}?template=outage`);

    expect(takeFormFollowUpView(SHARE_KEY)).toBeNull();
    expect(window.location.search).toBe("?template=outage");
  });

  test("keeps the view for a reload of the same form, in this tab", () => {
    openAt(`${FORM_PATH}?${FORM_FOLLOW_UP_PARAMETER}=${CREDENTIAL}`);
    takeFormFollowUpView(SHARE_KEY);

    // The reload: the credential is no longer in the address.
    expect(takeFormFollowUpView(SHARE_KEY)).toEqual({
      kind: "request",
      access: { credential: CREDENTIAL },
    });
  });

  test("keeps each form's view apart", () => {
    openAt(`${FORM_PATH}?${FORM_FOLLOW_UP_PARAMETER}=${CREDENTIAL}`);
    takeFormFollowUpView(SHARE_KEY);

    expect(takeFormFollowUpView(OTHER_SHARE_KEY)).toBeNull();
  });

  test("forgets the view once the page goes back to the form", () => {
    openAt(`${FORM_PATH}?${FORM_MY_REQUESTS_PARAMETER}=1`);
    takeFormFollowUpView(SHARE_KEY);

    keepFormFollowUpView(SHARE_KEY, null);

    expect(takeFormFollowUpView(SHARE_KEY)).toBeNull();
  });

  test.each([
    ["text that is no JSON", "{not json"],
    ["a view of no kind it knows", JSON.stringify({ kind: "admin" })],
    [
      "a request with a credential that is no credential",
      JSON.stringify({ kind: "request", access: { credential: "x" } }),
    ],
    [
      "a request with a submission that is no id",
      JSON.stringify({ kind: "request", access: { submissionId: "x" } }),
    ],
    ["a list", JSON.stringify([{ kind: "mine" }])],
  ])(
    "opens nothing for a kept view that is %s",
    (_name: string, kept: string) => {
      window.sessionStorage.setItem(
        `oneuptime-form-follow-up:${SHARE_KEY}`,
        kept,
      );

      expect(takeFormFollowUpView(SHARE_KEY)).toBeNull();
    },
  );

  test("still opens the address's view when the tab keeps nothing", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    openAt(`${FORM_PATH}?${FORM_FOLLOW_UP_PARAMETER}=${CREDENTIAL}`);

    expect(takeFormFollowUpView(SHARE_KEY)).toEqual({
      kind: "request",
      access: { credential: CREDENTIAL },
    });
    expect(takeFormFollowUpView(SHARE_KEY)).toBeNull();
  });
});

describe("getSubmissionFollowUpView", () => {
  test("opens the request by its credential, on a form anybody can open", () => {
    expect(
      getSubmissionFollowUpView({
        credential: CREDENTIAL,
        emailedTo: "jane@example.com",
      }),
    ).toEqual({ kind: "request", access: { credential: CREDENTIAL } });
  });

  test("opens it by its submission, on a form that asks its visitors to sign in", () => {
    expect(getSubmissionFollowUpView({ submissionId: SUBMISSION_ID })).toEqual({
      kind: "request",
      access: { submissionId: SUBMISSION_ID },
    });
  });

  test("prefers the credential when it has both", () => {
    const view: FormFollowUpView = getSubmissionFollowUpView({
      credential: CREDENTIAL,
      submissionId: SUBMISSION_ID,
    });

    expect(view).toEqual({
      kind: "request",
      access: { credential: CREDENTIAL },
    });
  });
});

describe("getFormFollowUpUrl", () => {
  test("hangs off the form's link", () => {
    expect(
      getFormFollowUpUrl(
        { shareKey: SHARE_KEY },
        FORM_FOLLOW_UP_ROUTE,
      ).toString(),
    ).toBe(`${BASE_URL}${FORM_FOLLOW_UP_ROUTE}`);
    expect(
      getFormFollowUpUrl(
        { shareKey: SHARE_KEY },
        FORM_MY_REQUESTS_ROUTE,
      ).toString(),
    ).toBe(`${BASE_URL}${FORM_MY_REQUESTS_ROUTE}`);
  });

  test("on the form's own domain, goes to that domain and names no key", () => {
    const url: string = getFormFollowUpUrl(
      { shareKey: null },
      FORM_FOLLOW_UP_REPLY_ROUTE,
    ).toString();

    expect(url).toBe(
      `${getFormCustomDomainApiUrl(window.location.origin)}${FORM_FOLLOW_UP_REPLY_ROUTE}`,
    );
    expect(url).not.toContain(SHARE_KEY);
  });
});

describe("the requests the page sends", () => {
  const URL_OF: (route: string) => string = (route: string): string => {
    return `${BASE_URL}${route}`;
  };

  test("loads a request with its access, and the form page's own header", async () => {
    server.on(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_ROUTE), [
      { status: 200, data: aRequest() },
    ]);

    const request: PublicFormRequest = await loadFormRequest(
      { shareKey: SHARE_KEY },
      { credential: CREDENTIAL },
    );

    const sent: SentRequest = onlyRequest(
      HTTPMethod.POST,
      URL_OF(FORM_FOLLOW_UP_ROUTE),
    );

    expect(sent.data).toEqual({ access: { credential: CREDENTIAL } });
    expect(sent.headers[FORM_PAGE_HEADER]).toBe(FORM_PAGE_HEADER_VALUE);
    // Never another project's, or the visitor's own.
    expect(sent.headers["tenantid"]).toBe("");
    expect(request.title).toBe("Checkout fails");
  });

  test("sends a reply's answers as the reply box packed them", async () => {
    server.on(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_REPLY_ROUTE), [
      { status: 200, data: aRequest() },
    ]);

    await sendFormRequestReply({
      target: { shareKey: SHARE_KEY },
      access: { submissionId: SUBMISSION_ID },
      answers: { message: "It fails again." },
    });

    expect(
      onlyRequest(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_REPLY_ROUTE)).data,
    ).toEqual({
      access: { submissionId: SUBMISSION_ID },
      answers: { message: "It fails again." },
    });
  });

  test("adds a person by email, with a name only when one was given", async () => {
    server.on(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_ADD_PERSON_ROUTE), [
      { status: 200, data: aRequest() },
      { status: 200, data: aRequest() },
    ]);

    await addPersonToFormRequest({
      target: { shareKey: SHARE_KEY },
      access: { credential: CREDENTIAL },
      email: "sam@example.com",
      name: "Sam",
    });
    await addPersonToFormRequest({
      target: { shareKey: SHARE_KEY },
      access: { credential: CREDENTIAL },
      email: "kim@example.com",
      name: "",
    });

    expect(
      server
        .requestsTo(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_ADD_PERSON_ROUTE))
        .map((request: SentRequest): unknown => {
          return request.data;
        }),
    ).toEqual([
      {
        access: { credential: CREDENTIAL },
        email: "sam@example.com",
        name: "Sam",
      },
      { access: { credential: CREDENTIAL }, email: "kim@example.com" },
    ]);
  });

  test("stops following with nothing but the access", async () => {
    server.on(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_STOP_ROUTE), [
      { status: 200, data: {} },
    ]);

    await stopFollowingFormRequest({
      target: { shareKey: SHARE_KEY },
      access: { credential: CREDENTIAL },
    });

    expect(
      onlyRequest(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_STOP_ROUTE)).data,
    ).toEqual({ access: { credential: CREDENTIAL } });
  });

  test("reads My requests with a GET, which sends no access at all", async () => {
    server.on(HTTPMethod.GET, URL_OF(FORM_MY_REQUESTS_ROUTE), [
      {
        status: 200,
        data: {
          formName: "Support",
          signedInAs: "jane@example.com",
          requests: [],
        },
      },
    ]);

    const mine: PublicFormMyRequests = await loadMyFormRequests({
      shareKey: SHARE_KEY,
    });

    expect(mine.signedInAs).toBe("jane@example.com");
    expect(
      onlyRequest(HTTPMethod.GET, URL_OF(FORM_MY_REQUESTS_ROUTE)).headers[
        FORM_PAGE_HEADER
      ],
    ).toBe(FORM_PAGE_HEADER_VALUE);
  });

  test("throws the server's refusal as it came, for the page to word", async () => {
    server.on(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_ROUTE), [
      { status: 404, data: { error: "This request is not available." } },
    ]);

    const refusal: unknown = await loadFormRequest(
      { shareKey: SHARE_KEY },
      { credential: CREDENTIAL },
    ).catch((error: unknown) => {
      return error;
    });

    expect(refusal).toBeInstanceOf(HTTPErrorResponse);
    expect((refusal as HTTPErrorResponse).statusCode).toBe(404);
  });

  test("throws for an answer it cannot read, rather than draw half a request", async () => {
    server.on(HTTPMethod.POST, URL_OF(FORM_FOLLOW_UP_ROUTE), [
      { status: 200, data: { submissionId: SUBMISSION_ID } },
    ]);

    await expect(
      loadFormRequest({ shareKey: SHARE_KEY }, { credential: CREDENTIAL }),
    ).rejects.toThrow("The request could not be read.");
  });
});

describe("readPublicFormRequest", () => {
  test("reads a whole request", () => {
    expect(readPublicFormRequest(aRequest())).toEqual({
      submissionId: SUBMISSION_ID,
      formName: "Support",
      title: "Checkout fails",
      reference: "INC-42",
      submittedAt: "2026-11-20T10:00:00.000Z",
      state: { name: "Investigating", color: "#d97706", isClosed: false },
      answers: [{ label: "What is wrong?", value: "Checkout fails" }],
      messages: [
        {
          id: "m1",
          createdAt: "2026-11-20T10:05:00.000Z",
          author: FormFollowUpAuthor.Team,
          authorName: "Sam",
          isYou: false,
          text: "<p>Looking into it.</p>",
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
      people: [
        {
          id: FOLLOWER_ID,
          email: "jane@example.com",
          name: "Jane",
          isSubmitter: true,
          isYou: true,
        },
      ],
      you: {
        id: FOLLOWER_ID,
        email: "jane@example.com",
        name: "Jane",
        isSubmitter: true,
        isYou: true,
      },
      canAddPeople: true,
    });
  });

  test.each([
    ["nothing", null],
    ["a list", [aRequest()]],
    ["text", "a request"],
    ["no submission", aRequest({ submissionId: "" })],
    ["no date it was sent", aRequest({ submittedAt: "yesterday" })],
    ["nobody it is for", aRequest({ you: null })],
    ["somebody with no address", aRequest({ you: { id: FOLLOWER_ID } })],
  ])("refuses an answer with %s", (_name: string, data: unknown) => {
    expect(() => {
      return readPublicFormRequest(data);
    }).toThrow("The request could not be read.");
  });

  test("drops the messages, people and answers it cannot read, and keeps the rest", () => {
    const request: PublicFormRequest = readPublicFormRequest(
      aRequest({
        messages: [
          null,
          "hello",
          { id: "m0", createdAt: "not a date", text: "x" },
          { createdAt: "2026-11-20T10:05:00.000Z", text: "no id" },
          {
            id: "m3",
            createdAt: "2026-11-20T10:09:00.000Z",
            author: "Admin",
            authorName: "  Mallory  ",
            text: "Hi",
            files: [
              { name: "a.txt", size: 3 },
              { size: 4 },
              { name: "b.txt", size: "big" },
              "c.txt",
            ],
          },
        ],
        people: [{ email: "no-id@example.com" }, { id: "p2" }, you],
        answers: [{ value: "no label" }, { label: "Office", value: 3 }],
      }),
    );

    expect(request.messages).toEqual([
      {
        id: "m3",
        createdAt: "2026-11-20T10:09:00.000Z",
        // An author it does not know is the person following, never the team.
        author: FormFollowUpAuthor.Requester,
        authorName: "Mallory",
        isYou: false,
        text: "Hi",
        files: [
          { name: "a.txt", size: 3 },
          { name: "b.txt", size: 0 },
        ],
      },
    ]);
    expect(
      request.people.map((person: { id: string }): string => {
        return person.id;
      }),
    ).toEqual([FOLLOWER_ID]);
    expect(request.answers).toEqual([{ label: "Office", value: "" }]);
  });

  test("draws a state's colour only when it is a colour", () => {
    expect(
      readPublicFormRequest(
        aRequest({ state: { name: "Open", color: "red;background:url(x)" } }),
      ).state,
    ).toEqual({ name: "Open", isClosed: false });
    expect(
      readPublicFormRequest(
        aRequest({
          state: { name: "Resolved", color: "#16A34A", isClosed: true },
        }),
      ).state,
    ).toEqual({ name: "Resolved", color: "#16A34A", isClosed: true });
  });

  test("has no state when the record has none it can name", () => {
    expect(readPublicFormRequest(aRequest({ state: null })).state).toBeNull();
    expect(
      readPublicFormRequest(aRequest({ state: { name: "   " } })).state,
    ).toBeNull();
  });

  test("leaves out a blank reference and sign-in, and trims the others", () => {
    const blank: PublicFormRequest = readPublicFormRequest(
      aRequest({ reference: "  ", signedInAs: "" }),
    );

    expect(blank.reference).toBeUndefined();
    expect(blank.signedInAs).toBeUndefined();

    const set: PublicFormRequest = readPublicFormRequest(
      aRequest({ reference: " INC-7 ", signedInAs: " jane@example.com " }),
    );

    expect(set.reference).toBe("INC-7");
    expect(set.signedInAs).toBe("jane@example.com");
  });

  test("lets people be added only when the server says so, in so many words", () => {
    expect(
      readPublicFormRequest(aRequest({ canAddPeople: "true" })).canAddPeople,
    ).toBe(false);
    expect(
      readPublicFormRequest(aRequest({ canAddPeople: 1 })).canAddPeople,
    ).toBe(false);
    expect(
      readPublicFormRequest(aRequest({ canAddPeople: true })).canAddPeople,
    ).toBe(true);
  });
});

describe("readPublicFormMyRequests", () => {
  test("reads the requests, the last activity falling back to when each was sent", () => {
    expect(
      readPublicFormMyRequests({
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
          {
            submissionId: FOLLOWER_ID,
            title: "Login is slow",
            submittedAt: "2026-11-19T10:00:00.000Z",
            state: null,
          },
        ],
      }),
    ).toEqual({
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
        {
          submissionId: FOLLOWER_ID,
          title: "Login is slow",
          submittedAt: "2026-11-19T10:00:00.000Z",
          lastActivityAt: "2026-11-19T10:00:00.000Z",
          state: null,
        },
      ],
    });
  });

  test("skips a request it could not open: no id, or no date", () => {
    expect(
      readPublicFormMyRequests({
        signedInAs: "jane@example.com",
        requests: [
          { submissionId: "../admin", submittedAt: "2026-11-20T10:00:00.000Z" },
          { submissionId: SUBMISSION_ID, submittedAt: "" },
          "x",
        ],
      }).requests,
    ).toEqual([]);
  });

  test.each([
    ["nothing", null],
    ["nobody signed in", { requests: [] }],
    ["no list", { signedInAs: "jane@example.com", requests: {} }],
  ])("refuses an answer with %s", (_name: string, data: unknown) => {
    expect(() => {
      return readPublicFormMyRequests(data);
    }).toThrow("Your requests could not be read.");
  });
});
