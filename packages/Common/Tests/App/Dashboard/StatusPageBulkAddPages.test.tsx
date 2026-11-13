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
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADD IN BULK ON A STATUS PAGE, THROUGH THE SHARED BULK RUNNER
 * (fu-bulk-actions).
 *
 * The five subscriber lists (email, SMS, Slack, Microsoft Teams, webhook)
 * and Private Users each added their pasted list, or CSV file, one entry at
 * a time in a loop of their own, behind a dialog of their own that said
 * "Please wait ... This may take a moment." and could not be stopped: a few
 * thousand subscribers moved from another tool were as many round trips,
 * one after another. They now run through runBulkAction and the shared
 * progress dialog (useStatusPageBulkAdd): several at once, Stop, the time
 * left, and a result that names every entry not added, with the server's
 * reason, and every line skipped, with why.
 *
 * The real pages are rendered; their table, their bulk form and their CSV
 * upload are recorded so a test can press Add in Bulk and hand the form
 * what a person types. Every add is a real create through ModelAPI, which
 * is watched.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const recordedTables: Array<Record<string, unknown>> = [];
const recordedBulkForms: Array<Record<string, unknown>> = [];
const recordedCsvUploads: Array<Record<string, unknown>> = [];

(
  globalThis as unknown as {
    __bulkAddPagesRecorded: Record<string, Array<Record<string, unknown>>>;
  }
).__bulkAddPagesRecorded = {
  tables: recordedTables,
  bulkForms: recordedBulkForms,
  csvUploads: recordedCsvUploads,
};

type Recorder = (
  list: string,
  testId: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (list: string, testId: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    (
      globalThis as unknown as {
        __bulkAddPagesRecorded: Record<string, Array<Record<string, unknown>>>;
      }
    ).__bulkAddPagesRecorded[list]!.push(props);

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", { "data-testid": testId });
  };
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return { __esModule: true, default: mockRecorder("tables", "model-table") };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: mockRecorder("bulkForms", "bulk-form-modal"),
  };
});

jest.mock("../../../UI/Components/CSVFileUpload/CSVFileUpload", () => {
  return {
    __esModule: true,
    default: mockRecorder("csvUploads", "csv-file-upload"),
  };
});

const mockNothing: () => {
  __esModule: boolean;
  default: () => null;
} = () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelOffPanel",
  () => {
    return mockNothing();
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationWarnings",
  () => {
    return mockNothing();
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/TeamAddedSubscribersUnsubscribedNotice",
  () => {
    return mockNothing();
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageMagicLinkCard",
  () => {
    return mockNothing();
  },
);

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

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
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
    },
  };
});

import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { BULK_ACTION_CONCURRENCY } from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { BULK_NOT_STARTED_COUNT } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { SubscriberAddChoice } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices";
import EmailSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmailSubscribers";
import MicrosoftTeamsSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/MicrosoftTeamsSubscribers";
import PrivateUser from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/PrivateUser";
import SMSSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SMSSubscribers";
import SlackSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SlackSubscribers";
import WebhookSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/WebhookSubscribers";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

function pageProps(): PageComponentProps {
  const project: Project = new Project();
  project._id = PROJECT_ID;

  return {
    pageRoute: new Route("/dashboard"),
    currentProject: project,
    hasPaymentMethod: false,
  };
}

/*
 * What a page's Add in Bulk is handed, and what each add must write: one
 * row per page, so every page is held to the same flow.
 */
interface PageCase {
  name: string;
  page: React.FunctionComponent<PageComponentProps>;
  // How the person fills the form: pasted text, or a CSV file's rows.
  input: "text" | "csv";
  modelType: { new (): BaseModel };
  // An entry each, the way a person writes it.
  entries: (count: number) => Array<string>;
  // A line the page skips, and why - for the pasted lists.
  invalidLine?: { line: string; reason: string } | undefined;
  // What the field says when nothing pasted can be added.
  noValidEntry?: string | undefined;
  // Hands the form what was typed, and submits it.
  submit: (values: Array<string>) => Promise<void>;
  // What the create wrote for an entry, as the page names it.
  readValue: (model: BaseModel) => string;
  // How the result names the entry at index of these values.
  namedAs: (values: Array<string>, index: number) => string;
  singular: string;
  plural: string;
}

