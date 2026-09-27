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
 * incident event: a warning that custom fields and the affected status
 * pages are internal data, and the project's incident custom fields with the
 * {{customFields.<key>}} variable each is placed by and whether it is
 * already in the default messages.
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

import IncidentCustomFieldTemplateVariables from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariables";
import IncidentCustomFieldTemplateVariablesCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariablesCopy";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";

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
    "for %s, warns that custom fields and the affected status pages are internal",
    async (eventType: StatusPageSubscriberNotificationEventType) => {
      render(<IncidentCustomFieldTemplateVariables eventType={eventType} />);

      const warning: HTMLElement = screen.getByTestId(
        "incident-template-variables-internal-data-warning",
      );

      expect(warning).toHaveTextContent(
        IncidentCustomFieldTemplateVariablesCopy.internalDataWarningTitle,
      );
      expect(warning).toHaveTextContent(
        IncidentCustomFieldTemplateVariablesCopy.internalDataWarning,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId(
            "incident-custom-field-template-variable-customFields.affected_location",
          ),
        ).toBeInTheDocument();
      });
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
          "incident-custom-field-template-variable-customFields.affected_location",
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
      "{{customFields.affected_location}}",
      "{{customFields.internal_ticket}}",
      "{{customFields.impact}}",
    ]);

    const location: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variable-customFields.affected_location",
    );
    expect(within(location).getByText("Affected Location")).toBeInTheDocument();
    expect(
      within(location).getByText("Dropdown (single select)"),
    ).toBeInTheDocument();
    expect(within(location).getByText("Yes")).toBeInTheDocument();

    const ticket: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variable-customFields.internal_ticket",
    );
    expect(within(ticket).getByText("No")).toBeInTheDocument();

    const impact: HTMLElement = screen.getByTestId(
      "incident-custom-field-template-variable-customFields.impact",
    );
    expect(
      within(impact).getByText("Rich text (Markdown)"),
    ).toBeInTheDocument();

    // A field with no usable key is not offered.
    expect(screen.queryByText("Legacy")).not.toBeInTheDocument();
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

  test("keeps the warning, and says the fields could not be listed, when they cannot be read", async () => {
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

    expect(
      screen.getByTestId("incident-template-variables-internal-data-warning"),
    ).toBeInTheDocument();
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
          "incident-custom-field-template-variable-customFields.impact",
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
  });
});
