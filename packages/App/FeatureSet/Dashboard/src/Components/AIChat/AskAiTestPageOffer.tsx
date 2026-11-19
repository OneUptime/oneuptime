import OnCallTestPageApi from "../OnCallTestPage/OnCallTestPageApi";
import SendTestPageButton from "../OnCallTestPage/SendTestPageButton";
import { RESULT_STATUS_WORDS } from "../OnCallTestPage/OnCallTestPageWords";
import {
  TEST_PAGE_RESULT_POLL_GRACE_IN_MS,
  TEST_PAGE_RESULT_POLL_INTERVAL_IN_MS,
  getResultSentenceWords,
} from "../OnCallTestPage/TestPageResult";
import { getSetupTestPageSentEvent } from "./AskAiSetupEvents";
import { recordAnswerTestPage } from "./AskAiTestPageRecord";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import {
  getAnswerTestPageOffer,
  readTestPageSent,
} from "Common/Types/AI/AIChatTestPage";
import {
  AIChatTestPageOffer,
  AIChatTestPageSent,
  AIChatWidget,
} from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import {
  OnCallTestPageResult,
  isOnCallTestPageResultFinal,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The test page an answer that set something up offers (issue #6829): a
 * setup is done when a page reaches someone, not when a record exists, so
 * the answer ends with #6811's test page - the policy's, when a policy was
 * made, else one to yourself (Common/Types/AI/AIChatTestPage picks it, as
 * the server does).
 *
 * Once one is sent, it is kept on the answer (#7249): its run is recorded
 * there, so the line under the button still says what became of it after a
 * reload and on another device - read again every few seconds until it is
 * acknowledged or over, as the test page's own result is - and the model
 * reads it in the next turn.
 */
export { getAnswerTestPageOffer };

export interface ComponentProps {
  widgets: Array<AIChatWidget>;
  // The answer's id: a test page sent from it is recorded on it.
  messageId?: string | undefined;
  // For tests: how often to ask again.
  pollIntervalInMs?: number | undefined;
}

const AskAiTestPageOffer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [result, setResult] = useState<OnCallTestPageResult | null>(null);
  // A test page sent from here in this session: its run.
  const [sentHere, setSentHere] = useState<string>("");
  // While its dialog is open, the dialog reads the result and says it.
  const [isDialogReading, setIsDialogReading] = useState<boolean>(false);
  const offer: AIChatTestPageOffer | null = getAnswerTestPageOffer(
    props.widgets,
  );
  const recorded: AIChatTestPageSent | null = readTestPageSent(offer?.sent);
  const executionLogId: string = sentHere || recorded?.executionLogId || "";

  /*
   * What became of the test page sent from this answer, read as the test
   * page's own result reads it: again every few seconds while it pages, and
   * not after it is acknowledged or over - nor while its dialog says it.
   */
  useEffect(() => {
    if (!executionLogId || isDialogReading) {
      return;
    }

    let isActive: boolean = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const read: () => Promise<void> = async (): Promise<void> => {
      let next: OnCallTestPageResult | null = null;

      try {
        next = await OnCallTestPageApi.getResult(executionLogId);
      } catch {
        // A run that can't be read is not drawn: the button is still there.
        return;
      }

      if (!isActive || !next || !RESULT_STATUS_WORDS[next.status]) {
        return;
      }

      setResult(next);

      const isOver: boolean =
        isOnCallTestPageResultFinal(next) ||
        !next.endsAt ||
        Date.now() >
          OneUptimeDate.fromString(next.endsAt).getTime() +
            TEST_PAGE_RESULT_POLL_GRACE_IN_MS;

      if (!isOver) {
        timer = setTimeout(
          read,
          props.pollIntervalInMs || TEST_PAGE_RESULT_POLL_INTERVAL_IN_MS,
        );
      }
    };

    void read();

    return () => {
      isActive = false;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [executionLogId, isDialogReading]);

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
        onSent={(sentExecutionLogId: string) => {
          setResult(null);
          setSentHere(sentExecutionLogId);
          setIsDialogReading(true);
          ProductEvents.send(
            ProductEventName.AskAiSetupTestPageSent,
            getSetupTestPageSentEvent(offer),
          );

          if (props.messageId) {
            recordAnswerTestPage({
              messageId: props.messageId,
              executionLogId: sentExecutionLogId,
            }).catch(() => {
              // The line still says it here; only a reload forgets it.
            });
          }
        }}
        onResult={(next: OnCallTestPageResult) => {
          setResult(next);
        }}
        onClose={() => {
          setIsDialogReading(false);
        }}
      />
      {/*
       * What became of it: the result's headline and its sentence, as the
       * test page's own result reads them.
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
