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
 * The shared switch in each row's ⋯ menu (useSwitchActions' rowActions):
 * Enable or Disable on a workflow, a runbook or a rule, Unsubscribe on a
 * subscriber - the row counterpart of the bulk switch, from the same
 * declaration, so the two never disagree about the column or the words.
 *
 *   - A row is offered the one action that changes it.
 *   - It sits in the ⋯ menu: View or Edit stays the row's button.
 *   - It writes at once, as the record's own switch does, unless the
 *     change has something to say (BulkSwitchConsequences) or the list
 *     asks its record page's question (getRowConfirmation): then it asks
 *     first, naming the row.
 *   - Once saved, the list reads its rows again (the RowActionContext the
 *     table hands it).
 *   - Someone who may not change the column finds it locked, saying which
 *     permission it takes.
 *
 * The actions are driven through the real row (RowActions), the way the
 * tables draw them.
 */

let permissionsForTest: Array<unknown> = [];
// English unless a test sets a lookup (the reader's language).
let lookupForTest: ((text: string) => string | undefined) | null = null;
let languageForTest: string = "en";

interface UpdateCall {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
}

const updateCalls: Array<UpdateCall> = [];
// Ids the server refuses, with its words.
let refusalsForTest: Record<string, string> = {};

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
        return false;
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
        language: languageForTest,
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

        if (refusalsForTest[id]) {
          throw new Error(refusalsForTest[id]);
        }

        updateCalls.push({
          modelName: new request.modelType().tableName || "",
          id,
          data: request.data,
        });
      },
    },
  };
});

import useBulkSwitchActions, {
  BulkSwitchActionsConfig,
  isRowSwitchActionOffered,
  SwitchActionsResult,
  UNSUBSCRIBE_SWITCH_ACTION,
  useSwitchActions,
} from "../../../UI/Components/BulkUpdate/BulkSwitchActions";
import { getBulkSwitchConsequence } from "../../../UI/Components/BulkUpdate/BulkSwitchConsequences";
import { BulkActionButtonSchema } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../../../UI/Components/ActionButton/RowActionContext";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const RUNBOOK_ID: string = "6c1d2e3f-4a5b-4c6d-8e9f-000000000001";
const WORKFLOW_ID: string = "6c1d2e3f-4a5b-4c6d-8e9f-000000000002";
const SUBSCRIBER_ID: string = "6c1d2e3f-4a5b-4c6d-8e9f-000000000003";

const runbook: (isEnabled: boolean | undefined) => Runbook = (
  isEnabled: boolean | undefined,
): Runbook => {
  const row: Runbook = new Runbook();
  row._id = RUNBOOK_ID;
  row.name = "Restart the checkout pods";

  if (isEnabled !== undefined) {
    row.isEnabled = isEnabled;
  }

  return row;
};

const workflow: (isEnabled: boolean) => Workflow = (
  isEnabled: boolean,
): Workflow => {
  const row: Workflow = new Workflow();
  row._id = WORKFLOW_ID;
  row.name = "Nightly backup";
  row.isEnabled = isEnabled;

  return row;
};

const VIEW: ActionButtonSchema<BaseModel> = {
  title: "View",
  icon: IconProp.ChevronRight,
  buttonStyleType: ButtonStyleType.OUTLINE,
  onClick: (): void => {},
};

interface RowHarnessProps<T extends BaseModel> {
  config: BulkSwitchActionsConfig<T>;
  item: T;
  onRefresh: () => void;
  onActions?: ((result: SwitchActionsResult<T>) => void) | undefined;
}

// One row of a list, as ModelTable draws it: View, then the switch in ⋯.
function RowHarness<T extends BaseModel>(
  props: RowHarnessProps<T>,
): ReactElement {
  const result: SwitchActionsResult<T> = useSwitchActions<T>(props.config);

  props.onActions?.(result);

  return (
    <RowActions<T>
      item={props.item}
      actionButtons={withRowActionContext<T>(
        [VIEW as unknown as ActionButtonSchema<T>, ...result.rowActions],
        { refresh: props.onRefresh },
      )}
    />
  );
}

let refreshCount: number = 0;

