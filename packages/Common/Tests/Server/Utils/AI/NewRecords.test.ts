import {
  asksForStart,
  describeLinkingCard,
  describeNewRecordCard,
  describeNewRecordForPerson,
  describeSeverityNotFound,
  describeStartForModel,
  describeStartForPerson,
  describeStartOnCard,
  getDescribedNewRecordArguments,
  getInitialStateArgumentSchema,
  getInvalidStartMessage,
  INITIAL_STATE_ARGUMENT_NAME,
  NEW_RECORD_STARTS,
  NewRecordStart,
  pickNamedSeverity,
  pickStartState,
  readRequestedStart,
  withStartWrittenOut,
} from "../../../../Server/Utils/AI/Toolbox/NewRecords";
import type { LinkedAffectedResource } from "../../../../Server/Utils/AI/Toolbox/AffectedResourceLinks";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_LINES,
  AIActionCardWords,
  aiActionCardFact,
  aiActionList,
  aiActionResourceByName,
  aiActionSentence,
  aiActionTerm,
  describeAIActionCardWords,
  isKnownAIActionCardWords,
} from "../../../../Types/AI/AIActionWords";
import { AiAffectedResourceKind } from "../../../../Types/AI/AiAffectedResources";
import { JSONObject } from "../../../../Types/JSON";
import { StateListType } from "../../../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";
import { actionLineText } from "../../../Helpers/AIActionText";

/*
 * WHAT A RECORD ASK AI CREATES TAKES: ITS SEVERITY, AND WHERE IT STARTS
 * (#5315's follow-ups).
 *
 * create_incident and create_alert share these rules (NewRecords):
 *
 *   - the severity is the one the call names, matched without regard to
 *     case or spaces, else the project's first - and the approval card
 *     says it in words, as create_alert's did and create_incident's now
 *     does;
 *   - a record written up after the fact starts acknowledged or resolved -
 *     the two starts by what they mean, never a state's name - which pages
 *     nobody, and the approval card says so before anyone allows it;
 *   - a value that is neither is never quietly a new, paging record: the
 *     call asks for a start, so it takes the state permission, and running
 *     it refuses with what to pass;
 *   - the card it leaves says the severity and the start, then what it is
 *     linked to and the start of its description, in the reader's words.
 */

const HOST: LinkedAffectedResource = {
  kind: AiAffectedResourceKind.Host,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "test01",
};

const CLUSTER: LinkedAffectedResource = {
  kind: AiAffectedResourceKind.KubernetesCluster,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "prod",
};

// A project's states, as the state services read them: created, acknowledged, resolved.
interface StateRow {
  _id: string;
  name: string;
  order: number;
  isCreatedState: boolean;
  isAcknowledgedState: boolean;
  isResolvedState: boolean;
}

const STATES: Array<StateRow> = [
  {
    _id: "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1",
    name: "Identified",
    order: 1,
    isCreatedState: true,
    isAcknowledgedState: false,
    isResolvedState: false,
  },
  {
    _id: "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2",
    name: "Investigating",
    order: 2,
    isCreatedState: false,
    isAcknowledgedState: true,
    isResolvedState: false,
  },
  {
    _id: "a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3",
    name: "Closed",
    order: 3,
    isCreatedState: false,
    isAcknowledgedState: false,
    isResolvedState: true,
  },
];

