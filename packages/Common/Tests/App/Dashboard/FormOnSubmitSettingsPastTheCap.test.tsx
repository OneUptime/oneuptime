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
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import FormMappingCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormMappingCard";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { getDefaultFormFields } from "../../../Types/Form/FormField";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { formStepButton } from "../../Helpers/FormStepButton";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A FORM'S ALWAYS-ATTACHED MONITORS SURVIVE A SAVE, HOWEVER MANY MONITORS
 * THE PROJECT HAS (#10646).
 *
 * The On Submit page read every monitor of the project to name the ones a
 * form's settings attach - the first 10,000 by name - and its Edit Settings
 * dialog kept only the saved monitors it found among them: one it did not
 * find was "deleted", and saving the dialog for any reason left it out. So a
 * monitor whose name sorts past the 10,000th ("WB1500KSK02" in a project of
 * 10,050 named before it) read "Deleted" on the card, and the next save of
 * the dialog dropped it from the form for good: every incident declared
 * through the form after that came without it.
 *
 * The card, its dialog and their reads are the real ones; ModelAPI answers
 * from a project faked whole (CappedListServer), so the old read of the
 * first 10,000 by name misses the monitor exactly as it did on the server.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000bb";
const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";
const LATE_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000aa";
const DELETED_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000dd";
const LABEL_ID: string = "c0000000-0000-4000-8000-000000000001";
const ARCHIVED_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000ee";
const OTHER_LATE_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000ab";
const DELETED_SEVERITY_ID: string = "a0000000-0000-4000-8000-0000000000dd";

// More monitors than the page read, every one named before "WB".
const MONITORS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;
let updateByIdMock: MockFunction;
let onSaved: MockFunction;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Monitor,
    namesSortingFirst(MONITORS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Monitor, [
    { _id: LATE_MONITOR_ID, name: "WB1500KSK02" },
    { _id: OTHER_LATE_MONITOR_ID, name: "WB1500KSK03" },
  ]);
  server.add(IncidentSeverity, [
    { _id: SEVERITY_ID, name: "Major", order: 1, isArchived: false },
  ]);
  server.add(Label, [
    { _id: LABEL_ID, name: "customer-report", isArchived: false },
    { _id: ARCHIVED_LABEL_ID, name: "customer-old", isArchived: true },
  ]);
  server.install();

  updateByIdMock = getJestMockFunction();
  updateByIdMock.mockResolvedValue({} as never);
  getJestSpyOn(ModelAPI, "updateById").mockImplementation(((
    ...args: Array<unknown>
  ): unknown => {
    return updateByIdMock(...args);
  }) as never);

  onSaved = getJestMockFunction();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(PermissionGate, "check").mockReturnValue({
    isAllowed: true,
  } as PermissionGateResult);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(targetSettings: JSONObject): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <FormMappingCard
        formId={new ObjectID(FORM_ID)}
        targetType={FormTargetType.Incident}
        fields={getDefaultFormFields(FormTargetType.Incident)}
        targetSettings={targetSettings}
        onSaved={() => {
          onSaved();
        }}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("form-mapping-rows")).toBeInTheDocument();
  });
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

async function openSettings(): Promise<void> {
  const editButton: HTMLElement | undefined = screen
    .queryAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(
        FormsCopy.editOnSubmitSettings,
      );
    });

  expect(editButton).toBeDefined();

  await act(async () => {
    fireEvent.click(editButton!);
  });

  await waitFor(() => {
    expect(
      within(modal()).getByRole("textbox", { name: /^Default Title/ }),
    ).toBeInTheDocument();
  });
}

// The dialog's steps, in order: Defaults, Always Attach, Owners.
function steps(): Array<HTMLElement> {
  return within(
    within(modal()).getByRole("navigation", { name: "Progress" }),
  ).getAllByRole("listitem");
}

async function openStep(index: number): Promise<void> {
  await act(async () => {
    fireEvent.click(formStepButton(steps()[index]!));
  });
}

