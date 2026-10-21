import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";
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
import StatusPageHeader from "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header";
import StatusPageNavBar from "../../../../App/FeatureSet/StatusPage/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";

/*
 * A status page's header links and nav bar under a foreign
 * `.hidden { display: none !important }`.
 *
 * The dashboard lost its navigation bar to that rule: Bootstrap 3 and HTML5
 * Boilerplate define it, and browser extensions and user stylesheets inject it
 * into every page. Status pages are read by our customers' own customers, on
 * browsers we know even less about, and both rows here were hidden the same
 * way — `hidden md:flex` — so the rule matched the bare class, outranked
 * `md:flex`, and took the header links and every nav entry (Incidents,
 * Subscribe, Log Out on a private page) off a desktop screen. A visitor
 * checking on an outage was left with the overview and no way to the incident
 * history.
 *
 * Both rows now use `max-md:hidden md:flex`: the same paint on a clean page,
 * without the class the rule targets. Each group ends with a control that
 * puts the old class strings back on the rendered markup and shows the same
 * assertion failing.
 */

const translation: i18n = createInstance();

const WITH_FOREIGN_HIDDEN_RULE: VisibilityOptions = {
  withForeignHiddenRule: true,
};

const MD_WIDTH_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["md"]!;

// From md up both rows are meant to be on screen.
const DESKTOP_WIDTHS_IN_PX: Array<number> = [
  TABLET_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

// Below md both rows fold behind a menu button.
const PHONE_WIDTHS_IN_PX: Array<number> = [
  PHONE_WIDTH_IN_PX,
  MD_WIDTH_IN_PX - 1,
];

// The kind of links a status page owner puts in the header.
const HEADER_LINKS: Array<Link> = [
  { title: "Website", to: URL.fromString("https://example.com") },
  {
    title: "Support",
    to: URL.fromString("https://example.com/support"),
    openInNewTab: true,
  },
];

// Every entry a private page with subscriptions and history shows.
const NAV_ENTRIES: Array<string> = [
  "Overview",
  "Incidents",
  "Announcements",
  "Scheduled Events",
  "Subscribe",
  "Log Out",
];

type VisibleWithRuleFunction = (width: number) => string;

// What describeVisibility says about an element the rule leaves alone.
const visibleWithRule: VisibleWithRuleFunction = (width: number): string => {
  return `visible at ${width}px with a foreign .hidden rule on the page`;
};

type RenderFunction = () => Promise<void>;

const renderHeader: RenderFunction = async (): Promise<void> => {
  await act(async () => {
    render(<StatusPageHeader links={HEADER_LINKS} onLogoClicked={() => {}} />);
  });
};

const renderNavBar: RenderFunction = async (): Promise<void> => {
  await act(async () => {
    render(
      <I18nextProvider i18n={translation}>
        <StatusPageNavBar
          show={true}
          isPreview={false}
          isPrivateStatusPage={true}
          enableEmailSubscribers={true}
          enableSMSSubscribers={false}
          showIncidentsOnStatusPage={true}
          showAnnouncementsOnStatusPage={true}
          showScheduledMaintenanceEventsOnStatusPage={true}
          showSubscriberPageOnStatusPage={true}
        />
      </I18nextProvider>,
    );
  });
};

type GetElementFunction = (name: string) => HTMLElement;

// The desktop copies are links; the phone bar's active entry is a button.
const getLink: GetElementFunction = (name: string): HTMLElement => {
  return screen.getByRole("link", { name });
};

beforeAll(async () => {
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
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("status page header links with a foreign .hidden rule on the page", () => {
  test.each(DESKTOP_WIDTHS_IN_PX)(
    "at %ipx every header link is on screen with the rule",
    async (width: number) => {
      await renderHeader();

      for (const link of HEADER_LINKS) {
        expect(
          describeVisibility(
            getLink(link.title),
            width,
            WITH_FOREIGN_HIDDEN_RULE,
          ),
        ).toBe(visibleWithRule(width));
      }
    },
  );

  test("below md they fold behind the menu button, which the rule leaves alone", async () => {
    await renderHeader();

    for (const width of PHONE_WIDTHS_IN_PX) {
      for (const link of HEADER_LINKS) {
        expect(
          isVisibleAtWidth(
            getLink(link.title),
            width,
            WITH_FOREIGN_HIDDEN_RULE,
          ),
        ).toBe(false);
      }

      // `md:hidden` is a breakpoint class, not the bare one the rule matches.
      expect(
        describeVisibility(
          screen.getByTestId("mobile-header-toggle"),
          width,
          WITH_FOREIGN_HIDDEN_RULE,
        ),
      ).toBe(visibleWithRule(width));
    }
  });

  test("control: with the pre-fix `hidden md:flex` put back, the links vanish at 1917px", async () => {
    await renderHeader();

    restorePreFixMarkup();

    for (const link of HEADER_LINKS) {
      expect(
        describeVisibility(
          getLink(link.title),
          WIDE_DESKTOP_WIDTH_IN_PX,
          WITH_FOREIGN_HIDDEN_RULE,
        ),
      ).toBe(
        'hidden at 1917px with a foreign .hidden rule on the page by <div class="hidden md:flex md:items-center md:gap-5">',
      );

      // On a clean page the old row was fine, which is why nobody saw it.
      expect(
        isVisibleAtWidth(getLink(link.title), WIDE_DESKTOP_WIDTH_IN_PX),
      ).toBe(true);
    }
  });
});

describe("status page nav bar with a foreign .hidden rule on the page", () => {
  test.each(DESKTOP_WIDTHS_IN_PX)(
    "at %ipx every nav entry is on screen with the rule",
    async (width: number) => {
      await renderNavBar();

      // One line per entry, so a failure names the entry and what hid it.
      expect(
        NAV_ENTRIES.map((name: string): string => {
          return `${name}: ${describeVisibility(
            getLink(name),
            width,
            WITH_FOREIGN_HIDDEN_RULE,
          )}`;
        }),
      ).toEqual(
        NAV_ENTRIES.map((name: string): string => {
          return `${name}: ${visibleWithRule(width)}`;
        }),
      );
    },
  );

  test("below md the compact bar takes over, and the rule leaves that alone too", async () => {
    await renderNavBar();

    for (const width of PHONE_WIDTHS_IN_PX) {
      expect(
        isVisibleAtWidth(getLink("Incidents"), width, WITH_FOREIGN_HIDDEN_RULE),
      ).toBe(false);

      expect(
        describeVisibility(
          screen.getByTestId("mobile-nav-toggle"),
          width,
          WITH_FOREIGN_HIDDEN_RULE,
        ),
      ).toBe(visibleWithRule(width));
    }
  });

  test("control: with the pre-fix `hidden md:flex` put back, every entry vanishes at 1917px", async () => {
    await renderNavBar();

    restorePreFixMarkup();

    for (const name of NAV_ENTRIES) {
      expect(
        describeVisibility(
          getLink(name),
          WIDE_DESKTOP_WIDTH_IN_PX,
          WITH_FOREIGN_HIDDEN_RULE,
        ),
      ).toBe(
        'hidden at 1917px with a foreign .hidden rule on the page by <div class="mt-5 hidden justify-between rounded-lg bg-white px-5 py-2 text-center shadow md:flex">',
      );
    }

    // On a clean page the old row was fine, which is why nobody saw it.
    expect(
      isVisibleAtWidth(getLink("Incidents"), WIDE_DESKTOP_WIDTH_IN_PX),
    ).toBe(true);
  });
});
