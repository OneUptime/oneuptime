import URL from "../../../Types/API/URL";
import CallRequest, {
  CallRequestMessage,
  GatherInput,
  Say,
} from "../../../Types/Call/CallRequest";
import { OnCallObserverPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { ON_CALL_PAGE_CALL_PASS_ON_DIGIT } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { OnCallPersonPageNotice } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import {
  CALL_SPEECH_CUT_MARK,
  CALL_TITLE_MAX_LENGTH,
  getSpeechCharacters,
} from "../../../Utils/Call/CallSpeech";
import {
  ON_CALL_OBSERVER_PAGE_CALL_NO_INPUT,
  ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT,
  ON_CALL_PAGE_CALL_INVALID_INPUT,
  ON_CALL_PAGE_CALL_PROMPT,
  ON_CALL_PAGE_CALL_TIMEOUT_IN_SECONDS,
  OnCallPageCallInput,
  buildOnCallPageCallData,
  getOnCallPageCallAcknowledgedMessage,
  getOnCallPageCallHeadline,
  getOnCallPageCallNoInputMessage,
  getOnCallPageCallOpening,
  getOnCallPageCallRecordLabel,
} from "../../../Utils/Call/OnCallPageCall";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN ON-CALL PAGE'S CALL SAYS (#10762).
 *
 * Who calls - the project, or the product for a call with none; how bad and
 * which one - the severity, as a text message names it, and the number,
 * which the voice spells; the keys, before a title cut for speech; and the
 * details and keys again while no key is pressed. Keys 1 and 2 answer as
 * they always have. These read the words of every kind of page - a first
 * page, a page again, a person's page, a policy started by hand and an
 * observer's page - for each kind of record.
 */

const RESPONSE_URL: URL = URL.fromString(
  "https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/0fa10762-0000-4000-8000-000000000001?pageToken=t",
);

const ALICE: OnCallPersonPageNotice = { pagedByName: "Alice Kim" };

const ALICE_WITH_MESSAGE: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  message: "Can you check the database?",
};

const POLICY_BY_HAND: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  policyName: "Database escalation",
};

function input(
  overrides: Partial<OnCallPageCallInput> = {},
  record: Partial<OnCallPageCallInput["record"]> = {},
): OnCallPageCallInput {
  return {
    record: {
      noun: "incident",
      number: "INC-42",
      severityName: "Critical Incident",
      title: "Checkout API is down",
      ...record,
    },
    projectName: "Acme Production",
    responseUrl: RESPONSE_URL,
    ...overrides,
  };
}

function sentencesOf(data: CallRequestMessage["data"]): Array<Say> {
  return data.filter((item: unknown): boolean => {
    return typeof (item as Say).sayMessage === "string";
  }) as Array<Say>;
}

function promptOf(data: CallRequestMessage["data"]): GatherInput {
  const prompts: Array<GatherInput> = data.filter((item: unknown): boolean => {
    return Boolean((item as GatherInput).numDigits);
  }) as Array<GatherInput>;

  expect(prompts).toHaveLength(1);

  return prompts[0]!;
}

describe("who calls", () => {
  test("the project, by its name", () => {
    expect(getOnCallPageCallOpening("Acme Production")).toBe(
      "This is a call from Acme Production.",
    );
  });

  test("a name that ends a sentence itself is not ended twice", () => {
    expect(getOnCallPageCallOpening("Acme Inc.")).toBe(
      "This is a call from Acme Inc.",
    );
  });

  test("without a project name, the product - which an installation that goes by its own name says instead", () => {
    for (const name of [undefined, null, "", "   "]) {
      expect(getOnCallPageCallOpening(name)).toBe(
        "This is a call from OneUptime.",
      );
    }
  });
});

