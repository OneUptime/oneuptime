import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import CardSelect, {
  CardSelectOption,
} from "../../../UI/Components/CardSelect/CardSelect";
import Page from "../../../UI/Components/Page/Page";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";

/*
 * A NAME SOMEONE TYPED IS DRAWN AS THEY TYPED IT.
 *
 * The Dashboard looks interface text up by its English, so a record whose
 * name happens to be some interface text was shown translated: a custom role
 * called "Incident Responder" - a placeholder the Dashboard translates - read
 * "Vorfallbearbeiter" to a German reader on Create Team's Access cards, a
 * team's Add Custom Role cards and at the end of the role page's breadcrumb
 * trail (custom roles UI review). A card marked isUserContent and a link
 * marked isRecordName are drawn as given; everything else is still looked
 * up, which the control cases pin.
 *
 * Also here: a card picker's idle search line says what its own search reads
 * (CardSelect searchHint) - the default is worded for monitor types.
 *
 * Read from the Dashboard's own German file, with i18next set up as the
 * Dashboard sets it up.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const GERMAN: Record<string, unknown> = readLocale("de");

// A role's name that is also a string the Dashboard translates.
const ROLE_NAME: string = "Incident Responder";
const ROLE_NAME_IN_GERMAN: string = GERMAN[ROLE_NAME] as string;

// Interface text on a card that is not marked: still looked up.
const VIEWER: string = "Viewer";
const VIEWER_IN_GERMAN: string = GERMAN[VIEWER] as string;

const ROLE_CARD: CardSelectOption = {
  value: "customRole:30000000-0000-4000-8000-000000000001",
  title: ROLE_NAME,
  description: "Custom role · 6 permissions",
  icon: IconProp.Identification,
  isUserContent: true,
};

const VIEWER_CARD: CardSelectOption = {
  value: "Viewer",
  title: VIEWER,
  description: "Read everything in the project. Change nothing.",
  icon: IconProp.Eye,
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: { translation: GERMAN },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("de");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("the German file the cases below lean on", () => {
  test("translates the role's name and the built-in role, so a lookup would change them", () => {
    expect(ROLE_NAME_IN_GERMAN).toBeTruthy();
    expect(ROLE_NAME_IN_GERMAN).not.toBe(ROLE_NAME);
    expect(VIEWER_IN_GERMAN).toBeTruthy();
    expect(VIEWER_IN_GERMAN).not.toBe(VIEWER);
  });
});

describe("a card picker", () => {
  test("draws a card marked as typed by someone as given, and looks the others up", () => {
    render(
      <CardSelect
        options={[VIEWER_CARD, ROLE_CARD]}
        value={undefined}
        onChange={() => {}}
        singleColumn={true}
      />,
    );

    const roleCard: HTMLElement = screen.getByTestId(
      `card-select-option-${ROLE_CARD.value}`,
    );
    expect(within(roleCard).getByText(ROLE_NAME)).toBeInTheDocument();
    expect(within(roleCard).queryByText(ROLE_NAME_IN_GERMAN)).toBeNull();
    expect(roleCard).toHaveTextContent("Custom role · 6 permissions");

    const viewerCard: HTMLElement = screen.getByTestId(
      `card-select-option-${VIEWER_CARD.value}`,
    );
    expect(within(viewerCard).getByText(VIEWER_IN_GERMAN)).toBeInTheDocument();
  });

  test("keeps the typed name in the searchable list too", () => {
    render(
      <CardSelect
        options={[VIEWER_CARD, ROLE_CARD]}
        value={undefined}
        onChange={() => {}}
        singleColumn={true}
        searchable={true}
      />,
    );

    expect(
      within(
        screen.getByTestId(`card-select-option-${ROLE_CARD.value}`),
      ).getByText(ROLE_NAME),
    ).toBeInTheDocument();
  });

  test("says what its own search reads while nothing is typed", () => {
    const hint: PluralTemplate = {
      one: "{{count}} to choose from. Search by name or by what a role allows.",
      other:
        "{{count}} to choose from. Search by name or by what a role allows.",
    };

    render(
      <CardSelect
        options={[VIEWER_CARD, ROLE_CARD]}
        value={undefined}
        onChange={() => {}}
        singleColumn={true}
        searchable={true}
        searchHint={hint}
      />,
    );

    const summary: HTMLElement = screen.getByTestId(
      "card-select-search-summary",
    );
    // The reader's language words it, with the count in it.
    expect(summary).toHaveTextContent(
      (GERMAN[hint.other] as string).replace("{{count}}", "2"),
    );
    expect(summary).not.toHaveTextContent("what you want to watch");
  });

  test("keeps the monitor-type wording when no hint is given", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });

    render(
      <CardSelect
        options={[VIEWER_CARD, ROLE_CARD]}
        value={undefined}
        onChange={() => {}}
        singleColumn={true}
        searchable={true}
      />,
    );

    expect(screen.getByTestId("card-select-search-summary")).toHaveTextContent(
      "2 to choose from. Search by name, category, or what you want to watch.",
    );
  });
});

describe("a breadcrumb trail", () => {
  const trail: Array<Link> = [
    { title: "Project", to: new Route("/dashboard/project") },
    { title: "Roles", to: new Route("/dashboard/project/teams/roles") },
    {
      title: ROLE_NAME,
      to: new Route("/dashboard/project/teams/roles/role"),
      isRecordName: true,
    },
  ];

  test("draws a record's name as typed, and looks the pages up", () => {
    render(<Breadcrumbs links={trail} />);

    const nav: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });
    expect(within(nav).getByText(ROLE_NAME)).toBeInTheDocument();
    expect(within(nav).queryByText(ROLE_NAME_IN_GERMAN)).toBeNull();
    expect(
      within(nav).getByText(GERMAN["Roles"] as string),
    ).toBeInTheDocument();
  });

  test("still looks up a link not marked as a record's name", () => {
    render(
      <Breadcrumbs
        links={[
          { title: "Project", to: new Route("/dashboard/project") },
          { title: ROLE_NAME, to: new Route("/dashboard/project/x") },
        ]}
      />,
    );

    expect(screen.getByText(ROLE_NAME_IN_GERMAN)).toBeInTheDocument();
  });

  test("names the browser tab with the record's name as typed", () => {
    render(
      <Page title="Teams" breadcrumbLinks={trail}>
        <div>Role page</div>
      </Page>,
    );

    expect(document.title).toContain(ROLE_NAME);
    expect(document.title).not.toContain(ROLE_NAME_IN_GERMAN);
    expect(document.title).toContain(GERMAN["Roles"] as string);
  });
});
