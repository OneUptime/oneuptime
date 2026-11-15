import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ENGLISH_SAID_TRANSLATED_MESSAGE,
  FLAG_NOT_READ_MESSAGE,
  LOOKED_UP_TWICE_MESSAGE,
  PlaceholderProblem,
  PlaceholderScanResult,
  PlaceholderSite,
  SOMETIMES_SAID_TRANSLATED_MESSAGE,
  scanPlaceholders,
} from "../../Helpers/PlaceholderLookupScan";

/*
 * A PLACEHOLDER IS LOOKED UP ONCE, WHEREVER IT IS DRAWN (#7682).
 *
 * #7663 made a form field's placeholder looked up once: FormField hands it
 * over in English, and the control that draws it looks it up. Outside
 * forms, pages still looked a placeholder up and handed the translation to
 * a control that looked it up again - Code's context dialog, the OpenStack
 * checks' option boxes, a note's file picker, the filters, the facet chips
 * and more - and so did the forms whose placeholder is a sentence built
 * around a value, and the Admin Dashboard's, Accounts' and the status
 * pages' keyed texts. Where a translation is itself an English key, the
 * reader saw the translation of the translation: Spanish says "Red" for
 * "Network", and "Rojo" for "Red".
 *
 * Every placeholder now goes over in English, or - a sentence around a
 * value, a front end's own keyed text - is said to be in the reader's
 * words already (isPlaceholderTranslated, is<Prop>Translated), and the
 * control draws it as given. This guard reads every page and shared
 * component (Helpers/PlaceholderLookupScan says how) and fails, naming the
 * place, on a placeholder looked up for a control that looks it up again,
 * on English said to be in the reader's words, on a looked-up one said to
 * be so only some of the time, and on the flag given to a component that
 * never reads it. Run over main before this change, it named the places
 * this change fixed.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");

let checkout: PlaceholderScanResult;

beforeAll(() => {
  checkout = scanPlaceholders(PACKAGES);
});

function sitesIn(file: string): Array<PlaceholderSite> {
  return checkout.sites.filter((site: PlaceholderSite): boolean => {
    return site.where.startsWith(`${file}:`);
  });
}

describe("the controls that look up a placeholder they are given", () => {
  test.each([
    ["Common/UI/Components/Input/Input.tsx", "Input", "placeholder"],
    ["Common/UI/Components/TextArea/TextArea.tsx", "TextArea", "placeholder"],
    ["Common/UI/Components/Dropdown/Dropdown.tsx", "Dropdown", "placeholder"],
    [
      "Common/UI/Components/EntityDropdown/EntityDropdown.tsx",
      "EntityDropdown",
      "placeholder",
    ],
    [
      "Common/UI/Components/AutocompleteTextInput/AutocompleteTextInput.tsx",
      "AutocompleteTextInput",
      "placeholder",
    ],
    [
      "Common/UI/Components/CodeEditor/CodeEditor.tsx",
      "CodeEditor",
      "placeholder",
    ],
    // Through the editor's hint.
    [
      "Common/UI/Components/CodeEditor/YamlEditor.tsx",
      "YamlEditor",
      "placeholder",
    ],
    [
      "Common/UI/Components/Markdown.tsx/MarkdownEditor.tsx",
      "MarkdownEditor",
      "placeholder",
    ],
    // Through a helper it hands the translator.
    [
      "Common/UI/Components/FilePicker/FilePicker.tsx",
      "FilePicker",
      "placeholder",
    ],
    [
      "Common/UI/Components/TimePicker/TimePicker.tsx",
      "TimePicker",
      "placeholder",
    ],
    [
      "Common/UI/Components/Forms/Fields/ColorPicker.tsx",
      "ColorPicker",
      "placeholder",
    ],
    // Through the Input it draws.
    [
      "Common/UI/Components/Forms/Fields/IconPicker.tsx",
      "IconPicker",
      "placeholder",
    ],
    [
      "Common/UI/Components/Workflow/ValuePicker/ValueTextField.tsx",
      "ValueTextField",
      "placeholder",
    ],
    [
      "Common/UI/Components/Navbar/NavBarMenuModal.tsx",
      "NavBarMenuModal",
      "searchPlaceholder",
    ],
    // A page's own: through the Input it draws.
    [
      "App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackCheckFormFields.tsx",
      "OptionInput",
      "placeholder",
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/AIChat/ChatInput.tsx",
      "ChatInput",
      "placeholder",
    ],
  ])(
    "%s's %s looks up its %s",
    (file: string, component: string, prop: string) => {
      expect(checkout.isLookedUpBy(file, component, prop)).toBe(true);
    },
  );
});

describe("every placeholder written for such a control", () => {
  test("is found: the pages' and the shared components', in and out of forms", () => {
    // Every control FormField draws, each told what the field says.
    expect(
      sitesIn("Common/UI/Components/Forms/Fields/FormField.tsx")
        .filter((site: PlaceholderSite): boolean => {
          return site.handedTo.endsWith(" placeholder>");
        })
        .map((site: PlaceholderSite) => {
          return [site.handedTo, site.isSaidTranslated];
        }),
    ).toEqual([
      ["<TimePicker placeholder>", true],
      ["<ColorPicker placeholder>", true],
      ["<IconPicker placeholder>", true],
      ["<EntityDropdown placeholder>", true],
      ["<Dropdown placeholder>", true],
      ["<TextArea placeholder>", true],
      ["<CodeEditor placeholder>", true],
      ["<YamlEditor placeholder>", true],
      ["<MarkdownEditor placeholder>", true],
      ["<CodeEditor placeholder>", true],
      ["<FilePicker placeholder>", true],
      ["<Input placeholder>", true],
    ]);

    // A filter's sentence around its field, and a note's file picker.
    expect(sitesIn("Common/UI/Components/Filters/DropdownFilter.tsx")).toEqual([
      expect.objectContaining({
        handedTo: "<Dropdown placeholder>",
        isLookedUp: true,
        isSaidTranslated: true,
      }),
    ]);
    expect(
      sitesIn(
        "App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer.tsx",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          handedTo: "<FilePicker placeholder>",
          isLookedUp: false,
          isSaidTranslated: false,
        }),
      ]),
    );

    // The keyed texts of the Admin Dashboard, Accounts and status pages.
    expect(
      sitesIn(
        "App/FeatureSet/StatusPage/src/Pages/Subscribe/SlackSubscribe.tsx",
      ).map((site: PlaceholderSite) => {
        return [site.handedTo, site.isLookedUp, site.isSaidTranslated];
      }),
    ).toEqual([
      ["a form field's placeholder", true, true],
      ["a form field's placeholder", true, true],
      ["a form field's placeholder", true, true],
    ]);

    // Of every page and component: none is missed for want of reading it.
    expect(checkout.sites.length).toBeGreaterThanOrEqual(1500);
    expect(
      checkout.sites.filter((site: PlaceholderSite): boolean => {
        return site.isLookedUp && site.isSaidTranslated;
      }).length,
    ).toBeGreaterThanOrEqual(30);
  });

  test("is English, or said to be in the reader's words: never looked up twice", () => {
    expect(checkout.problems).toEqual([]);
  });
});

/*
 * The rules, on a page written for them: a shared Input that looks its
 * placeholder up, a page's Box that hands its own on to it, and every way
 * a page can hand them one.
 */
