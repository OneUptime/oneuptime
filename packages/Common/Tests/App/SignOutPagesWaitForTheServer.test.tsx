// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  createGate,
  FakeTransport,
  Gate,
  SentRequest,
  settle,
} from "../UI/Utils/API/FakeAxiosServer";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";
import DashboardLogout from "../../../App/FeatureSet/Dashboard/src/Pages/Logout/Logout";
import DeleteAccount from "../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/DeleteAccount";
import AdminLogout from "../../../App/FeatureSet/AdminDashboard/src/Pages/Logout/Logout";
import StatusPageLogout from "../../../App/FeatureSet/StatusPage/src/Pages/Accounts/Logout";
import { STATUS_PAGE_IDENTITY_API_URL } from "../../../App/FeatureSet/StatusPage/src/Utils/Config";
import StatusPageUtil from "../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import HTTPMethod from "../../Types/API/HTTPMethod";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import ObjectID from "../../Types/ObjectID";
import { ACCOUNTS_URL } from "../../UI/Config";
import UiAnalytics from "../../UI/Utils/Analytics";
import LocalStorage from "../../UI/Utils/LocalStorage";
import ModelAPI from "../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../UI/Utils/Navigation";
import SignOutRequest, {
  SIGN_OUT_ANSWER_WAIT_IN_MS,
} from "../../UI/Utils/SignOutRequest";
import UserUtil from "../../UI/Utils/User";
import { getJestSpyOn } from "../Spy";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

// The page chrome: only what it holds.
jest.mock("../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div>{props.children}</div>;
    },
  };
});

