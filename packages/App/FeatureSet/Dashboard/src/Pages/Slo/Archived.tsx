import PageComponentProps from "../PageComponentProps";
import {
  getSloLastEvaluatedColumns,
  getSloTargetAndWindowColumns,
  getSloViewRoute,
  SLO_TABLE_SELECT_MORE_FIELDS,
} from "./Slos";
import useSloBulkActions, {
  SloBulkActionsResult,
} from "../../Components/Slo/useSloBulkActions";
import UserElement from "../../Components/User/User";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import User from "Common/Models/DatabaseModels/User";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Distinct from the live list's key, so the two tables never share saved
 * column preferences or URL filter state.
 */
export const SLOS_ARCHIVED_TABLE_ID: string = "slos-archived-table";

/**
 * SLOs that have been archived: retired without deleting their history. They
 * are hidden from the SLO list and the evaluation worker skips them, so this
 * page shows what each one promised (target and window), when it was last
 * measured, and who archived it - not its frozen SLI and budget, which would
 * read as live numbers.
 *
 * Unarchive is the only bulk action on offer (bulk Delete is added by the
 * table itself for anyone who may delete). Re-labelling or re-owning SLOs
 * nobody is measuring is not something this page should invite.
 */
const SlosArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Through the shared hook, like every SLO table, so the unarchive copy and
   * its permission gating are the same everywhere an SLO can be restored.
   * Its modals belong to the label and owner actions this page does not
   * offer; they are mounted anyway, so the page keeps the wiring every SLO
   * table has and adding one of those actions later cannot open nothing.
   */
  const {
    unarchiveBulkActions,
    unarchiveRowActions,
    modals,
  }: SloBulkActionsResult = useSloBulkActions();

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
  } = useResourceOwners<ServiceLevelObjective>({
    persistKey: SLOS_ARCHIVED_TABLE_ID,
    ownerUserModelType: ServiceLevelObjectiveOwnerUser,
    ownerTeamModelType: ServiceLevelObjectiveOwnerTeam,
    resourceIdField: "serviceLevelObjectiveId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<ServiceLevelObjective>
        modelType={ServiceLevelObjective}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id={SLOS_ARCHIVED_TABLE_ID}
        userPreferencesKey={SLOS_ARCHIVED_TABLE_ID}
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<ServiceLevelObjective>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name="Archived SLOs"
        cardProps={{
          title: "Archived SLOs",
          description:
            "SLOs you have archived. They are hidden from the SLO list and are not evaluated, so their numbers stay frozen as of their last evaluation. Select SLOs to unarchive them and resume measuring.",
        }}
        noItemsMessage="No archived SLOs. Archive an SLO from its Settings page, or select SLOs in the SLO list and choose Archive."
        documentationLink={new Route("/docs/slo/introduction")}
        showViewIdButton={true}
        searchableFields={["name", "description"]}
        // Most recently archived first: the SLO someone is looking for is usually the one just archived.
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
          {
            field: {
              archivedAt: true,
            },
            title: "Archived At",
            type: FieldType.Date,
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
          ...getSloTargetAndWindowColumns(),
          ...getSloLastEvaluatedColumns(),
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
            getElement: (item: ServiceLevelObjective): ReactElement => {
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
            getElement: (item: ServiceLevelObjective): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
          {
            field: {
              archivedAt: true,
            },
            title: "Archived At",
            type: FieldType.DateTime,
          },
          {
            field: {
              archivedByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Archived By",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: ServiceLevelObjective): ReactElement => {
              /*
               * Empty for an SLO archived through the API with a project key,
               * or whose archiving user has since been deleted (SET NULL).
               */
              if (!item.archivedByUser) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              return <UserElement user={item.archivedByUser as User} />;
            },
          },
        ]}
        selectMoreFields={SLO_TABLE_SELECT_MORE_FIELDS}
        onViewPage={(item: ServiceLevelObjective): Promise<Route> => {
          return Promise.resolve(getSloViewRoute(item));
        }}
      />
      {modals}
    </Fragment>
  );
};

export default SlosArchived;
