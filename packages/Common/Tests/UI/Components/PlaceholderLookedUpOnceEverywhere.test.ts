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
 * A TEXT IS LOOKED UP ONCE, WHEREVER IT IS DRAWN (#7682, #7790, #7791).
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
 * So did the Dashboard's nav (#7790): its products' names are its own keyed
 * texts (t("navbar.items.networkTitle")), and the bar, a pinned product and
 * the phone's menu looked each up again - Network read "Rojo" in Spanish,
 * Home "Starten" in Dutch, Logs and Queues "Registro" and "Codice" in
 * Italian, Profiles "Profil" in German. So did the products menu's words, a
 * link's title and over a hundred aria labels; and the Admin Dashboard's
 * detail cards, whose words for an empty value (t("common.none"))
 * PlaceholderText looked up again (#7791).
 *
 * Every such text now goes over in English, or - a sentence around a
 * value, a front end's own keyed text - is said to be in the reader's
 * words already (is<Prop>Translated: isPlaceholderTranslated,
 * isAriaLabelTranslated, isTitleTranslated), and the control draws it as
 * given. This guard reads every page and shared component
 * (Helpers/PlaceholderLookupScan says how) and fails, naming the place, on
 * a text looked up for a control that looks it up again, on English said
 * to be in the reader's words, on a looked-up one said to be so only some
 * of the time, and on the flag given to a component that never reads it.
 * Run over main before each change, it named the places that change fixed.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
// <Button ariaLabel>, <Dropdown ariaLabel>, <NavBar moreMenuAriaLabel>.
const HANDED_TO_ARIA_LABEL: RegExp = /[aA]riaLabel>$/;
// A detail card's field, or a field of a fields array.
const FIELD_PLACEHOLDER: RegExp = /^a (detail )?field's placeholder$/;

let checkout: PlaceholderScanResult;

beforeAll(() => {
  checkout = scanPlaceholders(PACKAGES);
});

function sitesIn(file: string): Array<PlaceholderSite> {
  return checkout.sites.filter((site: PlaceholderSite): boolean => {
    return site.where.startsWith(`${file}:`);
  });
}

// The place of a file's one line with a piece of code on it.
function placeOf(file: string, lines: Array<string>, code: string): string {
  const found: Array<number> = [];

  lines.forEach((line: string, index: number) => {
    if (line.includes(code)) {
      found.push(index + 1);
    }
  });

  expect(found).toHaveLength(1);

  return `${file}:${found[0]}`;
}

// The place of a line of the checkout's own code.
function placeInCheckout(file: string, code: string): string {
  return placeOf(
    file,
    fs.readFileSync(path.join(PACKAGES, file), "utf8").split("\n"),
    code,
  );
}

// Writes a file of a fixture's packages folder.
function writeFixture(
  packages: string,
  file: string,
  lines: Array<string>,
): void {
  const full: string = path.join(packages, file);

  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.join("\n"));
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

describe("the controls that look up a nav title, a menu's words, an aria label or an empty value's words (#7790, #7791)", () => {
  test.each([
    ["Common/UI/Components/Navbar/NavBarItem.tsx", "NavBarItem", "title"],
    // Through the Link it draws.
    ["Common/UI/Components/Navbar/NavBarItem.tsx", "NavBarItem", "tooltip"],
    // Through the products menu it opens.
    ["Common/UI/Components/Navbar/NavBar.tsx", "Navbar", "moreMenuFooter"],
    [
      "Common/UI/Components/Navbar/NavBar.tsx",
      "Navbar",
      "moreMenuNoResultsText",
    ],
    [
      "Common/UI/Components/Navbar/NavBar.tsx",
      "Navbar",
      "moreMenuKeyboardHint",
    ],
    // Through the menu, and the phone's.
    ["Common/UI/Components/Navbar/NavBar.tsx", "Navbar", "moreMenuRecentLabel"],
    [
      "Common/UI/Components/Navbar/NavBarMenuModal.tsx",
      "NavBarMenuModal",
      "footer",
    ],
    [
      "Common/UI/Components/Navbar/NavBarMenuModal.tsx",
      "NavBarMenuModal",
      "noResultsText",
    ],
    [
      "Common/UI/Components/Navbar/NavBarMenuModal.tsx",
      "NavBarMenuModal",
      "keyboardHint",
    ],
    [
      "Common/UI/Components/Navbar/NavBarMenuModal.tsx",
      "NavBarMenuModal",
      "recentLabel",
    ],
    [
      "Common/UI/Components/Navbar/NavBarMobileMenu.tsx",
      "NavBarMobileMenu",
      "recentLabel",
    ],
    ["Common/UI/Components/Link/Link.tsx", "Link", "title"],
    ["Common/UI/Components/Button/Button.tsx", "Button", "ariaLabel"],
    ["Common/UI/Components/Dropdown/Dropdown.tsx", "Dropdown", "ariaLabel"],
    ["Common/UI/Components/MoreMenu/MoreMenu.tsx", "MoreMenu", "ariaLabel"],
    // Through the MoreMenu it draws.
    ["Common/UI/Components/Card/CardMoreMenu.tsx", "CardMoreMenu", "ariaLabel"],
    [
      "Common/UI/Components/Checkbox/Checkbox.tsx",
      "CheckboxElement",
      "ariaLabel",
    ],
    ["Common/UI/Components/Toggle/Toggle.tsx", "Toggle", "ariaLabel"],
    [
      "Common/UI/Components/Workflow/ValuePicker/ValueTextField.tsx",
      "ValueTextField",
      "ariaLabel",
    ],
    [
      "Common/UI/Components/PeoplePicker/PeopleSearchPopup.tsx",
      "PeopleSearchPopup",
      "ariaLabel",
    ],
    // A page's own.
    [
      "App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi.tsx",
      "ReplayToolButton",
      "ariaLabel",
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/EventView/EventStatBar.tsx",
      "EventStatBar",
      "ariaLabel",
    ],
    // Through the Dropdown it draws.
    [
      "App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventPicker.tsx",
      "ProductAnalyticsEventPicker",
      "ariaLabel",
    ],
    [
      "Common/UI/Components/Detail/PlaceholderText.tsx",
      "PlaceholderText",
      "text",
    ],
    // Through the PlaceholderText it draws.
    ["Common/UI/Components/Detail/EmptyValue.tsx", "EmptyValue", "placeholder"],
  ])(
    "%s's %s looks up its %s",
    (file: string, component: string, prop: string) => {
      expect(checkout.isLookedUpBy(file, component, prop)).toBe(true);
    },
  );
});

describe("every nav title, menu word, aria label and empty value's words written for such a control", () => {
  const NAVIGATION_ITEMS: string =
    "App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx";

  test("is found: the Dashboard's products and Home, and its products menu's words", () => {
    // Network ("Red" in Spanish) and Home ("Start" in Dutch), keyed here.
    expect(checkout.sites).toContainEqual({
      where: placeInCheckout(
        NAVIGATION_ITEMS,
        'title: t("navbar.items.networkTitle"',
      ),
      handedTo: "a MoreMenuItem's title",
      isLookedUp: true,
      isSaidTranslated: true,
    });
    expect(checkout.sites).toContainEqual({
      where: placeInCheckout(NAVIGATION_ITEMS, 'title: t("navbar.home")'),
      handedTo: "a NavItem's title",
      isLookedUp: true,
      isSaidTranslated: true,
    });
    // Every product the menu lists, Home and the account menu.
    expect(sitesIn(NAVIGATION_ITEMS).length).toBeGreaterThanOrEqual(49);

    // The products menu's words, the Dashboard's own.
    expect(
      sitesIn("App/FeatureSet/Dashboard/src/Components/NavBar/NavBar.tsx").map(
        (site: PlaceholderSite) => {
          return [site.handedTo, site.isLookedUp, site.isSaidTranslated];
        },
      ),
    ).toEqual([
      ["<NavBar moreMenuFooter>", true, true],
      ["<NavBar moreMenuSearchPlaceholder>", true, true],
      ["<NavBar moreMenuNoResultsText>", true, true],
      ["<NavBar moreMenuKeyboardHint>", true, true],
      ["<NavBar moreMenuRecentLabel>", true, true],
    ]);

    // The Admin Dashboard's sections and menu words: English, read too.
    expect(
      sitesIn("App/FeatureSet/AdminDashboard/src/Components/NavBar/NavBar.tsx")
        .length,
    ).toBeGreaterThanOrEqual(10);

    // A status page's own words for its pages.
    expect(
      sitesIn("App/FeatureSet/StatusPage/src/Components/NavBar/NavBar.tsx")
        .filter((site: PlaceholderSite): boolean => {
          return site.handedTo === "<NavBarItem title>";
        })
        .map((site: PlaceholderSite): boolean => {
          return site.isSaidTranslated;
        }),
    ).toEqual([true, true, true]);
  });

  test("is found: the aria labels, the links' titles and the detail cards' words for an empty value", () => {
    const ariaLabels: Array<PlaceholderSite> = checkout.sites.filter(
      (site: PlaceholderSite): boolean => {
        return HANDED_TO_ARIA_LABEL.test(site.handedTo);
      },
    );

    // Of every page and component: none is missed for want of reading it.
    expect(ariaLabels.length).toBeGreaterThanOrEqual(250);
    expect(
      ariaLabels.filter((site: PlaceholderSite): boolean => {
        return site.isLookedUp && site.isSaidTranslated;
      }).length,
    ).toBeGreaterThanOrEqual(60);
    expect(
      checkout.sites.filter((site: PlaceholderSite): boolean => {
        return (
          site.handedTo === "<Link title>" &&
          site.isLookedUp &&
          site.isSaidTranslated
        );
      }).length,
    ).toBeGreaterThanOrEqual(14);

    // The Admin Dashboard's detail cards: t("common.none") and its kind.
    expect(
      checkout.sites.filter((site: PlaceholderSite): boolean => {
        return (
          site.where.startsWith("App/FeatureSet/AdminDashboard/") &&
          FIELD_PLACEHOLDER.test(site.handedTo) &&
          site.isLookedUp &&
          site.isSaidTranslated
        );
      }).length,
    ).toBeGreaterThanOrEqual(26);
    expect(
      sitesIn(
        "App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Subscription.tsx",
      ).filter((site: PlaceholderSite): boolean => {
        return site.handedTo === "<PlaceholderText text>";
      }),
    ).toEqual([
      expect.objectContaining({ isLookedUp: true, isSaidTranslated: true }),
    ]);
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
    return placeOf(PAGE, PAGE_LINES, code);
  };

  const write: (file: string, lines: Array<string>) => void = (
    file: string,
    lines: Array<string>,
  ): void => {
    writeFixture(packages, file, lines);
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

/*
 * The rules for the other texts (#7790, #7791), on a page written for them:
 * a shared Select that looks its aria label up, a Tab that looks its title
 * up and offers isTitleTranslated for it, a Heading that looks its title up
 * and offers no such flag, a Menu whose items' type offers one, and a
 * detail card's fields.
 */
describe("the guard's rules, for an aria label, a title, a menu's items and a detail card's fields", () => {
  let packages: string;
  let fixture: PlaceholderScanResult;

  const COMPONENTS: string = path.join("Common", "UI", "Components");

  const PAGE: string = path.join(
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "Nav.tsx",
  );

  // Each text on a line of its own.
  const PAGE_LINES: Array<string> = [
    'import React from "react";',
    'import Select from "Common/UI/Components/Select/Select";',
    'import Tab from "Common/UI/Components/Tab/Tab";',
    'import Heading from "Common/UI/Components/Heading/Heading";',
    'import Menu, { MenuItem, PinnedItem } from "Common/UI/Components/Menu/Menu";',
    'import FieldType from "Common/UI/Components/Types/FieldType";',
    'const KIND = translationKey("Kind");',
    "const Nav = () => {",
    "  const { t } = useTranslation();",
    "  const items: Array<MenuItem> = [",
    '    { title: t("navbar.items.networkTitle") },',
    '    { title: "Logs" },',
    '    { title: t("navbar.items.queuesTitle"), isTitleTranslated: true },',
    '    { title: "Traces", isTitleTranslated: true },',
    "  ];",
    '  const pinned = { title: t("navbar.items.logsTitle"), pinnedAt: 1 } as PinnedItem;',
    '  const home: PinnedItem = { title: t("navbar.home"), isTitleTranslated: true, pinnedAt: 2 };',
    "  const card = {",
    "    fields: [",
    '      { fieldType: FieldType.Text, placeholder: t("common.none") },',
    '      { title: "Owner", placeholder: t("common.unknown"), isPlaceholderTranslated: true },',
    '      { title: "Region", placeholder: "No region" },',
    '      { title: "Rack", placeholder: t("common.notSet") },',
    "    ],",
    "  };",
    "  return (",
    "    <>",
    '      <Select ariaLabel={t("pages.kind")} />',
    "      <Select ariaLabel={KIND} />",
    '      <Select ariaLabel={t("pages.device")} isAriaLabelTranslated={true} />',
    '      <Select ariaLabel="Device" isAriaLabelTranslated={true} />',
    '      <Tab title={t("navbar.userSettings")} />',
    '      <Tab title="Settings" />',
    '      <Tab title={t("navbar.items.performanceProfilesTitle")} isTitleTranslated={true} />',
    '      <Heading title={t("pages.heading")} />',
    '      <select aria-label={t("pages.native")} />',
    "      <Menu items={[...items, pinned, home]} />",
    "    </>",
    "  );",
    "};",
    "export default Nav;",
  ];

  const at: (code: string) => string = (code: string): string => {
    return placeOf(PAGE, PAGE_LINES, code);
  };

  beforeAll(() => {
    packages = fs.mkdtempSync(path.join(os.tmpdir(), "text-lookup-scan-"));

    writeFixture(packages, path.join(COMPONENTS, "Select", "Select.tsx"), [
      'import React from "react";',
      "const Select = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return (",
      "    <select",
      "      aria-label={",
      "        props.isAriaLabelTranslated",
      "          ? props.ariaLabel",
      "          : translateString(props.ariaLabel)",
      "      }",
      "    />",
      "  );",
      "};",
      "export default Select;",
    ]);

    writeFixture(packages, path.join(COMPONENTS, "Tab", "Tab.tsx"), [
      'import React from "react";',
      "const Tab = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  const title = props.isTitleTranslated",
      "    ? props.title",
      "    : translateString(props.title);",
      "  return <button>{title}</button>;",
      "};",
      "export default Tab;",
    ]);

    writeFixture(packages, path.join(COMPONENTS, "Heading", "Heading.tsx"), [
      'import React from "react";',
      "// Looks its title up, and cannot be told it is translated.",
      "const Heading = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return <h1>{translateString(props.title)}</h1>;",
      "};",
      "export default Heading;",
    ]);

    writeFixture(packages, path.join(COMPONENTS, "Menu", "Menu.tsx"), [
      'import React from "react";',
      "export interface MenuItem {",
      "  title: string;",
      "  isTitleTranslated?: boolean;",
      "}",
      "export interface PinnedItem extends MenuItem {",
      "  pinnedAt: number;",
      "}",
      "const Menu = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return (",
      "    <ul>",
      "      {props.items.map((item) => {",
      "        return (",
      "          <li>",
      "            {item.isTitleTranslated",
      "              ? item.title",
      "              : translateString(item.title)}",
      "          </li>",
      "        );",
      "      })}",
      "    </ul>",
      "  );",
      "};",
      "export default Menu;",
    ]);

    writeFixture(packages, PAGE, PAGE_LINES);

    fixture = scanPlaceholders(packages);
  });

  afterAll(() => {
    fs.rmSync(packages, { recursive: true, force: true });
  });

  test("holds a title only where its control offers is<Prop>Translated for it", () => {
    for (const [file, component] of [
      [path.join(COMPONENTS, "Tab", "Tab.tsx"), "Tab"],
      [path.join(COMPONENTS, "Heading", "Heading.tsx"), "Heading"],
    ] as Array<[string, string]>) {
      expect(fixture.isLookedUpBy(file, component, "title")).toBe(true);
    }

    const handedTo: Array<string> = fixture.sites.map(
      (site: PlaceholderSite): string => {
        return site.handedTo;
      },
    );

    expect(
      handedTo.filter((to: string): boolean => {
        return to === "<Tab title>";
      }),
    ).toHaveLength(3);
    expect(handedTo).not.toContain("<Heading title>");
  });

  test("fails on each place such a text is looked up twice or drawn in English, and on nothing else", () => {
    expect(
      fixture.problems.map((problem: PlaceholderProblem) => {
        return [problem.where, problem.handedTo, problem.code, problem.message];
      }),
    ).toEqual([
      [
        at('"navbar.items.networkTitle"'),
        "a MenuItem's title",
        't("navbar.items.networkTitle")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"Traces"'),
        "a MenuItem's title",
        '"Traces"',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isTitleTranslated`,
      ],
      // Cast to a type that takes the flag from the one it extends.
      [
        at('"navbar.items.logsTitle"'),
        "a PinnedItem's title",
        't("navbar.items.logsTitle")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"common.none"'),
        "a detail field's placeholder",
        't("common.none")',
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      // A card's field that leaves its type out.
      [
        at('"common.notSet"'),
        "a field's placeholder",
        't("common.notSet")',
        `${LOOKED_UP_TWICE_MESSAGE}isPlaceholderTranslated`,
      ],
      [
        at('"pages.kind"'),
        "<Select ariaLabel>",
        '{t("pages.kind")}',
        `${LOOKED_UP_TWICE_MESSAGE}isAriaLabelTranslated`,
      ],
      [
        at('"Device"'),
        "<Select ariaLabel>",
        '"Device"',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isAriaLabelTranslated`,
      ],
      [
        at('"navbar.userSettings"'),
        "<Tab title>",
        '{t("navbar.userSettings")}',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
    ]);
  });
});
