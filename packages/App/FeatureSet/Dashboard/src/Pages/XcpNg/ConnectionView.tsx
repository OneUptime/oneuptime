import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import XcpNgConnection from "Common/Models/DatabaseModels/XcpNgConnection";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import AppLink from "../../Components/AppLink/AppLink";
import XcpNgConnectionStatusCard from "../../Components/XcpNg/XcpNgConnectionStatusCard";
import {
  XcpNgPoolConnection,
  getXcpNgPoolConnection,
} from "./Utils/XcpNgPoolConnection";

/*
 * One XCP-ng connection's page: how its reading stands (and the one thing
 * that fixes it), the pools it reads - each with every page the agent's
 * pools have - what it is called, and Delete.
 *
 * Deleting a connection never deletes a pool: its pools keep their data
 * and history, and the next connection that reads one, or the agent, takes
 * it over (Common/Server/Utils/XcpNg/XcpNgPoolAssignment).
 */
const XcpNgConnectionView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  // A change on the status card (a new address, a probe) shows in the pools.
  const [refreshToken, setRefreshToken] = useState<number>(0);

  return (
    <Fragment>
      <XcpNgConnectionStatusCard
        modelId={modelId}
        onChanged={() => {
          setRefreshToken((token: number): number => {
            return token + 1;
          });
        }}
      />

      <ModelTable<XcpNgPool>
        modelType={XcpNgPool}
        id="xcp-ng-connection-pools-table"
        userPreferencesKey="xcp-ng-connection-pools-table"
        name="XCP-ng Pools"
        refreshToggle={String(refreshToken)}
        query={{ xcpNgConnectionId: modelId }}
        isCreateable={false}
        isEditable={false}
        isDeleteable={false}
        isViewable={true}
        showRefreshButton={true}
        filters={[]}
        cardProps={{
          title: "Pools It Reads",
          description:
            "The pools this connection reads, each with the same pages, monitors and templates as a pool the XCP-ng Agent sends. A pool shows up here after its first read.",
        }}
        noItemsMessage="No pool read yet. The first read adds every pool it finds, by its UUID."
        selectMoreFields={{
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentLastSeenAt: true,
          runningHostCount: true,
          runningVmCount: true,
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: XcpNgPool): ReactElement => {
              return (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
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
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Element,
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
                    className={`inline-block h-2 w-2 rounded-full ${connection.listDotClassName}`}
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
              hostCount: true,
            },
            title: "Hosts",
            type: FieldType.Element,
            getElement: (item: XcpNgPool): ReactElement => {
              if (!item.hostCount) {
                return <TableEmptyValue />;
              }
              return (
                <span className="text-sm text-gray-900">
                  {translator.translateTemplate(
                    "{{running}}/{{total}} running",
                    {
                      running: translator.formatNumber(
                        item.runningHostCount || 0,
                      ),
                      total: translator.formatNumber(item.hostCount),
                    },
                  )}
                </span>
              );
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
              if (!item.vmCount) {
                return <TableEmptyValue />;
              }
              return (
                <span className="text-sm text-gray-900">
                  {translator.translateTemplate(
                    "{{running}}/{{total}} running",
                    {
                      running: translator.formatNumber(item.runningVmCount || 0),
                      total: translator.formatNumber(item.vmCount),
                    },
                  )}
                </span>
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
        onViewPage={(item: XcpNgPool): Promise<Route> => {
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
              { modelId: new ObjectID(item._id as string) },
            ),
          );
        }}
      />

      <CardModelDetail<XcpNgConnection>
        name="XCP-ng Connection Details"
        cardProps={{
          title: "Connection Details",
          description:
            "How this connection is named in OneUptime. A Xen Orchestra's name also shows on every pool it reads.",
        }}
        isEditable={true}
        editButtonText="Edit Details"
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Xen Orchestra",
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Xen Orchestra for the Paris datacenter",
          },
        ]}
        modelDetailProps={{
          modelType: XcpNgConnection,
          id: "model-detail-xcp-ng-connection",
          modelId: modelId,
          showDetailsInNumberOfColumns: 2,
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: { description: true },
              title: "Description",
              fieldType: FieldType.LongText,
              placeholder: "No description",
            },
          ],
        }}
      />

      <ModelDelete
        modelType={XcpNgConnection}
        modelId={modelId}
        singularName="Connection"
        confirmationContent={
          <p className="text-sm text-gray-600">
            {translator.translateText(
              "The probe stops reading it. Its pools keep their data and history: connect them again, or install the XCP-ng Agent, and they carry on where they stopped.",
            )}
          </p>
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_CONNECTIONS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default XcpNgConnectionView;