const renderRow: <T extends BaseModel>(
  config: BulkSwitchActionsConfig<T>,
  item: T,
  onActions?: (result: SwitchActionsResult<T>) => void,
) => void = <T extends BaseModel>(
  config: BulkSwitchActionsConfig<T>,
  item: T,
  onActions?: (result: SwitchActionsResult<T>) => void,
): void => {
  render(
    <RowHarness<T>
      config={config}
      item={item}
      onRefresh={() => {
        refreshCount++;
      }}
      onActions={onActions}
    />,
  );
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

const menuItemNames: () => Array<string> = (): Array<string> => {
  return within(openMenu())
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

const clickMenuItem: (name: string) => void = (name: string): void => {
  fireEvent.click(within(openMenu()).getByRole("menuitem", { name: name }));
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  lookupForTest = null;
  languageForTest = "en";
  refusalsForTest = {};
  updateCalls.length = 0;
  refreshCount = 0;
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
});

describe("useSwitchActions", () => {
  test("gives the bulk switch and its row counterparts from one declaration", () => {
    let result: SwitchActionsResult<Workflow> | null = null;
    let bulkAlone: Array<BulkActionButtonSchema<Workflow>> = [];

    function BulkAlone(): ReactElement {
      bulkAlone = useBulkSwitchActions<Workflow>({
        modelType: Workflow,
        column: "isEnabled",
      });

      return <></>;
    }

    render(<BulkAlone />);
    renderRow<Workflow>(
      { modelType: Workflow, column: "isEnabled" },
      workflow(true),
      (given: SwitchActionsResult<Workflow>) => {
        result = given;
      },
    );

    const titles: (actions: Array<{ title: string }>) => Array<string> = (
      actions: Array<{ title: string }>,
    ): Array<string> => {
      return actions.map((action: { title: string }): string => {
        return action.title;
      });
    };

    expect(titles(result!.bulkActions)).toEqual(titles(bulkAlone));
    expect(
      result!.rowActions.map((action: ActionButtonSchema<Workflow>) => {
        return [
          action.title,
          action.icon,
          action.buttonStyleType,
          action.placement,
        ];
      }),
    ).toEqual([
      [
        "Enable",
        IconProp.Play,
        ButtonStyleType.OUTLINE,
        ActionButtonPlacement.MoreMenu,
      ],
      [
        "Disable",
        IconProp.Stop,
        ButtonStyleType.OUTLINE,
        ActionButtonPlacement.MoreMenu,
      ],
    ]);
  });
});

describe("which action a row offers", () => {
  test("an enabled row offers Disable alone, a disabled one Enable alone", () => {
    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(true),
    );
    expect(menuItemNames()).toEqual(["Disable"]);

    cleanup();

    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(false),
    );
    expect(menuItemNames()).toEqual(["Enable"]);
  });

  test("a row that does not say where its switch is offers neither: its list did not read the column", () => {
    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(undefined),
    );

    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();
    expect(
      isRowSwitchActionOffered(runbook(undefined), "isEnabled", true),
    ).toBe(false);
    expect(isRowSwitchActionOffered(runbook(true), "isEnabled", false)).toBe(
      true,
    );
    expect(isRowSwitchActionOffered(runbook(true), "isEnabled", true)).toBe(
      false,
    );
  });

  test("View stays the row's button: the switch is in the ⋯ menu", () => {
    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(true),
    );

    expect(
      within(screen.getByTestId("row-actions")).getByRole("button", {
        name: "View",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("row-actions")).queryByRole("button", {
        name: "Disable",
      }),
    ).toBeNull();
  });
});

describe("writing the row's switch", () => {
  test("Enable on a runbook writes at once - turning one on has nothing to say - and the list is read again", async () => {
    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(false),
    );

    clickMenuItem("Enable");

    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => {
      expect(refreshCount).toBe(1);
    });
    expect(updateCalls).toEqual([
      { modelName: "Runbook", id: RUNBOOK_ID, data: { isEnabled: true } },
    ]);
  });

  test("Disable on a runbook asks first, naming it and saying what a disabled runbook stops doing", () => {
    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(true),
    );

    clickMenuItem("Disable");

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Disable Runbook",
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "Are you sure you want to disable Restart the checkout pods?",
    );
    expect(within(dialog).getByTestId("row-switch-name")).toHaveTextContent(
      /^Restart the checkout pods$/,
    );
    expect(
      within(dialog).getByTestId("row-switch-consequence"),
    ).toHaveTextContent(
      getBulkSwitchConsequence({
        tableName: "Runbook",
        column: "isEnabled",
        value: false,
      }),
    );
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Disable");
    expect(updateCalls).toEqual([]);
  });

  test("answered, it writes the switch off on that row and has the list read again", async () => {
    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(true),
    );

    clickMenuItem("Disable");
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(updateCalls).toEqual([
      { modelName: "Runbook", id: RUNBOOK_ID, data: { isEnabled: false } },
    ]);
    expect(refreshCount).toBe(1);
  });

  test("Cancel writes nothing", () => {
    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(true),
    );

    clickMenuItem("Disable");
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls).toEqual([]);
    expect(refreshCount).toBe(0);
  });

  test("Enable on a workflow asks too: the catalog says what an enabled workflow does", () => {
    renderRow<Workflow>(
      { modelType: Workflow, column: "isEnabled" },
      workflow(false),
    );

    clickMenuItem("Enable");

    expect(screen.getByTestId("row-switch-consequence")).toHaveTextContent(
      "An enabled workflow runs every time its trigger fires.",
    );
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Enable Workflow",
    );
  });

  test("a refusal is said in the dialog, which stays open, and the list is not read again", async () => {
    refusalsForTest[RUNBOOK_ID] =
      "You do not have permission to update this runbook.";

    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(true),
    );

    clickMenuItem("Disable");
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "You do not have permission to update this runbook.",
      );
    });
    expect(refreshCount).toBe(0);
  });

  test("a refusal of a row that writes at once is said in the row's error dialog", async () => {
    refusalsForTest[RUNBOOK_ID] = "This runbook belongs to another project.";

    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(false),
    );

    clickMenuItem("Enable");

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "This runbook belongs to another project.",
      );
    });
    expect(refreshCount).toBe(0);
  });
});

