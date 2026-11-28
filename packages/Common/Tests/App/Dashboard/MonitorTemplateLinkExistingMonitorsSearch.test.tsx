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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  emptyMonitorTemplateChangeProgress,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
} from "../../../Types/Monitor/MonitorTemplateChange";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { MONITOR_NOT_FOUND_REFUSAL } from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import MonitorTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView";
import { MONITOR_TEMPLATE_CHANGE_ROUTES } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeApi";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * LINK EXISTING MONITORS, AS IT IS DRAWN AND SEARCHED (#10399).
 *
 * The dialog, its form and its picker as the page draws them - only the
 * page's other cards are left out - over an API that answers like the
 * server: the template is a Ping template with WB1500KSK01 linked, and the
 * project also has WB1500KSK02 (Ping, no template), WB1500KSK03 (Ping, of
 * another template), WB1500KSK04 (an API monitor) and WB1500KSK05 (Ping,
 * archived).
 *
 * The dialog used to read the project's first 10,000 Ping monitors when it
 * opened and search them in the browser, so in a bigger project a search for
 * WB1500KSK02 said "No matches found". Its picker now asks the server with
 * every search, within the monitors the template can link
 * (getLinkableMonitorsQuery): what it sends is pinned here, and what the
 * server answers to it in
 * Tests/Server/API/MonitorTemplateLinkableMonitorsPostgres.test.ts.
 *
 * Link starts one change of the monitors picked, which the server runs
 * (#11260, #11266: MonitorTemplateChangeAPI), and the change's progress
 * opens in their place: what it got done, and which monitors it could not
 * link and why, with Retry for those. The API below runs a change at once,
 * as the server would once its worker is done.
 */

interface CardButton {
  title: string;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

interface CapturedMonitorTable {
  cardButtons?: Array<CardButton>;
}

let capturedTables: Array<CapturedMonitorTable> = [];

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
const OTHER_TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000002";

interface FakeMonitor {
  id: string;
  name: string;
  monitorType: MonitorType;
  monitorTemplateId: string | null;
  isArchived: boolean;
}

// The project's monitors, as the server holds them.
const MONITORS: Array<FakeMonitor> = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    name: "WB1500KSK01",
    monitorType: MonitorType.Ping,
    monitorTemplateId: TEMPLATE_ID,
    isArchived: false,
  },
  {
    id: "60000000-0000-4000-8000-000000000002",
    name: "WB1500KSK02",
    monitorType: MonitorType.Ping,
    monitorTemplateId: null,
    isArchived: false,
  },
  {
    id: "60000000-0000-4000-8000-000000000003",
    name: "WB1500KSK03",
    monitorType: MonitorType.Ping,
    monitorTemplateId: OTHER_TEMPLATE_ID,
    isArchived: false,
  },
  {
    id: "60000000-0000-4000-8000-000000000004",
    name: "WB1500KSK04",
    monitorType: MonitorType.API,
    monitorTemplateId: null,
    isArchived: false,
  },
  {
    id: "60000000-0000-4000-8000-000000000005",
    name: "WB1500KSK05",
    monitorType: MonitorType.Ping,
    monitorTemplateId: null,
    isArchived: true,
  },
];

const idOf: (name: string) => string = (name: string): string => {
  return MONITORS.find((monitor: FakeMonitor): boolean => {
    return monitor.name === name;
  })!.id;
};

interface ListArguments {
  modelType: { new (): BaseModel };
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, unknown>;
}

// Whether a monitor matches a query, as Postgres reads the operators here.
const matches: (
  monitor: FakeMonitor,
  query: Record<string, unknown>,
) => boolean = (
  monitor: FakeMonitor,
  query: Record<string, unknown>,
): boolean => {
  return Object.entries(query).every(
    ([key, condition]: [string, unknown]): boolean => {
      const value: unknown = (monitor as unknown as Record<string, unknown>)[
        key === "_id" ? "id" : key
      ];

      if (condition instanceof NotEqualOrNull) {
        return value === null || value !== String(condition.value);
      }

      if (condition instanceof Search) {
        return String(value)
          .toLowerCase()
          .includes(String(condition.value).toLowerCase());
      }

      if (condition instanceof Includes) {
        return condition.values
          .map((each: unknown): string => {
            return String(each);
          })
          .includes(String(value));
      }

      return value === condition;
    },
  );
};

