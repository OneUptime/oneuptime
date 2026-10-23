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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";

/*
 * The shared bulk switch (BulkSwitchActions): Enable and Disable on a list
 * of workflows, rules or runbooks, Unsubscribe on a list of subscribers -
 * one boolean column written on every selected row - in the one way every
 * list now does it:
 *
 *   - gated on the column's own update permission: someone who may not
 *     change it sees the item locked, with the permission it takes;
 *   - not offered when every selected row is in that state already;
 *   - the confirmation counts and names only the rows it will change, and
 *     says what the change does to them (BulkSwitchConsequences);
 *   - one update per row through the API (the server checks each row), one
 *     after another;
 *   - the result counts what changed, lists the rows left alone with the
 *     reason, and the rows the server refused with its words.
 *
 * The hook is driven through the real action bar (BulkUpdateForm), the way
 * the tables draw it.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];
// English unless a test sets a lookup (the reader's language).
let lookupForTest: ((text: string) => string | undefined) | null = null;

interface UpdateCall {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
  startedAt: number;
  finishedAt: number;
}

const updateCalls: Array<UpdateCall> = [];
// Ids the server refuses, with its words.
let refusalsForTest: Record<string, string> = {};
let clock: number = 0;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
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

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value === undefined) {
            return value;
          }

          return lookupForTest ? lookupForTest(value) : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
        language: "en",
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: async (request: {
        modelType: { new (): { tableName?: string | null } };
        id: { toString: () => string };
        data: Record<string, unknown>;
      }): Promise<void> => {
        const id: string = request.id.toString();
        const startedAt: number = ++clock;

        // A write in flight for a moment, so a second one would overlap it.
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 5);
        });

        const finishedAt: number = ++clock;

        updateCalls.push({
          modelName: new request.modelType().tableName || "",
          id,
          data: request.data,
          startedAt,
          finishedAt,
        });

        if (refusalsForTest[id]) {
          throw new Error(refusalsForTest[id]);
        }
      },
    },
  };
});

import useBulkSwitchActions, {
  BulkSwitchActionsConfig,
  DISABLE_SWITCH_ACTION,
  ENABLE_SWITCH_ACTION,
  getRowsToChange,
  UNSUBSCRIBE_SWITCH_ACTION,
} from "../../../UI/Components/BulkUpdate/BulkSwitchActions";
import BulkUpdateForm, {
  BulkActionButtonSchema,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { getBulkSwitchConsequence } from "../../../UI/Components/BulkUpdate/BulkSwitchConsequences";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const WORKFLOW_IDS: Array<string> = [
  "7b0e1a52-0f3c-4d6e-9a41-000000000001",
  "7b0e1a52-0f3c-4d6e-9a41-000000000002",
  "7b0e1a52-0f3c-4d6e-9a41-000000000003",
  "7b0e1a52-0f3c-4d6e-9a41-000000000004",
  "7b0e1a52-0f3c-4d6e-9a41-000000000005",
];

const workflow: (index: number, isEnabled: boolean | undefined) => Workflow = (
  index: number,
  isEnabled: boolean | undefined,
): Workflow => {
  const row: Workflow = new Workflow();
  row._id = WORKFLOW_IDS[index]!;
  row.name = `Workflow ${index + 1}`;

  if (isEnabled !== undefined) {
    row.isEnabled = isEnabled;
  }

  return row;
};

interface HarnessProps<T extends BaseModel> {
  config: BulkSwitchActionsConfig<T>;
  items: Array<T>;
  singularLabel: string;
  pluralLabel: string;
  onActions?: ((actions: Array<BulkActionButtonSchema<T>>) => void) | undefined;
}

function Harness<T extends BaseModel>(props: HarnessProps<T>): ReactElement {
  const actions: Array<BulkActionButtonSchema<T>> = useBulkSwitchActions<T>(
    props.config,
  );

  props.onActions?.(actions);

  return (
    <BulkUpdateForm<T>
      selectedItems={props.items}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel={props.singularLabel}
      pluralLabel={props.pluralLabel}
      buttons={actions}
      itemToString={(item: T): string => {
        return String((item as unknown as { name?: string }).name || "");
      }}
    />
  );
}

const renderWorkflows: (
  items: Array<Workflow>,
  onActions?: (actions: Array<BulkActionButtonSchema<Workflow>>) => void,
) => void = (
  items: Array<Workflow>,
  onActions?: (actions: Array<BulkActionButtonSchema<Workflow>>) => void,
): void => {
  render(
    <Harness<Workflow>
      config={{ modelType: Workflow, column: "isEnabled" }}
      items={items}
      singularLabel="Workflow"
      pluralLabel="Workflows"
      onActions={onActions}
    />,
  );
};

const openMenu: () => void = (): void => {
  fireEvent.click(screen.getByText("Bulk Actions"));
};

const menuItemNames: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("menuitem").map((item: HTMLElement) => {
    return item.textContent?.trim() || "";
  });
};

const dialog: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("dialog");
};

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [Permission.ProjectOwner];
  lookupForTest = null;
  refusalsForTest = {};
  updateCalls.length = 0;
  clock = 0;
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
});

describe("the default actions", () => {
  test("are Enable and Disable, with the icons the monitors list uses, in the safe part of the menu", () => {
    let actions: Array<BulkActionButtonSchema<Workflow>> = [];

    renderWorkflows([workflow(0, true)], (given) => {
      actions = given;
    });

    expect(
      actions.map((action: BulkActionButtonSchema<Workflow>) => {
        return [action.title, action.icon, action.buttonStyleType];
      }),
    ).toEqual([
      ["Enable", IconProp.Play, ButtonStyleType.NORMAL],
      ["Disable", IconProp.Stop, ButtonStyleType.NORMAL],
    ]);
    expect(ENABLE_SWITCH_ACTION.value).toBe(true);
    expect(DISABLE_SWITCH_ACTION.value).toBe(false);
  });
});

describe("which actions the menu offers", () => {
  test("a selection that is all on offers Disable alone", () => {
    renderWorkflows([workflow(0, true), workflow(1, true)]);
    openMenu();

    expect(menuItemNames()).toEqual(["Disable"]);
  });

  test("a selection that is all off offers Enable alone", () => {
    renderWorkflows([workflow(0, false), workflow(1, false)]);
    openMenu();

    expect(menuItemNames()).toEqual(["Enable"]);
  });

  test("a mixed selection offers both", () => {
    renderWorkflows([workflow(0, true), workflow(1, false)]);
    openMenu();

    expect(menuItemNames()).toEqual(["Enable", "Disable"]);
  });

  test("rows that do not say whether they are on offer both, and are written", () => {
    renderWorkflows([workflow(0, undefined), workflow(1, undefined)]);
    openMenu();

    expect(menuItemNames()).toEqual(["Enable", "Disable"]);
  });
});

describe("the confirmation", () => {
  const MIXED: () => Array<Workflow> = (): Array<Workflow> => {
    return [
      workflow(0, true),
      workflow(1, false),
      workflow(2, true),
      workflow(3, false),
      workflow(4, true),
    ];
  };

  test("counts only the rows it will change", () => {
    renderWorkflows(MIXED());
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));

    expect(within(dialog()).getByText("Disable 3 Workflows")).toBeVisible();
    expect(
      within(dialog()).getByText(
        "Are you sure you want to disable 3 workflows?",
      ),
    ).toBeVisible();
  });

  test("names them, and not the rows already in that state", () => {
    renderWorkflows(MIXED());
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));

    const names: Array<string> = within(dialog())
      .getAllByTestId("delete-confirmation-item")
      .map((item: HTMLElement) => {
        return item.textContent || "";
      });

    expect(names).toEqual(["Workflow 1", "Workflow 3", "Workflow 5"]);
  });

  test("says what the change does to them, from the catalog", () => {
    renderWorkflows(MIXED());
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));

    expect(
      within(dialog()).getByTestId("bulk-switch-consequence"),
    ).toHaveTextContent(
      "A disabled workflow does not run when its trigger fires. You can still run it by hand from its Builder.",
    );
  });

  test("one row reads in the singular", () => {
    renderWorkflows([workflow(0, true), workflow(1, false)]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));

    expect(within(dialog()).getByText("Enable 1 Workflow")).toBeVisible();
    expect(
      within(dialog()).getByText("Are you sure you want to enable 1 workflow?"),
    ).toBeVisible();
    expect(
      within(dialog()).getByTestId("bulk-switch-consequence"),
    ).toHaveTextContent("An enabled workflow runs every time its trigger fires.");
  });

  test("its button is the action, and Cancel writes nothing", async () => {
    renderWorkflows(MIXED());
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));

    expect(
      within(dialog()).getByRole("button", { name: "Disable" }),
    ).toBeVisible();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(updateCalls).toEqual([]);
  });
});

describe("the run", () => {
  test("writes the column on each row it changes, one after another, in selection order", async () => {
    renderWorkflows([
      workflow(0, true),
      workflow(1, false),
      workflow(2, true),
    ]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Disable" }));

    await screen.findByText("Completed");

    expect(
      updateCalls.map((call: UpdateCall) => {
        return [call.modelName, call.id, call.data];
      }),
    ).toEqual([
      ["Workflow", WORKFLOW_IDS[0], { isEnabled: false }],
      ["Workflow", WORKFLOW_IDS[2], { isEnabled: false }],
    ]);

    // The second write starts once the first is done.
    expect(updateCalls[1]!.startedAt).toBeGreaterThan(
      updateCalls[0]!.finishedAt,
    );
  });

  test("says how many changed, in the action's own words", async () => {
    renderWorkflows([workflow(0, true), workflow(1, true)]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Disable" }));

    await screen.findByText("Completed");

    expect(
      screen.getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("2 Workflows disabled");
  });

  test("lists a row already in the state asked for as not changed, with why", async () => {
    renderWorkflows([workflow(0, true), workflow(1, false)]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Disable" }));

    await screen.findByText("Completed");

    expect(screen.getByTestId("bulk-action-unchanged-count")).toHaveTextContent(
      "1 Workflow not changed",
    );

    const unchanged: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );

    expect(within(unchanged).getByText("Workflow 2")).toBeVisible();
    expect(within(unchanged).getByText("Already disabled.")).toBeVisible();
    expect(updateCalls).toHaveLength(1);
  });

  test("lists a row the server refused, in the server's words, and changes the rest", async () => {
    refusalsForTest = {
      [WORKFLOW_IDS[1]!]:
        "You do not have permission to edit this workflow. Its labels are not ones you can edit.",
    };

    renderWorkflows([workflow(0, false), workflow(1, false), workflow(2, false)]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Enable" }));

    await screen.findByText("Completed");

    expect(
      screen.getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("2 Workflows enabled");
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "1 Workflow not enabled",
    );

    const failed: HTMLElement = screen.getByTestId("bulk-action-failed-items");

    expect(within(failed).getByText("Workflow 2")).toBeVisible();
    expect(
      within(failed).getByText(
        "You do not have permission to edit this workflow. Its labels are not ones you can edit.",
      ),
    ).toBeVisible();
    expect(updateCalls).toHaveLength(3);
  });

  test("a row the server refuses does not stop the ones after it", async () => {
    refusalsForTest = {
      [WORKFLOW_IDS[0]!]: "Workflow not found.",
      [WORKFLOW_IDS[1]!]: "Workflow not found.",
    };

    renderWorkflows([workflow(0, true), workflow(1, true), workflow(2, true)]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Disable" }));

    await screen.findByText("Completed");

    expect(
      screen.getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("1 Workflow disabled");
    // Refused for one reason: said once, both names under it.
    expect(
      screen.getAllByTestId("bulk-action-failed-items-group"),
    ).toHaveLength(1);
  });
});

describe("permissions", () => {
  test("someone who may not change the column sees the actions locked, saying which permission it takes", () => {
    permissionsForTest = [Permission.Viewer];

    let actions: Array<BulkActionButtonSchema<Workflow>> = [];

    renderWorkflows([workflow(0, true), workflow(1, false)], (given) => {
      actions = given;
    });

    for (const action of actions) {
      expect(action.disabled).toBe(true);
      expect(action.tooltip).toContain("permission");
    }

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));

    // A locked item opens nothing and writes nothing.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls).toEqual([]);
  });

  test("a project owner and a master admin may use them", () => {
    let actions: Array<BulkActionButtonSchema<Workflow>> = [];

    renderWorkflows([workflow(0, true)], (given) => {
      actions = given;
    });

    expect(actions.every((action) => {
      return !action.disabled;
    })).toBe(true);

    cleanup();
    permissionsForTest = [];
    isMasterAdminForTest = true;

    renderWorkflows([workflow(0, true)], (given) => {
      actions = given;
    });

    expect(actions.every((action) => {
      return !action.disabled;
    })).toBe(true);
  });

  test("before the permissions have loaded the actions stay open: the server still decides each row", () => {
    permissionsForTest = [];

    let actions: Array<BulkActionButtonSchema<Workflow>> = [];

    renderWorkflows([workflow(0, true)], (given) => {
      actions = given;
    });

    expect(actions.every((action) => {
      return !action.disabled;
    })).toBe(true);
  });
});

describe("a switch the other way round: a monitor's Disable Monitoring", () => {
  const monitor: (index: number, isDisabled: boolean) => Monitor = (
    index: number,
    isDisabled: boolean,
  ): Monitor => {
    const row: Monitor = new Monitor();
    row._id = WORKFLOW_IDS[index]!;
    row.name = `Monitor ${index + 1}`;
    row.disableActiveMonitoring = isDisabled;
    return row;
  };

  const renderMonitors: (items: Array<Monitor>) => void = (
    items: Array<Monitor>,
  ): void => {
    render(
      <Harness<Monitor>
        config={{
          modelType: Monitor,
          column: "disableActiveMonitoring",
          actions: [
            { ...ENABLE_SWITCH_ACTION, value: false },
            { ...DISABLE_SWITCH_ACTION, value: true },
          ],
        }}
        items={items}
        singularLabel="Monitor"
        pluralLabel="Monitors"
      />,
    );
  };

  test("Disable writes Disable Monitoring on, and says what a disabled monitor does", async () => {
    renderMonitors([monitor(0, false), monitor(1, true)]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));

    expect(within(dialog()).getByText("Disable 1 Monitor")).toBeVisible();
    expect(
      within(dialog()).getByTestId("bulk-switch-consequence"),
    ).toHaveTextContent(
      "A disabled monitor is not checked, and opens no incidents or alerts, until it is enabled again.",
    );

    fireEvent.click(within(dialog()).getByRole("button", { name: "Disable" }));
    await screen.findByText("Completed");

    expect(
      updateCalls.map((call: UpdateCall) => {
        return [call.modelName, call.id, call.data];
      }),
    ).toEqual([["Monitor", WORKFLOW_IDS[0], { disableActiveMonitoring: true }]]);
  });

  test("Enable writes it off, and a monitor already checked is left alone", async () => {
    renderMonitors([monitor(0, false), monitor(1, true)]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Enable" }));
    await screen.findByText("Completed");

    expect(updateCalls.map((call: UpdateCall) => {
      return call.data;
    })).toEqual([{ disableActiveMonitoring: false }]);
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      "Monitor 1",
    );
  });
});

describe("Unsubscribe on a list of subscribers", () => {
  const subscriber: (index: number, isUnsubscribed: boolean) => StatusPageSubscriber =
    (index: number, isUnsubscribed: boolean): StatusPageSubscriber => {
      const row: StatusPageSubscriber = new StatusPageSubscriber();
      row._id = WORKFLOW_IDS[index]!;
      row.isUnsubscribed = isUnsubscribed;
      (row as unknown as { name: string }).name = `person${index + 1}@example.com`;
      return row;
    };

  const renderSubscribers: (items: Array<StatusPageSubscriber>) => void = (
    items: Array<StatusPageSubscriber>,
  ): void => {
    render(
      <Harness<StatusPageSubscriber>
        config={{
          modelType: StatusPageSubscriber,
          column: "isUnsubscribed",
          actions: [UNSUBSCRIBE_SWITCH_ACTION],
          singularName: "Subscriber",
          pluralName: "Subscribers",
        }}
        items={items}
        singularLabel="Subscriber"
        pluralLabel="Subscribers"
      />,
    );
  };

  test("is the one action: nobody is subscribed again in bulk", () => {
    renderSubscribers([subscriber(0, false), subscriber(1, true)]);
    openMenu();

    expect(menuItemNames()).toEqual(["Unsubscribe"]);
  });

  test("is not offered when every selected subscriber is unsubscribed already", () => {
    renderSubscribers([subscriber(0, true), subscriber(1, true)]);

    expect(screen.queryByText("Bulk Actions")).toBeNull();
  });

  test("asks about the subscribers it changes, says they stay in the list, and writes Unsubscribed on each", async () => {
    renderSubscribers([
      subscriber(0, false),
      subscriber(1, true),
      subscriber(2, false),
    ]);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unsubscribe" }));

    expect(within(dialog()).getByText("Unsubscribe 2 Subscribers")).toBeVisible();
    expect(
      within(dialog()).getByText(
        "Are you sure you want to unsubscribe 2 subscribers?",
      ),
    ).toBeVisible();
    expect(
      within(dialog()).getByTestId("bulk-switch-consequence"),
    ).toHaveTextContent(
      "Unsubscribed subscribers get no more updates from this status page. They stay in the list, and each can be subscribed again from its Edit form.",
    );

    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Unsubscribe" }),
    );
    await screen.findByText("Completed");

    expect(updateCalls.map((call: UpdateCall) => {
      return [call.id, call.data];
    })).toEqual([
      [WORKFLOW_IDS[0], { isUnsubscribed: true }],
      [WORKFLOW_IDS[2], { isUnsubscribed: true }],
    ]);
    expect(
      screen.getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("2 Subscribers unsubscribed");
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      "Already unsubscribed.",
    );
  });
});

describe("options", () => {
  test("getItemName names the rows in the confirmation", () => {
    render(
      <Harness<Workflow>
        config={{
          modelType: Workflow,
          column: "isEnabled",
          getItemName: (item: Workflow): string => {
            return `Named ${item.name}`;
          },
        }}
        items={[workflow(0, true)]}
        singularLabel="Workflow"
        pluralLabel="Workflows"
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));

    expect(
      within(dialog()).getByTestId("delete-confirmation-item"),
    ).toHaveTextContent("Named Workflow 1");
  });

  test("a list's own API takes the writes (the Admin Dashboard's has no project)", async () => {
    const calls: Array<string> = [];

    // The Admin Dashboard's AdminModelAPI, as far as a write goes.
    const OwnModelAPI: typeof ModelAPI = {
      updateById: async (request: {
        id: { toString: () => string };
      }): Promise<void> => {
        calls.push(request.id.toString());
      },
    } as unknown as typeof ModelAPI;

    render(
      <Harness<Workflow>
        config={{
          modelType: Workflow,
          column: "isEnabled",
          modelAPI: OwnModelAPI,
        }}
        items={[workflow(0, true)]}
        singularLabel="Workflow"
        pluralLabel="Workflows"
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Disable" }));
    await screen.findByText("Completed");

    expect(calls).toEqual([WORKFLOW_IDS[0]]);
    expect(updateCalls).toEqual([]);
  });
});

describe("getRowsToChange", () => {
  test("keeps the rows whose column does not hold the value, and the rows that do not say", () => {
    const rows: Array<Workflow> = [
      workflow(0, true),
      workflow(1, false),
      workflow(2, undefined),
    ];

    expect(
      getRowsToChange(rows, "isEnabled", false).map((row: Workflow) => {
        return row.name;
      }),
    ).toEqual(["Workflow 1", "Workflow 3"]);
    expect(
      getRowsToChange(rows, "isEnabled", true).map((row: Workflow) => {
        return row.name;
      }),
    ).toEqual(["Workflow 2", "Workflow 3"]);
  });
});

describe("in the reader's language", () => {
  const german: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, "de.json"), "utf8"),
  ) as Record<string, string>;

  test("the confirmation and the result read German from the Dashboard's de.json", async () => {
    // As i18next answers: the German where there is one, else the text itself.
    lookupForTest = (text: string): string | undefined => {
      return german[text] || text;
    };

    renderWorkflows([workflow(0, true), workflow(1, true), workflow(2, false)]);
    fireEvent.click(screen.getByText(german["Bulk Actions"]!));
    fireEvent.click(
      screen.getByRole("menuitem", { name: german["Disable"]! }),
    );

    // "Disable {{count}} {{itemsName}}", the count and the plural name filled in.
    expect(
      within(dialog()).getByText(
        german["Disable {{count}} {{itemsName}}"]!
          .replace("{{count}}", "2")
          .replace("{{itemsName}}", german["Workflows"]!),
      ),
    ).toBeVisible();
    expect(
      within(dialog()).getByTestId("bulk-switch-consequence"),
    ).toHaveTextContent(
      german[
        getBulkSwitchConsequence({
          tableName: "Workflow",
          column: "isEnabled",
          value: false,
        })
      ]!,
    );

    fireEvent.click(
      within(dialog()).getByRole("button", { name: german["Disable"]! }),
    );

    await screen.findByText(german["Completed"]!);

    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      german["Already disabled."]!,
    );
  });
});
