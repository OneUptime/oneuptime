import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import type { SpyInstance } from "jest-mock";
import { initReactI18next } from "react-i18next";
import EvaluationLogList, {
  isNotEvaluatedEvent,
  isSkippedRequestsEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import MonitorNotEvaluated from "../../../Server/Utils/Monitor/MonitorNotEvaluated";
import Route from "../../../Types/API/Route";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../Types/ObjectID";
import { MonitorPauseReason } from "../../../Utils/Monitor/MonitorPauseState";
import Navigation from "../../../UI/Utils/Navigation";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * WHAT REACHED A MONITOR THAT WAS NOT BEING CHECKED, IN ITS LOGS (#11141).
 *
 * A request, an email or an agent's report that reaches a paused, turned
 * off or archived monitor is listed in its Monitoring Logs as it came, not
 * evaluated (MonitorNotEvaluated). Its summary has no criteria and one event
 * that says why: drawn as a notice of its own, not as one of the
 * evaluation's actions - there was no evaluation - with the way to the
 * switch that keeps the monitor checked when an incident declared by hand
 * paused it. Every language words it.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const MONITOR_ID: string = "11141c00-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVALUATED_AT: Date = new Date("2026-11-25T03:06:50.000Z");

function summaryFor(reason: MonitorPauseReason): MonitorEvaluationSummary {
  return {
    evaluatedAt: EVALUATED_AT,
    criteriaResults: [],
    events: [MonitorNotEvaluated.getEvent(reason)],
  };
}

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of DASHBOARD_LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await readIn("en");
});

describe("a not-evaluated event", () => {
  test("is told apart from every other event", () => {
    const event: MonitorEvaluationEvent = MonitorNotEvaluated.getEvent(
      MonitorPauseReason.ManualIncident,
    );

    expect(isNotEvaluatedEvent(event)).toBe(true);
    expect(isSkippedRequestsEvent(event)).toBe(false);
    expect(
      isNotEvaluatedEvent({
        type: "incident-created",
        title: "Incident created",
      }),
    ).toBe(false);
  });

  test("is drawn as a notice, saying it was not evaluated and why", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summaryFor(MonitorPauseReason.ManualIncident)}
        monitorId={new ObjectID(MONITOR_ID)}
      />,
    );

    expect(screen.getByTestId("not-evaluated")).toBeInTheDocument();
    expect(screen.getByTestId("not-evaluated-title")).toHaveTextContent(
      "Not evaluated: monitoring is paused by an incident",
    );
    expect(screen.getByTestId("not-evaluated-message")).toHaveTextContent(
      "An incident declared by hand paused this monitor's checks",
    );
  });

  test("is no action of an evaluation: there was none", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summaryFor(MonitorPauseReason.ManualIncident)}
      />,
    );

    expect(screen.queryByText("Actions")).toBeNull();
  });

  test("paused by an incident, it opens the monitor's settings, where it can be kept checked", () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    render(
      <EvaluationLogList
        evaluationSummary={summaryFor(MonitorPauseReason.ManualIncident)}
        monitorId={new ObjectID(MONITOR_ID)}
      />,
    );

    fireEvent.click(screen.getByTestId("not-evaluated-open-settings"));

    expect(navigate).toHaveBeenCalledTimes(1);
    const route: string = (navigate.mock.calls[0]![0] as Route).toString();
    expect(route).toContain(MONITOR_ID);
    expect(route).toContain("settings");
  });

  test.each([
    MonitorPauseReason.ScheduledMaintenance,
    MonitorPauseReason.Disabled,
    MonitorPauseReason.Archived,
  ])(
    "for %s it says why, and offers no settings: no switch there keeps it checked",
    (reason: MonitorPauseReason) => {
      render(
        <EvaluationLogList
          evaluationSummary={summaryFor(reason)}
          monitorId={new ObjectID(MONITOR_ID)}
        />,
      );

      expect(screen.getByTestId("not-evaluated-title")).toHaveTextContent(
        MonitorNotEvaluated.getEvent(reason).title,
      );
      expect(screen.queryByTestId("not-evaluated-open-settings")).toBeNull();
    },
  );

  test("where the page does not know the monitor, there is no way to its settings", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summaryFor(MonitorPauseReason.ManualIncident)}
      />,
    );

    expect(screen.getByTestId("not-evaluated")).toBeInTheDocument();
    expect(screen.queryByTestId("not-evaluated-open-settings")).toBeNull();
  });
});

describe("in every language", () => {
  const reasons: Array<MonitorPauseReason> = [
    MonitorPauseReason.ManualIncident,
    MonitorPauseReason.ScheduledMaintenance,
    MonitorPauseReason.Disabled,
    MonitorPauseReason.Archived,
  ];

  test("every title and message is a key of en.json", () => {
    const english: Record<string, string> = readLocale("en");

    for (const reason of reasons) {
      const event: MonitorEvaluationEvent =
        MonitorNotEvaluated.getEvent(reason);

      expect(english[event.title]).toBe(event.title);
      expect(english[event.message!]).toBe(event.message);
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the title and the message in its own words",
    async (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      for (const reason of reasons) {
        const event: MonitorEvaluationEvent =
          MonitorNotEvaluated.getEvent(reason);

        expect(locale[event.title]).toBeTruthy();
        expect(locale[event.title]).not.toBe(event.title);
        expect(locale[event.message!]).toBeTruthy();
        expect(locale[event.message!]).not.toBe(event.message);
      }

      await readIn(language);

      render(
        <EvaluationLogList
          evaluationSummary={summaryFor(MonitorPauseReason.ManualIncident)}
          monitorId={new ObjectID(MONITOR_ID)}
        />,
      );

      expect(screen.getByTestId("not-evaluated-title").textContent).toBe(
        locale[
          MonitorNotEvaluated.getEvent(MonitorPauseReason.ManualIncident).title
        ],
      );
    },
  );
});
