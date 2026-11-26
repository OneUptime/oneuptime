import ProjectUtil from "Common/UI/Utils/Project";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
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
  useMemo,
  useState,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import ServiceElement from "../Service/ServiceElement";
import ProfileUtil from "../../Utils/ProfileUtil";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  TelemetryServicesOnPage,
  useTelemetryServicesOnPage,
} from "../Telemetry/TelemetryServicesOnPage";
import { getUnknownServiceScopeOption } from "../Telemetry/TelemetryServiceScope";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import { getTelemetryFirstStepsSetupAction } from "../Telemetry/TelemetryFirstStepsEmptyState";
import {
  TELEMETRY_FIRST_STEPS_COPY,
  TelemetryFirstStepsCopy,
  TelemetryFirstStepsSignal,
} from "../Telemetry/TelemetryFirstSteps";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";

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
  const translator: Translator = useTranslator();
  const modelId: ObjectID | undefined = props.modelId;

  // A resource's Profiles tab, not the Profiler's own All profiles page.
  const isScopedToResource: boolean = Boolean(
    props.modelId || props.profileQuery || props.entityKeys,
  );

  const [attributes, setAttributes] = React.useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] =
    React.useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] =
    React.useState<boolean>(false);
  const [attributesError, setAttributesError] = React.useState<string>("");

  /*
   * The services the shown rows name, read by their ids as each page of
   * rows arrives - never the project's first 10,000 by name, past which a
   * service's row lost its name and its colour (#10764).
   */
  const servicesOnPage: TelemetryServicesOnPage = useTelemetryServicesOnPage();

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
   * Sources on the loaded page that the services read by their ids do not
   * name — hosts, RUM applications, clusters, serverless functions. Captured
   * from the table's own fetch so the cells, which render synchronously, can
   * show names once one lookup lands. A host-level (eBPF) profile's host is
   * named here too, by its id: the table read the project's first 10,000
   * hosts by name for them, and one past them was named this way anyway
   * (#10921).
   */
  const [unnamedEntityRefs, setUnnamedEntityRefs] = useState<
    Array<ProfileEntityRef>
  >([]);

  const handleProfilesFetched: (profiles: Array<Profile>) => Promise<void> =
    useCallback(
      async (profiles: Array<Profile>): Promise<void> => {
        /*
         * The services the page's rows name are read by their ids first: a
         * row whose source is a service is drawn from that read, and only
         * what it does not name is asked of the shared resolver - a service
         * never twice.
         */
        const services: Map<string, Service> =
          await servicesOnPage.readServicesOf(
            profiles
              .filter((profile: Profile): boolean => {
                const entityType: string =
                  profile.primaryEntityType?.toString() || "";

                return !entityType || entityType === ServiceType.OpenTelemetry;
              })
              .map((profile: Profile): ObjectID | undefined => {
                return profile.primaryEntityId;
              }),
          );

        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const knownIds: Set<string> = new Set<string>();

        for (const profile of profiles) {
          const id: string = profile.primaryEntityId?.toString() || "";

          if (
            id &&
            (services.has(id.toLowerCase()) ||
              TelemetryServiceUtil.isUnknownServiceId(id, projectId))
          ) {
            knownIds.add(id);
          }
        }

        const refs: Array<ProfileEntityRef> = collectProfileEntityRefs({
          profiles,
          knownIds: knownIds,
        });
        setUnnamedEntityRefs(
          (prev: Array<ProfileEntityRef>): Array<ProfileEntityRef> => {
            // Same sources as last page: keep state so nothing re-renders.
            return getProfileEntityRefsKey(prev) ===
              getProfileEntityRefsKey(refs)
              ? prev
              : refs;
          },
        );
      },
      [servicesOnPage.readServicesOf],
    );

  /*
   * What the services the page's rows name call the `?serviceId=` deep-link
   * id, if anything; otherwise the shared resolver names it below, by its
   * id - a host-level (eBPF) source, linked here by its Host id, too.
   */
  const deepLinkedService: Service | undefined =
    servicesOnPage.getService(serviceIdFilter);
  const deepLinkedServiceName: string | undefined = useMemo(() => {
    if (!serviceIdFilter) {
      return undefined;
    }
    // The stand-in for telemetry that named no service, in the reader's words.
    return TelemetryServiceUtil.getServiceDisplayName(
      deepLinkedService?.name,
      translator,
    );
  }, [serviceIdFilter, deepLinkedService, translator.language]);

  /*
   * One lookup for every name this table shows: the page's unnamed sources
   * (type-hinted, so each goes straight to its table) plus the `?serviceId=`
   * deep-link chip, whose id may not be a Service at all.
   */
  const entityIdsToResolve: Array<string> = useMemo(() => {
    const ids: Array<string> = unnamedEntityRefs.map(
      (ref: ProfileEntityRef): string => {
        return ref.id;
      },
    );
    /*
     * Skip the lookup only when the services read by their ids name the
     * chip's id by themselves.
     */
    const isChipNamedByServices: boolean = Boolean(
      serviceIdFilter &&
        getProfileServiceFilterChipDisplay({
          serviceId: serviceIdFilter,
          serviceName: deepLinkedServiceName,
          nameMap: undefined,
        }).isResolved,
    );
    if (serviceIdFilter && !isChipNamedByServices) {
      ids.push(serviceIdFilter);
    }
    return ids;
  }, [unnamedEntityRefs, serviceIdFilter, deepLinkedServiceName]);

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

  /*
   * Profiles without a service.name are tagged with the projectId
   * (ServiceType.Unknown) and have no Service row: the filter offers them
   * as "Unknown Service" beside its search.
   */
  const unknownServiceOptions: Array<DropdownOption> = useMemo(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    return projectId
      ? [getUnknownServiceScopeOption(projectId.toString())]
      : [];
  }, []);

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

  const handleAdvancedFiltersToggle: (show: boolean) => void = (
    show: boolean,
  ): void => {
    setAreAdvancedFiltersVisible(show);

    if (show && !attributesLoaded && !attributesLoading) {
      void loadAttributes();
    }
  };

  /*
   * The deep-link chip names the source once it is known — the services
   * read by their ids first, then the shared resolver — instead of an
   * 8-character id prefix nobody can read.
   */
  const serviceFilterChip: {
    key: string;
    value: string;
    isResolved: boolean;
  } | null = serviceIdFilter
    ? getProfileServiceFilterChipDisplay({
        serviceId: serviceIdFilter,
        serviceName: deepLinkedServiceName,
        nameMap: entityNames,
      })
    : null;

  /*
   * The All profiles page's empty list (an embed passes its own sentence).
   * Under a deep-link chip - a trace, a service, a profile type - nothing
   * matches, with the way to clear the chips. With none, it is the
   * Profiler's first steps, as its Overview shows them: the list said "No
   * profiles found." over a paragraph naming Grafana Alloy, eBPF and a
   * Pyroscope SDK, the setup guide's job.
   */
  const isNarrowedByChip: boolean = Boolean(
    traceIdFilter || serviceIdFilter || profileTypeFilter,
  );

  const firstSteps: TelemetryFirstStepsCopy =
    TELEMETRY_FIRST_STEPS_COPY[TelemetryFirstStepsSignal.Profiles];

  const allProfilesEmptyState: EmptyStateOptions = isNarrowedByChip
    ? {
        isFiltered: true,
        onClearFilters: (): void => {
          setTraceIdFilter(null);
          setServiceIdFilter(null);
          setProfileTypeFilter(null);
          Navigation.setQueryString({
            traceId: null,
            serviceId: null,
            profileType: null,
          });
        },
      }
    : {
        title: firstSteps.title,
        description: firstSteps.description,
        icon: firstSteps.icon,
        actions: [
          getTelemetryFirstStepsSetupAction(TelemetryFirstStepsSignal.Profiles),
        ],
      };

  const showFilterRow: boolean = hasProfileTableFilterRow({
    lockedChips: lockedEntityKeyChips,
    traceIdFilter,
    serviceIdFilter,
    profileTypeFilter,
  });

  return (
    <Fragment>
      {servicesOnPage.error && (
        <div className="mb-4">
          <ErrorMessage
            message={
              <ErrorSentence
                template="We couldn't load telemetry services. {{error}}"
                error={servicesOnPage.error}
              />
            }
            onRefreshClick={() => {
              void servicesOnPage.retry();
            }}
          />
        </div>
      )}

      {areAdvancedFiltersVisible && attributesError && (
        <div className="mb-4">
          <ErrorMessage
            message={
              <ErrorSentence
                template="We couldn't load profile attributes. {{error}}"
                error={attributesError}
              />
            }
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
              {translator.translateText("Filtered by trace")}
              <span className="font-mono" title={traceIdFilter}>
                {traceIdFilter.length > 12
                  ? `${traceIdFilter.substring(0, 8)}…`
                  : traceIdFilter}
              </span>
              <button
                type="button"
                className="text-indigo-400 hover:text-indigo-700"
                title={translator.translateText("Remove trace filter")}
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
              {translator.translateText(serviceFilterChip.key)}
              <span
                className={serviceFilterChip.isResolved ? "" : "font-mono"}
                title={serviceIdFilter}
              >
                {serviceFilterChip.value}
              </span>
              <button
                type="button"
                className="text-indigo-400 hover:text-indigo-700"
                title={translator.translateText("Remove service filter")}
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
              {translator.translateText("Type")}
              <span>
                {ProfileUtil.getProfileTypeDisplayName(profileTypeFilter)}
              </span>
              <button
                type="button"
                className="text-indigo-400 hover:text-indigo-700"
                title={translator.translateText("Remove type filter")}
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
          singularName="Performance profile"
          pluralName="Profiles"
          name="Performance Profiles"
          isViewable={true}
          cardProps={
            props.isMinimalTable
              ? undefined
              : {
                  title: "All profiles",
                  /*
                   * On the Profiler's own list, the side menu's Overview
                   * answers what is slow across every service. A
                   * resource's Profiles tab has that answer above the list
                   * (or, an inventory item's, none): there "the Overview"
                   * read as the resource's own Overview page, which shows
                   * no profiles, so the card only says what a row is.
                   */
                  description: isScopedToResource
                    ? "Each row is one recording of about a minute."
                    : "Each row is one recording of about a minute. For what is slow right now, use the Overview.",
                }
          }
          query={query}
          onFetchSuccess={(profiles: Array<Profile>) => {
            void handleProfilesFetched(profiles);
          }}
          selectMoreFields={{
            profileId: true,
            durationNano: true,
            traceId: true,
            unit: true,
            primaryEntityType: true,
          }}
          showViewIdButton={true}
          noItemsMessage={props.noItemsMessage}
          emptyState={props.noItemsMessage ? undefined : allProfilesEmptyState}
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
              /*
               * Searched on the server as it is typed in, 50 by name; what
               * the filter holds - from a link or a saved view - is named by
               * its ids, one gone as "No longer available" (#10764).
               * Archived services keep sending profiles: offered, marked.
               */
              filterEntityType: Service,
              filterDropdownField: { label: "name", value: "_id" },
              marksArchivedRecords: true,
              filterDropdownOptions: unknownServiceOptions,
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
                  servicesOnPage.getService(entityId);

                if (telemetryService) {
                  return (
                    <Fragment>
                      <ServiceElement service={telemetryService} />
                    </Fragment>
                  );
                }

                // Its service's name is on its way: never a short id meanwhile.
                if (servicesOnPage.isReading(entityId)) {
                  return <InlineValueSkeleton widthClassName="w-24" />;
                }

                const entityType: string =
                  profile.primaryEntityType?.toString() || "";

                /*
                 * Every other source (a host, a RUM application, a cluster,
                 * a serverless function, …) is named by the shared resolver,
                 * by its id, its kind in the reader's words under its name.
                 * Until — or unless — it resolves, the kind over a short id.
                 */
                const source: ProfileEntityDisplay = getProfileEntityDisplay({
                  entityId,
                  entityType,
                  nameMap: entityNames,
                });

                if (source.isResolved) {
                  return (
                    <div className="flex flex-col">
                      {/* What its owner named it, drawn as written. */}
                      <span className="text-sm text-gray-900" title={entityId}>
                        {source.primary}
                      </span>
                      <span className="text-xs text-gray-500">
                        {translator.translateText(source.typeLabel)}
                      </span>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col">
                    <span className="text-sm text-gray-900">
                      {translator.translateText(source.primary)}
                    </span>
                    {source.shortId && (
                      <span
                        className="text-xs font-mono text-gray-500"
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
                    : EMPTY_VALUE_MARK;

                return (
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {getValueOrQuietDash(durationLabel)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {translator.translatePlural(
                        { one: "{{count}} sample", other: "{{count}} samples" },
                        sampleCount,
                      )}
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
                  return <TableEmptyValue isSmall={true} />;
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
                    title={translator.translateTemplate(
                      "Open trace {{traceId}}",
                      {
                        traceId: traceId,
                      },
                    )}
                    isTitleTranslated={true}
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
