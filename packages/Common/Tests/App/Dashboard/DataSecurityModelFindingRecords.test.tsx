import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, configure, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import FindingOccurrences, {
  FINDING_OCCURRENCES_MODEL_LINE_TEST_ID,
  getNoRecordSentence,
  MODEL_VALUES_NOT_READ,
  UNAVAILABLE_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/FindingOccurrences";
import {
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceExcerptPartKind,
  DataSecurityOccurrenceRecordKind,
  DataSecurityOccurrencesSource,
  DataSecurityOccurrencesUnavailableReason,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator } from "../../../Types/Translator";

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

/*
 * THE RECORDS OF A FINDING THE NAMES-AND-ADDRESSES MODEL MADE (#10926).
 *
 * The server reads a model finding's records again with the model: the
 * list shows them as any finding's. Where the model cannot run on the
 * server, the panel says so - not that no record carries it; and where its
 * time for the read ran out before it read every value, the panel says how
 * many it had no time for, under the list or the sentence that none was
 * found.
 */

configure({ asyncUtilTimeout: 15000 });

const FINDING_ID: string = "7a7a7a7a-0000-4000-8000-000000109260";

const WINDOW: Pick<
  DataSecurityFindingOccurrences,
  "since" | "until" | "source" | "lastSeenAt"
> = {
  since: "2026-11-24T10:45:00.000Z",
  until: "2026-11-24T12:00:00.000Z",
  source: DataSecurityOccurrencesSource.SampledRecords,
  lastSeenAt: "2026-11-24T11:30:00.000Z",
};

const ONE_RECORD: DataSecurityFindingOccurrences["occurrences"] = [
  {
    time: "2026-11-24T11:30:00.000Z",
    recordKind: DataSecurityOccurrenceRecordKind.Log,
    serviceId: "1a1a1a1a-0000-4000-8000-0000000000a1",
    logId: "2b2b2b2b-0000-4000-8000-0000000000b2",
    severity: "Info",
    maskedValue: "M****",
    excerpt: {
      parts: [
        {
          kind: DataSecurityOccurrenceExcerptPartKind.Text,
          text: "Refund approved for ",
        },
        { kind: DataSecurityOccurrenceExcerptPartKind.Match, text: "M****" },
        { kind: DataSecurityOccurrenceExcerptPartKind.Text, text: ", " },
        { kind: DataSecurityOccurrenceExcerptPartKind.Masked, text: "1****" },
        { kind: DataSecurityOccurrenceExcerptPartKind.Text, text: ", Madrid" },
      ],
      isCutAtStart: false,
      isCutAtEnd: false,
    },
  },
];

function renderWith(answer: DataSecurityFindingOccurrences): void {
  jest
    .spyOn(DataSecurityApi, "getFindingOccurrences")
    .mockResolvedValue(answer);

  render(
    <MemoryRouter>
      <FindingOccurrences
        findingId={new ObjectID(FINDING_ID)}
        ownerName="checkout"
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a finding the model made, on the records panel", () => {
  test("its records are listed as any finding's, the name masked in its line", async () => {
    renderWith({
      ...WINDOW,
      occurrences: ONE_RECORD,
      recordsRead: 2,
      isComplete: true,
    });

    const excerpt: HTMLElement = await screen.findByTestId(
      "data-security-finding-occurrence-excerpt",
    );

    expect(excerpt).toHaveTextContent(
      "Refund approved for M****, 1****, Madrid",
    );
    expect(
      screen.queryByTestId(FINDING_OCCURRENCES_MODEL_LINE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("where its time ran out, how many values it had no time for is said under the list", async () => {
    renderWith({
      ...WINDOW,
      occurrences: ONE_RECORD,
      recordsRead: 40,
      isComplete: false,
      modelValuesNotRead: 30,
    });

    expect(
      await screen.findByTestId(FINDING_OCCURRENCES_MODEL_LINE_TEST_ID),
    ).toHaveTextContent(
      "The scanner's model had no time for 30 of the values read here, so a record among them that carries it is not listed.",
    );
  });

  test("and under the sentence that none was found", async () => {
    renderWith({
      ...WINDOW,
      occurrences: [],
      recordsRead: 300,
      isComplete: false,
      modelValuesNotRead: 1234,
    });

    expect(
      await screen.findByTestId("data-security-finding-occurrences-none"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(FINDING_OCCURRENCES_MODEL_LINE_TEST_ID),
    ).toHaveTextContent("had no time for 1,234 of the values read here");
  });

  test("where the model cannot run on the server, it says so, and nothing about its time", async () => {
    renderWith({
      ...WINDOW,
      occurrences: [],
      recordsRead: 0,
      isComplete: true,
      unavailableReason:
        DataSecurityOccurrencesUnavailableReason.ModelUnavailable,
      modelValuesNotRead: 5,
    });

    expect(
      await screen.findByTestId("data-security-finding-occurrences-none"),
    ).toHaveTextContent(
      "The scanner's model found this in free text, and it cannot run on this server just now, so the records it was found in cannot be shown.",
    );
    expect(
      screen.queryByTestId(FINDING_OCCURRENCES_MODEL_LINE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("the sentences", () => {
  test("every reason a finding's records cannot be shown has its own sentence", () => {
    for (const reason of Object.values(
      DataSecurityOccurrencesUnavailableReason,
    )) {
      expect(UNAVAILABLE_SENTENCES[reason]).toBeTruthy();
    }
  });

  test("the model's reason reads as its own sentence, not another's", () => {
    const translator: ReturnType<typeof createTranslator> =
      createTranslator(undefined);

    expect(
      getNoRecordSentence(translator, {
        ...WINDOW,
        occurrences: [],
        recordsRead: 0,
        isComplete: true,
        unavailableReason:
          DataSecurityOccurrencesUnavailableReason.ModelUnavailable,
      }),
    ).toBe(
      UNAVAILABLE_SENTENCES[
        DataSecurityOccurrencesUnavailableReason.ModelUnavailable
      ],
    );
  });

  test("the time sentence keeps its count wherever a language puts it", () => {
    expect(MODEL_VALUES_NOT_READ).toContain("{{count}}");
  });
});
