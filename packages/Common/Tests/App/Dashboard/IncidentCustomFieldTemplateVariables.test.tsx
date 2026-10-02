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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Under a subscriber notification template's variable reference, for an
 * incident event: who may place custom fields and labels, and the project's
 * incident custom fields with the {{incident.customFields.<key>}} variable each is
 * placed by and whether it is already in the default messages.
 *
 * No warning box: a yellow "Internal data" one used to open the panel, the
 * twin of the one the note template form had, and both were taken out as
 * clutter.
 *
 * The list request is stubbed and recorded; the words go through a
 * translation stub that records what it was asked to translate.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

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

const translated: Array<string> = [];

// The removed warning's title.
const WARNING_TITLE: RegExp = /internal data/i;
// A copy key that names a warning.
const WARNING_KEY: RegExp = /warning|internaldata/i;
// The removed warning's title, and its closing advice.
const WARNING_TEXT: RegExp = /internal data|whose subscribers may see them/i;

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value) {
            translated.push(value);
          }
          return value;
        },
        translateValue: (value: unknown): unknown => {
          if (typeof value === "string") {
            translated.push(value);
          }
          return value;
        },
      };
    },
  };
});

import IncidentCustomFieldTemplateVariables, {
  fetchIncidentCustomFieldTemplateVariables,
  IncidentCustomFieldTemplateVariableRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariables";
import IncidentCustomFieldTemplateVariablesCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariablesCopy";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { getCustomFieldTemplateVariableName } from "../../../Types/CustomField/CustomFieldVariableKey";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import { INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX } from "../../../Utils/Incident/IncidentNoteTemplateVariables";

const Event: typeof StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType;

function customField(data: {
  name: string;
  variableKey?: string;
  customFieldType?: CustomFieldType;
  includeInSubscriberNotifications?: boolean;
  sortOrder?: number;
}): IncidentCustomField {
  const row: IncidentCustomField = new IncidentCustomField();
  row.name = data.name;
  if (data.variableKey !== undefined) {
    row.variableKey = data.variableKey;
  }
  row.customFieldType = data.customFieldType || CustomFieldType.Text;
  row.includeInSubscriberNotifications =
    data.includeInSubscriberNotifications === true;
  if (data.sortOrder !== undefined) {
    row.sortOrder = data.sortOrder;
  }
  return row;
}

const FIELDS: Array<IncidentCustomField> = [
  customField({
    name: "Internal Ticket",
    variableKey: "internal_ticket",
    sortOrder: 9,
  }),
  customField({
    name: "Affected Location",
    variableKey: "affected_location",
    customFieldType: CustomFieldType.Dropdown,
    includeInSubscriberNotifications: true,
    sortOrder: 1,
  }),
  customField({
    name: "Impact",
    variableKey: "impact",
    customFieldType: CustomFieldType.Markdown,
    includeInSubscriberNotifications: true,
  }),
  // No usable key: nothing a template could place.
  customField({ name: "Legacy", variableKey: "Not A Key" }),
];

/*
 * No alert of any kind in the panel - the removed warning was the shared
 * Alert's amber (yellow) box - and none of its words.
 */
function expectNoWarning(panel: HTMLElement): void {
  expect(within(panel).queryAllByRole("alert")).toHaveLength(0);
  expect(
    screen.queryByTestId("incident-template-variables-internal-data-warning"),
  ).not.toBeInTheDocument();
  expect(panel.querySelector(".alert")).toBeNull();
  expect(panel.querySelector(".bg-amber-50")).toBeNull();
  expect(panel).not.toHaveTextContent(/internal data/i);
  expect(panel).not.toHaveTextContent(/name every audience the incident/i);
  expect(panel).not.toHaveTextContent(/whose subscribers may see them/i);
  expect(
    translated.some((text: string): boolean => {
      return WARNING_TITLE.test(text);
    }),
  ).toBe(false);
}

beforeEach(() => {
  getListMock.mockResolvedValue({ data: FIELDS, count: FIELDS.length });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  translated.length = 0;
});

describe("IncidentCustomFieldTemplateVariables", () => {
  test.each([
    [undefined],
    [Event.SubscriberEpisodeCreated],
    [Event.SubscriberAnnouncementCreated],
    [Event.SubscriberScheduledMaintenanceNoteCreated],
  ])("shows nothing, and reads nothing, for %s", async (eventType: unknown) => {
    const { container } = render(
      <IncidentCustomFieldTemplateVariables
        eventType={eventType as StatusPageSubscriberNotificationEventType}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test.each([
    [Event.SubscriberIncidentCreated],
    [Event.SubscriberIncidentStateChanged],
    [Event.SubscriberIncidentNoteCreated],
    [Event.SubscriberIncidentNoteUpdated],
    [Event.SubscriberIncidentPostmortemPublished],
  ])(
    "for %s, lists the fields under who may place them, with no warning box",
    async (eventType: StatusPageSubscriberNotificationEventType) => {
      render(<IncidentCustomFieldTemplateVariables eventType={eventType} />);

      await waitFor(() => {
        expect(
          screen.getByTestId(
            "incident-custom-field-template-variable-incident.customFields.affected_location",
          ),
        ).toBeInTheDocument();
      });

      const panel: HTMLElement = screen.getByTestId(
        "incident-custom-field-template-variables",
      );

      expectNoWarning(panel);

      // The panel opens with who may place custom fields and labels.
      expect(panel.firstElementChild).toBe(
        screen.getByTestId("incident-template-variables-placement-permission"),
      );
    },
  );

  test("lists the project's fields in their order, with the variable that places each", async () => {
    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentCreated}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "incident-custom-field-template-variable-incident.customFields.affected_location",
        ),
      ).toBeInTheDocument();
    });

    const rows: Array<HTMLElement> = screen
      .getByTestId("incident-custom-field-template-variables")
      .querySelectorAll("tbody tr") as unknown as Array<HTMLElement>;

    expect(
      Array.from(rows).map((row: HTMLElement): string => {
        return row.querySelector("code")!.textContent || "";
      }),
    ).toEqual([
      "{{incident.customFields.affected_location}}",
      "{{incident.customFields.internal_ticket}}",
      "{{incident.customFields.impact}}",
    ]);

    const location: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variable-incident.customFields.affected_location",
    );
    expect(within(location).getByText("Affected Location")).toBeInTheDocument();
    expect(
      within(location).getByText("Dropdown (single select)"),
    ).toBeInTheDocument();
    expect(within(location).getByText("Yes")).toBeInTheDocument();

    const ticket: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variable-incident.customFields.internal_ticket",
    );
    expect(within(ticket).getByText("No")).toBeInTheDocument();

    const impact: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variable-incident.customFields.impact",
    );
    expect(
      within(impact).getByText("Rich text (Markdown)"),
    ).toBeInTheDocument();

    // A field with no usable key is not offered.
    expect(screen.queryByText("Legacy")).not.toBeInTheDocument();
  });

  /*
   * "This custom fields.key template should be prefixed with incident." The
   * panel hands out the name a note template uses too, so one variable works
   * in both, and never the older {{customFields.<key>}}.
   */
  test("hands out each field's variable named after the incident, as a note template writes it", async () => {
    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentCreated}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "incident-custom-field-template-variable-incident.customFields.impact",
        ),
      ).toBeInTheDocument();
    });

    const panel: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variables",
    );
    const shown: Array<string> = Array.from(
      panel.querySelectorAll("tbody code"),
    ).map((code: Element): string => {
      return code.textContent || "";
    });

    expect(shown).toHaveLength(3);

    for (const variable of shown) {
      expect(
        variable.startsWith(`{{${INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX}`),
      ).toBe(true);
    }

    expect(panel).not.toHaveTextContent(/\{\{customFields\./);
  });

  test("fetchIncidentCustomFieldTemplateVariables names each row's variable the documented way", async () => {
    const rows: Array<IncidentCustomFieldTemplateVariableRow> =
      await fetchIncidentCustomFieldTemplateVariables();

    expect(
      rows.map((row: IncidentCustomFieldTemplateVariableRow): string => {
        return row.variableName;
      }),
    ).toEqual([
      getCustomFieldTemplateVariableName("affected_location"),
      getCustomFieldTemplateVariableName("internal_ticket"),
      getCustomFieldTemplateVariableName("impact"),
    ]);
    expect(rows[0]!.variableName).toBe(
      "incident.customFields.affected_location",
    );
  });

  test("reads the current project's incident custom fields, with their keys and settings", async () => {
    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentNoteCreated}
      />,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, any> = getListMock.mock
      .calls[0]![0] as Record<string, any>;

    expect(request["modelType"]).toBe(IncidentCustomField);
    expect(request["query"]["projectId"].toString()).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(request["select"]).toEqual(
      expect.objectContaining({
        name: true,
        variableKey: true,
        customFieldType: true,
        includeInSubscriberNotifications: true,
        sortOrder: true,
      }),
    );
  });

  test("says so when the project has no incident custom fields", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });

    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentCreated}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("incident-custom-field-template-variables-empty"),
      ).toHaveTextContent(
        IncidentCustomFieldTemplateVariablesCopy.noCustomFields,
      );
    });
  });

  /*
   * The save refuses a custom field or the labels from someone who cannot
   * read every incident (SubscriberTemplateIncidentRecordAccess): the panel
   * says so before they try, even when it could not list the fields.
   */
  test("says who may place custom fields and labels, translated", async () => {
    getListMock.mockRejectedValue(new Error("Not authorized"));

    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentCreated}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "incident-custom-field-template-variables-unavailable",
        ),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("incident-template-variables-placement-permission"),
    ).toHaveTextContent(
      IncidentCustomFieldTemplateVariablesCopy.placementPermission,
    );
    expect(translated).toContain(
      IncidentCustomFieldTemplateVariablesCopy.placementPermission,
    );
  });

  test("says the fields could not be listed, still with no warning box, when they cannot be read", async () => {
    getListMock.mockRejectedValue(new Error("Not authorized"));

    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentCreated}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "incident-custom-field-template-variables-unavailable",
        ),
      ).toHaveTextContent(
        IncidentCustomFieldTemplateVariablesCopy.customFieldsUnavailable,
      );
    });

    expectNoWarning(
      screen.getByTestId("incident-custom-field-template-variables"),
    );
  });

  test("shows no warning box while the fields are still loading", () => {
    // A request that never answers: the panel stays in its loading state.
    getListMock.mockReturnValue(new Promise<never>(() => {}));

    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentNoteCreated}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variables",
    );

    expectNoWarning(panel);
    expect(
      screen.getByTestId("incident-template-variables-placement-permission"),
    ).toBeInTheDocument();
  });

  test("shows no warning box when the project has no incident custom fields", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });

    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentPostmortemPublished}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("incident-custom-field-template-variables-empty"),
      ).toBeInTheDocument();
    });

    expectNoWarning(
      screen.getByTestId("incident-custom-field-template-variables"),
    );
  });

  test("the copy carries no warning text", () => {
    expect(
      Object.keys(IncidentCustomFieldTemplateVariablesCopy).some(
        (key: string): boolean => {
          return WARNING_KEY.test(key);
        },
      ),
    ).toBe(false);
    expect(
      Object.values(IncidentCustomFieldTemplateVariablesCopy).some(
        (text: string): boolean => {
          return WARNING_TEXT.test(text);
        },
      ),
    ).toBe(false);
    // What stays: who may place them, and the fields' table.
    expect(
      IncidentCustomFieldTemplateVariablesCopy.placementPermission,
    ).toMatch(/custom field/);
    expect(IncidentCustomFieldTemplateVariablesCopy.customFieldsTitle).toBe(
      "Incident Custom Fields",
    );
  });

  test("translates the words, never a variable", async () => {
    render(
      <IncidentCustomFieldTemplateVariables
        eventType={Event.SubscriberIncidentCreated}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "incident-custom-field-template-variable-incident.customFields.impact",
        ),
      ).toBeInTheDocument();
    });

    expect(translated).toEqual(
      expect.arrayContaining([
        IncidentCustomFieldTemplateVariablesCopy.customFieldsTitle,
        IncidentCustomFieldTemplateVariablesCopy.customFieldsDescription,
        IncidentCustomFieldTemplateVariablesCopy.variableColumnTitle,
        "Rich text (Markdown)",
        "Yes",
        "No",
      ]),
    );
    expect(
      translated.some((text: string): boolean => {
        return text.includes("{{");
      }),
    ).toBe(false);
    // A field's name is the team's own text: shown as written.
    expect(translated).not.toContain("Affected Location");
    // The removed warning's title is not looked up any more.
    expect(translated).not.toContain("Internal data");
  });
});
