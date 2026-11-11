import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import DefinedTerm from "Common/UI/Components/Glossary/DefinedTerm";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * INCIDENT OR ALERT, IN ONE LINE.
 *
 * Where a person chooses between opening an incident and creating an alert
 * - a monitor criteria's actions, a telemetry rule's "What happens" - this
 * says the difference beside the choice: incidents are for problems your
 * customers feel and can show on a status page; alerts are for your team
 * and never do. The two words are defined terms (the Glossary's Incident
 * and Alert), marked where a page first makes the choice: a criteria list
 * marks them on its first criteria only.
 */

export const INCIDENT_OR_ALERT_NOTE: string = translationKey(
  "{{incidents}} are for problems your customers feel, and can show on a status page. {{alerts}} are for your team, and never do.",
);
export const INCIDENT_OR_ALERT_NOTE_INCIDENTS: string =
  translationKey("Incidents");
export const INCIDENT_OR_ALERT_NOTE_ALERTS: string = translationKey("Alerts");

export const INCIDENT_OR_ALERT_NOTE_TEST_ID: string = "incident-or-alert-note";

export interface ComponentProps {
  /*
   * Draws the two words as defined terms. Off for every criteria after the
   * first: a page marks a word once.
   */
  marksTerms?: boolean | undefined;
  className?: string | undefined;
}

const IncidentOrAlertNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const incidents: string = translator.translateText(
    INCIDENT_OR_ALERT_NOTE_INCIDENTS,
  );
  const alerts: string = translator.translateText(INCIDENT_OR_ALERT_NOTE_ALERTS);

  return (
    <p
      data-testid={INCIDENT_OR_ALERT_NOTE_TEST_ID}
      className={props.className || "text-sm leading-5 text-gray-500"}
    >
      <TranslatedSentence
        template={INCIDENT_OR_ALERT_NOTE}
        slots={{
          incidents: props.marksTerms ? (
            <DefinedTerm term={GlossaryTerm.Incident}>{incidents}</DefinedTerm>
          ) : (
            incidents
          ),
          alerts: props.marksTerms ? (
            <DefinedTerm term={GlossaryTerm.Alert}>{alerts}</DefinedTerm>
          ) : (
            alerts
          ),
        }}
      />
    </p>
  );
};

export default IncidentOrAlertNote;
