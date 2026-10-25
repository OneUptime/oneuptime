import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Change a record's value from a list (useValueChangeActions): an
 * incident's or an alert's severity - and a security case's priority or
 * status - in a row's ⋯ menu and in Bulk Actions, the way the record's
 * Edit form changes it:
 *
 *   - the values offered are the project's own, in their order, the
 *     archived ones left out, read when the dialog opens and never before;
 *   - a row's dialog names the row and marks the value it has now Current;
 *     picking that one changes nothing;
 *   - the value's id is written to the record through the API, and the list
 *     reads its rows again;
 *   - in bulk, a row that has the value already is left alone, with why;
 *   - someone who may not change the column finds it locked.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

let permissionsForTest: Array<unknown> = [];

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

const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import useValueChangeActions, {
  getCurrentValueId,
  getValueChoiceOptions,
  VALUE_CHANGE_ALREADY,
  VALUE_CHANGE_CURRENT,
  VALUE_CHANGE_RESULT_LABELS,
  ValueChangeActionsConfig,
  ValueChangeActionsResult,
} from "../../../UI/Components/BulkUpdate/ValueChangeActions";
import {
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../../../UI/Components/ActionButton/RowActionContext";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const WAIT_TIMEOUT: number = 20000;
jest.setTimeout(30000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const INCIDENT_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const CRITICAL_ID: string = "55555555-5555-4555-8555-555555555551";
const MAJOR_ID: string = "55555555-5555-4555-8555-555555555552";
const MINOR_ID: string = "55555555-5555-4555-8555-555555555553";

const severity: (
  id: string,
  name: string,
  order: number,
) => IncidentSeverity = (
  id: string,
  name: string,
  order: number,
): IncidentSeverity => {
  const value: IncidentSeverity = new IncidentSeverity();
  value._id = id;
  value.name = name;
  value.order = order;
  value.color = new Color("#ff0000");

  return value;
};

// The project's live severities, in their order, as the API answers.
const SEVERITIES: Array<IncidentSeverity> = [
  severity(CRITICAL_ID, "Critical", 1),
  severity(MAJOR_ID, "Major", 2),
  severity(MINOR_ID, "Minor", 3),
];

const incident: (id: string, title: string, severityId: string) => Incident = (
  id: string,
  title: string,
  severityId: string,
): Incident => {
  const row: Incident = new Incident();
  row._id = id;
  row.title = title;

  const link: IncidentSeverity = new IncidentSeverity();
  link._id = severityId;
  row.incidentSeverity = link;

  return row;
};

const SEVERITY_CHANGE: ValueChangeActionsConfig<Incident, IncidentSeverity> = {
  modelType: Incident,
  column: "incidentSeverity",
  idColumn: "incidentSeverityId",
  valueModelType: IncidentSeverity,
  title: "Change Severity",
  fieldTitle: "Severity",
  icon: IconProp.Signal,
};

const writes: () => Array<{
  id: string;
  data: Record<string, unknown>;
}> = (): Array<{ id: string; data: Record<string, unknown> }> => {
  return (updateByIdMock.mock.calls as Array<Array<any>>).map(
    (call: Array<any>) => {
      return { id: call[0].id.toString(), data: call[0].data };
    },
  );
};

let refreshCount: number = 0;

function RowHarness(props: { item: Incident }): ReactElement {
  const { rowActions, modals }: ValueChangeActionsResult<Incident> =
    useValueChangeActions<Incident, IncidentSeverity>(SEVERITY_CHANGE);

  const view: ActionButtonSchema<Incident> = {
    title: "View",
    icon: IconProp.ChevronRight,
    buttonStyleType: ButtonStyleType.OUTLINE,
    onClick: (): void => {},
  };

  return (
    <>
      <RowActions<Incident>
        item={props.item}
        actionButtons={withRowActionContext<Incident>([view, ...rowActions], {
          refresh: () => {
            refreshCount++;
          },
        })}
      />
      {modals}
    </>
  );
}

const progress: Array<ProgressInfo<Incident>> = [];

function BulkHarness(props: { items: Array<Incident> }): ReactElement {
  const { bulkActions, modals }: ValueChangeActionsResult<Incident> =
    useValueChangeActions<Incident, IncidentSeverity>(SEVERITY_CHANGE);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void bulkActions[0]!.onClick({
            items: props.items,
            onProgressInfo: (info: ProgressInfo<Incident>): void => {
              progress.push(info);
            },
            onBulkActionStart: (): void => {},
            onBulkActionEnd: (): void => {},
          } as BulkActionOnClickProps<Incident>);
        }}
      >
        Trigger Change Severity
      </button>
      {modals}
    </>
  );
}

