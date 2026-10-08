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
 * Switches that belong to another switch (UI/Components/ModelSwitch):
 * "Open a fix pull request when an investigation finds a code change" and
 * "Open a pull request that adds missing telemetry" under "Fix new
 * incidents automatically". The maintainer: "The two dots below should be
 * auto-turned on when the 'Fix new alerts automatically' is turned on, and
 * it should actually be a child of 'Fix new alerts automatically'."
 *
 * Pinned here, on the shared pieces every page draws them with:
 *
 *  - getModelSwitchWrite: what a flip writes - its own column and each
 *    child's, set the same way, in one write;
 *  - ModelSwitchRow childSwitches: one request for all of them, every
 *    column announced, a refused save changing none of them, and a lock
 *    when one of the child columns may not be changed;
 *  - ModelSwitchRow childrenWhileOn: drawn under the switch's name only
 *    while it is on, not while a change to on is saved or asked about, gone
 *    at once when it is turned off, back if that is refused;
 *  - ModelSwitchesCard children: read with the rest, nested under their
 *    switch, on with it and off with it, each flipped on its own while it
 *    is on.
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
  ComponentProps as CardProps,
  getModelSwitchesInOrder,
  ModelSwitchesCardChildSwitch,
  ModelSwitchesCardSwitch,
} from "../../../UI/Components/ModelSwitch/ModelSwitchesCard";
import ModelSwitchRow, {
  ComponentProps as RowProps,
  ModelSwitchConfirmation,
} from "../../../UI/Components/ModelSwitch/ModelSwitchRow";
import {
  announceModelSwitchSaved,
  MODEL_SWITCH_SAVED_EVENT,
  ModelSwitchSaved,
  subscribeToModelSwitchSaved,
} from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import {
  getModelSwitchWrite,
  MODEL_SWITCH_CHILDREN_CLASS_NAME,
} from "../../../UI/Components/ModelSwitch/ModelSwitchUtil";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const RECORD_ID: string = "7c7c7c7c-0000-4000-8000-0000000000cc";
const CARD_TEST_ID: string = "the-switches";

const FIX: string = "switch-fix";
const CODE_FIX: string = "switch-code-fix";
const TELEMETRY: string = "switch-telemetry";
const INVESTIGATE: string = "switch-investigate";

// What the server holds for the record.
let stored: Record<string, unknown> = {};

