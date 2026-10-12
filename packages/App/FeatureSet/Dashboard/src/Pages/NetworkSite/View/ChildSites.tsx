import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import MonitorStatusElement from "../../../Components/MonitorStatus/MonitorStatusElement";
import { NETWORK_SITE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/NetworkSiteMetricDescriptions";
import { fetchChildNetworkSiteTypeOptions } from "../../../Components/NetworkSite/NetworkSiteFormDropdownOptions";
import Route from "Common/Types/API/Route";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import { SITE_MORE_FIELDS } from "../SiteFormSections";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Sites nested directly under this one. New child sites created here are
 * automatically parented to this site.
 */
const NetworkSiteChildSites: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
        // "Add Child Site", the same verb as the Sites list's "Add Site".
        createVerb="Add"
        singularName="Child Site"
        pluralName="Child Sites"
        showRefreshButton={true}
        name="Child Sites"
        cardProps={{
          title: "Child Sites",
          description: "Sites nested directly under this one.",
        }}
        noItemsMessage="This site has no child sites. Add one to build out the hierarchy below it."
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
        /*
         * One page: the child's type and name, with its location folded
         * under More fields. Two rows and a fold need no steps (the parent
         * is this site, so there is no hierarchy step to walk to).
         */
        formFields={[
          {
            field: {
              networkSiteType: true,
            },
            title: "Site Type",
            description:
              "Any type except the ones above this site's own type in the hierarchy. A unit-level site holds devices rather than child sites, so it offers none.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: () => {
              return fetchChildNetworkSiteTypeOptions(modelId);
            },
            required: true,
            placeholder: "Select Child Site Type",
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Unit 1042 - Springfield",
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            collapsibleSection: SITE_MORE_FIELDS,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "742 Evergreen Terrace, Springfield, IL",
          },
          {
            field: {
              latitude: true,
            },
            title: "Latitude",
            collapsibleSection: SITE_MORE_FIELDS,
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
            collapsibleSection: SITE_MORE_FIELDS,
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
                return (
                  <span className="text-sm text-gray-400">
                    {translator.translateText("Not set")}
                  </span>
                );
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
            headerTooltip: NETWORK_SITE_METRIC_DESCRIPTIONS.childSiteStatus,
            type: FieldType.Entity,
            getElement: (item: NetworkSite): ReactElement => {
              if (!item.currentMonitorStatus) {
                return (
                  <span className="text-sm text-gray-400">
                    {translator.translateText("No Data")}
                  </span>
                );
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
