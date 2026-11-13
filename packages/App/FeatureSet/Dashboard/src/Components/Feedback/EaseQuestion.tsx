import FeedbackWhereItGoes from "./FeedbackWhereItGoes";
import { getFeedbackGitHubIssueUrl } from "./FeedbackPage";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH,
  PRODUCT_FEEDBACK_SCORES,
  ProductFeedbackKind,
} from "Common/Types/ProductFeedback/ProductFeedback";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Icon from "Common/UI/Components/Icon/Icon";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { BILLING_ENABLED } from "Common/UI/Config";
import ProductFeedback from "Common/UI/Utils/ProductFeedback";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

/*
 * "HOW EASY WAS THAT?" (issue #6832): the one question at the end of a
 * guided setup, drawn once by GuidedSetupFrame for every setup.
 *
 * One line and five numbers, 1 (very hard) to 5 (very easy). One press
 * answers it: the score is kept at once (ProductFeedback, kind setup_flow,
 * the setup's key as the topic), and only then does an optional box ask
 * "What got in the way?". Nothing here blocks anything: the X puts it
 * away, and so does "Don't ask me again", which switches every question
 * off for this person (User Profile shows the same switch).
 *
 * On a self-hosted server, words sent can also go to OneUptime on GitHub:
 * a pre-filled issue the person reads there before sending, or not.
 */

export const EASE_QUESTION_TEST_ID: string = "ease-question";
export const EASE_QUESTION_SCORE_TEST_ID: string = "ease-question-score";
export const EASE_QUESTION_DETAILS_TEST_ID: string = "ease-question-details";
export const EASE_QUESTION_SEND_TEST_ID: string = "ease-question-send";
export const EASE_QUESTION_THANKS_TEST_ID: string = "ease-question-thanks";
export const EASE_QUESTION_CLOSE_TEST_ID: string = "ease-question-close";
export const EASE_QUESTION_STOP_ASKING_TEST_ID: string =
  "ease-question-stop-asking";
export const EASE_QUESTION_GITHUB_TEST_ID: string = "ease-question-github";
export const EASE_QUESTION_FAILED_TEST_ID: string = "ease-question-failed";

export interface ComponentProps {
  // The setup's key: "website_down".
  setup: string;
  /*
   * The setup reached its end ("How easy was that?"), or the person opened
   * the question before it did ("Stuck?": "How easy is this so far?").
   */
  isFinished: boolean;
  // OneUptime asked (rather than the person opening it): offers "Don't ask me again".
  isAsked: boolean;
  onClose: () => void;
}

type Stage = "score" | "details" | "sent";

/*
 * From this score up the setup was easy, and the box asks what could be
 * easier rather than what got in the way (the first walkthrough, #6832).
 */
export const EASY_SCORE: number = 4;

// One of the five numbers, and what it does under the pointer.
const SCORE_CLASS_NAME: string =
  "h-10 w-10 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const SCORE_HOVER_CLASS_NAME: string =
  "hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700";

