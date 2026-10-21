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
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * How many of a monitor's probes must agree before its status changes, on
 * its Probes & Interval page, under the probes it counts.
 *
 * It was a "Probe Agreement Settings" card on the monitor's Settings page,
 * whose Edit dialog held a "Minimum Probe Agreement" number, and which read
 * "All probes must agree" while empty. Now it is one sentence with the
 * number typed into it - "Change this monitor's status when [all] probes
 * agree" - saved when the box is left or Enter is pressed. An empty box is
 * all probes, as an empty column always was to the server.
 *
 * The real card, Input, TranslatedSentence and Card run; only the network
 * and the permission gate are stubbed. The fake monitor answers with what
 * was last saved, as the server would.
 */

const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import ProbeAgreementCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ProbeAgreementCard";
import { PROBE_AGREEMENT_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ProbesAndIntervalCopy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000000d1";

const INVALID: string =
  "Type a whole number of probes, or leave it empty for all probes.";

// The fake monitor's minimumProbeAgreement, as the server holds it.
let stored: number | null = null;
let gate: PermissionGateResult = { isAllowed: true };
const gateColumns: Array<string> = [];

beforeEach(() => {
  stored = null;
  gate = { isAllowed: true };
  gateColumns.length = 0;

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      stored = (options as { data: { minimumProbeAgreement: number | null } })
        .data.minimumProbeAgreement;
      return {};
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (_model: unknown, column: unknown): PermissionGateResult => {
      gateColumns.push(column as string);
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

function renderCard(
  initialValue: number | null | undefined,
  onSaved?: (value: number | null) => void,
): void {
  render(
    <ProbeAgreementCard
      monitorId={new ObjectID(MONITOR_ID)}
      initialValue={initialValue}
      onSaved={onSaved}
    />,
  );
}

function box(): HTMLInputElement {
  return screen.getByTestId(PROBE_AGREEMENT_TEST_ID) as HTMLInputElement;
}

function row(): HTMLElement {
  return screen.getByTestId(`${PROBE_AGREEMENT_TEST_ID}-row`);
}

function status(): HTMLElement {
  return screen.getByTestId(`${PROBE_AGREEMENT_TEST_ID}-status`);
}

function errorText(): string | null {
  return (
    screen.queryByTestId(`${PROBE_AGREEMENT_TEST_ID}-error`)?.textContent ??
    null
  );
}

// The sentence as read, with the box's number (or its placeholder) in it.
function sentence(): string {
  const parts: Array<string> = [];

  row().childNodes.forEach((node: ChildNode): void => {
    const element: HTMLElement = node as HTMLElement;

    if (element.getAttribute?.("role") === "status") {
      return;
    }

    const input: HTMLInputElement | null =
      element.querySelector?.("input") ?? null;

    if (input) {
      parts.push(input.value || `[${input.placeholder}]`);
      return;
    }

    parts.push((element.textContent || "").trim());
  });

  return parts.filter(Boolean).join(" ");
}

function type(text: string): void {
  fireEvent.change(box(), { target: { value: text } });
}

async function leave(): Promise<void> {
  fireEvent.blur(box());
  await flush();
}

async function pressEnter(): Promise<void> {
  fireEvent.keyDown(box(), { key: "Enter", code: "Enter" });
  await flush();
}

describe("the Probe Agreement card", () => {
  test("says what it is for, as one sentence with an empty box for all probes", () => {
    renderCard(null);

    expect(
      screen.getByRole("heading", { name: "Probe Agreement" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A status change waits until enough probes see the same result, so one probe with network trouble cannot change it on its own.",
      ),
    ).toBeInTheDocument();
    expect(box().value).toBe("");
    expect(box()).toHaveAttribute("placeholder", "all");
    expect(sentence()).toBe(
      "Change this monitor's status when [all] probes agree",
    );
    expect(
      screen.getByText(
        "Leave it empty for all probes. Only probes that are on and connected take part.",
      ),
    ).toBeInTheDocument();
  });

  test("the box is named for what it holds, and points at the note under it", () => {
    renderCard(null);

    expect(
      screen.getByRole("spinbutton", { name: "Probes that must agree" }),
    ).toBe(box());
    expect(box().getAttribute("aria-describedby")).toBe(
      screen.getByTestId(`${PROBE_AGREEMENT_TEST_ID}-note`).id,
    );
  });

  test("an empty column (undefined, as a fresh monitor reads) is all probes too", () => {
    renderCard(undefined);

    expect(box().value).toBe("");
    expect(sentence()).toBe(
      "Change this monitor's status when [all] probes agree",
    );
  });

  test("shows the number the monitor has, with the words for it", () => {
    renderCard(2);

    expect(box().value).toBe("2");
    expect(sentence()).toBe("Change this monitor's status when 2 probes agree");
  });

  test("one probe reads in the singular", () => {
    renderCard(1);

    expect(sentence()).toBe("Change this monitor's status when 1 probe agrees");
  });

  test("the words follow the number as it is typed", () => {
    renderCard(null);

    type("1");
    expect(sentence()).toBe("Change this monitor's status when 1 probe agrees");

    type("3");
    expect(sentence()).toBe("Change this monitor's status when 3 probes agree");
  });

  test("typing a number and leaving the box saves it alone, and says so", async () => {
    const saved: Array<number | null> = [];
    renderCard(null, (value: number | null): void => {
      saved.push(value);
    });

    type("2");
    expect(updateByIdMock).not.toHaveBeenCalled();

    await leave();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Monitor);
    expect(updateCall().id.toString()).toBe(MONITOR_ID);
    expect(updateCall().data).toEqual({ minimumProbeAgreement: 2 });
    expect(stored).toBe(2);
    expect(status()).toHaveTextContent("Saved");
    expect(saved).toEqual([2]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  test("Enter saves too, and leaving the box afterwards does not save again", async () => {
    renderCard(null);

    type("3");
    await pressEnter();
    await leave();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().data).toEqual({ minimumProbeAgreement: 3 });
  });

  test("emptying the box saves all probes: the column is cleared", async () => {
    renderCard(2);

    type("");
    await leave();

    expect(updateCall().data).toEqual({ minimumProbeAgreement: null });
    expect(stored).toBeNull();
    expect(box().value).toBe("");
    expect(sentence()).toBe(
      "Change this monitor's status when [all] probes agree",
    );
    expect(status()).toHaveTextContent("Saved");
  });

  test("leaving the box unchanged saves nothing", async () => {
    renderCard(2);

    fireEvent.focus(box());
    await leave();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent("");
  });

  test("a value the dashboard would not write (a 0 set through the API) is shown as it is, and leaving it untouched neither saves nor complains", async () => {
    renderCard(0);

    expect(box().value).toBe("0");

    fireEvent.focus(box());
    await leave();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(errorText()).toBeNull();

    // Changing it is held to the rule like any other number.
    type("00");
    await leave();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(errorText()).toBe(INVALID);
  });

  test("the number the monitor already has, written another way, saves nothing and reads as it is", async () => {
    renderCard(2);

    type("02");
    await leave();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(box().value).toBe("2");
  });

  test.each(["0", "-1", "2.5"])(
    "%j is not sent: it stays in the box with what to type instead",
    async (text: string) => {
      renderCard(null);

      type(text);
      await leave();

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(errorText()).toBe(INVALID);
      expect(
        screen.getByTestId(`${PROBE_AGREEMENT_TEST_ID}-error`),
      ).toHaveAttribute("role", "alert");
      expect(box()).toHaveAttribute("aria-invalid", "true");
      expect(box().getAttribute("aria-describedby")).toContain(
        screen.getByTestId(`${PROBE_AGREEMENT_TEST_ID}-error`).id,
      );
      expect(box().value).toBe(text);
    },
  );

  test("typing again clears the message", async () => {
    renderCard(null);

    type("0");
    await leave();
    expect(errorText()).toBe(INVALID);

    type("2");

    expect(errorText()).toBeNull();
  });

  test("Escape puts back the number the monitor has", async () => {
    renderCard(2);

    type("5");
    fireEvent.keyDown(box(), { key: "Escape", code: "Escape" });
    await flush();

    expect(box().value).toBe("2");

    await leave();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a refused number goes back to the one the monitor has, with the reason", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "You do not have permission to update this Monitor. You need one of these permissions: Edit Monitor.",
      );
    });

    renderCard(2);

    type("4");
    await leave();

    expect(box().value).toBe("2");
    expect(errorText()).toContain(
      "You do not have permission to update this Monitor.",
    );
    expect(status()).toHaveTextContent("");
    expect(stored).toBeNull();
  });

  test("says Saving… while the number is on its way, and saves it once", async () => {
    let finish: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void): void => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    renderCard(null);

    type("2");
    await pressEnter();

    expect(status()).toHaveTextContent("Saving…");

    // Leaving the box while it saves does not send it a second time.
    await leave();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    await flush();

    expect(status()).toHaveTextContent("Saved");
  });

  test("is gated on the agreement column itself", () => {
    renderCard(null);

    expect(gateColumns).toContain("minimumProbeAgreement");
  });

  test("unlocks once the permissions arrive, which is after a fresh sign-in's first paint", async () => {
    gate = { isAllowed: false };

    const view: { rerender: (ui: React.ReactElement) => void } = render(
      <ProbeAgreementCard
        monitorId={new ObjectID(MONITOR_ID)}
        initialValue={null}
      />,
    );

    expect(box()).toHaveAttribute("readonly");

    gate = { isAllowed: true };
    view.rerender(
      <ProbeAgreementCard
        monitorId={new ObjectID(MONITOR_ID)}
        initialValue={null}
      />,
    );

    expect(box()).not.toHaveAttribute("readonly");

    type("2");
    await leave();

    expect(updateCall().data).toEqual({ minimumProbeAgreement: 2 });
  });

  test("someone who may not change it sees the box locked, and nothing is saved", async () => {
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
    };

    renderCard(2);

    expect(box()).toHaveAttribute("readonly");

    type("5");
    await leave();

    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
