import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  VisibilityOptions,
  WIDE_DESKTOP_WIDTH_IN_PX,
  describeVisibility,
  isVisibleAtWidth,
  restorePreFixMarkup,
} from "../../ResponsiveVisibility";
import {
  PROJECT_ID,
  goTo,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";

/*
 * The customer report this file exists for: an invited user opened the
 * dashboard on a 1917px screen and found the project picker in the header but
 * no navigation bar under it — no Home, no Products — so there was no way to
 * reach a single product.
 *
 * Their browser carried a stylesheet the app does not ship:
 * `.hidden { display: none !important }`. Bootstrap 3 and HTML5 Boilerplate
 * define exactly that, and browser extensions and user stylesheets inject it
 * into every page. The dashboard hid desktop-only chrome with `hidden md:flex`;
 * the foreign rule matches the bare `hidden` class and outranks `md:flex`, so
 * the nav bar's desktop row vanished at every width. The header's picker has
 * no `hidden` on its way up, which is why it survived and the page looked half
 * broken rather than broken.
 *
 * These render the real nav bar, the real master page and the real Home side
 * menu, and resolve what a browser with that rule would paint. Each group ends
 * with a control that puts the pre-fix class strings back on the rendered
 * markup and shows the same assertion failing — so the tests are proven to
 * catch the regression, not merely to pass.
 */

/*
 * The header logo decodes its .svg import to recolour the mark for dark mode;
 * jest maps every .svg to one shared mock, so one factory covers it.
 */
const ASSET_DATA_URL: string = "data:image/svg+xml;base64,bG9nbw==";

jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return ASSET_DATA_URL;
});

const countMock: MockFunction = getJestMockFunction();

/*
 * The header counts incidents and alerts, and the Home side menu counts what
 * is active; none of those numbers bears on what is painted.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getList: async () => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// No socket in a unit test; every subscription hands back a no-op unsubscribe.
jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToModelEvent: () => {
        return () => {
          // no-op unsubscribe
        };
      },
    },
  };
});

// The project picker asks the server whether project creation is allowed.
jest.mock("../../../UI/Utils/GlobalConfig", () => {
  return {
    __esModule: true,
    default: {
      fetchVars: async () => {
        return { disableUserProjectCreation: false };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        // Only ever stringified by the mocked API layer above.
        return {
          toString: () => {
            return "user-1";
          },
        };
      },
      getProfilePicId: () => {
        return null;
      },
      getProfilePictureRoute: () => {
        return {
          toString: () => {
            return "/api/user/profile-picture/user-1";
          },
        };
      },
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import Project from "../../../Models/DatabaseModels/Project";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import DashboardMasterPage from "../../../../App/FeatureSet/Dashboard/src/Components/MasterPage/MasterPage";
import HomeLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

const WITH_FOREIGN_HIDDEN_RULE: VisibilityOptions = {
  withForeignHiddenRule: true,
};

const MD_WIDTH_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["md"]!;

// From md up the nav bar and the side menu are meant to be on screen.
const DESKTOP_WIDTHS_IN_PX: Array<number> = [
  TABLET_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

// The invited user's one and only project.
const PROJECT_NAME: string = "Acme Production";

const HOME_PATH: string = `/dashboard/${PROJECT_ID}/home`;

type VisibleWithRuleFunction = (width: number) => string;

// What describeVisibility says about an element the rule leaves alone.
const visibleWithRule: VisibleWithRuleFunction = (width: number): string => {
  return `visible at ${width}px with a foreign .hidden rule on the page`;
};

type BuildProjectFunction = () => Project;

const buildProject: BuildProjectFunction = (): Project => {
  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);
  project.name = PROJECT_NAME;
  return project;
};

type RenderFunction = () => Promise<void>;

/*
 * Mounted the way the app mounts it: under a router and the real i18next
 * instance with the dashboard's own English strings, so "Home" and
 * "Products" are the words on the screen.
 */
const renderNavBar: RenderFunction = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[HOME_PATH]}>
        <I18nextProvider i18n={translation}>
          <DashboardNavbar show={true} />
        </I18nextProvider>
      </MemoryRouter>,
    );
  });
};

/*
 * The whole shell as App.tsx mounts it for a signed-in user with one project:
 * header (logo, project picker, rail), nav bar, page, footer.
 */
