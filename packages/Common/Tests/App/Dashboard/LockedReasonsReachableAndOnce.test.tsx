import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import LlmConnectionTiles from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionTiles";
import LlmOtherAiTools from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmOtherAiTools";
import CloudConnectionTiles from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionTiles";
import VideoCallProviderGallery from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallProviderGallery";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { LlmConnectionKind } from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import ChoiceRows from "../../../UI/Components/ChoiceRows/ChoiceRows";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import LockedReason, {
  LOCKED_CONTROL_CLASS_NAME,
} from "../../../UI/Components/Tooltip/LockedReason";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * #8586: A PERMISSION CHECK'S REASON IS LOOKED UP ONCE.
 * #8587: A LOCKED TILE'S REASON REACHES EVERYONE WHO ASKS.
 *
 * PermissionGate words why a user may not do something in their language
 * already. MoreMenuItem looked the reason up again for its tooltip and its
 * screen reader's description, and ChoiceRows for its line under the
 * choices: where a translation is itself an English key, a second lookup
 * swaps it for another word (the Dashboard's Spanish says "Red" for
 * Network, and "Red" looked up again is "Rojo"). Each now takes a
 * translated flag, and every page that hands one a permission check's
 * reason says so.
 *
 * The connect pages' provider tiles put the reason in a tooltip on a
 * disabled button, which takes no focus, no tap and - for tippy.js - no
 * hover: nobody could read why the tile was locked. LockedReason wraps the
 * locked control in a focusable span that shows the reason on hover,
 * focus and a press, and describes it to a screen reader.
 */

interface Language {
  code: string;
  english: string;
  word: string;
  twice: string;
  extra?: Record<string, string>;
}

const LANGUAGES: Array<Language> = [
  { code: "es", english: "Network", word: "Red", twice: "Rojo" },
  { code: "nl", english: "Home", word: "Start", twice: "Starten" },
  { code: "de", english: "Default", word: "Standard", twice: "Normal" },
  {
    code: "fa",
    english: "Network",
    word: "شبکه",
    twice: "قرمز",
    extra: { شبکه: "قرمز" },
  },
  {
    code: "ar",
    english: "Network",
    word: "الشبكة",
    twice: "أحمر",
    extra: { الشبكة: "أحمر" },
  },
];

const instances: Map<string, i18n> = new Map();