describe("the start a call asks for", () => {
  test("nothing, an empty value or null: where every new record starts", () => {
    for (const args of [
      {},
      { [INITIAL_STATE_ARGUMENT_NAME]: "" },
      { [INITIAL_STATE_ARGUMENT_NAME]: "   " },
      { [INITIAL_STATE_ARGUMENT_NAME]: null },
    ] as Array<JSONObject>) {
      expect(readRequestedStart(args)).toEqual({
        start: null,
        isInvalid: false,
      });
      expect(asksForStart(args)).toBe(false);
    }
  });

  test("acknowledged and resolved, whatever their case and the spaces around them", () => {
    expect(
      readRequestedStart({ [INITIAL_STATE_ARGUMENT_NAME]: "acknowledged" }),
    ).toEqual({ start: NewRecordStart.Acknowledged, isInvalid: false });
    expect(
      readRequestedStart({ [INITIAL_STATE_ARGUMENT_NAME]: " Resolved " }),
    ).toEqual({ start: NewRecordStart.Resolved, isInvalid: false });
    expect(
      readRequestedStart({ [INITIAL_STATE_ARGUMENT_NAME]: "ACKNOWLEDGED" }),
    ).toEqual({ start: NewRecordStart.Acknowledged, isInvalid: false });
  });

  test("anything else is neither - never quietly a new record that pages", () => {
    for (const value of [
      "investigating",
      "Identified",
      "closed",
      42,
      true,
      ["resolved"],
      { state: "resolved" },
    ]) {
      const args: JSONObject = {
        [INITIAL_STATE_ARGUMENT_NAME]: value,
      } as JSONObject;

      expect(readRequestedStart(args)).toEqual({
        start: null,
        isInvalid: true,
      });
      // It still asks for a start, so it takes the state permission too.
      expect(asksForStart(args)).toBe(true);
    }
  });

  test("the only two starts are acknowledged and resolved, as the schema offers them", () => {
    expect([...NEW_RECORD_STARTS].sort()).toEqual(["acknowledged", "resolved"]);

    const schema: JSONObject = getInitialStateArgumentSchema("incident");
    expect(schema["type"]).toBe("string");
    expect(schema["enum"]).toEqual(["acknowledged", "resolved"]);
    // It tells the model when to use it, and when never to.
    expect(String(schema["description"])).toContain(
      "Leave it out for a new incident",
    );
    expect(String(schema["description"])).toContain("pages nobody");
    expect(String(schema["description"])).toContain(
      "Never use it to keep people from being paged about a live problem",
    );
  });

  test("the arguments the person approves write the start the one way", () => {
    expect(
      withStartWrittenOut({
        title: "Checkout down",
        [INITIAL_STATE_ARGUMENT_NAME]: " Resolved",
      }),
    ).toEqual({
      title: "Checkout down",
      [INITIAL_STATE_ARGUMENT_NAME]: "resolved",
    });

    // No start, or one that is neither: the call's arguments as they were.
    const none: JSONObject = { title: "Checkout down" };
    expect(withStartWrittenOut(none)).toBe(none);

    const invalid: JSONObject = { [INITIAL_STATE_ARGUMENT_NAME]: "later" };
    expect(withStartWrittenOut(invalid)).toBe(invalid);
  });

  test("running a call that names neither says what to pass", () => {
    expect(getInvalidStartMessage("alert")).toBe(
      'initialState must be "acknowledged" or "resolved". Leave it out for a new alert that pages its on-call policies.',
    );
  });
});

describe("the state a record starts in", () => {
  test("acknowledged: the project's acknowledged state, whatever it is called", () => {
    expect(
      pickStartState({
        start: NewRecordStart.Acknowledged,
        list: StateListType.IncidentState,
        states: STATES,
      })?.name,
    ).toBe("Investigating");
  });

  test("resolved: the project's resolved state, whatever it is called", () => {
    expect(
      pickStartState({
        start: NewRecordStart.Resolved,
        list: StateListType.AlertState,
        states: STATES,
      })?.name,
    ).toBe("Closed");
  });

  test("a project with no such state has none to start in", () => {
    expect(
      pickStartState({
        start: NewRecordStart.Resolved,
        list: StateListType.IncidentState,
        states: STATES.filter((state: StateRow): boolean => {
          return !state.isResolvedState;
        }),
      }),
    ).toBeNull();
  });
});

