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
import React from "react";
import CappedListServer, {
  CappedListCall,
} from "../../App/Dashboard/CappedListServer";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";

/*
 * AN ENTITY DROPDOWN OF RECORDS THAT CAN BE ARCHIVED THOUGH THEY ARE NO
 * VALUES (#10764).
 *
 * A service can be archived: hidden from its list, its telemetry still
 * arriving. ArchivedValuePicker knows only the values a record picks (a
 * state, a severity, a label), so a dropdown of services read no archive
 * switch and drew an archived service like any other. With
 * marksArchivedRecords, a search's read and a held value's read both
 * select the switch, and an archived service is marked Archived, in the
 * list and on its chip. Unset, a dropdown reads exactly as it did.
 */

const LIVE_ID: string = "a3000000-0000-4000-8000-000000000001";
const ARCHIVED_ID: string = "a3000000-0000-4000-8000-000000000002";

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();
  server.add(Service, [
    { _id: LIVE_ID, name: "WB kiosk api" },
    { _id: ARCHIVED_ID, name: "WB kiosk legacy", isArchived: true },
  ]);
  server.install();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPicker(data: {
  value: Array<string>;
  marksArchivedRecords?: boolean | undefined;
}): Promise<void> {
  await act(async () => {
    render(
      <EntityDropdown
        modelType={Service}
        labelField="name"
        valueField="_id"
        isMultiSelect={true}
        enableLabelsTab={false}
        listsArchivedValues={true}
        marksArchivedRecords={data.marksArchivedRecords}
        notFoundLabel="No longer available"
        value={data.value}
        dataTestId="service-picker"
        ariaLabel="Services"
      />,
    );
  });
}

async function search(text: string): Promise<Array<HTMLElement>> {
  const input: HTMLElement = screen.getByTestId("service-picker");

  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
  });

  return await screen.findAllByRole("option", { name: /WB kiosk/ });
}

function searchReads(): Array<CappedListCall> {
  return server.callsFor(Service).filter((call: CappedListCall): boolean => {
    return call.query["name"] instanceof Search;
  });
}

function heldReads(): Array<CappedListCall> {
  return server.callsFor(Service).filter((call: CappedListCall): boolean => {
    return call.query["_id"] instanceof Includes;
  });
}

describe("marksArchivedRecords", () => {
  test("a search reads each service's archive switch, and marks an archived one in the list", async () => {
    await renderPicker({ value: [], marksArchivedRecords: true });

    const options: Array<HTMLElement> = await search("WB kiosk");

    expect(searchReads()[0]!.select["isArchived"]).toBe(true);
    expect(
      within(options[1]!).getByTestId("entity-dropdown-option-archived-tag"),
    ).toBeInTheDocument();
    expect(
      within(options[0]!).queryByTestId("entity-dropdown-option-archived-tag"),
    ).toBeNull();
    // Offered, never left out: the switch is read, not filtered on.
    expect(searchReads()[0]!.query["isArchived"]).toBeUndefined();
  });

  test("a held archived service is read with its switch and marked on its chip", async () => {
    await renderPicker({ value: [ARCHIVED_ID], marksArchivedRecords: true });

    await waitFor(() => {
      expect(
        screen.getByTestId("entity-dropdown-chip-label"),
      ).toHaveTextContent("WB kiosk legacy");
    });

    expect(heldReads()[0]!.select["isArchived"]).toBe(true);
    expect(
      screen.getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();
  });

  test("a picked archived service keeps its mark on its chip", async () => {
    await renderPicker({ value: [], marksArchivedRecords: true });

    const options: Array<HTMLElement> = await search("WB kiosk legacy");

    await act(async () => {
      fireEvent.click(options[0]!);
    });

    expect(screen.getByTestId("entity-dropdown-chip-label")).toHaveTextContent(
      "WB kiosk legacy",
    );
    expect(
      screen.getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();
  });

  test("unset, a dropdown of services reads no archive switch, as before", async () => {
    await renderPicker({ value: [ARCHIVED_ID] });

    await waitFor(() => {
      expect(
        screen.getByTestId("entity-dropdown-chip-label"),
      ).toHaveTextContent("WB kiosk legacy");
    });

    // The fake answers every column; what is asked for is what is pinned.
    expect(heldReads()[0]!.select).not.toHaveProperty("isArchived");
    expect(heldReads()[0]!.select).toHaveProperty("name", true);

    await search("WB kiosk");

    expect(searchReads()[0]!.select).not.toHaveProperty("isArchived");
    expect(searchReads()[0]!.select).toHaveProperty("name", true);
  });
});
