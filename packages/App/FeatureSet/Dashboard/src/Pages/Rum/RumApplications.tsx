import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationOwnerTeam from "Common/Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerUser from "Common/Models/DatabaseModels/RumApplicationOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import {
  FIRST_RUN_GUIDE_DESCRIPTION,
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AddResourceGuide from "../../Components/ResourceOnboarding/AddResourceGuide";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import RUM_APPLICATION_ONBOARDING from "../../Components/Rum/RumApplicationOnboarding";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";

const RumApplications: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * While the project has no application the list shows the Add guide
   * under the empty table and watches for the first one, as every
   * infrastructure list does.
   */
  const firstRecordWatch: FirstRecordWatch =
    useFirstRecordWatch<RumApplication>({
      modelType: RumApplication,
    });
  const [isAddApplicationOpen, setIsAddApplicationOpen] =
    useState<boolean>(false);
  // Applications connected from the Add dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<RumApplication>({
      modelType: RumApplication,
    });

  /*
   * Labels and owners in Bulk Actions, as on every other resource list:
   * the list shows and filters an application by them, and they were set
   * one at a time.
   */
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<RumApplication>({ modelType: RumApplication });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<RumApplication>({
      ownerUserModelType: RumApplicationOwnerUser,
      ownerTeamModelType: RumApplicationOwnerTeam,
      resourceIdField: "rumApplicationId",
    });

  /*
   * The Owner and Labels chips above the table: an application can be found by the
   * person or the team that owns it - the server answers the Owner chip in
   * the list's own query - and the Owners column shows who that is.
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
  } = useResourceOwners<RumApplication>({
    persistKey: "rum-applications-table",
    ownerUserModelType: RumApplicationOwnerUser,
    ownerTeamModelType: RumApplicationOwnerTeam,
    resourceIdField: "rumApplicationId",
    showLabelsFacet: true,
  });

  if (firstRecordWatch.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (firstRecordWatch.error) {
    return (
      <ErrorMessage
        message={firstRecordWatch.error}
        onRefreshClick={firstRecordWatch.retry}
      />
    );
  }

  /*
   * An application is added by putting the snippet in it (Add RUM
   * Application): the guide asks for the app's name, writes it into the
   * snippet as service.name, and the application registers itself under it
   * when its first data arrives. There is no form: an application typed in
   * by hand would only wait for telemetry that nothing sends.
   */

  return (
    <Fragment>
      <ModelTable<RumApplication>
        modelType={RumApplication}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        id="rum-applications-table"
        userPreferencesKey="rum-applications-table"
        topContent={getFirstRunTopContent({
          topContent: filterBar,
          count: firstRecordWatch.count,
        })}
        emptyState={getFirstRunEmptyState({
          emptyState: facetEmptyState,
          count: firstRecordWatch.count,
        })}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: false,
        })}
        onFetchSuccess={(data: Array<RumApplication>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        showRefreshButton={true}
        showViewIdButton={true}
        name="RUM Applications"
        searchableFields={["name", "description"]}
        selectMoreFields={{
          appIdentifier: true,
          clientType: true,
        }}
        /*
         * Also what the empty list says: in plain words, not the resource
         * attributes ingest matches on ("browser.* / device.*").
         */
        cardProps={{
          title: "RUM Applications",
          description:
            "Your web and mobile apps, as their real users see them. Each app appears here once it sends telemetry.",
          buttons: [
            {
              title: RUM_APPLICATION_ONBOARDING.addTitle,
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setIsAddApplicationOpen(true);
              },
            },
          ],
        }}
        formFields={[]}
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
              appIdentifier: true,
            },
            title: "App Name (service.name)",
            type: FieldType.Text,
          },
          {
            field: {
              clientType: true,
            },
            title: "Client Type",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              const id: string = (item.appIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <div className="min-w-0">
                  <AppLink
                    to={route}
                    className="text-sm font-medium text-gray-900 truncate hover:underline"
                  >
                    {name || "—"}
                  </AppLink>
                  {showId && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {id}
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              clientType: true,
            },
            title: "Client Type",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: RumApplication): ReactElement => {
              const clientType: string = (item.clientType as string) || "";
              if (!clientType) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <span className="text-sm text-gray-700 capitalize">
                  {clientType}
                </span>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              return (
                <Pill
                  text={isConnected ? "Connected" : "Disconnected"}
                  color={isConnected ? Green : Red}
                />
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
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
            getElement: (item: RumApplication): ReactElement => {
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
            getElement: (item: RumApplication): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: RumApplication): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {firstRecordWatch.count === 0 && (
        <AddResourceGuide
          onboarding={RUM_APPLICATION_ONBOARDING}
          title={RUM_APPLICATION_ONBOARDING.firstRunTitle}
          description={FIRST_RUN_GUIDE_DESCRIPTION}
          onConnected={() => {
            // The guide gives way, and the table reads the new application.
            firstRecordWatch.onRecordCreated();
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {isAddApplicationOpen && (
        <AddResourceModal
          onboarding={RUM_APPLICATION_ONBOARDING}
          onClose={() => {
            setIsAddApplicationOpen(false);
          }}
          onConnected={() => {
            setConnectedCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default RumApplications;
