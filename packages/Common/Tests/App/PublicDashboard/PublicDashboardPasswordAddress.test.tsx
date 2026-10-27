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
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import type { SpyInstance } from "jest-mock";
import API from "../../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import DashboardThemeUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme";
import PublicDashboardUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import MasterPasswordPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/MasterPassword/MasterPassword";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A public dashboard's password prompt, and the addresses on the way to it
 * and back (Utils/PublicDashboard.ts, Pages/MasterPassword).
 *
 * The app reloads the page on its way to the prompt and back, so what the
 * link says lives in the address: its own theme (?theme=), which the page's
 * first script draws before the first paint, and the variables it picks.
 *
 *   - The prompt's address carries the link's theme, and a redirectUrl of
 *     the whole address the visitor came to, query included.
 *   - After the password, the visitor goes back to exactly that address -
 *     where they used to land on the bare dashboard: the prompt's effect,
 *     keyed by a new ObjectID each render, ran again after the unlock and
 *     sent them to the overview, dropping the query.
 */

const DASHBOARD_ID: string = "ab000000-0000-4000-8000-0000000000c1";

const PREVIEW_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;

let navigateSpy: SpyInstance<typeof Navigation.navigate>;

// The util reads the link's theme once a page: each test is a fresh page.
const openAt: (address: string) => void = (address: string): void => {
  window.history.replaceState(null, "", address);
  (
    DashboardThemeUtil as unknown as { linkTheme: string | null | undefined }
  ).linkTheme = undefined;
};

const navigatedTo: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

beforeEach(() => {
  window.localStorage.clear();
  openAt(PREVIEW_PATH);
  PublicDashboardUtil.setDashboardId(new ObjectID(DASHBOARD_ID));

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  openAt("/");
});

describe("an address of the app, with the link's own theme kept on it", () => {
  test("is unchanged when the link names no theme", () => {
    openAt(`${PREVIEW_PATH}?var-env=prod`);

    expect(PublicDashboardUtil.withLinkTheme(PREVIEW_PATH)).toBe(PREVIEW_PATH);
    expect(PublicDashboardUtil.withLinkTheme("/master-password?a=1")).toBe(
      "/master-password?a=1",
    );
  });

  test("gets the link's theme, after the query it has", () => {
    openAt(`${PREVIEW_PATH}?theme=Dark`);

    expect(PublicDashboardUtil.withLinkTheme(PREVIEW_PATH)).toBe(
      `${PREVIEW_PATH}?theme=dark`,
    );
    expect(PublicDashboardUtil.withLinkTheme("/master-password?a=1")).toBe(
      "/master-password?a=1&theme=dark",
    );
  });

  test("keeps a theme the address names already", () => {
    openAt(`${PREVIEW_PATH}?theme=dark`);

    expect(PublicDashboardUtil.withLinkTheme("/?theme=light")).toBe(
      "/?theme=light",
    );
  });
});

describe("the way to the password prompt", () => {
  const prompt: () => URL = (): URL => {
    expect(navigateSpy).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = navigateSpy.mock.calls[0] as Array<unknown>;

    expect(call[0]).toBeInstanceOf(Route);
    expect(call[1]).toEqual({ forceNavigate: true });

    return new URL(String(call[0]), "https://dashboard.acme.com");
  };

  test("carries the whole address the visitor came to, its query included", () => {
    openAt(`${PREVIEW_PATH}?var-env=prod&var-region=eu-west-1`);

    PublicDashboardUtil.navigateToMasterPasswordPage();

    const address: URL = prompt();

    expect(address.pathname).toBe(`${PREVIEW_PATH}/master-password`);
    expect(address.searchParams.get("redirectUrl")).toBe(
      `${PREVIEW_PATH}?var-env=prod&var-region=eu-west-1`,
    );
    expect(address.searchParams.get("theme")).toBeNull();
  });

  test("carries the link's own theme onto the prompt, for its first paint", () => {
    openAt(`${PREVIEW_PATH}?theme=dark&var-env=prod`);

    PublicDashboardUtil.navigateToMasterPasswordPage();

    const address: URL = prompt();

    expect(address.searchParams.get("theme")).toBe("dark");
    expect(address.searchParams.get("redirectUrl")).toBe(
      `${PREVIEW_PATH}?theme=dark&var-env=prod`,
    );
  });

  test("on a custom domain, the prompt is the domain's own", () => {
    openAt("/?theme=light");

    PublicDashboardUtil.navigateToMasterPasswordPage();

    const address: URL = prompt();

    expect(address.pathname).toBe("/master-password");
    expect(address.searchParams.get("redirectUrl")).toBe("/?theme=light");
    expect(address.searchParams.get("theme")).toBe("light");
  });

  test("an address no route could hold goes back by its path alone", () => {
    openAt(`${PREVIEW_PATH}?var-env=a|b`);

    PublicDashboardUtil.navigateToMasterPasswordPage();

    expect(prompt().searchParams.get("redirectUrl")).toBe(PREVIEW_PATH);
  });

  test("from an auth page, there is nowhere to go back to", () => {
    openAt(`${PREVIEW_PATH}/forbidden?theme=dark`);

    PublicDashboardUtil.navigateToMasterPasswordPage();

    const address: URL = prompt();

    expect(address.searchParams.get("redirectUrl")).toBeNull();
    expect(address.searchParams.get("theme")).toBe("dark");
  });

  test("on the prompt already, it goes nowhere", () => {
    openAt(`${PREVIEW_PATH}/master-password`);

    PublicDashboardUtil.navigateToMasterPasswordPage();

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe("the way back, once the password opens the dashboard", () => {
  const unlock: () => Promise<void> = async (): Promise<void> => {
    jest
      .spyOn(API, "post")
      .mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(200, {}, {});
      });

    await act(async () => {
      render(
        <MemoryRouter>
          <MasterPasswordPage dashboardName="Checkout" />
        </MemoryRouter>,
      );
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "open sesame" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock Dashboard" }));
    });

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });
  };

  beforeEach(() => {
    PublicDashboardUtil.setRequiresMasterPassword(true);
    PublicDashboardUtil.setMasterPasswordValidated(false);
  });

  test("goes to exactly the address the visitor came from - once, never on to the bare dashboard", async () => {
    const cameFrom: string = `${PREVIEW_PATH}?theme=light&var-env=prod`;

    openAt(
      `${PREVIEW_PATH}/master-password?redirectUrl=${encodeURIComponent(
        cameFrom,
      )}&theme=light`,
    );

    await unlock();

    // A render after the unlock must not send the visitor anywhere else.
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 50);
      });
    });

    expect(navigatedTo()).toEqual([cameFrom]);
    expect(PublicDashboardUtil.isMasterPasswordValidated()).toBe(true);
  });

  test("with nowhere to go back to, opens the dashboard - in the link's theme", async () => {
    openAt(`${PREVIEW_PATH}/master-password?theme=dark`);

    await unlock();

    expect(navigatedTo()).toEqual([`${PREVIEW_PATH}?theme=dark`]);
  });

  test("a visitor who already entered it is sent on to the dashboard as the prompt opens", async () => {
    PublicDashboardUtil.setMasterPasswordValidated(true);
    openAt(`${PREVIEW_PATH}/master-password`);

    await act(async () => {
      render(
        <MemoryRouter>
          <MasterPasswordPage dashboardName="Checkout" />
        </MemoryRouter>,
      );
    });

    expect(navigatedTo()).toEqual([PREVIEW_PATH]);
  });
});
