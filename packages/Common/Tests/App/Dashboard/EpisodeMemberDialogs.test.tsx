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
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The dialogs that add incidents or alerts to an episode, rendered for real
 * against a stand-in server (ModelAPI.getList, ModelAPI.create and API.post
 * answer from the tables below, as the API would: every query key filters):
 *
 *   - an episode's Add Alerts / Add Incidents (AddEpisodeMembersModal):
 *     several picked at once from everything the person can see that is not
 *     in the episode, searched by title or number, each with its number,
 *     state and severity, and a note when it is in another episode; one
 *     request; what could not be added stays listed, with why;
 *   - the lists' Add to Existing Episode (AddToExistingEpisodeModal): open
 *     episodes first, then recently resolved ones; what adding will do to
 *     the ones in an episode already, and to a resolved episode;
 *   - the lists' Add to New Episode (AddToNewEpisodeModal): a title and a
 *     severity, started from the most severe selected one, never from a
 *     private title.
 */

import AddEpisodeMembersModal, {
  EPISODE_MEMBER_SEARCH_DEBOUNCE_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddEpisodeMembersModal";
import AddToExistingEpisodeModal from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddToExistingEpisodeModal";
import AddToNewEpisodeModal from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddToNewEpisodeModal";
import {
  ALERT_EPISODE_MEMBER_KIND,
  INCIDENT_EPISODE_MEMBER_KIND,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeMemberKinds";
import { EPISODE_MEMBER_PICKER_LIMIT } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeMembersApi";
import EpisodePickerList from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodePickerList";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Color from "../../../Types/Color";
import {
  ALERT_NOT_FOUND_REASON,
  EpisodeMembersAddResult,
  MAX_EPISODE_MEMBERS_PER_ADD,
} from "../../../Types/Episode/EpisodeMembersAdd";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const EPISODE_ID: string = "e1000000-0000-4000-8000-000000000012";
const OTHER_EPISODE_ID: string = "e1000000-0000-4000-8000-000000000003";
const HIDDEN_EPISODE_ID: string = "e1000000-0000-4000-8000-000000000099";
const RESOLVED_EPISODE_ID: string = "e1000000-0000-4000-8000-000000000001";

const RED: Color = new Color("#dc2626");
const AMBER: Color = new Color("#f59e0b");

type IdFunction = (index: number) => string;

const id: IdFunction = (index: number): string => {
  return `a1000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
};

function firing(): AlertState {
  const state: AlertState = new AlertState();
  state.name = "Firing";
  state.color = RED;
  return state;
}

function severity(name: string, color: Color): AlertSeverity {
  const value: AlertSeverity = new AlertSeverity();
  value.name = name;
  value.color = color;
  return value;
}

function makeAlert(
  index: number,
  title: string,
  extra: Record<string, unknown> = {},
): Alert {
  const alert: Alert = new Alert();
  alert._id = id(index);
  alert.title = title;
  alert.alertNumber = index;
  alert.alertNumberWithPrefix = `ALT-${index}`;
  alert.currentAlertState = firing();
  alert.alertSeverity = severity("Major", AMBER);
  alert.createdAt = new Date(Date.now() - index * 60_000);
  Object.assign(alert, extra);
  return alert;
}

function makeEpisode(
  episodeId: string,
  number: number,
  title: string,
  extra: Record<string, unknown> = {},
): AlertEpisode {
  const episode: AlertEpisode = new AlertEpisode();
  episode._id = episodeId;
  episode.title = title;
  episode.episodeNumber = number;
  episode.episodeNumberWithPrefix = `AE-${number}`;
  episode.alertCount = 4;
  episode.createdAt = new Date(Date.now() - number * 3_600_000);
  Object.assign(episode, extra);
  return episode;
}

// What the stand-in server holds: what the person can see.
interface Tables {
  alerts: Array<Alert>;
  episodes: Array<AlertEpisode>;
  memberIds: Array<string>;
  severities: Array<AlertSeverity>;
}

let tables: Tables;

// Every getList call, and each add request's body.
let lists: Array<Record<string, any>>;
let adds: Array<Record<string, unknown>>;
let addAnswer: (ids: Array<string>) => EpisodeMembersAddResult;
let failLists: boolean;

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

// Every query key filters, as the API does.
function matches(model: BaseModel, query: Record<string, any>): boolean {
  const values: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  for (const [key, condition] of Object.entries(query)) {
    if (condition instanceof IncludesNone) {
      if (condition.values.map(idOf).includes(idOf(values[key]))) {
        return false;
      }
    } else if (condition instanceof Includes) {
      if (!condition.values.map(idOf).includes(idOf(values[key]))) {
        return false;
      }
    } else if (condition instanceof IsNull) {
      if (values[key]) {
        return false;
      }
    } else if (condition instanceof NotNull) {
      if (!values[key]) {
        return false;
      }
    } else if (condition instanceof MultiSearch) {
      const text: string = String(condition.value).toLowerCase();
      const hit: boolean = condition.fields.some((field: unknown) => {
        return String(values[field as string] ?? "")
          .toLowerCase()
          .includes(text);
      });
      if (!hit) {
        return false;
      }
    } else if (idOf(values[key]) !== idOf(condition)) {
      return false;
    }
  }

  return true;
}

function answer(data: Array<BaseModel>, limit: number): unknown {
  const page: Array<BaseModel> = data.slice(0, limit);
  return { data: page, count: page.length, skip: 0, limit: limit };
}

function standInServer(): void {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    call: Record<string, any>,
  ) => {
    lists.push(call);

    if (failLists) {
      throw new Error("The server could not be reached.");
    }

    const query: Record<string, any> = call["query"] || {};
    const limit: number = call["limit"];

    if (call["modelType"] === AlertEpisodeMember) {
      return answer(
        tables.memberIds.map((alertId: string): AlertEpisodeMember => {
          const member: AlertEpisodeMember = new AlertEpisodeMember();
          member.alertId = new ObjectID(alertId);
          member.alertEpisodeId = new ObjectID(EPISODE_ID);
          return member;
        }),
        limit,
      );
    }

    if (call["modelType"] === Alert) {
      return answer(
        tables.alerts.filter((alert: Alert): boolean => {
          return matches(alert, query);
        }),
        limit,
      );
    }

    if (call["modelType"] === AlertEpisode) {
      return answer(
        tables.episodes.filter((episode: AlertEpisode): boolean => {
          return matches(episode, query);
        }),
        limit,
      );
    }

    if (call["modelType"] === AlertSeverity) {
      return answer(tables.severities, limit);
    }

    return answer([], limit);
  }) as never);

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  jest.spyOn(API, "post").mockImplementation((async (call: {
    data: Record<string, unknown>;
  }) => {
    adds.push(call.data);
    return new HTTPResponse(
      200,
      addAnswer(call.data["alertIds"] as Array<string>) as never,
      {},
    );
  }) as never);
}

beforeEach(() => {
  lists = [];
  adds = [];
  failLists = false;
  addAnswer = (ids: Array<string>): EpisodeMembersAddResult => {
    return { added: ids, alreadyInEpisode: [], notAdded: [] };
  };
  tables = {
    alerts: [
      makeAlert(1, "Checkout API is offline", {
        alertSeverity: severity("Critical", RED),
      }),
      makeAlert(2, "Checkout p95 latency above 2 s", {
        alertEpisodeId: new ObjectID(OTHER_EPISODE_ID),
      }),
      makeAlert(3, "Disk filling up on db-1", {
        alertEpisodeId: new ObjectID(HIDDEN_EPISODE_ID),
      }),
      makeAlert(4, "Cart service restarts"),
      makeAlert(5, "Payroll export failing", { isPrivate: true }),
    ],
    episodes: [
      makeEpisode(EPISODE_ID, 12, "Checkout degradation"),
      makeEpisode(OTHER_EPISODE_ID, 3, "Latency spike"),
      makeEpisode(RESOLVED_EPISODE_ID, 1, "Last week's outage", {
        resolvedAt: new Date(Date.now() - 86_400_000),
      }),
    ],
    memberIds: [id(4)],
    severities: [],
  };
  standInServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function options(testId: string): Array<HTMLElement> {
  return screen.queryAllByTestId(`${testId}-option`);
}

function optionTitled(testId: string, title: string): HTMLElement {
  const option: HTMLElement | undefined = options(testId).find(
    (candidate: HTMLElement): boolean => {
      return within(candidate).queryByText(title) !== null;
    },
  );

  if (!option) {
    throw new Error(`No option titled "${title}".`);
  }

  return option;
}

function submitButton(): HTMLElement {
  return within(screen.getByTestId("modal")).getByTestId(
    "modal-footer-submit-button",
  );
}

describe("an episode's Add Alerts", () => {
  const LIST: string = "add-episode-members-list";

  let onClose: MockFunction;
  let onAdded: MockFunction;

  function open(): void {
    onClose = getJestMockFunction();
    onAdded = getJestMockFunction();

    render(
      <MemoryRouter>
        <AddEpisodeMembersModal
          config={ALERT_EPISODE_MEMBER_KIND}
          episodeId={new ObjectID(EPISODE_ID)}
          onClose={onClose as unknown as () => void}
          onAdded={
            onAdded as unknown as (result: EpisodeMembersAddResult) => void
          }
        />
      </MemoryRouter>,
    );
  }

  async function listed(): Promise<Array<string>> {
    await waitFor(() => {
      expect(options(LIST).length).toBeGreaterThan(0);
    });

    return options(LIST).map((option: HTMLElement): string => {
      return (
        within(option).getByTestId(`${LIST}-option-title`).textContent || ""
      );
    });
  }

  test("lists what the person can see that is not in the episode, each with its number, state and severity", async () => {
    open();

    expect(await listed()).toEqual([
      "Checkout API is offline",
      "Checkout p95 latency above 2 s",
      "Disk filling up on db-1",
      "Payroll export failing",
    ]);

    // What the episode holds was asked to be left out.
    const recordsCall: Record<string, any> = lists.find(
      (call: Record<string, any>) => {
        return call["modelType"] === Alert;
      },
    )!;
    expect((recordsCall["query"]["_id"] as IncludesNone).values).toEqual([
      id(4),
    ]);

    const first: HTMLElement = optionTitled(LIST, "Checkout API is offline");
    expect(
      within(first).getByTestId(`${LIST}-option-number`),
    ).toHaveTextContent("ALT-1");
    expect(within(first).getByTestId(`${LIST}-option-state`)).toHaveTextContent(
      "Firing",
    );
    expect(
      within(first).getByTestId(`${LIST}-option-severity`),
    ).toHaveTextContent("Critical");

    /*
     * Private sits on the line of facts with the state and severity, not
     * beside the title, where a title that wrapped pushed it away.
     */
    const privateOne: HTMLElement = optionTitled(
      LIST,
      "Payroll export failing",
    );
    expect(
      within(
        within(privateOne).getByTestId(`${LIST}-option-facts`),
      ).getByTestId(`${LIST}-option-private`),
    ).toHaveTextContent("Private");
    expect(
      within(optionTitled(LIST, "Checkout API is offline")).queryByTestId(
        `${LIST}-option-private`,
      ),
    ).not.toBeInTheDocument();
  });

  test("one in another episode says which, or only that, when the person cannot see it", async () => {
    open();
    await listed();

    expect(
      within(optionTitled(LIST, "Checkout p95 latency above 2 s")).getByTestId(
        `${LIST}-option-note`,
      ),
    ).toHaveTextContent("In episode AE-3");
    expect(
      within(optionTitled(LIST, "Disk filling up on db-1")).getByTestId(
        `${LIST}-option-note`,
      ),
    ).toHaveTextContent("In another episode");
    expect(
      within(optionTitled(LIST, "Checkout API is offline")).queryByTestId(
        `${LIST}-option-note`,
      ),
    ).not.toBeInTheDocument();
  });

  test("several are added in one request, in the order picked, and the dialog closes", async () => {
    open();
    await listed();

    expect(submitButton()).toBeDisabled();

    fireEvent.click(optionTitled(LIST, "Disk filling up on db-1"));
    fireEvent.click(optionTitled(LIST, "Checkout API is offline"));

    expect(submitButton()).toHaveTextContent("Add 2 Alerts");
    // One picked is in another episode: it stays there too.
    expect(
      screen.getByTestId("add-episode-members-other-note"),
    ).toHaveTextContent("Alerts that are in another episode stay there too.");

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(adds).toEqual([
      { alertEpisodeId: EPISODE_ID, alertIds: [id(3), id(1)] },
    ]);
    expect(onAdded).toHaveBeenCalledWith({
      added: [id(3), id(1)],
      alreadyInEpisode: [],
      notAdded: [],
    });
  });

  test("unpicking one leaves it out", async () => {
    open();
    await listed();

    fireEvent.click(optionTitled(LIST, "Checkout API is offline"));
    fireEvent.click(optionTitled(LIST, "Disk filling up on db-1"));
    fireEvent.click(optionTitled(LIST, "Checkout API is offline"));

    expect(submitButton()).toHaveTextContent("Add 1 Alert");

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(adds).toEqual([{ alertEpisodeId: EPISODE_ID, alertIds: [id(3)] }]);
    });
  });

  test("what could not be added stays listed, with why; what was added leaves the list", async () => {
    addAnswer = (): EpisodeMembersAddResult => {
      return {
        added: [id(1)],
        alreadyInEpisode: [],
        notAdded: [{ id: id(2), reason: ALERT_NOT_FOUND_REASON }],
      };
    };

    open();
    await listed();

    fireEvent.click(optionTitled(LIST, "Checkout API is offline"));
    fireEvent.click(optionTitled(LIST, "Checkout p95 latency above 2 s"));

    // The server now holds the one added.
    tables.memberIds = [id(4), id(1)];

    fireEvent.click(submitButton());

    const box: HTMLElement = await screen.findByTestId(
      "add-episode-members-not-added",
    );

    // Drawn as the dialog draws any refusal: the danger alert.
    expect(box).toHaveAttribute("role", "alert");
    expect(box).toHaveTextContent(/^1 alert was not added/);
    // The name on its line, the reason on its own: not "name: reason".
    expect(
      within(box)
        .getAllByTestId("add-episode-members-not-added-name")
        .map((element: HTMLElement) => {
          return element.textContent;
        }),
    ).toEqual(["ALT-2: Checkout p95 latency above 2 s"]);
    expect(
      within(box).getByTestId("add-episode-members-not-added-reason"),
    ).toHaveTextContent(ALERT_NOT_FOUND_REASON);
    expect(box).not.toHaveTextContent(
      `Checkout p95 latency above 2 s: ${ALERT_NOT_FOUND_REASON}`,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(
        options(LIST).map((option: HTMLElement): string => {
          return option.getAttribute("data-option-id") || "";
        }),
      ).not.toContain(id(1));
    });

    // The one not added is still picked, to try again.
    expect(
      optionTitled(LIST, "Checkout p95 latency above 2 s").getAttribute(
        "data-selected",
      ),
    ).toBe("true");
    expect(submitButton()).toHaveTextContent("Add 1 Alert");
  });

  test("several refused for one reason are listed under it, the reason said once", async () => {
    addAnswer = (): EpisodeMembersAddResult => {
      return {
        added: [],
        alreadyInEpisode: [],
        notAdded: [
          { id: id(1), reason: ALERT_NOT_FOUND_REASON },
          { id: id(3), reason: ALERT_NOT_FOUND_REASON },
          { id: id(2), reason: "The alert was deleted." },
        ],
      };
    };

    open();
    await listed();

    fireEvent.click(optionTitled(LIST, "Checkout API is offline"));
    fireEvent.click(optionTitled(LIST, "Disk filling up on db-1"));
    fireEvent.click(optionTitled(LIST, "Checkout p95 latency above 2 s"));
    fireEvent.click(submitButton());

    const box: HTMLElement = await screen.findByTestId(
      "add-episode-members-not-added",
    );

    expect(box).toHaveTextContent(/^3 alerts were not added/);

    const groups: Array<HTMLElement> = within(box).getAllByTestId(
      "add-episode-members-not-added-group",
    );
    expect(groups).toHaveLength(2);
    expect(
      within(groups[0]!)
        .getAllByTestId("add-episode-members-not-added-name")
        .map((element: HTMLElement) => {
          return element.textContent;
        }),
    ).toEqual([
      "ALT-1: Checkout API is offline",
      "ALT-3: Disk filling up on db-1",
    ]);
    expect(
      within(groups[0]!).getAllByTestId("add-episode-members-not-added-reason"),
    ).toHaveLength(1);
    expect(
      within(groups[1]!).getByTestId("add-episode-members-not-added-reason"),
    ).toHaveTextContent("The alert was deleted.");

    // Nothing was added: the page has nothing new to show.
    expect(onAdded).not.toHaveBeenCalled();
    expect(submitButton()).toHaveTextContent("Add 3 Alerts");
  });

  test("a search by number is sent as the number", async () => {
    open();
    await listed();

    fireEvent.change(screen.getByTestId(`${LIST}-search`), {
      target: { value: "#3" },
    });

    await waitFor(
      () => {
        const searched: Array<Record<string, any>> = lists.filter(
          (call: Record<string, any>) => {
            return (
              call["modelType"] === Alert &&
              call["query"]["_multiFieldSearch"] instanceof MultiSearch
            );
          },
        );
        expect(searched.length).toBeGreaterThan(0);
        expect(
          searched[searched.length - 1]!["query"]["_multiFieldSearch"].value,
        ).toBe("3");
      },
      { timeout: EPISODE_MEMBER_SEARCH_DEBOUNCE_MS * 8 },
    );

    await waitFor(() => {
      expect(options(LIST)).toHaveLength(1);
    });
    expect(options(LIST)[0]).toHaveTextContent("Disk filling up on db-1");
  });

  test("a search that matches nothing says so", async () => {
    open();
    await listed();

    fireEvent.change(screen.getByTestId(`${LIST}-search`), {
      target: { value: "nothing like this" },
    });

    expect(
      await screen.findByTestId(
        `${LIST}-no-match`,
        {},
        { timeout: EPISODE_MEMBER_SEARCH_DEBOUNCE_MS * 8 },
      ),
    ).toHaveTextContent('No alerts match "nothing like this".');
  });

  test("with nothing to add it says why, and drops the search box that could find nothing", async () => {
    tables.alerts = [];
    open();

    // While it loads, the search box is there and has focus.
    expect(screen.getByTestId(`${LIST}-search`)).toHaveFocus();

    expect(await screen.findByTestId(`${LIST}-empty`)).toHaveTextContent(
      "All the alerts you can see are in this episode already.",
    );
    expect(screen.queryByTestId(`${LIST}-search`)).not.toBeInTheDocument();
    /*
     * Focus stays in the dialog: on the list that says why. An effect moves
     * it there once the empty list is drawn, and on a busy runner React runs
     * that effect after findByTestId has already seen the list, so the test
     * waits for it.
     */
    await waitFor(() => {
      expect(screen.getByTestId(`${LIST}-list`)).toHaveFocus();
    });
  });

  test("a search that finds nothing keeps the search box, to search again", async () => {
    open();
    await listed();

    fireEvent.change(screen.getByTestId(`${LIST}-search`), {
      target: { value: "nothing like this" },
    });

    await screen.findByTestId(
      `${LIST}-no-match`,
      {},
      { timeout: EPISODE_MEMBER_SEARCH_DEBOUNCE_MS * 8 },
    );
    expect(screen.getByTestId(`${LIST}-search`)).toHaveValue(
      "nothing like this",
    );
  });

  test("a list that cannot be read says so, and is read again on Retry", async () => {
    failLists = true;
    open();

    expect(
      await screen.findByText("The server could not be reached."),
    ).toBeInTheDocument();

    failLists = false;
    fireEvent.click(
      screen.getByRole("button", { name: /Refresh|Retry|Try again/i }),
    );

    expect(await listed()).toHaveLength(4);
  });

  test("the list shows the most recent page, says so, and picks made before a search are kept - up to the most one request takes", async () => {
    // 50 "Alpha" alerts, newest, then 51 "Beta" ones.
    tables.alerts = [
      ...Array.from({ length: 50 }, (_value: unknown, index: number) => {
        return makeAlert(1000 + index, `Alpha ${index + 1}`);
      }),
      ...Array.from({ length: 51 }, (_value: unknown, index: number) => {
        return makeAlert(2000 + index, `Beta ${index + 1}`);
      }),
    ];
    tables.memberIds = [];

    open();
    await listed();

    expect(options(LIST)).toHaveLength(EPISODE_MEMBER_PICKER_LIMIT);
    expect(screen.getByTestId("add-episode-members-shown")).toHaveTextContent(
      `Showing the ${EPISODE_MEMBER_PICKER_LIMIT} most recent alerts that are not in this episode. Search to find others.`,
    );

    for (const option of options(LIST)) {
      fireEvent.click(option);
    }

    const search: (text: string) => Promise<void> = async (
      text: string,
    ): Promise<void> => {
      fireEvent.change(screen.getByTestId(`${LIST}-search`), {
        target: { value: text },
      });

      await waitFor(
        () => {
          expect(
            options(LIST).every((option: HTMLElement): boolean => {
              return (option.textContent || "").includes(text);
            }),
          ).toBe(true);
        },
        { timeout: EPISODE_MEMBER_SEARCH_DEBOUNCE_MS * 8 },
      );
    };

    await search("Beta");
    expect(screen.getByTestId("add-episode-members-shown")).toHaveTextContent(
      `Showing the first ${EPISODE_MEMBER_PICKER_LIMIT} matches. Type more to narrow them down.`,
    );

    for (const option of options(LIST)) {
      fireEvent.click(option);
    }

    expect(submitButton()).toHaveTextContent(
      `Add ${MAX_EPISODE_MEMBERS_PER_ADD} Alerts`,
    );
    expect(screen.getByTestId("add-episode-members-max")).toHaveTextContent(
      `You can add up to ${MAX_EPISODE_MEMBERS_PER_ADD} alerts at a time.`,
    );

    // The 101st cannot be picked.
    await search("Beta 51");
    const last: HTMLElement = optionTitled(LIST, "Beta 51");
    expect(within(last).getByRole("checkbox")).toBeDisabled();
    fireEvent.click(last);
    expect(submitButton()).toHaveTextContent(
      `Add ${MAX_EPISODE_MEMBERS_PER_ADD} Alerts`,
    );

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(adds).toHaveLength(1);
    });
    expect((adds[0]!["alertIds"] as Array<string>).length).toBe(
      MAX_EPISODE_MEMBERS_PER_ADD,
    );
  });
});

describe("the lists' Add to Existing Episode", () => {
  const LIST: string = "add-to-existing-episode-list";

  let onPick: MockFunction;
  let onCreateInstead: MockFunction;

  function open(
    recordIds: Array<string>,
    withCreateInstead: boolean = true,
  ): void {
    onPick = getJestMockFunction();
    onCreateInstead = getJestMockFunction();

    render(
      <MemoryRouter>
        <AddToExistingEpisodeModal
          config={ALERT_EPISODE_MEMBER_KIND}
          recordIds={recordIds}
          onClose={() => {}}
          onPick={onPick as unknown as (episode: unknown) => void}
          onCreateNewEpisodeInstead={
            withCreateInstead
              ? (onCreateInstead as unknown as () => void)
              : undefined
          }
        />
      </MemoryRouter>,
    );
  }

  test("lists the ongoing episodes first, then the recently resolved, each with how many it holds", async () => {
    open([id(1)]);

    const ongoing: HTMLElement = await screen.findByTestId(
      `${LIST}-section-open`,
    );
    const resolved: HTMLElement = screen.getByTestId(
      `${LIST}-section-resolved`,
    );

    expect(ongoing).toHaveTextContent("Ongoing");
    // In the order the server sorted them (EpisodeMembersApi asks newest first).
    expect(
      within(ongoing)
        .getAllByTestId(`${LIST}-option-title`)
        .map((element: HTMLElement) => {
          return element.textContent;
        }),
    ).toEqual(["Checkout degradation", "Latency spike"]);
    expect(resolved).toHaveTextContent("Recently Resolved");
    expect(resolved).toHaveTextContent("Last week's outage");
    expect(within(ongoing).getAllByText("4 alerts").length).toBeGreaterThan(0);

    /*
     * Each section is dated by what it is sorted by: an ongoing episode by
     * when it started, a resolved one by when it was resolved.
     */
    const resolvedEpisode: AlertEpisode = tables.episodes.find(
      (episode: AlertEpisode): boolean => {
        return episode._id?.toString() === RESOLVED_EPISODE_ID;
      },
    )!;
    expect(
      optionTitled(LIST, "Last week's outage")
        .querySelector("time")!
        .getAttribute("dateTime"),
    ).toBe(resolvedEpisode.resolvedAt!.toISOString());
    expect(
      optionTitled(LIST, "Latency spike")
        .querySelector("time")!
        .getAttribute("dateTime"),
    ).toBe(tables.episodes[1]!.createdAt!.toISOString());

    // The count and the time read as two facts.
    const facts: HTMLElement = within(
      optionTitled(LIST, "Latency spike"),
    ).getByTestId(`${LIST}-option-facts`);
    expect(within(facts).getByTestId(`${LIST}-option-meta`)).toHaveTextContent(
      "4 alerts",
    );
    expect(facts).toHaveTextContent(/4 alerts\s*·\s*\S/);

    // Single choice: radios.
    expect(within(ongoing).getAllByRole("radio").length).toBe(2);

    // Each section's list is named by its heading, for a screen reader.
    expect(
      within(screen.getByRole("list", { name: "Ongoing" })).getAllByRole(
        "radio",
      ),
    ).toHaveLength(2);
    expect(
      within(
        screen.getByRole("list", { name: "Recently Resolved" }),
      ).getAllByRole("radio"),
    ).toHaveLength(1);
  });

  test("nothing is added until one is picked; then the one picked is handed back", async () => {
    open([id(1)]);
    await screen.findByTestId(`${LIST}-section-open`);

    expect(submitButton()).toBeDisabled();

    fireEvent.click(optionTitled(LIST, "Checkout degradation"));
    expect(submitButton()).not.toBeDisabled();

    fireEvent.click(submitButton());

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ id: EPISODE_ID, number: "AE-12" }),
    );
  });

  test("it says what happens to the ones in an episode already, before adding", async () => {
    // Alert 2 is in AE-3; alert 1 in none.
    open([id(1), id(2)]);
    await screen.findByTestId(`${LIST}-section-open`);

    fireEvent.click(optionTitled(LIST, "Latency spike"));

    await waitFor(() => {
      expect(
        screen.getByTestId("add-to-existing-episode-in-this"),
      ).toHaveTextContent(
        "1 of them is in this episode already and is left as it is.",
      );
    });

    fireEvent.click(optionTitled(LIST, "Checkout degradation"));

    expect(
      screen.getByTestId("add-to-existing-episode-in-another"),
    ).toHaveTextContent(
      "1 of them is already in another episode. It stays there too: alerts can be in more than one episode.",
    );
    expect(
      screen.queryByTestId("add-to-existing-episode-in-this"),
    ).not.toBeInTheDocument();
  });

  test("a resolved episode is not reopened by adding, and it says so", async () => {
    open([id(1)]);
    await screen.findByTestId(`${LIST}-section-resolved`);

    fireEvent.click(optionTitled(LIST, "Last week's outage"));

    // In the note right above the button that adds them.
    expect(
      within(screen.getByTestId("add-to-existing-episode-notes")).getByTestId(
        "add-to-existing-episode-resolved",
      ),
    ).toHaveTextContent(
      "This episode is resolved. Adding to it does not reopen it.",
    );
  });

  test("with no episode yet, it offers Add to New Episode instead", async () => {
    tables.episodes = [];
    open([id(1)]);

    const empty: HTMLElement = await screen.findByTestId(`${LIST}-empty`);
    expect(empty).toHaveTextContent("No episodes yet");
    expect(empty).toHaveTextContent("Start one with your selection.");

    // Nothing to search: the box goes, and the way forward has focus.
    expect(screen.queryByTestId(`${LIST}-search`)).not.toBeInTheDocument();
    const createInstead: HTMLElement = within(empty).getByTestId(
      "add-to-existing-episode-create-instead",
    );
    // An effect moves focus there once the empty list is drawn (see above).
    await waitFor(() => {
      expect(createInstead).toHaveFocus();
    });

    fireEvent.click(createInstead);
    expect(onCreateInstead).toHaveBeenCalledTimes(1);
  });

  test("someone who may not create one is not offered it", async () => {
    tables.episodes = [];
    open([id(1)], false);

    const empty: HTMLElement = await screen.findByTestId(`${LIST}-empty`);

    expect(
      screen.queryByTestId("add-to-existing-episode-create-instead"),
    ).not.toBeInTheDocument();
    // Nor told to start one.
    expect(empty).toHaveTextContent("No episodes yet");
    expect(empty).not.toHaveTextContent("Start one");
  });
});

describe("the lists' Add to New Episode", () => {
  let onCreate: MockFunction;

  function open(recordIds: Array<string>): void {
    onCreate = getJestMockFunction();

    render(
      <MemoryRouter>
        <AddToNewEpisodeModal
          config={ALERT_EPISODE_MEMBER_KIND}
          recordIds={recordIds}
          onClose={() => {}}
          onCreate={
            onCreate as unknown as (values: {
              title: string;
              severityId: string | undefined;
            }) => void
          }
        />
      </MemoryRouter>,
    );
  }

  const CRITICAL_ID: string = "5e000000-0000-4000-8000-000000000001";
  const MAJOR_ID: string = "5e000000-0000-4000-8000-000000000002";

  beforeEach(() => {
    const critical: AlertSeverity = severity("Critical", RED);
    critical._id = CRITICAL_ID;
    critical.order = 1;
    const major: AlertSeverity = severity("Major", AMBER);
    major._id = MAJOR_ID;
    major.order = 2;
    tables.severities = [critical, major];

    tables.alerts = [
      makeAlert(1, "Checkout p95 latency above 2 s", {
        alertSeverityId: new ObjectID(MAJOR_ID),
        alertEpisodeId: new ObjectID(OTHER_EPISODE_ID),
      }),
      makeAlert(2, "Payroll export failing", {
        isPrivate: true,
        alertSeverityId: new ObjectID(CRITICAL_ID),
      }),
      makeAlert(3, "Checkout API is offline", {
        alertSeverityId: new ObjectID(MAJOR_ID),
      }),
    ];
  });

  test("starts at the most severe one's severity, and the most severe title that is not private", async () => {
    open([id(1), id(2), id(3)]);

    expect(
      await screen.findByDisplayValue("Checkout p95 latency above 2 s"),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Payroll export failing")).toBeNull();
    // The private one is the most severe: its severity, never its title.
    expect(screen.getByText("Critical")).toBeInTheDocument();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Add 3 Alerts to a New Episode",
    );
    /*
     * The title says what this does; the description says what the form
     * leaves out, and what happens to the one in another episode.
     */
    const description: HTMLElement = screen.getByTestId("modal-description");
    expect(description).toHaveTextContent(
      "You can add owners, on-call policies and notes on the episode's page. 1 of them is already in another episode, and stays there too.",
    );
    expect(description).not.toHaveTextContent("Creates an episode");
  });

  test("creating hands back the title, trimmed, and the severity", async () => {
    open([id(3)]);

    const title: HTMLElement = await screen.findByDisplayValue(
      "Checkout API is offline",
    );

    fireEvent.change(title, { target: { value: "  Checkout outage  " } });

    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate.mock.calls[0]![0]).toEqual({
      title: "Checkout outage",
      severityId: MAJOR_ID,
      // The project allows several episodes: none is left out.
      leftOutIds: [],
    });
  });

  test("an incident's dialog says incidents", async () => {
    jest.restoreAllMocks();
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 0,
    } as never);

    render(
      <MemoryRouter>
        <AddToNewEpisodeModal
          config={INCIDENT_EPISODE_MEMBER_KIND}
          recordIds={[id(1)]}
          onClose={() => {}}
          onCreate={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Add 1 Incident to a New Episode",
      );
    });

    // The severities asked for are the incident ones.
    expect(
      (ModelAPI.getList as unknown as MockFunction).mock.calls.some(
        (args: Array<any>) => {
          return args[0]["modelType"] === IncidentSeverity;
        },
      ),
    ).toBe(true);
    expect(
      (ModelAPI.getList as unknown as MockFunction).mock.calls.some(
        (args: Array<any>) => {
          return args[0]["modelType"] === Incident;
        },
      ),
    ).toBe(true);
  });
});

describe("the picker list", () => {
  test("a row that cannot be picked is not picked; a picked one can always be unpicked", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });
    const onToggle: MockFunction = getJestMockFunction();

    render(
      <EpisodePickerList
        testId="picker"
        selectionMode="multiple"
        sections={[
          {
            key: "rows",
            items: [
              { id: "one", title: "One" },
              { id: "two", title: "Two" },
            ],
          },
        ]}
        selectedIds={["one"]}
        onToggle={onToggle as unknown as (id: string) => void}
        isItemDisabled={() => {
          return true;
        }}
        searchText=""
        onSearchTextChange={() => {}}
        searchPlaceholder="Search"
        isLoading={false}
        error=""
        onRetry={() => {}}
        emptyState={<div />}
        noMatchText=""
      />,
    );

    const boxes: Array<HTMLElement> = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[0]).not.toBeDisabled();
    expect(boxes[1]).toBeDisabled();

    // Clicked as a person clicks: the row's text, then the box itself.
    await user.click(screen.getByText("Two"));
    await user.click(boxes[1]!);
    expect(onToggle).not.toHaveBeenCalled();

    await user.click(screen.getByText("One"));
    expect(onToggle).toHaveBeenCalledWith("one");
  });

  test("while the first page loads it shows a skeleton, announced as loading; the search box has focus", () => {
    render(
      <EpisodePickerList
        testId="picker"
        selectionMode="single"
        sections={[{ key: "rows", items: [] }]}
        selectedIds={[]}
        onToggle={() => {}}
        searchText=""
        onSearchTextChange={() => {}}
        searchPlaceholder="Search episodes"
        isLoading={true}
        error=""
        onRetry={() => {}}
        emptyState={<div />}
        noMatchText=""
      />,
    );

    expect(screen.getByTestId("picker-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.getByTestId("picker-search")).toHaveFocus();
    expect(
      screen.getByRole("searchbox", { name: "Search episodes" }),
    ).toBeInTheDocument();
  });
});
