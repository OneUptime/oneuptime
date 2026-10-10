import IconProp from "Common/Types/Icon/IconProp";
import { LlmMonitorTemplateId } from "Common/Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of each AI alert template (LlmMonitorTemplates in Common holds
 * what it does): the card on the Alerts tab, and the name and alert text
 * of the monitor it creates. Wrapped in translationKey() so the extractor
 * finds them; looked up where they are shown, in the reader's language.
 */

export interface LlmMonitorTemplateCopy {
  // The card's title: what goes wrong, in a few words.
  title: string;
  // One sentence: when it tells you.
  description: string;
  // The monitor's name, and the title of the alert it raises.
  monitorName: string;
  // The monitor's description: what it watches, as one sentence.
  monitorDescription: string;
  // What the alert says.
  alertDescription: string;
  icon: IconProp;
  // The card's icon tile and icon colours.
  iconTileClassName: string;
  iconClassName: string;
}

export const LLM_MONITOR_TEMPLATE_COPY: Record<
  LlmMonitorTemplateId,
  LlmMonitorTemplateCopy
> = {
  [LlmMonitorTemplateId.BadAnswers]: {
    title: translationKey("Answers go wrong"),
    description: translationKey(
      "When more than 5% of answers in 15 minutes fail, are refused, cut off, empty or flagged.",
    ),
    monitorName: translationKey("AI answers are going wrong"),
    monitorDescription: translationKey(
      "Alerts you when more than 5% of the AI's answers in 15 minutes fail, are refused, cut off, empty or flagged.",
    ),
    alertDescription: translationKey(
      "More than 5% of the AI's answers in the last 15 minutes had a problem.",
    ),
    icon: IconProp.Alert,
    iconTileClassName: "bg-amber-50",
    iconClassName: "text-amber-600",
  },
  [LlmMonitorTemplateId.FailedCalls]: {
    title: translationKey("AI calls fail"),
    description: translationKey(
      "When more than 10% of calls to the model in 5 minutes end in an error, like an outage or a rate limit.",
    ),
    monitorName: translationKey("AI calls are failing"),
    monitorDescription: translationKey(
      "Alerts you when more than 10% of the calls to the model in 5 minutes end in an error.",
    ),
    alertDescription: translationKey(
      "More than 10% of the calls to the model in the last 5 minutes ended in an error.",
    ),
    icon: IconProp.Error,
    iconTileClassName: "bg-red-50",
    iconClassName: "text-red-600",
  },
  [LlmMonitorTemplateId.Refusals]: {
    title: translationKey("The AI refuses to answer"),
    description: translationKey(
      "When more than 5% of answers in 30 minutes are refusals or blocked by a safety filter.",
    ),
    monitorName: translationKey("The AI is refusing to answer"),
    monitorDescription: translationKey(
      "Alerts you when more than 5% of the AI's answers in 30 minutes are refusals.",
    ),
    alertDescription: translationKey(
      "More than 5% of the AI's answers in the last 30 minutes were refusals.",
    ),
    icon: IconProp.Stop,
    iconTileClassName: "bg-amber-50",
    iconClassName: "text-amber-600",
  },
  [LlmMonitorTemplateId.CutOffAnswers]: {
    title: translationKey("Answers are cut off"),
    description: translationKey(
      "When 3 or more answers in 30 minutes stop at the token limit, usually because max tokens is too low.",
    ),
    monitorName: translationKey("AI answers are cut off"),
    monitorDescription: translationKey(
      "Alerts you when 3 or more of the AI's answers in 30 minutes stop at the token limit.",
    ),
    alertDescription: translationKey(
      "3 or more of the AI's answers in the last 30 minutes stopped at the token limit.",
    ),
    icon: IconProp.Scissors,
    iconTileClassName: "bg-orange-50",
    iconClassName: "text-orange-600",
  },
  [LlmMonitorTemplateId.FlaggedAnswers]: {
    title: translationKey("Answers are flagged"),
    description: translationKey(
      "As soon as an evaluation your app sends, like a guardrail or a thumbs-down, marks an answer as bad.",
    ),
    monitorName: translationKey("AI answers are flagged"),
    monitorDescription: translationKey(
      "Alerts you when an evaluation your app sends marks one of the AI's answers as bad.",
    ),
    alertDescription: translationKey(
      "An evaluation marked one of the AI's answers in the last 15 minutes as bad.",
    ),
    icon: IconProp.HandThumbDown,
    iconTileClassName: "bg-violet-50",
    iconClassName: "text-violet-600",
  },
  [LlmMonitorTemplateId.SlowAnswers]: {
    title: translationKey("Answers are slow"),
    description: translationKey(
      "When more than 10% of answers in 15 minutes take longer than 30 seconds.",
    ),
    monitorName: translationKey("AI answers are slow"),
    monitorDescription: translationKey(
      "Alerts you when more than 10% of the AI's answers in 15 minutes take longer than 30 seconds.",
    ),
    alertDescription: translationKey(
      "More than 10% of the AI's answers in the last 15 minutes took longer than 30 seconds.",
    ),
    icon: IconProp.Clock,
    iconTileClassName: "bg-sky-50",
    iconClassName: "text-sky-600",
  },
  [LlmMonitorTemplateId.NoAnswers]: {
    title: translationKey("The AI stops answering"),
    description: translationKey(
      "When your AI gives no answers for 30 minutes. For apps that are always busy.",
    ),
    monitorName: translationKey("The AI stopped answering"),
    monitorDescription: translationKey(
      "Alerts you when the AI gives no answers for 30 minutes.",
    ),
    alertDescription: translationKey(
      "The AI gave no answers in the last 30 minutes.",
    ),
    icon: IconProp.ChatBubbleLeftRight,
    iconTileClassName: "bg-gray-100",
    iconClassName: "text-gray-600",
  },
};
