import "@testing-library/jest-dom";
import {
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
  waitFor,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { MONITOR_NOT_LINKED_REFUSAL } from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import MonitorTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView";
import {
  LINKED_MONITORS_RESULT,
  LINKED_MONITORS_TITLE,
  SYNC_TO_LINKED_MONITORS_TITLES,
  SYNCED_MONITOR_RESULT,
  UNLINKED_MONITOR_RESULT,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateLinkedMonitorsWords";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHAT A TEMPLATE'S PAGE SAYS ABOUT ITS LINKED MONITORS, ONE LANGUAGE EACH
 * (#7678).
 *
 * The sync buttons said how many monitors they reach ("Sync Criteria to 3
 * Linked Monitors"), the Linked Monitors card carried the count in its
 * title, and Link Existing Monitors, Unlink from Template and Sync from
 * Template said what they did - all built in English, so every language
 * read them in English, with Latin digits. Each is a sentence of the
 * locales now: the count in the reader's digits, the form its number takes
 * ("1 verknüpften Monitor", "4 verknüpften Monitoren"), and a monitor's
 * name as it was written, set apart in the sentence (bdi).
 */

interface CardButton {
  title: string;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

interface CapturedDetail {
  name: string;
  cardProps?: { buttons?: Array<CardButton> | undefined } | undefined;
}

interface CapturedCustomFields {
  additionalButtons?: Array<CardButton> | undefined;
}

type ActionButtonClick = (
  monitor: Monitor,
  onCompleteAction: () => void,
  onError: (error: Error) => void,
) => void;

interface CapturedMonitorTable {
  title?: string | undefined;
  cardButtons?: Array<CardButton> | undefined;
  actionButtons?:
    | Array<{ title: string; onClick: ActionButtonClick }>
    | undefined;
}

interface CapturedFormModal {
  title: string;
  onSubmit: (values: { monitorIds: Array<string> }) => Promise<void> | void;
}

let capturedDetails: Array<CapturedDetail> = [];
let capturedCustomFields: Array<CapturedCustomFields> = [];
let capturedTables: Array<CapturedMonitorTable> = [];
let capturedModals: Array<CapturedFormModal> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedDetail) => {
      capturedDetails.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/CustomFields/CustomFieldsDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedCustomFields) => {
      capturedCustomFields.push(props);
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedMonitorTable) => {
        capturedTables.push(props);
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

// The link dialog is kept for its submit: every monitor picked is linked here.
jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedFormModal) => {
      capturedModals.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  const ObjectIDType: typeof ObjectID = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: typeof ObjectID;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: () => {
        return {
          id: new ObjectIDType("10000000-0000-4000-8000-000000000001"),
        };
      },
      getCurrentPlan: () => {
        return null;
      },
    },
  };
});

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";
const CHECKOUT_ID: string = "60000000-0000-4000-8000-000000000001";

const GERMAN: Record<string, string> = readDashboardLocale("de");
const PERSIAN: Record<string, string> = readDashboardLocale("fa");

// The template's linked monitors, as the server counts them.
let linkedMonitors: number = 0;

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, words] of Object.entries({
    de: GERMAN,
    fa: PERSIAN,
  })) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: words },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[language] = instance;
  }
});

beforeEach(() => {
  capturedDetails = [];
  capturedCustomFields = [];
  capturedTables = [];
  capturedModals = [];
  linkedMonitors = 0;

  const template: MonitorTemplate = new MonitorTemplate();
  template.monitorType = MonitorType.API;
  template.monitorSteps = new MonitorSteps();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(TEMPLATE_ID));
  jest.spyOn(ModelAPI, "count").mockImplementation((async () => {
    return linkedMonitors;
  }) as never);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(template as never);
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}) as never as HTTPErrorResponse,
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openPage(language: string): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <MonitorTemplatesView
          pageRoute={
            new Route(`/dashboard/monitors/settings/templates/${TEMPLATE_ID}`)
          }
          currentProject={null}
          hasPaymentMethod={true}
        />
      </I18nextProvider>,
    );
  });

  // The criteria and interval cards come once the template's type is read.
  await waitFor(() => {
    expect(
      capturedDetails.some((detail: CapturedDetail): boolean => {
        return detail.name === "Monitoring Interval";
      }),
    ).toBe(true);
  });
}

function lastDetail(name: string): CapturedDetail {
  return capturedDetails
    .filter((detail: CapturedDetail): boolean => {
      return detail.name === name;
    })
    .pop()!;
}