describe("what the approval card says", () => {
  test("the severity first, then where it starts, then what it is linked to", () => {
    const linked: ReturnType<typeof aiActionSentence> = aiActionSentence(
      AI_ACTION_LINES.linkedTo,
      {
        resources: aiActionList([
          aiActionResourceByName({ noun: "host", name: "test01" }),
        ]),
      },
    );

    expect(
      actionLineText(
        describeNewRecordForPerson({
          severityName: "High",
          start: NewRecordStart.Resolved,
          linked: [linked],
        }),
      ),
    ).toBe(
      'Severity: High. Starts resolved, so it pages nobody. Linked to host "test01".',
    );

    expect(
      actionLineText(
        describeNewRecordForPerson({
          severityName: "SEV2",
          start: NewRecordStart.Acknowledged,
          linked: [],
        }),
      ),
    ).toBe("Severity: SEV2. Starts acknowledged, so it pages nobody.");
  });

  test("a new record that starts where every new one does says nothing of its start", () => {
    expect(
      actionLineText(
        describeNewRecordForPerson({ severityName: "High", linked: [] }),
      ),
    ).toBe("Severity: High.");
    expect(
      describeNewRecordForPerson({ severityName: null, linked: [] }),
    ).toEqual([]);
  });

  test("the start's sentences are the module's", () => {
    expect(describeStartForPerson(NewRecordStart.Acknowledged)).toEqual(
      aiActionSentence(AI_ACTION_LINES.startsAcknowledged),
    );
    expect(describeStartForPerson(NewRecordStart.Resolved)).toEqual(
      aiActionSentence(AI_ACTION_LINES.startsResolved),
    );
    expect(describeStartForPerson(null)).toBeNull();
  });

  test("the arguments the line says in words: the severity, and the start", () => {
    expect(
      getDescribedNewRecordArguments({
        title: "Checkout down",
        severityName: "High",
        [INITIAL_STATE_ARGUMENT_NAME]: "resolved",
      }),
    ).toEqual(["severityName", INITIAL_STATE_ARGUMENT_NAME]);
    expect(getDescribedNewRecordArguments({ severityName: " " })).toEqual([]);
    // A start that is neither is not said in words: the argument line keeps it.
    expect(
      getDescribedNewRecordArguments({
        [INITIAL_STATE_ARGUMENT_NAME]: "later",
      }),
    ).toEqual([]);
  });
});

describe("what the model is told", () => {
  test("a record that started later paged nobody, and why", () => {
    expect(describeStartForModel(NewRecordStart.Acknowledged, "incident")).toBe(
      "It started in the project's acknowledged state, so no on-call policy paged anyone; its feed says why. Its rules, owners and feed ran as for any new incident.",
    );
    expect(describeStartForModel(NewRecordStart.Resolved, "alert")).toContain(
      "no on-call policy paged anyone, and it is not grouped into an episode, remediated or investigated",
    );
    expect(describeStartForModel(null, "alert")).toBe("");
  });

  test("a severity the project does not have: the one it took, and the ones there are", () => {
    expect(
      describeSeverityNotFound({
        noun: "incident",
        severityName: "P0",
        taken: "SEV1",
        severities: [{ name: "SEV1" }, { name: "" }, { name: "SEV2" }],
      }),
    ).toBe(
      'No incident severity of this project is named "P0", so it took the first, SEV1. The project\'s incident severities: SEV1, SEV2.',
    );
  });
});

describe("the severity a new record takes", () => {
  const severities: Array<{ name: string }> = [
    { name: "SEV1" },
    { name: " Major " },
    { name: "SEV3" },
  ];

  test("the one the call names, without regard to case or spaces", () => {
    expect(
      pickNamedSeverity({ severities, severityName: "major" }),
    ).toEqual({ severity: severities[1], isNamed: true });
    expect(
      pickNamedSeverity({ severities, severityName: "  sev3 " }),
    ).toEqual({ severity: severities[2], isNamed: true });
  });

  test("else the project's first, and it says it was not the one named", () => {
    expect(pickNamedSeverity({ severities, severityName: "P0" })).toEqual({
      severity: severities[0],
      isNamed: false,
    });
    expect(
      pickNamedSeverity({ severities, severityName: undefined }),
    ).toEqual({ severity: severities[0], isNamed: false });
  });

  test("a project with none gives none", () => {
    expect(pickNamedSeverity({ severities: [], severityName: "SEV1" })).toBe(
      null,
    );
  });
});

