import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import ProjectProducts, {
  REFRESH_AFTER_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import { useProjectProductsKeptUpToDate } from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/UseProjectProducts";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import DashboardAPI from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * THE PRODUCTS MENU FOLLOWS WHAT THE PROJECT USES (#7465).
 *
 * Found by the newcomer walkthrough: the guided setup made the project's
 * first on-call policy and monitor, and minutes later - through a reload -
 * the products menu still said "Monitors - Not set up" and "On-Call Duty -
 * Not set up"; the first logs arrived, and it still said "Logs - Not set
 * up". The Dashboard kept its answer until the page was reloaded, and the
 * server kept its own for five minutes (ProjectUsageCache.test.ts and
 * ProductRecordWritesForgetUsage.test.ts hold the server's side).
 *
 * Here, the Dashboard's side, with the navbar drawn and the server answered
 * by the test:
 *
 *  - a product's first record made on the page (ModelAPI) takes its mark
 *    off at once, asking nothing;
 *  - a product set up elsewhere (its first logs) shows once the menu is
 *    opened, the page changes or the tab comes back, after REFRESH_AFTER_MS;
 *  - nothing changed: looking again and again asks nothing more.
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

const NOT_SET_UP: ProjectProductsAnswer = {
  ...getEmptyProjectProductsAnswer(),
  usage: {
    [ProductKey.Monitors]: ProductUsage.NotSetUp,
    [ProductKey.OnCall]: ProductUsage.NotSetUp,
    [ProductKey.Logs]: ProductUsage.NotSetUp,
  },
};

let serverAnswer: ProjectProductsAnswer;
let asked: number;
let now: number;

function navbar(): ReactElement {
  return (
    <I18nextProvider i18n={translation}>
      <DashboardNavbar show={true} />
    </I18nextProvider>
  );
}

function openProducts(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: /Products/ }));
  return screen.getByRole("dialog", { name: "Products menu" });
}

function closeProducts(): void {
  const search: HTMLInputElement | null = screen
    .getByRole("dialog", { name: "Products menu" })
    .querySelector("input");
  fireEvent.keyDown(search!, { key: "Escape" });
  expect(
    screen.queryByRole("dialog", { name: "Products menu" }),
  ).not.toBeInTheDocument();
}

// The menu's card of a product, found by its search.
function card(menu: HTMLElement, title: string): HTMLElement {
  fireEvent.change(menu.querySelector("input")!, {
    target: { value: title },
  });

  const found: HTMLElement | undefined = within(menu)
    .getAllByRole("option")
    .find((option: HTMLElement): boolean => {
      return option.textContent?.startsWith(title) === true;
    });

  expect(found).toBeDefined();
  return found!;
}

function saysNotSetUp(menu: HTMLElement, title: string): boolean {
  return (
    within(card(menu, title)).queryByTestId("navbar-menu-not-set-up") !== null
  );
}

// The server confirms a create, as it answers ModelAPI.
function serverCreates(): SpyInstance<typeof DashboardAPI.fetch> {
  return (
    jest.spyOn(DashboardAPI, "fetch") as unknown as SpyInstance<
      typeof DashboardAPI.fetch
    >
  ).mockResolvedValue(
    new HTTPResponse(
      200,
      {
        _id: "7d000000-0000-4000-8000-00000000d001",
        projectId: { _type: "ObjectID", value: PROJECT_ID },
      },
      {},
    ) as never,
  );
}

