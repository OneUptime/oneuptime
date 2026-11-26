import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  BREADCRUMB_TITLE,
  ENGLISH_SAID_TRANSLATED_MESSAGE,
  FLAG_NOT_READ_MESSAGE,
  LOOKED_UP_TWICE_MESSAGE,
  MENU_LINK_TITLE,
  PlaceholderProblem,
  PlaceholderScanResult,
  PlaceholderSite,
  SOMETIMES_SAID_TRANSLATED_MESSAGE,
  UNFLAGGED_HAND_ON_MESSAGE,
  scanPlaceholders,
  translatedFlagOf,
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
/*
 * The Enterprise pages, beside the packages, are read only where ee/ is
 * checked out: the Common Test job deletes it before it runs, and the
 * Enterprise Edition Test workflow (test.ee.yaml) runs this with it.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(PACKAGES, "..", "ee"),
);
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
      // Its heading, its own keyed words (#8224).
      ["<Page title>", true, true],
      // Its trail's two crumbs, its own keyed words too (#8075).
      [BREADCRUMB_TITLE, true, true],
      [BREADCRUMB_TITLE, true, true],
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
    /*
     * Every placeholder the subscription page draws is looked up once and
     * said translated - however many it has: it gained a second, for a
     * project with no user limit, after this was first written.
     */
    const subscriptionPlaceholders: Array<PlaceholderSite> = sitesIn(
      "App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Subscription.tsx",
    ).filter((site: PlaceholderSite): boolean => {
      return site.handedTo === "<PlaceholderText text>";
    });

    expect(subscriptionPlaceholders.length).toBeGreaterThanOrEqual(1);

    for (const site of subscriptionPlaceholders) {
      expect(site).toEqual(
        expect.objectContaining({ isLookedUp: true, isSaidTranslated: true }),
      );
    }
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

/*
 * #8075: THE ADMIN DASHBOARD'S BREADCRUMBS, AND THE PRODUCTS MENU'S ITEMS.
 *
 * The Admin Dashboard words its crumbs itself (t("breadcrumbs.settings")),
 * and so do the status pages (t("nav.overview")): Breadcrumbs, the browser
 * tab and the phone's menu looked each one up again. Each now says
 * isTitleTranslated (Link). And the products menu looks up an item's
 * description and category unless the item says they are translated
 * (MoreMenuItem.isDescriptionTranslated, isCategoryTranslated), as the
 * Dashboard's 47 products now do; the Admin Dashboard hands its in English.
 */
