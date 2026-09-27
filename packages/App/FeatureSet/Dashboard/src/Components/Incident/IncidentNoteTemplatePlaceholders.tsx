import IncidentCustomFieldsCopy from "./IncidentCustomFieldsCopy";
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
      </div>
    );
  };

export default IncidentNoteTemplatePlaceholders;
