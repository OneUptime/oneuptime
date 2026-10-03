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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The shared one-switch setting (UI/Components/ModelSwitch/ModelSwitchRow):
 * one boolean column of one record, saved the moment the switch is flipped.
 * It is what a card with an Edit button whose dialog held one switch
 * becomes, so everything such a dialog did for the user it has to do on
 * its own: save exactly that column, show it saved, never show a state the
 * record is not in, lock for someone who may not change it (by the
 * column's own permissions, which the server also checks), name the plan
 * it needs, and ask first where a flip can lock people out.
 *
 * Only the network, the signed-in user's permissions and the plan are
 * stubbed; the gate, the Toggle and the dialog are the real ones.
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
let isMasterAdminForTest: boolean = false;

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
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import ModelSwitchRow, {
  ComponentProps,
  ModelSwitchConfirmation,
} from "../../../UI/Components/ModelSwitch/ModelSwitchRow";
import {
  announceModelSwitchSaved,
  MODEL_SWITCH_SAVED_EVENT,
  ModelSwitchSaved,
} from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const RECORD_ID: string = "5a5a5a5a-0000-4000-8000-0000000000aa";
const OTHER_ID: string = "5a5a5a5a-0000-4000-8000-0000000000bb";
const TEST_ID: string = "the-switch";

let plan: PlanType | null = null;

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  isMasterAdminForTest = false;
  plan = null;
  PermissionGate.clearPermissionPropsCache();

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  // The plans in order, as a billing install configures them.
  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function rowFor<TBaseModel extends BaseModel>(
  props: Partial<ComponentProps<TBaseModel>> &
    Pick<ComponentProps<TBaseModel>, "modelType" | "column">,
): ReactElement {
  const all: ComponentProps<TBaseModel> = {
    modelId: new ObjectID(RECORD_ID),
    initialValue: false,
    title: "Enable MCP Server",
    dataTestId: TEST_ID,
    ...props,
  } as ComponentProps<TBaseModel>;

  return <ModelSwitchRow<TBaseModel> {...all} />;
}

function mcpRow(props?: Partial<ComponentProps<StatusPage>>): ReactElement {
  return rowFor<StatusPage>({
    modelType: StatusPage,
    column: "enableMcpServer",
    ...props,
  });
}

function monitoringRow(props?: Partial<ComponentProps<Monitor>>): ReactElement {
  return rowFor<Monitor>({
    modelType: Monitor,
    column: "disableActiveMonitoring",
    isInverted: true,
    title: "Check this monitor",
    ...props,
  });
}

function theSwitch(): HTMLElement {
  return screen.getByTestId(TEST_ID);
}

function status(): HTMLElement {
  return screen.getByTestId(`${TEST_ID}-status`);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

async function press(): Promise<void> {
  fireEvent.click(theSwitch());
  await flush();
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

describe("ModelSwitchRow saves its column when it is flipped", () => {
  test("it is a named switch showing the value it was given", () => {
    render(mcpRow({ initialValue: true }));

    const control: HTMLElement = screen.getByRole("switch", {
      name: "Enable MCP Server",
    });
    expect(control).toBe(theSwitch());
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId(`${TEST_ID}-row`)).toContainElement(control);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a flip saves exactly that column of that record, and says Saved", async () => {
    render(mcpRow({ initialValue: false }));

    await press();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const call: UpdateCall = updateCall();
    expect(call.modelType).toBe(StatusPage);
    expect(call.id.toString()).toBe(RECORD_ID);
    expect(call.data).toEqual({ enableMcpServer: true });

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(status()).toHaveAttribute("role", "status");
    expect(status()).toHaveTextContent("Saved");
  });

  test("flipped back, it saves the other value", async () => {
    render(mcpRow({ initialValue: true }));

    await press();

    expect(updateCall().data).toEqual({ enableMcpServer: false });
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("it says Saving while the save is out, locked, and saves once however fast it is pressed", async () => {
    let finish: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    render(mcpRow());

    fireEvent.click(theSwitch());
    fireEvent.click(theSwitch());
    fireEvent.click(theSwitch());
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(status()).toHaveTextContent("Saving…");

    await act(async () => {
      finish();
    });
    await flush();

    expect(theSwitch()).not.toHaveAttribute("aria-disabled");
    expect(status()).toHaveTextContent("Saved");
  });

  test("a status with nothing to say is empty, but always in the page", () => {
    render(mcpRow());

    expect(status()).toBeEmptyDOMElement();
  });

  test("onChange hears the move and onSaved the save", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onSaved: MockFunction = getJestMockFunction();

    render(mcpRow({ initialValue: false, onChange, onSaved }));

    await press();

    expect(onChange.mock.calls).toEqual([[true]]);
    expect(onSaved.mock.calls).toEqual([[true]]);
  });
});

describe("ModelSwitchRow never shows a state the record is not in", () => {
  test("a refused save moves the switch back and says why under it", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onSaved: MockFunction = getJestMockFunction();
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Growth to access this feature",
      );
    });

    render(mcpRow({ initialValue: false, onChange, onSaved }));

    await press();

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please upgrade your plan to Growth to access this feature",
    );
    // The reason describes the switch, so a screen reader hears it there.
    expect(theSwitch().getAttribute("aria-describedby")).toContain(
      screen.getByRole("alert").id,
    );
    expect(theSwitch()).toHaveAttribute("aria-invalid", "true");
    expect(status()).toBeEmptyDOMElement();

    // Moved, then moved back; never saved.
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("the reason goes away with the next press that works", async () => {
    updateByIdMock.mockImplementationOnce(async (): Promise<unknown> => {
      throw new Error("Server Error. Please try again");
    });

    render(mcpRow({ initialValue: false }));

    await press();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await press();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(status()).toHaveTextContent("Saved");
  });
});

