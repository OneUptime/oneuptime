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
import { createInstance, i18n } from "i18next";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * The service colour and the span's status dot link to their records:
 * AppLink reads the router, which these pages need not mount.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import ServiceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Service/ServiceElement";
import TelemetryServiceElement from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryService/TelemetryServiceElement";
import SpanStatusElement from "../../../../App/FeatureSet/Dashboard/src/Components/Span/SpanStatusElement";
import { ReplayToolButton } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi";
import { StateSettingsNameCell } from "../../../../App/FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsTable";
import { HeaderActionButton } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseHeader";
import UserOverrideOverlapsMark from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideOverlapsMark";
import SubscriberNotificationPreviewButton from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewButton";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { StateListType } from "../../../Utils/StateListType";
import ColorCircle from "../../../UI/Components/ColorCircle/ColorCircle";
import ColorSquareCube from "../../../UI/Components/ColorSquareCube/ColorSquareCube";
import DetailIdLine from "../../../UI/Components/Detail/DetailIdLine";
import HeaderAlert, {
  HeaderAlertType,
} from "../../../UI/Components/HeaderAlert/HeaderAlert";
import HeaderModelAlert from "../../../UI/Components/HeaderAlert/HeaderModelAlert";
import ExplainedPill from "../../../UI/Components/Pill/ExplainedPill";
import RoleLabel from "../../../UI/Components/RoleLabel/RoleLabel";
import Toggle, {
  TOGGLE_HELP_BUTTON_TEST_ID,
} from "../../../UI/Components/Toggle/Toggle";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * #8423: A TOOLTIP A COMPONENT IS HANDED IS LOOKED UP ONCE.
 *
 * The colour squares and circles, HeaderAlert, Toggle, the replay
 * toolbar's buttons, the state settings' Built-in tag and the security
 * headers' actions looked up the tooltip they were handed, and could not
 * be told the page had worded it already: "{{name}} Service Color", a
 * span's status, a permission check's reason were looked up twice. Where
 * a translation is itself an English key, a second lookup swaps it for
 * another word: the Dashboard's Spanish says "Red" for Network, and "Red"
 * looked up again is "Rojo".
 *
 * Each now takes is<Prop>Translated and draws a text it is told is
 * translated as given; English is still looked up, once. These draw them
 * in the Dashboard's own words, as it ships:
 *
 * - Spanish says "Red" for Network, and "Rojo" for "Red";
 * - Dutch says "Start" for Home, and "Starten" for "Start";
 * - German says "Standard" for Default, and "Normal" for "Standard";
 * - Persian and Arabic say "شبکه" and "الشبكة" for Network; no word of
 *   theirs is a key of its own, so each case makes it one, which reads
 *   red ("قرمز", "أحمر").
 */

