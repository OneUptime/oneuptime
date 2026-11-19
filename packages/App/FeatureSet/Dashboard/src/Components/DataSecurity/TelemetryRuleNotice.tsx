import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A PAGE SAYS ONCE DATA SECURITY MADE A RULE OF INGEST.
 *
 * Scrub It (and Drop This Metric) make a rule - a log or trace scrub rule,
 * a metric pipeline rule - and the page says which, in one sentence whose
 * rule name opens the list the rule is in, where it can be changed or
 * removed: "The scrub rule <Data Security: Email address in body> now
 * masks this data in new logs." The sentence is one key with the name as
 * a slot (TranslatedSentence), so each language puts the name where its
 * grammar wants it; it was a translated sentence and a translated "View
 * scrub rules" link glued after it, which kept English's order everywhere
 * (SentencesFromTranslatedPiecesGuard). An issue's Where It Was Found and
 * In Your Telemetry draw it alike.
 */

export interface ComponentProps {
  // The sentence, with {{name}} where the rule's name goes (a translation key).
  template: string;
  // The rule's name, as it was saved: drawn as written.
  ruleName: string;
  // The list the rule is in.
  rulesRoute: Route;
  dataTestId: string;
  onClose: () => void;
}

const TelemetryRuleNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Alert
      type={AlertType.SUCCESS}
      dataTestId={props.dataTestId}
      title={
        <span>
          <TranslatedSentence
            template={props.template}
            slots={{
              name: (
                <AppLink
                  className="font-medium underline [overflow-wrap:anywhere]"
                  to={props.rulesRoute}
                >
                  {props.ruleName}
                </AppLink>
              ),
            }}
          />
        </span>
      }
      onClose={props.onClose}
    />
  );
};

export default TelemetryRuleNotice;
