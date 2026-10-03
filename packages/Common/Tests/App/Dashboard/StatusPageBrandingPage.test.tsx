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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A status page's Branding page, wired: one page where there were five
 * screens (Essential Branding, Header, Footer, Overview Page, Languages).
 * What nearly everyone sets comes first, in the order a visitor meets it;
 * what few people change - the history chart's colors, the languages and
 * search engine indexing - is folded under Advanced, which says
 * "Configured" while any of it differs from a new page's.
 *
 * The cards are recorded rather than drawn (CardModelDetail, ModelTable and
 * the Search Engine Indexing card have suites of their own): what matters
 * here is which cards the page hands what, in what order, and what the
 * folded section says. The section itself is the real one.
 */

type Recorded = { kind: string; props: Record<string, unknown> };

interface RecorderStore {
  latest: Map<string, Recorded>;
}

const store: RecorderStore = { latest: new Map<string, Recorded>() };

(
  globalThis as unknown as { __brandingPageRecorded: RecorderStore }
).__brandingPageRecorded = store;

type Recorder = (
  kind: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (kind: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    const name: string = (props["name"] as string | undefined) || kind;

    (
      globalThis as unknown as { __brandingPageRecorded: RecorderStore }
    ).__brandingPageRecorded.latest.set(name, { kind: kind, props: props });

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", {
      "data-testid": "recorded-card",
      "data-card": name,
      "data-kind": kind,
    });
  };
};

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return { __esModule: true, default: mockRecorder("card-model-detail") };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return { __esModule: true, default: mockRecorder("model-table") };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SearchEngineIndexingCard",
  () => {
    return {
      __esModule: true,
      default: mockRecorder("search-engine-indexing"),
    };
  },
);

import StatusPageBranding from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding";
import StatusPageBrandingCopy, {
  BRANDING_ADVANCED_SECTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageFooterLink from "../../../Models/DatabaseModels/StatusPageFooterLink";
import StatusPageHeaderLink from "../../../Models/DatabaseModels/StatusPageHeaderLink";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import Route from "../../../Types/API/Route";
import { Green } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { SUPPORTED_STATUS_PAGE_LANGUAGES } from "../../../Types/StatusPage/StatusPageLanguage";
import { ADVANCED_FORM_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

// Every card on the page, by its analytics name, top to bottom.
const MAIN_CARDS: Array<string> = [
  "Status Page > Branding > Header Style",
  "Status Page > Branding > Title and Description",
  "Status Page > Branding > Favicon",
  "Status Page > Header Links",
  "Status Page > Branding > Overview Page",
  "Status Page > Branding > Copyright",
  "Status Page > Footer Links",
];

const ADVANCED_CARDS: Array<string> = [
  "Status Page > Branding > Default Bar Color",
  "Status Page > Branding > History Chart Bar Color Rules",
  "Status Page > Languages",
  "search-engine-indexing",
];

beforeEach(() => {
  store.latest.clear();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(
      new Route(`/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}`),
    );
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<StatusPageBranding {...PAGE_PROPS} />);
  });
}

function cardNames(container?: HTMLElement): Array<string | null> {
  return within(container || document.body)
    .getAllByTestId("recorded-card")
    .map((element: HTMLElement): string | null => {
      return element.getAttribute("data-card");
    });
}

function propsOf(name: string): Record<string, unknown> {
  const card: Recorded | undefined = store.latest.get(name);

  expect([name, Boolean(card)]).toEqual([name, true]);

  return card!.props;
}

function cardPropsOf(name: string): Record<string, unknown> {
  return propsOf(name)["cardProps"] as Record<string, unknown>;
}

function detailPropsOf(name: string): Record<string, unknown> {
  return propsOf(name)["modelDetailProps"] as Record<string, unknown>;
}

type FieldShape = {
  field?: Record<string, unknown>;
  title?: string;
  fieldType?: string;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  stepId?: string;
  description?: string;
  dropdownOptions?: Array<{ value: unknown; label: string }>;
  getElement?: (item: StatusPage) => ReactElement;
};

function formFieldsOf(name: string): Array<FieldShape> {
  return propsOf(name)["formFields"] as Array<FieldShape>;
}

function detailFieldsOf(name: string): Array<FieldShape> {
  return detailPropsOf(name)["fields"] as Array<FieldShape>;
}

function columnsOf(fields: Array<FieldShape>): Array<string> {
  return fields.map((field: FieldShape): string => {
    return Object.keys(field.field || {})[0] || "";
  });
}

function advancedSection(): HTMLElement {
  return screen.getByTestId(BRANDING_ADVANCED_SECTION_TEST_ID);
}