describe("ModelSwitchRow, inverted", () => {
  /*
   * A column that stores what to turn off ("Disable Monitoring") behind a
   * switch that reads on = happening ("Check this monitor").
   */
  test("on means the column is false, and turning it off stores true", async () => {
    render(monitoringRow({ initialValue: true }));

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");

    await press();

    expect(updateCall().modelType).toBe(Monitor);
    expect(updateCall().data).toEqual({ disableActiveMonitoring: true });
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("turning it on stores false", async () => {
    render(monitoringRow({ initialValue: false }));

    await press();

    expect(updateCall().data).toEqual({ disableActiveMonitoring: false });
  });

  test("callers hear what the switch shows, not what the column stores", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onSaved: MockFunction = getJestMockFunction();

    render(monitoringRow({ initialValue: false, onChange, onSaved }));

    await press();

    expect(onChange.mock.calls).toEqual([[true]]);
    expect(onSaved.mock.calls).toEqual([[true]]);
  });
});

describe("ModelSwitchRow says what the switch does", () => {
  test("the description follows the switch, and the note follows it whichever way it is set", async () => {
    render(
      monitoringRow({
        initialValue: true,
        getDescription: (isOn: boolean): string => {
          return isOn ? "Checked." : "Not checked.";
        },
        note: "History is kept.",
      }),
    );

    const row: HTMLElement = screen.getByTestId(`${TEST_ID}-row`);
    expect(row).toHaveTextContent("Checked. History is kept.");

    await press();

    expect(row).toHaveTextContent("Not checked. History is kept.");
    expect(row).not.toHaveTextContent("Checked. History");
  });

  test("the sentence describes the switch for a screen reader, not names it", () => {
    render(
      mcpRow({
        getDescription: (): string => {
          return "AI agents can read this status page.";
        },
      }),
    );

    const describedBy: string = theSwitch().getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent(
      "AI agents can read this status page.",
    );
    expect(
      screen.getByRole("switch", { name: "Enable MCP Server" }),
    ).toBeInTheDocument();
  });
});

describe("ModelSwitchRow locks for someone who may not change it", () => {
  test("without the record's update permission it is locked, and says which permission is missing", async () => {
    permissionsForTest = [Permission.Viewer];

    render(mcpRow());

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId(`${TEST_ID}-row`)).toHaveTextContent(
      "You do not have permission to update this Status Page.",
    );

    await press();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("with the table's permission but not the column's, it is locked too, naming the column's permissions", async () => {
    /*
     * Manage Billing may update a project, but not the project's monitor
     * defaults: the server refuses the column, so the switch must not
     * pretend it will save.
     */
    permissionsForTest = [Permission.ManageProjectBilling];

    render(
      rowFor<Project>({
        modelType: Project,
        column: "doNotAddGlobalProbesByDefaultOnNewMonitors",
        isInverted: true,
        title: "Add global probes to new monitors",
        initialValue: true,
      }),
    );

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");

    const row: HTMLElement = screen.getByTestId(`${TEST_ID}-row`);
    expect(row).toHaveTextContent(
      "You do not have permission to update this Project.",
    );
    expect(row).toHaveTextContent("Project Owner");
    expect(row).toHaveTextContent("Project Admin");
    expect(row).not.toHaveTextContent("Manage Billing");

    await press();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("with the column's permission it saves", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    render(
      rowFor<Project>({
        modelType: Project,
        column: "doNotAddGlobalProbesByDefaultOnNewMonitors",
        isInverted: true,
        title: "Add global probes to new monitors",
        initialValue: true,
      }),
    );

    await press();

    expect(updateCall().modelType).toBe(Project);
    expect(updateCall().data).toEqual({
      doNotAddGlobalProbesByDefaultOnNewMonitors: true,
    });
  });

  test("a master admin may change it whatever their project permissions", async () => {
    permissionsForTest = [];
    isMasterAdminForTest = true;

    render(mcpRow());

    await press();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("before the permissions arrive it is locked but accuses nobody", () => {
    permissionsForTest = [];

    render(mcpRow());

    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId(`${TEST_ID}-row`)).not.toHaveTextContent(
      "You do not have permission",
    );
  });
});

describe("ModelSwitchRow names the plan it needs", () => {
  test("a plan below the column's update plan shows the plan's pill", () => {
    plan = PlanType.Free;

    // The embedded badge's switch is a Growth feature.
    render(
      rowFor<StatusPage>({
        modelType: StatusPage,
        column: "enableEmbeddedOverallStatus",
        title: "Enable Embedded Status Badge",
      }),
    );

    expect(screen.getByTestId(`${TEST_ID}-row`)).toHaveTextContent(
      "Growth Plan",
    );
  });

  test("no pill on a plan that has it, on a free column, or with billing off", () => {
    plan = PlanType.Growth;
    const view: RenderResult = render(
      rowFor<StatusPage>({
        modelType: StatusPage,
        column: "enableEmbeddedOverallStatus",
        title: "Enable Embedded Status Badge",
      }),
    );
    expect(view.container).not.toHaveTextContent("Plan");
    cleanup();

    plan = PlanType.Free;
    render(mcpRow());
    expect(screen.getByTestId(`${TEST_ID}-row`)).not.toHaveTextContent("Plan");
    cleanup();

    plan = null;
    render(
      rowFor<StatusPage>({
        modelType: StatusPage,
        column: "enableEmbeddedOverallStatus",
        title: "Enable Embedded Status Badge",
      }),
    );
    expect(screen.getByTestId(`${TEST_ID}-row`)).not.toHaveTextContent("Plan");
  });
});

describe("ModelSwitchRow asks first where a flip can lock people out", () => {
  const CONFIRM_ON: ModelSwitchConfirmation = {
    title: "Require SSO for everyone?",
    description: "People who sign in with a password will be signed out.",
    submitButtonText: "Require SSO",
    submitButtonType: ButtonStyleType.DANGER,
  };

  const askWhenTurningOn: (
    isTurningOn: boolean,
  ) => ModelSwitchConfirmation | undefined = (
    isTurningOn: boolean,
  ): ModelSwitchConfirmation | undefined => {
    return isTurningOn ? CONFIRM_ON : undefined;
  };

  test("turning it that way opens the dialog and saves nothing yet", async () => {
    render(mcpRow({ getConfirmation: askWhenTurningOn }));

    await press();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Require SSO for everyone?");
    expect(dialog).toHaveTextContent(
      "People who sign in with a password will be signed out.",
    );
    expect(updateByIdMock).not.toHaveBeenCalled();

    // Where it is going, locked while the dialog asks.
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(theSwitch()).toHaveAttribute("aria-disabled", "true");
  });

  test("confirmed, it saves", async () => {
    const onSaved: MockFunction = getJestMockFunction();
    render(mcpRow({ getConfirmation: askWhenTurningOn, onSaved }));

    await press();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Require SSO",
      }),
    );
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().data).toEqual({ enableMcpServer: true });
    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(status()).toHaveTextContent("Saved");
    expect(onSaved.mock.calls).toEqual([[true]]);
  });

  test("its button pressed twice saves once", async () => {
    render(mcpRow({ getConfirmation: askWhenTurningOn }));

    await press();
    const confirm: HTMLElement = within(screen.getByRole("dialog")).getByRole(
      "button",
      { name: "Require SSO" },
    );
    act(() => {
      confirm.click();
      confirm.click();
    });
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("cancelled, the switch goes back and nothing is saved", async () => {
    const onChange: MockFunction = getJestMockFunction();
    render(mcpRow({ getConfirmation: askWhenTurningOn, onChange }));

    await press();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(theSwitch()).not.toHaveAttribute("aria-disabled");
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  test("the other way saves at once, with no dialog", async () => {
    render(mcpRow({ initialValue: true, getConfirmation: askWhenTurningOn }));

    await press();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({ enableMcpServer: false });
  });

  test("a confirmed change the server refuses still goes back, with why", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Test SSO before you require it.");
    });

    render(mcpRow({ getConfirmation: askWhenTurningOn }));

    await press();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Require SSO",
      }),
    );
    await flush();

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Test SSO before you require it.",
    );
  });
});

