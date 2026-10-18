import MonitorStep, {
  SYNTHETIC_MONITOR_BROWSER_REQUIRED_MESSAGE,
  SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES,
  SYNTHETIC_MONITOR_DEFAULT_SCREEN_SIZE_TYPES,
  SYNTHETIC_MONITOR_SCREEN_SIZE_REQUIRED_MESSAGE,
} from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import BrowserType from "../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A Synthetic monitor runs its script once for each browser and screen size
 * picked (Probe SyntheticMonitor.execute loops over both lists). Its form
 * used to open with every box unticked, and nothing refused a step saved
 * that way - a monitor that ran nothing, never failed, and looked healthy
 * for good.
 *
 * A new Synthetic step now starts in Chromium at a desktop size, and a
 * step with either list empty is refused with a message saying what to
 * pick. Every other type is left exactly as it was.
 */

type DefaultStepArgs = Parameters<typeof MonitorStep.getDefaultMonitorStep>[0];

const buildArgs: (monitorType: MonitorType) => DefaultStepArgs = (
  monitorType: MonitorType,
): DefaultStepArgs => {
  const id: ObjectID = ObjectID.generate();

  return {
    monitorName: `${monitorType} monitor`,
    monitorType: monitorType,
    onlineMonitorStatusId: id,
    offlineMonitorStatusId: id,
    defaultIncidentSeverityId: id,
    defaultAlertSeverityId: id,
  };
};

// A new Synthetic step with a script, the one other thing it needs.
const buildSyntheticStep: () => MonitorStep = (): MonitorStep => {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
    buildArgs(MonitorType.SyntheticMonitor),
  );
  step.setCustomCode("await page.goto('https://example.com');");
  return step;
};

describe("a new Synthetic monitor runs its script somewhere", () => {
  test("it starts in Chromium at a desktop size", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.SyntheticMonitor),
    );

    expect(step.data?.browserTypes).toEqual([BrowserType.Chromium]);
    expect(step.data?.screenSizeTypes).toEqual([ScreenSizeType.Desktop]);
    expect(SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES).toEqual([
      BrowserType.Chromium,
    ]);
    expect(SYNTHETIC_MONITOR_DEFAULT_SCREEN_SIZE_TYPES).toEqual([
      ScreenSizeType.Desktop,
    ]);
  });

  test("each new step gets its own lists, so ticking one never changes the defaults", () => {
    const first: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.SyntheticMonitor),
    );
    first.data?.browserTypes?.push(BrowserType.Firefox);
    first.data?.screenSizeTypes?.push(ScreenSizeType.Mobile);

    const second: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.SyntheticMonitor),
    );

    expect(second.data?.browserTypes).toEqual([BrowserType.Chromium]);
    expect(second.data?.screenSizeTypes).toEqual([ScreenSizeType.Desktop]);
    expect(SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES).toEqual([
      BrowserType.Chromium,
    ]);
  });

  test("the defaults survive the round trip a saved monitor takes", () => {
    const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
      ...buildArgs(MonitorType.SyntheticMonitor),
      defaultMonitorStatusId: ObjectID.generate(),
    });

    const reread: MonitorSteps = MonitorSteps.fromJSON(steps.toJSON());
    const step: MonitorStep | undefined =
      reread.data?.monitorStepsInstanceArray[0];

    expect(step?.data?.browserTypes).toEqual([BrowserType.Chromium]);
    expect(step?.data?.screenSizeTypes).toEqual([ScreenSizeType.Desktop]);
  });

  test.each(
    Object.values(MonitorType).filter((type: MonitorType) => {
      return type !== MonitorType.SyntheticMonitor;
    }),
  )("a new %s step has neither list, as before", (monitorType: MonitorType) => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(monitorType),
    );

    expect(step.data?.browserTypes).toBeUndefined();
    expect(step.data?.screenSizeTypes).toBeUndefined();
  });
});

describe("a Synthetic step that would run nothing cannot be saved", () => {
  test("a new step with a script is valid as it stands", () => {
    expect(
      MonitorStep.getValidationError(
        buildSyntheticStep(),
        MonitorType.SyntheticMonitor,
      ),
    ).toBeNull();
  });

  test.each([[undefined], [[]]])(
    "no browser (%p) is refused, naming what to pick",
    (browserTypes: Array<BrowserType> | undefined) => {
      const step: MonitorStep = buildSyntheticStep();
      step.data!.browserTypes = browserTypes;

      expect(
        MonitorStep.getValidationError(step, MonitorType.SyntheticMonitor),
      ).toBe(SYNTHETIC_MONITOR_BROWSER_REQUIRED_MESSAGE);
    },
  );

  test.each([[undefined], [[]]])(
    "no screen size (%p) is refused, naming what to pick",
    (screenSizeTypes: Array<ScreenSizeType> | undefined) => {
      const step: MonitorStep = buildSyntheticStep();
      step.data!.screenSizeTypes = screenSizeTypes;

      expect(
        MonitorStep.getValidationError(step, MonitorType.SyntheticMonitor),
      ).toBe(SYNTHETIC_MONITOR_SCREEN_SIZE_REQUIRED_MESSAGE);
    },
  );

  test("the script is asked for first: a step with no code says so before anything else", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.SyntheticMonitor),
    );
    step.data!.browserTypes = [];

    expect(
      MonitorStep.getValidationError(step, MonitorType.SyntheticMonitor),
    ).toBe("Playwright code is required.");
  });

  test("any browser and any size will do", () => {
    const step: MonitorStep = buildSyntheticStep();
    step.data!.browserTypes = [BrowserType.Firefox];
    step.data!.screenSizeTypes = [ScreenSizeType.Mobile, ScreenSizeType.Tablet];

    expect(
      MonitorStep.getValidationError(step, MonitorType.SyntheticMonitor),
    ).toBeNull();
  });

  test("the rule is the Synthetic monitor's alone: Custom Code needs no browser", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.CustomJavaScriptCode),
    );
    step.setCustomCode("return { data: 1 };");

    expect(step.data?.browserTypes).toBeUndefined();
    expect(
      MonitorStep.getValidationError(step, MonitorType.CustomJavaScriptCode),
    ).toBeNull();
  });

  test("the messages say what to pick, in a sentence", () => {
    expect(SYNTHETIC_MONITOR_BROWSER_REQUIRED_MESSAGE).toBe(
      "Pick at least one browser to run the script in.",
    );
    expect(SYNTHETIC_MONITOR_SCREEN_SIZE_REQUIRED_MESSAGE).toBe(
      "Pick at least one screen size to run the script at.",
    );
  });
});
