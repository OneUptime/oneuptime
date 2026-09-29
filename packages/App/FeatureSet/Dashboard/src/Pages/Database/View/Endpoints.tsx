import PageComponentProps from "../../PageComponentProps";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Blue, Gray500 } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  DatabaseEndpointSourceLabel,
  getDatabaseEndpointSourceLabel,
} from "../Utils/DatabaseServerPresentation";
import useDatabaseWideTable from "../Utils/useDatabaseWideTable";

/*
 * The endpoints a database is known by — the ONE thing that decides which
 * telemetry is this database's (every endpoint's entity key is part of the
 * scope). Discovery adds the endpoints it sees; people add aliases for the
 * names discovery cannot connect (a second DNS name, an IP, a pooler).
 *
 * Each endpoint belongs to at most one database per project, so adding one
 * that another database owns is refused with that database's name. The
 * primary endpoint is the database's identity and cannot be removed here.
 */

export const PRIMARY_ENDPOINT_DELETE_MESSAGE: string =
  "The primary endpoint is this database's identity and cannot be removed. Archive the database instead if you no longer need it.";

/*
 * Width cap for the Endpoint cell. A Kubernetes pod's DNS name
 * ("postgres-0.postgres-headless.data.svc.cluster.local:5432@e2e-kind")
 * made the column 582 px wide and pushed Last Matched and Delete past the
 * card at 1440 px; capped, the name is cut with an ellipsis and reads in
 * full on hover (and when copied).
 */
export const DATABASE_ENDPOINT_COLUMN_MAX_WIDTH_CLASS: string = "max-w-xs";

const DatabaseServerEndpoints: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/endpoints, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const isWideTable: boolean = useDatabaseWideTable();

  return (
    <Fragment>
      <ModelTable<DatabaseServerEndpoint>
        modelType={DatabaseServerEndpoint}
        id="database-server-endpoints-table"
        userPreferencesKey="database-server-endpoints-table"
        name="Database Endpoints"
        singularName="Endpoint"
        pluralName="Endpoints"
        query={{
          databaseServerId: modelId,
        }}
        isCreateable={true}
        isDeleteable={true}
        isEditable={false}
        isViewable={false}
        showRefreshButton={true}
        sortBy="isPrimary"
        sortOrder={SortOrder.Descending}
        selectMoreFields={{
          isPrimary: true,
        }}
        onBeforeCreate={(
          item: DatabaseServerEndpoint,
          _miscDataProps: JSONObject,
        ): Promise<DatabaseServerEndpoint> => {
          /*
           * The server canonicalizes the value against this database's
           * engine, namespace and cluster, refuses one another database
           * owns, and records it as a user alias.
           */
          item.databaseServerId = modelId;
          item.endpoint = String(item.endpoint || "").trim();
          return Promise.resolve(item);
        }}
        onBeforeDelete={(
          item: DatabaseServerEndpoint,
        ): Promise<DatabaseServerEndpoint> => {
          if (item.isPrimary) {
            return Promise.reject(
              new BadDataException(PRIMARY_ENDPOINT_DELETE_MESSAGE),
            );
          }
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Endpoints",
          description:
            "The host:port names this database is reached by. Queries your applications send to any of them, and engine metrics collected under any of them, show on this database's pages. Add an alias for a name OneUptime could not connect on its own — a second DNS name, an IP address or a connection pooler.",
        }}
        noItemsMessage="This database has no endpoints yet. Add the host:port your applications connect to."
        formFields={[
          {
            field: {
              endpoint: true,
            },
            title: "Endpoint",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "db-replica.prod.internal:5432",
            description:
              "host:port as your applications connect to it. The engine's default port is used when you leave the port out; Kubernetes names are completed with this database's namespace.",
          },
        ]}
        filters={[]}
        columns={[
          {
            field: {
              endpoint: true,
            },
            title: "Endpoint",
            type: FieldType.Element,
            getElement: (item: DatabaseServerEndpoint): ReactElement => {
              const endpoint: string = String(item.endpoint || "").trim();
              /*
               * Truncated rather than wrapped: every table cell is nowrap,
               * and a max-width without overflow hidden would paint the
               * name over the next column.
               */
              return (
                <div
                  className={`flex min-w-0 items-center gap-2 ${DATABASE_ENDPOINT_COLUMN_MAX_WIDTH_CLASS}`}
                >
                  <span
                    data-testid="database-endpoint-value"
                    className="min-w-0 truncate font-mono text-sm text-gray-900"
                    title={endpoint || undefined}
                  >
                    {endpoint || "—"}
                  </span>
                  {item.isPrimary ? (
                    <span className="flex-shrink-0">
                      <Pill text="Primary" color={Blue} />
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              source: true,
            },
            title: "Added by",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DatabaseServerEndpoint): ReactElement => {
              const label: DatabaseEndpointSourceLabel =
                getDatabaseEndpointSourceLabel(item.source);
              return (
                <Pill
                  text={label.text}
                  color={label.isUser ? Blue : Gray500}
                  tooltip={label.description}
                />
              );
            },
          },
          {
            field: {
              lastMatchedAt: true,
            },
            title: "Last Matched",
            type: FieldType.DateTime,
            hideOnMobile: true,
            noValueMessage: "—",
          },
          {
            field: {
              createdAt: true,
            },
            title: "Added",
            type: FieldType.DateTime,
            hideOnMobile: true,
            /*
             * Below 2xl it starts hidden (the column picker offers it): with
             * it the table was 1160 px in a 1098 px card at 1440 px, and the
             * Delete button was cut off.
             */
            isHiddenByDefault: !isWideTable,
          },
        ]}
      />
    </Fragment>
  );
};

export default DatabaseServerEndpoints;