function advancedHeader(): HTMLElement {
  return within(advancedSection()).getByRole("button", {
    name: ADVANCED_FORM_SECTION_TITLE,
  });
}

// Tells the page what a card loaded, as the card would.
async function loadInto(name: string, item: StatusPage): Promise<void> {
  const onItemLoaded: (item: StatusPage) => void = detailPropsOf(name)[
    "onItemLoaded"
  ] as (item: StatusPage) => void;

  await act(async () => {
    onItemLoaded(item);
  });
}

async function rulesFetched(count: number): Promise<void> {
  const onFetchSuccess: (
    data: Array<StatusPageHistoryChartBarColorRule>,
    totalCount: number,
  ) => void = propsOf("Status Page > Branding > History Chart Bar Color Rules")[
    "onFetchSuccess"
  ] as (data: Array<StatusPageHistoryChartBarColorRule>, total: number) => void;

  await act(async () => {
    onFetchSuccess([], count);
  });
}

async function indexingIs(isOn: boolean): Promise<void> {
  const onChange: (isOn: boolean) => void = propsOf("search-engine-indexing")[
    "onChange"
  ] as (isOn: boolean) => void;

  await act(async () => {
    onChange(isOn);
  });
}

function pageWith(values: Partial<Record<string, unknown>>): StatusPage {
  const page: StatusPage = new StatusPage();

  for (const [key, value] of Object.entries(values)) {
    (page as unknown as Record<string, unknown>)[key] = value;
  }

  return page;
}

