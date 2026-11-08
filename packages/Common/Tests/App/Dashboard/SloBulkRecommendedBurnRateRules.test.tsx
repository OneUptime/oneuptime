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
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Add recommended rules" on the SLO list (Bulk Actions), rendered for real
 * through the shared action bar (BulkUpdateForm) against a stubbed API that
 * answers the bulk routes as the server does:
 *
 *   - the action sits in Bulk Actions in a run of its own, locked with the
 *     reason for someone who may not create, or read, SLO burn rate rules;
 *   - its confirmation asks the server first - in requests of at most the
 *     server's cap - and says how many of the selected SLOs get which
 *     rules, in which shape for which window, with the SLOs by name; how
 *     many already have every rule, and how many could not be read. Its Add
 *     waits for that, and stays unavailable with nothing to add or when the
 *     server could not say;
 *   - confirming sends only the SLOs the confirmation said are missing a
 *     rule, to the bulk add route, a batch at a time, and the result says
 *     what happened to every SLO - one SLO's refusal or failure, or a
 *     failed batch, never stops the others - and what was added, rule by
 *     rule; Stop is heard between batches, and sends nothing more;
 *   - run again on the same SLOs, there is nothing to add.
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

const mockPost: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return (error as { message?: string }).message || "Server Error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "22222222-2222-4222-8222-222222222222" };
      },
    },
  };
});