function lastTable(): Record<string, unknown> {
  const table: Record<string, unknown> | undefined =
    recordedTables[recordedTables.length - 1];

  if (!table) {
    throw new Error("The page drew no table.");
  }

  return table;
}

async function pressAddInBulk(): Promise<void> {
  const buttons: Array<Record<string, unknown>> = ((
    lastTable()["cardProps"] as Record<string, unknown>
  )["buttons"] || []) as Array<Record<string, unknown>>;

  const addInBulk: Record<string, unknown> | undefined = buttons.find(
    (button: Record<string, unknown>): boolean => {
      return button["title"] === "Add in Bulk";
    },
  );

  if (!addInBulk) {
    throw new Error("The table has no Add in Bulk.");
  }

  await act(async () => {
    (addInBulk["onClick"] as () => void)();
  });
}

function lastBulkForm(): Record<string, unknown> {
  const form: Record<string, unknown> | undefined =
    recordedBulkForms[recordedBulkForms.length - 1];

  if (!form) {
    throw new Error("No bulk form is open.");
  }

  return form;
}

// The bulk form's submit, started and left running.
let submitted: Promise<void> | null = null;

function submitText(data: Record<string, unknown>): Promise<void> {
  const onSubmit: (data: unknown) => Promise<void> = lastBulkForm()[
    "onSubmit"
  ] as (data: unknown) => Promise<void>;

  submitted = onSubmit(data).catch((error: unknown) => {
    // What the form would show the person, kept for the test to read.
    submitError = error instanceof Error ? error.message : String(error);
  });

  return Promise.resolve();
}

let submitError: string | null = null;

async function submitCsv(rows: Array<Record<string, string>>): Promise<void> {
  const upload: Record<string, unknown> | undefined =
    recordedCsvUploads[recordedCsvUploads.length - 1];

  if (!upload) {
    throw new Error("No CSV upload is open.");
  }

  await act(async () => {
    (upload["onDataChanged"] as (rows: Array<Record<string, string>>) => void)(
      rows,
    );
  });

  const button: HTMLElement = await screen.findByText("Add Subscribers");
  fireEvent.click(button);
}

function csvRows(values: Array<string>): Array<Record<string, string>> {
  return values.map((value: string, index: number) => {
    return { workspaceName: `Workspace ${index + 1}`, webhookUrl: value };
  });
}

