import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Mock } from "jest-mock";
import React, {
  FunctionComponent,
  ReactElement,
  Suspense,
  lazy,
  useState,
} from "react";
import {
  MemoryRouter,
  NavigateFunction,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import NewVersionNavigation from "../../../../UI/Components/NewVersion/NewVersionNavigation";
import Route_ from "../../../../Types/API/Route";
import Navigation from "../../../../UI/Utils/Navigation";
import NewVersion, {
  NEW_VERSION_LOADED_FOR_KEY,
  NewVersionAudience,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import { FetchFunction } from "../../../../UI/Utils/NewVersion/ServerBuildCheck";
import TabMemory from "../../../../UI/Utils/NewVersion/TabMemory";
import UnsavedChanges from "../../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * Once a new version is out, the next page the reader opens is loaded in
 * full from the server - so it arrives in the new version, instead of the
 * old one asking for code the server no longer has. These drive a real
 * router: a page is another path (a query or a hash on the same page is
 * not), the page being left takes its unsaved changes with it, but changes
 * held elsewhere on the screen, an offline browser, or a build already tried
 * keep the navigation inside the tab.
 */

const RUNNING: string = "14.0.89-aaaa-0001";
const NEWER: string = "14.0.90-bbbb-0002";

let serverBuildId: string = RUNNING;
let requests: number = 0;

const fetchFunction: FetchFunction = (): Promise<Response> => {
  requests++;

  return Promise.resolve({
    status: 200,
    ok: true,
    text: (): Promise<string> => {
      return Promise.resolve(JSON.stringify({ buildId: serverBuildId }));
    },
  } as unknown as Response);
};

const ORIGINAL_LOCATION: Location = window.location;
let reloadMock: Mock<() => void>;
let assignMock: Mock<(url: string) => void>;
let replaceMock: Mock<(url: string) => void>;
let navigate: NavigateFunction | null = null;

const Navigator: FunctionComponent = (): null => {
  navigate = useNavigate();
  return null;
};

// A page with a form the reader typed into.
const FormPage: FunctionComponent = (): ReactElement => {
  return (
    <div data-unsaved-changes-scope="form" data-testid="form-page">
      <input data-testid="form-field" />
    </div>
  );
};

// A page whose code is still downloading - and never arrives.
const NeverLoadingPage: React.LazyExoticComponent<FunctionComponent> = lazy(
  () => {
    return new Promise<{ default: FunctionComponent }>(() => {
      // Never resolves.
    });
  },
);

// A chat box that stays on screen across pages, like the AI chat panel.
const PersistentChat: FunctionComponent = (): ReactElement => {
  const [value, setValue] = useState<string>("");

  return (
    <textarea
      data-testid="chat"
      value={value}
      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(event.target.value);
      }}
    />
  );
};

/*
 * The Dashboard's router updates synchronously (useTransitions false); the
 * other frontends' navigate inside React transitions, which wait for a page's
 * code before they show it.
 */
const renderApp: (options?: { useTransitions?: boolean }) => void = (options?: {
  useTransitions?: boolean;
}): void => {
  render(
    <MemoryRouter
      initialEntries={["/dashboard/project/home"]}
      useTransitions={options?.useTransitions ?? false}
    >
      <NewVersionNavigation />
      <Navigator />
      <PersistentChat />
      <Suspense fallback={<div data-testid="page-loader">Loading</div>}>
        <Routes>
          <Route
            path="/dashboard/project/home"
            element={<div data-testid="home">Home</div>}
          />
          <Route path="/dashboard/project/form" element={<FormPage />} />
          <Route
            path="/dashboard/project/monitors"
            element={<NeverLoadingPage />}
          />
          <Route
            path="/dashboard/project/incidents"
            element={<div data-testid="incidents">Incidents</div>}
          />
        </Routes>
      </Suspense>
    </MemoryRouter>,
  );
};

const go: (to: string) => void = (to: string): void => {
  act(() => {
    navigate!(to);
  });
};

const flush: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
};

