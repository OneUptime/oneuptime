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
import React, { ReactElement } from "react";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const modelFormModalMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock consts above are still unassigned when the factory
 * runs. Dereferencing them lazily, at call time, is what makes this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

/*
 * The state-change modal is a full model form with its own API traffic. The
 * header only decides WHICH modal opens and what happens once it saves, so
 * the stub records its props, shows its copy, and exposes submit and close.
 */
jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, any>): ReactElement => {
      modelFormModalMock(props);

      return React.createElement(
        "div",
        { "data-testid": "state-change-modal" },
        React.createElement("h3", null, props["title"]),
        React.createElement("p", null, props["description"]),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: async () => {
              const model: unknown = new props["modelType"]();
              await props["onBeforeCreate"](model);
              await props["onSuccess"](model);
            },
          },
          props["submitButtonText"],
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              props["onClose"]();
            },
          },
          "Close modal",
        ),
      );
    },
  };
});

import ChangeAlertEpisodeState from "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/ChangeState";
import ChangeIncidentEpisodeState from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/ChangeState";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import User from "../../../Models/DatabaseModels/User";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Both episode headers used to be a bare legacy stepper: no number, title,
 * severity, privacy, duration or primary actions, and a 208px-margin page
 * loader while they fetched. They now render EventStatusPanel like the
 * incident header: Acknowledge / Resolve as real buttons, the other forward
 * states under "More actions", context facts, and a same-size skeleton while
 * loading. These tests drive both real components against a fake API.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const INVESTIGATING_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const RESOLVED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const TEMPLATE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

type Stage = "created" | "acknowledged" | "investigating" | "resolved";

interface HeaderProps {
  refreshToken?: number | undefined;
  onActionComplete: () => void | Promise<void>;
}

interface EpisodeSpec {
  title?: string | undefined;
  withGroupingRule?: boolean | undefined;
  withCreator?: boolean | undefined;
  withLastMemberAddedAt?: boolean | undefined;
  isPrivate?: boolean | undefined;
  currentStateId?: string | undefined;
}

interface EpisodeCase {
  noun: "incident" | "alert";
  episodeModel: typeof IncidentEpisode | typeof AlertEpisode;
  stateModel: typeof IncidentState | typeof AlertState;
  timelineModel:
    | typeof IncidentEpisodeStateTimeline
    | typeof AlertEpisodeStateTimeline;
  templateModel: typeof IncidentNoteTemplate | typeof AlertNoteTemplate;
  episodeIdField: "incidentEpisodeId" | "alertEpisodeId";
  stateIdField: "incidentStateId" | "alertStateId";
  renderHeader: (props: HeaderProps) => ReactElement;
  // Where the duration starts: declaredAt for incident episodes, createdAt for alerts.
  applyStart: (episode: any, startedAt: Date) => void;
  buildEpisode: (spec: EpisodeSpec) => any;
}

type SetStartFunction = (episode: any, startedAt: Date) => void;

const setIncidentEpisodeStart: SetStartFunction = (
  episode: any,
  startedAt: Date,
): void => {
  episode.declaredAt = startedAt;
  // Created much earlier: the header must still measure from declaredAt.
  episode.createdAt = new Date(startedAt.getTime() - 10 * DAY);
};

const setAlertEpisodeStart: SetStartFunction = (
  episode: any,
  startedAt: Date,
): void => {
  episode.createdAt = startedAt;
};

type BuildCreatorFunction = () => User;

const buildCreator: BuildCreatorFunction = (): User => {
  const user: User = new User();
  user.name = new Name("Ada Lovelace");
  return user;
};

