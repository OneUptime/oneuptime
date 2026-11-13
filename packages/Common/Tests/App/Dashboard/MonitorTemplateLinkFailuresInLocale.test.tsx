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
import MonitorTemplatesView, {
  getLinkFailuresText,
  LINK_FAILURES_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * LINK EXISTING MONITORS, WHEN SOME COULD NOT BE LINKED (#7629).
 *
 * The dialog said "2 of 3 link operations failed: Monitor not found; Error
 * connecting to server. Please try again in few minutes." in every
 * language: the sentence was built in code, and the reasons were joined
 * with a Latin "; ". It is a translated plural sentence now. Each reason is
 * said as ErrorMessageText says an error - a server that did not answer says
 * why and what to do, in the reader's language - and the reasons are
 * clauses of one line, in the language the sentence comes out in, with its
 * semicolon: "; " in German, "؛ " in Persian, " ; " in French.
 */

interface CardButton {
  title: string;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

interface CapturedMonitorTable {
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
// Gone before it could be linked: the server says so in its own words.
const SEARCH_ID: string = "60000000-0000-4000-8000-000000000002";
// The gateway answered for a server that did not.
const BILLING_ID: string = "60000000-0000-4000-8000-000000000003";

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

const instances: Record<string, i18n> = {};

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

  const template: MonitorTemplate = new MonitorTemplate();
  template.monitorType = MonitorType.API;
  template.monitorSteps = new MonitorSteps();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(TEMPLATE_ID));
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
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

// Links the three monitors: one is linked, two are not.
async function linkThree(): Promise<void> {
  const dialog: CapturedFormModal = capturedModals[capturedModals.length - 1]!;

  expect(dialog.title).toBe("Link Existing Monitors");

  await act(async () => {
    await dialog.onSubmit({
      monitorIds: [CHECKOUT_ID, SEARCH_ID, BILLING_ID],
    });
  });
}

async function dialogError(): Promise<string> {
  return (await screen.findByTestId("modal-error")).textContent || "";
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

  test("one monitor that could not be linked is told by its reason alone, as before", async () => {
    await openLinkDialog("de");

    const dialog: CapturedFormModal =
      capturedModals[capturedModals.length - 1]!;

    await act(async () => {
      await dialog.onSubmit({ monitorIds: [CHECKOUT_ID, SEARCH_ID] });
    });

    expect(await dialogError()).toBe(SERVER_SAYS);
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
