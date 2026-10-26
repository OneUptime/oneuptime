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
  USE_RECOMMENDED_RULES_EMPTY_STATE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import {
  BAR_COLOR_PREVIEW_SWATCH_TEST_ID,
  BAR_COLOR_PREVIEW_TEST_ID,
  BAR_COLOR_PREVIEW_WARNING_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/HistoryChartBarColorPreview";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import IconProp from "../../../Types/Icon/IconProp";
import EmptyStateOptions from "../../../UI/Components/ModelTable/EmptyStateOptions";
import { TableEmptyStateAction } from "../../../UI/Components/Table/TableEmptyState";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  HistoryChartBarColorRuleValues,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
} from "../../../Utils/StatusPage/HistoryChartBarColors";
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
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import { DetailImageBackdrop } from "../../../UI/Components/Detail/DetailImageBackdrop";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

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
  // The bar color preview reads the project's statuses while there are no rules.
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
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
  hideColumnDescription?: boolean;
  imageBackdrop?: DetailImageBackdrop;
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
    name: MORE_SETTINGS_SECTION_TITLE,
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

async function rulesFetched(
  count: number,
  rules: Array<StatusPageHistoryChartBarColorRule> = [],
): Promise<void> {
  const onFetchSuccess: (
    data: Array<StatusPageHistoryChartBarColorRule>,
    totalCount: number,
  ) => void = propsOf("Status Page > Branding > History Chart Bar Color Rules")[
    "onFetchSuccess"
  ] as (data: Array<StatusPageHistoryChartBarColorRule>, total: number) => void;

  await act(async () => {
    onFetchSuccess(rules, count);
  });
}

// A rule as the rules table loads it.
function ruleOf(
  uptimePercentGreaterThanOrEqualTo: number,
  barColor: string,
): StatusPageHistoryChartBarColorRule {
  const rule: StatusPageHistoryChartBarColorRule =
    new StatusPageHistoryChartBarColorRule();
  rule.uptimePercentGreaterThanOrEqualTo = uptimePercentGreaterThanOrEqualTo;
  rule.barColor = new Color(barColor);
  return rule;
}

