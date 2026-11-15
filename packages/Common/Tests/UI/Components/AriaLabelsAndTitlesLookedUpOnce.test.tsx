import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";

/*
 * AN ARIA LABEL, A LINK'S OR A NAV ITEM'S TITLE AND AN EMPTY VALUE'S WORDS
 * ARE LOOKED UP ONCE (#7790, #7791).
 *
 * The shared controls look these texts up in the reader's language, and
 * pages handed them ones they had looked up already - an aria label built
 * around a name, a front end's own keyed text: the Dashboard's names for
 * its products, the Admin Dashboard's t("common.none") for an empty value
 * - which the control looked up again. Where a translation is itself an
 * English key, the reader saw or heard the translation of the translation:
 * Spanish says "Red" for "Network", and "Rojo" for "Red".
 *
 * Now a page hands a control English, and the control looks it up, once;
 * or the page says the text is in the reader's words already
 * (isAriaLabelTranslated, isTitleTranslated, isTooltipTranslated,
 * isTextTranslated, isPlaceholderTranslated) and the control draws it as
 * given. Here each control, in Spanish with the Dashboard's own locale
 * file, says "Red" either way: never "Rojo", never the English.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 50 };
      },
    },
  };
});

import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Button from "../../../UI/Components/Button/Button";
import CardMoreMenu from "../../../UI/Components/Card/CardMoreMenu";
import CheckboxElement from "../../../UI/Components/Checkbox/Checkbox";
import Detail from "../../../UI/Components/Detail/Detail";
import EmptyValue from "../../../UI/Components/Detail/EmptyValue";
import PlaceholderText from "../../../UI/Components/Detail/PlaceholderText";
import Dropdown from "../../../UI/Components/Dropdown/Dropdown";
import Link from "../../../UI/Components/Link/Link";
import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import NavBarItem from "../../../UI/Components/Navbar/NavBarItem";
import PeopleSearchPopup from "../../../UI/Components/PeoplePicker/PeopleSearchPopup";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import Toggle, {
  TOGGLE_HELP_BUTTON_TEST_ID,
} from "../../../UI/Components/Toggle/Toggle";
import FieldType from "../../../UI/Components/Types/FieldType";
import ValueTextField from "../../../UI/Components/Workflow/ValuePicker/ValueTextField";
import { AnchoredFieldPopup } from "../../../UI/Types/UseAnchoredFieldPopup";
import Navigation from "../../../UI/Utils/Navigation";
import ProductAnalyticsEventPicker from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventPicker";
import { ReplayToolButton } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

// A text whose translation is itself an English key.
const ENGLISH: string = "Network";
const ONCE: string = "Red";
const TWICE: string = "Rojo";

interface Item {
  value?: string | Array<string> | undefined;
}

// What a page hands the control: the text, and whether it says it is translated.
type Draw = (text: string, isTranslated: boolean | undefined) => ReactElement;

function doNothing(): void {}

// The people search, open at its button.
const OPEN_POPUP: AnchoredFieldPopup = {
  isPopupOpen: true,
  popupPosition: {
    top: 120,
    bottom: undefined,
    left: 40,
    maxHeight: 380,
    width: 320,
  },
  popupRef: { current: null },
  popupId: "people-search-looked-up-once",
  portalTarget: document.body,
} as unknown as AnchoredFieldPopup;

function detailCard(
  fieldType: FieldType,
  item: Item,
  text: string,
  isTranslated: boolean | undefined,
): ReactElement {
  return (
    <Detail<Item>
      id="detail-looked-up-once"
      item={item}
      fields={[
        {
          key: "value",
          title: "Name",
          fieldType: fieldType,
          dropdownOptions: [{ label: "One", value: "one" }],
          placeholder: text,
          isPlaceholderTranslated: isTranslated,
        },
      ]}
      showRecordLine={false}
    />
  );
}

// Each control, handed the text where it looks it up.
const CONTROLS: Array<[string, Draw]> = [
  [
    "a button's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <Button
          icon={IconProp.Close}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          onClick={doNothing}
        />
      );
    },
  ],
  [
    "a dropdown's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <Dropdown
          options={[{ label: "One", value: "one" }]}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          onChange={doNothing}
        />
      );
    },
  ],
  [
    "a more menu's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <MoreMenu ariaLabel={text} isAriaLabelTranslated={isTranslated}>
          {[<MoreMenuItem key="edit" text="Edit" onClick={doNothing} />]}
        </MoreMenu>
      );
    },
  ],
  [
    "a card's more menu's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <CardMoreMenu ariaLabel={text} isAriaLabelTranslated={isTranslated}>
          {[<MoreMenuItem key="edit" text="Edit" onClick={doNothing} />]}
        </CardMoreMenu>
      );
    },
  ],
  [
    "a checkbox's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <CheckboxElement
          initialValue={false}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          onChange={doNothing}
        />
      );
    },
  ],
  [
    "a switch's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <Toggle
          initialValue={false}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          onChange={doNothing}
        />
      );
    },
  ],
  [
    "a workflow value box's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <ValueTextField
          value=""
          multiline={false}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          onChange={doNothing}
        />
      );
    },
  ],
  [
    "the people search's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <PeopleSearchPopup
          popup={OPEN_POPUP}
          kinds={[PeoplePickerKind.User]}
          selectedKeys={new Set<string>()}
          selectionMode="add"
          onPick={doNothing}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
        />
      );
    },
  ],
  [
    "a session replay button's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <ReplayToolButton
          icon={IconProp.Play}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          onClick={doNothing}
        />
      );
    },
  ],
  [
    "the product analytics event picker's aria label",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <ProductAnalyticsEventPicker
          events={[]}
          value={null}
          onChange={doNothing}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          dataTestId="event-picker-looked-up-once"
        />
      );
    },
  ],
  [
    "a link's title",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <Link
          to={new Route("/somewhere")}
          title={text}
          isTitleTranslated={isTranslated}
        >
          Go
        </Link>
      );
    },
  ],
  [
    "a nav item's title",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <NavBarItem
          title={text}
          isTitleTranslated={isTranslated}
          route={new Route("/somewhere")}
        />
      );
    },
  ],
  [
    "a nav item's tooltip",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <NavBarItem
          title="Home"
          tooltip={text}
          isTooltipTranslated={isTranslated}
          route={new Route("/somewhere")}
        />
      );
    },
  ],
  [
    "PlaceholderText's text",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return <PlaceholderText text={text} isTextTranslated={isTranslated} />;
    },
  ],
  [
    "an empty value's words",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return (
        <EmptyValue placeholder={text} isPlaceholderTranslated={isTranslated} />
      );
    },
  ],
  [
    "a detail card's empty text field",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return detailCard(FieldType.Text, {}, text, isTranslated);
    },
  ],
  [
    "a detail card's empty dropdown field",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return detailCard(FieldType.Dropdown, {}, text, isTranslated);
    },
  ],
  [
    "a detail card's empty multi-select field",
    (text: string, isTranslated: boolean | undefined): ReactElement => {
      return detailCard(
        FieldType.MultiSelectDropdown,
        { value: [] },
        text,
        isTranslated,
      );
    },
  ],
];

// A word as a shared component looks it up (UI/Utils/Translation).
function word(text: string): string {
  return i18next.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

/*
 * Every text a reader can see or hear: the names and hover tips the
 * controls draw, and every line of text with nothing else in it.
 */