beforeEach(() => {
  stored = {};
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const item: Project = new Project();
    item._id = RECORD_ID;
    Object.assign(item, stored);
    return item;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (data: unknown): Promise<unknown> => {
    Object.assign(stored, (data as { data: Record<string, unknown> }).data);
    return {};
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function press(testId: string): Promise<void> {
  fireEvent.click(screen.getByTestId(testId));
  await flush();
}

function checked(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("aria-checked");
}

// Every write the switches sent, as the columns and values each held.
function writes(): Array<Record<string, unknown>> {
  return updateByIdMock.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

/*
 * A save that waits until the test lets it finish (or fail), to look at
 * the switch while it is out.
 */
function holdSaves(): { finish: () => void; refuse: (why: string) => void } {
  let finish: () => void = (): void => {
    // Set below.
  };
  let refuse: (why: string) => void = (): void => {
    // Set below.
  };

  updateByIdMock.mockImplementation((): Promise<unknown> => {
    return new Promise<unknown>(
      (
        resolve: (value: unknown) => void,
        reject: (reason: unknown) => void,
      ) => {
        finish = (): void => {
          resolve({});
        };
        refuse = (why: string): void => {
          reject(new Error(why));
        };
      },
    );
  });

  return {
    finish: (): void => {
      finish();
    },
    refuse: (why: string): void => {
      refuse(why);
    },
  };
}

describe("getModelSwitchWrite: what a flip writes", () => {
  test("a switch with no children writes its own column alone", () => {
    expect(
      getModelSwitchWrite({
        column: "enableAutomaticPostmortemDraft",
        isOn: true,
      }),
    ).toEqual({ enableAutomaticPostmortemDraft: true });
    expect(
      getModelSwitchWrite({
        column: "enableAutomaticPostmortemDraft",
        isOn: false,
        childSwitches: [],
      }),
    ).toEqual({ enableAutomaticPostmortemDraft: false });
  });

  test.each([[true], [false]])(
    "turned %s, its children are set the same way, in the same write",
    (isOn: boolean) => {
      expect(
        getModelSwitchWrite({
          column: "enableAutomaticAlertRemediation",
          isOn,
          childSwitches: [
            { column: "enableAutomaticAlertCodeFixes" },
            { column: "enableAlertInstrumentationFixTasks" },
          ],
        }),
      ).toEqual({
        enableAutomaticAlertRemediation: isOn,
        enableAutomaticAlertCodeFixes: isOn,
        enableAlertInstrumentationFixTasks: isOn,
      });
    },
  );

  test("each column is stored the way its own switch reads: an inverted one the other way round", () => {
    expect(
      getModelSwitchWrite({
        column: "parent",
        isOn: true,
        childSwitches: [
          { column: "plainChild" },
          { column: "invertedChild", isInverted: true },
        ],
      }),
    ).toEqual({ parent: true, plainChild: true, invertedChild: false });

    expect(
      getModelSwitchWrite({
        column: "parent",
        isOn: true,
        isInverted: true,
        childSwitches: [{ column: "plainChild" }],
      }),
    ).toEqual({ parent: false, plainChild: true });
  });

  test("a child naming the switch's own column cannot overwrite it", () => {
    expect(
      getModelSwitchWrite({
        column: "parent",
        isOn: true,
        childSwitches: [{ column: "parent", isInverted: true }],
      }),
    ).toEqual({ parent: true });
  });
});

describe("where the children are drawn", () => {
  const pixels: (pattern: RegExp) => number = (pattern: RegExp): number => {
    const match: RegExpMatchArray | null =
      MODEL_SWITCH_CHILDREN_CLASS_NAME.match(pattern);

    expect(match).not.toBeNull();

    return Number(match![1]);
  };

  const MARGIN: RegExp = /(?:^|\s)ml-\[(\d+)px\]/;
  const SM_PADDING: RegExp = /(?:^|\s)sm:pl-\[(\d+)px\]/;
  const RULE: RegExp = /(?:^|\s)border-l-2(?:\s|$)/;

  /*
   * A switch is 44px wide and 12px from its name (Toggle: h-6 w-11, gap-3):
   * everything under a switch's name starts at 56px (pl-14).
   */
  test("the rule drops from the middle of the switch above, and each child switch lines up with its name", () => {
    expect(RULE.test(MODEL_SWITCH_CHILDREN_CLASS_NAME)).toBe(true);

    // A 2px rule centred on the middle of a 44px switch.
    expect(pixels(MARGIN) + 1).toBe(44 / 2);

    // From sm up the child switches start where the name above starts.
    expect(pixels(MARGIN) + 2 + pixels(SM_PADDING)).toBe(44 + 12);
  });

  test("it is drawn in the product's border grey, so the dark theme recolours it", () => {
    expect(MODEL_SWITCH_CHILDREN_CLASS_NAME.split(" ")).toContain(
      "border-gray-200",
    );
    // Not a hand-built card frame: no shadow, no rounded box, no fill.
    expect(MODEL_SWITCH_CHILDREN_CLASS_NAME).not.toMatch(/shadow|rounded|bg-/);
  });
});

/*
 * A row with two children drawn under it, the way ModelSwitchesCard draws
 * them: two more rows.
 */
function rowWithChildren(props?: Partial<RowProps<Project>>): ReactElement {
  return (
    <ModelSwitchRow<Project>
      modelType={Project}
      modelId={new ObjectID(RECORD_ID)}
      column="enableAutomaticAlertRemediation"
      initialValue={false}
      title="Fix new alerts automatically"
      dataTestId={FIX}
      childSwitches={[
        { column: "enableAutomaticAlertCodeFixes" },
        { column: "enableAlertInstrumentationFixTasks" },
      ]}
      childrenWhileOn={
        <>
          <ModelSwitchRow<Project>
            modelType={Project}
            modelId={new ObjectID(RECORD_ID)}
            column="enableAutomaticAlertCodeFixes"
            initialValue={true}
            title="Open a fix pull request when an investigation finds a code change"
            dataTestId={CODE_FIX}
          />
          <ModelSwitchRow<Project>
            modelType={Project}
            modelId={new ObjectID(RECORD_ID)}
            column="enableAlertInstrumentationFixTasks"
            initialValue={true}
            title="Open a pull request that adds missing telemetry"
            dataTestId={TELEMETRY}
          />
        </>
      }
      {...props}
    />
  );
}

describe("ModelSwitchRow: a switch with switches under it", () => {
  test("turning it on writes it and every child switch in ONE request", async () => {
    render(rowWithChildren());

    await press(FIX);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([
      {
        enableAutomaticAlertRemediation: true,
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: true,
      },
    ]);
    expect(
      String((updateByIdMock.mock.calls[0]![0] as { id: unknown }).id),
    ).toBe(RECORD_ID);
    expect(checked(FIX)).toBe("true");
    expect(screen.getByTestId(`${FIX}-status`)).toHaveTextContent("Saved");
  });

  test("turning it off writes it and every child switch off, in one request", async () => {
    render(rowWithChildren({ initialValue: true }));

    await press(FIX);

    expect(writes()).toEqual([
      {
        enableAutomaticAlertRemediation: false,
        enableAutomaticAlertCodeFixes: false,
        enableAlertInstrumentationFixTasks: false,
      },
    ]);
    expect(checked(FIX)).toBe("false");
  });

  test("every column it saved is announced, its own first, so anything showing one follows", async () => {
    const heard: Array<ModelSwitchSaved> = [];
    const listener: (event: CustomEvent) => void = (
      event: CustomEvent,
    ): void => {
      heard.push(event.detail as ModelSwitchSaved);
    };
    GlobalEvents.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);

    try {
      render(rowWithChildren());
      await press(FIX);
    } finally {
      GlobalEvents.removeEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
    }

    expect(
      heard.map((saved: ModelSwitchSaved): [string, boolean] => {
        return [saved.column, saved.value];
      }),
    ).toEqual([
      ["enableAutomaticAlertRemediation", true],
      ["enableAutomaticAlertCodeFixes", true],
      ["enableAlertInstrumentationFixTasks", true],
    ]);
    for (const saved of heard) {
      expect(saved.tableName).toBe("Project");
      expect(saved.modelId).toBe(RECORD_ID);
    }
  });

  test("a refused save changes none of them: it moves back, says why, announces nothing and draws no children", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to update this Project.");
    });
    const heard: MockFunction = getJestMockFunction();
    const unsubscribe: () => void = subscribeToModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(RECORD_ID),
      column: "enableAutomaticAlertCodeFixes",
      onSaved: (value: boolean): void => {
        heard(value);
      },
    });

    try {
      render(rowWithChildren());
      await press(FIX);
    } finally {
      unsubscribe();
    }

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(checked(FIX)).toBe("false");
    expect(screen.getByTestId(`${FIX}-row`)).toHaveTextContent(
      "You do not have permission to update this Project.",
    );
    expect(heard).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();
    expect(screen.queryByTestId(CODE_FIX)).toBeNull();
  });

  test("its children are drawn under it only while it is on", async () => {
    const view: RenderResult = render(rowWithChildren());

    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();
    expect(screen.queryByTestId(CODE_FIX)).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(1);

    view.unmount();
    render(rowWithChildren({ initialValue: true }));

    const group: HTMLElement = screen.getByTestId(`${FIX}-children`);
    expect(within(group).getByTestId(CODE_FIX)).toBeInTheDocument();
    expect(within(group).getByTestId(TELEMETRY)).toBeInTheDocument();
    // Not inside the switch's own row: under it.
    expect(
      within(screen.getByTestId(`${FIX}-row`)).queryByTestId(CODE_FIX),
    ).toBeNull();
  });

  test("they are a group named for the switch they belong to, hanging from it", () => {
    render(rowWithChildren({ initialValue: true }));

    const group: HTMLElement = screen.getByRole("group", {
      name: "Fix new alerts automatically",
    });

    expect(group).toBe(screen.getByTestId(`${FIX}-children`));
    expect(group.className).toBe(MODEL_SWITCH_CHILDREN_CLASS_NAME);
    expect(within(group).getAllByRole("switch")).toHaveLength(2);
    // The group follows the switch's row.
    expect(screen.getByTestId(`${FIX}-row`).nextElementSibling).toBe(group);
  });

  test("turning it on, they come once the save is done - not while it is out", async () => {
    const save: { finish: () => void } = holdSaves();

    render(rowWithChildren());

    fireEvent.click(screen.getByTestId(FIX));
    await flush();

    expect(checked(FIX)).toBe("true");
    expect(screen.getByTestId(`${FIX}-status`)).toHaveTextContent("Saving");
    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();

    await act(async () => {
      save.finish();
    });
    await flush();

    expect(screen.getByTestId(`${FIX}-status`)).toHaveTextContent("Saved");
    expect(screen.getByTestId(`${FIX}-children`)).toBeInTheDocument();
  });

  test("turning it off, they go at once, and come back if the save is refused", async () => {
    const save: { refuse: (why: string) => void } = holdSaves();

    render(rowWithChildren({ initialValue: true }));
    expect(screen.getByTestId(`${FIX}-children`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(FIX));
    await flush();

    expect(checked(FIX)).toBe("false");
    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();

    await act(async () => {
      save.refuse("The project could not be saved.");
    });
    await flush();

    expect(checked(FIX)).toBe("true");
    expect(screen.getByTestId(`${FIX}-children`)).toBeInTheDocument();
    expect(screen.getByTestId(`${FIX}-row`)).toHaveTextContent(
      "The project could not be saved.",
    );
  });

  test("a switch that asks first shows no children while its dialog is open, and saves them all once confirmed", async () => {
    const askBeforeOn: (
      isTurningOn: boolean,
    ) => ModelSwitchConfirmation | undefined = (
      isTurningOn: boolean,
    ): ModelSwitchConfirmation | undefined => {
      return isTurningOn
        ? {
            title: "Let OneUptime AI fix new alerts?",
            description: "It can change your infrastructure.",
            submitButtonText: "Turn on",
          }
        : undefined;
    };

    render(rowWithChildren({ getConfirmation: askBeforeOn }));

    await press(FIX);

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Let OneUptime AI fix new alerts?");
    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
    await flush();

    expect(writes()).toEqual([
      {
        enableAutomaticAlertRemediation: true,
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: true,
      },
    ]);
    expect(screen.getByTestId(`${FIX}-children`)).toBeInTheDocument();
  });

  test("a cancelled dialog saves nothing and shows no children", async () => {
    render(
      rowWithChildren({
        getConfirmation: (): ModelSwitchConfirmation => {
          return {
            title: "Sure?",
            description: "It can change your infrastructure.",
            submitButtonText: "Turn on",
          };
        },
      }),
    );

    await press(FIX);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(checked(FIX)).toBe("false");
    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();
  });

  /*
   * The server checks every column of a write: one the person may not
   * change refuses all of them. So the switch is locked by its children's
   * columns as well as its own - here a child that takes Project Owner or
   * Manage Billing (enableAi) under a switch a Project Admin may change.
   */
  test("it is locked, saying why, when the person may not change one of its children", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    render(
      rowWithChildren({
        childSwitches: [
          { column: "enableAutomaticAlertCodeFixes" },
          { column: "enableAi" },
        ],
      }),
    );

    expect(screen.getByTestId(FIX)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId(`${FIX}-row`)).toHaveTextContent(
      "Manage Billing",
    );

    await press(FIX);

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(checked(FIX)).toBe("false");
  });

  test("with children it may change, a Project Admin flips it", async () => {
    permissionsForTest = [Permission.ProjectAdmin];

    render(rowWithChildren());

    expect(screen.getByTestId(FIX)).not.toHaveAttribute("aria-disabled");
    await press(FIX);
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("a switch without children draws exactly the row it always did", () => {
    render(
      <ModelSwitchRow<Project>
        modelType={Project}
        modelId={new ObjectID(RECORD_ID)}
        column="enableAutomaticPostmortemDraft"
        initialValue={true}
        title="Draft a postmortem when an incident resolves"
        dataTestId="switch-postmortem"
      />,
    );

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });
});

