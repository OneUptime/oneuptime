import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import NextReminderCountdown, {
  ReminderRuleScope,
} from "../../../Components/Reminders/NextReminderCountdown";
import { getIncidentCreatedRenotifyFormField } from "../../../Components/Incident/IncidentCreatedRenotifyFormField";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IncidentStatusPageScopeCopy from "../../../Components/Incident/IncidentStatusPageScopeCopy";
import IncidentStatusPageScopeView from "../../../Components/Incident/IncidentStatusPageScopeView";
import {
  StatusPagePickerAccessHint,
  StatusPagesNotListingMonitorsWarning,
  TranslatedScopeNotice,
} from "../../../Components/Incident/IncidentStatusPageScopeNotices";
import {
  canNotifyAddedStatusPages,
  getNamedStatusPages,
  getNotifiedStatusPagesBeingRemoved,
  isClearingScope,
  joinStatusPageNames,
  NamedStatusPage,
} from "../../../Components/Incident/IncidentStatusPageScopeForm";
import { getIncidentScopeAddedPagesFormField } from "../../../Components/Incident/IncidentScopeAddedPagesFormField";
import useStatusPagePickerAccess, {
  StatusPagePickerAccess,
} from "../../../Components/Incident/useStatusPagePickerAccess";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The incident as the settings card last loaded it. Its 'created'
   * notification state decides whether turning 'Visible on Status Page' on
   * can also tell subscribers about the incident (see
   * IncidentCreatedRenotify); the card reloads it after every save.
   */
  const [loadedIncident, setLoadedIncident] = useState<Incident | null>(null);

  const canRenotifyOnPublish: boolean = Boolean(
    loadedIncident &&
      IncidentCreatedRenotify.canRenotifyOnPublish({
        isVisibleOnStatusPage: loadedIncident.isVisibleOnStatusPage,
        isPrivate: loadedIncident.isPrivate,
        subscriberNotificationStatusOnIncidentCreated:
          loadedIncident.subscriberNotificationStatusOnIncidentCreated,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
          loadedIncident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      }),
  );

  const isResolved: boolean =
    loadedIncident?.currentIncidentState?.isResolvedState === true;

  const settingsFormFields: Fields<Incident> = useMemo(() => {
    const fields: Fields<Incident> = [
      {
        field: {
          isVisibleOnStatusPage: true,
        },
        title: "Visible on Status Page",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
    ];

    if (canRenotifyOnPublish) {
      fields.push(
        getIncidentCreatedRenotifyFormField({
          tickedByDefault: IncidentCreatedRenotify.isTickedByDefault({
            isResolved: isResolved,
          }),
        }),
      );
    }

    fields.push({
      field: {
        isPrivate: true,
      },
      title: "Private Incident",
      description:
        "If enabled, only the incident's owner users and members of its owner teams (plus project admins and owners) can view this incident. Private incidents are automatically hidden from all status pages.",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    });

    return fields;
  }, [canRenotifyOnPublish, isResolved]);

  /*
   * The incident as the 'Status Page Scope' card last loaded it: the pages it
   * is limited to, the ones already told it was created, and whether its
   * 'created' notification can go out at all. The edit form's warnings and
   * its added-pages checkbox are worked out against it.
   */
  const [scopeIncident, setScopeIncident] = useState<Incident | null>(null);

  /*
   * Both cards read the incident's visibility and its 'created' notification
   * state: publishing it in one changes what the other offers (adding pages
   * queues the notification, and a queued notification is not offered again
   * on publish). So a save in either card reloads the other.
   */
  const [settingsRefresher, setSettingsRefresher] = useState<boolean>(false);
  const [scopeRefresher, setScopeRefresher] = useState<boolean>(false);

  const statusPagePickerAccess: StatusPagePickerAccess =
    useStatusPagePickerAccess();

  const loadedStatusPages: Array<NamedStatusPage> = getNamedStatusPages(
    scopeIncident?.statusPages,
  );

  const canNotifyAddedPages: boolean = Boolean(
    scopeIncident &&
      canNotifyAddedStatusPages({
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
          scopeIncident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
        isVisibleOnStatusPage: scopeIncident.isVisibleOnStatusPage,
        isPrivate: scopeIncident.isPrivate,
      }),
  );

  const scopeFormFields: Fields<Incident> = useMemo(() => {
    const fields: Fields<Incident> = [
      {
        field: {
          statusPages: true,
        },
        title: IncidentStatusPageScopeCopy.pickerTitle,
        description: IncidentStatusPageScopeCopy.pickerDescription,
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: StatusPage,
          labelField: "name",
          valueField: "_id",
        },
        required: false,
        placeholder: IncidentStatusPageScopeCopy.pickerPlaceholder,
        getFooterElement: (values: FormValues<Incident>) => {
          const formValue: unknown = (values as Record<string, unknown>)[
            "statusPages"
          ];

          /*
           * Pages that already heard about the incident hear nothing more
           * once removed - not even that it was resolved.
           */
          const removingNotified: Array<NamedStatusPage> =
            getNotifiedStatusPagesBeingRemoved({
              loadedStatusPages: loadedStatusPages,
              notifiedStatusPageIds:
                scopeIncident?.statusPagesNotifiedOnCreation,
              formValue: formValue,
            });

          return (
            <>
              <StatusPagePickerAccessHint access={statusPagePickerAccess} />
              <StatusPagesNotListingMonitorsWarning
                monitorIds={scopeIncident?.monitors}
                statusPageIds={formValue}
              />
              {removingNotified.length > 0 ? (
                <TranslatedScopeNotice
                  text={
                    IncidentStatusPageScopeCopy.removingNotifiedPagesWarning
                  }
                  values={{ names: joinStatusPageNames(removingNotified) }}
                  dataTestId="incident-scope-removing-notified-pages"
                />
              ) : (
                <></>
              )}
              {isClearingScope({
                isScoped: scopeIncident?.isScopedToStatusPages,
                formValue: formValue,
              }) ? (
                <TranslatedScopeNotice
                  text={IncidentStatusPageScopeCopy.clearingScopeWarning}
                  dataTestId="incident-scope-clearing"
                />
              ) : (
                <></>
              )}
            </>
          );
        },
      },
    ];

    if (canNotifyAddedPages) {
      fields.push(
        getIncidentScopeAddedPagesFormField({
          loadedStatusPages: scopeIncident?.statusPages,
        }),
      );
    }

    return fields;
  }, [scopeIncident, canNotifyAddedPages, statusPagePickerAccess]);

  return (
    <Fragment>
      <CardModelDetail
        name="Incident Settings"
        cardProps={{
          title: "Incident Settings",
          description: "Manage settings for this incident here.",
        }}
        refresher={settingsRefresher}
        onSaveSuccess={() => {
          setScopeRefresher((current: boolean): boolean => {
            return !current;
          });
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={settingsFormFields}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-settings",
          fields: [
            {
              field: {
                isVisibleOnStatusPage: true,
              },
              title: "Visible on Status Page",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                isPrivate: true,
              },
              title: "Private Incident",
              description:
                "Visible only to owners (users + members of owner teams), project admins, and project owners. Hidden from status pages.",
              fieldType: FieldType.Boolean,
            },
          ],
          selectMoreFields: {
            subscriberNotificationStatusOnIncidentCreated: true,
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
            currentIncidentState: {
              isResolvedState: true,
            },
          },
          onItemLoaded: (item: Incident) => {
            setLoadedIncident(item);
          },
          modelId: modelId,
        }}
      />

      <CardModelDetail
        name="Status Page Scope"
        cardProps={{
          title: IncidentStatusPageScopeCopy.settingsCardTitle,
          description: IncidentStatusPageScopeCopy.settingsCardDescription,
        }}
        refresher={scopeRefresher}
        onSaveSuccess={() => {
          setSettingsRefresher((current: boolean): boolean => {
            return !current;
          });
        }}
        isEditable={true}
        editButtonText={IncidentStatusPageScopeCopy.settingsEditButton}
        formFields={scopeFormFields}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-status-page-scope",
          fields: [
            {
              field: {
                statusPages: {
                  _id: true,
                  name: true,
                },
              },
              title: IncidentStatusPageScopeCopy.scopeFieldTitle,
              fieldType: FieldType.Element,
              getElement: (item: Incident): ReactElement => {
                return (
                  <IncidentStatusPageScopeView
                    isScopedToStatusPages={item.isScopedToStatusPages}
                    statusPages={item.statusPages || []}
                  />
                );
              },
            },
          ],
          selectMoreFields: {
            isScopedToStatusPages: true,
            statusPagesNotifiedOnCreation: true,
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
            isVisibleOnStatusPage: true,
            isPrivate: true,
            monitors: {
              _id: true,
            },
          },
          onItemLoaded: (item: Incident) => {
            setScopeIncident(item);
          },
          modelId: modelId,
        }}
      />

      <CardModelDetail
        name="Reminders"
        cardProps={{
          title: "Reminders",
          description: "Control reminder notifications for this incident.",
        }}
        isEditable={true}
        editButtonText="Edit Reminders"
        formFields={[
          {
            field: {
              enableReminders: true,
            },
            title: "Enable Reminders",
            description:
              "If enabled, reminder notifications are sent to this incident's owners based on the project's reminder rules while the incident is still open.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-reminders",
          fields: [
            {
              field: {
                enableReminders: true,
              },
              title: "Enable Reminders",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                nextReminderNotificationAt: true,
              },
              title: "Next Reminder In",
              fieldType: FieldType.Element,
              getElement: (item: Incident): ReactElement => {
                return (
                  <NextReminderCountdown
                    nextReminderAt={item.nextReminderNotificationAt}
                    severityId={item.incidentSeverityId}
                    labelIds={(item.labels || []).map((label: Label) => {
                      return label.id!;
                    })}
                    scope={ReminderRuleScope.Incident}
                    remindersEnabled={item.enableReminders !== false}
                  />
                );
              },
            },
            {
              field: {
                reminderNotificationSentCount: true,
              },
              title: "Reminders Sent",
              fieldType: FieldType.Number,
            },
          ],
          selectMoreFields: {
            incidentSeverityId: true,
            labels: {
              _id: true,
            },
          },
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default IncidentDelete;
