import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";

/*
 * What a person meets of the data types OneUptime AI learns (#10371),
 * rendered for real:
 *
 *   - Data Types to Review: each proposal in the words of the issue - "OneUptime
 *     AI found a data type your stores keep: Insurance policy number, in 11
 *     fields of 6 stores." and "Matches 98% of the values in these 11
 *     fields, and 0.1% of values elsewhere in the same stores." - with Add
 *     Data Type, and Not a Data Type, which asks once and turns it down;
 *   - Describe It: a sentence and three examples fill the form with a
 *     pattern Test It finds all three with - and the request carries the
 *     examples' shapes, never an example.
 */

let proposalRows: Array<unknown> = [];
let provingCount: number = 0;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<unknown> => {
        return {
          data: proposalRows,
          count: proposalRows.length,
          skip: 0,
          limit: 20,
        };
      },
      count: async (): Promise<number> => {
        return provingCount;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import DataTypesToReview, {
  DATA_TYPES_TO_REVIEW_TEST_ID,
  DataTypeToReview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataTypesToReview";
import {
  getPartlyCountedSentence,
  getProofSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataTypesToReviewCopy";
import DescribeDataType, {
  countExamplesFound,
  readExamples,
  toExampleShapes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DescribeDataType";
import {
  CustomDataTypeTestOutcome,
  CustomDataTypeTestResult,
  testCustomDataType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/CustomDataTypeTest";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { DESCRIBE_DATA_TYPE_ROUTE } from "../../../Types/DataSecurity/DataTypeDescribe";
import { JSONObject } from "../../../Types/JSON";
import { createTranslator, Translator } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import { CustomDataTypeValidator } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import {
  DataTypeDraft,
  DataTypeDraftVariant,
  DataTypeGroupField,
  DataTypeProof,
  DataTypeProposalPlan,
  toCustomDataTypeFormValues,
} from "../../../Utils/DataSecurity/DataTypeProposal";

const WAIT_TIMEOUT: number = 20000;
const ENGLISH: Translator = createTranslator(undefined, "en");

const DRAFT: DataTypeDraft = {
  name: "Insurance policy number",
  description: "The number of an insurance policy, such as AA-9999999.",
  category: DataCategory.Financial,
  sensitivity: DataSensitivity.Confidential,
  pattern: "\\b[A-Z]{2}-?\\d{7}\\b",
  ignoreCase: false,
  keywords: ["policy"],
  requiresKeyword: false,
  nameHints: ["policy no"],
  validator: CustomDataTypeValidator.None,
};

function groupFields(): Array<DataTypeGroupField> {
  return Array.from({ length: 11 }, (_value: unknown, index: number) => {
    return {
      dataStoreId: `store-${index % 6}`,
      storeName: `Store ${(index % 6) + 1}`,
      storeKind: "PostgreSQL",
      location: `t${index}.policy_no`,
      locationKind: "Column",
      shapes: [{ shape: "AA-9999999", share: 1 }],
      valueCount: 100,
    };
  });
}

// The issue's example: 98% of its 11 fields' values, 0.1% of values elsewhere.
function proof(overrides: Partial<DataTypeProof> = {}): DataTypeProof {
  return {
    variant: DataTypeDraftVariant.AsDrafted,
    storesInGroup: 6,
    storesCounted: 6,
    fieldsInGroup: 11,
    fieldsCounted: 11,
    groupValues: 1100,
    groupMatched: 1078,
    elsewhereValues: 12000,
    elsewhereMatched: 12,
    scatteredValues: 12000,
    scatteredMatched: 12,
    fields: groupFields().map((field: DataTypeGroupField) => {
      return {
        dataStoreId: field.dataStoreId,
        storeName: field.storeName,
        location: field.location,
        values: 100,
        matched: 98,
      };
    }),
    alsoIn: [],
    ...overrides,
  };
}

function plan(withProof: DataTypeProof = proof()): DataTypeProposalPlan {
  return {
    groupKey: "data-type:0123456789abcdef",
    skeleton: "A9",
    words: ["policy"],
    fields: groupFields(),
    fieldCount: 11,
    storeCount: 6,
    shapes: [{ shape: "AA-9999999", share: 1 }],
    draft: DRAFT,
    narrowed: { ...DRAFT, requiresKeyword: true },
    reason: "Every field's name says policy.",
    provingSince: "2026-11-23T00:00:00.000Z",
    provingUntil: "2026-11-25T00:00:00.000Z",
    proof: withProof,
  };
}

function proposalRow(id: string): DataSecurityAiProposal {
  const row: DataSecurityAiProposal = new DataSecurityAiProposal();

  row._id = id;
  row.plan = plan() as unknown as JSONObject;

  return row;
}

beforeEach(() => {
  proposalRows = [];
  provingCount = 0;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the proposal's numbers, in words", () => {
  test("say what the shadow scans counted, as the issue words it", () => {
    expect(getProofSentence(ENGLISH, proof())).toBe(
      "Matches 98% of the values in these 11 fields, and 0.1% of values elsewhere in the same stores.",
    );
    expect(
      getProofSentence(
        ENGLISH,
        proof({ elsewhereMatched: 1, elsewhereValues: 100_000 }),
      ),
    ).toBe(
      "Matches 98% of the values in these 11 fields, and less than 0.1% of values elsewhere in the same stores.",
    );
    expect(
      getProofSentence(
        ENGLISH,
        proof({
          fieldsCounted: 1,
          groupValues: 100,
          groupMatched: 100,
          elsewhereValues: 0,
          elsewhereMatched: 0,
        }),
      ),
    ).toBe("Matches 100% of the values in this field.");
  });

  test("say so when some stores were not scanned in time, and only then", () => {
    expect(getPartlyCountedSentence(ENGLISH, proof())).toBe("");
    expect(getPartlyCountedSentence(ENGLISH, proof({ storesCounted: 4 }))).toBe(
      "Counted on the scans of 4 of its 6 stores: the others were not scanned in time.",
    );
  });

  test("are written in the reader's digits and percent sign", () => {
    const german: Translator = createTranslator(undefined, "de");

    // Without German words for the sentence, the whole sentence is English.
    expect(getProofSentence(german, proof())).toContain("98%");
  });
});

describe("Data Types to Review", () => {
  test("is not drawn while no proposal waits", async () => {
    const { container } = render(<DataTypesToReview onAdd={(): void => {}} />);

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });

    expect(container.innerHTML).toBe("");
  });

  test("reads each proposal as the issue words it, with Add Data Type and Not a Data Type", async () => {
    proposalRows = [proposalRow("00000000-0000-4000-8000-000000000001")];
    provingCount = 2;

    let added: DataTypeToReview | null = null;

    render(
      <DataTypesToReview
        onAdd={(proposal: DataTypeToReview): void => {
          added = proposal;
        }}
      />,
    );

    const card: HTMLElement = await screen.findByTestId(
      DATA_TYPES_TO_REVIEW_TEST_ID,
      undefined,
      { timeout: WAIT_TIMEOUT },
    );

    expect(card.textContent).toContain(
      "OneUptime AI found a data type your stores keep: Insurance policy number, in 11 fields of 6 stores.",
    );
    expect(card.textContent).toContain(
      "Matches 98% of the values in these 11 fields, and 0.1% of values elsewhere in the same stores.",
    );
    expect(card.textContent).toContain(
      "OneUptime AI is checking 2 more data types on your stores' next scans.",
    );

    // Its fields, folded until asked for, with its pattern.
    expect(card.textContent).not.toContain("t0.policy_no");
    fireEvent.click(screen.getByTestId("data-type-to-review-toggle"));
    expect(card.textContent).toContain("t0.policy_no");
    expect(card.textContent).toContain(DRAFT.pattern);

    fireEvent.click(screen.getByTestId("data-type-to-review-add"));
    expect(added!.id.toString()).toBe("00000000-0000-4000-8000-000000000001");
    expect(added!.plan.draft.name).toBe("Insurance policy number");
  });

  test("Not a Data Type asks once, then turns the proposal down for good", async () => {
    proposalRows = [proposalRow("00000000-0000-4000-8000-000000000002")];

    const post: jest.SpiedFunction<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(200, { status: "Dismissed" }, {}) as never,
      );

    render(<DataTypesToReview onAdd={(): void => {}} />);

    fireEvent.click(
      await screen.findByTestId(
        "data-type-to-review-not-a-data-type",
        undefined,
        { timeout: WAIT_TIMEOUT },
      ),
    );

    // Asked once, in words that say what happens.
    expect(
      screen.getByText(
        "OneUptime AI will not propose Insurance policy number for these fields again. Nothing else changes.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    // Once turned down, it no longer waits: the card goes.
    proposalRows = [];
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(screen.queryByTestId(DATA_TYPES_TO_REVIEW_TEST_ID)).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(post).toHaveBeenCalledTimes(1);

    const call: { url: { toString: () => string }; data: JSONObject } = post
      .mock.calls[0]![0] as unknown as {
      url: { toString: () => string };
      data: JSONObject;
    };

    expect(call.url.toString()).toContain(
      "/data-security-ai-proposal/00000000-0000-4000-8000-000000000002/dismiss",
    );
    expect(call.data).toEqual({ reason: "Not a data type." });
  });
});

describe("Describe It", () => {
  const EXAMPLES: Array<string> = ["EMP-482913", "EMP771204", "EMP-000042"];

  // What OneUptime AI drafted, as the form is filled in with it.
  const DESCRIBED: JSONObject = toCustomDataTypeFormValues({
    ...DRAFT,
    name: "Employee ID",
    category: DataCategory.ContactAndIdentity,
    pattern: "\\bEMP-?\\d{6}\\b",
    keywords: ["employee"],
    nameHints: ["employee id"],
  });

  test("sends a sentence and the shapes of the examples, never an example, and fills the form", async () => {
    const post: jest.SpiedFunction<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(200, { dataType: DESCRIBED, reason: "" }, {}) as never,
      );
    let filled: { values: JSONObject; examples: Array<string> } | null = null;

    render(
      <DescribeDataType
        onDraft={(values: JSONObject, examples: Array<string>): void => {
          filled = { values, examples };
        }}
      />,
    );

    fireEvent.change(screen.getByTestId("describe-data-type-sentence"), {
      target: {
        value:
          "Our employee IDs look like EMP-123456, sometimes without the dash.",
      },
    });
    fireEvent.change(screen.getByTestId("describe-data-type-examples"), {
      target: { value: EXAMPLES.join("\n") },
    });
    fireEvent.click(screen.getByTestId("describe-data-type-fill"));

    await waitFor(
      () => {
        expect(filled).not.toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(post).toHaveBeenCalledTimes(1);

    const call: { url: { toString: () => string }; data: JSONObject } = post
      .mock.calls[0]![0] as unknown as {
      url: { toString: () => string };
      data: JSONObject;
    };

    expect(call.url.toString()).toContain(DESCRIBE_DATA_TYPE_ROUTE);
    expect(call.data).toEqual({
      sentence:
        "Our employee IDs look like EMP-123456, sometimes without the dash.",
      exampleShapes: ["AAA-999999", "AAA999999"],
    });

    // The examples never leave the browser.
    for (const example of EXAMPLES) {
      expect(JSON.stringify(call.data)).not.toContain(example);
    }

    // The form gets the draft, and Test It the examples.
    expect(filled!.values).toEqual(DESCRIBED);
    expect(filled!.examples).toEqual(EXAMPLES);
    expect(
      (await screen.findByTestId("describe-data-type-filled")).textContent,
    ).toBe(
      "OneUptime AI filled in the form. Its pattern finds 3 of your 3 examples: see Test It.",
    );
  });

  test("Test It, run on the examples in the browser, finds all three with the pattern the form was filled with", () => {
    const result: CustomDataTypeTestResult = testCustomDataType(
      DESCRIBED,
      EXAMPLES.join("\n"),
    );

    expect(result.outcome).toBe(CustomDataTypeTestOutcome.Found);
    expect(result.foundCount).toBe(3);
    expect(countExamplesFound(DESCRIBED, EXAMPLES)).toBe(3);
    expect(countExamplesFound(DESCRIBED, ["EMP-48291", "XYZ-482913"])).toBe(0);
  });

  test("reads the examples one to a line, and sends each shape once", () => {
    expect(readExamples("  EMP-1  \n\nEMP-1\nEMP-2\r\n")).toEqual([
      "EMP-1",
      "EMP-2",
    ]);
    expect(toExampleShapes(["EMP-482913", "EMP-771204", "emp771204"])).toEqual([
      "AAA-999999",
      "aaa999999",
    ]);
  });

  test("cannot be pressed without a sentence, and says why the server would not draft one", async () => {
    const refusal: string =
      "OneUptime AI found no data type to draft in that description. Describe it differently, or write the pattern yourself.";

    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(400, { message: refusal }, {}) as never,
      );
    let filled: boolean = false;

    render(
      <DescribeDataType
        onDraft={(): void => {
          filled = true;
        }}
      />,
    );

    expect(screen.getByTestId("describe-data-type-fill")).toBeDisabled();

    fireEvent.change(screen.getByTestId("describe-data-type-sentence"), {
      target: { value: "Make the dashboard blue." },
    });
    fireEvent.click(screen.getByTestId("describe-data-type-fill"));

    expect(
      (
        await screen.findByTestId("describe-data-type-error", undefined, {
          timeout: WAIT_TIMEOUT,
        })
      ).textContent,
    ).toContain(refusal);
    expect(filled).toBe(false);
  });
});
