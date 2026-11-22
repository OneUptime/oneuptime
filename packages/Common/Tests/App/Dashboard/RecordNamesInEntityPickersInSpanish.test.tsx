// UX rule: Docs/ux/README.md#in-every-language
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
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import { getFormSettingsFields } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormSettingsEditor";
import { toDropdownOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData";
import { toSeverityDropdownOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateSideOver";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import { FormTargetSettingReferenceModel } from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";
import { getValueChoiceOptions } from "../../../UI/Components/BulkUpdate/ValueChangeActions";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import Field from "../../../UI/Components/Forms/Types/Field";
import { JSONObject } from "../../../Types/JSON";
import { createTranslator } from "../../../Types/Translator";
import { StateListType } from "../../../Utils/StateOrder";
import { isRecordNameAsWritten } from "../../../Utils/DefaultRecordNames";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A PICKER'S OPTION DRAWS A RECORD'S NAME AS WRITTEN, AND A DEFAULT NAME IN
 * THE READER'S LANGUAGE (#8065).
 *
 * Options built by hand from records said nothing, so a Dropdown looked
 * their labels up: a label named "Network" read "Red" in Spanish, a state
 * named "Open" the verb "Abrir". EntityDropdown drew every entry as
 * written, so the default "Resolved" stayed English in its list while it
 * read "Resuelto" everywhere else. Drawn here with the Dashboard's real
 * Spanish words.
 */

const SPANISH: Record<string, string> = readDashboardLocale("es");

let spanishInstance: i18n | null = null;

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

/*
 * Lets a dropdown of a table run its search - it waits a quarter of a
 * second after it opens or the search changes - and settle.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 300);
    });

    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// Opens an EntityDropdown's list and reads what it offers.
async function entityDropdownListed(): Promise<Array<string>> {
  fireEvent.focus(screen.getByRole("combobox"));
  await flush();

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return (option.textContent || "").trim();
  });
}

// Opens a Dropdown's menu and reads what it offers.
function dropdownListed(): Array<string> {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return (option.textContent || "").trim();
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the words the cases below lean on", () => {
  test("Spanish words Network, Open and Resolved its own way", () => {
    expect({
      Network: SPANISH["Network"],
      Open: SPANISH["Open"],
      Resolved: SPANISH["Resolved"],
      "Critical Incident": SPANISH["Critical Incident"],
      High: SPANISH["High"],
    }).toEqual({
      Network: "Red",
      Open: "Abrir",
      Resolved: "Resuelto",
      "Critical Incident": "Incidente crítico",
      High: "Alta",
    });
  });
});

describe("an EntityDropdown of a record's table", () => {
  // As a form hands it the options it fetched: no mark of their own.
  const STATE_OPTIONS: Array<DropdownOption> = [
    { value: "s-1", label: "Resolved" },
    { value: "s-2", label: "Open" },
  ];

  test("of incident states: the default Resolved reads Resuelto, the project's Open as written", async () => {
    renderInSpanish(
      <EntityDropdown
        ariaLabel="State"
        modelType={IncidentState}
        options={STATE_OPTIONS}
      />,
    );

    const listed: Array<string> = await entityDropdownListed();

    expect(listed).toEqual(expect.arrayContaining(["Resuelto", "Open"]));
    expect(listed).not.toContain("Abrir");
    expect(listed).not.toContain("Resolved");
  });

  test("of labels: a label named Network reads Network, and one named Resolved too", async () => {
    renderInSpanish(
      <EntityDropdown
        ariaLabel="Labels"
        modelType={Label}
        options={[
          { value: "l-1", label: "Network" },
          { value: "l-2", label: "Resolved" },
        ]}
      />,
    );

    const listed: Array<string> = await entityDropdownListed();

    expect(listed).toEqual(expect.arrayContaining(["Network", "Resolved"]));
    expect(listed).not.toContain("Red");
    expect(listed).not.toContain("Resuelto");
  });

  test("a picked default reads in Spanish as the value too", async () => {
    renderInSpanish(
      <EntityDropdown
        ariaLabel="State"
        modelType={IncidentState}
        options={STATE_OPTIONS}
        value="s-1"
      />,
    );
    await flush();

    expect(screen.getByTestId("entity-dropdown-value")).toHaveTextContent(
      "Resuelto",
    );
  });

  test("the reader finds the default by the word they read, and by the English", async () => {
    renderInSpanish(
      <EntityDropdown
        ariaLabel="State"
        modelType={IncidentState}
        options={STATE_OPTIONS}
      />,
    );

    const input: HTMLElement = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Resu" } });
    await flush();

    expect(
      screen.getAllByRole("option").map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      }),
    ).toEqual(["Resuelto"]);
  });

  test("an option that says how it reads reads so, whatever the table", async () => {
    renderInSpanish(
      <EntityDropdown
        ariaLabel="State"
        modelType={IncidentState}
        options={[
          { value: "s-1", label: "Resolved", isUserContent: true },
          { value: "s-2", label: "Network", isUserContent: false },
        ]}
      />,
    );

    const listed: Array<string> = await entityDropdownListed();

    expect(listed).toEqual(expect.arrayContaining(["Resolved", "Red"]));
  });
});

describe("an EntityDropdown of static options, of no table", () => {
  test("draws each label as written, as it always did", async () => {
    renderInSpanish(
      <EntityDropdown
        ariaLabel="Repository"
        options={[
          { value: "r-1", label: "Network" },
          { value: "r-2", label: "Open" },
        ]}
      />,
    );

    const listed: Array<string> = await entityDropdownListed();

    expect(listed).toEqual(expect.arrayContaining(["Network", "Open"]));
    expect(listed).not.toContain("Red");
    expect(listed).not.toContain("Abrir");
  });
});

describe("options built by hand", () => {
  test("a bulk value change's severities: the default Critical Incident in Spanish, Network as written", () => {
    renderInSpanish(
      <Dropdown
        ariaLabel="Severity"
        options={getValueChoiceOptions({
          values: [
            { id: "v-1", name: "Critical Incident" },
            { id: "v-2", name: "Network" },
          ],
          translator: createTranslator(undefined, "es"),
          valueTableName: "IncidentSeverity",
        })}
      />,
    );

    expect(dropdownListed()).toEqual(["Incidente crítico", "Network"]);
  });

  test("a bulk value change of no table draws every name as written", () => {
    const options: Array<DropdownOption> = getValueChoiceOptions({
      values: [{ id: "v-1", name: "Network" }],
      translator: createTranslator(undefined, "es"),
    });

    expect(options[0]).toMatchObject({ label: "Network", isUserContent: true });
  });

  test("a form's On Submit settings read each record by its own list", () => {
    expect(
      toDropdownOptions(
        [{ id: "1", name: "Critical Incident" }],
        FormTargetSettingReferenceModel.IncidentSeverity,
      )[0],
    ).toMatchObject({ isUserContent: false });
    // An incident template named as a default severity is the project's own.
    expect(
      toDropdownOptions(
        [{ id: "2", name: "Critical Incident" }],
        FormTargetSettingReferenceModel.IncidentTemplate,
      )[0],
    ).toMatchObject({ isUserContent: true });
    expect(
      toDropdownOptions(
        [{ id: "3", name: "Network" }],
        FormTargetSettingReferenceModel.Label,
      )[0],
    ).toMatchObject({ isUserContent: true });
  });

  test("the settings form hands each field its records' list", () => {
    const lists: Record<
      FormTargetSettingReferenceModel,
      Array<JSONObject>
    > = {} as Record<FormTargetSettingReferenceModel, Array<JSONObject>>;

    for (const model of Object.values(FormTargetSettingReferenceModel)) {
      lists[model] = [{ id: `${model}-1`, name: "Critical Incident" }];
    }

    const fields: Array<Field<JSONObject>> = getFormSettingsFields({
      targetType: FormTargetType.Incident,
      reference: {
        lists: lists as never,
        templateIdsWithSeverity: [],
      },
    });

    const marks: Record<string, boolean | undefined> = {};

    for (const field of fields) {
      const option: DropdownOption | undefined = (
        field.dropdownOptions as Array<DropdownOption> | undefined
      )?.[0];

      if (option) {
        marks[Object.keys(field.field || {})[0]!] = option.isUserContent;
      }
    }

    // Only the severity is a list a new project starts with names in.
    expect(marks["incidentSeverityId"]).toBe(false);
    expect(marks["incidentTemplateId"]).toBe(true);

    /*
     * What is always attached is searched on the server (#10646): the
     * picker reads each name by its own table (EntityDropdown), so a monitor
     * or a label called "Critical Incident" is drawn as written.
     */
    const tableOf: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      const modelType:
        | { new (): { tableName?: string | undefined } }
        | undefined = fields.find((field: Field<JSONObject>): boolean => {
        return Object.keys(field.field || {})[0] === key;
      })?.dropdownModal?.type as never;

      return modelType ? new modelType().tableName : undefined;
    };

    expect(tableOf("monitorIds")).toBe("Monitor");
    expect(tableOf("labelIds")).toBe("Label");
    expect(isRecordNameAsWritten("Monitor", "Critical Incident")).toBe(true);
    expect(isRecordNameAsWritten("Label", "Critical Incident")).toBe(true);
  });

  test("a recommendation's severity rows read by their own list: High is an alert's default, an incident's own", () => {
    const severities: Array<{ id: ObjectID; name: string }> = [
      { id: ObjectID.generate(), name: "High" },
      { id: ObjectID.generate(), name: "Critical Incident" },
    ];

    expect(
      toSeverityDropdownOptions(
        severities as never,
        StateListType.AlertSeverity,
      ).map((option: DropdownOption): boolean | undefined => {
        return option.isUserContent;
      }),
    ).toEqual([false, true]);
    expect(
      toSeverityDropdownOptions(
        severities as never,
        StateListType.IncidentSeverity,
      ).map((option: DropdownOption): boolean | undefined => {
        return option.isUserContent;
      }),
    ).toEqual([true, false]);
  });
});