interface Language {
  code: string;
  english: string;
  // The language's word for it: what the reader must see.
  word: string;
  // That word looked up again: what they must never see.
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

// A service named like a key: its colour's tooltip, worded around it.
const SERVICE_NAME: string = "api";

const instances: Map<string, i18n> = new Map();

/*
 * The language's file as it ships, plus its probe (extra), and every
 * sentence a case words made a key of its own that reads the language's
 * twice: so a sentence looked up again would read it.
 */
function dashboardIn(language: Language, sentences: Array<string> = []): i18n {
  const id: string = `${language.code}|${sentences.join("|")}`;
  const cached: i18n | undefined = instances.get(id);

  if (cached) {
    return cached;
  }

  const probes: Record<string, string> = {};

  for (const sentence of sentences) {
    probes[sentence] = language.twice;
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
          ...probes,
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  instances.set(id, instance);

  return instance;
}

function lookUp(language: Language, text: string): string {
  return dashboardIn(language).t(text, { defaultValue: text }) as string;
}

function renderIn(
  language: Language,
  element: ReactElement,
  sentences: Array<string> = [],
): HTMLElement {
  return render(
    <I18nextProvider i18n={dashboardIn(language, sentences)}>
      <div data-testid="holder">{element}</div>
    </I18nextProvider>,
  ).getByTestId("holder");
}

// The words the tooltip shows once the pointer is over its trigger.
function tooltipOver(trigger: Element): string {
  fireEvent.mouseEnter(trigger);

  return (screen.getByRole("tooltip").textContent || "").trim();
}

// ColorSquareCube's square, and ColorCircle's dot.
function squareIn(holder: HTMLElement): HTMLElement {
  return holder.querySelector("div.rounded.h-3.w-3") as HTMLElement;
}

function dotIn(holder: HTMLElement): HTMLElement {
  return within(holder).getByRole("img");
}

const NOTHING: () => void = (): void => {};

beforeEach(() => {
  // Route population, and the unknown service's id, read the project's id.
  goTo(`/dashboard/${PROJECT_ID}/traces`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(LANGUAGES)("in $code", (language: Language) => {
  const { english, word, twice } = language;

  test(`the words these cases lean on: ${english} is ${word}, and ${word} looked up again is ${twice}`, () => {
    expect(lookUp(language, english)).toBe(word);
    expect(lookUp(language, word)).toBe(twice);
  });

  describe("a colour square (ColorSquareCube)", () => {
    test("looks English up once", () => {
      const holder: HTMLElement = renderIn(
        language,
        <ColorSquareCube color={new Color("#6366f1")} tooltip={english} />,
      );

      expect(tooltipOver(squareIn(holder))).toBe(word);
    });

    test(`draws a tooltip it is told is translated as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <ColorSquareCube
          color={new Color("#6366f1")}
          tooltip={word}
          isTooltipTranslated={true}
        />,
      );

      expect(tooltipOver(squareIn(holder))).toBe(word);
    });

    test(`draws a name someone gave as written: ${english}, never ${word}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <ColorSquareCube
          color={new Color("#6366f1")}
          tooltip={english}
          isTooltipUserContent={true}
        />,
      );

      expect(tooltipOver(squareIn(holder))).toBe(english);
    });
  });

  describe("a colour dot (ColorCircle)", () => {
    test("looks English up once, and names the dot by the words its tooltip shows", () => {
      const holder: HTMLElement = renderIn(
        language,
        <ColorCircle color={new Color("#10b981")} tooltip={english} />,
      );

      // It named the dot by the English its tooltip was handed.
      expect(dotIn(holder)).toHaveAttribute("aria-label", word);
      expect(tooltipOver(dotIn(holder))).toBe(word);
    });

    test(`draws and names a tooltip it is told is translated as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <ColorCircle
          color={new Color("#10b981")}
          tooltip={word}
          isTooltipTranslated={true}
        />,
      );

      expect(dotIn(holder)).toHaveAttribute("aria-label", word);
      expect(tooltipOver(dotIn(holder))).toBe(word);
    });
  });

  describe("a header alert (HeaderAlert, HeaderModelAlert)", () => {
    test("looks English up once", () => {
      const holder: HTMLElement = renderIn(
        language,
        <HeaderAlert
          icon={IconProp.Alert}
          title="2"
          alertType={HeaderAlertType.ERROR}
          tooltip={english}
        />,
      );

      expect(tooltipOver(holder.firstElementChild!)).toBe(word);
    });

    test(`draws a tooltip it is told is translated as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <HeaderAlert
          icon={IconProp.Alert}
          title="2"
          alertType={HeaderAlertType.ERROR}
          tooltip={word}
          isTooltipTranslated={true}
        />,
      );

      expect(tooltipOver(holder.firstElementChild!)).toBe(word);
    });

    test.each([
      [false, "looks English up once"],
      [true, `hands its flag on: ${word}, never ${twice}`],
    ])(
      "a count's alert, said translated %s: %s",
      async (isTranslated: boolean) => {
        jest.spyOn(ModelAPI, "count").mockResolvedValue(2 as never);

        const holder: HTMLElement = renderIn(
          language,
          <HeaderModelAlert<Monitor>
            icon={IconProp.Alert}
            modelType={Monitor}
            singularName="Monitor"
            pluralName="Monitors"
            query={{}}
            alertType={HeaderAlertType.ERROR}
            tooltip={isTranslated ? word : english}
            isTooltipTranslated={isTranslated}
          />,
        );

        await act(async () => {
          for (let index: number = 0; index < 5; index++) {
            await Promise.resolve();
          }
        });

        expect(holder).toHaveTextContent("2");
        expect(tooltipOver(holder.firstElementChild!)).toBe(word);
      },
    );
  });

  describe("a switch (Toggle)", () => {
    // The switch's help button, which shows the tooltip.
    const helpButtonOf: (holder: HTMLElement) => HTMLElement = (
      holder: HTMLElement,
    ): HTMLElement => {
      return within(holder).getByTestId(
        `alerts-toggle-${TOGGLE_HELP_BUTTON_TEST_ID}`,
      );
    };

    // What the switch says its help means, to a screen reader and on a tap.
    const helpOf: (holder: HTMLElement) => string = (
      holder: HTMLElement,
    ): string => {
      const describedBy: string =
        helpButtonOf(holder).getAttribute("aria-describedby") || "";

      return (document.getElementById(describedBy)?.textContent || "").trim();
    };

    test("looks English up once", () => {
      const holder: HTMLElement = renderIn(
        language,
        <Toggle
          title="Alerts"
          tooltip={english}
          onChange={NOTHING}
          dataTestId="alerts-toggle"
        />,
      );

      expect(helpOf(holder)).toBe(word);
      expect(tooltipOver(helpButtonOf(holder))).toBe(word);
    });

    test(`draws a tooltip it is told is translated as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <Toggle
          title="Alerts"
          tooltip={word}
          isTooltipTranslated={true}
          onChange={NOTHING}
          dataTestId="alerts-toggle"
        />,
      );

      expect(helpOf(holder)).toBe(word);
      expect(tooltipOver(helpButtonOf(holder))).toBe(word);
    });
  });

  describe("a replay toolbar's button (ReplayToolButton)", () => {
    const button: (holder: HTMLElement) => HTMLElement = (
      holder: HTMLElement,
    ): HTMLElement => {
      return within(holder).getByTestId("replay-probe");
    };

    test("looks its English label, title and tooltip up once", () => {
      const holder: HTMLElement = renderIn(
        language,
        <ReplayToolButton
          label={english}
          title={english}
          tooltip={english}
          dataTestId="replay-probe"
          onClick={NOTHING}
        />,
      );

      expect(button(holder)).toHaveTextContent(word);
      expect(button(holder)).toHaveAttribute("title", word);
      expect(tooltipOver(button(holder))).toBe(word);
    });

    test(`draws a label, a title and a tooltip it is told are translated as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <ReplayToolButton
          label={word}
          isLabelTranslated={true}
          title={word}
          isTitleTranslated={true}
          tooltip={word}
          isTooltipTranslated={true}
          dataTestId="replay-probe"
          onClick={NOTHING}
        />,
      );

      expect(button(holder).textContent?.trim()).toBe(word);
      expect(button(holder)).toHaveAttribute("title", word);
      expect(tooltipOver(button(holder))).toBe(word);
    });

    test("each flag speaks for its own text only", () => {
      const holder: HTMLElement = renderIn(
        language,
        <ReplayToolButton
          label={word}
          isLabelTranslated={true}
          title={english}
          tooltip={english}
          dataTestId="replay-probe"
          onClick={NOTHING}
        />,
      );

      expect(button(holder).textContent?.trim()).toBe(word);
      expect(button(holder)).toHaveAttribute("title", word);
      expect(tooltipOver(button(holder))).toBe(word);
    });
  });

