import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Probe from "Common/Models/DatabaseModels/Probe";
import XcpNgConnection from "Common/Models/DatabaseModels/XcpNgConnection";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AppLink from "../../Components/AppLink/AppLink";
import {
  XCP_NG_CONNECT_FORM_STEPS,
  getXcpNgConnectFormFields,
} from "../../Components/XcpNg/XcpNgConnectionFormFields";
import {
  XCP_NG_CONNECT_QUERY_PARAM,
  XcpNgCollectionStatusView,
  XcpNgCollectionTone,
  getXcpNgCollectionStatusView,
  getXcpNgConnectionTypeLabel,
} from "../../Components/XcpNg/XcpNgConnectionView";
import ProbeUtil from "../../Utils/Probe";

/*
 * XCP-ng > Connections: the Xen Orchestras and pools a OneUptime probe reads,
 * with no agent to run (#10996, #10999). Connect adds one - a Xen Orchestra
 * for every pool it manages, or one pool without Xen Orchestra through its
 * XAPI - and opens its page, where the first read shows. Every pool a
 * connection reads joins XCP-ng Pools by its UUID, as the agent's do.
 *
 * The Pools page's "Connect Without an Agent" opens Connect here
 * (?connect=1).
 */

const DOT_CLASS: Record<XcpNgCollectionTone, string> = {
  [XcpNgCollectionTone.Collecting]: "bg-emerald-500",
  [XcpNgCollectionTone.Checking]: "bg-indigo-500",
  [XcpNgCollectionTone.Failing]: "bg-red-500",
};

const TEXT_CLASS: Record<XcpNgCollectionTone, string> = {
  [XcpNgCollectionTone.Collecting]: "text-emerald-700",
  [XcpNgCollectionTone.Checking]: "text-indigo-700",
  [XcpNgCollectionTone.Failing]: "text-red-700",
};

const XcpNgConnections: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  useEffect(() => {
    ProbeUtil.getAllProbes()
      .then((allProbes: Array<Probe>) => {
        setProbes(allProbes);
      })
      .catch(() => {
        // The picker then offers none, and says how to add one.
      });

    // Opened from the Pools page's "Connect Without an Agent".
    if (Navigation.getQueryStringByName(XCP_NG_CONNECT_QUERY_PARAM)) {
      setShowCreateForm(true);
    }
  }, []);

  return (
    <Fragment>
      <ModelTable<XcpNgConnection>
        modelType={XcpNgConnection}
        id="xcp-ng-connections-table"
        userPreferencesKey="xcp-ng-connections-table"
        name="XCP-ng Connections"
        singularName="XCP-ng"
        createVerb="Connect"
        createFormTitle="Connect XCP-ng"
        showCreateForm={showCreateForm}
        isCreateable={true}
        isEditable={false}
        isDeleteable={false}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        searchableFields={["name", "address", "description"]}
        filters={[]}
        query={{}}
        cardProps={{
          title: "Connections",
          description:
            "The Xen Orchestras and pools a OneUptime probe reads, with no agent to install. Connect a Xen Orchestra once for every pool it manages, or a pool without one through its XAPI.",
        }}
        noItemsMessage="Nothing is connected yet. Connect a Xen Orchestra, or a pool without one, and a probe reads it - its pools show up with the same pages as the agent's."
        formSteps={XCP_NG_CONNECT_FORM_STEPS}
        formFields={getXcpNgConnectFormFields({
          probes: probes,
          isBillingEnabled: BILLING_ENABLED,
          translator: translator,
        })}
        onCreateSuccess={(
          item: XcpNgConnection,
          modalType?: ModalType,
        ): Promise<XcpNgConnection> => {
          setShowCreateForm(false);
          // Its page is where the first read shows, and a certificate to trust.
          if (item._id && modalType !== ModalType.Edit) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.XCP_NG_CONNECTION_VIEW] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }
          return Promise.resolve(item);
        }}
        /*
         * The status reads the columns that decide whether a probe may read
         * it (XcpNgCollectionStop) and its last report, whichever columns
         * are shown.
         */
        selectMoreFields={{
          projectId: true,
          connectionType: true,
          address: true,
          username: true,
          isOpenMetricsSecretSet: true,
          isPasswordSet: true,
          collectionProbeId: true,
          collectionProbe: {
            name: true,
            isGlobalProbe: true,
            projectId: true,
            connectionStatus: true,
          },
          collectionStatus: true,
          collectionErrorCode: true,
          nextCollectionAt: true,
          collectionSummary: true,
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: XcpNgConnection): ReactElement => {
              return (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.XCP_NG_CONNECTION_VIEW] as Route,
                    { modelId: new ObjectID(item._id as string) },
                  )}
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {(item.name as string) || <TableEmptyValue />}
                </AppLink>
              );
            },
          },
          {
            field: {
              connectionType: true,
            },
            title: "Reads",
            type: FieldType.Element,
            getElement: (item: XcpNgConnection): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getXcpNgConnectionTypeLabel(item.connectionType, translator)}
                </span>
              );
            },
          },
          {
            field: {
              collectionStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: XcpNgConnection): ReactElement => {
              const view: XcpNgCollectionStatusView =
                getXcpNgCollectionStatusView(
                  item,
                  translator,
                  new Date(),
                  BILLING_ENABLED,
                );
              return (
                <div
                  className="flex items-center gap-2"
                  data-testid="xcp-ng-connection-status-cell"
                  data-tone={view.tone}
                  title={view.title}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${DOT_CLASS[view.tone]}`}
                  />
                  <span
                    className={`text-sm font-medium ${TEXT_CLASS[view.tone]}`}
                  >
                    {view.label}
                  </span>
                </div>
              );
            },
          },
          {
            field: {
              collectionSummary: true,
            },
            title: "Pools",
            type: FieldType.Element,
            getElement: (item: XcpNgConnection): ReactElement => {
              const count: number = Array.isArray(item.collectionSummary?.pools)
                ? item.collectionSummary!.pools.length
                : 0;
              if (!item.collectionSummary) {
                return <TableEmptyValue />;
              }
              return (
                <span className="text-sm text-gray-900">
                  {translator.formatNumber(count)}
                </span>
              );
            },
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: XcpNgConnection): ReactElement => {
              return (
                <bdi className="font-mono text-xs text-gray-700">
                  {item.address || ""}
                </bdi>
              );
            },
          },
          {
            field: {
              collectionProbe: {
                name: true,
              },
            },
            title: "Probe",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: XcpNgConnection): ReactElement => {
              return item.collectionProbe?.name ? (
                <span className="text-sm text-gray-700">
                  {item.collectionProbe.name}
                </span>
              ) : (
                <TableEmptyValue />
              );
            },
          },
          {
            field: {
              lastSuccessfulCollectionAt: true,
            },
            title: "Last Read",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
        onViewPage={(item: XcpNgConnection): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_CONNECTION_VIEW] as Route,
              { modelId: new ObjectID(item._id as string) },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default XcpNgConnections;
