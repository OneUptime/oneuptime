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

/*
 * A card of switches for one record (UI/Components/ModelSwitch/
 * ModelSwitchesCard): what a card becomes whose Edit dialog held nothing
 * but switches - the AI settings pages' "Investigate new incidents", "Draft
 * a postmortem when an incident resolves" and the rest.
 *
 * It reads the record once, for every switch's column, and draws one row
 * per switch (ModelSwitchRow, which has its own suite). Each row saves its
 * own column alone, keeps its own "Saved" and its own refusal, locks by its
 * own column's permissions, and asks first where its definition says so.
 *
 * The network and the signed-in user's permissions are stubbed; the gate,
 * the rows, the Toggles and the dialog are the real ones.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
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

import ModelSwitchesCard, {
  ComponentProps,
  ModelSwitchesCardSwitch,
} from "../../../UI/Components/ModelSwitch/ModelSwitchesCard";
import { ModelSwitchConfirmation } from "../../../UI/Components/ModelSwitch/ModelSwitchRow";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const RECORD_ID: string = "7c7c7c7c-0000-4000-8000-0000000000aa";
const OTHER_ID: string = "7c7c7c7c-0000-4000-8000-0000000000bb";
const CARD_TEST_ID: string = "the-switches";

// What the server holds for the record, or why it cannot be read.
let stored: Record<string, unknown> | null | Error = null;

beforeEach(() => {
  stored = {};
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const item: Project = new Project();
    item._id = RECORD_ID;
    Object.assign(item, stored);
    return item;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * Three Project columns: one whose model default is on (enableAi), two
 * whose default is off - the way the AI settings pages mix them.
 */
const SWITCHES: Array<ModelSwitchesCardSwitch<Project>> = [
  {
    column: "enableAutomaticIncidentInvestigation",
    title: "Investigate new incidents",
    getDescription: (): string => {
      return "OneUptime AI looks into each new incident.";
    },
    dataTestId: "switch-investigate",
  },
  {
    column: "enableAutomaticPostmortemDraft",
    title: "Draft a postmortem when an incident resolves",
    note: "It never replaces a postmortem that already exists.",
    dataTestId: "switch-postmortem",
  },
  {
    column: "enableAi",
    title: "Enable AI",
    dataTestId: "switch-ai",
  },
];

