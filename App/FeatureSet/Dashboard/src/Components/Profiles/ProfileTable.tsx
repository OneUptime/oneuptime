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
  useCallback,
  useEffect,
  useMemo,
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
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Service from "Common/Models/DatabaseModels/Service";
import Host from "Common/Models/DatabaseModels/Host";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ServiceElement from "../Service/ServiceElement";
import ProfileUtil from "../../Utils/ProfileUtil";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import {
  ProfileEntityDisplay,
  ProfileEntityRef,
  buildProfileEntityTypeHints,
  collectProfileEntityRefs,
  getProfileEntityDisplay,
  getProfileEntityRefsKey,
  getProfileServiceFilterChipDisplay,
  hasProfileTableFilterRow,
} from "../../Utils/ProfilesEntityDisplay";
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../Utils/LockedEntityKeyChips";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import LockedFilterChip from "Common/UI/Components/TelemetryViewer/components/LockedFilterChip";

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
  /*
   * Scope to a OneUptime entity by its stable entityKeys (membership) —
   * compiles to `hasAny(entityKeys, [...])` server-side.
   */
  entityKeys?: Array<string> | undefined;
  /*
   * How the locked pill names each of `entityKeys` ("Kubernetes Pod:
   * checkout-7d9f"). Display only; without it the pill reads
   * "Resource: <key>" — it is never left out.
   */
  entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;
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
  const [hosts, setHosts] = React.useState<Array<Host>>([]);

  const [areAdvancedFiltersVisible, setAreAdvancedFiltersVisible] =
    useState<boolean>(false);

  /*
   * Deep-link filters: trace pages link here with ?traceId=..., and the
   * Profiler overview's "All profiles" link carries ?serviceId= /
   * ?profileType= so the list opens in the context the user was just
   * looking at. Each is held in state (seeded from the URL once) so
   * dismissing its chip both widens the table and cleans the URL.
   */
  const [traceIdFilter, setTraceIdFilter] = useState<string | null>(() => {
    return Navigation.getQueryStringByName("traceId");
  });
  const [serviceIdFilter, setServiceIdFilter] = useState<string | null>(() => {
    return Navigation.getQueryStringByName("serviceId");
  });
  const [profileTypeFilter, setProfileTypeFilter] = useState<string | null>(
    () => {
      return Navigation.getQueryStringByName("profileType");
    },
  );

  /*
   * Sources on the loaded page that neither the Service nor the Host list can
   * name — RUM applications, clusters, serverless functions, hosts past the
   * per-project cap. Captured from the table's own fetch so the cells, which
   * render synchronously, can show names once one lookup lands.
   */
  const [unnamedEntityRefs, setUnnamedEntityRefs] = useState<
    Array<ProfileEntityRef>
  >([]);

  const knownEntityIds: Set<string> = useMemo(() => {
    const ids: Set<string> = new Set<string>();
    for (const service of telemetryServices) {
      if (service.id) {
        ids.add(service.id.toString());
      }
    }
    for (const host of hosts) {
      if (host.id) {
        ids.add(host.id.toString());
      }
    }
    return ids;
  }, [telemetryServices, hosts]);

  const handleProfilesFetched: (profiles: Array<Profile>) => void = useCallback(
    (profiles: Array<Profile>): void => {
      const refs: Array<ProfileEntityRef> = collectProfileEntityRefs({
        profiles,
        knownIds: knownEntityIds,
      });
      setUnnamedEntityRefs(
        (prev: Array<ProfileEntityRef>): Array<ProfileEntityRef> => {
          // Same sources as last page: keep state so nothing re-renders.
          return getProfileEntityRefsKey(prev) === getProfileEntityRefsKey(refs)
            ? prev
            : refs;
        },
      );
    },
    [knownEntityIds],
  );

  /*
   * What the loaded Service / Host lists call the `?serviceId=` deep-link id,
   * if anything. A host-level (eBPF) source is linked here by its Host id.
   */
  const serviceFilterListNames: {
    serviceName: string | undefined;
    hostName: string | undefined;
  } = useMemo(() => {
    if (!serviceIdFilter) {
      return { serviceName: undefined, hostName: undefined };
    }
    const host: Host | undefined = hosts.find((candidate: Host): boolean => {
      return candidate.id?.toString() === serviceIdFilter;
    });
    return {
      serviceName: telemetryServices.find((service: Service): boolean => {
        return service.id?.toString() === serviceIdFilter;
      })?.name,
      hostName: host ? host.name || host.hostIdentifier : undefined,
    };
  }, [serviceIdFilter, telemetryServices, hosts]);

  /*
   * One lookup for every name this table shows: the page's unnamed sources
   * (type-hinted, so each goes straight to its table) plus the `?serviceId=`
   * deep-link chip, whose id may not be a Service at all.
   */
  const entityIdsToResolve: Array<string> = useMemo(() => {
    /*
     * Wait for the Service / Host lists: until they land every id looks
     * unnamed, and a deep link to a loaded Service would be looked up for
     * nothing.
     */
    if (isPageLoading) {
      return [];
    }
    const ids: Array<string> = unnamedEntityRefs.map(
      (ref: ProfileEntityRef): string => {
        return ref.id;
      },
    );
    /*
     * Skip the lookup only when the chip can name the id from the lists by
     * itself. `knownEntityIds` is the wrong test here: it also holds a Host
     * with neither name nor identifier, which the chip cannot print.
     */
    const isChipNamedByLists: boolean = Boolean(
      serviceIdFilter &&
        getProfileServiceFilterChipDisplay({
          serviceId: serviceIdFilter,
          serviceName: serviceFilterListNames.serviceName,
          hostName: serviceFilterListNames.hostName,
          nameMap: undefined,
        }).isResolved,
    );
    if (serviceIdFilter && !isChipNamedByLists) {
      ids.push(serviceIdFilter);
    }
    return ids;
  }, [
    isPageLoading,
    unnamedEntityRefs,
    serviceIdFilter,
    serviceFilterListNames,
  ]);

  const entityTypeHints: Record<string, ServiceType> = useMemo(() => {
    return buildProfileEntityTypeHints(unnamedEntityRefs);
  }, [unnamedEntityRefs]);

  const entityNames: TelemetryEntityNameMap = useTelemetryEntityNames(
    entityIdsToResolve,
    { typeHints: entityTypeHints },
  );

  const query: Query<Profile> = React.useMemo(() => {
    const baseQuery: Query<Profile> = {
      ...(props.profileQuery || {}),
    };

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      baseQuery.projectId = projectId;
    }

    if (serviceIdFilter) {
      baseQuery.primaryEntityId = new ObjectID(serviceIdFilter);
    }

    // An explicit entity page scope (modelId) wins over the deep link.
    if (modelId) {
      baseQuery.primaryEntityId = modelId;
    }

    if (traceIdFilter) {
      baseQuery.traceId = traceIdFilter;
    }

    if (profileTypeFilter) {
      /*
       * The deep link carries a UI selection (a category like "memory" or
       * a specific raw type), so expand it the same way the overview's
       * queries do — a literal match on "cpu" would miss Node profiles
       * stored as "samples".
       */
      const rawTypes: Array<string> | undefined =
        ProfileUtil.getQueryProfileTypes(profileTypeFilter);
      if (rawTypes && rawTypes.length > 0) {
        (baseQuery as Record<string, unknown>)["profileType"] = new Includes(
          rawTypes,
        );
      }
    }

    if (props.entityKeys && props.entityKeys.length > 0) {
      (baseQuery as Record<string, unknown>)["entityKeys"] = new Includes(
        props.entityKeys,
      );
    }

    return baseQuery;
  }, [
    props.profileQuery,
    modelId,
    props.entityKeys,
    traceIdFilter,
    serviceIdFilter,
    profileTypeFilter,
  ]);

  /*
   * The locked pill for an entity-key scope — an Inventory item's Profiles
   * page. The query above already narrows the list by `entityKeys`; without
   * a pill the table looked like every profile in the project. Built from
   * the same `props.entityKeys` the query reads, but never fed back into it:
   * these chips are rendered and counted, nothing else.
   */
  const lockedEntityKeyChips: Array<ActiveFilter> = useMemo(() => {
    return buildLockedEntityKeyChips({
      rows: "profiles",
      entityKeys: props.entityKeys,
      displays: props.entityKeyDisplays,
    });
  }, [props.entityKeys, props.entityKeyDisplays]);

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

      /*
       * Hosts resolve names for host-level (eBPF) profiles, which carry
       * a Host id — not a Service id — in primaryEntityId. Failure here
       * is non-fatal: the table still renders, falling back to the
       * entity-type label for those rows.
       */
      try {
        const hostsResponse: ListResult<Host> = await ModelAPI.getList({
          modelType: Host,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            name: true,
            hostIdentifier: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        });
        setHosts(hostsResponse.data || []);
      } catch {
        setHosts([]);
      }
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

  /*
   * The deep-link chip names the source once it is known — the loaded
   * Service and Host lists first, then the shared resolver — instead of an
   * 8-character id prefix nobody can read.
   */
  const serviceFilterChip: {
    key: string;
    value: string;
    isResolved: boolean;
  } | null = serviceIdFilter
    ? getProfileServiceFilterChipDisplay({
        serviceId: serviceIdFilter,
        serviceName: serviceFilterListNames.serviceName,
        hostName: serviceFilterListNames.hostName,
        nameMap: entityNames,
      })
    : null;

  const showFilterRow: boolean = hasProfileTableFilterRow({
    lockedChips: lockedEntityKeyChips,
    traceIdFilter,
    serviceIdFilter,
    profileTypeFilter,
  });

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

      {showFilterRow && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/*
           * Locked pills lead, like every other viewer's locked chips, and
           * have no remove button: the page owns this scope, so there is
           * no query string for them to clear.
           */}
          {lockedEntityKeyChips.map((chip: ActiveFilter): ReactElement => {
            return (
              <LockedFilterChip
                key={`readonly:${chip.facetKey}:${chip.value}`}
                displayKey={chip.displayKey}
                displayValue={chip.displayValue}
                lockedDetail={chip.lockedDetail}
              />
            );
          })}

          {traceIdFilter && (
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
              Filtered by trace
              <span className="font-mono" title={traceIdFilter}>
                {traceIdFilter.length > 12
                  ? `${traceIdFilter.substring(0, 8)}…`
                  : traceIdFilter}
              </span>
              <button
                type="button"
                className="text-indigo-400 hover:text-indigo-700"
                title="Remove trace filter"
                onClick={() => {
                  setTraceIdFilter(null);
                  Navigation.setQueryString({ traceId: null });
                }}
              >
                <Icon icon={IconProp.Close} className="h-3 w-3" />
              </button>
            </span>
          )}

          {serviceIdFilter && serviceFilterChip && (
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
              {serviceFilterChip.key}
              <span
                className={serviceFilterChip.isResolved ? "" : "font-mono"}
                title={serviceIdFilter}
              >
                {serviceFilterChip.value}
              </span>
              <button
                type="button"
                className="text-indigo-400 hover:text-indigo-700"
                title="Remove service filter"
                onClick={() => {
                  setServiceIdFilter(null);
                  Navigation.setQueryString({ serviceId: null });
                }}
              >
                <Icon icon={IconProp.Close} className="h-3 w-3" />
              </button>
            </span>
          )}

          {profileTypeFilter && (
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
              Type
              <span>
                {ProfileUtil.getProfileTypeDisplayName(profileTypeFilter)}
              </span>
              <button
                type="button"
                className="text-indigo-400 hover:text-indigo-700"
                title="Remove type filter"
                onClick={() => {
                  setProfileTypeFilter(null);
                  Navigation.setQueryString({ profileType: null });
                }}
              >
                <Icon icon={IconProp.Close} className="h-3 w-3" />
              </button>
            </span>
          )}
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
          onFetchSuccess={(profiles: Array<Profile>) => {
            handleProfilesFetched(profiles);
          }}
          selectMoreFields={{
            profileId: true,
            durationNano: true,
            traceId: true,
            unit: true,
            primaryEntityType: true,
          }}
          showViewIdButton={true}
          noItemsMessage={
            props.noItemsMessage ? (
              props.noItemsMessage
            ) : (
              <div className="text-center">
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  No profiles found. Send continuous profiles with Grafana Alloy
                  (zero-code eBPF profiling for anything on a host) or a
                  Pyroscope SDK in your application — recordings show up here
                  shortly after they arrive.
                </p>
                <div className="mt-3">
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.PROFILES_DOCUMENTATION] as Route,
                    )}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    <Icon icon={IconProp.Book} className="h-4 w-4" />
                    Set up profiling
                  </Link>
                </div>
              </div>
            )
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
                primaryEntityId: true,
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
                primaryEntityId: true,
              },
              title: "Source",
              type: FieldType.Element,
              getElement: (profile: Profile): ReactElement => {
                const entityId: string =
                  profile.primaryEntityId?.toString() || "";

                /*
                 * primaryEntityId is only a Service id when
                 * primaryEntityType says so — host-level (eBPF) profiles
                 * carry a Host id, container collectors a DockerHost /
                 * KubernetesCluster id. Try the matching lookup table
                 * first, then degrade to a type label so the column
                 * never claims "Unknown" for a perfectly valid source.
                 */
                const telemetryService: Service | undefined =
                  telemetryServices.find((service: Service) => {
                    return service.id?.toString() === entityId;
                  });

                if (telemetryService) {
                  return (
                    <Fragment>
                      <ServiceElement service={telemetryService} />
                    </Fragment>
                  );
                }

                const entityType: string =
                  profile.primaryEntityType?.toString() || "";

                if (entityType === ServiceType.Host) {
                  const host: Host | undefined = hosts.find((h: Host) => {
                    return h.id?.toString() === entityId;
                  });
                  if (host) {
                    return (
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-900">
                          {host.name || host.hostIdentifier}
                        </span>
                        <span className="text-xs text-gray-400">Host</span>
                      </div>
                    );
                  }
                }

                /*
                 * Every other source (RUM application, cluster, serverless
                 * function, …) is named by the shared resolver. Until — or
                 * unless — it resolves, the type label over a short id.
                 */
                const source: ProfileEntityDisplay = getProfileEntityDisplay({
                  entityId,
                  entityType,
                  nameMap: entityNames,
                });

                if (source.isResolved) {
                  return (
                    <div className="flex flex-col">
                      <span className="text-sm text-gray-900" title={entityId}>
                        {source.primary}
                      </span>
                      <span className="text-xs text-gray-400">
                        {source.typeLabel}
                      </span>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col">
                    <span className="text-sm text-gray-900">
                      {source.primary}
                    </span>
                    {source.shortId && (
                      <span
                        className="text-xs font-mono text-gray-400"
                        title={entityId}
                      >
                        {source.shortId}
                      </span>
                    )}
                  </div>
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
