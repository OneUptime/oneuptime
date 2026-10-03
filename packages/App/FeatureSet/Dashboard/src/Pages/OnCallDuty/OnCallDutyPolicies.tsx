import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import { ON_CALL_POLICY_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import useCustomFieldFacets from "../../Components/CustomFields/useCustomFieldFacets";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import { getOnCallPolicyCreateFormFields } from "../../Components/OnCallPolicy/OnCallPolicyCreateForm";

/*
 * Whether the user may add escalation rules, which "Who gets paged first?"
 * does for them: the policy's first rule is created as the user.
 */
const canAddEscalationRules: () => boolean = (): boolean => {
  return PermissionGate.check(
    new OnCallDutyPolicyEscalationRule(),
    ModelAction.Create,
  ).isAllowed;
};

const OnCallDutyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<OnCallDutyPolicy>({ modelType: OnCallDutyPolicy });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<OnCallDutyPolicy>({
      ownerUserModelType: OnCallDutyPolicyOwnerUser,
      ownerTeamModelType: OnCallDutyPolicyOwnerTeam,
      resourceIdField: "onCallDutyPolicyId",
    });

  // Archived policies leave this list; they are on the Archived page.
  const { archiveBulkActions } = useBulkArchiveActions<OnCallDutyPolicy>({
    modelType: OnCallDutyPolicy,
    singularName: ON_CALL_POLICY_ARCHIVE_COPY.singularName,
    pluralName: ON_CALL_POLICY_ARCHIVE_COPY.pluralName,
    archiveConfirmMessage:
      ON_CALL_POLICY_ARCHIVE_COPY.bulkArchiveConfirmMessage,
    unarchiveConfirmMessage:
      ON_CALL_POLICY_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
  });

  /*
   * One chip per custom field this project has defined. They arrive a render
   * or two late (the definitions are fetched), which is what
   * `areFacetsLoading` below tells the bar.
   */
  const { facets: customFieldFacets, isLoading: areCustomFieldFacetsLoading } =
    useCustomFieldFacets({
      customFieldsModelType: OnCallDutyPolicyCustomField,
    });

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<OnCallDutyPolicy>({
    persistKey: "on-call-policies-table",
    ownerUserModelType: OnCallDutyPolicyOwnerUser,
    ownerTeamModelType: OnCallDutyPolicyOwnerTeam,
    resourceIdField: "onCallDutyPolicyId",
    showLabelsFacet: true,
    extraFacets: customFieldFacets,
    areFacetsLoading: areCustomFieldFacetsLoading,
  });

  /*
   * Name, who gets paged first, and the description and labels folded under
   * Advanced (OnCallPolicyCreateForm.ts). Built once, not on every render of
   * the page.
   */
  const createFormFields: Array<ModelField<OnCallDutyPolicy>> = useMemo(
    (): Array<ModelField<OnCallDutyPolicy>> => {
      return getOnCallPolicyCreateFormFields({
        canAddEscalationRules: canAddEscalationRules,
      });
    },
    [],
  );

  return (
    <Fragment>
      <ModelTable<OnCallDutyPolicy>
        modelType={OnCallDutyPolicy}
        enableJsonImportExport={true}
        id="on-call-duty-table"
        userPreferencesKey="on-call-duty-table"
        customFieldsModelType={OnCallDutyPolicyCustomField}
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<OnCallDutyPolicy>) => {
          onResourcesFetched(data);
        }}
        saveFilterProps={{
          tableId: "on-call-policies-table",
        }}
        isDeleteable={false}
        name="On-Call > Policies"
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        cardProps={{
          title: "On-Call Duty Policies",
          description:
            "On-call policies decide who is notified when an incident or alert opens, and who is next if nobody acknowledges it.",
        }}
        videoLink={URL.fromString("https://youtu.be/HzhKmCryYdc")}
        formFields={createFormFields}
        onCreateSuccess={(item: OnCallDutyPolicy): Promise<OnCallDutyPolicy> => {
          /*
           * A new policy opens on its Escalation Rules: Level 1 is there when
           * someone was picked to be paged first, and adding the first rule
           * is the one thing to do when nobody was.
           */
          if (item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route,
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
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,

            getElement: (item: OnCallDutyPolicy): ReactElement => {
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
            getElement: (item: OnCallDutyPolicy): ReactElement => {
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
    </Fragment>
  );
};

export default OnCallDutyPage;
