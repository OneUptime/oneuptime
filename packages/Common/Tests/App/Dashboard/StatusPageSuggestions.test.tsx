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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, useState } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The status pages that show the affected monitors, suggested under the
 * status page picker of a scheduled maintenance event or an announcement:
 * "Status pages that show the affected monitors: [+ Acme Public] [+ EU Status]
 * Add all".
 *
 * The raw call is stubbed and its request recorded, so these pin down what
 * it asks (the route, the tenant header, the monitors and the kind of
 * event), when it asks (once per set of monitors, after the picking
 * settles, never without a monitor), what it does with a late or failed
 * answer - and above all that it only suggests: nothing is picked until a
 * page's button, or Add all, is clicked.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (
          error &&
          typeof error === "object" &&
          "message" in (error as Record<string, unknown>)
        ) {
          return String((error as Record<string, unknown>)["message"]);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

import StatusPageSuggestions, {
  RecordStatusPageSuggestions,
  getStatusPageSuggestionsFooter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSuggestions";
import {
  STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS,
  fetchStatusPagesShowingMonitors,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/useStatusPagesListingMonitors";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPageListingMonitors,
} from "../../../Types/StatusPage/StatusPagesListingMonitors";
import { FieldFooterProps } from "../../../UI/Components/Forms/Types/Field";

const MONITOR_A: string = "c0000000-0000-4000-8000-000000000001";
const MONITOR_B: string = "c0000000-0000-4000-8000-000000000002";
const PUBLIC_PAGE: string = "b0000000-0000-4000-8000-000000000001";
const EU_PAGE: string = "b0000000-0000-4000-8000-000000000002";
const STATUS_PAGE: string = "b0000000-0000-4000-8000-000000000003";
const EVENT_ID: string = "a0000000-0000-4000-8000-00000000000a";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const german: i18n = createInstance();

const LISTING: Array<StatusPageListingMonitors> = [
  { statusPageId: PUBLIC_PAGE, name: "Acme Public" },
  { statusPageId: EU_PAGE, name: "EU Status" },
];

function ok(
  statusPages: Array<StatusPageListingMonitors>,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    StatusPagesListingMonitors.toJSON({ statusPages: statusPages }),
    {},
  );
}

function requestOf(call: number = 0): {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
} {
  const request: Record<string, unknown> = postMock.mock.calls[
    call
  ]![0] as Record<string, unknown>;

  return {
    url: String(request["url"]),
    data: request["data"] as JSONObject,
    headers: request["headers"] as Record<string, string>,
  };
}

// Long enough for the picking to settle and any answer to land.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS + 100);
    });
  });
}

function line(): HTMLElement | null {
  return screen.queryByTestId("status-page-suggestions-line");
}

function suggestionNames(): Array<string> {
  return screen
    .queryAllByTestId("status-page-suggestion")
    .map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    });
}

/*
 * The picker the suggestions sit under, as a form holds it: the value is
 * whatever was last handed to onChange.
 */
interface HarnessProps {
  monitorIds: unknown;
  initialStatusPageIds?: unknown;
  eventType?: StatusPageEventType | undefined;
  onChange?: ((statusPageIds: Array<string>) => void) | undefined;
}

let changes: Array<Array<string>> = [];

