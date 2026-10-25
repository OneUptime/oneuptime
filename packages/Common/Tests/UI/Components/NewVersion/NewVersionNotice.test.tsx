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
import React from "react";
import NewVersionNotice from "../../../../UI/Components/NewVersion/NewVersionNotice";
import NewVersion, {
  NEW_VERSION_PLACE_KEY,
  NewVersionAudience,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import { FetchFunction } from "../../../../UI/Utils/NewVersion/ServerBuildCheck";
import TabMemory from "../../../../UI/Utils/NewVersion/TabMemory";
import UnsavedChanges from "../../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * "A new version of OneUptime is available": the quiet card the Dashboard and
 * the Admin Dashboard show once the server serves a newer build. It never
 * shows before there is one, never to a status page's visitors, reloads to
 * the same place, asks first when something typed is unsaved, and once
 * dismissed stays away until the next build.
 */

const RUNNING: string = "14.0.89-aaaa-0001";
const NEWER: string = "14.0.90-bbbb-0002";
const NEWEST: string = "14.0.91-cccc-0003";

let serverBuildId: string = RUNNING;

const fetchFunction: FetchFunction = (): Promise<Response> => {
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

const start: (audience?: NewVersionAudience) => void = (
  audience?: NewVersionAudience,
): void => {
  NewVersion.start({
    audience: audience || NewVersionAudience.Members,
    runningBuild: {
      buildId: RUNNING,
      manifestUrl: "/dashboard/dist/build.json",
    },
    fetchFunction: fetchFunction,
    firstCheckDelayInMs: 24 * 60 * 60 * 1000,
  });
};

const serve: (buildId: string) => Promise<void> = async (
  buildId: string,
): Promise<void> => {
  serverBuildId = buildId;

  await act(async () => {
    await NewVersion.checkNow({ force: true });
  });
};

const notice: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("new-version-notice");
};

beforeEach(() => {
  NewVersion.reset();
  UnsavedChanges.reset();
  window.sessionStorage.clear();
  window.name = "";
  serverBuildId = RUNNING;

  reloadMock = jest.fn<() => void>();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      ...ORIGINAL_LOCATION,
      href: "https://oneuptime.example/dashboard/project/incidents?page=3",
      reload: reloadMock,
    },
  });
});

