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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A button that sets a switch's column from somewhere other than the switch
 * (UI/Components/ModelSwitch/useSaveModelSwitch): "Turn evaluation on" on a
 * disabled SLO's banner, with the "Evaluate this SLO" switch on its
 * Settings page. It must write exactly what the switch writes, be locked
 * for exactly the people the switch is locked for, save once however fast
 * it is pressed, say why a save failed, and tell the switch, so the two
 * never disagree on the screen.
 *
 * Only the network and the signed-in user's permissions are stubbed; the
 * gate, the events and the switch are the real ones.
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

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
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
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import useSaveModelSwitch, {
  SaveModelSwitch,
} from "../../../UI/Components/ModelSwitch/useSaveModelSwitch";
import ModelSwitchRow from "../../../UI/Components/ModelSwitch/ModelSwitchRow";
import {
  MODEL_SWITCH_SAVED_EVENT,
  ModelSwitchSaved,
} from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const SLO_ID: string = "7c7c7c7c-0000-4000-8000-0000000000aa";
const OTHER_SLO_ID: string = "7c7c7c7c-0000-4000-8000-0000000000bb";

interface ButtonProps {
  modelId: string;
  value?: boolean | undefined;
  onSaved?: (() => void) | undefined;
  modelAPI?: typeof ModelAPI | undefined;
}

// A banner's button: what the hook gives a page to draw.
const TurnOnButton: (props: ButtonProps) => ReactElement = (
  props: ButtonProps,
): ReactElement => {
  const turnOn: SaveModelSwitch = useSaveModelSwitch<ServiceLevelObjective>({
    modelType: ServiceLevelObjective,
    modelId: new ObjectID(props.modelId),
    column: "isEnabled",
    value: props.value ?? true,
    onSaved: props.onSaved,
    modelAPI: props.modelAPI,
  });

  return (
    <div>
      <button
        type="button"
        data-testid="turn-on"
        disabled={!turnOn.gate.isAllowed}
        title={turnOn.gate.disabledReason}
        onClick={turnOn.save}
      >
        Turn evaluation on
      </button>
      <span data-testid="saving">{turnOn.isSaving ? "saving" : "idle"}</span>
      <span data-testid="error">{turnOn.error}</span>
    </div>
  );
};

function press(): void {
  fireEvent.click(screen.getByTestId("turn-on"));
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
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

let announced: Array<ModelSwitchSaved> = [];

const listener: (event: Event) => void = (event: Event): void => {
  announced.push((event as CustomEvent).detail as ModelSwitchSaved);
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  announced = [];
  window.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
});

afterEach(() => {
  window.removeEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
  cleanup();
  jest.restoreAllMocks();
});

