import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import CategoryCheckbox, {
  CategoryCheckboxOptionsAndCategories,
} from "../../../UI/Components/CategoryCheckbox/Index";
import CheckboxElement from "../../../UI/Components/Checkbox/Checkbox";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import StatusPageUtil from "../../../UI/Utils/StatusPage";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A CHECKBOX THAT NAMES A RECORD DRAWS THE NAME AS WRITTEN (#7782).
 *
 * A checkbox looked its title up in the reader's language, and lists of
 * checkboxes (CategoryCheckbox) title each box with a record's name: a
 * status page's groups and resources in a subscriber's form, the records in
 * a "Select items by Labels" dialog (SelectByLabelsDialogNames). On a
 * Spanish page a group or a resource named "Network" read "Red". A box
 * whose title is a name now says so and draws it as written; a box titled
 * with the product's words still reads them in the reader's language.
 */

const SPANISH: Record<string, string> = readDashboardLocale("es");

let spanishInstance: i18n | null = null;

// The Dashboard's Spanish, English behind it, as it ships.
function spanishI18n(): i18n {
  if (spanishInstance) {
    return spanishInstance;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: SPANISH },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  spanishInstance = instance;

  return instance;
}

function renderInSpanish(element: ReactElement): void {
  render(<I18nextProvider i18n={spanishI18n()}>{element}</I18nextProvider>);
}

// The status page's resources, as the page's API lists them.
function statusPageAPI(resources: Array<StatusPageResource>): typeof ModelAPI {
  class ResourcesAPI extends ModelAPI {}

  ResourcesAPI.getList = (async (): Promise<unknown> => {
    return {
      data: resources,
      count: resources.length,
      skip: 0,
      limit: resources.length,
    };
  }) as unknown as typeof ModelAPI.getList;

  return ResourcesAPI;
}

function group(id: string, name: string, order: number): StatusPageGroup {
  const value: StatusPageGroup = new StatusPageGroup();
  value._id = id;
  value.name = name;
  value.order = order;
  return value;
}

function resource(
  id: string,
  name: string,
  order: number,
  inGroup: StatusPageGroup,
): StatusPageResource {
  const value: StatusPageResource = new StatusPageResource();
  value._id = id;
  value.displayName = name;
  value.order = order;
  value.statusPageGroup = inGroup;
  return value;
}

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for Network, Website and Database", () => {
    expect({
      Network: SPANISH["Network"],
      Website: SPANISH["Website"],
      Database: SPANISH["Database"],
    }).toEqual({
      Network: "Red",
      Website: "Sitio web",
      Database: "Base de datos",
    });
  });
});

describe("a checkbox, on a Spanish page", () => {
  test("titled with the product's words, reads them in Spanish", () => {
    renderInSpanish(<CheckboxElement title="Website" />);

    expect(
      screen.getByRole("checkbox", { name: "Sitio web" }),
    ).toBeInTheDocument();
  });

  test("titled with a name, reads it as written", () => {
    renderInSpanish(
      <CheckboxElement title="Website" isTitleUserContent={true} />,
    );

    expect(
      screen.getByRole("checkbox", { name: "Website" }),
    ).toBeInTheDocument();
  });
});

describe("a status page's groups and resources, in a subscriber's form on a Spanish page", () => {
  test("read as the page names them", async () => {
    const network: StatusPageGroup = group(
      "019acd20-2222-4222-8222-222222222222",
      "Network",
      1,
    );

    const props: CategoryCheckboxOptionsAndCategories =
      await StatusPageUtil.getCategoryCheckboxPropsBasedOnResources(
        new ObjectID("019acd20-1111-4111-8111-111111111111"),
        undefined,
        statusPageAPI([
          resource(
            "019acd20-4444-4444-8444-444444444444",
            "Website",
            1,
            network,
          ),
          resource(
            "019acd20-5555-4555-8555-555555555555",
            "Database",
            2,
            network,
          ),
        ]),
      );

    renderInSpanish(
      <CategoryCheckbox
        categories={props.categories}
        options={props.options}
        onChange={() => {}}
      />,
    );

    expect(
      screen.getAllByRole("checkbox").map((box: HTMLElement): string => {
        return (
          document.querySelector(`label[for="${box.id}"]`)?.textContent || ""
        ).trim();
      }),
    ).toEqual(["Network", "Website", "Database"]);
  });
});