function dashboardIn(language: Language): i18n {
  const cached: i18n | undefined = instances.get(language.code);

  if (cached) {
    return cached;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language.code,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language.code]: {
        translation: {
          ...readDashboardLocale(language.code),
          ...(language.extra || {}),
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  instances.set(language.code, instance);

  return instance;
}

function lookUp(language: Language, text: string): string {
  return dashboardIn(language).t(text, { defaultValue: text }) as string;
}

function renderIn(language: Language, element: ReactElement): HTMLElement {
  return render(
    <I18nextProvider i18n={dashboardIn(language)}>
      <MemoryRouter>
        <div data-testid="holder">{element}</div>
      </MemoryRouter>
    </I18nextProvider>,
  ).getByTestId("holder");
}

function shownTooltip(): string {
  return (screen.getByRole("tooltip").textContent || "").trim();
}

function describedBy(element: HTMLElement): string {
  return (
    document.getElementById(element.getAttribute("aria-describedby") || "")
      ?.textContent || ""
  ).trim();
}

const NOTHING: () => void = (): void => {};

afterEach(() => {
  cleanup();
});

describe.each(LANGUAGES)("in $code", (language: Language) => {
  const { english, word, twice } = language;

  test(`the words these cases lean on: ${english} is ${word}, and ${word} looked up again is ${twice}`, () => {
    expect(lookUp(language, english)).toBe(word);
    expect(lookUp(language, word)).toBe(twice);
  });

  describe("a locked menu item (MoreMenuItem)", () => {
    const item: (holder: HTMLElement) => HTMLElement = (
      holder: HTMLElement,
    ): HTMLElement => {
      return within(holder).getByRole("menuitem");
    };

    test("looks an English reason up once, for its tooltip and its screen reader", () => {
      const holder: HTMLElement = renderIn(
        language,
        <MoreMenuItem
          text="Delete"
          isDisabled={true}
          tooltip={english}
          onClick={NOTHING}
        />,
      );

      expect(describedBy(item(holder))).toBe(word);
      fireEvent.mouseEnter(item(holder));
      expect(shownTooltip()).toBe(word);
    });

    test(`draws a permission check's reason as given, for both: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <MoreMenuItem
          text="Delete"
          isDisabled={true}
          tooltip={word}
          isTooltipTranslated={true}
          onClick={NOTHING}
        />,
      );

      expect(describedBy(item(holder))).toBe(word);
      fireEvent.mouseEnter(item(holder));
      expect(shownTooltip()).toBe(word);
    });

    test(`an unlocked item's tooltip said translated is drawn as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <MoreMenuItem
          text="Archive"
          tooltip={word}
          isTooltipTranslated={true}
          onClick={NOTHING}
        />,
      );

      fireEvent.mouseEnter(item(holder));
      expect(shownTooltip()).toBe(word);
    });

    test(`words someone wrote stay as written: ${english}, never ${word}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <MoreMenuItem
          text="Delete"
          isDisabled={true}
          tooltip={english}
          isTooltipUserContent={true}
          onClick={NOTHING}
        />,
      );

      expect(describedBy(item(holder))).toBe(english);
    });
  });

  describe("locked choices (ChoiceRows)", () => {
    const OPTIONS: Array<{ value: "a" | "b"; title: string }> = [
      { value: "a", title: "Public" },
      { value: "b", title: "Private" },
    ];

    test("looks an English reason up once", () => {
      renderIn(
        language,
        <ChoiceRows<"a" | "b">
          value="a"
          options={OPTIONS}
          onPick={NOTHING}
          ariaLabel="Who can see it"
          lockedReason={english}
          dataTestId="choices"
        />,
      );

      expect(screen.getByTestId("choices-locked-reason")).toHaveTextContent(
        word,
      );
    });

    test(`draws a permission check's reason as given: ${word}, never ${twice}`, () => {
      renderIn(
        language,
        <ChoiceRows<"a" | "b">
          value="a"
          options={OPTIONS}
          onPick={NOTHING}
          ariaLabel="Who can see it"
          lockedReason={word}
          isLockedReasonTranslated={true}
          dataTestId="choices"
        />,
      );

      expect(
        screen.getByTestId("choices-locked-reason").textContent?.trim(),
      ).toBe(word);
    });
  });

  describe("a locked control's reason (LockedReason)", () => {
    const renderLocked: () => {
      wrapper: HTMLElement;
      onClick: MockFunction;
    } = (): { wrapper: HTMLElement; onClick: MockFunction } => {
      const onClick: MockFunction = getJestMockFunction();

      renderIn(
        language,
        <LockedReason reason={word} dataTestId="locked">
          <button
            type="button"
            disabled={true}
            className={LOCKED_CONTROL_CLASS_NAME}
            onClick={onClick}
          >
            Connect
          </button>
        </LockedReason>,
      );

      return { wrapper: screen.getByTestId("locked"), onClick };
    };

    test(`is reached from the keyboard and says why, as given: ${word}, never ${twice}`, () => {
      const { wrapper } = renderLocked();

      expect(wrapper).toHaveAttribute("tabindex", "0");
      wrapper.focus();
      expect(document.activeElement).toBe(wrapper);
      fireEvent.focus(wrapper);
      expect(shownTooltip()).toBe(word);
    });

    test("says why on a hover, and on a press, which keeps it", () => {
      const { wrapper } = renderLocked();

      fireEvent.mouseEnter(wrapper);
      expect(shownTooltip()).toBe(word);
      fireEvent.mouseLeave(wrapper);
      fireEvent.click(wrapper);
      expect(shownTooltip()).toBe(word);
    });

    test("describes itself to a screen reader whether or not the tooltip shows", () => {
      const { wrapper } = renderLocked();

      expect(describedBy(wrapper)).toBe(word);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    test("the control inside stays locked and takes no pointer", () => {
      const { wrapper, onClick } = renderLocked();
      const button: HTMLElement = within(wrapper).getByRole("button");

      expect(button).toBeDisabled();
      expect(button).toHaveClass(LOCKED_CONTROL_CLASS_NAME);
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("the connect pages' locked tiles", () => {
    // A locked tile: its wrapper, and the button in it.
    const expectReachableLock: (
      wrapperTestId: string,
      buttonTestId: string,
      onConnect: MockFunction,
    ) => void = (
      wrapperTestId: string,
      buttonTestId: string,
      onConnect: MockFunction,
    ): void => {
      const wrapper: HTMLElement = screen.getByTestId(wrapperTestId);
      const button: HTMLElement = screen.getByTestId(buttonTestId);

      expect(wrapper).toContainElement(button);
      expect(wrapper).toHaveAttribute("tabindex", "0");
      expect(describedBy(wrapper)).toBe(word);
      expect(button).toBeDisabled();
      expect(button).toHaveClass(LOCKED_CONTROL_CLASS_NAME);

      fireEvent.focus(wrapper);
      expect(shownTooltip()).toBe(word);
      fireEvent.click(button);
      expect(onConnect).not.toHaveBeenCalled();
    };

    test("an AI provider's tile", () => {
      const onConnect: MockFunction = getJestMockFunction();

      renderIn(
        language,
        <LlmConnectionTiles
          kind={LlmConnectionKind.ProviderAccount}
          connectionCounts={{}}
          canConnect={false}
          connectDisabledReason={word}
          onConnect={onConnect}
        />,
      );

      expectReachableLock(
        `llm-connection-tile-locked-${LlmConnectionProvider.OpenAI}`,
        `llm-connection-tile-${LlmConnectionProvider.OpenAI}`,
        onConnect,
      );
    });

    test("another AI tool's Connect", () => {
      const onConnect: MockFunction = getJestMockFunction();

      renderIn(
        language,
        <LlmOtherAiTools
          onConnect={onConnect}
          canConnect={false}
          connectDisabledReason={word}
        />,
      );

      expectReachableLock(
        "llm-other-ai-tool-connect-locked-cursor",
        "llm-other-ai-tool-connect-cursor",
        onConnect,
      );
    });

    test("a cloud's tile", () => {
      const onConnect: MockFunction = getJestMockFunction();

      renderIn(
        language,
        <CloudConnectionTiles
          connectionCounts={{}}
          canConnect={false}
          connectDisabledReason={word}
          onConnect={onConnect}
        />,
      );

      expectReachableLock(
        `cloud-connection-tile-locked-${CloudProvider.AWS}`,
        `cloud-connection-tile-${CloudProvider.AWS}`,
        onConnect,
      );
    });

    test("a video call provider's Connect", () => {
      const onConnect: MockFunction = getJestMockFunction();

      renderIn(
        language,
        <VideoCallProviderGallery
          connectionCounts={{}}
          canConnect={false}
          connectDisabledReason={word}
          onConnect={onConnect}
        />,
      );

      expectReachableLock(
        `video-call-connect-locked-${VideoCallProvider.Zoom}`,
        `video-call-connect-${VideoCallProvider.Zoom}`,
        onConnect,
      );
    });
  });
});

describe("an unlocked tile is as it was", () => {
  const english: Language = {
    code: "en",
    english: "Network",
    word: "Network",
    twice: "Network",
  };

  test("no wrapper, the button takes the pointer, and a press connects", () => {
    const onConnect: MockFunction = getJestMockFunction();

    renderIn(
      english,
      <CloudConnectionTiles
        connectionCounts={{}}
        canConnect={true}
        onConnect={onConnect}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      `cloud-connection-tile-${CloudProvider.AWS}`,
    );

    expect(
      screen.queryByTestId(`cloud-connection-tile-locked-${CloudProvider.AWS}`),
    ).not.toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(button).not.toHaveClass(LOCKED_CONTROL_CLASS_NAME);
    fireEvent.click(button);
    expect(onConnect).toHaveBeenCalledWith(CloudProvider.AWS);
  });

  test("locked with nothing to say, a tile is disabled with no wrapper", () => {
    renderIn(
      english,
      <VideoCallProviderGallery
        connectionCounts={{}}
        canConnect={false}
        onConnect={NOTHING}
      />,
    );

    expect(
      screen.getByTestId(`video-call-connect-${VideoCallProvider.Zoom}`),
    ).toBeDisabled();
    expect(
      screen.queryByTestId(`video-call-connect-locked-${VideoCallProvider.Zoom}`),
    ).not.toBeInTheDocument();
  });
});
