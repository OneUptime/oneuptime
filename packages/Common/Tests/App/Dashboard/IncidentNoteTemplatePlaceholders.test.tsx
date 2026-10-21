import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The template variables an incident note template's Note field offers.
 *
 * "Can you please make this modal UI better? For example, instead of showing
 * a list of variables, we can show the list of variables at the bottom, but
 * it should be collapsed ... you can also integrate variables with the
 * markdown editor". The field no longer prints every placeholder above the
 * editor: it hands these groups to the Markdown editor, which keeps them
 * collapsed under it, behind its Insert variable button, and under the cursor
 * when "{{" is typed.
 *
 * They are the incident's own values, then the project's custom fields - each
 * by its own {{incident.customFields.<key>}}, named as the project named it,
 * never the family's "<key>" pattern, and never the older
 * {{customFields.<key>}}. No warning goes with them: a yellow "Internal data"
 * box used to, and the maintainer asked for it to go.
 */

const translated: Array<string> = [];

// A copy key that names a warning.
const WARNING_KEY: RegExp = /warning|internaldata/i;
// The removed warning's title, and its closing advice.
const WARNING_TEXT: RegExp =
  /internal data|before you post a public note|read the filled-in text/i;

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value) {
            translated.push(value);
          }
          return value ? `[${value}]` : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

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

import useIncidentNoteTemplateVariables, {
  IncidentNoteTemplateVariables,
  NOTE_TEMPLATE_CUSTOM_FIELDS_GROUP_TITLE,
  NOTE_TEMPLATE_INCIDENT_GROUP_TITLE,
  getIncidentNoteTemplateVariableGroups,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentNoteTemplatePlaceholders";
import IncidentCustomFieldsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldsCopy";
import IncidentCustomFieldTemplateVariablesCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariablesCopy";
import {
  INCIDENT_NOTE_TEMPLATE_VARIABLES,
  IncidentNoteTemplateVariableInfo,
} from "../../../Utils/Incident/IncidentNoteTemplateVariables";
import { isCustomFieldTemplateVariableName } from "../../../Types/CustomField/CustomFieldVariableKey";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
} from "../../../Types/Template/TemplateVariable";
import TemplateVariablesList from "../../../UI/Components/TemplateVariables/TemplateVariablesList";

const ROWS: Array<{
  variableName: string;
  name: string;
  customFieldType: CustomFieldType;
  isIncludedInSubscriberNotifications: boolean;
}> = [
  {
    variableName: "incident.customFields.customer_impact",
    name: "Customer Impact",
    customFieldType: CustomFieldType.Text,
    isIncludedInSubscriberNotifications: true,
  },
  {
    variableName: "incident.customFields.on_call_lead",
    name: "On-call Lead",
    customFieldType: CustomFieldType.Text,
    isIncludedInSubscriberNotifications: false,
  },
];

// The incident's own variables, as the list that fills them has them.
const OWN_VARIABLES: Array<IncidentNoteTemplateVariableInfo> =
  INCIDENT_NOTE_TEMPLATE_VARIABLES.filter(
    (variable: IncidentNoteTemplateVariableInfo): boolean => {
      return !isCustomFieldTemplateVariableName(variable.name);
    },
  );

const FAMILY: IncidentNoteTemplateVariableInfo =
  INCIDENT_NOTE_TEMPLATE_VARIABLES.find(
    (variable: IncidentNoteTemplateVariableInfo): boolean => {
      return isCustomFieldTemplateVariableName(variable.name);
    },
  )!;

function namesOf(groups: TemplateVariableGroups): Array<string> {
  return groups.flatMap((group: TemplateVariableGroup): Array<string> => {
    return group.variables.map((variable: TemplateVariable): string => {
      return variable.name;
    });
  });
}

afterEach(() => {
  cleanup();
  translated.length = 0;
  fetchMock.mockReset();
});

