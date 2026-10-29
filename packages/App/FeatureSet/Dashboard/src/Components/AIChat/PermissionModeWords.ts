import AIChatPermissionMode from "Common/Types/AI/AIChatPermissionMode";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a permission mode means, in one short sentence. The permission menu
 * (PermissionModePicker) says it under each mode's name, in Ask AI and on
 * the AI Investigation card, and the card's composer says it beside the
 * picker for the mode chosen. The picker names the mode and the box is for
 * asking OneUptime AI, so the sentence does not say who acts again: without
 * that it fits on the picker's row in the two-thirds column of a 1280px
 * page. English keys: whoever draws one translates it.
 *
 * React-free on purpose: the card's conversation data
 * (InvestigationConversationData) hands it on, and suites that load that
 * module run without React.
 */
export function describePermissionMode(mode: AIChatPermissionMode): string {
  switch (mode) {
    case AIChatPermissionMode.AutoRun:
      return translationKey(
        "Acts on clear requests right away, within your permissions.",
      );
    case AIChatPermissionMode.AskForApproval:
      return translationKey("Asks for approval before it changes anything.");
    case AIChatPermissionMode.ReadOnly:
      return translationKey(
        "Only reads and answers. It never changes anything.",
      );
    default:
      return "";
  }
}
