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
import { CardButtonSchema } from "../../../UI/Components/Card/Card";

/*
 * "Add recommended rules" on an SLO's Burn Rate Rules page, rendered for
 * real against a stubbed API (the table is a stand-in that draws the page's
 * own card buttons and reports its rows, as the real one does after every
 * read):
 *
 *   - the action is offered only while the server says the SLO is missing a
 *     recommended rule, and is asked again only when the table's rows change;
 *   - it is locked, with the reason, for someone who may not create rules;
 *   - its confirmation lists exactly what will be added, as the rules table
 *     will show it;
 *   - confirming posts to the add route for this SLO, closes the dialog and
 *     reads the table again - after which the action is gone;
 *   - a refusal is said in the dialog, which stays open.
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

let mockRows: Array<ServiceLevelObjectiveBurnRateRule> = [];
let mockTableProps:
  | ModelTableProps<ServiceLevelObjectiveBurnRateRule>
  | undefined;

/*
 * The table: draws the card's buttons, and reports its rows whenever it
 * reads them - on mount and on every refreshToggle - as BaseModelTable's
 * onFetchSuccess does.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (
      props: ModelTableProps<ServiceLevelObjectiveBurnRateRule>,
    ): React.ReactElement => {
      mockTableProps = props;

      React.useEffect(() => {
        props.onFetchSuccess?.([...mockRows], mockRows.length);
      }, [props.refreshToggle]);

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

import SloBurnRateRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules";
import SloRecommendedBurnRateRulesModal from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloRecommendedBurnRateRulesModal";
import { getRecommendedRulesSignature } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloRecommendedBurnRateRules";
import RecommendedBurnRateRulesApi, {
  SLO_ADD_RECOMMENDED_BURN_RATE_RULES_PATH,
  SLO_RECOMMENDED_BURN_RATE_RULES_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/RecommendedBurnRateRulesApi";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  SloRecommendedBurnRateRuleToAdd,
  getSloRecommendedBurnRateRules,
  sloRecommendedBurnRateRuleToJSON,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const BUTTON: string = "Add recommended rules";

function slowLeakToAdd(
  window: { windowDays: number } = { windowDays: 30 },
): SloRecommendedBurnRateRuleToAdd {
  return {
    ...getSloRecommendedBurnRateRules(window)[2]!,
    alertSeverityName: "Low",
  };
}

function rule(name: string, longWindowInMinutes: number): ServiceLevelObjectiveBurnRateRule {
  const row: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  row._id = ObjectID.generate().toString();
  row.name = name;
  row.longWindowInMinutes = longWindowInMinutes;
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

// What the routes answer, by path.
let missing: Array<SloRecommendedBurnRateRuleToAdd>;
let addOutcome: (() => Promise<unknown>) | null;

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <SloBurnRateRules
        pageRoute={new Route("/dashboard/slos")}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("slo-burn-rate-rules-table")).toBeInTheDocument();
  });
}

beforeEach(() => {
  mockRows = [rule("Fast burn", 60), rule("Slow burn", 360)];
  mockTableProps = undefined;
  missing = [slowLeakToAdd()];
  addOutcome = null;

  mockGetItem.mockReset();
  mockPost.mockReset();

  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.isEnabled = true;
  slo.sloStatus = SloStatus.Healthy;
  mockGetItem.mockResolvedValue(slo);

  mockPost.mockImplementation((async (call: PostCall): Promise<unknown> => {
    if (call.url.toString().endsWith(SLO_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)) {
      if (addOutcome) {
        return await addOutcome();
      }

      const added: Array<SloRecommendedBurnRateRuleToAdd> = missing.map(
        (item: SloRecommendedBurnRateRuleToAdd) => {
          return { ...item, id: ObjectID.generate().toString() };
        },
      );

      // The rules now exist, so nothing is missing any more.
      for (const item of added) {
        mockRows.push(rule(item.name, item.longWindowInMinutes));
      }

      missing = [];

      return {
        data: { rules: added.map(sloRecommendedBurnRateRuleToJSON) },
      };
    }

    return { data: { rules: missing.map(sloRecommendedBurnRateRuleToJSON) } };
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

describe("Add recommended rules on the Burn Rate Rules page", () => {
  test("is offered while the SLO is missing a recommended rule", async () => {
    await renderPage();

    expect(
      await screen.findByRole("button", { name: BUTTON }),
    ).toBeInTheDocument();

    // Asked once, for this SLO, in its project.
    const asked: Array<PostCall> = postsTo(SLO_RECOMMENDED_BURN_RATE_RULES_PATH);

    expect(asked).toHaveLength(1);
    expect(asked[0]!.data).toEqual({
      serviceLevelObjectiveId: SLO_ID.toString(),
    });
    expect(asked[0]!.headers).toEqual({ tenantid: PROJECT_ID.toString() });
  });

  test("is not offered to an SLO that has every recommended rule", async () => {
    missing = [];

    await renderPage();

    await waitFor(() => {
      expect(postsTo(SLO_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(1);
    });

    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  test("is not offered when the server cannot say what is missing", async () => {
    mockPost.mockRejectedValue(new Error("You may not read these rules."));

    await renderPage();

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
    });

    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  test("asks again only when the table's rows change, not on every read", async () => {
    await renderPage();
    await screen.findByRole("button", { name: BUTTON });

    // The worker stamped a rule's lifecycle: same rows, read again.
    act(() => {
      mockTableProps!.onFetchSuccess!([...mockRows], mockRows.length);
    });

    expect(postsTo(SLO_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(1);

    // Someone deleted Slow burn.
    await act(async () => {
      mockTableProps!.onFetchSuccess!([mockRows[0]!], 1);
    });

    await waitFor(() => {
      expect(postsTo(SLO_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(2);
    });
  });

  test("its confirmation lists exactly what will be added, as the rules table will show it", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });
    const rules: Array<HTMLElement> = within(dialog).getAllByTestId(
      "slo-recommended-burn-rate-rule",
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]).toHaveTextContent("Slow leak");
    expect(rules[0]).toHaveTextContent("1×");
    expect(rules[0]).toHaveTextContent(
      "Fires when about 10% of the error budget burns in 3d",
    );
    expect(rules[0]).toHaveTextContent("4320m / 360m");
    expect(rules[0]).toHaveTextContent("Suppress 1440m after resolve");
    expect(rules[0]).toHaveTextContent("Alert: Low");
    expect(
      within(dialog).getByRole("button", { name: "Add rules" }),
    ).toBeEnabled();
  });

  test("adding them posts to the add route for this SLO, closes the dialog, reads the table again, and the action goes", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });
    const refreshBefore: string | undefined = mockTableProps!.refreshToggle;

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add rules" }));
    });

    const added: Array<PostCall> = postsTo(
      SLO_ADD_RECOMMENDED_BURN_RATE_RULES_PATH,
    );

    expect(added).toHaveLength(1);
    expect(added[0]!.data).toEqual({
      serviceLevelObjectiveId: SLO_ID.toString(),
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(mockTableProps!.refreshToggle).not.toBe(refreshBefore);

    await waitFor(() => {
      expect(postsTo(SLO_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(2);
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    });
  });

  test("a refusal is said in the dialog, which stays open, and the table is read again", async () => {
    addOutcome = async (): Promise<unknown> => {
      throw new Error(
        "Adding the recommended burn rate rules takes a role that can create SLO burn rate rules.",
      );
    };

    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: BUTTON,
    });
    const refreshBefore: string | undefined = mockTableProps!.refreshToggle;

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add rules" }));
    });

    expect(await within(dialog).findByTestId("confirm-error")).toHaveTextContent(
      "takes a role that can create SLO burn rate rules",
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
    expect(postsTo(SLO_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(0);
  });

  test("is locked, with the reason, for someone who may not create rules - and opens nothing", async () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(((
      _model: unknown,
      action: ModelAction,
    ) => {
      return action === ModelAction.Create
        ? {
            isAllowed: false,
            disabledReason:
              "You do not have permission to create this SLO Burn Rate Rule.",
          }
        : { isAllowed: true };
    }) as never);

    await renderPage();

    const button: HTMLElement = await screen.findByRole("button", {
      name: BUTTON,
    });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "You do not have permission to create this SLO Burn Rate Rule.",
    );

    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("is not drawn at all while the permissions are still unknown", async () => {
    jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false, disabledReason: undefined });

    await renderPage();

    await waitFor(() => {
      expect(postsTo(SLO_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(1);
    });

    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });
});

describe("the confirmation, on its own", () => {
  function renderModal(
    rules: Array<SloRecommendedBurnRateRuleToAdd>,
    more: Partial<{ isLoading: boolean; error: string }> = {},
  ): { onSubmit: MockFunction; onClose: MockFunction } {
    const onSubmit: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();

    render(
      <SloRecommendedBurnRateRulesModal
        rules={rules}
        isLoading={more.isLoading ?? false}
        error={more.error ?? ""}
        onSubmit={onSubmit as unknown as () => void}
        onClose={onClose as unknown as () => void}
      />,
    );

    return { onSubmit, onClose };
  }

  test("lists every rule it adds, each with what it is for", () => {
    renderModal(
      getSloRecommendedBurnRateRules({ windowDays: 30 }).map(
        (recommended: ReturnType<typeof getSloRecommendedBurnRateRules>[0]) => {
          return {
            ...recommended,
            alertSeverityName:
              recommended.name === "Slow leak" ? "Low" : "Critical",
          };
        },
      ),
    );

    const rules: Array<HTMLElement> = screen.getAllByTestId(
      "slo-recommended-burn-rate-rule",
    );

    expect(
      rules.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "Fast burn14.4×Fires when about 2% of the error budget burns in 1h60m / 5mSuppress 60m after resolveAlert: Critical",
      "Slow burn6×Fires when about 5% of the error budget burns in 6h360m / 30mSuppress 360m after resolveAlert: Critical",
      "Slow leak1×Fires when about 10% of the error budget burns in 3d4320m / 360mSuppress 1440m after resolveAlert: Low",
    ]);
  });

  test("says a short window's slow leak as it is scaled: 16.8 hours on a 7-day SLO", () => {
    renderModal([slowLeakToAdd({ windowDays: 7 })]);

    const leak: HTMLElement = screen.getByTestId(
      "slo-recommended-burn-rate-rule",
    );

    expect(leak).toHaveTextContent(
      "Fires when about 10% of the error budget burns in 16h 48m",
    );
    expect(leak).toHaveTextContent("1008m / 84m");
    expect(leak).toHaveTextContent("Suppress 1008m after resolve");
  });

  test("a rule the project has no severity for says it raises at the default one", () => {
    renderModal([{ ...slowLeakToAdd(), alertSeverityName: null }]);

    expect(screen.getByTestId("slo-recommended-burn-rate-rule")).toHaveTextContent(
      "Alert: Default",
    );
  });

  test("says what it is and what happens after", () => {
    renderModal([slowLeakToAdd()]);

    const dialog: HTMLElement = screen.getByRole("dialog", { name: BUTTON });

    expect(dialog).toHaveTextContent(
      "These are the recommended burn rate rules this SLO does not have yet, scaled to its compliance window. Edit or delete them afterwards like any other rule.",
    );
  });

  test("confirms with Add rules, and offers nothing to confirm when there is nothing to add", () => {
    const { onSubmit } = renderModal([slowLeakToAdd()]);

    fireEvent.click(screen.getByRole("button", { name: "Add rules" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    cleanup();
    renderModal([]);

    expect(screen.getByRole("button", { name: "Add rules" })).toBeDisabled();
  });

  test("shows the refusal it is handed", () => {
    renderModal([slowLeakToAdd()], { error: "Not allowed." });

    expect(screen.getByTestId("confirm-error")).toHaveTextContent(
      "Not allowed.",
    );
  });
});

describe("what decides whether to ask again", () => {
  test("is each row's id, name and long window, and how many rows there are", () => {
    const fast: ServiceLevelObjectiveBurnRateRule = rule("Fast burn", 60);
    const base: string = getRecommendedRulesSignature([fast], 1);

    expect(getRecommendedRulesSignature([fast], 1)).toBe(base);

    const lifecycle: ServiceLevelObjectiveBurnRateRule = Object.assign(
      new ServiceLevelObjectiveBurnRateRule(),
      fast,
      { lastAlertCreatedAt: new Date() },
    );

    expect(getRecommendedRulesSignature([lifecycle], 1)).toBe(base);

    const renamed: ServiceLevelObjectiveBurnRateRule = Object.assign(
      new ServiceLevelObjectiveBurnRateRule(),
      fast,
      { name: "Paging" },
    );
    const moved: ServiceLevelObjectiveBurnRateRule = Object.assign(
      new ServiceLevelObjectiveBurnRateRule(),
      fast,
      { longWindowInMinutes: 30 },
    );

    expect(getRecommendedRulesSignature([renamed], 1)).not.toBe(base);
    expect(getRecommendedRulesSignature([moved], 1)).not.toBe(base);
    expect(getRecommendedRulesSignature([fast], 2)).not.toBe(base);
    expect(getRecommendedRulesSignature([], 0)).not.toBe(base);
  });
});

describe("the API the page calls", () => {
  test("asks and adds through the two routes beside the rule table's CRUD path", async () => {
    mockPost.mockResolvedValue({
      data: { rules: [sloRecommendedBurnRateRuleToJSON(slowLeakToAdd())] },
    });

    expect(await RecommendedBurnRateRulesApi.getMissing(SLO_ID)).toEqual([
      slowLeakToAdd(),
    ]);
    expect(await RecommendedBurnRateRulesApi.addMissing(SLO_ID)).toEqual([
      slowLeakToAdd(),
    ]);

    expect(
      mockPost.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as PostCall).url.toString();
      }),
    ).toEqual([
      expect.stringMatching(
        /\/service-level-objective-burn-rate-rule\/recommended-rules$/,
      ),
      expect.stringMatching(
        /\/service-level-objective-burn-rate-rule\/recommended-rules\/add$/,
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

    await expect(RecommendedBurnRateRulesApi.addMissing(SLO_ID)).rejects.toBe(
      refusal,
    );
  });

  test("reads an answer it cannot make sense of as nothing to add", async () => {
    mockPost.mockResolvedValue({ data: { data: [], count: 0 } });

    expect(await RecommendedBurnRateRulesApi.getMissing(SLO_ID)).toEqual([]);

    mockPost.mockResolvedValue({ data: [] });

    expect(await RecommendedBurnRateRulesApi.getMissing(SLO_ID)).toEqual([]);
  });
});
