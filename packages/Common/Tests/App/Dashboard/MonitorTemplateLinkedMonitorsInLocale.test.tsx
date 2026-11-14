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
  UNLINK_MONITOR_CONFIRMATION,
  UNLINKED_MONITOR_RESULT,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateLinkedMonitorsWords";
import {
  buildSyncResultSummary,
  STILL_ON_PREVIOUS_CONFIGURATION,
  SyncResultSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateSyncResultUtil";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
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
 *
 * And (#7710): a sync button says the same kind of thing before the count
 * is read as after - in German "Intervall mit verknüpften Monitoren
 * synchronisieren", never the noun "Synchronisierungsintervall" until the
 * count turns it into a command - as its dialog's button does; a sync's
 * summary writes its counts in the reader's digits and runs its two
 * sentences together as the reader's script does; and Unlink from
 * Template asks first with the monitor's name set apart.
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

// Starts a row action of the Linked Monitors table on Checkout API: its confirmation opens.
async function openRowAction(title: string): Promise<void> {
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
}

// The open dialog's own button, pressed.
async function confirm(): Promise<void> {
  await act(async () => {
    fireEvent.click(await screen.findByTestId("modal-footer-submit-button"));
  });
}

// Runs a row action of the Linked Monitors table on Checkout API, and confirms it.
async function runRowAction(title: string): Promise<void> {
  await openRowAction(title);
  await confirm();
}

// Presses a card's sync button: its dialog opens.
async function pressSyncButton(
  card: "Monitoring Criteria" | "Monitoring Interval",
): Promise<void> {
  await act(async () => {
    lastDetail(card).cardProps!.buttons![0]!.onClick!();
  });
}

/*
 * A card button's title as the button draws it in `language`: Button looks
 * its title up as it is written (useTranslateValue's translateString), so
 * a title with no count, which the page hands over in English, is drawn in
 * the reader's words.
 */
function asDrawn(language: string, title: string): string {
  return instances[language]!.t(title, {
    defaultValue: title,
    keySeparator: false,
    nsSeparator: false,
  });
}

// A counted line's general form in the language of `words`, for 3: English where it has none.
function forThree(
  words: Record<string, string>,
  template: { other: string },
): string {
  return (words[template.other] || template.other).replace("{{count}}", "3");
}

/*
 * How each language the Dashboard speaks says "sync ..." as a command, the
 * verb where its grammar puts it: first ("Sync", "Synkroniser",
 * "Синхронизировать"), last ("... synchronisieren", "... सिंक करें",
 * "... 동기화", "...同期"), or after its object in Dutch ("Interval
 * synchroniseren naar ..."). A noun - "Synchronisierungsintervall", "सिंक
 * अंतराल", "동기화 간격", "the synchronization interval" - matches none
 * (#7710). Persian and Arabic name the action with its noun on every
 * button, so theirs only say it is one.
 */
const SYNC_COMMAND: Record<string, RegExp> = {
  en: /^Sync /,
  ar: /^مزامنة /,
  da: /^Synkronis[eé]r /,
  de: / synchronisieren$/,
  es: /^Sincronizar /,
  fa: /^همگام/,
  fr: /^Synchroniser /,
  hi: / सिंक करें$/,
  it: /^Sincronizza /,
  ja: /同期$/,
  ko: / 동기화$/,
  nl: / synchroniseren( |$)/,
  no: /^Synkroniser /,
  pt: /^Sincronizar /,
  ru: /^Синхронизировать /,
  sv: /^Synkronisera /,
  "zh-CN": /^(将.+)?同步/,
  "zh-TW": /^(將.+)?同步/,
};

// The four sync buttons: each one's title before the count is read, and its dialog's button.
const SYNC_BUTTONS: Array<{
  counted: PluralTemplate;
  countless: string;
  dialogButton: string;
}> = [
  {
    counted: SYNC_TO_LINKED_MONITORS_TITLES.criteria,
    countless: "Sync Criteria to Linked Monitors",
    dialogButton: "Sync Criteria",
  },
  {
    counted: SYNC_TO_LINKED_MONITORS_TITLES.interval,
    countless: "Sync Interval to Linked Monitors",
    dialogButton: "Sync Interval",
  },
  {
    counted: SYNC_TO_LINKED_MONITORS_TITLES.labels,
    countless: "Sync Labels to Linked Monitors",
    dialogButton: "Sync Labels",
  },
  {
    counted: SYNC_TO_LINKED_MONITORS_TITLES.customFields,
    countless: "Sync Custom Fields to Linked Monitors",
    dialogButton: "Sync Custom Fields",
  },
];

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

  test("each sync button says to sync before the count is read, as after it, and so does its dialog (#7710)", async () => {
    // The linked monitors' count is on its way: the buttons have no count to say yet.
    let answerCount: (count: number) => void = (): void => {};

    jest.spyOn(ModelAPI, "count").mockImplementation((() => {
      return new Promise<number>((resolve: (count: number) => void) => {
        answerCount = resolve;
      });
    }) as never);

    await openPage("de");

    const before: ReturnType<typeof titles> = titles();

    // The page hands each button the title the guard below reads in every language.
    expect([
      before.criteria,
      before.interval,
      before.labels,
      before.customFields,
    ]).toEqual(
      SYNC_BUTTONS.map((button: { countless: string }): string => {
        return button.countless;
      }),
    );

    expect({
      criteria: asDrawn("de", before.criteria),
      interval: asDrawn("de", before.interval),
      labels: asDrawn("de", before.labels),
      customFields: asDrawn("de", before.customFields),
    }).toEqual({
      criteria: "Kriterien mit verknüpften Monitoren synchronisieren",
      interval: "Intervall mit verknüpften Monitoren synchronisieren",
      labels: "Beschriftungen mit verknüpften Monitoren synchronisieren",
      customFields:
        "Benutzerdefinierte Felder mit verknüpften Monitoren synchronisieren",
    });

    // The Interval button's dialog: its title is the button's, and its own button says to sync.
    await pressSyncButton("Monitoring Interval");

    expect((await screen.findByTestId("modal-title")).textContent).toBe(
      "Intervall mit verknüpften Monitoren synchronisieren",
    );
    expect(screen.getByTestId("modal-footer-submit-button").textContent).toBe(
      "Intervall synchronisieren",
    );

    await act(async () => {
      answerCount(3);
    });

    await waitFor(() => {
      expect(titles().interval).toBe(
        "Intervall mit 3 verknüpften Monitoren synchronisieren",
      );
    });

    // Before the count and after it, every one is a command: "... synchronisieren".
    const after: ReturnType<typeof titles> = titles();

    for (const title of [
      asDrawn("de", before.criteria),
      asDrawn("de", before.interval),
      asDrawn("de", before.labels),
      asDrawn("de", before.customFields),
      after.criteria,
      after.interval,
      after.labels,
      after.customFields,
    ]) {
      expect(title).toMatch(SYNC_COMMAND["de"]!);
    }
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

  test("Unlink from Template asks first in Persian, a Latin name kept as written, set apart (#7710)", async () => {
    await openPage("fa");
    await openRowAction("Unlink from Template");

    const question: HTMLElement = await resultLine();

    expect(question.textContent).toBe(
      PERSIAN[UNLINK_MONITOR_CONFIRMATION]!.replace(
        "{{monitorName}}",
        `${FIRST_STRONG_ISOLATE}Checkout API${POP_DIRECTIONAL_ISOLATE}`,
      ),
    );

    const name: HTMLElement | null = question.querySelector("bdi");

    expect(name?.textContent).toBe("Checkout API");
    expect(name?.getAttribute("dir")).toBe("ltr");
  });

  test("a sync that reached 3 of 5 linked monitors says so in Persian, with Persian digits (#7710)", async () => {
    linkedMonitors = 5;
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          { syncedMonitors: 3, totalLinkedMonitors: 5 },
          {},
        ) as never as HTTPErrorResponse,
      );

    await openPage("fa");
    await pressSyncButton("Monitoring Criteria");
    await confirm();

    expect((await screen.findByTestId("modal-title")).textContent).toBe(
      PERSIAN["Partially synced"],
    );
    expect((await resultLine()).textContent).toBe(
      `معیارها روی ۳ مانیتور همگام شد (۵ مانیتور به این قالب پیوند دارند). ${PERSIAN[
        STILL_ON_PREVIOUS_CONFIGURATION.other
      ]!.replace("{{count}}", "۲")}`,
    );
    expect((await resultLine()).textContent).not.toMatch(/[0-9]/);
  });
});

