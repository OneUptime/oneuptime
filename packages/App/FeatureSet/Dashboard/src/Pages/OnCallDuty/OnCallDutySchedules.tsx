import LabelsElement from "Common/UI/Components/Label/Labels";
import {
  UsedByListActions,
  getUsedByListActions,
} from "../../Components/UsedBy/UsedByListActions";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import ProjectUtil from "Common/UI/Utils/Project";
import UserElement from "../../Components/User/User";
import IconProp from "Common/Types/Icon/IconProp";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  ON_CALL_SCHEDULES_IMPORT_OFFER,
  withToolImportOffer,
} from "../../Components/ToolImport/ToolImportOffer";
import PageComponentProps from "../PageComponentProps";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
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
import useSharedNames, {
  SharedNamesOfList,
} from "../../Components/SharedName/UseSharedNames";
import { SharedNameKind } from "Common/Types/Database/SharedNames";

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

  // Add and remove owners on many schedules at once, as on the policies list.
  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<OnCallDutySchedule>({
      ownerUserModelType: OnCallDutyPolicyScheduleOwnerUser,
      ownerTeamModelType: OnCallDutyPolicyScheduleOwnerTeam,
      resourceIdField: "onCallDutyPolicyScheduleId",
    });

  /*
   * The Owner and Labels chips above the table, as on the policies list: a
   * schedule can be found by the person or the team that owns it - the
   * server answers the Owner chip in the list's own query - and the Owners
   * column shows who that is.
   */
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<OnCallDutySchedule>({
    persistKey: "on-call-schedules-table",
    ownerUserModelType: OnCallDutyPolicyScheduleOwnerUser,
    ownerTeamModelType: OnCallDutyPolicyScheduleOwnerTeam,
    resourceIdField: "onCallDutyPolicyScheduleId",
    showLabelsFacet: true,
  });

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

  /*
   * A row's Delete and the bulk Delete say what still uses the
   * records first (#7435).
   */
  const usedBy: UsedByListActions<OnCallDutySchedule> =
    getUsedByListActions<OnCallDutySchedule>(UsedByRecordKind.OnCallSchedule);

  /*
   * Schedules that share a name with another schedule (#9746): made before
   * a schedule's name was one schedule's (#9742), they keep it, and every
   * picker draws them alike. Marked beside their name, counted above the
   * list with how to tell them apart, and each given Rename.
   */
  const sharedNames: SharedNamesOfList<OnCallDutySchedule> =
    useSharedNames<OnCallDutySchedule>({
      kind: SharedNameKind.OnCallSchedule,
      modelType: OnCallDutySchedule,
    });

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
        /*
         * Search's Create On-Call Schedule opens this list with ?create=1, and the table
         * opens its create form from it (#7035).
         */
        opensCreateFormFromAddress={true}
        refreshToggle={sharedNames.refreshToken}
        actionButtons={[sharedNames.renameAction]}
        topContent={
          <Fragment>
            {sharedNames.note}
            {filterBar}
          </Fragment>
        }
        /*
         * Beside the empty list's Create, a link to bring the schedules over
         * from PagerDuty, Opsgenie and the rest (ToolImportOffer).
         */
        emptyState={withToolImportOffer({
          emptyState: facetEmptyState,
          offer: ON_CALL_SCHEDULES_IMPORT_OFFER,
          translator: translator,
        })}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<OnCallDutySchedule>) => {
          onResourcesFetched(data);
          sharedNames.onListFetched();
        }}
        saveFilterProps={{
          tableId: "on-call-schedules-table",
        }}
        isDeleteable={true}
        getDeleteConfirmation={usedBy.getDeleteConfirmation}
        name="On-Call > Schedules"
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [...labelBulkActions, ...ownerBulkActions],
          deleteConfirmationDetails: usedBy.deleteConfirmationDetails,
        }}
        cardProps={{
          title: "On-Call Schedules",
          description:
            "Rotations that decide who is on call at any moment. Add a schedule to an on-call policy's escalation rules to page whoever is on call.",
          titleGlossaryTerm: GlossaryTerm.OnCallSchedule,
          buttons: [
            /*
             * Named as the page it opens, which the On-Call Duty menu,
             * Search and the trail all call Schedule Timeline. It said
             * "Timeline View", so the action and its page went by two
             * names.
             */
            {
              title: "Schedule Timeline",
              icon: IconProp.Timeline,
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
          // The schedule's name, marked when another schedule shares it (#9746).
          sharedNames.nameColumn,
          {
            field: {
              currentUserOnRoster: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "On-Call Now",
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
                  <Pill
                    text="No one on call"
                    tone={PillTone.Warning}
                    icon={IconProp.Alert}
                    className="w-fit"
                  />
                  {item.rosterNextStartAt && item.nextUserOnRoster ? (
                    <span className="text-xs text-gray-500">
                      {translator.translateTemplate("Resumes {{date}}", {
                        date: OneUptimeDate.getDateAsLocalFormattedString(
                          item.rosterNextStartAt,
                        ),
                      })}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500">
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
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: OnCallDutySchedule): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
      {sharedNames.renameModal}
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
