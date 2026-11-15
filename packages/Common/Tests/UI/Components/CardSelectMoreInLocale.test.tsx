import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement, useState } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import CardSelect, {
  CardSelectCatalog,
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { withNoBreakSpaces } from "../../../Types/NoBreakSpaces";

/*
 * Create Monitor's More monitor types in the reader's language (issue
 * #5364's UI review). Folded after Change on a type it holds, More's line
 * names the choice - "More monitor types · Selected: Kubernetes" - and that
 * sentence is looked up whole, in every language the Dashboard ships: the
 * German line reads "Weitere Monitortypen · Ausgewählt: Kubernetes", never
 * an English "Selected:" beside German words.
 *
 * i18next is set up once for this file, from the Dashboard's own locale
 * files, as the Dashboard sets it up; each jest file has its own module
 * registry, so it reaches no other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

const SELECTED_KEY: string = "Selected: {{name}}";
const MORE_KEY: string = "More monitor types";

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const CATALOG: CardSelectCatalog = {
  commonOptionValues: ["Website"],
  moreOptionsText: MORE_KEY,
};

const OPTIONS: Array<CardSelectOptionGroup> = [
  {
    label: "Basic Monitoring",
    options: [
      {
        value: "Website",
        title: "Website",
        description: "Check a page loads and responds.",
        icon: IconProp.Globe,
      },
    ],
  },
  {
    label: "Infrastructure",
    options: [
      {
        value: "Kubernetes",
        title: "Kubernetes",
        description: "Cluster, node, workload, and pod health.",
        icon: IconProp.Kubernetes,
      },
    ],
  },
];

const Picker: () => ReactElement = (): ReactElement => {
  const [value, setValue] = useState<string | undefined>("Kubernetes");

  return (
    <CardSelect
      options={OPTIONS}
      value={value}
      onChange={setValue}
      catalog={CATALOG}
    />
  );
};

// Change on the Kubernetes monitor, then More folded: the choice is out of sight.
function foldAwayTheChoice(): HTMLElement {
  render(<Picker />);
  fireEvent.click(screen.getByTestId("card-select-change"));
  fireEvent.click(screen.getByTestId("card-select-more"));

  return screen.getByTestId("card-select-more");
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: resources,
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

describe("More monitor types' line in the reader's language", () => {
  test("German: Weitere Monitortypen · Ausgewählt: Kubernetes", () => {
    const more: HTMLElement = foldAwayTheChoice();

    expect(screen.getByTestId("card-select-more-title")).toHaveTextContent(
      /^Weitere Monitortypen$/,
    );
    expect(screen.getByTestId("card-select-more-selection")).toHaveTextContent(
      /^Ausgewählt: Kubernetes$/,
    );
    expect(more).toHaveAccessibleName("Weitere Monitortypen");
    expect(more).toHaveAccessibleDescription("Ausgewählt: Kubernetes");
    expect(more).not.toHaveTextContent("Selected");
  });

  /*
   * The line names the choice as its row and the summary do. It used to
   * look the title up even for a product's name (isTitleProductName), which
   * the rows and the summary draw as written: a product named "Resend" read
   * "Resend" on its row and "Ausgewählt: Erneut senden" on More's line, the
   * German for the verb.
   */
  test("German: a product's name folded away is named as written, as its row and the summary name it", () => {
    const productOptions: Array<CardSelectOptionGroup> = [
      OPTIONS[0]!,
      {
        label: "Providers",
        options: [
          {
            value: "resend",
            title: "Resend",
            description: "Check a page loads and responds.",
            icon: IconProp.Email,
            isTitleProductName: true,
          },
          {
            value: "responder",
            title: "Incident Responder",
            description: "Check a page loads and responds.",
            icon: IconProp.User,
            isUserContent: true,
          },
        ],
      },
    ];

    const ProductPicker: (props: {
      initial: string;
    }) => ReactElement = (props: { initial: string }): ReactElement => {
      const [value, setValue] = useState<string | undefined>(props.initial);

      return (
        <CardSelect
          options={productOptions}
          value={value}
          onChange={setValue}
          catalog={CATALOG}
        />
      );
    };

    // The words a lookup would give: what the line must not say.
    expect(readLocale("de")["Resend"]).toBe("Erneut senden");

    for (const [initial, name] of [
      ["resend", "Resend"],
      ["responder", "Incident Responder"],
    ] as Array<[string, string]>) {
      render(<ProductPicker initial={initial} />);

      // The summary names it as written...
      expect(screen.getByTestId("card-select-summary-title")).toHaveTextContent(
        new RegExp(`^${name}$`),
      );

      fireEvent.click(screen.getByTestId("card-select-change"));

      // ...and so does its row, open under More...
      expect(
        screen.getByTestId(`card-select-option-${initial}`),
      ).toHaveTextContent(name);

      fireEvent.click(screen.getByTestId("card-select-more"));

      // ...and More's line, folded, in a German sentence.
      expect(
        screen.getByTestId("card-select-more-selection"),
      ).toHaveTextContent(new RegExp(`^Ausgewählt: ${name}$`));
      expect(
        screen.getByTestId("card-select-more"),
      ).toHaveAccessibleDescription(`Ausgewählt: ${name}`);

      cleanup();
    }
  });

  test("Persian: the sentence the Persian file words, the type's name in it", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("fa");
    });

    foldAwayTheChoice();

    expect(screen.getByTestId("card-select-more-selection")).toHaveTextContent(
      /^انتخاب‌شده: Kubernetes$/,
    );
    expect(screen.getByTestId("card-select-more-title")).toHaveTextContent(
      readLocale("fa")[MORE_KEY]!,
    );
  });

  test("every language the Dashboard ships words the sentence itself, the name kept", async () => {
    for (const language of LANGUAGES) {
      const words: string | undefined = readLocale(language)[SELECTED_KEY];

      expect({ language, words }).toEqual({
        language,
        words: expect.stringContaining("{{name}}"),
      });
      expect({ language, isEnglish: words === SELECTED_KEY }).toEqual({
        language,
        isEnglish: false,
      });

      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      foldAwayTheChoice();

      expect({
        language,
        line: screen.getByTestId("card-select-more-selection").textContent,
      }).toEqual({
        language,
        // As the page draws the words: French's colon kept with its word.
        line: withNoBreakSpaces(words!, SELECTED_KEY, language)
          .split("{{name}}")
          .join("Kubernetes"),
      });

      cleanup();
    }
  });
});
