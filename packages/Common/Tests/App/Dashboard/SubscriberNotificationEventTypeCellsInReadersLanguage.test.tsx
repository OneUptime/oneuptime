import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A SUBSCRIBER TEMPLATE'S EVENT TYPE, IN THE READER'S WORDS, ON A STATUS
 * PAGE'S TEMPLATES AND ON A TEMPLATE'S OWN PAGE (#8179).
 *
 * Besides Subscriber Templates (SubscriberNotificationEventTypesInReaders
 * Language), two more places draw a template's event type: a status page's
 * Subscriber Settings > Notification Templates (its Event Type filter and
 * column) and a template's own page (its Event Type field). Both drew the
 * stored name, "Subscriber Incident Note Created", in every language.
 *
 * Each page is drawn in English, German, Arabic and Persian with its
 * tables and cards recorded; then the filter's options are drawn in a real
 * menu, and the cell and the field as the table and the card draw them.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedCards: Array<Record<string, unknown>> = [];

(
  globalThis as unknown as {
    __eventTypeRecorded: Record<string, Array<Record<string, unknown>>>;
  }
).__eventTypeRecorded = { tables: recordedTables, cards: recordedCards };

type Recorder = (
  list: string,
  testId: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (list: string, testId: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    (
      globalThis as unknown as {
        __eventTypeRecorded: Record<string, Array<Record<string, unknown>>>;
      }
    ).__eventTypeRecorded[list]!.push(props);

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", { "data-testid": testId });
  };
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return { __esModule: true, default: mockRecorder("tables", "model-table") };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: mockRecorder("cards", "card-model-detail"),
  };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return { __esModule: true, default: mockRecorder("tables", "form-modal") };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

for (const component of [
  "SubscriberChannelsCard",
  "SubscriberRestrictionsSettings",
  "SubscriberChannelOffPanel",
  "SubscriberNotificationWarnings",
  "TeamAddedSubscribersUnsubscribedNotice",
]) {
  jest.mock(
    `../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/${component}`,
    () => {
      return {
        __esModule: true,
        default: (): null => {
          return null;
        },
      };
    },
  );
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
    },
  };
});

import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SubscriberNotificationTemplateView from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/SubscriberNotificationTemplateView";
import SubscriberSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SubscriberSettings";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LOCALES: Record<string, Record<string, string>> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Record<string, string>] => {
    return [language, readDashboardLocale(language)];
  }),
);

function word(language: string, english: string): string {
  const drawn: string | undefined = LOCALES[language]![english];

  if (!drawn) {
    throw new Error(`${language} has no word for "${english}"`);
  }

  return drawn;
}

const NOTE_CREATED: Record<string, string> = {
  en: "Subscriber Incident Note Created",
  de: "Vorfallsnotiz erstellt",
  ar: "أُنشئت ملاحظة حادثة",
  fa: "یادداشت حادثه ساخته شد",
};

const PROJECT_ID: string = "81790000-0000-4000-8000-000000000101";
const STATUS_PAGE_ID: string = "81790000-0000-4000-8000-000000000102";
const TEMPLATE_ID: string = "81790000-0000-4000-8000-000000000103";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

function templateFor(
  eventType: string | undefined,
): StatusPageSubscriberNotificationTemplate {
  const template: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();

  template._id = TEMPLATE_ID;
  template.templateName = "Customer note email";
  template.eventType = eventType as StatusPageSubscriberNotificationEventType;
  template.notificationMethod = StatusPageSubscriberNotificationMethod.Email;

  return template;
}

function linkTo(
  eventType: string | undefined,
): StatusPageSubscriberNotificationTemplateStatusPage {
  const link: StatusPageSubscriberNotificationTemplateStatusPage =
    new StatusPageSubscriberNotificationTemplateStatusPage();

  link._id = "81790000-0000-4000-8000-000000000104";
  link.statusPageSubscriberNotificationTemplate = templateFor(eventType);

  return link;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map(
        (
          language: string,
        ): [string, { translation: Record<string, string> }] => {
          return [language, { translation: LOCALES[language]! }];
        },
      ),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  recordedTables.length = 0;
  recordedCards.length = 0;

  getItemMock.mockReset();
  getItemMock.mockImplementation(
    async (options: { modelType?: unknown }): Promise<unknown> => {
      if (options?.modelType === StatusPageSubscriberNotificationTemplate) {
        return templateFor(
          StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
        );
      }

      const page: StatusPage = new StatusPage();
      page._id = STATUS_PAGE_ID;
      return page;
    },
  );
  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 10000 };
  });

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/status-pages"));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(element: ReactElement): Promise<void> {
  await act(async () => {
    render(element);
  });

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

interface EventTypeColumn {
  field?: Record<string, unknown>;
  filterDropdownOptions?: Array<DropdownOption>;
  getElement?: (item: unknown) => ReactElement;
}

