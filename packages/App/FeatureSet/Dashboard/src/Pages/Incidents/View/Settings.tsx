import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ProjectUtil from "Common/UI/Utils/Project";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
import IncidentStateUtil from "../../../Utils/IncidentState";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import IncidentCreatedRenotify, {
  IncidentCreatedRenotifyState,
} from "Common/Types/StatusPage/IncidentCreatedRenotify";
import IncidentPostmortemPublication from "Common/Types/StatusPage/IncidentPostmortemPublication";
import RemindersCard from "../../../Components/Reminders/RemindersCard";
import ReminderRuleScope from "../../../Components/Reminders/ReminderRuleScope";
import { getIncidentCreatedRenotifyFormField } from "../../../Components/Incident/IncidentCreatedRenotifyFormField";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IncidentStatusPageScopeCopy from "../../../Components/Incident/IncidentStatusPageScopeCopy";
import IncidentStatusPageScopeView from "../../../Components/Incident/IncidentStatusPageScopeView";
import {
  StatusPagesNotListingMonitorsWarning,
  TranslatedScopeNotice,
} from "../../../Components/Incident/IncidentStatusPageScopeNotices";
import {
  getIdsFromFormValue,
  getNamedStatusPages,
  getNotifiedStatusPagesBeingRemoved,
  isClearingScope,
  joinStatusPageNames,
  NamedStatusPage,
} from "../../../Components/Incident/IncidentStatusPageScopeForm";
import { getIncidentScopeAddedPagesFormField } from "../../../Components/Incident/IncidentScopeAddedPagesFormField";

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

  const renotifyState: IncidentCreatedRenotifyState | null = loadedIncident
    ? {
        isVisibleOnStatusPage: loadedIncident.isVisibleOnStatusPage,
        isPrivate: loadedIncident.isPrivate,
        subscriberNotificationStatusOnIncidentCreated:
          loadedIncident.subscriberNotificationStatusOnIncidentCreated,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
          loadedIncident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
        statusPages: loadedIncident.statusPages,
        statusPagesNotifiedOnCreation:
          loadedIncident.statusPagesNotifiedOnCreation,
      }
    : null;

  const canRenotifyOnPublish: boolean = Boolean(
    renotifyState &&
      IncidentCreatedRenotify.canRenotifyOnPublish(renotifyState),
  );

  // Skipped, or limited to status pages that were never told.
  const renotifyDescription: string | undefined = renotifyState
    ? IncidentCreatedRenotify.getFormFieldDescription(renotifyState)
    : undefined;

  /*
   * A postmortem published while the incident was hidden waits for it to be
   * shown: turning 'Visible on Status Page' on sends it to subscribers
   * (IncidentPostmortemPublication.isShownByUpdate), and the switch says so
   * while that is the case.
   */
  const isPostmortemWaitingForIncident: boolean =
    IncidentPostmortemPublication.isWaitingForIncidentToShow(loadedIncident);

  /*
   * Resolved by the one rule (Common/Utils/ResolvedState): the project's
   * resolved state, or a state placed after it.
   */
  const [incidentStates, setIncidentStates] = useState<Array<IncidentState>>(
    [],
  );

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    IncidentStateUtil.getIncidentStates(projectId)
      .then((states: Array<IncidentState>) => {
        setIncidentStates(states);
      })
      .catch(() => {
        // Left open: the publish checkbox starts ticked, as for an open incident.
      });
  }, []);

  const isResolved: boolean = ResolvedStateUtil.isResolved({
    list: StateListType.IncidentState,
    states: incidentStates,
    stateId: loadedIncident?.currentIncidentStateId,
  });

  const settingsFormFields: Fields<Incident> = useMemo(() => {
    const fields: Fields<Incident> = [
      {
        field: {
          isVisibleOnStatusPage: true,
        },
        title: "Visible on Status Page",
        ...(isPostmortemWaitingForIncident
          ? {
              description: IncidentPostmortemPublication.sendsOnShowDescription,
            }
          : {}),
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
          description: renotifyDescription,
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
  }, [
    canRenotifyOnPublish,
    isResolved,
    renotifyDescription,
    isPostmortemWaitingForIncident,
  ]);

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

  const loadedStatusPages: Array<NamedStatusPage> = getNamedStatusPages(
    scopeIncident?.statusPages,
  );

  /*
   * The pages an incident that is not limited has told, by name. Limiting it
   * drops every one of them the new list leaves out, and they are in no list
   * the card loaded, so their names are read here for the warning. Pages the
   * person cannot read are not named.
   */
  const [notifiedStatusPages, setNotifiedStatusPages] = useState<
    Array<NamedStatusPage>
  >([]);

  const unscopedNotifiedIds: string = scopeIncident?.isScopedToStatusPages
    ? ""
    : getIdsFromFormValue(scopeIncident?.statusPagesNotifiedOnCreation).join(
        ",",
      );

  useEffect(() => {
    const ids: Array<string> = unscopedNotifiedIds
      ? unscopedNotifiedIds.split(",")
      : [];

    if (ids.length === 0) {
      setNotifiedStatusPages([]);
      return;
    }

    let isCancelled: boolean = false;

    Promise.resolve()
      .then((): Promise<ListResult<StatusPage>> => {
        return ModelAPI.getList<StatusPage>({
          modelType: StatusPage,
          query: {
            _id: new Includes(ids),
          } as Query<StatusPage>,
          limit: ids.length,
          skip: 0,
          select: { _id: true, name: true },
          sort: {},
        });
      })
      .then((result: ListResult<StatusPage>) => {
        if (!isCancelled) {
          setNotifiedStatusPages(getNamedStatusPages(result.data));
        }
      })
      .catch(() => {
        // Without names there is nobody to name: the warning is left out.
        if (!isCancelled) {
          setNotifiedStatusPages([]);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [unscopedNotifiedIds]);

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
              isScoped: scopeIncident
                ? scopeIncident.isScopedToStatusPages === true
                : undefined,
              notifiedStatusPages: notifiedStatusPages,
            });

          return (
            <>
              {/*
               * Only once the incident is loaded: until then its monitors
               * are unknown, not none, and every picked page would look
               * like one that lists none of them.
               */}
              {scopeIncident ? (
                <StatusPagesNotListingMonitorsWarning
                  monitorIds={scopeIncident.monitors}
                  statusPageIds={formValue}
                />
              ) : (
                <></>
              )}
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

    /*
     * Shown only while ticking it would send something (see
     * wouldQueueAddedPagesNotification): the form adds a page that was not
     * told yet, and the incident's 'created' notification can go out to it.
     */
    if (scopeIncident) {
      fields.push(
        getIncidentScopeAddedPagesFormField({
          loadedIncident: scopeIncident,
        }),
      );
    }

    return fields;
  }, [scopeIncident, notifiedStatusPages]);

  return (
    <Fragment>
      <CardModelDetail
        name="Incident Settings"
        cardProps={{
          title: "Incident Settings",
          description:
            "Whether this incident shows on status pages, and who in the project can see it.",
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
            currentIncidentStateId: true,
            // Pages added while it was hidden can be told when it is published.
            statusPages: {
              _id: true,
            },
            statusPagesNotifiedOnCreation: true,
            // Whether showing it sends a postmortem that waits for it.
            showPostmortemOnStatusPage: true,
            postmortemNote: true,
            notifySubscribersOnPostmortemPublished: true,
            subscriberNotificationStatusOnPostmortemPublished: true,
            subscriberNotificationStatusMessageOnPostmortemPublished: true,
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
            subscriberNotificationStatusOnIncidentCreated: true,
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

      <RemindersCard scope={ReminderRuleScope.Incident} modelId={modelId} />
    </Fragment>
  );
};

export default IncidentDelete;