/*
 * EVERY PAGE THAT SIGNS OUT OPENS THE NEXT PAGE ONLY ONCE THE SERVER HAS
 * SIGNED THE BROWSER OUT (issue #9508).
 *
 * The Dashboard's and the Admin Dashboard's Sign Out pages started the
 * sign-out and opened the sign-in page at once, in full; Firefox cancels a
 * request still on its way when the page changes, so the server never
 * cleared the session's cookies and the next person on the browser was
 * signed in as the one who left. Delete Account did the same. A private
 * status page's Sign Out waited, but a sign-out that failed left its reader
 * on an error, still signed in on the page.
 *
 * The real pages, rendered, with the real sign-out down to the page's
 * fetch; the page change is Firefox's (FakeAxiosServer.changePage), so a
 * sign-out the page did not wait for, and that is not keepalive, is lost.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const DASHBOARD_SIGN_OUT: string = `${DASHBOARD_ORIGIN}/identity/logout`;

const STATUS_PAGE_ID: string = "44444444-4444-4444-8444-444444444444";

const STATUS_PAGE_SIGN_OUT: string = URL.fromURL(STATUS_PAGE_IDENTITY_API_URL)
  .addRoute(`/logout/${STATUS_PAGE_ID}`)
  .toString();

const USER_ID: string = "55555555-5555-4555-8555-555555555555";

interface Navigated {
  to: string;
  force: boolean;
}

let server: FakeAxiosServer;

let navigated: Array<Navigated> = [];

function signOutsTo(address: string): Array<SentRequest> {
  return server.requestsTo(HTTPMethod.POST, address);
}

// The only sign-out sent to `address`: the server answered it, and nothing cancelled it.
function expectTheSignOutReachedTheServer(address: string): void {
  expect(signOutsTo(address)).toHaveLength(1);
  expect(signOutsTo(address)[0]).toEqual(
    expect.objectContaining({ keepalive: true, answered: true }),
  );
  expect(signOutsTo(address)[0]!.cancelled).toBeFalsy();
}

async function letTheSignOutRun(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();

  server = new FakeAxiosServer(mockedAxios);
  navigated = [];

  // A page change, in Firefox: whatever is still on its way is cancelled.
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (to: Route | URL, options?: { forceNavigate?: boolean }): void => {
      navigated.push({
        to: to.toString(),
        force: Boolean(options?.forceNavigate),
      });
      server.changePage();
    },
  );

  getJestSpyOn(UiAnalytics, "logout").mockImplementation((): void => {});
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await settle();
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();
  localStorage.clear();
});

describe("Sign Out on the Dashboard", () => {
  const renderPage: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      render(
        <DashboardLogout
          pageRoute={new Route("/dashboard/logout")}
          currentProject={null}
          hasPaymentMethod={false}
        />,
      );
    });
  };

  test("the sign-in page opens only once the server has answered the sign-out", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, DASHBOARD_SIGN_OUT, [
      { status: 200, gate: gate.promise },
    ]);

    await renderPage();
    await letTheSignOutRun();

    expect(UiAnalytics.logout).toHaveBeenCalledTimes(1);
    expect(signOutsTo(DASHBOARD_SIGN_OUT)).toHaveLength(1);
    // The server has not answered: still the Sign Out page.
    expect(navigated).toEqual([]);

    await act(async () => {
      gate.open();
      await settle();
    });

    expect(navigated).toEqual([{ to: ACCOUNTS_URL.toString(), force: false }]);
    expectTheSignOutReachedTheServer(DASHBOARD_SIGN_OUT);
  });

  test("a server too slow to answer: the sign-in page opens after the wait, and the sign-out still reaches the server", async () => {
    jest.useFakeTimers();

    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, DASHBOARD_SIGN_OUT, [
      { status: 200, gate: gate.promise },
    ]);

    await renderPage();

    await act(async () => {
      jest.advanceTimersByTime(SIGN_OUT_ANSWER_WAIT_IN_MS - 1);
    });

    expect(navigated).toEqual([]);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(navigated).toEqual([{ to: ACCOUNTS_URL.toString(), force: false }]);

    // Answered after the page changed: it was keepalive, so never cancelled.
    await act(async () => {
      gate.open();
    });

    expectTheSignOutReachedTheServer(DASHBOARD_SIGN_OUT);
  });

  test("a sign-out the server could not be reached for still ends on the sign-in page", async () => {
    getJestSpyOn(console, "error").mockImplementation((): void => {});

    server.on(HTTPMethod.POST, DASHBOARD_SIGN_OUT, [
      { networkErrorCode: "ECONNREFUSED" },
    ]);

    await renderPage();
    await letTheSignOutRun();

    expect(navigated).toEqual([{ to: ACCOUNTS_URL.toString(), force: false }]);
  });
});

describe("Sign Out on the Admin Dashboard", () => {
  test("the sign-in page opens only once the server has answered the sign-out", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, DASHBOARD_SIGN_OUT, [
      { status: 200, gate: gate.promise },
    ]);

    await act(async () => {
      render(<AdminLogout />);
    });
    await letTheSignOutRun();

    expect(UiAnalytics.logout).toHaveBeenCalledTimes(1);
    expect(signOutsTo(DASHBOARD_SIGN_OUT)).toHaveLength(1);
    expect(navigated).toEqual([]);

    await act(async () => {
      gate.open();
      await settle();
    });

    expect(navigated).toEqual([{ to: ACCOUNTS_URL.toString(), force: false }]);
    expectTheSignOutReachedTheServer(DASHBOARD_SIGN_OUT);
  });
});

describe("Sign Out on a private status page", () => {
  beforeEach(() => {
    // The page this tab shows, on its preview address.
    StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
    getJestSpyOn(StatusPageUtil, "isPreviewPage").mockReturnValue(true);
  });

  afterEach(() => {
    StatusPageUtil.setStatusPageId(null);
  });

  const renderPage: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      render(
        <MemoryRouter>
          <StatusPageLogout />
        </MemoryRouter>,
      );
    });
  };

  test("the reader is forgotten at once, and the page's sign-in opens only once the server has answered", async () => {
    const gate: Gate = createGate();

    LocalStorage.setItem(`${STATUS_PAGE_ID}user_email`, "reader@example.com");
    LocalStorage.setItem(`masterPasswordValidated-${STATUS_PAGE_ID}`, true);

    server.on(HTTPMethod.POST, STATUS_PAGE_SIGN_OUT, [
      { status: 200, gate: gate.promise },
    ]);

    await renderPage();
    await letTheSignOutRun();

    expect(LocalStorage.getItem(`${STATUS_PAGE_ID}user_email`)).toBeFalsy();
    expect(
      LocalStorage.getItem(`masterPasswordValidated-${STATUS_PAGE_ID}`),
    ).toBeFalsy();
    expect(signOutsTo(STATUS_PAGE_SIGN_OUT)).toHaveLength(1);
    expect(navigated).toEqual([]);

    await act(async () => {
      gate.open();
      await settle();
    });

    expect(navigated).toEqual([
      { to: `/status-page/${STATUS_PAGE_ID}/login`, force: true },
    ]);
    expectTheSignOutReachedTheServer(STATUS_PAGE_SIGN_OUT);
  });

  test("a sign-out that failed still ends on the page's sign-in, rather than on an error", async () => {
    getJestSpyOn(console, "error").mockImplementation((): void => {});

    server.on(HTTPMethod.POST, STATUS_PAGE_SIGN_OUT, [{ status: 500 }]);

    await renderPage();
    await letTheSignOutRun();

    expect(navigated).toEqual([
      { to: `/status-page/${STATUS_PAGE_ID}/login`, force: true },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Delete Account", () => {
  beforeEach(() => {
    // No projects left, so the account can be deleted.
    getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 100,
    } as never);
    getJestSpyOn(ModelAPI, "deleteItem").mockResolvedValue(undefined as never);
    getJestSpyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  });

  test("once the account is deleted, the sign-in page opens only once the server has answered the sign-out", async () => {
    const gate: Gate = createGate();

    server.on(HTTPMethod.POST, DASHBOARD_SIGN_OUT, [
      { status: 200, gate: gate.promise },
    ]);

    render(
      <DeleteAccount
        pageRoute={new Route("/dashboard/user-settings/delete-account")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Delete Account" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      await settle();
    });

    expect(ModelAPI.deleteItem).toHaveBeenCalledTimes(1);
    expect(signOutsTo(DASHBOARD_SIGN_OUT)).toHaveLength(1);
    expect(navigated).toEqual([]);

    await act(async () => {
      gate.open();
      await settle();
    });

    expect(navigated).toEqual([{ to: "/accounts/login", force: true }]);
    expectTheSignOutReachedTheServer(DASHBOARD_SIGN_OUT);
  });
});

/*
 * A PERSON WHO SIGNED IN THROUGH AN IDENTITY PROVIDER SET TO SIGN PEOPLE OUT
 * OF IT TOO GOES TO THE PROVIDER'S SIGN-OUT, NOT THE SIGN-IN PAGE (#9535).
 *
 * The server's answer to the sign-out names the provider's own sign-out,
 * which ends the person's session there and comes back to the sign-in page.
 * The page still waits for that answer - the OneUptime session ends first -
 * and follows only an http(s) address.
 */
