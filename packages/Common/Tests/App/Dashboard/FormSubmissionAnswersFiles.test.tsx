import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { FormSubmissionAnswersList } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Submissions/FormSubmissionsTable";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import { CustomFieldFile } from "../../../Types/CustomField/CustomFieldFile";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";

/*
 * A submission's View Answers, for a form with file questions: each file
 * answer is the files stored for it, listed as the Custom Fields card lists
 * files - each with its kind and its size - rather than their names run
 * together in a sentence. They download from the record the submission
 * created (its file field, or its private note), so here they are listed,
 * never linked. Every other answer reads as before.
 */

const SCREENSHOT: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "outage.png",
  fileType: MimeType.png,
  size: 245760,
};

const ERRORS: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "gateway-errors.csv",
  fileType: MimeType.csv,
  size: 18432,
};

const CAPTURE: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "capture-eu-west-1.pcap",
  fileType: MimeType.pcap,
  size: 2516582,
};

type SubmissionOfFunction = (answers: Array<JSONObject>) => FormSubmission;

const submissionOf: SubmissionOfFunction = (
  answers: Array<JSONObject>,
): FormSubmission => {
  const submission: FormSubmission = new FormSubmission();
  submission._id = "bbbbbbbb-0000-4000-8000-000000000001";
  submission.answers = answers as never;
  return submission;
};

afterEach(() => {
  cleanup();
});

describe("a submission's file answers", () => {
  test("a file question's files are listed, each with its size, never linked", () => {
    render(
      <FormSubmissionAnswersList
        submission={submissionOf([
          {
            fieldId: "summary",
            label: "What is wrong?",
            value: "Checkout fails",
            displayValue: "Checkout fails",
          },
          {
            fieldId: "screenshot",
            label: "Screenshot",
            value: SCREENSHOT as unknown as JSONObject,
            displayValue: "outage.png",
          },
          {
            fieldId: "logs",
            label: "Logs and captures",
            value: [ERRORS, CAPTURE] as unknown as JSONObject,
            displayValue: "gateway-errors.csv, capture-eu-west-1.pcap",
          },
        ])}
      />,
    );

    const screenshot: HTMLElement = screen.getByTestId(
      "form-submission-files-screenshot",
    );
    const logs: HTMLElement = screen.getByTestId("form-submission-files-logs");

    expect(within(screenshot).getAllByTestId("custom-field-file")).toHaveLength(
      1,
    );
    expect(screenshot).toHaveTextContent("outage.png");
    expect(screenshot).toHaveTextContent("240 KB");

    const rows: Array<HTMLElement> =
      within(logs).getAllByTestId("custom-field-file");

    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.textContent;
      }),
    ).toEqual(["gateway-errors.csv18 KB", "capture-eu-west-1.pcap2.4 MB"]);

    // Listed, not linked: their downloads are on the record.
    expect(screen.queryByRole("link")).toBeNull();
    // Never their names run together as a sentence.
    expect(
      screen.queryByText("gateway-errors.csv, capture-eu-west-1.pcap"),
    ).toBeNull();
  });

  test("every other answer reads as it did", () => {
    render(
      <FormSubmissionAnswersList
        submission={submissionOf([
          {
            fieldId: "summary",
            label: "What is wrong?",
            value: "Checkout fails",
            displayValue: "Checkout fails",
          },
          {
            fieldId: "urgent",
            label: "Is it urgent?",
            value: true,
            displayValue: "Yes",
          },
          {
            fieldId: "empty",
            label: "Anything else?",
            value: "",
            displayValue: "",
          },
        ])}
      />,
    );

    expect(screen.getByText("Checkout fails")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByTestId("custom-field-file")).toBeNull();
  });

  test("a file answer as it was sent, before its files were stored, reads as their names", () => {
    render(
      <FormSubmissionAnswersList
        submission={submissionOf([
          {
            fieldId: "screenshot",
            label: "Screenshot",
            value: { name: "outage.png", fileType: MimeType.png },
            displayValue: "outage.png",
          },
        ])}
      />,
    );

    expect(screen.getByText("outage.png")).toBeInTheDocument();
    expect(screen.queryByTestId("custom-field-file")).toBeNull();
  });
});
