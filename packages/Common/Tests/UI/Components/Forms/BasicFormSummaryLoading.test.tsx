import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A form's summary step (FormSummary) is a file of its own, loaded as a form
 * with a summary step is drawn (issue #5619). It draws with Detail, and
 * through it a table, the code view and highlight.js - which every page
 * that draws any form, the sign-in page among them, used to download and
 * parse before it could draw.
 *
 * In this order (a test file keeps what it has loaded, so the order is part
 * of the test):
 *
 *   - a form without a summary step never loads it;
 *   - a form with one asks for it as it is drawn, before the step is
 *     reached; reached before it is there, the step says it is loading, and
 *     the form can still be saved;
 *   - a load that failed is tried again by the next form, and the summary
 *     lists what the form holds.
 */

const mockSummary: { requires: number; fail: boolean } = {
  requires: 0,
  fail: false,
};

jest.mock("../../../../UI/Components/Forms/FormSummary", () => {
  mockSummary.requires++;

  if (mockSummary.fail) {
    throw new Error("The summary's file could not be fetched");
  }

  return jest.requireActual("../../../../UI/Components/Forms/FormSummary");
});

import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../../Types/JSON";

const FIELDS: Fields<JSONObject> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
  },
];

const renderForm: (hasSummary: boolean) => MockFunction = (
  hasSummary: boolean,
): MockFunction => {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="incident-form"
      fields={FIELDS}
      summary={hasSummary ? { enabled: true } : undefined}
      initialValues={{ name: "Database is down" }}
      onSubmit={onSubmit}
      submitButtonText="Save"
      disableAutofocus={true}
    />,
  );

  return onSubmit;
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 10);
    });
  });
};

afterEach(() => {
  cleanup();
});

describe("a form without a summary step", () => {
  test("never loads the summary", async () => {
    renderForm(false);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    await settle();

    expect(mockSummary.requires).toBe(0);
  });
});

describe("a form with a summary step", () => {
  test("asks for the summary as it is drawn; reached before it is there, the step says it is loading", async () => {
    mockSummary.fail = true;

    const onSubmit: MockFunction = renderForm(true);

    await settle();

    // Asked for before anyone reached the step.
    expect(mockSummary.requires).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const loading: HTMLElement = await screen.findByTestId(
      "form-summary-loading",
    );

    expect(loading).toHaveAttribute("role", "status");
    expect(within(loading).getByText("Loading content")).toHaveClass("sr-only");

    // The form can still be saved from the step.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("tries again after a failed load, and the summary lists what the form holds", async () => {
    mockSummary.fail = false;

    renderForm(true);

    await settle();

    expect(mockSummary.requires).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Database is down")).toBeInTheDocument();
    expect(screen.queryByTestId("form-summary-loading")).toBeNull();
  });

  test("draws the summary at once once a form has loaded it", async () => {
    renderForm(true);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Database is down")).toBeInTheDocument();
    expect(screen.queryByTestId("form-summary-loading")).toBeNull();
    expect(mockSummary.requires).toBe(2);
  });
});
