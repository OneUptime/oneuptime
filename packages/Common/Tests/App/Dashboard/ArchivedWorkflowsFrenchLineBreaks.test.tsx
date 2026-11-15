import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * THE EMPTY ARCHIVED WORKFLOWS PAGE, IN FRENCH, NEVER STARTS A LINE WITH »
 * (#8032).
 *
 * At 1280 px the page's empty list wrapped as "Pour en archiver un,
 * sélectionnez-le dans la liste « Flux de travail" over "» et choisissez «
 * Archiver », ou ouvrez sa page Paramètres.": French writes a space inside
 * its guillemets, and the locale's was a plain one, which a line may break
 * at. jsdom lays nothing out, so the page is read for what decides it: each
 * guillemet holds the words beside it with a no-break space, and no space a
 * line breaks at stands between them. Rendered with the real page and table,
 * from the Dashboard's French file as it ships: Utils/i18n.ts hands it to
 * i18next set with its no-break spaces (withNoBreakSpacesInLocale), since
 * the table draws its empty list's message with t(), not the Translator.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/API/API",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...(actual["default"] as Record<string, unknown>),
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import { WORKFLOW_ARCHIVE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import WorkflowsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Archived";
import Route from "../../../Types/API/Route";
import {
  NO_BREAK_SPACE,
  NoBreakLocaleTree,
  withNoBreakSpacesInLocale,
} from "../../../Types/NoBreakSpaces";
import Permission from "../../../Types/Permission";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const FRENCH_AS_WRITTEN: Record<string, string> = readDashboardLocale("fr");

const FRENCH_AS_SHIPPED: NoBreakLocaleTree = withNoBreakSpacesInLocale({
  locale: FRENCH_AS_WRITTEN,
  language: "fr",
  english: readDashboardLocale("en"),
});

// A space a line may break at: the space and the fixed-width ones.
const BREAKING_SPACE: string = "[\\u0020\\u2000-\\u2006\\u2008-\\u200A\\u205F]";

// A guillemet a line could start with, or one it could end with.
const GUILLEMET_ALONE: RegExp = new RegExp(
  `${BREAKING_SPACE}[»›]|[«‹]${BREAKING_SPACE}`,
  "u",
);

// A French mark a line could start with.
const MARK_ALONE: RegExp = new RegExp(
  `[\\p{L}\\p{N}»)]${BREAKING_SPACE}+[?!:;](?=\\s|$)`,
  "u",
);

// The page's text as it is drawn, spaces and all: no space is folded.
function drawnText(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

async function renderArchivedWorkflows(): Promise<HTMLElement> {
  const path: string = `/dashboard/${PROJECT_ID}/workflows/archived`;

  goTo(path);

  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <WorkflowsArchived
        pageRoute={new Route(path)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("table-empty-state-title");

  return container;
}

async function inFrench(locale: NoBreakLocaleTree): Promise<void> {
  await act(async (): Promise<void> => {
    i18next.addResourceBundle("fr", "translation", locale, true, true);
    await i18next.changeLanguage("fr");
  });
}

beforeAll(async () => {
  permissionsForTest = [Permission.ProjectAdmin];

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

describe("the empty Archived Workflows page in French, as the Dashboard ships it", () => {
  beforeAll(async () => {
    await inFrench(FRENCH_AS_SHIPPED);
  });

  test("its empty list's message holds « Flux de travail » and « Archiver » with their words", async () => {
    await renderArchivedWorkflows();

    const description: string = drawnText(
      screen.getByTestId("table-empty-state-description"),
    );

    expect(description).toBe(
      `Pour en archiver un, sélectionnez-le dans la liste «${NO_BREAK_SPACE}Flux de travail${NO_BREAK_SPACE}» et choisissez «${NO_BREAK_SPACE}Archiver${NO_BREAK_SPACE}», ou ouvrez sa page Paramètres.`,
    );
  });

  test("no guillemet and no mark anywhere on the page can start or end a line alone", async () => {
    const text: string = drawnText(await renderArchivedWorkflows());

    // The page is in French, and its sentences have guillemets to hold.
    expect(text).toContain("Flux de travail archivés");
    expect(text).toContain("«");
    expect(text.match(GUILLEMET_ALONE)).toBeNull();
    expect(text.match(MARK_ALONE)).toBeNull();
  });

  test("the French file itself still writes plain spaces, as its translators type them", () => {
    expect(
      FRENCH_AS_WRITTEN[WORKFLOW_ARCHIVE_COPY.noArchivedItemsMessage],
    ).toContain("« Flux de travail »");
  });
});

describe("the checks catch a guillemet a line could start with (control)", () => {
  test("a plain space before » and after «", () => {
    expect(GUILLEMET_ALONE.test("la liste « Flux de travail » et")).toBe(true);
    expect(
      GUILLEMET_ALONE.test(
        `la liste «${NO_BREAK_SPACE}Flux de travail${NO_BREAK_SPACE}» et`,
      ),
    ).toBe(false);
  });

  test("a plain space before ? or :", () => {
    expect(MARK_ALONE.test("Archiver 3 flux de travail ?")).toBe(true);
    expect(MARK_ALONE.test("Dupliquer : Flux")).toBe(true);
    expect(MARK_ALONE.test("Archiver 3 flux de travail\u202F?")).toBe(false);
  });
});
