import {
  getAnswerTestPageOffer,
  getAnswerTestPageSent,
  isTestPageOfOffer,
  readTestPageSent,
  withAnswerTestPageSent,
} from "../../../Types/AI/AIChatTestPage";
import {
  AIChatTestPageOffer,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import {
  OnCallTestPageKind,
  OnCallTestPageResult,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TEST PAGE AN ANSWER OFFERS, AND THE ONE SENT FROM IT (#6829, #7249).
 *
 * The Dashboard draws the offer and the server records a test page sent
 * from it, both from these: the policy's offer before a test page to
 * yourself, never an id that is not one, and the run kept on the card that
 * offered it - the card the next reload, another device and the model read
 * it from.
 */

const POLICY_ID: string = "72490000-0000-4000-8000-000000000001";
const OTHER_POLICY_ID: string = "72490000-0000-4000-8000-000000000002";
const RUN_ID: string = "72490000-0000-4000-8000-000000000003";
const ME: string = "72490000-0000-4000-8000-000000000004";
const ANA: string = "72490000-0000-4000-8000-000000000005";
const SENT_AT: string = "2026-11-19T10:15:00.000Z";

function card(id: string, testPage?: unknown): AIChatWidget {
  return {
    id: id,
    type: AIChatWidgetType.ResourceCard,
    title: "Created",
    data: {
      heading: id,
      ...(testPage === undefined
        ? {}
        : { testPage: testPage as AIChatTestPageOffer }),
    },
  };
}

const MONITOR_CARD: AIChatWidget = card("W1", { kind: "self" });
const POLICY_CARD: AIChatWidget = card("W2", {
  kind: "policy",
  policyId: POLICY_ID,
  policyName: "Default on-call policy",
});

function result(
  data: Partial<OnCallTestPageResult>,
): Pick<OnCallTestPageResult, "kind" | "policyId" | "steps"> {
  return {
    kind: data.kind || OnCallTestPageKind.Policy,
    policyId: data.policyId,
    steps: data.steps || [],
  };
}

describe("the offer an answer makes", () => {
  test("is the policy's when a policy was made, else one to yourself, else none", () => {
    expect(getAnswerTestPageOffer([MONITOR_CARD, POLICY_CARD])).toEqual({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
    });
    expect(getAnswerTestPageOffer([MONITOR_CARD])).toEqual({ kind: "self" });
    expect(getAnswerTestPageOffer([card("W1")])).toBeNull();
    expect(getAnswerTestPageOffer([])).toBeNull();
    expect(getAnswerTestPageOffer(undefined)).toBeNull();
  });

  test("is never an id that is not one, a kind no card offers, or a widget that is not a card", () => {
    expect(
      getAnswerTestPageOffer([
        card("W1", { kind: "policy", policyId: "javascript:alert(1)" }),
        card("W2", { kind: "member", userId: ANA }),
        {
          id: "W3",
          type: AIChatWidgetType.Table,
          title: "t",
          data: { testPage: { kind: "self" } },
        },
      ]),
    ).toBeNull();
  });
});

describe("a test page sent from it, kept on the answer", () => {
  test("is recorded on the card that offers it, and on no other", () => {
    const widgets: Array<AIChatWidget> | null = withAnswerTestPageSent(
      [MONITOR_CARD, POLICY_CARD],
      { executionLogId: RUN_ID, sentAt: SENT_AT },
    );

    expect(widgets).not.toBeNull();
    expect(widgets![0]).toEqual(MONITOR_CARD);
    expect(widgets![1]!.data.testPage).toEqual({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
      sent: { executionLogId: RUN_ID, sentAt: SENT_AT },
    });
    // The card's other words are kept.
    expect(widgets![1]!.data.heading).toBe("W2");
    // The answer's own widgets are left as they were.
    expect(POLICY_CARD.data.testPage).not.toHaveProperty("sent");

    expect(getAnswerTestPageSent(widgets)).toEqual({
      executionLogId: RUN_ID,
      sentAt: SENT_AT,
    });
    expect(getAnswerTestPageSent([MONITOR_CARD, POLICY_CARD])).toBeNull();
  });

  test("a later test page takes the earlier one's place", () => {
    const LATER_RUN: string = "72490000-0000-4000-8000-000000000009";
    const first: Array<AIChatWidget> = withAnswerTestPageSent([MONITOR_CARD], {
      executionLogId: RUN_ID,
      sentAt: SENT_AT,
    })!;
    const second: Array<AIChatWidget> = withAnswerTestPageSent(first, {
      executionLogId: LATER_RUN,
      sentAt: "2026-11-19T10:20:00.000Z",
    })!;

    expect(getAnswerTestPageSent(second)).toEqual({
      executionLogId: LATER_RUN,
      sentAt: "2026-11-19T10:20:00.000Z",
    });
    expect(second).toHaveLength(1);
  });

  test("an answer that offers none takes none", () => {
    expect(
      withAnswerTestPageSent([card("W1")], {
        executionLogId: RUN_ID,
        sentAt: SENT_AT,
      }),
    ).toBeNull();
  });

  test("only a run's id and a date are read back as one", () => {
    expect(
      readTestPageSent({ executionLogId: RUN_ID, sentAt: SENT_AT }),
    ).toEqual({ executionLogId: RUN_ID, sentAt: SENT_AT });
    expect(
      readTestPageSent({ executionLogId: "1; drop", sentAt: SENT_AT }),
    ).toBe(null);
    expect(readTestPageSent({ executionLogId: RUN_ID, sentAt: "" })).toBeNull();
    expect(readTestPageSent({ executionLogId: RUN_ID })).toBeNull();
    expect(readTestPageSent("x")).toBeNull();
    expect(readTestPageSent(null)).toBeNull();
    // Nothing but the two is kept.
    expect(
      readTestPageSent({
        executionLogId: RUN_ID,
        sentAt: SENT_AT,
        html: "<b>",
      }),
    ).toEqual({ executionLogId: RUN_ID, sentAt: SENT_AT });
  });
});

describe("the run recorded is the test page the answer offers", () => {
  const policyOffer: AIChatTestPageOffer = {
    kind: "policy",
    policyId: POLICY_ID,
  };

  test("the policy's offer takes that policy's test, and no other", () => {
    expect(
      isTestPageOfOffer({
        offer: policyOffer,
        result: result({ policyId: POLICY_ID }),
        userId: ME,
      }),
    ).toBe(true);
    expect(
      isTestPageOfOffer({
        offer: policyOffer,
        result: result({ policyId: OTHER_POLICY_ID }),
        userId: ME,
      }),
    ).toBe(false);
    expect(
      isTestPageOfOffer({
        offer: policyOffer,
        result: result({ kind: OnCallTestPageKind.Self }),
        userId: ME,
      }),
    ).toBe(false);
  });

  test("the offer to yourself takes a test page that paged only you", () => {
    const step: OnCallTestPageResult["steps"][number] = {
      id: "s1",
      userId: ME,
      status: "Paged" as never,
      statusMessage: "",
      deliveries: [],
    };

    expect(
      isTestPageOfOffer({
        offer: { kind: "self" },
        result: result({ kind: OnCallTestPageKind.Self, steps: [step] }),
        userId: ME,
      }),
    ).toBe(true);
    expect(
      isTestPageOfOffer({
        offer: { kind: "self" },
        result: result({
          kind: OnCallTestPageKind.Self,
          steps: [{ ...step, userId: ANA }],
        }),
        userId: ME,
      }),
    ).toBe(false);
    expect(
      isTestPageOfOffer({
        offer: { kind: "self" },
        result: result({ kind: OnCallTestPageKind.Member, steps: [step] }),
        userId: ME,
      }),
    ).toBe(false);
    expect(
      isTestPageOfOffer({
        offer: { kind: "self" },
        result: result({
          kind: OnCallTestPageKind.Policy,
          policyId: POLICY_ID,
        }),
        userId: ME,
      }),
    ).toBe(false);
  });
});
