import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import UserElement from "../../Components/User/User";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import PageComponentProps from "../PageComponentProps";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import {
  addScheduleFirstLayerMiscData,
  getOnCallScheduleCreateFormFields,
} from "../../Components/OnCallPolicy/OnCallScheduleCreateForm";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import PlanLeftoverPage from "../../Components/Billing/PlanLeftoverPage";
import PlanLeftoverTable from "../../Components/Billing/PlanLeftoverTable";
import { PlanLeftoverTitle } from "../../Components/Billing/PlanLeftoverCopy";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";

/*
 * Whether the user may add layers and people to them, which "Who takes
 * turns?" does for them: the schedule's first layer is created as the user.
 */
const canAddScheduleLayers: () => boolean = (): boolean => {
  return (
    PermissionGate.check(
      new OnCallDutyPolicyScheduleLayer(),
      ModelAction.Create,
    ).isAllowed &&
    PermissionGate.check(
      new OnCallDutyPolicyScheduleLayerUser(),
      ModelAction.Create,
    ).isAllowed
  );
};

const OnCallDutyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<OnCallDutySchedule>({ modelType: OnCallDutySchedule });

  /*
   * Like Create On-Call Policy, which asks who gets paged first, the form
   * asks for the name and who takes turns, and folds how long each turn
   * lasts, the timezone, the description and the labels under Advanced
   * (OnCallScheduleCreateForm.ts). Three rows, so no steps. Built once, not
   * on every render of the page.
   */
  const createFormFields: Array<ModelField<OnCallDutySchedule>> =
    useMemo((): Array<ModelField<OnCallDutySchedule>> => {
      return getOnCallScheduleCreateFormFields({
        canAddLayers: canAddScheduleLayers,
      });
    }, []);

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
        formFields={createFormFields}
        onBeforeCreate={(
          item: OnCallDutySchedule,
          miscDataProps: JSONObject,
          formValues: JSONObject,
        ): Promise<OnCallDutySchedule> => {
          // How long each turn lasts goes with the people who take turns.
          addScheduleFirstLayerMiscData({
            miscDataProps: miscDataProps,
            formValues: formValues,
          });

          return Promise.resolve(item);
        }}
        onCreateSuccess={(
          item: OnCallDutySchedule,
        ): Promise<OnCallDutySchedule> => {
          /*
           * A new schedule opens on its Layers: the rotation is there when
           * someone was picked to take turns, and building it is the one
           * thing to do when nobody was.
           */
          if (item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }

          return Promise.resolve(item);
        }}
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

// The plan on-call schedules are sold at.
const ON_CALL_SCHEDULE_PLAN: PlanType =
  new OnCallDutySchedule().getCreateBillingPlan() || PlanType.Growth;

// The schedules a project below the plan still has: each can be deleted.
const OnCallSchedulesLeftover: FunctionComponent = (): ReactElement => {
  return (
    <PlanLeftoverTable<OnCallDutySchedule>
      modelType={OnCallDutySchedule}
      id="on-call-schedules"
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      requiredPlan={ON_CALL_SCHEDULE_PLAN}
      title={PlanLeftoverTitle.onCallSchedules}
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
            description: true,
          },
          noValueMessage: "-",
          title: "Description",
          type: FieldType.LongText,
        },
      ]}
    />
  );
};

/*
 * On-call schedules are sold on the Growth plan, and a schedule keeps paging
 * the people on it, through the escalation rules that name it, after a
 * project drops below the plan. Below it this page is the plan note with
 * the schedules the project still has under it, to delete
 * (PlanLeftoverPage); on the plan, and with billing off, it is the page.
 */
const OnCallDutySchedulesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <PlanLeftoverPage
      requiredPlan={ON_CALL_SCHEDULE_PLAN}
      leftovers={<OnCallSchedulesLeftover />}
    >
      <OnCallDutyPage {...props} />
    </PlanLeftoverPage>
  );
};

export default OnCallDutySchedulesPage;
