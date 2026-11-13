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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { SERVER_DOWN_MESSAGE } from "../../../Types/Exception/UnexplainedError";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import {
  getMonitorTypeMismatchRefusal,
  MONITOR_NOT_FOUND_REFUSAL,
  MONITOR_TYPE_MISMATCH_REFUSAL,
} from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import MonitorTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView";
import {
  getLinkFailuresText,
  LINK_FAILURES_TEMPLATE,
  LINKED_MONITORS_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateLinkedMonitorsWords";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * LINK EXISTING MONITORS, WHEN SOME COULD NOT BE LINKED (#7629, #7678).
 *
 * The dialog said "2 of 3 link operations failed: Monitor not found; Error
 * connecting to server. Please try again in few minutes." in every
 * language: the sentence was built in code, and the reasons were joined
 * with a Latin "; ". It is a translated plural sentence now. Each reason is
 * said as ErrorMessageText says an error - a server that did not answer says
 * why and what to do, in the reader's language - and the reasons are
 * clauses of one line, in the language the sentence comes out in, with its
 * semicolon: "; " in German, "؛ " in Persian, " ; " in French.
 *
 * And (#7678): the monitors that were linked are linked, whatever happened
 * to the rest - the page reads its count, its table and the monitors that
 * can still be linked again, and says how many of how many could not be
 * linked whenever more than one was picked, "1 of 3" too. The server's
 * refusals are sentences of the Dashboard's locales, a type mismatch with
 * its two types, so a German reader reads why in German.
 */

interface CardButton {
  title: string;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

interface CapturedMonitorTable {
  title?: string | undefined;
  refreshToggle?: string | undefined;
  cardButtons?: Array<CardButton>;
}

interface CapturedFormModal {
  title: string;
  error?: string | undefined;
  onSubmit: (values: { monitorIds: Array<string> }) => Promise<void> | void;
}

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
    default: () => {
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
    default: () => {
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

/*
 * The dialog's form is not what this is about: the dialog is kept for its
 * submit, and its error is drawn by the dialog's own body (ModalBody), as
 * the Modal draws it.
 */
jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  const ModalBody: FunctionComponent<{
    error?: string | undefined;
    children: ReactElement;
  }> = (
    jest.requireActual("../../../UI/Components/Modal/ModalBody") as {
      default: FunctionComponent<{
        error?: string | undefined;
        children: ReactElement;
      }>;
    }
  ).default;

  return {
    __esModule: true,
    default: (props: CapturedFormModal) => {
      capturedModals.push(props);
      return ReactModule.createElement(ModalBody, {
        error: props.error,
        children: ReactModule.createElement("div"),
      });
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

// Linked.
const CHECKOUT_ID: string = "60000000-0000-4000-8000-000000000001";
// Refused in words of the server's own that no locale has: drawn as written.
const SEARCH_ID: string = "60000000-0000-4000-8000-000000000002";
// The gateway answered for a server that did not.
const BILLING_ID: string = "60000000-0000-4000-8000-000000000003";
// Gone before it could be linked: the server's refusal, a sentence of the locales.
const GONE_ID: string = "60000000-0000-4000-8000-000000000004";
// An Incoming Request monitor, which an API template does not link.
const INBOX_ID: string = "60000000-0000-4000-8000-000000000005";
// Linked too.
const INVENTORY_ID: string = "60000000-0000-4000-8000-000000000006";

const SERVER_SAYS: string = "Monitor not found";

const KEY: string = LINK_FAILURES_TEMPLATE.other;

const SERVER_DOWN_WHY: string = "The OneUptime server did not answer.";
const SERVER_DOWN_NEXT: string =
  "It may be starting or restarting. Try again in a few minutes.";

const GERMAN: Record<string, string> = readDashboardLocale("de");
const PERSIAN: Record<string, string> = readDashboardLocale("fa");

// German that has not worded the sentence yet: it words the reasons.
const GERMAN_BUT_THE_SENTENCE: Record<string, string> = Object.fromEntries(
  Object.entries(GERMAN).filter(([key]: [string, string]): boolean => {
    return !key.startsWith(KEY);
  }),
);

// The monitor of another type, as the server refuses it: in English.
const TYPE_MISMATCH: string = getMonitorTypeMismatchRefusal({
  monitorType: MonitorType.IncomingRequest,
  templateType: MonitorType.API,
});

// The same refusal, as a German reader is to read it: German words for the types too.
const GERMAN_TYPE_MISMATCH: string = (
  GERMAN[MONITOR_TYPE_MISMATCH_REFUSAL.template] as string
)
  .split("{{monitorType}}")
  .join(GERMAN["Incoming Request"] as string)
  .split("{{templateType}}")
  .join(GERMAN["API"] as string);

const instances: Record<string, i18n> = {};

// The template's linked monitors, as the server counts them.
let linkedMonitors: number = 0;

beforeAll(async () => {
  const languages: Array<[string, string, Record<string, string>]> = [
    ["de", "de", GERMAN],
    ["de without the sentence", "de", GERMAN_BUT_THE_SENTENCE],
    ["fa", "fa", PERSIAN],
  ];

  for (const [name, language, words] of languages) {
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
    instances[name] = instance;
  }
});

beforeEach(() => {
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

  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const url: string = args.url.toString();

    if (url.endsWith(`/link-monitor/${SEARCH_ID}`)) {
      return new HTTPErrorResponse(400, { message: SERVER_SAYS }, {});
    }

    if (url.endsWith(`/link-monitor/${BILLING_ID}`)) {
      return new HTTPErrorResponse(502, {}, {});
    }

    if (url.endsWith(`/link-monitor/${GONE_ID}`)) {
      return new HTTPErrorResponse(
        400,
        { message: MONITOR_NOT_FOUND_REFUSAL },
        {},
      );
    }

    if (url.endsWith(`/link-monitor/${INBOX_ID}`)) {
      return new HTTPErrorResponse(400, { message: TYPE_MISMATCH }, {});
    }

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The template's page, its Link Existing Monitors dialog open.
async function openLinkDialog(instance: string): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[instance]!}>
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

  // The button opens the dialog once the template's type is read.
  let linkButton: CardButton | undefined = undefined;

  await waitFor(() => {
    const table: CapturedMonitorTable | undefined =
      capturedTables[capturedTables.length - 1];

    linkButton = table?.cardButtons?.find((button: CardButton): boolean => {
      return button.title === "Link Existing Monitors" && !button.disabled;
    });

    expect(linkButton).toBeTruthy();
  });

  await act(async () => {
    (linkButton as CardButton | undefined)!.onClick!();
  });

  await waitFor(() => {
    expect(capturedModals.length).toBeGreaterThan(0);
  });
}

// Links the monitors picked in the dialog.
async function link(monitorIds: Array<string>): Promise<void> {
  const dialog: CapturedFormModal = capturedModals[capturedModals.length - 1]!;

  expect(dialog.title).toBe("Link Existing Monitors");

  await act(async () => {
    await dialog.onSubmit({ monitorIds: monitorIds });
  });
}

// Links the three monitors: one is linked, two are not.
async function linkThree(): Promise<void> {
  await link([CHECKOUT_ID, SEARCH_ID, BILLING_ID]);
}

async function dialogError(): Promise<string> {
  return (await screen.findByTestId("modal-error")).textContent || "";
}

function lastTable(): CapturedMonitorTable {
  return capturedTables[capturedTables.length - 1]!;
}

// How many times the monitors that can be linked have been read.
function eligibleReads(): number {
  return (ModelAPI.getList as unknown as { mock: { calls: Array<unknown> } })
    .mock.calls.length;
}

describe("Link Existing Monitors, when some monitors could not be linked", () => {
  test("German says it in German, and says why the server did not answer in German, the reasons set off with '; '", async () => {
    await openLinkDialog("de");
    await linkThree();

    expect(await dialogError()).toBe(
      `2 von 3 Monitoren konnten nicht verknüpft werden: ${SERVER_SAYS}; ${GERMAN[SERVER_DOWN_WHY]} ${GERMAN[SERVER_DOWN_NEXT]}`,
    );
    expect(GERMAN[SERVER_DOWN_WHY]).toBe(
      "Der OneUptime-Server hat nicht geantwortet.",
    );
  });

  test("Persian says it in Persian, with Persian digits, the reasons set off with the Arabic semicolon", async () => {
    await openLinkDialog("fa");
    await linkThree();

    const line: string = await dialogError();

    expect(line).toBe(
      `۲ از ۳ مانیتور پیوند داده نشد: ${SERVER_SAYS}؛ ${PERSIAN[SERVER_DOWN_WHY]} ${PERSIAN[SERVER_DOWN_NEXT]}`,
    );
    expect(line).not.toContain(";");
    expect(line).not.toContain(SERVER_DOWN_WHY);
  });

  test("German that has not worded the sentence yet says it all in English, the reasons too", async () => {
    await openLinkDialog("de without the sentence");
    await linkThree();

    expect(await dialogError()).toBe(
      `2 of 3 monitors could not be linked: ${SERVER_SAYS}; ${SERVER_DOWN_WHY} ${SERVER_DOWN_NEXT}`,
    );
  });

  test("one of two monitors that could not be linked is told as 1 of 2, with its reason", async () => {
    await openLinkDialog("de");
    await link([CHECKOUT_ID, SEARCH_ID]);

    expect(await dialogError()).toBe(
      `1 von 2 Monitoren konnte nicht verknüpft werden: ${SERVER_SAYS}`,
    );
  });
});

describe("Link Existing Monitors, when some monitors were linked and some were not (#7678)", () => {
  test("2 of 3 linked: the count, the table and the monitors that can be linked are read again, and the line says 1 of 3", async () => {
    await openLinkDialog("de");

    await waitFor(() => {
      expect(lastTable().title).toBe("Verknüpfte Monitore (0)");
    });

    const refreshBefore: string | undefined = lastTable().refreshToggle;
    const readsBefore: number = eligibleReads();

    // Two of the three are linked by the time the page asks again.
    linkedMonitors = 2;
    await link([CHECKOUT_ID, GONE_ID, INVENTORY_ID]);

    expect(await dialogError()).toBe(
      `1 von 3 Monitoren konnte nicht verknüpft werden: ${GERMAN[MONITOR_NOT_FOUND_REFUSAL]}`,
    );

    await waitFor(() => {
      expect(lastTable().title).toBe(
        (GERMAN[LINKED_MONITORS_TITLE] as string).replace("{{count}}", "2"),
      );
    });
    expect(lastTable().title).toBe("Verknüpfte Monitore (2)");
    expect(lastTable().refreshToggle).not.toBe(refreshBefore);

    // The dialog stays open, and the two that were linked leave its list.
    await waitFor(() => {
      expect(eligibleReads()).toBe(readsBefore + 1);
    });
    expect(await dialogError()).toContain("1 von 3");
  });

  test("one monitor picked, and not linked: its reason alone, in German", async () => {
    await openLinkDialog("de");
    await link([GONE_ID]);

    expect(await dialogError()).toBe(GERMAN[MONITOR_NOT_FOUND_REFUSAL]);
    expect(GERMAN[MONITOR_NOT_FOUND_REFUSAL]).toBe(
      "Dieser Monitor existiert in diesem Projekt nicht, oder Sie haben keinen Zugriff darauf.",
    );
  });

  test("one monitor picked, and the server did not answer: why, in German, and no count", async () => {
    await openLinkDialog("de");
    await link([BILLING_ID]);

    const line: string = await dialogError();

    expect(line).toContain(GERMAN[SERVER_DOWN_WHY] as string);
    expect(line).not.toContain("von 1");
  });

  test("everything linked: the dialog closes, and the count is read again", async () => {
    await openLinkDialog("de");

    linkedMonitors = 2;
    await link([CHECKOUT_ID, INVENTORY_ID]);

    await waitFor(() => {
      expect(lastTable().title).toBe("Verknüpfte Monitore (2)");
    });
    expect(screen.queryByTestId("modal-error")).toBeNull();
  });
});

describe("the server's reasons, in the reader's language (#7678)", () => {
  test("German: a monitor that is gone and one of another type, each reason German, said as sentences", async () => {
    await openLinkDialog("de");
    await link([CHECKOUT_ID, GONE_ID, INBOX_ID]);

    expect(await dialogError()).toBe(
      `2 von 3 Monitoren konnten nicht verknüpft werden: ${GERMAN[MONITOR_NOT_FOUND_REFUSAL]} ${GERMAN_TYPE_MISMATCH}`,
    );
    expect(GERMAN_TYPE_MISMATCH).toBe(
      "Dieser Monitor hat den Typ Eingehende Anfrage, diese Vorlage den Typ API. Nur Monitore vom Typ der Vorlage können mit ihr verknüpft werden.",
    );
  });

  test("German: one monitor of another type, the type mismatch alone, with the German name of its type", async () => {
    await openLinkDialog("de");
    await link([INBOX_ID]);

    const line: string = await dialogError();

    expect(line).toBe(GERMAN_TYPE_MISMATCH);
    expect(line).not.toContain(MonitorType.IncomingRequest);
  });
});

describe("the sentence for monitors that could not be linked", () => {
  test("says each reason once", () => {
    expect(
      getLinkFailuresText({
        errors: [SERVER_SAYS, SERVER_SAYS, SERVER_SAYS],
        total: 4,
        translator: dashboardTranslator("en"),
      }),
    ).toBe(`3 of 4 monitors could not be linked: ${SERVER_SAYS}`);
  });

  test("French sets its colon and its semicolon apart with a space", () => {
    const french: Record<string, string> = readDashboardLocale("fr");

    expect(
      getLinkFailuresText({
        errors: [SERVER_SAYS, SERVER_DOWN_MESSAGE],
        total: 3,
        translator: dashboardTranslator("fr"),
      }),
    ).toBe(
      `2 moniteurs sur 3 n'ont pas pu être liés : ${SERVER_SAYS} ; ${french[SERVER_DOWN_WHY]} ${french[SERVER_DOWN_NEXT]}`,
    );
  });

  test("a reason that is a whole sentence is followed by the next as a sentence is, never by '.;'", () => {
    const line: string = getLinkFailuresText({
      errors: [SERVER_DOWN_MESSAGE, MONITOR_NOT_FOUND_REFUSAL, SERVER_SAYS],
      total: 4,
      translator: dashboardTranslator("en"),
    });

    expect(line).toBe(
      `3 of 4 monitors could not be linked: ${SERVER_DOWN_WHY} ${SERVER_DOWN_NEXT} ${MONITOR_NOT_FOUND_REFUSAL} ${SERVER_SAYS}`,
    );
    expect(line).not.toContain(".;");
  });

  test("Japanese runs its sentences together after its full stop", () => {
    const japanese: Record<string, string> = readDashboardLocale("ja");

    expect(
      getLinkFailuresText({
        errors: [MONITOR_NOT_FOUND_REFUSAL, SERVER_DOWN_MESSAGE],
        total: 2,
        translator: dashboardTranslator("ja"),
      }),
    ).toContain(
      `${japanese[MONITOR_NOT_FOUND_REFUSAL]}${japanese[SERVER_DOWN_WHY]}`,
    );
    expect(japanese[MONITOR_NOT_FOUND_REFUSAL]).toMatch(/。$/);
  });

  test("is worded in every language the Dashboard speaks, both forms", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(english[KEY]).toBe(LINK_FAILURES_TEMPLATE.other);
    expect(english[`${KEY}_one`]).toBe(LINK_FAILURES_TEMPLATE.one);

    for (const language of [
      "ar",
      "da",
      "de",
      "es",
      "fa",
      "fr",
      "hi",
      "it",
      "ja",
      "ko",
      "nl",
      "no",
      "pt",
      "ru",
      "sv",
      "zh-CN",
      "zh-TW",
    ]) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        general: words[KEY] !== KEY,
        one: words[`${KEY}_one`] !== KEY,
      }).toEqual({ language, general: true, one: true });
    }
  });
});
