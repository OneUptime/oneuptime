import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import EventItem, {
  TimelineItemType,
} from "../../../UI/Components/EventItem/EventItem";

/*
 * AN EVENT ON A STATUS PAGE NAMES ITS LABELS AND STATES AS THE PROJECT DID
 * (#7780).
 *
 * A status page's incident (EventItem) draws its labels and each change of
 * its state as a Pill, and the Pill looked every text up in the page's
 * language. The page's Spanish has words for "Navigation" and "Next", so a
 * label a project named "Navigation" read "Navegación", and a state it
 * named "Next" read "Siguiente" - the page had already put the state's
 * name in its reader's words (translateStatusName: a default name in
 * Spanish, the project's own as written), and the Pill looked it up again.
 * A label's name is drawn as written now, and so are the page's own words
 * for a state.
 */

const STATUS_PAGE_SPANISH: JSONObject = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/StatusPage/src/Locales/es.json",
    ),
    "utf8",
  ),
) as JSONObject;

const SLATE: Color = new Color("#64748b");
const GREEN: Color = new Color("#10b981");

// The status page's Spanish, as its pages read it.
function statusPageSpanish(): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: "es",
    fallbackLng: "es",
    resources: { es: { translation: STATUS_PAGE_SPANISH } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });

  return instance;
}

function incidentState(name: string, color: Color): IncidentState {
  const state: IncidentState = new IncidentState();
  state.name = name;
  state.color = color;

  return state;
}

function renderIncidentInSpanish(): HTMLElement {
  const { container } = render(
    <I18nextProvider i18n={statusPageSpanish()}>
      <EventItem
        eventTitle="Checkout is failing for some customers"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        isDetailItem={true}
        eventSecondDescription="Started 18:02 UTC"
        labels={[{ name: "Navigation", color: SLATE }]}
        eventTimeline={[
          {
            date: new Date("2026-09-14T18:12:00Z"),
            type: TimelineItemType.StateChange,
            icon: IconProp.Info,
            iconColor: SLATE,
            state: incidentState("Next", SLATE),
            // A project's own state, as translateStatusName gives it back.
            stateDisplayName: "Next",
          },
          {
            date: new Date("2026-09-14T18:40:00Z"),
            type: TimelineItemType.StateChange,
            icon: IconProp.CheckCircle,
            iconColor: GREEN,
            state: incidentState("Resolved", GREEN),
            // OneUptime's default, already in the page's Spanish.
            stateDisplayName: "Resuelto",
          },
        ]}
      />
    </I18nextProvider>,
  );

  return container;
}

function pillTextsIn(element: HTMLElement): Array<string> {
  return within(element)
    .getAllByTestId("pill-text")
    .map((text: HTMLElement): string => {
      return text.textContent || "";
    });
}

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("the status page's Spanish has words of its own for Navigation and Next", () => {
    expect([
      STATUS_PAGE_SPANISH["Navigation"],
      STATUS_PAGE_SPANISH["Next"],
    ]).toEqual(["Navegación", "Siguiente"]);
  });
});

describe("an incident on a Spanish status page", () => {
  test("a label named Navigation reads Navigation, never Navegación", () => {
    const container: HTMLElement = renderIncidentInSpanish();
    const labels: HTMLElement = container.querySelector(
      ".active-event-box-body-labels",
    ) as HTMLElement;

    expect(pillTextsIn(labels)).toEqual(["Navigation"]);
  });

  test("its states read as the page named them: the project's Next as written, the default Resolved in Spanish", () => {
    renderIncidentInSpanish();

    // The timeline, one state change a row.
    expect(pillTextsIn(screen.getByRole("list"))).toEqual(["Next", "Resuelto"]);
  });
});
