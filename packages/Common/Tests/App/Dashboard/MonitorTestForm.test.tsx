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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import Permission from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { BoxSpacing, resolveMargin } from "../../ResponsiveSpacing";

/*
 * https://github.com/OneUptime/oneuptime/issues/3867
 *
 * The "Test Monitor" form, RENDERED. It used to live only on the criteria
 * sub-page; issue #3867 puts it on the Monitor Overview, which is the page
 * every reader of a monitor lands on. That widening is what these cover:
 *
 *   - who is even offered the button (running a test CREATES a MonitorTest
 *     row, and the read audience of a monitor does not hold that permission);
 *   - what the created row carries - in particular monitorId, without which
 *     the server cannot resolve {{monitorSecrets.*}} and the probe silently
 *     tests a literal placeholder;
 *   - the poll that follows, which used to run to completion no matter what
 *     the user did next. Closing the result, running a second test, or
 *     leaving the page all left it fetching every fifteen seconds and calling
 *     setState on a component that might be gone. The overview page is the one
 *     people navigate away from, so that leak stops being theoretical.
 *
 * ModelAPI is replaced at the module boundary because MonitorTestForm imports
 * it directly; `create` and `getItem` are separate mocks so a count of polls
 * is a count of polls.
 */

const createMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

/*
 * Swapped per test. The gate reads this through PermissionUtil, so the default
 * is a user who may run a test; the tests that care set it to something else.
 */
let currentPermissions: Array<Permission> = [Permission.ProjectAdmin];
let isMasterAdmin: boolean = false;

// Lazy wrappers: jest.mock is hoisted above these declarations.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

const getForDraftMock: MockFunction = getJestMockFunction();

/*
 * Who is told, as the result's verdict reads it (#7074): the resolver's
 * answer for the monitor the test ran, stood in for.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
    );

    return {
      ...actual,
      __esModule: true,
      default: {
        getForDraft: (...args: Array<unknown>): unknown => {
          return getForDraftMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return currentPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import MonitorTestForm, {
  getStartingTestProbeId,
  MONITOR_TEST_MAX_POLL_ATTEMPTS,
  MONITOR_TEST_TIMED_OUT_MESSAGE,
  MONITOR_TEST_POLL_INTERVAL_IN_MS,
  toProbeIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTest";
import { getMonitorTestJudgement } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTestVerdict";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { MonitorEvaluationCriteriaResult } from "../../../Types/Monitor/MonitorEvaluationSummary";
import {
  WhoIsToldCriteria,
  WhoIsToldOwnersSource,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { MonitorStepProbeResponse } from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorTest from "../../../Models/DatabaseModels/MonitorTest";
import Probe from "../../../Models/DatabaseModels/Probe";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { ButtonSize } from "../../../UI/Components/Button/Button";

const MONITOR_ID: string = "11111111-1111-4111-8111-111111111111";
const TEST_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_PROBE_ID: string = "55555555-5555-4555-8555-555555555555";

function probe(id: string, name: string): Probe {
  return Object.assign(new Probe(), { _id: id, name: name });
}

const PROBES: Array<Probe> = [
  probe(PROBE_ID, "Ohio Probe"),
  probe(OTHER_PROBE_ID, "Frankfurt Probe"),
];

function steps(): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = { monitorStepsInstanceArray: [new MonitorStep()] };
  return monitorSteps;
}

// A finished test row: the shape the poll is waiting for.
function finishedRow(): MonitorTest {
  const response: MonitorStepProbeResponse = {
    "step-1": {
      probeId: new ObjectID(PROBE_ID),
      monitorId: new ObjectID(MONITOR_ID),
      monitorStepId: new ObjectID(TEST_ID),
      isOnline: true,
      responseTimeInMs: 42,
      responseCode: 200,
    },
  } as unknown as MonitorStepProbeResponse;

  return Object.assign(new MonitorTest(), {
    _id: TEST_ID,
    monitorStepProbeResponse: response,
  });
}

interface RenderOptions {
  monitorType?: MonitorType | undefined;
  probes?: Array<Probe> | undefined;
  // The create-monitor flow tests steps that belong to no monitor yet.
  withoutMonitorId?: boolean | undefined;
  preferredProbeIds?: Array<string> | undefined;
  monitorSteps?: MonitorSteps | undefined;
  monitorName?: string | undefined;
  labels?: Array<unknown> | undefined;
}

function renderForm(options: RenderOptions = {}): RenderResult {
  return render(
    <MonitorTestForm
      monitorId={
        options.withoutMonitorId ? undefined : new ObjectID(MONITOR_ID)
      }
      monitorSteps={options.monitorSteps || steps()}
      monitorType={options.monitorType || MonitorType.Website}
      probes={options.probes || PROBES}
      preferredProbeIds={options.preferredProbeIds}
      monitorName={options.monitorName}
      labels={options.labels}
      buttonSize={ButtonSize.Normal}
    />,
  );
}

// Lets a resolved promise land before anything is asserted.
async function flush(): Promise<void> {
  await act(async () => {});
}

async function tick(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(MONITOR_TEST_POLL_INTERVAL_IN_MS);
  });
}

async function clickTestMonitor(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("test-monitor-button"));
  });
}

/*
 * Picks a probe in the modal's dropdown and submits. react-select renders its
 * menu on ArrowDown, and the probe name is unique on the page at that moment,
 * so a global text lookup finds the option.
 */