const EaseQuestion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const questionId: string = useId();
  const [stage, setStage] = useState<Stage>("score");
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [details, setDetails] = useState<string>("");
  const [sentDetails, setSentDetails] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [hasFailed, setHasFailed] = useState<boolean>(false);
  // The score given: an easy one is not asked what got in the way.
  const [score, setScore] = useState<number>(0);

  /*
   * A score's look. While the answer is sent the scores are busy, not
   * locked: they keep their look, without the hover (ButtonStates).
   */
  const scoreClassName: string = `${SCORE_CLASS_NAME} ${getHandDrawnButtonStateClassName(
    { isBusy: isSending, hoverClassName: SCORE_HOVER_CLASS_NAME },
  )}`;

  const answer: (score: number) => Promise<void> = async (
    score: number,
  ): Promise<void> => {
    setIsSending(true);
    setHasFailed(false);

    const id: string | null = await ProductFeedback.submit({
      kind: ProductFeedbackKind.SetupFlow,
      topic: props.setup,
      score: score,
    });

    setIsSending(false);

    if (id === null) {
      setHasFailed(true);
      return;
    }

    setAnswerId(id);
    setScore(score);
    setStage("details");
  };

  const sendDetails: () => Promise<void> = async (): Promise<void> => {
    if (!answerId || !details.trim()) {
      return;
    }

    setIsSending(true);
    setHasFailed(false);

    const isAdded: boolean = await ProductFeedback.addDetails({
      answerId: answerId,
      details: details,
    });

    setIsSending(false);

    if (!isAdded) {
      setHasFailed(true);
      return;
    }

    setSentDetails(details.trim());
    setStage("sent");
  };

  const question: string = props.isFinished
    ? translator.translateText("How easy was that?") || ""
    : translator.translateText("How easy is this so far?") || "";

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4"
      data-testid={EASE_QUESTION_TEST_ID}
      aria-labelledby={questionId}
    >
      <div className="flex items-start justify-between gap-3">
        <p id={questionId} className="text-sm font-semibold text-gray-900">
          {stage === "score"
            ? question
            : stage === "details"
              ? score >= EASY_SCORE
                ? translator.translateText(
                    "Thanks. Anything we could make easier?",
                  )
                : translator.translateText("Thanks. What got in the way?")
              : translator.translateText("Thanks for telling us.")}
        </p>
        <button
          type="button"
          className="-m-1 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={translator.translateText("Close") || ""}
          data-testid={EASE_QUESTION_CLOSE_TEST_ID}
          onClick={props.onClose}
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      </div>

      {stage === "score" ? (
        <div className="mt-3 inline-flex flex-col">
          <div className="flex gap-2" role="group" aria-labelledby={questionId}>
            {PRODUCT_FEEDBACK_SCORES.map((score: number): ReactElement => {
              return (
                <button
                  key={score}
                  type="button"
                  disabled={isSending}
                  className={scoreClassName}
                  data-testid={`${EASE_QUESTION_SCORE_TEST_ID}-${score}`}
                  onClick={() => {
                    void answer(score);
                  }}
                >
                  {translator.formatNumber(score)}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between gap-4 text-xs text-gray-500">
            <span>{translator.translateText("Very hard")}</span>
            <span>{translator.translateText("Very easy")}</span>
          </div>
        </div>
      ) : (
        <></>
      )}

      {stage === "details" ? (
        <div className="mt-3 space-y-3">
          <TextArea
            value={details}
            onChange={(value: string) => {
              setDetails(value.slice(0, PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH));
            }}
            placeholder="Optional: what was hard, missing or confusing?"
            ariaLabelledby={questionId}
            autoGrow={true}
            rows={2}
            maxRows={6}
            dataTestId={EASE_QUESTION_DETAILS_TEST_ID}
          />
          <Button
            title="Send"
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            disabled={!details.trim() || isSending}
            isLoading={isSending}
            dataTestId={EASE_QUESTION_SEND_TEST_ID}
            onClick={() => {
              void sendDetails();
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {stage === "sent" ? (
        <div
          className="mt-2 space-y-2"
          data-testid={EASE_QUESTION_THANKS_TEST_ID}
        >
          {!BILLING_ENABLED && sentDetails ? (
            <a
              href={getFeedbackGitHubIssueUrl({
                details: sentDetails,
                page: ProductFeedback.getPage(),
                version: ProductFeedback.getVersion(),
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
              data-testid={EASE_QUESTION_GITHUB_TEST_ID}
            >
              {translator.translateText("Also tell OneUptime on GitHub")}
              <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
            </a>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      {hasFailed ? (
        <p
          className="mt-2 text-sm text-red-700"
          role="alert"
          data-testid={EASE_QUESTION_FAILED_TEST_ID}
        >
          {translator.translateText(
            "Your answer could not be sent. Check your connection, then try again.",
          )}
        </p>
      ) : (
        <></>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <FeedbackWhereItGoes />
        {props.isAsked && stage === "score" ? (
          <button
            type="button"
            className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid={EASE_QUESTION_STOP_ASKING_TEST_ID}
            onClick={() => {
              void ProductFeedback.stopAsking();
              props.onClose();
            }}
          >
            {translator.translateText("Don't ask me again")}
          </button>
        ) : (
          <></>
        )}
      </div>
    </section>
  );
};

export default EaseQuestion;
