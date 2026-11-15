// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import {
  ExposurePill,
  SensitivityPill,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityPills";
import { RunnerLiveStatusBubble } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerStatus";
import Label from "../../../Models/DatabaseModels/Label";
import Color from "../../../Types/Color";
import DataSensitivity, {
  DATA_SENSITIVITY_DESCRIPTION,
} from "../../../Types/DataSecurity/DataSensitivity";
import {
  DATA_STORE_EXPOSURE_DESCRIPTION,
  DataStoreExposure,
} from "../../../Types/DataSecurity/DataStorePosture";
import { RunnerLiveStatus } from "../../../Types/Runner/RunnerLiveStatus";
import LabelElement from "../../../UI/Components/Label/Label";
import Pill from "../../../UI/Components/Pill/Pill";
import CurrentlyActiveIndicator, {
  CURRENTLY_ACTIVE_TEXT,
} from "../../../UI/Components/StateTimeline/CurrentlyActiveIndicator";
import MonitoringOffIndicator, {
  MONITORING_OFF_TEXT,
} from "../../../UI/Components/StateTimeline/MonitoringOffIndicator";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A BADGE'S WORDS ARE LOOKED UP ONCE (#8067).
 *
 * - A label's description, in its hover tip, is its owner's words, like
 *   its name: Tooltip looked it up, so a description that matched a key
 *   read as that key's translation - "Status" read "Estado" in Spanish.
 * - A badge a page hands words it has worded already (t(), a template, a
 *   helper) looked them up a second time: where a translation is itself an
 *   English key it read that key's translation - Spanish "Red" (Network)
 *   read "Rojo", German "Standard" (Default) read "Normal".
 *
 * Now a badge given such words says it draws them as written
 * (isUserContent, isTooltipUserContent), and one given plain English looks
 * it up once. These draw badges with the Dashboard's real German, Spanish
 * and Persian. (German says "Status" for Status, so its label's case is
 * described "Production", "Produktion" in German.)
 */

const GREEN: Color = new Color("#10b981");

const instances: Map<string, i18n> = new Map();

// The Dashboard's words in a language, English behind them, as it ships.
function dashboardIn(
  language: string,
  extra: Record<string, string> = {},
): i18n {
  const id: string = `${language}:${JSON.stringify(extra)}`;
  const cached: i18n | undefined = instances.get(id);

  if (cached) {
    return cached;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: {
        translation: { ...readDashboardLocale(language), ...extra },
      },
    },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });

  instances.set(id, instance);

  return instance;
}

function renderIn(
  language: string,
  element: ReactElement,
  extra: Record<string, string> = {},
): void {
  render(
    <I18nextProvider i18n={dashboardIn(language, extra)}>
      {element}
    </I18nextProvider>,
  );
}

function wordIn(language: string, english: string): string {
  const value: unknown = readDashboardLocale(language)[english];

  if (typeof value !== "string") {
    throw new Error(`No "${english}" in ${language}`);
  }

  return value;
}

// The one pill's words, and its hover tip once it is shown.
function pillText(): string {
  return (screen.getByTestId("pill-text").textContent || "").trim();
}

function hoverTip(): string {
  fireEvent.mouseEnter(screen.getByTestId("pill"));

  return (screen.getByRole("tooltip").textContent || "").trim();
}

function labelWith(name: string, description: string): Label {
  const label: Label = new Label();

  label.name = name;
  label.description = description;
  label.color = GREEN;

  return label;
}

afterEach(() => {
  cleanup();
});

describe("the words these cases lean on", () => {
  test("each language has its own word for the descriptions, and Red and Standard are keys of their own", () => {
    expect(wordIn("de", "Production")).toBe("Produktion");
    expect(wordIn("es", "Status")).toBe("Estado");
    expect(wordIn("fa", "Status")).not.toBe("Status");
    // Spanish Network, looked up again; German Default, looked up again.
    expect([wordIn("es", "Network"), wordIn("es", "Red")]).toEqual([
      "Red",
      "Rojo",
    ]);
    expect([wordIn("de", "Default"), wordIn("de", "Standard")]).toEqual([
      "Standard",
      "Normal",
    ]);
  });
});

describe("a label's description, in its hover tip", () => {
  test.each([
    ["de", "Production"],
    ["es", "Status"],
    ["fa", "Status"],
  ])(
    "%s: reads as its owner wrote it, %s, never as the key it matches",
    (language: string, description: string) => {
      renderIn(
        language,
        <LabelElement label={labelWith("Network", description)} />,
      );

      expect(pillText()).toBe("Network");
      expect(hoverTip()).toBe(description);
    },
  );
});