async function runTestOnProbe(probeName: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  });

  await act(async () => {
    const option: HTMLElement = screen.getByText(probeName);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
  });

  await act(async () => {
    fireEvent.click(screen.getByText("Run Test"));
  });

  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  createMock.mockReset();
  getItemMock.mockReset();
  getForDraftMock.mockReset();
  currentPermissions = [Permission.ProjectAdmin];
  isMasterAdmin = false;
  createMock.mockResolvedValue({
    data: Object.assign(new MonitorTest(), { _id: TEST_ID }),
  });
  getItemMock.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("who is offered the button", () => {
  test("a user who may create a monitor test gets it", () => {
    renderForm();

    expect(screen.getByTestId("test-monitor-button")).toBeInTheDocument();
  });

  test("a read-only user does not", () => {
    /*
     * MonitorTest's create list excludes Viewer / MonitorViewer /
     * ReadProjectMonitor, but its read list includes them - so these users can
     * open every page the button now appears on. Before the gate they were
     * handed a button whose only possible outcome was a refusal, and only
     * after they had picked a probe and pressed Run Test.
     */
    currentPermissions = [Permission.Viewer];

    renderForm();

    expect(screen.queryByTestId("test-monitor-button")).not.toBeInTheDocument();
  });

  test("a user with only the read permission does not", () => {
    currentPermissions = [Permission.ReadProjectMonitor];

    renderForm();

    expect(screen.queryByTestId("test-monitor-button")).not.toBeInTheDocument();
  });

  test("CreateProjectMonitor on its own is enough", () => {
    currentPermissions = [Permission.CreateProjectMonitor];

    renderForm();

    expect(screen.getByTestId("test-monitor-button")).toBeInTheDocument();
  });

  test("nothing is offered before the permission snapshot has landed", () => {
    /*
     * Permissions arrive on a response header, so they are empty for the first
     * paint after a login or a project switch. Hidden, not disabled: a disabled
     * button would accuse a permitted user of lacking a permission they hold.
     */
    currentPermissions = [];

    renderForm();

    expect(screen.queryByTestId("test-monitor-button")).not.toBeInTheDocument();
  });

  test("a master admin is offered it regardless", () => {
    currentPermissions = [];
    isMasterAdmin = true;

    renderForm();

    expect(screen.getByTestId("test-monitor-button")).toBeInTheDocument();
  });

  test("a monitor type no probe runs is not offered it", () => {
    renderForm({ monitorType: MonitorType.Logs });

    expect(screen.queryByTestId("test-monitor-button")).not.toBeInTheDocument();
  });

  test("the hook order survives a monitor type that flips probeable-ness", () => {
    /*
     * The early return for a non-probeable type used to sit ABOVE this
     * component's useState calls, so one mounted instance rendering first with
     * a non-probeable type and then with a probeable one threw "Rendered more
     * hooks than during the previous render" and blanked the page. Nothing in
     * eslint catches that, and the overview page's loading gate was the only
     * reason it stayed dormant.
     */
    const view: RenderResult = render(
      <MonitorTestForm
        monitorSteps={steps()}
        monitorType={MonitorType.Logs}
        probes={PROBES}
        buttonSize={ButtonSize.Normal}
      />,
    );

    expect(screen.queryByTestId("test-monitor-button")).not.toBeInTheDocument();

    expect(() => {
      view.rerender(
        <MonitorTestForm
          monitorSteps={steps()}
          monitorType={MonitorType.Website}
          probes={PROBES}
          buttonSize={ButtonSize.Normal}
        />,
      );
    }).not.toThrow();

    expect(screen.getByTestId("test-monitor-button")).toBeInTheDocument();
  });
});

