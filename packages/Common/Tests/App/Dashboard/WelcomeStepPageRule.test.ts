import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  WELCOME_STEPS,
  WelcomeStepEntry,
  getWelcomeStepEntry,
  getWelcomeStepPage,
  getWelcomeStepRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { WelcomeStep } from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import PermissionGate, {
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * WHERE EACH WELCOME CHECKLIST STEP LEADS, BY THE RULE THE DOCS STATE
 * (issue #7144).
 *
 * The docs' welcome checklist table (introduction/home.md, in 17
 * languages) says what each step opens, and App's IntroductionDocsFacts
 * reads that from the catalog's declarations - guidedSetupPage,
 * guidedSetupModelType, createPage and pageMap - by this rule:
 *
 *   - someone who may create what the step asks for goes to its guided
 *     setup, else its create page, else today's page;
 *   - anyone else goes to today's page, unless the step names no model to
 *     create (neither a create page nor a guided setup model) - then
 *     everyone goes where the first person does.
 *
 * This runs getWelcomeStepPage on every step of the catalog, for someone
 * who may create anything and for someone who may create nothing, and holds
 * it to that rule, so the docs test's reading of the declarations is the
 * page the click opens. GettingStartedTaskRoutes clicks the steps one by
 * one; this covers every step the catalog has, and any it gains.
 */

const PROJECT_ID: string = "65f00000000000000000dddd";

// Which models the person may create: every model, none, or some by name.
let mayCreate: "all" | "none" | Array<string>;
let checkSpy: SpyInstance<typeof PermissionGate.check>;

beforeEach(() => {
  mayCreate = "all";
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  checkSpy = jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (model: PermissionCheckableModel): PermissionGateResult => {
        const allowed: boolean =
          mayCreate === "all" ||
          (Array.isArray(mayCreate) &&
            mayCreate.includes(model.constructor.name));

        return allowed
          ? { isAllowed: true }
          : { isAllowed: false, disabledReason: "Not allowed here." };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The model a step gates on, as the docs test reads it.
function gateModelOf(
  entry: WelcomeStepEntry,
): { new (): PermissionCheckableModel } | undefined {
  return entry.createPage?.modelType || entry.guidedSetupModelType;
}

// The rule the docs state, from the step's declarations alone.
function declaredPage(entry: WelcomeStepEntry, may: boolean): PageMap | null {
  const forCreators: PageMap | null =
    entry.guidedSetupPage || entry.createPage?.pageMap || entry.pageMap || null;

  if (!gateModelOf(entry) || may) {
    return forCreators;
  }

  return entry.pageMap || null;
}

describe("every step leads where its declarations say", () => {
  test.each(
    WELCOME_STEPS.map((entry: WelcomeStepEntry): [WelcomeStep] => {
      return [entry.step];
    }),
  )("%s, for someone who may create what it asks for", (step: WelcomeStep) => {
    const entry: WelcomeStepEntry = getWelcomeStepEntry(step);

    mayCreate = "all";

    expect(getWelcomeStepPage(entry)).toBe(declaredPage(entry, true));
  });

  test.each(
    WELCOME_STEPS.map((entry: WelcomeStepEntry): [WelcomeStep] => {
      return [entry.step];
    }),
  )("%s, for someone who may create nothing", (step: WelcomeStep) => {
    const entry: WelcomeStepEntry = getWelcomeStepEntry(step);

    mayCreate = "none";

    expect(getWelcomeStepPage(entry)).toBe(declaredPage(entry, false));
  });

  test("a step that names no model to create asks no permission and sends everyone alike", () => {
    const ungated: Array<WelcomeStepEntry> = WELCOME_STEPS.filter(
      (entry: WelcomeStepEntry): boolean => {
        return !gateModelOf(entry);
      },
    );

    expect(ungated.length).toBeGreaterThan(0);

    for (const entry of ungated) {
      mayCreate = "all";
      checkSpy.mockClear();
      const forAll: PageMap | null = getWelcomeStepPage(entry);

      expect({ step: entry.step, asked: checkSpy.mock.calls.length }).toEqual({
        step: entry.step,
        asked: 0,
      });

      mayCreate = "none";

      expect({ step: entry.step, page: getWelcomeStepPage(entry) }).toEqual({
        step: entry.step,
        page: forAll,
      });
    }
  });

  test("a step that names a model asks about creating exactly that model", () => {
    const gated: Array<WelcomeStepEntry> = WELCOME_STEPS.filter(
      (entry: WelcomeStepEntry): boolean => {
        return Boolean(gateModelOf(entry));
      },
    );

    expect(
      gated.map((entry: WelcomeStepEntry): [WelcomeStep, string] => {
        return [entry.step, gateModelOf(entry)!.name];
      }),
    ).toEqual([
      [WelcomeStep.Monitor, "Monitor"],
      [WelcomeStep.StatusPage, "StatusPage"],
    ]);

    for (const entry of gated) {
      // Allowed to create everything but this step's model: today's page.
      mayCreate = ["Monitor", "StatusPage"].filter((name: string): boolean => {
        return name !== gateModelOf(entry)!.name;
      });

      expect({ step: entry.step, page: getWelcomeStepPage(entry) }).toEqual({
        step: entry.step,
        page: entry.pageMap,
      });

      // Allowed to create only this step's model: its guided setup.
      mayCreate = [gateModelOf(entry)!.name];

      expect({ step: entry.step, page: getWelcomeStepPage(entry) }).toEqual({
        step: entry.step,
        page: entry.guidedSetupPage,
      });
    }
  });
});

describe("the guided setups the docs name", () => {
  /*
   * The four steps the docs table says open a guided setup, and the two of
   * them that send someone who may not create the record to a list.
   */
  test("four steps open a guided setup, and two only for who may create its record", () => {
    const rows: Array<[WelcomeStep, PageMap | null, PageMap | null]> =
      WELCOME_STEPS.filter((entry: WelcomeStepEntry): boolean => {
        return Boolean(entry.guidedSetupPage);
      }).map(
        (
          entry: WelcomeStepEntry,
        ): [WelcomeStep, PageMap | null, PageMap | null] => {
          mayCreate = "all";
          const forCreators: PageMap | null = getWelcomeStepPage(entry);

          mayCreate = "none";

          return [entry.step, forCreators, getWelcomeStepPage(entry)];
        },
      );

    expect(rows).toEqual([
      [WelcomeStep.Monitor, PageMap.MONITOR_GUIDED_SETUP, PageMap.MONITORS],
      [
        WelcomeStep.Telemetry,
        PageMap.SERVICES_GUIDED_SETUP,
        PageMap.SERVICES_GUIDED_SETUP,
      ],
      [
        WelcomeStep.OnCall,
        PageMap.ON_CALL_DUTY_GUIDED_SETUP,
        PageMap.ON_CALL_DUTY_GUIDED_SETUP,
      ],
      [
        WelcomeStep.StatusPage,
        PageMap.STATUS_PAGES_GUIDED_SETUP,
        PageMap.STATUS_PAGES,
      ],
    ]);
  });

  test("Create Monitor is no longer where the monitor step leads, for anyone", () => {
    const monitor: WelcomeStepEntry = getWelcomeStepEntry(WelcomeStep.Monitor);

    for (const who of ["all", "none"] as const) {
      mayCreate = who;

      expect(getWelcomeStepPage(monitor)).not.toBe(PageMap.MONITOR_CREATE);
    }
  });

  test("a guided setup opens at its own address, with no query", () => {
    for (const entry of WELCOME_STEPS) {
      if (!entry.guidedSetupPage) {
        continue;
      }

      mayCreate = "all";

      const route: Route | null = getWelcomeStepRoute(entry);

      expect({ step: entry.step, route: route?.toString() }).toEqual({
        step: entry.step,
        route: (RouteMap[entry.guidedSetupPage] as Route)
          .toString()
          .replace(":projectId", PROJECT_ID),
      });
    }
  });
});