  describe("a state's Built-in tag (StateSettingsNameCell)", () => {
    const tagOf: (holder: HTMLElement) => HTMLElement = (
      holder: HTMLElement,
    ): HTMLElement => {
      return within(holder).getByTestId("state-settings-built-in");
    };

    test("looks English up once, for its tooltip and its screen reader", () => {
      const holder: HTMLElement = renderIn(
        language,
        <StateSettingsNameCell
          name="Resolved"
          stateList={StateListType.IncidentState}
          color={new Color("#10b981")}
          builtInTooltip={english}
        />,
      );

      expect(tagOf(holder)).toHaveTextContent(word);
      expect(tooltipOver(tagOf(holder))).toBe(word);
    });

    test(`draws a tooltip it is told is translated as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <StateSettingsNameCell
          name="Resolved"
          stateList={StateListType.IncidentState}
          color={new Color("#10b981")}
          builtInTooltip={word}
          isBuiltInTooltipTranslated={true}
        />,
      );

      expect(tagOf(holder)).not.toHaveTextContent(twice);
      expect(tooltipOver(tagOf(holder))).toBe(word);
    });
  });

  describe("a security header's locked action (HeaderActionButton)", () => {
    const wrapperOf: (holder: HTMLElement) => HTMLElement = (
      holder: HTMLElement,
    ): HTMLElement => {
      return within(holder).getByTestId("probe-action-disabled-wrapper");
    };

    test("looks English up once", () => {
      const holder: HTMLElement = renderIn(
        language,
        <HeaderActionButton
          action={{
            title: "Close Case",
            icon: IconProp.CheckCircle,
            isDisabled: true,
            tooltip: english,
            dataTestId: "probe-action",
            onClick: NOTHING,
          }}
        />,
      );

      expect(tooltipOver(wrapperOf(holder))).toBe(word);
    });

    test(`draws a reason it is told is translated as given, as a permission check words it: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <HeaderActionButton
          action={{
            title: "Close Case",
            icon: IconProp.CheckCircle,
            isDisabled: true,
            tooltip: word,
            isTooltipTranslated: true,
            dataTestId: "probe-action",
            onClick: NOTHING,
          }}
        />,
      );

      expect(tooltipOver(wrapperOf(holder))).toBe(word);
    });
  });

  describe("the components the guard found handing a tooltip on", () => {
    test(`an override's overlaps mark draws its worded text as given: ${word}, never ${twice}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <UserOverrideOverlapsMark text={word} />,
      );
      const mark: HTMLElement = within(holder).getByTestId(
        "user-override-overlaps",
      );

      expect(mark).toHaveAttribute("aria-label", word);
      expect(tooltipOver(mark)).toBe(word);
    });

    test(`a record's ID line draws an ID as it is: ${english}, never ${word}`, () => {
      const holder: HTMLElement = renderIn(
        language,
        <DetailIdLine recordId={english} />,
      );

      expect(
        tooltipOver(within(holder).getByTestId("detail-id-value-wrapper")),
      ).toBe(english);
    });

    test("an explained pill looks its explanation up once, for its tooltip and its description alike", () => {
      const holder: HTMLElement = renderIn(
        language,
        <ExplainedPill
          text="Adds nothing"
          explanation={english}
          color={new Color("#f59e0b")}
          dataTestId="explained"
        />,
      );
      const pill: HTMLElement = within(holder).getByTestId("explained");
      const description: string =
        document.getElementById(pill.getAttribute("aria-describedby") || "")
          ?.textContent || "";

      expect(description.trim()).toBe(word);
      expect(tooltipOver(pill)).toBe(word);
    });

    test(`a role's label looks English up once, and draws a description it is told is translated as given: ${word}, never ${twice}`, () => {
      const english_: HTMLElement = renderIn(
        language,
        <RoleLabel name="Commander" description={english} />,
      );

      expect(tooltipOver(english_.firstElementChild!)).toBe(word);
      cleanup();

      const worded: HTMLElement = renderIn(
        language,
        <RoleLabel
          name="Commander"
          description={word}
          isDescriptionTranslated={true}
        />,
      );

      expect(tooltipOver(worded.firstElementChild!)).toBe(word);
    });

    test("a locked preview link looks its reason up once, for its tooltip and its screen reader alike", () => {
      const holder: HTMLElement = renderIn(
        language,
        <SubscriberNotificationPreviewButton
          getRequest={() => {
            return null;
          }}
          isDisabled={true}
          disabledReason={english}
          dataTestId="preview"
        />,
      );

      expect(within(holder).getByTestId("preview-reason")).toHaveTextContent(
        word,
      );
      expect(tooltipOver(within(holder).getByTestId("preview"))).toBe(word);
    });
  });

  describe("the pages that word a colour's tooltip", () => {
    /*
     * The service colour's sentence, as the page words it - then made a
     * key of its own: looked up again, it would read the language's twice.
     */
    const sentence: string = lookUp(language, "{{name}} Service Color").replace(
      "{{name}}",
      SERVICE_NAME,
    );

    test(`the sentence these cases lean on is the language's own: ${sentence}`, () => {
      expect(sentence).not.toContain("Service Color");
      expect(sentence).toContain(SERVICE_NAME);
    });

    test(`a service's colour reads the page's sentence, never ${twice}`, () => {
      const service: Service = new Service();

      service._id = "0193c0de-6740-4aaa-8bbb-000000000101";
      service.name = SERVICE_NAME;
      service.serviceColor = new Color("#6366f1");

      const holder: HTMLElement = renderIn(
        language,
        <ServiceElement service={service} />,
        [sentence],
      );

      expect(tooltipOver(squareIn(holder))).toBe(sentence);
    });

    test(`a telemetry service's colour reads the page's sentence, never ${twice}`, () => {
      const service: Service = new Service();

      service._id = "0193c0de-6740-4aaa-8bbb-000000000102";
      service.name = SERVICE_NAME;
      service.serviceColor = new Color("#6366f1");

      const holder: HTMLElement = renderIn(
        language,
        <TelemetryServiceElement telemetryService={service} />,
        [sentence],
      );

      expect(tooltipOver(squareIn(holder))).toBe(sentence);
    });

    test(`a span's status dot reads the page's word for its status, never ${twice}`, () => {
      const status: string = lookUp(language, "Span Status: Unset (no error)");
      const holder: HTMLElement = renderIn(
        language,
        <SpanStatusElement spanStatusCode={SpanStatus.Unset} traceId="t" />,
        [status],
      );

      expect(status).not.toBe("Span Status: Unset (no error)");
      expect(dotIn(holder)).toHaveAttribute("aria-label", status);
      expect(tooltipOver(dotIn(holder))).toBe(status);
    });
  });
});

