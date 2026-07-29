import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import MonitorStatusElement from "../../Components/MonitorStatus/MonitorStatusElement";
import ImportSitesFromCsvModal from "../../Components/NetworkSite/ImportSitesFromCsvModal";
import SiteHierarchyTree from "../../Components/NetworkSite/SiteHierarchyTree";
import SiteSummaryCards from "../../Components/NetworkSite/SiteSummaryCards";
import Route from "Common/Types/API/Route";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const NetworkSites: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Bumped when sites change — a create from the table, or a CSV import — so
   * the table, the summary cards and the hierarchy tree all refetch without a
   * page reload.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  return (
    <Fragment>
      <SiteSummaryCards refreshToggle={refreshToggle} />
      <div className="mb-5">
        <SiteHierarchyTree refreshToggle={refreshToggle} />
      </div>
      <ModelTable<NetworkSite>
        refreshToggle={refreshToggle}
        onCreateSuccess={(item: NetworkSite): Promise<NetworkSite> => {
          setRefreshToggle(Date.now().toString());
          return Promise.resolve(item);
        }}
        modelType={NetworkSite}
        id="network-sites-table"
        userPreferencesKey="network-sites-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        name="Network Sites"
        searchableFields={["name", "description"]}
        cardProps={{
          title: "Network Sites",
          description:
            "Group your network devices into a drill-down hierarchy — regions, franchisees, markets, units. Each site rolls up the health of everything below it.",
          buttons: [
            /*
             * OUTLINE, not NORMAL/PRIMARY: BaseModelTable promotes the first
             * NORMAL/PRIMARY button to the header slot, and bulk import
             * belongs in the ⋯ overflow next to the other table-wide actions
             * — the same place every other bulk import in the product lives.
             */
            {
              title: "Import from CSV",
              buttonStyle: ButtonStyleType.OUTLINE,
              icon: IconProp.Upload,
              onClick: () => {
                setShowImportModal(true);
              },
            } as CardButtonSchema,
          ],
        }}
        showViewIdButton={true}
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
              networkSiteType: {
                name: true,
              },
            },
            title: "Site Type",
            type: FieldType.Entity,
            filterEntityType: NetworkSiteType,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
        ]}
        formSteps={[
          { title: "Site Details", id: "site-details" },
          { title: "Location", id: "location" },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "site-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Unit 1042 - Springfield",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "site-details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Flagship location — two switches and a firewall.",
          },
          {
            field: {
              networkSiteType: true,
            },
            title: "Site Type",
            stepId: "site-details",
            description:
              "Level of this site in the hierarchy. Unit-level types are leaf sites — the network map opens their device topology. Manage the list in Network Settings.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSiteType,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Site Type",
          },
          {
            field: {
              parentSite: true,
            },
            title: "Parent Site",
            stepId: "site-details",
            description:
              "The site this one is nested under. Leave empty for a root site.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSite,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Parent Site (optional)",
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            stepId: "location",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "742 Evergreen Terrace, Springfield, IL",
          },
          {
            field: {
              latitude: true,
            },
            title: "Latitude",
            stepId: "location",
            description:
              "Between -90 and 90. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "39.7817",
          },
          {
            field: {
              longitude: true,
            },
            title: "Longitude",
            stepId: "location",
            description:
              "Between -180 and 180. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "-89.6501",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: NetworkSite): ReactElement => {
              const route: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
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
              networkSiteType: {
                name: true,
              },
            },
            title: "Site Type",
            type: FieldType.Entity,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.networkSiteType?.name) {
                return <span className="text-sm text-gray-400">Not set</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.networkSiteType.name}
                </span>
              );
            },
          },
          {
            field: {
              parentSite: {
                name: true,
              },
            },
            title: "Parent Site",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.parentSite?.name) {
                return <span className="text-sm text-gray-400">Root</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.parentSite.name}
                </span>
              );
            },
          },
          {
            field: {
              currentMonitorStatus: {
                name: true,
                color: true,
              },
            },
            title: "Status",
            type: FieldType.Entity,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.currentMonitorStatus) {
                return <span className="text-sm text-gray-400">No Data</span>;
              }
              return (
                <MonitorStatusElement
                  monitorStatus={item.currentMonitorStatus}
                  shouldAnimate={false}
                />
              );
            },
          },
          {
            field: {
              latitude: true,
            },
            title: "Location",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkSite): ReactElement => {
              if (
                item.latitude === undefined ||
                item.latitude === null ||
                item.longitude === undefined ||
                item.longitude === null
              ) {
                return (
                  <span className="text-sm text-gray-400">Not pinned</span>
                );
              }
              return (
                <span className="text-sm text-gray-600">
                  {item.latitude}, {item.longitude}
                </span>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
        selectMoreFields={{
          longitude: true,
        }}
        onViewPage={(item: NetworkSite): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />

      {showImportModal && (
        <ImportSitesFromCsvModal
          onClose={() => {
            setShowImportModal(false);
          }}
          onImportComplete={() => {
            /*
             * Fires while the modal is still open on its results, so the
             * table and the rollups behind it are already current when the
             * user closes it.
             */
            setRefreshToggle(Date.now().toString());
          }}
        />
      )}
    </Fragment>
  );
};

export default NetworkSites;
