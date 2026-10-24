import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationOwnerTeam from "Common/Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerUser from "Common/Models/DatabaseModels/RumApplicationOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import { getFirstRunTopContent } from "../../Components/Infrastructure/FirstRecordWatch";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import RumDocumentationCard from "../../Components/Rum/RumDocumentationCard";

const RumApplications: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  const { archiveBulkActions } = useBulkArchiveActions<RumApplication>({
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

  useEffect(() => {
    ModelAPI.count({
      modelType: RumApplication,
      query: {},
    })
      .then(setCount)
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (count === null) {
    return <PageLoader isVisible={true} />;
  }

  /*
   * The create form asks for the one thing an application cannot be created
   * without: the service.name its SDK reports. The display name follows it
   * - an application added here is named like a discovered one - and folds
   * under Advanced with the description and the labels, so the form is two
   * rows (DiscoveredResourceFormFields).
   */
  const advancedSection: FormFieldCollapsibleSection<RumApplication> =
    getAdvancedFormSection<RumApplication>();

  return (
    <Fragment>
      <ModelTable<RumApplication>
        modelType={RumApplication}
        id="rum-applications-table"
        userPreferencesKey="rum-applications-table"
        topContent={getFirstRunTopContent({
          topContent: filterBar,
          count: count,
        })}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({
          isArchived: false,
        })}
        onFetchSuccess={(data: Array<RumApplication>) => {
          onResourcesFetched(data);
        }}
        onCreateSuccess={(item: RumApplication): Promise<RumApplication> => {
          setCount((currentCount: number | null): number => {
            return (currentCount || 0) + 1;
          });
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
        }}
        formFields={[
          getIdentityFormField<RumApplication>({
            field: {
              appIdentifier: true,
            },
            title: "App Name (service.name)",
            placeholder: "storefront-web",
            description:
              "The service.name your browser or mobile OpenTelemetry SDK reports, exactly. Telemetry is matched to this application by it.",
          }),
          getDisplayNameFormField<RumApplication>({
            getDefaultName:
              getNameFromIdentityField<RumApplication>("appIdentifier"),
            placeholder: "Storefront",
            description:
              "Starts as the app name. Type your own name to show instead; telemetry is still matched by the app name.",
            collapsibleSection: advancedSection,
          }),
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Customer-facing storefront web app",
            collapsibleSection: advancedSection,
          },
          getLabelsFormField<RumApplication>({
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
      {count === 0 && (
        <RumDocumentationCard
          title="Getting Started with Real User Monitoring"
          description="Pick what you are instrumenting and follow the steps. Your app appears in the list above once its first telemetry arrives."
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default RumApplications;
