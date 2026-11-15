import { StoredRuleUpdates } from "Common/Types/Workspace/NotificationRules/NotificationRuleUpdates";
import {
  getInlineSeparator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getUpdatesSummary,
  UpdatesEventType,
  UpdatesSummary,
} from "../NotificationRuleForm/NotificationRuleUpdatesCopy";

/*
 * Which updates a rule posts, on its card (issue #7581):
 *
 *   Updates   Key updates only
 *             Resolved and reopened · Severity changes · Public notes
 *
 *   Updates   Private notes · Paging
 *
 *   Updates   Only when an incident is declared or a video call starts
 *
 * The answer it picked on its Updates step and the updates it posts; a rule
 * that ticked its own boxes is said by its updates alone. The card shows
 * the row only for a rule that leaves some updates out: every other rule
 * posts every update, as rules always did. An on-call policy rule's card
 * always shows it (#7549): a new one starts on Key updates only, so one
 * saved before, which posts every update, says "Every update".
 *
 * Each update stays whole on its line, the mark after it with it: a narrow
 * card breaks the list between two updates, never inside one ("Änderungen
 * des / Schweregrads") or with a mark at the start of a line.
 */

export interface ComponentProps {
  rule: StoredRuleUpdates;
  eventType: UpdatesEventType;
}

const UpdatesRuleSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const summary: UpdatesSummary = getUpdatesSummary({
    rule: props.rule,
    eventType: props.eventType,
    translator: translator,
  });

  // " · ", or " • " where the zero is a dot (Persian).
  const mark: string = getInlineSeparator(translator.language).trim();
  const lastIndex: number = summary.updates.length - 1;

  return (
    <div className="text-sm" data-testid="notification-rule-updates-summary">
      {summary.title ? (
        <p
          className="text-gray-700"
          data-testid="notification-rule-updates-summary-title"
        >
          {summary.title}
        </p>
      ) : (
        <></>
      )}
      {summary.updates.length > 0 ? (
        <ul
          role="list"
          className={summary.title ? "mt-0.5 text-gray-500" : "text-gray-700"}
          data-testid="notification-rule-updates-summary-list"
        >
          {summary.updates.map((name: string, index: number): ReactElement => {
            return (
              <React.Fragment key={name}>
                <li className="inline-block">
                  {name}
                  {index < lastIndex ? (
                    <span aria-hidden="true">{` ${mark}`}</span>
                  ) : (
                    <></>
                  )}
                </li>
                {index < lastIndex ? " " : <></>}
              </React.Fragment>
            );
          })}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

export default UpdatesRuleSummary;