describe("a list's own question (getRowConfirmation)", () => {
  const ASKED: Array<{ value: boolean; name: string }> = [];

  const config: BulkSwitchActionsConfig<Workflow> = {
    modelType: Workflow,
    column: "isEnabled",
    getItemName: (item: Workflow): string => {
      return `Workflow: ${item.name}`;
    },
    getRowConfirmation: (data: {
      value: boolean;
      item: Workflow;
      name: string;
    }): RowActionConfirmation | undefined => {
      ASKED.push({ value: data.value, name: data.name });

      if (data.value) {
        return undefined;
      }

      return {
        title: "Turn off this workflow?",
        description: "Its runs stop.",
        submitButtonText: "Turn off",
        details: <p data-testid="own-question-name">{data.name}</p>,
      };
    },
  };

  beforeEach(() => {
    ASKED.length = 0;
  });

  test("is asked for the value the action writes, with the row's name", () => {
    renderRow<Workflow>(config, workflow(true));

    clickMenuItem("Disable");

    expect(ASKED).toEqual([{ value: false, name: "Workflow: Nightly backup" }]);
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Turn off this workflow?",
    );
    expect(screen.getByTestId("own-question-name")).toHaveTextContent(
      "Workflow: Nightly backup",
    );
    // In place of the catalog's sentence, not beside it.
    expect(screen.queryByTestId("row-switch-consequence")).toBeNull();
  });

  test("with no question for a value, the row writes at once", async () => {
    renderRow<Workflow>(config, workflow(false));

    clickMenuItem("Enable");

    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => {
      expect(updateCalls).toEqual([
        { modelName: "Workflow", id: WORKFLOW_ID, data: { isEnabled: true } },
      ]);
    });
  });
});

describe("permissions", () => {
  test("someone who may not change the column finds the row's action locked, saying which permission it takes, and it writes nothing", () => {
    permissionsForTest = [Permission.Viewer];

    renderRow<Runbook>(
      { modelType: Runbook, column: "isEnabled" },
      runbook(true),
    );

    const disable: HTMLElement = within(openMenu()).getByRole("menuitem", {
      name: "Disable",
    });

    expect(disable).toHaveAttribute("aria-disabled", "true");

    const describedBy: string | null = disable.getAttribute("aria-describedby");

    expect(document.getElementById(describedBy!)?.textContent).toContain(
      "permission",
    );

    fireEvent.click(disable);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls).toEqual([]);
  });
});

describe("Unsubscribe in a subscriber's row", () => {
  const subscriber: (isUnsubscribed: boolean) => StatusPageSubscriber = (
    isUnsubscribed: boolean,
  ): StatusPageSubscriber => {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = SUBSCRIBER_ID;
    row.subscriberEmail = undefined;
    row.isUnsubscribed = isUnsubscribed;

    return row;
  };

  const config: BulkSwitchActionsConfig<StatusPageSubscriber> = {
    modelType: StatusPageSubscriber,
    column: "isUnsubscribed",
    actions: [UNSUBSCRIBE_SWITCH_ACTION],
    singularName: "Subscriber",
    pluralName: "Subscribers",
    getItemName: (): string => {
      return "jane@example.com";
    },
  };

  test("a subscribed row asks, saying they stay in the list, and writes Unsubscribed", async () => {
    renderRow<StatusPageSubscriber>(config, subscriber(false));

    const menu: HTMLElement = openMenu();

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(["Unsubscribe"]);

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Unsubscribe" }),
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Unsubscribe Subscriber",
    );
    expect(screen.getByTestId("row-switch-name")).toHaveTextContent(
      "jane@example.com",
    );
    expect(screen.getByTestId("row-switch-consequence")).toHaveTextContent(
      "They stay in the list",
    );

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(updateCalls).toEqual([
        {
          modelName: "StatusPageSubscriber",
          id: SUBSCRIBER_ID,
          data: { isUnsubscribed: true },
        },
      ]);
    });
  });

  test("an unsubscribed row offers nothing: nobody is subscribed again from a row", () => {
    renderRow<StatusPageSubscriber>(config, subscriber(true));

    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();
  });
});

describe("in the reader's language", () => {
  test("the row's question reads German from the Dashboard's de.json", () => {
    const german: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_LOCALES, "de.json"), "utf8"),
    ) as Record<string, string>;

    lookupForTest = (text: string): string | undefined => {
      return german[text] || text;
    };
    languageForTest = "de";

    renderRow<Workflow>(
      { modelType: Workflow, column: "isEnabled" },
      workflow(true),
    );

    clickMenuItem(german["Disable"]!);

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      german["Disable {{itemName}}"]!.replace(
        "{{itemName}}",
        german["Workflow"]!,
      ),
    );
    expect(screen.getByTestId("row-switch-consequence")).toHaveTextContent(
      german[
        getBulkSwitchConsequence({
          tableName: "Workflow",
          column: "isEnabled",
          value: false,
        })
      ]!,
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      german["Disable"]!,
    );
  });
});
