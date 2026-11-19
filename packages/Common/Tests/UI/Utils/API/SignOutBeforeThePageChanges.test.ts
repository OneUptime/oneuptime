// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, {
  createGate,
  FakeTransport,
  Gate,
  SentRequest,
  settle,
} from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import { ACCOUNTS_URL, IDENTITY_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import SignOutRequest, {
  SIGN_OUT_ANSWER_WAIT_IN_MS,
} from "../../../../UI/Utils/SignOutRequest";
import User from "../../../../UI/Utils/User";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * SIGN OUT ENDS THE SESSION ON THE SERVER BEFORE THE PAGE GOES AWAY, IN EVERY
 * BROWSER (issue #9508).
 *
 * In Firefox, Sign Out showed the sign-in page and left the person signed
 * in: opening OneUptime again, they were still in. The Sign Out pages started
 * POST /identity/logout and opened the sign-in page at once, in full - and
 * Firefox cancels every request still on its way when the page changes, as
 * soon as the new address is set. The server never heard of the sign-out
 * (nginx logged 499, "client closed the request", or nothing at all), so it
 * never answered with the cleared cookies, which are HttpOnly and only the
 * server can clear. Chrome cancels later, so there the sign-out got through.
 * Every sign-out the app runs itself - a session the server ended, a project
 * that is gone - did the same.
 *
 * Here the page changes as Firefox changes it (FakeAxiosServer.changePage):
 * every request still on its way is cancelled, and the server never acts on
 * it, but one sent with keepalive. A sign-out now reaches the server either
 * way: the page waits for its answer, and the request is keepalive for when
 * it cannot wait any longer.
 *
 * The real client throughout, down to where axios and fetch would open a
 * socket.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const SIGN_OUT_ADDRESS: string = `${DASHBOARD_ORIGIN}/identity/logout`;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const LOGIN_ROUTE: string = "/accounts/login";

const RESOURCE_URL: string = `${DASHBOARD_ORIGIN}/api/incident/get-list`;

const OTHER_RESOURCE_URL: string = `${DASHBOARD_ORIGIN}/api/monitor/get-list`;

let server: FakeAxiosServer;

// Where the page went, in order.
let navigated: Array<string> = [];

let currentRoute: string = "/dashboard/overview";

function signOuts(): Array<SentRequest> {
  return server.requestsTo(HTTPMethod.POST, SIGN_OUT_ADDRESS);
}

/*
 * Lets every promise chain run, without the clock: for the tests that hold
 * the clock still, where settle()'s timer would never fire.
 */
async function flushWithoutTheClock(): Promise<void> {
  for (let index: number = 0; index < 50; index++) {
    await Promise.resolve();
  }
}

// What the Sign Out pages of the Dashboard and the Admin Dashboard do.
async function signOutAsTheSignOutPagesDo(): Promise<void> {
  const identityProviderSignOutUrl: URL | null = await User.logout();
  Navigation.navigate(identityProviderSignOutUrl || ACCOUNTS_URL);
}

// A session the server ended: a request refused, and the renewal it asks for refused too.
function scriptARefusedSession(url: string = RESOURCE_URL): void {
  server
    .on(HTTPMethod.POST, url, [{ status: 401 }])
    .on(HTTPMethod.POST, REFRESH_URL, [
      {
        status: 401,
        data: { message: "Session expired. Please sign in again." },
      },
    ]);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  BaseAPI.resetSessionEndForTests();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();

  server = new FakeAxiosServer(mockedAxios);
  navigated = [];
  currentRoute = "/dashboard/overview";

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
  localStorage.clear();
});

describe("the page change this fake plays is Firefox's", () => {
  test("a request still on its way when the page changes is cancelled, and the server never acts on it - what the Sign Out pages used to send", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
      { status: 200, gate: gate.promise },
    ]);

    // Before this fix: the API client's request, not waited for, then the page change.
    const before: Promise<unknown> = BaseAPI.post({
      url: URL.fromString(SIGN_OUT_ADDRESS),
    }).catch((err: unknown): unknown => {
      return err;
    });

    Navigation.navigate(ACCOUNTS_URL);
    gate.open();
    await before;

    expect(signOuts()).toEqual([expect.objectContaining({ cancelled: true })]);
    expect(signOuts()[0]!.answered).toBeFalsy();
  });
});