// Whether a column, a filter or a field is the event type's, on a template or its link.
function isEventType(entry: EventTypeColumn): boolean {
  const field: Record<string, unknown> = entry.field || {};
  const nested: unknown = field["statusPageSubscriberNotificationTemplate"];

  return (
    field["eventType"] === true ||
    (typeof nested === "object" &&
      (nested as Record<string, unknown>)["eventType"] === true)
  );
}

function linkedTemplatesTable(): Record<string, unknown> {
  const table: Record<string, unknown> | undefined = recordedTables
    .slice()
    .reverse()
    .find((props: Record<string, unknown>): boolean => {
      return (
        props["modelType"] ===
        StatusPageSubscriberNotificationTemplateStatusPage
      );
    });

  expect(table).toBeDefined();

  return table!;
}

// What an element reads as on the page.
function textOf(element: ReactElement): string {
  const { container, unmount } = render(<div>{element}</div>);
  const text: string = container.textContent || "";

  unmount();

  return text;
}

// A filter's options in a real menu, as the table's filter draws them.
async function menuOf(options: Array<DropdownOption>): Promise<Array<string>> {
  const { container, unmount } = render(<Dropdown options={options} />);
  const input: HTMLInputElement | null = container.querySelector(
    "input[role='combobox']",
  );

  expect(input).not.toBeNull();

  await act(async () => {
    fireEvent.keyDown(input!, { key: "ArrowDown", code: "ArrowDown" });
  });

  const menu: HTMLElement | null =
    document.querySelector<HTMLElement>(".ou-select__menu");

  expect(menu).not.toBeNull();

  const labels: Array<string> = within(menu!)
    .getAllByTestId("dropdown-option-label")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });

  unmount();

  return labels;
}

function everyEventType(language: string): Array<string> {
  return Object.values(StatusPageSubscriberNotificationEventType).map(
    (eventType: string): string => {
      return word(language, eventType);
    },
  );
}

describe.each(LANGUAGES)(
  "%s: a status page's Notification Templates",
  (language: string) => {
    beforeAll(async () => {
      await i18next.changeLanguage(language);
    });

    async function openTemplates(): Promise<Record<string, unknown>> {
      await renderPage(<SubscriberSettings {...PAGE_PROPS} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("tab", {
            name: word(language, "Notification Templates"),
          }),
        );
      });

      return linkedTemplatesTable();
    }

    test("the Event Type filter offers each event in the reader's words", async () => {
      const table: Record<string, unknown> = await openTemplates();
      const filter: EventTypeColumn | undefined = (
        table["filters"] as Array<EventTypeColumn>
      ).find(isEventType);

      expect(filter).toBeDefined();
      expect(
        filter!.filterDropdownOptions!.some((option: DropdownOption) => {
          return option.isUserContent;
        }),
      ).toBe(false);
      expect(await menuOf(filter!.filterDropdownOptions!)).toEqual(
        everyEventType(language),
      );
    });

    test("the Event Type column draws a linked template's event in the same words", async () => {
      const table: Record<string, unknown> = await openTemplates();
      const column: EventTypeColumn | undefined = (
        table["columns"] as Array<EventTypeColumn>
      ).find(isEventType);

      expect(column?.getElement).toBeDefined();
      expect(
        textOf(
          column!.getElement!(
            linkTo(
              StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
            ),
          ),
        ),
      ).toBe(NOTE_CREATED[language]);
      expect(
        textOf(
          column!.getElement!(
            linkTo(StatusPageSubscriberNotificationEventType.SubscriberReport),
          ),
        ),
      ).toBe(word(language, "Subscriber Report"));

      // An event a newer server added reads as it is stored, never looked up.
      expect(textOf(column!.getElement!(linkTo("Report")))).toBe("Report");
      // A link whose template went away reads Unknown, in the reader's words.
      expect(textOf(column!.getElement!(linkTo(undefined)))).toBe(
        word(language, "Unknown"),
      );
    });
  },
);

describe.each(LANGUAGES)("%s: a template's own page", (language: string) => {
  beforeAll(async () => {
    await i18next.changeLanguage(language);
  });

  test("its Event Type field reads the event as the list and the filter do", async () => {
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(TEMPLATE_ID));

    await renderPage(<SubscriberNotificationTemplateView {...PAGE_PROPS} />);

    const fields: Array<EventTypeColumn> = recordedCards.flatMap(
      (card: Record<string, unknown>): Array<EventTypeColumn> => {
        return (
          ((card["modelDetailProps"] as Record<string, unknown> | undefined)?.[
            "fields"
          ] as Array<EventTypeColumn> | undefined) || []
        );
      },
    );
    const field: EventTypeColumn | undefined = fields.find(isEventType);

    expect(field?.getElement).toBeDefined();
    expect(
      textOf(
        field!.getElement!(
          templateFor(
            StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
          ),
        ),
      ),
    ).toBe(NOTE_CREATED[language]);
    expect(
      textOf(
        field!.getElement!(
          templateFor(
            StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
          ),
        ),
      ),
    ).toBe(word(language, "Subscriber Scheduled Maintenance Created"));
  });
});
