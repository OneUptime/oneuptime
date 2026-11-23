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
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import {
  APPLY_TO_SIMILAR_TEST_ID,
  ApplyToSimilarModal,
  FindingDecisions,
  useFindingDecisions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingDecisions";
import {
  FINDING_AI_REASON_TEST_ID,
  FINDING_AI_SUGGESTION_TEST_ID,
  FINDING_CONFIRMED_BY_AI_TEST_ID,
  FINDING_PRECEDENT_TEST_ID,
  FINDING_VERDICT_TEST_ID,
  getFindingRowNote,
  getShownVerdict,
  summarizePrecedent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingRowNote";
import { getDataSecurityAiProposalRoute } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/AI";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import Route from "../../../Types/API/Route";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { DataSecurityAiProposalKind } from "../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityApplyToSimilarResult,
  DataSecuritySimilarFinding,
  DataSecuritySimilarFindings,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DataStoreFindingDecision,
  DataStoreFindingPrecedent,
  DataStoreFindingVerdict,
  FindingWrongMatchSign,
} from "../../../Types/DataSecurity/DataStoreFindingVerdict";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import Toast from "../../../UI/Utils/Toast";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import type { SpyInstance } from "jest-mock";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * ONEUPTIME AI'S VERDICT ACROSS A FINDING'S ROW, AND ONE DECISION FOR EVERY
 * FINDING LIKE IT (#10372, #6105).
 *
 * What's Inside and In Your Telemetry draw, under a finding's cells, what
 * OneUptime AI says of it: a suggestion's reason, its verdict on a finding
 * that waits for a person - Confirm it, Not sensitive or Cannot tell - with
 * why and the team's decisions it rests on, one glance away, and that it
 * confirmed one on its own. A decided finding's verdict says nothing more.
 * After a decision, Apply to Similar Findings lists the findings like it,
 * each ticked, and applies the decision to the ticked ones only; Mark as
 * Not Sensitive starts from OneUptime AI's draft.
 */

const FINDING_ID: string = "10372000-0000-4000-8000-0000000000f1";
const STORE_A: string = "10372000-0000-4000-8000-0000000000a1";
const STORE_B: string = "10372000-0000-4000-8000-0000000000a2";
const STORE_C: string = "10372000-0000-4000-8000-0000000000a3";
const STORE_D: string = "10372000-0000-4000-8000-0000000000a4";
const UNREADABLE_STORE: string = "10372000-0000-4000-8000-0000000000a9";

const REASON: string =
  "Your team marked order_number not sensitive on four stores: Shopify order numbers that pass the Luhn check.";
const DRAFT: string = "Shopify order numbers, as on the other stores.";

function precedent(
  index: number,
  data: Partial<DataStoreFindingPrecedent> = {},
): DataStoreFindingPrecedent {
  return {
    findingId: `10372000-0000-4000-8000-0000000001${index}0`,
    dataStoreId: [STORE_A, STORE_B, STORE_C, STORE_D][index % 4]!,
    location: "public.orders.order_number",
    decision: DataStoreFindingDecision.NotSensitive,
    reason: "Shopify order numbers.",
    isSameName: true,
    ...data,
  };
}

function waitingFinding(
  record: JSONObject | null,
  data: Partial<DataStoreFinding> = {},
): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding(
    new ObjectID(FINDING_ID),
  );

  finding.dataTypeId = "credit-card-number";
  finding.location = "public.orders.order_number";
  finding.locationKind = "Column";
  finding.confidence = DataConfidence.Low;
  finding.matchCount = 40;
  finding.isSuppressed = false;
  finding.isConfirmed = false;
  finding.isAiSuggested = false;

  if (record) {
    finding.aiVerdict = record["verdict"] as string;
    finding.aiVerdictAnalysis = record;
  }

  Object.assign(finding, data);

  return finding;
}

function verdictRecord(data: JSONObject = {}): JSONObject {
  return {
    version: 1,
    verdict: DataStoreFindingVerdict.NotSensitive,
    reason: REASON,
    draft: DRAFT,
    precedent: [0, 1, 2, 3].map((index: number): JSONObject => {
      return precedent(index) as unknown as JSONObject;
    }),
    signs: [FindingWrongMatchSign.IdFieldWithLuhnNumbers],
    language: "en",
    writtenAt: new Date().toISOString(),
    ...data,
  };
}

function storeNamed(id: string, name: string): DataStore {
  const store: DataStore = new DataStore(new ObjectID(id));

  store.name = name;

  return store;
}

function renderNote(finding: DataStoreFinding): HTMLElement {
  const note: ReactElement | null = getFindingRowNote(finding);

  expect(note).not.toBeNull();

  const { container } = render(<MemoryRouter>{note}</MemoryRouter>);

  return container;
}

let storeReads: SpyInstance<typeof ModelAPI.getList>;

beforeEach(() => {
  // The stores a reader may read: all but one.
  storeReads = jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return {
      data: [
        storeNamed(STORE_A, "orders-eu"),
        storeNamed(STORE_B, "orders-us"),
        storeNamed(STORE_C, "billing-replica"),
      ],
      count: 3,
      skip: 0,
      limit: 10,
    } as unknown as ListResult<DataStore>;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("OneUptime AI's verdict, across a finding's row", () => {
  test("a Low finding the team dismissed on four stores reads Not sensitive, why, and whose decisions it rests on", () => {
    renderNote(waitingFinding(verdictRecord()));

    const verdict: HTMLElement = screen.getByTestId(FINDING_VERDICT_TEST_ID);

    expect(within(verdict).getByText("OneUptime AI")).toBeInTheDocument();
    expect(within(verdict).getByText("Not sensitive")).toBeInTheDocument();
    expect(withoutIsolateMarks(verdict.textContent || "")).toContain(REASON);

    const cited: HTMLElement = screen.getByTestId(FINDING_PRECEDENT_TEST_ID);

    expect(withoutIsolateMarks(cited.textContent || "")).toContain(
      "Your team marked order_number not sensitive on 4 stores.",
    );
    // The field reads as code, as on the row above.
    expect(within(cited).getByText("order_number").tagName).toBe("CODE");
    // The sign it was judged with.
    expect(
      within(verdict).getByText(
        "An id field holding numbers that pass the Luhn check",
      ),
    ).toBeInTheDocument();
  });

  test("Show the decisions lists each one: its store, as the reader may read it, its place and its reason", async () => {
    const record: JSONObject = verdictRecord({
      precedent: [
        precedent(0, { reason: "Shopify order numbers." }),
        precedent(1, {
          dataStoreId: UNREADABLE_STORE,
          reason: "Order references from the old shop.",
        }),
      ] as unknown as JSONObject,
    });

    renderNote(waitingFinding(record));

    expect(storeReads).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show the decisions" }));

    expect(await screen.findByText("orders-eu")).toBeInTheDocument();
    // A store the reader may not read is not named.
    expect(screen.getByText("Another store")).toBeInTheDocument();
    expect(screen.getByText("Order references from the old shop.")).toBeInTheDocument();
    expect(screen.getAllByText("Marked not sensitive")).toHaveLength(2);
    expect(screen.getAllByText("Same field name")).toHaveLength(2);
    expect(storeReads).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Hide the decisions" }));

    expect(screen.queryByText("orders-eu")).toBeNull();
  });

  test("decisions both ways read as two lines, and a name like it is not called the same name", () => {
    const record: JSONObject = verdictRecord({
      verdict: DataStoreFindingVerdict.CannotTell,
      draft: "",
      signs: [],
      precedent: [
        precedent(0),
        precedent(1, { location: "sales.orders.order_ref", isSameName: false }),
        precedent(2, { decision: DataStoreFindingDecision.Confirmed }),
      ] as unknown as JSONObject,
    });

    renderNote(waitingFinding(record));

    const cited: string = withoutIsolateMarks(
      screen.getByTestId(FINDING_PRECEDENT_TEST_ID).textContent || "",
    );

    expect(screen.getByText("Cannot tell")).toBeInTheDocument();
    expect(cited).toContain(
      "Your team marked fields like it not sensitive on 2 stores.",
    );
    expect(cited).toContain("Your team confirmed order_number on 1 store.");
  });

  test("the summary counts stores, not decisions", () => {
    expect(
      summarizePrecedent([
        precedent(0),
        precedent(4, { findingId: "10372000-0000-4000-8000-000000000199" }),
        precedent(1),
      ]),
    ).toEqual([
      {
        decision: DataStoreFindingDecision.NotSensitive,
        stores: 2,
        field: "order_number",
      },
    ]);
  });

  test("a finding a person decided since shows no verdict: their decision is the finding's", () => {
    for (const decided of [
      { isSuppressed: true },
      { isConfirmed: true },
    ] as Array<Partial<DataStoreFinding>>) {
      const finding: DataStoreFinding = waitingFinding(verdictRecord(), decided);

      expect(getShownVerdict(finding)).toBeNull();
      expect(getFindingRowNote(finding)).toBeNull();
    }
  });

  test("a verdict the finding's column no longer agrees with is not shown", () => {
    const finding: DataStoreFinding = waitingFinding(verdictRecord(), {
      aiVerdict: DataStoreFindingVerdict.Confirm,
    });

    expect(getShownVerdict(finding)).toBeNull();
  });

  test("a finding with nothing to say draws no line", () => {
    expect(getFindingRowNote(waitingFinding(null))).toBeNull();
  });
});

describe("OneUptime AI's suggestion and its own confirmation, across the row", () => {
  test("a suggestion's reason reads across the row, not in a narrow column (#6105, item 7)", () => {
    renderNote(
      waitingFinding(null, {
        dataTypeId: "customer-number",
        location: "public.customers.kundennr",
        isAiSuggested: true,
        aiReason:
          "Ein Feld namens kundennr neben name und email, mit Werten wie AA-999999: eine Kundennummer.",
      }),
    );

    const suggestion: HTMLElement = screen.getByTestId(
      FINDING_AI_SUGGESTION_TEST_ID,
    );

    expect(
      within(suggestion).getByText("Suggested by OneUptime AI"),
    ).toBeInTheDocument();
    // In the language OneUptime AI wrote it, as written.
    expect(
      withoutIsolateMarks(
        screen.getByTestId(FINDING_AI_REASON_TEST_ID).textContent || "",
      ),
    ).toBe(
      "Ein Feld namens kundennr neben name und email, mit Werten wie AA-999999: eine Kundennummer.",
    );
  });

  test("a finding OneUptime AI confirmed on its own says so, with where to undo it", () => {
    renderNote(
      waitingFinding(null, {
        confidence: DataConfidence.High,
        isConfirmed: true,
        isConfirmedByAi: true,
      }),
    );

    const line: HTMLElement = screen.getByTestId(
      FINDING_CONFIRMED_BY_AI_TEST_ID,
    );

    expect(line).toHaveTextContent(
      "Confirmed by OneUptime AI on its own, as one of your AI rules allows.",
    );
    expect(
      within(line).getByRole("link", { name: "Undo it in Data Security > AI" }),
    ).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_SECURITY_AI] as Route,
      ).toString(),
    );
  });

  test("a finding a person confirmed says nothing of OneUptime AI", () => {
    expect(
      getFindingRowNote(
        waitingFinding(null, { isConfirmed: true, isConfirmedByAi: false }),
      ),
    ).toBeNull();
  });
});

