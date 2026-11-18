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
 * "Use the recommended policy" on the SLO list (Bulk Actions, #6358),
 * rendered for real through the shared action bar (BulkUpdateForm) against
 * a stubbed API that answers the bulk routes as the server does:
 *
 *   - the action sits in Bulk Actions beside Add recommended rules, named as
 *     the Error Budget Policy page's own button, locked with the reason for
 *     someone who may not create, or read, SLO error budget policy tiers;
 *   - its confirmation asks the server first and says how many of the
 *     selected SLOs get the recommended tiers they are missing, each tier
 *     once with how many get it and whether it freezes deployments; how
 *     many already have the recommended policy, have a policy of their own,
 *     or could not be read. Its button waits for that, and stays
 *     unavailable with nothing to add or when the server could not say;
 *   - confirming sends only the SLOs the confirmation said get tiers, to the
 *     bulk add route, and the result says what happened to every SLO, and
 *     what was added, tier by tier;
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

import useSloRecommendedPolicyBulkAction, {
  getSloRecommendedPolicyOutcome,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloRecommendedPolicyBulkAction";
import {
  SLO_BULK_RECOMMENDED_POLICY_ALREADY_THERE,
  SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER,
  SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY_REASON,
  SLO_BULK_RECOMMENDED_POLICY_SERVER_REASON_KEYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBulkRecommendedPolicyCopy";
import { SLO_RECOMMENDED_RULES_MENU_GROUP } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBulkRecommendedRulesCopy";
import { USE_RECOMMENDED_POLICY_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloRecommendedPolicyTiersModal";
import {
  SLO_BULK_ADD_RECOMMENDED_POLICY_PATH,
  SLO_BULK_RECOMMENDED_POLICY_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/RecommendedPolicyTiersApi";
import {
  SLO_RECOMMENDED_POLICY_CREATE_REFUSAL_MESSAGE,
  SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE,
} from "../../../Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI";
import { SLO_NOT_FOUND_MESSAGE } from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { JSONObject } from "../../../Types/JSON";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import {
  BULK_ITEM_CHANGED,
  BulkItemStatus,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import BulkUpdateForm, {
  BulkActionButtonSchema,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import {
  SLO_BULK_POLICY_ADD_FAILED_MESSAGE,
  SloBulkRecommendedPolicyResult,
  SloBulkRecommendedPolicyStatus,
  sloBulkRecommendedPolicyResultToJSON,
} from "../../../Utils/Slo/SloBulkRecommendedPolicy";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  SloExistingPolicyTier,
  SloRecommendedPolicyStanding,
  SloRecommendedPolicyState,
  SloRecommendedPolicyTier,
  getSloRecommendedPolicyStanding,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";

const BUTTON: string = "Use the recommended policy";

// The project the stub serves: each SLO's tiers, and whether the caller may read it.
interface StubSlo {
  id: string;
  name: string;
  tiers: Array<SloExistingPolicyTier>;
  isReadable: boolean;
}

let project: Map<string, StubSlo>;
let failPreview: Error | null;

function idNumber(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function stubSlo(
  index: number,
  data: {
    name: string;
    tiers?: Array<SloExistingPolicyTier>;
    isReadable?: boolean;
  },
): StubSlo {
  const slo: StubSlo = {
    id: idNumber(index),
    name: data.name,
    tiers: data.tiers ?? [],
    isReadable: data.isReadable ?? true,
  };

  project.set(slo.id, slo);

  return slo;
}

function rowOf(slo: StubSlo): ServiceLevelObjective {
  const row: ServiceLevelObjective = new ServiceLevelObjective();
  row._id = slo.id;
  row.name = slo.name;
  return row;
}

const HALF_POLICY: Array<SloExistingPolicyTier> = [
  { name: "Caution", thresholdPercentage: 50 },
  { name: "Reliability first", thresholdPercentage: 25 },
];

const WHOLE_POLICY: Array<SloExistingPolicyTier> =
  SLO_RECOMMENDED_POLICY_TIERS.map(
    (tier: SloRecommendedPolicyTier): SloExistingPolicyTier => {
      return { name: tier.name, thresholdPercentage: tier.thresholdPercentage };
    },
  );

const OWN_POLICY: Array<SloExistingPolicyTier> = [
  { name: "Yellow", thresholdPercentage: 40 },
  { name: "Red", thresholdPercentage: 10 },
];

// What the server's bulk preview says of an SLO, by the page's own rule.
function previewOf(id: string): SloBulkRecommendedPolicyResult {
  const slo: StubSlo | undefined = project.get(id);

  if (!slo || !slo.isReadable) {
    return {
      serviceLevelObjectiveId: id,
      status: SloBulkRecommendedPolicyStatus.Refused,
      tiers: [],
      message: SLO_NOT_FOUND_MESSAGE,
    };
  }

  const standing: SloRecommendedPolicyStanding =
    getSloRecommendedPolicyStanding({ existingTiers: slo.tiers });

  if (standing.state === SloRecommendedPolicyState.OwnPolicy) {
    return {
      serviceLevelObjectiveId: id,
      status: SloBulkRecommendedPolicyStatus.OwnPolicy,
      tiers: [],
      message: null,
    };
  }

  return {
    serviceLevelObjectiveId: id,
    status:
      standing.missingTiers.length > 0
        ? SloBulkRecommendedPolicyStatus.Missing
        : SloBulkRecommendedPolicyStatus.NothingMissing,
    tiers: standing.missingTiers,
    message: null,
  };
}

function addTo(id: string): SloBulkRecommendedPolicyResult {
  const preview: SloBulkRecommendedPolicyResult = previewOf(id);

  if (preview.status !== SloBulkRecommendedPolicyStatus.Missing) {
    return preview;
  }

  project.get(id)!.tiers.push(...preview.tiers);

  return {
    ...preview,
    status: SloBulkRecommendedPolicyStatus.Added,
    tiers: preview.tiers.map((tier: SloRecommendedPolicyTier) => {
      return { ...tier, id: ObjectID.generate().toString() };
    }),
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

function respond(results: Array<SloBulkRecommendedPolicyResult>): unknown {
  return {
    data: { results: results.map(sloBulkRecommendedPolicyResultToJSON) },
  };
}

beforeEach(() => {
  project = new Map();
  failPreview = null;

  mockPost.mockReset();
  mockPost.mockImplementation((async (call: PostCall): Promise<unknown> => {
    const ids: Array<string> = idsOf(call);

    if (call.url.toString().endsWith(SLO_BULK_RECOMMENDED_POLICY_PATH)) {
      if (failPreview) {
        throw failPreview;
      }

      return respond(ids.map(previewOf));
    }

    if (call.url.toString().endsWith(SLO_BULK_ADD_RECOMMENDED_POLICY_PATH)) {
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
}> = (props: { rows: Array<ServiceLevelObjective> }): React.ReactElement => {
  const actions: Array<BulkActionButtonSchema<ServiceLevelObjective>> =
    useSloRecommendedPolicyBulkAction();

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
): Promise<HTMLElement> {
  render(<SloList rows={rows} />);

  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: BUTTON }));

  return await screen.findByRole("dialog", {
    name: `Use the recommended policy on ${rows.length} ${rows.length === 1 ? "SLO" : "SLOs"}`,
  });
}

async function answered(dialog: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(
      within(dialog).queryByTestId("slo-bulk-recommended-policy-checking"),
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

describe("Use the recommended policy in the SLO list's Bulk Actions", () => {
  function action(): BulkActionButtonSchema<ServiceLevelObjective> {
    const actions: Array<BulkActionButtonSchema<ServiceLevelObjective>> =
      renderHook(() => {
        return useSloRecommendedPolicyBulkAction();
      }).result.current;

    expect(actions).toHaveLength(1);

    return actions[0]!;
  }

  test("is offered as the Error Budget Policy page names it, beside Add recommended rules", () => {
    const offered: BulkActionButtonSchema<ServiceLevelObjective> = action();

    expect(offered.title).toBe(BUTTON);
    expect(USE_RECOMMENDED_POLICY_TITLE).toBe(BUTTON);
    expect(offered.icon).toBe(IconProp.Scale);
    expect(offered.menuGroup).toBe(SLO_RECOMMENDED_RULES_MENU_GROUP);
    expect(offered.disabled).toBeFalsy();
    expect(offered.confirmMessage).toBeDefined();
    expect(offered.confirmDetails).toBeDefined();
  });

  test.each([ModelAction.Create, ModelAction.Read])(
    "is locked, with the reason, for someone who may not %s SLO error budget policy tiers",
    (missingAction: ModelAction) => {
      jest.spyOn(PermissionGate, "check").mockImplementation(((
        _model: unknown,
        modelAction: ModelAction,
      ) => {
        return modelAction === missingAction
          ? { isAllowed: false, disabledReason: "Not allowed." }
          : { isAllowed: true };
      }) as never);

      const locked: BulkActionButtonSchema<ServiceLevelObjective> = action();

      expect(locked.disabled).toBe(true);
      expect(locked.tooltip).toBe("Not allowed.");
    },
  );
});

describe("its confirmation", () => {
  test("says what it does, asks the server once about every selected SLO, and adds nothing yet", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Checkout" })),
      rowOf(stubSlo(1, { name: "Search", tiers: [...HALF_POLICY] })),
    ]);

    expect(dialog).toHaveTextContent(
      "An SLO with no error budget policy gets the recommended one, and an SLO with part of it gets the tiers it is missing. An SLO with a policy of its own is left as it is.",
    );

    await answered(dialog);

    const asked: Array<PostCall> = postsTo(SLO_BULK_RECOMMENDED_POLICY_PATH);

    expect(asked).toHaveLength(1);
    expect(idsOf(asked[0]!)).toEqual([idNumber(0), idNumber(1)]);
    expect(postsTo(SLO_BULK_ADD_RECOMMENDED_POLICY_PATH)).toHaveLength(0);
  });

  test("lists each recommended tier once, with how many SLOs get it, marking the one that freezes deployments", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Checkout" })),
      rowOf(stubSlo(1, { name: "Search", tiers: [...HALF_POLICY] })),
      rowOf(stubSlo(2, { name: "Billing", tiers: [...HALF_POLICY] })),
    ]);

    await answered(dialog);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-policy-headline"),
    ).toHaveTextContent("3 SLOs get the recommended tiers they are missing:");

    const tiers: Array<HTMLElement> = within(dialog).getAllByTestId(
      "slo-bulk-recommended-policy-tier",
    );

    expect(
      tiers.map((tier: HTMLElement): string => {
        return tier.textContent || "";
      }),
    ).toEqual([
      expect.stringMatching(/^Caution1 SLOBudget left ≤ 50%$/),
      expect.stringMatching(/^Reliability first1 SLOBudget left ≤ 25%$/),
      expect.stringMatching(
        /^Budget exhausted3 SLOsBudget left ≤ 0%Freezes deployments$/,
      ),
    ]);
    expect(
      within(dialog).getAllByTestId("slo-bulk-recommended-policy-tier-freezes"),
    ).toHaveLength(1);
    expect(
      within(dialog).getByTestId("slo-bulk-recommended-policy-freeze-note"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(submitOf(dialog)).toBeEnabled();
    });
  });

  test("says how many already have the recommended policy, have one of their own, or could not be read", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Checkout" })),
      rowOf(stubSlo(1, { name: "Search", tiers: [...WHOLE_POLICY] })),
      rowOf(stubSlo(2, { name: "Billing", tiers: [...OWN_POLICY] })),
      rowOf(stubSlo(3, { name: "Payments", tiers: [...OWN_POLICY] })),
      rowOf(stubSlo(4, { name: "Hidden", isReadable: false })),
    ]);

    await answered(dialog);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-policy-complete"),
    ).toHaveTextContent(
      "1 SLO already has the recommended policy and is left as it is.",
    );
    expect(
      within(dialog).getByTestId("slo-bulk-recommended-policy-own-policy"),
    ).toHaveTextContent(
      "2 SLOs have an error budget policy of their own and are left as they are.",
    );
    expect(
      within(dialog).getByTestId("slo-bulk-recommended-policy-refused"),
    ).toHaveTextContent("1 SLO could not be read, so nothing is added to it.");
  });

  test("with nothing to add, says so, and its button stays unavailable", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Search", tiers: [...WHOLE_POLICY] })),
      rowOf(stubSlo(1, { name: "Billing", tiers: [...OWN_POLICY] })),
    ]);

    await answered(dialog);

    expect(
      within(dialog).getByTestId("slo-bulk-recommended-policy-nothing"),
    ).toHaveTextContent("There is nothing to add.");
    expect(submitOf(dialog)).toBeDisabled();
  });

  test("when the server cannot say, says so and why, and adds nothing", async () => {
    failPreview = new Error(SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE);

    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Checkout" })),
    ]);

    const failed: HTMLElement = await within(dialog).findByTestId(
      "slo-bulk-recommended-policy-check-failed",
    );

    expect(failed).toHaveTextContent(
      "Could not check which of these SLOs have an error budget policy, so nothing can be added yet.",
    );
    expect(failed).toHaveTextContent(
      SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE,
    );
    expect(submitOf(dialog)).toBeDisabled();
  });
});

