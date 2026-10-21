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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Please remove this yellow warning. We don't need it."
 *
 * What someone writing a template sees, page by page. The tables and cards
 * are stubbed and their props recorded; the help each form field carries
 * (its description and footer), its template variables (the editor's
 * collapsed Template variables list, and that list's footer) and the
 * Template Variables Reference are rendered for real:
 *
 *   - the note field of the incident note template forms - a new
 *     template's one-page form, and a template's Edit Note Template dialog - where
 *     a yellow "Internal data" box sat under the placeholders;
 *   - the template body of the subscriber notification template forms, for
 *     every channel and every incident event, and a template's Template
 *     Variables Reference card, where its twin opened the incident custom
 *     fields.
 *
 * None of them shows a warning box any more, and what they are there for -
 * the variables, the project's custom fields among them - still shows.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedCards: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div");
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCards.push(props);
      return React.createElement("div");
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div");
    },
  };
});

// Every channel's tab at once, so each channel's table is recorded.
jest.mock("../../../UI/Components/Tabs/Tabs", () => {
  return {
    __esModule: true,
    default: (props: {
      tabs: Array<{ name: string; children: ReactNode }>;
    }): ReactElement => {
      return React.createElement(
        "div",
        null,
        props.tabs.map(
          (tab: { name: string; children: ReactNode }): ReactElement => {
            return React.createElement(
              "section",
              { key: tab.name, "data-tab": tab.name },
              tab.children,
            );
          },
        ),
      );
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "variables-reference-markdown" },
        props.text,
      );
    },
  };
});

jest.mock("../../../UI/Components/CodeBlock/CodeBlock", () => {
  return {
    __esModule: true,
    default: (props: { code: string }): ReactElement => {
      return React.createElement("pre", null, props.code);
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
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

import IncidentNoteTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentNoteTemplates";
import IncidentNoteTemplateView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentNoteTemplateView";
import SubscriberNotificationTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/SubscriberNotificationTemplates";
import SubscriberNotificationTemplateView from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/SubscriberNotificationTemplateView";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import Route from "../../../Types/API/Route";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTemplateVariables from "../../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import Navigation from "../../../UI/Utils/Navigation";
import { INCIDENT_NOTE_TEMPLATE_VARIABLES } from "../../../Utils/Incident/IncidentNoteTemplateVariables";
import { isCustomFieldTemplateVariableName } from "../../../Types/CustomField/CustomFieldVariableKey";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
} from "../../../Types/Template/TemplateVariable";
import TemplateVariablesList from "../../../UI/Components/TemplateVariables/TemplateVariablesList";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000bb";

// The incident events whose templates offer the incident custom fields.
const INCIDENT_EVENT_TYPES: Array<StatusPageSubscriberNotificationEventType> =
  Object.values(StatusPageSubscriberNotificationEventType).filter(
    (eventType: StatusPageSubscriberNotificationEventType): boolean => {
      return (
        SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
          eventType,
        ).length > 0
      );
    },
  );

const CHANNELS: Array<StatusPageSubscriberNotificationMethod> = Object.values(
  StatusPageSubscriberNotificationMethod,
);

// The two removed warnings' shared title.
const REMOVED_WARNING_TITLE: string = "Internal data";

// A phrase from each removed warning's body.
const REMOVED_WARNING_WORDS: RegExp =
  /before you post a public note|whose subscribers may see them/i;

function incidentCustomField(): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field.name = "Affected Location";
  field.variableKey = "affected_location";
  field.customFieldType = CustomFieldType.Text;
  field.includeInSubscriberNotifications = true;
  field.sortOrder = 1;
  return field;
}

let template: StatusPageSubscriberNotificationTemplate | null = null;

beforeEach(() => {
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentCustomField) {
      return { data: [incidentCustomField()], count: 1, skip: 0, limit: 0 };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  getItemMock.mockImplementation(async () => {
    return template;
  });

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(TEMPLATE_ID);
    });
});

