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
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * ISSUE #7033: "Moving from another tool?" in a product's How it works.
 *
 * The empty Monitors, On-Call and Status Pages lists offer the importer
 * (#6809), and once a list had a record nothing did: How it works, the
 * product's explanation behind the ? beside its title, never named it.
 * The real dialog is drawn here, as every product's layout draws it, with
 * the Dashboard's real locales: one quiet line under its buttons, the
 * empty list's own link and tools, for whoever may run the import, on the
 * three products an import fills and no other. It closes the dialog as it
 * opens the importer, saying How it works opened it.
 */

let mockPermissions: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
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
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import ProductAboutButton, {
  PRODUCT_ABOUT_DIALOG_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductAboutButton";
import ProductShowcase, {
  PRODUCT_SHOWCASE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductShowcase";
import {
  RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID,
  RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID,
  RESOURCE_SHOWCASE_PITCH_TEST_ID,
  RESOURCE_SHOWCASE_PREVIEW_TEST_ID,
  RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard";
import {
  TOOL_IMPORT_HOW_IT_WORKS_QUESTION,
  TOOL_IMPORT_HOW_IT_WORKS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportOffer";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import ProductKey, {
  ONBOARDED_PRODUCT_KEYS,
  OnboardedProductKey,
} from "../../../Types/Product/ProductKey";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fa"];

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
}

const IMPORTER_PATH: string = (
  RouteMap[PageMap.SETTINGS_IMPORT_FROM_TOOL] as Route
)
  .toString()
  .replace(":projectId", PROJECT_ID);

/*
 * The three products an import fills: the line's words, and the address
 * it opens - the importer on the tools that fill the list, saying How it
 * works opened it.
 */
const OFFERING: Array<[OnboardedProductKey, string, string]> = [
  [
    ProductKey.Monitors,
    "Import from UptimeRobot, Better Stack, Pingdom and others",
    "?from=monitors-how-it-works&kind=Monitor",
  ],
  [
    ProductKey.OnCall,
    "Import from Opsgenie, PagerDuty, incident.io and others",
    "?from=on-call-how-it-works&kind=OnCallPolicy",
  ],
  [
    ProductKey.StatusPages,
    "Import from UptimeRobot, Atlassian Statuspage or Better Stack",
    "?from=status-pages-how-it-works&kind=StatusPage",
  ],
];

let navigated: Array<string> = [];

function asRole(permissions: Array<Permission>): void {
  mockPermissions = permissions;
  PermissionGate.clearPermissionPropsCache();
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// How it works, opened, as a product page's ? opens it.
async function openHowItWorks(
  product: OnboardedProductKey,
): Promise<HTMLElement> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ProductAboutButton product={product} />
      </MemoryRouter>,
    );
  });
  await settle();

  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
  await settle();

  return screen.getByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID);
}

function importLine(): HTMLElement | null {
  return screen.queryByTestId(TOOL_IMPORT_HOW_IT_WORKS_TEST_ID);
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  asRole([Permission.ProjectOwner]);
  navigated = [];
  goTo(`/dashboard/${PROJECT_ID}/monitors`);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((route: unknown): void => {
      navigated.push(String(route));
    });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await readIn("en");
});

