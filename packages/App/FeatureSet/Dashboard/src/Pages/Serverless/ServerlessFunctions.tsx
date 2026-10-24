import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionOwnerTeam from "Common/Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import ServerlessFunctionOwnerUser from "Common/Models/DatabaseModels/ServerlessFunctionOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import {
  getDisplayNameFormField,
  getIdentityFormField,
  getNameFromIdentityField,
} from "../../Utils/Form/DiscoveredResourceFormFields";
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
  FIRST_RUN_GUIDE_DESCRIPTION,
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ServerlessDocumentationCard from "../../Components/Serverless/ServerlessDocumentationCard";
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

  const { archiveBulkActions } = useBulkArchiveActions<ServerlessFunction>({
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
   * The create form asks for the one thing a function cannot be created
   * without: the faas.name its telemetry carries (on Azure Functions,
   * ingest fills it in from service.name). The display name follows it - a
   * function added here is named like a discovered one - and folds under
   * Advanced with the description and the labels, so the form is two rows
   * (DiscoveredResourceFormFields).
   */
  const advancedSection: FormFieldCollapsibleSection<ServerlessFunction> =
    getAdvancedFormSection<ServerlessFunction>();

  return (
    <Fragment>
      <ModelTable<ServerlessFunction>
        modelType={ServerlessFunction}
        refreshToggle={firstRecordWatch.refreshToken}
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
        onCreateSuccess={(
          item: ServerlessFunction,
        ): Promise<ServerlessFunction> => {
          firstRecordWatch.onRecordCreated();
          return Promise.resolve(item);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
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
        }}
        formFields={[
          getIdentityFormField<ServerlessFunction>({
            field: {
              functionIdentifier: true,
            },
            title: "Function Name (faas.name)",
            placeholder: "checkout-handler",
            description:
              "The faas.name your function's telemetry carries, exactly (on Azure Functions, the app's OTEL_SERVICE_NAME).",
          }),
          getDisplayNameFormField<ServerlessFunction>({
            getDefaultName:
              getNameFromIdentityField<ServerlessFunction>(
                "functionIdentifier",
              ),
            placeholder: "Checkout handler",
            description:
              "Starts as the function name. Type your own name to show instead; telemetry is still matched by the function name.",
            collapsibleSection: advancedSection,
          }),
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Handles checkout events",
            collapsibleSection: advancedSection,
          },
          getLabelsFormField<ServerlessFunction>({
            collapsibleSection: advancedSection,
          }),
        ]}
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
        <ServerlessDocumentationCard
          title="Getting Started with Serverless Functions"
          description={FIRST_RUN_GUIDE_DESCRIPTION}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default ServerlessFunctions;