describe("every breadcrumb and every products menu item's words written for a page (#8075)", () => {
  const ADMIN: string = "App/FeatureSet/AdminDashboard/";
  const STATUS_PAGE: string = "App/FeatureSet/StatusPage/";
  const DASHBOARD_NAV: string =
    "App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx";
  const ADMIN_NAV: string =
    "App/FeatureSet/AdminDashboard/src/Components/NavBar/NavBar.tsx";

  const crumbsIn: (prefix: string) => Array<PlaceholderSite> = (
    prefix: string,
  ): Array<PlaceholderSite> => {
    return checkout.sites.filter((site: PlaceholderSite): boolean => {
      return (
        site.where.startsWith(prefix) && site.handedTo === BREADCRUMB_TITLE
      );
    });
  };

  test("finds the Admin Dashboard's 123 keyed crumbs, every one said to be translated", () => {
    const keyed: Array<PlaceholderSite> = crumbsIn(ADMIN).filter(
      (site: PlaceholderSite): boolean => {
        return site.isLookedUp;
      },
    );

    expect(keyed.length).toBeGreaterThanOrEqual(123);
    expect(
      keyed.every((site: PlaceholderSite): boolean => {
        return site.isSaidTranslated;
      }),
    ).toBe(true);
    // Settings > Telegram's trail, crumb by crumb.
    expect(
      sitesIn(
        "App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/Index.tsx",
      )
        .filter((site: PlaceholderSite): boolean => {
          return site.handedTo === BREADCRUMB_TITLE;
        })
        .map((site: PlaceholderSite) => {
          return [site.isLookedUp, site.isSaidTranslated];
        }),
    ).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
    // A trail written as a constant, typed Array<Link>, is read too.
    expect(
      sitesIn(
        "App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Support.tsx",
      ).filter((site: PlaceholderSite): boolean => {
        return site.handedTo === BREADCRUMB_TITLE && site.isSaidTranslated;
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  test("finds the status pages' keyed crumbs, every one said to be translated", () => {
    const keyed: Array<PlaceholderSite> = crumbsIn(STATUS_PAGE);

    expect(keyed.length).toBeGreaterThanOrEqual(27);
    expect(
      keyed.every((site: PlaceholderSite): boolean => {
        return site.isLookedUp && site.isSaidTranslated;
      }),
    ).toBe(true);
  });

  test("finds the products menu's descriptions and categories: the Dashboard's said translated, the Admin Dashboard's English", () => {
    for (const prop of ["description", "category"]) {
      const dashboard: Array<PlaceholderSite> = sitesIn(DASHBOARD_NAV).filter(
        (site: PlaceholderSite): boolean => {
          return site.handedTo === `a MoreMenuItem's ${prop}`;
        },
      );
      const admin: Array<PlaceholderSite> = sitesIn(ADMIN_NAV).filter(
        (site: PlaceholderSite): boolean => {
          return site.handedTo === `a MoreMenuItem's ${prop}`;
        },
      );

      expect(dashboard.length).toBeGreaterThanOrEqual(47);
      expect(
        dashboard.every((site: PlaceholderSite): boolean => {
          return site.isLookedUp && site.isSaidTranslated;
        }),
      ).toBe(true);
      // Users, Projects, Feedback ... under Management, Monitoring ...
      expect(admin.length).toBeGreaterThanOrEqual(7);
      expect(
        admin.every((site: PlaceholderSite): boolean => {
          return !site.isLookedUp && !site.isSaidTranslated;
        }),
      ).toBe(true);
    }
  });
});

/*
 * The crumb rules, on a page written for them: a trail written in the
 * element, one through a constant, one a page inside hands up, a record's
 * name, and an array that is no trail. And a menu whose items' type offers
 * isDescriptionTranslated and isCategoryTranslated.
 */
describe("the guard's rules, for a page's crumbs and a menu item's description and category (#8075)", () => {
  let packages: string;
  let fixture: PlaceholderScanResult;

  const COMPONENTS: string = path.join("Common", "UI", "Components");

  const PAGE: string = path.join(
    "App",
    "FeatureSet",
    "AdminDashboard",
    "src",
    "Pages",
    "Crumbs.tsx",
  );

  // Each text on a line of its own.
  const PAGE_LINES: Array<string> = [
    'import React from "react";',
    'import Page, { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";',
    'import Menu, { MenuItem } from "Common/UI/Components/Menu/Menu";',
    'import Link from "Common/Types/Link";',
    "const Crumbs = (props) => {",
    "  const { t } = useTranslation();",
    '  const toolsCategory: string = t("navbar.categories.tools");',
    "  const breadcrumbLinks: Array<Link> = [",
    '    { title: t("breadcrumbs.projects"), to: home },',
    '    { title: t("breadcrumbs.project"), isTitleTranslated: true, to: home },',
    "  ];",
    "  const trail: Array<Link> = [",
    '    { title: translator.translateText("Hunts"), to: home },',
    "  ];",
    "  const notATrail = [",
    '    { title: t("pages.notACrumb") },',
    "  ];",
    "  usePageBreadcrumbLinks(props.isReady ? trail : null);",
    "  const items: Array<MenuItem> = [",
    '    { title: "Users", description: t("navbar.usersDescription"),',
    "      category: toolsCategory },",
    '    { title: "Teams", description: "Every team.", category: "Management" },',
    '    { title: "Logs", description: t("navbar.logsDescription"), isDescriptionTranslated: true,',
    "      category: toolsCategory, isCategoryTranslated: true },",
    '    { title: "Traces", description: "Every trace.", isDescriptionTranslated: true, category: "Tools" },',
    "  ];",
    "  return (",
    "    <Page",
    '      title="Crumbs"',
    "      breadcrumbLinks={[",
    '        { title: t("breadcrumbs.adminDashboard"), to: home },',
    '        { title: t("breadcrumbs.settings"), isTitleTranslated: true, to: home },',
    '        { title: "Settings", to: home },',
    '        { title: "Global Probes", isTitleTranslated: true, to: home },',
    "        { title: props.projectName, isRecordName: true, to: home },",
    "      ]}",
    "    >",
    '      <Page title="Inner" breadcrumbLinks={breadcrumbLinks}>',
    "        <Menu items={items} />",
    "      </Page>",
    "    </Page>",
    "  );",
    "};",
    "export default Crumbs;",
  ];

  const at: (code: string) => string = (code: string): string => {
    return placeOf(PAGE, PAGE_LINES, code);
  };

  beforeAll(() => {
    packages = fs.mkdtempSync(path.join(os.tmpdir(), "crumb-lookup-scan-"));

    writeFixture(packages, path.join(COMPONENTS, "Menu", "Menu.tsx"), [
      'import React from "react";',
      "export interface MenuItem {",
      "  title: string;",
      "  description: string;",
      "  isDescriptionTranslated?: boolean;",
      "  category?: string;",
      "  isCategoryTranslated?: boolean;",
      "}",
      "const Menu = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return (",
      "    <ul>",
      "      {props.items.map((item) => {",
      "        return <li>{translateString(item.description)}</li>;",
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

  test("reads every crumb of a trail, and nothing that is no trail or a record's name", () => {
    const crumbs: Array<string> = fixture.sites
      .filter((site: PlaceholderSite): boolean => {
        return site.handedTo === BREADCRUMB_TITLE;
      })
      .map((site: PlaceholderSite): string => {
        return site.where;
      });

    expect(crumbs).toEqual([
      at('"breadcrumbs.projects"'),
      at('"breadcrumbs.project"'),
      at('translateText("Hunts")'),
      at('"breadcrumbs.adminDashboard"'),
      at('"breadcrumbs.settings"'),
      at('{ title: "Settings", to: home }'),
      at('"Global Probes"'),
    ]);
    expect(crumbs).not.toContain(at('"pages.notACrumb"'));
    expect(crumbs).not.toContain(at("props.projectName"));
  });

  test("fails on each crumb looked up twice or English said to be translated, and on each such menu word", () => {
    expect(
      fixture.problems.map((problem: PlaceholderProblem) => {
        return [problem.where, problem.handedTo, problem.code, problem.message];
      }),
    ).toEqual([
      // Through a constant handed to the page.
      [
        at('"breadcrumbs.projects"'),
        BREADCRUMB_TITLE,
        't("breadcrumbs.projects")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      // Through a constant a page inside hands up.
      [
        at('translateText("Hunts")'),
        BREADCRUMB_TITLE,
        'translator.translateText("Hunts")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"navbar.usersDescription"'),
        "a MenuItem's description",
        't("navbar.usersDescription")',
        `${LOOKED_UP_TWICE_MESSAGE}isDescriptionTranslated`,
      ],
      // A constant the page built with a lookup.
      [
        at("      category: toolsCategory },"),
        "a MenuItem's category",
        "toolsCategory",
        `${LOOKED_UP_TWICE_MESSAGE}isCategoryTranslated`,
      ],
      [
        at('"Every trace."'),
        "a MenuItem's description",
        '"Every trace."',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isDescriptionTranslated`,
      ],
      // In the element.
      [
        at('"breadcrumbs.adminDashboard"'),
        BREADCRUMB_TITLE,
        't("breadcrumbs.adminDashboard")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"Global Probes"'),
        BREADCRUMB_TITLE,
        '"Global Probes"',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isTitleTranslated`,
      ],
    ]);
  });
});

describe("the controls that look up a page's heading, a side menu's titles, a tooltip and a metric card's title (#8224, #8225, #8226, #8355)", () => {
  test.each([
    ["Common/UI/Components/Page/Page.tsx", "Page", "title"],
    // Through the Page it draws, its props handed on whole.
    ["Common/UI/Components/Page/ModelPage.tsx", "ModelPage", "title"],
    [
      "App/FeatureSet/StatusPage/src/Components/Page/Page.tsx",
      "StatusPagePage",
      "title",
    ],
    [
      "Common/UI/Components/SideMenu/SideMenuSection.tsx",
      "SideMenuSection",
      "title",
    ],
    ["Common/UI/Components/SideMenu/SideMenuItem.tsx", "SideMenuItem", "link"],
    [
      "Common/UI/Components/SideMenu/SideMenuItem.tsx",
      "SideMenuItem",
      "subItemLink",
    ],
    // Through the SideMenuItem it draws.
    [
      "Common/UI/Components/SideMenu/CountModelSideMenuItem.tsx",
      "CountModelSideMenuItem",
      "link",
    ],
    ["Common/UI/Components/Tooltip/Tooltip.tsx", "Tooltip", "text"],
    [
      "App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard.tsx",
      "EmbeddedMetricCard",
      "title",
    ],
  ])(
    "%s's %s looks up its %s",
    (file: string, component: string, prop: string) => {
      expect(checkout.isLookedUpBy(file, component, prop)).toBe(true);
    },
  );
});

describe("every page heading, side menu title, tooltip and metric card title written for such a control", () => {
  const ADMIN: string = "App/FeatureSet/AdminDashboard/";
  const STATUS_PAGE: string = "App/FeatureSet/StatusPage/";
  const ENTERPRISE: string = "../ee/";
  const HEADINGS: Array<string> = ["<Page title>", "<ModelPage title>"];

  const handedIn: (
    prefix: string,
    handedTo: Array<string>,
  ) => Array<PlaceholderSite> = (
    prefix: string,
    handedTo: Array<string>,
  ): Array<PlaceholderSite> => {
    return checkout.sites.filter((site: PlaceholderSite): boolean => {
      return site.where.startsWith(prefix) && handedTo.includes(site.handedTo);
    });
  };

  // Each site, by its place and how it is written.
  const states: (
    sites: Array<PlaceholderSite>,
  ) => Array<[string, boolean, boolean]> = (
    sites: Array<PlaceholderSite>,
  ): Array<[string, boolean, boolean]> => {
    return sites.map((site: PlaceholderSite): [string, boolean, boolean] => {
      return [site.where, site.isLookedUp, site.isSaidTranslated];
    });
  };

  const allLookedUpAndSaid: (
    sites: Array<PlaceholderSite>,
  ) => Array<[string, boolean, boolean]> = (
    sites: Array<PlaceholderSite>,
  ): Array<[string, boolean, boolean]> => {
    return sites.map((site: PlaceholderSite): [string, boolean, boolean] => {
      return [site.where, true, true];
    });
  };

  test("finds the Admin Dashboard's 40 keyed headings, every one said to be translated", () => {
    const keyed: Array<PlaceholderSite> = handedIn(ADMIN, HEADINGS).filter(
      (site: PlaceholderSite): boolean => {
        return site.isLookedUp;
      },
    );

    expect(keyed.length).toBeGreaterThanOrEqual(40);
    expect(states(keyed)).toEqual(allLookedUpAndSaid(keyed));

    // Settings > Probes' heading, and a user's page.
    expect(
      sitesIn(
        "App/FeatureSet/AdminDashboard/src/Pages/Settings/Probes/Index.tsx",
      )
        .filter((site: PlaceholderSite): boolean => {
          return site.handedTo === "<Page title>";
        })
        .map((site: PlaceholderSite) => {
          return [site.isLookedUp, site.isSaidTranslated];
        }),
    ).toEqual([[true, true]]);
    expect(
      sitesIn("App/FeatureSet/AdminDashboard/src/Pages/Users/View/Index.tsx")
        .filter((site: PlaceholderSite): boolean => {
          return site.handedTo === "<ModelPage title>";
        })
        .map((site: PlaceholderSite) => {
          return [site.isLookedUp, site.isSaidTranslated];
        }),
    ).toEqual([[true, true]]);
  });

  test("finds the status pages' 12 keyed headings, every one said to be translated", () => {
    const keyed: Array<PlaceholderSite> = handedIn(STATUS_PAGE, HEADINGS);

    expect(keyed.length).toBeGreaterThanOrEqual(12);
    expect(states(keyed)).toEqual(allLookedUpAndSaid(keyed));
  });

  test("reads the Enterprise pages beside the packages: their keyed headings, crumbs and menu entries, said translated", () => {
    if (!ENTERPRISE_PRESENT) {
      return;
    }

    const keyed: Array<PlaceholderSite> = [
      ...handedIn(ENTERPRISE, HEADINGS),
      ...handedIn(ENTERPRISE, [BREADCRUMB_TITLE]),
      ...handedIn(ENTERPRISE, [MENU_LINK_TITLE]),
    ].filter((site: PlaceholderSite): boolean => {
      return site.isLookedUp;
    });

    expect(handedIn(ENTERPRISE, HEADINGS).length).toBeGreaterThanOrEqual(8);
    expect(
      handedIn(ENTERPRISE, [BREADCRUMB_TITLE]).length,
    ).toBeGreaterThanOrEqual(19);
    expect(
      handedIn(ENTERPRISE, [MENU_LINK_TITLE]).length,
    ).toBeGreaterThanOrEqual(1);
    expect(states(keyed)).toEqual(allLookedUpAndSaid(keyed));
  });

  test("finds the Admin Dashboard's and the status page's keyed side menus, every title said to be translated", () => {
    const keyed: Array<PlaceholderSite> = [
      ...handedIn(ADMIN, [MENU_LINK_TITLE]),
      ...handedIn(ADMIN, ["<SideMenuSection title>"]),
    ].filter((site: PlaceholderSite): boolean => {
      return site.isLookedUp;
    });

    expect(
      handedIn(ADMIN, [MENU_LINK_TITLE]).filter(
        (site: PlaceholderSite): boolean => {
          return site.isLookedUp;
        },
      ).length,
    ).toBeGreaterThanOrEqual(27);
    expect(
      handedIn(ADMIN, ["<SideMenuSection title>"]).length,
      /*
       * Settings' six one-page sections are two since #9134. Since #9216
       * Send Email has no menu, so no Communication section, and a
       * project's Support entry is in its Advanced section.
       */
    ).toBeGreaterThanOrEqual(10);
    expect(states(keyed)).toEqual(allLookedUpAndSaid(keyed));

    /*
     * Settings' menu: its 15 entries (Push Notifications too, #9134, and Help
     * and Support, #10864). The Subscribe menu: its five.
     */
    expect(
      sitesIn(
        "App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu.tsx",
      ).filter((site: PlaceholderSite): boolean => {
        return site.handedTo === MENU_LINK_TITLE && site.isSaidTranslated;
      }).length,
    ).toBe(15);
    expect(
      sitesIn("App/FeatureSet/StatusPage/src/Pages/Subscribe/SideMenu.tsx").map(
        (site: PlaceholderSite) => {
          return [site.handedTo, site.isLookedUp, site.isSaidTranslated];
        },
      ),
    ).toEqual([
      [MENU_LINK_TITLE, true, true],
      [MENU_LINK_TITLE, true, true],
      [MENU_LINK_TITLE, true, true],
      [MENU_LINK_TITLE, true, true],
      [MENU_LINK_TITLE, true, true],
    ]);
  });

  test("finds every tooltip's text: a hundred, the 26 worded where they are written said translated, Button's own among them", () => {
    const tooltips: Array<PlaceholderSite> = checkout.sites.filter(
      (site: PlaceholderSite): boolean => {
        return site.handedTo === "<Tooltip text>";
      },
    );

    /*
     * The packages' own 97 (two more are now a Pill's tooltip, #9137), and
     * the Enterprise pages' three where ee/ is checked out.
     */
    expect(
      tooltips.filter((site: PlaceholderSite): boolean => {
        return !site.where.startsWith(ENTERPRISE);
      }).length,
    ).toBeGreaterThanOrEqual(97);

    if (ENTERPRISE_PRESENT) {
      expect(tooltips.length).toBeGreaterThanOrEqual(100);
    }
    expect(
      tooltips.filter((site: PlaceholderSite): boolean => {
        return site.isLookedUp && site.isSaidTranslated;
      }).length,
    ).toBeGreaterThanOrEqual(26);
    expect(
      sitesIn("Common/UI/Components/Button/Button.tsx")
        .filter((site: PlaceholderSite): boolean => {
          return site.handedTo === "<Tooltip text>";
        })
        .map((site: PlaceholderSite) => {
          return [site.isLookedUp, site.isSaidTranslated];
        }),
    ).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  test("finds the metric cards a page words: the Docker and Podman containers' titles, said translated", () => {
    for (const engine of ["Docker", "Podman"]) {
      expect(
        sitesIn(
          `App/FeatureSet/Dashboard/src/Pages/${engine}/View/ContainerDetail.tsx`,
        )
          .filter((site: PlaceholderSite): boolean => {
            return site.handedTo === "<EmbeddedMetricCard title>";
          })
          .map((site: PlaceholderSite) => {
            return [site.isLookedUp, site.isSaidTranslated];
          }),
      ).toEqual([[true, true]]);
    }

    // The resource pages' English section titles are read too.
    expect(
      checkout.sites.filter((site: PlaceholderSite): boolean => {
        return (
          site.handedTo === "<EmbeddedMetricCard title>" &&
          !site.isLookedUp &&
          !site.isSaidTranslated
        );
      }).length,
    ).toBeGreaterThanOrEqual(30);
  });
});

/*
 * The rules, on pages written for them: a Page that looks its title up
 * unless told it is translated, a ModelPage and a status page's Page that
 * hand their props on whole to it, a side menu item that looks its links
 * up, a menu's sections typed SideMenuSectionProps, a Tooltip, and an
 * Enterprise page beside the packages.
 */
describe("the guard's rules, for a page's heading, a side menu's titles and a tooltip (#8224, #8225, #8226)", () => {
  let root: string;
  let fixture: PlaceholderScanResult;

  const COMPONENTS: string = path.join("Common", "UI", "Components");

  const PAGE: string = path.join(
    "App",
    "FeatureSet",
    "AdminDashboard",
    "src",
    "Pages",
    "Headings.tsx",
  );

  // Beside the packages folder, read from it as ../ee.
  const ENTERPRISE_PAGE: string = path.join(
    "ee",
    "AdminDashboard",
    "Licence.tsx",
  );

  // Each text on a line of its own.
  const PAGE_LINES: Array<string> = [
    'import React from "react";',
    'import Page from "Common/UI/Components/Page/Page";',
    'import ModelPage from "Common/UI/Components/Page/ModelPage";',
    'import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";',
    'import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";',
    'import { SideMenuSectionProps } from "Common/UI/Components/SideMenu/SideMenu";',
    'import Tooltip from "Common/UI/Components/Tooltip/Tooltip";',
    'import Card from "Common/UI/Components/Card/Card";',
    'import StatusPagePage from "../../../StatusPage/src/Components/Page/Page";',
    "const Headings = (props) => {",
    "  const { t } = useTranslation();",
    "  const sections: Array<SideMenuSectionProps> = [",
    "    {",
    '      title: t("sideMenu.basic"),',
    "      items: [",
    '        { link: { title: t("sideMenu.users"), to: home } },',
    '        { link: { title: t("sideMenu.teams"), isTitleTranslated: true, to: home } },',
    '        { link: { title: "Probes", to: home } },',
    "      ],",
    "    },",
    '    { title: t("sideMenu.advanced"), isTitleTranslated: true, items: [] },',
    "  ];",
    "  const steps = [",
    '    { link: { title: t("steps.openMonitors"), route: home } },',
    "  ];",
    "  return (",
    "    <>",
    '      <Page title={t("pages.settings.title")}>',
    "        <div />",
    "      </Page>",
    '      <Page title={t("pages.users.title")} isTitleTranslated={true}>',
    "        <div />",
    "      </Page>",
    '      <Page title="Settings" isTitleTranslated={true}>',
    "        <div />",
    "      </Page>",
    '      <Page title="Projects">',
    "        <div />",
    "      </Page>",
    '      <ModelPage title={t("pages.userView.title")}>',
    "        <div />",
    "      </ModelPage>",
    '      <ModelPage title={t("pages.projectView.title")} isTitleTranslated={true}>',
    "        <div />",
    "      </ModelPage>",
    '      <StatusPagePage title={t("incidents.title")}>',
    "        <div />",
    "      </StatusPagePage>",
    '      <SideMenuSection title={t("sideMenu.billing")}>',
    "        <SideMenuItem",
    '          link={{ title: t("sideMenu.overview"), to: home }}',
    "        />",
    "        <SideMenuItem",
    '          link={{ title: t("sideMenu.sso"), isTitleTranslated: true, to: home }}',
    '          subItemLink={{ title: t("sideMenu.ssoProviders"), to: home }}',
    "        />",
    "        <SideMenuItem",
    "          link={{ title: props.userEmail, isRecordName: true, to: home }}",
    "        />",
    "        <SideMenuItem",
    '          link={{ title: "Overview", to: home }}',
    "        />",
    "        <SideMenuItem",
    '          link={{ title: "Delete", isTitleTranslated: true, to: home }}',
    "        />",
    "      </SideMenuSection>",
    '      <SideMenuSection title={t("sideMenu.members")} isTitleTranslated={true}>',
    '        <Card link={{ title: t("card.notAMenuLink") }} />',
    "      </SideMenuSection>",
    '      <Tooltip text={t("tooltips.copy")}>',
    "        <span />",
    "      </Tooltip>",
    '      <Tooltip text={t("tooltips.paste")} isTextTranslated={true}>',
    "        <span />",
    "      </Tooltip>",
    '      <Tooltip text="Copy">',
    "        <span />",
    "      </Tooltip>",
    "    </>",
    "  );",
    "};",
    "export default Headings;",
  ];

  const ENTERPRISE_LINES: Array<string> = [
    'import React from "react";',
    'import Page from "Common/UI/Components/Page/Page";',
    "const Licence = () => {",
    "  const { t } = useTranslation();",
    "  return (",
    '    <Page title={t("pages.settings.title")}',
    "      breadcrumbLinks={[",
    '        { title: t("breadcrumbs.settings"), to: home },',
    "      ]}",
    "    >",
    "      <div />",
    "    </Page>",
    "  );",
    "};",
    "export default Licence;",
  ];

  const at: (code: string) => string = (code: string): string => {
    return placeOf(PAGE, PAGE_LINES, code);
  };

  const inEnterprise: (code: string) => string = (code: string): string => {
    return placeOf(path.join("..", ENTERPRISE_PAGE), ENTERPRISE_LINES, code);
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "heading-lookup-scan-"));

    const packages: string = path.join(root, "packages");

    writeFixture(packages, path.join("Common", "Types", "Link.ts"), [
      "export default interface Link {",
      "  title: string;",
      "  isTitleTranslated?: boolean | undefined;",
      "  isRecordName?: boolean | undefined;",
      "}",
    ]);

    writeFixture(packages, path.join(COMPONENTS, "Page", "Page.tsx"), [
      'import React from "react";',
      "const Page = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  const title = props.isTitleTranslated",
      "    ? props.title",
      "    : translateString(props.title);",
      "  return <h1>{title}</h1>;",
      "};",
      "export default Page;",
    ]);

    writeFixture(packages, path.join(COMPONENTS, "Page", "ModelPage.tsx"), [
      'import React from "react";',
      'import Page from "./Page";',
      "const ModelPage = (props) => {",
      '  return <Page {...props} className="record" />;',
      "};",
      "export default ModelPage;",
    ]);

    writeFixture(
      packages,
      path.join(
        "App",
        "FeatureSet",
        "StatusPage",
        "src",
        "Components",
        "Page",
        "Page.tsx",
      ),
      [
        'import React from "react";',
        'import Page from "Common/UI/Components/Page/Page";',
        "const StatusPagePage = (props) => {",
        '  return <Page {...props} className="w-full" />;',
        "};",
        "export default StatusPagePage;",
      ],
    );

    writeFixture(
      packages,
      path.join(COMPONENTS, "SideMenu", "SideMenuSection.tsx"),
      [
        'import React from "react";',
        "const SideMenuSection = (props) => {",
        "  const { translateString } = useTranslateValue();",
        "  return (",
        "    <h6>",
        "      {props.isTitleTranslated ? props.title : translateString(props.title)}",
        "    </h6>",
        "  );",
        "};",
        "export default SideMenuSection;",
      ],
    );

    writeFixture(
      packages,
      path.join(COMPONENTS, "SideMenu", "SideMenuItem.tsx"),
      [
        'import React from "react";',
        'import Link from "../../../Types/Link";',
        "const SideMenuItem = (props) => {",
        "  const { translateString } = useTranslateValue();",
        "  return (",
        "    <a>",
        "      {getCrumbTitle(props.link, translateString)}",
        "      {props.subItemLink ? getCrumbTitle(props.subItemLink, translateString) : null}",
        "    </a>",
        "  );",
        "};",
        "export default SideMenuItem;",
      ],
    );

    writeFixture(packages, path.join(COMPONENTS, "SideMenu", "SideMenu.tsx"), [
      'import React from "react";',
      'import Link from "../../../Types/Link";',
      "export interface SideMenuItemProps {",
      "  link: Link;",
      "  subItemLink?: Link | undefined;",
      "}",
      "export interface SideMenuSectionProps {",
      "  title: string;",
      "  isTitleTranslated?: boolean | undefined;",
      "  items: Array<SideMenuItemProps>;",
      "}",
    ]);

    writeFixture(packages, path.join(COMPONENTS, "Tooltip", "Tooltip.tsx"), [
      'import React from "react";',
      "const Tooltip = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return (",
      "    <span>",
      "      {props.isTextTranslated ? props.text : translateString(props.text)}",
      "    </span>",
      "  );",
      "};",
      "export default Tooltip;",
    ]);

    // Draws a link of its own as given: no menu.
    writeFixture(packages, path.join(COMPONENTS, "Card", "Card.tsx"), [
      'import React from "react";',
      "const Card = (props) => {",
      "  return <a>{props.link.title}</a>;",
      "};",
      "export default Card;",
    ]);

    writeFixture(packages, PAGE, PAGE_LINES);
    writeFixture(root, ENTERPRISE_PAGE, ENTERPRISE_LINES);

    fixture = scanPlaceholders(packages);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const where: (handedTo: string) => Array<string> = (
    handedTo: string,
  ): Array<string> => {
    return fixture.sites
      .filter((site: PlaceholderSite): boolean => {
        return site.handedTo === handedTo;
      })
      .map((site: PlaceholderSite): string => {
        return site.where;
      });
  };

  test("holds a heading through the components that hand it on whole, and an Enterprise page's, read from beside the packages", () => {
    expect(where("<Page title>")).toEqual([
      inEnterprise('"pages.settings.title"'),
      at('"pages.settings.title"'),
      at('"pages.users.title"'),
      at('<Page title="Settings"'),
      at('<Page title="Projects">'),
    ]);
    expect(where("<ModelPage title>")).toEqual([
      at('"pages.userView.title"'),
      at('"pages.projectView.title"'),
    ]);
    expect(where("<StatusPagePage title>")).toEqual([at('"incidents.title"')]);
    expect(where("<SideMenuSection title>")).toEqual([
      at('"sideMenu.billing"'),
      at('"sideMenu.members"'),
    ]);
    expect(where("<Tooltip text>")).toEqual([
      at('"tooltips.copy"'),
      at('"tooltips.paste"'),
      at('<Tooltip text="Copy">'),
    ]);
  });

  test("holds a menu link written for an item that looks it up, or through its entry's type, and no other link", () => {
    expect(where(MENU_LINK_TITLE)).toEqual([
      at('"sideMenu.users"'),
      at('"sideMenu.teams"'),
      at('{ link: { title: "Probes", to: home } },'),
      at('"sideMenu.overview"'),
      at('"sideMenu.sso"'),
      at('"sideMenu.ssoProviders"'),
      at('link={{ title: "Overview", to: home }}'),
      at('"Delete"'),
    ]);
    // A record's name; a link no menu draws (a step's, a card's).
    expect(where(MENU_LINK_TITLE)).not.toContain(at("props.userEmail"));
    expect(where(MENU_LINK_TITLE)).not.toContain(at('"steps.openMonitors"'));
    expect(where(MENU_LINK_TITLE)).not.toContain(at('"card.notAMenuLink"'));
    // A menu's sections, by the type they are written as.
    expect(where("a SideMenuSectionProps's title")).toEqual([
      at('"sideMenu.basic"'),
      at('"sideMenu.advanced"'),
    ]);
  });

  test("fails on each heading, menu title and tooltip looked up twice or English said to be translated, and on nothing else", () => {
    expect(
      fixture.problems.map((problem: PlaceholderProblem) => {
        return [problem.where, problem.handedTo, problem.code, problem.message];
      }),
    ).toEqual([
      [
        inEnterprise('"pages.settings.title"'),
        "<Page title>",
        '{t("pages.settings.title")}',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        inEnterprise('"breadcrumbs.settings"'),
        BREADCRUMB_TITLE,
        't("breadcrumbs.settings")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      // A menu's sections and their links, by their types.
      [
        at('"sideMenu.basic"'),
        "a SideMenuSectionProps's title",
        't("sideMenu.basic")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"sideMenu.users"'),
        MENU_LINK_TITLE,
        't("sideMenu.users")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"pages.settings.title"'),
        "<Page title>",
        '{t("pages.settings.title")}',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('<Page title="Settings"'),
        "<Page title>",
        '"Settings"',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isTitleTranslated`,
      ],
      // Through the Page it hands its props on to.
      [
        at('"pages.userView.title"'),
        "<ModelPage title>",
        '{t("pages.userView.title")}',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"incidents.title"'),
        "<StatusPagePage title>",
        '{t("incidents.title")}',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"sideMenu.billing"'),
        "<SideMenuSection title>",
        '{t("sideMenu.billing")}',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"sideMenu.overview"'),
        MENU_LINK_TITLE,
        't("sideMenu.overview")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      // The sub-item's link is its own: the item's flag says nothing of it.
      [
        at('"sideMenu.ssoProviders"'),
        MENU_LINK_TITLE,
        't("sideMenu.ssoProviders")',
        `${LOOKED_UP_TWICE_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"Delete"'),
        MENU_LINK_TITLE,
        '"Delete"',
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isTitleTranslated`,
      ],
      [
        at('"tooltips.copy"'),
        "<Tooltip text>",
        '{t("tooltips.copy")}',
        `${LOOKED_UP_TWICE_MESSAGE}isTextTranslated`,
      ],
    ]);
  });
});

describe("the components that hand a tooltip on, and their callers (#8423)", () => {
  test.each([
    [
      "Common/UI/Components/ColorSquareCube/ColorSquareCube.tsx",
      "ColorSquareCube",
      "tooltip",
    ],
    [
      "Common/UI/Components/ColorCircle/ColorCircle.tsx",
      "ColorCircle",
      "tooltip",
    ],
    [
      "Common/UI/Components/HeaderAlert/HeaderAlert.tsx",
      "HeaderAlert",
      "tooltip",
    ],
    // Through the HeaderAlert it draws.
    [
      "Common/UI/Components/HeaderAlert/HeaderModelAlert.tsx",
      "HeaderModelAlert",
      "tooltip",
    ],
    ["Common/UI/Components/Toggle/Toggle.tsx", "Toggle", "tooltip"],
    [
      "App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi.tsx",
      "ReplayToolButton",
      "label",
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi.tsx",
      "ReplayToolButton",
      "title",
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi.tsx",
      "ReplayToolButton",
      "tooltip",
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsTable.tsx",
      "StateSettingsNameCell",
      "builtInTooltip",
    ],
    // The components the guard found handing one on, each with its flag now.
    [
      "App/FeatureSet/Dashboard/src/Components/ProjectProducts/ProductSwitchRow.tsx",
      "ProductSwitchRow",
      "lockedReason",
    ],
    [
      "Common/UI/Components/RoleLabel/RoleLabel.tsx",
      "RoleLabel",
      "description",
    ],
    [
      "App/FeatureSet/AdminDashboard/src/Pages/Health/HealthPage.tsx",
      "HealthPage",
      "title",
    ],
  ])(
    "%s's %s looks up its %s",
    (file: string, component: string, prop: string) => {
      expect(checkout.isLookedUpBy(file, component, prop)).toBe(true);
    },
  );

  // A caller's sites for one control's prop, by how each is written.
  const statesIn: (
    file: string,
    handedTo: string,
  ) => Array<[boolean, boolean]> = (
    file: string,
    handedTo: string,
  ): Array<[boolean, boolean]> => {
    return sitesIn(file)
      .filter((site: PlaceholderSite): boolean => {
        return site.handedTo === handedTo;
      })
      .map((site: PlaceholderSite): [boolean, boolean] => {
        return [site.isLookedUp, site.isSaidTranslated];
      });
  };

  test("holds the pages that word a colour's tooltip, every one said to be translated", () => {
    for (const file of [
      "App/FeatureSet/Dashboard/src/Components/Service/ServiceElement.tsx",
      "App/FeatureSet/Dashboard/src/Components/TelemetryService/TelemetryServiceElement.tsx",
    ]) {
      expect(statesIn(file, "<ColorSquareCube tooltip>")).toEqual([
        [true, true],
      ]);
    }
    expect(
      statesIn(
        "App/FeatureSet/Dashboard/src/Components/Span/SpanStatusElement.tsx",
        "<ColorCircle tooltip>",
      ),
    ).toEqual([[true, true]]);
    // A service's name, as written: no lookup, nothing to say.
    expect(
      statesIn(
        "App/FeatureSet/Dashboard/src/Components/Metrics/MetricsDashboard.tsx",
        "<ColorSquareCube tooltip>",
      ),
    ).toEqual([[false, false]]);
  });

  test("holds the switches whose tooltip is worded, every one said to be translated", () => {
    expect(
      statesIn(
        "Common/UI/Components/ModelSwitch/ModelSwitchRow.tsx",
        "<Toggle tooltip>",
      ),
    ).toEqual([[true, true]]);
    expect(
      statesIn(
        "App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTelemetrySourcesCard.tsx",
        "<Toggle tooltip>",
      ),
    ).toEqual([[true, true]]);
    // An English sentence, looked up by the switch alone.
    expect(
      statesIn(
        "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance.tsx",
        "<Toggle tooltip>",
      ),
    ).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  test("holds the replay toolbar's worded labels, every one said to be translated", () => {
    const labels: Array<PlaceholderSite> = checkout.sites.filter(
      (site: PlaceholderSite): boolean => {
        return site.handedTo === "<ReplayToolButton label>" && site.isLookedUp;
      },
    );

    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(
      labels.map((site: PlaceholderSite): [string, boolean] => {
        return [site.where, site.isSaidTranslated];
      }),
    ).toEqual(
      labels.map((site: PlaceholderSite): [string, boolean] => {
        return [site.where, true];
      }),
    );
    // The seek buttons' "10s", worded in the reader's units; the rest English.
    expect(
      statesIn(
        "App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayControls.tsx",
        "<ReplayToolButton label>",
      ).filter(([isLookedUp]: [boolean, boolean]): boolean => {
        return isLookedUp;
      }),
    ).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  test("finds no component that hands a prop on to a looked-up text without offering its flag", () => {
    expect(
      checkout.problems.filter((problem: PlaceholderProblem): boolean => {
        return problem.message.startsWith(UNFLAGGED_HAND_ON_MESSAGE);
      }),
    ).toEqual([]);
  });
});

/*
 * The rule that holds a component to its own prop (#8423): one that hands
 * its tooltip on, as it is, to a text its control looks up unless told it
 * is translated offers that flag and hands it on - otherwise its callers
 * cannot say a worded tooltip is translated, and nothing can see them.
 */
describe("the guard's rules, for a prop a component hands on (#8423)", () => {
  let root: string;
  let fixture: PlaceholderScanResult;

  const COMPONENTS: string = path.join("Common", "UI", "Components");
  const HINTS: string = path.join(COMPONENTS, "Hints", "Hints.tsx");
  const BANNER: string = path.join(COMPONENTS, "Banner", "Banner.tsx");
  const SWATCH: string = path.join(COMPONENTS, "Swatch", "Swatch.tsx");
  const PAGE: string = path.join(
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "Colours.tsx",
  );

  // Each component on a line of its own.
  const HINTS_LINES: Array<string> = [
    'import React from "react";',
    'import Tooltip from "../Tooltip/Tooltip";',
    'import Card from "../Card/Card";',
    // A prop taken out of the props, by its name or another.
    "export const Destructured = ({ hint }) => <Tooltip text={hint}><span /></Tooltip>;",
    "export const Renamed = ({ hint: shownHint }) => <Tooltip text={shownHint}><span /></Tooltip>;",
    // Taken out in the body, then a constant that is it.
    "export const Aliased = (props) => { const { note } = props; const shown = note || ''; return <Tooltip text={shown}><span /></Tooltip>; };",
    // Either branch of a ?:, never what it asks.
    "export const Either = (props) => <Tooltip text={props.isLocked ? props.reason : props.fallback}><span /></Tooltip>;",
    // The right of an &&.
    "export const OnlyWhen = (props) => <Tooltip text={props.isShown && props.why}><span /></Tooltip>;",
    // Said by the element: words someone wrote, or the reader's.
    "export const Written = (props) => <Tooltip text={props.name} isTextUserContent={true}><span /></Tooltip>;",
    "export const SaidTrue = (props) => <Tooltip text={props.because} isTextTranslated={true}><span /></Tooltip>;",
    // Said false is no saying: the tooltip looks it up.
    "export const SaidFalse = (props) => <Tooltip text={props.label} isTextTranslated={false}><span /></Tooltip>;",
    // A value made from a prop is no prop handed on.
    "export const Built = (props) => <Tooltip text={`${props.serviceName} Service`}><span /></Tooltip>;",
    // Looked up here: the looked-up-twice rule's.
    "export const LooksUp = (props) => { const { translateString } = useTranslateValue(); return <Tooltip text={translateString(props.word)}><span /></Tooltip>; };",
    // A placeholder of its own is held through the component already.
    "export const OwnPlaceholder = (props) => <Tooltip text={props.placeholder}><span /></Tooltip>;",
    // To a control that offers no flag, or to an element.
    "export const ToCard = (props) => <Card title={props.title} />;",
    "export const ToElement = (props) => <span title={props.title} />;",
    // Its props handed on whole: the flag goes with them.
    "export const Spread = (props) => <Tooltip {...props}><span /></Tooltip>;",
    // A constant of its own is no prop.
    "export const Constant = () => { const tip = 'Copy'; return <Tooltip text={tip}><span /></Tooltip>; };",
  ];

  // A colour square as main drew it: its tooltip handed on, no flag.
  const SWATCH_LINES: Array<string> = [
    'import React from "react";',
    'import Tooltip from "../Tooltip/Tooltip";',
    "const Swatch = (props) => {",
    "  return (",
    "    <Tooltip text={props.tooltip}>",
    '      <div className="h-3 w-3" />',
    "    </Tooltip>",
    "  );",
    "};",
    "export default Swatch;",
  ];

  // Hands its tooltip on to a component that offers the flag, without it.
  const BANNER_LINES: Array<string> = [
    'import React from "react";',
    'import Dot from "../Dot/Dot";',
    "const Banner = (props) => {",
    "  return <Dot tooltip={props.tooltip} />;",
    "};",
    "export default Banner;",
  ];

  const PAGE_LINES: Array<string> = [
    'import React from "react";',
    'import Dot from "Common/UI/Components/Dot/Dot";',
    'import Swatch from "Common/UI/Components/Swatch/Swatch";',
    'import Banner from "Common/UI/Components/Banner/Banner";',
    'import FlaggedBanner from "Common/UI/Components/FlaggedBanner/FlaggedBanner";',
    "const Colours = () => {",
    "  const { t } = useTranslation();",
    "  return (",
    "    <>",
    '      <Dot tooltip={t("dot.unflagged")} />',
    '      <Dot tooltip={t("dot.flagged")} isTooltipTranslated={true} />',
    '      <Dot tooltip="Red" isTooltipTranslated={true} />',
    '      <Dot tooltip="Green" />',
    '      <Swatch tooltip={t("swatch.unseen")} />',
    '      <FlaggedBanner tooltip={t("banner.unflagged")} />',
    '      <FlaggedBanner tooltip={t("banner.flagged")} isTooltipTranslated={true} />',
    '      <Banner tooltip={t("banner.unseen")} />',
    "    </>",
    "  );",
    "};",
    "export default Colours;",
  ];

  const at: (file: string, lines: Array<string>, code: string) => string = (
    file: string,
    lines: Array<string>,
    code: string,
  ): string => {
    return placeOf(file, lines, code);
  };

  const inHints: (code: string) => string = (code: string): string => {
    return at(HINTS, HINTS_LINES, code);
  };

  const onPage: (code: string) => string = (code: string): string => {
    return at(PAGE, PAGE_LINES, code);
  };

  const handOn: (own: string, as: string) => string = (
    own: string,
    as: string,
  ): string => {
    return `${UNFLAGGED_HAND_ON_MESSAGE}${translatedFlagOf(own)} for ${own}, and hand it on as ${translatedFlagOf(as)}`;
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hand-on-lookup-scan-"));

    const packages: string = path.join(root, "packages");

    writeFixture(packages, path.join(COMPONENTS, "Tooltip", "Tooltip.tsx"), [
      'import React from "react";',
      "const Tooltip = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return (",
      "    <span>",
      "      {props.isTextTranslated || props.isTextUserContent ? props.text : translateString(props.text)}",
      "    </span>",
      "  );",
      "};",
      "export default Tooltip;",
    ]);

    // Looks its title up, and offers no flag for it.
    writeFixture(packages, path.join(COMPONENTS, "Card", "Card.tsx"), [
      'import React from "react";',
      "const Card = (props) => {",
      "  const { translateString } = useTranslateValue();",
      "  return <h2>{translateString(props.title)}</h2>;",
      "};",
      "export default Card;",
    ]);

    // Offers the flag, and hands it on: its callers are held through it.
    writeFixture(packages, path.join(COMPONENTS, "Dot", "Dot.tsx"), [
      'import React from "react";',
      'import Tooltip from "../Tooltip/Tooltip";',
      "const Dot = (props) => {",
      "  return (",
      "    <Tooltip text={props.tooltip} isTextTranslated={props.isTooltipTranslated}>",
      '      <div role="img" />',
      "    </Tooltip>",
      "  );",
      "};",
      "export default Dot;",
    ]);

    writeFixture(
      packages,
      path.join(COMPONENTS, "FlaggedBanner", "FlaggedBanner.tsx"),
      [
        'import React from "react";',
        'import Dot from "../Dot/Dot";',
        "const FlaggedBanner = (props) => {",
        "  return (",
        "    <Dot tooltip={props.tooltip} isTooltipTranslated={props.isTooltipTranslated} />",
        "  );",
        "};",
        "export default FlaggedBanner;",
      ],
    );

    writeFixture(packages, SWATCH, SWATCH_LINES);
    writeFixture(packages, BANNER, BANNER_LINES);
    writeFixture(packages, HINTS, HINTS_LINES);
    writeFixture(packages, PAGE, PAGE_LINES);

    fixture = scanPlaceholders(packages);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("fails on each prop handed on without its flag, naming the flag to offer, and on nothing else", () => {
    expect(
      fixture.problems
        .filter((problem: PlaceholderProblem): boolean => {
          return problem.message.startsWith(UNFLAGGED_HAND_ON_MESSAGE);
        })
        .map((problem: PlaceholderProblem) => {
          return [
            problem.where,
            problem.handedTo,
            problem.code,
            problem.message,
          ];
        }),
    ).toEqual([
      // Through a component that offers the flag, and hands it to Tooltip.
      [
        at(BANNER, BANNER_LINES, "<Dot tooltip={props.tooltip} />"),
        "<Dot tooltip>",
        "{props.tooltip}",
        handOn("tooltip", "tooltip"),
      ],
      [
        inHints("export const Destructured"),
        "<Tooltip text>",
        "{hint}",
        handOn("hint", "text"),
      ],
      // By the prop's own name, whatever the code calls it.
      [
        inHints("export const Renamed"),
        "<Tooltip text>",
        "{shownHint}",
        handOn("hint", "text"),
      ],
      [
        inHints("export const Aliased"),
        "<Tooltip text>",
        "{shown}",
        handOn("note", "text"),
      ],
      [
        inHints("export const Either"),
        "<Tooltip text>",
        "{props.isLocked ? props.reason : props.fallback}",
        handOn("reason", "text"),
      ],
      [
        inHints("export const Either"),
        "<Tooltip text>",
        "{props.isLocked ? props.reason : props.fallback}",
        handOn("fallback", "text"),
      ],
      [
        inHints("export const OnlyWhen"),
        "<Tooltip text>",
        "{props.isShown && props.why}",
        handOn("why", "text"),
      ],
      [
        inHints("export const SaidFalse"),
        "<Tooltip text>",
        "{props.label}",
        handOn("label", "text"),
      ],
      // A file that looks nothing up and names no flag is read too.
      [
        at(SWATCH, SWATCH_LINES, "<Tooltip text={props.tooltip}>"),
        "<Tooltip text>",
        "{props.tooltip}",
        handOn("tooltip", "text"),
      ],
    ]);
  });

  test("holds the callers of a component that offers the flag, through every component that hands it on, and no caller of one that does not", () => {
    expect(
      fixture.problems
        .filter((problem: PlaceholderProblem): boolean => {
          return !problem.message.startsWith(UNFLAGGED_HAND_ON_MESSAGE);
        })
        .map((problem: PlaceholderProblem) => {
          return [problem.where, problem.handedTo, problem.message];
        }),
    ).toEqual([
      [
        onPage('"dot.unflagged"'),
        "<Dot tooltip>",
        `${LOOKED_UP_TWICE_MESSAGE}isTooltipTranslated`,
      ],
      [
        onPage('tooltip="Red"'),
        "<Dot tooltip>",
        `${ENGLISH_SAID_TRANSLATED_MESSAGE}isTooltipTranslated`,
      ],
      [
        onPage('"banner.unflagged"'),
        "<FlaggedBanner tooltip>",
        `${LOOKED_UP_TWICE_MESSAGE}isTooltipTranslated`,
      ],
      // Looked up where it is handed to Tooltip: the looked-up-twice rule's.
      [
        inHints("export const LooksUp"),
        "<Tooltip text>",
        `${LOOKED_UP_TWICE_MESSAGE}isTextTranslated`,
      ],
    ]);

    // The components with no flag hide their callers: no site at all.
    const pageSites: Array<string> = fixture.sites
      .filter((site: PlaceholderSite): boolean => {
        return site.where.startsWith(`${PAGE}:`);
      })
      .map((site: PlaceholderSite): string => {
        return `${site.where} ${site.handedTo}`;
      });

    expect(pageSites).toEqual([
      `${onPage('"dot.unflagged"')} <Dot tooltip>`,
      `${onPage('"dot.flagged"')} <Dot tooltip>`,
      `${onPage('tooltip="Red"')} <Dot tooltip>`,
      `${onPage('tooltip="Green"')} <Dot tooltip>`,
      `${onPage('"banner.unflagged"')} <FlaggedBanner tooltip>`,
      `${onPage('"banner.flagged"')} <FlaggedBanner tooltip>`,
    ]);
  });
});

/*
 * The same rules on the checkout's own files, copied into a fixture as
 * they are and as they were: the colour square and the header alert as
 * main drew them, a page's flag dropped, a switch's tooltip looked up
 * twice. Each change is named.
 */
describe("the guard on the colour square, the header alert and the switch, as they are and with each fix undone (#8423)", () => {
  const COLOR_SQUARE: string = path.join(
    "Common",
    "UI",
    "Components",
    "ColorSquareCube",
    "ColorSquareCube.tsx",
  );
  const HEADER_ALERT: string = path.join(
    "Common",
    "UI",
    "Components",
    "HeaderAlert",
    "HeaderAlert.tsx",
  );
  const TOOLTIP: string = path.join(
    "Common",
    "UI",
    "Components",
    "Tooltip",
    "Tooltip.tsx",
  );
  const TOGGLE: string = path.join(
    "Common",
    "UI",
    "Components",
    "Toggle",
    "Toggle.tsx",
  );
  const SERVICE_ELEMENT: string = path.join(
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "Service",
    "ServiceElement.tsx",
  );
  const SWITCH_PAGE: string = path.join(
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "Switches.tsx",
  );

  const readCheckout: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(PACKAGES, file), "utf8");
  };

  // The checkout's text with one piece of code taken out, which must be there.
  const without: (text: string, code: string) => string = (
    text: string,
    code: string,
  ): string => {
    expect(text).toContain(code);

    return text.replace(code, "");
  };

  const MAIN_COLOR_SQUARE: Array<string> = [
    'import Tooltip from "../Tooltip/Tooltip";',
    'import Color from "../../../Types/Color";',
    'import React, { FunctionComponent, ReactElement } from "react";',
    "export interface ComponentProps {",
    "  color: Color;",
    "  tooltip: string;",
    "}",
    "const ColorSquareCube: FunctionComponent<ComponentProps> = (",
    "  props: ComponentProps,",
    "): ReactElement => {",
    "  return (",
    "    <Tooltip text={props.tooltip}>",
    '      <div className="rounded h-3 w-3"></div>',
    "    </Tooltip>",
    "  );",
    "};",
    "export default ColorSquareCube;",
  ];

  const SWITCH_LINES: Array<string> = [
    'import React from "react";',
    'import Toggle from "Common/UI/Components/Toggle/Toggle";',
    "const Switches = () => {",
    "  const { t } = useTranslation();",
    "  return (",
    "    <>",
    '      <Toggle title="Alerts" tooltip={t("switch.unflagged")} onChange={noop} />',
    '      <Toggle title="Alerts" tooltip={t("switch.flagged")} isTooltipTranslated={true} onChange={noop} />',
    '      <Toggle title="Alerts" tooltip="Notifies the team." onChange={noop} />',
    "    </>",
    "  );",
    "};",
    "export default Switches;",
  ];

  const scanWith: (
    files: Record<string, string>,
  ) => Array<[string, string, string]> = (
    files: Record<string, string>,
  ): Array<[string, string, string]> => {
    const root: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "tooltip-fix-undone-scan-"),
    );

    try {
      const packages: string = path.join(root, "packages");

      for (const [file, text] of Object.entries(files)) {
        writeFixture(packages, file, text.split("\n"));
      }

      return scanPlaceholders(packages).problems.map(
        (problem: PlaceholderProblem): [string, string, string] => {
          return [
            problem.where.slice(0, problem.where.lastIndexOf(":")),
            problem.handedTo,
            problem.message,
          ];
        },
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  const AS_THEY_ARE: () => Record<string, string> = (): Record<
    string,
    string
  > => {
    return {
      [TOOLTIP]: readCheckout(TOOLTIP),
      [COLOR_SQUARE]: readCheckout(COLOR_SQUARE),
      [HEADER_ALERT]: readCheckout(HEADER_ALERT),
      [SERVICE_ELEMENT]: readCheckout(SERVICE_ELEMENT),
    };
  };

  test("as they are: nothing to name", () => {
    expect(scanWith(AS_THEY_ARE())).toEqual([]);
  });

  test("the service colour's flag dropped: the page is named, its sentence looked up twice", () => {
    expect(
      scanWith({
        ...AS_THEY_ARE(),
        [SERVICE_ELEMENT]: without(
          readCheckout(SERVICE_ELEMENT),
          "isTooltipTranslated={true}",
        ),
      }),
    ).toEqual([
      [
        SERVICE_ELEMENT,
        "<ColorSquareCube tooltip>",
        `${LOOKED_UP_TWICE_MESSAGE}isTooltipTranslated`,
      ],
    ]);
  });

  test("the colour square as main drew it: it is named for handing its tooltip on, and the page's flag for going unread", () => {
    expect(
      scanWith({
        ...AS_THEY_ARE(),
        [COLOR_SQUARE]: MAIN_COLOR_SQUARE.join("\n"),
      }),
    ).toEqual([
      [
        SERVICE_ELEMENT,
        "<ColorSquareCube tooltip>",
        `${FLAG_NOT_READ_MESSAGE}isTooltipTranslated`,
      ],
      [
        COLOR_SQUARE,
        "<Tooltip text>",
        `${UNFLAGGED_HAND_ON_MESSAGE}isTooltipTranslated for tooltip, and hand it on as isTextTranslated`,
      ],
    ]);
  });

  test("the header alert with its flag no longer handed on: it is named", () => {
    expect(
      scanWith({
        ...AS_THEY_ARE(),
        [HEADER_ALERT]: without(
          readCheckout(HEADER_ALERT),
          "isTextTranslated={props.isTooltipTranslated}",
        ),
      }),
    ).toEqual([
      [
        HEADER_ALERT,
        "<Tooltip text>",
        `${UNFLAGGED_HAND_ON_MESSAGE}isTooltipTranslated for tooltip, and hand it on as isTextTranslated`,
      ],
    ]);
  });

  test("a switch's worded tooltip with no flag is named; flagged, or in English, it is not", () => {
    expect(
      scanWith({
        [TOOLTIP]: readCheckout(TOOLTIP),
        [TOGGLE]: readCheckout(TOGGLE),
        [SWITCH_PAGE]: SWITCH_LINES.join("\n"),
      }),
    ).toEqual([
      [
        SWITCH_PAGE,
        "<Toggle tooltip>",
        `${LOOKED_UP_TWICE_MESSAGE}isTooltipTranslated`,
      ],
    ]);
  });

  // The switch as main had it: its tooltip looked up whatever it was told.
  const TOGGLE_AS_MAIN: () => string = (): string => {
    const text: string = readCheckout(TOGGLE);
    const asMain: string = text.replace(
      /props\.isTooltipTranslated\s*\?\s*props\.tooltip\s*:\s*/,
      "",
    );

    expect(asMain).not.toBe(text);
    expect(asMain).toContain(
      "const tooltip: string | undefined = translateString(props.tooltip);",
    );

    return asMain;
  };

  test("the switch as main had it, looking its tooltip up with no flag: none of its callers can be seen", () => {
    expect(
      scanWith({
        [TOOLTIP]: readCheckout(TOOLTIP),
        [TOGGLE]: TOGGLE_AS_MAIN(),
        [SWITCH_PAGE]: SWITCH_LINES.join("\n"),
      }).filter((problem: [string, string, string]): boolean => {
        return problem[0] === SWITCH_PAGE;
      }),
    ).toEqual([
      // The flag a caller gives is the one thing it can still be told of.
      [
        SWITCH_PAGE,
        "<Toggle tooltip>",
        `${FLAG_NOT_READ_MESSAGE}isTooltipTranslated`,
      ],
    ]);
  });
});

/*
 * #8586: a permission check's reason (PermissionGate.disabledReason) is in
 * the reader's words already, so the guard reads it as a looked-up text:
 * every control that offers a translated flag holds its callers to it.
 */
describe("a permission check's reason, handed to a control that looks it up (#8586)", () => {
  test.each([
    [
      "Common/UI/Components/MoreMenu/MoreMenuItem.tsx",
      "MoreMenuItem",
      "tooltip",
    ],
    [
      "Common/UI/Components/ChoiceRows/ChoiceRows.tsx",
      "ChoiceRows",
      "lockedReason",
    ],
    [
      "Common/UI/Components/ModelSwitch/ModelSwitchRow.tsx",
      "ModelSwitchRow",
      "lockedReason",
    ],
    // Through the ModelSwitchRow it draws.
    [
      "Common/UI/Components/ModelSwitch/ModelSwitchCard.tsx",
      "ModelSwitchCard",
      "lockedReason",
    ],
  ])(
    "%s's %s looks up its %s",
    (file: string, component: string, prop: string) => {
      expect(checkout.isLookedUpBy(file, component, prop)).toBe(true);
    },
  );

  test("holds every locked menu item's reason: the permission checks' all said translated", () => {
    const reasons: Array<PlaceholderSite> = checkout.sites.filter(
      (site: PlaceholderSite): boolean => {
        return site.handedTo === "<MoreMenuItem tooltip>" && site.isLookedUp;
      },
    );

    expect(reasons.length).toBeGreaterThanOrEqual(27);
    expect(
      reasons.map((site: PlaceholderSite): [string, boolean] => {
        return [site.where, site.isSaidTranslated];
      }),
    ).toEqual(
      reasons.map((site: PlaceholderSite): [string, boolean] => {
        return [site.where, true];
      }),
    );

    /*
     * The reasons carried in an object of the page's own (an AI agent's
     * actions, a calendar feed's, an entity's reset), which the guard
     * cannot follow: said translated too.
     */
    for (const file of [
      "App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentActionsMenu.tsx",
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedManageMenu.tsx",
      "App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskHeader.tsx",
    ]) {
      expect(
        sitesIn(file)
          .filter((site: PlaceholderSite): boolean => {
            return site.handedTo === "<MoreMenuItem tooltip>";
          })
          .map((site: PlaceholderSite): boolean => {
            return site.isSaidTranslated;
          }),
      ).toEqual([true]);
    }

    // A case's header: its menu's five locked moves.
    expect(
      sitesIn(
        "App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseHeader.tsx",
      )
        .filter((site: PlaceholderSite): boolean => {
          return site.handedTo === "<MoreMenuItem tooltip>";
        })
        .map((site: PlaceholderSite) => {
          return [site.isLookedUp, site.isSaidTranslated];
        }),
    ).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  test("holds the choices locked by a permission check: the sharing, access and theme cards", () => {
    for (const file of [
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCard.tsx",
      "App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCard.tsx",
      "App/FeatureSet/Dashboard/src/Components/PublicPageTheme/PublicPageThemeCard.tsx",
    ]) {
      expect(
        sitesIn(file)
          .filter((site: PlaceholderSite): boolean => {
            return site.handedTo === "<ChoiceRows lockedReason>";
          })
          .map((site: PlaceholderSite) => {
            return [site.isLookedUp, site.isSaidTranslated];
          }),
      ).toEqual([[true, true]]);
    }
  });

  describe("the rule, on a fixture", () => {
    let root: string;
    let fixture: PlaceholderScanResult;

    const PAGE: string = path.join(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "Locks.tsx",
    );

    const PAGE_LINES: Array<string> = [
      'import React from "react";',
      'import Tooltip from "Common/UI/Components/Tooltip/Tooltip";',
      'import PermissionGate, { PermissionGateResult } from "Common/UI/Utils/PermissionGate";',
      "const Locks = (props) => {",
      "  const typed: PermissionGateResult = check();",
      "  const asked = PermissionGate.check(new Monitor(), ModelAction.Delete);",
      "  const reason = typed.isAllowed ? undefined : typed.disabledReason;",
      "  const other = { disabledReason: 'Not yet' };",
      "  return (",
      "    <>",
      "      <Tooltip text={typed.disabledReason}><span /></Tooltip>",
      "      <Tooltip text={asked.isAllowed ? undefined : asked.disabledReason}><span /></Tooltip>",
      "      <Tooltip text={reason}><span /></Tooltip>",
      "      <Tooltip text={typed.disabledReason} isTextTranslated={true}><span /></Tooltip>",
      // Not a permission check's: a prop, an object of its own.
      "      <Tooltip text={props.disabledReason}><span /></Tooltip>",
      "      <Tooltip text={other.disabledReason}><span /></Tooltip>",
      "    </>",
      "  );",
      "};",
      "export default Locks;",
    ];

    const at: (code: string) => string = (code: string): string => {
      return placeOf(PAGE, PAGE_LINES, code);
    };

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-reason-scan-"));

      const packages: string = path.join(root, "packages");

      writeFixture(
        packages,
        path.join("Common", "UI", "Components", "Tooltip", "Tooltip.tsx"),
        [
          'import React from "react";',
          "const Tooltip = (props) => {",
          "  const { translateString } = useTranslateValue();",
          "  return <span>{props.isTextTranslated ? props.text : translateString(props.text)}</span>;",
          "};",
          "export default Tooltip;",
        ],
      );
      writeFixture(packages, PAGE, PAGE_LINES);

      fixture = scanPlaceholders(packages);
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("a permission check's reason, typed, asked for, or a constant made of one, is looked up already; any other disabledReason is not", () => {
      expect(
        fixture.sites
          .filter((site: PlaceholderSite): boolean => {
            return site.where.startsWith(`${PAGE}:`);
          })
          .map((site: PlaceholderSite): [string, boolean, boolean] => {
            return [site.where, site.isLookedUp, site.isSaidTranslated];
          }),
      ).toEqual([
        [at("<Tooltip text={typed.disabledReason}><span />"), true, false],
        [at("asked.disabledReason"), true, false],
        [at("<Tooltip text={reason}>"), true, false],
        [at("isTextTranslated={true}"), true, true],
        [at("props.disabledReason"), false, false],
        [at("other.disabledReason}"), false, false],
      ]);
    });

    test("fails on each permission check's reason not said translated, and on nothing else", () => {
      expect(
        fixture.problems.map((problem: PlaceholderProblem) => {
          return [problem.where, problem.message];
        }),
      ).toEqual([
        [
          at("<Tooltip text={typed.disabledReason}><span />"),
          `${LOOKED_UP_TWICE_MESSAGE}isTextTranslated`,
        ],
        [
          at("asked.disabledReason"),
          `${LOOKED_UP_TWICE_MESSAGE}isTextTranslated`,
        ],
        [
          at("<Tooltip text={reason}>"),
          `${LOOKED_UP_TWICE_MESSAGE}isTextTranslated`,
        ],
        // A prop of its own handed on: the hand-on rule's (#8423).
        [
          at("props.disabledReason"),
          `${UNFLAGGED_HAND_ON_MESSAGE}isDisabledReasonTranslated for disabledReason, and hand it on as isTextTranslated`,
        ],
      ]);
    });
  });
});
