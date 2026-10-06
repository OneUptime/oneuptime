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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * What a project below a feature's plan still has of it, under the page's
 * upsell or plan note (Dashboard Components/Billing/PlanLeftoverTable).
 *
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed: the server lets every plan read, switch off (isEnabled false,
 * nothing else) and delete the records of a plan-gated table a project
 * already has (Common/Types/Billing/PlanGatedTable). This table offers
 * exactly that - and nothing to add, edit or switch on.
 *
 * The real component, dialog and switch rule are used; ModelTable is a
 * stand-in that records its props and draws the rows' actions, and the
 * network and the permission gate are stubbed.
 */

const countMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

interface RecordedAction {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  isVisible?: ((item: unknown) => boolean | undefined) | undefined;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
}

interface RecordedColumn {
  field: Record<string, unknown>;
  title: string;
}

interface RecordedTable {
  id: string;
  modelType: unknown;
  query: Record<string, unknown>;
  isCreateable: boolean;
  isEditable?: boolean;
  isDeleteable: boolean;
  isViewable?: boolean;
  refreshToggle?: string;
  cardProps: { title: string; description: string };
  columns: Array<RecordedColumn>;
  actionButtons: Array<RecordedAction>;
  filters: Array<unknown>;
}

// The rows the stand-in table lists, and every render's props.
const mockTable: {
  rows: Array<Record<string, unknown>>;
  renders: Array<RecordedTable>;
} = { rows: [], renders: [] };

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: RecordedTable): ReactElement => {
      mockTable.renders.push(props);

      return react.createElement(
        "div",
        { "data-testid": "stand-in-table" },
        react.createElement("h2", null, props.cardProps.title),
        react.createElement("p", null, props.cardProps.description),
        ...mockTable.rows.map((row: Record<string, unknown>): ReactElement => {
          return react.createElement(
            "div",
            {
              key: String(row["_id"]),
              "data-testid": `row-${String(row["_id"])}`,
            },
            String(row["name"]),
            ...props.actionButtons
              .filter((action: RecordedAction): boolean => {
                return !action.isVisible || action.isVisible(row) !== false;
              })
              .map((action: RecordedAction): ReactElement => {
                return react.createElement(
                  "button",
                  {
                    key: action.title,
                    type: "button",
                    disabled: Boolean(action.disabled),
                    title: action.tooltip,
                    onClick: () => {
                      action.onClick(
                        row,
                        () => {
                          return undefined;
                        },
                        () => {
                          return undefined;
                        },
                      );
                    },
                  },
                  action.title,
                );
              }),
          );
        }),
      );
    },
  };
});

import PlanLeftoverTable from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverTable";
import PlanLeftoverCopy, {
  PlanLeftoverTitle,
  getPlanLeftoverDescription,
  getPlanLeftoverTableTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverCopy";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import FieldType from "../../../UI/Components/Types/FieldType";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "7d7d7d7d-0000-4000-8000-000000000001";
const ON_ID: string = "7d7d7d7d-0000-4000-8000-0000000000a1";
const OFF_ID: string = "7d7d7d7d-0000-4000-8000-0000000000a2";

let count: number | Error = 2;
let gate: PermissionGateResult = { isAllowed: true };
let refusal: Error | null = null;

beforeEach(() => {
  count = 2;
  gate = { isAllowed: true };
  refusal = null;
  mockTable.rows = [
    { _id: ON_ID, name: "Okta", isEnabled: true },
    { _id: OFF_ID, name: "Old Azure AD", isEnabled: false },
  ];
  mockTable.renders = [];

  countMock.mockReset();
  countMock.mockImplementation(async (): Promise<number> => {
    if (count instanceof Error) {
      throw count;
    }

    return count;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    if (refusal) {
      throw refusal;
    }

    return {};
  });

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
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
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderProviders(): Promise<void> {
  await act(async () => {
    render(
      <PlanLeftoverTable<ProjectSSO>
        modelType={ProjectSSO}
        id="project-saml-providers"
        query={{ projectId: new ObjectID(PROJECT_ID) }}
        requiredPlan={PlanType.Scale}
        title={PlanLeftoverTitle.samlProviders}
        columns={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
        ]}
      />,
    );
  });

  await flush();
}

async function renderApiKeys(): Promise<void> {
  await act(async () => {
    render(
      <PlanLeftoverTable<ApiKey>
        modelType={ApiKey}
        id="api-keys"
        query={{ projectId: new ObjectID(PROJECT_ID) }}
        requiredPlan={PlanType.Growth}
        title={PlanLeftoverTitle.apiKeys}
        columns={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { expiresAt: true },
            title: "Expires",
            type: FieldType.Date,
          },
        ]}
      />,
    );
  });

  await flush();
}

