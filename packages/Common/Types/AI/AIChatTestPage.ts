import {
  AIChatTestPageOffer,
  AIChatTestPageSent,
  AIChatWidget,
  AIChatWidgetType,
} from "./AIChatTypes";
import OneUptimeDate from "../Date";
import ObjectID from "../ObjectID";
import {
  OnCallTestPageKind,
  OnCallTestPageResult,
} from "../OnCallDutyPolicy/OnCallTestPage";

/*
 * THE TEST PAGE AN ANSWER OFFERS, AND THE ONE SENT FROM IT (#6829, #7249).
 *
 * A setup is done when a page reaches someone, not when a record exists, so
 * an answer that set something up ends with #6811's test page. Each card a
 * setup action left says what it would test (AIChatWidgetData.testPage):
 * the on-call policy it made, or a test page to yourself for a monitor you
 * now own. The answer offers one: the policy's, when a policy was made, as
 * it tests the chain the monitor's incidents run; else a test page to
 * yourself. A policy id that is not one is never offered, and the test
 * page's own routes check the person may send it.
 *
 * Once it is sent, its run is recorded on the card that offered it (`sent`,
 * POST /ai-chat/message-test-page): the Dashboard draws what became of it
 * from there after a reload, and the model reads it in the next turn. The
 * Dashboard and the server pick the offer here, so they never pick two.
 */

interface OfferOnCard {
  offer: AIChatTestPageOffer;
  // The card's place among the answer's widgets.
  index: number;
}

function isOffer(value: unknown): value is AIChatTestPageOffer {
  if (!value || typeof value !== "object") {
    return false;
  }

  const offer: AIChatTestPageOffer = value as AIChatTestPageOffer;

  if (offer.kind === "policy") {
    return (
      typeof offer.policyId === "string" && ObjectID.isValidUUID(offer.policyId)
    );
  }

  return offer.kind === "self";
}

function getOfferOnCard(
  widgets: ReadonlyArray<AIChatWidget> | null | undefined,
): OfferOnCard | null {
  const offers: Array<OfferOnCard> = [];

  (widgets || []).forEach((widget: AIChatWidget, index: number): void => {
    const offer: unknown =
      widget && widget.type === AIChatWidgetType.ResourceCard
        ? widget.data?.testPage
        : undefined;

    if (isOffer(offer)) {
      offers.push({ offer: offer, index: index });
    }
  });

  return (
    offers.find((found: OfferOnCard): boolean => {
      return found.offer.kind === "policy";
    }) ||
    offers[0] ||
    null
  );
}

// The test page an answer offers, from the cards its setup actions left.
export function getAnswerTestPageOffer(
  widgets: ReadonlyArray<AIChatWidget> | null | undefined,
): AIChatTestPageOffer | null {
  return getOfferOnCard(widgets)?.offer || null;
}

// A run recorded on an offer, when it is one: a run's id and an ISO date.
export function readTestPageSent(value: unknown): AIChatTestPageSent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const sent: AIChatTestPageSent = value as AIChatTestPageSent;

  if (
    typeof sent.executionLogId !== "string" ||
    !ObjectID.isValidUUID(sent.executionLogId) ||
    typeof sent.sentAt !== "string" ||
    !sent.sentAt ||
    !OneUptimeDate.isValidDateString(sent.sentAt)
  ) {
    return null;
  }

  return { executionLogId: sent.executionLogId, sentAt: sent.sentAt };
}

// The test page sent from an answer's offer, when one was.
export function getAnswerTestPageSent(
  widgets: ReadonlyArray<AIChatWidget> | null | undefined,
): AIChatTestPageSent | null {
  return readTestPageSent(getAnswerTestPageOffer(widgets)?.sent);
}

/*
 * The answer's widgets with a test page recorded on the card that offers
 * it - a later one in place of an earlier - or null when no card offers
 * one. The widgets given are left as they are.
 */
export function withAnswerTestPageSent(
  widgets: ReadonlyArray<AIChatWidget> | null | undefined,
  sent: AIChatTestPageSent,
): Array<AIChatWidget> | null {
  const found: OfferOnCard | null = getOfferOnCard(widgets);

  if (!found || !widgets) {
    return null;
  }

  return widgets.map((widget: AIChatWidget, index: number): AIChatWidget => {
    if (index !== found.index) {
      return widget;
    }

    return {
      ...widget,
      data: {
        ...widget.data,
        testPage: {
          ...found.offer,
          sent: { executionLogId: sent.executionLogId, sentAt: sent.sentAt },
        },
      },
    };
  });
}

/*
 * Whether a test page's run is the one an answer offers: the policy's own
 * test, or a test page to the person themselves - every person it paged is
 * them.
 */
export function isTestPageOfOffer(data: {
  offer: AIChatTestPageOffer;
  result: Pick<OnCallTestPageResult, "kind" | "policyId" | "steps">;
  userId: string;
}): boolean {
  if (data.offer.kind === "policy") {
    return (
      data.result.kind === OnCallTestPageKind.Policy &&
      data.result.policyId === data.offer.policyId
    );
  }

  return (
    data.result.kind === OnCallTestPageKind.Self &&
    (data.result.steps || []).every(
      (step: OnCallTestPageResult["steps"][number]): boolean => {
        return !step.userId || step.userId === data.userId;
      },
    )
  );
}
