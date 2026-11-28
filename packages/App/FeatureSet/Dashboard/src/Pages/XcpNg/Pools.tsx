import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgPoolOwnerTeam from "Common/Models/DatabaseModels/XcpNgPoolOwnerTeam";
import XcpNgPoolOwnerUser from "Common/Models/DatabaseModels/XcpNgPoolOwnerUser";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildEnumFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import XCP_NG_POOL_ONBOARDING from "../../Components/XcpNg/XcpNgPoolOnboarding";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import XCP_NG_POOL_SHOWCASE from "../../Components/XcpNg/XcpNgPoolShowcase";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  XcpNgPoolConnection,
  getXcpNgPoolConnection,
} from "./Utils/XcpNgPoolConnection";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import Navigation from "Common/UI/Utils/Navigation";
import { XCP_NG_CONNECT_QUERY_PARAM } from "../../Components/XcpNg/XcpNgConnectionView";
import StorageUsageBar from "Common/UI/Components/StorageUsage/StorageUsageBar";
import { getStorageUsage } from "Common/Utils/Storage/StorageUsage";

/*
 * How many of a pool's hosts or VMs are Running, out of how many it has:
 * "2/3 running", both counts in the reader's digits. Red while a pool that
 * is read now has one that is not running; a pool that is not read keeps
 * its last counts in grey, since they no longer say what runs now. A pool
 * that reported none of them yet draws the quiet dash.
 */
const renderRunningCount: (data: {
  running: number | null | undefined;
  total: number | null | undefined;
  isConnected: boolean;
  translator: Translator;
  testId: string;
}) => ReactElement = (data: {
  running: number | null | undefined;
  total: number | null | undefined;
  isConnected: boolean;
  translator: Translator;
  testId: string;
}): ReactElement => {
  const total: number = data.total || 0;
  if (total <= 0) {
    return <TableEmptyValue />;
  }
  const running: number = data.running || 0;
  const isShort: boolean = data.isConnected && running < total;
  return (
    <span
      data-testid={data.testId}
      className={`text-sm ${
        isShort
          ? "font-medium text-red-700"
          : data.isConnected
            ? "text-gray-900"
            : "text-gray-500"
      }`}
    >
      {data.translator.translateTemplate("{{running}}/{{total}} running", {
        running: data.translator.formatNumber(running),
        total: data.translator.formatNumber(total),
      })}
    </span>
  );
};

