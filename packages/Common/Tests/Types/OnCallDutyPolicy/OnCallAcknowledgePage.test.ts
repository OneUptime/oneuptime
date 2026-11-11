import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_ACKNOWLEDGED_TITLE,
  ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_RESOLVED_TITLE,
  ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_SEEN_TITLE,
  OnCallAcknowledgePageAnswer,
  OnCallAcknowledgePageFacts,
  OnCallAcknowledgePageRecord,
  OnCallAcknowledgePageRun,
  OnCallAcknowledgePageState,
  getOnCallAcknowledgePageAnswer,
  getOnCallAcknowledgePageAnsweredHeading,
  getOnCallAcknowledgePageAnsweredSentence,
  getOnCallAcknowledgePagePersonName,
  isOnCallAcknowledgePageOpen,
  isOnCallPageEndedOnlyByAnAnswer,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgePage";

/*
 * WHAT THE ACKNOWLEDGE PAGE A MESSAGE'S LINK OPENS OFFERS
 * (https://github.com/OneUptime/oneuptime/issues/6706).
 *
 * It asked "Do you want to acknowledge this incident?" whatever had happened
 * since the message was sent. These pin the rule it now offers Acknowledge
 * by - the rule the worker ends a person's page with - and the words it says
 * instead once the page is over.
 */

const PERSON: string = "0f6706aa-0000-4000-8000-000000000001";
const ANA: string = "0f6706aa-0000-4000-8000-0000000000a1";
const POLICY: string = "0f6706aa-0000-4000-8000-0000000000b1";
const WORKFLOW: string = "0f6706aa-0000-4000-8000-0000000000c1";
const ANSWERED_AT: Date = new Date("2026-11-11T03:01:35.000Z");

// A run of an on-call policy, nobody has answered it yet.
const POLICY_RUN: OnCallAcknowledgePageRun = {
  onCallDutyPolicyId: POLICY,
  triggeredByUserId: null,
  triggeredByWorkflowId: null,
  isObserverPage: false,
  pageAgainNumber: null,
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  acknowledgedByUser: null,
};

// A page again (OnCallAcknowledgementTimeout): its record was acknowledged all along.
const PAGE_AGAIN_RUN: OnCallAcknowledgePageRun = {
  ...POLICY_RUN,
  pageAgainNumber: 1,
};

// A page a person asked for from Slack or Microsoft Teams (OnCallPersonPage).
const PERSON_PAGE_RUN: OnCallAcknowledgePageRun = {
  ...POLICY_RUN,
  onCallDutyPolicyId: null,
  triggeredByUserId: ANA,
};

// An observer's page (OnCallObserverPage).
const OBSERVER_RUN: OnCallAcknowledgePageRun = {
  ...POLICY_RUN,
  isObserverPage: true,
};

const OPEN_RECORD: OnCallAcknowledgePageRecord = {
  isAcknowledged: false,
  isResolved: false,
};

// Acknowledged - or in a state after it, such as "Monitor": the one rule says so.
const ACKNOWLEDGED_RECORD: OnCallAcknowledgePageRecord = {
  isAcknowledged: true,
  isResolved: false,
};

const RESOLVED_RECORD: OnCallAcknowledgePageRecord = {
  isAcknowledged: true,
  isResolved: true,
};

function answeredBy(
  run: OnCallAcknowledgePageRun,
  userId: string,
  user: { name?: unknown; email?: unknown } | null = { name: "Ana Lopez" },
): OnCallAcknowledgePageRun {
  return {
    ...run,
    acknowledgedAt: ANSWERED_AT,
    acknowledgedByUserId: userId,
    acknowledgedByUser: user,
  };
}

function facts(
  overrides: Partial<OnCallAcknowledgePageFacts>,
): OnCallAcknowledgePageFacts {
  return {
    personUserId: PERSON,
    isMessageAcknowledged: false,
    run: POLICY_RUN,
    record: OPEN_RECORD,
    ...overrides,
  };
}

function stateOf(overrides: Partial<OnCallAcknowledgePageFacts>): string {
  return getOnCallAcknowledgePageAnswer(facts(overrides)).state;
}

