import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import frenchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fr.json";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  OnCallDutyRoutePath,
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const OTHER_PROJECT_ID: string = "7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const MODEL_ID: ObjectID = new ObjectID("0193c0de-5555-4aaa-8bbb-000000000005");
const SUB_MODEL_ID: ObjectID = new ObjectID(
  "0193c0de-5555-4aaa-8bbb-000000000006",
);

/*
 * Exercise the real catalog and navbar on every registered On-Call page,
 * including sibling sections that are not below the policies landing page.
 */
const ON_CALL_PAGES: Array<string> = [
  PageMap.ON_CALL_DUTY,
  ...Object.keys(OnCallDutyRoutePath),
];

function navbar(): ReactElement {
  return (
    <I18nextProvider i18n={translation}>
      <DashboardNavbar show={true} />
    </I18nextProvider>
  );
}

function pagePath(page: string): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: MODEL_ID,
    subModelId: SUB_MODEL_ID,
  }).toString();
}

function expectOnCallSelected(width: number): void {
  expect(screen.getByText("On-Call Duty", { exact: true })).toBeVisible();
  expect(
    screen.queryByText("Products", { exact: true }),
  ).not.toBeInTheDocument();

  if (width === MOBILE_WIDTH) {
    expect(screen.getByTestId("mobile-nav-toggle")).toBeVisible();
    expect(screen.queryByText("Home", { exact: true })).not.toBeInTheDocument();
  } else {
    expect(screen.getByRole("button", { name: "On-Call Duty" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
  }
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      fr: { translation: frenchLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/home`);
  await translation.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe.each([
  ["desktop", DESKTOP_WIDTH],
  ["mobile", MOBILE_WIDTH],
] as Array<[string, number]>)(
  "On-Call navbar on %s",
  (_viewport: string, width: number) => {
    beforeEach(() => {
      setViewportWidth(width);
    });

    test.each(ON_CALL_PAGES)("selects On-Call Duty on %s", (page: string) => {
      goTo(pagePath(page));
      render(navbar());

      expectOnCallSelected(width);
    });

    test.each(["", "/", "/schedules/", `/schedules/${MODEL_ID}/layers/`])(
      "selects On-Call Duty on the section root or trailing slash: %s",
      (suffix: string) => {
        goTo(`/dashboard/${PROJECT_ID}/on-call-duty${suffix}`);
        render(navbar());

        expectOnCallSelected(width);
      },
    );

    test.each([
      ["home", "Home"],
      ["monitors", "Monitors"],
      [`incidents/${MODEL_ID}/on-call-policy-execution-logs`, "Incidents"],
      [`alerts/${MODEL_ID}/on-call-policy-execution-logs`, "Alerts"],
      [`users/${MODEL_ID}/on-call-readiness`, "Users"],
      [`teams/${MODEL_ID}/on-call-schedules`, "Teams"],
      ["on-call-duty-archive", "Home"],
    ])(
      "does not claim another product's route: %s",
      (suffix: string, title: string) => {
        goTo(`/dashboard/${PROJECT_ID}/${suffix}`);
        render(navbar());

        expect(screen.queryByText("On-Call Duty")).not.toBeInTheDocument();
        expect(screen.getByText(title, { exact: true })).toBeVisible();
      },
    );

    test("updates when navigating into and out of schedules", () => {
      const { rerender } = render(navbar());
      expect(screen.queryByText("On-Call Duty")).not.toBeInTheDocument();

      goTo(pagePath(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW));
      rerender(navbar());
      expectOnCallSelected(width);

      goTo(`/dashboard/${PROJECT_ID}/monitors`);
      rerender(navbar());
      expect(screen.getByText("Monitors", { exact: true })).toBeVisible();
      expect(screen.queryByText("On-Call Duty")).not.toBeInTheDocument();
    });

    test("keeps the selection when switching projects and languages", async () => {
      goTo(pagePath(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW));
      const { rerender } = render(navbar());
      expectOnCallSelected(width);

      goTo(`/dashboard/${OTHER_PROJECT_ID}/on-call-duty/schedules/${MODEL_ID}`);
      rerender(navbar());
      expectOnCallSelected(width);

      await act(async () => {
        await translation.changeLanguage("fr");
      });
      expect(screen.getByText("Astreinte", { exact: true })).toBeVisible();
      expect(screen.queryByText("On-Call Duty")).not.toBeInTheDocument();
    });
  },
);

test("the selected product still opens the menu and links to this project's policies", () => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${OTHER_PROJECT_ID}/on-call-duty/schedules/${MODEL_ID}`);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  render(navbar());

  fireEvent.click(screen.getByRole("button", { name: "On-Call Duty" }));
  const menu: HTMLElement = screen.getByRole("dialog", {
    name: "Products menu",
  });
  expect(
    within(menu).getByRole("option", { selected: true }),
  ).toHaveTextContent("On-Call Duty");
  const link: HTMLElement = within(menu).getByRole("link", {
    name: /On-Call Duty/,
  });
  const landingPath: string = `/dashboard/${OTHER_PROJECT_ID}/on-call-duty/policies`;
  expect(link).toHaveAttribute("href", landingPath);

  fireEvent.click(link);
  expect(Navigation.navigate).toHaveBeenCalledWith(new Route(landingPath));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