describe("Sign Out on the Dashboard and the Admin Dashboard", () => {
  test("the sign-out is a keepalive POST to /identity/logout on the dashboard's own host, with the page's own cookies", async () => {
    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [{ status: 200 }]);

    await User.logout();

    expect(signOuts()).toEqual([
      expect.objectContaining({
        keepalive: true,
        credentials: "same-origin",
        answered: true,
      }),
    ]);
  });

  test("logout resolves only once the server has answered the sign-out", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
      { status: 200, gate: gate.promise },
    ]);

    let isDone: boolean = false;

    const signingOut: Promise<void> = User.logout().then((): void => {
      isDone = true;
    });

    await settle();

    expect(isDone).toBe(false);
    expect(signOuts()[0]!.answered).toBeFalsy();

    gate.open();
    await signingOut;

    expect(isDone).toBe(true);
    expect(signOuts()[0]!.answered).toBe(true);
  });

  test("the person is forgotten in this browser at once, before the server has answered", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
      { status: 200, gate: gate.promise },
    ]);

    localStorage.setItem("user_email", "ada@example.com");
    expect(User.isLoggedIn()).toBe(true);

    const signingOut: Promise<URL | null> = User.logout();

    expect(User.isLoggedIn()).toBe(false);

    gate.open();
    await signingOut;
  });

  test("the sign-in page opens only once the server has answered, and in Firefox the sign-out reaches the server", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
      { status: 200, gate: gate.promise },
    ]);

    const signingOut: Promise<void> = signOutAsTheSignOutPagesDo();

    await settle();

    // The server has not answered: the page is still the Sign Out page.
    expect(navigated).toEqual([]);

    gate.open();
    await signingOut;

    expect(navigated).toEqual([ACCOUNTS_URL.toString()]);
    expect(signOuts()).toHaveLength(1);
    expect(signOuts()[0]!.answered).toBe(true);
    expect(signOuts()[0]!.cancelled).toBeFalsy();
  });

  test("even a page that changes at once, as the Sign Out pages did, no longer loses it: it is keepalive", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
      { status: 200, gate: gate.promise },
    ]);

    const signingOut: Promise<URL | null> = User.logout();
    Navigation.navigate(ACCOUNTS_URL);

    gate.open();
    await signingOut;

    expect(signOuts()[0]!.cancelled).toBeFalsy();
    expect(signOuts()[0]!.answered).toBe(true);
  });

  test("a server too slow to answer: the sign-in page opens after the wait, and the sign-out still reaches the server after the page changed", async () => {
    jest.useFakeTimers();

    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
      { status: 200, gate: gate.promise },
    ]);

    let isDone: boolean = false;

    const signingOut: Promise<void> = signOutAsTheSignOutPagesDo().then(
      (): void => {
        isDone = true;
      },
    );

    jest.advanceTimersByTime(SIGN_OUT_ANSWER_WAIT_IN_MS - 1);
    await flushWithoutTheClock();

    expect(isDone).toBe(false);
    expect(navigated).toEqual([]);

    // Nobody is left on the spinner.
    jest.advanceTimersByTime(1);
    await signingOut;

    expect(navigated).toEqual([ACCOUNTS_URL.toString()]);
    expect(signOuts()[0]!.answered).toBeFalsy();

    // The server answers after the page changed: the sign-out was never cancelled.
    gate.open();
    await flushWithoutTheClock();

    expect(signOuts()[0]!.cancelled).toBeFalsy();
    expect(signOuts()[0]!.answered).toBe(true);
  });

  test.each([
    { steps: "the server answered with an error", reply: { status: 500 } },
    {
      steps: "the server could not be reached",
      reply: { networkErrorCode: "ECONNREFUSED" },
    },
  ])(
    "$steps: logout still resolves, and the page still goes to the sign-in page",
    async (data: { reply: { status?: number; networkErrorCode?: string } }) => {
      server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [data.reply]);

      jest.spyOn(console, "error").mockImplementation((): void => {});

      await signOutAsTheSignOutPagesDo();

      expect(navigated).toEqual([ACCOUNTS_URL.toString()]);
      expect(signOuts()).toHaveLength(1);
    },
  );
});