function recommendedRules(): Array<StatusPageHistoryChartBarColorRule> {
  return RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
    (rule: HistoryChartBarColorRuleValues) => {
      return ruleOf(
        rule.uptimePercentGreaterThanOrEqualTo,
        rule.barColor.toString(),
      );
    },
  );
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

  test("the More settings section starts folded, names its cards, and opens onto what it is for", async () => {
    await renderPage();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    // Folded, its header names the four cards it holds, none of them set.
    expect(listedNames(advancedHeader())).toEqual([
      "Default Bar Color",
      "Bar Color Rules",
      "Languages",
      "Search Engine Indexing",
    ]);
    expect(setChips(advancedHeader())).toEqual([]);

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(advancedSection()).toHaveTextContent(
      StatusPageBrandingCopy.advancedDescription,
    );
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
      "darkThemeLogoFile@logo",
      "logoAltText@logo",
      "coverImageFile@cover-image",
      "coverImageAltText@cover-image",
    ]);
    expect(columnsOf(formFieldsOf(name))).not.toContain("faviconFile");
  });

  /*
   * The logo for the dark theme sits beside the logo, in the same step: an
   * image, never required, saying where it is shown and what happens
   * without one. The card shows it under the logo, and says the same while
   * there is none, instead of a bare No logo uploaded.
   */
  test("Logo and Cover Image: a dark theme logo beside the logo, optional, saying what it is for", async () => {
    await renderPage();

    const name: string = "Status Page > Branding > Header Style";
    const darkLogo: FieldShape | undefined = formFieldsOf(name).find(
      (field: FieldShape): boolean => {
        return columnsOf([field])[0] === "darkThemeLogoFile";
      },
    );

    expect(darkLogo).toBeDefined();
    expect(darkLogo!.title).toBe("Dark Theme Logo");
    expect(darkLogo!.stepId).toBe("logo");
    expect(darkLogo!.fieldType).toBe(FormFieldSchemaType.ImageFile);
    expect(darkLogo!.required).toBe(false);
    expect(darkLogo!.placeholder).toBe("Upload logo for the dark theme");
    expect(darkLogo!.description).toBe(
      StatusPageBrandingCopy.darkThemeLogoDescription,
    );
    expect(StatusPageBrandingCopy.darkThemeLogoDescription).toBe(
      "Shown instead of the logo where your status page is dark. Without one, the logo is shown on a light backdrop there.",
    );

    const details: Array<FieldShape> = detailFieldsOf(name);

    expect(columnsOf(details).slice(0, 2)).toEqual([
      "logoFile",
      "darkThemeLogoFile",
    ]);

    const shown: FieldShape = details[1]!;

    expect(shown.title).toBe("Dark Theme Logo");
    expect(shown.fieldType).toBe(FieldType.ImageFile);
    // The card reads the image itself, as it reads the logo's.
    expect(shown.field).toEqual({
      darkThemeLogoFile: { file: true, fileType: true },
    });
    expect(shown.placeholder).toBe(StatusPageBrandingCopy.noDarkThemeLogo);
    expect(StatusPageBrandingCopy.noDarkThemeLogo).toBe(
      "None. The logo is shown on a light backdrop.",
    );
  });

  /*
   * Each logo on the page it is made for, in the dashboard's light theme
   * and its dark one alike: a dark theme logo - light lettering - vanished
   * on the card's white frame, and the logo on the dark theme's slate one.
   */
  test("Logo and Cover Image: each logo is shown on the page it is made for; the cover image on the card", async () => {
    await renderPage();

    const details: Array<FieldShape> = detailFieldsOf(
      "Status Page > Branding > Header Style",
    );
    const backdropOf: (column: string) => DetailImageBackdrop | undefined = (
      column: string,
    ): DetailImageBackdrop | undefined => {
      return details.find((field: FieldShape): boolean => {
        return columnsOf([field])[0] === column;
      })?.imageBackdrop;
    };

    expect(backdropOf("logoFile")).toBe(DetailImageBackdrop.Light);
    expect(backdropOf("darkThemeLogoFile")).toBe(DetailImageBackdrop.Dark);
    expect(backdropOf("coverImageFile")).toBeUndefined();
  });

  /*
   * The two logos in Edit Images each say where they are shown. The logo
   * said only its column's "Status Page Logo", right above a logo for the
   * dark theme that said where it goes.
   */
  test("Logo and Cover Image: the logo says where it is shown, as the dark theme logo does", async () => {
    await renderPage();

    const logo: FieldShape | undefined = formFieldsOf(
      "Status Page > Branding > Header Style",
    ).find((field: FieldShape): boolean => {
      return columnsOf([field])[0] === "logoFile";
    });

    expect(logo!.description).toBe(StatusPageBrandingCopy.logoDescription);
    expect(logo!.hideColumnDescription).toBe(true);
    expect(StatusPageBrandingCopy.logoDescription).toBe(
      "Shown on your status page and in the emails it sends.",
    );
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

  test("each card says what it changes for a visitor", async () => {
    await renderPage();

    expect(
      cardPropsOf("Status Page > Branding > Header Style")["description"],
    ).toBe("Shown at the top of your status page.");
    expect(
      cardPropsOf("Status Page > Branding > Title and Description")[
        "description"
      ],
    ).toBe(
      "Its name in the browser tab and in subscriber emails, and the description search engines show.",
    );
    // The favicon is the browser tab's icon; it was said to be "used for SEO".
    expect(cardPropsOf("Status Page > Branding > Favicon")["description"]).toBe(
      "The small icon in the browser tab.",
    );
    expect(
      cardPropsOf("Status Page > Branding > Copyright")["description"],
    ).toBe("The line at the bottom of your status page, such as Acme, Inc.");

    const descriptions: Array<unknown> = Array.from(store.latest.values()).map(
      (recorded: Recorded): unknown => {
        return (
          recorded.props["cardProps"] as Record<string, unknown> | undefined
        )?.["description"];
      },
    );

    expect(descriptions.length).toBeGreaterThan(5);

    for (const description of [
      "These will show up on your status page.",
      "This will also be used for SEO.",
      "Favicon will be used for SEO.",
      "Copyright info for your status page",
      "Header Links for your status page",
    ]) {
      expect(descriptions).not.toContain(description);
    }
  });

  /*
   * Each dialog is named like the button that opens it (Edit Images, not
   * the model's "Edit Status Page"), as the custom code cards' are.
   */
  test.each([
    ["Status Page > Branding > Header Style", "Edit Images"],
    ["Status Page > Branding > Favicon", "Edit Favicon"],
    ["Status Page > Branding > Overview Page", "Edit Description"],
    ["Status Page > Branding > Copyright", "Edit Copyright"],
    ["Status Page > Branding > Default Bar Color", "Edit Default Bar Color"],
    ["Status Page > Languages", "Edit Languages"],
  ])(
    "%s: its dialog is named like its button, %s",
    async (name: string, title: string) => {
      await renderPage();

      expect(propsOf(name)["editButtonText"]).toBe(title);
      expect(propsOf(name)["editModalTitle"]).toBe(title);
    },
  );

  test("Title and Description's dialog says what the two are for, so its fields need no help, and no SEO", async () => {
    await renderPage();

    const name: string = "Status Page > Branding > Title and Description";
    const props: Record<string, unknown> = propsOf(name);

    expect(props["editModalTitle"]).toBe("Edit Title and Description");
    expect(StatusPageBrandingCopy.titleEditTitle).toBe(
      "Edit Title and Description",
    );
    expect(props["editModalDescription"]).toBe(
      StatusPageBrandingCopy.titleDescription,
    );
    expect(props["editModalDescription"]).toBe(
      cardPropsOf(name)["description"],
    );

    for (const field of formFieldsOf(name) as Array<
      FieldShape & { hideColumnDescription?: boolean }
    >) {
      expect([field.title, field.hideColumnDescription]).toEqual([
        field.title,
        true,
      ]);
      expect(field.description).toBeUndefined();
    }
  });

  test("the page title's example is a name, and the detail rows have no stand-in sentences", async () => {
    await renderPage();

    const name: string = "Status Page > Branding > Title and Description";
    const [title, description] = formFieldsOf(name) as [
      FieldShape & { placeholder?: string },
      FieldShape & { placeholder?: string },
    ];

    expect(title.placeholder).toBe("e.g., Acme Status");
    expect(description.placeholder).toBe(
      "e.g., Live status of Acme's website and API.",
    );

    for (const row of detailFieldsOf(name) as Array<
      FieldShape & { placeholder?: string }
    >) {
      expect(row.placeholder).toBeUndefined();
    }
  });

  test.each([
    [
      "Status Page > Header Links",
      "Header Link",
      "Header Links",
      "Links at the top of your status page, such as your website or support.",
    ],
    [
      "Status Page > Footer Links",
      "Footer Link",
      "Footer Links",
      "Links at the bottom of your status page, such as your terms or privacy policy.",
    ],
  ])(
    "%s: its rows are each a %s, added with Add, and an empty table says what they are for",
    async (
      name: string,
      singular: string,
      plural: string,
      description: string,
    ) => {
      await renderPage();

      const props: Record<string, unknown> = propsOf(name);

      expect(props["singularName"]).toBe(singular);
      expect(props["pluralName"]).toBe(plural);
      expect(props["createVerb"]).toBe("Add");
      expect(
        (props["cardProps"] as Record<string, unknown>)["description"],
      ).toBe(description);
      // No message of its own: empty, the table says the card's line.
      expect(props["noItemsMessage"]).toBeUndefined();
    },
  );

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

  /*
   * A link's dialog asks for the words visitors click by example, and
   * neither field repeats the column's help ("Title of this resource",
   * "URL to a website or any other resource on the internet").
   */
  test.each([
    ["Status Page > Header Links", "e.g., Support"],
    ["Status Page > Footer Links", "e.g., Privacy Policy"],
  ])(
    "%s: a link's title asks by example, and neither field repeats its column's help",
    async (name: string, placeholder: string) => {
      await renderPage();

      const [title, link] = formFieldsOf(name) as [
        FieldShape & { hideColumnDescription?: boolean },
        FieldShape & { hideColumnDescription?: boolean },
      ];

      expect(columnsOf([title, link])).toEqual(["title", "link"]);
      expect(title.placeholder).toBe(placeholder);
      expect(title.hideColumnDescription).toBe(true);
      expect(title.description).toBeUndefined();
      expect(link.hideColumnDescription).toBe(true);
      expect(link.description).toBeUndefined();
      expect(link.placeholder).toBe("https://link.com");
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
      "Bar Color Rules",
    );
  });

  /*
   * #4719: the API answers a rule's percentage as a number now, where it
   * answered the decimal column's text ("100.00"), and Terraform can apply
   * rules a configuration computed, such as a day with one minute of
   * downtime, which the API keeps as 99.93055555555556. The table reads
   * them all the way the preview under it names them; the rule's Edit form
   * keeps every digit.
   */
  test("the rules table reads each rule's percentage as the preview under it names it", async () => {
    await renderPage();

    type RuleColumn = {
      field?: Record<string, unknown>;
      title?: string;
      type?: FieldType;
      getElement?: (rule: StatusPageHistoryChartBarColorRule) => ReactElement;
      getExportValue?: (rule: StatusPageHistoryChartBarColorRule) => string;
    };

    const columns: Array<RuleColumn> = propsOf(
      "Status Page > Branding > History Chart Bar Color Rules",
    )["columns"] as Array<RuleColumn>;

    expect(
      columns.map((column: RuleColumn): Array<unknown> => {
        return [
          Object.keys(column.field || {})[0],
          column.title,
          column.type,
          Boolean(column.getElement),
        ];
      }),
    ).toEqual([
      [
        "uptimePercentGreaterThanOrEqualTo",
        "When Uptime Percent >=",
        FieldType.Percent,
        true,
      ],
      ["barColor", "Then, Bar Color is", FieldType.Color, false],
    ]);

    const cell: (percent: number | string) => string = (
      percent: number | string,
    ): string => {
      const rule: StatusPageHistoryChartBarColorRule =
        new StatusPageHistoryChartBarColorRule();
      (
        rule as unknown as {
          uptimePercentGreaterThanOrEqualTo: number | string;
        }
      ).uptimePercentGreaterThanOrEqualTo = percent;
      rule.barColor = new Color("#fde047");

      const { container } = render(columns[0]!.getElement!(rule));
      const shown: string = container.textContent || "";

      // Export CSV writes what the table shows.
      expect(columns[0]!.getExportValue!(rule)).toBe(shown);

      return shown;
    };

    expect([100, 99.999, 100 * (1 - 1 / 1440), 99.65, 0].map(cell)).toEqual([
      "100%",
      "99.999%",
      "99.9306%",
      "99.65%",
      "0%",
    ]);

    // As servers before #4719 answered it: the decimal column's text.
    expect(["100.00", "99.650", "99.93055555555556", "0.00"].map(cell)).toEqual(
      ["100%", "99.65%", "99.9306%", "0%"],
    );

    // The preview's own names for the same rules.
    await rulesFetched(2, [ruleOf(100 * (1 - 1 / 1440), "#fde047")]);

    expect(
      within(screen.getByTestId(BAR_COLOR_PREVIEW_TEST_ID)).getByText(
        "99.9306% or more",
      ),
    ).toBeInTheDocument();
  });

  /*
   * Issue #486: the cards said the default color was for a day with no data
   * (a day with no data is always the hatched grey), and that without rules
   * a day took "the lowest monitor state color" (it takes the most severe).
   * They say what the strip does now, under the names the folded header
   * already gave them.
   */
  test("the two history chart cards say what they do, by the names the folded header gives them", async () => {
    await renderPage();

    expect(cardPropsOf("Status Page > Branding > Default Bar Color")).toEqual({
      title: "Default Bar Color",
      description:
        "The color of a day that no bar color rule matches. A day with no monitoring data is always drawn gray and striped.",
    });
    expect(
      cardPropsOf("Status Page > Branding > History Chart Bar Color Rules"),
    ).toEqual({
      title: "Bar Color Rules",
      description:
        "Each bar of the uptime history is a day. Rules color a day by its uptime: they are checked from the top, and the first one the day's uptime reaches sets its color.",
    });
  });

  test("an empty rules table says how days are colored without rules, and offers the recommended rules", async () => {
    await renderPage();

    const rules: Record<string, unknown> = propsOf(
      "Status Page > Branding > History Chart Bar Color Rules",
    );
    const emptyState: EmptyStateOptions = rules[
      "emptyState"
    ] as EmptyStateOptions;

    expect(rules["noItemsMessage"]).toBeUndefined();
    expect(emptyState.title).toBe("No bar color rules");
    expect(emptyState.description).toBe(
      "Each day takes the color of the most severe monitor status it had, even if only for a minute. The recommended rules color a day by how long it was down, in colors that people with red-green color blindness can tell apart.",
    );
    expect(
      (emptyState.actions || []).map((action: TableEmptyStateAction) => {
        return [action.title, action.icon, action.dataTestId];
      }),
    ).toEqual([
      [
        "Use Recommended Rules",
        IconProp.Swatch,
        USE_RECOMMENDED_RULES_EMPTY_STATE_TEST_ID,
      ],
    ]);
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

    expect(setChips(advancedHeader())).toEqual([]);
  });

  test("is not said before anything has loaded", async () => {
    await renderPage();

    expect(setChips(advancedHeader())).toEqual([]);
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

    expect(hasSetChip(advancedHeader())).toBe(true);
  });

  test("follows the cards: flipping indexing back on, or deleting the last rule, takes it away", async () => {
    await renderPage();

    await indexingIs(false);
    expect(hasSetChip(advancedHeader())).toBe(true);

    await indexingIs(true);
    expect(setChips(advancedHeader())).toEqual([]);

    await rulesFetched(2);
    expect(hasSetChip(advancedHeader())).toBe(true);

    await rulesFetched(0);
    expect(setChips(advancedHeader())).toEqual([]);
  });

  test("is said only while folded: open, the cards say it themselves", async () => {
    await renderPage();

    await rulesFetched(3);
    expect(hasSetChip(advancedHeader())).toBe(true);

    fireEvent.click(advancedHeader());

    expect(setChips(advancedHeader())).toEqual([]);
  });
});