// What the four sync buttons and the Linked Monitors card are called now.
function titles(): {
  criteria: string;
  interval: string;
  labels: string;
  customFields: string;
  linkedMonitors: string;
} {
  return {
    criteria: lastDetail("Monitoring Criteria").cardProps!.buttons![0]!.title,
    interval: lastDetail("Monitoring Interval").cardProps!.buttons![0]!.title,
    labels: lastDetail("Labels").cardProps!.buttons![0]!.title,
    customFields:
      capturedCustomFields[capturedCustomFields.length - 1]!
        .additionalButtons![0]!.title,
    linkedMonitors: capturedTables[capturedTables.length - 1]!.title!,
  };
}

function lastTable(): CapturedMonitorTable {
  return capturedTables[capturedTables.length - 1]!;
}

// Opens Link Existing Monitors and links the monitors picked.
async function link(monitorIds: Array<string>): Promise<void> {
  const linkButton: CardButton = lastTable().cardButtons!.find(
    (button: CardButton): boolean => {
      return button.title === "Link Existing Monitors";
    },
  )!;

  capturedModals = [];

  await act(async () => {
    linkButton.onClick!();
  });

  await waitFor(() => {
    expect(capturedModals.length).toBeGreaterThan(0);
  });

  await act(async () => {
    await capturedModals[capturedModals.length - 1]!.onSubmit({
      monitorIds: monitorIds,
    });
  });
}

// The Done dialog's line.
async function resultLine(): Promise<HTMLElement> {
  return await screen.findByTestId("confirm-modal-description");
}

async function closeResult(): Promise<void> {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
  });
}

// Runs a row action of the Linked Monitors table on Checkout API, and confirms it.
async function runRowAction(title: string): Promise<void> {
  const monitor: Monitor = new Monitor(new ObjectID(CHECKOUT_ID));
  monitor.name = "Checkout API";

  const action: { title: string; onClick: ActionButtonClick } =
    lastTable().actionButtons!.find((button: { title: string }): boolean => {
      return button.title === title;
    })!;

  await act(async () => {
    action.onClick(
      monitor,
      () => {},
      () => {},
    );
  });

  await act(async () => {
    fireEvent.click(await screen.findByTestId("modal-footer-submit-button"));
  });
}

// A counted line's general form in the language of `words`, for 3: English where it has none.
function forThree(
  words: Record<string, string>,
  template: { other: string },
): string {
  return (words[template.other] || template.other).replace("{{count}}", "3");
}

describe("Link Existing Monitors and the sync buttons, in German", () => {
  test("after linking 1 monitor and then 3: the line and the titles are German, each in its number's form", async () => {
    await openPage("de");

    linkedMonitors = 1;
    await link([CHECKOUT_ID]);

    expect((await resultLine()).textContent).toBe(
      "1 Monitor mit dieser Vorlage verknüpft.",
    );
    await waitFor(() => {
      expect(titles()).toEqual({
        criteria: "Kriterien mit 1 verknüpften Monitor synchronisieren",
        interval: "Intervall mit 1 verknüpften Monitor synchronisieren",
        labels: "Beschriftungen mit 1 verknüpften Monitor synchronisieren",
        customFields:
          "Benutzerdefinierte Felder mit 1 verknüpften Monitor synchronisieren",
        linkedMonitors: "Verknüpfte Monitore (1)",
      });
    });

    await closeResult();

    linkedMonitors = 4;
    await link([
      "60000000-0000-4000-8000-000000000002",
      "60000000-0000-4000-8000-000000000003",
      "60000000-0000-4000-8000-000000000004",
    ]);

    expect((await resultLine()).textContent).toBe(
      "3 Monitore mit dieser Vorlage verknüpft.",
    );
    await waitFor(() => {
      expect(titles()).toEqual({
        criteria: "Kriterien mit 4 verknüpften Monitoren synchronisieren",
        interval: "Intervall mit 4 verknüpften Monitoren synchronisieren",
        labels: "Beschriftungen mit 4 verknüpften Monitoren synchronisieren",
        customFields:
          "Benutzerdefinierte Felder mit 4 verknüpften Monitoren synchronisieren",
        linkedMonitors: "Verknüpfte Monitore (4)",
      });
    });
  });

  test("Unlink from Template says it in German, the monitor's name as written, set apart", async () => {
    await openPage("de");
    await runRowAction("Unlink from Template");

    await waitFor(async () => {
      expect((await resultLine()).textContent).toBe(
        "Die Verknüpfung von „Checkout API“ mit dieser Vorlage wurde aufgehoben.",
      );
    });

    const name: HTMLElement | null = (await resultLine()).querySelector("bdi");

    expect(name?.textContent).toBe("Checkout API");
  });

  test("Sync from Template says it in German, the monitor's name as written, set apart", async () => {
    await openPage("de");
    await runRowAction("Sync from Template");

    await waitFor(async () => {
      expect((await resultLine()).textContent).toBe(
        "„Checkout API“ wurde aus dieser Vorlage synchronisiert.",
      );
    });

    expect((await resultLine()).querySelector("bdi")?.textContent).toBe(
      "Checkout API",
    );
  });

  test("Unlink from Template, refused: the server's reason, in German", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: MONITOR_NOT_LINKED_REFUSAL },
          {},
        ) as never,
      );

    await openPage("de");
    await runRowAction("Unlink from Template");

    expect((await screen.findByTestId("modal-error")).textContent).toBe(
      "Dieser Monitor ist nicht mit dieser Vorlage verknüpft.",
    );
    expect(GERMAN[MONITOR_NOT_LINKED_REFUSAL]).toBe(
      "Dieser Monitor ist nicht mit dieser Vorlage verknüpft.",
    );
  });
});

