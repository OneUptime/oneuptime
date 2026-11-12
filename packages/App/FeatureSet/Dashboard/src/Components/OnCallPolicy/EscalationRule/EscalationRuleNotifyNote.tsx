import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * UNDER AN ESCALATION RULE'S NOTIFY FIELD: WHAT THE RULE DECIDES, AND WHAT
 * IT DOES NOT.
 *
 * #3254 looked for the order of channels - SMS first, then a call - on this
 * form. A rule says who is paged and how long their level has; how each
 * person is reached, by which method and after how long, is each person's
 * own ladder (How to Reach Me, #6820). One line says so, with the link.
 *
 * And on a new rule after the first, when this level is paged (#7373): the
 * wait before it belongs to the level before it, and "Escalate after" on
 * this form is how long THIS level has before the next one. Without the
 * line, a newcomer adding a teammate to page "after 5 minutes" typed 5 into
 * the wrong rule.
 */

export const HOW_EACH_PERSON_IS_REACHED: string = translationKey(
  "This rule says who is paged. How each person is reached, by which method and after how long, is their own {{howToReachMe}}.",
);

export const HOW_TO_REACH_ME_LINK_TEXT: string =
  translationKey("How to Reach Me");

export const PAGED_AFTER_PREVIOUS_LEVEL: PluralTemplate = {
  one: "This level is paged {{count}} minute after {{level}}, if nobody acknowledges {{level}}. That wait is set on {{level}}.",
  other:
    "This level is paged {{count}} minutes after {{level}}, if nobody acknowledges {{level}}. That wait is set on {{level}}.",
};

export const PAGED_WITH_PREVIOUS_LEVEL: string = translationKey(
  "This level is paged at the same time as {{level}}, which waits 0 minutes. That wait is set on {{level}}.",
);

export const ESCALATION_RULE_NOTIFY_NOTE_TEST_ID: string =
  "escalation-rule-notify-note";

export interface PreviousEscalationLevel {
  // As the rules list names it: its own name, or "Level 1".
  name: string;
  escalateAfterInMinutes: number;
}

export interface ComponentProps {
  // A new rule after the first: the level before it.
  previousLevel?: PreviousEscalationLevel | undefined;
}

// "This level is paged 30 minutes after Level 1, ...", or "" for the first level.
export const describeWhenLevelIsPaged: (
  translator: Translator,
  previousLevel: PreviousEscalationLevel | undefined,
) => string = (
  translator: Translator,
  previousLevel: PreviousEscalationLevel | undefined,
): string => {
  if (!previousLevel) {
    return "";
  }

  if (!previousLevel.escalateAfterInMinutes) {
    return translator.translateTemplate(PAGED_WITH_PREVIOUS_LEVEL, {
      level: previousLevel.name,
    });
  }

  return translator.translatePlural(
    PAGED_AFTER_PREVIOUS_LEVEL,
    previousLevel.escalateAfterInMinutes,
    { level: previousLevel.name },
  );
};

const EscalationRuleNotifyNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const whenPaged: string = describeWhenLevelIsPaged(
    translator,
    props.previousLevel,
  );

  return (
    <div
      className="mt-2 flex flex-col gap-1.5 text-sm text-gray-500"
      data-testid={ESCALATION_RULE_NOTIFY_NOTE_TEST_ID}
    >
      {whenPaged ? (
        <p data-testid="escalation-rule-when-paged">{whenPaged}</p>
      ) : (
        <></>
      )}
      <p>
        <TranslatedSentence
          template={HOW_EACH_PERSON_IS_REACHED}
          slots={{
            howToReachMe: (
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route,
                )}
                className="font-medium text-indigo-600 hover:text-indigo-500"
              >
                {translator.translateText(HOW_TO_REACH_ME_LINK_TEXT)}
              </Link>
            ),
          }}
        />
      </p>
    </div>
  );
};

export default EscalationRuleNotifyNote;
