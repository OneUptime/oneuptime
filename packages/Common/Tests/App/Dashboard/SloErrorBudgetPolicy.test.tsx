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

/*
 * An SLO's Error Budget Policy page, rendered for real against a stubbed API
 * (the table is a stand-in that draws its empty state, its rows through the
 * page's own cells, and reports its rows as the real one does after every
 * read):
 *
 *   - "Use the recommended policy" is offered in the empty table's starter,
 *     only while the SLO has no tier, once the server has said what it adds,
 *     and never on an archived SLO;
 *   - it is locked, with the reason, for someone who may not create tiers,
 *     and not drawn while the permissions are unknown;
 *   - its confirmation lists exactly the tiers it adds - name, the budget
 *     left each applies at, what the team does - and says none raises
 *     anything until switched on;
 *   - confirming posts to the add route for this SLO, closes the dialog and
 *     reads the table again; a refusal is said in the dialog;
 *   - the rows run from the highest threshold down, say each threshold as
 *     the budget left it applies at, what each tier raises, and mark the
 *     tier the SLO is in.
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
const mockPost: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "22222222-2222-4222-8222-222222222222" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return (error as Error).message;
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return <div data-testid="markdown">{props.text}</div>;
    },
  };
});

let mockRows: Array<ServiceLevelObjectiveErrorBudgetPolicyTier> = [];
let mockTableProps:
  | ModelTableProps<ServiceLevelObjectiveErrorBudgetPolicyTier>
  | undefined;

/*
 * The table: reports its rows whenever it reads them - on mount and on
 * every refreshToggle - as its onFetchSuccess does; draws the page's empty
 * state (its title, description and actions, as BaseModelTable hands them
 * to TableEmptyState) while it has no rows; and otherwise draws each row
 * through the page's own column cells.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const {
    default: TableEmptyStateComponent,
    TableEmptyStateKind: EmptyStateKind,
  } = jest.requireActual(
    "../../../UI/Components/Table/TableEmptyState",
  ) as typeof import("../../../UI/Components/Table/TableEmptyState");

  return {
    __esModule: true,
    default: (
      props: ModelTableProps<ServiceLevelObjectiveErrorBudgetPolicyTier>,
    ): React.ReactElement => {
      mockTableProps = props;

      React.useEffect(() => {
        props.onFetchSuccess?.([...mockRows], mockRows.length);
      }, [props.refreshToggle]);

      return (
        <section data-testid={props.id} data-refresh={props.refreshToggle}>
          {props.topContent}
          {mockRows.length === 0 ? (
            <TableEmptyStateComponent
              kind={EmptyStateKind.Empty}
              title={props.emptyState?.title || ""}
              description={props.emptyState?.description}
              actions={props.emptyState?.actions}
            />
          ) : (
            <table>
              <tbody>
                {mockRows.map(
                  (row: ServiceLevelObjectiveErrorBudgetPolicyTier) => {
                    return (
                      <tr key={row._id} data-testid="tier-row">
                        {props.columns.map(
                          (
                            column: ModelTableProps<ServiceLevelObjectiveErrorBudgetPolicyTier>["columns"][number],
                          ) => {
                            return (
                              <td key={column.title}>
                                {column.getElement
                                  ? column.getElement(row)
                                  : ""}
                              </td>
                            );
                          },
                        )}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          )}
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
      default: (): null => {
        return null;
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
          <p>{props.description}</p>
          {props.children}
          {props.error ? (
            <p data-testid="confirm-error">{props.error}</p>
          ) : null}
          <button
            disabled={Boolean(props.disableSubmitButton || props.isLoading)}
            onClick={props.onSubmit}
          >
            {props.submitButtonText}
          </button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      );
    },
  };
});

import SloErrorBudgetPolicy, {
  CURRENT_POLICY_TIER_TEST_ID,
  ERROR_BUDGET_POLICY_TABLE_ID,
  POLICY_TIER_DEPLOYMENTS_TEST_ID,
  USE_RECOMMENDED_POLICY_BUTTON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/ErrorBudgetPolicy";
import SloRecommendedPolicyTiersModal, {
  RECOMMENDED_POLICY_FREEZE_NOTE,
  RECOMMENDED_POLICY_FREEZE_NOTE_TEST_ID,
  RECOMMENDED_TIER_FREEZES_DEPLOYMENTS_TEXT,
  RECOMMENDED_TIER_FREEZES_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloRecommendedPolicyTiersModal";
import { getRecommendedPolicySignature } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloRecommendedPolicyTiers";
import RecommendedPolicyTiersApi, {
  SLO_ADD_RECOMMENDED_POLICY_PATH,
  SLO_RECOMMENDED_POLICY_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/RecommendedPolicyTiersApi";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
  SloRecommendedPolicyTierToAdd,
  sloRecommendedPolicyTierToJSON,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import {
  SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE,
  SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
} from "../../../Utils/Slo/SloEvaluation";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const BUTTON: string = "Use the recommended policy";

function recommendedTiers(): Array<SloRecommendedPolicyTierToAdd> {
  return SLO_RECOMMENDED_POLICY_TIERS.map(
    (tier: SloRecommendedPolicyTier): SloRecommendedPolicyTierToAdd => {
      return { ...tier };
    },
  );
}

function tier(data: {
  name: string;
  thresholdPercentage: number;
  whatWeDo?: string;
  freezesDeployments?: boolean;
  shouldCreateAlert?: boolean;
  shouldCreateIncident?: boolean;
  autoResolveAlert?: boolean;
  isIncidentPrivate?: boolean;
  isEnabled?: boolean;
}): ServiceLevelObjectiveErrorBudgetPolicyTier {
  const row: ServiceLevelObjectiveErrorBudgetPolicyTier =
    new ServiceLevelObjectiveErrorBudgetPolicyTier();
  row._id = ObjectID.generate().toString();
  row.name = data.name;
  row.thresholdPercentage = data.thresholdPercentage;
  row.whatWeDo = data.whatWeDo || `What we do in ${data.name}.`;
  row.freezesDeployments = data.freezesDeployments ?? false;
  row.shouldCreateAlert = data.shouldCreateAlert ?? false;
  row.shouldCreateIncident = data.shouldCreateIncident ?? false;
  row.autoResolveAlert = data.autoResolveAlert ?? true;
  row.autoResolveIncident = true;
  row.isAlertPrivate = false;
  row.isIncidentPrivate = data.isIncidentPrivate ?? false;
  row.isEnabled = data.isEnabled ?? true;
  return row;
}

interface PostCall {
  url: URL;
  data: JSONObject;
  headers: Record<string, string>;
}

function postsTo(path: string): Array<PostCall> {
  return mockPost.mock.calls
    .map((call: Array<unknown>): PostCall => {
      return call[0] as PostCall;
    })
    .filter((call: PostCall): boolean => {
      return call.url.toString().endsWith(path);
    });
}

function storedSlo(
  overrides: {
    isArchived?: boolean;
    currentTierId?: string;
    enteredAt?: Date;
  } = {},
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.isArchived = overrides.isArchived ?? false;

  if (overrides.currentTierId) {
    slo.currentErrorBudgetPolicyTierId = new ObjectID(overrides.currentTierId);
  }

  if (overrides.enteredAt) {
    slo.currentErrorBudgetPolicyTierEnteredAt = overrides.enteredAt;
  }

  return slo;
}

// What the routes answer, by path.
let missing: Array<SloRecommendedPolicyTierToAdd>;
let addOutcome: (() => Promise<unknown>) | null;

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <SloErrorBudgetPolicy
        pageRoute={new Route("/dashboard/slos")}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(
      screen.getByTestId(ERROR_BUDGET_POLICY_TABLE_ID),
    ).toBeInTheDocument();
  });

  // The page's first questions to the server are answered inside act.
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  mockRows = [];
  mockTableProps = undefined;
  missing = recommendedTiers();
  addOutcome = null;

  mockGetItem.mockReset();
  mockPost.mockReset();

  mockGetItem.mockResolvedValue(storedSlo());

  mockPost.mockImplementation((async (call: PostCall): Promise<unknown> => {
    if (call.url.toString().endsWith(SLO_ADD_RECOMMENDED_POLICY_PATH)) {
      if (addOutcome) {
        return await addOutcome();
      }

      const added: Array<SloRecommendedPolicyTierToAdd> = missing.map(
        (item: SloRecommendedPolicyTierToAdd) => {
          return { ...item, id: ObjectID.generate().toString() };
        },
      );

      // The tiers now exist, so nothing is missing any more.
      for (const item of added) {
        mockRows.push(
          tier({
            name: item.name,
            thresholdPercentage: item.thresholdPercentage,
            whatWeDo: item.whatWeDo,
          }),
        );
      }

      missing = [];

      return {
        data: { tiers: added.map(sloRecommendedPolicyTierToJSON) },
      };
    }

    return { data: { tiers: missing.map(sloRecommendedPolicyTierToJSON) } };
  }) as never);

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

describe("Use the recommended policy on the Error Budget Policy page", () => {
  test("is offered in the empty table's starter, once the server has said what it adds", async () => {
    await renderPage();

    const button: HTMLElement = await screen.findByRole("button", {
      name: BUTTON,
    });

    // In the table's own empty state, after its title and what to do.
    const table: HTMLElement = screen.getByTestId(ERROR_BUDGET_POLICY_TABLE_ID);

    expect(table).toContainElement(button);
    expect(table).toHaveTextContent("No error budget policy yet");
    expect(table).toHaveTextContent(
      "Start from the recommended policy, or add tiers of your own.",
    );
    expect(button).toBeEnabled();
    expect(screen.getByTestId(USE_RECOMMENDED_POLICY_BUTTON_TEST_ID)).toBe(
      button,
    );

    // Asked once, for this SLO, in its project.
    const asked: Array<PostCall> = postsTo(SLO_RECOMMENDED_POLICY_PATH);

    expect(asked).toHaveLength(1);
    expect(asked[0]!.data).toEqual({
      serviceLevelObjectiveId: SLO_ID.toString(),
    });
    expect(asked[0]!.headers).toEqual({ tenantid: PROJECT_ID.toString() });
  });

  test("is not offered, nor asked about, once the SLO has a tier", async () => {
    mockRows = [tier({ name: "Caution", thresholdPercentage: 50 })];

    await renderPage();

    expect(screen.getAllByTestId("tier-row")).toHaveLength(1);
    expect(postsTo(SLO_RECOMMENDED_POLICY_PATH)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  test("is not offered while the server has not said what it would add, or could not", async () => {
    let answer: (value: unknown) => void = (): void => {};

    mockPost.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        answer = resolve;
      }),
    );

    await renderPage();

    expect(postsTo(SLO_RECOMMENDED_POLICY_PATH)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();

    await act(async () => {
      answer({ data: { tiers: [] } });
    });

    // Nothing to add: still nothing to offer.
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();

    cleanup();
    mockPost.mockRejectedValue(new Error("You may not read these tiers."));

    await renderPage();

    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  test("is not offered on an archived SLO, to which a policy never applies", async () => {
    mockGetItem.mockResolvedValue(storedSlo({ isArchived: true }));

    await renderPage();

    await waitFor(() => {
      expect(postsTo(SLO_RECOMMENDED_POLICY_PATH)).toHaveLength(1);
    });

    expect(
      (mockGetItem.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toEqual(expect.objectContaining({ isArchived: true }));
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  test("its confirmation lists exactly the tiers it adds, and that none of them pages anyone", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });
    const listed: Array<HTMLElement> = within(dialog).getAllByTestId(
      "slo-recommended-policy-tier",
    );

    expect(
      listed.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual(
      SLO_RECOMMENDED_POLICY_TIERS.map(
        (recommended: SloRecommendedPolicyTier): string => {
          return `${recommended.name}Budget left ≤ ${recommended.thresholdPercentage}%${recommended.whatWeDo}${recommended.freezesDeployments ? "Freezes deployments" : ""}`;
        },
      ),
    );
    expect(dialog).toHaveTextContent(
      "They raise no alerts or incidents until you switch that on, and you can edit them afterwards like any other tier.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Add tiers" }),
    ).toBeEnabled();
  });

  test("its confirmation marks the tier that freezes deployments - Budget exhausted - and says what that does", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });
    const listed: Array<HTMLElement> = within(dialog).getAllByTestId(
      "slo-recommended-policy-tier",
    );

    expect(
      listed.map((item: HTMLElement): boolean => {
        return Boolean(
          within(item).queryByTestId(RECOMMENDED_TIER_FREEZES_TEST_ID),
        );
      }),
    ).toEqual([false, false, true]);
    expect(
      within(listed[2]!).getByTestId(RECOMMENDED_TIER_FREEZES_TEST_ID),
    ).toHaveTextContent(RECOMMENDED_TIER_FREEZES_DEPLOYMENTS_TEXT);
    expect(listed[2]).toHaveTextContent("Budget exhausted");
    expect(
      within(dialog).getByTestId(RECOMMENDED_POLICY_FREEZE_NOTE_TEST_ID),
    ).toHaveTextContent(
      "A tier marked Freezes deployments tells CI/CD pipelines that check this SLO to hold back releases while the SLO is in it.",
    );
    expect(RECOMMENDED_POLICY_FREEZE_NOTE).toContain(
      RECOMMENDED_TIER_FREEZES_DEPLOYMENTS_TEXT,
    );
  });

  test("what the server says it adds decides the mark: the definition, as the API answers it", async () => {
    // A tier the server does not say freezes is not marked, whatever its name.
    missing = recommendedTiers().map(
      (recommended: SloRecommendedPolicyTierToAdd) => {
        return { ...recommended, freezesDeployments: false };
      },
    );

    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });

    expect(
      within(dialog).queryByTestId(RECOMMENDED_TIER_FREEZES_TEST_ID),
    ).toBeNull();
    expect(
      within(dialog).queryByTestId(RECOMMENDED_POLICY_FREEZE_NOTE_TEST_ID),
    ).toBeNull();
  });

  test("adding them posts to the add route for this SLO, closes the dialog and reads the table again, which then lists them", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });
    const refreshBefore: string | undefined = mockTableProps!.refreshToggle;

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Add tiers" }),
      );
    });

    const added: Array<PostCall> = postsTo(SLO_ADD_RECOMMENDED_POLICY_PATH);

    expect(added).toHaveLength(1);
    expect(added[0]!.data).toEqual({
      serviceLevelObjectiveId: SLO_ID.toString(),
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(mockTableProps!.refreshToggle).not.toBe(refreshBefore);

    await waitFor(() => {
      expect(screen.getAllByTestId("tier-row")).toHaveLength(3);
    });

    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    // The table has rows now: what is missing is not asked again.
    expect(postsTo(SLO_RECOMMENDED_POLICY_PATH)).toHaveLength(1);
  });

  test("a refusal is said in the dialog, which stays open, and the table is read again", async () => {
    addOutcome = async (): Promise<unknown> => {
      throw new Error(
        "Using the recommended error budget policy takes a role that can create SLO error budget policy tiers.",
      );
    };

    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });
    const refreshBefore: string | undefined = mockTableProps!.refreshToggle;

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Add tiers" }),
      );
    });

    expect(
      await within(dialog).findByTestId("confirm-error"),
    ).toHaveTextContent(
      "takes a role that can create SLO error budget policy tiers",
    );
    expect(screen.getByRole("dialog", { name: BUTTON })).toBeInTheDocument();
    expect(mockTableProps!.refreshToggle).not.toBe(refreshBefore);
  });

  test("closing the dialog adds nothing", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(postsTo(SLO_ADD_RECOMMENDED_POLICY_PATH)).toHaveLength(0);
    expect(screen.getByRole("button", { name: BUTTON })).toBeInTheDocument();
  });

  test("is locked, with the reason, for someone who may not create tiers - and opens nothing", async () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(((
      _model: unknown,
      action: ModelAction,
    ) => {
      return action === ModelAction.Create
        ? {
            isAllowed: false,
            disabledReason:
              "You do not have permission to create this SLO Error Budget Policy Tier.",
          }
        : { isAllowed: true };
    }) as never);

    await renderPage();

    const button: HTMLElement = await screen.findByRole("button", {
      name: BUTTON,
    });

    expect(button).toBeDisabled();

    fireEvent.mouseEnter(
      screen.getByTestId(
        `${USE_RECOMMENDED_POLICY_BUTTON_TEST_ID}-disabled-wrapper`,
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "You do not have permission to create this SLO Error Budget Policy Tier.",
      );
    });

    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(postsTo(SLO_ADD_RECOMMENDED_POLICY_PATH)).toHaveLength(0);
  });

  test("is not drawn while the permissions are still unknown", async () => {
    jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false, disabledReason: undefined });

    await renderPage();

    await waitFor(() => {
      expect(postsTo(SLO_RECOMMENDED_POLICY_PATH)).toHaveLength(1);
    });

    expect(screen.getByTestId(ERROR_BUDGET_POLICY_TABLE_ID)).toHaveTextContent(
      "No error budget policy yet",
    );
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });
});

describe("the tiers table", () => {
  test("lists the tiers from the highest threshold down, for this SLO, made for this SLO", async () => {
    await renderPage();

    expect(mockTableProps!.sortBy).toBe("thresholdPercentage");
    expect(mockTableProps!.sortOrder).toBe(SortOrder.Descending);
    expect(mockTableProps!.query).toEqual({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
    });

    const created: ServiceLevelObjectiveErrorBudgetPolicyTier =
      await mockTableProps!.onBeforeCreate!(
        new ServiceLevelObjectiveErrorBudgetPolicyTier(),
        {},
        {},
      );

    expect(created.serviceLevelObjectiveId).toBe(SLO_ID);
    expect(created.projectId).toBe(PROJECT_ID);
    // ModelTable's own create button, named after the model.
    expect(mockTableProps!.isCreateable).toBe(true);
    expect(mockTableProps!.singularName).toBeUndefined();
  });

  test("says under its title how a tier is entered and left, from the evaluation's own margins", async () => {
    await renderPage();

    expect(mockTableProps!.cardProps!.title).toBe("Error Budget Policy");
    expect(mockTableProps!.cardProps!.description).toBe(
      `What the team agreed to do as this SLO's error budget runs down. The SLO is in the tier with the lowest threshold its budget is at or below. It leaves a tier once its budget is ${SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE} points above the tier's threshold, and a tier at 0% once ${SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE}% is left again.`,
    );
    expect(mockTableProps!.documentationLink!.toString()).toBe(
      "/docs/slo/error-budget-policy",
    );
  });

  test("says each threshold as the budget left it applies at, what the team does, and what each tier raises", async () => {
    mockRows = [
      tier({
        name: "Caution",
        thresholdPercentage: 50,
        whatWeDo: "Review **risky** changes.",
      }),
      tier({
        name: "Reliability first",
        thresholdPercentage: 25.5,
        shouldCreateAlert: true,
        autoResolveAlert: false,
      }),
      tier({
        name: "Budget exhausted",
        thresholdPercentage: 0,
        shouldCreateAlert: true,
        shouldCreateIncident: true,
        isIncidentPrivate: true,
      }),
    ];

    await renderPage();

    const rows: Array<HTMLElement> = screen.getAllByTestId("tier-row");

    expect(rows[0]).toHaveTextContent("Budget left ≤ 50%");
    expect(within(rows[0]!).getByTestId("markdown")).toHaveTextContent(
      "Review **risky** changes.",
    );
    // A tier raises nothing until someone switches that on.
    expect(rows[0]).toHaveTextContent("Nothing");

    expect(rows[1]).toHaveTextContent("Budget left ≤ 25.5%");
    expect(rows[1]).toHaveTextContent("Alert");
    expect(rows[1]).toHaveTextContent("Alert: resolved by hand");

    expect(rows[2]).toHaveTextContent("Budget left ≤ 0%");
    expect(rows[2]).toHaveTextContent("Alert + Incident");
    expect(rows[2]).toHaveTextContent("Incident: private");
  });

  test("says in each row whether deployments are frozen or allowed while the SLO is in the tier", async () => {
    mockRows = [
      tier({ name: "Caution", thresholdPercentage: 50 }),
      tier({
        name: "Reliability first",
        thresholdPercentage: 25,
        freezesDeployments: true,
      }),
      tier({
        name: "Budget exhausted",
        thresholdPercentage: 0,
        freezesDeployments: true,
      }),
    ];

    await renderPage();

    const cells: Array<HTMLElement> = screen.getAllByTestId(
      POLICY_TIER_DEPLOYMENTS_TEST_ID,
    );

    expect(
      cells.map((cell: HTMLElement): string => {
        return cell.textContent || "";
      }),
    ).toEqual(["Allowed", "Frozen", "Frozen"]);

    // The column is read from the tier's own switch.
    const column: { title: string; field?: unknown } | undefined =
      mockTableProps?.columns.find(
        (candidate: { title: string }): boolean => {
          return candidate.title === "Deployments";
        },
      );

    expect(column?.field).toEqual({ freezesDeployments: true });
  });

  test("a tier read without its switch reads as allowed", async () => {
    const row: ServiceLevelObjectiveErrorBudgetPolicyTier = tier({
      name: "Caution",
      thresholdPercentage: 50,
    });
    row.freezesDeployments = undefined;
    mockRows = [row];

    await renderPage();

    expect(screen.getByTestId(POLICY_TIER_DEPLOYMENTS_TEST_ID)).toHaveTextContent(
      "Allowed",
    );
  });

  test("marks the tier the SLO is in, and when it entered it", async () => {
    const caution: ServiceLevelObjectiveErrorBudgetPolicyTier = tier({
      name: "Caution",
      thresholdPercentage: 50,
    });
    const reliabilityFirst: ServiceLevelObjectiveErrorBudgetPolicyTier = tier({
      name: "Reliability first",
      thresholdPercentage: 25,
    });
    mockRows = [caution, reliabilityFirst];
    mockGetItem.mockResolvedValue(
      storedSlo({
        currentTierId: reliabilityFirst._id!,
        enteredAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      }),
    );

    await renderPage();

    const marks: Array<HTMLElement> = await screen.findAllByTestId(
      CURRENT_POLICY_TIER_TEST_ID,
    );

    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("Current tier");

    const rows: Array<HTMLElement> = screen.getAllByTestId("tier-row");

    expect(rows[1]).toContainElement(marks[0]!);
    expect(rows[1]).toHaveTextContent("Entered 3 hours ago");
    expect(rows[0]).not.toHaveTextContent("Entered");

    // Read with the columns the mark needs.
    expect(
      (mockGetItem.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toEqual(
      expect.objectContaining({
        currentErrorBudgetPolicyTierId: true,
        currentErrorBudgetPolicyTierEnteredAt: true,
      }),
    );
  });

  test("marks no tier while the SLO is in none", async () => {
    mockRows = [tier({ name: "Caution", thresholdPercentage: 50 })];

    await renderPage();

    expect(screen.getAllByTestId("tier-row")).toHaveLength(1);
    expect(screen.queryByTestId(CURRENT_POLICY_TIER_TEST_ID)).toBeNull();
  });

  test("reads which tier the SLO is in again whenever the table reads its rows", async () => {
    mockRows = [tier({ name: "Caution", thresholdPercentage: 50 })];

    await renderPage();

    const readsBefore: number = mockGetItem.mock.calls.length;

    await act(async () => {
      mockTableProps!.onFetchSuccess!([...mockRows], mockRows.length);
    });

    expect(mockGetItem.mock.calls.length).toBe(readsBefore + 1);
  });
});

describe("the confirmation, on its own", () => {
  function renderModal(
    tiers: Array<SloRecommendedPolicyTierToAdd>,
    more: Partial<{ isLoading: boolean; error: string }> = {},
  ): { onSubmit: MockFunction; onClose: MockFunction } {
    const onSubmit: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();

    render(
      <SloRecommendedPolicyTiersModal
        tiers={tiers}
        isLoading={more.isLoading ?? false}
        error={more.error ?? ""}
        onSubmit={onSubmit as unknown as () => void}
        onClose={onClose as unknown as () => void}
      />,
    );

    return { onSubmit, onClose };
  }

  test("lists only what is missing, as the server said it", () => {
    renderModal([recommendedTiers()[2]!]);

    const listed: Array<HTMLElement> = screen.getAllByTestId(
      "slo-recommended-policy-tier",
    );

    expect(listed).toHaveLength(1);
    expect(listed[0]).toHaveTextContent("Budget exhausted");
    expect(listed[0]).toHaveTextContent("Budget left ≤ 0%");
    expect(listed[0]).toHaveTextContent("Freezes deployments");
    expect(
      screen.getByTestId(RECOMMENDED_POLICY_FREEZE_NOTE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("with no tier that freezes deployments left to add, says nothing about deployments", () => {
    renderModal(recommendedTiers().slice(0, 2));

    expect(screen.queryByTestId(RECOMMENDED_TIER_FREEZES_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(RECOMMENDED_POLICY_FREEZE_NOTE_TEST_ID),
    ).toBeNull();
  });

  test("confirms with Add tiers, and offers nothing to confirm when there is nothing to add", () => {
    const { onSubmit } = renderModal(recommendedTiers());

    fireEvent.click(screen.getByRole("button", { name: "Add tiers" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    cleanup();
    renderModal([]);

    expect(screen.getByRole("button", { name: "Add tiers" })).toBeDisabled();
  });

  test("shows the refusal it is handed", () => {
    renderModal(recommendedTiers(), { error: "Not allowed." });

    expect(screen.getByTestId("confirm-error")).toHaveTextContent(
      "Not allowed.",
    );
  });
});

describe("what decides whether to ask again", () => {
  test("is each row's id, name and threshold, and how many rows there are", () => {
    const caution: ServiceLevelObjectiveErrorBudgetPolicyTier = tier({
      name: "Caution",
      thresholdPercentage: 50,
    });
    const base: string = getRecommendedPolicySignature([caution], 1);

    expect(getRecommendedPolicySignature([caution], 1)).toBe(base);

    const stamped: ServiceLevelObjectiveErrorBudgetPolicyTier = Object.assign(
      new ServiceLevelObjectiveErrorBudgetPolicyTier(),
      caution,
      { lastAlertCreatedAt: new Date() },
    );

    expect(getRecommendedPolicySignature([stamped], 1)).toBe(base);

    const renamed: ServiceLevelObjectiveErrorBudgetPolicyTier = Object.assign(
      new ServiceLevelObjectiveErrorBudgetPolicyTier(),
      caution,
      { name: "Slowdown" },
    );
    const moved: ServiceLevelObjectiveErrorBudgetPolicyTier = Object.assign(
      new ServiceLevelObjectiveErrorBudgetPolicyTier(),
      caution,
      { thresholdPercentage: 40 },
    );

    expect(getRecommendedPolicySignature([renamed], 1)).not.toBe(base);
    expect(getRecommendedPolicySignature([moved], 1)).not.toBe(base);
    expect(getRecommendedPolicySignature([], 0)).not.toBe(base);
  });
});

describe("the API the page calls", () => {
  test("asks and adds through the two routes beside the tier table's CRUD path", async () => {
    mockPost.mockResolvedValue({
      data: { tiers: recommendedTiers().map(sloRecommendedPolicyTierToJSON) },
    });

    expect(await RecommendedPolicyTiersApi.getMissing(SLO_ID)).toEqual(
      recommendedTiers(),
    );
    expect(await RecommendedPolicyTiersApi.addMissing(SLO_ID)).toEqual(
      recommendedTiers(),
    );

    expect(
      mockPost.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as PostCall).url.toString();
      }),
    ).toEqual([
      expect.stringMatching(
        /\/service-level-objective-error-budget-policy-tier\/recommended-policy$/,
      ),
      expect.stringMatching(
        /\/service-level-objective-error-budget-policy-tier\/recommended-policy\/add$/,
      ),
    ]);
  });

  test("throws a refusal, whose message is the server's sentence", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "Not allowed." } as JSONObject,
      {},
    );
    mockPost.mockResolvedValue(refusal);

    await expect(RecommendedPolicyTiersApi.addMissing(SLO_ID)).rejects.toBe(
      refusal,
    );
  });

  test("reads an answer it cannot make sense of as nothing to add", async () => {
    mockPost.mockResolvedValue({ data: { data: [], count: 0 } });

    expect(await RecommendedPolicyTiersApi.getMissing(SLO_ID)).toEqual([]);

    mockPost.mockResolvedValue({ data: [] });

    expect(await RecommendedPolicyTiersApi.getMissing(SLO_ID)).toEqual([]);
  });
});
