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
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE "SELECT ITEMS BY LABELS" DIALOG DRAWS NAMES AS WRITTEN (#7782).
 *
 * A form's pick of records that carry labels - an incident's monitors - has
 * a "Select items by Labels" link, which opens a dialog listing the records
 * under their labels. Each record's name reached its checkbox as a title,
 * and the checkbox looked every title up in the reader's language: on a
 * Spanish page a monitor named "Network" read "Red", one named "Website"
 * "Sitio web", and the label "Production" over them "Producción". A
 * record's name is its owner's and now reads as written, by the one rule for
 * a record's name (Common/Utils/DefaultRecordNames).
 *
 * The real ModelForm, BasicForm, FormField, Modal and CategoryCheckbox,
 * with the Dashboard's real Spanish; only the API is answered here.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: permissionsForTest };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

// The project's monitors, each with its labels, as the form's list reads them.
let monitorRows: Array<unknown> = [];

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (data: {
        modelType: { new (): { tableName: string | null } };
        limit: number;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        // Cross a task boundary, as a real request does.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        const rows: Array<unknown> =
          new data.modelType().tableName === "Monitor" ? monitorRows : [];

        return { data: rows, count: rows.length, skip: 0, limit: data.limit };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Color from "../../../../Types/Color";
import Permission from "../../../../Types/Permission";
import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";

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

function labelNamed(id: string, name: string): Label {
  const label: Label = new Label();
  label._id = id;
  label.name = name;
  label.color = new Color("#6366f1");
  return label;
}

function monitorNamed(id: string, name: string, labels: Array<Label>): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  monitor.labels = labels;
  return monitor;
}

async function openSelectByLabelsDialog(): Promise<HTMLElement> {
  await act(async (): Promise<void> => {
    render(
      <I18nextProvider i18n={spanishI18n()}>
        <ModelForm<Incident>
          modelType={Incident}
          name="Create Incident"
          id="create-incident-form"
          formType={FormType.Create}
          submitButtonText="Create"
          onSuccess={() => {}}
          fields={[
            {
              field: { monitors: true },
              title: "Monitors",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Monitor,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
            },
          ]}
        />
      </I18nextProvider>,
    );
  });

  const link: HTMLElement = await screen.findByText(
    "Seleccionar elementos por Etiquetas",
  );

  await act(async (): Promise<void> => {
    fireEvent.click(link);
  });

  return screen.getByTestId("modal");
}

// What each box in the dialog says, in its order.
function boxNames(dialog: HTMLElement): Array<string> {
  return within(dialog)
    .getAllByRole("checkbox")
    .map((box: HTMLElement): string => {
      const label: HTMLElement | null = dialog.querySelector(
        `label[for="${box.id}"]`,
      );

      return (label?.textContent || "").trim();
    });
}

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for Network, Website, Production and the link", () => {
    expect({
      Network: SPANISH["Network"],
      Website: SPANISH["Website"],
      Production: SPANISH["Production"],
      Labels: SPANISH["Labels"],
      link: SPANISH["Select items by {{column}}"],
    }).toEqual({
      Network: "Red",
      Website: "Sitio web",
      Production: "Producción",
      Labels: "Etiquetas",
      link: "Seleccionar elementos por {{column}}",
    });
  });
});

describe("Select items by Labels, on a Spanish page", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();

    const production: Label = labelNamed(
      "0193c0de-0000-4aaa-8bbb-00000000000a",
      "Production",
    );
    const network: Label = labelNamed(
      "0193c0de-0000-4aaa-8bbb-00000000000b",
      "Network",
    );

    monitorRows = [
      monitorNamed("0193c0de-0000-4aaa-8bbb-000000000001", "Network", [
        production,
      ]),
      monitorNamed("0193c0de-0000-4aaa-8bbb-000000000002", "Website", [
        production,
        network,
      ]),
      monitorNamed("0193c0de-0000-4aaa-8bbb-000000000003", "Database", []),
    ];
  });

  afterEach(() => {
    cleanup();
  });

  test("lists each monitor under its labels, every name as written", async () => {
    const dialog: HTMLElement = await openSelectByLabelsDialog();

    await waitFor(() => {
      expect(within(dialog).getAllByRole("checkbox").length).toBeGreaterThan(0);
    });

    expect(boxNames(dialog)).toEqual([
      // The monitors with no label first, then each label over its own.
      "Database",
      "Network",
      "Website",
      "Production",
      "Network",
      "Website",
    ]);
    expect(dialog).not.toHaveTextContent("Red");
    expect(dialog).not.toHaveTextContent("Sitio web");
    expect(dialog).not.toHaveTextContent("Producción");
  });
});