describe("confirming it", () => {
  test("sends only the SLOs that get tiers, and says what happened to each and what was added", async () => {
    const dialog: HTMLElement = await openConfirmation([
      rowOf(stubSlo(0, { name: "Checkout" })),
      rowOf(stubSlo(1, { name: "Search", tiers: [...HALF_POLICY] })),
      rowOf(stubSlo(2, { name: "Payments", tiers: [...WHOLE_POLICY] })),
      rowOf(stubSlo(3, { name: "Billing", tiers: [...OWN_POLICY] })),
      rowOf(stubSlo(4, { name: "Hidden", isReadable: false })),
    ]);

    await confirmAndFinish(dialog);

    const adds: Array<PostCall> = postsTo(SLO_BULK_ADD_RECOMMENDED_POLICY_PATH);

    // The two that get tiers; the others are reported as the confirmation said.
    expect(adds.flatMap(idsOf)).toEqual([idNumber(0), idNumber(1)]);

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "Tiers added to 2 SLOs",
    );
    expect(screen.getByTestId("bulk-action-unchanged-count")).toHaveTextContent(
      "2 SLOs left as they were",
    );
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      SLO_BULK_RECOMMENDED_POLICY_ALREADY_THERE,
    );
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY_REASON,
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "Tiers not added to 1 SLO",
    );
    expect(screen.getByTestId("bulk-action-failed-items")).toHaveTextContent(
      `Hidden${SLO_NOT_FOUND_MESSAGE}`,
    );

    const added: HTMLElement = screen.getByTestId(
      "slo-bulk-recommended-policy-added",
    );

    expect(added).toHaveTextContent("Caution: added to 1 SLO");
    expect(added).toHaveTextContent("Reliability first: added to 1 SLO");
    expect(added).toHaveTextContent("Budget exhausted: added to 2 SLOs");
  });

  test("run again on the same SLOs, there is nothing to add", async () => {
    const rows: Array<ServiceLevelObjective> = [
      rowOf(stubSlo(0, { name: "Checkout" })),
      rowOf(stubSlo(1, { name: "Search", tiers: [...HALF_POLICY] })),
    ];

    const dialog: HTMLElement = await openConfirmation(rows);
    await confirmAndFinish(dialog);
    cleanup();

    const again: HTMLElement = await openConfirmation(rows);
    await answered(again);

    expect(
      within(again).getByTestId("slo-bulk-recommended-policy-nothing"),
    ).toHaveTextContent("There is nothing to add.");
    expect(
      within(again).getByTestId("slo-bulk-recommended-policy-complete"),
    ).toHaveTextContent(
      "2 SLOs already have the recommended policy and are left as they are.",
    );
    expect(submitOf(again)).toBeDisabled();
  });
});