function Harness(props: HarnessProps): ReactElement {
  const [statusPageIds, setStatusPageIds] = useState<unknown>(
    props.initialStatusPageIds ?? [],
  );

  return (
    <div>
      <button type="button" data-testid="before">
        before
      </button>
      <StatusPageSuggestions
        monitorIds={props.monitorIds}
        statusPageIds={statusPageIds}
        eventType={props.eventType || StatusPageEventType.ScheduledEvent}
        onChange={(ids: Array<string>) => {
          changes.push(ids);
          props.onChange?.(ids);
          setStatusPageIds(ids);
        }}
      />
      <span data-testid="picked">{JSON.stringify(statusPageIds)}</span>
    </div>
  );
}

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
        ) as Record<string, string>,
      },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  changes = [];
  postMock.mockReset();
  postMock.mockResolvedValue(ok(LISTING));
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("StatusPageSuggestions: what it asks, and when", () => {
  test("asks nothing, and draws nothing, while no monitor is affected", async () => {
    render(<Harness monitorIds={[]} />);
    await settle();

    expect(postMock).not.toHaveBeenCalled();
    expect(line()).toBeNull();

    cleanup();
    render(<Harness monitorIds={undefined} />);
    await settle();

    expect(postMock).not.toHaveBeenCalled();
  });

  test("asks the listing route with the tenant header, the monitors sorted and lower-cased, and the kind of event", async () => {
    render(
      <Harness
        monitorIds={[MONITOR_B.toUpperCase(), { _id: MONITOR_A, name: "API" }]}
        eventType={StatusPageEventType.Announcement}
      />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    const request: {
      url: string;
      data: JSONObject;
      headers: Record<string, string>;
    } = requestOf();

    expect(request.url).toContain("/status-page/listing-monitors");
    expect(request.url).toContain(StatusPagesListingMonitors.apiPath);
    expect(request.headers).toEqual({ tenantid: "project-1" });
    expect(request.data).toEqual({
      monitorIds: [MONITOR_A, MONITOR_B],
      eventType: StatusPageEventType.Announcement,
    });
  });

  test("waits for the picking to settle, and asks once per set of monitors", async () => {
    jest.useFakeTimers();

    const view: ReturnType<typeof render> = render(
      <Harness monitorIds={[MONITOR_A]} />,
    );

    act(() => {
      jest.advanceTimersByTime(STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS - 50);
    });

    // Another monitor picked before the first settled: one request, for both.
    view.rerender(<Harness monitorIds={[MONITOR_A, MONITOR_B]} />);

    act(() => {
      jest.advanceTimersByTime(STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS - 50);
    });

    expect(postMock).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(requestOf().data["monitorIds"]).toEqual([MONITOR_A, MONITOR_B]);

    // The same monitors in another order or shape: no new request.
    view.rerender(
      <Harness monitorIds={[{ _id: MONITOR_B }, MONITOR_A.toUpperCase()]} />,
    );

    act(() => {
      jest.advanceTimersByTime(STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS * 3);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("reads the monitors out of the affected resources picker's payload while the form splits it", async () => {
    render(
      <Harness
        monitorIds={{
          __affectedResourcesPayload: true,
          monitors: [MONITOR_A],
          hosts: ["d0000000-0000-4000-8000-000000000001"],
        }}
      />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    expect(requestOf().data["monitorIds"]).toEqual([MONITOR_A]);
  });
});

describe("StatusPageSuggestions: it suggests, and never picks by itself", () => {
  test("names the pages that show the monitors, under a label, and picks none of them", async () => {
    render(<Harness monitorIds={[MONITOR_A, MONITOR_B]} />);

    await waitFor(() => {
      expect(line()).not.toBeNull();
    });

    const group: HTMLElement = screen.getByRole("group", {
      name: "Status pages that show the affected monitors:",
    });

    expect(group).toBe(line());
    expect(suggestionNames()).toEqual(["Acme Public", "EU Status"]);
    expect(
      within(group).getByRole("button", { name: "Add Acme Public" }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: "Add EU Status" }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: "Add all" }),
    ).toBeInTheDocument();

    await settle();

    // Nothing was picked: not on the answer, not after it.
    expect(changes).toEqual([]);
    expect(screen.getByTestId("picked")).toHaveTextContent("[]");
  });

  test("says monitor, not monitors, when one monitor is affected", async () => {
    render(<Harness monitorIds={[MONITOR_A]} />);

    expect(
      await screen.findByRole("group", {
        name: "Status pages that show the affected monitor:",
      }),
    ).toBeInTheDocument();
  });

  test("a page already picked is not suggested, in whatever shape the picker holds it", async () => {
    render(
      <Harness
        monitorIds={[MONITOR_A]}
        initialStatusPageIds={[{ _id: PUBLIC_PAGE.toUpperCase() }]}
      />,
    );

    await waitFor(() => {
      expect(suggestionNames()).toEqual(["EU Status"]);
    });

    // One page: its own button adds it, so there is no Add all.
    expect(screen.queryByTestId("status-page-suggestions-add-all")).toBeNull();
  });

  test("with every page that shows the monitors picked, the line is not there", async () => {
    render(
      <Harness
        monitorIds={[MONITOR_A]}
        initialStatusPageIds={[EU_PAGE, PUBLIC_PAGE, STATUS_PAGE]}
      />,
    );

    await settle();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(line()).toBeNull();
  });

  test("monitors on no status page draw nothing", async () => {
    postMock.mockResolvedValue(ok([]));

    render(<Harness monitorIds={[MONITOR_A]} />);
    await settle();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(line()).toBeNull();
  });

  test("a failed request draws nothing: the suggestion is advisory", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(500, { error: "Server error" }, {}),
    );

    render(<Harness monitorIds={[MONITOR_A]} />);
    await settle();

    expect(line()).toBeNull();

    postMock.mockRejectedValue(new Error("Network down"));
    cleanup();
    render(<Harness monitorIds={[MONITOR_B]} />);
    await settle();

    expect(line()).toBeNull();
  });

  test("an answer for monitors that have since changed is dropped", async () => {
    let answerFirst: (value: HTTPResponse<JSONObject>) => void = () => {};

    postMock.mockImplementationOnce(() => {
      return new Promise(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          answerFirst = resolve;
        },
      );
    });
    postMock.mockResolvedValueOnce(
      ok([{ statusPageId: EU_PAGE, name: "EU Status" }]),
    );

    const view: ReturnType<typeof render> = render(
      <Harness monitorIds={[MONITOR_A]} />,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    view.rerender(<Harness monitorIds={[MONITOR_B]} />);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(suggestionNames()).toEqual(["EU Status"]);
    });

    // The first answer, for monitor A, arrives last: it changes nothing.
    await act(async () => {
      answerFirst(ok([{ statusPageId: PUBLIC_PAGE, name: "Acme Public" }]));
    });

    expect(suggestionNames()).toEqual(["EU Status"]);
  });
});

