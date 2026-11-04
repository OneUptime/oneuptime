import {
  describeAIActionCardWords,
  isKnownAIActionCardWords,
} from "../../Types/AI/AIActionWords";
import { AIChatWidget } from "../../Types/AI/AIChatTypes";

/*
 * The card an AI action left, as its words read in English
 * (Types/AI/AIActionWords): its kind, its line and its facts - or null
 * when the card has no words the Dashboard would say in the reader's
 * language, which a test about a write tool's card should never see.
 */
export interface AIActionCardText {
  heading: string;
  kind: string;
  line?: string | undefined;
  facts: Array<{ label: string; value: string }>;
}

export const actionCardText: (
  widget: AIChatWidget | undefined,
) => AIActionCardText | null = (
  widget: AIChatWidget | undefined,
): AIActionCardText | null => {
  if (!widget || !isKnownAIActionCardWords(widget.data.words)) {
    return null;
  }

  return {
    heading: widget.data.heading || "",
    ...describeAIActionCardWords(widget.data.words),
  };
};
