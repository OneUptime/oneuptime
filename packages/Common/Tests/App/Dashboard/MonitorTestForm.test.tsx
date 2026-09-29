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
} from "@testing-library/react";
import * as React from "react";
import Permission from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";

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
  MONITOR_TEST_MAX_POLL_ATTEMPTS,
  MONITOR_TEST_POLL_INTERVAL_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorTest";
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
}

function renderForm(options: RenderOptions = {}): RenderResult {
  if (options.withoutMonitorId) {
    return render(
      <MonitorTestForm
        monitorSteps={steps()}
        monitorType={options.monitorType || MonitorType.Website}
        probes={options.probes || PROBES}
        buttonSize={ButtonSize.Normal}
      />,
    );
  }

  return render(
    <MonitorTestForm
      monitorId={new ObjectID(MONITOR_ID)}
      monitorSteps={steps()}
      monitorType={options.monitorType || MonitorType.Website}
      probes={options.probes || PROBES}
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

    expect(screen.getByText("Select Probe")).toBeInTheDocument();

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
      screen.getByText(
        "Monitor Test took too long to complete. Please try again later.",
      ),
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
      screen.queryByText(
        "Monitor Test took too long to complete. Please try again later.",
      ),
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