const renderMasterPage: RenderFunction = async (): Promise<void> => {
  const project: Project = buildProject();

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[HOME_PATH]}>
        <I18nextProvider i18n={translation}>
          <DashboardMasterPage
            isLoading={false}
            error=""
            projects={[project]}
            selectedProject={project}
            onProjectSelected={() => {}}
            showProjectModal={false}
            onProjectModalClose={() => {}}
            hideNavBarOn={[RouteMap[PageMap.PROJECT_SSO] as Route]}
          >
            <div>Home page content</div>
          </DashboardMasterPage>
        </I18nextProvider>
      </MemoryRouter>,
    );
  });
};

/*
 * The Home page's layout with its real side menu, routed as App.tsx routes
 * it: a pathless layout route wrapping the Home page's own route.
 */
const renderHomeLayout: RenderFunction = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[HOME_PATH]}>
        <I18nextProvider i18n={translation}>
          <Routes>
            <PageRoute
              element={
                <HomeLayout
                  currentProject={buildProject()}
                  hasPaymentMethod={true}
                  pageRoute={RouteMap[PageMap.HOME] as Route}
                />
              }
            >
              <PageRoute
                path={(RouteMap[PageMap.HOME] as Route).toString()}
                element={<div>Home page content</div>}
              />
            </PageRoute>
          </Routes>
        </I18nextProvider>
      </MemoryRouter>,
    );
  });
};

type GetElementFunction = () => HTMLElement;

const getHomeLink: GetElementFunction = (): HTMLElement => {
  return screen.getByRole("link", { name: "Home" });
};

const getProductsButton: GetElementFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: "Products" });
};

const getProjectPicker: GetElementFunction = (): HTMLElement => {
  const picker: HTMLElement | null = screen
    .getByText(PROJECT_NAME)
    .closest("button");

  if (!picker) {
    throw new Error("The project picker did not render as a button.");
  }

  return picker;
};

