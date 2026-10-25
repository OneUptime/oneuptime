import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getArchivedAtFilter,
  getArchivedColumns,
} from "../../Components/Archive/ArchivedColumns";
import { ON_CALL_POLICY_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Distinct from the live list's key, so the two tables never share saved
 * column preferences or URL filter state.
 */
export const ON_CALL_POLICIES_ARCHIVED_TABLE_ID: string =
  "on-call-policies-archived-table";

/**
 * On-call policies that have been archived: they page no one - an incident or
 * alert that still lists one gets a "not executed" execution log saying why -
 * and they are hidden from the On-Call Policies list until unarchived. Their
 * escalation rules and execution history are kept.
 */
const OnCallDutyPoliciesArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<OnCallDutyPolicy>({
      modelType: OnCallDutyPolicy,
      singularName: ON_CALL_POLICY_ARCHIVE_COPY.singularName,
      pluralName: ON_CALL_POLICY_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage:
        ON_CALL_POLICY_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage:
        ON_CALL_POLICY_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
    });

  /*
   * The Owner and Labels chips above the table, as on the live list: an
   * archived one can be found by the person or the team that owns it - the
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
  } = useResourceOwners<OnCallDutyPolicy>({
    persistKey: ON_CALL_POLICIES_ARCHIVED_TABLE_ID,
    ownerUserModelType: OnCallDutyPolicyOwnerUser,
    ownerTeamModelType: OnCallDutyPolicyOwnerTeam,
    resourceIdField: "onCallDutyPolicyId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<OnCallDutyPolicy>
        modelType={OnCallDutyPolicy}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id={ON_CALL_POLICIES_ARCHIVED_TABLE_ID}
        userPreferencesKey={ON_CALL_POLICIES_ARCHIVED_TABLE_ID}
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<OnCallDutyPolicy>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name={ON_CALL_POLICY_ARCHIVE_COPY.archivedPageTitle}
        cardProps={{
          title: ON_CALL_POLICY_ARCHIVE_COPY.archivedPageTitle,
          description: ON_CALL_POLICY_ARCHIVE_COPY.archivedPageDescription,
        }}
        noItemsMessage={ON_CALL_POLICY_ARCHIVE_COPY.noArchivedItemsMessage}
        searchableFields={["name", "description"]}
        sortBy="archivedAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          getArchivedAtFilter<OnCallDutyPolicy>(),
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
          ...getArchivedColumns<OnCallDutyPolicy>(),
        ]}
        onViewPage={(item: OnCallDutyPolicy): Promise<Route> => {
          /*
           * /on-call-duty/policies/<id>; the table's default (this list's URL
           * + /<id>) would be /policies/archived/<id>, which no route matches.
           */
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default OnCallDutyPoliciesArchived;
