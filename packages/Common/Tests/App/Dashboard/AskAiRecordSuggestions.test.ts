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
import AlertStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/AlertState";
import IncidentStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState";
import ScheduledMaintenanceStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AIChatPageContextType from "../../../Types/AI/AIChatPageContext";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { ScheduledMaintenancePhaseOfState } from "../../../Utils/ScheduledMaintenanceStart";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
 * has not started what to check before it does. Whether an incident or an
 * alert is resolved, and where a maintenance event is in its life, are
 * asked of the one rule every part of OneUptime asks (ResolvedStateUtil,
 * ScheduledMaintenanceStartUtil), over the project's states. What could
 * not be read is no state, and the page type's own questions stay.
 */

const ENTITY_ID: string = "20000000-0000-4000-8000-000000000002";
const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

// A project's incident and alert states: one of its own after Resolved.
const OPEN_STATE_ID: string = "30000000-0000-4000-8000-000000000001";
const ACKNOWLEDGED_STATE_ID: string = "30000000-0000-4000-8000-000000000002";
const RESOLVED_STATE_ID: string = "30000000-0000-4000-8000-000000000003";
const CLOSED_STATE_ID: string = "30000000-0000-4000-8000-000000000004";

// A project's maintenance states: "Confirmed" and "Verifying" of its own.
const SCHEDULED_STATE_ID: string = "40000000-0000-4000-8000-000000000001";
const CONFIRMED_STATE_ID: string = "40000000-0000-4000-8000-000000000002";
const ONGOING_STATE_ID: string = "40000000-0000-4000-8000-000000000003";
const VERIFYING_STATE_ID: string = "40000000-0000-4000-8000-000000000004";
const ENDED_STATE_ID: string = "40000000-0000-4000-8000-000000000005";
const COMPLETED_STATE_ID: string = "40000000-0000-4000-8000-000000000006";

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

// States as the Dashboard's cached lists hold them: top first, with places.
function resolvableStateRows(): Array<JSONObject> {
  return [
    { _id: OPEN_STATE_ID, order: 1, isCreatedState: true },
    { _id: ACKNOWLEDGED_STATE_ID, order: 2, isAcknowledgedState: true },
    { _id: RESOLVED_STATE_ID, order: 3, isResolvedState: true },
    { _id: CLOSED_STATE_ID, order: 4 },
  ];
}

function incidentStates(): Array<IncidentState> {
  return resolvableStateRows().map((json: JSONObject): IncidentState => {
    return fromApi(json, IncidentState);
  });
}

function alertStates(): Array<AlertState> {
  return resolvableStateRows().map((json: JSONObject): AlertState => {
    return fromApi(json, AlertState);
  });
}

function maintenanceStates(): Array<ScheduledMaintenanceState> {
  return [
    { _id: SCHEDULED_STATE_ID, order: 1, isScheduledState: true },
    { _id: CONFIRMED_STATE_ID, order: 2 },
    { _id: ONGOING_STATE_ID, order: 3, isOngoingState: true },
    { _id: VERIFYING_STATE_ID, order: 4 },
    { _id: ENDED_STATE_ID, order: 5, isEndedState: true },
    { _id: COMPLETED_STATE_ID, order: 6, isResolvedState: true },
  ].map((json: JSONObject): ScheduledMaintenanceState => {
    return fromApi(json, ScheduledMaintenanceState);
  });
}