afterEach(() => {
  cleanup();
  recordedTables.length = 0;
  recordedCards.length = 0;
  translated.length = 0;
  template = null;
  getListMock.mockReset();
  getItemMock.mockReset();
  jest.restoreAllMocks();
});

type FormFieldProps = Record<string, unknown>;

function formFieldsOf(props: Record<string, unknown>): Array<FormFieldProps> {
  return (props["formFields"] as Array<FormFieldProps> | undefined) || [];
}

function isFieldFor(formField: FormFieldProps, column: string): boolean {
  const field: Record<string, unknown> | undefined = formField["field"] as
    | Record<string, unknown>
    | undefined;
  return Boolean(field && field[column]);
}

/*
 * Everything a form field draws around its input: its description, section
 * description and footer, whichever it has.
 */
function helpOf(
  formField: FormFieldProps,
  values: Record<string, unknown>,
): Array<ReactNode> {
  const help: Array<ReactNode> = [];

  for (const key of ["description", "sectionDescription", "footerElement"]) {
    const value: unknown = formField[key];

    if (React.isValidElement(value) || typeof value === "string") {
      help.push(value as ReactNode);
    }
  }

  if (typeof formField["getFooterElement"] === "function") {
    help.push(
      (
        formField["getFooterElement"] as (
          values: Record<string, unknown>,
        ) => ReactNode
      )(values),
    );
  }

  return help;
}

function renderHelp(help: Array<ReactNode>): HTMLElement {
  render(
    <MemoryRouter>
      <div data-testid="form-field-help">
        {help.map((node: ReactNode, index: number): ReactElement => {
          return <React.Fragment key={index}>{node}</React.Fragment>;
        })}
      </div>
    </MemoryRouter>,
  );

  return screen.getByTestId("form-field-help");
}

// No yellow box - the shared Alert's warning is amber - and no warning words.
function expectNoYellowWarning(region: HTMLElement): void {
  expect(region.querySelector(".bg-amber-50")).toBeNull();
  expect(region.querySelector(".bg-yellow-50")).toBeNull();
  expect(
    region.querySelector(
      "[data-testid='incident-note-template-internal-data-warning'], [data-testid='incident-template-variables-internal-data-warning']",
    ),
  ).toBeNull();
  expect(within(region).queryByText(REMOVED_WARNING_TITLE)).toBeNull();
  expect(region).not.toHaveTextContent(REMOVED_WARNING_WORDS);
  expect(translated).not.toContain(REMOVED_WARNING_TITLE);
  expect(
    translated.some((text: string): boolean => {
      return REMOVED_WARNING_WORDS.test(text);
    }),
  ).toBe(false);
}

// Every variable name the groups offer.
function namesOf(groups: TemplateVariableGroups): Array<string> {
  return groups.flatMap((group: TemplateVariableGroup): Array<string> => {
    return group.variables.map((variable: TemplateVariable): string => {
      return variable.name;
    });
  });
}

// What a field's variables are, given the form's values.
function variablesOf(
  formField: FormFieldProps,
  values: Record<string, unknown>,
): TemplateVariableGroups {
  const templateVariables: unknown = formField["templateVariables"];

  if (typeof templateVariables === "function") {
    return (
      templateVariables as (
        values: Record<string, unknown>,
      ) => TemplateVariableGroups
    )(values);
  }

  return (templateVariables as TemplateVariableGroups | undefined) || [];
}

/*
 * The note field: its help above the editor says what the note is, and its
 * variables - every one the note can use, the project's custom field among
 * them - are the editor's, collapsed under it. Neither carries a warning.
 */
