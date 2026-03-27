import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Profile from "Common/Models/AnalyticsModels/Profile";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/Utils/API";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Query from "Common/Types/BaseDatabase/Query";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Service from "Common/Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ServiceElement from "../Service/ServiceElement";

export interface ComponentProps {
  modelId?: ObjectID | undefined;
  profileQuery?: Query<Profile> | undefined;
  isMinimalTable?: boolean | undefined;
  noItemsMessage?: string | undefined;
}

const ProfileTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modelId: ObjectID | undefined = props.modelId;

  const [attributes, setAttributes] = React.useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] =
    React.useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] =
    React.useState<boolean>(false);
  const [attributesError, setAttributesError] = React.useState<string>("");

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const [telemetryServices, setServices] = React.useState<Array<Service>>([]);

  const [areAdvancedFiltersVisible, setAreAdvancedFiltersVisible] =
    useState<boolean>(false);

  const query: Query<Profile> = React.useMemo(() => {
    const baseQuery: Query<Profile> = {
      ...(props.profileQuery || {}),
    };

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      baseQuery.projectId = projectId;
    }

    if (modelId) {
      baseQuery.serviceId = modelId;
    }

    return baseQuery;
  }, [props.profileQuery, modelId]);

  const loadServices: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);
      setPageError("");

      const telemetryServicesResponse: ListResult<Service> =
        await ModelAPI.getList({
          modelType: Service,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            serviceColor: true,
            name: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setServices(telemetryServicesResponse.data || []);
    } catch (err) {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setIsPageLoading(false);
    }
  };

  const loadAttributes: PromiseVoidFunction = async (): Promise<void> => {
    if (attributesLoading || attributesLoaded) {
      return;
    }

    try {
      setAttributesLoading(true);
      setAttributesError("");

      const attributeResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/profiles/get-attributes",
          ),
          data: {},
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (attributeResponse instanceof HTTPErrorResponse) {
        throw attributeResponse;
      }

      const fetchedAttributes: Array<string> = (attributeResponse.data[
        "attributes"
      ] || []) as Array<string>;
      setAttributes(fetchedAttributes);
      setAttributesLoaded(true);
    } catch (err) {
      setAttributes([]);
      setAttributesLoaded(false);
      setAttributesError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setAttributesLoading(false);
    }
  };

  useEffect(() => {
    loadServices().catch((err: Error) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  const handleAdvancedFiltersToggle: (show: boolean) => void = (
    show: boolean,
  ): void => {
    setAreAdvancedFiltersVisible(show);

    if (show && !attributesLoaded && !attributesLoading) {
      void loadAttributes();
    }
  };

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      {pageError && (
        <div className="mb-4">
          <ErrorMessage
            message={`We couldn't load telemetry services. ${pageError}`}
            onRefreshClick={() => {
              void loadServices();
            }}
          />
        </div>
      )}

      {areAdvancedFiltersVisible && attributesError && (
        <div className="mb-4">
          <ErrorMessage
            message={`We couldn't load profile attributes. ${attributesError}`}
            onRefreshClick={() => {
              setAttributesLoaded(false);
              void loadAttributes();
            }}
          />
        </div>
      )}

      <div className="rounded">
        <AnalyticsModelTable<Profile>
          userPreferencesKey="profile-table"
          disablePagination={props.isMinimalTable}
          modelType={Profile}
          id="profiles-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          singularName="Profile"
          pluralName="Profiles"
          name="Profiles"
          isViewable={true}
          cardProps={
            props.isMinimalTable
              ? undefined
              : {
                  title: "Profiles",
                  description:
                    "Continuous profiling data from your services. Profiles help you understand CPU, memory, and allocation hotspots in your applications.",
                }
          }
          query={query}
          showViewIdButton={true}
          noItemsMessage={
            props.noItemsMessage
              ? props.noItemsMessage
              : "No profiles found."
          }
          showRefreshButton={true}
          sortBy="startTime"
          sortOrder={SortOrder.Descending}
          onViewPage={(profile: Profile) => {
            return Promise.resolve(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROFILE_VIEW]!,
                {
                  modelId: profile.profileId!,
                },
              ),
            );
          }}
          filters={[
            {
              field: {
                serviceId: true,
              },
              type: FieldType.MultiSelectDropdown,
              filterDropdownOptions: telemetryServices.map(
                (service: Service) => {
                  return {
                    label: service.name!,
                    value: service.id!.toString(),
                  };
                },
              ),
              title: "Service",
            },
            {
              field: {
                profileType: true,
              },
              type: FieldType.Text,
              title: "Profile Type",
            },
            {
              field: {
                traceId: true,
              },
              type: FieldType.Text,
              title: "Trace ID",
            },
            {
              field: {
                startTime: true,
              },
              type: FieldType.DateTime,
              title: "Start Time",
            },
            {
              field: {
                attributes: true,
              },
              type: FieldType.JSON,
              title: "Attributes",
              jsonKeys: attributes,
              isAdvancedFilter: true,
            },
          ]}
          onAdvancedFiltersToggle={handleAdvancedFiltersToggle}
          columns={[
            {
              field: {
                profileId: true,
              },
              title: "Profile ID",
              type: FieldType.Text,
            },
            {
              field: {
                profileType: true,
              },
              title: "Profile Type",
              type: FieldType.Text,
            },
            {
              field: {
                serviceId: true,
              },
              title: "Service",
              type: FieldType.Element,
              getElement: (profile: Profile): ReactElement => {
                const telemetryService: Service | undefined =
                  telemetryServices.find((service: Service) => {
                    return (
                      service.id?.toString() ===
                      profile.serviceId?.toString()
                    );
                  });

                if (!telemetryService) {
                  return <p>Unknown</p>;
                }

                return (
                  <Fragment>
                    <ServiceElement service={telemetryService} />
                  </Fragment>
                );
              },
            },
            {
              field: {
                sampleCount: true,
              },
              title: "Samples",
              type: FieldType.Number,
            },
            {
              field: {
                startTime: true,
              },
              title: "Start Time",
              type: FieldType.DateTime,
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default ProfileTable;