describe("the note template's variables", () => {
  test("first the incident's own, in the order the fill list has them, each with what it holds", () => {
    const groups: TemplateVariableGroups =
      getIncidentNoteTemplateVariableGroups({ status: "loaded", rows: [] });

    expect(groups[0]!.title).toBe(NOTE_TEMPLATE_INCIDENT_GROUP_TITLE);
    expect(groups[0]!.variables).toEqual(
      OWN_VARIABLES.map(
        (variable: IncidentNoteTemplateVariableInfo): TemplateVariable => {
          return { name: variable.name, description: variable.description };
        },
      ),
    );
    expect(namesOf([groups[0]!])).toEqual([
      "incident.title",
      "incident.number",
      "incident.severity",
      "incident.state",
      "incident.startedAt",
      "incident.labels",
      "incident.affectedStatusPages",
    ]);
  });

  test("then the project's custom fields, each by its own variable and the name the project gave it", () => {
    const groups: TemplateVariableGroups =
      getIncidentNoteTemplateVariableGroups({ status: "loaded", rows: ROWS });

    expect(groups).toHaveLength(2);
    expect(groups[1]!.title).toBe(NOTE_TEMPLATE_CUSTOM_FIELDS_GROUP_TITLE);
    expect(groups[1]!.variables).toEqual([
      {
        name: "incident.customFields.customer_impact",
        description: "Customer Impact",
        isDescriptionVerbatim: true,
      },
      {
        name: "incident.customFields.on_call_lead",
        description: "On-call Lead",
        isDescriptionVerbatim: true,
      },
    ]);
    // The group says what these are.
    expect(groups[1]!.description).toBe(FAMILY.description);
  });

  /*
   * "This custom fields.key template should be prefixed with incident." Every
   * variable offered is the incident's, and the custom fields are offered by
   * name, never as the family's pattern or the older prefix.
   */
  test("every variable offered is the incident's: no pattern, no older name", () => {
    const names: Array<string> = namesOf(
      getIncidentNoteTemplateVariableGroups({ status: "loaded", rows: ROWS }),
    );

    for (const name of names) {
      expect(name.startsWith("incident.")).toBe(true);
      expect(name).not.toContain("<key>");
    }

    expect(names).not.toContain(FAMILY.name);
    expect(
      names.some((name: string): boolean => {
        return name.startsWith("customFields.");
      }),
    ).toBe(false);
  });

  test("while the fields are read, the group says what they are and has none yet", () => {
    const groups: TemplateVariableGroups =
      getIncidentNoteTemplateVariableGroups({ status: "loading" });

    expect(groups[1]!.variables).toEqual([]);
    expect(groups[1]!.description).toBe(FAMILY.description);
  });

  test("a project with no custom fields is told so", () => {
    const groups: TemplateVariableGroups =
      getIncidentNoteTemplateVariableGroups({ status: "loaded", rows: [] });

    expect(groups[1]!.variables).toEqual([]);
    expect(groups[1]!.description).toBe(
      IncidentCustomFieldTemplateVariablesCopy.noCustomFields,
    );
  });

  test("a reader who may not list the fields is told they could not be loaded", () => {
    const groups: TemplateVariableGroups =
      getIncidentNoteTemplateVariableGroups({ status: "failed" });

    expect(groups[1]!.variables).toEqual([]);
    expect(groups[1]!.description).toBe(
      IncidentCustomFieldTemplateVariablesCopy.customFieldsUnavailable,
    );
  });

  test("the custom field family's own words say variable, and point at nothing that may move", () => {
    expect(FAMILY.description).toBe(
      "The value of an incident custom field. Each field has a variable of its own.",
    );
    expect(FAMILY.description).not.toMatch(/Template Variable shown/);
  });
});