const INCIDENT_CASE: EpisodeCase = {
  noun: "incident",
  episodeModel: IncidentEpisode,
  stateModel: IncidentState,
  timelineModel: IncidentEpisodeStateTimeline,
  templateModel: IncidentNoteTemplate,
  episodeIdField: "incidentEpisodeId",
  stateIdField: "incidentStateId",
  renderHeader: (props: HeaderProps): ReactElement => {
    return (
      <ChangeIncidentEpisodeState
        episodeId={new ObjectID(EPISODE_ID)}
        {...props}
      />
    );
  },
  applyStart: setIncidentEpisodeStart,
  buildEpisode: (spec: EpisodeSpec): IncidentEpisode => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.id = new ObjectID(EPISODE_ID);
    episode.title = spec.title || "Checkout outage";
    episode.episodeNumber = 7;
    episode.episodeNumberWithPrefix = "EP-7";
    episode.isPrivate = spec.isPrivate === true;

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Critical";
    severity.color = new Color("#ef4444");
    episode.incidentSeverity = severity;

    if (spec.withGroupingRule) {
      const rule: IncidentGroupingRule = new IncidentGroupingRule();
      rule.name = "Checkout 5xx";
      episode.incidentGroupingRule = rule;
    }

    if (spec.withCreator) {
      episode.createdByUser = buildCreator();
    }

    if (spec.withLastMemberAddedAt) {
      episode.lastIncidentAddedAt = new Date(Date.now() - 5 * MINUTE);
    }

    if (spec.currentStateId) {
      episode.currentIncidentStateId = new ObjectID(spec.currentStateId);
    }

    return episode;
  },
};

const ALERT_CASE: EpisodeCase = {
  noun: "alert",
  episodeModel: AlertEpisode,
  stateModel: AlertState,
  timelineModel: AlertEpisodeStateTimeline,
  templateModel: AlertNoteTemplate,
  episodeIdField: "alertEpisodeId",
  stateIdField: "alertStateId",
  renderHeader: (props: HeaderProps): ReactElement => {
    return (
      <ChangeAlertEpisodeState
        episodeId={new ObjectID(EPISODE_ID)}
        {...props}
      />
    );
  },
  applyStart: setAlertEpisodeStart,
  buildEpisode: (spec: EpisodeSpec): AlertEpisode => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.id = new ObjectID(EPISODE_ID);
    episode.title = spec.title || "Checkout outage";
    episode.episodeNumber = 7;
    episode.episodeNumberWithPrefix = "EP-7";
    episode.isPrivate = spec.isPrivate === true;

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Critical";
    severity.color = new Color("#ef4444");
    episode.alertSeverity = severity;

    if (spec.withGroupingRule) {
      const rule: AlertGroupingRule = new AlertGroupingRule();
      rule.name = "Checkout 5xx";
      episode.alertGroupingRule = rule;
    }

    if (spec.withCreator) {
      episode.createdByUser = buildCreator();
    }

    if (spec.withLastMemberAddedAt) {
      episode.lastAlertAddedAt = new Date(Date.now() - 5 * MINUTE);
    }

    if (spec.currentStateId) {
      episode.currentAlertStateId = new ObjectID(spec.currentStateId);
    }

    return episode;
  },
};

const CASES: Array<EpisodeCase> = [INCIDENT_CASE, ALERT_CASE];

interface StateSpec {
  id: string;
  name: string;
  color: string;
  flag?: "isCreatedState" | "isAcknowledgedState" | "isResolvedState";
}

const STATE_SPECS: Array<StateSpec> = [
  {
    id: CREATED_STATE_ID,
    name: "Created",
    color: "#ef4444",
    flag: "isCreatedState",
  },
  {
    id: ACKNOWLEDGED_STATE_ID,
    name: "Acknowledged",
    color: "#f59e0b",
    flag: "isAcknowledgedState",
  },
  {
    id: INVESTIGATING_STATE_ID,
    name: "Investigating",
    color: "#6366f1",
  },
  {
    id: RESOLVED_STATE_ID,
    name: "Resolved",
    color: "#10b981",
    flag: "isResolvedState",
  },
];

type BuildStatesFunction = (episodeCase: EpisodeCase) => Array<any>;

const buildStates: BuildStatesFunction = (
  episodeCase: EpisodeCase,
): Array<any> => {
  return STATE_SPECS.map((spec: StateSpec): any => {
    const state: any = new episodeCase.stateModel();
    state.id = new ObjectID(spec.id);
    state.name = spec.name;
    state.color = new Color(spec.color);

    if (spec.flag) {
      state[spec.flag] = true;
    }

    return state;
  });
};

type BuildTimelinesFunction = (
  episodeCase: EpisodeCase,
  stage: Stage,
  startedAt: Date,
) => Array<any>;