describe("choosing a probe", () => {
  test("the modal offers exactly the probes it was given", async () => {
    renderForm();
    await clickTestMonitor();

    expect(screen.getByText("Probe")).toBeInTheDocument();
    expect(screen.getByText("Where the check runs from.")).toBeInTheDocument();

    const combobox: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.keyDown(combobox, { key: "ArrowDown" });
    });

    expect(screen.getByText("Ohio Probe")).toBeInTheDocument();
    expect(screen.getByText("Frankfurt Probe")).toBeInTheDocument();
  });

  test("nothing is created until a probe is picked and the test is run", async () => {
    renderForm();
    await clickTestMonitor();

    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("what the created monitor test carries", () => {
  test("the monitor id, the steps, the type, the chosen probe and the queue flag", async () => {
    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Frankfurt Probe");

    expect(createMock).toHaveBeenCalledTimes(1);

    const request: { model: MonitorTest; modelType: unknown } = createMock.mock
      .calls[0]![0] as { model: MonitorTest; modelType: unknown };

    expect(request.modelType).toBe(MonitorTest);
    expect(request.model.monitorType).toBe(MonitorType.Website);
    expect(request.model.isInQueue).toBe(true);
    expect(request.model.probeId?.toString()).toBe(OTHER_PROBE_ID);
    expect(
      request.model.monitorSteps?.data?.monitorStepsInstanceArray,
    ).toHaveLength(1);

    /*
     * The one that fails silently if it is dropped: without monitorId the
     * server returns the test unchanged instead of resolving the monitor's
     * secrets, and the probe requests a literal {{monitorSecrets.x}}.
     */
    expect(request.model.monitorId?.toString()).toBe(MONITOR_ID);
  });

  test("a form used without a monitor id does not invent one", async () => {
    renderForm({ withoutMonitorId: true });
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    const request: { model: MonitorTest } = createMock.mock.calls[0]![0] as {
      model: MonitorTest;
    };

    expect(request.model.monitorId).toBeUndefined();
  });
});

describe("waiting for the probe to report", () => {
  test("polls the created row until a response arrives, then stops", async () => {
    getItemMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(finishedRow());

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    // Nothing is fetched before the first interval fires.
    expect(getItemMock).not.toHaveBeenCalled();

    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(2);

    // The answer landed, so the interval is done.
    await tick();
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });

  test("asks only for the response column, on the created row", async () => {
    getItemMock.mockResolvedValue(finishedRow());

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");
    await tick();

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };

    expect(request.modelType).toBe(MonitorTest);
    expect(request.id.toString()).toBe(TEST_ID);
    expect(request.select).toEqual({ monitorStepProbeResponse: true });
  });

  test("gives up after the attempt budget and says so", async () => {
    getItemMock.mockResolvedValue(null);

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    for (let i: number = 0; i <= MONITOR_TEST_MAX_POLL_ATTEMPTS; i++) {
      await tick();
    }

    expect(
      screen.getByText(MONITOR_TEST_TIMED_OUT_MESSAGE),
    ).toBeInTheDocument();

    const callsAtGiveUp: number = getItemMock.mock.calls.length;

    // And it really stopped rather than just reporting.
    await tick();
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(callsAtGiveUp);
  });

  test("a failing poll does not end a test that may still be coming", async () => {
    /*
     * The poll callback is async and runs long after the enclosing try/catch
     * has returned, so a rejection used to be an unhandled one - every fifteen
     * seconds, with the user still waiting the full budget either way.
     */
    getItemMock
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(finishedRow());

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    await tick();
    await tick();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText(MONITOR_TEST_TIMED_OUT_MESSAGE),
    ).not.toBeInTheDocument();
  });
});