// The server's answer to a list: monitors only, by name.
const answerList: (data: ListArguments) => ListResult<BaseModel> = (
  data: ListArguments,
): ListResult<BaseModel> => {
  if (data.modelType !== Monitor) {
    return { data: [], count: 0, skip: 0, limit: data.limit };
  }

  const found: Array<FakeMonitor> = MONITORS.filter(
    (monitor: FakeMonitor): boolean => {
      return matches(monitor, data.query);
    },
  ).sort((a: FakeMonitor, b: FakeMonitor): number => {
    return a.name.localeCompare(b.name);
  });

  return {
    data: found
      .slice(data.skip, data.skip + data.limit)
      .map((monitor: FakeMonitor): Monitor => {
        const model: Monitor = new Monitor();
        model._id = monitor.id;
        model.name = monitor.name;
        return model;
      }),
    count: found.length,
    skip: data.skip,
    limit: data.limit,
  };
};

let listReads: Array<ListArguments> = [];

interface Post {
  url: string;
  data: JSONObject;
}

let posts: Array<Post> = [];
// The monitors the server refuses to link, by id, with why.
let refusals: Record<string, string> = {};
// The changes the server holds, by id, as they stand once run.
let changes: Record<string, MonitorTemplateChangeView> = {};

const TEMPLATE_NAME: string = "WB KSK Ping Monitor Template";

// A change of these monitors, as the server holds it once its worker ran it.
const runChange: (monitorIds: Array<string>) => MonitorTemplateChangeView = (
  monitorIds: Array<string>,
): MonitorTemplateChangeView => {
  const lines: Array<MonitorTemplateChangeLine> = monitorIds
    .filter((id: string): boolean => {
      return Boolean(refusals[id]);
    })
    .map((id: string): MonitorTemplateChangeLine => {
      return {
        monitorId: id,
        monitorName: MONITORS.find((monitor: FakeMonitor): boolean => {
          return monitor.id === id;
        })?.name,
        outcome: MonitorTemplateChangeOutcome.Failed,
        reason: refusals[id]!,
      };
    });

  const view: MonitorTemplateChangeView = {
    id: `change-${Object.keys(changes).length + 1}`,
    status: MonitorTemplateChangeStatus.Completed,
    settings: {
      kind: MonitorTemplateChangeKind.Link,
      applyTemplateSettings: true,
      clearTemplateSettings: false,
      deleteTemplateWhenDone: false,
    },
    monitorTemplateId: TEMPLATE_ID,
    monitorTemplateName: TEMPLATE_NAME,
    progress: {
      ...emptyMonitorTemplateChangeProgress(monitorIds.length),
      processed: monitorIds.length,
      changed: monitorIds.length - lines.length,
      failed: lines.length,
    },
    lines: lines,
    isLinesTruncated: false,
    isStopRequested: false,
    retryableCount: lines.length,
    isTemplateDeleted: false,
  };

  changes[view.id] = view;

  return view;
};

// What the server answers a start or a retry with: the change, queued.
const answerChange: (
  view: MonitorTemplateChangeView,
) => HTTPResponse<JSONObject> = (
  view: MonitorTemplateChangeView,
): HTTPResponse<JSONObject> => {
  const queued: MonitorTemplateChangeView = {
    ...view,
    status: MonitorTemplateChangeStatus.Queued,
    progress: emptyMonitorTemplateChangeProgress(view.progress.total),
    lines: [],
    retryableCount: 0,
    createdAt: new Date().toISOString(),
  };

  return new HTTPResponse<JSONObject>(
    200,
    { change: queued as unknown as JSONObject },
    {},
  );
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[language] = instance;
  }
});

