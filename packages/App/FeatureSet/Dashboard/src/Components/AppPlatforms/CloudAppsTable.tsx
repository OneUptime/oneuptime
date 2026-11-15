import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
  getCloudProviderForPlatform,
  getManagedCloudPlatformLabel,
} from "Common/Types/Cloud/CloudPlatform";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import CloudConnectionLogo from "../Cloud/Connect/CloudConnectionLogo";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  CloudAppSignals,
  countLiveInstancesByApp,
  getCloudAppGroupLabel,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import { hasCloudAppSentTraces } from "../../Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import {
  CLOUD_APP_SIGNAL_WINDOW_MINUTES,
  CloudAppSignalResult,
  fetchCloudAppInstances,
  fetchCloudAppSignals,
} from "../../Pages/AppPlatforms/Utils/CloudAppReads";
import { CloudResourceScopeSource } from "../../Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import {
  CloudAppRevisionCell,
  CloudAppSignalsSummaryCell,
  CloudAppStateCell,
} from "./CloudAppCells";
import CloudAppFacts, { CloudAppFact } from "./CloudAppFacts";
import { getAppsCloudAccountFacet } from "./AppPlatformsAccountFacet";
import useResourceOwners, {
  UseResourceOwnersResult,
} from "../ResourceOwners/useResourceOwners";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";

/*
 * A list of App Platforms apps: every app on every platform (All Apps), or
 * one environment's (its Apps tab). One row per app - an ECS service, a
 * Cloud Run service, a Container App - with whether it runs and on how many
 * instances, the revision it runs and since when, and its requests, error
 * rate and p95 over the last hour, the way a platform's own console lists
 * its services.
 *
 * The rows are CloudApp's; the instances and the numbers are read beside
 * them for the rows on the page (fetchCloudAppInstances, and one grouped
 * read per environment for the numbers: fetchCloudAppSignals).
 *
 * All Apps has a Cloud Account chip above the rows: an app is in the
 * account its environment is in (AppPlatformsAccountFacet). Cloud's
 * Overview links here with it set to the accounts Cloud reads.
 */

export const APPS_TABLE_TITLE: string = translationKey("Apps");
export const APPS_TABLE_DESCRIPTION: string = translationKey(
  "Every app your platforms run, with its instances, the revision it runs, and its requests, errors and latency in the last hour.",
);
export const ENVIRONMENT_APPS_TABLE_DESCRIPTION: string = translationKey(
  "The apps this environment runs, with their instances, revisions, and requests, errors and latency in the last hour.",
);
export const NO_APPS_MESSAGE: string = translationKey(
  "No apps yet. An app appears when its telemetry names it: an ECS task definition family, a Cloud Run service, or a service.name.",
);

const SIGNAL_WINDOW_NOTE: string = translationKey(
  "Each app's error rate, requests and p95 latency in the last hour, from the spans where requests enter it.",
);

// The clouds' product names, as written in every language (DropdownOption.isUserContent).
const PLATFORM_FILTER_OPTIONS: Array<DropdownOption> =
  MANAGED_CLOUD_PLATFORMS.map(
    (descriptor: ManagedCloudPlatformDescriptor): DropdownOption => {
      return {
        label: descriptor.productName,
        value: descriptor.platform,
        isUserContent: true,
      };
    },
  );

export interface ComponentProps {
  id: string;
  /*
   * One environment's apps (its Apps tab), with the environment already
   * read; unset, every app of every environment listed here.
   */
  environment?: (CloudResourceScopeSource & { _id?: unknown }) | undefined;
  /*
   * The environments whose apps are listed (All Apps), by id: their apps'
   * numbers are read through their cloud.* attributes, and each row names
   * its environment. Unset with `environment`.
   */
  environments?: ReadonlyMap<string, CloudResource> | undefined;
}

function idOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

const CloudAppsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [signals, setSignals] = useState<Map<string, CloudAppSignals>>(
    new Map<string, CloudAppSignals>(),
  );
  const [signalsFailed, setSignalsFailed] = useState<boolean>(false);
  const [isLoadingSignals, setIsLoadingSignals] = useState<boolean>(false);
  const [liveInstances, setLiveInstances] = useState<Map<string, number>>(
    new Map<string, number>(),
  );
  const [instancesLoaded, setInstancesLoaded] = useState<boolean>(false);
  // Only the latest page's reads land: an older one is dropped.
  const fetchCount: React.MutableRefObject<number> = useRef<number>(0);

  const environmentId: string = idOf(props.environment?._id);

  const environments: ReadonlyMap<string, CloudResourceScopeSource> =
    useMemo((): ReadonlyMap<string, CloudResourceScopeSource> => {
      if (props.environment && environmentId) {
        return new Map<string, CloudResourceScopeSource>([
          [environmentId, props.environment],
        ]);
      }

      return (
        (props.environments as
          | ReadonlyMap<string, CloudResourceScopeSource>
          | undefined) || new Map<string, CloudResourceScopeSource>()
      );
    }, [environmentId, props.environment, props.environments]);

  /*
   * All Apps' chips: the account an app's environment is in. An
   * environment's own Apps tab has one environment, and no chip.
   */
  const accountChips: UseResourceOwnersResult<CloudApp> =
    useResourceOwners<CloudApp>({
      persistKey: environmentId ? undefined : props.id,
      showOwnerFacet: false,
      extraFacets:
        environmentId || !props.environments
          ? []
          : [getAppsCloudAccountFacet(props.environments)],
    });

  const baseQuery: Query<CloudApp> = useMemo((): Query<CloudApp> => {
    if (environmentId) {
      return { cloudResourceId: new ObjectID(environmentId) };
    }

    return {
      cloudResourceId: new Includes(
        Array.from((props.environments || new Map()).keys()).map(
          (id: string): ObjectID => {
            return new ObjectID(id);
          },
        ),
      ),
    } as Query<CloudApp>;
  }, [environmentId, props.environments]);

  // The list's own environments, narrowed by the chip when it is set.
  const query: Query<CloudApp> = environmentId
    ? baseQuery
    : accountChips.mergeFiltersIntoQuery(baseQuery);

  const onRowsFetched: (apps: Array<CloudApp>) => void = (
    apps: Array<CloudApp>,
  ): void => {
    fetchCount.current = fetchCount.current + 1;
    const thisFetch: number = fetchCount.current;
    const appIds: Array<string> = apps
      .map((app: CloudApp): string => {
        return idOf(app._id);
      })
      .filter(Boolean);

    setIsLoadingSignals(true);
    setInstancesLoaded(false);

    fetchCloudAppSignals({ apps, environments })
      .then((result: CloudAppSignalResult): void => {
        if (thisFetch !== fetchCount.current) {
          return;
        }
        setSignals(result.signals);
        setSignalsFailed(result.failed);
        setIsLoadingSignals(false);
      })
      .catch((): void => {
        if (thisFetch !== fetchCount.current) {
          return;
        }
        setSignalsFailed(true);
        setIsLoadingSignals(false);
      });

    fetchCloudAppInstances(appIds)
      .then((instances: Array<CloudResourceInstance>): void => {
        if (thisFetch !== fetchCount.current) {
          return;
        }
        setLiveInstances(countLiveInstancesByApp(instances));
        setInstancesLoaded(true);
      })
      .catch((): void => {
        if (thisFetch !== fetchCount.current) {
          return;
        }
        setInstancesLoaded(true);
      });
  };

  // A new set of environments is a new list: forget the old numbers.
  useEffect(() => {
    setSignals(new Map<string, CloudAppSignals>());
    setLiveInstances(new Map<string, number>());
  }, [baseQuery]);

  const getAppRoute: (app: CloudApp) => Route = (app: CloudApp): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL] as Route,
      {
        modelId: new ObjectID(idOf(app.cloudResourceId)),
        subModelId: new ObjectID(idOf(app._id)),
      },
    );
  };

  const signalsOf: (app: CloudApp) => CloudAppSignals | null | undefined = (
    app: CloudApp,
  ): CloudAppSignals | null | undefined => {
    const found: CloudAppSignals | undefined = signals.get(idOf(app._id));

    if (found) {
      return found;
    }

    return signalsFailed && !isLoadingSignals ? null : undefined;
  };

  /*
   * Where an app runs, under its name: its platform and region on All Apps,
   * where apps of every environment sit together, and the cluster or slot
   * it is kept apart by. One fact each: the line wraps between them
   * (CloudAppFacts).
   */
  const getWhere: (app: CloudApp) => Array<CloudAppFact> = (
    app: CloudApp,
  ): Array<CloudAppFact> => {
    const facts: Array<CloudAppFact> = [];

    if (!environmentId) {
      const environment: CloudResource | undefined = props.environments?.get(
        idOf(app.cloudResourceId),
      );
      const platform: string = getManagedCloudPlatformLabel(
        app.cloudPlatform || environment?.cloudPlatform,
      );

      if (platform) {
        facts.push({ key: "platform", content: platform });
      }

      if (environment?.cloudRegion) {
        facts.push({ key: "region", content: environment.cloudRegion });
      }
    }

    const group: string = getCloudAppGroupLabel({
      groupName: app.groupName,
      cloudPlatform: app.cloudPlatform,
      translator,
    });

    if (group) {
      facts.push({ key: "group", content: group });
    }

    return facts;
  };

  return (
    <ModelTable<CloudApp>
      modelType={CloudApp}
      id={props.id}
      userPreferencesKey={props.id}
      name="Apps"
      singularName="App"
      pluralName="Apps"
      query={query}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      showRefreshButton={true}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      noItemsMessage={NO_APPS_MESSAGE}
      {...(environmentId
        ? {}
        : {
            topContent: accountChips.filterBar,
            emptyState: accountChips.emptyState,
            currentFacetState: accountChips.facetSaveState,
            onFacetStateRestored: accountChips.restoreFacetState,
          })}
      onFetchSuccess={(data: Array<CloudApp>): void => {
        onRowsFetched(data);
      }}
      selectMoreFields={{
        cloudResourceId: true,
        cloudPlatform: true,
        groupName: true,
        telemetryAttributes: true,
        currentRevisionSince: true,
        lastSeenAt: true,
        // An app that sends no traces reads "No traces", not "No requests".
        tracesLastReceivedAt: true,
      }}
      searchableFields={["name", "serviceName"]}
      cardProps={{
        title: APPS_TABLE_TITLE,
        description: environmentId
          ? ENVIRONMENT_APPS_TABLE_DESCRIPTION
          : APPS_TABLE_DESCRIPTION,
      }}
      filters={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        ...(environmentId
          ? []
          : [
              {
                field: { cloudPlatform: true },
                title: "Platform",
                type: FieldType.Dropdown,
                filterDropdownOptions: PLATFORM_FILTER_OPTIONS,
              },
            ]),
        {
          field: { lastSeenAt: true },
          title: "Last Seen",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "App",
          type: FieldType.Element,
          isNotCustomizable: true,
          /*
           * Where it runs wraps under the name rather than widen the column:
           * at 1280 beside the side menu, the numbers keep their columns.
           */
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-xs",
          // A mark beside the name: the name reads its own way, the cell the page's.
          getLineText: drawsItsOwnLines,
          getElement: (app: CloudApp): ReactElement => {
            const where: Array<CloudAppFact> = getWhere(app);

            return (
              <div className="flex min-w-0 items-start gap-2.5">
                {environmentId ? (
                  <></>
                ) : (
                  <CloudConnectionLogo
                    provider={
                      getCloudProviderForPlatform(app.cloudPlatform) ||
                      undefined
                    }
                    size="sm"
                  />
                )}
                <div className="min-w-0">
                  <AppLink
                    to={getAppRoute(app)}
                    className="break-words text-sm font-medium text-gray-900 hover:underline"
                  >
                    <IsolatedText text={app.name || "—"} />
                  </AppLink>
                  {/*
                   * Each part is kept whole where it fits - a region such as
                   * europe-west1 never breaks at its hyphen - and no dot is
                   * left at a line's end.
                   */}
                  <CloudAppFacts
                    facts={where}
                    className="mt-0.5 text-xs text-gray-500"
                    dataTestId="cloud-app-where"
                  />
                </div>
              </div>
            );
          },
          getExportValue: (app: CloudApp): string => {
            return app.name || "";
          },
        },
        {
          field: { lastSeenAt: true },
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          getElement: (app: CloudApp): ReactElement => {
            return (
              <CloudAppStateCell
                lastSeenAt={app.lastSeenAt}
                liveInstances={
                  instancesLoaded
                    ? liveInstances.get(idOf(app._id)) || 0
                    : undefined
                }
              />
            );
          },
        },
        {
          field: { currentRevision: true },
          title: "Revision",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (app: CloudApp): ReactElement => {
            return (
              <CloudAppRevisionCell
                revision={app.currentRevision}
                since={app.currentRevisionSince}
                appName={app.name}
              />
            );
          },
        },
        {
          field: { _id: true },
          id: "last-hour",
          title: "Last hour",
          headerTooltip: SIGNAL_WINDOW_NOTE,
          type: FieldType.Element,
          disableSort: true,
          getElement: (app: CloudApp): ReactElement => {
            return (
              <CloudAppSignalsSummaryCell
                signals={signalsOf(app)}
                isLoading={isLoadingSignals}
                hasTraces={hasCloudAppSentTraces(app)}
              />
            );
          },
        },
      ]}
      onViewPage={(app: CloudApp): Promise<Route> => {
        return Promise.resolve(getAppRoute(app));
      }}
    />
  );
};

export { CLOUD_APP_SIGNAL_WINDOW_MINUTES };

export default CloudAppsTable;
