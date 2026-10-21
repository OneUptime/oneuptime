import "@testing-library/jest-dom";
import type { Mock } from "jest-mock";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A custom subscriber notification template's body and subject offer the
 * event's variables and, for an incident event, the project's incident
 * custom fields - each by its {{incident.customFields.<key>}}, named as the
 * project named it - in the template editor's Template variables list. The
 * list's footer reads the fields (only for an incident event, only once the
 * body is shown) and says who may place them; for the report it documents
 * what the report's loops reach.
 */

const fetchMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariables",
  () => {
    return {
      __esModule: true,
      fetchIncidentCustomFieldTemplateVariables: (
        ...args: Array<unknown>
      ): unknown => {
        return fetchMock(...args);
      },
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown-viewer" },
        props.text,
      );
    },
  };
});

import SubscriberTemplateVariablesFooter, {
  getSubscriberTemplateVariableGroups,
  offersIncidentCustomFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberTemplateVariables";
import { IncidentCustomFieldTemplateVariablesState } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariables";
import IncidentCustomFieldTemplateVariablesCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariablesCopy";
import { SUBSCRIBER_REPORT_LOOP_DOCUMENTATION } from "../../../../App/FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateVariables";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
} from "../../../Types/Template/TemplateVariable";

const INCIDENT_CREATED: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;
const ANNOUNCEMENT_CREATED: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated;

const ROWS: Array<{
  variableName: string;
  name: string;
  customFieldType: CustomFieldType;
  isIncludedInSubscriberNotifications: boolean;
}> = [
  {
    variableName: "incident.customFields.affected_location",
    name: "Affected Location",
    customFieldType: CustomFieldType.Text,
    isIncludedInSubscriberNotifications: true,
  },
];

function namesOf(groups: TemplateVariableGroups): Array<string> {
  return groups.flatMap((group: TemplateVariableGroup): Array<string> => {
    return group.variables.map((variable: TemplateVariable): string => {
      return variable.name;
    });
  });
}

