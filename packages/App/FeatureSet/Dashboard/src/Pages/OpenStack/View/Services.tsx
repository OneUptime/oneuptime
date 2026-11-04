import PageComponentProps from "../../PageComponentProps";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import Input from "Common/UI/Components/Input/Input";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import OpenStackAccessNotice from "../../../Components/OpenStack/OpenStackAccessNotice";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";
import OpenStackServiceGroupCard from "../../../Components/OpenStack/OpenStackServiceGroupCard";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import { isResourceStatusConnected } from "../../../Components/ResourceConnection/ResourceConnectionState";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  OpenStackServiceRows,
  fetchOpenStackServiceRows,
} from "../Utils/OpenStackOverviewReads";
import {
  OpenStackAccessGap,
  OpenStackServiceGroup,
  getOpenStackAccessGaps,
  getOpenStackNetworkBackendName,
  getOpenStackServiceGroups,
  getOpenStackServiceTitle,
  getOpenStackWorkerHost,
} from "../Utils/OpenStackServices";

/*
 * What `openstack compute service list`, `network agent list`, `volume service list` and
 * `endpoint list` answer between them, together and for every region, without anyone
 * running them: a card for each OpenStack service in each region, what needs someone
 * first. OpenStackServices decides the order and OpenStackHealth what needs someone, the
 * same as the Overview, so the two can't disagree.
 *
 * Everything is read at once because there are few of these even on a large cloud, and
 * what needs someone can't be put first in a list that holds a page of it. A cloud with
 * more than a read holds says so rather than reading as though that was all of them.
 */

// A connected agent's data refreshes every couple of minutes, so a tab left open does too.
const REFRESH_EVERY_MS: number = 60 * 1000;

function isMatch(row: OpenStackResource, needle: string): boolean {
  return [
    row.name,
    getOpenStackWorkerHost(row),
    row.availabilityZone,
    row.adminState,
  ].some((value: string | undefined): boolean => {
    return (value || "").toLowerCase().includes(needle);
  });
}

interface ServicesPageData {
  rows: OpenStackServiceRows;
  cloud: OpenStackCloud | null;
}

const OpenStackCloudServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { region }: OpenStackRegionState = useOpenStackRegion();
  const [search, setSearch] = useState<string>("");
  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(modelId);
  }, [modelId.toString()]);

  const read: OpenStackRead<ServicesPageData> =
    useOpenStackRead<ServicesPageData>(async () => {
      const [rows, cloud]: [OpenStackServiceRows, OpenStackCloud | null] =
        await Promise.all([
          fetchOpenStackServiceRows(modelId),
          ModelAPI.getItem<OpenStackCloud>({
            modelType: OpenStackCloud,
            id: modelId,
            select: { otelCollectorStatus: true, lastSeenAt: true },
          }),
        ]);
      return { rows, cloud };
    }, [modelId.toString()]);

  // The tab someone leaves open while a service is down has to keep telling the truth.
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      read.reload();
    }, REFRESH_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (read.isLoading && !read.data) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error && !read.data) {
    return (
      <ResourcePartReadError
        testId="openstack-services-read-error"
        title="Couldn't read this cloud's services"
        message={read.error}
        onRetry={read.reload}
      />
    );
  }

  const data: ServicesPageData = read.data as ServicesPageData;
  const now: Date = OneUptimeDate.getCurrentDate();
  const isConnected: boolean = isResourceStatusConnected(
    data.cloud?.otelCollectorStatus,
  );

  const inRegion: (row: OpenStackResource) => boolean = (
    row: OpenStackResource,
  ): boolean => {
    return !region || row.regionName === region;
  };
  const apis: Array<OpenStackResource> = data.rows.apis.filter(inRegion);
  const workers: Array<OpenStackResource> = data.rows.workers.filter(inRegion);

  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION] as Route,
    { modelId: modelId },
  );

  // Only a cloud that reports can say a credential can't list something.
  const accessGaps: Array<OpenStackAccessGap> = isConnected
    ? getOpenStackAccessGaps({ apis: apis, workers: workers })
    : [];

  const needle: string = search.trim().toLowerCase();

  const groups: Array<OpenStackServiceGroup> = getOpenStackServiceGroups({
    apis: apis,
    workers: workers,
    now: now,
  })
    .map((group: OpenStackServiceGroup): OpenStackServiceGroup => {
      if (!needle) {
        return group;
      }
      /*
       * A search for a host narrows a group to it. A search for a service keeps the whole
       * of what it names, and the API that answers for it.
       */
      const isGroupMatch: boolean =
        getOpenStackServiceTitle(group.service)
          .toLowerCase()
          .includes(needle) ||
        (group.regionName || "").toLowerCase().includes(needle);
      return isGroupMatch
        ? group
        : {
            ...group,
            workers: group.workers.filter((row: OpenStackResource): boolean => {
              return isMatch(row, needle);
            }),
          };
    })
    .filter((group: OpenStackServiceGroup): boolean => {
      return (
        !needle ||
        group.workers.length > 0 ||
        getOpenStackServiceTitle(group.service)
          .toLowerCase()
          .includes(needle) ||
        (group.regionName || "").toLowerCase().includes(needle)
      );
    });

  const backendName: string | null = getOpenStackNetworkBackendName(workers);

  const hasRegions: boolean =
    !region &&
    new Set(
      apis.map((row: OpenStackResource): string => {
        return row.regionName || "";
      }),
    ).size > 1;

  const isEmpty: boolean = apis.length === 0 && workers.length === 0;

  return (
    <Fragment>
      {!isConnected && data.cloud?.lastSeenAt ? (
        <OpenStackPartNotice testId="openstack-services-quiet" tone="warning">
          {translator.translateTemplate(
            "OneUptime last heard from this cloud {{time}}. Nothing here is current: this is what it last reported.",
            { time: OneUptimeDate.fromNow(data.cloud.lastSeenAt) },
          )}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {read.error ? (
        <OpenStackPartNotice
          testId="openstack-services-refresh-failed"
          tone="warning"
          text="Couldn't read this cloud's services just now, so this is what they last said. This page will try again."
        />
      ) : (
        <></>
      )}

      <OpenStackAccessNotice
        gaps={accessGaps}
        documentationRoute={documentationRoute}
      />

      {data.rows.workerCount > data.rows.workers.length ? (
        <OpenStackPartNotice testId="openstack-services-capped" tone="warning">
          {translator.translateTemplate(
            "This cloud has {{total}} workers. The first {{shown}} are listed here.",
            {
              total: translator.formatNumber(data.rows.workerCount),
              shown: translator.formatNumber(data.rows.workers.length),
            },
          )}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {isEmpty ? (
        <div
          className="rounded-xl border border-gray-200 bg-white px-5 shadow-sm sm:px-0"
          data-testid="openstack-services-empty"
        >
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            title="No services reported yet"
            description="The agent reports each service's API once it can reach Keystone. Check that it is running, and that the machine it runs on can reach your cloud."
          />
        </div>
      ) : (
        <>
          <div className="mb-4 max-w-md">
            <Input
              value={search}
              onChange={(value: string) => {
                setSearch(value);
              }}
              placeholder={
                translator.translateText("Search by service or host") ||
                "Search by service or host"
              }
              ariaLabel={
                translator.translateText("Search by service or host") ||
                "Search by service or host"
              }
              dataTestId="openstack-services-search"
            />
          </div>
          {groups.length === 0 ? (
            <p
              className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
              data-testid="openstack-services-no-match"
            >
              {translator.translateText("No service or host matches this.") ||
                "No service or host matches this."}
            </p>
          ) : (
            <></>
          )}
          {groups.map((group: OpenStackServiceGroup): ReactElement => {
            return (
              <OpenStackServiceGroupCard
                key={group.key}
                group={group}
                showRegion={hasRegions}
                backendName={
                  group.service === OpenStackServiceType.Network
                    ? backendName
                    : null
                }
                getRowRoute={routes.routeFor}
                now={now}
              />
            );
          })}
        </>
      )}
    </Fragment>
  );
};

export default OpenStackCloudServices;