describe("Sign Out of a session whose identity provider signs people out too", () => {
  const PROVIDER_SIGN_OUT: string =
    "https://idp.example.com/realms/acme/protocol/openid-connect/logout?id_token_hint=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln&client_id=oneuptime&post_logout_redirect_uri=https%3A%2F%2Foneuptime.example.com%2Faccounts";

  const pages: Array<{ name: string; render: () => ReactElement }> = [
    {
      name: "the Dashboard",
      render: (): ReactElement => {
        return (
          <DashboardLogout
            pageRoute={new Route("/dashboard/logout")}
            currentProject={null}
            hasPaymentMethod={false}
          />
        );
      },
    },
    {
      name: "the Admin Dashboard",
      render: (): ReactElement => {
        return <AdminLogout />;
      },
    },
  ];

  test.each(pages)(
    "on $name, the provider's sign-out opens once the server has answered",
    async (page: { name: string; render: () => ReactElement }) => {
      const gate: Gate = createGate();

      server.on(HTTPMethod.POST, DASHBOARD_SIGN_OUT, [
        {
          status: 200,
          gate: gate.promise,
          data: { identityProviderSignOutUrl: PROVIDER_SIGN_OUT },
        },
      ]);

      await act(async () => {
        render(page.render());
      });
      await letTheSignOutRun();

      // The OneUptime session ends first: nothing opens before the answer.
      expect(navigated).toEqual([]);

      await act(async () => {
        gate.open();
        await settle();
      });

      expect(navigated).toEqual([{ to: PROVIDER_SIGN_OUT, force: false }]);
      expectTheSignOutReachedTheServer(DASHBOARD_SIGN_OUT);
    },
  );

  test.each(pages)(
    "on $name, an address of any other scheme is never followed: the sign-in page opens",
    async (page: { name: string; render: () => ReactElement }) => {
      server.on(HTTPMethod.POST, DASHBOARD_SIGN_OUT, [
        {
          status: 200,
          data: { identityProviderSignOutUrl: "javascript:alert(1)" },
        },
      ]);

      await act(async () => {
        render(page.render());
      });
      await letTheSignOutRun();

      expect(navigated).toEqual([
        { to: ACCOUNTS_URL.toString(), force: false },
      ]);
    },
  );
});