// The chips a picker of the Always Attach step shows, by their text.
function chipsOf(picker: HTMLElement): Array<string> {
  const field: HTMLElement = picker.closest(
    "[data-testid='entity-dropdown-box']",
  )!.parentElement!.parentElement!;

  return within(field)
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

function picker(name: RegExp): HTMLElement {
  return within(modal()).getByRole("combobox", { name: name });
}

// Saves from the last step, as it is.
async function save(): Promise<JSONObject> {
  await openStep(steps().length - 1);

  await waitFor(() => {
    expect(
      within(modal()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(FormsCopy.saveChanges);
  });

  await act(async () => {
    fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(() => {
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  const request: Record<string, unknown> = updateByIdMock.mock
    .calls[0]![0] as Record<string, unknown>;

  return (request["data"] as JSONObject)["targetSettings"] as JSONObject;
}

// Changes the default title - any change - and saves from the last step.
async function changeTitleAndSave(): Promise<JSONObject> {
  fireEvent.change(
    within(modal()).getByRole("textbox", { name: /^Default Title/ }),
    { target: { value: "Reported through the form" } },
  );

  await openStep(steps().length - 1);

  await waitFor(() => {
    expect(
      within(modal()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(FormsCopy.saveChanges);
  });

  await act(async () => {
    fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(() => {
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  const request: Record<string, unknown> = updateByIdMock.mock
    .calls[0]![0] as Record<string, unknown>;

  return (request["data"] as JSONObject)["targetSettings"] as JSONObject;
}

describe("a saved monitor whose name sorts past the 10,000th", () => {
  test("the old read of every monitor never had it", () => {
    expect(
      server
        .list({
          modelType: Monitor,
          query: { projectId: new ObjectID(PROJECT_ID) } as never,
          select: { _id: true, name: true } as never,
          sort: { name: "Ascending" } as never,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        })
        .data.map((monitor: Monitor): string => {
          return monitor.name || "";
        }),
    ).not.toContain("WB1500KSK02");
  });

  test("the card names it, not Deleted", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [LATE_MONITOR_ID],
    });

    const row: HTMLElement = screen.getByTestId("form-mapping-row-monitors");

    expect(row).toHaveTextContent("WB1500KSK02");
    expect(row).not.toHaveTextContent(FormsCopy.deletedRecord);
  });

  test("the form keeps it when the dialog is saved", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [LATE_MONITOR_ID],
      labelIds: [LABEL_ID],
    });
    await openSettings();

    const saved: JSONObject = await changeTitleAndSave();

    expect(saved["monitorIds"]).toEqual([LATE_MONITOR_ID]);
    // Every other setting is kept as it was.
    expect(saved["labelIds"]).toEqual([LABEL_ID]);
    expect(saved["incidentSeverityId"]).toBe(SEVERITY_ID);
    expect(saved["defaultTitle"]).toBe("Reported through the form");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("the page never reads the project's monitors whole: only the saved ones, by id", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [LATE_MONITOR_ID],
    });

    const monitorReads: Array<Record<string, unknown>> = server
      .callsFor(Monitor)
      .map((call: { query: Record<string, unknown> }) => {
        return call.query;
      });

    expect(monitorReads.length).toBeGreaterThan(0);

    for (const query of monitorReads) {
      expect(query["_id"]).toBeInstanceOf(Includes);
      expect(
        (query["_id"] as Includes).values.map((value: unknown): string => {
          return String(value).toLowerCase();
        }),
      ).toEqual([LATE_MONITOR_ID]);
    }
  });
});

describe("a saved monitor deleted since", () => {
  test("the card says Deleted in its place", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [DELETED_MONITOR_ID, LATE_MONITOR_ID],
    });

    const row: HTMLElement = screen.getByTestId("form-mapping-row-monitors");

    expect(row).toHaveTextContent(FormsCopy.deletedRecord);
    expect(row).toHaveTextContent("WB1500KSK02");
  });
});

describe("the Always Attach pickers search the server", () => {
  test("a monitor past the 10,000th is found by its name, picked and saved beside the one held", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [LATE_MONITOR_ID],
    });
    await openSettings();
    await openStep(1);

    // The one held is named, read by its id.
    await waitFor(() => {
      expect(chipsOf(picker(/^Monitors/))).toEqual(["WB1500KSK02"]);
    });

    await act(async () => {
      fireEvent.focus(picker(/^Monitors/));
      fireEvent.change(picker(/^Monitors/), {
        target: { value: "WB1500KSK0" },
      });
    });

    const option: HTMLElement = await within(modal()).findByRole("option", {
      name: /WB1500KSK03/,
    });

    // Asked of the server, by name: never the project's first 10,000.
    const search: Record<string, unknown> | undefined = server
      .callsFor(Monitor)
      .map((call: { query: Record<string, unknown> }) => {
        return call.query;
      })
      .find((query: Record<string, unknown>): boolean => {
        return query["name"] instanceof Search;
      });

    expect((search?.["name"] as Search<string>).toString()).toBe("WB1500KSK0");
    expect(
      server.callsFor(Monitor).every((call: { limit: number }): boolean => {
        return call.limit <= 50;
      }),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(option);
    });

    expect(chipsOf(picker(/^Monitors/))).toEqual([
      "WB1500KSK02",
      "WB1500KSK03",
    ]);

    const saved: JSONObject = await save();

    expect(saved["monitorIds"]).toEqual([
      LATE_MONITOR_ID,
      OTHER_LATE_MONITOR_ID,
    ]);
  });

  test("a monitor deleted since is a Deleted chip, and the save keeps it as it was left", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [DELETED_MONITOR_ID, LATE_MONITOR_ID],
    });
    await openSettings();
    await openStep(1);

    await waitFor(() => {
      expect(chipsOf(picker(/^Monitors/))).toEqual([
        FormsCopy.deletedRecord,
        "WB1500KSK02",
      ]);
    });
    expect(
      within(modal())
        .getAllByTestId("entity-dropdown-chip-label")
        .find((chip: HTMLElement): boolean => {
          return chip.getAttribute("data-not-found") === "true";
        }),
    ).toHaveTextContent(FormsCopy.deletedRecord);

    const saved: JSONObject = await save();

    // Nothing dropped behind the reader's back.
    expect(saved["monitorIds"]).toEqual([DELETED_MONITOR_ID, LATE_MONITOR_ID]);
  });

  test("a monitor deleted since is taken out with its chip's Remove", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [DELETED_MONITOR_ID, LATE_MONITOR_ID],
    });
    await openSettings();
    await openStep(1);

    const remove: HTMLElement = await within(modal()).findByRole("button", {
      name: "Remove Deleted",
    });

    await act(async () => {
      fireEvent.click(remove);
    });

    expect(chipsOf(picker(/^Monitors/))).toEqual(["WB1500KSK02"]);

    const saved: JSONObject = await save();

    expect(saved["monitorIds"]).toEqual([LATE_MONITOR_ID]);
  });

  test("an archived label is never offered, and one the form holds stays, marked Archived", async () => {
    await renderCard({
      incidentSeverityId: SEVERITY_ID,
      labelIds: [ARCHIVED_LABEL_ID],
    });
    await openSettings();
    await openStep(1);

    await waitFor(() => {
      expect(chipsOf(picker(/^Labels/))).toEqual(["customer-old"]);
    });
    expect(
      within(modal()).getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.focus(picker(/^Labels/));
      fireEvent.change(picker(/^Labels/), { target: { value: "customer" } });
    });

    await within(modal()).findByRole("option", { name: /customer-report/ });

    expect(
      within(modal()).queryByRole("option", { name: /customer-old/ }),
    ).not.toBeInTheDocument();

    // The search asked for live labels only.
    expect(
      server
        .callsFor(Label)
        .some((call: { query: Record<string, unknown> }): boolean => {
          return (
            call.query["name"] instanceof Search &&
            call.query["isArchived"] === false
          );
        }),
    ).toBe(true);

    const saved: JSONObject = await save();

    expect(saved["labelIds"]).toEqual([ARCHIVED_LABEL_ID]);
  });
});

describe("the short lists", () => {
  test("a severity deleted since reads Deleted, and the save keeps it unless it is changed", async () => {
    await renderCard({ incidentSeverityId: DELETED_SEVERITY_ID });
    await openSettings();

    expect(
      within(modal()).getByText(FormsCopy.deletedRecord),
    ).toBeInTheDocument();

    const saved: JSONObject = await save();

    expect(saved["incidentSeverityId"]).toBe(DELETED_SEVERITY_ID);
  });
});
