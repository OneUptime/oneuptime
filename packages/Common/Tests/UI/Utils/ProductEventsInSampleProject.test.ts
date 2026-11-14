import Project from "../../../Models/DatabaseModels/Project";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import UiAnalytics from "../../../UI/Utils/Analytics";
import ProductEvents, {
  SAMPLE_PROJECT_EVENTS,
} from "../../../UI/Utils/ProductEvents";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A SAMPLE PROJECT IS NO ACTIVATION (issue #6808): nothing done inside one
 * sends a Dashboard product event - no checklist step, no guided setup, no
 * "How it works" - except the sample's own two, so the activation funnel
 * never counts a made-up project. Every other project sends as before.
 */

const project: (isSampleProject: boolean) => Project = (
  isSampleProject: boolean,
): Project => {
  const row: Project = new Project();
  row._id = "5a3c0000-0000-4000-8000-0000000000a1";
  row.isSampleProject = isSampleProject;
  return row;
};

let capture: SpyInstance<typeof UiAnalytics.capture>;

beforeEach(() => {
  capture = jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProductEvents in a sample project", () => {
  test("sends nothing done inside one", () => {
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project(true));

    ProductEvents.send(ProductEventName.GoalsChosen, { goals: "explore" });
    ProductEvents.send(ProductEventName.GuidedSetupStarted, {
      setup: "website_down",
    });
    ProductEvents.send(ProductEventName.HowItWorksOpened, {
      product: "oneuptime",
    });

    expect(ProductEvents.isInSampleProject()).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });

  test("sends the sample's own events", () => {
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project(true));

    ProductEvents.send(ProductEventName.SampleProjectDeleted, { days_kept: 2 });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![0]).toBe(
      ProductEventName.SampleProjectDeleted,
    );
    expect(SAMPLE_PROJECT_EVENTS).toEqual([
      ProductEventName.SampleProjectStarted,
      ProductEventName.SampleProjectDeleted,
    ]);
  });

  test("a real project sends as before", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue(project(false));

    ProductEvents.send(ProductEventName.GoalsChosen, { goals: "uptime" });

    expect(ProductEvents.isInSampleProject()).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("with no project, a page outside any (the No projects page) sends as before", () => {
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);

    ProductEvents.send(ProductEventName.SampleProjectStarted, {
      from: "welcome",
      is_new: true,
    });

    expect(capture).toHaveBeenCalledTimes(1);
  });
});