// The first entry is written 10 minutes after the episode started.
const buildTimelines: BuildTimelinesFunction = (
  episodeCase: EpisodeCase,
  stage: Stage,
  startedAt: Date,
): Array<any> => {
  const entries: Array<[string, number]> = [[CREATED_STATE_ID, 10]];

  if (stage !== "created") {
    entries.push([ACKNOWLEDGED_STATE_ID, 30]);
  }

  if (stage === "investigating" || stage === "resolved") {
    entries.push([INVESTIGATING_STATE_ID, 60]);
  }

  if (stage === "resolved") {
    entries.push([RESOLVED_STATE_ID, 125]);
  }

  return entries.map((entry: [string, number]): any => {
    const timeline: any = new episodeCase.timelineModel();
    timeline[episodeCase.stateIdField] = new ObjectID(entry[0]);
    timeline.startsAt = new Date(startedAt.getTime() + entry[1] * MINUTE);
    return timeline;
  });
};

type ListOfFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listOf: ListOfFunction = (data: Array<unknown>) => {
  return { data, count: data.length, skip: 0, limit: data.length };
};

interface FakeServerOptions {
  stage?: Stage | undefined;
  episode?: EpisodeSpec | undefined;
  startedAt?: Date | undefined;
}

interface FakeServer {
  startedAt: Date;
  setStage: (stage: Stage) => void;
}

type InstallFakeServerFunction = (
  episodeCase: EpisodeCase,
  options?: FakeServerOptions,
) => FakeServer;

const installFakeServer: InstallFakeServerFunction = (
  episodeCase: EpisodeCase,
  options?: FakeServerOptions,
): FakeServer => {
  const startedAt: Date =
    options?.startedAt || new Date(Date.now() - 3 * DAY - 2 * 60 * MINUTE);
  let stage: Stage = options?.stage || "created";

  getItemMock.mockImplementation(() => {
    const episode: any = episodeCase.buildEpisode(options?.episode || {});
    episodeCase.applyStart(episode, startedAt);
    return Promise.resolve(episode);
  });

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: Record<string, any> = args[0] as Record<string, any>;

    if (request["modelType"] === episodeCase.stateModel) {
      return Promise.resolve(listOf(buildStates(episodeCase)));
    }

    if (request["modelType"] === episodeCase.timelineModel) {
      return Promise.resolve(
        listOf(buildTimelines(episodeCase, stage, startedAt)),
      );
    }

    if (request["modelType"] === episodeCase.templateModel) {
      const template: any = new episodeCase.templateModel();
      template.id = new ObjectID(TEMPLATE_ID);
      template.templateName = "Customer update";
      template.note = "We are on it.";
      return Promise.resolve(listOf([template]));
    }

    return Promise.resolve(listOf([]));
  });

  return {
    startedAt,
    setStage: (nextStage: Stage): void => {
      stage = nextStage;
    },
  };
};

type RenderLoadedFunction = (
  episodeCase: EpisodeCase,
  props?: Partial<HeaderProps>,
) => Promise<{
  view: ReturnType<typeof render>;
  onActionComplete: MockFunction;
}>;

const renderLoaded: RenderLoadedFunction = async (
  episodeCase: EpisodeCase,
  props?: Partial<HeaderProps>,
): Promise<{
  view: ReturnType<typeof render>;
  onActionComplete: MockFunction;
}> => {
  const onActionComplete: MockFunction = getJestMockFunction();

  const view: ReturnType<typeof render> = render(
    episodeCase.renderHeader({ onActionComplete, ...(props || {}) }),
  );

  await screen.findByRole("heading", { level: 2 });

  return { view, onActionComplete };
};

type ActionButtonsFunction = () => Array<HTMLElement>;

const actionButtons: ActionButtonsFunction = (): Array<HTMLElement> => {
  return within(screen.getByRole("group", { name: "Event actions" }))
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("aria-label") !== "More actions";
    })
    .filter((button: HTMLElement): boolean => {
      return !button.textContent?.includes("More actions");
    });
};

type FactPairsFunction = () => Array<[string, string]>;

const factPairs: FactPairsFunction = (): Array<[string, string]> => {
  return Array.from(screen.getByTestId("event-status-facts").children).map(
    (group: Element): [string, string] => {
      return [
        group.querySelector("dt")?.textContent?.trim() || "",
        group.querySelector("dd")?.textContent?.trim() || "",
      ];
    },
  );
};

type MenuChoicesFunction = () => Array<string>;

