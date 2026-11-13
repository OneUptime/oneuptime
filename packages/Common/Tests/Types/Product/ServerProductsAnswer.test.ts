import ProductKey from "../../../Types/Product/ProductKey";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
  parseProjectProductsAnswer,
  parseServerProductsOff,
  toProjectProductsAnswerJSON,
} from "../../../Types/Product/ProjectProductsAnswer";
import {
  ServerProductOffReason,
  ServerProductsPreset,
} from "../../../Types/Product/ServerProducts";
import {
  SERVER_PRODUCTS_ROUTE,
  ServerProductsAnswer,
  ServerProductsSource,
  parseServerProductsAnswer,
  toServerProductsAnswerJSON,
} from "../../../Types/Product/ServerProductsAnswer";
import { describe, expect, test } from "@jest/globals";

/*
 * What the server says about the products it switched off (#6815): in every
 * project's products answer (offOnServer), and on Admin Dashboard >
 * Settings > Products (ServerProductsAnswer). Both are read safely: what is
 * not known reads as on.
 */

describe("the products answer's offOnServer", () => {
  test("is empty before an answer: every product on", () => {
    expect(getEmptyProjectProductsAnswer().offOnServer).toEqual({});
  });

  test("keeps known products a server can switch off, with a known reason", () => {
    expect(
      parseServerProductsOff({
        [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
        [ProductKey.Alerts]: ServerProductOffReason.SwitchedOff,
        [ProductKey.ProjectSettings]: ServerProductOffReason.SwitchedOff,
        [ProductKey.Monitors]: "hidden",
        "not-a-product": ServerProductOffReason.SwitchedOff,
      }),
    ).toEqual({
      [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
      [ProductKey.Alerts]: ServerProductOffReason.SwitchedOff,
    });
  });

  test("reads anything that is not an object as nothing off", () => {
    expect(parseServerProductsOff(null)).toEqual({});
    expect(parseServerProductsOff([ProductKey.Logs])).toEqual({});
    expect(parseServerProductsOff("logs")).toEqual({});
  });

  test("an answer from before #6815, with no offOnServer, reads as every product on", () => {
    const answer: ProjectProductsAnswer | null = parseProjectProductsAnswer({
      hidden: [ProductKey.Logs],
      pinned: [],
    });

    expect(answer?.offOnServer).toEqual({});
  });

  test("goes through JSON unchanged", () => {
    const answer: ProjectProductsAnswer = {
      ...getEmptyProjectProductsAnswer(),
      hidden: [ProductKey.Traces],
      offOnServer: {
        [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
        [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
      },
    };

    expect(
      parseProjectProductsAnswer(
        JSON.parse(JSON.stringify(toProjectProductsAnswerJSON(answer))),
      ),
    ).toEqual(answer);
  });
});

describe("the Admin Dashboard's answer", () => {
  const answer: ServerProductsAnswer = {
    off: {
      [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
      [ProductKey.Alerts]: ServerProductOffReason.SwitchedOff,
    },
    switchedOff: [ProductKey.Alerts],
    preset: null,
    source: ServerProductsSource.Saved,
    startingValue: "monitoring-and-status-pages",
    startingValueUnknownNames: ["logz"],
    isTelemetryIngestionStopped: true,
    shouldSuggestStoppingIngestion: false,
    changedAt: "2026-11-12T10:00:00.000Z",
  };

  test("lives under the global config's routes", () => {
    expect(SERVER_PRODUCTS_ROUTE).toBe("/global-config/server-products");
  });

  test("goes through JSON unchanged", () => {
    expect(
      parseServerProductsAnswer(
        JSON.parse(JSON.stringify(toServerProductsAnswerJSON(answer))),
      ),
    ).toEqual(answer);
  });

  test("reads what it does not know safely", () => {
    expect(parseServerProductsAnswer(null)).toBeNull();
    expect(parseServerProductsAnswer([])).toBeNull();

    expect(
      parseServerProductsAnswer({
        off: { [ProductKey.Users]: ServerProductOffReason.SwitchedOff },
        switchedOff: [ProductKey.Teams, ProductKey.Logs, "nope"],
        preset: "almost-everything",
        source: "somewhere",
        startingValue: 3,
        startingValueUnknownNames: ["ok", 4],
        isTelemetryIngestionStopped: "yes",
        shouldSuggestStoppingIngestion: 1,
        changedAt: 5,
      }),
    ).toEqual({
      off: {},
      switchedOff: [ProductKey.Logs],
      preset: null,
      source: ServerProductsSource.StartingValue,
      startingValue: "",
      startingValueUnknownNames: ["ok"],
      isTelemetryIngestionStopped: false,
      shouldSuggestStoppingIngestion: false,
      changedAt: null,
    });
  });

  test("keeps a preset it knows", () => {
    expect(
      parseServerProductsAnswer({
        ...toServerProductsAnswerJSON(answer),
        preset: ServerProductsPreset.IncidentResponse,
      })?.preset,
    ).toBe(ServerProductsPreset.IncidentResponse);
  });
});