import useSloRecommendedRulesBulkAction, {
  SLO_BULK_RECOMMENDED_RULES_BATCH_SIZE,
  getSloRecommendedRulesOutcome,
  runSloRecommendedRulesBulkAdd,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloRecommendedRulesBulkAction";
import SloRecommendedRulesBatches from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloRecommendedRulesBatches";
import {
  SLO_ADD_RECOMMENDED_RULES_ACTION_TITLE,
  SLO_BULK_RECOMMENDED_RULES_ALREADY_THERE,
  SLO_BULK_RECOMMENDED_RULES_NO_ANSWER,
  SLO_BULK_RECOMMENDED_RULES_SERVER_REASON_KEYS,
  SLO_RECOMMENDED_RULES_MENU_GROUP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBulkRecommendedRulesCopy";
import {
  SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH,
  SLO_BULK_RECOMMENDED_BURN_RATE_RULES_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/RecommendedBurnRateRulesApi";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { JSONObject } from "../../../Types/JSON";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  BULK_ITEM_CHANGED,
  BulkActionRunResult,
  BulkItemStatus,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import {
  SLO_BULK_ADD_FAILED_MESSAGE,
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  SloBulkRecommendedRulesResult,
  SloBulkRecommendedRulesStatus,
  sloBulkRecommendedRulesResultToJSON,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";
import {
  SLO_RECOMMENDED_RULES_CREATE_REFUSAL_MESSAGE,
  SLO_RECOMMENDED_RULES_READ_REFUSAL_MESSAGE,
  SLO_RECOMMENDED_RULES_SLO_NOT_FOUND_MESSAGE as SLO_NOT_FOUND_MESSAGE,
  SLO_SLOW_LEAK_RULE_NAME,
  SloRecommendedBurnRateRule,
  SloRecommendedBurnRateRuleToAdd,
  getSloRecommendedBurnRateRules,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";

const BUTTON: string = "Add recommended rules";

/*
 * The project the stub serves: each SLO's window, the recommended rules it
 * has, whether the caller may read it, and how an add of it goes.
 */
interface StubSlo {
  id: string;
  name: string;
  windowDays: number;
  has: Array<string>;
  isReadable: boolean;
  // The add's answer for it, when it is not an ordinary add.
  addAnswer?: (() => SloBulkRecommendedRulesResult) | undefined;
}

let project: Map<string, StubSlo>;
// An add request that fails as a whole, by the ids it names.
let failAddRequest: ((ids: Array<string>) => Error | null) | null;
// An add request held until the test lets it go.
let holdAdds: boolean;
let heldAdds: Array<() => void>;
let failPreview: Error | null;

function idNumber(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function stubSlo(
  index: number,
  data: Partial<StubSlo> & { windowDays?: number },
): StubSlo {
  const slo: StubSlo = {
    id: idNumber(index),
    name: data.name || `SLO ${index + 1}`,
    windowDays: data.windowDays ?? 30,
    has: data.has ?? ["Fast burn", "Slow burn"],
    isReadable: data.isReadable ?? true,
    addAnswer: data.addAnswer,
  };

  project.set(slo.id, slo);

  return slo;
}

function rowOf(slo: StubSlo): ServiceLevelObjective {
  const row: ServiceLevelObjective = new ServiceLevelObjective();
  row._id = slo.id;
  row.name = slo.name;
  row.windowDays = slo.windowDays;
  return row;
}

function missingOf(slo: StubSlo): Array<SloRecommendedBurnRateRuleToAdd> {
  return getSloRecommendedBurnRateRules({ windowDays: slo.windowDays })
    .filter((rule: SloRecommendedBurnRateRule): boolean => {
      return !slo.has.includes(rule.name);
    })
    .map(
      (rule: SloRecommendedBurnRateRule): SloRecommendedBurnRateRuleToAdd => {
        return {
          ...rule,
          alertSeverityName:
            rule.name === SLO_SLOW_LEAK_RULE_NAME ? "Low" : "Critical",
        };
      },
    );
}

function previewOf(id: string): SloBulkRecommendedRulesResult {
  const slo: StubSlo | undefined = project.get(id);

  if (!slo || !slo.isReadable) {
    return {
      serviceLevelObjectiveId: id,
      status: SloBulkRecommendedRulesStatus.Refused,
      rules: [],
      message: SLO_NOT_FOUND_MESSAGE,
    };
  }

  const missing: Array<SloRecommendedBurnRateRuleToAdd> = missingOf(slo);

  return {
    serviceLevelObjectiveId: id,
    status:
      missing.length > 0
        ? SloBulkRecommendedRulesStatus.Missing
        : SloBulkRecommendedRulesStatus.NothingMissing,
    rules: missing,
    message: null,
  };
}

function addTo(id: string): SloBulkRecommendedRulesResult {
  const slo: StubSlo | undefined = project.get(id);

  if (slo?.addAnswer) {
    return slo.addAnswer();
  }

  const preview: SloBulkRecommendedRulesResult = previewOf(id);

  if (preview.status !== SloBulkRecommendedRulesStatus.Missing) {
    return preview;
  }

  slo!.has.push(
    ...preview.rules.map((rule: SloRecommendedBurnRateRuleToAdd): string => {
      return rule.name;
    }),
  );

  return {
    ...preview,
    status: SloBulkRecommendedRulesStatus.Added,
    rules: preview.rules.map(
      (
        rule: SloRecommendedBurnRateRuleToAdd,
      ): SloRecommendedBurnRateRuleToAdd => {
        return { ...rule, id: ObjectID.generate().toString() };
      },
    ),
  };
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

function idsOf(call: PostCall): Array<string> {
  return call.data["serviceLevelObjectiveIds"] as Array<string>;
}

function respond(results: Array<SloBulkRecommendedRulesResult>): unknown {
  return {
    data: { results: results.map(sloBulkRecommendedRulesResultToJSON) },
  };
}

beforeEach(() => {
  project = new Map();
  failAddRequest = null;
  holdAdds = false;
  heldAdds = [];
  failPreview = null;

  mockPost.mockReset();
  mockPost.mockImplementation((async (call: PostCall): Promise<unknown> => {
    const ids: Array<string> = idsOf(call);

    if (
      call.url.toString().endsWith(SLO_BULK_RECOMMENDED_BURN_RATE_RULES_PATH)
    ) {
      if (failPreview) {
        throw failPreview;
      }

      return respond(ids.map(previewOf));
    }

    if (
      call.url
        .toString()
        .endsWith(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)
    ) {
      if (holdAdds) {
        await new Promise<void>((resolve: () => void) => {
          heldAdds.push(resolve);
        });
      }

      const failure: Error | null = failAddRequest ? failAddRequest(ids) : null;

      if (failure) {
        throw failure;
      }

      return respond(ids.map(addTo));
    }

    throw new Error(`Unexpected request to ${call.url.toString()}`);
  }) as never);

  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const SloList: React.FunctionComponent<{
  rows: Array<ServiceLevelObjective>;
  batchSize?: number;
}> = (props: {
  rows: Array<ServiceLevelObjective>;
  batchSize?: number;
}): React.ReactElement => {
  const actions: Array<BulkActionButtonSchema<ServiceLevelObjective>> =
    useSloRecommendedRulesBulkAction({ batchSize: props.batchSize });

  return (
    <BulkUpdateForm<ServiceLevelObjective>
      selectedItems={props.rows}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Service Level Objective"
      pluralLabel="Service Level Objectives"
      itemToString={(item: ServiceLevelObjective): string => {
        return item.name || "";
      }}
      buttons={actions}
    />
  );
};

async function openConfirmation(
  rows: Array<ServiceLevelObjective>,
  batchSize?: number,
): Promise<HTMLElement> {
  render(<SloList rows={rows} batchSize={batchSize} />);

  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: BUTTON }));

  return await screen.findByRole("dialog", {
    name: `Add recommended rules to ${rows.length} ${rows.length === 1 ? "SLO" : "SLOs"}`,
  });
}

async function answered(dialog: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(
      within(dialog).queryByTestId("slo-bulk-recommended-rules-checking"),
    ).toBeNull();
  });
}

function submitOf(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId("modal-footer-submit-button");
}

async function confirmAndFinish(dialog: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(submitOf(dialog)).toBeEnabled();
  });

  fireEvent.click(submitOf(dialog));

  await screen.findByText("Completed");
}

describe("Add recommended rules in the SLO list's Bulk Actions", () => {
  function action(): BulkActionButtonSchema<ServiceLevelObjective> {
    const actions: Array<BulkActionButtonSchema<ServiceLevelObjective>> =
      renderHook(() => {
        return useSloRecommendedRulesBulkAction();
      }).result.current;

    expect(actions).toHaveLength(1);

    return actions[0]!;
  }

  test("is offered as the Burn Rate Rules page names it, with the note's light bulb, in a run of its own", () => {
    const offered: BulkActionButtonSchema<ServiceLevelObjective> = action();

    expect(offered.title).toBe(BUTTON);
    expect(SLO_ADD_RECOMMENDED_RULES_ACTION_TITLE).toBe(BUTTON);
    expect(offered.icon).toBe(IconProp.LightBulb);
    expect(offered.menuGroup).toBe(SLO_RECOMMENDED_RULES_MENU_GROUP);
    expect(offered.disabled).toBeFalsy();
    // Asked before it runs, always.
    expect(offered.confirmMessage).toBeDefined();
    expect(offered.confirmDetails).toBeDefined();
  });

  test("is locked, with the reason, for someone who may not create SLO burn rate rules", () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(((
      _model: unknown,
      modelAction: ModelAction,
    ) => {
      return modelAction === ModelAction.Create
        ? {
            isAllowed: false,
            disabledReason:
              "You do not have permission to create this SLO Burn Rate Rule.",
          }
        : { isAllowed: true };
    }) as never);

    const locked: BulkActionButtonSchema<ServiceLevelObjective> = action();

    expect(locked.disabled).toBe(true);
    expect(locked.tooltip).toBe(
      "You do not have permission to create this SLO Burn Rate Rule.",
    );
  });

  test("is locked, with the reason, for someone who may not read them: the confirmation could say nothing", () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(((
      _model: unknown,
      modelAction: ModelAction,
    ) => {
      return modelAction === ModelAction.Read
        ? {
            isAllowed: false,
            disabledReason:
              "You do not have permission to read this SLO Burn Rate Rule.",
          }
        : { isAllowed: true };
    }) as never);

    expect(action().tooltip).toBe(
      "You do not have permission to read this SLO Burn Rate Rule.",
    );
  });

  test("is left alone while the permissions are still unknown: the server refuses what it must", () => {
    jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false, disabledReason: undefined });

    expect(action().disabled).toBeFalsy();
  });

  test("locked, it opens nothing and asks nothing", () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason:
        "You do not have permission to create this SLO Burn Rate Rule.",
    });

    render(<SloList rows={[rowOf(stubSlo(0, {}))]} />);

    fireEvent.click(screen.getByText("Bulk Actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: BUTTON }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe("its confirmation", () => {
  test("is titled with how many SLOs are selected, says what it does, and waits for the server", async () => {
    let answer: (() => void) | null = null;

    mockPost.mockImplementationOnce((async (
      call: PostCall,
    ): Promise<unknown> => {
      await new Promise<void>((resolve: () => void) => {
        answer = resolve;
      });

      return respond(idsOf(call).map(previewOf));
    }) as never);

    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, {})),
      rowOf(stubSlo(1, {})),
    ]);

    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "Each SLO gets only the recommended burn rate rules it does not have yet, scaled to its compliance window. Edit or delete them afterwards like any other rule.",
    );
    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-checking"),
    ).toHaveTextContent(
      "Checking which recommended rules each SLO is missing…",
    );
    expect(submitOf(dialog)).toBeDisabled();
    expect(submitOf(dialog)).toHaveTextContent(BUTTON);

    await act(async () => {
      answer!();
    });

    await answered(dialog);

    expect(submitOf(dialog)).toBeEnabled();
  });

  test("asks about every selected SLO, in its project, without adding anything", async () => {
    const rows: Array<ServiceLevelObjective> = [
      rowOf(stubSlo(0, {})),
      rowOf(stubSlo(1, {})),
    ];

    const dialog: HTMLElement = await openConfirmation(rows);
    await answered(dialog);

    const asked: Array<PostCall> = postsTo(
      SLO_BULK_RECOMMENDED_BURN_RATE_RULES_PATH,
    );

    expect(asked).toHaveLength(1);
    expect(idsOf(asked[0]!)).toEqual([idNumber(0), idNumber(1)]);
    expect(asked[0]!.headers).toEqual({
      tenantid: "22222222-2222-4222-8222-222222222222",
    });
    expect(postsTo(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)).toEqual([]);
  });

  test("asks in requests of at most the server's cap, one after another", async () => {
    const rows: Array<ServiceLevelObjective> = [];

    for (let index: number = 0; index < 250; index++) {
      rows.push(rowOf(stubSlo(index, {})));
    }

    const dialog: HTMLElement = await openConfirmation(rows);
    await answered(dialog);

    expect(
      postsTo(SLO_BULK_RECOMMENDED_BURN_RATE_RULES_PATH).map(
        (call: PostCall): number => {
          return idsOf(call).length;
        },
      ),
    ).toEqual([
      SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
      SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
      50,
    ]);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-headline"),
    ).toHaveTextContent("250 SLOs get the recommended rules they are missing:");
  });

  test("counts how many SLOs get each rule, in each shape their windows give it, and names them", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Checkout", windowDays: 30 })),
      rowOf(stubSlo(1, { name: "Search", windowDays: 7 })),
      rowOf(stubSlo(2, { name: "Payments", windowDays: 30 })),
      // Every rule deleted: Fast burn and Slow burn too.
      rowOf(stubSlo(3, { name: "Billing", windowDays: 30, has: [] })),
    ]);
    await answered(dialog);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-headline"),
    ).toHaveTextContent("4 SLOs get the recommended rules they are missing:");

    const rules: Array<HTMLElement> = within(dialog).getAllByTestId(
      "slo-bulk-recommended-rules-rule",
    );

    // In the order they are recommended, each with how many SLOs get it.
    expect(
      rules.map((rule: HTMLElement): string => {
        return rule.firstElementChild?.textContent || "";
      }),
    ).toEqual(["Fast burn1 SLO", "Slow burn1 SLO", "Slow leak4 SLOs"]);

    const leakShapes: Array<HTMLElement> = within(rules[2]!).getAllByTestId(
      "slo-bulk-recommended-rules-variant",
    );

    expect(leakShapes).toHaveLength(2);

    // The 30-day shape first: three SLOs get it.
    expect(leakShapes[0]).toHaveTextContent(
      "1× · Fires when about 10% of the error budget burns in 3d",
    );
    expect(leakShapes[0]).toHaveTextContent("3 SLOs");
    expect(leakShapes[0]).toHaveTextContent("4320m / 360m");
    expect(leakShapes[0]).toHaveTextContent("Suppress 1440m after resolve");
    expect(leakShapes[0]).toHaveTextContent("Alert: Low");
    expect(
      within(leakShapes[0]!).getByTestId(
        "slo-bulk-recommended-rules-variant-slos",
      ),
    ).toHaveTextContent("Checkout, Payments and Billing");

    // A tenth of a 7-day window: 16.8 hours, still at 1x.
    expect(leakShapes[1]).toHaveTextContent(
      "1× · Fires when about 10% of the error budget burns in 16h 48m",
    );
    expect(leakShapes[1]).toHaveTextContent("1 SLO");
    expect(leakShapes[1]).toHaveTextContent("1008m / 84m");
    expect(leakShapes[1]).toHaveTextContent("Suppress 1008m after resolve");
    expect(
      within(leakShapes[1]!).getByTestId(
        "slo-bulk-recommended-rules-variant-slos",
      ),
    ).toHaveTextContent("Search");

    // A rule with one shape does not count it twice.
    const fastShapes: Array<HTMLElement> = within(rules[0]!).getAllByTestId(
      "slo-bulk-recommended-rules-variant",
    );

    expect(fastShapes).toHaveLength(1);
    expect(fastShapes[0]).toHaveTextContent(
      "14.4× · Fires when about 2% of the error budget burns in 1h",
    );
    expect(fastShapes[0]).toHaveTextContent("Alert: Critical");
    expect(fastShapes[0]).not.toHaveTextContent("1 SLO");
  });

  test("names the first few SLOs of a shape, and counts the rest", async () => {
    const rows: Array<ServiceLevelObjective> = [];

    for (let index: number = 0; index < 9; index++) {
      rows.push(rowOf(stubSlo(index, { name: `Service ${index + 1}` })));
    }

    const dialog: HTMLElement = await openConfirmation(rows);
    await answered(dialog);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-variant-slos"),
    ).toHaveTextContent("Service 1, Service 2, Service 3 and 6 more");
  });

  test("says how many already have every rule, and how many could not be read", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, {})),
      rowOf(stubSlo(1, { has: ["Fast burn", "Slow burn", "Slow leak"] })),
      rowOf(stubSlo(2, { has: ["Fast burn", "Slow burn", "Slow leak"] })),
      rowOf(stubSlo(3, { isReadable: false })),
    ]);
    await answered(dialog);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-headline"),
    ).toHaveTextContent("1 SLO gets the recommended rules it is missing:");
    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-complete"),
    ).toHaveTextContent(
      "2 SLOs already have every recommended rule and are left as they are.",
    );
    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-refused"),
    ).toHaveTextContent("1 SLO could not be read, so nothing is added to it.");
    expect(submitOf(dialog)).toBeEnabled();
  });

  test("with nothing to add, says so, and its Add stays unavailable", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { has: ["Fast burn", "Slow burn", "Slow leak"] })),
      rowOf(stubSlo(1, { isReadable: false })),
    ]);
    await answered(dialog);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-nothing"),
    ).toHaveTextContent("There is nothing to add.");
    expect(
      within(dialog).queryByTestId("slo-bulk-recommended-rules-headline"),
    ).toBeNull();
    expect(
      within(dialog).getByTestId("slo-bulk-recommended-rules-complete"),
    ).toHaveTextContent(
      "1 SLO already has every recommended rule and is left as it is.",
    );
    expect(submitOf(dialog)).toBeDisabled();

    fireEvent.click(submitOf(dialog));

    expect(postsTo(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)).toEqual([]);
  });

  test("when the server cannot say what is missing, says that and why, and adds nothing", async () => {
    failPreview = new Error(
      "Seeing which recommended burn rate rules an SLO is missing takes a role that can read SLO burn rate rules.",
    );

    const dialog: HTMLElement = await openConfirmation([rowOf(stubSlo(0, {}))]);
    await answered(dialog);

    const failed: HTMLElement = within(dialog).getByTestId(
      "slo-bulk-recommended-rules-check-failed",
    );

    expect(failed).toHaveTextContent(
      "Could not check which recommended rules these SLOs are missing, so nothing can be added yet.",
    );
    expect(failed).toHaveTextContent(
      "takes a role that can read SLO burn rate rules",
    );
    expect(submitOf(dialog)).toBeDisabled();
  });

  test("closing it adds nothing", async () => {
    const dialog: HTMLElement = await openConfirmation([rowOf(stubSlo(0, {}))]);
    await answered(dialog);

    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(postsTo(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)).toEqual([]);
  });
});

