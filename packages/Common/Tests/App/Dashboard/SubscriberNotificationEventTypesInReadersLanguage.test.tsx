// UX rule: Docs/ux/README.md#in-every-language
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
import { SpyInstance } from "jest-mock";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * A SUBSCRIBER TEMPLATE'S EVENT TYPE IN THE READER'S LANGUAGE (#8179).
 *
 * Status Pages > Settings > Subscriber Templates listed each template's
 * event type as it is stored, "Subscriber Incident Note Created", in every
 * language: the Event Type filter's menu and chip, the Event Type column
 * and the Create Template form's Event Type field. Each is now a key of
 * the Dashboard's locales: English reads the name the API and Terraform
 * take, and German, Arabic and Persian read their own words, alike in all
 * four places.
 *
 * The real page and table, in each language, over a fake ModelAPI: the
 * list is opened from a link that picks the Event Type filter's value, then
 * the chip, the menu and the row are read, and the Create Template form is
 * stepped to its Event Type field. What is saved is the stored value.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(180000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may read and create every template.
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "81790000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

// The template editor's code fields: a plain text box is enough here.
jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: {
      value?: string;
      onChange?: (value: string) => void;
    }): React.ReactElement => {
      return React.createElement("textarea", {
        value: props.value || "",
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          props.onChange?.(event.target.value);
        },
      });
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SubscriberNotificationTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/SubscriberNotificationTemplates";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { PROJECT_ID } from "./SideMenuHarness";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LOCALES: Record<string, Record<string, string>> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Record<string, string>] => {
    return [language, readDashboardLocale(language)];
  }),
);

// A word of the Dashboard's, in a language.
function word(language: string, english: string): string {
  const drawn: string | undefined = LOCALES[language]![english];

  if (!drawn) {
    throw new Error(`${language} has no word for "${english}"`);
  }

  return drawn;
}

// Each language's words for the event types the cases read.
const EXPECTED: Record<string, Record<string, string>> = {
  en: {
    "Subscriber Incident Note Created": "Subscriber Incident Note Created",
    "Subscriber Scheduled Maintenance Created":
      "Subscriber Scheduled Maintenance Created",
    "Subscriber Report": "Subscriber Report",
  },
  de: {
    "Subscriber Incident Note Created": "Vorfallsnotiz erstellt",
    "Subscriber Scheduled Maintenance Created": "Wartungsereignis erstellt",
    "Subscriber Report": "Bericht für Abonnenten",
  },
  ar: {
    "Subscriber Incident Note Created": "أُنشئت ملاحظة حادثة",
    "Subscriber Scheduled Maintenance Created": "أُنشئ حدث صيانة",
    "Subscriber Report": "تقرير للمشتركين",
  },
  fa: {
    "Subscriber Incident Note Created": "یادداشت حادثه ساخته شد",
    "Subscriber Scheduled Maintenance Created":
      "رویداد تعمیر و نگهداری ساخته شد",
    "Subscriber Report": "گزارش برای مشترکان",
  },
};

const TABLE_ID: string = "subscriber-notification-templates-table-email";

// An email template for an incident's new note.
const NOTE_TEMPLATE: StatusPageSubscriberNotificationTemplate = Object.assign(
  new StatusPageSubscriberNotificationTemplate(),
  {
    _id: "81790000-0000-4000-8000-000000000011",
    templateName: "Customer note email",
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
    notificationMethod: StatusPageSubscriberNotificationMethod.Email,
    createdAt: new Date("2026-11-13T09:00:00Z"),
  },
);

function rowsOf(modelType: { new (): BaseModel }): Array<BaseModel> {
  if (modelType === StatusPageSubscriberNotificationTemplate) {
    return [NOTE_TEMPLATE];
  }

  return [];
}

const PATH: string = "status-pages/settings/subscriber-notification-templates";