describe("isOnCallPageEndedOnlyByAnAnswer: the pages the record being acknowledged does not end", () => {
  test.each([
    ["a policy's run", POLICY_RUN, false],
    ["a page again", PAGE_AGAIN_RUN, true],
    ["a page a person asked for", PERSON_PAGE_RUN, true],
    ["an observer's page", OBSERVER_RUN, true],
    [
      "a direct page a workflow started (no person asked for it)",
      {
        ...POLICY_RUN,
        onCallDutyPolicyId: null,
        triggeredByUserId: null,
        triggeredByWorkflowId: WORKFLOW,
      },
      false,
    ],
    [
      "a workflow's page started by a person's action",
      {
        ...POLICY_RUN,
        onCallDutyPolicyId: null,
        triggeredByUserId: ANA,
        triggeredByWorkflowId: WORKFLOW,
      },
      false,
    ],
    ["no run", null, false],
    ["a run read without any of the columns", {}, false],
  ])(
    "%s: %p",
    (
      _name: string,
      run: OnCallAcknowledgePageRun | null,
      expected: boolean,
    ) => {
      expect(isOnCallPageEndedOnlyByAnAnswer(run)).toBe(expected);
    },
  );
});

describe("a responder's page: over once its record is acknowledged, whoever did it", () => {
  test("nobody has done anything yet: Acknowledge is offered", () => {
    expect(stateOf({})).toBe(OnCallAcknowledgePageState.Open);
  });

  test("a colleague answered their page: it says who", () => {
    expect(
      getOnCallAcknowledgePageAnswer(
        facts({
          run: answeredBy(POLICY_RUN, ANA),
          record: ACKNOWLEDGED_RECORD,
        }),
      ),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
      acknowledgedByName: "Ana Lopez",
    });
  });

  test("acknowledged some other way - the Dashboard, Slack, a workflow: no name to give", () => {
    /*
     * The issue's own screenshot: an incident moved on to "Monitor", a state
     * after Acknowledged, still asked to be acknowledged.
     */
    expect(
      getOnCallAcknowledgePageAnswer(facts({ record: ACKNOWLEDGED_RECORD })),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
    });
  });

  test("the record follows the run: a run answered but a record no longer acknowledged is offered again", () => {
    /*
     * As the worker reads a responder's page: by its record. A record moved
     * back to a state before Acknowledged waits for somebody again.
     */
    expect(
      stateOf({ run: answeredBy(POLICY_RUN, ANA), record: OPEN_RECORD }),
    ).toBe(OnCallAcknowledgePageState.Open);
  });

  test("a direct page a workflow started reads like a responder's page", () => {
    expect(
      stateOf({
        run: {
          ...POLICY_RUN,
          onCallDutyPolicyId: null,
          triggeredByWorkflowId: WORKFLOW,
        },
        record: ACKNOWLEDGED_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.AcknowledgedBySomeoneElse);
  });
});

