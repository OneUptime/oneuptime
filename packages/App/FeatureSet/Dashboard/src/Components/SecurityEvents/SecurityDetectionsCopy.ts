import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words the Detections pages share: what an empty Detection Rules
 * list says, and the way from it to the Rule Library.
 *
 * React-free so the words are pinned in a plain test.
 */

export const DETECTION_RULES_EMPTY_TITLE: string = translationKey(
  "No detection rules yet",
);

export const DETECTION_RULES_EMPTY_DESCRIPTION: string = translationKey(
  "Add ready-made rules from the Rule Library in a click, or write a Sigma rule of your own.",
);

export const OPEN_RULE_LIBRARY: string = translationKey(
  "Open the Rule Library",
);
