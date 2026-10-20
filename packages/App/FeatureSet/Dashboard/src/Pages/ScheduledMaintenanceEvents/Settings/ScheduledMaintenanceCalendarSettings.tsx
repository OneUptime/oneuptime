import PageComponentProps from "../../PageComponentProps";
import { readExternalCalendarNow } from "../../../Components/ScheduledMaintenance/ExternalCalendarApi";
import {
  EXTERNAL_CALENDAR_OPEN_QUERY_PARAM,
  isAddExternalCalendarAsked,
} from "../../../Components/ScheduledMaintenance/ExternalCalendarAddLink";
import {
  EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT,
  ExternalCalendarHealth,
  getExternalCalendarHealth,
  getExternalCalendarKeptSummary,
  getRefreshIntervalOptions,
} from "../../../Components/ScheduledMaintenance/ExternalCalendarStatus";
import ScheduledMaintenanceExternalCalendar from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  ExternalCalendarLinkResult,
  normalizeExternalCalendarLink,
} from "Common/Types/ScheduledMaintenance/ExternalCalendar";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Scheduled Maintenance > Settings > Calendar Settings (issue #5084): the
 * calendars from outside the project the Maintenance Calendar shows beside
 * its events - public holidays, a change freeze kept in Exchange, another
 * project's calendar link.
 *
 * In the folded Settings section, as the maintainer asked: set up once, and
 * nothing a reader of the calendar has to see. Adding one asks for its name
 * and its link; its colour (one its siblings do not use) and how often it is
 * read (every hour) are picked, under More fields. It is read at once, and
 * its row says how that went - Working, with how many events it holds, or
 * Not working and why.
 *
 *   - The link can be a secret (a calendar's private address), so it is
 *     never shown again: the row shows the host it points at, and Change
 *     link replaces it.
 *   - Read now reads it again at once; Turn off stops reading it and hides
 *     its events from everyone, until Turn on.
 */

// Built once: BasicForm folds the fields next to each other that carry it.
const moreFields: FormFieldCollapsibleSection<ScheduledMaintenanceExternalCalendar> =
  getAdvancedFormSection<ScheduledMaintenanceExternalCalendar>();

export const EXTERNAL_CALENDARS_TABLE_ID: string =
  "scheduled-maintenance-external-calendars-table";

export const MAINTENANCE_CALENDAR_DOCS_ROUTE: string =
  "/docs/scheduled-maintenance/calendar";

// The link field's own check, in the reader's language, as the server checks it.
export function getCalendarLinkProblem(value: unknown): string | null {
  const result: ExternalCalendarLinkResult = normalizeExternalCalendarLink(
    typeof value === "string" ? value : "",
  );

  if ("problem" in result) {
    const text: string = EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT[result.problem];

    return getGlobalTranslator().translateText(text) || text;
  }

  return null;
}

const ScheduledMaintenanceCalendarSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [changingLinkOf, setChangingLinkOf] =
    useState<ScheduledMaintenanceExternalCalendar | null>(null);
  const [isChangingLink, setIsChangingLink] = useState<boolean>(false);
  const [changeLinkError, setChangeLinkError] = useState<string>("");

  const updateGate: PermissionGateResult = PermissionGate.check(
    new ScheduledMaintenanceExternalCalendar(),
    ModelAction.Update,
  );

  /*
   * Opened from the Maintenance Calendar's Add External Calendar: the Add
   * dialog opens with the page, for whoever may add one. Read once; the ask
   * then leaves the address, so a refresh does not open it again.
   */
  const [isAddAsked] = useState<boolean>((): boolean => {
    return (
      isAddExternalCalendarAsked(Navigation.getQueryString()) &&
      PermissionGate.check(
        new ScheduledMaintenanceExternalCalendar(),
        ModelAction.Create,
      ).isAllowed
    );
  });

  useEffect(() => {
    if (isAddExternalCalendarAsked(Navigation.getQueryString())) {
      Navigation.setQueryString({
        [EXTERNAL_CALENDAR_OPEN_QUERY_PARAM]: null,
      });
    }
  }, []);

  /*
   * The table reads its rows again. A row action's own completion only
   * clears its spinner (RowActions), so every action that changes a row -
   * Read now, Turn on, Turn off, Change link - asks for this itself, or the
   * row would go on saying Working after Turn off.
   */
  const reload: () => void = (): void => {
    // A count, so two reloads in one millisecond are still two.
    setRefreshToggle((previous: string): string => {
      return String(Number(previous || 0) + 1);
    });
  };

  const setEnabled: (
    item: ScheduledMaintenanceExternalCalendar,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => Promise<void> = async (
    item: ScheduledMaintenanceExternalCalendar,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById<ScheduledMaintenanceExternalCalendar>({
        modelType: ScheduledMaintenanceExternalCalendar,
        id: item.id!,
        data: { isEnabled: isEnabled },
      });
      onCompleteAction();
      reload();
    } catch (err) {
      onError(err as Error);
    }
  };

  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceExternalCalendar>
        modelType={ScheduledMaintenanceExternalCalendar}
        id={EXTERNAL_CALENDARS_TABLE_ID}
        name="Settings > Scheduled Maintenance External Calendars"
        userPreferencesKey={EXTERNAL_CALENDARS_TABLE_ID}
        singularName="External Calendar"
        pluralName="External Calendars"
        createVerb="Add"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        refreshToggle={refreshToggle}
        showCreateForm={isAddAsked}
        documentationLink={new Route(MAINTENANCE_CALENDAR_DOCS_ROUTE)}
        cardProps={{
          title: "External Calendars",
          description:
            "Show the events of other calendars, such as public holidays or a change freeze, on the Maintenance Calendar.",
        }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          color: true,
          calendarHost: true,
          isEnabled: true,
          lastReadAt: true,
          lastReadError: true,
          lastReadHttpStatus: true,
          eventCount: true,
          hasMoreEvents: true,
        }}
        /*
         * A new calendar is read at once, so its row says how that went as
         * soon as the list reloads. The Workers would read it within a
         * minute anyway: a read that is refused here is no failure.
         */
        onCreateSuccess={async (
          item: ScheduledMaintenanceExternalCalendar,
          modalType?: ModalType,
        ): Promise<ScheduledMaintenanceExternalCalendar> => {
          if (modalType === ModalType.Create && item.id) {
            try {
              await readExternalCalendarNow(item.id);
            } catch {
              // Read within a minute by the Workers.
            }

            reload();
          }

          return item;
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            description: "The name the Maintenance Calendar shows for it.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Public holidays",
            validation: {
              minLength: 1,
              maxLength: 100,
            },
          },
          {
            field: {
              calendarUrl: true,
            },
            title: "Calendar Link",
            // translationKey: the extractor skips copy with a link scheme in it.
            description: translationKey(
              "The calendar's iCal (.ics) link, starting with https:// or webcal://. It can be a private link: it is stored encrypted and never shown again.",
            ),
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder:
              "https://calendar.google.com/calendar/ical/.../basic.ics",
            // Never read back, so an edit could only blank it: Change link replaces it.
            doNotShowWhenEditing: true,
            customValidation: (
              values: FormValues<ScheduledMaintenanceExternalCalendar>,
            ): string | null => {
              return getCalendarLinkProblem(values.calendarUrl);
            },
          },
          {
            field: {
              color: true,
            },
            title: "Color",
            description: "The color its events are drawn in on the calendar.",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            collapsibleSection: moreFields,
          },
          {
            field: {
              refreshIntervalInMinutes: true,
            },
            title: "Refresh",
            description:
              "How often OneUptime reads the calendar for changes. Calendar servers often ask for no more than once an hour.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getRefreshIntervalOptions(),
            required: true,
            collapsibleSection: moreFields,
          },
        ]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        actionButtons={[
          {
            title: "Read now",
            icon: IconProp.Refresh,
            buttonStyleType: ButtonStyleType.OUTLINE,
            placement: ActionButtonPlacement.MoreMenu,
            isVisible: (
              item: ScheduledMaintenanceExternalCalendar,
            ): boolean => {
              return item.isEnabled !== false;
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Read it now instead of at its next read."
              : updateGate.disabledReason,
            onClick: async (
              item: ScheduledMaintenanceExternalCalendar,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): Promise<void> => {
              try {
                await readExternalCalendarNow(item.id!);
                onCompleteAction();
                reload();
              } catch (err) {
                onError(new Error(API.getFriendlyMessage(err)));
              }
            },
          },
          {
            title: "Change link",
            icon: IconProp.Link,
            buttonStyleType: ButtonStyleType.OUTLINE,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace its link. The events of the old one are forgotten."
              : updateGate.disabledReason,
            onClick: (
              item: ScheduledMaintenanceExternalCalendar,
              onCompleteAction: VoidFunction,
            ): void => {
              setChangeLinkError("");
              setChangingLinkOf(item);
              onCompleteAction();
            },
          },
          {
            title: "Turn on",
            icon: IconProp.Play,
            buttonStyleType: ButtonStyleType.OUTLINE,
            placement: ActionButtonPlacement.MoreMenu,
            isVisible: (
              item: ScheduledMaintenanceExternalCalendar,
            ): boolean => {
              return item.isEnabled === false;
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Read it again and show its events."
              : updateGate.disabledReason,
            onClick: (
              item: ScheduledMaintenanceExternalCalendar,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): Promise<void> => {
              return setEnabled(item, true, onCompleteAction, onError);
            },
          },
          {
            title: "Turn off",
            icon: IconProp.Stop,
            buttonStyleType: ButtonStyleType.OUTLINE,
            placement: ActionButtonPlacement.MoreMenu,
            isVisible: (
              item: ScheduledMaintenanceExternalCalendar,
            ): boolean => {
              return item.isEnabled !== false;
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Stop reading it and hide its events from everyone."
              : updateGate.disabledReason,
            onClick: (
              item: ScheduledMaintenanceExternalCalendar,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): Promise<void> => {
              return setEnabled(item, false, onCompleteAction, onError);
            },
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Calendar",
            type: FieldType.Element,
            getElement: (
              item: ScheduledMaintenanceExternalCalendar,
            ): ReactElement => {
              return (
                <div
                  className="flex min-w-0 items-center gap-3"
                  data-testid="external-calendar-name"
                >
                  <span
                    className="oneuptime-calendar-legend-dot h-3 w-3 flex-none rounded-full"
                    style={{
                      backgroundColor: item.color?.toString() || "#6b7280",
                    }}
                    aria-hidden="true"
                  ></span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {item.name}
                    </div>
                    {item.calendarHost ? (
                      <div className="truncate text-xs text-gray-500">
                        {item.calendarHost}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
              );
            },
            getExportValue: (
              item: ScheduledMaintenanceExternalCalendar,
            ): string => {
              return item.name || "";
            },
          },
          {
            field: {
              lastReadError: true,
            },
            title: "Status",
            type: FieldType.Element,
            disableSort: true,
            getElement: (
              item: ScheduledMaintenanceExternalCalendar,
            ): ReactElement => {
              const health: ExternalCalendarHealth =
                getExternalCalendarHealth(item);

              const reason: string = translator.translateTemplate(
                health.tooltip,
                health.tooltipValues,
              );

              /*
               * Why a calendar is not working is what to fix, so it is
               * said under the pill rather than kept in its tooltip.
               */
              return (
                <div
                  className="min-w-0 max-w-xs space-y-1"
                  data-testid="external-calendar-status"
                >
                  <Pill
                    color={health.color}
                    text={health.label}
                    tooltip={reason}
                  />
                  {health.key === "failing" ? (
                    <p
                      className="whitespace-normal text-xs text-gray-600"
                      data-testid="external-calendar-status-reason"
                    >
                      {reason}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              lastReadAt: true,
            },
            title: "Last read",
            type: FieldType.Element,
            getElement: (
              item: ScheduledMaintenanceExternalCalendar,
            ): ReactElement => {
              const kept: {
                count: number;
                hasMore: boolean;
                limit: number;
              } | null = getExternalCalendarKeptSummary(item);

              if (!item.lastReadAt || !kept) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Not yet")}
                  </span>
                );
              }

              return (
                <div
                  className="min-w-0"
                  data-testid="external-calendar-last-read"
                >
                  <div className="text-sm text-gray-900">
                    {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      item.lastReadAt,
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {kept.hasMore
                      ? translator.translateTemplate(
                          "{{count}} events kept, the nearest today",
                          { count: kept.count },
                        )
                      : translator.translatePlural(
                          {
                            one: "{{count}} event",
                            other: "{{count}} events",
                          },
                          kept.count,
                        )}
                  </div>
                </div>
              );
            },
          },
        ]}
      />

      {changingLinkOf ? (
        <BasicFormModal<JSONObject>
          title={translator.translateTemplate("Change the link of {{name}}", {
            name: changingLinkOf.name || "",
          })}
          description="Paste the calendar's new iCal (.ics) link. The events of the old link are forgotten, and the new one is read at once."
          submitButtonText="Change link"
          isLoading={isChangingLink}
          error={changeLinkError || undefined}
          onClose={() => {
            setChangingLinkOf(null);
          }}
          onSubmit={async (data: JSONObject): Promise<void> => {
            setIsChangingLink(true);
            setChangeLinkError("");

            try {
              await ModelAPI.updateById<ScheduledMaintenanceExternalCalendar>({
                modelType: ScheduledMaintenanceExternalCalendar,
                id: changingLinkOf.id!,
                data: { calendarUrl: data["calendarUrl"] as string },
              });

              try {
                await readExternalCalendarNow(changingLinkOf.id!);
              } catch {
                // Read within a minute by the Workers.
              }

              setChangingLinkOf(null);
              reload();
            } catch (err) {
              setChangeLinkError(API.getFriendlyMessage(err));
            }

            setIsChangingLink(false);
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  calendarUrl: true,
                },
                title: "New Calendar Link",
                description: translationKey(
                  "Starting with https:// or webcal://. It is stored encrypted and never shown again.",
                ),
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "https://",
                customValidation: (
                  values: FormValues<JSONObject>,
                ): string | null => {
                  return getCalendarLinkProblem(values["calendarUrl"]);
                },
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default ScheduledMaintenanceCalendarSettings;