describe("the poll does not outlive what the user is doing", () => {
  test("closing the result modal stops it", async () => {
    getItemMock.mockResolvedValue(null);

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText("Close"));
    });

    await tick();
    await tick();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("unmounting stops it", async () => {
    /*
     * The overview page is a tab people leave. An un-cleaned interval kept
     * fetching for two and a half minutes and setting state on a component
     * that was gone.
     */
    getItemMock.mockResolvedValue(null);

    const view: RenderResult = renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    view.unmount();

    await tick();
    await tick();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("leaving while the test is still being created starts no poll at all", async () => {
    /*
     * The gap the interval ref alone does not close: during the create round
     * trip there is no interval to cancel yet, so an unmount in that window
     * would have started a poll nothing owned.
     */
    let releaseCreate: (value: { data: MonitorTest }) => void = () => {};

    createMock.mockReturnValue(
      new Promise((resolve: (value: { data: MonitorTest }) => void) => {
        releaseCreate = resolve;
      }),
    );

    const view: RenderResult = renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    view.unmount();

    await act(async () => {
      releaseCreate({
        data: Object.assign(new MonitorTest(), { _id: TEST_ID }),
      });
    });

    await tick();
    await tick();

    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("a second test does not race the first", async () => {
    /*
     * Each run used to create its own interval with nothing stopping the
     * previous one, so two polls wrote to the same state and the loser could
     * overwrite a good result with its timeout message.
     */
    getItemMock.mockResolvedValue(null);

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText("Close"));
    });

    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");

    getItemMock.mockClear();

    // One live interval, so one fetch per tick - not two.
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});

// The open result dialog.
function resultDialog(): HTMLElement {
  const dialog: HTMLElement | null = screen
    .getByText("Monitor Test Result")
    .closest("[role='dialog']");

  expect(dialog).not.toBeNull();

  return dialog as HTMLElement;
}

describe("the result", () => {
  /*
   * It used to say "Probe: -": the result named no probe, though the person
   * had just picked one. It names the probe the test ran on, as the
   * monitor's Summary names the probe whose check it shows.
   */
  test("names the probe the test ran on", async () => {
    getItemMock.mockResolvedValue(finishedRow());

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Frankfurt Probe");
    await tick();

    expect(
      within(resultDialog()).getByText("Frankfurt Probe"),
    ).toBeInTheDocument();
    expect(
      within(resultDialog()).queryByText("Ohio Probe"),
    ).not.toBeInTheDocument();
  });

  test("names the probe of the test that ran last, not of the one before", async () => {
    getItemMock.mockResolvedValue(finishedRow());

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");
    await tick();

    expect(within(resultDialog()).getByText("Ohio Probe")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Close"));
    });

    await clickTestMonitor();
    await runTestOnProbe("Frankfurt Probe");
    await tick();

    expect(
      within(resultDialog()).getByText("Frankfurt Probe"),
    ).toBeInTheDocument();
    expect(
      within(resultDialog()).queryByText("Ohio Probe"),
    ).not.toBeInTheDocument();
  });
});

/*
 * Where the button sits. NORMAL Buttons once carried md:ml-3, a dialog
 * footer's gap, from md up; the box round this one took it back with a bare
 * -ml-3, which on a phone - where the button had no margin - pulled it 12px
 * past the left edge of everything else on Create Monitor's criteria step
 * (and of the card header it sits in on the criteria page). No Button
 * carries a margin now (#9128), and the box takes nothing back. Read the
 * way the cascade does (ResponsiveSpacing): jsdom has no stylesheet.
 */
describe("where the button sits", () => {
  function margins(width: number): { box: BoxSpacing; button: BoxSpacing } {
    const button: HTMLElement = screen.getByTestId("test-monitor-button");
    const box: HTMLElement = button.closest("div") as HTMLElement;

    return {
      box: resolveMargin(box.className, width),
      button: resolveMargin(button.className, width),
    };
  }

  test("on a phone, neither the button nor its box moves it off the gutter", () => {
    renderForm();

    for (const width of [320, 375, 390, 767]) {
      const { box, button } = margins(width);

      expect([width, box.left + button.left, box.right]).toEqual([width, 0, 0]);
    }
  });

  test("from md up too, neither the button nor its box carries a margin", () => {
    renderForm();

    for (const width of [768, 1024, 1280]) {
      const { box, button } = margins(width);

      expect([width, button.left, box.left + button.left, box.right]).toEqual([
        width,
        0,
        0,
        0,
      ]);
    }
  });
});

// The value the open dialog's probe picker shows, or null when it is empty.
function pickedProbeName(): string | null {
  const dialog: HTMLElement | null = screen
    .getByText("Test Monitor", { selector: "h3, h2, [id]" })
    .closest("[role='dialog']");
  const root: HTMLElement = (dialog as HTMLElement) || document.body;

  for (const name of ["Ohio Probe", "Frankfurt Probe", "Probe-1"]) {
    if (within(root).queryByText(name)) {
      return name;
    }
  }

  return null;
}

async function pressRunTest(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText("Run Test"));
  });

  await flush();
}