describe("the person's own answer ends their page, however they gave it", () => {
  test("this message's own link", () => {
    expect(stateOf({ isMessageAcknowledged: true })).toBe(
      OnCallAcknowledgePageState.AcknowledgedByYou,
    );
  });

  test("another of their messages, a call's 1, the app: the run records them", () => {
    expect(
      stateOf({
        run: answeredBy(POLICY_RUN, PERSON),
        record: ACKNOWLEDGED_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.AcknowledgedByYou);
  });

  test("the run's id and the person's are compared whatever their case", () => {
    expect(
      stateOf({
        personUserId: new ObjectID(PERSON),
        run: answeredBy(POLICY_RUN, PERSON.toUpperCase()),
        record: ACKNOWLEDGED_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.AcknowledgedByYou);
  });

  test("this message answered, even with nothing else read", () => {
    expect(
      stateOf({ isMessageAcknowledged: true, run: null, record: null }),
    ).toBe(OnCallAcknowledgePageState.AcknowledgedByYou);
  });

  test("a page whose person is not known is never theirs", () => {
    expect(
      stateOf({
        personUserId: null,
        run: answeredBy(POLICY_RUN, PERSON),
        record: ACKNOWLEDGED_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.AcknowledgedBySomeoneElse);
  });

  test("a run answered without anybody named is not theirs", () => {
    expect(
      stateOf({
        run: { ...POLICY_RUN, acknowledgedAt: ANSWERED_AT },
        record: ACKNOWLEDGED_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.AcknowledgedBySomeoneElse);
  });

  test("a run that names them but was never answered is not an answer", () => {
    expect(
      stateOf({
        run: { ...POLICY_RUN, acknowledgedByUserId: PERSON },
        record: OPEN_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.Open);
  });
});

describe("a resolved record ends every page of it", () => {
  test.each([
    ["a policy's run", POLICY_RUN],
    ["a page again", PAGE_AGAIN_RUN],
    ["a page a person asked for", PERSON_PAGE_RUN],
    ["an observer's page", OBSERVER_RUN],
    ["no run read", null],
  ])("%s", (_name: string, run: OnCallAcknowledgePageRun | null) => {
    expect(stateOf({ run: run, record: RESOLVED_RECORD })).toBe(
      OnCallAcknowledgePageState.Resolved,
    );
  });

  test("resolved is said before the person's own answer: it is where the record is now", () => {
    expect(
      stateOf({
        isMessageAcknowledged: true,
        run: answeredBy(POLICY_RUN, PERSON),
        record: RESOLVED_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.Resolved);
  });
});

describe("a page again, a person's page and an observer's page go on until one of their people answers", () => {
  const RUNS: Array<[string, OnCallAcknowledgePageRun]> = [
    ["a page again", PAGE_AGAIN_RUN],
    ["a page a person asked for", PERSON_PAGE_RUN],
    ["an observer's page", OBSERVER_RUN],
  ];

  test.each(RUNS)(
    "%s about an acknowledged record still offers its answer",
    (_name: string, run: OnCallAcknowledgePageRun) => {
      expect(stateOf({ run: run, record: ACKNOWLEDGED_RECORD })).toBe(
        OnCallAcknowledgePageState.Open,
      );
    },
  );

  test.each(RUNS)(
    "%s somebody else answered is over, and says who",
    (_name: string, run: OnCallAcknowledgePageRun) => {
      expect(
        getOnCallAcknowledgePageAnswer(
          facts({ run: answeredBy(run, ANA), record: ACKNOWLEDGED_RECORD }),
        ),
      ).toEqual({
        state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
        acknowledgedByName: "Ana Lopez",
      });
    },
  );

  test.each(RUNS)(
    "%s the person answered themselves is theirs",
    (_name: string, run: OnCallAcknowledgePageRun) => {
      expect(
        stateOf({ run: answeredBy(run, PERSON), record: ACKNOWLEDGED_RECORD }),
      ).toBe(OnCallAcknowledgePageState.AcknowledgedByYou);
    },
  );

  test.each(RUNS)(
    "%s answered, about a record that cannot be read, is still over",
    (_name: string, run: OnCallAcknowledgePageRun) => {
      expect(stateOf({ run: answeredBy(run, ANA), record: null })).toBe(
        OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
      );
    },
  );
});

describe("what cannot be read never takes Acknowledge away", () => {
  test("neither the run nor the record", () => {
    expect(stateOf({ run: null, record: null })).toBe(
      OnCallAcknowledgePageState.Open,
    );
  });

  test("the record, on a responder's page", () => {
    expect(stateOf({ record: null })).toBe(OnCallAcknowledgePageState.Open);
  });

  test("the run, about an open record", () => {
    expect(stateOf({ run: null })).toBe(OnCallAcknowledgePageState.Open);
  });

  test("a run that could not be read, about an acknowledged record: it might be a page again, so Acknowledge stays", () => {
    expect(
      stateOf({ run: null, isRunUnknown: true, record: ACKNOWLEDGED_RECORD }),
    ).toBe(OnCallAcknowledgePageState.Open);
  });

  test("a run that could not be read still knows a resolve and the person's own answer", () => {
    expect(
      stateOf({ run: null, isRunUnknown: true, record: RESOLVED_RECORD }),
    ).toBe(OnCallAcknowledgePageState.Resolved);
    expect(
      stateOf({
        run: null,
        isRunUnknown: true,
        isMessageAcknowledged: true,
        record: ACKNOWLEDGED_RECORD,
      }),
    ).toBe(OnCallAcknowledgePageState.AcknowledgedByYou);
  });

  test("a page with no run at all, about an acknowledged record, is a responder's page", () => {
    expect(stateOf({ run: null, record: ACKNOWLEDGED_RECORD })).toBe(
      OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
    );
  });
});

describe("who answered, as the page names them", () => {
  test.each([
    [
      "their name",
      { name: "Ana Lopez", email: "ana@example.com" },
      "Ana Lopez",
    ],
    ["their name, trimmed", { name: "  Ana Lopez  " }, "Ana Lopez"],
    [
      "their email, with no name",
      { name: "", email: "ana@example.com" },
      "ana@example.com",
    ],
    [
      "their email, with a blank name",
      { name: "   ", email: " ana@example.com " },
      "ana@example.com",
    ],
    ["nothing, with neither", { name: "", email: "" }, ""],
    ["nothing, for nobody", null, ""],
    ["nothing, for nobody (undefined)", undefined, ""],
  ])(
    "%s",
    (
      _name: string,
      user: { name?: unknown; email?: unknown } | null | undefined,
      expected: string,
    ) => {
      expect(getOnCallAcknowledgePagePersonName(user)).toBe(expected);
    },
  );

  test("an answer by somebody with no name or email names nobody", () => {
    expect(
      getOnCallAcknowledgePageAnswer(
        facts({
          run: answeredBy(POLICY_RUN, ANA, { name: "", email: "" }),
          record: ACKNOWLEDGED_RECORD,
        }),
      ),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
    });
  });

  test("an answer by somebody with only an email names their email", () => {
    expect(
      getOnCallAcknowledgePageAnswer(
        facts({
          run: answeredBy(POLICY_RUN, ANA, { email: "ana@example.com" }),
          record: ACKNOWLEDGED_RECORD,
        }),
      ).acknowledgedByName,
    ).toBe("ana@example.com");
  });

  test("a name is given only for somebody else, never for the person or a resolve", () => {
    expect(
      getOnCallAcknowledgePageAnswer(
        facts({
          run: answeredBy(POLICY_RUN, PERSON),
          record: ACKNOWLEDGED_RECORD,
        }),
      ).acknowledgedByName,
    ).toBeUndefined();
    expect(
      getOnCallAcknowledgePageAnswer(
        facts({ run: answeredBy(POLICY_RUN, ANA), record: RESOLVED_RECORD }),
      ).acknowledgedByName,
    ).toBeUndefined();
  });
});

describe("isOnCallAcknowledgePageOpen", () => {
  test.each([
    [OnCallAcknowledgePageState.Open, true],
    [OnCallAcknowledgePageState.AcknowledgedByYou, false],
    [OnCallAcknowledgePageState.AcknowledgedBySomeoneElse, false],
    [OnCallAcknowledgePageState.Resolved, false],
  ])("%s: %p", (state: OnCallAcknowledgePageState, expected: boolean) => {
    expect(isOnCallAcknowledgePageOpen({ state: state })).toBe(expected);
  });
});

describe("the heading over a page that no longer offers Acknowledge", () => {
  test.each([
    [
      OnCallAcknowledgePageState.AcknowledgedByYou,
      false,
      "Already acknowledged",
    ],
    [
      OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
      false,
      "Already acknowledged",
    ],
    [OnCallAcknowledgePageState.Resolved, false, "Already resolved"],
    [
      OnCallAcknowledgePageState.AcknowledgedByYou,
      true,
      "Already marked as seen",
    ],
    [
      OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
      true,
      "Already marked as seen",
    ],
    // Resolved is resolved for an observer too.
    [OnCallAcknowledgePageState.Resolved, true, "Already resolved"],
  ])(
    "%s, observer %p: %p",
    (
      state: OnCallAcknowledgePageState,
      isObserverPage: boolean,
      expected: string,
    ) => {
      expect(
        getOnCallAcknowledgePageAnsweredHeading({
          state: state,
          isObserverPage: isObserverPage,
        }),
      ).toBe(expected);
    },
  );

  test("the headings are the constants other places can name", () => {
    expect(ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_ACKNOWLEDGED_TITLE).toBe(
      "Already acknowledged",
    );
    expect(ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_RESOLVED_TITLE).toBe(
      "Already resolved",
    );
    expect(ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_SEEN_TITLE).toBe(
      "Already marked as seen",
    );
  });
});

describe("the sentence under it", () => {
  function sentence(
    answer: OnCallAcknowledgePageAnswer,
    isObserverPage: boolean = false,
    labels: [string, string] = ["Incident INC-42", "Incident INC-42"],
  ): string {
    return getOnCallAcknowledgePageAnsweredSentence({
      answer: answer,
      isObserverPage: isObserverPage,
      recordLabel: labels[0],
      recordLabelInSentence: labels[1],
    });
  }

  test("somebody else, by name", () => {
    expect(
      sentence({
        state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
        acknowledgedByName: "Ana Lopez",
      }),
    ).toBe("Incident INC-42 was already acknowledged by Ana Lopez.");
  });

  test("somebody else, unnamed", () => {
    expect(
      sentence({ state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse }),
    ).toBe("Incident INC-42 is already acknowledged.");
  });

  test("somebody else, named only by blanks, is unnamed", () => {
    expect(
      sentence({
        state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
        acknowledgedByName: "   ",
      }),
    ).toBe("Incident INC-42 is already acknowledged.");
  });

  test("the person", () => {
    expect(
      sentence({ state: OnCallAcknowledgePageState.AcknowledgedByYou }),
    ).toBe("You already acknowledged Incident INC-42.");
  });

  test("resolved", () => {
    expect(sentence({ state: OnCallAcknowledgePageState.Resolved })).toBe(
      "Incident INC-42 is already resolved.",
    );
  });

  test("a record without a number: 'This incident' to open a sentence, 'this incident' inside one", () => {
    const labels: [string, string] = ["This incident", "this incident"];

    expect(
      sentence(
        {
          state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
          acknowledgedByName: "Ana Lopez",
        },
        false,
        labels,
      ),
    ).toBe("This incident was already acknowledged by Ana Lopez.");
    expect(
      sentence(
        { state: OnCallAcknowledgePageState.AcknowledgedByYou },
        false,
        labels,
      ),
    ).toBe("You already acknowledged this incident.");
    expect(
      sentence({ state: OnCallAcknowledgePageState.Resolved }, false, labels),
    ).toBe("This incident is already resolved.");
  });

  test("an episode reads the same", () => {
    expect(
      sentence(
        {
          state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
          acknowledgedByName: "Ana Lopez",
        },
        false,
        ["Alert Episode AEP-3", "Alert Episode AEP-3"],
      ),
    ).toBe("Alert Episode AEP-3 was already acknowledged by Ana Lopez.");
  });

  test("with no label at all, it still reads", () => {
    expect(
      sentence({ state: OnCallAcknowledgePageState.Resolved }, false, ["", ""]),
    ).toBe("It is already resolved.");
    expect(
      sentence({ state: OnCallAcknowledgePageState.AcknowledgedByYou }, false, [
        " ",
        " ",
      ]),
    ).toBe("You already acknowledged it.");
  });

  describe("an observer's page is marked as seen, never acknowledged", () => {
    test("by the person", () => {
      expect(
        sentence({ state: OnCallAcknowledgePageState.AcknowledgedByYou }, true),
      ).toBe("You already marked this page as seen.");
    });

    test("by another observer, by name", () => {
      expect(
        sentence(
          {
            state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
            acknowledgedByName: "Ana Lopez",
          },
          true,
        ),
      ).toBe("Ana Lopez already marked this page as seen.");
    });

    test("by another observer, unnamed", () => {
      expect(
        sentence(
          { state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse },
          true,
        ),
      ).toBe("This page is already marked as seen.");
    });

    test("resolved is still resolved", () => {
      expect(
        sentence({ state: OnCallAcknowledgePageState.Resolved }, true),
      ).toBe("Incident INC-42 is already resolved.");
    });

    test("none of an observer's answers says the record was acknowledged", () => {
      for (const answer of [
        { state: OnCallAcknowledgePageState.AcknowledgedByYou },
        {
          state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
          acknowledgedByName: "Ana Lopez",
        },
        { state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse },
      ]) {
        expect(sentence(answer, true)).not.toMatch(/acknowledg/i);
      }
    });
  });
});
