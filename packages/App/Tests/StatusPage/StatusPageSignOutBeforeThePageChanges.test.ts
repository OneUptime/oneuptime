// Must stay the first import: it gives the browser clients below a page to load on.
import {
  DEFAULT_PAGE_URL,
  clearBrowserStorage,
  setNavigatorLocks,
} from "./BrowserSessionHarness";
import StatusPageAPI from "../../FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../FeatureSet/StatusPage/src/Utils/StatusPage";
import StatusPageUser from "../../FeatureSet/StatusPage/src/Utils/User";
import FakeAxiosServer, {
  FakeTransport,
  Gate,
  SentRequest,
  createGate,
  settle,
} from "Common/Tests/UI/Utils/API/FakeAxiosServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import SignOutRequest, {
  SIGN_OUT_ANSWER_WAIT_IN_MS,
} from "Common/UI/Utils/SignOutRequest";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "Common/node_modules/axios";

/*
 * Common's API client is loaded from packages/Common, so the axios it calls is
 * Common's copy, not App's - mock that one, by path.
 */
jest.mock("Common/node_modules/axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(
    jest.fn(),
    jest.requireActual("Common/node_modules/axios"),
  );
});

/*
 * A PRIVATE STATUS PAGE SIGNS ITS READER OUT ON THE SERVER BEFORE THE PAGE
 * GOES AWAY (issue #9508).
 *
 * The page's sign-in opens in full after a sign-out, and Firefox cancels a
 * request still on its way when the page changes. When the server ended a
 * reader's session, the page started the sign-out without waiting for it and
 * opened its sign-in at once, so the server never cleared the page's cookies;
 * and the page's own Sign Out waited, but left the reader signed in on the
 * page, behind an error, when the sign-out failed.
 *
 * Here, on a status page's own custom domain, the page change is Firefox's
 * (FakeAxiosServer.changePage): every request still on its way is
 * cancelled, but one sent with keepalive. The real status page client, down
 * to where axios and fetch would open a socket.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const STATUS_PAGE_ID: string = "11111111-1111-4111-8111-111111111111";

const PAGE_ORIGIN: string = new globalThis.URL(DEFAULT_PAGE_URL).origin;

const SIGN_OUT_URL: string = `${PAGE_ORIGIN}/status-page-identity-api/logout/${STATUS_PAGE_ID}`;

const REFRESH_URL: string = `${PAGE_ORIGIN}/status-page-identity-api/refresh-token/${STATUS_PAGE_ID}`;

const STATUS_PAGE_API_URL: string = `${PAGE_ORIGIN}/status-page-api/overview/${STATUS_PAGE_ID}`;

let server: FakeAxiosServer;

// Where the page went, in order.
let navigated: Array<string> = [];

let currentRoute: string = "/incidents";

function signOuts(): Array<SentRequest> {
  return server.requestsTo(HTTPMethod.POST, SIGN_OUT_URL);
}

function expectTheSignOutReachedTheServer(): void {
  expect(signOuts()).toHaveLength(1);
  expect(signOuts()[0]).toEqual(
    expect.objectContaining({
      keepalive: true,
      credentials: "same-origin",
      answered: true,
    }),
  );
  expect(signOuts()[0]!.cancelled).toBeFalsy();
}

// Lets every promise chain run without the clock, for the tests that hold it still.
async function flushWithoutTheClock(): Promise<void> {
  for (let index: number = 0; index < 50; index++) {
    await Promise.resolve();
  }
}

// The reader, as a sign-in to this page leaves them in the browser.
function signedInReader(): void {
  const statusPageId: ObjectID = new ObjectID(STATUS_PAGE_ID);

  StatusPageUser.setUserId(
    statusPageId,
    new ObjectID("33333333-3333-4333-8333-333333333333"),
  );
  StatusPageUser.setEmail(statusPageId, "reader@example.com" as never);
  LocalStorage.setItem(`masterPasswordValidated-${STATUS_PAGE_ID}`, true);
}

function isReaderForgotten(): boolean {
  const statusPageId: ObjectID = new ObjectID(STATUS_PAGE_ID);

  return (
    !StatusPageUser.isLoggedIn(statusPageId) &&
    StatusPageUser.getUserId(statusPageId).toString() === "" &&
    !LocalStorage.getItem(`masterPasswordValidated-${STATUS_PAGE_ID}`)
  );
}

// The server ended the reader's session: a request refused, and its renewal refused too.
function scriptAnEndedSession(): void {
  server
    .on(HTTPMethod.POST, STATUS_PAGE_API_URL, [{ status: 401 }])
    .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }]);
}

beforeEach(() => {
  clearBrowserStorage();
  setNavigatorLocks(undefined);
  SignOutRequest.forgetSignOutsOnTheirWayForTests();

  server = new FakeAxiosServer(mockedAxios);
  navigated = [];
  currentRoute = "/incidents";

  jest
    .spyOn(StatusPageUtil, "getStatusPageId")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));

  // A page change, in Firefox: whatever is still on its way is cancelled.
  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((to: Route | URL): void => {
      navigated.push(to.toString());
      server.changePage();
    });

  jest.spyOn(Navigation, "getCurrentRoute").mockImplementation((): Route => {
    return new Route(currentRoute);
  });
});

afterEach(async () => {
  jest.useRealTimers();
  await settle();
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();
  StatusPageUtil.setIsPrivateStatusPage(false);
  clearBrowserStorage();
});

describe("a status page's sign-out", () => {
  test("forgets the reader here at once, then sends the page's own origin a keepalive POST, and resolves once it is answered", async () => {
    const gate: Gate = createGate();

    signedInReader();
    server.on(HTTPMethod.POST, SIGN_OUT_URL, [
      { status: 200, gate: gate.promise },
    ]);

    let isDone: boolean = false;

    const signingOut: Promise<void> = StatusPageUser.logout(
      new ObjectID(STATUS_PAGE_ID),
    ).then((): void => {
      isDone = true;
    });

    // Forgotten before the server has answered: a closed tab keeps nothing.
    expect(isReaderForgotten()).toBe(true);

    await settle();
    expect(isDone).toBe(false);

    gate.open();
    await signingOut;

    expect(isDone).toBe(true);
    expectTheSignOutReachedTheServer();
  });

  test.each([
    { steps: "refused by the server", reply: { status: 500 } },
    {
      steps: "that never reached the server",
      reply: { networkErrorCode: "ECONNREFUSED" },
    },
  ])(
    "one $steps still forgets the reader, and resolves rather than rejects",
    async (data: { reply: { status?: number; networkErrorCode?: string } }) => {
      jest.spyOn(console, "error").mockImplementation((): void => {});

      signedInReader();
      server.on(HTTPMethod.POST, SIGN_OUT_URL, [data.reply]);

      await expect(
        StatusPageUser.logout(new ObjectID(STATUS_PAGE_ID)),
      ).resolves.toBeUndefined();

      expect(isReaderForgotten()).toBe(true);
      expect(signOuts()).toHaveLength(1);
    },
  );
});

describe("a private page whose session the server ended", () => {
  test("opens its sign-in only once the sign-out has been answered, and in Firefox the sign-out still reaches the server", async () => {
    const gate: Gate = createGate();

    StatusPageUtil.setIsPrivateStatusPage(true);
    scriptAnEndedSession();
    server.on(HTTPMethod.POST, SIGN_OUT_URL, [
      { status: 200, gate: gate.promise },
    ]);

    const response: unknown = await StatusPageAPI.post<JSONObject>({
      url: URL.fromString(STATUS_PAGE_API_URL),
    });
    await settle();

    expect((response as HTTPErrorResponse).statusCode).toBe(401);
    expect(signOuts()).toHaveLength(1);
    expect(navigated).toEqual([]);

    gate.open();
    await settle();

    expect(navigated.length).toBeGreaterThan(0);
    expect(new Set(navigated)).toEqual(new Set(["/login"]));
    expectTheSignOutReachedTheServer();
  });

  test("a sign-out the server is slow to answer: the sign-in opens after the wait, and the sign-out outlives the page change", async () => {
    jest.useFakeTimers({
      // Only the timer that times the wait: dates and Node's own clocks run as they do.
      doNotFake: [
        "Date",
        "hrtime",
        "performance",
        "nextTick",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
      ],
    });

    const gate: Gate = createGate();

    StatusPageUtil.setIsPrivateStatusPage(true);
    scriptAnEndedSession();
    server.on(HTTPMethod.POST, SIGN_OUT_URL, [
      { status: 200, gate: gate.promise },
    ]);

    await StatusPageAPI.post<JSONObject>({
      url: URL.fromString(STATUS_PAGE_API_URL),
    });
    await flushWithoutTheClock();

    expect(navigated).toEqual([]);

    jest.advanceTimersByTime(SIGN_OUT_ANSWER_WAIT_IN_MS);
    await flushWithoutTheClock();

    expect(new Set(navigated)).toEqual(new Set(["/login"]));

    gate.open();
    await flushWithoutTheClock();

    expectTheSignOutReachedTheServer();
  });

  test("on its own sign-in page, the reader is signed out, keepalive, and the page stays", async () => {
    StatusPageUtil.setIsPrivateStatusPage(true);
    currentRoute = "/login";
    scriptAnEndedSession();
    /*
     * The refused renewal and the request it was for each sign out; the
     * first is answered before the second asks, so each sends its own.
     */
    server.on(HTTPMethod.POST, SIGN_OUT_URL, [
      { status: 200 },
      { status: 200 },
    ]);

    await StatusPageAPI.post<JSONObject>({
      url: URL.fromString(STATUS_PAGE_API_URL),
    });
    await settle();

    expect(navigated).toEqual([]);
    expect(signOuts().length).toBeGreaterThan(0);

    for (const signOut of signOuts()) {
      expect(signOut).toEqual(
        expect.objectContaining({ keepalive: true, answered: true }),
      );
    }
  });

  test("a page whose request was refused as unauthenticated (checkIfTheUserIsAuthenticated) signs out first, and only then opens its sign-in", async () => {
    const gate: Gate = createGate();

    StatusPageUtil.setIsPrivateStatusPage(true);
    jest.spyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(false);
    server.on(HTTPMethod.POST, SIGN_OUT_URL, [
      { status: 200, gate: gate.promise },
    ]);

    const checking: Promise<void> =
      StatusPageUtil.checkIfTheUserIsAuthenticated(
        new HTTPErrorResponse(401, { message: "Session expired" }, {}),
      );

    await settle();

    expect(signOuts()).toHaveLength(1);
    expect(navigated).toEqual([]);

    gate.open();
    await checking;

    expect(navigated).toHaveLength(1);
    expect(navigated[0]!.startsWith("/login")).toBe(true);
    expectTheSignOutReachedTheServer();
  });
});