describe("the guard's rules", () => {
  let packages: string;
  let fixture: PlaceholderScanResult;

  const PAGE: string = path.join(
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "Page.tsx",
  );

  // Each placeholder on a line of its own.
  const PAGE_LINES: Array<string> = [
    'import React from "react";',
    'import Input from "Common/UI/Components/Input/Input";',
    'import Box from "../Components/Box";',
    'import Lazy from "../Components/Lazy";',
    'import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";',
    'const SEARCH = translationKey("Search");',
    "const Page = () => {",
    "  const translator = useTranslator();",
    '  const looked = translator.translateText("Region");',
    "  const fields = [",
    '    { fieldType: FormFieldSchemaType.Text, placeholder: translator.translateText("Zone") },',
    '    { fieldType: FormFieldSchemaType.Text, placeholder: "Rack" },',
    '    { fieldType: FormFieldSchemaType.Text, placeholder: t("pages.row"), isPlaceholderTranslated: true },',
    '    { fieldType: FormFieldSchemaType.Text, placeholder: "Aisle", isPlaceholderTranslated: true },',
    '    { fieldType: FormFieldSchemaType.Text, placeholder: t("pages.hall"), isPlaceholderTranslated: false },',
    '    { fieldType: FormFieldSchemaType.Text, placeholder: t("pages.gate"), isPlaceholderTranslated: Boolean(looked) },',
    "  ];",
    "  return (",
    "    <>",
    '      <Input placeholder={translator.translateText("Network")} />',
    "      <Input placeholder={looked} />",
    '      <Input placeholder="Site" />',
    '      <Input placeholder={translator.translateTemplate("Find {{x}}", { x: 1 })} isPlaceholderTranslated={true} />',
    '      <Input placeholder="Floor" isPlaceholderTranslated={true} />',
    "      <Input placeholder={SEARCH} isPlaceholderTranslated />",
    '      <Input placeholder={translator.translateText("City")} isPlaceholderTranslated={false} />',
    '      <Input placeholder={translator.translateText("Area") || ""} isPlaceholderTranslated={true} />',
    '      <Input placeholder={looked || "Street"} isPlaceholderTranslated={Boolean(looked)} />',
    '      <Input placeholder={translator.translateText("Lane") as string} isPlaceholderTranslated={Boolean(looked)} />',
    '      <Input placeholder={SEARCH || translator.translateTemplate("Dock {{x}}", { x: 1 })} isPlaceholderTranslated={!SEARCH} />',
    '      <Box placeholder={translator.translateText("Country")} />',
    '      <Box placeholder={translator.translateTemplate("Near {{x}}", { x: 1 })} isPlaceholderTranslated={true} />',
    '      <Lazy placeholder={translator.translateTemplate("Up {{x}}", { x: 1 })} isPlaceholderTranslated={true} />',
    '      <input placeholder={translator.translateText("Planet")} />',
    "    </>",
    "  );",
    "};",
    "export default Page;",
  ];

  // The place of the page's one line with a piece of code on it.
  const at: (code: string) => string = (code: string): string => {
    const lines: Array<number> = [];

    PAGE_LINES.forEach((line: string, index: number) => {
      if (line.includes(code)) {
        lines.push(index + 1);
      }
    });

    expect(lines).toHaveLength(1);

    return `${PAGE}:${lines[0]}`;
  };

  const write: (file: string, lines: Array<string>) => void = (
    file: string,
    lines: Array<string>,
  ): void => {
    const full: string = path.join(packages, file);

    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, lines.join("\n"));
  };

  beforeAll(() => {
    packages = fs.mkdtempSync(path.join(os.tmpdir(), "placeholder-scan-"));

    write(path.join("Common", "UI", "Components", "Input", "Input.tsx"), [
      'import React from "react";',
      "const Input = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return (",
      "    <input",
      "      placeholder={",
      "        props.isPlaceholderTranslated",
      "          ? props.placeholder",
      "          : translateString(props.placeholder)",
      "      }",
      "    />",
      "  );",
      "};",
      "export default Input;",
    ]);

    write(
      path.join(
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "Box.tsx",
      ),
      [
        'import React from "react";',
        'import Input from "Common/UI/Components/Input/Input";',
        "// Hands its placeholder on, and never reads the flag.",
        "const Box = (props) => {",
        "  return <Input placeholder={props.placeholder} />;",
        "};",
        "export default Box;",
      ],
    );

    write(
      path.join(
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "Lazy.tsx",
      ),
      [
        'import React from "react";',
        'import Input from "Common/UI/Components/Input/Input";',
        "// Hands its props on whole, the flag with them.",
        "const Lazy = (props) => {",
        "  return <Input {...props} />;",
        "};",
        "export default Lazy;",
      ],
    );

    write(PAGE, PAGE_LINES);

    fixture = scanPlaceholders(packages);
  });

  afterAll(() => {
    fs.rmSync(packages, { recursive: true, force: true });
  });

  test("finds the controls by their code, and a component that hands its placeholder on", () => {
    expect(
      fixture.isLookedUpBy(
        path.join("Common", "UI", "Components", "Input", "Input.tsx"),
        "Input",
        "placeholder",
      ),
    ).toBe(true);
    expect(
      fixture.isLookedUpBy(
        path.join(
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          "Components",
          "Box.tsx",
        ),
        "Box",
        "placeholder",
      ),
    ).toBe(true);
  });

  test("fails on each place a placeholder is looked up twice or drawn in English, and on nothing else", () => {
    expect(
      fixture.problems.map((problem: PlaceholderProblem) => {
        return [problem.where, problem.handedTo, problem.code, problem.message];
      }),
    ).toEqual([
      [
        at('"Zone"'),
        "a form field's placeholder",
        'translator.translateText("Zone")',
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"Aisle"'),
        "a form field's placeholder",
        '"Aisle"',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"pages.hall"'),
        "a form field's placeholder",
        't("pages.hall")',
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"pages.gate"'),
        "a form field's placeholder",
        't("pages.gate")',
        `${SOMETIMES_SAID_TRANSLATED_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"Network"'),
        "<Input placeholder>",
        '{translator.translateText("Network")}',
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at("{looked} />"),
        "<Input placeholder>",
        "{looked}",
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"Floor"'),
        "<Input placeholder>",
        '"Floor"',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at("{SEARCH}"),
        "<Input placeholder>",
        "{SEARCH}",
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"City"'),
        "<Input placeholder>",
        '{translator.translateText("City")}',
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"Lane"'),
        "<Input placeholder>",
        '{translator.translateText("Lane") as string}',
        `${SOMETIMES_SAID_TRANSLATED_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"Country"'),
        "<Box placeholder>",
        '{translator.translateText("Country")}',
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"Near'),
        "<Box placeholder>",
        '{translator.translateTemplate("Near {{x}}", { x: 1 })}',
        `${FLAG_NOT_READ_MESSAGE}isPlaceholderTranslated`,
      ],
    ]);
  });
});
