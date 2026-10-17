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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The add dialogs in a project that allows an incident (or alert) in only
 * one episode (Common/Types/Episode/EpisodeSingleMembership), rendered for
 * real against a stand-in server - the project's switch read through
 * ModelAPI.getItem, the lists through ModelAPI.getList, adds through
 * API.post:
 *
 *   - an episode's Add Alerts / Add Incidents (AddEpisodeMembersModal)
 *     lists only what can be added - the ones in no episode - and says the
 *     rule under the list, once, with how to add one that is held - only
 *     where it explains the list; a search still finds any, and one in
 *     another episode is drawn locked, naming that episode (when the person
 *     can see it), its note never faded with the rest of the row;
 *   - the lists' Add to Existing Episode says the selected ones in another
 *     episode are not added - or, when every one is in an episode, that
 *     there is nothing to add, with only Close;
 *   - the lists' Add to New Episode leaves the ones in an episode out, says
 *     how many, starts its title and severity from the rest and hands their
 *     ids back - or says there is nothing to add.
 *
 * With the switch off - every project until it turns it on - each dialog
 * acts as it always did (EpisodeMemberDialogs.test.tsx pins that).
 */

import AddEpisodeMembersModal from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddEpisodeMembersModal";
import AddToExistingEpisodeModal from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddToExistingEpisodeModal";
import AddToNewEpisodeModal from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddToNewEpisodeModal";
import {
  ALERT_EPISODE_MEMBER_KIND,
  EpisodeMemberKindConfig,
  INCIDENT_EPISODE_MEMBER_KIND,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeMemberKinds";
import {
  EPISODE_MEMBER_PICKER_LIMIT,
  fetchIsLimitedToOneEpisode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeMembersApi";
import { EPISODE_PICKER_DISABLED_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodePickerList";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Color from "../../../Types/Color";
import { EpisodeMembersAddResult } from "../../../Types/Episode/EpisodeMembersAdd";
import {
  ALERT_IN_ANOTHER_EPISODE_REASON,
  ALERT_SINGLE_MEMBERSHIP_COLUMN,
  INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
} from "../../../Types/Episode/EpisodeSingleMembership";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "7c000000-0000-4000-8000-000000000001";
const EPISODE_ID: string = "e1000000-0000-4000-8000-000000000012";
const OTHER_EPISODE_ID: string = "e1000000-0000-4000-8000-000000000003";
const HIDDEN_EPISODE_ID: string = "e1000000-0000-4000-8000-000000000099";

const CRITICAL_ID: string = "5e000000-0000-4000-8000-000000000001";
const MAJOR_ID: string = "5e000000-0000-4000-8000-000000000002";

const RED: Color = new Color("#dc2626");
const AMBER: Color = new Color("#f59e0b");

type IdFunction = (index: number) => string;

const id: IdFunction = (index: number): string => {
  return `a1000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
};

/*
 * One kind's stand-ins: the models it reads, and how it names its records
 * and episodes.
 */
interface KindCase {
  config: EpisodeMemberKindConfig;
  recordModel: { new (): BaseModel };
  episodeModel: { new (): BaseModel };
  memberModel: { new (): BaseModel };
  severityModel: { new (): BaseModel };
  recordPrefix: string;
  episodePrefix: string;
  column: string;
}

const ALERTS: KindCase = {
  config: ALERT_EPISODE_MEMBER_KIND,
  recordModel: Alert,
  episodeModel: AlertEpisode,
  memberModel: AlertEpisodeMember,
  severityModel: AlertSeverity,
  recordPrefix: "ALT-",
  episodePrefix: "AE-",
  column: ALERT_SINGLE_MEMBERSHIP_COLUMN,
};

const INCIDENTS: KindCase = {
  config: INCIDENT_EPISODE_MEMBER_KIND,
  recordModel: Incident,
  episodeModel: IncidentEpisode,
  memberModel: IncidentEpisodeMember,
  severityModel: IncidentSeverity,
  recordPrefix: "INC-",
  episodePrefix: "IE-",
  column: INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
};

function makeRecord(
  kind: KindCase,
  index: number,
  title: string,
  extra: Record<string, unknown> = {},
): BaseModel {
  const record: BaseModel = new kind.recordModel();
  const values: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;
  values["_id"] = id(index);
  values["title"] = title;
  values[kind.config.recordNumberField] = index;
  values[kind.config.recordNumberWithPrefixField] =
    `${kind.recordPrefix}${index}`;
  values[kind.config.recordDateField] = new Date(Date.now() - index * 60_000);
  values["createdAt"] = new Date(Date.now() - index * 60_000);
  Object.assign(values, extra);
  return record;
}

function makeEpisode(
  kind: KindCase,
  episodeId: string,
  number: number,
  title: string,
): BaseModel {
  const episode: BaseModel = new kind.episodeModel();
  const values: Record<string, unknown> = episode as unknown as Record<
    string,
    unknown
  >;
  values["_id"] = episodeId;
  values["title"] = title;
  values["episodeNumber"] = number;
  values["episodeNumberWithPrefix"] = `${kind.episodePrefix}${number}`;
  values["createdAt"] = new Date(Date.now() - number * 3_600_000);
  return episode;
}

function makeSeverity(
  kind: KindCase,
  severityId: string,
  name: string,
  order: number,
  color: Color,
): BaseModel {
  const severity: BaseModel = new kind.severityModel();
  const values: Record<string, unknown> = severity as unknown as Record<
    string,
    unknown
  >;
  values["_id"] = severityId;
  values["name"] = name;
  values["order"] = order;
  values["color"] = color;
  return severity;
}

// What the stand-in server holds: what the person can see.
interface Tables {
  // The project's switch for this kind; null when it cannot be read.
  isLimited: boolean | null;
  records: Array<BaseModel>;
  // The episodes the person can see.
  episodes: Array<BaseModel>;
  // What the episode being added to holds.
  memberIds: Array<string>;
  severities: Array<BaseModel>;
}

let tables: Tables;

// Every getItem and getList call, and each add request's body.
let items: Array<Record<string, any>>;
let lists: Array<Record<string, any>>;
let adds: Array<Record<string, unknown>>;
let addAnswer: (ids: Array<string>) => EpisodeMembersAddResult;

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

function standInServer(kind: KindCase): void {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (
    call: Record<string, any>,
  ) => {
    items.push(call);

    if (call["modelType"] !== Project) {
      return null;
    }

    if (tables.isLimited === null) {
      throw new Error("The server could not be reached.");
    }

    const project: Project = new Project();
    project._id = PROJECT_ID;
    (project as unknown as Record<string, unknown>)[kind.column] =
      tables.isLimited;
    return project;
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    call: Record<string, any>,
  ) => {
    lists.push(call);

    const query: Record<string, any> = call["query"] || {};
    const limit: number = call["limit"];

    if (call["modelType"] === kind.memberModel) {
      return answer(
        tables.memberIds.map((recordId: string): BaseModel => {
          const member: BaseModel = new kind.memberModel();
          const values: Record<string, unknown> = member as unknown as Record<
            string,
            unknown
          >;
          values[kind.config.membershipRecordIdField] = new ObjectID(recordId);
          values[kind.config.membershipEpisodeIdField] = new ObjectID(
            EPISODE_ID,
          );
          return member;
        }),
        limit,
      );
    }

    if (call["modelType"] === kind.recordModel) {
      return answer(
        tables.records.filter((record: BaseModel): boolean => {
          return matches(record, query);
        }),
        limit,
      );
    }

    if (call["modelType"] === kind.episodeModel) {
      return answer(
        tables.episodes.filter((episode: BaseModel): boolean => {
          return matches(episode, query);
        }),
        limit,
      );
    }

    if (call["modelType"] === kind.severityModel) {
      return answer(tables.severities, limit);
    }

    return answer([], limit);
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (call: {
    data: Record<string, unknown>;
  }) => {
    adds.push(call.data);
    return new HTTPResponse(
      200,
      addAnswer(call.data[kind.config.idsKey] as Array<string>) as never,
      {},
    );
  }) as never);
}

/*
 * Five records: 1 and 4 in no episode, 2 in episode 3, 3 in an episode the
 * person cannot see, 5 in the episode being added to.
 */
function seed(kind: KindCase): void {
  tables = {
    isLimited: true,
    records: [
      makeRecord(kind, 1, "Checkout API is offline"),
      makeRecord(kind, 2, "Checkout p95 latency above 2 s", {
        [kind.config.recordEpisodeIdField]: new ObjectID(OTHER_EPISODE_ID),
      }),
      makeRecord(kind, 3, "Disk filling up on db-1", {
        [kind.config.recordEpisodeIdField]: new ObjectID(HIDDEN_EPISODE_ID),
      }),
      makeRecord(kind, 4, "Cart service restarts"),
      makeRecord(kind, 5, "Payment webhook failures", {
        [kind.config.recordEpisodeIdField]: new ObjectID(EPISODE_ID),
      }),
    ],
    episodes: [
      makeEpisode(kind, EPISODE_ID, 12, "Checkout degradation"),
      makeEpisode(kind, OTHER_EPISODE_ID, 3, "Latency spike"),
    ],
    memberIds: [id(5)],
    severities: [],
  };
}

beforeEach(() => {
  items = [];
  lists = [];
  adds = [];
  addAnswer = (ids: Array<string>): EpisodeMembersAddResult => {
    return { added: ids, alreadyInEpisode: [], notAdded: [] };
  };
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

function titlesListed(testId: string): Array<string> {
  return options(testId).map((option: HTMLElement): string => {
    return (
      within(option).getByTestId(`${testId}-option-title`).textContent || ""
    );
  });
}

function submitButton(): HTMLElement | null {
  return within(screen.getByTestId("modal")).queryByTestId(
    "modal-footer-submit-button",
  );
}

// The read of the records the list shows, the last one made.
function lastRecordsQuery(kind: KindCase): Record<string, any> {
  const calls: Array<Record<string, any>> = lists.filter(
    (call: Record<string, any>): boolean => {
      return call["modelType"] === kind.recordModel;
    },
  );
  return calls[calls.length - 1]!["query"] as Record<string, any>;
}

describe("whether the project allows one in only one episode", () => {
  test("is read from the current project, its own column only", async () => {
    seed(ALERTS);
    standInServer(ALERTS);

    await expect(
      fetchIsLimitedToOneEpisode({ config: ALERT_EPISODE_MEMBER_KIND }),
    ).resolves.toBe(true);

    expect(items).toHaveLength(1);
    expect(items[0]!["modelType"]).toBe(Project);
    expect(idOf(items[0]!["id"])).toBe(PROJECT_ID);
    expect(items[0]!["select"]).toEqual({ limitAlertsToOneEpisode: true });
  });

  test("incidents read theirs", async () => {
    seed(INCIDENTS);
    standInServer(INCIDENTS);

    await expect(
      fetchIsLimitedToOneEpisode({ config: INCIDENT_EPISODE_MEMBER_KIND }),
    ).resolves.toBe(true);
    expect(items[0]!["select"]).toEqual({ limitIncidentsToOneEpisode: true });
  });

  test("a project that cannot be read allows several: the server decides anyway", async () => {
    seed(ALERTS);
    standInServer(ALERTS);
    tables.isLimited = null;

    await expect(
      fetchIsLimitedToOneEpisode({ config: ALERT_EPISODE_MEMBER_KIND }),
    ).resolves.toBe(false);
  });

  test("no project selected: several, without asking", async () => {
    seed(ALERTS);
    standInServer(ALERTS);
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    await expect(
      fetchIsLimitedToOneEpisode({ config: ALERT_EPISODE_MEMBER_KIND }),
    ).resolves.toBe(false);
    expect(items).toEqual([]);
  });
});

describe.each([
  ["alerts", ALERTS],
  ["incidents", INCIDENTS],
])(
  "an episode's Add (%s), allowed in only one episode",
  (_name: string, kind: KindCase) => {
    const LIST: string = "add-episode-members-list";
    let onClose: MockFunction;
    let onAdded: MockFunction;

    function open(): void {
      onClose = getJestMockFunction();
      onAdded = getJestMockFunction();

      render(
        <MemoryRouter>
          <AddEpisodeMembersModal
            config={kind.config}
            episodeId={new ObjectID(EPISODE_ID)}
            onClose={onClose as unknown as () => void}
            onAdded={
              onAdded as unknown as (result: EpisodeMembersAddResult) => void
            }
          />
        </MemoryRouter>,
      );
    }

    async function search(text: string): Promise<void> {
      fireEvent.change(screen.getByTestId(`${LIST}-search`), {
        target: { value: text },
      });

      await waitFor(
        () => {
          const query: Record<string, any> = lastRecordsQuery(kind);
          expect(query["_multiFieldSearch"]).toBeInstanceOf(MultiSearch);
        },
        { timeout: 4000 },
      );
    }

    beforeEach(() => {
      seed(kind);
      standInServer(kind);
    });

    test("lists only what can be added: the ones in no episode", async () => {
      open();

      await waitFor(() => {
        expect(options(LIST).length).toBeGreaterThan(0);
      });

      expect(titlesListed(LIST)).toEqual([
        "Checkout API is offline",
        "Cart service restarts",
      ]);
      // Asked of the server, not filtered here.
      expect(
        lastRecordsQuery(kind)[kind.config.recordEpisodeIdField],
      ).toBeInstanceOf(IsNull);
    });

    // The rule, and how to add one that is held: said for everyone.
    const RULE: string =
      kind === ALERTS
        ? "An alert can be in only one episode in this project. To add one that is in another episode, remove it from that episode first."
        : "An incident can be in only one episode in this project. To add one that is in another episode, remove it from that episode first.";

    // Every place in the dialog that says the rule.
    function rulesSaid(): number {
      const ruleSentence: string =
        kind === ALERTS
          ? "An alert can be in only one episode in this project."
          : "An incident can be in only one episode in this project.";

      return (
        (screen.getByTestId("modal").textContent?.split(ruleSentence).length ||
          1) - 1
      );
    }

    test("says the rule once, under the list, with how to add one that is held", async () => {
      open();

      expect(
        await screen.findByTestId("add-episode-members-one-episode"),
      ).toHaveTextContent(RULE);
      await waitFor(() => {
        expect(options(LIST).length).toBeGreaterThan(0);
      });
      expect(rulesSaid()).toBe(1);
    });

    test("a search finds any: one in another episode is listed locked, naming the episode, with how to move it", async () => {
      open();
      await waitFor(() => {
        expect(options(LIST).length).toBeGreaterThan(0);
      });

      await search("Checkout");

      await waitFor(() => {
        expect(titlesListed(LIST)).toContain("Checkout p95 latency above 2 s");
      });

      // A search is not narrowed to the ones in no episode.
      expect(
        lastRecordsQuery(kind)[kind.config.recordEpisodeIdField],
      ).toBeUndefined();

      const locked: HTMLElement = optionTitled(
        LIST,
        "Checkout p95 latency above 2 s",
      );
      const checkbox: HTMLInputElement = within(locked).getByRole(
        "checkbox",
      ) as HTMLInputElement;
      const note: HTMLElement = within(locked).getByTestId(
        `${LIST}-option-note`,
      );

      expect(checkbox).toBeDisabled();
      expect(note).toHaveTextContent(
        `Already in episode ${kind.episodePrefix}3`,
      );

      /*
       * Faded: its box, its title and its facts - never its note, which
       * says why it cannot be picked. The row itself is not faded, or the
       * note would fade with it.
       */
      expect(checkbox).toHaveClass(EPISODE_PICKER_DISABLED_CLASS_NAME);
      expect(within(locked).getByTestId(`${LIST}-option-heading`)).toHaveClass(
        EPISODE_PICKER_DISABLED_CLASS_NAME,
      );
      expect(within(locked).getByTestId(`${LIST}-option-facts`)).toHaveClass(
        EPISODE_PICKER_DISABLED_CLASS_NAME,
      );
      expect(note).not.toHaveClass(EPISODE_PICKER_DISABLED_CLASS_NAME);
      expect(locked).not.toHaveClass(EPISODE_PICKER_DISABLED_CLASS_NAME);
      expect(locked).toHaveClass("cursor-not-allowed");

      // A row that can be picked is not faded at all.
      const free: HTMLElement = optionTitled(LIST, "Checkout API is offline");
      expect(within(free).getByRole("checkbox")).not.toHaveClass(
        EPISODE_PICKER_DISABLED_CLASS_NAME,
      );
      expect(
        within(free).getByTestId(`${LIST}-option-heading`),
      ).not.toHaveClass(EPISODE_PICKER_DISABLED_CLASS_NAME);
      expect(note).toHaveAttribute(
        "title",
        kind === ALERTS
          ? `An alert can be in only one episode in this project. To add it here, remove it from episode ${kind.episodePrefix}3 first.`
          : `An incident can be in only one episode in this project. To add it here, remove it from episode ${kind.episodePrefix}3 first.`,
      );
      // The note is what a screen reader hears for the locked box.
      expect(checkbox.getAttribute("aria-describedby")).toBe(note.id);

      // Clicking it picks nothing.
      fireEvent.click(locked);
      expect(checkbox).not.toBeChecked();
      expect(submitButton()).toBeDisabled();

      // One in no episode is picked as always.
      fireEvent.click(optionTitled(LIST, "Checkout API is offline"));
      expect(submitButton()).not.toBeDisabled();
    });

    test("an episode the person cannot see is 'another episode'", async () => {
      open();
      await waitFor(() => {
        expect(options(LIST).length).toBeGreaterThan(0);
      });

      await search("Disk");

      await waitFor(() => {
        expect(titlesListed(LIST)).toEqual(["Disk filling up on db-1"]);
      });

      const note: HTMLElement = within(
        optionTitled(LIST, "Disk filling up on db-1"),
      ).getByTestId(`${LIST}-option-note`);

      expect(note).toHaveTextContent("Already in another episode");
      expect(note.getAttribute("title")).toContain(
        "remove it from that episode first.",
      );
    });

    test("only the ones picked are asked for, and the dialog closes", async () => {
      open();
      await waitFor(() => {
        expect(options(LIST).length).toBeGreaterThan(0);
      });

      fireEvent.click(optionTitled(LIST, "Cart service restarts"));
      fireEvent.click(submitButton()!);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(adds).toEqual([
        {
          [kind.config.episodeIdKey]: EPISODE_ID,
          [kind.config.idsKey]: [id(4)],
        },
      ]);
    });

    test("one put in another episode meanwhile stays listed, with the server's reason", async () => {
      addAnswer = (): EpisodeMembersAddResult => {
        return {
          added: [],
          alreadyInEpisode: [],
          notAdded: [{ id: id(1), reason: kind.config.inAnotherEpisodeReason }],
        };
      };

      open();
      await waitFor(() => {
        expect(options(LIST).length).toBeGreaterThan(0);
      });

      fireEvent.click(optionTitled(LIST, "Checkout API is offline"));

      await act(async () => {
        fireEvent.click(submitButton()!);
      });

      const box: HTMLElement = await screen.findByTestId(
        "add-episode-members-not-added",
      );
      expect(
        within(box).getByTestId("add-episode-members-not-added-reason"),
      ).toHaveTextContent(kind.config.inAnotherEpisodeReason);
      expect(onClose).not.toHaveBeenCalled();
    });

    test("with nothing in no episode, it says the rest are all in another episode - and the rule once, under the list", async () => {
      tables.records = tables.records.filter((record: BaseModel): boolean => {
        return Boolean(
          (record as unknown as Record<string, unknown>)[
            kind.config.recordEpisodeIdField
          ],
        );
      });

      open();

      const empty: HTMLElement = await screen.findByTestId(`${LIST}-empty`);

      expect(empty).toHaveTextContent(
        kind === ALERTS
          ? "Every other alert you can see is already in another episode."
          : "Every other incident you can see is already in another episode.",
      );
      // The empty state says what is so; the line under the list, why.
      expect(empty).not.toHaveTextContent("can be in only one episode");
      expect(
        await screen.findByTestId("add-episode-members-one-episode"),
      ).toHaveTextContent(RULE);
      expect(rulesSaid()).toBe(1);
    });

    test("with nothing at all, it says there are none yet, and no rule that explains nothing", async () => {
      tables.records = [];
      tables.memberIds = [];

      open();

      expect(await screen.findByTestId(`${LIST}-empty`)).toHaveTextContent(
        `There are no ${kind === ALERTS ? "alerts" : "incidents"} in this project yet.`,
      );
      expect(
        screen.queryByTestId("add-episode-members-one-episode"),
      ).not.toBeInTheDocument();
    });

    test("with every one in this episode already, no rule either", async () => {
      tables.records = tables.records.filter((record: BaseModel): boolean => {
        return tables.memberIds.includes(idOf(record._id));
      });

      open();

      expect(await screen.findByTestId(`${LIST}-empty`)).toHaveTextContent(
        `All the ${kind === ALERTS ? "alerts" : "incidents"} you can see are in this episode already.`,
      );
      expect(
        screen.queryByTestId("add-episode-members-one-episode"),
      ).not.toBeInTheDocument();
    });

    test("a search that matches nothing says so, without the rule", async () => {
      open();
      await waitFor(() => {
        expect(options(LIST).length).toBeGreaterThan(0);
      });

      await search("no such title");

      expect(await screen.findByTestId(`${LIST}-no-match`)).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByTestId("add-episode-members-one-episode"),
        ).not.toBeInTheDocument();
      });
    });

    test("at the most it lists, it says it shows the ones in no episode", async () => {
      for (
        let index: number = 100;
        index < 100 + EPISODE_MEMBER_PICKER_LIMIT;
        index++
      ) {
        tables.records.push(
          makeRecord(kind, index, `Synthetic check ${index}`),
        );
      }

      open();

      expect(
        await screen.findByTestId("add-episode-members-shown"),
      ).toHaveTextContent(
        `Showing the ${EPISODE_MEMBER_PICKER_LIMIT} most recent ${kind === ALERTS ? "alerts" : "incidents"} that are in no episode. Search to find others.`,
      );
    });
  },
);

describe("an episode's Add Alerts, in a project that allows several", () => {
  const LIST: string = "add-episode-members-list";

  beforeEach(() => {
    seed(ALERTS);
    tables.isLimited = false;
    standInServer(ALERTS);
  });

  test("lists every one not in this episode, picks one in another episode, and says nothing of the rule", async () => {
    render(
      <MemoryRouter>
        <AddEpisodeMembersModal
          config={ALERT_EPISODE_MEMBER_KIND}
          episodeId={new ObjectID(EPISODE_ID)}
          onClose={() => {}}
          onAdded={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(titlesListed(LIST)).toEqual([
        "Checkout API is offline",
        "Checkout p95 latency above 2 s",
        "Disk filling up on db-1",
        "Cart service restarts",
      ]);
    });

    expect(
      lastRecordsQuery(ALERTS)[ALERT_EPISODE_MEMBER_KIND.recordEpisodeIdField],
    ).toBeUndefined();

    const other: HTMLElement = optionTitled(
      LIST,
      "Checkout p95 latency above 2 s",
    );
    expect(within(other).getByRole("checkbox")).not.toBeDisabled();
    expect(within(other).getByTestId(`${LIST}-option-note`)).toHaveTextContent(
      "In episode AE-3",
    );
    expect(
      screen.queryByTestId("add-episode-members-one-episode"),
    ).not.toBeInTheDocument();
  });

  test("a switch that cannot be read is taken as off", async () => {
    tables.isLimited = null;

    render(
      <MemoryRouter>
        <AddEpisodeMembersModal
          config={ALERT_EPISODE_MEMBER_KIND}
          episodeId={new ObjectID(EPISODE_ID)}
          onClose={() => {}}
          onAdded={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(titlesListed(LIST)).toHaveLength(4);
    });
  });
});

describe("the lists' Add to Existing Episode, allowed in only one episode", () => {
  const LIST: string = "add-to-existing-episode-list";
  let onClose: MockFunction;
  let onPick: MockFunction;

  function open(recordIds: Array<string>, kind: KindCase = ALERTS): void {
    onClose = getJestMockFunction();
    onPick = getJestMockFunction();

    render(
      <MemoryRouter>
        <AddToExistingEpisodeModal
          config={kind.config}
          recordIds={recordIds}
          onClose={onClose as unknown as () => void}
          onPick={onPick as unknown as (episode: unknown) => void}
        />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    seed(ALERTS);
    standInServer(ALERTS);
  });

  test("it says the ones in another episode are not added", async () => {
    // 1 in no episode, 2 in AE-3.
    open([id(1), id(2)]);
    await screen.findByTestId(`${LIST}-section-open`);

    fireEvent.click(optionTitled(LIST, "Checkout degradation"));

    await waitFor(() => {
      expect(
        screen.getByTestId("add-to-existing-episode-in-another"),
      ).toHaveTextContent(
        "1 of them is already in another episode, so it won't be added. An alert can be in only one episode in this project.",
      );
    });
    expect(submitButton()).not.toBeDisabled();
  });

  test("several in another episode: the plural", async () => {
    open([id(1), id(2), id(3)]);
    await screen.findByTestId(`${LIST}-section-open`);

    fireEvent.click(optionTitled(LIST, "Checkout degradation"));

    await waitFor(() => {
      expect(
        screen.getByTestId("add-to-existing-episode-in-another"),
      ).toHaveTextContent(
        "2 of them are already in another episode, so they won't be added. An alert can be in only one episode in this project.",
      );
    });
  });

  test("every selected one in an episode: nothing to add, why, and only Close", async () => {
    open([id(2), id(3)]);

    const notice: HTMLElement = await screen.findByTestId(
      "add-to-existing-episode-nothing-to-add",
    );

    expect(notice).toHaveTextContent("Nothing to add");
    expect(
      screen.getByTestId("add-to-existing-episode-nothing-to-add-reason"),
    ).toHaveTextContent(
      "Every selected alert is already in an episode. An alert can be in only one episode in this project. To move them, remove them from their episodes first.",
    );
    // The same dialog: its title, no list, no button that adds.
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Add 2 Alerts to an Episode",
    );
    expect(screen.queryByTestId(`${LIST}-list`)).not.toBeInTheDocument();
    expect(submitButton()).not.toBeInTheDocument();

    /*
     * The keyboard starts on Close, the one thing left to do - though the
     * dialog drew its list first, with the search box focused, and that box
     * is gone.
     */
    await waitFor(() => {
      expect(screen.getByTestId("modal-footer-close-button")).toHaveFocus();
    });

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  test("one selected, in an episode: the singular, for incidents too", async () => {
    cleanup();
    jest.restoreAllMocks();
    seed(INCIDENTS);
    standInServer(INCIDENTS);

    open([id(2)], INCIDENTS);

    expect(
      await screen.findByTestId(
        "add-to-existing-episode-nothing-to-add-reason",
      ),
    ).toHaveTextContent(
      "The selected incident is already in an episode. An incident can be in only one episode in this project. To move it, remove it from its episode first.",
    );
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Close",
    );
  });

  test("until it knows, the list shows its skeleton, never the episodes first", async () => {
    let releaseItem: () => void = () => {};
    const itemRead: Promise<void> = new Promise<void>((resolve: () => void) => {
      releaseItem = resolve;
    });

    jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      await itemRead;
      const project: Project = new Project();
      project.limitAlertsToOneEpisode = true;
      return project;
    }) as never);

    open([id(2), id(3)]);

    expect(await screen.findByTestId(`${LIST}-skeleton`)).toBeInTheDocument();
    // The episodes were read, but are not shown while the switch is unknown.
    await waitFor(() => {
      expect(
        lists.some((call: Record<string, any>): boolean => {
          return call["modelType"] === AlertEpisode;
        }),
      ).toBe(true);
    });
    expect(options(LIST)).toHaveLength(0);

    await act(async () => {
      releaseItem();
    });

    expect(
      await screen.findByTestId("add-to-existing-episode-nothing-to-add"),
    ).toBeInTheDocument();
  });

  test("with several allowed, every one in an episode is still offered the picker, as before", async () => {
    tables.isLimited = false;
    open([id(2), id(3)]);

    expect(
      await screen.findByTestId(`${LIST}-section-open`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("add-to-existing-episode-nothing-to-add"),
    ).not.toBeInTheDocument();

    fireEvent.click(optionTitled(LIST, "Checkout degradation"));

    await waitFor(() => {
      expect(
        screen.getByTestId("add-to-existing-episode-in-another"),
      ).toHaveTextContent("They stay there too");
    });
  });
});

describe("the lists' Add to New Episode, allowed in only one episode", () => {
  let onClose: MockFunction;
  let onCreate: MockFunction;

  function open(recordIds: Array<string>, kind: KindCase = ALERTS): void {
    onClose = getJestMockFunction();
    onCreate = getJestMockFunction();

    render(
      <MemoryRouter>
        <AddToNewEpisodeModal
          config={kind.config}
          recordIds={recordIds}
          onClose={onClose as unknown as () => void}
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

  beforeEach(() => {
    seed(ALERTS);
    tables.severities = [
      makeSeverity(ALERTS, CRITICAL_ID, "Critical", 1, RED),
      makeSeverity(ALERTS, MAJOR_ID, "Major", 2, AMBER),
    ];
    // The one in another episode is the most severe.
    (tables.records[1] as unknown as Record<string, unknown>)[
      ALERT_EPISODE_MEMBER_KIND.recordSeverityIdField
    ] = new ObjectID(CRITICAL_ID);
    (tables.records[0] as unknown as Record<string, unknown>)[
      ALERT_EPISODE_MEMBER_KIND.recordSeverityIdField
    ] = new ObjectID(MAJOR_ID);
    standInServer(ALERTS);
  });

  test("the ones in an episode are left out: it says how many, and starts from the rest", async () => {
    open([id(1), id(2)]);

    // The title and severity are the one going in, not the one left out.
    expect(
      await screen.findByDisplayValue("Checkout API is offline"),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Checkout p95 latency above 2 s"),
    ).toBeNull();
    expect(screen.getByText("Major")).toBeInTheDocument();

    /*
     * What changes what this creates comes first: the one left out, then
     * what can be added on the episode's page.
     */
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "1 of them is already in an episode, so it is left out. An alert can be in only one episode in this project. You can add owners, on-call policies and notes on the episode's page.",
    );
    expect(
      screen.getByTestId("modal-description").textContent?.indexOf("1 of them"),
    ).toBe(0);

    await act(async () => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate.mock.calls[0]![0]).toEqual({
      title: "Checkout API is offline",
      severityId: MAJOR_ID,
      leftOutIds: [id(2)],
    });
  });

  test("every one in an episode: nothing to add, why, and only Close", async () => {
    open([id(2), id(3)]);

    const notice: HTMLElement = await screen.findByTestId(
      "add-to-new-episode-nothing-to-add",
    );

    expect(notice).toHaveTextContent("Nothing to add");
    expect(
      screen.getByTestId("add-to-new-episode-nothing-to-add-reason"),
    ).toHaveTextContent(
      "Every selected alert is already in an episode. An alert can be in only one episode in this project. To move them, remove them from their episodes first.",
    );
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Add 2 Alerts to a New Episode",
    );
    // No form, nothing that creates.
    expect(screen.queryByDisplayValue(/./)).toBeNull();
    expect(submitButton()).not.toBeInTheDocument();

    // The keyboard starts on Close, the one thing left to do.
    await waitFor(() => {
      expect(screen.getByTestId("modal-footer-close-button")).toHaveFocus();
    });

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("with several allowed, the one in another episode goes in too, as before", async () => {
    tables.isLimited = false;
    open([id(1), id(2)]);

    // The most severe one is in another episode, and starts the episode.
    expect(
      await screen.findByDisplayValue("Checkout p95 latency above 2 s"),
    ).toBeInTheDocument();
    // Nothing changes what this creates, so the page's sentence comes first.
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "You can add owners, on-call policies and notes on the episode's page. 1 of them is already in another episode, and stays there too.",
    );

    await act(async () => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(
      (onCreate.mock.calls[0]![0] as Record<string, unknown>)["leftOutIds"],
    ).toEqual([]);
  });

  test("the reason each left-out one gets is the server's own", () => {
    expect(ALERT_EPISODE_MEMBER_KIND.inAnotherEpisodeReason).toBe(
      ALERT_IN_ANOTHER_EPISODE_REASON,
    );
  });
});