const PAGES: Array<PageCase> = [
  {
    name: "Email Subscribers",
    page: EmailSubscribers,
    input: "text",
    modelType: StatusPageSubscriber,
    entries: (count: number): Array<string> => {
      return Array.from({ length: count }, (_v: unknown, i: number) => {
        return `person${i + 1}@example.com`;
      });
    },
    invalidLine: { line: "not-an-address", reason: "Email is not valid." },
    noValidEntry: "No valid email address found. Enter one address per line.",
    submit: async (values: Array<string>): Promise<void> => {
      await submitText({
        emails: values.join("\n"),
        subscriberAddChoice: SubscriberAddChoice.SubscribeNow,
      });
    },
    readValue: (model: BaseModel): string => {
      return (model as StatusPageSubscriber).subscriberEmail!.toString();
    },
    namedAs: (values: Array<string>, index: number): string => {
      return values[index]!;
    },
    singular: "Subscriber",
    plural: "Subscribers",
  },
  {
    name: "SMS Subscribers",
    page: SMSSubscribers,
    input: "text",
    modelType: StatusPageSubscriber,
    entries: (count: number): Array<string> => {
      return Array.from({ length: count }, (_v: unknown, i: number) => {
        return `+1415555${String(1000 + i)}`;
      });
    },
    invalidLine: { line: "call me", reason: "Phone number is not valid." },
    noValidEntry: "No valid phone number found. Enter one number per line.",
    submit: async (values: Array<string>): Promise<void> => {
      await submitText({
        phones: values.join("\n"),
        sendYouHaveSubscribedMessage: false,
      });
    },
    readValue: (model: BaseModel): string => {
      return (model as StatusPageSubscriber).subscriberPhone!.toString();
    },
    namedAs: (values: Array<string>, index: number): string => {
      return values[index]!;
    },
    singular: "Subscriber",
    plural: "Subscribers",
  },
  {
    name: "Slack Subscribers",
    page: SlackSubscribers,
    input: "csv",
    modelType: StatusPageSubscriber,
    entries: (count: number): Array<string> => {
      return Array.from({ length: count }, (_v: unknown, i: number) => {
        return `https://hooks.slack.com/services/T0/B${i + 1}/x`;
      });
    },
    submit: async (values: Array<string>): Promise<void> => {
      await submitCsv(csvRows(values));
    },
    readValue: (model: BaseModel): string => {
      return (
        model as StatusPageSubscriber
      ).slackIncomingWebhookUrl!.toString();
    },
    // By its workspace, as the list names it (csvRows: "Workspace 2").
    namedAs: (_values: Array<string>, index: number): string => {
      return `Workspace ${index + 1}`;
    },
    singular: "Subscriber",
    plural: "Subscribers",
  },
  {
    name: "Microsoft Teams Subscribers",
    page: MicrosoftTeamsSubscribers,
    input: "csv",
    modelType: StatusPageSubscriber,
    entries: (count: number): Array<string> => {
      return Array.from({ length: count }, (_v: unknown, i: number) => {
        return `https://example.webhook.office.com/webhookb2/${i + 1}`;
      });
    },
    submit: async (values: Array<string>): Promise<void> => {
      await submitCsv(csvRows(values));
    },
    readValue: (model: BaseModel): string => {
      return (
        model as StatusPageSubscriber
      ).microsoftTeamsIncomingWebhookUrl!.toString();
    },
    // By its workspace, as the list names it (csvRows: "Workspace 2").
    namedAs: (_values: Array<string>, index: number): string => {
      return `Workspace ${index + 1}`;
    },
    singular: "Subscriber",
    plural: "Subscribers",
  },
  {
    name: "Webhook Subscribers",
    page: WebhookSubscribers,
    input: "csv",
    modelType: StatusPageSubscriber,
    entries: (count: number): Array<string> => {
      return Array.from({ length: count }, (_v: unknown, i: number) => {
        return `https://ops.example.com/status-hook/${i + 1}`;
      });
    },
    submit: async (values: Array<string>): Promise<void> => {
      await submitCsv(csvRows(values));
    },
    readValue: (model: BaseModel): string => {
      return (model as StatusPageSubscriber).subscriberWebhook!.toString();
    },
    namedAs: (values: Array<string>, index: number): string => {
      return values[index]!;
    },
    singular: "Subscriber",
    plural: "Subscribers",
  },
  {
    name: "Private Users",
    page: PrivateUser,
    input: "text",
    modelType: StatusPagePrivateUser,
    entries: (count: number): Array<string> => {
      return Array.from({ length: count }, (_v: unknown, i: number) => {
        return `reader${i + 1}@example.com`;
      });
    },
    invalidLine: { line: "reader@", reason: "Email is not valid." },
    noValidEntry: "No valid email address found. Enter one address per line.",
    submit: async (values: Array<string>): Promise<void> => {
      await submitText({ emails: values.join("\n") });
    },
    readValue: (model: BaseModel): string => {
      return (model as StatusPagePrivateUser).email!.toString();
    },
    namedAs: (values: Array<string>, index: number): string => {
      return values[index]!;
    },
    singular: "Private User",
    plural: "Private Users",
  },
];

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

function gate(): Gate {
  let release: () => void = () => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    release = resolve;
  });
  return { promise, release };
}

// Each create, as the page sent it.
function created(): Array<BaseModel> {
  return createMock.mock.calls.map((call: Array<unknown>): BaseModel => {
    return (call[0] as { model: BaseModel }).model;
  });
}