/*
 * The card, as the AI settings pages use it: "Investigate new alerts",
 * then "Fix new alerts automatically" with its two pull requests.
 */
const CHILDREN: Array<ModelSwitchesCardChildSwitch<Project>> = [
  {
    column: "enableAutomaticAlertCodeFixes",
    title: "Open a fix pull request when an investigation finds a code change",
    note: "Needs a repository connected through the GitHub App and a Runner that can fix code.",
    dataTestId: CODE_FIX,
  },
  {
    column: "enableAlertInstrumentationFixTasks",
    title: "Open a pull request that adds missing telemetry",
    dataTestId: TELEMETRY,
  },
];

const SWITCHES: Array<ModelSwitchesCardSwitch<Project>> = [
  {
    column: "enableAutomaticAlertInvestigation",
    title: "Investigate new alerts",
    dataTestId: INVESTIGATE,
  },
  {
    column: "enableAutomaticAlertRemediation",
    title: "Fix new alerts automatically",
    dataTestId: FIX,
    children: CHILDREN,
  },
];

function card(props?: Partial<CardProps<Project>>): ReactElement {
  return (
    <ModelSwitchesCard<Project>
      modelType={Project}
      modelId={new ObjectID(RECORD_ID)}
      cardTitle="What OneUptime AI does"
      switches={SWITCHES}
      dataTestId={CARD_TEST_ID}
      {...props}
    />
  );
}