// One record type's read: what it selects, and what it says from the API's answer.
interface StateRead {
  type: AIChatPageContextType;
  modelType: { new (): BaseModel };
  select: JSONObject;
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

let incidentStatesRead: ReturnType<typeof jest.spyOn>;
let alertStatesRead: ReturnType<typeof jest.spyOn>;
let maintenanceStatesRead: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  incidentStatesRead = jest
    .spyOn(IncidentStateUtil, "getIncidentStates")
    .mockResolvedValue(incidentStates());
  alertStatesRead = jest
    .spyOn(AlertStateUtil, "getAlertStates")
    .mockResolvedValue(alertStates());
  maintenanceStatesRead = jest
    .spyOn(ScheduledMaintenanceStateUtil, "getScheduledMaintenanceStates")
    .mockResolvedValue(maintenanceStates());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("where the record stands, from what the one rule says", () => {
  test("an incident or an alert: resolved, open, or not known", () => {
    expect(getResolvableEntityState(true)).toBe(PageEntityState.Resolved);
    expect(getResolvableEntityState(false)).toBe(PageEntityState.Open);
    expect(getResolvableEntityState(null)).toBeUndefined();
    expect(getResolvableEntityState(undefined)).toBeUndefined();
  });

  test("a monitor: operational, not operational, or not read", () => {
    expect(getMonitorEntityState(true)).toBe(PageEntityState.Operational);
    expect(getMonitorEntityState(false)).toBe(PageEntityState.NotOperational);

    for (const value of [undefined, null, "false", 0]) {
      expect(getMonitorEntityState(value)).toBeUndefined();
    }
  });

  test("a maintenance event: not started, in progress or over", () => {
    expect(
      getScheduledMaintenanceEntityState(
        ScheduledMaintenancePhaseOfState.NotStarted,
      ),
    ).toBe(PageEntityState.Upcoming);
    expect(
      getScheduledMaintenanceEntityState(
        ScheduledMaintenancePhaseOfState.InProgress,
      ),
    ).toBe(PageEntityState.Ongoing);
    expect(
      getScheduledMaintenanceEntityState(ScheduledMaintenancePhaseOfState.Over),
    ).toBe(PageEntityState.Ended);
    expect(getScheduledMaintenanceEntityState(null)).toBeUndefined();
    expect(getScheduledMaintenanceEntityState(undefined)).toBeUndefined();
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
      // Its number with the prefix it was given too (Utils/Project/RecordNumber).
      select: {
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        currentIncidentStateId: true,
      },
      json: {
        title: "Checkout unavailable",
        incidentNumber: 42,
        currentIncidentStateId: RESOLVED_STATE_ID,
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
        alertNumberWithPrefix: true,
        currentAlertStateId: true,
      },
      json: {
        title: "Elevated errors",
        alertNumber: 7,
        currentAlertStateId: ACKNOWLEDGED_STATE_ID,
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
        scheduledMaintenanceNumber: true,
        scheduledMaintenanceNumberWithPrefix: true,
        currentScheduledMaintenanceStateId: true,
      },
      json: {
        title: "Database upgrade",
        currentScheduledMaintenanceStateId: CONFIRMED_STATE_ID,
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

      expect(await PageContextUtil.resolveEntity(contextFor(type))).toEqual({
        title,
        state,
      });
      expect(getItem).toHaveBeenCalledTimes(1);
      expect(getItem).toHaveBeenCalledWith({
        modelType: modelType,
        id: new ObjectID(ENTITY_ID),
        select: select,
      });
    },
  );

  test("an incident or an alert is resolved by its state's place: a state of the project's own after Resolved is resolved too", async () => {
    for (const [stateId, state] of [
      [OPEN_STATE_ID, PageEntityState.Open],
      [ACKNOWLEDGED_STATE_ID, PageEntityState.Open],
      [RESOLVED_STATE_ID, PageEntityState.Resolved],
      // "Closed", placed after Resolved and flagged nothing.
      [CLOSED_STATE_ID, PageEntityState.Resolved],
    ] as Array<[string, PageEntityState]>) {
      jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValueOnce(
          fromApi(
            { title: "Checkout unavailable", currentIncidentStateId: stateId },
            Incident,
          ),
        );
      expect(
        (await PageContextUtil.resolveEntity(
          contextFor(AIChatPageContextType.Incident),
        ))!.state,
      ).toBe(state);

      jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValueOnce(
          fromApi(
            { title: "Elevated errors", currentAlertStateId: stateId },
            Alert,
          ),
        );
      expect(
        (await PageContextUtil.resolveEntity(
          contextFor(AIChatPageContextType.Alert),
        ))!.state,
      ).toBe(state);
    }

    // Each list is the project's, read through the Dashboard's cached list.
    expect(incidentStatesRead).toHaveBeenCalledWith(PROJECT_ID);
    expect(alertStatesRead).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a maintenance event is placed by its state, the project's own states included", async () => {
    for (const [stateId, state] of [
      [SCHEDULED_STATE_ID, PageEntityState.Upcoming],
      [CONFIRMED_STATE_ID, PageEntityState.Upcoming],
      [ONGOING_STATE_ID, PageEntityState.Ongoing],
      [VERIFYING_STATE_ID, PageEntityState.Ongoing],
      [ENDED_STATE_ID, PageEntityState.Ended],
      [COMPLETED_STATE_ID, PageEntityState.Ended],
    ] as Array<[string, PageEntityState]>) {
      jest.spyOn(ModelAPI, "getItem").mockResolvedValueOnce(
        fromApi(
          {
            title: "Database upgrade",
            currentScheduledMaintenanceStateId: stateId,
          },
          ScheduledMaintenance,
        ),
      );

      expect(
        (await PageContextUtil.resolveEntity(
          contextFor(AIChatPageContextType.ScheduledMaintenanceEvent),
        ))!.state,
      ).toBe(state);
    }

    expect(maintenanceStatesRead).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("states that could not be read, or a state that is none of them: the title, and no state", async () => {
    for (const [statesRead, type, json, modelType] of [
      [
        incidentStatesRead,
        AIChatPageContextType.Incident,
        {
          title: "Checkout unavailable",
          currentIncidentStateId: RESOLVED_STATE_ID,
        },
        Incident,
      ],
      [
        alertStatesRead,
        AIChatPageContextType.Alert,
        { title: "Elevated errors", currentAlertStateId: RESOLVED_STATE_ID },
        Alert,
      ],
      [
        maintenanceStatesRead,
        AIChatPageContextType.ScheduledMaintenanceEvent,
        {
          title: "Database upgrade",
          currentScheduledMaintenanceStateId: ONGOING_STATE_ID,
        },
        ScheduledMaintenance,
      ],
    ] as Array<
      [
        ReturnType<typeof jest.spyOn>,
        AIChatPageContextType,
        JSONObject,
        { new (): BaseModel },
      ]
    >) {
      // Refused.
      statesRead.mockRejectedValueOnce(new Error("Read access denied"));
      jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValueOnce(fromApi(json, modelType));
      expect(
        (await PageContextUtil.resolveEntity(contextFor(type)))!.state,
      ).toBeUndefined();

      // None there.
      statesRead.mockResolvedValueOnce([]);
      jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValueOnce(fromApi(json, modelType));
      expect(
        (await PageContextUtil.resolveEntity(contextFor(type)))!.state,
      ).toBeUndefined();
    }

    // A maintenance event in a state that is none of the project's.
    jest.spyOn(ModelAPI, "getItem").mockResolvedValueOnce(
      fromApi(
        {
          title: "Database upgrade",
          currentScheduledMaintenanceStateId: ObjectID.generate().toString(),
        },
        ScheduledMaintenance,
      ),
    );
    expect(
      await PageContextUtil.resolveEntity(
        contextFor(AIChatPageContextType.ScheduledMaintenanceEvent),
      ),
    ).toEqual({ title: "Database upgrade", state: undefined });
  });

  test("no project open, or a record with no state: no state is read or said", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    jest.spyOn(ModelAPI, "getItem").mockResolvedValueOnce(
      fromApi(
        {
          title: "Checkout unavailable",
          currentIncidentStateId: RESOLVED_STATE_ID,
        },
        Incident,
      ),
    );

    expect(
      await PageContextUtil.resolveEntity(
        contextFor(AIChatPageContextType.Incident),
      ),
    ).toEqual({ title: "Checkout unavailable", state: undefined });
    expect(incidentStatesRead).not.toHaveBeenCalled();

    jest.restoreAllMocks();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest
      .spyOn(IncidentStateUtil, "getIncidentStates")
      .mockResolvedValue(incidentStates());
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValueOnce(
        fromApi({ title: "Checkout unavailable" }, Incident),
      );

    expect(
      await PageContextUtil.resolveEntity(
        contextFor(AIChatPageContextType.Incident),
      ),
    ).toEqual({ title: "Checkout unavailable", state: undefined });
  });

  test("a monitor's status the person may not read leaves its title, read again without it", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValueOnce(new Error("You do not have permission"))
      .mockResolvedValueOnce(fromApi({ name: "Checkout API" }, Monitor));

    expect(
      await PageContextUtil.resolveEntity(
        contextFor(AIChatPageContextType.Monitor),
      ),
    ).toEqual({ title: "Checkout API", state: undefined });
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(getItem).toHaveBeenLastCalledWith({
      modelType: Monitor,
      id: new ObjectID(ENTITY_ID),
      select: { name: true },
    });

    // And the chip's title is as it was before the status was read.
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValueOnce(new Error("You do not have permission"))
      .mockResolvedValueOnce(fromApi({ name: "Checkout API" }, Monitor));
    expect(
      await PageContextUtil.resolveEntityTitle(
        contextFor(AIChatPageContextType.Monitor),
      ),
    ).toBe("Checkout API");
  });

  test("a monitor's status read without its flag is no state", async () => {
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

  test.each(STATE_READS)(
    "$type: no read at all, or no record, says nothing",
    async ({ type }: StateRead) => {
      jest
        .spyOn(ModelAPI, "getItem")
        .mockRejectedValue(new Error("Read access denied"));
      expect(await PageContextUtil.resolveEntity(contextFor(type))).toBeNull();

      jest.restoreAllMocks();
      const getItem: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(null);
      expect(await PageContextUtil.resolveEntity(contextFor(type))).toBeNull();
      // A record that is gone is not read again.
      expect(getItem).toHaveBeenCalledTimes(1);
    },
  );

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
      expect(incidentStatesRead).not.toHaveBeenCalled();
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
