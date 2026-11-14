import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import { ProjectProductsChosenBy } from "../../../Types/Product/ProjectProducts";
import {
  PROJECT_PRODUCTS_PINS_ROUTE,
  PROJECT_PRODUCTS_ROUTE,
  PROJECT_PRODUCTS_VISIBILITY_ROUTE,
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
  parseProjectProductsAnswer,
  toProjectProductsAnswerJSON,
} from "../../../Types/Product/ProjectProductsAnswer";
import { describe, expect, test } from "@jest/globals";

/*
 * The one answer the Dashboard reads about a project's products (#6814):
 * what is sent and stored is read safely, so a bad value never hides
 * Project Settings or pins a product that does not exist.
 */

const ANSWER: ProjectProductsAnswer = {
  hidden: [ProductKey.Logs, ProductKey.Kubernetes],
  chosenBy: ProjectProductsChosenBy.Member,
  pinned: [ProductKey.Monitors, ProductKey.Logs],
  usage: {
    [ProductKey.Monitors]: ProductUsage.InUse,
    [ProductKey.Logs]: ProductUsage.InUse,
    [ProductKey.Incidents]: ProductUsage.NothingYet,
    [ProductKey.Kubernetes]: ProductUsage.NotSetUp,
  },
  neededPlans: { [ProductKey.Workflows]: PlanType.Growth },
  canChooseProducts: true,
  hiddenWithData: [ProductKey.Logs],
  offOnServer: {},
};

describe("the routes", () => {
  test("live under /project-products", () => {
    expect(PROJECT_PRODUCTS_ROUTE).toBe("/project-products");
    expect(PROJECT_PRODUCTS_VISIBILITY_ROUTE).toBe(
      "/project-products/visibility",
    );
    expect(PROJECT_PRODUCTS_PINS_ROUTE).toBe("/project-products/pins");
  });
});

describe("the answer", () => {
  test("an empty answer shows every product and pins none", () => {
    expect(getEmptyProjectProductsAnswer()).toEqual({
      hidden: [],
      chosenBy: null,
      pinned: [],
      usage: {},
      neededPlans: {},
      canChooseProducts: false,
      hiddenWithData: [],
      // Nothing switched off on the server (#6815).
      offOnServer: {},
    });
  });

  test("what is sent reads back the same", () => {
    expect(
      parseProjectProductsAnswer(
        JSON.parse(JSON.stringify(toProjectProductsAnswerJSON(ANSWER))),
      ),
    ).toEqual(ANSWER);
  });

  test("a value that is not an answer reads as null", () => {
    expect(parseProjectProductsAnswer(null)).toBeNull();
    expect(parseProjectProductsAnswer("answer")).toBeNull();
    expect(parseProjectProductsAnswer([ANSWER])).toBeNull();
  });

  test("anything unknown is left out", () => {
    expect(
      parseProjectProductsAnswer({
        hidden: ["logs", "nope", "project-settings"],
        chosenBy: "robot",
        pinned: ["logs", "logs", "nope", 4],
        usage: { logs: "in_use", monitors: "busy", nope: "in_use" },
        neededPlans: { workflows: "Growth", forms: "Platinum", nope: "Growth" },
        canChooseProducts: "yes",
        hiddenWithData: ["logs", "monitors"],
      }),
    ).toEqual({
      hidden: [ProductKey.Logs],
      chosenBy: null,
      pinned: [ProductKey.Logs],
      usage: { [ProductKey.Logs]: ProductUsage.InUse },
      neededPlans: { [ProductKey.Workflows]: PlanType.Growth },
      canChooseProducts: false,
      // Only a hidden product can be hidden with data.
      hiddenWithData: [ProductKey.Logs],
      offOnServer: {},
    });
  });

  test("a person's pins are five at most", () => {
    expect(
      parseProjectProductsAnswer({
        pinned: [
          "monitors",
          "incidents",
          "alerts",
          "on-call",
          "status-pages",
          "logs",
        ],
      })?.pinned,
    ).toHaveLength(5);
  });
});