beforeEach(() => {
  capturedTables = [];
  listReads = [];
  posts = [];
  refusals = {};
  changes = {};

  const template: MonitorTemplate = new MonitorTemplate();
  template.monitorType = MonitorType.Ping;
  template.monitorSteps = new MonitorSteps();
  template.templateName = TEMPLATE_NAME;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(TEMPLATE_ID));
  jest.spyOn(ModelAPI, "count").mockResolvedValue(264 as never);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(template as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    data: ListArguments,
  ): Promise<ListResult<BaseModel>> => {
    listReads.push(data);
    return answerList(data);
  }) as never);

  // A change of the template's monitors, read as the server answers it.
  jest.spyOn(API, "get").mockImplementation((async (args: {
    url: { toString: () => string };
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const route: string = args.url.toString().split("?")[0]!;

    // No change of the template's monitors runs when the page opens.
    if (
      route.endsWith(
        MONITOR_TEMPLATE_CHANGE_ROUTES.activeOfTemplate(TEMPLATE_ID),
      )
    ) {
      return new HTTPResponse<JSONObject>(200, { changes: [] }, {});
    }

    const changeId: string | undefined = Object.keys(changes).find(
      (id: string): boolean => {
        return route.endsWith(MONITOR_TEMPLATE_CHANGE_ROUTES.change(id));
      },
    );

    if (changeId) {
      return new HTTPResponse<JSONObject>(
        200,
        { change: changes[changeId] as unknown as JSONObject },
        {},
      );
    }

    return new HTTPErrorResponse(404, { message: "Not found." }, {});
  }) as never);

  // Link starts a change, and Retry one of what the last could not link.
  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
    data?: JSONObject | undefined;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const url: string = args.url.toString();
    const data: JSONObject = args.data || {};
    posts.push({ url, data });

    if (url.endsWith(MONITOR_TEMPLATE_CHANGE_ROUTES.start)) {
      return answerChange(runChange(data["monitorIds"] as Array<string>));
    }

    const retried: string | undefined = Object.keys(changes).find(
      (id: string): boolean => {
        return url.endsWith(MONITOR_TEMPLATE_CHANGE_ROUTES.retry(id));
      },
    );

    if (retried) {
      return answerChange(
        runChange(
          changes[retried]!.lines.map(
            (line: MonitorTemplateChangeLine): string => {
              return line.monitorId;
            },
          ),
        ),
      );
    }

    return new HTTPErrorResponse(404, { message: "Not found." }, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * The template's page, with its Link Existing Monitors dialog open: in a
 * router, as the Dashboard draws it, since a change's progress links each
 * monitor it names to its page.
 */
async function openLinkDialog(language: string = "en"): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <I18nextProvider i18n={instances[language]!}>
          <MonitorTemplatesView
            pageRoute={
              new Route(`/dashboard/monitors/settings/templates/${TEMPLATE_ID}`)
            }
            currentProject={null}
            hasPaymentMethod={true}
          />
        </I18nextProvider>
      </MemoryRouter>,
    );
  });

  let linkButton: CardButton | undefined = undefined;

  await waitFor(() => {
    linkButton = capturedTables[capturedTables.length - 1]?.cardButtons?.find(
      (button: CardButton): boolean => {
        return button.title === "Link Existing Monitors" && !button.disabled;
      },
    );

    expect(linkButton).toBeTruthy();
  });

  await act(async () => {
    (linkButton as CardButton | undefined)!.onClick!();
  });

  await screen.findByRole("dialog");
}

function picker(): HTMLElement {
  return within(screen.getByRole("dialog")).getByRole("combobox");
}

async function openPicker(): Promise<void> {
  await act(async () => {
    fireEvent.click(picker());
  });
}

async function typeInPicker(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(picker(), { target: { value: text } });
  });
}

// The monitor lists the picker asked the server for.
function monitorReads(): Array<ListArguments> {
  return listReads.filter((read: ListArguments): boolean => {
    return read.modelType === Monitor;
  });
}

// The picker's searches: reads within the template's query.
function searches(): Array<ListArguments> {
  return monitorReads().filter((read: ListArguments): boolean => {
    return read.query["monitorTemplateId"] instanceof NotEqualOrNull;
  });
}

