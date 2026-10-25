import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getArchivedAtFilter,
  getArchivedColumns,
} from "../../Components/Archive/ArchivedColumns";
import { WORKFLOW_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import WorkflowElement from "../../Components/Workflow/WorkflowElement";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowOwnerTeam from "Common/Models/DatabaseModels/WorkflowOwnerTeam";
import WorkflowOwnerUser from "Common/Models/DatabaseModels/WorkflowOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Distinct from the live list's key, so the two tables never share saved
 * column preferences or URL filter state.
 */
export const WORKFLOWS_ARCHIVED_TABLE_ID: string = "workflows-archived-table";

/**
 * Workflows that have been archived: hidden from the Workflows list and never
 * run, from any trigger, until they are unarchived. Nothing about them is
 * lost - their steps, variables and run history are all where they were.
 *
 * Unarchive is the bulk action on offer here (the table adds Delete itself
 * for anyone who may delete). "When Unarchived" answers the question
 * unarchiving raises: will this start running again? Only if it is enabled -
 * archiving never touches that switch.
 */
const WorkflowsArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions, unarchiveRowActions } =
    useBulkArchiveActions<Workflow>({
      modelType: Workflow,
      singularName: WORKFLOW_ARCHIVE_COPY.singularName,
      pluralName: WORKFLOW_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage: WORKFLOW_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage:
        WORKFLOW_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
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
  } = useResourceOwners<Workflow>({
    persistKey: WORKFLOWS_ARCHIVED_TABLE_ID,
    ownerUserModelType: WorkflowOwnerUser,
    ownerTeamModelType: WorkflowOwnerTeam,
    resourceIdField: "workflowId",
    showLabelsFacet: true,
  });

  return (
    <Fragment>
      <ModelTable<Workflow>
        modelType={Workflow}
        // Unarchive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...unarchiveRowActions]}
        id={WORKFLOWS_ARCHIVED_TABLE_ID}
        userPreferencesKey={WORKFLOWS_ARCHIVED_TABLE_ID}
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: true,
        })}
        onFetchSuccess={(data: Array<Workflow>) => {
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
        name={WORKFLOW_ARCHIVE_COPY.archivedPageTitle}
        cardProps={{
          title: WORKFLOW_ARCHIVE_COPY.archivedPageTitle,
          description: WORKFLOW_ARCHIVE_COPY.archivedPageDescription,
        }}
        noItemsMessage={WORKFLOW_ARCHIVE_COPY.noArchivedItemsMessage}
        searchableFields={["name", "description"]}
        // The workflow someone is looking for is usually the one just archived.
        sortBy="archivedAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            title: "Name",
            type: FieldType.Text,
            field: {
              name: true,
            },
          },
          getArchivedAtFilter<Workflow>(),
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Workflow): ReactElement => {
              return <WorkflowElement workflow={item} />;
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
              isEnabled: true,
            },
            /*
             * An archived workflow runs nothing whatever its switch says, so
             * the column answers what unarchiving will do instead.
             */
            title: "When Unarchived",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Workflow): ReactElement => {
              if (item.isEnabled) {
                return (
                  <Pill text="Runs again" color={Green500} isMinimal={true} />
                );
              }

              return (
                <Pill text="Stays disabled" color={Gray500} isMinimal={true} />
              );
            },
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
            getElement: (item: Workflow): ReactElement => {
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
            getElement: (item: Workflow): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
          ...getArchivedColumns<Workflow>(),
        ]}
        onViewPage={(item: Workflow): Promise<Route> => {
          /*
           * A workflow's pages live at /workflows/<id>; the table's default
           * (this list's URL + /<id>) would be /workflows/archived/<id>,
           * which no route matches.
           */
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_VIEW] as Route,
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

export default WorkflowsArchived;