/*
 * #7985: Select Probe opened empty in a project with one probe, and with
 * the two probes the form had already picked. The walker opened the list to
 * pick the only entry in it.
 */
describe("the probe the test starts on", () => {
  test("one probe in the project: no picker, the dialog says which probe runs it, and Run Test runs there", async () => {
    renderForm({ probes: [probe(PROBE_ID, "Probe-1")] });
    await clickTestMonitor();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("test-monitor-only-probe")).toHaveTextContent(
      "The check runs from Probe-1.",
    );

    await pressRunTest();

    expect(createMock).toHaveBeenCalledTimes(1);

    const request: { model: MonitorTest } = createMock.mock.calls[0]![0] as {
      model: MonitorTest;
    };

    expect(request.model.probeId?.toString()).toBe(PROBE_ID);
  });

  test("two probes the form picked: the picker starts on the first, and Run Test runs there untouched", async () => {
    renderForm({ preferredProbeIds: [OTHER_PROBE_ID, PROBE_ID] });
    await clickTestMonitor();

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(pickedProbeName()).toBe("Frankfurt Probe");

    await pressRunTest();

    const request: { model: MonitorTest } = createMock.mock.calls[0]![0] as {
      model: MonitorTest;
    };

    expect(request.model.probeId?.toString()).toBe(OTHER_PROBE_ID);
  });

  test("a picked probe the list does not offer is passed over for the next", async () => {
    renderForm({
      preferredProbeIds: ["99999999-9999-4999-8999-999999999999", PROBE_ID],
    });
    await clickTestMonitor();

    expect(pickedProbeName()).toBe("Ohio Probe");
  });

  test("two probes and none picked: the picker starts empty, and asks for one", async () => {
    renderForm();
    await clickTestMonitor();

    expect(pickedProbeName()).toBeNull();

    await pressRunTest();

    expect(createMock).not.toHaveBeenCalled();
  });

  test("the starting probe, worked out", () => {
    const two: Array<Probe> = PROBES;
    const one: Array<Probe> = [probe(PROBE_ID, "Probe-1")];

    expect(getStartingTestProbeId({ probes: one })).toBe(PROBE_ID);
    expect(
      getStartingTestProbeId({
        probes: two,
        preferredProbeIds: [OTHER_PROBE_ID],
      }),
    ).toBe(OTHER_PROBE_ID);
    expect(getStartingTestProbeId({ probes: two })).toBeUndefined();
    expect(
      getStartingTestProbeId({ probes: two, preferredProbeIds: ["unknown"] }),
    ).toBeUndefined();
    expect(getStartingTestProbeId({ probes: [] })).toBeUndefined();
  });

  test("a form's or a monitor's probes, read as ids", () => {
    expect(
      toProbeIds([
        PROBE_ID,
        new ObjectID(OTHER_PROBE_ID),
        { value: PROBE_ID },
        { probeId: new ObjectID(OTHER_PROBE_ID) },
        { _id: "55555555-5555-4555-8555-000000000000" },
        null,
        7,
      ]),
    ).toEqual([
      PROBE_ID,
      OTHER_PROBE_ID,
      "55555555-5555-4555-8555-000000000000",
    ]);
    expect(toProbeIds(undefined)).toEqual([]);
    expect(toProbeIds("not a list")).toEqual([]);
  });
});

// A finished test row whose answer its criteria judged (#7074).
function judgedRow(
  criteriaResults: Array<MonitorEvaluationCriteriaResult>,
): MonitorTest {
  const row: MonitorTest = finishedRow();
  const response: MonitorStepProbeResponse =
    row.monitorStepProbeResponse as MonitorStepProbeResponse;

  response["step-1"] = {
    ...response["step-1"]!,
    isOnline: false,
    responseCode: 503,
    evaluationSummary: {
      evaluatedAt: new Date(),
      criteriaResults: criteriaResults,
      events: [],
    },
  };

  return row;
}

function criteriaResult(
  overrides: Partial<MonitorEvaluationCriteriaResult>,
): MonitorEvaluationCriteriaResult {
  return {
    criteriaId: "offline",
    criteriaName: "Check if Acme is offline",
    filterCondition: FilterCondition.Any,
    met: false,
    message: "",
    filters: [],
    ...overrides,
  };
}