describe("a session the server ended: the sign-in page opens once the sign-out has settled", () => {
  test("after a 401 whose renewal the server refuses", async () => {
    const gate: Gate = createGate();

    scriptARefusedSession();
    server.on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
      { status: 200, gate: gate.promise },
    ]);

    await BaseAPI.post({ url: URL.fromString(RESOURCE_URL) });
    await settle();

    expect(signOuts()).toHaveLength(1);
    expect(navigated).toEqual([]);

    gate.open();
    await settle();

    expect(navigated.length).toBeGreaterThan(0);
    expect(new Set(navigated)).toEqual(new Set([LOGIN_ROUTE]));
    expect(signOuts()).toEqual([
      expect.objectContaining({ keepalive: true, answered: true }),
    ]);
  });

  test("after a 405 - the project is gone - which signs out too", async () => {
    const gate: Gate = createGate();

    server
      .on(HTTPMethod.POST, RESOURCE_URL, [{ status: 405 }])
      .on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
        { status: 200, gate: gate.promise },
      ]);

    await BaseAPI.post({ url: URL.fromString(RESOURCE_URL) });
    await settle();

    expect(navigated).toEqual([]);

    gate.open();
    await settle();

    expect(navigated).toEqual([LOGIN_ROUTE]);
    expect(signOuts()[0]!.answered).toBe(true);
  });

  test("a sign-out the server is slow to answer: the sign-in page opens after the wait, and the sign-out outlives the page change", async () => {
    jest.useFakeTimers();

    const gate: Gate = createGate();

    server
      .on(HTTPMethod.POST, RESOURCE_URL, [{ status: 405 }])
      .on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
        { status: 200, gate: gate.promise },
      ]);

    await BaseAPI.post({ url: URL.fromString(RESOURCE_URL) });
    await flushWithoutTheClock();

    expect(navigated).toEqual([]);

    jest.advanceTimersByTime(SIGN_OUT_ANSWER_WAIT_IN_MS);
    await flushWithoutTheClock();

    expect(navigated).toEqual([LOGIN_ROUTE]);

    gate.open();
    await flushWithoutTheClock();

    expect(signOuts()[0]!.cancelled).toBeFalsy();
    expect(signOuts()[0]!.answered).toBe(true);
  });

  test("a sign-out that failed still ends on the sign-in page", async () => {
    jest.spyOn(console, "error").mockImplementation((): void => {});

    server
      .on(HTTPMethod.POST, RESOURCE_URL, [{ status: 405 }])
      .on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
        { networkErrorCode: "ECONNRESET" },
      ]);

    await BaseAPI.post({ url: URL.fromString(RESOURCE_URL) });
    await settle();

    expect(navigated).toEqual([LOGIN_ROUTE]);
  });

  test("on the sign-in page already: the sign-out is still sent, keepalive, and nothing navigates", async () => {
    currentRoute = LOGIN_ROUTE;

    server
      .on(HTTPMethod.POST, RESOURCE_URL, [{ status: 405 }])
      .on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [{ status: 200 }]);

    await BaseAPI.post({ url: URL.fromString(RESOURCE_URL) });
    await settle();

    expect(navigated).toEqual([]);
    expect(signOuts()).toEqual([
      expect.objectContaining({ keepalive: true, answered: true }),
    ]);
  });

  test("a burst of requests the server refused sends one sign-out, and they all land on the sign-in page once it is answered", async () => {
    const gate: Gate = createGate();

    server
      .on(HTTPMethod.POST, RESOURCE_URL, [{ status: 405 }])
      .on(HTTPMethod.POST, OTHER_RESOURCE_URL, [{ status: 405 }])
      .on(HTTPMethod.POST, SIGN_OUT_ADDRESS, [
        { status: 200, gate: gate.promise },
      ]);

    await Promise.all([
      BaseAPI.post({ url: URL.fromString(RESOURCE_URL) }),
      BaseAPI.post({ url: URL.fromString(OTHER_RESOURCE_URL) }),
    ]);
    await settle();

    expect(signOuts()).toHaveLength(1);
    expect(navigated).toEqual([]);

    gate.open();
    await settle();

    expect(navigated).toEqual([LOGIN_ROUTE, LOGIN_ROUTE]);
    expect(signOuts()[0]!.answered).toBe(true);
  });
});
