import "@testing-library/jest-dom";
import {
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

import BulkChangeStateModal from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/BulkChangeStateModal";
import { BulkStateChangeNoteType } from "../../../../App/FeatureSet/Dashboard/src/Utils/BulkStateChange";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Color from "../../../Types/Color";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import getJestMockFunction from "../../MockType";

/*
 * The bulk "Change State" action on the incidents, alerts, episodes and
 * scheduled maintenance tables offered its states as plain names. Each
 * table now builds the options from its state rows with
 * DropdownUtil.getDropdownOptionsFromEntityArray - which these tests use the
 * same way - so the picker draws each state's colour like every other state
 * dropdown.
 */

function state(id: string, name: string, color: string): IncidentState {
  const row: IncidentState = new IncidentState();
  row._id = id;
  row.name = name;
  row.color = new Color(color);
  return row;
}

const STATES: Array<IncidentState> = [
  state("identified", "Identified", "#ef4444"),
  state("acknowledged", "Acknowledged", "#f59e0b"),
  state("resolved", "Resolved", "#10b981"),
];

function renderModal(): void {
  const stateOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEntityArray({
      array: STATES,
      labelField: "name",
      valueField: "_id",
    });

  render(
    <BulkChangeStateModal
      title="Change Incident State"
      description="Select the state to change incidents to."
      stateFieldKey="incidentStateId"
      stateOptions={stateOptions}
      noteType={BulkStateChangeNoteType.Public}
      noteTitle="Public Note"
      noteDescription="Post a public note about this state change."
      noteTemplates={[]}
      onClose={getJestMockFunction()}
      onSubmit={async (): Promise<void> => {}}
    />,
  );
}

// The colour of the dot drawn in an element, as the dropdown titles it.
function dotIn(element: HTMLElement): string | undefined {
  const dot: HTMLElement | null = element.querySelector<HTMLElement>(
    'span[aria-hidden="true"][title]',
  );

  return dot?.getAttribute("title") || undefined;
}

async function openStatePicker(): Promise<void> {
  const picker: HTMLElement = await within(
    screen.getByTestId("modal"),
  ).findByRole("combobox");

  fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
}

afterEach(() => {
  cleanup();
});

describe("the bulk Change State picker shows each state's colour", () => {
  test("every state in the menu has its colour", async () => {
    renderModal();

    await openStatePicker();

    const options: Array<HTMLElement> = await screen.findAllByRole("option");

    expect(
      options.map((option: HTMLElement) => {
        return [option.textContent?.trim(), dotIn(option)];
      }),
    ).toEqual([
      ["Identified", "#ef4444"],
      ["Acknowledged", "#f59e0b"],
      ["Resolved", "#10b981"],
    ]);
  });

  test("the picked state keeps its colour once the menu closes", async () => {
    renderModal();

    await openStatePicker();

    fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));

    await waitFor(() => {
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });

    const modal: HTMLElement = screen.getByTestId("modal");
    const picked: HTMLElement = within(modal).getByText("Resolved");

    expect(dotIn(picked.parentElement as HTMLElement)).toBe("#10b981");
  });
});