async function renderScimConnections(
  modelType: typeof ProjectSCIM | typeof StatusPageSCIM,
): Promise<void> {
  await act(async () => {
    render(
      <PlanLeftoverTable<ProjectSCIM | StatusPageSCIM>
        modelType={modelType as never}
        id="scim-connections"
        query={{ projectId: new ObjectID(PROJECT_ID) }}
        requiredPlan={PlanType.Scale}
        title={PlanLeftoverTitle.scimConnections}
        columns={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
        ]}
      />,
    );
  });

  await flush();
}

function lastTable(): RecordedTable {
  const table: RecordedTable | undefined =
    mockTable.renders[mockTable.renders.length - 1];

  if (!table) {
    throw new Error("The table was never drawn");
  }

  return table;
}

async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

function turnOffButtonOf(rowId: string): HTMLElement {
  return within(screen.getByTestId(`row-${rowId}`)).getByRole("button", {
    name: PlanLeftoverCopy.turnOffButton,
  });
}

describe("what it reads", () => {
  test("it counts the page's own records once - the model and the query the page hands it", async () => {
    await renderProviders();

    expect(countMock).toHaveBeenCalledTimes(1);

    const request: { modelType: unknown; query: Record<string, unknown> } =
      countMock.mock.calls[0]![0] as {
        modelType: unknown;
        query: Record<string, unknown>;
      };

    expect(request.modelType).toBe(ProjectSSO);
    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    expect(lastTable().query).toBe(request.query);
  });
});

describe("nothing left draws nothing: the page above is the page", () => {
  test("no records", async () => {
    count = 0;

    await renderProviders();

    expect(screen.queryByTestId("stand-in-table")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        getPlanLeftoverTableTestId("project-saml-providers"),
      ),
    ).not.toBeInTheDocument();
  });

  test("a count that fails", async () => {
    count = new Error("network down");

    await renderProviders();

    expect(screen.queryByTestId("stand-in-table")).not.toBeInTheDocument();
  });
});

