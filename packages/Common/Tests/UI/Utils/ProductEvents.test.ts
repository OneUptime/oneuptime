import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * The Dashboard's behaviour events (issue #6830): ProductEvents.send, the
 * Welcome checklist's events (ChecklistEvents) and a guided setup's
 * (GuidedSetupEvents). What reaches UiAnalytics.capture is what would be
 * sent: only the properties the catalog lists, the common ones added, the
 * words of a search only on Cloud - and never an error on the page.
 */

const captureMock: Mock<(name: string, data?: unknown) => void> =
  jest.fn<(name: string, data?: unknown) => void>();

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (name: string, data?: unknown): void => {
        captureMock(name, data);
      },
    },
  };
});

import ProductEvents from "../../../UI/Utils/ProductEvents";
import ChecklistEvents from "../../../UI/Utils/ChecklistEvents";
import { GuidedSetupEvents } from "../../../UI/Utils/GuidedSetupEvents";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import Project from "../../../Models/DatabaseModels/Project";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "6d1f6a37-6a2c-4c8c-9a1f-6f1e2a3b4c5d";
const USER_ID: string = "0a0b0c0d-1111-4222-8333-944455556666";

// OneUptime Cloud, or a self-hosted edition, as each test says.
let isCloud: boolean = true;
let isEnterprise: boolean = false;

const lastEvent: () => { name: string; data: JSONObject } = (): {
  name: string;
  data: JSONObject;
} => {
  const call: Array<unknown> = captureMock.mock.calls[
    captureMock.mock.calls.length - 1
  ] as Array<unknown>;

  return { name: call[0] as string, data: call[1] as JSONObject };
};

const eventNames: () => Array<string> = (): Array<string> => {
  return captureMock.mock.calls.map((call: Array<unknown>): string => {
    return call[0] as string;
  });
};