describe("how bad, and which one", () => {
  test("the severity with what happened, and the number", () => {
    expect(getOnCallPageCallRecordLabel(input().record)).toBe(
      "Critical Incident INC-42",
    );
  });

  test("a severity named after what it rates is not followed by the word again", () => {
    expect(
      getOnCallPageCallRecordLabel(
        input({}, { severityName: "Critical Incident" }).record,
      ),
    ).not.toContain("Incident incident");
    expect(
      getOnCallPageCallRecordLabel(input({}, { severityName: "Critical" }).record),
    ).toBe("Critical incident INC-42");
  });

  test("each kind of record", () => {
    const labels: Record<OnCallObserverPageRecordKind, string> = {
      incident: getOnCallPageCallRecordLabel(
        input({}, { noun: "incident", severityName: "Major Incident" }).record,
      ),
      alert: getOnCallPageCallRecordLabel(
        input({}, { noun: "alert", number: "ALT-7", severityName: "High" })
          .record,
      ),
      "incident episode": getOnCallPageCallRecordLabel(
        input(
          {},
          {
            noun: "incident episode",
            number: "IE-2",
            severityName: "Critical Incident",
          },
        ).record,
      ),
      "alert episode": getOnCallPageCallRecordLabel(
        input({}, { noun: "alert episode", number: "AE-4", severityName: "Low" })
          .record,
      ),
    };

    expect(labels).toEqual({
      incident: "Major Incident INC-42",
      alert: "High alert ALT-7",
      "incident episode": "Critical Incident episode IE-2",
      "alert episode": "Low alert episode AE-4",
    });
  });

  test("without a severity: the kind and the number", () => {
    expect(
      getOnCallPageCallRecordLabel(input({}, { severityName: undefined }).record),
    ).toBe("Incident INC-42");
    expect(
      getOnCallPageCallRecordLabel(
        input({}, { noun: "alert episode", severityName: "  " }).record,
      ),
    ).toBe("Alert episode INC-42");
  });

  test("without a number: the severity and the kind", () => {
    expect(
      getOnCallPageCallRecordLabel(input({}, { number: undefined }).record),
    ).toBe("Critical Incident");
  });

  test("with neither: nothing - the sentence before it names the kind already", () => {
    expect(
      getOnCallPageCallRecordLabel(
        input({}, { number: null, severityName: null }).record,
      ),
    ).toBe("");
  });
});

describe("the headline: what happened, how bad and which one", () => {
  test("a first page: a new one, with its severity, then its number", () => {
    expect(getOnCallPageCallHeadline(input())).toBe(
      "A new Critical Incident has been created: INC-42.",
    );
  });

  test("a first page of each kind of record", () => {
    expect(
      getOnCallPageCallHeadline(
        input({}, { noun: "alert", number: "ALT-7", severityName: "High" }),
      ),
    ).toBe("A new High alert has been created: ALT-7.");
    expect(
      getOnCallPageCallHeadline(
        input({}, { noun: "alert episode", number: "AE-4", severityName: "Low" }),
      ),
    ).toBe("A new Low alert episode has been created: AE-4.");
    expect(
      getOnCallPageCallHeadline(
        input(
          {},
          {
            noun: "incident episode",
            number: "IE-2",
            severityName: "Critical Incident",
          },
        ),
      ),
    ).toBe("A new Critical Incident episode has been created: IE-2.");
  });

  test("a first page without a severity, or without a number, says what it has", () => {
    expect(
      getOnCallPageCallHeadline(input({}, { severityName: undefined })),
    ).toBe("A new incident has been created: INC-42.");
    expect(getOnCallPageCallHeadline(input({}, { number: undefined }))).toBe(
      "A new Critical Incident has been created.",
    );
    expect(
      getOnCallPageCallHeadline(
        input({}, { number: undefined, severityName: undefined }),
      ),
    ).toBe("A new incident has been created.");
    expect(getOnCallPageCallHeadline(input({}, { number: "#42" }))).toBe(
      "A new Critical Incident has been created: #42.",
    );
  });

  test("a page again: still not resolved, then the record", () => {
    expect(
      getOnCallPageCallHeadline(
        input({ pageAgain: { pageAgainNumber: 1, minutes: 30 } }),
      ),
    ).toBe(
      "An incident is still not resolved 30 minutes after it was acknowledged: Critical Incident INC-42.",
    );
  });

  test("a person's page: who paged, then the record", () => {
    expect(getOnCallPageCallHeadline(input({ personPage: ALICE }))).toBe(
      "Alice Kim paged you about an incident: Critical Incident INC-42.",
    );
  });

  test("a policy started by hand: who started which policy, then the record", () => {
    expect(
      getOnCallPageCallHeadline(input({ personPage: POLICY_BY_HAND })),
    ).toBe(
      "Alice Kim started the on-call policy Database escalation for an incident: Critical Incident INC-42.",
    );
  });

  test("an observer's page: paged as an observer, then the record - over a page again", () => {
    expect(getOnCallPageCallHeadline(input({ isObserverPage: true }))).toBe(
      "You are paged as an observer about an incident: Critical Incident INC-42.",
    );
    expect(
      getOnCallPageCallHeadline(
        input({
          isObserverPage: true,
          pageAgain: { pageAgainNumber: 2 },
        }),
      ),
    ).toBe(
      "You are paged as an observer about an incident: Critical Incident INC-42.",
    );
    expect(
      getOnCallPageCallHeadline(
        input({ isObserverPage: true, personPage: ALICE }),
      ),
    ).toBe(
      "Alice Kim paged you about an incident, as an observer: Critical Incident INC-42.",
    );
  });

  test("a page that is not a first one, with neither severity nor number: what it is, alone", () => {
    expect(
      getOnCallPageCallHeadline(
        input(
          { personPage: ALICE },
          { number: undefined, severityName: undefined },
        ),
      ),
    ).toBe("Alice Kim paged you about an incident.");
  });
});

