import SendTestPageButton from "../OnCallTestPage/SendTestPageButton";
import { RESULT_STATUS_WORDS } from "../OnCallTestPage/OnCallTestPageWords";
import { getResultSentenceWords } from "../OnCallTestPage/TestPageResult";
import { getSetupTestPageSentEvent } from "./AskAiSetupEvents";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import {
  AIChatTestPageOffer,
  AIChatWidget,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import ObjectID from "Common/Types/ObjectID";
import { OnCallTestPageResult } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  widgets: Array<AIChatWidget>;
}

/*
 * The test page an answer that set something up offers (issue #6829): a
 * setup is done when a page reaches someone, not when a record exists, so
 * the answer ends with #6811's test page.
 *
 * Each card a setup action left says what it would test (AIChatWidgetData.
 * testPage): the on-call policy it made, or a test page to yourself for a
 * monitor you now own. The answer offers one: the policy's, when a policy
 * was made, as it tests the chain the monitor's incidents run; else a test
 * page to yourself. A policy id that is not one is never offered, and the
 * test page's own routes check the person may send it.
 */
export function getAnswerTestPageOffer(
  widgets: ReadonlyArray<AIChatWidget>,
): AIChatTestPageOffer | null {
  const offers: Array<AIChatTestPageOffer> = widgets
    .filter((widget: AIChatWidget): boolean => {
      return widget.type === AIChatWidgetType.ResourceCard;
    })
    .map((widget: AIChatWidget): AIChatTestPageOffer | undefined => {
      return widget.data?.testPage;
    })
    .filter((offer: AIChatTestPageOffer | undefined): boolean => {
      if (!offer || typeof offer !== "object") {
        return false;
      }

      if (offer.kind === "policy") {
        return (
          typeof offer.policyId === "string" &&
          ObjectID.isValidUUID(offer.policyId)
        );
      }

      return offer.kind === "self";
    }) as Array<AIChatTestPageOffer>;

  return (
    offers.find((offer: AIChatTestPageOffer): boolean => {
      return offer.kind === "policy";
    }) ||
    offers[0] ||
    null
  );
}

const AskAiTestPageOffer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [result, setResult] = useState<OnCallTestPageResult | null>(null);
  const offer: AIChatTestPageOffer | null = getAnswerTestPageOffer(
    props.widgets,
  );

  if (!offer) {
    return <></>;
  }

  return (
    <div data-testid="ask-ai-test-page-offer" className="space-y-1.5">
      <SendTestPageButton
        target={
          offer.kind === "policy"
            ? {
                kind: "policy",
                policyId: offer.policyId,
                policyName: offer.policyName,
              }
            : { kind: "self" }
        }
        /*
         * Sized to its label, in line with the cards above it: NORMAL keeps
         * a dialog footer's margin and is a phone's whole width.
         */
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        dataTestId="ask-ai-send-test-page"
        onSent={() => {
          setResult(null);
          ProductEvents.send(
            ProductEventName.AskAiSetupTestPageSent,
            getSetupTestPageSentEvent(offer),
          );
        }}
        onResult={(next: OnCallTestPageResult) => {
          setResult(next);
        }}
      />
      {/*
       * What became of it, once the dialog said: the result's headline
       * and its sentence, as the test page's own result reads them.
       */}
      {result ? (
        <p
          data-testid="ask-ai-test-page-result"
          className="text-xs leading-5 text-gray-600"
        >
          <span className="font-medium text-gray-900">
            {translator.translateText(RESULT_STATUS_WORDS[result.status].title)}
          </span>{" "}
          {getResultSentenceWords(translator, result)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default AskAiTestPageOffer;
