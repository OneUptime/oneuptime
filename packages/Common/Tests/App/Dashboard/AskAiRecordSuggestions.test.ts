import PageContextUtil, {
  DashboardPageContext,
  ResolvedPageEntity,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import {
  getEntityStateSuggestions,
  getMonitorEntityState,
  getResolvableEntityState,
  getScheduledMaintenanceEntityState,
  isPageEntityState,
  PAGE_ENTITY_STATES,
  PageEntityState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageEntityState";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AIChatPageContextType from "../../../Types/AI/AIChatPageContext";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI'S QUESTIONS FOLLOW THE RECORD ON SCREEN (the follow-up #5273
 * listed: "they are still per page type; asking about the record on screen
 * needs a read each time the panel opens").
 *
 * The read that already fetched the record's title for the chip now also
 * reads where it stands, and the questions follow: a resolved incident is
 * asked how the response went and what would stop it coming back, a
 * monitor that is not operational is asked why, a maintenance event that
 * has not started what to check before it does. What could not be read is
 * no state, and the page type's own questions stay.
 */

const ENTITY_ID: string = "20000000-0000-4000-8000-000000000002";
const NOW: Date = new Date("2026-10-29T12:00:00.000Z");

function contextFor(
  type: AIChatPageContextType,
  options: { entityId?: string; entityState?: PageEntityState } = {
    entityId: ENTITY_ID,
  },
): DashboardPageContext {
  return {
    type: type,
    ...(options.entityId ? { entityId: options.entityId } : {}),
    ...(options.entityState ? { entityState: options.entityState } : {}),
    noun: "record",
    chipLabel: "This record",
    icon: IconProp.Document,
    isEntity: Boolean(options.entityId),
  };
}

function titlesOf(deck: Array<SuggestedQuestion>): Array<string> {
  return deck.map((suggestion: SuggestedQuestion): string => {
    return suggestion.title;
  });
}

function deckFor(
  type: AIChatPageContextType,
  entityState?: PageEntityState,
): Array<SuggestedQuestion> {
  return PageContextUtil.getSuggestions(
    contextFor(type, {
      entityId: ENTITY_ID,
      ...(entityState ? { entityState } : {}),
    }),
  );
}

// What the API answers, turned into the model as ModelAPI.getItem does.
function fromApi<T extends BaseModel>(
  json: JSONObject,
  modelType: { new (): T },
): T {
  return BaseModel.fromJSONObject(json, modelType) as T;
}

// One record type's read: what it selects, and what it says from the API's answer.
interface StateRead {
  type: AIChatPageContextType;
  modelType: { new (): BaseModel };
  select: JSONObject;
  titleSelect: JSONObject;
  json: JSONObject;
  title: string;
  state: PageEntityState;
}

// A state with questions of its own, and their titles in order.
interface StateDeck {
  type: AIChatPageContextType;
  state: PageEntityState;
  titles: Array<string>;
}

// What a question a state changes must not ask any more.
const ASKS_FOR_A_STATUS_UPDATE: RegExp = /so far|status update/i;
const ASKS_TO_CREATE_AN_INCIDENT: RegExp = /create an incident/i;
const ASKS_ABOUT_THE_WINDOW_SO_FAR: RegExp = /during this maintenance window/i;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("where the record stands, from what the read says", () => {
  test("an incident or an alert: resolved, open, or not read", () => {
    expect(getResolvableEntityState(true)).toBe(PageEntityState.Resolved);
    expect(getResolvableEntityState(false)).toBe(PageEntityState.Open);

    // Only a flag that was read says which.
    for (const value of [undefined, null, "true", 1, 0, {}]) {
      expect(getResolvableEntityState(value)).toBeUndefined();
    }
  });

  test("a monitor: operational, not operational, or not read", () => {
    expect(getMonitorEntityState(true)).toBe(PageEntityState.Operational);
    expect(getMonitorEntityState(false)).toBe(PageEntityState.NotOperational);

    for (const value of [undefined, null, "false", 0]) {
      expect(getMonitorEntityState(value)).toBeUndefined();
    }
  });

  test("a maintenance event: its state's flags say it first", () => {
    const window: JSONObject = {
      // A window that says the opposite of every flag below.
      startsAt: new Date("2026-10-29T13:00:00.000Z"),
      endsAt: new Date("2026-10-29T14:00:00.000Z"),
    };

    expect(
      getScheduledMaintenanceEntityState({
        ...window,
        isEndedState: true,
        now: NOW,
      }),
    ).toBe(PageEntityState.Ended);
    expect(
      getScheduledMaintenanceEntityState({
        ...window,
        isResolvedState: true,
        now: NOW,
      }),
    ).toBe(PageEntityState.Ended);
    expect(
      getScheduledMaintenanceEntityState({
        ...window,
        isOngoingState: true,
        now: NOW,
      }),
    ).toBe(PageEntityState.Ongoing);
    expect(
      getScheduledMaintenanceEntityState({
        startsAt: new Date("2026-10-29T10:00:00.000Z"),
        endsAt: new Date("2026-10-29T11:00:00.000Z"),
        isScheduledState: true,
        now: NOW,
      }),
    ).toBe(PageEntityState.Upcoming);

    // Ended outranks the others, a flag left on from before included.
    expect(
      getScheduledMaintenanceEntityState({
        isScheduledState: true,
        isOngoingState: true,
        isEndedState: true,
        now: NOW,
      }),
    ).toBe(PageEntityState.Ended);
  });

  test("a state of the project's own, with no flag: its window says it", () => {
    const at: (startsAt: unknown, endsAt: unknown) => unknown = (
      startsAt: unknown,
      endsAt: unknown,
    ): unknown => {
      return getScheduledMaintenanceEntityState({
        isScheduledState: false,
        isOngoingState: false,
        isEndedState: false,
        isResolvedState: false,
        startsAt,
        endsAt,
        now: NOW,
      });
    };

    expect(at("2026-10-29T12:00:00.001Z", "2026-10-29T13:00:00.000Z")).toBe(
      PageEntityState.Upcoming,
    );
    // From the moment it starts, until the moment it ends.
    expect(at("2026-10-29T12:00:00.000Z", "2026-10-29T13:00:00.000Z")).toBe(
      PageEntityState.Ongoing,
    );
    expect(at(new Date("2026-10-29T11:00:00.000Z"), undefined)).toBe(
      PageEntityState.Ongoing,
    );
    expect(at("2026-10-29T11:00:00.000Z", "2026-10-29T12:00:00.000Z")).toBe(
      PageEntityState.Ended,
    );
    expect(
      at(
        new Date("2026-10-29T10:00:00.000Z").getTime(),
        new Date("2026-10-29T11:00:00.000Z").getTime(),
      ),
    ).toBe(PageEntityState.Ended);

    // No start that is a time: no state.
    for (const startsAt of [undefined, null, "", "soon", Number.NaN, {}]) {
      expect(at(startsAt, "2026-10-29T13:00:00.000Z")).toBeUndefined();
    }

    // An end that is no time is no end.
    expect(at("2026-10-29T11:00:00.000Z", "later")).toBe(
      PageEntityState.Ongoing,
    );
  });

  test("names only its own states", () => {
    expect(PAGE_ENTITY_STATES).toEqual([
      "Open",
      "Resolved",
      "Operational",
      "NotOperational",
      "Upcoming",
      "Ongoing",
      "Ended",
    ]);
    expect(isPageEntityState("Resolved")).toBe(true);
    expect(isPageEntityState("resolved")).toBe(false);
    expect(isPageEntityState(undefined)).toBe(false);
  });
});

describe("one read, each time Ask AI opens: the title and where it stands", () => {
  const STATE_READS: Array<StateRead> = [
    {
      type: AIChatPageContextType.Incident,
      modelType: Incident,
      select: {
        title: true,
        incidentNumber: true,
        currentIncidentState: { isResolvedState: true },
      },
      titleSelect: { title: true, incidentNumber: true },
      json: {
        title: "Checkout unavailable",
        incidentNumber: 42,
        currentIncidentState: { isResolvedState: true },
      },
      title: "#42 Checkout unavailable",
      state: PageEntityState.Resolved,
    },
    {
      type: AIChatPageContextType.Alert,
      modelType: Alert,
      select: {
        title: true,
        alertNumber: true,
        currentAlertState: { isResolvedState: true },
      },
      titleSelect: { title: true, alertNumber: true },
      json: {
        title: "Elevated errors",
        alertNumber: 7,
        currentAlertState: { isResolvedState: false },
      },
      title: "#7 Elevated errors",
      state: PageEntityState.Open,
    },
    {
      type: AIChatPageContextType.Monitor,
      modelType: Monitor,
      select: {
        name: true,
        currentMonitorStatus: { isOperationalState: true },
      },
      titleSelect: { name: true },
      json: {
        name: "Checkout API",
        currentMonitorStatus: { isOperationalState: false },
      },
      title: "Checkout API",
      state: PageEntityState.NotOperational,
    },
    {
      type: AIChatPageContextType.ScheduledMaintenanceEvent,
      modelType: ScheduledMaintenance,
      select: {
        title: true,
        startsAt: true,
        endsAt: true,
        currentScheduledMaintenanceState: {
          isScheduledState: true,
          isOngoingState: true,
          isEndedState: true,
          isResolvedState: true,
        },
      },
      titleSelect: { title: true },
      json: {
        title: "Database upgrade",
        startsAt: { _type: "DateTime", value: "2026-10-30T02:00:00.000Z" },
        endsAt: { _type: "DateTime", value: "2026-10-30T04:00:00.000Z" },
        currentScheduledMaintenanceState: {
          isScheduledState: true,
          isOngoingState: false,
          isEndedState: false,
          isResolvedState: false,
        },
      },
      title: "Database upgrade",
      state: PageEntityState.Upcoming,
    },
  ];

  test.each(STATE_READS)(
    "$type: its title and its state in one read",
    async ({ type, modelType, select, json, title, state }: StateRead) => {
      const getItem: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(fromApi(json, modelType));

      expect(
        await PageContextUtil.resolveEntity(contextFor(type), NOW),
      ).toEqual({ title, state });
      expect(getItem).toHaveBeenCalledTimes(1);
      expect(getItem).toHaveBeenCalledWith({
        modelType: modelType,
        id: new ObjectID(ENTITY_ID),
        select: select,
      });
    },
  );

  test.each(STATE_READS)(
    "$type: a state the person may not read leaves its title, read again without it",
    async ({ type, modelType, titleSelect, json, title }: StateRead) => {
      const titleOnly: JSONObject = { ...json };
      for (const key of [
        "currentIncidentState",
        "currentAlertState",
        "currentMonitorStatus",
        "currentScheduledMaintenanceState",
        "startsAt",
        "endsAt",
      ]) {
        delete titleOnly[key];
      }

      const getItem: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getItem")
        .mockRejectedValueOnce(new Error("You do not have permission"))
        .mockResolvedValueOnce(fromApi(titleOnly, modelType));

      expect(
        await PageContextUtil.resolveEntity(contextFor(type), NOW),
      ).toEqual({ title, state: undefined });
      expect(getItem).toHaveBeenCalledTimes(2);
      expect(getItem).toHaveBeenLastCalledWith({
        modelType: modelType,
        id: new ObjectID(ENTITY_ID),
        select: titleSelect,
      });

      // And the chip's title is as it was before the state was read.
      jest
        .spyOn(ModelAPI, "getItem")
        .mockRejectedValueOnce(new Error("You do not have permission"))
        .mockResolvedValueOnce(fromApi(titleOnly, modelType));
      expect(await PageContextUtil.resolveEntityTitle(contextFor(type))).toBe(
        title,
      );
    },
  );

  test.each(STATE_READS)(
    "$type: no read at all, or no record, says nothing",
    async ({ type }: StateRead) => {
      jest
        .spyOn(ModelAPI, "getItem")
        .mockRejectedValue(new Error("Read access denied"));
      expect(
        await PageContextUtil.resolveEntity(contextFor(type), NOW),
      ).toBeNull();

      jest.restoreAllMocks();
      const getItem: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(null);
      expect(
        await PageContextUtil.resolveEntity(contextFor(type), NOW),
      ).toBeNull();
      // A record that is gone is not read again without its state.
      expect(getItem).toHaveBeenCalledTimes(1);
    },
  );

  test("a resolved flag that came back false is an open record, not an unread one", async () => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(
      fromApi(
        {
          title: "Checkout unavailable",
          incidentNumber: 42,
          currentIncidentState: { isResolvedState: false },
        },
        Incident,
      ),
    );

    expect(
      await PageContextUtil.resolveEntity(
        contextFor(AIChatPageContextType.Incident),
      ),
    ).toEqual({
      title: "#42 Checkout unavailable",
      state: PageEntityState.Open,
    });
  });

  test("a state read without its flag is no state", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(
        fromApi(
          { name: "Checkout API", currentMonitorStatus: { name: "Degraded" } },
          Monitor,
        ),
      );

    expect(
      await PageContextUtil.resolveEntity(
        contextFor(AIChatPageContextType.Monitor),
      ),
    ).toEqual({ title: "Checkout API", state: undefined });
  });

  test("a maintenance event's window is read against the time Ask AI opened", async () => {
    const json: JSONObject = {
      title: "Database upgrade",
      startsAt: { _type: "DateTime", value: "2026-10-29T11:00:00.000Z" },
      endsAt: { _type: "DateTime", value: "2026-10-29T13:00:00.000Z" },
      // A state of the project's own: no flag says where it is.
      currentScheduledMaintenanceState: {
        isScheduledState: false,
        isOngoingState: false,
        isEndedState: false,
        isResolvedState: false,
      },
    };

    for (const [now, state] of [
      [new Date("2026-10-29T10:00:00.000Z"), PageEntityState.Upcoming],
      [NOW, PageEntityState.Ongoing],
      [new Date("2026-10-29T13:30:00.000Z"), PageEntityState.Ended],
    ] as Array<[Date, PageEntityState]>) {
      jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(fromApi(json, ScheduledMaintenance));
      expect(
        (await PageContextUtil.resolveEntity(
          contextFor(AIChatPageContextType.ScheduledMaintenanceEvent),
          now,
        ))!.state,
      ).toBe(state);
    }
  });

  test.each<
    [
      AIChatPageContextType,
      { new (): BaseModel },
      JSONObject,
      JSONObject,
      string,
    ]
  >([
    [
      AIChatPageContextType.TelemetryService,
      Service,
      { name: true },
      { name: "Checkout service" },
      "Checkout service",
    ],
    [
      AIChatPageContextType.RumApplication,
      RumApplication,
      { name: true },
      { name: "Checkout browser" },
      "Checkout browser",
    ],
    [
      AIChatPageContextType.Exception,
      TelemetryException,
      { message: true, exceptionType: true },
      { message: "Request failed", exceptionType: "TypeError" },
      "Request failed",
    ],
    [
      AIChatPageContextType.SecurityCase,
      SecurityCase,
      { title: true, caseNumberWithPrefix: true },
      { title: "Impossible travel", caseNumberWithPrefix: "SEC-9" },
      "SEC-9 Impossible travel",
    ],
  ])(
    "%s: its title only, read as before",
    async (
      type: AIChatPageContextType,
      modelType: { new (): BaseModel },
      select: JSONObject,
      json: JSONObject,
      title: string,
    ) => {
      const getItem: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(fromApi(json, modelType));

      const entity: ResolvedPageEntity | null =
        await PageContextUtil.resolveEntity(contextFor(type));

      expect(entity).toEqual({ title });
      expect(getItem).toHaveBeenCalledTimes(1);
      expect(getItem).toHaveBeenCalledWith({
        modelType: modelType,
        id: new ObjectID(ENTITY_ID),
        select: select,
      });
    },
  );

  test.each([
    contextFor(AIChatPageContextType.IncidentsList, {}),
    contextFor(AIChatPageContextType.Incident, {}),
    contextFor(AIChatPageContextType.Incident, { entityId: "settings" }),
  ])(
    "nothing is read for a page that is no record: %p",
    async (context: DashboardPageContext) => {
      const getItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ModelAPI,
        "getItem",
      );

      expect(await PageContextUtil.resolveEntity(context)).toBeNull();
      expect(getItem).not.toHaveBeenCalled();
    },
  );

  test("where the record stands stays in the browser", () => {
    expect(
      PageContextUtil.toRequestPayload({
        ...contextFor(AIChatPageContextType.Incident, {
          entityId: ENTITY_ID,
          entityState: PageEntityState.Resolved,
        }),
        entityTitle: "#42 Checkout unavailable",
      }),
    ).toEqual({
      type: AIChatPageContextType.Incident,
      entityId: ENTITY_ID,
      entityTitle: "#42 Checkout unavailable",
    });
  });
});