function whoIsTold(criteria: Array<WhoIsToldCriteria>): WhoIsToldResult {
  return {
    monitorId: "",
    monitorName: "Acme",
    checkedAt: new Date().toISOString(),
    criteria: criteria,
    channels: {
      isBillingEnabled: false,
      isSmsOn: true,
      isCallOn: true,
      isWhatsAppOn: true,
      isTelegramOn: true,
      hasOwnTwilioForSms: false,
      hasOwnTwilioForCalls: false,
      serverCanSendEmail: true,
      serverCanSendSms: true,
      serverCanCall: true,
    },
    breaks: [],
  };
}

const OFFLINE_CRITERIA: WhoIsToldCriteria = {
  id: "offline",
  name: "Check if Acme is offline",
  statusName: "Offline",
  events: [
    {
      kind: OnCallTestPageRecordKind.Incident,
      title: "Acme is offline",
      severityName: "Critical Incident",
      owners: {
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: ["Ana Lopez"],
        teamNames: [],
      },
      ownerRules: [],
      rules: [],
      policies: [],
      statusPages: [],
    },
  ],
};

async function runJudgedTest(row: MonitorTest): Promise<void> {
  getItemMock.mockImplementation((request: unknown) => {
    const modelType: unknown = (request as { modelType: unknown }).modelType;

    if (modelType === MonitorStatus) {
      return Promise.resolve(
        Object.assign(new MonitorStatus(), { name: "Operational" }),
      );
    }

    return Promise.resolve(row);
  });

  await clickTestMonitor();
  await runTestOnProbe("Ohio Probe");
  await tick();
  await flush();
  await flush();
}

/*
 * #7074: Test Monitor's result said what the probe found and nothing of
 * what it meant. It says which criteria the answer matched and what would
 * follow - the status, what opens and its severity, who is told - in the
 * words the monitor's "When this goes down" card says them in.
 */