describe("How it works on the products an import fills", () => {
  test.each(OFFERING)(
    "%s: one quiet line, the question and the empty list's own link",
    async (product: OnboardedProductKey, words: string, query: string) => {
      const dialog: HTMLElement = await openHowItWorks(product);
      const line: HTMLElement = within(dialog).getByTestId(
        TOOL_IMPORT_HOW_IT_WORKS_TEST_ID,
      );
      const link: HTMLElement = within(line).getByRole("link");

      expect(
        within(dialog).getAllByTestId(TOOL_IMPORT_HOW_IT_WORKS_TEST_ID),
      ).toHaveLength(1);
      // Two sentences side by side, each whole.
      expect(textOf(line)).toBe(
        `${TOOL_IMPORT_HOW_IT_WORKS_QUESTION} ${words}`,
      );
      expect(textOf(link)).toBe(words);
      // A real address: it opens in a new tab with a modified click too.
      expect(link).toHaveAttribute("href", `${IMPORTER_PATH}${query}`);
      // Quiet: a link in the line's small words, never a second button.
      expect(line.tagName).toBe("P");
      expect(line).toHaveClass("text-sm");
      expect(link.className).not.toContain("bg-");
      expect(within(dialog).getAllByRole("link", { name: words })).toHaveLength(
        1,
      );
    },
  );

  test.each(OFFERING)(
    "%s: it sits under the explanation's buttons, in the pitch beside the example",
    async (product: OnboardedProductKey) => {
      const dialog: HTMLElement = await openHowItWorks(product);
      const line: HTMLElement = within(dialog).getByTestId(
        TOOL_IMPORT_HOW_IT_WORKS_TEST_ID,
      );
      const follows: (a: HTMLElement, b: HTMLElement) => boolean = (
        a: HTMLElement,
        b: HTMLElement,
      ): boolean => {
        return Boolean(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      };

      for (const before of [
        RESOURCE_SHOWCASE_SETUP_BUTTON_TEST_ID,
        RESOURCE_SHOWCASE_GUIDE_LINK_TEST_ID,
        RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID,
      ]) {
        expect({
          before,
          isBefore: follows(within(dialog).getByTestId(before), line),
        }).toEqual({ before, isBefore: true });
      }

      // In the pitch, before the example drawn beside it.
      expect(
        follows(
          line,
          within(dialog).getByTestId(RESOURCE_SHOWCASE_PREVIEW_TEST_ID),
        ),
      ).toBe(true);
      expect(
        within(dialog)
          .getByTestId(RESOURCE_SHOWCASE_PITCH_TEST_ID)
          .contains(line),
      ).toBe(true);
    },
  );

  test.each(OFFERING)(
    "%s: the link closes the dialog as it opens the importer, saying How it works opened it",
    async (product: OnboardedProductKey, words: string, query: string) => {
      const dialog: HTMLElement = await openHowItWorks(product);

      await act(async () => {
        fireEvent.click(within(dialog).getByRole("link", { name: words }));
      });

      expect(navigated).toEqual([`${IMPORTER_PATH}${query}`]);
      expect(screen.queryByTestId(PRODUCT_ABOUT_DIALOG_TEST_ID)).toBeNull();
    },
  );
});

describe("who and where it is offered", () => {
  test("every other product's How it works has no such line: no import fills its list", async () => {
    const others: Array<OnboardedProductKey> = ONBOARDED_PRODUCT_KEYS.filter(
      (product: OnboardedProductKey): boolean => {
        return !OFFERING.some(
          (entry: [OnboardedProductKey, string, string]): boolean => {
            return entry[0] === product;
          },
        );
      },
    );

    expect(others.length).toBeGreaterThan(30);

    for (const product of [
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.Services,
      ProductKey.Logs,
      ProductKey.Workflows,
      ProductKey.ScheduledMaintenance,
    ] as Array<OnboardedProductKey>) {
      expect(others).toContain(product);

      const dialog: HTMLElement = await openHowItWorks(product);

      expect({
        product,
        line: within(dialog).queryByTestId(TOOL_IMPORT_HOW_IT_WORKS_TEST_ID),
      }).toEqual({ product, line: null });
      cleanup();
    }
  });

  test.each(OFFERING)(
    "%s: a read-only member reads How it works without it, as they get no empty list's link",
    async (product: OnboardedProductKey) => {
      asRole([Permission.Viewer]);

      const dialog: HTMLElement = await openHowItWorks(product);

      // The explanation is all there; only the line is left out.
      expect(
        within(dialog).getByTestId(RESOURCE_SHOWCASE_DOCS_LINK_TEST_ID),
      ).toBeInTheDocument();
      expect(importLine()).toBeNull();
      expect(dialog).not.toHaveTextContent(TOOL_IMPORT_HOW_IT_WORKS_QUESTION);
    },
  );

  test("someone who may create monitors and nothing else is offered it on Monitors only", async () => {
    asRole([Permission.CreateProjectMonitor]);

    await openHowItWorks(ProductKey.Monitors);
    expect(importLine()).not.toBeNull();
    cleanup();

    await openHowItWorks(ProductKey.OnCall);
    expect(importLine()).toBeNull();
    cleanup();

    await openHowItWorks(ProductKey.StatusPages);
    expect(importLine()).toBeNull();
  });

  test("before the permissions have loaded, nothing is offered", async () => {
    asRole([]);

    await openHowItWorks(ProductKey.Monitors);

    expect(importLine()).toBeNull();
  });

  test.each([ProductKey.Monitors, ProductKey.OnCall, ProductKey.StatusPages])(
    "%s's empty list explanation draws no second link: the empty state's own is beside it",
    async (product: ProductKey) => {
      await act(async () => {
        render(
          <MemoryRouter>
            <ProductShowcase product={product as OnboardedProductKey} />
          </MemoryRouter>,
        );
      });
      await settle();

      expect(screen.getByTestId(PRODUCT_SHOWCASE_TEST_ID)).toBeInTheDocument();
      expect(importLine()).toBeNull();
    },
  );

  test.each([
    ["Monitor/Layout.tsx", ProductKey.Monitors],
    ["OnCallDuty/Layout.tsx", ProductKey.OnCall],
    ["StatusPages/Layout.tsx", ProductKey.StatusPages],
  ])(
    "Pages/%s draws How it works for %s, beside the title of every page of the product",
    (file: string, product: string) => {
      const layout: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, "Pages", file),
        "utf8",
      );
      const key: string = Object.keys(ProductKey).find(
        (name: string): boolean => {
          return (
            (ProductKey as unknown as Record<string, string>)[name] === product
          );
        },
      )!;

      expect(layout).toContain(
        `titleRight={<ProductAboutButton product={ProductKey.${key}} />}`,
      );
    },
  );
});

describe("in the reader's language", () => {
  test("German: the question as the numbering help asks it, the link in German, the tools as they are", async () => {
    await readIn("de");

    const dialog: HTMLElement = await openHowItWorks(ProductKey.StatusPages);
    const line: HTMLElement = within(dialog).getByTestId(
      TOOL_IMPORT_HOW_IT_WORKS_TEST_ID,
    );

    expect(textOf(line)).toBe(
      "Sie wechseln von einem anderen Tool? Import aus UptimeRobot, Atlassian Statuspage oder Better Stack",
    );
    expect(textOf(line)).not.toContain(TOOL_IMPORT_HOW_IT_WORKS_QUESTION);
  });

  test("Persian: the question and the link in Persian, the tools' names in Latin letters", async () => {
    await readIn("fa");

    const dialog: HTMLElement = await openHowItWorks(ProductKey.OnCall);
    const line: HTMLElement = within(dialog).getByTestId(
      TOOL_IMPORT_HOW_IT_WORKS_TEST_ID,
    );
    const text: string = textOf(line);

    expect(text.startsWith("از ابزار دیگری می‌آیید؟")).toBe(true);
    expect(text).toContain("درون‌ریزی از");
    for (const tool of ["Opsgenie", "PagerDuty", "incident.io"]) {
      expect(text).toContain(tool);
    }
    expect(text).not.toContain("Import from");
  });
});