describe("ProductEvents", () => {
  beforeEach(() => {
    isCloud = true;
    isEnterprise = false;
    captureMock.mockReset();
    localStorage.clear();
    document.documentElement.lang = "de";

    const project: Project = new Project();
    project.createdByUserId = new ObjectID(USER_ID);

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Growth);
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
    jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
    jest.spyOn(ProductEvents, "isCloud").mockImplementation((): boolean => {
      return isCloud;
    });
    jest
      .spyOn(ProductEvents, "isEnterpriseEdition")
      .mockImplementation((): boolean => {
        return isEnterprise;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("send", () => {
    test("sends the event with what every event carries, and only the properties its catalog entry lists", () => {
      ProductEvents.send(ProductEventName.ImporterOpened, {
        from: "Home",
        project_name: "Acme",
        email: "someone@example.com",
      });

      expect(lastEvent()).toEqual({
        name: "importer/opened",
        data: {
          project_id: PROJECT_ID,
          plan: PlanType.Growth,
          edition: "cloud",
          language: "de",
          is_project_creator: true,
          from: "home",
        },
      });
    });

    test("the words of a search go only from Cloud, cut short; the count goes everywhere", () => {
      const words: string =
        "how do I page the person on call by phone at night";

      ProductEvents.send(ProductEventName.SearchFoundNothing, {
        source: "command_palette",
        query_length: words.length,
        query: words,
      });

      expect(lastEvent().data["query"]).toBe(words.slice(0, 40));
      expect(lastEvent().data["query_length"]).toBe(words.length);

      isCloud = false;

      ProductEvents.send(ProductEventName.SearchFoundNothing, {
        source: "command_palette",
        query_length: words.length,
        query: words,
      });

      expect("query" in lastEvent().data).toBe(false);
      expect(lastEvent().data["query_length"]).toBe(words.length);
      expect(lastEvent().data["edition"]).toBe("community");
    });

    test("the edition is cloud, enterprise or community", () => {
      expect(ProductEvents.getEdition()).toBe("cloud");

      isCloud = false;
      isEnterprise = true;
      expect(ProductEvents.getEdition()).toBe("enterprise");

      isEnterprise = false;
      expect(ProductEvents.getEdition()).toBe("community");
    });

    test("a member who did not create the project is not its creator; an unknown creator says nothing", () => {
      jest
        .spyOn(UserUtil, "getUserId")
        .mockReturnValue(new ObjectID("11111111-2222-4333-8444-555555555555"));

      expect(ProductEvents.getCommonProperties()["is_project_creator"]).toBe(
        false,
      );

      jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);

      expect("is_project_creator" in ProductEvents.getCommonProperties()).toBe(
        false,
      );
    });

    test("no plan reads as empty, no project leaves the project out, and no language reads as English", () => {
      jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(null);
      jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
      document.documentElement.lang = "";

      const common: JSONObject = ProductEvents.getCommonProperties();

      expect(common["plan"]).toBe("");
      expect("project_id" in common).toBe(false);
      expect(common["language"]).toBe("en");
    });

    test("never throws: not when the project cannot be read, not when analytics does", () => {
      jest.spyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
        throw new Error("storage is gone");
      });

      expect(() => {
        ProductEvents.send(ProductEventName.HowItWorksOpened, {
          product: "monitors",
        });
      }).not.toThrow();
      expect(lastEvent().data["product"]).toBe("monitors");

      captureMock.mockImplementation(() => {
        throw new Error("PostHog is down");
      });

      expect(() => {
        ProductEvents.send(ProductEventName.HowItWorksOpened, {
          product: "monitors",
        });
      }).not.toThrow();
    });
  });

  describe("ChecklistEvents", () => {
    const STEPS: Array<string> = ["monitor", "status-page", "team"];

    test("the first visit only remembers; a step done since is sent once; the last one finishes it", () => {
      ChecklistEvents.noteProgress({
        projectId: PROJECT_ID,
        current: { monitor: false, "status-page": false, team: true },
        stepKeys: STEPS,
      });

      expect(captureMock).not.toHaveBeenCalled();

      ChecklistEvents.noteProgress({
        projectId: PROJECT_ID,
        current: { monitor: true, "status-page": false, team: true },
        stepKeys: STEPS,
      });

      expect(eventNames()).toEqual(["home/checklist_step_completed"]);
      expect(lastEvent().data["step"]).toBe("monitor");

      // A reload sends nothing again.
      ChecklistEvents.noteProgress({
        projectId: PROJECT_ID,
        current: { monitor: true, "status-page": false, team: true },
        stepKeys: STEPS,
      });

      expect(captureMock).toHaveBeenCalledTimes(1);

      ChecklistEvents.noteProgress({
        projectId: PROJECT_ID,
        current: { monitor: true, "status-page": true, team: true },
        stepKeys: STEPS,
      });

      expect(eventNames()).toEqual([
        "home/checklist_step_completed",
        "home/checklist_step_completed",
        "home/checklist_finished",
      ]);
      expect(lastEvent().data["step_count"]).toBe(3);
    });

    test("each project is remembered on its own", () => {
      ChecklistEvents.noteProgress({
        projectId: PROJECT_ID,
        current: { monitor: false },
        stepKeys: STEPS,
      });
      ChecklistEvents.noteProgress({
        projectId: "another-project",
        current: { monitor: true },
        stepKeys: STEPS,
      });

      expect(captureMock).not.toHaveBeenCalled();
      expect(
        localStorage.getItem(ChecklistEvents.getSeenKey(PROJECT_ID)),
      ).toContain('"monitor":false');
    });

    test("what was kept unreadable is a first visit, not an error", () => {
      localStorage.setItem(ChecklistEvents.getSeenKey(PROJECT_ID), "[1,2]");

      expect(() => {
        ChecklistEvents.noteProgress({
          projectId: PROJECT_ID,
          current: { monitor: true },
          stepKeys: STEPS,
        });
      }).not.toThrow();
      expect(captureMock).not.toHaveBeenCalled();
    });
  });

  describe("GuidedSetupEvents", () => {
    test("started once, each new step once, then finished with the seconds it took - and nothing after", () => {
      let now: number = 1_000_000;
      const events: GuidedSetupEvents = new GuidedSetupEvents(
        "website_down",
        (): number => {
          return now;
        },
      );

      events.start();
      events.start();
      events.reachStep("address");
      events.reachStep("address");
      events.reachStep("who_to_tell");
      now += 95_000;
      events.finish();
      events.leave();
      events.reachStep("late");

      expect(eventNames()).toEqual([
        "guided_setup/started",
        "guided_setup/step_reached",
        "guided_setup/step_reached",
        "guided_setup/finished",
      ]);

      const steps: Array<JSONObject> = captureMock.mock.calls
        .filter((call: Array<unknown>): boolean => {
          return call[0] === "guided_setup/step_reached";
        })
        .map((call: Array<unknown>): JSONObject => {
          return call[1] as JSONObject;
        });

      expect(
        steps.map((step: JSONObject) => {
          return [step["step"], step["step_number"]];
        }),
      ).toEqual([
        ["address", 1],
        ["who_to_tell", 2],
      ]);
      expect(lastEvent().data["setup"]).toBe("website_down");
      expect(lastEvent().data["seconds_taken"]).toBe(95);
      expect(events.isFinishedOrLeft()).toBe(true);
    });

    test("left before its end says at which step, once", () => {
      const events: GuidedSetupEvents = new GuidedSetupEvents("status_page");

      events.start();
      events.reachStep("pick_monitors");
      events.leave();
      events.leave();
      events.finish();

      expect(eventNames()).toEqual([
        "guided_setup/started",
        "guided_setup/step_reached",
        "guided_setup/left",
      ]);
      expect(lastEvent().data).toEqual(
        expect.objectContaining({
          setup: "status_page",
          step: "pick_monitors",
          step_number: 1,
        }),
      );
    });

    test("a setup never started is never left", () => {
      const events: GuidedSetupEvents = new GuidedSetupEvents("telemetry");

      events.leave();

      expect(captureMock).not.toHaveBeenCalled();
    });
  });
});