describe("ModelSwitchRow saves through the API it is given", () => {
  test("the admin dashboard's API, not the project one", async () => {
    const adminUpdateById: MockFunction = getJestMockFunction();
    adminUpdateById.mockImplementation(async (): Promise<unknown> => {
      return {};
    });

    // AdminModelAPI is ModelAPI with no project headers.
    const AdminApi: typeof ModelAPI = {
      updateById: adminUpdateById,
    } as unknown as typeof ModelAPI;

    render(mcpRow({ modelAPI: AdminApi }));

    await press();

    expect(adminUpdateById).toHaveBeenCalledTimes(1);
    expect((adminUpdateById.mock.calls[0]![0] as UpdateCall).data).toEqual({
      enableMcpServer: true,
    });
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("ModelSwitchRow moves with the rest of the screen", () => {
  test("a save of the same column elsewhere moves the switch, and tells the caller", async () => {
    const onChange: MockFunction = getJestMockFunction();
    render(monitoringRow({ initialValue: false, onChange }));

    act(() => {
      // The banner's "Turn monitoring on" button: the column is now false.
      announceModelSwitchSaved({
        modelType: Monitor,
        modelId: new ObjectID(RECORD_ID),
        column: "disableActiveMonitoring",
        value: false,
      });
    });

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(onChange.mock.calls).toEqual([[true]]);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("another record's, another column's or another table's save leaves it alone", () => {
    render(monitoringRow({ initialValue: false }));

    act(() => {
      announceModelSwitchSaved({
        modelType: Monitor,
        modelId: new ObjectID(OTHER_ID),
        column: "disableActiveMonitoring",
        value: false,
      });
      announceModelSwitchSaved({
        modelType: Monitor,
        modelId: new ObjectID(RECORD_ID),
        column: "isArchived",
        value: false,
      });
      announceModelSwitchSaved({
        modelType: StatusPage,
        modelId: new ObjectID(RECORD_ID),
        column: "disableActiveMonitoring",
        value: false,
      });
    });

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("it announces its own saves with the stored value, and does not hear itself", async () => {
    const heard: Array<ModelSwitchSaved> = [];
    const listener: (event: Event) => void = (event: Event): void => {
      heard.push((event as CustomEvent).detail as ModelSwitchSaved);
    };
    window.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);

    const onChange: MockFunction = getJestMockFunction();

    try {
      render(monitoringRow({ initialValue: true, onChange }));

      await press();

      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({
        tableName: "Monitor",
        modelId: RECORD_ID,
        column: "disableActiveMonitoring",
        value: true,
      });
      expect(heard[0]!.source).not.toBe("");
      // Once for the press; its own announcement is not heard again.
      expect(onChange.mock.calls).toEqual([[false]]);
    } finally {
      window.removeEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
    }
  });

  test("two switches on the same column move together", async () => {
    render(
      <>
        {monitoringRow({ initialValue: true, dataTestId: "first" })}
        {monitoringRow({ initialValue: true, dataTestId: "second" })}
      </>,
    );

    fireEvent.click(screen.getByTestId("first"));
    await flush();

    expect(screen.getByTestId("first")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByTestId("second")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("a save of its own in flight is not overtaken by one from elsewhere", async () => {
    let finish: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    render(monitoringRow({ initialValue: true }));

    fireEvent.click(theSwitch());
    await flush();

    act(() => {
      announceModelSwitchSaved({
        modelType: Monitor,
        modelId: new ObjectID(RECORD_ID),
        column: "disableActiveMonitoring",
        value: false,
      });
    });

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      finish();
    });
    await flush();

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("after it unmounts it no longer listens", () => {
    const view: RenderResult = render(monitoringRow({ initialValue: false }));
    view.unmount();

    expect(() => {
      announceModelSwitchSaved({
        modelType: Monitor,
        modelId: new ObjectID(RECORD_ID),
        column: "disableActiveMonitoring",
        value: false,
      });
    }).not.toThrow();
  });
});