afterEach(() => {
  cleanup();
  NewVersion.reset();
  UnsavedChanges.reset();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("NewVersionNotice", () => {
  test("says nothing before anything is known", () => {
    start();
    render(<NewVersionNotice />);

    expect(notice()).toBeNull();
  });

  test("says nothing while the version is current", async () => {
    start();
    render(<NewVersionNotice />);

    await serve(RUNNING);

    expect(notice()).toBeNull();
  });

  test("appears the moment a new version is found, saying what happens next", async () => {
    start();
    render(<NewVersionNotice />);

    await serve(NEWER);

    expect(notice()).toBeInTheDocument();
    expect(screen.getByTestId("new-version-notice-title")).toHaveTextContent(
      "A new version of OneUptime is available",
    );
    expect(screen.getByTestId("new-version-notice-message")).toHaveTextContent(
      "The next page you open will use it.",
    );
    expect(screen.getByTestId("new-version-notice-reload")).toHaveTextContent(
      "Reload",
    );
    expect(screen.getByTestId("new-version-notice-dismiss")).toHaveAttribute(
      "aria-label",
      "Dismiss",
    );
    // Quiet: announced politely, and nothing reloads by itself.
    expect(notice()).toHaveAttribute("role", "status");
    expect(notice()).toHaveAttribute("aria-live", "polite");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  test("shows a version found before it was drawn", async () => {
    start();
    await serve(NEWER);

    render(<NewVersionNotice />);

    expect(notice()).toBeInTheDocument();
  });

  test("never shows to a status page's or a public dashboard's visitors", async () => {
    start(NewVersionAudience.Visitors);
    render(<NewVersionNotice />);

    await serve(NEWER);

    expect(notice()).toBeNull();
  });

  test("Reload loads the new version on the same page, back at the same place", async () => {
    start();
    render(<NewVersionNotice />);
    await serve(NEWER);

    fireEvent.click(screen.getByTestId("new-version-notice-reload"));

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(TabMemory.get(NEW_VERSION_PLACE_KEY) || "{}")).toEqual(
      expect.objectContaining({
        href: "https://oneuptime.example/dashboard/project/incidents?page=3",
      }),
    );
  });

  describe("with something typed and not saved", () => {
    test("Reload asks first, saying what would be lost", async () => {
      start();
      render(<NewVersionNotice />);
      await serve(NEWER);
      const release: () => void = UnsavedChanges.hold();

      fireEvent.click(screen.getByTestId("new-version-notice-reload"));

      expect(reloadMock).not.toHaveBeenCalled();
      expect(notice()).toHaveAttribute("data-confirming", "true");
      expect(
        screen.getByTestId("new-version-notice-message"),
      ).toHaveTextContent(
        "Reload now? Changes you haven't saved on this page will be lost.",
      );
      expect(screen.getByTestId("new-version-notice-reload")).toHaveTextContent(
        "Reload anyway",
      );
      expect(screen.getByTestId("new-version-notice-cancel")).toHaveTextContent(
        "Cancel",
      );
      release();
    });

    test("Reload anyway reloads", async () => {
      start();
      render(<NewVersionNotice />);
      await serve(NEWER);
      const release: () => void = UnsavedChanges.hold();

      fireEvent.click(screen.getByTestId("new-version-notice-reload"));
      fireEvent.click(screen.getByTestId("new-version-notice-reload"));

      expect(reloadMock).toHaveBeenCalledTimes(1);
      release();
    });

    test("Cancel keeps the page, and the notice goes back to how it was", async () => {
      start();
      render(<NewVersionNotice />);
      await serve(NEWER);
      const release: () => void = UnsavedChanges.hold();

      fireEvent.click(screen.getByTestId("new-version-notice-reload"));
      fireEvent.click(screen.getByTestId("new-version-notice-cancel"));

      expect(reloadMock).not.toHaveBeenCalled();
      expect(notice()).toHaveAttribute("data-confirming", "false");
      expect(
        screen.getByTestId("new-version-notice-message"),
      ).toHaveTextContent("The next page you open will use it.");
      release();
    });

    test("a newer build than the one asked about asks again", async () => {
      start();
      render(<NewVersionNotice />);
      await serve(NEWER);
      const release: () => void = UnsavedChanges.hold();

      fireEvent.click(screen.getByTestId("new-version-notice-reload"));
      await serve(NEWEST);

      expect(notice()).toHaveAttribute("data-confirming", "false");
      release();
    });
  });

  test("Dismiss hides it for this build, and the next build brings it back", async () => {
    start();
    render(<NewVersionNotice />);
    await serve(NEWER);

    fireEvent.click(screen.getByTestId("new-version-notice-dismiss"));

    expect(notice()).toBeNull();
    expect(reloadMock).not.toHaveBeenCalled();

    await serve(NEWEST);

    expect(notice()).toBeInTheDocument();
  });

  test("a dismissed notice stays away across a reload of the same build", async () => {
    start();
    await serve(NEWER);
    NewVersion.dismissNotice();

    render(<NewVersionNotice />);

    expect(notice()).toBeNull();
  });

  test("goes away when a rolled-back deploy makes the version current again", async () => {
    start();
    render(<NewVersionNotice />);
    await serve(NEWER);

    await serve(RUNNING);
    expect(notice()).toBeInTheDocument();

    await serve(RUNNING);
    expect(notice()).toBeNull();
  });

  test("steps aside while the page itself speaks of the new version, and comes back after", async () => {
    start();
    render(<NewVersionNotice />);
    await serve(NEWER);
    expect(notice()).toBeInTheDocument();

    let release: () => void = (): void => {};

    act(() => {
      release = NewVersion.holdNotice();
    });
    expect(notice()).toBeNull();

    // A second hold, let go twice, still counts once.
    let second: () => void = (): void => {};
    act(() => {
      second = NewVersion.holdNotice();
    });
    act(() => {
      second();
      second();
    });
    expect(notice()).toBeNull();

    act(() => {
      release();
    });
    expect(notice()).toBeInTheDocument();
  });

  test("goes away once a reload into the new version has begun", async () => {
    start();
    render(<NewVersionNotice />);
    await serve(NEWER);

    act(() => {
      NewVersion.reloadKeepingPlace();
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
  });

  test("sits in a corner and never in print", async () => {
    start();
    render(<NewVersionNotice />);
    await serve(NEWER);

    const className: string = notice()!.className;

    expect(className).toContain("fixed");
    expect(className).toContain("bottom-");
    // The reading side in a right-to-left language too.
    expect(className).toContain("sm:start-6");
    expect(className).toContain("print:hidden");
  });
});