describe("Link Existing Monitors and the sync buttons, in Persian", () => {
  test("after linking 1 monitor and then 3: the line and the titles are Persian, with Persian digits", async () => {
    await openPage("fa");

    linkedMonitors = 1;
    await link([CHECKOUT_ID]);

    expect((await resultLine()).textContent).toBe(
      "۱ مانیتور به این قالب پیوند داده شد.",
    );
    await waitFor(() => {
      expect(titles()).toEqual({
        criteria: "همگام‌سازی معیارها با ۱ مانیتور پیوندشده",
        interval: "همگام‌سازی بازه با ۱ مانیتور پیوندشده",
        labels: "همگام‌سازی برچسب‌ها با ۱ مانیتور پیوندشده",
        customFields: "همگام‌سازی فیلدهای سفارشی با ۱ مانیتور پیوندشده",
        linkedMonitors: "مانیتورهای پیوندشده (۱)",
      });
    });

    await closeResult();

    linkedMonitors = 4;
    await link([
      "60000000-0000-4000-8000-000000000002",
      "60000000-0000-4000-8000-000000000003",
      "60000000-0000-4000-8000-000000000004",
    ]);

    expect((await resultLine()).textContent).toBe(
      "۳ مانیتور به این قالب پیوند داده شد.",
    );
    await waitFor(() => {
      expect(titles()).toEqual({
        criteria: "همگام‌سازی معیارها با ۴ مانیتور پیوندشده",
        interval: "همگام‌سازی بازه با ۴ مانیتور پیوندشده",
        labels: "همگام‌سازی برچسب‌ها با ۴ مانیتور پیوندشده",
        customFields: "همگام‌سازی فیلدهای سفارشی با ۴ مانیتور پیوندشده",
        linkedMonitors: "مانیتورهای پیوندشده (۴)",
      });
    });

    // Not a Latin digit anywhere.
    expect(JSON.stringify(titles())).not.toMatch(/[0-9]/);
  });

  test("Unlink from Template says it in Persian, a Latin name kept as written, set apart", async () => {
    await openPage("fa");
    await runRowAction("Unlink from Template");

    // In a sentence read right to left the name is set apart twice: in an isolate, and in its bdi.
    await waitFor(async () => {
      expect((await resultLine()).textContent).toBe(
        `پیوند «${FIRST_STRONG_ISOLATE}Checkout API${POP_DIRECTIONAL_ISOLATE}» از این قالب لغو شد.`,
      );
    });

    const name: HTMLElement | null = (await resultLine()).querySelector("bdi");

    expect(name?.textContent).toBe("Checkout API");
    expect(name?.getAttribute("dir")).toBe("ltr");
  });
});

describe("the page's words about its linked monitors", () => {
  test("are worded in every language the Dashboard speaks, each count form", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const counted: Array<{ one: string; other: string }> = [
      LINKED_MONITORS_RESULT,
      SYNC_TO_LINKED_MONITORS_TITLES.criteria,
      SYNC_TO_LINKED_MONITORS_TITLES.interval,
      SYNC_TO_LINKED_MONITORS_TITLES.labels,
      SYNC_TO_LINKED_MONITORS_TITLES.customFields,
    ];
    const sentences: Array<string> = [
      LINKED_MONITORS_TITLE,
      UNLINKED_MONITOR_RESULT,
      SYNCED_MONITOR_RESULT,
    ];

    for (const template of counted) {
      expect(english[template.other]).toBe(template.other);
      expect(english[`${template.other}_one`]).toBe(template.one);
    }

    for (const sentence of sentences) {
      expect(english[sentence]).toBe(sentence);
    }

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const english3: Array<string> = counted.map(
        (template: { other: string }): string => {
          return forThree(english, template);
        },
      );
      const worded3: Array<string> = counted.map(
        (template: { other: string }): string => {
          return forThree(words, template);
        },
      );

      expect({
        language,
        counted: worded3.filter((text: string, index: number): boolean => {
          return text === english3[index];
        }),
        sentences: sentences.filter((sentence: string): boolean => {
          return !words[sentence] || words[sentence] === sentence;
        }),
      }).toEqual({ language, counted: [], sentences: [] });
    }
  });
});