describe("useIncidentNoteTemplateVariables", () => {
  function Probe(props: {
    onValue: (value: IncidentNoteTemplateVariables) => void;
  }): ReactElement {
    props.onValue(useIncidentNoteTemplateVariables());
    return <div />;
  }

  test("reads the project's fields once, and offers them when they arrive", async () => {
    fetchMock.mockResolvedValue(ROWS);

    const seen: Array<IncidentNoteTemplateVariables> = [];

    await act(async (): Promise<void> => {
      render(
        <Probe
          onValue={(value: IncidentNoteTemplateVariables) => {
            seen.push(value);
          }}
        />,
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(namesOf(seen[0]!.groups)).not.toContain(
      "incident.customFields.customer_impact",
    );
    expect(namesOf(seen[seen.length - 1]!.groups)).toContain(
      "incident.customFields.customer_impact",
    );
  });

  test("when the fields cannot be read, still offers the incident's own", async () => {
    fetchMock.mockRejectedValue(new Error("No permission"));

    let last: IncidentNoteTemplateVariables | null = null;

    await act(async (): Promise<void> => {
      render(
        <Probe
          onValue={(value: IncidentNoteTemplateVariables) => {
            last = value;
          }}
        />,
      );
    });

    const groups: TemplateVariableGroups = last!.groups;

    expect(namesOf(groups)).toContain("incident.title");
    expect(groups[1]!.description).toBe(
      IncidentCustomFieldTemplateVariablesCopy.customFieldsUnavailable,
    );
  });

  test("describes them with the copy's intro, which speaks of variables", async () => {
    fetchMock.mockResolvedValue([]);

    let last: IncidentNoteTemplateVariables | null = null;

    await act(async (): Promise<void> => {
      render(
        <Probe
          onValue={(value: IncidentNoteTemplateVariables) => {
            last = value;
          }}
        />,
      );
    });

    expect(last!.description).toBe(
      IncidentCustomFieldsCopy.noteTemplateVariablesIntro,
    );
    expect(IncidentCustomFieldsCopy.noteTemplateVariablesIntro).toMatch(
      /variables/,
    );
    expect(IncidentCustomFieldsCopy.noteTemplateVariablesIntro).not.toMatch(
      /placeholder/,
    );
  });
});

describe("shown under the editor", () => {
  function renderList(): HTMLElement {
    render(
      <TemplateVariablesList
        groups={getIncidentNoteTemplateVariableGroups({
          status: "loaded",
          rows: ROWS,
        })}
        description={IncidentCustomFieldsCopy.noteTemplateVariablesIntro}
        onInsert={() => {}}
        supportsTyping={true}
      />,
    );

    return screen.getByTestId("template-variables");
  }

  test("lists every variable in braces, with what it is filled with", () => {
    const list: HTMLElement = renderList();

    for (const variable of OWN_VARIABLES) {
      const code: HTMLElement = within(list).getByText(`{{${variable.name}}}`);

      expect(code.tagName).toBe("CODE");
      expect(code.parentElement).toHaveTextContent(`[${variable.description}]`);
    }

    for (const row of ROWS) {
      expect(
        within(list).getByText(`{{${row.variableName}}}`),
      ).toBeInTheDocument();
      expect(list).toHaveTextContent(row.name);
    }
  });

  test("starts collapsed, at the bottom: one line naming the list", () => {
    const list: HTMLElement = renderList();

    expect(list.tagName).toBe("DETAILS");
    expect(list).not.toHaveAttribute("open");
  });

  test("shows no warning: no alert, no 'Internal data', no advice about public notes", () => {
    const list: HTMLElement = renderList();

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(
      screen.queryByTestId("incident-note-template-internal-data-warning"),
    ).not.toBeInTheDocument();
    expect(list.querySelector(".alert")).toBeNull();
    expect(list.querySelector(".bg-amber-50")).toBeNull();
    expect(list).not.toHaveTextContent(WARNING_TEXT);
    expect(list).not.toHaveTextContent(/Include in Subscriber Notifications/);
    expect(
      translated.some((text: string): boolean => {
        return WARNING_TEXT.test(text);
      }),
    ).toBe(false);
  });

  test("translates the words - never a variable, never a field's name", () => {
    renderList();

    expect(translated).toContain(
      IncidentCustomFieldsCopy.noteTemplateVariablesIntro,
    );

    for (const variable of OWN_VARIABLES) {
      expect(translated).toContain(variable.description);
    }

    for (const row of ROWS) {
      expect(translated).not.toContain(row.name);
    }

    expect(
      translated.some((text: string) => {
        return text.includes("{{incident");
      }),
    ).toBe(false);
  });

  test("the copy carries no warning text", () => {
    expect(
      Object.keys(IncidentCustomFieldsCopy).some((key: string): boolean => {
        return WARNING_KEY.test(key);
      }),
    ).toBe(false);
    expect(
      Object.values(IncidentCustomFieldsCopy).some((text: string): boolean => {
        return WARNING_TEXT.test(text);
      }),
    ).toBe(false);
  });
});