function noteTemplateFormIsClean(noteField: FormFieldProps): void {
  const groups: TemplateVariableGroups = variablesOf(noteField, { note: "" });
  const names: Array<string> = namesOf(groups);

  // The variables the note can use are all still there...
  for (const variable of INCIDENT_NOTE_TEMPLATE_VARIABLES) {
    if (isCustomFieldTemplateVariableName(variable.name)) {
      continue;
    }

    expect(names).toContain(variable.name);
  }

  // ...the project's custom field by its own variable...
  expect(names).toContain("incident.customFields.affected_location");

  const help: HTMLElement = renderHelp([
    ...helpOf(noteField, { note: "" }),
    <TemplateVariablesList
      key="variables"
      groups={groups}
      description={noteField["templateVariablesDescription"] as string}
      onInsert={() => {}}
    />,
  ]);

  for (const name of names) {
    expect(within(help).getByText(`{{${name}}}`)).toBeInTheDocument();
  }

  // ...with no warning box, or any other alert, around them.
  expect(within(help).queryAllByRole("alert")).toHaveLength(0);
  expect(help.querySelector(".alert")).toBeNull();
  expectNoYellowWarning(help);
}

describe("the incident note template forms", () => {
  test("a new template's note field offers the variables and no warning", async () => {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <IncidentNoteTemplates
            pageRoute={new Route("/incidents/settings/note-templates")}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });

    // The last render: the project's custom fields have been read.
    const table: Record<string, unknown> | undefined = [...recordedTables]
      .reverse()
      .find((props: Record<string, unknown>): boolean => {
        return props["modelType"] === IncidentNoteTemplate;
      });

    expect(table).toBeDefined();

    const noteField: FormFieldProps | undefined = formFieldsOf(table!).find(
      (formField: FormFieldProps): boolean => {
        return isFieldFor(formField, "note");
      },
    );

    expect(noteField).toBeDefined();

    cleanup();
    noteTemplateFormIsClean(noteField!);
  });

  test("Edit Note Template offers the variables and no warning", async () => {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <IncidentNoteTemplateView
            pageRoute={
              new Route("/incidents/settings/note-templates/" + TEMPLATE_ID)
            }
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });

    const noteFields: Array<FormFieldProps> = recordedCards
      .flatMap(formFieldsOf)
      .filter((formField: FormFieldProps): boolean => {
        return isFieldFor(formField, "note");
      });

    expect(noteFields.length).toBeGreaterThan(0);

    cleanup();
    noteTemplateFormIsClean(noteFields[noteFields.length - 1]!);
  });
});

