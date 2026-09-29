import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import { ComponentProps as ConfirmModalProps } from "../../../UI/Components/Modal/ConfirmModal";
import { ComponentProps as BasicFormModalProps } from "../../../UI/Components/FormModal/BasicFormModal";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";

/*
 * The SLO Monitors page, rendered for real against a stubbed API.
 *
 * What is pinned is the behaviour a person meets, not the table internals
 * (the ModelTable is replaced by a stand-in that renders the page's own
 * columns and row actions):
 *
 *   - the list is exactly the SLO's monitors, each marked Rule or Manual;
 *   - while a monitor rule is enabled, Add is locked with the API's own
 *     reason, a banner links to Monitor Rules, and a rule-attached row keeps a
 *     locked Remove - but a hand-attached row can still be removed;
 *   - saves apply the person's change to a FRESH read of the SLO, so a rule
 *     sync that moved the list meanwhile is kept, and a rule enabled while the
 *     modal was open refuses the add without writing;
 *   - a change refreshes the table and the notice banner together.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const mockGetItem: MockFunction = getJestMockFunction();
const mockCount: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return mockUpdateById(...args);
      },
    },
  };
});

let mockTableProps: ModelTableProps<Monitor> | undefined;
let mockRows: Array<Monitor> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<Monitor>): React.ReactElement => {
      mockTableProps = props;

      return (
        <section data-testid={props.id} data-refresh={props.refreshToggle}>
          {(props.cardProps?.buttons || []).map(
            (button: unknown, index: number): React.ReactElement => {
              const schema: CardButtonSchema = button as CardButtonSchema;

              return (
                <button
                  key={index}
                  disabled={schema.disabled}
                  title={schema.tooltip}
                  onClick={schema.onClick}
                >
                  {schema.title}
                </button>
              );
            },
          )}
          {mockRows.map((row: Monitor): React.ReactElement => {
            return (
              <div key={row._id} data-testid={`row-${row._id}`}>
                {props.columns.map(
                  (column: { getElement?: unknown }, index: number) => {
                    const getElement:
                      | ((item: Monitor) => React.ReactElement)
                      | undefined = column.getElement as
                      | ((item: Monitor) => React.ReactElement)
                      | undefined;

                    return (
                      <span key={index}>
                        {getElement ? getElement(row) : null}
                      </span>
                    );
                  },
                )}
                {(props.actionButtons || [])
                  .filter((action: ActionButtonSchema<Monitor>): boolean => {
                    return !action.isVisible || Boolean(action.isVisible(row));
                  })
                  .map(
                    (
                      action: ActionButtonSchema<Monitor>,
                      index: number,
                    ): React.ReactElement => {
                      return (
                        <button
                          key={index}
                          disabled={action.disabled}
                          title={action.tooltip}
                          onClick={() => {
                            action.onClick(
                              row,
                              () => {},
                              () => {},
                            );
                          }}
                        >
                          {action.title}
                        </button>
                      );
                    },
                  )}
              </div>
            );
          })}
        </section>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloNoticeBanner",
  () => {
    return {
      __esModule: true,
      default: (props: { refreshToggle?: string }): React.ReactElement => {
        return (
          <div
            data-testid="slo-notice-banner"
            data-refresh={props.refreshToggle || ""}
          />
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: ConfirmModalProps): React.ReactElement => {
      return (
        <div role="dialog" aria-label={props.title}>
          <h2>{props.title}</h2>
          <div>{props.description}</div>
          {props.error ? (
            <p data-testid="confirm-error">{props.error}</p>
          ) : null}
          <button onClick={props.onSubmit}>{props.submitButtonText}</button>
        </div>
      );
    },
  };
});

let mockSelection: Array<string> = [];

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (
      props: BasicFormModalProps<{ monitors: Array<string> }>,
    ): React.ReactElement => {
      const options: Array<{ label: string }> =
        (props.formProps.fields[0]?.dropdownOptions as
          | Array<{ label: string }>
          | undefined) || [];

      return (
        <div data-testid="add-monitors-modal">
          <h2>{props.title}</h2>
          <ul>
            {options.map((option: { label: string }) => {
              return <li key={option.label}>{option.label}</li>;
            })}
          </ul>
          {props.error ? <p data-testid="add-error">{props.error}</p> : null}
          <button
            onClick={() => {
              props.onSubmit?.({ monitors: mockSelection });
            }}
          >
            Submit selection
          </button>
        </div>
      );
    },
  };
});

import SloMonitors from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Monitors";
import {
  SLO_MONITORS_MANAGED_BY_RULES_MESSAGE,
  SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/SloMonitorSource";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MANUAL: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RULE: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EXTRA: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function monitor(id: string, name: string): Monitor {
  const row: Monitor = new Monitor();
  row._id = id;
  row.name = name;
  return row;
}

function sloWith(
  monitorIds: Array<string>,
  autoAddedMonitorIds: Array<string>,
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.monitors = monitorIds.map((id: string): Monitor => {
    return monitor(id, id);
  });
  slo.autoAddedMonitors = autoAddedMonitorIds.map((id: string): Monitor => {
    return monitor(id, id);
  });
  return slo;
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <SloMonitors
        pageRoute={new Route("/dashboard/slos")}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("slo-monitors-table")).toBeInTheDocument();
  });
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`row-${id}`);
}

describe("SLO Monitors page", () => {
  beforeEach(() => {
    mockTableProps = undefined;
    mockRows = [];
    mockSelection = [];
    mockGetItem.mockReset();
    mockCount.mockReset();
    mockGetList.mockReset();
    mockUpdateById.mockReset();
    mockUpdateById.mockResolvedValue({});

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(SLO_ID);
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route("/dashboard/slos"));
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("lists exactly the SLO's monitors, each marked Rule or Manual", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL, RULE], [RULE]));
    mockCount.mockResolvedValue(0);
    mockRows = [monitor(MANUAL, "Checkout API"), monitor(RULE, "Cart API")];

    await renderPage();

    const query: Record<string, unknown> = mockTableProps!.query as Record<
      string,
      unknown
    >;

    expect((query["_id"] as Includes).values).toEqual([MANUAL, RULE]);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(within(row(MANUAL)).getByText("Manual")).toBeInTheDocument();
    expect(within(row(RULE)).getByText("Rule")).toBeInTheDocument();
    expect(within(row(MANUAL)).getByText("Checkout API")).toBeInTheDocument();

    const countCall: {
      modelType: unknown;
      query: Record<string, unknown>;
    } = mockCount.mock.calls[0]![0] as {
      modelType: unknown;
      query: Record<string, unknown>;
    };

    expect(countCall.modelType).toBe(ServiceLevelObjectiveMonitorRule);
    expect(countCall.query["serviceLevelObjectiveId"]).toBe(SLO_ID);
    expect(countCall.query["isEnabled"]).toBe(true);
  });

  test("an SLO with nothing attached lists nothing rather than the whole project", async () => {
    mockGetItem.mockResolvedValue(sloWith([], []));
    mockCount.mockResolvedValue(0);

    await renderPage();

    expect(
      ((mockTableProps!.query as Record<string, unknown>)["_id"] as Includes)
        .values,
    ).toEqual([]);
  });

  test("while a rule is enabled, Add is locked with the API's reason and a banner links to Monitor Rules", async () => {
    mockGetItem.mockResolvedValue(sloWith([RULE], [RULE]));
    mockCount.mockResolvedValue(2);

    await renderPage();

    const add: HTMLElement = screen.getByRole("button", {
      name: "Add Monitors",
    });

    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", SLO_MONITORS_MANAGED_BY_RULES_MESSAGE);

    const banner: HTMLElement = screen.getByTestId(
      "slo-monitors-managed-by-rules",
    );

    expect(banner).toHaveTextContent("2 enabled monitor rules decide");
    expect(
      within(banner).getByText("Manage Monitor Rules").closest("a"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`${SLO_ID.toString()}/monitor-rules`),
    );
  });

  test("with no rule enabled there is no banner and Add is available", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL], []));
    mockCount.mockResolvedValue(0);

    await renderPage();

    expect(
      screen.queryByTestId("slo-monitors-managed-by-rules"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add Monitors" }),
    ).not.toBeDisabled();
  });

  test("a hand-attached row can be removed while rules are enabled; a rule-attached row keeps a locked Remove", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL, RULE], [RULE]));
    mockCount.mockResolvedValue(1);
    mockRows = [monitor(MANUAL, "Checkout API"), monitor(RULE, "Cart API")];

    await renderPage();

    const manualRemove: Array<HTMLElement> = within(row(MANUAL)).getAllByRole(
      "button",
      { name: "Remove" },
    );
    const ruleRemove: Array<HTMLElement> = within(row(RULE)).getAllByRole(
      "button",
      { name: "Remove" },
    );

    expect(manualRemove).toHaveLength(1);
    expect(manualRemove[0]).not.toBeDisabled();
    expect(ruleRemove).toHaveLength(1);
    expect(ruleRemove[0]).toBeDisabled();
    expect(ruleRemove[0]).toHaveAttribute(
      "title",
      SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
    );
  });

  test("Add offers only monitors not yet attached, and saves the change onto a fresh read", async () => {
    mockGetItem
      .mockResolvedValueOnce(sloWith([MANUAL], []))
      // The modal opens against the list as it is then...
      .mockResolvedValueOnce(sloWith([MANUAL], []))
      // ...and by the time the person saves, a rule sync added EXTRA.
      .mockResolvedValueOnce(sloWith([MANUAL, EXTRA], []))
      .mockResolvedValue(sloWith([MANUAL, EXTRA, OTHER], []));
    mockCount.mockResolvedValue(0);
    mockGetList.mockResolvedValue({
      data: [monitor(MANUAL, "Checkout API"), monitor(OTHER, "Search API")],
      count: 2,
    });

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Monitors" }));
    });

    const modal: HTMLElement = await screen.findByTestId("add-monitors-modal");

    expect(
      within(modal)
        .getAllByRole("listitem")
        .map((item: HTMLElement) => {
          return item.textContent;
        }),
    ).toEqual(["Search API"]);

    mockSelection = [OTHER];

    await act(async () => {
      fireEvent.click(within(modal).getByText("Submit selection"));
    });

    await waitFor(() => {
      expect(mockUpdateById).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateById.mock.calls[0]![0]).toEqual({
      modelType: ServiceLevelObjective,
      id: SLO_ID,
      data: {
        monitors: [{ _id: MANUAL }, { _id: EXTRA }, { _id: OTHER }],
      },
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("add-monitors-modal"),
      ).not.toBeInTheDocument();
    });

    // The table and the notice banner refresh together.
    expect(screen.getByTestId("slo-monitors-table")).toHaveAttribute(
      "data-refresh",
      "2",
    );
    expect(screen.getByTestId("slo-notice-banner")).toHaveAttribute(
      "data-refresh",
      "2",
    );
  });

  test("a rule enabled while the modal was open refuses the add without writing", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL], []));
    mockCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);
    mockGetList.mockResolvedValue({
      data: [monitor(OTHER, "Search API")],
      count: 1,
    });

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Monitors" }));
    });

    const modal: HTMLElement = await screen.findByTestId("add-monitors-modal");
    mockSelection = [OTHER];

    await act(async () => {
      fireEvent.click(within(modal).getByText("Submit selection"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("add-error")).toHaveTextContent(
        SLO_MONITORS_MANAGED_BY_RULES_MESSAGE,
      );
    });
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("an empty selection writes nothing", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL], []));
    mockCount.mockResolvedValue(0);
    mockGetList.mockResolvedValue({
      data: [monitor(OTHER, "Search API")],
      count: 1,
    });

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Monitors" }));
    });

    const modal: HTMLElement = await screen.findByTestId("add-monitors-modal");

    await act(async () => {
      fireEvent.click(within(modal).getByText("Submit selection"));
    });

    expect(screen.getByTestId("add-error")).toHaveTextContent(
      "Select at least one monitor to add.",
    );
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  test("says so when every monitor in the project is already attached", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL], []));
    mockCount.mockResolvedValue(0);
    mockGetList.mockResolvedValue({
      data: [monitor(MANUAL, "Checkout API")],
      count: 1,
    });

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Monitors" }));
    });

    expect(
      await screen.findByRole("dialog", { name: "Nothing to Add" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("add-monitors-modal")).not.toBeInTheDocument();
  });

  test("removing a hand-attached monitor asks first, then writes the list without it", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL, RULE], [RULE]));
    mockCount.mockResolvedValue(1);
    mockRows = [monitor(MANUAL, "Checkout API"), monitor(RULE, "Cart API")];

    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(row(MANUAL)).getByRole("button", { name: "Remove" }),
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Remove Monitor from SLO",
    });

    expect(dialog).toHaveTextContent("Checkout API");
    expect(mockUpdateById).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    });

    await waitFor(() => {
      expect(mockUpdateById).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateById.mock.calls[0]![0]).toEqual({
      modelType: ServiceLevelObjective,
      id: SLO_ID,
      data: { monitors: [{ _id: RULE }] },
    });
  });

  test("a save the API refuses keeps the dialog open with the reason", async () => {
    mockGetItem.mockResolvedValue(sloWith([MANUAL], []));
    mockCount.mockResolvedValue(0);
    mockRows = [monitor(MANUAL, "Checkout API")];
    mockUpdateById.mockRejectedValue(new Error("The API said no."));

    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(row(MANUAL)).getByRole("button", { name: "Remove" }),
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Remove Monitor from SLO",
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("confirm-error")).toHaveTextContent(
        "The API said no.",
      );
    });
    expect(
      screen.getByRole("dialog", { name: "Remove Monitor from SLO" }),
    ).toBeInTheDocument();
  });

  test("an SLO that cannot be loaded shows the error instead of an empty table", async () => {
    mockGetItem.mockRejectedValue(new Error("Could not load the SLO."));
    mockCount.mockResolvedValue(0);

    render(
      <MemoryRouter>
        <SloMonitors
          pageRoute={new Route("/dashboard/slos")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Could not load the SLO."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("slo-monitors-table")).not.toBeInTheDocument();
  });
});