async function answerArrived(): Promise<void> {
  await waitFor(() => {
    expect(ProjectProducts.getState(PROJECT_ID).isFresh).toBe(true);
  });
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  ProjectProducts.reset();
  serverAnswer = NOT_SET_UP;
  asked = 0;
  ProjectProducts.setFetcher(async (): Promise<ProjectProductsAnswer> => {
    asked++;
    return serverAnswer;
  });
  now = Date.UTC(2026, 10, 15, 21, 14, 0);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the products menu follows what the project uses (#7465)", () => {
  test("the first monitor made on the page takes Monitors' Not set up off at once, before the server is asked", async () => {
    render(navbar());
    await answerArrived();

    let menu: HTMLElement = openProducts();
    expect(saysNotSetUp(menu, "Monitors")).toBe(true);
    closeProducts();

    serverCreates();
    const created: Monitor = new Monitor();
    created.name = "checkout-api";
    await act(async () => {
      await ModelAPI.create<Monitor>({ model: created, modelType: Monitor });
    });

    expect(
      ProjectProducts.getState(PROJECT_ID).answer.usage[ProductKey.Monitors],
    ).toBe(ProductUsage.InUse);
    expect(asked).toBe(1);

    /*
     * Opening the menu asks the server what else the create changed; an
     * answer it may have worked out before the create keeps the mark off.
     */
    menu = openProducts();
    await waitFor(() => {
      expect(asked).toBe(2);
    });
    expect(saysNotSetUp(menu, "Monitors")).toBe(false);
    expect(saysNotSetUp(menu, "On-Call")).toBe(true);
  });

  test("the first on-call policy a guided setup makes takes On-Call's off at once", async () => {
    render(navbar());
    await answerArrived();

    serverCreates();
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.name = "Primary on-call";
    await act(async () => {
      await ModelAPI.create<OnCallDutyPolicy>({
        model: policy,
        modelType: OnCallDutyPolicy,
      });
    });

    const menu: HTMLElement = openProducts();
    expect(saysNotSetUp(menu, "On-Call")).toBe(false);
    expect(saysNotSetUp(menu, "Monitors")).toBe(true);
  });

  test("the first logs, arrived meanwhile, show once the menu is opened after REFRESH_AFTER_MS", async () => {
    render(navbar());
    await answerArrived();

    let menu: HTMLElement = openProducts();
    expect(saysNotSetUp(menu, "Logs")).toBe(true);
    closeProducts();

    serverAnswer = {
      ...NOT_SET_UP,
      usage: { ...NOT_SET_UP.usage, [ProductKey.Logs]: ProductUsage.InUse },
    };
    now += REFRESH_AFTER_MS;

    menu = openProducts();
    await waitFor(() => {
      expect(asked).toBe(2);
    });
    await waitFor(() => {
      expect(saysNotSetUp(screen.getByRole("dialog"), "Logs")).toBe(false);
    });
    expect(saysNotSetUp(menu, "Monitors")).toBe(true);
  });

  test("nothing changed: opening the menu again and again asks nothing more", async () => {
    render(navbar());
    await answerArrived();

    for (let look: number = 0; look < 5; look++) {
      openProducts();
      closeProducts();
      now += 2_000;
    }

    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toBe(1);
  });
});

describe("moving between pages and coming back to the tab", () => {
  function Page(props: { pathname: string }): ReactElement {
    useProjectProductsKeptUpToDate(props.pathname);
    return <div />;
  }

  function setVisibility(state: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return state;
      },
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>)["visibilityState"];
  });

  test("the first page asks; another page within REFRESH_AFTER_MS asks nothing; one after it asks", async () => {
    const { rerender } = render(<Page pathname="/dashboard/home" />);
    await answerArrived();
    expect(asked).toBe(1);

    now += REFRESH_AFTER_MS - 1;
    rerender(<Page pathname="/dashboard/monitors" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toBe(1);

    now += 1;
    rerender(<Page pathname="/dashboard/logs" />);
    await waitFor(() => {
      expect(asked).toBe(2);
    });
  });

  test("the same page drawn again asks nothing", async () => {
    const { rerender } = render(<Page pathname="/dashboard/home" />);
    await answerArrived();

    now += REFRESH_AFTER_MS;
    rerender(<Page pathname="/dashboard/home" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(asked).toBe(1);
  });

  test("coming back to the tab after REFRESH_AFTER_MS asks; leaving it, or coming back sooner, does not", async () => {
    render(<Page pathname="/dashboard/home" />);
    await answerArrived();

    now += 1_000;
    setVisibility("visible");
    setVisibility("hidden");
    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toBe(1);

    now += REFRESH_AFTER_MS;
    setVisibility("hidden");
    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toBe(1);

    setVisibility("visible");
    await waitFor(() => {
      expect(asked).toBe(2);
    });
  });

  test("a page gone stops listening to the tab", async () => {
    const { unmount } = render(<Page pathname="/dashboard/home" />);
    await answerArrived();
    unmount();

    now += REFRESH_AFTER_MS;
    setVisibility("visible");
    await act(async () => {
      await Promise.resolve();
    });

    expect(asked).toBe(1);
  });
});
