import IncidentCustomFieldsCopy from "./IncidentCustomFieldsCopy";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  INCIDENT_NOTE_TEMPLATE_VARIABLES,
  IncidentNoteTemplateVariableInfo,
} from "Common/Utils/Incident/IncidentNoteTemplateVariables";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The placeholders an incident note template can use, under the note's input
 * wherever a note template is written. The placeholders are shown as code and
 * never pass through the translation lookup, which would take their braces
 * for placeholders of its own.
 *
 * Below them, a warning: the same template fills public notes, which are
 * shown on status pages and emailed to their subscribers, and the custom
 * field, label and status page placeholders read the team's incident
 * records - every custom field, whether or not it is marked for subscribers.
 */
const IncidentNoteTemplatePlaceholders: FunctionComponent =
  (): ReactElement => {
    const { translateString } = useTranslateValue();

    const tx: (text: string) => string = (text: string): string => {
      return translateString(text) || text;
    };

    return (
      <div data-testid="incident-note-template-placeholders">
        <p>{tx(IncidentCustomFieldsCopy.noteTemplatePlaceholdersIntro)}</p>
        <ul className="mt-1 space-y-0.5">
          {INCIDENT_NOTE_TEMPLATE_VARIABLES.map(
            (variable: IncidentNoteTemplateVariableInfo): ReactElement => {
              return (
                <li key={variable.name}>
                  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
                    {`{{${variable.name}}}`}
                  </code>{" "}
                  <span>{tx(variable.description)}</span>
                </li>
              );
            },
          )}
        </ul>
        <div className="mt-3">
          <Alert
            type={AlertType.WARNING}
            dataTestId="incident-note-template-internal-data-warning"
            strongTitle={
              IncidentCustomFieldsCopy.noteTemplateInternalDataWarningTitle
            }
            title={IncidentCustomFieldsCopy.noteTemplateInternalDataWarning}
          />
        </div>
      </div>
    );
  };

export default IncidentNoteTemplatePlaceholders;
