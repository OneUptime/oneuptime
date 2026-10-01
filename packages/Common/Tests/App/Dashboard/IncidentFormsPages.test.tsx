import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";

/*
 * Incidents > Settings > Forms (issue #4114): the list of incident forms, and
 * a form's own page.
 *
 *   - the list manages the project's IncidentForm rows and creates a form in
 *     two steps - its details, then what its incidents start with, where the
 *     severity is required (ModelForm never reads a column's own "required",
 *     and the server refuses a form without one);
 *   - a form's page has one card per thing an admin decides - Form Details,
 *     Share Link, Incident Settings, Form Settings, Questions, Access,
 *     Submissions - and a Delete that goes back to the list.
 *
 * The tables, cards and the delete card are stubbed and their props
 * recorded; the Share Link and Questions cards have suites of their own
 * (IncidentFormShareLinkCard.test.tsx, IncidentCustomFieldSettingsCard.test.tsx).
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedDetailCards: Array<Record<string, unknown>> = [];
const recordedDeletes: Array<Record<string, unknown>> = [];
const recordedShareLinkCards: Array<Record<string, unknown>> = [];
const recordedSettingsCards: Array<Record<string, unknown>> = [];

let mockIpAllowlistEditable: boolean = true;

let mockTranslate: (value: string) => string = (value: string): string => {
  return value;
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", {
        "data-testid": `table-${String(props["name"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedDetailCards.push(props);
      return React.createElement("div", {
        "data-testid": `card-${String(props["name"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedDeletes.push(props);
      return React.createElement("div", { "data-testid": "model-delete" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormShareLinkCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        recordedShareLinkCards.push(props);
        return React.createElement("div", {
          "data-testid": "share-link-card",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldSettingsCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        recordedSettingsCards.push(props);
        return React.createElement("div", {
          "data-testid": "questions-card",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormPlan",
  () => {
    return {
      __esModule: true,
      isIncidentFormIpAllowlistEditableOnCurrentPlan: (): boolean => {
        return mockIpAllowlistEditable;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return typeof value === "string" && value
            ? mockTranslate(value)
            : value;
        },
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" && value
            ? mockTranslate(value)
            : value;
        },
      };
    },
  };
});

import IncidentForms from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentForms";
import IncidentFormView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentFormView";
import IncidentFormCopy from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormCopy";
import {
  getIncidentFormDescriptionSettingLabel,
  INCIDENT_FORM_DESCRIPTION_SETTING_OPTIONS,
  INCIDENT_FORM_DETAILS_STEP_ID,
  INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormFields";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentFormSubmission from "../../../Models/DatabaseModels/IncidentFormSubmission";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { IncidentFormFieldSetting } from "../../../Types/Incident/IncidentFormPublic";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000ff";
const INCIDENT_ID: string = "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8a9b";
const TEMPLATE_ID: string = "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a";

type NavigateSpy = ReturnType<typeof getJestSpyOn>;

let navigateSpy: NavigateSpy;

beforeEach(() => {
  mockIpAllowlistEditable = true;
  mockTranslate = (value: string): string => {
    return value;
  };

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(FORM_ID);
    });

  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  recordedTables.length = 0;
  recordedDetailCards.length = 0;
  recordedDeletes.length = 0;
  recordedShareLinkCards.length = 0;
  recordedSettingsCards.length = 0;
  jest.restoreAllMocks();
});

type Props = Record<string, unknown>;

function last(records: Array<Props>): Props {
  expect(records.length).toBeGreaterThan(0);
  return records[records.length - 1]!;
}

function tableNamed(name: string): Props {
  return last(
    recordedTables.filter((props: Props): boolean => {
      return props["name"] === name;
    }),
  );
}

function detailCardNamed(name: string): Props {
  return last(
    recordedDetailCards.filter((props: Props): boolean => {
      return props["name"] === name;
    }),
  );
}

function titlesOf(fields: unknown): Array<unknown> {
  return (fields as Array<Props>).map((field: Props): unknown => {
    return field["title"];
  });
}

function fieldFor(fields: unknown, column: string): Props {
  const found: Props | undefined = (fields as Array<Props>).find(
    (field: Props): boolean => {
      return Boolean(
        field["field"] && Object.keys(field["field"] as Props).includes(column),
      );
    },
  );

  expect(found).toBeDefined();
  return found!;
}

function columnsOf(fields: unknown): Array<string> {
  return (fields as Array<Props>).map((field: Props): string => {
    return Object.keys(field["field"] as Props)[0]!;
  });
}

function detailFields(card: Props): Array<Props> {
  return (card["modelDetailProps"] as Props)["fields"] as Array<Props>;
}

// A getElement, rendered where its links can resolve.
function renderElement(element: ReactElement): HTMLElement {
  return render(<MemoryRouter>{element}</MemoryRouter>).container;
}

function route(pageMapKey: string, modelId?: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[pageMapKey] as Route,
    modelId ? { modelId: new ObjectID(modelId) } : undefined,
  ).toString();
}

describe("the Incident Forms list", () => {
  async function renderList(): Promise<Props> {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <IncidentForms
            pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_FORMS] as Route}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });

    return tableNamed("Settings > Incident Forms");
  }

  test("manages the project's incident forms", async () => {
    const table: Props = await renderList();

    expect(table["modelType"]).toBe(IncidentForm);
    expect(String((table["query"] as Props)["projectId"])).toBe(PROJECT_ID);
    expect(Object.keys(table["query"] as Props)).toEqual(["projectId"]);
  });

  test("has ids of its own", async () => {
    const table: Props = await renderList();

    expect(table["id"]).toBe("incident-forms-table");
    expect(table["userPreferencesKey"]).toBe("incident-forms-table");
    expect(table["saveFilterProps"]).toEqual({
      tableId: "incident-forms-table",
    });
  });

  test("creates and opens forms; editing and deleting happen on a form's page", async () => {
    const table: Props = await renderList();

    expect(table["isCreateable"]).toBe(true);
    expect(table["isViewable"]).toBe(true);
    expect(table["isEditable"]).toBe(false);
    expect(table["isDeleteable"]).toBe(false);
  });

  test("a row opens the form's page, one segment under the list", async () => {
    const table: Props = await renderList();

    expect(String(table["viewPageRoute"])).toBe(
      `/dashboard/${PROJECT_ID}/incidents/settings/forms`,
    );
    expect(RouteMap[PageMap.INCIDENTS_SETTINGS_FORMS_VIEW]!.toString()).toBe(
      `${RouteMap[PageMap.INCIDENTS_SETTINGS_FORMS]!.toString()}/:id`,
    );
  });

  test("is the Incident Forms card, with the forms documentation", async () => {
    const table: Props = await renderList();

    expect(table["cardProps"]).toEqual({
      title: "Incident Forms",
      description: IncidentFormCopy.listDescription,
    });
    expect(table["noItemsMessage"]).toBe(IncidentFormCopy.listEmpty);
    expect(String(table["documentationLink"])).toBe("/docs/incidents/forms");
  });

  test("creates a form in two steps: its details, then its incidents", async () => {
    const table: Props = await renderList();

    expect(table["formSteps"]).toEqual([
      { title: "Form Details", id: INCIDENT_FORM_DETAILS_STEP_ID },
      {
        title: "Incident Settings",
        id: INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID,
      },
    ]);

    const fields: Array<Props> = table["formFields"] as Array<Props>;

    expect(
      fields.map((field: Props): Array<unknown> => {
        return [Object.keys(field["field"] as Props)[0], field["stepId"]];
      }),
    ).toEqual([
      ["name", INCIDENT_FORM_DETAILS_STEP_ID],
      ["description", INCIDENT_FORM_DETAILS_STEP_ID],
      ["incidentSeverity", INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID],
      ["incidentTemplate", INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID],
    ]);
  });

  test("a form needs a name", async () => {
    const name: Props = fieldFor((await renderList())["formFields"], "name");

    expect(name["title"]).toBe("Name");
    expect(name["fieldType"]).toBe(FormFieldSchemaType.Text);
    expect(name["required"]).toBe(true);
    expect(name["placeholder"]).toBe(IncidentFormCopy.namePlaceholder);
  });

  test("its description is Markdown, without image upload: the public page cannot show a private image", async () => {
    const description: Props = fieldFor(
      (await renderList())["formFields"],
      "description",
    );

    expect(description["fieldType"]).toBe(FormFieldSchemaType.Markdown);
    expect(description["required"]).toBe(false);
    expect(description["allowImageUpload"]).toBe(false);
  });

  /*
   * Regression guard: ModelForm never reads TableColumn.required, so without
   * required on the field the wizard would let a form through that
   * IncidentFormService then refuses with a message about a field the user
   * could not tell was needed.
   */
  test("the severity is required, picked from the project's incident severities", async () => {
    const severity: Props = fieldFor(
      (await renderList())["formFields"],
      "incidentSeverity",
    );

    expect(severity["title"]).toBe("Severity");
    expect(severity["required"]).toBe(true);
    expect(severity["fieldType"]).toBe(FormFieldSchemaType.Dropdown);
    expect(severity["dropdownModal"]).toEqual({
      type: IncidentSeverity,
      labelField: "name",
      valueField: "_id",
    });
    expect(severity["description"]).toBe(IncidentFormCopy.severityDescription);
  });

  test("the incident template is optional, picked by name, and warns what it sets off", async () => {
    const template: Props = fieldFor(
      (await renderList())["formFields"],
      "incidentTemplate",
    );

    expect(template["title"]).toBe("Incident Template");
    expect(template["required"]).toBe(false);
    expect(template["fieldType"]).toBe(FormFieldSchemaType.Dropdown);
    expect(template["dropdownModal"]).toEqual({
      type: IncidentTemplate,
      labelField: "templateName",
      valueField: "_id",
    });

    const warning: string = String(template["description"]);

    expect(warning).toBe(IncidentFormCopy.templateDescription);
    /*
     * In the server's order: the form's severity (or the reporter's) and the
     * reporter's answers win, and the template fills in the rest - not
     * "everything the template sets applies", which its severity never does
     * while the form has its own.
     */
    expect(warning).toContain(
      "The form's severity (or the one the reporter chooses) and the reporter's title, description and answers come first",
    );
    expect(warning).toContain("the template fills in everything else");
    expect(warning).not.toContain("everything the template sets applies");
    expect(warning).toContain("monitors");
    expect(warning).toContain("on-call policies");
    expect(warning).toContain("a monitor status change");
  });

  test("lists name, description and Enabled, and filters by them", async () => {
    const table: Props = await renderList();

    expect(columnsOf(table["columns"])).toEqual([
      "name",
      "description",
      "isEnabled",
    ]);
    expect(titlesOf(table["columns"])).toEqual([
      "Name",
      "Description",
      "Enabled",
    ]);

    const description: Props = fieldFor(table["columns"], "description");

    // Free text in a table cell wraps inside its column.
    expect(description["wrapContent"]).toBe(true);
    expect(fieldFor(table["columns"], "isEnabled")["type"]).toBe(
      FieldType.Boolean,
    );

    expect(columnsOf(table["filters"])).toEqual([
      "name",
      "description",
      "isEnabled",
    ]);
    expect(fieldFor(table["filters"], "isEnabled")["type"]).toBe(
      FieldType.Boolean,
    );
  });
});