describe("confirming it", () => {
  test("adds through the bulk add route, a batch at a time, only to the SLOs the confirmation said are missing a rule", async () => {
    const rows: Array<ServiceLevelObjective> = [];

    for (let index: number = 0; index < 25; index++) {
      rows.push(rowOf(stubSlo(index, {})));
    }

    const complete: Array<string> = [25, 26, 27].map((index: number) => {
      return stubSlo(index, { has: ["Fast burn", "Slow burn", "Slow leak"] })
        .id;
    });
    const unreadable: string = stubSlo(28, { isReadable: false }).id;

    // Interleaved, as a selection is.
    rows.splice(3, 0, rowOf(project.get(complete[0]!)!));
    rows.splice(12, 0, rowOf(project.get(unreadable)!));
    rows.push(
      rowOf(project.get(complete[1]!)!),
      rowOf(project.get(complete[2]!)!),
    );

    const dialog: HTMLElement = await openConfirmation(rows);
    await confirmAndFinish(dialog);

    const adds: Array<PostCall> = postsTo(
      SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH,
    );

    expect(
      adds.map((call: PostCall): number => {
        return idsOf(call).length;
      }),
    ).toEqual([
      SLO_BULK_RECOMMENDED_RULES_BATCH_SIZE,
      SLO_BULK_RECOMMENDED_RULES_BATCH_SIZE,
      5,
    ]);

    const sent: Array<string> = adds.flatMap(idsOf);

    // Each SLO missing a rule once, in the order selected; none of the others.
    expect(sent).toEqual(
      Array.from({ length: 25 }, (_value: unknown, index: number): string => {
        return idNumber(index);
      }),
    );
    expect(adds[0]!.headers).toEqual({
      tenantid: "22222222-2222-4222-8222-222222222222",
    });

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "Rules added to 25 SLOs",
    );
    expect(screen.getByTestId("bulk-action-unchanged-count")).toHaveTextContent(
      "3 SLOs already had every recommended rule",
    );
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      SLO_BULK_RECOMMENDED_RULES_ALREADY_THERE,
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "Rules not added to 1 SLO",
    );
    expect(screen.getByTestId("bulk-action-failed-items")).toHaveTextContent(
      `SLO 29${SLO_NOT_FOUND_MESSAGE}`,
    );

    // And what was added, rule by rule.
    expect(
      screen.getByTestId("slo-bulk-recommended-rules-added"),
    ).toHaveTextContent("Slow leak: added to 25 SLOs");
  });

  test("says what happened to each SLO: one refused or failed never stops the others", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Checkout" })),
      rowOf(
        stubSlo(1, {
          name: "Search",
          // Its permission was taken away after the confirmation asked.
          addAnswer: (): SloBulkRecommendedRulesResult => {
            return {
              serviceLevelObjectiveId: idNumber(1),
              status: SloBulkRecommendedRulesStatus.Refused,
              rules: [],
              message:
                "You do not have permission to create SLO Burn Rate Rule.",
            };
          },
        }),
      ),
      rowOf(
        stubSlo(2, {
          name: "Billing",
          has: [],
          // Fast burn went in, then the database went away.
          addAnswer: (): SloBulkRecommendedRulesResult => {
            return {
              serviceLevelObjectiveId: idNumber(2),
              status: SloBulkRecommendedRulesStatus.Failed,
              rules: [
                {
                  ...getSloRecommendedBurnRateRules({ windowDays: 30 })[0]!,
                  alertSeverityName: "Critical",
                },
              ],
              message: SLO_BULK_ADD_FAILED_MESSAGE,
            };
          },
        }),
      ),
      rowOf(stubSlo(3, { name: "Payments" })),
    ]);
    await confirmAndFinish(dialog);

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "Rules added to 2 SLOs",
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "Rules not added to 2 SLOs",
    );

    const failures: HTMLElement = screen.getByTestId(
      "bulk-action-failed-items",
    );

    expect(failures).toHaveTextContent(
      "SearchYou do not have permission to create SLO Burn Rate Rule.",
    );
    expect(failures).toHaveTextContent(`Billing${SLO_BULK_ADD_FAILED_MESSAGE}`);

    // What a failed SLO added before it failed is counted as added.
    const added: HTMLElement = screen.getByTestId(
      "slo-bulk-recommended-rules-added",
    );

    expect(added).toHaveTextContent("Fast burn: added to 1 SLO");
    expect(added).toHaveTextContent("Slow leak: added to 2 SLOs");
  });

  test("a batch that fails as a whole fails only its own SLOs, in the server's words; the next batch still runs", async () => {
    const rows: Array<ServiceLevelObjective> = [];

    for (let index: number = 0; index < 4; index++) {
      rows.push(rowOf(stubSlo(index, {})));
    }

    failAddRequest = (ids: Array<string>): Error | null => {
      return ids.includes(idNumber(0))
        ? new Error(
            "Error connecting to server. Please try again in few minutes.",
          )
        : null;
    };

    const dialog: HTMLElement = await openConfirmation(rows, 2);
    await confirmAndFinish(dialog);

    expect(postsTo(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(
      2,
    );
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "Rules added to 2 SLOs",
    );
    expect(screen.getByTestId("bulk-action-failed-items")).toHaveTextContent(
      "SLO 1SLO 2Error connecting to server. Please try again in few minutes.",
    );
  });

  test("an SLO the server's answer leaves out is never called done", async () => {
    mockPost.mockImplementation((async (call: PostCall): Promise<unknown> => {
      const ids: Array<string> = idsOf(call);

      if (
        call.url
          .toString()
          .endsWith(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)
      ) {
        // Only the first is answered.
        return respond([addTo(ids[0]!)]);
      }

      return respond(ids.map(previewOf));
    }) as never);

    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, {})),
      rowOf(stubSlo(1, { name: "Search" })),
    ]);
    await confirmAndFinish(dialog);

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "Rules added to 1 SLO",
    );
    expect(screen.getByTestId("bulk-action-failed-items")).toHaveTextContent(
      `Search${SLO_BULK_RECOMMENDED_RULES_NO_ANSWER}`,
    );
  });

  test("Stop is heard between batches, and nothing more is sent", async () => {
    const rows: Array<ServiceLevelObjective> = [];

    for (let index: number = 0; index < 6; index++) {
      rows.push(rowOf(stubSlo(index, {})));
    }

    holdAdds = true;

    const dialog: HTMLElement = await openConfirmation(rows, 2);
    await waitFor(() => {
      expect(submitOf(dialog)).toBeEnabled();
    });

    fireEvent.click(submitOf(dialog));

    // The first batch is on its way: stop the run.
    await waitFor(() => {
      expect(heldAdds).toHaveLength(1);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

    await act(async () => {
      heldAdds.shift()!();
    });

    await screen.findByText("Stopped");

    expect(postsTo(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(
      1,
    );
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "Rules added to 2 SLOs",
    );
    expect(
      screen.getByTestId("bulk-action-not-started-count"),
    ).toHaveTextContent("4");
  });

  test("run again on the same SLOs, there is nothing to add", async () => {
    const rows: Array<ServiceLevelObjective> = [
      rowOf(stubSlo(0, {})),
      rowOf(stubSlo(1, { windowDays: 7 })),
    ];

    const dialog: HTMLElement = await openConfirmation(rows);
    await confirmAndFinish(dialog);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    cleanup();

    const again: HTMLElement = await openConfirmation(rows);
    await answered(again);

    expect(
      within(again).getByTestId("slo-bulk-recommended-rules-nothing"),
    ).toHaveTextContent("There is nothing to add.");
    expect(submitOf(again)).toBeDisabled();
    expect(postsTo(SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_PATH)).toHaveLength(
      1,
    );
  });
});

describe("what happened to one SLO, read from the server's answer", () => {
  function answerOf(
    status: SloBulkRecommendedRulesStatus,
    message: string | null = null,
  ): SloBulkRecommendedRulesResult {
    return {
      serviceLevelObjectiveId: idNumber(0),
      status: status,
      rules: [],
      message: message,
    };
  }

  test("added is done, nothing missing is left alone with why, refused and failed fail with the server's words", () => {
    expect(
      getSloRecommendedRulesOutcome(
        answerOf(SloBulkRecommendedRulesStatus.Added),
      ),
    ).toBe(BULK_ITEM_CHANGED);
    expect(
      getSloRecommendedRulesOutcome(
        answerOf(SloBulkRecommendedRulesStatus.NothingMissing),
      ),
    ).toEqual({
      status: BulkItemStatus.Unchanged,
      reason: SLO_BULK_RECOMMENDED_RULES_ALREADY_THERE,
    });
    expect(() => {
      return getSloRecommendedRulesOutcome(
        answerOf(SloBulkRecommendedRulesStatus.Refused, "Not allowed."),
      );
    }).toThrow("Not allowed.");
    expect(() => {
      return getSloRecommendedRulesOutcome(
        answerOf(SloBulkRecommendedRulesStatus.Failed, "Database down."),
      );
    }).toThrow("Database down.");
  });

  test("no answer, or one that only says what would be added, is never called done", () => {
    expect(() => {
      return getSloRecommendedRulesOutcome(undefined);
    }).toThrow(SLO_BULK_RECOMMENDED_RULES_NO_ANSWER);
    expect(() => {
      return getSloRecommendedRulesOutcome(
        answerOf(SloBulkRecommendedRulesStatus.Missing),
      );
    }).toThrow(SLO_BULK_RECOMMENDED_RULES_NO_ANSWER);
    expect(() => {
      return getSloRecommendedRulesOutcome(
        answerOf(SloBulkRecommendedRulesStatus.Failed),
      );
    }).toThrow(SLO_BULK_RECOMMENDED_RULES_NO_ANSWER);
  });

  test("the server's reasons are keys the Dashboard translates, in the server's own words", () => {
    expect(SLO_BULK_RECOMMENDED_RULES_SERVER_REASON_KEYS).toEqual([
      SLO_NOT_FOUND_MESSAGE,
      SLO_BULK_ADD_FAILED_MESSAGE,
      SLO_RECOMMENDED_RULES_CREATE_REFUSAL_MESSAGE,
      SLO_RECOMMENDED_RULES_READ_REFUSAL_MESSAGE,
    ]);
  });
});

describe("the run on its own", () => {
  interface Recorded {
    reports: Array<ProgressInfo<ServiceLevelObjective>>;
    props: BulkActionOnClickProps<ServiceLevelObjective>;
    stop: () => void;
  }

  function actionPropsFor(rows: Array<ServiceLevelObjective>): Recorded {
    const controller: AbortController = new AbortController();
    const reports: Array<ProgressInfo<ServiceLevelObjective>> = [];

    return {
      reports: reports,
      stop: (): void => {
        controller.abort();
      },
      props: {
        items: rows,
        stopSignal: controller.signal,
        onProgressInfo: (info: ProgressInfo<ServiceLevelObjective>): void => {
          reports.push(info);
        },
        onBulkActionStart: (): void => {},
        onBulkActionEnd: (): void => {},
      },
    };
  }

  test("with no word from the confirmation, sends every SLO, for the server to decide", async () => {
    const rows: Array<ServiceLevelObjective> = [0, 1, 2].map(
      (index: number): ServiceLevelObjective => {
        return rowOf(stubSlo(index, {}));
      },
    );
    const sent: Array<Array<string>> = [];
    const recorded: Recorded = actionPropsFor(rows);

    const result: BulkActionRunResult<ServiceLevelObjective> =
      await runSloRecommendedRulesBulkAdd({
        actionProps: recorded.props,
        preview: null,
        batchSize: 2,
        addMissingToMany: async (
          ids: Array<ObjectID>,
        ): Promise<Array<SloBulkRecommendedRulesResult>> => {
          const asked: Array<string> = ids.map((id: ObjectID): string => {
            return id.toString();
          });
          sent.push(asked);
          return asked.map(addTo);
        },
      });

    expect(sent).toEqual([[idNumber(0), idNumber(1)], [idNumber(2)]]);
    expect(result.changed).toHaveLength(3);
    expect(result.failed).toEqual([]);
  });

  test("is told every request's answer, for the result's last lines", async () => {
    const rows: Array<ServiceLevelObjective> = [0, 1].map(
      (index: number): ServiceLevelObjective => {
        return rowOf(stubSlo(index, {}));
      },
    );
    const told: Array<SloBulkRecommendedRulesResult> = [];

    await runSloRecommendedRulesBulkAdd({
      actionProps: actionPropsFor(rows).props,
      preview: null,
      batchSize: 1,
      addMissingToMany: async (
        ids: Array<ObjectID>,
      ): Promise<Array<SloBulkRecommendedRulesResult>> => {
        return ids.map((id: ObjectID): SloBulkRecommendedRulesResult => {
          return addTo(id.toString());
        });
      },
      onResults: (results: Array<SloBulkRecommendedRulesResult>): void => {
        told.push(...results);
      },
    });

    expect(
      told.map((result: SloBulkRecommendedRulesResult): Array<string> => {
        return [result.serviceLevelObjectiveId, result.status];
      }),
    ).toEqual([
      [idNumber(0), SloBulkRecommendedRulesStatus.Added],
      [idNumber(1), SloBulkRecommendedRulesStatus.Added],
    ]);
  });

  test("reports SLOs in the order they were selected, whatever order the batches answer in", async () => {
    const rows: Array<ServiceLevelObjective> = [0, 1, 2, 3].map(
      (index: number): ServiceLevelObjective => {
        return rowOf(stubSlo(index, {}));
      },
    );

    const result: BulkActionRunResult<ServiceLevelObjective> =
      await runSloRecommendedRulesBulkAdd({
        actionProps: actionPropsFor(rows).props,
        preview: null,
        batchSize: 4,
        addMissingToMany: async (
          ids: Array<ObjectID>,
        ): Promise<Array<SloBulkRecommendedRulesResult>> => {
          // The server answers in its own order.
          return [...ids].reverse().map((id: ObjectID) => {
            return addTo(id.toString());
          });
        },
      });

    expect(
      result.changed.map((row: ServiceLevelObjective): string => {
        return row._id!.toString();
      }),
    ).toEqual([idNumber(0), idNumber(1), idNumber(2), idNumber(3)]);
  });
});

describe("the batches a run sends", () => {
  test("hold the run's SLOs in order, at most a batch's size each", () => {
    const batches: SloRecommendedRulesBatches<string> =
      new SloRecommendedRulesBatches<string>({
        ids: ["a", "b", "c", "d", "e"],
        batchSize: 2,
        send: async (): Promise<Map<string, string>> => {
          return new Map();
        },
      });

    expect(batches.batchCount).toBe(3);
  });

  test("send a batch once every SLO of it has been asked for, and answer each of them", async () => {
    const sent: Array<Array<string>> = [];
    const batches: SloRecommendedRulesBatches<string> =
      new SloRecommendedRulesBatches<string>({
        ids: ["a", "b", "c"],
        batchSize: 2,
        send: async (ids: Array<string>): Promise<Map<string, string>> => {
          sent.push(ids);
          return new Map(
            ids.map((id: string): [string, string] => {
              return [id, `answer of ${id}`];
            }),
          );
        },
      });

    const a: Promise<string | undefined> = batches.run("a");

    await Promise.resolve();
    expect(sent).toEqual([]);

    const b: Promise<string | undefined> = batches.run("b");
    const c: Promise<string | undefined> = batches.run("c");

    expect(await a).toBe("answer of a");
    expect(await b).toBe("answer of b");
    expect(await c).toBe("answer of c");
    expect(sent).toEqual([["a", "b"], ["c"]]);
  });

  test("a request that fails fails every SLO of its batch, and only those", async () => {
    const batches: SloRecommendedRulesBatches<string> =
      new SloRecommendedRulesBatches<string>({
        ids: ["a", "b", "c"],
        batchSize: 2,
        send: async (ids: Array<string>): Promise<Map<string, string>> => {
          if (ids.includes("a")) {
            throw new Error("Server down.");
          }

          return new Map([["c", "answer of c"]]);
        },
      });

    const a: Promise<string | undefined> = batches.run("a");
    const b: Promise<string | undefined> = batches.run("b");
    const c: Promise<string | undefined> = batches.run("c");

    await expect(a).rejects.toThrow("Server down.");
    await expect(b).rejects.toThrow("Server down.");
    await expect(c).resolves.toBe("answer of c");
  });

  test("a send that throws at once fails its whole batch too", async () => {
    const batches: SloRecommendedRulesBatches<string> =
      new SloRecommendedRulesBatches<string>({
        ids: ["a", "b"],
        batchSize: 2,
        send: (): Promise<Map<string, string>> => {
          throw new Error("No network.");
        },
      });

    const a: Promise<string | undefined> = batches.run("a");
    const b: Promise<string | undefined> = batches.run("b");

    await expect(a).rejects.toThrow("No network.");
    await expect(b).rejects.toThrow("No network.");
  });

  test("on Stop, send what was asked for of a batch, and never the rest", async () => {
    const sent: Array<Array<string>> = [];
    const batches: SloRecommendedRulesBatches<string> =
      new SloRecommendedRulesBatches<string>({
        ids: ["a", "b", "c", "d"],
        batchSize: 3,
        send: async (ids: Array<string>): Promise<Map<string, string>> => {
          sent.push(ids);
          return new Map(
            ids.map((id: string): [string, string] => {
              return [id, id];
            }),
          );
        },
      });

    const a: Promise<string | undefined> = batches.run("a");

    batches.onStop();

    expect(await a).toBe("a");
    expect(sent).toEqual([["a"]]);

    // Nothing of a batch nobody asked for is sent.
    batches.onStop();
    await Promise.resolve();
    expect(sent).toEqual([["a"]]);
  });

  test("an SLO named twice is sent once, and both steps read its answer", async () => {
    const sent: Array<Array<string>> = [];
    const batches: SloRecommendedRulesBatches<string> =
      new SloRecommendedRulesBatches<string>({
        ids: ["a", "a", "b"],
        batchSize: 2,
        send: async (ids: Array<string>): Promise<Map<string, string>> => {
          sent.push(ids);
          return new Map(
            ids.map((id: string): [string, string] => {
              return [id, id];
            }),
          );
        },
      });

    const first: Promise<string | undefined> = batches.run("a");
    const second: Promise<string | undefined> = batches.run("a");
    const b: Promise<string | undefined> = batches.run("b");

    expect([await first, await second, await b]).toEqual(["a", "a", "b"]);
    expect(sent).toEqual([["a", "b"]]);
  });

  test("refuse an SLO that is not one of the run's", async () => {
    const batches: SloRecommendedRulesBatches<string> =
      new SloRecommendedRulesBatches<string>({
        ids: ["a"],
        batchSize: 2,
        send: async (): Promise<Map<string, string>> => {
          return new Map();
        },
      });

    await expect(batches.run("z")).rejects.toThrow(
      "z is not one of the SLOs this run adds to.",
    );
  });

  test("read a batch size that is not a whole number of at least one as one", () => {
    for (const batchSize of [0, -3, 0.4, Number.NaN]) {
      expect(
        new SloRecommendedRulesBatches<string>({
          ids: ["a", "b"],
          batchSize: batchSize,
          send: async (): Promise<Map<string, string>> => {
            return new Map();
          },
        }).batchCount,
      ).toBe(2);
    }
  });
});

describe("a refusal the bulk routes answer as a whole", () => {
  test("is read in the server's words, for every SLO of the batch", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      422,
      {
        message:
          "Adding the recommended burn rate rules takes a role that can create SLO burn rate rules.",
      } as JSONObject,
      {},
    );

    failAddRequest = (): Error => {
      return refusal as unknown as Error;
    };

    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, {})),
      rowOf(stubSlo(1, {})),
    ]);
    await confirmAndFinish(dialog);

    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "Rules not added to 2 SLOs",
    );
    expect(screen.getByTestId("bulk-action-failed-items")).toHaveTextContent(
      "takes a role that can create SLO burn rate rules",
    );
  });
});
