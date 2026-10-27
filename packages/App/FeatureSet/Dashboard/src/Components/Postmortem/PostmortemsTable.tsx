import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import { Black } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners from "../ResourceOwners/useResourceOwners";
import useBulkPostmortemStatusAction from "./BulkPostmortemStatusAction";
import { POSTMORTEMS_TABLE_ID } from "./PostmortemListFacetKeys";
import { POSTMORTEM_LIST_FACETS } from "./PostmortemListFacets";
import PostmortemStatusPicker from "./PostmortemStatusPicker";
import PostmortemStatusSummaryCards from "./PostmortemStatusSummaryCards";
import {
  PostmortemStatusTile,
  applyPostmortemStatusTile,
  getPostmortemStatusTiles,
} from "./PostmortemStatusTiles";
import usePostmortemStatuses, {
  PostmortemStatusesState,
} from "./usePostmortemStatuses";

export const POSTMORTEMS_CARD_TITLE: string = translationKey("Postmortems");
export const POSTMORTEMS_CARD_DESCRIPTION: string = translationKey(
  "Every incident's postmortem: where it stands and who owns it. Filter by owner, severity or status to see which are still owed.",
);
export const POSTMORTEMS_EMPTY_TITLE: string =
  translationKey("No postmortems yet");
export const POSTMORTEMS_EMPTY_DESCRIPTION: string = translationKey(
  "When an incident is declared, its postmortem shows up here.",
);

/*
 * The Incident column holds a number ("INC-101"): it names its own floor, so
 * it is not the row's name that takes a fitting table's spare room
 * (TableLayout's first-column fill, with a 10rem floor). Left to fill, it
 * stood 184px wide around "INC-101" while the titles beside it wrapped to
 * three lines at 1280px; the room is the title's now.
 */
export const INCIDENT_NUMBER_COLUMN_CLASS_NAME: string = "min-w-[4rem]";

// An incident's Postmortem page, where its postmortem is written.
export const getIncidentPostmortemRoute: (incidentId: ObjectID) => Route = (
  incidentId: ObjectID,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.INCIDENT_VIEW_POSTMORTEM] as Route,
    { modelId: incidentId },
  );
};

export interface ComponentProps {
  // The incidents the list covers: the project's, by default.
  query?: Query<Incident> | undefined;
}

/*
 * Every incident's postmortem, across the project (Incidents > Postmortems):
 * the incident, where its postmortem stands, its severity, who owns it and
 * when it was declared, newest first. The customer's question - "which
 * postmortems are still owed, by which team, for which severity?" - is the
 * Owner, Severity and Postmortem Status chips together, and the counts
 * above the list answer how many are in each status at a glance.
 *
 * A postmortem's status is changed right in its row (the same pill as on
 * its page), or for many at once (Change Postmortem Status); a row opens
 * the incident's Postmortem page, where it is written.
 */
const PostmortemsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const postmortemStatuses: PostmortemStatusesState = usePostmortemStatuses();

  /*
   * Bumped after a move made from the list - a row's pill, the bulk
   * action - so the counts and the rows read again.
   */
  const [refreshToken, setRefreshToken] = useState<number>(0);

  const refresh: () => void = (): void => {
    setRefreshToken((previous: number) => {
      return previous + 1;
    });
  };

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
    facetSelections,
    facetOperators,
    setFacetSelection,
  } = useResourceOwners<Incident>({
    persistKey: POSTMORTEMS_TABLE_ID,
    ownerUserModelType: IncidentOwnerUser,
    ownerTeamModelType: IncidentOwnerTeam,
    resourceIdField: "incidentId",
    showLabelsFacet: true,
    extraFacets: POSTMORTEM_LIST_FACETS,
  });

  // Add Owner / Remove Owner: who owns an incident owns its postmortem.
  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Incident>({
      ownerUserModelType: IncidentOwnerUser,
      ownerTeamModelType: IncidentOwnerTeam,
      resourceIdField: "incidentId",
    });

  const { bulkAction: statusBulkAction, modal: statusBulkActionModal } =
    useBulkPostmortemStatusAction({
      choices: postmortemStatuses.choices,
      onDone: refresh,
    });

  const tiles: Array<PostmortemStatusTile> = getPostmortemStatusTiles(
    postmortemStatuses.choices,
  );

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Moving a postmortem is an update of its incident.
  const canMoveStatus: boolean = PermissionGate.check(
    new Incident(),
    ModelAction.Update,
  ).isAllowed;

  return (
    <>
      {projectId ? (
        <PostmortemStatusSummaryCards
          projectId={projectId}
          tiles={tiles}
          facetSelections={facetSelections}
          facetOperators={facetOperators}
          refreshToken={refreshToken.toString()}
          onTileClick={(tile: PostmortemStatusTile) => {
            applyPostmortemStatusTile({
              tile: tile,
              facetSelections: facetSelections,
              facetOperators: facetOperators,
              setFacetSelection: setFacetSelection,
            });
          }}
        />
      ) : (
        <></>
      )}

      <ModelTable<Incident>
        name="Postmortems"
        modelType={Incident}
        id={POSTMORTEMS_TABLE_ID}
        userPreferencesKey={POSTMORTEMS_TABLE_ID}
        urlStateKey={POSTMORTEMS_TABLE_ID}
        saveFilterProps={{
          tableId: POSTMORTEMS_TABLE_ID,
        }}
        refreshToggle={refreshToken.toString()}
        bulkActions={{
          buttons: [statusBulkAction, ...ownerBulkActions],
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showCreateForm={false}
        isViewable={true}
        /*
         * A row opens the incident's Postmortem page: "View Incident" would
         * promise its overview, and the shortest word leaves the columns
         * their room beside the side menu.
         */
        viewButtonText="View"
        onViewPage={async (item: Incident): Promise<Route> => {
          return getIncidentPostmortemRoute(new ObjectID(item._id as string));
        }}
        topContent={filterBar}
        emptyState={{
          title: POSTMORTEMS_EMPTY_TITLE,
          description: POSTMORTEMS_EMPTY_DESCRIPTION,
          // A write-up, as in the side menu - not the incident's warning sign.
          icon: IconProp.DocumentText,
          hideCreateButton: true,
          ...facetEmptyState,
        }}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(
          props.query || {
            projectId: projectId!,
          },
        )}
        onFetchSuccess={(data: Array<Incident>) => {
          onResourcesFetched(data);
        }}
        cardProps={{
          title: POSTMORTEMS_CARD_TITLE,
          description: POSTMORTEMS_CARD_DESCRIPTION,
        }}
        showRefreshButton={true}
        searchableFields={["title"]}
        filters={[
          {
            title: "Incident Number",
            type: FieldType.Number,
            field: {
              incidentNumber: true,
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              declaredAt: true,
            },
            title: "Declared",
            type: FieldType.Date,
          },
        ]}
        selectMoreFields={{
          incidentNumberWithPrefix: true,
          postmortemStatusId: true,
        }}
        columns={[
          {
            field: {
              incidentNumber: true,
            },
            title: "Incident",
            type: FieldType.Text,
            // The row's name: always shown, so a list never loses which incident a row is.
            isNotCustomizable: true,
            contentClassName: INCIDENT_NUMBER_COLUMN_CLASS_NAME,
            getElement: (item: Incident): ReactElement => {
              const numberLabel: string =
                item.incidentNumberWithPrefix ||
                (item.incidentNumber ? `#${item.incidentNumber}` : "-");

              if (!item._id) {
                return <span>{numberLabel}</span>;
              }

              return (
                <AppLink
                  className="font-medium text-gray-900 hover:underline"
                  to={getIncidentPostmortemRoute(
                    new ObjectID(item._id as string),
                  )}
                >
                  <span>{numberLabel}</span>
                </AppLink>
              );
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Element,
            /*
             * A title is anyone's sentence: it wraps, capped so the status,
             * severity and owners keep their room beside the side menu -
             * and never narrower than 9rem, not the 10rem of a column of
             * prose: in German the row's Anzeigen and "Nicht erforderlich"
             * left the table 2px past its card at 1280px.
             */
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[16rem] 2xl:max-w-md",
            contentClassName: "min-w-[9rem]",
            getElement: (item: Incident): ReactElement => {
              const title: string = item.title?.toString() || "";

              if (!item._id) {
                return <span>{title}</span>;
              }

              return (
                <AppLink
                  className="hover:underline"
                  to={getIncidentPostmortemRoute(
                    new ObjectID(item._id as string),
                  )}
                >
                  <span>{title}</span>
                </AppLink>
              );
            },
          },
          {
            field: {
              postmortemStatus: {
                _id: true,
                name: true,
                color: true,
              },
            },
            title: "Postmortem Status",
            type: FieldType.Entity,
            getElement: (item: Incident): ReactElement => {
              if (!item._id) {
                return <></>;
              }

              return (
                <PostmortemStatusPicker
                  incidentId={new ObjectID(item._id as string)}
                  statusId={
                    item.postmortemStatusId?.toString() ||
                    item.postmortemStatus?._id?.toString() ||
                    null
                  }
                  choices={postmortemStatuses.choices}
                  isEditable={canMoveStatus}
                  isInTable={true}
                  dataTestId="postmortem-row-status"
                  /*
                   * The counts change, and a list narrowed to a status may
                   * no longer hold the row: both read again.
                   */
                  onChanged={refresh}
                />
              );
            },
          },
          {
            field: {
              incidentSeverity: {
                name: true,
                color: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: Incident): ReactElement => {
              if (!item.incidentSeverity) {
                return <></>;
              }

              return (
                <Pill
                  isMinimal={true}
                  color={item.incidentSeverity.color || Black}
                  text={item.incidentSeverity.name || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            disableSort: true,
            getElement: (item: Incident): ReactElement => {
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
              declaredAt: true,
            },
            title: "Declared",
            /*
             * The day is what a list of postmortems is read by ("owed for
             * last week's incidents"); the time is on the incident. A date
             * alone also leaves the columns their room beside the side menu
             * in longer languages: with the time, German ran 57px past the
             * card at 1280px, under the sticky View.
             */
            type: FieldType.Date,
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
            // Filtered by with the Labels chip; shown from Columns when wanted.
            isHiddenByDefault: true,
            getElement: (item: Incident): ReactElement => {
              return <LabelsElement labels={item.labels || []} />;
            },
          },
        ]}
      />

      {statusBulkActionModal}
      {ownerBulkActionModals}
    </>
  );
};

export default PostmortemsTable;