describe("the questions follow the record", () => {
  const STATE_DECKS: Array<StateDeck> = [
    {
      type: AIChatPageContextType.Incident,
      state: PageEntityState.Resolved,
      titles: [
        "Summarize",
        "Find root cause",
        "Response timeline",
        "Prevent a repeat",
      ],
    },
    {
      type: AIChatPageContextType.Alert,
      state: PageEntityState.Resolved,
      titles: ["Summarize", "Investigate", "Was it real?", "Fired before?"],
    },
    {
      type: AIChatPageContextType.Monitor,
      state: PageEntityState.NotOperational,
      titles: [
        "Status summary",
        "Why not operational?",
        "Is it flapping?",
        "Related incidents",
      ],
    },
    {
      type: AIChatPageContextType.ScheduledMaintenanceEvent,
      state: PageEntityState.Upcoming,
      titles: [
        "Summarize",
        "Healthy before it starts?",
        "Draft a notice",
        "Overlapping maintenance?",
      ],
    },
    {
      type: AIChatPageContextType.ScheduledMaintenanceEvent,
      state: PageEntityState.Ended,
      titles: [
        "Summarize",
        "Impact during window",
        "Monitor status",
        "Back to normal?",
      ],
    },
  ];

  test.each(STATE_DECKS)(
    "$type, $state: $titles",
    ({ type, state, titles }: StateDeck) => {
      expect(titlesOf(deckFor(type, state))).toEqual(titles);
    },
  );

  test.each(STATE_DECKS)(
    "$type, $state: changes a card where it stands, and keeps the first",
    ({ type, state }: StateDeck) => {
      const own: Array<SuggestedQuestion> = deckFor(type);
      const deck: Array<SuggestedQuestion> = deckFor(type, state);

      expect(deck).toHaveLength(own.length);
      expect(deck[0]!.title).toBe(own[0]!.title);

      // Each card is the page type's card in that place, or a new one.
      deck.forEach((suggestion: SuggestedQuestion, index: number): void => {
        const isInItsPlace: boolean = suggestion.title === own[index]!.title;
        const isNew: boolean = !titlesOf(own).includes(suggestion.title);

        expect([suggestion.title, isInItsPlace || isNew]).toEqual([
          suggestion.title,
          true,
        ]);
      });

      // And it is not the page type's deck.
      expect(deck).not.toEqual(own);
    },
  );

  test("the questions a state changes say where the record stands", () => {
    const question: (
      type: AIChatPageContextType,
      state: PageEntityState,
      title: string,
    ) => string = (
      type: AIChatPageContextType,
      state: PageEntityState,
      title: string,
    ): string => {
      return deckFor(type, state).find((suggestion: SuggestedQuestion) => {
        return suggestion.title === title;
      })!.question;
    };

    expect(
      question(
        AIChatPageContextType.Incident,
        PageEntityState.Resolved,
        "Summarize",
      ),
    ).toBe(
      "Summarize this incident: what happened, how long it lasted, and how it was resolved.",
    );
    expect(
      question(
        AIChatPageContextType.Alert,
        PageEntityState.Resolved,
        "Summarize",
      ),
    ).toBe(
      "Summarize this alert: why it fired, how long it lasted, and how it was resolved.",
    );
    expect(
      question(
        AIChatPageContextType.Monitor,
        PageEntityState.NotOperational,
        "Why not operational?",
      ),
    ).toBe(
      "Why is this monitor not operational right now? Investigate the telemetry from around when its status changed.",
    );
    expect(
      question(
        AIChatPageContextType.ScheduledMaintenanceEvent,
        PageEntityState.Upcoming,
        "Healthy before it starts?",
      ),
    ).toBe(
      "Are the monitors this maintenance covers operational right now, before it starts? Flag any that are not.",
    );

    // A resolved incident is not asked for a status update "so far".
    expect(
      deckFor(AIChatPageContextType.Incident, PageEntityState.Resolved).some(
        (suggestion: SuggestedQuestion): boolean => {
          return ASKS_FOR_A_STATUS_UPDATE.test(suggestion.question);
        },
      ),
    ).toBe(false);
    // A resolved alert is not asked to become an incident.
    expect(
      deckFor(AIChatPageContextType.Alert, PageEntityState.Resolved).some(
        (suggestion: SuggestedQuestion): boolean => {
          return ASKS_TO_CREATE_AN_INCIDENT.test(suggestion.question);
        },
      ),
    ).toBe(false);
    // A maintenance event that has not started is not asked what it changed.
    expect(
      deckFor(
        AIChatPageContextType.ScheduledMaintenanceEvent,
        PageEntityState.Upcoming,
      ).some((suggestion: SuggestedQuestion): boolean => {
        return ASKS_ABOUT_THE_WINDOW_SO_FAR.test(suggestion.question);
      }),
    ).toBe(false);
  });

  test("a state the page type's own questions fit keeps them", () => {
    for (const [type, state] of [
      [AIChatPageContextType.Incident, PageEntityState.Open],
      [AIChatPageContextType.Alert, PageEntityState.Open],
      [AIChatPageContextType.Monitor, PageEntityState.Operational],
      [
        AIChatPageContextType.ScheduledMaintenanceEvent,
        PageEntityState.Ongoing,
      ],
    ] as Array<[AIChatPageContextType, PageEntityState]>) {
      expect(deckFor(type, state)).toEqual(deckFor(type));
      expect(getEntityStateSuggestions(type, state)).toBeNull();
    }
  });

  test("no state, or another type's state, is the page type's own questions", () => {
    for (const type of Object.values(AIChatPageContextType)) {
      expect(getEntityStateSuggestions(type, undefined)).toBeNull();
    }

    expect(
      deckFor(AIChatPageContextType.Monitor, PageEntityState.Resolved),
    ).toEqual(deckFor(AIChatPageContextType.Monitor));
    expect(
      deckFor(AIChatPageContextType.Incident, PageEntityState.Upcoming),
    ).toEqual(deckFor(AIChatPageContextType.Incident));
    expect(
      deckFor(AIChatPageContextType.TelemetryService, PageEntityState.Resolved),
    ).toEqual(deckFor(AIChatPageContextType.TelemetryService));
  });

  test("a state on a page that is no record is not looked at", () => {
    expect(
      PageContextUtil.getSuggestions({
        ...contextFor(AIChatPageContextType.Incident, {}),
        entityState: PageEntityState.Resolved,
      }),
    ).toEqual(
      PageContextUtil.getSuggestions(
        contextFor(AIChatPageContextType.Incident, {}),
      ),
    );
  });

  test("every state's question is drawn in the reader's language", () => {
    const localesDir: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales",
    );
    const locales: Array<string> = fs
      .readdirSync(localesDir)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      });

    expect(locales).toHaveLength(16);

    const readLocale: (file: string) => JSONObject = (
      file: string,
    ): JSONObject => {
      return JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      ) as JSONObject;
    };
    const english: JSONObject = readLocale("en.json");
    const texts: Array<string> = [];

    for (const { type, state } of STATE_DECKS) {
      for (const suggestion of deckFor(type, state)) {
        texts.push(suggestion.title, suggestion.question);
      }
    }

    for (const text of texts) {
      expect(english[text]).toBe(text);
    }

    for (const locale of locales) {
      const translations: JSONObject = readLocale(locale);

      for (const text of texts) {
        const translated: unknown = translations[text];

        expect([locale, text, typeof translated]).toEqual([
          locale,
          text,
          "string",
        ]);
        expect((translated as string).trim().length).toBeGreaterThan(0);
      }
    }
  });
});
