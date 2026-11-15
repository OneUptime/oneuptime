import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import {
  AiRunRefusalCode,
  readAiRunRefusalCode,
} from "Common/Types/AI/AiRunRefusal";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { describeAiRunRefusal } from "../AI/AiRunFailureWords";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHY AN AI INSIGHT'S CONFIRM, DISMISS, RESOLVE OR REOPEN DID NOT SAVE, IN
 * THE READER'S LANGUAGE (#8052).
 *
 * The insight's page showed the server's answer as the server wrote it:
 * "AI insight not found (or you do not have access to it)." in English on
 * a German, Arabic or Persian page, once the insight was deleted in
 * another tab. The server refuses those actions with a code beside its
 * English sentence (Types/AI/AiRunRefusal), as it does a triage's Try
 * again; the page keeps both, and says the code's sentence in the
 * reader's language when it draws the line (describeAiRunRefusal) - so a
 * language switch rewords it too. An answer with no code - another
 * server's, a malformed request's - is worded when the Dashboard words
 * that very sentence, and said as written otherwise. The Alert reads the
 * line the way it is written: a worded one from the right on an Arabic
 * page, an English one from the left.
 */

export interface InsightActionRefusal {
  // The server's message, as it wrote it.
  message: string;
  // The refusal's code beside it, when the server sent one this page knows.
  refusalCode: AiRunRefusalCode | null;
}

// What a failed action's answer said: its message, and its code if any.
export function readInsightActionRefusal(err: unknown): InsightActionRefusal {
  return {
    message: API.getFriendlyMessage(err),
    refusalCode:
      err instanceof HTTPErrorResponse ? readAiRunRefusalCode(err.data) : null,
  };
}

// The line in the reader's language.
export function describeInsightActionRefusal(
  refusal: InsightActionRefusal,
  translator: Translator,
): string {
  return describeAiRunRefusal(refusal.message, translator, refusal.refusalCode);
}

export interface ComponentProps {
  refusal: InsightActionRefusal;
}

const InsightActionError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Alert
      type={AlertType.DANGER}
      strongTitle="Could not save your action"
      title={describeInsightActionRefusal(props.refusal, translator)}
      dataTestId="ai-insight-action-error"
    />
  );
};

export default InsightActionError;
