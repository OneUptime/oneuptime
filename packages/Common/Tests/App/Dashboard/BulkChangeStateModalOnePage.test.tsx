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
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

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

import BulkChangeStateModal, {
  BulkChangeStateSubmitData,
  NOTIFY_SUBSCRIBERS_FIELD_KEY,
  getBulkChangeStateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/BulkChangeStateModal";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/BulkStateChange";
import { JSONObject } from "../../../Types/JSON";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import Field from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The bulk Change State behind the incidents, alerts, episodes and scheduled
 * maintenance tables walked two steps - State, then Note - once a project
 * had note templates. With the note folded under "Add a public note" /
 * "Add a private note", like the single-event dialogs, it is one page of at
 * most three rows: the state, whether subscribers hear about it, and the
 * folded note. What it hands the table on submit is unchanged.
 */

const STATE_KEY: string = "incidentStateId";
const RESOLVED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const STATE_OPTIONS: Array<DropdownOption> = [
  { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", label: "Identified" },
  { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", label: "Acknowledged" },
  { value: RESOLVED_ID, label: "Resolved" },
];

const TEMPLATES: Array<BulkStateChangeNoteTemplate> = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    templateName: "All clear",
    note: "Everything is back to normal.",
  },
];

const NOTE_TEXT: string = "Rolled back the deploy for every one of these.";

interface RenderOptions {
  noteType: BulkStateChangeNoteType;
  showNotify: boolean;
}

function renderModal(options: RenderOptions): MockFunction {
  const onSubmit: MockFunction = getJestMockFunction();
  onSubmit.mockResolvedValue(undefined as never);

  render(
    <BulkChangeStateModal
      title="Change Incident State"
      description="Select the state to change incidents to."
      stateFieldKey={STATE_KEY}
      stateOptions={STATE_OPTIONS}
      noteType={options.noteType}
      noteTitle={
        options.noteType === BulkStateChangeNoteType.Public
          ? "Public Note"
          : "Private Note"
      }
      noteDescription="The same note is added to every incident you selected."
      noteTemplates={TEMPLATES}
      showNotifyStatusPageSubscribers={options.showNotify}
      onClose={getJestMockFunction()}
      onSubmit={
        onSubmit as unknown as (
          data: BulkChangeStateSubmitData,
        ) => Promise<void>
      }
    />,
  );

  return onSubmit;
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

async function pickResolved(): Promise<void> {
  const picker: HTMLElement = await within(modal()).findByRole("combobox");

  fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));
}

async function writeNote(foldName: string): Promise<void> {
  const fold: HTMLElement = within(modal()).getByRole("button", {
    name: foldName,
  });

  expect(fold).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(fold);
  expect(fold).toHaveAttribute("aria-expanded", "true");

  // The markdown source view is a plain textarea.
  fireEvent.click(within(modal()).getByTitle("Switch to markdown source"));
  fireEvent.change(
    await within(modal()).findByPlaceholderText("Type your markdown here..."),
    { target: { value: NOTE_TEXT } },
  );
}

async function submit(
  onSubmit: MockFunction,
): Promise<BulkChangeStateSubmitData> {
  fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  return onSubmit.mock.calls[0]![0] as BulkChangeStateSubmitData;
}

afterEach(() => {
  cleanup();
});

describe("the bulk Change State form", () => {
  function keyOf(field: Field<JSONObject>): string {
    return field.overrideFieldKey || Object.keys(field.field || {})[0] || "";
  }

  test("is the state, the subscriber switch and the folded note - no steps", () => {
    const fields: Fields<JSONObject> = getBulkChangeStateFormFields({
      stateFieldKey: STATE_KEY,
      stateOptions: STATE_OPTIONS,
      noteType: BulkStateChangeNoteType.Public,
      noteTitle: "Public Note",
      noteDescription: "The same note is added to every incident you selected.",
      noteTemplates: TEMPLATES,
      showNotifyStatusPageSubscribers: true,
    });

    expect(fields.map(keyOf)).toEqual([
      STATE_KEY,
      NOTIFY_SUBSCRIBERS_FIELD_KEY,
      "publicNoteTemplate",
      "publicNote",
    ]);

    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }

    // The state stays required; the rest is optional.
    expect(fields[0]!.title).toBe("Select State");
    expect(fields[0]!.required).toBe(true);
    expect(fields[0]!.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(fields[0]!.dropdownOptions).toBe(STATE_OPTIONS);

    // Only the note and its template are folded, under one line.
    expect(fields[0]!.collapsibleSection).toBeUndefined();
    expect(fields[1]!.collapsibleSection).toBeUndefined();
    expect(fields[2]!.collapsibleSection?.title).toBe("Add a public note");
    expect(fields[3]!.collapsibleSection).toBe(fields[2]!.collapsibleSection);

    // A bulk change does not read each event's settings: the box starts on.
    expect(fields[1]!.defaultValue).toBe(true);
  });

  test("has no subscriber switch for alerts and episodes", () => {
    const fields: Fields<JSONObject> = getBulkChangeStateFormFields({
      stateFieldKey: "alertStateId",
      stateOptions: STATE_OPTIONS,
      noteType: BulkStateChangeNoteType.Private,
      noteTitle: "Private Note",
      noteDescription: "Only your team can see it.",
      noteTemplates: TEMPLATES,
    });

    expect(fields.map(keyOf)).toEqual([
      "alertStateId",
      "privateNoteTemplate",
      "privateNote",
    ]);
    expect(fields[1]!.collapsibleSection?.title).toBe("Add a private note");
  });
});