describe("what a responder's call says, and asks", () => {
  test("who calls; the headline, said again; the title after the prompt, said again; then the prompt", () => {
    const data: CallRequestMessage["data"] = buildOnCallPageCallData(input());

    expect(sentencesOf(data)).toEqual([
      { sayMessage: "This is a call from Acme Production." },
      {
        sayMessage: "A new Critical Incident has been created: INC-42.",
        recordNumber: "INC-42",
        repeated: true,
      },
      {
        sayMessage: "Checkout API is down",
        afterPrompt: true,
        repeated: true,
      },
    ]);
    // Sentences first, the prompt last: as a Notification service of the release before says them.
    expect(Boolean((data[data.length - 1] as GatherInput).numDigits)).toBe(true);
  });

  test("the prompt asks for 1 or 2 in one sentence, then the call waits 10 seconds", () => {
    const prompt: GatherInput = promptOf(buildOnCallPageCallData(input()));

    expect(prompt.introMessage).toBe(ON_CALL_PAGE_CALL_PROMPT);
    expect(ON_CALL_PAGE_CALL_PROMPT).toBe(
      `Press ${ON_CALL_PAGE_CALL_ACKNOWLEDGE_DIGIT} to acknowledge, or ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT} to escalate.`,
    );
    expect(ON_CALL_PAGE_CALL_PROMPT).toBe(
      "Press 1 to acknowledge, or 2 to escalate.",
    );
    expect(prompt.numDigits).toBe(1);
    expect(prompt.timeoutInSeconds).toBe(ON_CALL_PAGE_CALL_TIMEOUT_IN_SECONDS);
    expect(ON_CALL_PAGE_CALL_TIMEOUT_IN_SECONDS).toBe(10);
  });

  test("1 answers as it always has, any other key too, and 2 from what happened", () => {
    const prompt: GatherInput = promptOf(buildOnCallPageCallData(input()));

    expect(prompt.onInputCallRequest).toEqual({
      "1": { sayMessage: "You have acknowledged this incident. Good bye" },
      default: { sayMessage: "Invalid input. Good bye" },
    });
    expect(ON_CALL_PAGE_CALL_INVALID_INPUT).toBe("Invalid input. Good bye");
    expect(getOnCallPageCallAcknowledgedMessage("alert episode")).toBe(
      "You have acknowledged this alert episode. Good bye",
    );
  });

  test("a call nobody answered says so, for what it was about, and ends", () => {
    expect(promptOf(buildOnCallPageCallData(input())).noInputMessage).toBe(
      "You did not press a key, so this incident is not acknowledged. Good bye.",
    );
    expect(getOnCallPageCallNoInputMessage("alert")).toBe(
      "You did not press a key, so this alert is not acknowledged. Good bye.",
    );
  });

  test("the key pressed goes to the page's keypad address", () => {
    expect(promptOf(buildOnCallPageCallData(input())).responseUrl).toBe(
      RESPONSE_URL,
    );
  });

  test("a 500-character title is cut for speech at a word boundary, to about 100 characters", () => {
    const title: string = "Checkout API latency above two seconds in Europe ".repeat(
      10,
    );
    const said: Say = sentencesOf(
      buildOnCallPageCallData(input({}, { title: title })),
    )[2]!;

    expect(title.length).toBeGreaterThan(450);
    expect(getSpeechCharacters(said.sayMessage).length).toBeLessThanOrEqual(
      CALL_TITLE_MAX_LENGTH,
    );
    expect(said.sayMessage.endsWith(`Europe${CALL_SPEECH_CUT_MARK}`)).toBe(
      true,
    );
  });

  test("a record with no title says no title sentence", () => {
    for (const title of [undefined, null, "", "   "]) {
      expect(
        sentencesOf(buildOnCallPageCallData(input({}, { title: title }))).map(
          (said: Say): string => {
            return said.sayMessage;
          },
        ),
      ).toEqual([
        "This is a call from Acme Production.",
        "A new Critical Incident has been created: INC-42.",
      ]);
    }
  });

  test("a record with no number carries none for the voice to spell", () => {
    const headline: Say = sentencesOf(
      buildOnCallPageCallData(input({}, { number: undefined })),
    )[1]!;

    expect(headline.recordNumber).toBeUndefined();
    expect(headline.sayMessage).toBe("A new Critical Incident has been created.");
  });

  test("a person's message: said once, after the title", () => {
    const sentences: Array<Say> = sentencesOf(
      buildOnCallPageCallData(input({ personPage: ALICE_WITH_MESSAGE })),
    );

    expect(sentences.slice(2)).toEqual([
      { sayMessage: "Checkout API is down", afterPrompt: true, repeated: true },
      {
        sayMessage: "Alice Kim says: Can you check the database?",
        afterPrompt: true,
      },
    ]);
  });

  test("each kind of record says its own noun", () => {
    for (const noun of [
      "incident",
      "alert",
      "incident episode",
      "alert episode",
    ] as Array<OnCallObserverPageRecordKind>) {
      const prompt: GatherInput = promptOf(
        buildOnCallPageCallData(input({}, { noun: noun })),
      );

      expect(prompt.noInputMessage).toBe(
        `You did not press a key, so this ${noun} is not acknowledged. Good bye.`,
      );
      expect(prompt.onInputCallRequest["1"]!.sayMessage).toBe(
        `You have acknowledged this ${noun}. Good bye`,
      );
    }
  });
});