describe("what the result says would follow", () => {
  test("a matched criteria: which it is, and what it sets off, who is told included", async () => {
    getForDraftMock.mockResolvedValue(whoIsTold([OFFLINE_CRITERIA]));

    renderForm();
    await runJudgedTest(
      judgedRow([
        criteriaResult({
          criteriaId: "online",
          criteriaName: "Check if Acme is online",
        }),
        criteriaResult({ met: true }),
      ]),
    );

    const verdict: HTMLElement = screen.getByTestId("monitor-test-verdict");

    expect(verdict).toHaveAttribute("data-matched", "true");
    expect(
      within(verdict).getByTestId("monitor-test-verdict-criteria"),
    ).toHaveTextContent("This result matches Check if Acme is offline.");
    expect(
      within(verdict).getByTestId("monitor-test-verdict-follows"),
    ).toHaveTextContent(
      "OneUptime marks it Offline and opens an incident (Critical Incident). It emails the Project Owners (Ana Lopez). Nobody is paged.",
    );
  });

  test("who is told is read for the monitor the test ran, its steps as they were tested", async () => {
    getForDraftMock.mockResolvedValue(whoIsTold([OFFLINE_CRITERIA]));
    const tested: MonitorSteps = steps();

    renderForm({
      withoutMonitorId: true,
      monitorSteps: tested,
      monitorName: "Acme",
      labels: ["66666666-6666-4666-8666-666666666666"],
    });
    await runJudgedTest(judgedRow([criteriaResult({ met: true })]));

    expect(getForDraftMock).toHaveBeenCalledTimes(1);

    const draft: {
      monitorId?: ObjectID;
      name: string;
      monitorType: MonitorType;
      monitorSteps: MonitorSteps;
      labelIds: Array<ObjectID>;
    } = (getForDraftMock.mock.calls[0]![0] as { draft: never }).draft;

    expect(draft.monitorId).toBeUndefined();
    expect(draft.name).toBe("Acme");
    expect(draft.monitorType).toBe(MonitorType.Website);
    expect(draft.monitorSteps).toBe(tested);
    expect(
      draft.labelIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual(["66666666-6666-4666-8666-666666666666"]);
  });

  test("a saved monitor's test is read as that monitor", async () => {
    getForDraftMock.mockResolvedValue(whoIsTold([OFFLINE_CRITERIA]));

    renderForm();
    await runJudgedTest(judgedRow([criteriaResult({ met: true })]));

    const draft: { monitorId?: ObjectID } = (
      getForDraftMock.mock.calls[0]![0] as { draft: { monitorId?: ObjectID } }
    ).draft;

    expect(draft.monitorId?.toString()).toBe(MONITOR_ID);
  });

  test("no criteria matched: it says so, and that the monitor shows its default status", async () => {
    const tested: MonitorSteps = steps();
    tested.data!.defaultMonitorStatusId = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );

    renderForm({ monitorSteps: tested });
    await runJudgedTest(judgedRow([criteriaResult({ met: false })]));

    const verdict: HTMLElement = screen.getByTestId("monitor-test-verdict");

    expect(verdict).toHaveAttribute("data-matched", "false");
    expect(verdict).toHaveTextContent("This result matches no criteria.");
    expect(verdict).toHaveTextContent(
      "The monitor shows its default status, Operational, and nothing opens.",
    );
    // Nothing matched, so nobody is asked who would be told.
    expect(getForDraftMock).not.toHaveBeenCalled();
  });

  test("a matched criteria that sets nothing off says so", async () => {
    // The resolver leaves out a criteria with no status and nothing to open.
    getForDraftMock.mockResolvedValue(whoIsTold([]));

    renderForm();
    await runJudgedTest(judgedRow([criteriaResult({ met: true })]));

    expect(
      screen.getByTestId("monitor-test-verdict-follows"),
    ).toHaveTextContent("It changes no status and opens nothing.");
  });

  test("a private incident the reader can't see: what opens, never whom it tells", async () => {
    getForDraftMock.mockResolvedValue(
      whoIsTold([
        {
          ...OFFLINE_CRITERIA,
          events: [
            {
              ...OFFLINE_CRITERIA.events[0]!,
              owners: {
                source: WhoIsToldOwnersSource.Named,
                userNames: [],
                teamNames: [],
              },
              isPrivate: true,
              isHidden: true,
            },
          ],
        },
      ]),
    );

    renderForm();
    await runJudgedTest(judgedRow([criteriaResult({ met: true })]));

    const follows: HTMLElement = screen.getByTestId(
      "monitor-test-verdict-follows",
    );

    expect(follows).toHaveTextContent(
      "It's private, so you can't see who it tells.",
    );
    expect(follows).not.toHaveTextContent("Ana Lopez");
  });

  test("who is told cannot be worked out: it says so, the criteria still named", async () => {
    getForDraftMock.mockRejectedValue(
      new Error("You can't read this monitor."),
    );

    renderForm();
    await runJudgedTest(judgedRow([criteriaResult({ met: true })]));

    expect(
      screen.getByTestId("monitor-test-verdict-criteria"),
    ).toHaveTextContent("This result matches Check if Acme is offline.");
    expect(screen.getByTestId("monitor-test-verdict-error")).toHaveTextContent(
      "Couldn't work out who is told.",
    );
  });

  test("a result kept before answers were judged says nothing more than it did", async () => {
    getItemMock.mockResolvedValue(finishedRow());

    renderForm();
    await clickTestMonitor();
    await runTestOnProbe("Ohio Probe");
    await tick();

    expect(
      screen.queryByTestId("monitor-test-verdict"),
    ).not.toBeInTheDocument();
    expect(getForDraftMock).not.toHaveBeenCalled();
  });

  test("the criteria that matched is the first met, as the monitor acts on it", () => {
    expect(getMonitorTestJudgement([])).toBeUndefined();
    expect(
      getMonitorTestJudgement([
        finishedRow().monitorStepProbeResponse!["step-1"]!,
      ]),
    ).toBeUndefined();

    const judged: MonitorTest = judgedRow([
      criteriaResult({ criteriaId: "a", met: false }),
      criteriaResult({ criteriaId: "b", met: true, skipped: true }),
      criteriaResult({ criteriaId: "c", met: true }),
      criteriaResult({ criteriaId: "d", met: true }),
    ]);

    expect(
      getMonitorTestJudgement([judged.monitorStepProbeResponse!["step-1"]!])
        ?.matched?.criteriaId,
    ).toBe("c");
    expect(
      getMonitorTestJudgement([
        judgedRow([criteriaResult({ met: false })]).monitorStepProbeResponse![
          "step-1"
        ]!,
      ]),
    ).toEqual({ matched: null });
  });
});