describe("the card a new record leaves under the answer", () => {
  test("its kind, its severity and where it started, what it is linked to and its description", () => {
    const words: AIActionCardWords = describeNewRecordCard({
      kind: AI_ACTION_CARD_KINDS.incident,
      severityName: "SEV2",
      start: NewRecordStart.Resolved,
      linked: [HOST, CLUSTER],
      description: "Checkout was down for 20 minutes.",
    });

    expect(isKnownAIActionCardWords(words)).toBe(true);
    expect(words).toEqual({
      kind: aiActionTerm(AI_ACTION_CARD_KINDS.incident),
      line: [
        aiActionSentence(AI_ACTION_CARD_LINES.severity, { severity: "SEV2" }),
        aiActionSentence(AI_ACTION_CARD_LINES.startedResolved),
      ],
      facts: [
        aiActionCardFact(
          AI_ACTION_CARD_FACTS.affectedResources,
          aiActionList([
            aiActionResourceByName({ noun: "host", name: "test01" }),
            aiActionResourceByName({
              noun: "Kubernetes cluster",
              name: "prod",
            }),
          ]),
        ),
        aiActionCardFact(
          AI_ACTION_CARD_FACTS.description,
          "Checkout was down for 20 minutes.",
        ),
      ],
    });

    // Its English, as exports print it.
    expect(describeAIActionCardWords(words)).toEqual({
      kind: "Incident",
      line: "Severity: SEV2 · Started resolved",
      facts: [
        {
          label: "Affected resources",
          value: 'host "test01", Kubernetes cluster "prod"',
        },
        { label: "Description", value: "Checkout was down for 20 minutes." },
      ],
    });
  });

  test("a new record that starts where every new one does says only its severity; nothing linked, nothing said", () => {
    expect(
      describeNewRecordCard({
        kind: AI_ACTION_CARD_KINDS.alert,
        severityName: "High",
        start: null,
        linked: [],
        description: "",
      }),
    ).toEqual({
      kind: aiActionTerm(AI_ACTION_CARD_KINDS.alert),
      line: [
        aiActionSentence(AI_ACTION_CARD_LINES.severity, { severity: "High" }),
      ],
    });

    expect(describeStartOnCard(NewRecordStart.Acknowledged)).toEqual(
      aiActionSentence(AI_ACTION_CARD_LINES.startedAcknowledged),
    );
    expect(describeStartOnCard(null)).toBeNull();
  });

  test("a long description is cut to the start of it", () => {
    const description: string = "x".repeat(250);
    const words: AIActionCardWords = describeNewRecordCard({
      kind: AI_ACTION_CARD_KINDS.alert,
      severityName: undefined,
      start: null,
      linked: [],
      description,
    });

    expect(words.line).toBeUndefined();
    expect(words.facts).toEqual([
      aiActionCardFact(
        AI_ACTION_CARD_FACTS.description,
        `${"x".repeat(200)}…`,
      ),
    ]);
  });
});

describe("the card linking leaves", () => {
  test("what it added on its line, and what was linked already as a fact", () => {
    const words: AIActionCardWords = describeLinkingCard({
      kind: AI_ACTION_CARD_KINDS.incident,
      added: [HOST],
      alreadyLinked: [CLUSTER],
    });

    expect(isKnownAIActionCardWords(words)).toBe(true);
    expect(describeAIActionCardWords(words)).toEqual({
      kind: "Incident",
      line: 'Linked to host "test01"',
      facts: [
        { label: "Already linked", value: 'Kubernetes cluster "prod"' },
      ],
    });
  });

  test("nothing new: what it was linked to already, on its line", () => {
    expect(
      describeAIActionCardWords(
        describeLinkingCard({
          kind: AI_ACTION_CARD_KINDS.alert,
          added: [],
          alreadyLinked: [HOST],
        }),
      ),
    ).toEqual({
      kind: "Alert",
      line: 'Already linked to host "test01"',
      facts: [],
    });
  });

  test("everything added: no fact about what was linked already", () => {
    expect(
      describeLinkingCard({
        kind: AI_ACTION_CARD_KINDS.alert,
        added: [HOST, CLUSTER],
        alreadyLinked: [],
      }).facts,
    ).toBeUndefined();
  });
});