describe("the subscriber notification template forms", () => {
  test("there are incident events and channels to check", () => {
    expect(INCIDENT_EVENT_TYPES).toHaveLength(5);
    expect(CHANNELS.length).toBeGreaterThanOrEqual(5);
  });

  async function renderTemplatesPage(): Promise<void> {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <SubscriberNotificationTemplates
            pageRoute={new Route("/status-pages/settings/subscriber-templates")}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });
  }

  // The channel's body field, as the page last rendered it.
  function templateBodyFieldFor(
    channel: StatusPageSubscriberNotificationMethod,
  ): FormFieldProps {
    const table: Record<string, unknown> | undefined = [...recordedTables]
      .reverse()
      .find((props: Record<string, unknown>): boolean => {
        const query: Record<string, unknown> | undefined = props["query"] as
          | Record<string, unknown>
          | undefined;
        return (
          props["modelType"] === StatusPageSubscriberNotificationTemplate &&
          query?.["notificationMethod"] === channel
        );
      });

    expect(table).toBeDefined();

    const bodyField: FormFieldProps | undefined = formFieldsOf(table!).find(
      (formField: FormFieldProps): boolean => {
        return isFieldFor(formField, "templateBody");
      },
    );

    expect(bodyField).toBeDefined();
    return bodyField!;
  }

  // The end of the body's variables list, for these values.
  function renderVariablesFooter(
    bodyField: FormFieldProps,
    values: Record<string, unknown>,
  ): HTMLElement {
    const getFooter: (values: Record<string, unknown>) => ReactNode = bodyField[
      "getTemplateVariablesFooter"
    ] as (values: Record<string, unknown>) => ReactNode;

    expect(typeof getFooter).toBe("function");

    render(
      <MemoryRouter>
        <div data-testid="variables-footer">{getFooter(values)}</div>
      </MemoryRouter>,
    );

    return screen.getByTestId("variables-footer");
  }

  describe.each(CHANNELS)("a new %s template", (channel: string) => {
    test.each(INCIDENT_EVENT_TYPES)(
      "for %s, offers the incident custom fields as variables, with no warning",
      async (eventType: StatusPageSubscriberNotificationEventType) => {
        await renderTemplatesPage();

        const values: Record<string, unknown> = {
          eventType: eventType,
          templateBody: "",
        };

        const footer: HTMLElement = renderVariablesFooter(
          templateBodyFieldFor(
            channel as StatusPageSubscriberNotificationMethod,
          ),
          values,
        );

        // The project's field, offered by its variable once it is read.
        await waitFor(() => {
          expect(
            namesOf(
              variablesOf(
                templateBodyFieldFor(
                  channel as StatusPageSubscriberNotificationMethod,
                ),
                values,
              ),
            ),
          ).toContain("incident.customFields.affected_location");
        });

        // Who may place it, which the save enforces - and no box around it.
        expect(
          within(footer).getByTestId(
            "subscriber-template-placement-permission",
          ),
        ).toBeInTheDocument();
        expectNoYellowWarning(footer);

        // The help around the body: the preview and the default, no warning.
        const help: HTMLElement = renderHelp(
          helpOf(
            templateBodyFieldFor(
              channel as StatusPageSubscriberNotificationMethod,
            ),
            values,
          ),
        );

        // The reference is no longer an open table under the body.
        expect(
          within(help).queryByTestId("variables-reference-markdown"),
        ).not.toBeInTheDocument();
        expectNoYellowWarning(help);
      },
    );
  });

  test("a template for an event without incident fields shows no warning either", async () => {
    await renderTemplatesPage();

    const values: Record<string, unknown> = {
      eventType:
        StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
      templateBody: "",
    };

    const bodyField: FormFieldProps = templateBodyFieldFor(
      StatusPageSubscriberNotificationMethod.Email,
    );

    // The event's own variables are offered...
    expect(namesOf(variablesOf(bodyField, values))).toEqual(
      expect.arrayContaining(["announcementTitle", "statusPageName"]),
    );

    const footer: HTMLElement = renderVariablesFooter(bodyField, values);

    // ...and nothing about the incident's custom fields is read or shown.
    expect(getListMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ modelType: IncidentCustomField }),
    );
    expect(
      within(footer).queryByTestId("subscriber-template-placement-permission"),
    ).not.toBeInTheDocument();
    expect(
      namesOf(variablesOf(bodyField, values)).some((name: string): boolean => {
        return isCustomFieldTemplateVariableName(name);
      }),
    ).toBe(false);
    expectNoYellowWarning(footer);
  });

  test.each(INCIDENT_EVENT_TYPES)(
    "a %s template's page: the Template Variables Reference lists the fields with no warning",
    async (eventType: StatusPageSubscriberNotificationEventType) => {
      template = new StatusPageSubscriberNotificationTemplate();
      template.eventType = eventType;
      template.notificationMethod =
        StatusPageSubscriberNotificationMethod.Email;

      const { container } = render(
        <MemoryRouter>
          <SubscriberNotificationTemplateView
            pageRoute={
              new Route(
                "/status-pages/settings/subscriber-templates/" + TEMPLATE_ID,
              )
            }
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId(
            "incident-custom-field-template-variable-incident.customFields.affected_location",
          ),
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Template Variables Reference")).toBeVisible();
      expectNoYellowWarning(container as HTMLElement);

      // The Edit dialog's body field: a live preview, and no warning.
      const bodyFields: Array<FormFieldProps> = recordedCards
        .flatMap(formFieldsOf)
        .filter((formField: FormFieldProps): boolean => {
          return isFieldFor(formField, "templateBody");
        });

      expect(bodyFields.length).toBeGreaterThan(0);

      cleanup();

      const help: HTMLElement = renderHelp(
        helpOf(bodyFields[bodyFields.length - 1]!, {
          templateBody: "",
          emailSubject: "",
        }),
      );

      expectNoYellowWarning(help);
    },
  );
});