async function pick(name: string): Promise<void> {
  const option: HTMLElement = await screen.findByRole(
    "option",
    { name: new RegExp(name) },
    { timeout: 5000 },
  );

  await act(async () => {
    fireEvent.click(option);
  });
}

async function pressLink(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
}

describe("Link Existing Monitors, opened", () => {
  test("never reads the project's first 10,000: only its picker's own page, within what it can link", async () => {
    await openLinkDialog();

    expect(
      within(screen.getByRole("dialog")).getByText(
        "Pick Ping monitors to link to this template. Monitors linked to another template move to this one.",
      ),
    ).toBeInTheDocument();

    // The picker has the focus, and reads its first page of 50.
    await waitFor(() => {
      expect(monitorReads().length).toBeGreaterThan(0);
    });

    for (const read of monitorReads()) {
      expect(read.limit).toBe(50);
      expect(read.query["monitorTemplateId"]).toBeInstanceOf(NotEqualOrNull);
    }
  });

  test("its picker, opened, asks the server for the first 50 monitors it can link, by name", async () => {
    await openLinkDialog();
    await openPicker();

    await waitFor(() => {
      expect(searches()).toHaveLength(1);
    });

    const read: ListArguments = searches()[0]!;

    expect(read.limit).toBe(50);
    expect(read.skip).toBe(0);
    expect(read.sort).toEqual({ name: SortOrder.Ascending });
    expect(Object.keys(read.query).sort()).toEqual([
      "isArchived",
      "monitorTemplateId",
      "monitorType",
    ]);
    expect(read.query["monitorType"]).toBe(MonitorType.Ping);
    expect(read.query["isArchived"]).toBe(false);
    expect(
      (read.query["monitorTemplateId"] as NotEqualOrNull<string>).value,
    ).toBe(TEMPLATE_ID);

    // What the server answered: the two this template can link.
    expect(
      await screen.findByRole("option", { name: /WB1500KSK02/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /WB1500KSK03/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /WB1500KSK01/ })).toBeNull();
  });
});