async function loaded(): Promise<void> {
  await screen.findByTestId(FIX);
}

function switchIds(): Array<string | null> {
  return within(screen.getByTestId(CARD_TEST_ID))
    .getAllByRole("switch")
    .map((control: HTMLElement): string | null => {
      return control.getAttribute("data-testid");
    });
}

describe("getModelSwitchesInOrder", () => {
  test("every switch, each followed by the ones under it", () => {
    expect(
      getModelSwitchesInOrder(SWITCHES).map(
        (definition: ModelSwitchesCardChildSwitch<Project>): string => {
          return definition.column;
        },
      ),
    ).toEqual([
      "enableAutomaticAlertInvestigation",
      "enableAutomaticAlertRemediation",
      "enableAutomaticAlertCodeFixes",
      "enableAlertInstrumentationFixTasks",
    ]);
  });
});

describe("ModelSwitchesCard: switches under a switch", () => {
  test("it reads every column at once, the ones under a switch too", async () => {
    render(card());
    await loaded();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(
      (getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual({
      enableAutomaticAlertInvestigation: true,
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: true,
    });
  });

  test("with the switch off, the switches under it are not offered - whatever they hold", async () => {
    stored = {
      enableAutomaticAlertInvestigation: true,
      enableAutomaticAlertRemediation: false,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: true,
    };

    render(card());
    await loaded();

    expect(switchIds()).toEqual([INVESTIGATE, FIX]);
    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();
    expect(checked(FIX)).toBe("false");
  });

  test("with the switch on, they hang under it, each as the record holds it", async () => {
    stored = {
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: false,
      enableAlertInstrumentationFixTasks: true,
    };

    render(card());
    await loaded();

    expect(switchIds()).toEqual([INVESTIGATE, FIX, CODE_FIX, TELEMETRY]);

    const group: HTMLElement = screen.getByTestId(`${FIX}-children`);
    expect(
      within(group)
        .getAllByRole("switch")
        .map((control: HTMLElement): string | null => {
          return control.getAttribute("data-testid");
        }),
    ).toEqual([CODE_FIX, TELEMETRY]);
    expect(checked(CODE_FIX)).toBe("false");
    expect(checked(TELEMETRY)).toBe("true");

    // Each says its own sentence, under its own name.
    expect(screen.getByTestId(`${CODE_FIX}-row`)).toHaveTextContent(
      "Needs a repository connected through the GitHub App and a Runner that can fix code.",
    );
    expect(
      screen.getByRole("switch", {
        name: "Open a pull request that adds missing telemetry",
      }),
    ).toBe(screen.getByTestId(TELEMETRY));

    // The other switch has none.
    expect(screen.queryByTestId(`${INVESTIGATE}-children`)).toBeNull();
  });

  test("turning the switch on is ONE save that turns both on, and they appear on - even ones that were off", async () => {
    stored = {
      enableAutomaticAlertRemediation: false,
      enableAutomaticAlertCodeFixes: false,
      enableAlertInstrumentationFixTasks: false,
    };
    const onSaved: MockFunction = getJestMockFunction();

    render(card({ onSaved }));
    await loaded();

    await press(FIX);

    expect(writes()).toEqual([
      {
        enableAutomaticAlertRemediation: true,
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: true,
      },
    ]);
    expect(switchIds()).toEqual([INVESTIGATE, FIX, CODE_FIX, TELEMETRY]);
    expect(checked(CODE_FIX)).toBe("true");
    expect(checked(TELEMETRY)).toBe("true");
    expect(onSaved.mock.calls).toEqual([
      ["enableAutomaticAlertCodeFixes", true],
      ["enableAlertInstrumentationFixTasks", true],
      ["enableAutomaticAlertRemediation", true],
    ]);
  });

  test("turning the switch off is one save that turns both off, and they go", async () => {
    stored = {
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: false,
    };

    render(card());
    await loaded();

    await press(FIX);

    expect(writes()).toEqual([
      {
        enableAutomaticAlertRemediation: false,
        enableAutomaticAlertCodeFixes: false,
        enableAlertInstrumentationFixTasks: false,
      },
    ]);
    expect(switchIds()).toEqual([INVESTIGATE, FIX]);
  });

  test("while it is on, each switch under it is flipped on its own and saves its own column", async () => {
    stored = {
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: true,
    };

    render(card());
    await loaded();

    await press(CODE_FIX);

    expect(writes()).toEqual([{ enableAutomaticAlertCodeFixes: false }]);
    expect(checked(CODE_FIX)).toBe("false");
    expect(checked(TELEMETRY)).toBe("true");
    expect(checked(FIX)).toBe("true");
    expect(screen.getByTestId(`${CODE_FIX}-status`)).toHaveTextContent("Saved");
  });

  test("off and on again, both come back on - the one turned off by hand too", async () => {
    stored = {
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: true,
    };

    render(card());
    await loaded();

    await press(TELEMETRY);
    expect(checked(TELEMETRY)).toBe("false");

    await press(FIX);
    expect(screen.queryByTestId(TELEMETRY)).toBeNull();

    await press(FIX);

    expect(checked(CODE_FIX)).toBe("true");
    expect(checked(TELEMETRY)).toBe("true");
    expect(writes()).toEqual([
      { enableAlertInstrumentationFixTasks: false },
      {
        enableAutomaticAlertRemediation: false,
        enableAutomaticAlertCodeFixes: false,
        enableAlertInstrumentationFixTasks: false,
      },
      {
        enableAutomaticAlertRemediation: true,
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: true,
      },
    ]);
  });

  test("a refused turn-on leaves all three off: the switch moves back with why, and nothing appears under it", async () => {
    stored = {
      enableAutomaticAlertRemediation: false,
      enableAutomaticAlertCodeFixes: false,
      enableAlertInstrumentationFixTasks: false,
    };
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("AI is disabled for this project.");
    });
    const onChange: MockFunction = getJestMockFunction();

    render(card({ onChange }));
    await loaded();
    onChange.mockClear();

    await press(FIX);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(checked(FIX)).toBe("false");
    expect(switchIds()).toEqual([INVESTIGATE, FIX]);
    expect(screen.getByTestId(`${FIX}-row`)).toHaveTextContent(
      "AI is disabled for this project.",
    );
    // The switches under it never moved.
    expect(onChange.mock.calls).toEqual([
      ["enableAutomaticAlertRemediation", true],
      ["enableAutomaticAlertRemediation", false],
    ]);
  });

  test("a refused turn-off brings them back as they were, the one turned off by hand still off", async () => {
    stored = {
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: true,
    };

    render(card());
    await loaded();

    await press(CODE_FIX);
    expect(checked(CODE_FIX)).toBe("false");

    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The project could not be saved.");
    });

    await press(FIX);

    expect(checked(FIX)).toBe("true");
    expect(checked(CODE_FIX)).toBe("false");
    expect(checked(TELEMETRY)).toBe("true");
  });

  test("the caller hears every switch once the record is read, the ones under a switch too", async () => {
    stored = {
      enableAutomaticAlertInvestigation: true,
      enableAutomaticAlertRemediation: false,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: false,
    };
    const onChange: MockFunction = getJestMockFunction();

    render(card({ onChange }));
    await loaded();

    expect(onChange.mock.calls).toEqual([
      ["enableAutomaticAlertInvestigation", true],
      ["enableAutomaticAlertRemediation", false],
      ["enableAutomaticAlertCodeFixes", true],
      ["enableAlertInstrumentationFixTasks", false],
    ]);
  });

  test("someone who may not change them sees the switch locked, and with it on, the ones under it locked too", async () => {
    permissionsForTest = [Permission.EditProject];
    stored = {
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: false,
    };

    render(card());
    await loaded();

    for (const testId of [FIX, CODE_FIX, TELEMETRY]) {
      expect([
        testId,
        screen.getByTestId(testId).getAttribute("aria-disabled"),
      ]).toEqual([testId, "true"]);
    }

    await press(FIX);
    await press(TELEMETRY);

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(screen.getByTestId(`${FIX}-children`)).toBeInTheDocument();
  });

  test("a save of the switch made elsewhere on the screen moves it, and with it what is under it", async () => {
    stored = {
      enableAutomaticAlertRemediation: true,
      enableAutomaticAlertCodeFixes: true,
      enableAlertInstrumentationFixTasks: true,
    };

    const view: RenderResult = render(card());
    await loaded();

    // Run the rows' effects (their subscriptions) before announcing.
    await act(async () => {
      view.rerender(card());
    });

    act(() => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(RECORD_ID),
        column: "enableAutomaticAlertRemediation",
        value: false,
        source: "somewhere-else",
      });
    });

    expect(checked(FIX)).toBe("false");
    expect(screen.queryByTestId(`${FIX}-children`)).toBeNull();
  });
});