describe("the bulk Change State dialog", () => {
  test("is one short page with the note folded, even when the project has templates", async () => {
    renderModal({ noteType: BulkStateChangeNoteType.Public, showNotify: true });

    await within(modal()).findByRole("combobox");
    // BasicForm settles its steps after mounting.
    await act(async () => {});

    expect(
      within(modal()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(modal()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(modal()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Change State");

    expect(
      within(modal()).getByRole("checkbox", {
        name: "Notify Status Page Subscribers",
      }),
    ).toBeChecked();
    expect(
      within(modal()).getByRole("button", { name: "Add a public note" }),
    ).toHaveAttribute("aria-expanded", "false");

    // Short while the note is folded; wide once it is opened.
    expect(modal()).toHaveClass("sm:max-w-lg");

    fireEvent.click(
      within(modal()).getByRole("button", { name: "Add a public note" }),
    );

    expect(modal()).toHaveClass("sm:max-w-7xl");
    expect(
      within(modal()).getByText("Select Note Template"),
    ).toBeInTheDocument();
  });

  test("sends the state, the note and the subscriber choice, as before", async () => {
    const onSubmit: MockFunction = renderModal({
      noteType: BulkStateChangeNoteType.Public,
      showNotify: true,
    });

    await pickResolved();
    await writeNote("Add a public note");

    const data: BulkChangeStateSubmitData = await submit(onSubmit);

    expect(data.stateId.toString()).toBe(RESOLVED_ID);
    expect(data.note).toBe(NOTE_TEXT);
    expect(data.shouldStatusPageSubscribersBeNotified).toBe(true);
  });

  test("unticking the box sends false", async () => {
    const onSubmit: MockFunction = renderModal({
      noteType: BulkStateChangeNoteType.Public,
      showNotify: true,
    });

    await pickResolved();
    fireEvent.click(
      within(modal()).getByRole("checkbox", {
        name: "Notify Status Page Subscribers",
      }),
    );

    const data: BulkChangeStateSubmitData = await submit(onSubmit);

    expect(data.shouldStatusPageSubscribersBeNotified).toBe(false);
    // Nothing written: no note.
    expect(data.note).toBeUndefined();
  });

  test("a private note goes with an alert's state, and no subscriber choice is sent", async () => {
    const onSubmit: MockFunction = renderModal({
      noteType: BulkStateChangeNoteType.Private,
      showNotify: false,
    });

    await pickResolved();

    expect(
      within(modal()).queryByRole("checkbox", {
        name: "Notify Status Page Subscribers",
      }),
    ).toBeNull();

    await writeNote("Add a private note");

    const data: BulkChangeStateSubmitData = await submit(onSubmit);

    expect(data.stateId.toString()).toBe(RESOLVED_ID);
    expect(data.note).toBe(NOTE_TEXT);
    expect(
      Object.prototype.hasOwnProperty.call(
        data,
        "shouldStatusPageSubscribersBeNotified",
      ),
    ).toBe(false);
  });

  test("a state is still required", async () => {
    const onSubmit: MockFunction = renderModal({
      noteType: BulkStateChangeNoteType.Private,
      showNotify: false,
    });

    await within(modal()).findByRole("combobox");

    fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(
        within(modal()).getByText(/Select State is required/i),
      ).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