function drawnTexts(): Array<string> {
  const texts: Array<string> = [];

  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      const value: string | null = element.getAttribute(attribute);

      if (value) {
        texts.push(value);
      }
    }

    if (element.children.length === 0) {
      const text: string = (element.textContent || "").trim();

      if (text) {
        texts.push(text);
      }
    }
  }

  return texts;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: readDashboardLocale("es") },
    },
    interpolation: { escapeValue: false },
  });

  // A nav item asks whether it is the page the reader is on.
  Navigation.setLocation({
    pathname: "/elsewhere",
    search: "",
    hash: "",
    state: null,
    key: "looked-up-once",
  } as Location);
});

afterEach(() => {
  cleanup();
});

describe("a text whose translation is another English key", () => {
  test("is one in Spanish: Network is Red, and Red is Rojo", () => {
    expect(word(ENGLISH)).toBe(ONCE);
    expect(word(ONCE)).toBe(TWICE);
  });
});

describe("in Spanish", () => {
  test.each(CONTROLS)(
    "%s, handed over in English, is looked up once",
    async (_text: string, draw: Draw) => {
      render(draw(ENGLISH, undefined));
      await settle();

      const drawn: Array<string> = drawnTexts();

      expect(drawn).toContain(ONCE);
      expect(drawn).not.toContain(TWICE);
      expect(drawn).not.toContain(ENGLISH);
    },
  );

  test.each(CONTROLS)(
    "%s, in the reader's words already and said so, is drawn as given",
    async (_text: string, draw: Draw) => {
      render(draw(ONCE, true));
      await settle();

      const drawn: Array<string> = drawnTexts();

      expect(drawn).toContain(ONCE);
      expect(drawn).not.toContain(TWICE);
    },
  );

  test.each([
    ["handed over in English", ENGLISH, undefined],
    ["in the reader's words already and said so", ONCE, true],
  ])(
    "a switch's help button, its aria label %s, is about Red, never Rojo",
    async (_how: string, text: string, isTranslated: boolean | undefined) => {
      render(
        <Toggle
          initialValue={false}
          ariaLabel={text}
          isAriaLabelTranslated={isTranslated}
          tooltip="Turns it on"
          onChange={doNothing}
        />,
      );
      await settle();

      const name: string =
        screen
          .getByTestId(TOGGLE_HELP_BUTTON_TEST_ID)
          .getAttribute("aria-label") || "";

      expect(name).toBe(
        i18next.t("About {{label}}", {
          label: ONCE,
          keySeparator: false,
          nsSeparator: false,
        }),
      );
      expect(name).not.toContain(TWICE);
    },
  );
});