describe("the Branding page", () => {
  test("is every branding card, on one page: the cards people set, then Advanced", async () => {
    await renderPage();

    expect(cardNames()).toEqual([...MAIN_CARDS, ...ADVANCED_CARDS]);
  });

  test("folds the history chart's colors, the languages and search engine indexing under Advanced, and nothing else", async () => {
    await renderPage();

    expect(cardNames(advancedSection())).toEqual(ADVANCED_CARDS);

    for (const name of MAIN_CARDS) {
      expect(
        within(advancedSection())
          .queryAllByTestId("recorded-card")
          .some((element: HTMLElement): boolean => {
            return element.getAttribute("data-card") === name;
          }),
      ).toBe(false);
    }
  });

  test("the Advanced section starts folded, says what is in it, and opens", async () => {
    await renderPage();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(advancedSection()).toHaveTextContent(
      StatusPageBrandingCopy.advancedDescription,
    );

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
  });

  test("every card keeps the analytics name it had on its old screen", async () => {
    await renderPage();

    for (const name of [...MAIN_CARDS, ...ADVANCED_CARDS]) {
      expect(store.latest.has(name)).toBe(true);
    }
  });

  test("no two detail cards share a DOM id, now that they share a page", async () => {
    await renderPage();

    const ids: Array<string> = Array.from(store.latest.values())
      .filter((card: Recorded): boolean => {
        return card.kind === "card-model-detail";
      })
      .map((card: Recorded): string => {
        return (card.props["modelDetailProps"] as Record<string, unknown>)[
          "id"
        ] as string;
      });

    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every detail card edits this status page", async () => {
    await renderPage();

    for (const card of Array.from(store.latest.values())) {
      if (card.kind !== "card-model-detail") {
        continue;
      }

      const detail: Record<string, unknown> = card.props[
        "modelDetailProps"
      ] as Record<string, unknown>;

      expect(detail["modelType"]).toBe(StatusPage);
      expect((detail["modelId"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
      expect(card.props["isEditable"]).toBe(true);
    }
  });
});

describe("the cards people set", () => {
  test("Logo and Cover Image: two steps, the images and their alt text, and no favicon", async () => {
    await renderPage();

    const name: string = "Status Page > Branding > Header Style";

    expect(cardPropsOf(name)["title"]).toBe("Logo and Cover Image");
    expect(propsOf(name)["editButtonText"]).toBe("Edit Images");
    expect(
      (propsOf(name)["formSteps"] as Array<{ id: string }>).map(
        (step: { id: string }): string => {
          return step.id;
        },
      ),
    ).toEqual(["logo", "cover-image"]);
    expect(
      formFieldsOf(name).map((field: FieldShape): string => {
        return `${Object.keys(field.field || {})[0]}@${field.stepId}`;
      }),
    ).toEqual([
      "logoFile@logo",
      "logoAltText@logo",
      "coverImageFile@cover-image",
      "coverImageAltText@cover-image",
    ]);
    expect(columnsOf(formFieldsOf(name))).not.toContain("faviconFile");
  });

  test("Title and Description, then Favicon, each with its own fields", async () => {
    await renderPage();

    expect(
      cardPropsOf("Status Page > Branding > Title and Description")["title"],
    ).toBe("Title and Description");
    expect(
      columnsOf(formFieldsOf("Status Page > Branding > Title and Description")),
    ).toEqual(["pageTitle", "pageDescription"]);

    expect(cardPropsOf("Status Page > Branding > Favicon")["title"]).toBe(
      "Favicon",
    );
    expect(columnsOf(formFieldsOf("Status Page > Branding > Favicon"))).toEqual(
      ["faviconFile"],
    );
  });

  test.each([
    ["Status Page > Header Links", StatusPageHeaderLink, "Header Links"],
    ["Status Page > Footer Links", StatusPageFooterLink, "Footer Links"],
  ])(
    "%s: this page's links, dragged into order",
    async (name: string, modelType: unknown, title: string) => {
      await renderPage();

      const props: Record<string, unknown> = propsOf(name);

      expect(props["modelType"]).toBe(modelType);
      expect((props["cardProps"] as Record<string, unknown>)["title"]).toBe(
        title,
      );
      expect(props["enableDragAndDrop"]).toBe(true);
      expect(props["dragDropIndexField"]).toBe("order");
      expect(
        (
          (props["query"] as Record<string, unknown>)[
            "statusPageId"
          ] as ObjectID
        ).toString(),
      ).toBe(STATUS_PAGE_ID);
    },
  );

  test("a new link belongs to this status page and project", async () => {
    await renderPage();

    cleanup();
    store.latest.clear();

    await act(async () => {
      render(
        <StatusPageBranding
          {...PAGE_PROPS}
          currentProject={
            { _id: PROJECT_ID } as PageComponentProps["currentProject"]
          }
        />,
      );
    });

    for (const name of [
      "Status Page > Header Links",
      "Status Page > Footer Links",
    ]) {
      const onBeforeCreate: (
        item: StatusPageHeaderLink,
      ) => Promise<StatusPageHeaderLink> = propsOf(name)["onBeforeCreate"] as (
        item: StatusPageHeaderLink,
      ) => Promise<StatusPageHeaderLink>;

      const created: StatusPageHeaderLink = await onBeforeCreate(
        new StatusPageHeaderLink(),
      );

      expect(created.statusPageId?.toString()).toBe(STATUS_PAGE_ID);
      expect(created.projectId?.toString()).toBe(PROJECT_ID);
    }
  });

  test("the overview page description is named for what it is, and edited as markdown", async () => {
    await renderPage();

    const name: string = "Status Page > Branding > Overview Page";

    expect(cardPropsOf(name)["title"]).toBe("Overview Page Description");
    expect(cardPropsOf(name)["description"]).toBe(
      StatusPageBrandingCopy.overviewDescriptionDescription,
    );
    expect(propsOf(name)["editButtonText"]).toBe("Edit Description");

    const [field] = formFieldsOf(name);

    expect(Object.keys(field!.field || {})).toEqual([
      "overviewPageDescription",
    ]);
    // It used to end in a full stop.
    expect(field!.title).toBe("Overview Page Description");
    expect(field!.fieldType).toBe(FormFieldSchemaType.Markdown);
    expect(detailFieldsOf(name)[0]!.fieldType).toBe(FieldType.Markdown);
  });

  test("the footer: the copyright line, then the footer's links", async () => {
    await renderPage();

    expect(cardPropsOf("Status Page > Branding > Copyright")["title"]).toBe(
      "Copyright Info",
    );
    expect(
      columnsOf(formFieldsOf("Status Page > Branding > Copyright")),
    ).toEqual(["copyrightText"]);

    const names: Array<string | null> = cardNames();

    expect(names.indexOf("Status Page > Footer Links")).toBe(
      names.indexOf("Status Page > Branding > Copyright") + 1,
    );
  });
});

describe("the cards under Advanced", () => {
  test("the history chart's default bar color, then its rules", async () => {
    await renderPage();

    expect(
      columnsOf(formFieldsOf("Status Page > Branding > Default Bar Color")),
    ).toEqual(["defaultBarColor"]);

    const rules: Record<string, unknown> = propsOf(
      "Status Page > Branding > History Chart Bar Color Rules",
    );

    expect(rules["modelType"]).toBe(StatusPageHistoryChartBarColorRule);
    expect(rules["enableDragAndDrop"]).toBe(true);
    expect((rules["cardProps"] as Record<string, unknown>)["title"]).toBe(
      "Rules for Bar Colors of History Chart",
    );
  });

  test("Languages is one card and one dialog: the default language, then the ones the footer offers", async () => {
    await renderPage();

    const name: string = "Status Page > Languages";

    expect(cardPropsOf(name)["title"]).toBe("Languages");
    expect(cardPropsOf(name)["description"]).toBe(
      StatusPageBrandingCopy.languagesDescription,
    );
    expect(propsOf(name)["editButtonText"]).toBe("Edit Languages");

    const [defaultLanguage, enabledLanguages] = formFieldsOf(name);

    expect(columnsOf(formFieldsOf(name))).toEqual([
      "defaultLanguage",
      "enabledLanguages",
    ]);

    expect(defaultLanguage!.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(defaultLanguage!.required).toBe(true);
    expect(defaultLanguage!.defaultValue).toBe("en");
    expect(
      defaultLanguage!.dropdownOptions!.map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      ),
    ).toEqual(
      SUPPORTED_STATUS_PAGE_LANGUAGES.map((language: { code: string }) => {
        return language.code;
      }),
    );
    expect(defaultLanguage!.dropdownOptions![1]!.label).toBe(
      "Deutsch (German)",
    );

    expect(enabledLanguages!.fieldType).toBe(
      FormFieldSchemaType.MultiSelectDropdown,
    );
    expect(enabledLanguages!.required).toBe(false);
    expect(enabledLanguages!.placeholder).toBe("All languages");
  });

  test("Languages shows each language by its own name and its English one, and all of them when none is picked", async () => {
    await renderPage();

    const [defaultLanguage, enabledLanguages] = detailFieldsOf(
      "Status Page > Languages",
    );

    const { container: german } = render(
      defaultLanguage!.getElement!(pageWith({ defaultLanguage: "de" })),
    );
    expect(german).toHaveTextContent("Deutsch (German)");

    const { container: none } = render(
      defaultLanguage!.getElement!(pageWith({})),
    );
    expect(none).toHaveTextContent("English (English)");

    const { container: some } = render(
      enabledLanguages!.getElement!(
        pageWith({ enabledLanguages: ["fr", "ja"] }),
      ),
    );
    expect(some).toHaveTextContent("Français (French), 日本語 (Japanese)");

    const { container: all } = render(
      enabledLanguages!.getElement!(pageWith({ enabledLanguages: [] })),
    );
    expect(all).toHaveTextContent("All supported languages");
  });

  test("Search Engine Indexing is the switch card, for this status page", async () => {
    await renderPage();

    expect(
      (
        propsOf("search-engine-indexing")["statusPageId"] as ObjectID
      ).toString(),
    ).toBe(STATUS_PAGE_ID);
  });
});

describe("Configured, on the folded Advanced section", () => {
  test("is not said for a new status page: green bars, no rules, English, every language, indexed", async () => {
    await renderPage();

    await loadInto(
      "Status Page > Branding > Default Bar Color",
      pageWith({ defaultBarColor: Green }),
    );
    await rulesFetched(0);
    await loadInto(
      "Status Page > Languages",
      pageWith({ defaultLanguage: "en", enabledLanguages: [] }),
    );
    await indexingIs(true);

    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });

  test("is not said before anything has loaded", async () => {
    await renderPage();

    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });

  test.each([
    [
      "a chosen default bar color",
      async (): Promise<void> => {
        await loadInto(
          "Status Page > Branding > Default Bar Color",
          pageWith({ defaultBarColor: new Color("#123456") }),
        );
      },
    ],
    [
      "a bar color rule",
      async (): Promise<void> => {
        await rulesFetched(1);
      },
    ],
    [
      "a default language other than English",
      async (): Promise<void> => {
        await loadInto(
          "Status Page > Languages",
          pageWith({ defaultLanguage: "de" }),
        );
      },
    ],
    [
      "a shorter list of languages",
      async (): Promise<void> => {
        await loadInto(
          "Status Page > Languages",
          pageWith({ defaultLanguage: "en", enabledLanguages: ["en", "fr"] }),
        );
      },
    ],
    [
      "search engines kept away",
      async (): Promise<void> => {
        await indexingIs(false);
      },
    ],
  ])("is said for %s", async (_what: string, setUp: () => Promise<void>) => {
    await renderPage();

    await setUp();

    expect(advancedHeader()).toHaveTextContent("Configured");
  });

  test("follows the cards: flipping indexing back on, or deleting the last rule, takes it away", async () => {
    await renderPage();

    await indexingIs(false);
    expect(advancedHeader()).toHaveTextContent("Configured");

    await indexingIs(true);
    expect(advancedHeader()).not.toHaveTextContent("Configured");

    await rulesFetched(2);
    expect(advancedHeader()).toHaveTextContent("Configured");

    await rulesFetched(0);
    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });

  test("is said only while folded: open, the cards say it themselves", async () => {
    await renderPage();

    await rulesFetched(3);
    expect(advancedHeader()).toHaveTextContent("Configured");

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });
});