function pageProps(): PageComponentProps {
  return {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/${PATH}`),
    currentProject: null,
    hasPaymentMethod: true,
  } as unknown as PageComponentProps;
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

let createOrUpdate: SpyInstance<typeof ModelAPI.createOrUpdate>;

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> = rowsOf(options.modelType);

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<number> => {
        return rowsOf(options.modelType).length;
      },
    );
  // createOrUpdate is generic; its spy is the one instantiation the suite reads.
  createOrUpdate = jest.spyOn(ModelAPI, "createOrUpdate").mockResolvedValue({
    data: NOTE_TEMPLATE,
  } as never) as unknown as SpyInstance<typeof ModelAPI.createOrUpdate>;
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The list, opened from a link that has already picked an event type.
async function renderFiltered(filter: JSONObject): Promise<void> {
  const params: Record<string, string> = TableFilterUrlState.getLinkQueryParams(
    TABLE_ID,
    { filter },
  );
  const search: string = Object.keys(params)
    .map((name: string): string => {
      return `${name}=${params[name]}`;
    })
    .join("&");

  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/${PATH}?${search}`,
  );

  await act(async () => {
    render(
      <MemoryRouter>
        <SubscriberNotificationTemplates {...pageProps()} />
      </MemoryRouter>,
    );
  });
  await settle();
}

// A text without the marks that set its words apart on a right-to-left page.
function withoutIsolates(text: string): string {
  return text.replace(/[⁦-⁩]/g, "");
}

// The chip over the list that starts with a filter's name.
function chipOf(field: string): string {
  const chip: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(".rounded-full"),
  ).find((element: HTMLElement): boolean => {
    return withoutIsolates(element.textContent || "").startsWith(field);
  });

  if (!chip) {
    throw new Error(`No chip for ${field}`);
  }

  return withoutIsolates(chip.textContent || "");
}

// The form's button that goes on: Next, then, on the last step, the one that creates.
async function goOn(modal: HTMLElement): Promise<void> {
  const button: HTMLElement | null =
    within(modal).queryByTestId("modal-footer-next-button") ||
    within(modal).queryByTestId("modal-footer-submit-button");

  if (!button) {
    throw new Error("The form has no button that goes on");
  }

  await act(async () => {
    fireEvent.click(button);
  });
  await settle();
}

// Every option an open menu offers.
function openMenuOptions(): Array<string> {
  const menu: HTMLElement | null =
    document.querySelector<HTMLElement>(".ou-select__menu");

  if (!menu) {
    throw new Error("No menu is open");
  }

  return within(menu)
    .getAllByTestId("dropdown-option-label")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });
}

async function openMenuOf(row: HTMLElement): Promise<Array<string>> {
  const input: HTMLInputElement | null = row.querySelector<HTMLInputElement>(
    "input[role='combobox']",
  );

  if (!input) {
    throw new Error("The field has no menu");
  }

  await act(async () => {
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  });
  await settle();

  return openMenuOptions();
}

// Edit Filters, then one filter's menu: the values it has picked and offers.
async function openFilterMenu(
  language: string,
  field: string,
): Promise<{ picked: Array<string>; options: Array<string> }> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: word(language, "Edit Filters") }),
    );
  });
  await settle();

  const label: HTMLElement = screen.getByText(field, { selector: "label" });
  const row: HTMLElement = label.parentElement!.parentElement as HTMLElement;
  const picked: Array<string> = within(row)
    .queryAllByTestId("dropdown-value-label")
    .map((value: HTMLElement): string => {
      return value.textContent || "";
    });

  return { picked, options: await openMenuOf(row) };
}

// Every event type, in a language, in the order the menus offer them.
function everyEventType(language: string): Array<string> {
  return Object.values(StatusPageSubscriberNotificationEventType).map(
    (eventType: string): string => {
      return word(language, eventType);
    },
  );
}

describe("the words the cases below lean on", () => {
  test.each(LANGUAGES)(
    "%s: every event type has a key, and each language but English its own words",
    (language: string) => {
      const drawn: Array<string> = everyEventType(language);

      expect(new Set<string>(drawn).size).toBe(19);

      for (const [eventType, expected] of Object.entries(EXPECTED[language]!)) {
        expect({ eventType, drawn: word(language, eventType) }).toEqual({
          eventType,
          drawn: expected,
        });
      }

      if (language === "en") {
        // English reads each as the API and Terraform name it.
        expect(drawn).toEqual(
          Object.values(StatusPageSubscriberNotificationEventType),
        );
      } else {
        for (const eventType of Object.values(
          StatusPageSubscriberNotificationEventType,
        )) {
          expect({ eventType, inWords: word(language, eventType) }).not.toEqual(
            { eventType, inWords: eventType },
          );
        }
      }
    },
  );
});