describe("useSaveModelSwitch saves the switch's column", () => {
  test("a press writes the value to that column of that record, and nothing else", async () => {
    render(<TurnOnButton modelId={SLO_ID} />);

    press();
    await settle();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(ServiceLevelObjective);
    expect(updateCall().id.toString()).toBe(SLO_ID);
    expect(updateCall().data).toEqual({ isEnabled: true });
  });

  test("it writes the stored value it is given, not what a switch shows", async () => {
    render(<TurnOnButton modelId={SLO_ID} value={false} />);

    press();
    await settle();

    expect(updateCall().data).toEqual({ isEnabled: false });
  });

  test("it announces the save, so a switch on the same column follows it", async () => {
    render(
      <>
        <TurnOnButton modelId={SLO_ID} />
        <ModelSwitchRow<ServiceLevelObjective>
          modelType={ServiceLevelObjective}
          modelId={new ObjectID(SLO_ID)}
          column="isEnabled"
          initialValue={false}
          title="Evaluate this SLO"
          dataTestId="evaluate-switch"
        />
      </>,
    );

    expect(screen.getByTestId("evaluate-switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    press();
    await settle();

    expect(announced).toEqual([
      expect.objectContaining({
        tableName: new ServiceLevelObjective().tableName,
        modelId: SLO_ID,
        column: "isEnabled",
        value: true,
      }),
    ]);
    expect(screen.getByTestId("evaluate-switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("onSaved is told once the save is back", async () => {
    const onSaved: MockFunction = getJestMockFunction();

    render(<TurnOnButton modelId={SLO_ID} onSaved={onSaved} />);

    press();
    await settle();

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("it saves through the API it is given", async () => {
    const adminUpdateById: MockFunction = getJestMockFunction();
    adminUpdateById.mockImplementation(async (): Promise<unknown> => {
      return {};
    });

    render(
      <TurnOnButton
        modelId={SLO_ID}
        modelAPI={{ updateById: adminUpdateById } as unknown as typeof ModelAPI}
      />,
    );

    press();
    await settle();

    expect(adminUpdateById).toHaveBeenCalledTimes(1);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("useSaveModelSwitch while it saves", () => {
  test("it says it is saving, and saves once however fast it is pressed", async () => {
    let finish: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    render(<TurnOnButton modelId={SLO_ID} />);

    press();
    press();
    press();

    expect(screen.getByTestId("saving")).toHaveTextContent("saving");
    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    await settle();

    expect(screen.getByTestId("saving")).toHaveTextContent("idle");
  });

  test("a refused save says why, announces nothing and tells nobody it saved", async () => {
    const onSaved: MockFunction = getJestMockFunction();
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to edit this SLO.");
    });

    render(<TurnOnButton modelId={SLO_ID} onSaved={onSaved} />);

    press();
    await settle();

    expect(screen.getByTestId("error")).toHaveTextContent(
      "You do not have permission to edit this SLO.",
    );
    expect(screen.getByTestId("saving")).toHaveTextContent("idle");
    expect(announced).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("the next press clears the reason, and can save", async () => {
    updateByIdMock.mockImplementationOnce(async (): Promise<unknown> => {
      throw new Error("The server is not reachable.");
    });

    render(<TurnOnButton modelId={SLO_ID} />);

    press();
    await settle();
    expect(screen.getByTestId("error")).toHaveTextContent(
      "The server is not reachable.",
    );

    press();
    await settle();

    expect(screen.getByTestId("error")).toHaveTextContent("");
    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(announced).toHaveLength(1);
  });

  test("what failed for one record is not shown for the next one the page moves to", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The server is not reachable.");
    });

    const view: RenderResult = render(<TurnOnButton modelId={SLO_ID} />);

    press();
    await settle();
    expect(screen.getByTestId("error")).toHaveTextContent(
      "The server is not reachable.",
    );

    view.rerender(<TurnOnButton modelId={OTHER_SLO_ID} />);

    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  test("a save out for one record does not show as saving on the next one", async () => {
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>(() => {
        // Never answers.
      });
    });

    const view: RenderResult = render(<TurnOnButton modelId={SLO_ID} />);

    press();
    expect(screen.getByTestId("saving")).toHaveTextContent("saving");

    view.rerender(<TurnOnButton modelId={OTHER_SLO_ID} />);

    expect(screen.getByTestId("saving")).toHaveTextContent("idle");
  });
});

describe("useSaveModelSwitch is gated like the switch", () => {
  test("without the column's update permission it is locked, and says which permission is missing", async () => {
    // A member may read SLOs, not change whether they are evaluated.
    permissionsForTest = [Permission.ProjectMember];

    render(<TurnOnButton modelId={SLO_ID} />);

    const button: HTMLElement = screen.getByTestId("turn-on");
    expect(button).toBeDisabled();
    expect(button.getAttribute("title") || "").toMatch(/permission/i);

    press();
    await settle();

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("with it, it is open", () => {
    permissionsForTest = [Permission.EditServiceLevelObjective];

    render(<TurnOnButton modelId={SLO_ID} />);

    expect(screen.getByTestId("turn-on")).not.toBeDisabled();
  });

  test("before the permissions arrive it is locked but accuses nobody", () => {
    permissionsForTest = [];

    render(<TurnOnButton modelId={SLO_ID} />);

    const button: HTMLElement = screen.getByTestId("turn-on");
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toBeNull();
  });
});
