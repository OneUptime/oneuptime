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
import ProfileUtil from "../../Utils/ProfileUtil";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

const PROFILE_TYPE_FILTER_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "CPU time", value: "cpu" },
  { label: "CPU samples", value: "samples" },
  { label: "Wall time", value: "wall" },
  { label: "Live memory (objects)", value: "inuse_objects" },
  { label: "Live memory (bytes)", value: "inuse_space" },
  { label: "Allocations (count)", value: "alloc_objects" },
  { label: "Allocations (bytes)", value: "alloc_space" },
  { label: "Heap memory", value: "heap" },
  { label: "Goroutines", value: "goroutine" },
  { label: "Lock contention", value: "contention" },
  { label: "Mutex contention", value: "mutex" },
  { label: "Blocking operations", value: "block" },
];

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
          singularName="Performance Profile"
          pluralName="Performance Profiles"
          name="Performance Profiles"
          isViewable={true}
          cardProps={
            props.isMinimalTable
              ? undefined
              : {
                  title: "All profiles",
                  description:
                    "Every row is one ~60-second recording of a service. Prefer the aggregated view on the Overview page for answering \u201cwhat is slow right now\u201d \u2014 individual profiles are most useful when you need a specific recording (for example, one linked from a slow trace).",
                }
          }
          query={query}
          selectMoreFields={{
            profileId: true,
            durationNano: true,
            traceId: true,
            unit: true,
          }}
          showViewIdButton={true}
          noItemsMessage={
            props.noItemsMessage
              ? props.noItemsMessage
              : "No performance profiles found. Profiles are captured automatically by the OneUptime SDK once you enable the profiler in your service. See the documentation for setup instructions."
          }
          showRefreshButton={true}
          sortBy="startTime"
          sortOrder={SortOrder.Descending}
          onViewPage={(profile: Profile) => {
            return Promise.resolve(
              RouteUtil.populateRouteParams(RouteMap[PageMap.PROFILE_VIEW]!, {
                modelId: profile.profileId!,
              }),
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
              type: FieldType.MultiSelectDropdown,
              filterDropdownOptions: PROFILE_TYPE_FILTER_OPTIONS,
              title: "Type",
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
              title: "Captured At",
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
                serviceId: true,
              },
              title: "Service",
              type: FieldType.Element,
              getElement: (profile: Profile): ReactElement => {
                const telemetryService: Service | undefined =
                  telemetryServices.find((service: Service) => {
                    return (
                      service.id?.toString() === profile.serviceId?.toString()
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
                profileType: true,
              },
              title: "Type",
              type: FieldType.Element,
              getElement: (profile: Profile): ReactElement => {
                const profileType: string = profile.profileType || "unknown";
                const displayName: string =
                  ProfileUtil.getProfileTypeDisplayName(profileType);
                const badgeColor: string =
                  ProfileUtil.getProfileTypeBadgeColor(profileType);

                return (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}
                  >
                    {displayName}
                  </span>
                );
              },
            },
            {
              field: {
                sampleCount: true,
              },
              title: "Duration / Samples",
              description:
                "How long the recording covers, and how many samples were collected. More samples = higher fidelity.",
              type: FieldType.Element,
              getElement: (profile: Profile): ReactElement => {
                const durationNano: number = profile.durationNano
                  ? Number(profile.durationNano)
                  : 0;
                const sampleCount: number = profile.sampleCount
                  ? Number(profile.sampleCount)
                  : 0;

                const durationLabel: string =
                  durationNano > 0
                    ? ProfileUtil.formatProfileValue(
                        durationNano,
                        "nanoseconds",
                      )
                    : "—";

                return (
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {durationLabel}
                    </span>
                    <span className="text-xs text-gray-500">
                      {sampleCount.toLocaleString()} samples
                    </span>
                  </div>
                );
              },
            },
            {
              field: {
                traceId: true,
              },
              title: "Trace",
              description:
                "If this profile was captured during a traced request, click to jump to the trace.",
              type: FieldType.Element,
              getElement: (profile: Profile): ReactElement => {
                const traceId: string | undefined = profile.traceId?.toString();

                if (!traceId) {
                  /*
                   * Most profiles today aren't attached to a specific
                   * request; show nothing rather than a confusing em-dash.
                   */
                  return <span className="text-xs text-gray-300">—</span>;
                }

                const traceRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.TRACE_VIEW]!,
                  {
                    modelId: traceId,
                  },
                );

                const shortId: string =
                  traceId.length > 12 ? `${traceId.substring(0, 8)}…` : traceId;

                return (
                  <Link
                    to={traceRoute}
                    className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
                    title={`Open trace ${traceId}`}
                  >
                    <Icon icon={IconProp.Link} className="h-3.5 w-3.5" />
                    <span className="font-mono">{shortId}</span>
                  </Link>
                );
              },
            },
            {
              field: {
                startTime: true,
              },
              title: "Captured",
              type: FieldType.DateTime,
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default ProfileTable;
