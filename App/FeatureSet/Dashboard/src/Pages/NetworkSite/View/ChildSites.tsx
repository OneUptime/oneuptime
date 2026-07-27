import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import MonitorStatusElement from "../../../Components/MonitorStatus/MonitorStatusElement";
import Route from "Common/Types/API/Route";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Sites nested directly under this one. New child sites created here are
 * automatically parented to this site.
 */
const NetworkSiteChildSites: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<NetworkSite>
        modelType={NetworkSite}
        id="network-site-children-table"
        userPreferencesKey="network-site-children-table"
        query={{ parentSiteId: modelId }}
        onBeforeCreate={(item: NetworkSite): Promise<NetworkSite> => {
          item.parentSiteId = modelId;
          return Promise.resolve(item);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        name="Child Sites"
        cardProps={{
          title: "Child Sites",
          description: "Sites nested directly under this one.",
        }}
        noItemsMessage="This site has no child sites. Create one to build out the hierarchy below it."
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
        ]}
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
    </Fragment>
  );
};

export default NetworkSiteChildSites;