describe("a sync's summary, in the reader's language (#7710)", () => {
  test("in Persian, every count is written in Persian digits", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 10000,
      totalLinkedMonitors: 50000,
      translator: dashboardTranslator("fa"),
    });

    expect(summary.message).toContain("۱۰٬۰۰۰");
    expect(summary.message).toContain("۵۰٬۰۰۰");
    expect(summary.message).toContain("۴۰٬۰۰۰");
    expect(summary.message).not.toMatch(/[0-9]/);
  });

  test("in Japanese and both Chinese, the two sentences follow one another with no space; in English, with one", () => {
    const summaries: Record<string, string> = {};

    for (const language of ["en", "ja", "zh-CN", "zh-TW"]) {
      summaries[language] = buildSyncResultSummary({
        subject: "criteria",
        syncedMonitors: 3,
        totalLinkedMonitors: 5,
        translator: dashboardTranslator(language),
      }).message;
    }

    expect(summaries).toEqual({
      en: "Synced criteria onto 3 monitors (5 linked to this template). 2 linked monitors still use the previous configuration — usually because your permissions do not cover them. Run the sync again as a user who can update every linked monitor.",
      ja: "条件を 3 個のモニターに同期しました（このテンプレートにリンクされているのは 5 個）。リンクされた 2 個のモニターは、まだ以前の設定を使っています — 通常は、あなたの権限がそれらに及ばないことが原因です。リンクされたすべてのモニターを更新できるユーザーとして、もう一度同期を実行してください。",
      "zh-CN":
        "已将条件同步到 3 个监视器（共 5 个关联到此模板）。2 个已关联的监视器仍在使用之前的配置，通常是因为你的权限不覆盖它们。请以能够更新每个已关联监视器的用户身份重新运行同步。",
      "zh-TW":
        "已將條件同步到 3 個監測器（共 5 個連結到此範本）。2 個已連結的監測器仍在使用先前的設定，通常是因為你的權限未涵蓋它們。請以能夠更新每個已連結監測器的使用者身分重新執行同步。",
    });
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
      UNLINK_MONITOR_CONFIRMATION,
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

  test("every sync button is a command in every language, before the count is read as after it, and so is its dialog's button (#7710)", () => {
    expect(Object.keys(SYNC_COMMAND).sort()).toEqual(
      ["en", ...DASHBOARD_LANGUAGES].sort(),
    );

    const english: Record<string, string> = readDashboardLocale("en");

    for (const button of SYNC_BUTTONS) {
      expect(english[button.countless]).toBe(button.countless);
      expect(english[button.dialogButton]).toBe(button.dialogButton);
    }

    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const reader: Translator = dashboardTranslator(language);
      const command: RegExp = SYNC_COMMAND[language]!;
      const notCommands: Array<string> = [];

      for (const button of SYNC_BUTTONS) {
        for (const title of [
          reader.translateText(button.countless)!,
          reader.translatePlural(button.counted, 1),
          reader.translatePlural(button.counted, 3),
          reader.translateText(button.dialogButton)!,
        ]) {
          if (!command.test(title)) {
            notCommands.push(title);
          }
        }
      }

      expect({ language, notCommands }).toEqual({ language, notCommands: [] });
    }
  });

  test("the Interval button says the same command before the count is read as after it, in the languages that once named it (#7710)", () => {
    // Each said "the synchronization interval" until the count was read, and its dialog's button always did.
    const interval: Record<
      string,
      { countless: string; counted: string; dialogButton: string }
    > = {
      de: {
        countless: "Intervall mit verknüpften Monitoren synchronisieren",
        counted: "Intervall mit 3 verknüpften Monitoren synchronisieren",
        dialogButton: "Intervall synchronisieren",
      },
      pt: {
        countless: "Sincronizar Intervalo com Monitores Vinculados",
        counted: "Sincronizar Intervalo com 3 Monitores Vinculados",
        dialogButton: "Sincronizar Intervalo",
      },
      nl: {
        countless: "Interval synchroniseren naar gekoppelde monitoren",
        counted: "Interval synchroniseren naar 3 gekoppelde monitoren",
        dialogButton: "Interval synchroniseren",
      },
      no: {
        countless: "Synkroniser intervall til koblede overvåkere",
        counted: "Synkroniser intervall til 3 koblede overvåkere",
        dialogButton: "Synkroniser intervall",
      },
      hi: {
        countless: "लिंक किए गए मॉनिटर के साथ अंतराल सिंक करें",
        counted: "लिंक किए गए 3 मॉनिटर के साथ अंतराल सिंक करें",
        dialogButton: "अंतराल सिंक करें",
      },
      ko: {
        countless: "연결된 모니터에 간격 동기화",
        counted: "연결된 모니터 3개에 간격 동기화",
        dialogButton: "간격 동기화",
      },
    };

    for (const [language, expected] of Object.entries(interval)) {
      const reader: Translator = dashboardTranslator(language);

      expect({
        language,
        countless: reader.translateText("Sync Interval to Linked Monitors"),
        counted: reader.translatePlural(
          SYNC_TO_LINKED_MONITORS_TITLES.interval,
          3,
        ),
        dialogButton: reader.translateText("Sync Interval"),
      }).toEqual({ language, ...expected });
    }
  });
});
