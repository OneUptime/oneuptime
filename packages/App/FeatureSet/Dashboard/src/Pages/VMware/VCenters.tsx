import PageMap from "../../Utils/PageMap";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../Components/Archive/ResourceArchiveCopy";
import AgentVersion from "../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../Components/AgentVersion/AgentKind";
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
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import Navigation from "Common/UI/Utils/Navigation";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../Components/Infrastructure/UseFirstRecordWatch";
import {
  getFirstRunEmptyState,
  getFirstRunTopContent,
} from "../../Components/Infrastructure/FirstRecordWatch";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import useShowcaseCreateForm, {
  ShowcaseCreateForm,
} from "../../Components/ResourceShowcase/UseShowcaseCreateForm";
import VMWARE_VCENTER_SHOWCASE from "../../Components/VMware/VMwareVCenterShowcase";
import AppLink from "../../Components/AppLink/AppLink";
import ObjectID from "Common/Types/ObjectID";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import Probe from "Common/Models/DatabaseModels/Probe";
import VMwareCollectionMethod from "Common/Types/VMware/VMwareCollectionMethod";
import { JSONObject } from "Common/Types/JSON";
import { BILLING_ENABLED } from "Common/UI/Config";
import ProbeUtil from "../../Utils/Probe";
import {
  VMWARE_CONNECT_FORM_STEPS,
  getVMwareConnectFormFields,
} from "../../Components/VMware/VMwareConnectionFormFields";
import { isProbeCollected } from "../../Components/VMware/VMwareProbeCollectionView";

const VMwareVCenters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const firstRecordWatch: FirstRecordWatch = useFirstRecordWatch<VMwareVCenter>(
    {
      modelType: VMwareVCenter,
    },
  );
  // The probes a vCenter can be connected through (the Connect form's picker).
  const [probes, setProbes] = useState<Array<Probe>>([]);
  // The showcase's Connect vCenter: the table's own form.
  const showcaseCreateForm: ShowcaseCreateForm = useShowcaseCreateForm({
    modelType: VMwareVCenter,
    createVerb: "Connect",
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<VMwareVCenter>({ modelType: VMwareVCenter });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<VMwareVCenter>({
      ownerUserModelType: VMwareVCenterOwnerUser,
      ownerTeamModelType: VMwareVCenterOwnerTeam,
      resourceIdField: "vmwareVCenterId",
    });

  const { archiveBulkActions, archiveRowActions } =
    useBulkArchiveActions<VMwareVCenter>({
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
    emptyState: facetEmptyState,
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

  useEffect(() => {
    ProbeUtil.getAllProbes()
      .then((allProbes: Array<Probe>) => {
        setProbes(allProbes);
      })
      .catch(() => {
        // The picker then offers none, and says how to add one.
      });
  }, []);

  if (firstRecordWatch.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (firstRecordWatch.error) {
    return (
      <ErrorMessage
        message={firstRecordWatch.error}
        onRefreshClick={firstRecordWatch.retry}
      />
    );
  }

  return (
    <Fragment>
      <ModelTable<VMwareVCenter>
        modelType={VMwareVCenter}
        // Archive in each row's ⋯ menu, as in Bulk Actions.
        actionButtons={[...archiveRowActions]}
        refreshToggle={firstRecordWatch.refreshToken}
        id="vmware-vcenters-table"
        userPreferencesKey="vmware-vcenters-table"
        topContent={getFirstRunTopContent({
          topContent: filterBar,
          count: firstRecordWatch.count,
        })}
        emptyState={getFirstRunEmptyState({
          emptyState: facetEmptyState,
          count: firstRecordWatch.count,
        })}
        showCreateForm={showcaseCreateForm.showCreateForm}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<VMwareVCenter>) => {
          onResourcesFetched(data);
        }}
        onCreateSuccess={(
          item: VMwareVCenter,
          modalType?: ModalType,
        ): Promise<VMwareVCenter> => {
          firstRecordWatch.onRecordCreated();
          /*
           * Its page is where the first collection shows: the status card
           * there says whether the probe got in, and offers "Trust this
           * certificate" for a certificate nobody trusted yet.
           */
          if (item._id && modalType !== ModalType.Edit) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.VMWARE_VCENTER_VIEW] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }
          return Promise.resolve(item);
        }}
        isDeleteable={true}
        deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={true}
        createVerb="Connect"
        /*
         * A vCenter connected here is collected by a probe: OneUptime logs
         * in with the account entered, no agent to run. One the VMware agent
         * sends appears on its own when the agent first reports.
         */
        onBeforeCreate={async (
          item: VMwareVCenter,
          miscDataProps: JSONObject,
        ): Promise<VMwareVCenter> => {
          void miscDataProps;
          item.collectionMethod = VMwareCollectionMethod.Probe;
          return item;
        }}
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
            "vCenter Servers and ESXi hosts in this project. Connect one with a read-only account and a probe, or install the VMware Agent.",
        }}
        showViewIdButton={true}
        formSteps={VMWARE_CONNECT_FORM_STEPS}
        formFields={getVMwareConnectFormFields({
          probes: probes,
          isBillingEnabled: BILLING_ENABLED,
          translator: translator,
        })}
        selectMoreFields={{
          collectionMethod: true,
          collectionProbe: {
            name: true,
          },
        }}
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
                    {isConnected
                      ? translator.translateText("Connected")
                      : translator.translateText("Disconnected")}
                  </span>
                </div>
              );
            },
          },
          /*
           * Collected By and Agent Version start hidden. The list answers
           * "which vCenters are there, and are they up?" with the columns
           * every infrastructure list shows: Name, Status, Last Seen, Labels
           * and Owners. How one vCenter is collected, and the version of the
           * agent that sends it, are details of that vCenter, on its own
           * pages: the Overview shows the Agent Version (with its upgrade
           * sign) under vCenter Details, and Settings the Data Collection
           * card. The table's Customize Columns turns either back on.
           *
           * Neither is hideOnMobile: that flag drops a column at render
           * while the picker knows nothing of it, so on a phone a viewer
           * who switched one on would get no column (as the monitor list's
           * Template column explains, in Components/Monitor/MonitorTable).
           */
          {
            field: {
              collectionMethod: true,
            },
            title: "Collected By",
            type: FieldType.Element,
            isHiddenByDefault: true,
            getElement: (item: VMwareVCenter): ReactElement => {
              if (!isProbeCollected(item)) {
                return (
                  <span className="text-sm text-gray-700">
                    {translator.translateText("VMware Agent")}
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-700">
                  {item.collectionProbe?.name
                    ? translator.translateTemplate("Probe: {{name}}", {
                        name: item.collectionProbe.name,
                      })
                    : translator.translateText("Probe")}
                </span>
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
            type: FieldType.Element,
            // Hidden until asked for: see Collected By above.
            isHiddenByDefault: true,
            getElement: (item: VMwareVCenter): ReactElement => {
              /*
               * No version: a vCenter a probe collects, or an agent from
               * before its files reported one. The quiet dash every empty
               * cell has, which a phone's card leaves out rather than
               * naming a field with nothing under it.
               */
              if (!item.agentVersion) {
                return <TableEmptyValue screenReaderText="Not reported" />;
              }

              return (
                <AgentVersion
                  kind={AgentKind.VMwareAgent}
                  version={item.agentVersion}
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
      {firstRecordWatch.count === 0 && (
        <ResourceShowcaseCard
          showcase={VMWARE_VCENTER_SHOWCASE}
          addButton={showcaseCreateForm.addButton}
        />
      )}
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default VMwareVCenters;