describe("what happened to one SLO", () => {
  function answer(
    status: SloBulkRecommendedPolicyStatus,
    message: string | null = null,
  ): SloBulkRecommendedPolicyResult {
    return {
      serviceLevelObjectiveId: idNumber(0),
      status: status,
      tiers: [],
      message: message,
    };
  }

  test("added is done, nothing missing and its own policy are left alone with why, refused and failed fail with the server's words", () => {
    expect(
      getSloRecommendedPolicyOutcome(
        answer(SloBulkRecommendedPolicyStatus.Added),
      ),
    ).toBe(BULK_ITEM_CHANGED);

    expect(
      getSloRecommendedPolicyOutcome(
        answer(SloBulkRecommendedPolicyStatus.NothingMissing),
      ),
    ).toEqual({
      status: BulkItemStatus.Unchanged,
      reason: SLO_BULK_RECOMMENDED_POLICY_ALREADY_THERE,
    });

    expect(
      getSloRecommendedPolicyOutcome(
        answer(SloBulkRecommendedPolicyStatus.OwnPolicy),
      ),
    ).toEqual({
      status: BulkItemStatus.Unchanged,
      reason: SLO_BULK_RECOMMENDED_POLICY_OWN_POLICY_REASON,
    });

    expect(() => {
      getSloRecommendedPolicyOutcome(
        answer(SloBulkRecommendedPolicyStatus.Refused, SLO_NOT_FOUND_MESSAGE),
      );
    }).toThrow(SLO_NOT_FOUND_MESSAGE);

    expect(() => {
      getSloRecommendedPolicyOutcome(
        answer(
          SloBulkRecommendedPolicyStatus.Failed,
          SLO_BULK_POLICY_ADD_FAILED_MESSAGE,
        ),
      );
    }).toThrow(SLO_BULK_POLICY_ADD_FAILED_MESSAGE);
  });

  test("no answer, or one that only says what would be added, is never called done", () => {
    expect(() => {
      getSloRecommendedPolicyOutcome(undefined);
    }).toThrow(SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER);

    expect(() => {
      getSloRecommendedPolicyOutcome(
        answer(SloBulkRecommendedPolicyStatus.Missing),
      );
    }).toThrow(SLO_BULK_RECOMMENDED_POLICY_NO_ANSWER);
  });

  test("the server's reasons are keys the Dashboard translates, in the server's own words", () => {
    expect(SLO_BULK_RECOMMENDED_POLICY_SERVER_REASON_KEYS).toEqual([
      SLO_NOT_FOUND_MESSAGE,
      SLO_BULK_POLICY_ADD_FAILED_MESSAGE,
      SLO_RECOMMENDED_POLICY_CREATE_REFUSAL_MESSAGE,
      SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE,
    ]);
  });
});