function customFieldGroupOf(
  groups: TemplateVariableGroups,
): TemplateVariableGroup | undefined {
  return groups.find((group: TemplateVariableGroup): boolean => {
    return (
      group.title === IncidentCustomFieldTemplateVariablesCopy.customFieldsTitle
    );
  });
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("getSubscriberTemplateVariableGroups", () => {
  test("an incident event: the event's variables, then the project's custom fields by name", () => {
    const groups: TemplateVariableGroups = getSubscriberTemplateVariableGroups(
      INCIDENT_CREATED,
      { status: "loaded", rows: ROWS },
    );

    expect(namesOf(groups)).toEqual(
      expect.arrayContaining(["statusPageName", "incidentTitle"]),
    );

    const fields: TemplateVariableGroup | undefined =
      customFieldGroupOf(groups);

    expect(groups[groups.length - 1]).toBe(fields);
    expect(fields!.variables).toEqual([
      {
        name: "incident.customFields.affected_location",
        description: "Affected Location",
        isDescriptionVerbatim: true,
      },
    ]);
    expect(fields!.description).toBe(
      IncidentCustomFieldTemplateVariablesCopy.customFieldsDescription,
    );
  });

  test("never the family's <key> pattern, nor the older {{customFields.<key>}}", () => {
    const names: Array<string> = namesOf(
      getSubscriberTemplateVariableGroups(INCIDENT_CREATED, {
        status: "loaded",
        rows: ROWS,
      }),
    );

    for (const name of names) {
      expect(name).not.toContain("<");
      expect(name.startsWith("customFields.")).toBe(false);
    }
  });

  test("while the fields are read, the group is there with none yet", () => {
    const fields: TemplateVariableGroup | undefined = customFieldGroupOf(
      getSubscriberTemplateVariableGroups(INCIDENT_CREATED, {
        status: "loading",
      }),
    );

    expect(fields!.variables).toEqual([]);
    expect(fields!.description).toBe(
      IncidentCustomFieldTemplateVariablesCopy.customFieldsDescription,
    );
  });

  test("a project without fields, or a reader who may not list them, is told so", () => {
    expect(
      customFieldGroupOf(
        getSubscriberTemplateVariableGroups(INCIDENT_CREATED, {
          status: "loaded",
          rows: [],
        }),
      )!.description,
    ).toBe(IncidentCustomFieldTemplateVariablesCopy.noCustomFields);

    expect(
      customFieldGroupOf(
        getSubscriberTemplateVariableGroups(INCIDENT_CREATED, {
          status: "failed",
        }),
      )!.description,
    ).toBe(IncidentCustomFieldTemplateVariablesCopy.customFieldsUnavailable);
  });

  test("an event that is not about an incident offers no custom fields", () => {
    const groups: TemplateVariableGroups = getSubscriberTemplateVariableGroups(
      ANNOUNCEMENT_CREATED,
      { status: "loaded", rows: ROWS },
    );

    expect(customFieldGroupOf(groups)).toBeUndefined();
    expect(namesOf(groups)).toContain("announcementTitle");
    expect(offersIncidentCustomFields(ANNOUNCEMENT_CREATED)).toBe(false);
    expect(offersIncidentCustomFields(INCIDENT_CREATED)).toBe(true);
    expect(offersIncidentCustomFields(undefined)).toBe(false);
  });
});

describe("the end of the body's variables list", () => {
  test("for an incident event, reads the project's fields and hands them over", async () => {
    fetchMock.mockResolvedValue(ROWS);

    const states: Array<IncidentCustomFieldTemplateVariablesState> = [];

    await act(async (): Promise<void> => {
      render(
        <SubscriberTemplateVariablesFooter
          eventType={INCIDENT_CREATED}
          onCustomFieldsChange={(
            state: IncidentCustomFieldTemplateVariablesState,
          ) => {
            states.push(state);
          }}
        />,
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(states).toEqual([
      { status: "loading" },
      { status: "loaded", rows: ROWS },
    ]);
  });

  test("says who may place them, which the save enforces", async () => {
    fetchMock.mockResolvedValue(ROWS);

    await act(async (): Promise<void> => {
      render(
        <SubscriberTemplateVariablesFooter
          eventType={INCIDENT_CREATED}
          onCustomFieldsChange={() => {}}
        />,
      );
    });

    expect(
      screen.getByTestId("subscriber-template-placement-permission"),
    ).toHaveTextContent(
      IncidentCustomFieldTemplateVariablesCopy.placementPermission,
    );
  });

  test("a failed read is handed over as failed", async () => {
    fetchMock.mockRejectedValue(new Error("No permission"));

    const states: Array<IncidentCustomFieldTemplateVariablesState> = [];

    await act(async (): Promise<void> => {
      render(
        <SubscriberTemplateVariablesFooter
          eventType={INCIDENT_CREATED}
          onCustomFieldsChange={(
            state: IncidentCustomFieldTemplateVariablesState,
          ) => {
            states.push(state);
          }}
        />,
      );
    });

    expect(states[states.length - 1]).toEqual({ status: "failed" });
  });

  test("for any other event, reads nothing and shows nothing", async () => {
    const onCustomFieldsChange: Mock<
      (state: IncidentCustomFieldTemplateVariablesState) => void
    > = jest.fn<(state: IncidentCustomFieldTemplateVariablesState) => void>();

    let container: HTMLElement | null = null;

    await act(async (): Promise<void> => {
      container = render(
        <SubscriberTemplateVariablesFooter
          eventType={ANNOUNCEMENT_CREATED}
          onCustomFieldsChange={onCustomFieldsChange}
        />,
      ).container;
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCustomFieldsChange).not.toHaveBeenCalled();
    expect(container!).toBeEmptyDOMElement();
  });

  test("for the report, documents what its loops reach", async () => {
    await act(async (): Promise<void> => {
      render(
        <SubscriberTemplateVariablesFooter
          eventType={StatusPageSubscriberNotificationEventType.SubscriberReport}
          onCustomFieldsChange={() => {}}
        />,
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("markdown-viewer").textContent).toBe(
      SUBSCRIBER_REPORT_LOOP_DOCUMENTATION,
    );
  });

  test("shows no warning box", async () => {
    fetchMock.mockResolvedValue(ROWS);

    let container: HTMLElement | null = null;

    await act(async (): Promise<void> => {
      container = render(
        <SubscriberTemplateVariablesFooter
          eventType={INCIDENT_CREATED}
          onCustomFieldsChange={() => {}}
        />,
      ).container;
    });

    expect(container!.querySelector(".bg-amber-50, .bg-yellow-50")).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});
