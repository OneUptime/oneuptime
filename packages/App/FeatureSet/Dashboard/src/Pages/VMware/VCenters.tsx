import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterOwnerTeam from "Common/Models/DatabaseModels/VMwareVCenterOwnerTeam";
import VMwareVCenterOwnerUser from "Common/Models/DatabaseModels/VMwareVCenterOwnerUser";
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
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import VMwareDocumentationCard from "../../Components/VMware/DocumentationCard";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";

/*
 * While the project has no vCenters yet, re-count on this cadence so the
 * page flips from the install guide to the table the moment the first
 * agent collection lands — no hard refresh.
 */
const FIRST_DATA_POLL_INTERVAL_MS: number = 10 * 1000;

const VMwareVCenters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [clusterCount, setClusterCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<VMwareVCenter>({ modelType: VMwareVCenter });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<VMwareVCenter>({
      ownerUserModelType: VMwareVCenterOwnerUser,
      ownerTeamModelType: VMwareVCenterOwnerTeam,
      resourceIdField: "vmwareVCenterId",
    });

  const { archiveBulkActions } = useBulkArchiveActions<VMwareVCenter>({
    modelType: VMwareVCenter,
  });

  const vmwareExtraFacets: Array<ResourceFacet> = [
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
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<VMwareVCenter>({
    persistKey: "vmware-vcenters-table",
    ownerUserModelType: VMwareVCenterOwnerUser,
    ownerTeamModelType: VMwareVCenterOwnerTeam,
    resourceIdField: "vmwareVCenterId",
    showLabelsFacet: true,
    extraFacets: vmwareExtraFacets,
  });

  const fetchClusterCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: VMwareVCenter,
        query: {},
      });
      setClusterCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchClusterCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * Live first-data poll: the one-shot count above paints the empty
   * state; this effect keeps quietly re-counting every 10s while the
   * count is zero and flips the page to the table on the first nonzero
   * result. The interval is cleared on unmount and is not re-armed once
   * a vCenter exists (the effect re-runs with a nonzero count and
   * bails). Background failures keep the empty state rather than
   * replacing the install guide with an error.
   */
  useEffect(() => {
    if (clusterCount !== 0) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      ModelAPI.count({
        modelType: VMwareVCenter,
        query: {},
      })
        .then((count: number) => {
          if (count > 0) {
            setClusterCount(count);
          }
        })
        .catch(() => {
          // Transient background-poll failure — keep polling.
        });
    }, FIRST_DATA_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [clusterCount]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <ModelTable<VMwareVCenter>
        modelType={VMwareVCenter}
        id="vmware-vcenters-table"
        userPreferencesKey="vmware-vcenters-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<VMwareVCenter>) => {
          onResourcesFetched(data);
        }}
        onCreateSuccess={(item: VMwareVCenter): Promise<VMwareVCenter> => {
          setClusterCount((currentCount: number | null): number => {
            return (currentCount || 0) + 1;
          });
          return Promise.resolve(item);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        showRefreshButton={true}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="vCenters"
        isViewable={true}
        searchableFields={["name", "description"]}
        filters={[]}
        cardProps={{
          title: "vCenters",
          description:
            "vCenter Servers (and standalone ESXi hosts) being monitored in this project. Install the OneUptime VMware Agent to connect one.",
        }}
        showViewIdButton={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "prod-vcenter",
            description:
              "This should match the vmware.vcenter.name resource attribute reported by the VMware Agent (the VMWARE_VCENTER_NAME it was installed with).",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production vCenter Server in the US East datacenter",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: VMwareVCenter): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.VMWARE_VCENTER_VIEW] as Route,
                {
                  modelId: new ObjectID(item._id as string),
                },
              );
              return (
                <AppLink
                  to={route}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || "—"}
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
            getElement: (item: VMwareVCenter): ReactElement => {
              const isConnected: boolean =
                item.otelCollectorStatus === "connected";
              return (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      isConnected ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      isConnected ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {isConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>
              );
            },
          },
          /*
           * The host / VM / datastore counts deliberately do NOT live on
           * this list. They are per-collection snapshot columns whose
           * meaning needs the vCenter's own context to read correctly —
           * the vCenter overview page shows them next to the inventory
           * they summarise. The vcenter receiver reports no vSphere
           * version, so there is no version column either.
           */
          {
            field: {
              agentVersion: true,
            },
            title: "Agent Version",
            type: FieldType.Text,
            hideOnMobile: true,
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
            getElement: (item: VMwareVCenter): ReactElement => {
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
            getElement: (item: VMwareVCenter): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        onViewPage={(item: VMwareVCenter): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.VMWARE_VCENTER_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
      {clusterCount === 0 && (
        <VMwareDocumentationCard
          title="Getting Started with VMware Monitoring"
          description="No vCenters connected yet. Install the agent using the guide below and your vCenter will appear here automatically."
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default VMwareVCenters;