function card(props?: Partial<ComponentProps<Project>>): ReactElement {
  return (
    <ModelSwitchesCard<Project>
      modelType={Project}
      modelId={new ObjectID(RECORD_ID)}
      cardTitle="What OneUptime AI does"
      cardDescription="It works on incidents on its own."
      switches={SWITCHES}
      dataTestId={CARD_TEST_ID}
      {...props}
    />
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function loaded(): Promise<void> {
  await screen.findByTestId("switch-investigate");
}

function theSwitch(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

async function press(testId: string): Promise<void> {
  fireEvent.click(theSwitch(testId));
  await flush();
}

interface GetItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

function getItemCall(index: number = 0): GetItemCall {
  return getItemMock.mock.calls[index]![0] as GetItemCall;
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

describe("ModelSwitchesCard reads the record once", () => {
  test("it is a card with its title and line, then one switch per definition, in order", async () => {
    stored = {
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticPostmortemDraft: false,
      enableAi: true,
    };

    render(card());

    expect(screen.getByText("What OneUptime AI does")).toBeInTheDocument();
    expect(
      screen.getByText("It works on incidents on its own."),
    ).toBeInTheDocument();

    await loaded();

    const switches: Array<HTMLElement> = within(
      screen.getByTestId(CARD_TEST_ID),
    ).getAllByRole("switch");

    expect(
      switches.map((control: HTMLElement): string | null => {
        return control.getAttribute("data-testid");
      }),
    ).toEqual(["switch-investigate", "switch-postmortem", "switch-ai"]);
    expect(
      switches.map((control: HTMLElement): string | null => {
        return control.getAttribute("aria-checked");
      }),
    ).toEqual(["true", "false", "true"]);

    // Named by their titles, as anywhere else a switch is drawn.
    expect(
      screen.getByRole("switch", { name: "Investigate new incidents" }),
    ).toBe(switches[0]);
  });

  test("it reads that record, for every switch's column at once", async () => {
    render(card());
    await loaded();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemCall().modelType).toBe(Project);
    expect(getItemCall().id.toString()).toBe(RECORD_ID);
    expect(getItemCall().select).toEqual({
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticPostmortemDraft: true,
      enableAi: true,
    });
  });

  test("columns the page asks for are read with them, and handed over", async () => {
    stored = { name: "Acme", enableAi: false };
    const onLoaded: MockFunction = getJestMockFunction();

    render(card({ select: { name: true }, onLoaded }));
    await loaded();

    expect(getItemCall().select).toEqual({
      name: true,
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticPostmortemDraft: true,
      enableAi: true,
    });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect((onLoaded.mock.calls[0]![0] as Project).name).toBe("Acme");
  });

  test("a column never written reads as its model's default", async () => {
    // enableAi defaults on; the two AI behaviours default off.
    stored = {};

    render(card());
    await loaded();

    expect(theSwitch("switch-investigate")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(theSwitch("switch-postmortem")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(theSwitch("switch-ai")).toHaveAttribute("aria-checked", "true");
  });

  test("an inverted switch is on while its column is false", async () => {
    stored = { doNotAddGlobalProbesByDefaultOnNewMonitors: false };

    render(
      card({
        switches: [
          {
            column: "doNotAddGlobalProbesByDefaultOnNewMonitors",
            title: "Add global probes to new monitors",
            isInverted: true,
            dataTestId: "switch-probes",
          },
        ],
      }),
    );

    expect(await screen.findByTestId("switch-probes")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("each switch says its own sentence and note", async () => {
    render(card());
    await loaded();

    expect(screen.getByTestId("switch-investigate-row")).toHaveTextContent(
      "OneUptime AI looks into each new incident.",
    );
    expect(screen.getByTestId("switch-postmortem-row")).toHaveTextContent(
      "It never replaces a postmortem that already exists.",
    );
    expect(screen.getByTestId("switch-ai-row")).not.toHaveTextContent(
      "OneUptime AI looks into each new incident.",
    );
  });

  test("the caller hears where every switch is once it is read", async () => {
    stored = {
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticPostmortemDraft: false,
      enableAi: false,
    };
    const onChange: MockFunction = getJestMockFunction();

    render(card({ onChange }));
    await loaded();

    expect(onChange.mock.calls).toEqual([
      ["enableAutomaticIncidentInvestigation", true],
      ["enableAutomaticPostmortemDraft", false],
      ["enableAi", false],
    ]);
  });

  test("while it reads it shows a loader, and no switch", () => {
    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>(() => {
        // Never answers.
      });
    });

    render(card());

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByTestId(CARD_TEST_ID)).toBeInTheDocument();
  });

  test("a failed read says why, and tries again when asked", async () => {
    stored = new Error("The project could not be read.");

    render(card());
    await flush();

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByTestId(CARD_TEST_ID)).toHaveTextContent(
      "The project could not be read.",
    );

    stored = { enableAi: true };
    fireEvent.click(
      within(screen.getByTestId(CARD_TEST_ID)).getByRole("button"),
    );
    await loaded();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(theSwitch("switch-ai")).toHaveAttribute("aria-checked", "true");
  });

  test("a record that is not there says so", async () => {
    stored = null;

    render(card());
    await flush();

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByTestId(CARD_TEST_ID)).toHaveTextContent(
      "Item not found",
    );
  });

  test("another record is read again, and an old answer never lands on it", async () => {
    let answerFirst: (value: unknown) => void = (): void => {
      // Set below.
    };

    getItemMock.mockImplementationOnce((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        answerFirst = resolve;
      });
    });

    const view: RenderResult = render(card());

    stored = { enableAi: false };
    view.rerender(card({ modelId: new ObjectID(OTHER_ID) }));
    await loaded();

    // The first record's late answer says enableAi is on.
    const late: Project = new Project();
    late._id = RECORD_ID;
    late.enableAi = true;
    answerFirst(late);
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(getItemCall(1).id.toString()).toBe(OTHER_ID);
    expect(theSwitch("switch-ai")).toHaveAttribute("aria-checked", "false");
  });
});

describe("ModelSwitchesCard: each switch saves its own column", () => {
  test("a flip saves exactly that column of that record, and only that row says Saved", async () => {
    stored = {
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticPostmortemDraft: false,
      enableAi: true,
    };
    const onSaved: MockFunction = getJestMockFunction();

    render(card({ onSaved }));
    await loaded();

    await press("switch-postmortem");

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Project);
    expect(updateCall().id.toString()).toBe(RECORD_ID);
    expect(updateCall().data).toEqual({ enableAutomaticPostmortemDraft: true });
    expect(theSwitch("switch-postmortem")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("switch-postmortem-status")).toHaveTextContent(
      "Saved",
    );
    expect(screen.getByTestId("switch-investigate-status").textContent).toBe(
      "",
    );
    expect(onSaved.mock.calls).toEqual([
      ["enableAutomaticPostmortemDraft", true],
    ]);
  });

  test("two switches flipped one after the other save one column each", async () => {
    stored = {
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticPostmortemDraft: true,
      enableAi: true,
    };

    render(card());
    await loaded();

    await press("switch-investigate");
    await press("switch-postmortem");

    expect(
      updateByIdMock.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as UpdateCall).data;
      }),
    ).toEqual([
      { enableAutomaticIncidentInvestigation: false },
      { enableAutomaticPostmortemDraft: false },
    ]);
  });

  test("a refused save moves that switch back with why, and leaves the others alone", async () => {
    stored = {
      enableAutomaticIncidentInvestigation: true,
      enableAutomaticPostmortemDraft: false,
      enableAi: true,
    };
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("AI is disabled for this project.");
    });

    render(card());
    await loaded();

    await press("switch-investigate");

    expect(theSwitch("switch-investigate")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("switch-investigate-row")).toHaveTextContent(
      "AI is disabled for this project.",
    );
    expect(screen.getByTestId("switch-postmortem-row")).not.toHaveTextContent(
      "AI is disabled for this project.",
    );
    expect(theSwitch("switch-postmortem")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("the caller hears each move, with the switch it was", async () => {
    stored = { enableAi: true };
    const onChange: MockFunction = getJestMockFunction();

    render(card({ onChange }));
    await loaded();
    onChange.mockClear();

    await press("switch-ai");

    expect(onChange.mock.calls).toEqual([["enableAi", false]]);
  });

  test("a switch whose definition asks first opens its dialog, and saves only when confirmed", async () => {
    stored = { enableAi: true };

    const askBeforeOff: (
      isTurningOn: boolean,
    ) => ModelSwitchConfirmation | undefined = (
      isTurningOn: boolean,
    ): ModelSwitchConfirmation | undefined => {
      return isTurningOn
        ? undefined
        : {
            title: "Turn off AI for this project?",
            description: "Every AI feature in this project stops at once.",
            submitButtonText: "Turn off AI",
          };
    };

    render(
      card({
        switches: SWITCHES.map(
          (
            definition: ModelSwitchesCardSwitch<Project>,
          ): ModelSwitchesCardSwitch<Project> => {
            return definition.column === "enableAi"
              ? { ...definition, getConfirmation: askBeforeOff }
              : definition;
          },
        ),
      }),
    );
    await loaded();

    await press("switch-ai");

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Turn off AI for this project?");
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Turn off AI" }),
    );
    await flush();

    expect(updateCall().data).toEqual({ enableAi: false });

    // The other switches never ask.
    await press("switch-investigate");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).toHaveBeenCalledTimes(2);
  });

  test("a save of one of its columns made elsewhere on the screen moves that switch", async () => {
    stored = { enableAi: true, enableAutomaticPostmortemDraft: false };

    const view: RenderResult = render(card());
    await loaded();

    /*
     * The rows listen from an effect. They were drawn when the read
     * resolved, outside act, so React runs that effect on its own schedule
     * and findBy can find them before it has run. Drawing the card again
     * inside act makes React run every pending effect first.
     */
    await act(async () => {
      view.rerender(card());
    });

    act(() => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(RECORD_ID),
        column: "enableAi",
        value: false,
        source: "the-notice",
      });
    });

    expect(theSwitch("switch-ai")).toHaveAttribute("aria-checked", "false");
    expect(theSwitch("switch-postmortem")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("it saves through the API it is given", async () => {
    const otherApi: { updateById: MockFunction; getItem: MockFunction } = {
      updateById: getJestMockFunction(),
      getItem: getJestMockFunction(),
    };
    otherApi.getItem.mockImplementation(async (): Promise<Project> => {
      const item: Project = new Project();
      item._id = RECORD_ID;
      item.enableAi = true;
      return item;
    });
    otherApi.updateById.mockImplementation(async (): Promise<unknown> => {
      return {};
    });

    render(card({ modelAPI: otherApi as unknown as typeof ModelAPI }));
    await loaded();
    await press("switch-ai");

    expect(getItemMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(otherApi.getItem).toHaveBeenCalledTimes(1);
    expect(otherApi.updateById).toHaveBeenCalledTimes(1);
  });
});

