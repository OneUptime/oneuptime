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
 * (its description and footer) and the Template Variables Reference are
 * rendered for real:
 *
 *   - the note field of the incident note template forms - a new template's
 *     Note Details step, and a template's Edit Note Template dialog - where
 *     a yellow "Internal data" box sat under the placeholders;
 *   - the template body of the subscriber notification template forms, for
 *     every channel and every incident event, and a template's Template
 *     Variables Reference card, where its twin opened the incident custom
 *     fields.
 *
 * None of them shows a warning box any more, and what they are there for -
 * the placeholders, the fields with their template variables - still shows.
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

/*
 * The words of the two removed warnings: their shared title, and a phrase
 * from each body.
 */
const REMOVED_WARNING_WORDS: RegExp =
  /internal data|before you post a public note|whose subscribers may see them|outside your team/i;

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
  expect(region).not.toHaveTextContent(REMOVED_WARNING_WORDS);
  expect(
    translated.some((text: string): boolean => {
      return REMOVED_WARNING_WORDS.test(text);
    }),
  ).toBe(false);
}

function noteTemplateFormHelpIsClean(noteField: FormFieldProps): void {
  const help: HTMLElement = renderHelp(helpOf(noteField, { note: "" }));

  // The placeholders the note can use are still there...
  for (const variable of INCIDENT_NOTE_TEMPLATE_VARIABLES) {
    expect(within(help).getByText(`{{${variable.name}}}`)).toBeInTheDocument();
  }

  // ...with no warning box, or any other alert, around them.
  expect(within(help).queryAllByRole("alert")).toHaveLength(0);
  expect(help.querySelector(".alert")).toBeNull();
  expectNoYellowWarning(help);
}

describe("the incident note template forms", () => {
  test("a new template's Note Details step shows the placeholders and no warning", async () => {
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

    const table: Record<string, unknown> | undefined = recordedTables.find(
      (props: Record<string, unknown>): boolean => {
        return props["modelType"] === IncidentNoteTemplate;
      },
    );

    expect(table).toBeDefined();

    const noteField: FormFieldProps | undefined = formFieldsOf(table!).find(
      (formField: FormFieldProps): boolean => {
        return isFieldFor(formField, "note");
      },
    );

    expect(noteField).toBeDefined();

    cleanup();
    noteTemplateFormHelpIsClean(noteField!);
  });

  test("Edit Note Template shows the placeholders and no warning", async () => {
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
    noteTemplateFormHelpIsClean(noteFields[noteFields.length - 1]!);
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

  function templateBodyFieldFor(
    channel: StatusPageSubscriberNotificationMethod,
  ): FormFieldProps {
    const table: Record<string, unknown> | undefined = recordedTables.find(
      (props: Record<string, unknown>): boolean => {
        const query: Record<string, unknown> | undefined = props["query"] as
          | Record<string, unknown>
          | undefined;
        return (
          props["modelType"] === StatusPageSubscriberNotificationTemplate &&
          query?.["notificationMethod"] === channel
        );
      },
    );

    expect(table).toBeDefined();

    const bodyField: FormFieldProps | undefined = formFieldsOf(table!).find(
      (formField: FormFieldProps): boolean => {
        return isFieldFor(formField, "templateBody");
      },
    );

    expect(bodyField).toBeDefined();
    return bodyField!;
  }

  describe.each(CHANNELS)("a new %s template", (channel: string) => {
    test.each(INCIDENT_EVENT_TYPES)(
      "for %s, lists the incident custom fields under the body with no warning",
      async (eventType: StatusPageSubscriberNotificationEventType) => {
        await renderTemplatesPage();

        const bodyField: FormFieldProps = templateBodyFieldFor(
          channel as StatusPageSubscriberNotificationMethod,
        );

        cleanup();

        const help: HTMLElement = renderHelp(
          helpOf(bodyField, { eventType: eventType, templateBody: "" }),
        );

        await waitFor(() => {
          expect(
            screen.getByTestId(
              "incident-custom-field-template-variable-customFields.affected_location",
            ),
          ).toBeInTheDocument();
        });

        // Under the variable reference, as before - only the box is gone.
        expect(
          within(help).getByTestId("variables-reference-markdown"),
        ).toBeInTheDocument();
        expect(
          within(help).getByTestId("incident-custom-field-template-variables"),
        ).toBeInTheDocument();
        expectNoYellowWarning(help);
      },
    );
  });

  test("a template for an event without incident fields shows no warning either", async () => {
    await renderTemplatesPage();

    const bodyField: FormFieldProps = templateBodyFieldFor(
      StatusPageSubscriberNotificationMethod.Email,
    );

    cleanup();

    const help: HTMLElement = renderHelp(
      helpOf(bodyField, {
        eventType:
          StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated,
        templateBody: "",
      }),
    );

    // The variable reference is there, for the event the template is for.
    expect(
      within(help).getByTestId("variables-reference-markdown"),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ modelType: IncidentCustomField }),
    );
    expect(
      within(help).queryByTestId("incident-custom-field-template-variables"),
    ).not.toBeInTheDocument();
    expectNoYellowWarning(help);
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
            "incident-custom-field-template-variable-customFields.affected_location",
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