const openRowDialog: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    fireEvent.click(screen.getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Change Severity",
      }),
    );

    return await screen.findByTestId("modal", {}, { timeout: WAIT_TIMEOUT });
  };

// The dropdown's options, as the dialog lists them.
const openValues: (modal: HTMLElement) => Promise<Array<HTMLElement>> = async (
  modal: HTMLElement,
): Promise<Array<HTMLElement>> => {
  const picker: HTMLElement = await within(modal).findByRole("combobox");

  fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

  return await screen.findAllByRole("option");
};

const pick: (modal: HTMLElement, name: string) => Promise<void> = async (
  modal: HTMLElement,
  name: string,
): Promise<void> => {
  const options: Array<HTMLElement> = await openValues(modal);
  const option: HTMLElement | undefined = options.find(
    (candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").startsWith(name);
    },
  );

  fireEvent.click(option!);
};

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  refreshCount = 0;
  progress.length = 0;

  getListMock.mockImplementation(async (): Promise<any> => {
    return {
      data: SEVERITIES,
      count: SEVERITIES.length,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    };
  });
  updateByIdMock.mockResolvedValue({});
});

describe("a row's value now", () => {
  test("is read off its link, or its id column, or is none", () => {
    expect(
      getCurrentValueId(
        incident(INCIDENT_ONE_ID, "Checkout API down", MAJOR_ID),
        "incidentSeverity",
        "incidentSeverityId",
      ),
    ).toBe(MAJOR_ID);

    const byId: Incident = new Incident();
    byId.incidentSeverityId = new ObjectID(MINOR_ID);

    expect(
      getCurrentValueId(byId, "incidentSeverity", "incidentSeverityId"),
    ).toBe(MINOR_ID);
    expect(
      getCurrentValueId(
        new Incident(),
        "incidentSeverity",
        "incidentSeverityId",
      ),
    ).toBe("");
  });

  test("the dialog's options keep the project's order and mark the row's own Current", () => {
    const options: Array<{
      value: unknown;
      label: string;
      description?: string;
    }> = getValueChoiceOptions({
      values: [
        { id: CRITICAL_ID, name: "Critical" },
        { id: MAJOR_ID, name: "Major" },
        { id: MINOR_ID, name: "Minor" },
      ],
      currentValueId: MAJOR_ID,
      translator: createTranslator(undefined, "en"),
    }) as Array<{ value: unknown; label: string; description?: string }>;

    expect(
      options.map((option: { label: string; description?: string }) => {
        return [option.label, option.description];
      }),
    ).toEqual([
      ["Critical", undefined],
      ["Major", VALUE_CHANGE_CURRENT],
      ["Minor", undefined],
    ]);
  });
});