describe("in English", () => {
  const english: Language = {
    code: "en",
    english: "Network",
    word: "Network",
    twice: "Network",
  };

  test("every component reads its English as it is", () => {
    const holder: HTMLElement = renderIn(
      english,
      <>
        <ColorSquareCube color={new Color("#6366f1")} tooltip="Network" />
        <ColorCircle color={new Color("#10b981")} tooltip="Span Status: Ok" />
      </>,
    );

    expect(tooltipOver(squareIn(holder))).toBe("Network");
    cleanup();

    const dot: HTMLElement = renderIn(
      english,
      <ColorCircle color={new Color("#10b981")} tooltip="Span Status: Ok" />,
    );

    expect(dotIn(dot)).toHaveAttribute("aria-label", "Span Status: Ok");
    expect(tooltipOver(dotIn(dot))).toBe("Span Status: Ok");
  });

  test("a service's colour says whose colour it is", () => {
    const service: Service = new Service();

    service._id = "0193c0de-6740-4aaa-8bbb-000000000101";
    service.name = SERVICE_NAME;
    service.serviceColor = new Color("#6366f1");

    const holder: HTMLElement = renderIn(
      english,
      <ServiceElement service={service} />,
    );

    expect(tooltipOver(squareIn(holder))).toBe("api Service Color");
  });
});