describe("records with a switch (SSO providers)", () => {
  test("are listed read-only: nothing to add, edit or open, and Delete is the table's own", async () => {
    await renderProviders();

    expect(
      screen.getByTestId(getPlanLeftoverTableTestId("project-saml-providers")),
    ).toBeInTheDocument();

    const table: RecordedTable = lastTable();

    expect(table.modelType).toBe(ProjectSSO);
    expect(table.isCreateable).toBe(false);
    expect(table.isEditable).toBe(false);
    expect(table.isViewable).toBe(false);
    expect(table.isDeleteable).toBe(true);
    expect(table.filters).toEqual([]);
    expect(table.id).toBe(getPlanLeftoverTableTestId("project-saml-providers"));
  });

  test("say what is left, that the plan does not include it, and what each move takes", async () => {
    await renderProviders();

    expect(
      screen.getByRole("heading", { name: "SAML providers still set up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your plan does not include these any more. The ones that are on still work: you can turn them off or delete them. Turning them on again or adding new ones needs the Scale plan.",
      ),
    ).toBeInTheDocument();
  });

  test("show the page's columns, then whether each one is on", async () => {
    await renderProviders();

    expect(
      lastTable().columns.map((column: RecordedColumn): unknown => {
        return [column.field, column.title];
      }),
    ).toEqual([
      [{ name: true }, "Name"],
      [{ isEnabled: true }, "Enabled"],
    ]);
  });

  test("offer Turn off on the ones that are on, and only those", async () => {
    await renderProviders();

    expect(turnOffButtonOf(ON_ID)).toBeEnabled();
    expect(
      within(screen.getByTestId(`row-${OFF_ID}`)).queryByRole("button", {
        name: PlanLeftoverCopy.turnOffButton,
      }),
    ).not.toBeInTheDocument();
  });

  test("Turn off asks first, saying it stops at once and what turning it on again takes", async () => {
    await renderProviders();
    await press(turnOffButtonOf(ON_ID));

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Turn this off?",
    );
    expect(dialog).toHaveTextContent(
      "It stops working right away. Turning it on again needs the Scale plan.",
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("confirming writes the switch alone, false - the one change every plan may make - and refreshes the list", async () => {
    await renderProviders();

    const refreshBefore: string | undefined = lastTable().refreshToggle;

    await press(turnOffButtonOf(ON_ID));
    await press(
      within(screen.getByTestId("modal")).getByRole("button", {
        name: PlanLeftoverCopy.turnOffButton,
      }),
    );

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateByIdMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(request.modelType).toBe(ProjectSSO);
    expect(request.id.toString()).toBe(ON_ID);
    expect(request.data).toEqual({ isEnabled: false });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(lastTable().refreshToggle).not.toBe(refreshBefore);
  });

  test("cancelling writes nothing", async () => {
    await renderProviders();
    await press(turnOffButtonOf(ON_ID));
    await press(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a refusal keeps the dialog open, with the server's reason", async () => {
    refusal = new Error("You do not have permission to edit this provider.");

    await renderProviders();
    await press(turnOffButtonOf(ON_ID));
    await press(
      within(screen.getByTestId("modal")).getByRole("button", {
        name: PlanLeftoverCopy.turnOffButton,
      }),
    );

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialog).toHaveTextContent(
      "You do not have permission to edit this provider.",
    );
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("someone who may not change the switch sees Turn off locked, with why, and pressing it does nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Project SSO permission.",
    };

    await renderProviders();

    const button: HTMLElement = turnOffButtonOf(ON_ID);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "You need the Edit Project SSO permission.",
    );

    const action: RecordedAction | undefined = lastTable().actionButtons[0];
    action!.onClick(
      mockTable.rows[0],
      () => {
        return undefined;
      },
      () => {
        return undefined;
      },
    );
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("the switch it checks is the one it writes", async () => {
    await renderProviders();

    expect(PermissionGate.checkColumnUpdate).toHaveBeenCalledWith(
      expect.any(ProjectSSO),
      "isEnabled",
    );
  });
});

describe("records without a switch (API keys)", () => {
  beforeEach(() => {
    mockTable.rows = [{ _id: ON_ID, name: "CI deploys" }];
  });

  test("are listed with Delete only: nothing to turn off", async () => {
    await renderApiKeys();

    const table: RecordedTable = lastTable();

    expect(table.isCreateable).toBe(false);
    expect(table.isEditable).toBe(false);
    expect(table.isDeleteable).toBe(true);
    expect(table.actionButtons).toEqual([]);
    expect(
      table.columns.map((column: RecordedColumn): string => {
        return column.title;
      }),
    ).toEqual(["Name", "Expires"]);
  });

  /*
   * Below Growth, a project's API keys stop working: every request made
   * with one is refused until the project is back on the plan (Common/
   * Types/Billing/PlanCutoffCredentials). The table says so - not that they
   * still work.
   */
  test("say they stopped working, that upgrading turns them back on, and that they can still be deleted", async () => {
    await renderApiKeys();

    expect(
      screen.getByRole("heading", { name: "API keys still set up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "These stopped working: your plan does not include them. Upgrading to the Growth plan turns them back on as they are. You can still delete them.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/they still work/)).not.toBeInTheDocument();
  });
});

describe("SCIM connections, the project's and its status pages'", () => {
  beforeEach(() => {
    mockTable.rows = [{ _id: ON_ID, name: "Okta provisioning" }];
  });

  test.each([
    ["the project's", ProjectSCIM],
    ["a status page's", StatusPageSCIM],
  ])(
    "%s say they stopped, that the identity provider no longer adds or removes people, and that an upgrade turns them back on",
    async (
      _label: string,
      modelType: typeof ProjectSCIM | typeof StatusPageSCIM,
    ) => {
      await renderScimConnections(modelType);

      expect(
        screen.getByRole("heading", { name: "SCIM connections still set up" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "These stopped working: your plan does not include them, so your identity provider no longer adds or removes people here. Upgrading to the Scale plan turns them back on as they are. You can still delete them.",
        ),
      ).toBeInTheDocument();
      expect(lastTable().isDeleteable).toBe(true);
      expect(lastTable().actionButtons).toEqual([]);
    },
  );
});

describe("which description a table gets", () => {
  test("API keys: stopped", () => {
    expect(
      getPlanLeftoverDescription({
        tableName: new ApiKey().tableName,
        hasSwitch: false,
      }),
    ).toBe(PlanLeftoverCopy.descriptionStopped);
  });

  test.each([[new ProjectSCIM().tableName], [new StatusPageSCIM().tableName]])(
    "%s: stopped, and provisioning with it",
    (tableName: string | null) => {
      expect(getPlanLeftoverDescription({ tableName, hasSwitch: false })).toBe(
        PlanLeftoverCopy.descriptionScimStopped,
      );
    },
  );

  /*
   * Everything else a lower plan keeps still works after a downgrade - SSO
   * providers sign people in, rules post, schedules page people - and its
   * table says that, as before.
   */
  test("a table with a switch that keeps working: the ones that are on still work", () => {
    expect(
      getPlanLeftoverDescription({
        tableName: new ProjectSSO().tableName,
        hasSwitch: true,
      }),
    ).toBe(PlanLeftoverCopy.descriptionWithSwitch);
  });

  test("a table without a switch that keeps working: they still work", () => {
    expect(
      getPlanLeftoverDescription({
        tableName: new WorkspaceNotificationRule().tableName,
        hasSwitch: false,
      }),
    ).toBe(PlanLeftoverCopy.descriptionWithoutSwitch);
  });

  test("a table with no name: as before", () => {
    expect(
      getPlanLeftoverDescription({ tableName: undefined, hasSwitch: false }),
    ).toBe(PlanLeftoverCopy.descriptionWithoutSwitch);
  });
});