describe("what an observer's call says, and asks", () => {
  const data: CallRequestMessage["data"] = buildOnCallPageCallData(
    input({ isObserverPage: true }),
  );

  test("who stays on it, before the prompt, said once", () => {
    expect(sentencesOf(data)).toEqual([
      { sayMessage: "This is a call from Acme Production." },
      {
        sayMessage:
          "You are paged as an observer about an incident: Critical Incident INC-42.",
        recordNumber: "INC-42",
        repeated: true,
      },
      {
        sayMessage:
          "You are kept informed: the people responding stay on this incident.",
      },
      {
        sayMessage: "Checkout API is down",
        afterPrompt: true,
        repeated: true,
      },
    ]);
  });

  test("1 says they have heard it, which acknowledges nothing, and there is no 2", () => {
    const prompt: GatherInput = promptOf(data);

    expect(prompt.introMessage).toBe(
      "To say you have heard this, press 1. This does not acknowledge the incident.",
    );
    expect(prompt.introMessage).not.toContain("press 2");
    expect(prompt.onInputCallRequest).toEqual({
      "1": { sayMessage: "Thank you. The page is marked as heard. Good bye" },
      default: { sayMessage: "Invalid input. Good bye" },
    });
  });

  test("a call nobody answered says the page is not marked as heard", () => {
    expect(promptOf(data).noInputMessage).toBe(
      ON_CALL_OBSERVER_PAGE_CALL_NO_INPUT,
    );
    expect(ON_CALL_OBSERVER_PAGE_CALL_NO_INPUT).toBe(
      "You did not press a key, so this page is not marked as heard. Good bye.",
    );
  });
});

describe("a call request travels between services as JSON", () => {
  test("what it carries for the voice is plain data an older service ignores", () => {
    const callRequest: CallRequest = {
      to: undefined as unknown as CallRequest["to"],
      data: buildOnCallPageCallData(input()),
    };
    const sent: Array<unknown> = JSON.parse(JSON.stringify(callRequest.data));

    expect(sent[1]).toEqual({
      sayMessage: "A new Critical Incident has been created: INC-42.",
      recordNumber: "INC-42",
      repeated: true,
    });
  });
});