const getHomeSideMenu: GetElementFunction = (): HTMLElement => {
  return screen.getByRole("navigation", { name: "Main navigation" });
};

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.className = "";
  goTo(HOME_PATH);
  countMock.mockImplementation(async () => {
    return 0;
  });

  /*
   * The header looks up who is on call for the project in the URL. Nobody is,
   * which keeps its error dialog out of a test about layout.
   */
  jest.spyOn(API, "get").mockImplementation((): Promise<any> => {
    return Promise.resolve(
      new HTTPResponse<JSONObject>(
        200,
        {
          escalationRulesByUser: [],
          escalationRulesByTeam: [],
          escalationRulesBySchedule: [],
        },
        {},
      ),
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("customer regression: the dashboard nav bar stays on screen under a foreign .hidden rule", () => {
  test.each(DESKTOP_WIDTHS_IN_PX)(
    "at %ipx, Home and Products are on screen with the rule",
    async (width: number) => {
      // The nav bar picks its desktop or phone layout from the window width.
      setViewportWidth(width);

      await renderNavBar();

      expect(
        describeVisibility(getHomeLink(), width, WITH_FOREIGN_HIDDEN_RULE),
      ).toBe(visibleWithRule(width));
      expect(
        describeVisibility(
          getProductsButton(),
          width,
          WITH_FOREIGN_HIDDEN_RULE,
        ),
      ).toBe(visibleWithRule(width));
    },
  );

  test("at the customer's 1917px, Home leads to this project and Products opens every product", async () => {
    setViewportWidth(WIDE_DESKTOP_WIDTH_IN_PX);

    await renderNavBar();

    // Seeing the row is only half of it: it has to take the user somewhere.
    expect(getHomeLink()).toHaveAttribute("href", routeFor(PageMap.HOME));
    expect(routeFor(PageMap.HOME)).toContain(PROJECT_ID);

    expect(
      describeVisibility(
        screen.getByRole("link", { name: "User Settings" }),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(visibleWithRule(WIDE_DESKTOP_WIDTH_IN_PX));

    fireEvent.click(getProductsButton());

    const menu: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });

    expect(
      describeVisibility(
        within(menu).getByRole("link", { name: /Monitors/ }),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(visibleWithRule(WIDE_DESKTOP_WIDTH_IN_PX));
  });

  test("on a phone the compact bar takes over, and the rule leaves that alone too", async () => {
    setViewportWidth(PHONE_WIDTH_IN_PX);

    await renderNavBar();

    // `md:hidden` is a breakpoint class, not the bare one the rule matches.
    expect(
      describeVisibility(
        screen.getByTestId("mobile-nav-toggle"),
        PHONE_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(visibleWithRule(PHONE_WIDTH_IN_PX));
  });

  test("control: with the pre-fix `hidden md:flex` put back, Home and Products vanish at 1917px", async () => {
    setViewportWidth(WIDE_DESKTOP_WIDTH_IN_PX);

    await renderNavBar();

    restorePreFixMarkup();

    const oldRow: string =
      'hidden at 1917px with a foreign .hidden rule on the page by <div class="bg-white flex text-center items-center lg:py-2 hidden md:flex">';

    expect(
      describeVisibility(
        getHomeLink(),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(oldRow);
    expect(
      describeVisibility(
        getProductsButton(),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(oldRow);

    // On a clean page the old row was fine, which is why nobody saw it.
    expect(isVisibleAtWidth(getHomeLink(), WIDE_DESKTOP_WIDTH_IN_PX)).toBe(
      true,
    );
  });
});

describe("customer regression: with one project, the picker and the nav bar are both on screen", () => {
  beforeEach(() => {
    setViewportWidth(WIDE_DESKTOP_WIDTH_IN_PX);
  });

  test("at 1917px with the rule, the master page shows the project picker and Home / Products under it", async () => {
    await renderMasterPage();

    const entries: Array<[string, HTMLElement]> = [
      ["project picker", getProjectPicker()],
      ["Home", getHomeLink()],
      ["Products", getProductsButton()],
    ];

    // One line per entry, so a failure names the entry and what hid it.
    expect(
      entries.map(([label, element]: [string, HTMLElement]): string => {
        return `${label}: ${describeVisibility(
          element,
          WIDE_DESKTOP_WIDTH_IN_PX,
          WITH_FOREIGN_HIDDEN_RULE,
        )}`;
      }),
    ).toEqual(
      entries.map(([label]: [string, HTMLElement]): string => {
        return `${label}: ${visibleWithRule(WIDE_DESKTOP_WIDTH_IN_PX)}`;
      }),
    );
  });

  test("control: with the pre-fix classes put back, the picker stays and the nav bar goes, as in the screenshot", async () => {
    await renderMasterPage();

    restorePreFixMarkup();

    // Exactly the contradiction the customer sent: a picker, and nothing to pick into.
    expect(
      isVisibleAtWidth(
        getProjectPicker(),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(true);
    expect(
      isVisibleAtWidth(
        getHomeLink(),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(false);
    expect(
      isVisibleAtWidth(
        getProductsButton(),
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(false);
  });
});

describe("the Home page's side menu under a foreign .hidden rule", () => {
  test.each(DESKTOP_WIDTHS_IN_PX)(
    "at %ipx the side menu and its links are on screen with the rule",
    async (width: number) => {
      // The side menu, too, picks its layout from the window width.
      setViewportWidth(width);

      await renderHomeLayout();

      const sideMenu: HTMLElement = getHomeSideMenu();

      expect(
        describeVisibility(sideMenu, width, WITH_FOREIGN_HIDDEN_RULE),
      ).toBe(visibleWithRule(width));
      expect(
        describeVisibility(
          within(sideMenu).getByRole("link", { name: /Active Incidents/ }),
          width,
          WITH_FOREIGN_HIDDEN_RULE,
        ),
      ).toBe(visibleWithRule(width));
    },
  );

  test("below md it hands over to its phone toggle, which the rule leaves alone", async () => {
    setViewportWidth(MD_WIDTH_IN_PX - 1);

    await renderHomeLayout();

    expect(
      describeVisibility(
        screen.getByTestId("mobile-sidemenu-toggle"),
        MD_WIDTH_IN_PX - 1,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(visibleWithRule(MD_WIDTH_IN_PX - 1));
  });

  test("control: with the pre-fix `hidden md:block` put back, the side menu vanishes at 1917px", async () => {
    setViewportWidth(WIDE_DESKTOP_WIDTH_IN_PX);

    await renderHomeLayout();

    restorePreFixMarkup();

    const sideMenu: HTMLElement = getHomeSideMenu();

    expect(sideMenu.getAttribute("class")).toMatch(/^hidden md:block /);
    expect(
      isVisibleAtWidth(
        sideMenu,
        WIDE_DESKTOP_WIDTH_IN_PX,
        WITH_FOREIGN_HIDDEN_RULE,
      ),
    ).toBe(false);
    expect(isVisibleAtWidth(sideMenu, WIDE_DESKTOP_WIDTH_IN_PX)).toBe(true);
  });
});