describe("a form's page", () => {
  async function renderView(): Promise<void> {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <IncidentFormView
            pageRoute={RouteMap[PageMap.INCIDENTS_SETTINGS_FORMS_VIEW] as Route}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });
  }

  function formDetails(): Props {
    return detailCardNamed("Incident Form > Form Details");
  }

  function incidentSettings(): Props {
    return detailCardNamed("Incident Form > Incident Settings");
  }

  function formSettings(): Props {
    return detailCardNamed("Incident Form > Form Settings");
  }

  function access(): Props {
    return detailCardNamed("Incident Form > Access");
  }

  function submissions(): Props {
    return tableNamed("Incident Form > Submissions");
  }

  test("has its cards in the order a new form is set up", async () => {
    await renderView();

    const order: Array<string> = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid]"),
    ).map((element: HTMLElement): string => {
      return element.getAttribute("data-testid") || "";
    });

    expect(order).toEqual([
      "card-Incident Form > Form Details",
      "share-link-card",
      "card-Incident Form > Incident Settings",
      "card-Incident Form > Form Settings",
      "questions-card",
      "card-Incident Form > Access",
      "table-Incident Form > Submissions",
      "model-delete",
    ]);
  });

  test("every card is about this form", async () => {
    await renderView();

    for (const card of [
      formDetails(),
      incidentSettings(),
      formSettings(),
      access(),
    ]) {
      const detail: Props = card["modelDetailProps"] as Props;

      expect(detail["modelType"]).toBe(IncidentForm);
      expect(String(detail["modelId"])).toBe(FORM_ID);
      expect(card["isEditable"]).toBe(true);
      /*
       * Detail sizes a field at 1/n of the card whatever its colSpan: two
       * columns squeezed the description and the success message to half
       * width, and every field to half a phone.
       */
      expect(detail["showDetailsInNumberOfColumns"]).toBe(1);
    }

    expect(String(last(recordedShareLinkCards)["modelId"])).toBe(FORM_ID);
    expect(String(last(recordedSettingsCards)["modelId"])).toBe(FORM_ID);
    expect(String(last(recordedDeletes)["modelId"])).toBe(FORM_ID);
  });

  /*
   * A CardModelDetail writes every field it holds when saved: a column held
   * by two cards would be overwritten by whichever was saved last.
   */
  test("no column is edited by two cards", async () => {
    await renderView();

    const edited: Array<string> = [
      formDetails(),
      incidentSettings(),
      formSettings(),
      access(),
    ].flatMap((card: Props): Array<string> => {
      return columnsOf(card["formFields"]);
    });

    expect(edited).toEqual(Array.from(new Set(edited)));
    expect(edited.sort()).toEqual(
      [
        "allowReporterToChooseSeverity",
        "description",
        "descriptionSetting",
        "incidentSeverity",
        "incidentTemplate",
        "ipWhitelist",
        "isEnabled",
        "isReporterDetailsRequired",
        "name",
        "successMessage",
      ].sort(),
    );
    // The questions and the link have cards of their own.
    expect(edited).not.toContain("customFieldSettings");
    expect(edited).not.toContain("shareKey");
  });

  describe("Form Details", () => {
    test("edits the name, the description and Enabled", async () => {
      await renderView();

      const card: Props = formDetails();

      expect((card["cardProps"] as Props)["title"]).toBe("Form Details");
      expect(card["editButtonText"]).toBe("Edit Form Details");
      expect(columnsOf(card["formFields"])).toEqual([
        "name",
        "description",
        "isEnabled",
      ]);
      expect(fieldFor(card["formFields"], "name")["required"]).toBe(true);
      expect(
        fieldFor(card["formFields"], "description")["allowImageUpload"],
      ).toBe(false);

      const enabled: Props = fieldFor(card["formFields"], "isEnabled");

      expect(enabled["title"]).toBe("Enabled");
      expect(enabled["fieldType"]).toBe(FormFieldSchemaType.Toggle);
      expect(enabled["description"]).toBe(IncidentFormCopy.enabledDescription);
    });

    test("shows the form's id, name, Enabled and description", async () => {
      await renderView();

      const fields: Array<Props> = detailFields(formDetails());

      expect(columnsOf(fields)).toEqual([
        "_id",
        "name",
        "isEnabled",
        "description",
      ]);
      expect(titlesOf(fields)).toEqual([
        "Incident Form ID",
        "Name",
        "Enabled",
        "Description",
      ]);
      expect(fieldFor(fields, "_id")["fieldType"]).toBe(FieldType.ObjectID);
      expect(fieldFor(fields, "isEnabled")["fieldType"]).toBe(
        FieldType.Boolean,
      );
      expect(fieldFor(fields, "description")["fieldType"]).toBe(
        FieldType.Markdown,
      );
    });

    test("saving it asks the Share Link card to read the form again", async () => {
      await renderView();

      expect(last(recordedShareLinkCards)["refresher"]).toBe(false);

      await act(async (): Promise<void> => {
        (formDetails()["onSaveSuccess"] as () => void)();
      });

      expect(last(recordedShareLinkCards)["refresher"]).toBe(true);

      await act(async (): Promise<void> => {
        (formDetails()["onSaveSuccess"] as () => void)();
      });

      expect(last(recordedShareLinkCards)["refresher"]).toBe(false);
    });
  });

  describe("Incident Settings", () => {
    test("edits the severity (required), Let Reporter Choose Severity and the template", async () => {
      await renderView();

      const card: Props = incidentSettings();

      expect((card["cardProps"] as Props)["title"]).toBe("Incident Settings");
      expect(card["editButtonText"]).toBe("Edit Incident Settings");
      expect(columnsOf(card["formFields"])).toEqual([
        "incidentSeverity",
        "allowReporterToChooseSeverity",
        "incidentTemplate",
      ]);

      // The server refuses clearing it: the edit form must not allow it.
      expect(fieldFor(card["formFields"], "incidentSeverity")["required"]).toBe(
        true,
      );
      expect(fieldFor(card["formFields"], "incidentTemplate")["required"]).toBe(
        false,
      );

      const choose: Props = fieldFor(
        card["formFields"],
        "allowReporterToChooseSeverity",
      );

      expect(choose["title"]).toBe("Let Reporter Choose Severity");
      expect(choose["fieldType"]).toBe(FormFieldSchemaType.Toggle);
    });

    test("warns, on the card and in the edit form, what a template sets off", async () => {
      await renderView();

      const card: Props = incidentSettings();
      const cardDescription: string = String(
        (card["cardProps"] as Props)["description"],
      );

      expect(cardDescription).toBe(
        IncidentFormCopy.incidentSettingsDescription,
      );
      // Which comes first, next to the severity the card shows.
      expect(cardDescription).toContain(
        "the form's severity (or the one the reporter chooses) and the reporter's title, description and answers come first",
      );
      expect(cardDescription).toContain(
        "the template fills in everything else",
      );
      expect(cardDescription).not.toContain(
        "everything the template sets applies",
      );
      expect(cardDescription).toContain(
        "including its monitors, on-call policies and a monitor status change",
      );
      expect(
        fieldFor(card["formFields"], "incidentTemplate")["description"],
      ).toBe(IncidentFormCopy.templateDescription);
    });

    test("shows the severity as a pill", async () => {
      await renderView();

      const severityField: Props = fieldFor(
        detailFields(incidentSettings()),
        "incidentSeverity",
      );

      expect(severityField["title"]).toBe("Severity");

      const form: IncidentForm = new IncidentForm();
      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "Critical";
      severity.color = new Color("#ff0000");
      form.incidentSeverity = severity;

      const container: HTMLElement = renderElement(
        (severityField["getElement"] as (item: IncidentForm) => ReactElement)(
          form,
        ),
      );

      expect(container).toHaveTextContent("Critical");
      expect(
        container.querySelector('[data-testid="incident-form-no-severity"]'),
      ).toBeNull();
    });

    test("a form whose severity was deleted says it has none", async () => {
      await renderView();

      const severityField: Props = fieldFor(
        detailFields(incidentSettings()),
        "incidentSeverity",
      );

      const container: HTMLElement = renderElement(
        (severityField["getElement"] as (item: IncidentForm) => ReactElement)(
          new IncidentForm(),
        ),
      );

      expect(
        container.querySelector('[data-testid="incident-form-no-severity"]'),
      ).toHaveTextContent("No severity");
    });

    test("links the template to its own page", async () => {
      await renderView();

      const templateField: Props = fieldFor(
        detailFields(incidentSettings()),
        "incidentTemplate",
      );

      const form: IncidentForm = new IncidentForm();
      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.templateName = "Customer data exposure";
      form.incidentTemplate = template;

      const container: HTMLElement = renderElement(
        (templateField["getElement"] as (item: IncidentForm) => ReactElement)(
          form,
        ),
      );

      const link: HTMLAnchorElement | null = container.querySelector("a");

      expect(link).toHaveTextContent("Customer data exposure");
      expect(link!.getAttribute("href")).toBe(
        route(PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW, TEMPLATE_ID),
      );
    });

    test("a form without a template says None", async () => {
      await renderView();

      const templateField: Props = fieldFor(
        detailFields(incidentSettings()),
        "incidentTemplate",
      );

      const container: HTMLElement = renderElement(
        (templateField["getElement"] as (item: IncidentForm) => ReactElement)(
          new IncidentForm(),
        ),
      );

      expect(container).toHaveTextContent("None");
      expect(container.querySelector("a")).toBeNull();
    });
  });

  describe("Form Settings", () => {
    test("edits the description question (required), Require Reporter Details and the success message", async () => {
      await renderView();

      const card: Props = formSettings();

      expect((card["cardProps"] as Props)["title"]).toBe("Form Settings");
      expect(card["editButtonText"]).toBe("Edit Form Settings");
      expect(columnsOf(card["formFields"])).toEqual([
        "descriptionSetting",
        "isReporterDetailsRequired",
        "successMessage",
      ]);

      const question: Props = fieldFor(
        card["formFields"],
        "descriptionSetting",
      );

      expect(question["title"]).toBe("Description Question");
      expect(question["fieldType"]).toBe(FormFieldSchemaType.Dropdown);
      // NOT NULL: a cleared dropdown would be refused by the server.
      expect(question["required"]).toBe(true);
      expect(
        (question["dropdownOptions"] as Array<DropdownOption>).map(
          (option: DropdownOption): Array<unknown> => {
            return [option.label, option.value];
          },
        ),
      ).toEqual([
        ["Required", IncidentFormFieldSetting.Required],
        ["Optional", IncidentFormFieldSetting.Optional],
        ["Hidden", IncidentFormFieldSetting.Hidden],
      ]);
      expect(question["dropdownOptions"]).toBe(
        INCIDENT_FORM_DESCRIPTION_SETTING_OPTIONS,
      );

      const details: Props = fieldFor(
        card["formFields"],
        "isReporterDetailsRequired",
      );

      expect(details["title"]).toBe("Require Reporter Details");
      expect(details["fieldType"]).toBe(FormFieldSchemaType.Toggle);

      const success: Props = fieldFor(card["formFields"], "successMessage");

      expect(success["title"]).toBe("Success Message");
      expect(success["fieldType"]).toBe(FormFieldSchemaType.Markdown);
      expect(success["allowImageUpload"]).toBe(false);
    });

    test("shows the description question in words, translated", async () => {
      mockTranslate = (value: string): string => {
        return `[de] ${value}`;
      };

      await renderView();

      const question: Props = fieldFor(
        detailFields(formSettings()),
        "descriptionSetting",
      );

      const form: IncidentForm = new IncidentForm();
      form.descriptionSetting = IncidentFormFieldSetting.Hidden;

      const container: HTMLElement = renderElement(
        (question["getElement"] as (item: IncidentForm) => ReactElement)(form),
      );

      expect(container).toHaveTextContent("[de] Hidden");
    });

    test("a description question that was not read shows as the default, Optional", () => {
      expect(getIncidentFormDescriptionSettingLabel(undefined)).toBe(
        "Optional",
      );
      expect(getIncidentFormDescriptionSettingLabel("Sometimes")).toBe(
        "Optional",
      );
      expect(getIncidentFormDescriptionSettingLabel("Required")).toBe(
        "Required",
      );
      expect(getIncidentFormDescriptionSettingLabel("Hidden")).toBe("Hidden");
    });
  });

  describe("Questions", () => {
    test("is the custom field settings card, in form mode, with its own title", async () => {
      await renderView();

      const card: Props = last(recordedSettingsCards);

      expect(card["mode"]).toBe("form");
      expect(card["modelType"]).toBe(IncidentForm);
      expect(card["title"]).toBeUndefined();
      expect(card["description"]).toBeUndefined();
    });
  });

  describe("Access", () => {
    test("edits the IP allowlist, one address or range per line", async () => {
      await renderView();

      const card: Props = access();

      expect((card["cardProps"] as Props)["title"]).toBe("Access");
      expect(card["editButtonText"]).toBe("Edit IP Allowlist");
      expect(columnsOf(card["formFields"])).toEqual(["ipWhitelist"]);

      const allowlist: Props = fieldFor(card["formFields"], "ipWhitelist");

      expect(allowlist["title"]).toBe("IP Allowlist");
      expect(allowlist["fieldType"]).toBe(FormFieldSchemaType.LongText);
      expect(allowlist["description"]).toBe(
        IncidentFormCopy.ipAllowlistDescription,
      );
    });

    test("shows each address or range on its own line", async () => {
      await renderView();

      const allowlist: Props = fieldFor(detailFields(access()), "ipWhitelist");
      const form: IncidentForm = new IncidentForm();
      form.ipWhitelist = "203.0.113.0/24\n198.51.100.7\n";

      const container: HTMLElement = renderElement(
        (allowlist["getElement"] as (item: IncidentForm) => ReactElement)(form),
      );

      const shown: HTMLElement = container.querySelector(
        '[data-testid="incident-form-ip-allowlist"]',
      ) as HTMLElement;

      expect(shown.textContent).toBe("203.0.113.0/24\n198.51.100.7");
      expect(shown.className).toContain("whitespace-pre-line");
    });

    test("an empty allowlist says any network may open the form", async () => {
      await renderView();

      const allowlist: Props = fieldFor(detailFields(access()), "ipWhitelist");

      for (const value of [undefined, "", "  \n "]) {
        const form: IncidentForm = new IncidentForm();

        if (value !== undefined) {
          form.ipWhitelist = value;
        }

        const container: HTMLElement = renderElement(
          (allowlist["getElement"] as (item: IncidentForm) => ReactElement)(
            form,
          ),
        );

        expect(container).toHaveTextContent("Any network");
        expect(
          container.querySelector('[data-testid="incident-form-ip-allowlist"]'),
        ).toBeNull();

        cleanup();
      }
    });

    test("says nothing about the plan when it allows the change", async () => {
      mockIpAllowlistEditable = true;

      await renderView();

      const card: Props = access();

      expect((card["cardProps"] as Props)["description"]).toBe(
        IncidentFormCopy.accessDescription,
      );
      expect(fieldFor(card["formFields"], "ipWhitelist")["description"]).toBe(
        IncidentFormCopy.ipAllowlistDescription,
      );
    });

    test("says, on the card and in the edit form, that the change needs the Scale plan", async () => {
      mockIpAllowlistEditable = false;
      mockTranslate = (value: string): string => {
        return `[de] ${value}`;
      };

      await renderView();

      const card: Props = access();

      for (const description of [
        (card["cardProps"] as Props)["description"],
        fieldFor(card["formFields"], "ipWhitelist")["description"],
      ]) {
        const container: HTMLElement = renderElement(
          description as ReactElement,
        );

        expect(
          container.querySelector(
            '[data-testid="incident-form-ip-allowlist-plan-note"]',
          ),
        ).toHaveTextContent(
          "[de] Editing the IP allowlist needs the Scale plan.",
        );

        cleanup();
      }

      expect(IncidentFormCopy.accessPlanNote).toContain("Scale plan");
    });
  });

  describe("Submissions", () => {
    test("lists this form's submissions, newest first", async () => {
      await renderView();

      const table: Props = submissions();
      const query: Props = table["query"] as Props;

      expect(table["modelType"]).toBe(IncidentFormSubmission);
      expect(String(query["incidentFormId"])).toBe(FORM_ID);
      expect(String(query["projectId"])).toBe(PROJECT_ID);
      expect(table["sortBy"]).toBe("createdAt");
      expect(table["sortOrder"]).toBe(SortOrder.Descending);
      expect(table["id"]).toBe("incident-form-submissions-table");
      expect(table["userPreferencesKey"]).toBe(
        "incident-form-submissions-table",
      );
    });

    test("cannot be created or edited, only deleted (as permissions allow)", async () => {
      await renderView();

      const table: Props = submissions();

      expect(table["isCreateable"]).toBe(false);
      expect(table["isEditable"]).toBe(false);
      expect(table["isViewable"]).toBe(false);
      expect(table["isDeleteable"]).toBe(true);
      expect(table["formFields"]).toBeUndefined();
    });

    test("shows when, who and which incident", async () => {
      await renderView();

      const table: Props = submissions();

      expect(titlesOf(table["columns"])).toEqual([
        "Submitted At",
        "Reporter Name",
        "Reporter Email",
        "Incident",
      ]);
      expect(columnsOf(table["columns"])).toEqual([
        "createdAt",
        "reporterName",
        "reporterEmail",
        "incident",
      ]);
      expect(fieldFor(table["columns"], "createdAt")["type"]).toBe(
        FieldType.DateTime,
      );
      expect(fieldFor(table["columns"], "reporterEmail")["type"]).toBe(
        FieldType.Email,
      );
      expect((table["cardProps"] as Props)["title"]).toBe("Submissions");
      expect(table["noItemsMessage"]).toBe(IncidentFormCopy.submissionsEmpty);
      expect(table["singularName"]).toBe("Submission");
      expect(table["pluralName"]).toBe("Submissions");
    });

    function submissionWithIncident(): IncidentFormSubmission {
      const submission: IncidentFormSubmission = new IncidentFormSubmission();
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      incident.incidentNumber = 42;
      incident.incidentNumberWithPrefix = "INC-42";
      submission.incident = incident;
      submission.incidentId = new ObjectID(INCIDENT_ID);
      return submission;
    }

    test("the incident is its number, linking to the incident", async () => {
      await renderView();

      const column: Props = fieldFor(submissions()["columns"], "incident");
      const container: HTMLElement = renderElement(
        (
          column["getElement"] as (item: IncidentFormSubmission) => ReactElement
        )(submissionWithIncident()),
      );

      const link: HTMLAnchorElement | null = container.querySelector("a");

      expect(link).toHaveTextContent("INC-42");
      expect(link!.getAttribute("href")).toBe(
        route(PageMap.INCIDENT_VIEW, INCIDENT_ID),
      );
      expect(
        (column["getExportValue"] as (item: IncidentFormSubmission) => string)(
          submissionWithIncident(),
        ),
      ).toBe("INC-42");
    });

    test("a project without an incident number prefix shows #42", async () => {
      await renderView();

      const column: Props = fieldFor(submissions()["columns"], "incident");
      const submission: IncidentFormSubmission = submissionWithIncident();
      delete submission.incident!.incidentNumberWithPrefix;

      const container: HTMLElement = renderElement(
        (
          column["getElement"] as (item: IncidentFormSubmission) => ReactElement
        )(submission),
      );

      expect(container.querySelector("a")).toHaveTextContent("#42");
    });

    test("a submission whose incident was deleted shows a dash and no link", async () => {
      await renderView();

      const column: Props = fieldFor(submissions()["columns"], "incident");
      const container: HTMLElement = renderElement(
        (
          column["getElement"] as (item: IncidentFormSubmission) => ReactElement
        )(new IncidentFormSubmission()),
      );

      expect(container).toHaveTextContent("-");
      expect(container.querySelector("a")).toBeNull();
      expect(
        (column["getExportValue"] as (item: IncidentFormSubmission) => string)(
          new IncidentFormSubmission(),
        ),
      ).toBe("");
    });

    test("View Incident opens the submission's incident", async () => {
      await renderView();

      const actions: Array<Props> = submissions()[
        "actionButtons"
      ] as Array<Props>;

      expect(titlesOf(actions)).toEqual(["View Incident"]);

      const viewIncident: Props = actions[0]!;
      let completed: number = 0;

      (
        viewIncident["onClick"] as (
          item: IncidentFormSubmission,
          onCompleteAction: () => void,
        ) => void
      )(submissionWithIncident(), (): void => {
        completed++;
      });

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(String(navigateSpy.mock.calls[0]![0])).toBe(
        route(PageMap.INCIDENT_VIEW, INCIDENT_ID),
      );
      expect(completed).toBe(1);
    });

    test("View Incident reads the incident id column when the relation was not joined", async () => {
      await renderView();

      const viewIncident: Props = (
        submissions()["actionButtons"] as Array<Props>
      )[0]!;
      const submission: IncidentFormSubmission = new IncidentFormSubmission();
      submission.incidentId = new ObjectID(INCIDENT_ID);

      expect(
        (
          viewIncident["isVisible"] as (item: IncidentFormSubmission) => boolean
        )(submission),
      ).toBe(true);

      (
        viewIncident["onClick"] as (
          item: IncidentFormSubmission,
          onCompleteAction: () => void,
        ) => void
      )(submission, (): void => {});

      expect(String(navigateSpy.mock.calls[0]![0])).toBe(
        route(PageMap.INCIDENT_VIEW, INCIDENT_ID),
      );
      expect(submissions()["selectMoreFields"]).toEqual({ incidentId: true });
    });

    test("View Incident is hidden, and does nothing, when the incident is gone", async () => {
      await renderView();

      const viewIncident: Props = (
        submissions()["actionButtons"] as Array<Props>
      )[0]!;
      let completed: number = 0;

      expect(
        (
          viewIncident["isVisible"] as (item: IncidentFormSubmission) => boolean
        )(new IncidentFormSubmission()),
      ).toBe(false);

      (
        viewIncident["onClick"] as (
          item: IncidentFormSubmission,
          onCompleteAction: () => void,
        ) => void
      )(new IncidentFormSubmission(), (): void => {
        completed++;
      });

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(completed).toBe(1);
    });

    test("deleting a submission says the incident stays", async () => {
      await renderView();

      const confirmation: Props = await (
        submissions()["getDeleteConfirmation"] as () => Promise<Props>
      )();

      expect(confirmation).toEqual({
        title: "Delete Submission",
        description: IncidentFormCopy.deleteSubmissionDescription,
        submitButtonText: "Delete",
      });
      expect(IncidentFormCopy.deleteSubmissionDescription).toContain(
        "The incident it declared is not deleted",
      );
    });

    test("filters by when and by whom", async () => {
      await renderView();

      const filters: unknown = submissions()["filters"];

      expect(columnsOf(filters)).toEqual([
        "createdAt",
        "reporterName",
        "reporterEmail",
      ]);
      expect(titlesOf(filters)).toEqual([
        "Submitted At",
        "Reporter Name",
        "Reporter Email",
      ]);
    });
  });

  describe("Delete", () => {
    test("deletes this form and goes back to the list", async () => {
      await renderView();

      const deleteCard: Props = last(recordedDeletes);

      expect(deleteCard["modelType"]).toBe(IncidentForm);

      (deleteCard["onDeleteSuccess"] as () => void)();

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(String(navigateSpy.mock.calls[0]![0])).toBe(
        `/dashboard/${PROJECT_ID}/incidents/settings/forms`,
      );
    });

    test("the confirmation says the submissions go with it, and the incidents stay", async () => {
      mockTranslate = (value: string): string => {
        return `[de] ${value}`;
      };

      await renderView();

      const container: HTMLElement = renderElement(
        last(recordedDeletes)["confirmationContent"] as ReactElement,
      );

      expect(container).toHaveTextContent(
        `[de] ${IncidentFormCopy.deleteFormNote}`,
      );
      expect(IncidentFormCopy.deleteFormNote).toBe(
        "Its submissions are deleted with it. The incidents it declared are not deleted.",
      );
    });
  });
});