describe("ModelSwitchesCard locks each switch by its own column", () => {
  /*
   * A Project Admin may change the AI behaviours, but not Enable AI, which
   * takes Project Owner or Manage Billing: one card, two answers.
   */
  test("a switch whose column the person may not change is locked, with why; the others work", async () => {
    permissionsForTest = [Permission.ProjectAdmin];
    stored = { enableAi: true, enableAutomaticIncidentInvestigation: true };

    render(card());
    await loaded();

    expect(theSwitch("switch-ai")).toHaveAttribute("aria-disabled", "true");
    const row: HTMLElement = screen.getByTestId("switch-ai-row");
    expect(row).toHaveTextContent(
      "You do not have permission to update this Project.",
    );
    expect(row).toHaveTextContent("Project Owner");
    expect(row).toHaveTextContent("Manage Billing");

    await press("switch-ai");
    expect(updateByIdMock).not.toHaveBeenCalled();

    expect(theSwitch("switch-investigate")).not.toHaveAttribute(
      "aria-disabled",
    );
    await press("switch-investigate");
    expect(updateCall().data).toEqual({
      enableAutomaticIncidentInvestigation: false,
    });
  });

  test("someone the Project table lets in but the AI columns do not sees every AI behaviour locked", async () => {
    permissionsForTest = [Permission.EditProject];
    stored = {};

    render(card());
    await loaded();

    for (const testId of ["switch-investigate", "switch-postmortem"]) {
      expect([testId, theSwitch(testId).getAttribute("aria-disabled")]).toEqual(
        [testId, "true"],
      );
    }

    expect(screen.getByTestId("switch-investigate-row")).toHaveTextContent(
      "Project Admin",
    );

    await press("switch-postmortem");
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