const XcpNgPools: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<XcpNgPool>({
    modelType: XcpNgPool,
  });
  const [isAddPoolOpen, setIsAddPoolOpen] = useState<boolean>(false);
  // Pools connected from the Add dialog show in the list at once.
  const [connectedCount, setConnectedCount] = useState<number>(0);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<XcpNgPool>({ modelType: XcpNgPool });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<XcpNgPool>({
      ownerUserModelType: XcpNgPoolOwnerUser,
      ownerTeamModelType: XcpNgPoolOwnerTeam,
      resourceIdField: "xcpNgPoolId",
    });

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<XcpNgPool>({
      modelType: XcpNgPool,
    });

  const xcpNgExtraFacets: Array<ResourceFacet> = [
    {
      key: "otelCollectorStatus",
      label: "Status",
      icon: IconProp.Wifi,
      isMultiSelect: false,
      options: [
        { value: "connected", label: "Connected" },
        { value: "disconnected", label: "Disconnected" },
      ],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEnumFacetQuery(values, operator, false);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<XcpNgPool>({
    persistKey: "xcp-ng-pools-table",
    ownerUserModelType: XcpNgPoolOwnerUser,
    ownerTeamModelType: XcpNgPoolOwnerTeam,
    resourceIdField: "xcpNgPoolId",
    showLabelsFacet: true,
    extraFacets: xcpNgExtraFacets,
  });

  if (firstRecordWatch.isLoading) {
    return <PageSkeleton shape="table" />;
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
   * A pool is added by connecting the Xen Orchestra that manages it (Add
   * XCP-ng Pool): the guide turns on Xen Orchestra's OpenMetrics plugin and
   * installs the agent beside it, and every pool that Xen Orchestra manages
   * registers itself by its UUID when its first data arrives. There is no
   * form: a pool typed in by hand would only wait for telemetry that
   * nothing sends.
   */
  return (
    <Fragment>
      <ModelTable<XcpNgPool>
        modelType={XcpNgPool}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={`${firstRecordWatch.refreshToken}-${connectedCount}`}
        id="xcp-ng-pools-table"
        userPreferencesKey="xcp-ng-pools-table"
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
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<XcpNgPool>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={false}
        showRefreshButton={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="XCP-ng Pools"
        isViewable={true}
        searchableFields={["name", "description"]}
        /*
         * The status reads the last read and the agent's own clock too; the
         * running counts read the pool's snapshot, whichever columns are
         * shown.
         */
        selectMoreFields={{
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentLastSeenAt: true,
          hostCount: true,
          runningHostCount: true,
          vmCount: true,
          runningVmCount: true,
          storageCapacityBytes: true,
          storageUsedBytes: true,
        }}
        filters={[]}
        cardProps={{
          title: "XCP-ng Pools",
          description:
            "XCP-ng pools being monitored in this project. Install the OneUptime XCP-ng Agent next to Xen Orchestra, or have a probe read Xen Orchestra or the pool itself, with nothing to install.",
          buttons: [
            /*
             * The probe's way in (#10996, #10999): Connect on the
             * Connections page, opened from here.
             */
            {
              title: "Connect Without an Agent",
              icon: IconProp.Link,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                Navigation.navigate(
                  new Route(
                    `${RouteUtil.populateRouteParams(
                      RouteMap[PageMap.XCP_NG_CONNECTIONS] as Route,
                    ).toString()}?${XCP_NG_CONNECT_QUERY_PARAM}=1`,
                  ),
                );
              },
            },
            {
              title: XCP_NG_POOL_ONBOARDING.addTitle,
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setIsAddPoolOpen(true);
              },
            },
          ],
        }}
        showViewIdButton={true}
        formFields={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: XcpNgPool): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || <TableEmptyValue />}
                </AppLink>
              );
            },
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            /*
             * The hero's reading, word for word: "Can't read API" while the
             * agent runs but Xen Orchestra no longer reports the pool,
             * "Waiting for data" before its first read.
             */
            getElement: (item: XcpNgPool): ReactElement => {
              const connection: XcpNgPoolConnection = getXcpNgPoolConnection({
                pool: item,
                translator: translator,
              });
              return (
                <div
                  className="flex items-center gap-2"
                  data-testid="xcp-ng-pool-status"
                  data-state={connection.state}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${connection.listDotClassName}`}
                  />
                  <span
                    className={`text-sm font-medium ${connection.listTextClassName}`}
                  >
                    {connection.label}
                  </span>
                </div>
              );
            },
          },
          {
            field: {
              xenOrchestraName: true,
            },
            title: "Xen Orchestra",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: XcpNgPool): ReactElement => {
              if (!item.xenOrchestraName) {
                return <TableEmptyValue />;
              }
              return (
                <span className="text-sm text-gray-700">
                  {item.xenOrchestraName}
                </span>
              );
            },
          },
          {
            field: {
              hostCount: true,
            },
            title: "Hosts",
            type: FieldType.Element,
            getElement: (item: XcpNgPool): ReactElement => {
              return renderRunningCount({
                running: item.runningHostCount,
                total: item.hostCount,
                isConnected: getXcpNgPoolConnection({
                  pool: item,
                  translator: translator,
                }).isConnected,
                translator: translator,
                testId: "xcp-ng-pool-hosts",
              });
            },
          },
          {
            field: {
              vmCount: true,
            },
            title: "VMs",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: XcpNgPool): ReactElement => {
              return renderRunningCount({
                running: item.runningVmCount,
                total: item.vmCount,
                isConnected: getXcpNgPoolConnection({
                  pool: item,
                  translator: translator,
                }).isConnected,
                translator: translator,
                testId: "xcp-ng-pool-vms",
              });
            },
          },
          {
            field: {
              storageUsedBytes: true,
            },
            title: "Storage",
            type: FieldType.Element,
            hideOnMobile: true,
            /*
             * Used of the capacity of every storage repository the pool
             * has, as Xen Orchestra reports them: the bar turns amber at
             * 80% and red at 90%, where the storage repository template
             * alerts.
             */
            getElement: (item: XcpNgPool): ReactElement => {
              return (
                <StorageUsageBar
                  usage={getStorageUsage({
                    capacity: item.storageCapacityBytes,
                    used: item.storageUsedBytes,
                  })}
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
            getElement: (item: XcpNgPool): ReactElement => {
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
            getElement: (item: XcpNgPool): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: XcpNgPool): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
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
          showcase={XCP_NG_POOL_SHOWCASE}
          addButton={{
            title: XCP_NG_POOL_ONBOARDING.addTitle,
            onClick: () => {
              setIsAddPoolOpen(true);
            },
          }}
        />
      )}
      {isAddPoolOpen && (
        <AddResourceModal
          onboarding={XCP_NG_POOL_ONBOARDING}
          onClose={() => {
            setIsAddPoolOpen(false);
          }}
          onConnected={() => {
            // The showcase gives way, and the table reads the new pool.
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

export default XcpNgPools;
