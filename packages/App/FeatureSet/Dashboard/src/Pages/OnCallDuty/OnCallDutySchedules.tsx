import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import UserElement from "../../Components/User/User";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import OneUptimeDate from "Common/Types/Date";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallDutyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<OnCallDutySchedule>({ modelType: OnCallDutySchedule });

  return (
    <Fragment>
      <ModelTable<OnCallDutySchedule>
        modelType={OnCallDutySchedule}
        id="on-call-duty-table"
        userPreferencesKey="on-call-duty-table"
        saveFilterProps={{
          tableId: "on-call-schedules-table",
        }}
        isDeleteable={false}
        name="On-Call > Schedules"
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [...labelBulkActions],
        }}
        cardProps={{
          title: "On-Call Duty Schedules",
          description:
            "Here is a list of on-call-duty schedules for this project.",
        }}
        noItemsMessage={"No on-call schedule found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Schedule Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              timezone: true,
            },
            title: "Timezone",
            description:
              "The timezone this schedule's active-hour restrictions and hand-off times are interpreted in. Defaults to your current timezone.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
            defaultValue: OneUptimeDate.getCurrentTimezone(),
            required: false,
            placeholder: "Select Timezone",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            type: FieldType.EntityArray,
            title: "Labels",
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        /*
         * currentUserOnRoster / nextUserOnRoster back the "On call now" column
         * below. Both are already persisted on the schedule and refreshed every
         * minute by the RefreshHandoffTime worker, so this costs no extra work
         * on the server — the list simply never asked for them before, which is
         * why an uncovered schedule and a healthy one rendered as identical rows.
         */
        selectMoreFields={{
          rosterNextStartAt: true,
          nextUserOnRoster: {
            _id: true,
            name: true,
            email: true,
          },
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              currentUserOnRoster: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "On Call Now",
            type: FieldType.Element,
            /*
             * Deliberately NOT `noValueMessage: "-"`. A dash is exactly the
             * silent blank this column exists to replace: "nobody is on call"
             * is a state worth naming, not missing data.
             */
            getElement: (item: OnCallDutySchedule): ReactElement => {
              if (item.currentUserOnRoster) {
                return <UserElement user={item.currentUserOnRoster} />;
              }

              return (
                <div className="flex flex-col gap-0.5">
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                    <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
                    No one on call
                  </span>
                  {item.rosterNextStartAt && item.nextUserOnRoster ? (
                    <span className="text-xs text-gray-400">
                      Resumes{" "}
                      {OneUptimeDate.getDateAsLocalFormattedString(
                        item.rosterNextStartAt,
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">
                      No upcoming shifts
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: OnCallDutySchedule): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
      {labelBulkActionModals}
    </Fragment>
  );
};

export default OnCallDutyPage;
