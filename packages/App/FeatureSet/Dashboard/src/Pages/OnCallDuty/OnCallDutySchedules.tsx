import LabelsElement from "Common/UI/Components/Label/Labels";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
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
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const OnCallDutyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<OnCallDutySchedule>({ modelType: OnCallDutySchedule });

  /*
   * Like Create On-Call Policy, the create form asks for the name and folds
   * the description and the labels under Advanced. The timezone stays in
   * view: it decides when hand-offs happen, and it starts on the reader's
   * own. Three rows, so no steps.
   */
  const advancedSection: FormFieldCollapsibleSection<OnCallDutySchedule> =
    getAdvancedFormSection<OnCallDutySchedule>();

  return (
    <Fragment>
      <ModelTable<OnCallDutySchedule>
        modelType={OnCallDutySchedule}
        /*
         * Its own id and preferences key: sharing the policies table's
         * meant a column layout saved on one page was applied to the other.
         */
        id="on-call-schedules-table"
        userPreferencesKey="on-call-schedules-table"
        /*
         * The model is named for its table (On-Call Duty Policy Schedule),
         * which made the create button "Create On-Call Policy Schedule"
         * on a page every menu calls On-Call Schedules.
         */
        singularName="On-Call Schedule"
        pluralName="On-Call Schedules"
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
            "Rotations that decide who is on call at any moment. Add a schedule to an on-call policy's escalation rules to page whoever is on call.",
          buttons: [
            {
              title: "Timeline View",
              icon: IconProp.ViewColumns,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE] as Route,
                  ),
                );
              },
            },
          ],
        }}
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
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
            collapsibleSection: advancedSection,
          },
          getLabelsFormField<OnCallDutySchedule>({
            collapsibleSection: advancedSection,
          }),
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
                    {translator.translateText("No one on call")}
                  </span>
                  {item.rosterNextStartAt && item.nextUserOnRoster ? (
                    <span className="text-xs text-gray-400">
                      {translator.translateTemplate("Resumes {{date}}", {
                        date: OneUptimeDate.getDateAsLocalFormattedString(
                          item.rosterNextStartAt,
                        ),
                      })}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">
                      {translator.translateText("No upcoming shifts")}
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