async function renderPage(pageCase: PageCase): Promise<void> {
  const Page: React.FunctionComponent<PageComponentProps> = pageCase.page;

  await act(async () => {
    render(<Page {...pageProps()} />);
  });

  // Let the page's own reads land.
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

function progressDialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function waitForResult(title: string = "Completed"): Promise<void> {
  await screen.findByText(title, undefined, { timeout: 10000 });
}

beforeEach(() => {
  recordedTables.length = 0;
  recordedBulkForms.length = 0;
  recordedCsvUploads.length = 0;
  submitted = null;
  submitError = null;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    page.enableEmailSubscribers = true;
    page.enableSmsSubscribers = true;
    page.enableSlackSubscribers = true;
    page.enableMicrosoftTeamsSubscribers = true;
    page.isPublicStatusPage = false;
    return page;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 10000 };
  });

  createMock.mockReset();
  createMock.mockImplementation(async (): Promise<unknown> => {
    return { data: {} };
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

afterEach(async () => {
  await flush();
  cleanup();
  jest.restoreAllMocks();
});

describe.each(
  PAGES.map((pageCase: PageCase): [string, PageCase] => {
    return [pageCase.name, pageCase];
  }),
)("Add in Bulk on %s", (_name: string, pageCase: PageCase) => {
  test("adds every entry once, each as its own create on this page and project, and says so", async () => {
    await renderPage(pageCase);
    await pressAddInBulk();

    const values: Array<string> = pageCase.entries(3);
    await pageCase.submit(values);
    await waitForResult();

    expect(createMock).toHaveBeenCalledTimes(3);

    for (const call of createMock.mock.calls as Array<Array<any>>) {
      expect(call[0].modelType).toBe(pageCase.modelType);
      expect(call[0].model).toBeInstanceOf(pageCase.modelType);
      expect(call[0].model.statusPageId.toString()).toBe(STATUS_PAGE_ID);
      expect(call[0].model.projectId.toString()).toBe(PROJECT_ID);
    }

    // Each entry once, as it was written (the entries here are as kept).
    expect(created().map(pageCase.readValue).sort()).toEqual(
      [...values].sort(),
    );

    expect(
      within(progressDialog()).getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent(`3 ${pageCase.plural} added`);
    // Nothing left over: no failure, nothing skipped, nothing not started.
    expect(
      within(progressDialog()).queryByTestId("bulk-action-failed-count"),
    ).toBeNull();
    expect(
      within(progressDialog()).queryByTestId("bulk-action-unchanged-count"),
    ).toBeNull();
  });

  test(`adds several at once - at most ${BULK_ACTION_CONCURRENCY} - in the shared progress dialog, with Stop`, async () => {
    const gates: Array<Gate> = [];
    let inFlight: number = 0;
    let highWater: number = 0;

    createMock.mockImplementation(async (): Promise<unknown> => {
      const entryGate: Gate = gate();
      gates.push(entryGate);
      inFlight += 1;
      highWater = Math.max(highWater, inFlight);
      await entryGate.promise;
      inFlight -= 1;
      return { data: {} };
    });

    await renderPage(pageCase);
    await pressAddInBulk();
    await pageCase.submit(pageCase.entries(10));

    await screen.findByText("In Progress");
    await flush();

    // The shared dialog: its count in the entries' own name, and Stop.
    expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
      `0 of 10 ${pageCase.plural}`,
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Stop",
    );
    expect(highWater).toBe(BULK_ACTION_CONCURRENCY);
    expect(gates).toHaveLength(BULK_ACTION_CONCURRENCY);

    // Let them all through, as each finishes the next starts.
    while (createMock.mock.calls.length < 10 || inFlight > 0) {
      await act(async () => {
        gates.forEach((entryGate: Gate) => {
          entryGate.release();
        });
      });
      await flush();
    }

    await waitForResult();
    expect(highWater).toBe(BULK_ACTION_CONCURRENCY);
    expect(
      within(progressDialog()).getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent(`10 ${pageCase.plural} added`);
  });

  test("an add the server refuses is named with its reason, and the rest are still added", async () => {
    const values: Array<string> = pageCase.entries(3);

    createMock.mockImplementation(
      async (request: { model: BaseModel }): Promise<unknown> => {
        if (pageCase.readValue(request.model) === values[1]) {
          throw new Error("You are already subscribed to this status page.");
        }

        return { data: {} };
      },
    );

    await renderPage(pageCase);
    await pressAddInBulk();
    await pageCase.submit(values);
    await waitForResult();

    expect(createMock).toHaveBeenCalledTimes(3);
    expect(
      within(progressDialog()).getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent(`2 ${pageCase.plural} added`);
    expect(
      within(progressDialog()).getByTestId("bulk-action-failed-count"),
    ).toHaveTextContent(`1 ${pageCase.singular} not added`);

    const failed: HTMLElement = within(progressDialog()).getByTestId(
      "bulk-action-failed-items",
    );
    expect(
      within(failed).getByText(pageCase.namedAs(values, 1)),
    ).toBeInTheDocument();
    expect(
      within(failed).getByText(
        "You are already subscribed to this status page.",
      ),
    ).toBeInTheDocument();
  });

  test("Stop starts no more adds: the ones started finish, and the rest are counted as never started", async () => {
    const gates: Array<Gate> = [];

    createMock.mockImplementation(async (): Promise<unknown> => {
      const entryGate: Gate = gate();
      gates.push(entryGate);
      await entryGate.promise;
      return { data: {} };
    });

    await renderPage(pageCase);
    await pressAddInBulk();
    await pageCase.submit(pageCase.entries(10));

    await screen.findByText("In Progress");
    await flush();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await act(async () => {
      gates.forEach((entryGate: Gate) => {
        entryGate.release();
      });
    });
    await flush();

    await waitForResult("Stopped");
    expect(createMock).toHaveBeenCalledTimes(BULK_ACTION_CONCURRENCY);
    expect(
      within(progressDialog()).getByTestId("bulk-action-not-started-count"),
    ).toHaveTextContent(
      BULK_NOT_STARTED_COUNT.other
        .replace("{{count}}", String(10 - BULK_ACTION_CONCURRENCY))
        .replace("{{itemsName}}", pageCase.plural),
    );
  });

  test("the list is read again once the run has ended, and Close takes the result away", async () => {
    await renderPage(pageCase);

    const before: unknown = lastTable()["refreshToggle"];

    await pressAddInBulk();
    await pageCase.submit(pageCase.entries(2));
    await waitForResult();
    await flush();

    expect(lastTable()["refreshToggle"]).not.toEqual(before);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(screen.queryByText("Completed")).toBeNull();
  });

  if (pageCase.invalidLine) {
    const invalid: { line: string; reason: string } = pageCase.invalidLine;

    test("a line that is not valid is never sent, and is listed as skipped with why", async () => {
      const values: Array<string> = pageCase.entries(2);

      await renderPage(pageCase);
      await pressAddInBulk();
      await pageCase.submit([values[0]!, invalid.line, values[1]!]);
      await waitForResult();

      expect(createMock).toHaveBeenCalledTimes(2);
      expect(
        within(progressDialog()).getByTestId("bulk-action-succeeded-count"),
      ).toHaveTextContent(`2 ${pageCase.plural} added`);
      expect(
        within(progressDialog()).getByTestId("bulk-action-unchanged-count"),
      ).toHaveTextContent(`1 ${pageCase.singular} skipped`);

      const skipped: HTMLElement = within(progressDialog()).getByTestId(
        "bulk-action-unchanged-items",
      );
      expect(within(skipped).getByText(invalid.line)).toBeInTheDocument();
      expect(within(skipped).getByText(invalid.reason)).toBeInTheDocument();
    });

    /*
     * The form's field says it, under the field, and the form waits. It
     * used to be an error thrown from the submit, which the bulk form
     * never shows: Add did nothing, and said nothing.
     */
    test("a list with nothing valid in it is refused under the field, with how to fix it", async () => {
      await renderPage(pageCase);
      await pressAddInBulk();

      const fields: Array<Record<string, unknown>> = (
        lastBulkForm()["formProps"] as Record<string, unknown>
      )["fields"] as Array<Record<string, unknown>>;
      const pasted: Record<string, unknown> = fields[0]!;
      const fieldName: string = Object.keys(
        pasted["field"] as Record<string, unknown>,
      )[0]!;
      const check: (values: Record<string, unknown>) => string | null = pasted[
        "customValidation"
      ] as (values: Record<string, unknown>) => string | null;

      expect(typeof check).toBe("function");
      expect(check({ [fieldName]: `${invalid.line}\nalso not one` })).toBe(
        pageCase.noValidEntry,
      );
      // One good entry is enough: the rest are listed as skipped.
      expect(
        check({
          [fieldName]: `${invalid.line}\n${pageCase.entries(1)[0]!}`,
        }),
      ).toBeNull();
      // An empty field is the field's own Required to say.
      expect(check({ [fieldName]: "" })).toBeNull();
      expect(check({})).toBeNull();
    });

    test("a submit with nothing valid in it, should one get past the field, sends nothing and throws nothing", async () => {
      await renderPage(pageCase);
      await pressAddInBulk();
      await pageCase.submit([invalid.line]);
      await submitted;
      await flush();

      expect(createMock).not.toHaveBeenCalled();
      expect(submitError).toBeNull();
      expect(screen.queryByText("In Progress")).toBeNull();
      expect(screen.queryByText("Completed")).toBeNull();
    });

    test("an entry pasted twice is added once", async () => {
      const values: Array<string> = pageCase.entries(2);

      await renderPage(pageCase);
      await pressAddInBulk();
      await pageCase.submit([values[0]!, values[1]!, values[0]!]);
      await waitForResult();

      expect(createMock).toHaveBeenCalledTimes(2);
    });
  }

  if (pageCase.input === "csv") {
    test("the file's form opens empty after a run, as Close leaves it", async () => {
      await renderPage(pageCase);
      await pressAddInBulk();
      await pageCase.submit(pageCase.entries(1));
      await waitForResult();
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await pressAddInBulk();

      // Nothing uploaded yet: Add Subscribers waits for a file.
      const addButton: HTMLElement = (
        await screen.findByText("Add Subscribers")
      ).closest("button")!;
      expect(addButton).toBeDisabled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  }
});

describe("what each page writes for an entry", () => {
  test("Email Subscribers: the address, and the columns of When you add them", async () => {
    await renderPage(PAGES[0]!);
    await pressAddInBulk();
    await submitText({
      emails: "Ada@Example.com",
      subscriberAddChoice: SubscriberAddChoice.AskToConfirm,
    });
    await waitForResult();

    const subscriber: StatusPageSubscriber =
      created()[0] as StatusPageSubscriber;
    // Kept in lower case, as the server keeps an address.
    expect(subscriber.subscriberEmail!.toString()).toBe("ada@example.com");
    expect(subscriber.isSubscriptionConfirmed).toBe(false);
    expect(subscriber.sendYouHaveSubscribedMessage).toBe(false);
  });

  /*
   * ISSUE #7180: one number a line, read left to right on every page - the
   * box and its example with it - as a phone number field reads. Drawn the
   * page's way, a Persian or Arabic page put each "+" after its digits.
   */
  test("SMS Subscribers: the box of numbers reads left to right, its example with it", async () => {
    await renderPage(PAGES[1]!);
    await pressAddInBulk();

    const fields: Array<Record<string, unknown>> = (
      lastBulkForm()["formProps"] as Record<string, unknown>
    )["fields"] as Array<Record<string, unknown>>;
    const phones: Record<string, unknown> | undefined = fields.find(
      (field: Record<string, unknown>): boolean => {
        return Boolean((field["field"] as Record<string, unknown>)["phones"]);
      },
    );

    expect(phones).toBeDefined();
    expect(phones!["fieldType"]).toBe(FormFieldSchemaType.LongText);
    expect(phones!["readsLeftToRight"]).toBe(true);
    expect(phones!["placeholder"]).toBe(
      "+11234567890\n+11234567891\n+11234567892",
    );
  });

  test("SMS Subscribers: the number, and whether it is told it is subscribed", async () => {
    await renderPage(PAGES[1]!);
    await pressAddInBulk();
    await submitText({
      phones: "+1 415 555 0100",
      sendYouHaveSubscribedMessage: true,
    });
    await waitForResult();

    const subscriber: StatusPageSubscriber =
      created()[0] as StatusPageSubscriber;
    expect(subscriber.subscriberPhone!.toString()).toBe("+14155550100");
    expect(subscriber.sendYouHaveSubscribedMessage).toBe(true);
  });

  test("Slack Subscribers: the webhook, the workspace's name and the welcome switch", async () => {
    await renderPage(PAGES[2]!);
    await pressAddInBulk();
    await submitCsv([
      {
        workspaceName: "Acme",
        webhookUrl: "https://hooks.slack.com/services/T0/B1/x",
      },
    ]);
    await waitForResult();

    const subscriber: StatusPageSubscriber =
      created()[0] as StatusPageSubscriber;
    expect(subscriber.slackIncomingWebhookUrl!.toString()).toBe(
      "https://hooks.slack.com/services/T0/B1/x",
    );
    expect(subscriber.slackWorkspaceName).toBe("Acme");
    // The welcome message switch starts off, as on the form.
    expect(subscriber.sendYouHaveSubscribedMessage).toBe(false);
  });

  test("Microsoft Teams Subscribers: the webhook and the workspace's name", async () => {
    await renderPage(PAGES[3]!);
    await pressAddInBulk();
    await submitCsv([
      {
        workspaceName: "Contoso",
        webhookUrl: "https://example.webhook.office.com/webhookb2/1",
      },
    ]);
    await waitForResult();

    const subscriber: StatusPageSubscriber =
      created()[0] as StatusPageSubscriber;
    expect(subscriber.microsoftTeamsIncomingWebhookUrl!.toString()).toBe(
      "https://example.webhook.office.com/webhookb2/1",
    );
    expect(subscriber.microsoftTeamsWorkspaceName).toBe("Contoso");
  });

  /*
   * A row whose URL is not one is never sent, and is listed as skipped
   * with the product's words - not as "not added" with the parser's
   * "Hostname not a url is not in valid format.".
   */
  test("Webhook Subscribers: a URL that is not one is skipped, with why, and never sent", async () => {
    await renderPage(PAGES[4]!);
    await pressAddInBulk();
    await submitCsv([
      { webhookUrl: "https://ops.example.com/status-hook/1" },
      { webhookUrl: "not a url" },
      { webhookUrl: "" },
    ]);
    await waitForResult();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(
      within(progressDialog()).getByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("1 Subscriber added");
    expect(
      within(progressDialog()).queryByTestId("bulk-action-failed-count"),
    ).toBeNull();
    expect(
      within(progressDialog()).getByTestId("bulk-action-unchanged-count"),
    ).toHaveTextContent("2 Subscribers skipped");

    const skipped: HTMLElement = within(progressDialog()).getByTestId(
      "bulk-action-unchanged-items",
    );
    expect(within(skipped).getByText("not a url")).toBeInTheDocument();
    expect(within(skipped).getByText("URL is not valid.")).toBeInTheDocument();
    expect(skipped).not.toHaveTextContent("Hostname");
  });

  test.each([
    ["Slack Subscribers", 2],
    ["Microsoft Teams Subscribers", 3],
  ])(
    "%s: a row is named by its workspace in the result, and a row whose URL is not one is skipped by that name",
    async (_name: string, index: number) => {
      const pageCase: PageCase = PAGES[index]!;
      const values: Array<string> = pageCase.entries(2);

      createMock.mockImplementation(
        async (request: { model: BaseModel }): Promise<unknown> => {
          if (pageCase.readValue(request.model) === values[1]) {
            throw new Error("You are already subscribed to this status page.");
          }

          return { data: {} };
        },
      );

      await renderPage(pageCase);
      await pressAddInBulk();
      await submitCsv([
        { workspaceName: "Acme Ops", webhookUrl: values[0]! },
        { workspaceName: "Globex", webhookUrl: values[1]! },
        { workspaceName: "Initech", webhookUrl: "not a url" },
      ]);
      await waitForResult();

      // Only the two that are URLs were sent.
      expect(createMock).toHaveBeenCalledTimes(2);

      const failed: HTMLElement = within(progressDialog()).getByTestId(
        "bulk-action-failed-items",
      );
      expect(within(failed).getByText("Globex")).toBeInTheDocument();
      expect(failed).not.toHaveTextContent(values[1]!);

      const skipped: HTMLElement = within(progressDialog()).getByTestId(
        "bulk-action-unchanged-items",
      );
      expect(within(skipped).getByText("Initech")).toBeInTheDocument();
      expect(
        within(skipped).getByText("URL is not valid."),
      ).toBeInTheDocument();
    },
  );

  test("Private Users: the address, on this page and project", async () => {
    await renderPage(PAGES[5]!);
    await pressAddInBulk();
    await submitText({ emails: "Reader@Example.com" });
    await waitForResult();

    const user: StatusPagePrivateUser = created()[0] as StatusPagePrivateUser;
    expect(user.email!.toString()).toBe("reader@example.com");
    expect(user.statusPageId!.toString()).toBe(STATUS_PAGE_ID);
  });
});

/*
 * The six pages keep no loop and no progress dialog of their own: a seventh
 * copy would be the next one to add entries one at a time again.
 */
describe("the pages' sources", () => {
  const VIEW: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "StatusPages",
    "View",
  );

  test.each([
    "EmailSubscribers.tsx",
    "SMSSubscribers.tsx",
    "SlackSubscribers.tsx",
    "MicrosoftTeamsSubscribers.tsx",
    "WebhookSubscribers.tsx",
    "PrivateUser.tsx",
  ])(
    "%s adds through useStatusPageBulkAdd and draws its dialog",
    (file: string) => {
      const source: string = fs.readFileSync(path.join(VIEW, file), "utf8");

      expect(source).toContain("useStatusPageBulkAdd({");
      expect(source).toContain("await bulkAdd.run(");
      expect(source).toContain("{bulkAdd.dialog}");
      expect(source).not.toContain("setBulkProgress");
      expect(source).not.toContain("<ProgressBar");
      expect(source).not.toContain("This may take a moment.");
    },
  );
});
