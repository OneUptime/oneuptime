import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import AuditLogChangesModal, {
  CHANGED_FIELDS_NAMED_ON_A_ROW,
  getChangedFieldLabels,
  getChangeFieldLabel,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import { JSONArray } from "Common/Types/JSON";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT CHANGED, BY THE FIELDS' NAMES, BEFORE AND AFTER (#10290).
 *
 * The changes dialog named each field by its key split into English words
 * ("Vmware V Centers", "Network Device Tie Source") and drew a switch as
 * "true" or "false" in every language, and a row of the log said only "3
 * fields changed": which fields meant opening every row. A field reads now
 * as its model names it, a switch as Yes or No in the reader's words, and a
 * row of the log names the fields an update changed under its button.
 */

const translator: Translator = getGlobalTranslator();

afterEach(() => {
  cleanup();
});

const MONITOR_UPDATE: JSONArray = [
  { field: "name", oldValue: "Checkout API", newValue: "Checkout API v2" },
  { field: "isArchived", oldValue: false, newValue: true },
  {
    field: "networkDeviceTieSource",
    oldValue: "Discovery",
    newValue: "Person",
  },
  { field: "description", oldValue: "", newValue: "The checkout service" },
  { field: "noSuchColumn", oldValue: 1, newValue: 2 },
];

function openDialog(storedResourceType?: string): void {
  render(
    <AuditLogChangesModal
      isOpen={true}
      onClose={jest.fn()}
      action="Update"
      resourceType="Monitor"
      storedResourceType={storedResourceType}
      resourceName="Checkout API"
      changes={MONITOR_UPDATE}
    />,
  );
}

function fieldNames(): Array<string> {
  return screen
    .getAllByTestId("audit-log-change-field")
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

describe("the changes dialog", () => {
  test("names each field as its model does, and a field it does not have by its key", () => {
    openDialog("Monitor");

    expect(fieldNames()).toEqual([
      "Description",
      "Is Archived",
      "Name",
      "Network Device Set By",
      "No Such Column",
    ]);
  });

  test("without the entry's type, names each field by its key, as it always did", () => {
    openDialog(undefined);

    expect(fieldNames()).toContain("Network Device Tie Source");
  });

  test("shows a switch as Yes or No, before and after", () => {
    openDialog("Monitor");

    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.queryByText("true")).not.toBeInTheDocument();
    expect(screen.queryByText("false")).not.toBeInTheDocument();
  });

  test("still shows each value before and after", () => {
    openDialog("Monitor");

    expect(screen.getByText("Checkout API")).toBeInTheDocument();
    expect(screen.getByText("Checkout API v2")).toBeInTheDocument();
    expect(screen.getByText("The checkout service")).toBeInTheDocument();
  });
});

describe("a row of the log", () => {
  test("names the first fields an update changed, then how many more", () => {
    const labels: Array<string> = getChangedFieldLabels({
      changes: MONITOR_UPDATE,
      storedResourceType: "Monitor",
      translator: translator,
    });

    expect(CHANGED_FIELDS_NAMED_ON_A_ROW).toBe(3);
    expect(labels).toEqual(["Description", "Is Archived", "Name", "2 more"]);
  });

  test("names every field when there are no more than it names", () => {
    expect(
      getChangedFieldLabels({
        changes: MONITOR_UPDATE.slice(0, 2),
        storedResourceType: "Monitor",
        translator: translator,
      }),
    ).toEqual(["Is Archived", "Name"]);
  });

  test("names one more, in the singular", () => {
    expect(
      getChangedFieldLabels({
        changes: MONITOR_UPDATE.slice(0, 4),
        storedResourceType: "Monitor",
        translator: translator,
      }),
    ).toEqual(["Description", "Is Archived", "Name", "1 more"]);
  });

  test("names nothing for an entry with no changes, or none it can read", () => {
    expect(
      getChangedFieldLabels({
        changes: [],
        storedResourceType: "Monitor",
        translator: translator,
      }),
    ).toEqual([]);
    expect(
      getChangedFieldLabels({
        changes: undefined,
        storedResourceType: "Monitor",
        translator: translator,
      }),
    ).toEqual([]);
  });

  test("a field's name is its model's, or its key's words", () => {
    expect(
      getChangeFieldLabel({
        field: "vmwareVCenters",
        storedResourceType: "Monitor",
        translator: translator,
      }),
    ).toBe("vCenters");
    expect(
      getChangeFieldLabel({
        field: "vmwareVCenters",
        storedResourceType: "Not A Model",
        translator: translator,
      }),
    ).toBe("Vmware V Centers");
  });
});
