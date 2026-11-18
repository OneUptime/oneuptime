import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../Types/API/Route";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Product Analytics > Analytics Settings: how long product analytics keeps
 * the application's numbers (issue #6626). 13 months unless someone chose
 * otherwise, which few need, so the card waits folded under More settings,
 * named in the folded header - with its value while it is not the default -
 * and a link to its place opens the fold at it. Its one field picks 3, 6,
 * 13 or 25 months, said in the reader's words.
 *
 * CardModelDetail is a stand-in that records its props and draws a card
 * under its title's place; the events switch is the real one, over a
 * stand-in ModelAPI.
 */

const mockDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockDetails.push(props);

      return React.createElement("div", {
        "data-testid": "card-model-detail-stand-in",
        "data-name": props["name"],
      });
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (): unknown => {
        return Promise.resolve({});
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import RumApplicationProductAnalyticsSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsSettings";
import {
  PRODUCT_ANALYTICS_MORE_SETTINGS_TEST_ID,
  PRODUCT_ANALYTICS_RETENTION_DESCRIPTION,
  PRODUCT_ANALYTICS_RETENTION_FIELD_DESCRIPTION,
  PRODUCT_ANALYTICS_RETENTION_LINE_TEST_ID,
  PRODUCT_ANALYTICS_RETENTION_PLACE,
  PRODUCT_ANALYTICS_RETENTION_TITLE,
  formatProductAnalyticsRetention,
  getProductAnalyticsRetentionOptions,
  readProductAnalyticsRetentionMonths,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsRetention";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-settings`;

async function drawPage(hash: string = ""): Promise<void> {
  window.history.replaceState(null, "", `${PAGE_PATH}${hash}`);

  await act(async () => {
    render(
      <MemoryRouter>
        <RumApplicationProductAnalyticsSettings
          pageRoute={new Route(PAGE_PATH)}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });
}

function retentionCard(): Record<string, unknown> {
  const drawn: Array<Record<string, unknown>> = mockDetails.filter(
    (props: Record<string, unknown>): boolean => {
      return props["name"] === PRODUCT_ANALYTICS_RETENTION_TITLE;
    },
  );

  expect(drawn.length).toBeGreaterThan(0);

  return drawn[drawn.length - 1]!;
}

function moreSettings(): HTMLElement {
  return screen.getByTestId(PRODUCT_ANALYTICS_MORE_SETTINGS_TEST_ID);
}

function moreSettingsHeader(): HTMLElement {
  return within(moreSettings()).getByRole("button", {
    name: new RegExp(MORE_SETTINGS_SECTION_TITLE),
  });
}

function applicationWith(months: number | undefined): RumApplication {
  const item: RumApplication = new RumApplication();

  if (months !== undefined) {
    item.productAnalyticsRetentionInMonths = months;
  }

  return item;
}

beforeEach(() => {
  mockDetails.length = 0;
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return new RumApplication();
  });
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("the retention card, folded under More settings", () => {
  test("waits folded, named in the header, with no value while it is the default", async () => {
    await drawPage();

    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(
      within(moreSettings()).getByTestId("folded-section-contents"),
    ).toHaveTextContent(/^Product Analytics Retention$/);
  });

  test("the folded header says the choice while it is not the default", async () => {
    await drawPage();

    const onItemLoaded: (item: RumApplication) => void = (
      retentionCard()["modelDetailProps"] as {
        onItemLoaded: (item: RumApplication) => void;
      }
    ).onItemLoaded;

    await act(async () => {
      onItemLoaded(applicationWith(6));
    });

    expect(
      within(moreSettings()).getByTestId("folded-section-contents"),
    ).toHaveTextContent("Product Analytics Retention: 6 months");

    await act(async () => {
      onItemLoaded(applicationWith(13));
    });

    expect(
      within(moreSettings()).getByTestId("folded-section-contents"),
    ).toHaveTextContent(/^Product Analytics Retention$/);
  });

  test("a link to the card's place opens the fold at it", async () => {
    expect(PRODUCT_ANALYTICS_RETENTION_PLACE).toBe(
      "product-analytics-retention",
    );

    await drawPage(`#${PRODUCT_ANALYTICS_RETENTION_PLACE}`);

    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(moreSettings()).getAllByTestId("card-model-detail-stand-in")
        .length,
    ).toBeGreaterThan(0);
  });

  test("comes after the page's own cards: the events switch and the user properties", async () => {
    await drawPage();

    const names: Array<unknown> = mockDetails.map(
      (props: Record<string, unknown>): unknown => {
        return props["name"];
      },
    );

    expect(names[names.length - 1]).toBe(PRODUCT_ANALYTICS_RETENTION_TITLE);
  });
});

describe("the retention card's one field", () => {
  test("picks 3, 6, 13 or 25 months, the default named as such, and is required", async () => {
    await drawPage();

    const card: Record<string, unknown> = retentionCard();
    const field: Record<string, unknown> = (
      card["formFields"] as Array<Record<string, unknown>>
    )[0]!;

    expect(field["field"]).toEqual({ productAnalyticsRetentionInMonths: true });
    expect(field["fieldType"]).toBe(FormFieldSchemaType.Dropdown);
    expect(field["required"]).toBe(true);
    expect(field["description"]).toBe(
      PRODUCT_ANALYTICS_RETENTION_FIELD_DESCRIPTION,
    );
    expect(
      (field["dropdownOptions"] as Array<DropdownOption>).map(
        (option: DropdownOption): string => {
          return `${option.label}=${option.value}`;
        },
      ),
    ).toEqual([
      /* A number is held to its unit on a page: a no-break space (#8770). */
      "3\u00A0months=3",
      "6\u00A0months=6",
      "13\u00A0months (default)=13",
      "25\u00A0months=25",
    ]);
    expect(card["isEditable"]).toBe(true);
    expect(card["editButtonText"]).toBe("Edit Retention");
    expect((card["cardProps"] as Record<string, unknown>)["description"]).toBe(
      PRODUCT_ANALYTICS_RETENTION_DESCRIPTION,
    );
  });

  test("its read view says how long, the default for an application that never chose", async () => {
    await drawPage();

    const getElement: (item: RumApplication) => ReactElement = (
      (retentionCard()["modelDetailProps"] as Record<string, unknown>)[
        "fields"
      ] as Array<{ getElement: (item: RumApplication) => ReactElement }>
    )[0]!.getElement;

    for (const [months, said] of [
      [undefined, "13 months"],
      [25, "25 months"],
      [3, "3 months"],
    ] as Array<[number | undefined, string]>) {
      const { unmount } = render(getElement(applicationWith(months)));

      expect(
        screen.getByTestId(PRODUCT_ANALYTICS_RETENTION_LINE_TEST_ID),
      ).toHaveTextContent(said);

      unmount();
    }
  });

  test("the card's and the field's words fit their room", () => {
    expect(PRODUCT_ANALYTICS_RETENTION_DESCRIPTION.length).toBeLessThanOrEqual(
      210,
    );
    expect(
      PRODUCT_ANALYTICS_RETENTION_FIELD_DESCRIPTION.length,
    ).toBeLessThanOrEqual(150);
  });
});

describe("the words that say how long", () => {
  test("an unknown or missing value reads as the default", () => {
    expect(formatProductAnalyticsRetention(undefined)).toBe("13\u00A0months");
    expect(formatProductAnalyticsRetention(7)).toBe("13\u00A0months");
    expect(formatProductAnalyticsRetention(6)).toBe("6\u00A0months");

    expect(readProductAnalyticsRetentionMonths(null)).toBe(13);
    expect(readProductAnalyticsRetentionMonths({})).toBe(13);
    expect(readProductAnalyticsRetentionMonths({ retentionMonths: 25 })).toBe(
      25,
    );
    expect(readProductAnalyticsRetentionMonths({ retentionMonths: 99 })).toBe(
      13,
    );
  });

  test("the options are the shared choices, in their order", () => {
    expect(
      getProductAnalyticsRetentionOptions().map(
        (option: DropdownOption): unknown => {
          return option.value;
        },
      ),
    ).toEqual([3, 6, 13, 25]);
  });
});