describe("Link Existing Monitors, searched (#10399)", () => {
  test("a search for part of a name is the server's: WB1500KSK0 finds WB1500KSK02", async () => {
    await openLinkDialog();
    await openPicker();
    await typeInPicker("WB1500KSK0");

    await waitFor(
      () => {
        expect(
          searches().some((read: ListArguments): boolean => {
            return (
              read.query["name"] instanceof Search &&
              String((read.query["name"] as Search<string>).value) ===
                "WB1500KSK0"
            );
          }),
        ).toBe(true);
      },
      { timeout: 5000 },
    );

    const read: ListArguments = searches()[searches().length - 1]!;

    // The search is added to the template's query, never in its place.
    expect(read.query["monitorType"]).toBe(MonitorType.Ping);
    expect(read.query["isArchived"]).toBe(false);
    expect(read.query["monitorTemplateId"]).toBeInstanceOf(NotEqualOrNull);
    expect(read.limit).toBe(50);

    expect(
      await screen.findByRole("option", { name: /WB1500KSK02/ }),
    ).toBeInTheDocument();

    const listed: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      });

    expect(listed).toEqual(["WB1500KSK02", "WB1500KSK03"]);
    expect(screen.queryByText("No matches found")).toBeNull();
  });

  test("never reads a capped list of monitors, however it is searched", async () => {
    await openLinkDialog();
    await openPicker();
    await typeInPicker("KSK");

    await waitFor(
      () => {
        expect(searches().length).toBeGreaterThan(1);
      },
      { timeout: 5000 },
    );

    for (const read of monitorReads()) {
      expect(read.limit).not.toBe(LIMIT_PER_PROJECT);
    }
  });

  test("a search that matches nothing it can link says so", async () => {
    await openLinkDialog();
    await openPicker();
    await typeInPicker("WB1500KSK01");

    expect(
      await screen.findByText("No matching entries.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe("Link Existing Monitors, picked and linked", () => {
  // The change's headline in its progress dialog.
  async function changeTitle(text: string): Promise<void> {
    await waitFor(
      () => {
        expect(
          screen.getByTestId("monitor-template-change-title"),
        ).toHaveTextContent(text);
      },
      { timeout: 5000 },
    );
  }

  test("links the monitor found by its name as one change, and says so", async () => {
    await openLinkDialog();
    await openPicker();
    await typeInPicker("KSK02");
    await pick("WB1500KSK02");
    await pressLink();

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]!.url).toContain(MONITOR_TEMPLATE_CHANGE_ROUTES.start);
    expect(posts[0]!.data).toEqual({
      monitorTemplateId: TEMPLATE_ID,
      settings: {
        kind: MonitorTemplateChangeKind.Link,
        applyTemplateSettings: true,
        clearTemplateSettings: false,
        deleteTemplateWhenDone: false,
      },
      monitorIds: [idOf("WB1500KSK02")],
    });

    await changeTitle(`1 monitor is linked to ${TEMPLATE_NAME}`);
    expect(screen.queryByTestId("monitor-template-change-issue")).toBeNull();
  });

  test("some linked and some not: the change names the one not linked and why, and Retry tries only that one", async () => {
    refusals[idOf("WB1500KSK03")] = MONITOR_NOT_FOUND_REFUSAL;

    await openLinkDialog();
    await openPicker();
    await pick("WB1500KSK02");
    await openPicker();
    await pick("WB1500KSK03");
    await pressLink();

    // One change for both, never a request per monitor.
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]!.data["monitorIds"]).toEqual([
      idOf("WB1500KSK02"),
      idOf("WB1500KSK03"),
    ]);

    await changeTitle(`1 of 2 monitors are linked to ${TEMPLATE_NAME}`);

    // WB1500KSK03 could not be linked, and why; WB1500KSK02 is linked.
    const issue: HTMLElement = screen.getByTestId(
      "monitor-template-change-issue",
    );
    expect(issue).toHaveTextContent("1 monitor could not be changed");
    expect(issue).toHaveTextContent(MONITOR_NOT_FOUND_REFUSAL);
    expect(within(issue).getByText("WB1500KSK03")).toBeInTheDocument();
    expect(within(issue).queryByText("WB1500KSK02")).toBeNull();

    // Retry tries again only the one not linked.
    delete refusals[idOf("WB1500KSK03")];

    const retry: HTMLElement = screen.getByTestId("modal-footer-submit-button");
    expect(retry).toHaveTextContent("Retry 1 monitor");

    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => {
      expect(posts).toHaveLength(2);
    });
    expect(posts[1]!.url).toContain(
      MONITOR_TEMPLATE_CHANGE_ROUTES.retry("change-1"),
    );
    expect(changes["change-2"]!.progress.total).toBe(1);

    await changeTitle(`1 monitor is linked to ${TEMPLATE_NAME}`);
  });
});

describe("Link Existing Monitors, with nothing to link", () => {
  test("says there are no monitors to link yet", async () => {
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      data: ListArguments,
    ): Promise<ListResult<BaseModel>> => {
      listReads.push(data);
      return { data: [], count: 0, skip: 0, limit: data.limit };
    }) as never);

    await openLinkDialog();
    await openPicker();

    expect(
      await screen.findByText(
        "No monitors to link yet.",
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  test("says so in German too", async () => {
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      data: ListArguments,
    ): Promise<ListResult<BaseModel>> => {
      listReads.push(data);
      return { data: [], count: 0, skip: 0, limit: data.limit };
    }) as never);

    await openLinkDialog("de");
    await openPicker();

    expect(
      await screen.findByText(
        "Noch keine Monitore zum Verknüpfen.",
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  test("is worded in every language the Dashboard speaks", () => {
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
        isWorded:
          Boolean(words["No monitors to link yet."]) &&
          words["No monitors to link yet."] !== "No monitors to link yet.",
      }).toEqual({ language, isWorded: true });
    }
  });
});