const openMoreActions: MenuChoicesFunction = (): Array<string> => {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));

  return Array.from(
    screen.getByRole("menu").querySelectorAll<HTMLElement>('[role="menuitem"]'),
  )
    .filter((element: HTMLElement): boolean => {
      return !element.querySelector('[role="menuitem"]');
    })
    .map((element: HTMLElement): string => {
      return element.textContent?.trim() || "";
    });
};

type CallsForFunction = (modelType: unknown) => number;

const listCallsFor: CallsForFunction = (modelType: unknown): number => {
  return getListMock.mock.calls.filter((call: Array<any>): boolean => {
    return call[0]?.modelType === modelType;
  }).length;
};

type LastModalPropsFunction = () => Record<string, any>;

const lastModalProps: LastModalPropsFunction = (): Record<string, any> => {
  const calls: Array<Array<any>> = modelFormModalMock.mock.calls;
  return calls[calls.length - 1]![0];
};

beforeEach((): void => {
  getItemMock.mockReset();
  getListMock.mockReset();
  modelFormModalMock.mockReset();

  const path: string = `/dashboard/${PROJECT_ID}/incidents/episodes/${EPISODE_ID}`;

  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(CASES)("$noun episode header", (episodeCase: EpisodeCase) => {
  test("holds its place with a skeleton while loading, not a page loader", () => {
    getItemMock.mockReturnValue(new Promise<never>(() => {}) as never);
    getListMock.mockReturnValue(new Promise<never>(() => {}) as never);

    const { container } = render(
      episodeCase.renderHeader({ onActionComplete: getJestMockFunction() }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading episode");
    expect(screen.getByTestId("episode-header-skeleton")).toHaveClass(
      "rounded-xl",
      "border",
    );
    expect(container.querySelector(".mt-52")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  test("loads the episode, states and timeline together", async () => {
    installFakeServer(episodeCase);

    await renderLoaded(episodeCase);

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemMock.mock.calls[0]![0].modelType).toBe(
      episodeCase.episodeModel,
    );
    expect(getItemMock.mock.calls[0]![0].id.toString()).toBe(EPISODE_ID);
    expect(listCallsFor(episodeCase.stateModel)).toBe(1);
    expect(listCallsFor(episodeCase.timelineModel)).toBe(1);

    const timelineRequest: Record<string, any> = getListMock.mock.calls.find(
      (call: Array<any>): boolean => {
        return call[0]?.modelType === episodeCase.timelineModel;
      },
    )![0];

    expect(
      timelineRequest["query"][episodeCase.episodeIdField].toString(),
    ).toBe(EPISODE_ID);
  });

  test("shows the number, title, state, severity and private pill", async () => {
    installFakeServer(episodeCase, { episode: { isPrivate: true } });

    await renderLoaded(episodeCase);

    expect(screen.getByTitle("Number")).toHaveTextContent("EP-7");
    expect(
      screen.getByRole("heading", { level: 2, name: "Checkout outage" }),
    ).toBeInTheDocument();

    const pills: Array<string> = screen
      .getAllByTestId("pill")
      .map((pill: HTMLElement): string => {
        return pill.textContent?.trim() || "";
      });

    expect(pills).toEqual(
      expect.arrayContaining(["Created", "Critical", "Private"]),
    );
  });

  test("leaves the private pill out for a visible episode", async () => {
    installFakeServer(episodeCase, { episode: { isPrivate: false } });

    await renderLoaded(episodeCase);

    expect(screen.queryByText("Private")).toBeNull();
  });

  test("shows grouping, creator and when the last member joined", async () => {
    installFakeServer(episodeCase, {
      episode: {
        withGroupingRule: true,
        withCreator: true,
        withLastMemberAddedAt: true,
      },
    });

    await renderLoaded(episodeCase);

    const pairs: Array<[string, string]> = factPairs();

    expect(pairs[0]).toEqual(["Grouping", "Checkout 5xx"]);
    expect(pairs[1]).toEqual(["Created by", "Ada Lovelace"]);
    expect(pairs[2]![0]).toBe(`Last ${episodeCase.noun} added`);
    expect(pairs[2]![1]).toBe(
      OneUptimeDate.fromNow(new Date(Date.now() - 5 * MINUTE)),
    );
    expect(
      screen.getByTestId("event-status-facts").querySelector("time"),
    ).toHaveAttribute("title");
  });

  test("falls back to a manual, system-created episode and skips the unknown", async () => {
    installFakeServer(episodeCase);

    await renderLoaded(episodeCase);

    expect(factPairs()).toEqual([
      ["Grouping", "Manual episode"],
      ["Created by", "System"],
    ]);
  });

  test("a new episode offers Acknowledge first and Resolve as the secondary action", async () => {
    installFakeServer(episodeCase, { stage: "created" });

    await renderLoaded(episodeCase);

    const buttons: Array<HTMLElement> = actionButtons();

    expect(
      buttons.map((button: HTMLElement): string => {
        return button.textContent?.trim() || "";
      }),
    ).toEqual(["Acknowledge", "Resolve"]);

    expect(buttons[0]).toHaveAttribute("id", "episode-acknowledge-btn");
    expect(buttons[0]).toHaveAttribute("type", "button");
    expect(buttons[0]).toHaveClass("bg-indigo-600", "text-white");
    expect(buttons[1]).toHaveAttribute("id", "episode-resolve-btn");
    expect(buttons[1]).toHaveClass("border-gray-300", "bg-white");

    // Only states not already on a button, and only forward ones.
    expect(openMoreActions()).toEqual(["Investigating"]);
  });

  test("an acknowledged episode promotes Resolve to the primary action", async () => {
    installFakeServer(episodeCase, { stage: "acknowledged" });

    await renderLoaded(episodeCase);

    const buttons: Array<HTMLElement> = actionButtons();

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("id", "episode-resolve-btn");
    expect(buttons[0]).toHaveTextContent("Resolve");
    expect(buttons[0]).toHaveClass("bg-indigo-600");
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });

  test("a resolved episode has nothing left to do", async () => {
    installFakeServer(episodeCase, { stage: "resolved" });

    await renderLoaded(episodeCase);

    expect(actionButtons()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  test("the current state follows the latest timeline entry over the stored column", async () => {
    installFakeServer(episodeCase, {
      stage: "investigating",
      // A stale column: the timeline already moved on.
      episode: { currentStateId: CREATED_STATE_ID },
    });

    await renderLoaded(episodeCase);

    // The state pill comes first, before severity.
    expect(screen.getAllByTestId("pill")[0]).toHaveTextContent("Investigating");
    expect(actionButtons()[0]).toHaveAttribute("id", "episode-resolve-btn");
  });

  test("without a readable timeline the stored current state is used", async () => {
    installFakeServer(episodeCase, {
      episode: { currentStateId: ACKNOWLEDGED_STATE_ID },
    });
    const defaultList: (...args: Array<unknown>) => unknown =
      getListMock.getMockImplementation() as (
        ...args: Array<unknown>
      ) => unknown;

    getListMock.mockImplementation((...args: Array<unknown>) => {
      if (
        (args[0] as Record<string, any>)["modelType"] ===
        episodeCase.timelineModel
      ) {
        return Promise.resolve(listOf([]));
      }

      return defaultList(...args);
    });

    await renderLoaded(episodeCase);

    expect(screen.getAllByTestId("pill")[0]).toHaveTextContent("Acknowledged");
  });

  test("an ongoing episode counts from its start, not its first timeline entry", async () => {
    const server: FakeServer = installFakeServer(episodeCase, {
      stage: "acknowledged",
    });

    const { view } = await renderLoaded(episodeCase);

    expect(view.container).toHaveTextContent("Ongoing for");
    // Three days and two hours ago; the first entry was ten minutes later.
    expect(view.container).toHaveTextContent("3 days, 2 hours");
    expect(server.startedAt.getTime()).toBeLessThan(Date.now() - 3 * DAY);
  });

  test("a resolved episode shows how long it took, ending at the resolve", async () => {
    installFakeServer(episodeCase, {
      stage: "resolved",
      startedAt: new Date("2026-09-14T18:00:00.000Z"),
    });

    const { view } = await renderLoaded(episodeCase);

    expect(view.container).toHaveTextContent("Lasted");
    expect(view.container).not.toHaveTextContent("Resolved in");
    // Start -> the resolve entry 125 minutes later.
    expect(view.container).toHaveTextContent("2 hours, 5 minutes");
  });

  /*
   * The overview's stat bar says "Resolved in" for the time to the FIRST
   * resolution. The header's pill runs to the CURRENT one. Under the same
   * label, a reopened episode showed "Resolved in 3 hours" in the header and
   * "Resolved in 10 minutes" right below it.
   */
  test("a reopened and resolved-again episode says how long it lasted, not a second 'Resolved in'", async () => {
    const startedAt: Date = new Date("2026-09-14T10:00:00.000Z");

    installFakeServer(episodeCase, { stage: "resolved", startedAt });

    const defaultList: (...args: Array<unknown>) => unknown =
      getListMock.getMockImplementation() as (
        ...args: Array<unknown>
      ) => unknown;

    getListMock.mockImplementation((...args: Array<unknown>) => {
      if (
        (args[0] as Record<string, any>)["modelType"] ===
        episodeCase.timelineModel
      ) {
        // Declared 10:00, resolved 10:10, reopened 11:00, resolved again 13:00.
        const entries: Array<[string, number]> = [
          [CREATED_STATE_ID, 0],
          [RESOLVED_STATE_ID, 10],
          [CREATED_STATE_ID, 60],
          [RESOLVED_STATE_ID, 180],
        ];

        return Promise.resolve(
          listOf(
            entries.map((entry: [string, number]): any => {
              const timeline: any = new episodeCase.timelineModel();
              timeline[episodeCase.stateIdField] = new ObjectID(entry[0]);
              timeline.startsAt = new Date(
                startedAt.getTime() + entry[1] * MINUTE,
              );
              return timeline;
            }),
          ),
        );
      }

      return defaultList(...args);
    });

    const { view } = await renderLoaded(episodeCase);

    expect(screen.getAllByTestId("pill")[0]).toHaveTextContent("Resolved");
    expect(view.container).toHaveTextContent("Lasted");
    // 10:00 -> the current resolution at 13:00.
    expect(view.container).toHaveTextContent("3 hours");
    expect(view.container).not.toHaveTextContent("Resolved in");
  });

  test("Acknowledge opens the acknowledge modal with the episode wording", async () => {
    installFakeServer(episodeCase);

    await renderLoaded(episodeCase);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    const modal: HTMLElement = screen.getByTestId("state-change-modal");

    expect(within(modal).getByRole("heading")).toHaveTextContent(
      "Acknowledge Episode",
    );
    expect(modal).toHaveTextContent(
      `also updates all ${episodeCase.noun}s in this episode`,
    );
    expect(
      within(modal).getByRole("button", { name: "Acknowledge" }),
    ).toBeInTheDocument();
    expect(lastModalProps()["modelType"]).toBe(episodeCase.timelineModel);
  });

  test("Resolve opens the resolve modal", async () => {
    installFakeServer(episodeCase);

    await renderLoaded(episodeCase);

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    const modal: HTMLElement = screen.getByTestId("state-change-modal");

    expect(within(modal).getByRole("heading")).toHaveTextContent(
      "Resolve Episode",
    );
    expect(
      within(modal).getByRole("button", { name: "Resolve" }),
    ).toBeInTheDocument();
  });

  test("another state from More actions opens a 'Mark as' modal", async () => {
    installFakeServer(episodeCase);

    await renderLoaded(episodeCase);

    openMoreActions();

    const choice: HTMLElement | undefined = Array.from(
      screen
        .getByRole("menu")
        .querySelectorAll<HTMLElement>('[role="menuitem"]'),
    )
      .filter((element: HTMLElement): boolean => {
        return !element.querySelector('[role="menuitem"]');
      })
      .find((element: HTMLElement): boolean => {
        return element.textContent?.trim() === "Investigating";
      });

    fireEvent.click(choice!);

    const modal: HTMLElement = screen.getByTestId("state-change-modal");

    expect(within(modal).getByRole("heading")).toHaveTextContent(
      "Mark Episode as Investigating",
    );
    expect(modal).toHaveTextContent(
      `You are about to mark this episode as Investigating. This will also update all ${episodeCase.noun}s in this episode.`,
    );
    expect(
      within(modal).getByRole("button", { name: "Mark as Investigating" }),
    ).toBeInTheDocument();
  });

  test("the modal offers the project's note templates for the private note", async () => {
    installFakeServer(episodeCase);

    await renderLoaded(episodeCase);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor((): void => {
      const fields: Array<Record<string, any>> =
        lastModalProps()["formProps"]["fields"];

      expect(fields[0]!["dropdownOptions"]).toEqual([
        { value: TEMPLATE_ID, label: "Customer update" },
      ]);
    });

    const fields: Array<Record<string, any>> =
      lastModalProps()["formProps"]["fields"];

    expect(fields[0]!["showIf"]()).toBe(true);
    expect(fields[1]!["title"]).toBe("Private Note");

    // Picking the template fills the private note.
    const setValues: MockFunction = getJestMockFunction();
    fields[0]!["onChange"](TEMPLATE_ID, { privateNote: "" }, setValues);
    expect(setValues).toHaveBeenCalledWith({ privateNote: "We are on it." });
  });

  test("closing the modal changes nothing", async () => {
    installFakeServer(episodeCase);

    const { onActionComplete } = await renderLoaded(episodeCase);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));

    expect(screen.queryByTestId("state-change-modal")).toBeNull();
    expect(onActionComplete).not.toHaveBeenCalled();
  });

  test("saving records the change on this episode, reloads and tells the page", async () => {
    const server: FakeServer = installFakeServer(episodeCase);

    const { onActionComplete } = await renderLoaded(episodeCase);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    server.setStage("acknowledged");

    const modal: HTMLElement = screen.getByTestId("state-change-modal");

    await act(async () => {
      fireEvent.click(
        within(modal).getByRole("button", { name: "Acknowledge" }),
      );
    });

    await waitFor((): void => {
      expect(onActionComplete).toHaveBeenCalledTimes(1);
    });

    const onBeforeCreate: (model: any) => Promise<any> =
      lastModalProps()["onBeforeCreate"];
    const model: any = await onBeforeCreate(new episodeCase.timelineModel());

    expect(model.projectId.toString()).toBe(PROJECT_ID);
    expect(model[episodeCase.episodeIdField].toString()).toBe(EPISODE_ID);
    expect(model[episodeCase.stateIdField].toString()).toBe(
      ACKNOWLEDGED_STATE_ID,
    );

    // The header reloaded in place: the next action is Resolve.
    await waitFor((): void => {
      expect(actionButtons()).toHaveLength(1);
    });

    expect(actionButtons()[0]).toHaveAttribute("id", "episode-resolve-btn");
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(listCallsFor(episodeCase.timelineModel)).toBe(2);
    expect(screen.queryByTestId("state-change-modal")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a failed first load shows the error with a retry", async () => {
    installFakeServer(episodeCase);
    getItemMock.mockRejectedValueOnce(new Error("Episode not reachable"));

    render(
      episodeCase.renderHeader({ onActionComplete: getJestMockFunction() }),
    );

    await waitFor((): void => {
      expect(screen.getByTestId("episode-header-error")).toHaveTextContent(
        "Episode not reachable",
      );
    });

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByRole("heading", { level: 2, name: "Checkout outage" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("episode-header-error")).toBeNull();
  });

  test("a new refreshToken reloads in place", async () => {
    installFakeServer(episodeCase, { episode: { title: "Before edit" } });

    const { view, onActionComplete } = await renderLoaded(episodeCase, {
      refreshToken: 0,
    });

    installFakeServer(episodeCase, { episode: { title: "After edit" } });

    view.rerender(
      episodeCase.renderHeader({ onActionComplete, refreshToken: 1 }),
    );

    // No skeleton flash while it reloads.
    expect(screen.queryByTestId("episode-header-skeleton")).toBeNull();

    expect(
      await screen.findByRole("heading", { level: 2, name: "After edit" }),
    ).toBeInTheDocument();
  });

  test("a failed refresh keeps the header and offers to try again", async () => {
    installFakeServer(episodeCase);

    const { view, onActionComplete } = await renderLoaded(episodeCase, {
      refreshToken: 0,
    });

    getItemMock.mockRejectedValueOnce(new Error("Gateway timeout"));

    view.rerender(
      episodeCase.renderHeader({ onActionComplete, refreshToken: 1 }),
    );

    const alert: HTMLElement = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "Couldn't refresh this episode: Gateway timeout",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Checkout outage" }),
    ).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor((): void => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