describe("the actions", () => {
  test("are Change Severity in the ⋯ menu and in Bulk Actions", () => {
    const { result } = renderHook(() => {
      return useValueChangeActions<Incident, IncidentSeverity>(SEVERITY_CHANGE);
    });

    expect(
      result.current.rowActions.map((action: ActionButtonSchema<Incident>) => {
        return [action.title, action.icon, action.placement];
      }),
    ).toEqual([
      ["Change Severity", IconProp.Signal, ActionButtonPlacement.MoreMenu],
    ]);
    expect(result.current.bulkActions[0]!.title).toBe("Change Severity");
    expect(result.current.bulkActions[0]!.resultLabels).toBe(
      VALUE_CHANGE_RESULT_LABELS,
    );
  });

  test("read nothing until the dialog opens", () => {
    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down", MAJOR_ID)}
      />,
    );

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("someone who may not change the severity finds them locked, saying which permission it takes", () => {
    permissionsForTest = [Permission.Viewer];

    const { result } = renderHook(() => {
      return useValueChangeActions<Incident, IncidentSeverity>(SEVERITY_CHANGE);
    });

    for (const action of [
      result.current.rowActions[0]!,
      result.current.bulkActions[0]!,
    ]) {
      expect(action.disabled).toBe(true);
      expect(action.tooltip).toContain("permission");
    }
  });
});

describe("a row's Change Severity", () => {
  test("lists the project's live severities in their order, naming the row and marking its own Current", async () => {
    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down", MAJOR_ID)}
      />,
    );

    const modal: HTMLElement = await openRowDialog();

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Change Severity",
    );
    expect(modal).toHaveTextContent(
      "Pick the new severity for Checkout API down.",
    );

    const read: any = (getListMock.mock.calls[0] as Array<any>)[0];

    expect(read.modelType).toBe(IncidentSeverity);
    expect(read.query.projectId.toString()).toBe(PROJECT_ID);
    // Archived severities are left out: nobody can pick one again.
    expect(read.query.isArchived).toBe(false);
    expect(read.sort).toEqual({ order: SortOrder.Ascending });

    const options: Array<HTMLElement> = await openValues(modal);

    expect(
      options.map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      }),
    ).toEqual(["Critical", `Major${VALUE_CHANGE_CURRENT}`, "Minor"]);
  });

  test("writes the picked severity to the row, and the list is read again", async () => {
    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down", MAJOR_ID)}
      />,
    );

    const modal: HTMLElement = await openRowDialog();

    await pick(modal, "Critical");
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(screen.queryByTestId("modal")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(writes()).toEqual([
      { id: INCIDENT_ONE_ID, data: { incidentSeverityId: CRITICAL_ID } },
    ]);
    expect(refreshCount).toBe(1);
  });

  test("opens on the severity the row has now, and sending it unchanged changes nothing", async () => {
    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down", MAJOR_ID)}
      />,
    );

    const modal: HTMLElement = await openRowDialog();

    // The picker shows the row's own severity before anything is picked.
    await waitFor(() => {
      expect(modal.querySelector(".ou-select__single-value")?.textContent).toBe(
        "Major",
      );
    });

    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(screen.queryByTestId("modal")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(refreshCount).toBe(0);
  });

  test("a refusal is said in the dialog, which stays open", async () => {
    updateByIdMock.mockRejectedValue(
      new Error("You do not have permission to edit this incident."),
    );

    render(
      <RowHarness
        item={incident(INCIDENT_ONE_ID, "Checkout API down", MAJOR_ID)}
      />,
    );

    const modal: HTMLElement = await openRowDialog();

    await pick(modal, "Minor");
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toHaveTextContent(
          "You do not have permission to edit this incident.",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(refreshCount).toBe(0);
  });
});

describe("Change Severity in Bulk Actions", () => {
  test("asks once for the selection, writes each row, and leaves one that has it already alone, with why", async () => {
    render(
      <BulkHarness
        items={[
          incident(INCIDENT_ONE_ID, "Checkout API down", MAJOR_ID),
          incident(INCIDENT_TWO_ID, "Payments slow", CRITICAL_ID),
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Trigger Change Severity"));

    const modal: HTMLElement = await screen.findByTestId(
      "modal",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(modal).toHaveTextContent(
      "Pick the severity for the 2 selected incidents.",
    );

    // No row's value is marked in a selection's dialog.
    const options: Array<HTMLElement> = await openValues(modal);

    expect(
      options.map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      }),
    ).toEqual(["Critical", "Major", "Minor"]);

    fireEvent.click(options[0]!);

    await act(async () => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(
      () => {
        expect(progress.length).toBeGreaterThan(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const last: ProgressInfo<Incident> = progress[progress.length - 1]!;

    expect(writes()).toEqual([
      { id: INCIDENT_ONE_ID, data: { incidentSeverityId: CRITICAL_ID } },
    ]);
    expect(
      (last.unchanged || []).map((entry: BulkActionUnchanged<Incident>) => {
        return [entry.item._id, entry.reason];
      }),
    ).toEqual([
      [INCIDENT_TWO_ID, VALUE_CHANGE_ALREADY.replace("{{value}}", "Critical")],
    ]);
  });
});
