import MaintenanceStatusPagesCopy, {
  hasNoStatusPagePicked,
} from "./MaintenanceStatusPagesCopy";
import FetchStatusPages from "../StatusPage/FetchStatusPages";
import {
  StatusPageSuggestionsFooterOptions,
  getStatusPageSuggestionsFooter,
} from "../StatusPage/StatusPageSuggestions";
import { getIdsFromFormValue } from "../Incident/IncidentStatusPageScopeForm";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FieldFooterProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React, { ReactElement } from "react";

/*
 * "Show event on these status pages": the status page picker of a
 * maintenance event (Create, the event's own Edit) and of a maintenance
 * template - one field, defined once, so the three forms say the same thing.
 *
 * An event shows only on the pages it names (MaintenanceStatusPagesCopy),
 * which is not what an incident's picker means when left empty. So the field
 * says it where it is used:
 *
 * - its placeholder, while nothing is picked: "Not shown on any status page";
 * - its help, which says so and that an incident works the other way;
 * - under it, the pages that list the affected monitors, one click to add
 *   (StatusPageSuggestions) - nothing is picked by itself, since a picked
 *   page tells its subscribers;
 * - and on the review step, with no page picked, a warning - "This event
 *   will not appear on any status page." - with the same one-click picks
 *   under it, so the fix is where the problem is read.
 */

export const MAINTENANCE_STATUS_PAGES_NOT_SHOWN_TEST_ID: string =
  "maintenance-status-pages-not-shown";

export interface MaintenanceStatusPagesFormFieldOptions {
  stepId: string;
  // A template's form: its help and warning speak of its events.
  isTemplate?: boolean | undefined;
  /*
   * The record to read the monitors from, for a form that does not hold
   * them (StatusPageSuggestionsFooterOptions). Left out, they are the form's
   * own.
   */
  monitorsOf?: StatusPageSuggestionsFooterOptions["monitorsOf"];
  /*
   * What the pages picked will do, under the field, on a form with no
   * Subscriber Notifications section to say it (an event's Edit, #9974):
   * MaintenanceStatusPagesReason. Left out, nothing.
   */
  getReachNote?: StatusPageSuggestionsFooterOptions["getNote"];
}

// A form field of a model, as ModelForm takes one.
export const getMaintenanceStatusPagesFormField: <
  TEntity extends DatabaseBaseModel,
>(
  options: MaintenanceStatusPagesFormFieldOptions,
) => ModelField<TEntity> = <TEntity extends DatabaseBaseModel>(
  options: MaintenanceStatusPagesFormFieldOptions,
): ModelField<TEntity> => {
  /*
   * The same one-click picks, under the review's warning. The field's own
   * footer is written out below, where StatusPageSuggestionsGuard reads it.
   */
  const getReviewSuggestions: (
    values: FormValues<TEntity>,
    error?: string,
    footer?: FieldFooterProps,
  ) => ReactElement | undefined = getStatusPageSuggestionsFooter<TEntity>({
    eventType: StatusPageEventType.ScheduledEvent,
    monitorsOf: options.monitorsOf,
  });

  return {
    field: {
      statusPages: true,
    },
    title: MaintenanceStatusPagesCopy.pickerTitle,
    stepId: options.stepId,
    description: options.isTemplate
      ? MaintenanceStatusPagesCopy.templatePickerDescription
      : MaintenanceStatusPagesCopy.pickerDescription,
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: StatusPage,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: MaintenanceStatusPagesCopy.pickerPlaceholder,
    getFooterElement: getStatusPageSuggestionsFooter<TEntity>({
      eventType: StatusPageEventType.ScheduledEvent,
      monitorsOf: options.monitorsOf,
      getNote: options.getReachNote,
    }),
    getSummaryElement: (
      values: FormValues<TEntity>,
      footer?: FieldFooterProps,
    ): ReactElement => {
      const statusPages: unknown = ((values || {}) as Record<string, unknown>)[
        "statusPages"
      ];

      if (hasNoStatusPagePicked(statusPages)) {
        return (
          <div className="space-y-2">
            <Alert
              type={AlertType.WARNING}
              dataTestId={MAINTENANCE_STATUS_PAGES_NOT_SHOWN_TEST_ID}
              title={
                options.isTemplate
                  ? MaintenanceStatusPagesCopy.templateNotShownWarning
                  : MaintenanceStatusPagesCopy.notShownWarning
              }
            />
            {getReviewSuggestions(values, undefined, footer)}
          </div>
        );
      }

      const ids: Array<string> = getIdsFromFormValue(statusPages);

      return (
        <FetchStatusPages
          // Read again once a page is added from here.
          key={ids.join(",")}
          statusPageIds={ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          })}
        />
      );
    },
  } as ModelField<TEntity>;
};

export default getMaintenanceStatusPagesFormField;