describe("a tooltip", () => {
  test("looks its English up once, and draws words it is told are as written as given", () => {
    renderIn(
      "es",
      <div>
        <Tooltip text="Status">
          <span data-testid="looked-up">a</span>
        </Tooltip>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByTestId("looked-up"));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Estado");
    cleanup();

    renderIn(
      "es",
      <div>
        <Tooltip text="Status" isTextUserContent={true}>
          <span data-testid="as-written">a</span>
        </Tooltip>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByTestId("as-written"));

    expect(screen.getByRole("tooltip")).toHaveTextContent(/^Status$/);
  });
});

describe("a badge given words already in the reader's language", () => {
  test.each([
    // Spanish Network, which is another key.
    ["es", "Red"],
    // German Default, which is another key.
    ["de", "Standard"],
    // Persian Connected.
    ["fa", wordIn("fa", "Connected")],
  ])(
    "%s: draws %s unchanged, its text and its hover tip",
    (language: string, words: string) => {
      renderIn(
        language,
        <Pill
          text={words}
          isUserContent={true}
          tooltip={words}
          isTooltipUserContent={true}
          color={GREEN}
        />,
      );

      expect(pillText()).toBe(words);
      expect(hoverTip()).toBe(words);
    },
  );

  test("es: looked up again, it would read another word - what the marks are for", () => {
    renderIn("es", <Pill text="Red" tooltip="Red" color={GREEN} />);

    expect(pillText()).toBe("Rojo");
    expect(hoverTip()).toBe("Rojo");
  });
});

/*
 * The Dashboard's own badges, worded once: in Spanish, and with each of
 * their Spanish words made a key that reads "Rojo", as "Red" is.
 */
describe("the Dashboard's badges, in Spanish", () => {
  const TWICE: string = "Rojo";

  // Each Spanish word, made a key of its own.
  const probe: (english: Array<string>) => Record<string, string> = (
    english: Array<string>,
  ): Record<string, string> => {
    return Object.fromEntries(
      english.map((text: string): [string, string] => {
        return [wordIn("es", text), TWICE];
      }),
    );
  };

  test("a Runner's status bubble says its status once, with what comes after it", () => {
    renderIn(
      "es",
      <RunnerLiveStatusBubble
        status={RunnerLiveStatus.Connected}
        suffix="2 min"
      />,
      probe(["Connected"]),
    );

    expect(document.body).toHaveTextContent(
      `${wordIn("es", "Connected")} · 2 min`,
    );
    expect(document.body).not.toHaveTextContent(TWICE);
  });

  test.each([
    [RunnerLiveStatus.Connected, "Connected"],
    [RunnerLiveStatus.NeverConnected, "Never connected"],
    [RunnerLiveStatus.Disconnected, "Disconnected"],
  ])(
    "a Runner's %s bubble, its status alone, says it once",
    (status: RunnerLiveStatus, english: string) => {
      renderIn(
        "es",
        <RunnerLiveStatusBubble status={status} />,
        probe([english]),
      );

      expect(document.body).toHaveTextContent(wordIn("es", english));
      expect(document.body).not.toHaveTextContent(TWICE);
    },
  );

  test.each([
    [
      "Currently Active",
      <CurrentlyActiveIndicator key="active" />,
      CURRENTLY_ACTIVE_TEXT,
    ],
    [
      "Monitoring Off",
      <MonitoringOffIndicator key="off" />,
      MONITORING_OFF_TEXT,
    ],
  ])(
    "the timeline's %s goes over in English and is looked up once",
    (_name: string, element: ReactElement, english: string) => {
      renderIn("es", element, probe([english]));

      expect(pillText()).toBe(wordIn("es", english));
    },
  );

  test("data security's sensitivity and exposure say their hover tips once", () => {
    const sensitivityTip: string =
      DATA_SENSITIVITY_DESCRIPTION[DataSensitivity.Restricted];

    renderIn(
      "es",
      <SensitivityPill sensitivity={DataSensitivity.Restricted} />,
      probe([sensitivityTip]),
    );

    expect(hoverTip()).toBe(wordIn("es", sensitivityTip));
    cleanup();

    const exposureTip: string =
      DATA_STORE_EXPOSURE_DESCRIPTION[DataStoreExposure.Public];

    renderIn(
      "es",
      <ExposurePill exposure={DataStoreExposure.Public} />,
      probe([exposureTip]),
    );

    expect(hoverTip()).toBe(wordIn("es", exposureTip));
  });
});