function similarFinding(
  index: number,
  data: Partial<DataSecuritySimilarFinding> = {},
): DataSecuritySimilarFinding {
  return {
    findingId: `10372000-0000-4000-8000-0000000002${index}0`,
    dataStoreId: [STORE_A, STORE_B, STORE_C][index % 3]!,
    storeName: ["orders-eu", "orders-us", "billing-replica"][index % 3]!,
    storeKind: "PostgreSQL",
    location: "public.orders.order_number",
    locationKind: "Column",
    dataTypeId: "credit-card-number",
    dataTypeName: "Card number",
    confidence: "Low",
    aiVerdict: "",
    isSameStore: false,
    ...data,
  };
}

function similarList(
  decision: DataStoreFindingDecision,
  findings: Array<DataSecuritySimilarFinding>,
): DataSecuritySimilarFindings {
  return {
    findingId: FINDING_ID,
    decision,
    reason:
      decision === DataStoreFindingDecision.NotSensitive
        ? "Shopify order numbers."
        : "",
    hasName: true,
    findings,
  };
}

describe("Apply to Similar Findings", () => {
  test("lists each finding like it, each ticked, and applies the decision to the ticked ones only", async () => {
    const applied: Array<DataSecurityApplyToSimilarResult> = [];
    const apply: SpyInstance<typeof DataSecurityApi.applyToSimilarFindings> =
      jest
        .spyOn(DataSecurityApi, "applyToSimilarFindings")
        .mockResolvedValue({
          decision: DataStoreFindingDecision.NotSensitive,
          applied: 2,
          skipped: 0,
        });
    const findings: Array<DataSecuritySimilarFinding> = [
      similarFinding(0, {
        isSameStore: true,
        location: "public.refunds.order_number",
      }),
      similarFinding(1, { aiVerdict: DataStoreFindingVerdict.NotSensitive }),
      similarFinding(2),
    ];

    render(
      <ApplyToSimilarModal
        findingId={new ObjectID(FINDING_ID)}
        similar={similarList(DataStoreFindingDecision.NotSensitive, findings)}
        onClose={() => {
          return undefined;
        }}
        onApplied={(result: DataSecurityApplyToSimilarResult) => {
          applied.push(result);
        }}
      />,
    );

    const list: HTMLElement = screen.getByTestId(APPLY_TO_SIMILAR_TEST_ID);

    expect(withoutIsolateMarks(list.textContent || "")).toContain(
      "Each keeps your reason: Shopify order numbers.",
    );
    expect(within(list).getByText("3 of 3 ticked")).toBeInTheDocument();
    expect(within(list).getByText("This store")).toBeInTheDocument();
    expect(within(list).getByText("Not sensitive")).toBeInTheDocument();
    expect(within(list).getByText("public.refunds.order_number")).toBeInTheDocument();

    for (const finding of findings) {
      expect(
        screen.getByTestId(`apply-to-similar-${finding.findingId}`),
      ).toBeChecked();
    }

    // Judged on its own: unticked.
    fireEvent.click(
      screen.getByTestId(`apply-to-similar-${findings[2]!.findingId}`),
    );

    expect(within(list).getByText("2 of 3 ticked")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Mark 2 as Not Sensitive" }),
    );

    await waitFor(() => {
      expect(applied).toHaveLength(1);
    });
    expect(apply).toHaveBeenCalledWith({
      findingId: new ObjectID(FINDING_ID),
      findingIds: [findings[0]!.findingId, findings[1]!.findingId],
    });
  });

  test("Untick all leaves nothing to apply, and Tick all ticks them again", () => {
    render(
      <ApplyToSimilarModal
        findingId={new ObjectID(FINDING_ID)}
        similar={similarList(DataStoreFindingDecision.Confirmed, [
          similarFinding(0),
          similarFinding(1),
        ])}
        onClose={() => {
          return undefined;
        }}
        onApplied={() => {
          return undefined;
        }}
      />,
    );

    // A confirmation has no reason to keep.
    expect(screen.queryByText(/Each keeps your reason/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Untick all" }));

    expect(screen.getByText("0 of 2 ticked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm 0" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Tick all" }));

    expect(screen.getByRole("button", { name: "Confirm 2" })).toBeEnabled();
  });

  test("a refusal from the server is said in the dialog, and nothing is reported applied", async () => {
    const applied: Array<DataSecurityApplyToSimilarResult> = [];

    jest
      .spyOn(DataSecurityApi, "applyToSimilarFindings")
      .mockRejectedValue(
        new Error("You may not change the findings of these stores."),
      );

    render(
      <ApplyToSimilarModal
        findingId={new ObjectID(FINDING_ID)}
        similar={similarList(DataStoreFindingDecision.NotSensitive, [
          similarFinding(0),
        ])}
        onClose={() => {
          return undefined;
        }}
        onApplied={(result: DataSecurityApplyToSimilarResult) => {
          applied.push(result);
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mark 1 as Not Sensitive" }),
    );

    expect(
      await screen.findByText(/You may not change the findings of these stores/),
    ).toBeInTheDocument();
    expect(applied).toHaveLength(0);
  });
});

// A list's row and its two buttons, as What's Inside wires them.
function Decisions(props: {
  finding: DataStoreFinding;
  onChanged: () => void;
}): ReactElement {
  const decisions: FindingDecisions = useFindingDecisions(props.onChanged);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          decisions.markNotSensitive(props.finding);
        }}
      >
        Row: Not Sensitive
      </button>
      <button
        type="button"
        onClick={() => {
          decisions.afterConfirm(props.finding);
        }}
      >
        Row: Confirmed
      </button>
      {decisions.dialogs}
    </div>
  );
}

describe("a person's decision, then the findings like it", () => {
  test("Mark as Not Sensitive starts from OneUptime AI's draft, then offers the findings like it, and says what it applied", async () => {
    const changed: Array<string> = [];
    const saved: SpyInstance<typeof ModelAPI.updateById> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(DataSecurityApi, "getSimilarFindings")
      .mockResolvedValue(
        similarList(
          DataStoreFindingDecision.NotSensitive,
          Array.from({ length: 9 }, (_value: unknown, index: number) => {
            return similarFinding(index, {
              findingId: `10372000-0000-4000-8000-00000000030${index}`,
            });
          }),
        ),
      );
    jest.spyOn(DataSecurityApi, "applyToSimilarFindings").mockResolvedValue({
      decision: DataStoreFindingDecision.NotSensitive,
      applied: 9,
      skipped: 0,
    });
    const toasts: SpyInstance<typeof Toast.success> = jest
      .spyOn(Toast, "success")
      .mockReturnValue("toast");

    render(
      <Decisions
        finding={waitingFinding(verdictRecord())}
        onChanged={() => {
          changed.push("changed");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Row: Not Sensitive" }));

    // The person's reason starts from the draft, theirs to change.
    const reason: HTMLTextAreaElement = (await screen.findByRole(
      "textbox",
    )) as HTMLTextAreaElement;

    expect(reason.value).toBe(DRAFT);

    fireEvent.change(reason, {
      target: { value: "Shopify order numbers, not cards." },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Mark as Not Sensitive" }),
      );
    });

    await waitFor(() => {
      expect(saved).toHaveBeenCalledTimes(1);
    });
    expect(saved.mock.calls[0]![0]).toMatchObject({
      data: {
        isSuppressed: true,
        suppressedReason: "Shopify order numbers, not cards.",
      },
    });

    // Nine more, on other stores, in one list.
    expect(await screen.findByText("9 of 9 ticked")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Mark 9 as Not Sensitive" }),
    );

    await waitFor(() => {
      expect(toasts).toHaveBeenCalledWith(
        "9 more findings marked as not sensitive.",
      );
    });
    expect(screen.queryByTestId(APPLY_TO_SIMILAR_TEST_ID)).toBeNull();
    expect(changed.length).toBeGreaterThanOrEqual(2);
  });

  test("with no draft, the reason starts empty", async () => {
    render(
      <Decisions
        finding={waitingFinding(
          verdictRecord({
            verdict: DataStoreFindingVerdict.Confirm,
            draft: "",
          }),
        )}
        onChanged={() => {
          return undefined;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Row: Not Sensitive" }));

    expect(
      ((await screen.findByRole("textbox")) as HTMLTextAreaElement).value,
    ).toBe("");
  });

  test("after Confirm, nothing more is asked when no finding is like it", async () => {
    const asked: SpyInstance<typeof DataSecurityApi.getSimilarFindings> = jest
      .spyOn(DataSecurityApi, "getSimilarFindings")
      .mockResolvedValue(similarList(DataStoreFindingDecision.Confirmed, []));

    render(
      <Decisions
        finding={waitingFinding(null)}
        onChanged={() => {
          return undefined;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Row: Confirmed" }));

    await waitFor(() => {
      expect(asked).toHaveBeenCalledWith(new ObjectID(FINDING_ID));
    });
    expect(screen.queryByTestId(APPLY_TO_SIMILAR_TEST_ID)).toBeNull();
  });
});

describe("a proposal for no issue opens what it changes", () => {
  test("a store's own findings, its scans' settings, or the data types the project looks for", () => {
    const store: ObjectID = new ObjectID(STORE_A);

    expect(
      getDataSecurityAiProposalRoute({
        dataStoreId: store,
        kind: DataSecurityAiProposalKind.ConfirmFindings,
      }).toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_INSIDE] as Route,
        { modelId: store },
      ).toString(),
    );
    expect(
      getDataSecurityAiProposalRoute({
        dataStoreId: store,
        kind: DataSecurityAiProposalKind.AddScanExclusion,
      }).toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS] as Route,
        { modelId: store },
      ).toString(),
    );
    expect(
      getDataSecurityAiProposalRoute({
        kind: DataSecurityAiProposalKind.TurnOffDataType,
      }).toString(),
    ).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_SECURITY_SETTINGS_DATA_TYPES] as Route,
      ).toString(),
    );
  });
});
