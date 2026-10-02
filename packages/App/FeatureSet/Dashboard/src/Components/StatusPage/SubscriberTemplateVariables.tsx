import {
  IncidentCustomFieldTemplateVariableRow,
  IncidentCustomFieldTemplateVariablesState,
  fetchIncidentCustomFieldTemplateVariables,
} from "./IncidentCustomFieldTemplateVariables";
import IncidentCustomFieldTemplateVariablesCopy from "./IncidentCustomFieldTemplateVariablesCopy";
import {
  SUBSCRIBER_REPORT_LOOP_DOCUMENTATION,
  getSubscriberNotificationTemplateVariableGroups,
} from "../../Utils/SubscriberNotificationTemplateVariables";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import {
  TemplateVariable,
  TemplateVariableGroup,
  TemplateVariableGroups,
} from "Common/Types/Template/TemplateVariable";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * What a custom subscriber notification template's content fields offer as
 * template variables - in a new template's Template Content step and in a
 * template's Edit Template Content dialog.
 *
 * Under the body there used to be the whole variable reference, a markdown
 * table, always open, and under that the project's incident custom fields in
 * a table of their own. The fields now list their variables themselves,
 * collapsed (Field.templateVariables): the event's variables, and for an
 * incident event the project's custom fields, each by its
 * {{incident.customFields.<key>}} and named as the project named it - every
 * one a click, or a "{{", away from going in where the cursor is.
 *
 * The template's own page keeps the full reference card.
 */

// Whether the event offers the incident's custom fields (the incident events).
export const offersIncidentCustomFields: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
) => boolean = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): boolean => {
  return Boolean(
    eventType &&
      SubscriberNotificationTemplateVariables.getDynamicVariablesForEventType(
        eventType,
      ).length > 0,
  );
};

/**
 * The variables a template for this event can use, as the template editor
 * lists them: the status page's, the event's, and for an incident event the
 * project's custom fields as far as they are known.
 */
export const getSubscriberTemplateVariableGroups: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  customFields: IncidentCustomFieldTemplateVariablesState,
) => TemplateVariableGroups = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  customFields: IncidentCustomFieldTemplateVariablesState,
): TemplateVariableGroups => {
  const groups: Array<TemplateVariableGroup> =
    getSubscriberNotificationTemplateVariableGroups(eventType);

  if (!offersIncidentCustomFields(eventType)) {
    return groups;
  }

  const copy: typeof IncidentCustomFieldTemplateVariablesCopy =
    IncidentCustomFieldTemplateVariablesCopy;

  let description: string = copy.customFieldsDescription;
  let variables: Array<TemplateVariable> = [];

  if (customFields.status === "failed") {
    description = copy.customFieldsUnavailable;
  } else if (customFields.status === "loaded") {
    if (customFields.rows.length === 0) {
      description = copy.noCustomFields;
    }

    variables = customFields.rows.map(
      (row: IncidentCustomFieldTemplateVariableRow): TemplateVariable => {
        return {
          name: row.variableName,
          // The field's name, as a project member typed it.
          description: row.name,
          isDescriptionVerbatim: true,
        };
      },
    );
  }

  return [
    ...groups,
    {
      title: copy.customFieldsTitle,
      description: description,
      variables: variables,
    },
  ];
};

export interface SubscriberTemplateVariablesFooterProps {
  eventType?: StatusPageSubscriberNotificationEventType | undefined;
  // The project's custom fields, read for an incident event.
  onCustomFieldsChange: (
    state: IncidentCustomFieldTemplateVariablesState,
  ) => void;
}

/*
 * The end of the template body's Template variables list. For an incident
 * event it reads the project's custom fields (only then, and only once the
 * body is shown) and says who may place them - the save refuses anyone else.
 * For the report, which Handlebars renders, it documents what its loops
 * reach, which are not variables to pick on their own.
 */
export const SubscriberTemplateVariablesFooter: FunctionComponent<
  SubscriberTemplateVariablesFooterProps
> = (props: SubscriberTemplateVariablesFooterProps): ReactElement => {
  const { translateString } = useTranslateValue();
  const offersCustomFields: boolean = offersIncidentCustomFields(
    props.eventType,
  );

  useEffect(() => {
    if (!offersCustomFields) {
      return;
    }

    let isCurrent: boolean = true;

    props.onCustomFieldsChange({ status: "loading" });

    fetchIncidentCustomFieldTemplateVariables()
      .then((rows: Array<IncidentCustomFieldTemplateVariableRow>) => {
        if (isCurrent) {
          props.onCustomFieldsChange({ status: "loaded", rows: rows });
        }
      })
      .catch(() => {
        if (isCurrent) {
          props.onCustomFieldsChange({ status: "failed" });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [offersCustomFields]);

  if (
    props.eventType ===
    StatusPageSubscriberNotificationEventType.SubscriberReport
  ) {
    return (
      <div
        className="rounded-md border border-gray-200 bg-gray-50 p-3"
        data-testid="subscriber-template-report-loop-variables"
      >
        <MarkdownViewer text={SUBSCRIBER_REPORT_LOOP_DOCUMENTATION} />
      </div>
    );
  }

  if (!offersCustomFields) {
    return <></>;
  }

  return (
    <p
      className="text-xs text-gray-500"
      data-testid="subscriber-template-placement-permission"
    >
      {translateString(
        IncidentCustomFieldTemplateVariablesCopy.placementPermission,
      ) || IncidentCustomFieldTemplateVariablesCopy.placementPermission}
    </p>
  );
};

export default SubscriberTemplateVariablesFooter;
