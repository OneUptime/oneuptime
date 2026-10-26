import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionOwnerTeam from "Common/Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import ServerlessFunctionOwnerUser from "Common/Models/DatabaseModels/ServerlessFunctionOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
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
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import SERVERLESS_FUNCTION_ONBOARDING from "../../Components/Serverless/ServerlessFunctionOnboarding";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import SERVERLESS_FUNCTION_SHOWCASE from "../../Components/Serverless/ServerlessFunctionShowcase";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const ServerlessFunctions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch =
    useFirstRecordWatch<ServerlessFunction>({
      modelType: ServerlessFunction,
    });
  const [isAddFunctionOpen, setIsAddFunctionOpen] = useState<boolean>(false);
  // Functions connected from the Add dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<ServerlessFunction>({
      modelType: ServerlessFunction,
    });

  /*
   * Labels and owners in Bulk Actions, as on every other resource list:
   * the list shows and filters a function by them, and they were set
   * one at a time.
   */
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<ServerlessFunction>({ modelType: ServerlessFunction });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<ServerlessFunction>({
      ownerUserModelType: ServerlessFunctionOwnerUser,
      ownerTeamModelType: ServerlessFunctionOwnerTeam,
      resourceIdField: "serverlessFunctionId",
    });

  /*
   * The Owner and Labels chips above the table: a function can be found by the
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
  } = useResourceOwners<ServerlessFunction>({
    persistKey: "serverless-functions-table",
    ownerUserModelType: ServerlessFunctionOwnerUser,
    ownerTeamModelType: ServerlessFunctionOwnerTeam,
    resourceIdField: "serverlessFunctionId",
    showLabelsFacet: true,
  });

  if (firstRecordWatch.error) {
    return (
      <ErrorMessage
        message={firstRecordWatch.error}
        onRefreshClick={firstRecordWatch.retry}
      />
    );
  }

  if (firstRecordWatch.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  /*
   * A function is added by instrumenting it (Add Serverless Function): it
   * registers itself under its faas.name when its first data arrives, and
   * the guide's last step says so. There is no form: a function typed in
   * by hand would only wait for telemetry that nothing sends.
   */
  return (
    <Fragment>
      <ModelTable<ServerlessFunction>
        modelType={ServerlessFunction}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
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
        id="serverless-functions-table"
        userPreferencesKey="serverless-functions-table"
        query={mergeFiltersIntoQuery({
          isArchived: false,
        })}
        onFetchSuccess={(data: Array<ServerlessFunction>) => {
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
        name="Serverless Functions"
        searchableFields={["name", "description"]}
        selectMoreFields={{
          functionIdentifier: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          functionVersion: true,
        }}
        cardProps={{
          title: "Serverless Functions",
          description:
            "Serverless functions being monitored in this project. A function shows up here once its OpenTelemetry data arrives.",
          buttons: [
            {
              title: SERVERLESS_FUNCTION_ONBOARDING.addTitle,
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setIsAddFunctionOpen(true);
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
              functionIdentifier: true,
            },
            title: "Function Name (faas.name)",
            type: FieldType.Text,
          },
          {
            field: {
              cloudPlatform: true,
            },
            title: "Cloud Platform",
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
            getElement: (item: ServerlessFunction): ReactElement => {
              const id: string = (item.functionIdentifier as string) || "";
              const name: string = (item.name as string) || "";
              const showId: boolean = id !== "" && id !== name;
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW] as Route,
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
              cloudPlatform: true,
            },
            title: "Platform",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: ServerlessFunction): ReactElement => {
              const platform: string = (item.cloudPlatform as string) || "";
              const region: string = (item.cloudRegion as string) || "";
              if (!platform && !region) {
                return <span className="text-sm text-gray-400">—</span>;
              }
              return (
                <div className="text-sm text-gray-700">
                  <span className="font-mono">
                    {platform || translator.translateText("unknown")}
                  </span>
                  {region && (
                    <span className="ml-1.5 text-xs text-gray-500">
                      {region}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: ServerlessFunction): ReactElement => {
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
            getElement: (item: ServerlessFunction): ReactElement => {
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
            getElement: (item: ServerlessFunction): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: ServerlessFunction): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {firstRecordWatch.count === 0 && (
        <ResourceShowcaseCard
          showcase={SERVERLESS_FUNCTION_SHOWCASE}
          addButton={{
            title: SERVERLESS_FUNCTION_ONBOARDING.addTitle,
            onClick: () => {
              setIsAddFunctionOpen(true);
            },
          }}
        />
      )}
      {isAddFunctionOpen && (
        <AddResourceModal
          onboarding={SERVERLESS_FUNCTION_ONBOARDING}
          onClose={() => {
            setIsAddFunctionOpen(false);
          }}
          onConnected={() => {
            // The showcase gives way, and the table reads the new function.
            firstRecordWatch.onRecordCreated();
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

export default ServerlessFunctions;