describe.each(LANGUAGES)(
  "%s Subscriber Templates, filtered to an incident's new note",
  (language: string) => {
    beforeAll(async () => {
      await i18next.changeLanguage(language);
    });

    const noteCreated: string =
      EXPECTED[language]!["Subscriber Incident Note Created"]!;

    test("the Event Type filter's chip, its menu and the row's cell read the event in the reader's words", async () => {
      await renderFiltered({
        eventType:
          StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
      });

      expect(
        await screen.findByText("Customer note email"),
      ).toBeInTheDocument();

      // The row: the event type in the reader's words.
      const row: HTMLElement = screen
        .getByText("Customer note email")
        .closest("tr") as HTMLElement;

      expect(within(row).getByText(noteCreated)).toBeInTheDocument();

      // The chip names the event as the row does.
      const chip: string = chipOf(word(language, "Event Type"));

      expect(chip).toContain(noteCreated);

      const menu: { picked: Array<string>; options: Array<string> } =
        await openFilterMenu(language, word(language, "Event Type"));

      expect(menu.picked).toEqual([noteCreated]);
      expect(menu.options).toEqual(everyEventType(language));

      if (language !== "en") {
        expect(document.body.textContent).not.toContain(
          "Subscriber Incident Note Created",
        );
        expect(document.body.textContent).not.toContain("Subscriber Report");
      }
    });

    test("the Create Template form's Event Type field offers each event in the reader's words, and saves the stored value", async () => {
      await renderFiltered({});

      expect(
        await screen.findByText("Customer note email"),
      ).toBeInTheDocument();

      const create: HTMLElement | undefined = screen
        .getAllByTestId("card-button")
        .find((button: HTMLElement): boolean => {
          return !(button.textContent || "").includes(
            word(language, "Edit Filters"),
          );
        });

      expect(create).toBeDefined();

      await act(async () => {
        fireEvent.click(create!);
      });
      await settle();

      const modal: HTMLElement = await screen.findByTestId("modal");

      // Template Info: a name, then on to Template Settings.
      fireEvent.change(
        within(modal).getByPlaceholderText(
          word(language, "My Custom Template"),
        ),
        { target: { value: "Maintenance email" } },
      );

      await goOn(modal);

      // Template Settings: the Event Type field, its one menu.
      expect(modal.textContent).toContain(word(language, "Template Settings"));
      expect(modal.textContent).toContain(word(language, "Event Type"));
      expect(within(modal).getAllByRole("combobox")).toHaveLength(1);

      const options: Array<string> = await openMenuOf(modal);

      expect(options).toEqual(everyEventType(language));

      // Picking the maintenance event's words picks its stored value.
      const maintenanceCreated: string =
        EXPECTED[language]!["Subscriber Scheduled Maintenance Created"]!;
      const option: HTMLElement | undefined = within(
        document.querySelector<HTMLElement>(".ou-select__menu")!,
      )
        .getAllByTestId("dropdown-option-label")
        .find((candidate: HTMLElement): boolean => {
          return candidate.textContent === maintenanceCreated;
        });

      expect(option).toBeDefined();

      await act(async () => {
        fireEvent.click(option!);
      });
      await settle();

      expect(
        within(modal)
          .getAllByTestId("dropdown-value-label")
          .map((value: HTMLElement): string => {
            return value.textContent || "";
          }),
      ).toContain(maintenanceCreated);

      if (language !== "en") {
        expect(modal.textContent).not.toContain(
          "Subscriber Scheduled Maintenance Created",
        );
      }

      /*
       * Template Content, seeded with the event's default subject and body,
       * then Create: the template is saved with the stored value.
       */
      await goOn(modal);
      expect(createOrUpdate).not.toHaveBeenCalled();
      await goOn(modal);

      const call: Array<unknown> | undefined = createOrUpdate.mock.calls.find(
        (args: Array<unknown>): boolean => {
          return (
            (args[0] as { modelType?: unknown }).modelType ===
            StatusPageSubscriberNotificationTemplate
          );
        },
      );

      expect(call).toBeDefined();

      const saved: StatusPageSubscriberNotificationTemplate = (
        call![0] as { model: StatusPageSubscriberNotificationTemplate }
      ).model;

      expect({
        templateName: saved.templateName,
        eventType: saved.eventType,
        notificationMethod: saved.notificationMethod,
      }).toEqual({
        templateName: "Maintenance email",
        eventType:
          StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
        notificationMethod: StatusPageSubscriberNotificationMethod.Email,
      });
    });
  },
);