const startWithNewVersion: () => Promise<void> = async (): Promise<void> => {
  serverBuildId = NEWER;
  NewVersion.start({
    audience: NewVersionAudience.Members,
    runningBuild: {
      buildId: RUNNING,
      manifestUrl: "/dashboard/dist/build.json",
    },
    fetchFunction: fetchFunction,
    firstCheckDelayInMs: 24 * 60 * 60 * 1000,
  });

  await act(async () => {
    await NewVersion.checkNow({ force: true });
  });
};

const setOnline: (isOnline: boolean) => void = (isOnline: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return isOnline;
    },
  });
};

beforeEach(() => {
  NewVersion.reset();
  UnsavedChanges.reset();
  window.sessionStorage.clear();
  window.name = "";
  serverBuildId = RUNNING;
  requests = 0;
  navigate = null;
  setOnline(true);

  reloadMock = jest.fn<() => void>();
  assignMock = jest.fn<(url: string) => void>();
  replaceMock = jest.fn<(url: string) => void>();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      ...ORIGINAL_LOCATION,
      href: "https://oneuptime.example/dashboard/project/home",
      pathname: "/dashboard/project/home",
      reload: reloadMock,
      assign: assignMock,
      replace: replaceMock,
    },
  });
});

afterEach(() => {
  cleanup();
  NewVersion.reset();
  UnsavedChanges.reset();
  setOnline(true);
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("NewVersionNavigation", () => {
  test("A NEW VERSION IS OUT: the next page is loaded in full, in the new version", async () => {
    await startWithNewVersion();
    renderApp();

    go("/dashboard/project/incidents");

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(TabMemory.get(NEW_VERSION_LOADED_FOR_KEY)).toBe(NEWER);
  });

  test("the page that opens the tab is not loaded again", async () => {
    await startWithNewVersion();
    renderApp();

    expect(reloadMock).not.toHaveBeenCalled();
  });

  test("a page whose code has not downloaded yet goes to the new version instead of failing", async () => {
    await startWithNewVersion();
    renderApp();

    go("/dashboard/project/monitors");

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test("the unsaved form on the page being left does not hold the load back: it is gone either way", async () => {
    await startWithNewVersion();
    renderApp();

    go("/dashboard/project/form");
    // That was a full load already; count from here.
    reloadMock.mockClear();
    TabMemory.remove(NEW_VERSION_LOADED_FOR_KEY);
    NewVersion.reset();
    UnsavedChanges.reset();
    await startWithNewVersion();

    fireEvent.input(screen.getByTestId("form-field"), {
      target: { value: "Half-typed" },
    });
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

    go("/dashboard/project/monitors");

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test("UNSAVED CHANGES that stay on screen (the AI chat) keep the navigation inside the tab", async () => {
    await startWithNewVersion();
    renderApp();

    fireEvent.change(screen.getByTestId("chat"), {
      target: { value: "Why is checkout slow?" },
    });

    go("/dashboard/project/incidents");

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("incidents")).toBeInTheDocument();
    expect(screen.getByTestId("chat")).toHaveValue("Why is checkout slow?");
  });

  test("a query or a hash on the same page is not opening a page", async () => {
    await startWithNewVersion();
    renderApp();

    go("/dashboard/project/home?status=down");
    go("/dashboard/project/home?status=down#latest");

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  test("offline, the page opens inside the tab rather than on the browser's error page", async () => {
    await startWithNewVersion();
    renderApp();
    setOnline(false);

    go("/dashboard/project/incidents");

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("incidents")).toBeInTheDocument();
  });

  test("a build already tried is not tried again: no loop of full loads", async () => {
    TabMemory.set(NEW_VERSION_LOADED_FOR_KEY, NEWER);
    await startWithNewVersion();
    renderApp();

    go("/dashboard/project/incidents");
    go("/dashboard/project/home");

    expect(reloadMock).not.toHaveBeenCalled();
  });

  test("with the version current, pages open inside the tab, and a navigation is a moment to look", async () => {
    NewVersion.start({
      audience: NewVersionAudience.Members,
      runningBuild: {
        buildId: RUNNING,
        manifestUrl: "/dashboard/dist/build.json",
      },
      fetchFunction: fetchFunction,
      firstCheckDelayInMs: 24 * 60 * 60 * 1000,
    });
    renderApp();

    go("/dashboard/project/incidents");
    await flush();

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("incidents")).toBeInTheDocument();
    expect(requests).toBe(1);

    // Found on that look: the next page loads the new version.
    serverBuildId = NEWER;
    await act(async () => {
      await NewVersion.checkNow({ force: true });
    });

    go("/dashboard/project/home");

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test("a router that navigates in transitions loads the new version once the page commits", async () => {
    await startWithNewVersion();
    renderApp({ useTransitions: true });

    go("/dashboard/project/incidents");
    await flush();

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test("before NewVersion starts, it does nothing at all", () => {
    renderApp();

    go("/dashboard/project/incidents");

    expect(reloadMock).not.toHaveBeenCalled();
    expect(requests).toBe(0);
    expect(screen.getByTestId("incidents")).toBeInTheDocument();
  });
});

/*
 * The app's own links and buttons go through Navigation.navigate, which asks
 * before it moves the router at all: in a router that navigates in
 * transitions (the Admin Dashboard, Accounts, status pages) the page would
 * otherwise first wait for code the server no longer has.
 */
describe("Navigation.navigate once a new version is out", () => {
  const navigateHook: Mock<(to: string, options?: unknown) => void> = jest.fn<
    (to: string, options?: unknown) => void
  >();

  beforeEach(() => {
    navigateHook.mockClear();
    Navigation.setNavigateHook(navigateHook as unknown as NavigateFunction);
  });

  test("opens another page in full, at the address it was going to", async () => {
    await startWithNewVersion();

    Navigation.navigate(new Route_("/dashboard/project/monitors?status=down"));

    expect(assignMock).toHaveBeenCalledWith(
      "/dashboard/project/monitors?status=down",
    );
    expect(navigateHook).not.toHaveBeenCalled();
    expect(TabMemory.get(NEW_VERSION_LOADED_FOR_KEY)).toBe(NEWER);
  });

  test("a replace stays a replace: no extra history entry", async () => {
    await startWithNewVersion();

    Navigation.navigate(new Route_("/dashboard/project/monitors"), {
      replace: true,
    });

    expect(replaceMock).toHaveBeenCalledWith("/dashboard/project/monitors");
    expect(assignMock).not.toHaveBeenCalled();
    expect(navigateHook).not.toHaveBeenCalled();
  });

  test("a query on the same page stays inside the tab", async () => {
    await startWithNewVersion();

    Navigation.navigate(new Route_("/dashboard/project/home?status=down"));

    expect(assignMock).not.toHaveBeenCalled();
    expect(navigateHook).toHaveBeenCalledWith(
      "/dashboard/project/home?status=down",
    );
  });

  test("with the version current, another page opens inside the tab", async () => {
    NewVersion.start({
      audience: NewVersionAudience.Members,
      runningBuild: {
        buildId: RUNNING,
        manifestUrl: "/dashboard/dist/build.json",
      },
      fetchFunction: fetchFunction,
      firstCheckDelayInMs: 24 * 60 * 60 * 1000,
    });

    Navigation.navigate(new Route_("/dashboard/project/monitors"));

    expect(assignMock).not.toHaveBeenCalled();
    expect(navigateHook).toHaveBeenCalledWith("/dashboard/project/monitors");
  });

  test("with unsaved changes on screen, another page opens inside the tab", async () => {
    await startWithNewVersion();
    const release: () => void = UnsavedChanges.hold();

    Navigation.navigate(new Route_("/dashboard/project/monitors"));

    expect(assignMock).not.toHaveBeenCalled();
    expect(navigateHook).toHaveBeenCalledWith("/dashboard/project/monitors");
    release();
  });
});
