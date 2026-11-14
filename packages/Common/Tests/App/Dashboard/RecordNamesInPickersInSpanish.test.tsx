// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import BulkChangeStateModal from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/BulkChangeStateModal";
import { BulkStateChangeNoteType } from "../../../../App/FeatureSet/Dashboard/src/Utils/BulkStateChange";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Color from "../../../Types/Color";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import getJestMockFunction from "../../MockType";

/*
 * A PICKER BUILT FROM RECORDS DRAWS THEIR NAMES AS WRITTEN (#7782).
 *
 * DropdownUtil.getDropdownOptionsFromEntityArray built a form's options
 * from records - the monitor criteria form's labels and monitor statuses,
 * the bulk Change state dialog's states - and never said an option was a
 * name, so the Dropdown looked each one up: on a Spanish page a label named
 * "Network" read "Red", and a state a project named "Open" the verb
 * "Abrir". Each option now says how it reads by the one rule for a
 * record's name (Common/Utils/DefaultRecordNames): a name as written,
 * OneUptime's default names of the record's own table looked up -
 * "Operational" reads "Operativo", as its badge does.
 */

const SPANISH: Record<string, string> = readDashboardLocale("es");

let spanishInstance: i18n | null = null;

// The Dashboard's Spanish, English behind it, as it ships.
function spanishI18n(): i18n {
  if (spanishInstance) {
    return spanishInstance;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: SPANISH },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  spanishInstance = instance;

  return instance;
}

function renderInSpanish(element: ReactElement): void {
  render(<I18nextProvider i18n={spanishI18n()}>{element}</I18nextProvider>);
}

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const row: T = new modelType();
  row._id = id;
  row.setColumnValue("name", name);
  row.setColumnValue("color", new Color("#10b981"));
  return row;
}

function optionsOf(rows: Array<BaseModel>): Array<DropdownOption> {
  return DropdownUtil.getDropdownOptionsFromEntityArray({
    array: rows,
    labelField: "name",
    valueField: "_id",
  });
}

// What an open menu lists.
function listed(): Array<string> {
  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return (option.textContent || "").trim();
  });
}

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for Network, Open, Resolved and Operational", () => {
    expect({
      Network: SPANISH["Network"],
      Open: SPANISH["Open"],
      Resolved: SPANISH["Resolved"],
      Operational: SPANISH["Operational"],
      Identified: SPANISH["Identified"],
    }).toEqual({
      Network: "Red",
      Open: "Abrir",
      Resolved: "Resuelto",
      Operational: "Operativo",
      Identified: "Identificado",
    });
  });
});

describe("options built from records", () => {
  test("a default name of an incident state is looked up", () => {
    expect(
      optionsOf([named(IncidentState, "s-1", "Resolved")])[0],
    ).toMatchObject({ label: "Resolved", isUserContent: false });
  });

  test("a state the project named itself is a name", () => {
    expect(optionsOf([named(IncidentState, "s-2", "Open")])[0]).toMatchObject({
      label: "Open",
      isUserContent: true,
    });
  });

  test("the same word as a label's name is a name, never looked up", () => {
    expect(optionsOf([named(Label, "l-1", "Resolved")])[0]).toMatchObject({
      label: "Resolved",
      isUserContent: true,
    });
  });

  test("a default name is OneUptime's only in its own table: a monitor status named Resolved is the project's", () => {
    expect(
      optionsOf([named(MonitorStatus, "m-1", "Resolved")])[0],
    ).toMatchObject({ label: "Resolved", isUserContent: true });
    expect(
      optionsOf([named(MonitorStatus, "m-2", "Operational")])[0],
    ).toMatchObject({ label: "Operational", isUserContent: false });
  });

  test("each option keeps its colour", () => {
    expect(optionsOf([named(Label, "l-2", "Network")])[0]!.color).toEqual(
      new Color("#10b981"),
    );
  });
});

describe("the monitor criteria form's pickers, on a Spanish page", () => {
  async function openMenuOf(options: Array<DropdownOption>): Promise<void> {
    renderInSpanish(<Dropdown onChange={() => {}} options={options} />);

    await act(async (): Promise<void> => {
      fireEvent.keyDown(screen.getByRole("combobox"), {
        key: "ArrowDown",
        code: "ArrowDown",
      });
    });
  }

  test("the labels picker lists a label named Network as Network, never Red", async () => {
    await openMenuOf(
      optionsOf([
        named(Label, "l-1", "Network"),
        named(Label, "l-2", "Checkout"),
      ]),
    );

    expect(listed()).toEqual(["Network", "Checkout"]);
  });

  test("the monitor status picker reads Operativo for the default Operational, and Open for a status the project named Open", async () => {
    await openMenuOf(
      optionsOf([
        named(MonitorStatus, "m-1", "Operational"),
        named(MonitorStatus, "m-2", "Open"),
      ]),
    );

    expect(listed()).toEqual(["Operativo", "Open"]);
  });
});

describe("the bulk Change state dialog, on a Spanish page", () => {
  test("offers a new project's states in Spanish, and a state the project named Open as written", async () => {
    renderInSpanish(
      <BulkChangeStateModal
        title="Change Incident State"
        description="Select the state to change incidents to."
        stateFieldKey="incidentStateId"
        stateOptions={optionsOf([
          named(IncidentState, "identified", "Identified"),
          named(IncidentState, "open", "Open"),
          named(IncidentState, "resolved", "Resolved"),
        ])}
        noteType={BulkStateChangeNoteType.Public}
        noteTitle="Public Note"
        noteDescription="Post a public note about this state change."
        noteTemplates={[]}
        onClose={getJestMockFunction()}
        onSubmit={async (): Promise<void> => {}}
      />,
    );

    const picker: HTMLElement = await within(
      screen.getByTestId("modal"),
    ).findByRole("combobox");

    await act(async (): Promise<void> => {
      fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    });

    expect(listed()).toEqual(["Identificado", "Open", "Resuelto"]);
  });
});