describe("StatusPageSuggestions: adding", () => {
  test("one click adds that page after those already picked, and its button goes", async () => {
    render(
      <Harness monitorIds={[MONITOR_A]} initialStatusPageIds={[STATUS_PAGE]} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Add EU Status" }),
    );

    expect(changes).toEqual([[STATUS_PAGE, EU_PAGE]]);
    expect(suggestionNames()).toEqual(["Acme Public"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added EU Status to the status pages.",
    );
  });

  test("Add all adds every suggested page at once, and the line goes", async () => {
    render(
      <Harness monitorIds={[MONITOR_A]} initialStatusPageIds={[STATUS_PAGE]} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add all" }));

    expect(changes).toEqual([[STATUS_PAGE, PUBLIC_PAGE, EU_PAGE]]);
    expect(line()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added 2 status pages.",
    );
  });

  test("keyboard focus moves on to the next suggestion, then to where the line was", async () => {
    postMock.mockResolvedValue(
      ok([...LISTING, { statusPageId: STATUS_PAGE, name: "Status Three" }]),
    );

    render(<Harness monitorIds={[MONITOR_A]} />);

    const first: HTMLElement = await screen.findByRole("button", {
      name: "Add Acme Public",
    });
    first.focus();
    fireEvent.click(first);

    // The button now in its place - the next page's.
    expect(screen.getByRole("button", { name: "Add EU Status" })).toHaveFocus();

    // The last one's button goes to the one before it.
    const last: HTMLElement = screen.getByRole("button", {
      name: "Add Status Three",
    });
    last.focus();
    fireEvent.click(last);

    expect(screen.getByRole("button", { name: "Add EU Status" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Add EU Status" }));

    // Nothing left: focus stays where the line was, not lost to the page.
    expect(line()).toBeNull();
    expect(screen.getByTestId("status-page-suggestions")).toHaveFocus();
    expect(changes).toEqual([
      [PUBLIC_PAGE],
      [PUBLIC_PAGE, STATUS_PAGE],
      [PUBLIC_PAGE, STATUS_PAGE, EU_PAGE],
    ]);
  });

  test("a long page name is clipped on screen and read out in full", async () => {
    const longName: string =
      "Acme Commerce Public Status for every customer in the European Union and the United Kingdom";

    postMock.mockResolvedValue(
      ok([{ statusPageId: PUBLIC_PAGE, name: longName }]),
    );

    render(<Harness monitorIds={[MONITOR_A]} />);

    const button: HTMLElement = await screen.findByRole("button", {
      name: `Add ${longName}`,
    });

    expect(button).toHaveAttribute("title", longName);
    expect(button.className).toContain("max-w-full");
    expect(button.querySelector("span")!.className).toContain("truncate");
  });
});

describe("StatusPageSuggestions: while a new answer is on its way", () => {
  test("a monitor added: the pages already named stay under the pointer until the new answer adds to them", async () => {
    let answerSecond: (value: HTTPResponse<JSONObject>) => void = () => {};

    postMock.mockResolvedValueOnce(
      ok([{ statusPageId: PUBLIC_PAGE, name: "Acme Public" }]),
    );
    postMock.mockImplementationOnce(() => {
      return new Promise(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          answerSecond = resolve;
        },
      );
    });

    const view: ReturnType<typeof render> = render(
      <Harness monitorIds={[MONITOR_A]} />,
    );

    await waitFor(() => {
      expect(suggestionNames()).toEqual(["Acme Public"]);
    });

    view.rerender(<Harness monitorIds={[MONITOR_A, MONITOR_B]} />);
    await settle();

    // Asked again, and still showing what is still true meanwhile.
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(suggestionNames()).toEqual(["Acme Public"]);

    await act(async () => {
      answerSecond(ok(LISTING));
    });

    expect(suggestionNames()).toEqual(["Acme Public", "EU Status"]);
  });

  test("a monitor taken away: the pages it named go until the new answer says which still show one", async () => {
    let answerSecond: (value: HTTPResponse<JSONObject>) => void = () => {};

    postMock.mockResolvedValueOnce(ok(LISTING));
    postMock.mockImplementationOnce(() => {
      return new Promise(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          answerSecond = resolve;
        },
      );
    });

    const view: ReturnType<typeof render> = render(
      <Harness monitorIds={[MONITOR_A, MONITOR_B]} />,
    );

    await waitFor(() => {
      expect(suggestionNames()).toEqual(["Acme Public", "EU Status"]);
    });

    view.rerender(<Harness monitorIds={[MONITOR_A]} />);

    // Nothing that may be out of date is offered.
    expect(line()).toBeNull();

    await settle();

    await act(async () => {
      answerSecond(ok([{ statusPageId: EU_PAGE, name: "EU Status" }]));
    });

    expect(suggestionNames()).toEqual(["EU Status"]);
  });
});

describe("StatusPageSuggestions: names", () => {
  test("in name order, whatever order the answer came in", async () => {
    postMock.mockResolvedValue(
      ok([
        { statusPageId: STATUS_PAGE, name: "Site 10" },
        { statusPageId: EU_PAGE, name: "site 2" },
        { statusPageId: PUBLIC_PAGE, name: "Acme Public" },
      ]),
    );

    render(<Harness monitorIds={[MONITOR_A]} />);

    await waitFor(() => {
      expect(suggestionNames()).toEqual(["Acme Public", "site 2", "Site 10"]);
    });
  });

  test("a page without a name is called an untitled status page, last, in the reader's language", async () => {
    postMock.mockResolvedValue(
      ok([
        { statusPageId: STATUS_PAGE, name: "" },
        { statusPageId: PUBLIC_PAGE, name: "Acme Public" },
      ]),
    );

    render(<Harness monitorIds={[MONITOR_A]} />);

    await waitFor(() => {
      expect(suggestionNames()).toEqual([
        "Acme Public",
        "Untitled status page",
      ]);
    });
    expect(
      screen.getByRole("button", { name: "Add Untitled status page" }),
    ).toBeInTheDocument();

    cleanup();

    render(
      <I18nextProvider i18n={german}>
        <Harness monitorIds={[MONITOR_A]} />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(suggestionNames()).toEqual([
        "Acme Public",
        "Unbenannte Statusseite",
      ]);
    });
  });
});

describe("fetchStatusPagesShowingMonitors: more monitors than one request may name", () => {
  test("asks in several requests, and names each page once", async () => {
    const monitorIds: Array<string> = Array.from(
      { length: StatusPagesListingMonitors.maxIdsPerRequest + 3 },
      (_value: unknown, index: number): string => {
        return `c0000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      },
    );

    postMock.mockResolvedValueOnce(ok(LISTING));
    postMock.mockResolvedValueOnce(
      ok([
        { statusPageId: EU_PAGE, name: "EU Status" },
        { statusPageId: STATUS_PAGE, name: "Status Three" },
      ]),
    );

    const pages: Array<StatusPageListingMonitors> =
      await fetchStatusPagesShowingMonitors({
        monitorIds: monitorIds,
        eventType: StatusPageEventType.ScheduledEvent,
      });

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(
      (requestOf(0).data["monitorIds"] as Array<string>).length +
        (requestOf(1).data["monitorIds"] as Array<string>).length,
    ).toBe(monitorIds.length);
    expect(requestOf(1).data["eventType"]).toBe(
      StatusPageEventType.ScheduledEvent,
    );
    expect(
      pages.map((page: StatusPageListingMonitors): string => {
        return page.statusPageId;
      }),
    ).toEqual([PUBLIC_PAGE, EU_PAGE, STATUS_PAGE]);
  });
});

describe("StatusPageSuggestions in German", () => {
  test("the label, the buttons and what is read out are translated", async () => {
    render(
      <I18nextProvider i18n={german}>
        <Harness monitorIds={[MONITOR_A, MONITOR_B]} />
      </I18nextProvider>,
    );

    expect(
      await screen.findByRole("group", {
        name: "Statusseiten, die die betroffenen Monitore zeigen:",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alle hinzufügen" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "EU Status hinzufügen" }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "EU Status zu den Statusseiten hinzugefügt.",
    );
  });
});

describe("RecordStatusPageSuggestions: an Edit form that does not hold the monitors", () => {
  test("reads the monitors from the record, and suggests from them", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = EVENT_ID;
    (event as unknown as { monitors: Array<{ _id: string }> }).monitors = [
      { _id: MONITOR_B },
      { _id: MONITOR_A },
    ];
    getItemMock.mockResolvedValue(event);

    const onChange: MockFunction = getJestMockFunction();

    render(
      <RecordStatusPageSuggestions
        modelType={ScheduledMaintenance}
        modelId={new ObjectID(EVENT_ID)}
        statusPageIds={[EU_PAGE]}
        eventType={StatusPageEventType.ScheduledEvent}
        onChange={onChange as unknown as (ids: Array<string>) => void}
      />,
    );

    await waitFor(() => {
      expect(suggestionNames()).toEqual(["Acme Public"]);
    });

    const read: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(read["modelType"]).toBe(ScheduledMaintenance);
    expect((read["id"] as ObjectID).toString()).toBe(EVENT_ID);
    expect(read["select"]).toEqual({ monitors: { _id: true } });
    expect(requestOf().data).toEqual({
      monitorIds: [MONITOR_A, MONITOR_B],
      eventType: StatusPageEventType.ScheduledEvent,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Acme Public" }));

    expect(onChange).toHaveBeenCalledWith([EU_PAGE, PUBLIC_PAGE]);
  });

  test("asks right away: a saved record's monitors do not change while the picker is open", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    (event as unknown as { monitors: Array<{ _id: string }> }).monitors = [
      { _id: MONITOR_A },
    ];
    getItemMock.mockResolvedValue(event);

    render(
      <RecordStatusPageSuggestions
        modelType={ScheduledMaintenance}
        modelId={new ObjectID(EVENT_ID)}
        statusPageIds={[]}
        eventType={StatusPageEventType.ScheduledEvent}
        onChange={() => {}}
      />,
    );

    // Well before the pause a form being filled in waits for.
    await waitFor(
      () => {
        expect(postMock).toHaveBeenCalledTimes(1);
      },
      { timeout: STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS / 2, interval: 10 },
    );
  });

  test("a record without monitors, or one that cannot be read, suggests nothing", async () => {
    getItemMock.mockResolvedValue(new ScheduledMaintenance());

    render(
      <RecordStatusPageSuggestions
        modelType={ScheduledMaintenance}
        modelId={new ObjectID(EVENT_ID)}
        statusPageIds={[]}
        eventType={StatusPageEventType.ScheduledEvent}
        onChange={() => {}}
      />,
    );
    await settle();

    expect(postMock).not.toHaveBeenCalled();
    expect(line()).toBeNull();

    cleanup();
    getItemMock.mockRejectedValue(new Error("You do not have permissions"));

    render(
      <RecordStatusPageSuggestions
        modelType={ScheduledMaintenance}
        modelId={new ObjectID(EVENT_ID)}
        statusPageIds={[]}
        eventType={StatusPageEventType.ScheduledEvent}
        onChange={() => {}}
      />,
    );
    await settle();

    expect(postMock).not.toHaveBeenCalled();
    expect(line()).toBeNull();
  });
});

describe("getStatusPageSuggestionsFooter: the status page picker's footer", () => {
  test("drawn outside a form, with no field to add to, it is nothing", () => {
    expect(
      getStatusPageSuggestionsFooter<ScheduledMaintenance>({
        eventType: StatusPageEventType.ScheduledEvent,
      })({ monitors: [MONITOR_A] }),
    ).toBeUndefined();
  });

  test("suggests from the form's monitors and adds through the field's setValue", async () => {
    const setValue: MockFunction = getJestMockFunction();
    const footer: FieldFooterProps = {
      setValue: setValue as unknown as (value: unknown) => void,
    };

    render(
      getStatusPageSuggestionsFooter<ScheduledMaintenance>({
        eventType: StatusPageEventType.ScheduledEvent,
      })(
        {
          monitors: [MONITOR_A] as never,
          statusPages: [STATUS_PAGE] as never,
        },
        undefined,
        footer,
      )!,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Add Acme Public" }),
    );

    expect(setValue).toHaveBeenCalledWith([STATUS_PAGE, PUBLIC_PAGE]);
    expect(requestOf().data).toEqual({
      monitorIds: [MONITOR_A],
      eventType: StatusPageEventType.ScheduledEvent,
    });
  });

  test("reads the monitors from the record when the form does not hold them", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    (event as unknown as { monitors: Array<{ _id: string }> }).monitors = [
      { _id: MONITOR_B },
    ];
    getItemMock.mockResolvedValue(event);

    render(
      getStatusPageSuggestionsFooter<ScheduledMaintenance>({
        eventType: StatusPageEventType.ScheduledEvent,
        monitorsOf: {
          modelType: ScheduledMaintenance,
          modelId: new ObjectID(EVENT_ID),
        },
      })(
        // The form's own monitors, if any, are not what it reads.
        { statusPages: [] as never, monitors: [MONITOR_A] as never },
        undefined,
        { setValue: () => {} },
      )!,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(requestOf().data["monitorIds"]).toEqual([MONITOR_B]);
  });
});
