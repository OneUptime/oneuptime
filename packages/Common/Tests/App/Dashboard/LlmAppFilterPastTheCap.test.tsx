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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import { PROJECT_ID, goTo, listItem, summary } from "./LlmConversationFixtures";
import LlmConversationsView from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationsView";
import Service from "../../../Models/DatabaseModels/Service";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { LlmConversationListItem } from "../../../Types/Telemetry/LlmConversationApi";
import { LLM_SETUP_CHECK_ROUTE } from "../../../Types/Telemetry/LlmSetupCheckApi";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * THE AI CONVERSATIONS' APP FILTER AND THE APPS ITS ROWS NAME, PAST THE
 * PROJECT'S FIRST 10,000 APPS (#10764).
 *
 * The list read the project's first 10,000 apps (telemetry services) by
 * name, to offer them in its App filter and to name each conversation's
 * app. An app past them could not be picked, one a link held left the
 * filter blank while the list was still narrowed by it, and a conversation
 * of one read with no app at all. The filter searches the server now; the
 * app a link holds is named by its id, one deleted since reading "No longer
 * available"; and the rows' apps are read by their ids. ModelAPI answers
 * from a project faked whole (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PAGE: string = `/dashboard/${PROJECT_ID}/llm/conversations`;
const LATE_APP_ID: string = "c1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_APP_ID: string = "c1000000-0000-4000-8000-0000000000ab";
const ARCHIVED_APP_ID: string = "c1000000-0000-4000-8000-0000000000ac";
const DELETED_APP_ID: string = "c1000000-0000-4000-8000-0000000000dd";

let server: CappedListServer;
let conversations: Array<LlmConversationListItem> = [];
let postBodies: Array<JSONObject> = [];

beforeEach(() => {
  server = new CappedListServer();
  postBodies = [];
  conversations = [
    listItem({
      key: "c:kiosk",
      conversationId: "kiosk",
      title: "Is the kiosk open?",
      serviceIds: [LATE_APP_ID],
    }),
  ];

  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: LATE_APP_ID, name: "WB kiosk assistant" },
    { _id: OTHER_LATE_APP_ID, name: "WB kiosk concierge" },
    { _id: ARCHIVED_APP_ID, name: "WB kiosk legacy bot", isArchived: true },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {
    return undefined;
  });
  getJestSpyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    if (args.url.toString().includes(LLM_SETUP_CHECK_ROUTE)) {
      return new HTTPResponse<JSONObject>(200, {}, {});
    }

    postBodies.push(args.data);

    return new HTTPResponse<JSONObject>(
      200,
      {
        summary: args.data["includeSummary"]
          ? (summary() as unknown as JSONObject)
          : null,
        conversations: conversations as unknown as Array<JSONObject>,
        hasMore: false,
      } as JSONObject,
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

async function openList(query: string = ""): Promise<void> {
  goTo(`${PAGE}${query}`);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`${PAGE}${query}`]}>
        <LlmConversationsView />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(
      screen.queryByTestId("llm-conversations-loading"),
    ).not.toBeInTheDocument();
  });
}

async function appPicker(): Promise<HTMLElement> {
  return await within(
    await screen.findByTestId("llm-conversations-app"),
  ).findByRole("combobox", { name: "App" });
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

function lastServiceIds(): unknown {
  return postBodies[postBodies.length - 1]?.["serviceIds"];
}

function idsOf(value: unknown): Array<string> {
  return value instanceof Includes
    ? value.values.map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
    : [];
}

describe("the AI conversations' App filter past the 10,000th app", () => {
  test("never reads the project's apps whole: a page of a search, ids, or one row and the count", async () => {
    await openList();

    const picker: HTMLElement = await appPicker();

    await act(async () => {
      fireEvent.focus(picker);
      fireEvent.change(picker, { target: { value: "WB kiosk" } });
    });

    await screen.findByRole("option", { name: /WB kiosk concierge/ });

    for (const call of serviceReads()) {
      expect(call.limit).toBeLessThanOrEqual(50);
    }
  });

  test("finds an app past the 10,000th by a search on the server, archived ones marked, and narrows the list to the one picked", async () => {
    await openList();

    const picker: HTMLElement = await appPicker();

    await act(async () => {
      fireEvent.focus(picker);
      fireEvent.change(picker, { target: { value: "WB kiosk" } });
    });

    await waitFor(() => {
      expect(
        screen.queryAllByRole("option").map((option: HTMLElement): string => {
          return option.textContent || "";
        }),
      ).toEqual([
        "WB kiosk assistant",
        "WB kiosk concierge",
        "WB kiosk legacy botArchived",
      ]);
    });

    const searched: Array<CappedListCall> = serviceReads().filter(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect(searched[searched.length - 1]!.limit).toBe(50);
    // Archived apps keep sending calls: offered, never left out.
    expect(searched[searched.length - 1]!.query["isArchived"]).toBeUndefined();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("option", { name: /WB kiosk concierge/ }),
      );
    });

    await waitFor(() => {
      expect(lastServiceIds()).toEqual([OTHER_LATE_APP_ID]);
    });
    expect(new URLSearchParams(window.location.search).get("app")).toBe(
      OTHER_LATE_APP_ID,
    );
  });

  test("an app a link holds past the 10,000th is named by its id, narrows the list, and is cleared back to every app", async () => {
    await openList(`?app=${LATE_APP_ID}`);

    const value: HTMLElement = await screen.findByTestId(
      "entity-dropdown-value",
    );

    await waitFor(() => {
      expect(value).toHaveTextContent("WB kiosk assistant");
    });

    // Read by its id, with its archive switch: never by its name.
    const held: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return (
          idsOf(call.query["_id"]).includes(LATE_APP_ID) &&
          call.select["isArchived"] === true
        );
      },
    );

    expect(held).toBeDefined();
    expect(postBodies[0]!["serviceIds"]).toEqual([LATE_APP_ID]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("entity-dropdown-clear"));
    });

    await waitFor(() => {
      expect(lastServiceIds()).toBeUndefined();
    });
    expect(new URLSearchParams(window.location.search).get("app")).toBeNull();
  });

  test("an app a link holds that was deleted since reads No longer available, and still narrows the list until it is cleared", async () => {
    await openList(`?app=${DELETED_APP_ID}`);

    const value: HTMLElement = await screen.findByTestId(
      "entity-dropdown-value",
    );

    await waitFor(() => {
      expect(value).toHaveTextContent("No longer available");
    });
    expect(within(value).getByText("No longer available")).toHaveAttribute(
      "data-not-found",
      "true",
    );
    expect(lastServiceIds()).toEqual([DELETED_APP_ID]);
  });

  test("an archived app a link holds is named and marked Archived", async () => {
    await openList(`?app=${ARCHIVED_APP_ID}`);

    const value: HTMLElement = await screen.findByTestId(
      "entity-dropdown-value",
    );

    await waitFor(() => {
      expect(value).toHaveTextContent("WB kiosk legacy bot");
    });
    expect(
      within(value).getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();
  });

  test("a conversation of an app past the 10,000th names its app, read by its id", async () => {
    await openList();

    await waitFor(() => {
      expect(screen.getByTestId("llm-conversation-row")).toHaveTextContent(
        "WB kiosk assistant",
      );
    });

    const byId: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return call.query["_id"] instanceof Includes;
      },
    );

    expect(idsOf(byId!.query["_id"])).toEqual([LATE_APP_ID]);
  });
});