/*
 * Issue #486: the recommended bar color rules, one click away on a page
 * that has none, and what the page's colors look like under them.
 */
describe("the recommended bar color rules, on a page that has none", () => {
  type CreateArgs = {
    model: StatusPageHistoryChartBarColorRule;
    modelType: unknown;
  };

  function rulesTable(): Record<string, unknown> {
    return propsOf("Status Page > Branding > History Chart Bar Color Rules");
  }

  async function useRecommendedRulesFromTheEmptyTable(): Promise<void> {
    const emptyState: EmptyStateOptions = rulesTable()[
      "emptyState"
    ] as EmptyStateOptions;

    await act(async () => {
      emptyState.actions![0]!.onClick();
    });
  }

  function answerCreates(
    refuseAt?: number | undefined,
  ): Array<StatusPageHistoryChartBarColorRule> {
    const made: Array<StatusPageHistoryChartBarColorRule> = [];
    let attempts: number = 0;

    jest.spyOn(ModelAPI, "create").mockImplementation((async (
      args: CreateArgs,
    ) => {
      attempts++;

      if (attempts === refuseAt) {
        throw new Error("You do not have permission to create rules.");
      }

      args.model.id = ObjectID.generate();
      made.push(args.model);

      return { data: args.model } as never;
    }) as never);

    return made;
  }

  beforeEach(() => {
    // The preview reads the project's statuses while there are no rules.
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 0,
    } as never);
  });

  test("makes the four recommended rules on this page, in their order, and reloads the table", async () => {
    await renderPage();
    await rulesFetched(0);

    const made: Array<StatusPageHistoryChartBarColorRule> = answerCreates();

    expect(rulesTable()["refreshToggle"]).toBeUndefined();

    await useRecommendedRulesFromTheEmptyTable();

    expect(
      made.map((rule: StatusPageHistoryChartBarColorRule) => {
        return [
          rule.uptimePercentGreaterThanOrEqualTo,
          rule.barColor?.toString(),
          rule.statusPageId?.toString(),
          rule.projectId?.toString(),
        ];
      }),
    ).toEqual([
      [100, "#22c55e", STATUS_PAGE_ID, PROJECT_ID],
      [99, "#fde047", STATUS_PAGE_ID, PROJECT_ID],
      [95, "#c2410c", STATUS_PAGE_ID, PROJECT_ID],
      [0, "#7f1d1d", STATUS_PAGE_ID, PROJECT_ID],
    ]);
    expect(rulesTable()["refreshToggle"]).toBe("1");
    expect(rulesTable()["topContent"]).toBeUndefined();
  });

  test("says it is working while it makes them, and a second click makes no second set", async () => {
    await renderPage();
    await rulesFetched(0);

    let finish: () => void = (): void => {};
    const created: Array<number> = [];

    jest.spyOn(ModelAPI, "create").mockImplementation((async (
      args: CreateArgs,
    ) => {
      created.push(1);

      if (created.length === 1) {
        await new Promise<void>((resolve: () => void) => {
          finish = resolve;
        });
      }

      return { data: args.model } as never;
    }) as never);

    const emptyState: () => EmptyStateOptions = (): EmptyStateOptions => {
      return rulesTable()["emptyState"] as EmptyStateOptions;
    };

    act(() => {
      emptyState().actions![0]!.onClick();
    });

    expect(emptyState().actions![0]!.isLoading).toBe(true);

    await act(async () => {
      emptyState().actions![0]!.onClick();
    });

    await act(async () => {
      finish();
    });

    expect(created).toHaveLength(4);
    expect(emptyState().actions![0]!.isLoading).toBe(false);
  });

  test("a refused add takes back the rules it made, says why above the table, and reloads it", async () => {
    await renderPage();
    await rulesFetched(0);

    const made: Array<StatusPageHistoryChartBarColorRule> = answerCreates(3);
    const deleted: Array<string> = [];

    jest.spyOn(ModelAPI, "deleteItem").mockImplementation((async (args: {
      id: ObjectID;
    }) => {
      deleted.push(args.id.toString());
    }) as never);

    await useRecommendedRulesFromTheEmptyTable();

    expect(made).toHaveLength(2);
    expect(deleted).toEqual(
      made.map((rule: StatusPageHistoryChartBarColorRule) => {
        return rule.id!.toString();
      }),
    );
    expect(rulesTable()["refreshToggle"]).toBe("1");

    const { container } = render(rulesTable()["topContent"] as ReactElement);

    expect(container).toHaveTextContent(
      "You do not have permission to create rules.",
    );
  });

  test("the preview under the rules shows the recommended rules, and nothing to warn about", async () => {
    await renderPage();
    await rulesFetched(4, recommendedRules());

    const preview: HTMLElement = screen.getByTestId(BAR_COLOR_PREVIEW_TEST_ID);
    const swatches: Array<HTMLElement> = within(preview).getAllByTestId(
      BAR_COLOR_PREVIEW_SWATCH_TEST_ID,
    );

    // Four rules and no data, in three kinds of vision.
    expect(swatches).toHaveLength(15);
    expect(
      within(preview).queryAllByTestId(BAR_COLOR_PREVIEW_WARNING_TEST_ID),
    ).toHaveLength(0);
    expect(preview).toHaveTextContent("99% or more");
  });

  test("the preview is drawn after the rules, before the languages", async () => {
    await renderPage();
    await rulesFetched(4, recommendedRules());

    const section: HTMLElement = advancedSection();
    const preview: HTMLElement = screen.getByTestId(BAR_COLOR_PREVIEW_TEST_ID);
    const rules: HTMLElement = within(section)
      .getAllByTestId("recorded-card")
      .find((element: HTMLElement): boolean => {
        return (
          element.getAttribute("data-card") ===
          "Status Page > Branding > History Chart Bar Color Rules"
        );
      })!;
    const languages: HTMLElement = within(section)
      .getAllByTestId("recorded-card")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-card") === "Status Page > Languages";
      })!;

    expect(
      rules.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      preview.compareDocumentPosition(languages) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("without rules, the preview warns that the statuses' green and red look alike, and offers the rules too", async () => {
    const operational: MonitorStatus = new MonitorStatus();
    operational.name = "Operational";
    operational.color = new Color("#2ab57d");
    operational.priority = 1;

    const offline: MonitorStatus = new MonitorStatus();
    offline.name = "Offline";
    offline.color = new Color("#fd625e");
    offline.priority = 3;

    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [offline, operational],
      count: 2,
      skip: 0,
      limit: 2,
    } as never);

    await renderPage();
    await rulesFetched(0);

    const preview: HTMLElement = screen.getByTestId(BAR_COLOR_PREVIEW_TEST_ID);

    expect(
      within(preview)
        .getAllByTestId(BAR_COLOR_PREVIEW_WARNING_TEST_ID)
        .map((warning: HTMLElement) => {
          return warning.textContent;
        }),
    ).toEqual([
      "Operational and Offline look alike to people with red-green color blindness.",
    ]);

    const made: Array<StatusPageHistoryChartBarColorRule> = answerCreates();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Use Recommended Rules" }),
      );
    });

    expect(made).toHaveLength(4);
  });
});

describe("Configured, now that a new page starts with the recommended rules", () => {
  beforeEach(() => {
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 0,
    } as never);
  });

  test("is not said for the recommended rules, as a page made in the dashboard has them", async () => {
    await renderPage();

    await rulesFetched(4, recommendedRules());

    expect(setChips(advancedHeader())).toEqual([]);
  });

  test("is said once one of them is changed, removed or added to", async () => {
    await renderPage();

    const changed: Array<StatusPageHistoryChartBarColorRule> =
      recommendedRules();
    changed[1] = ruleOf(99, "#ffff00");

    await rulesFetched(4, changed);
    expect(hasSetChip(advancedHeader())).toBe(true);

    await rulesFetched(3, recommendedRules().slice(0, 3));
    expect(hasSetChip(advancedHeader())).toBe(true);

    await rulesFetched(5, [...recommendedRules(), ruleOf(50, "#000000")]);
    expect(hasSetChip(advancedHeader())).toBe(true);

    await rulesFetched(4, recommendedRules());
    expect(setChips(advancedHeader())).toEqual([]);
  });
});
