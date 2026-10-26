import PageComponentProps from "../PageComponentProps";
import UserElement from "../../Components/User/User";
import McpServerCard from "../../Components/Mcp/McpServerCard";
import {
  getMcpAccessLabel,
  getMcpClientHost,
} from "../../Utils/McpClientAuthorization";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import {
  DeleteConfirmation,
  ModalTableBulkDefaultActions,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import User from "Common/Models/DatabaseModels/User";
import Route from "Common/Types/API/Route";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * How wide the two free-text cells of the connected clients table may grow.
 *
 * Table cells do not wrap, so a long client name or a long email address
 * makes the whole table wider than the card and pushes the row's Disconnect
 * button - the one thing the table is for - out of sight on a laptop screen.
 * Capped, the text is cut short with an ellipsis instead (every line in both
 * cells truncates; the full value is the tooltip).
 *
 * The numbers are measured, not chosen: beside the page's side menu the table
 * has 938px at a 1280px window and 1194px at 1536px, and the other columns
 * take 542px of it. These are the widest caps that leave the button whole at
 * each of those widths with the longest names the columns can be given.
 */
const CLIENT_CELL_WIDTH_CLASS_NAME: string = "max-w-[10rem] 2xl:max-w-[18rem]";
const CONNECTED_BY_CELL_WIDTH_CLASS_NAME: string =
  "max-w-[11rem] 2xl:max-w-[18rem]";

const McpServerPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const host: string = `${HTTP_PROTOCOL}${HOST}`;
  const mcpUrl: string = `${host}/mcp`;

  const apiKeysRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
  );
  const externalMcpServersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS] as Route,
  );

  return (
    <div>
      <McpServerCard mcpUrl={mcpUrl} apiKeysRoute={apiKeysRoute} />

      {/*
       * The MCP clients members have connected by signing in. A member sees
       * their own; project owners and admins see everybody's (the server
       * scopes the read - see the McpOAuthGrant model). Disconnecting deletes
       * the row, and with it every token the client holds.
       *
       * `activatedAt: NotNull` leaves out approvals a client never came back
       * to collect; those lapse on their own a few minutes later.
       */}
      <ModelTable<McpOAuthGrant>
        modelType={McpOAuthGrant}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          activatedAt: new NotNull(),
        }}
        id="mcp-client-authorizations-table"
        name="Settings > MCP Server > Connected MCP Clients"
        userPreferencesKey="mcp-client-authorizations-table"
        singularName="connected client"
        pluralName="connected clients"
        isDeleteable={true}
        /*
         * Deleting the row IS disconnecting the client, and that is the word
         * the page uses everywhere: on the button, in the confirmation and in
         * the bulk action. Nothing the client created is touched, so the
         * default "this action cannot be undone" would say the wrong thing -
         * the client can simply be connected again.
         */
        deleteButtonText="Disconnect"
        getDeleteConfirmation={async (
          item: McpOAuthGrant,
        ): Promise<DeleteConfirmation> => {
          return {
            title: "Disconnect MCP Client",
            description: item.name
              ? translator.translateTemplate(
                  'Disconnect "{{name}}"? It is signed out at once and must connect again to work here. Nothing it created is deleted.',
                  { name: item.name },
                )
              : translator.translateTemplate(
                  "Disconnect this MCP client? It is signed out at once and must connect again to work here. Nothing it created is deleted.",
                ),
            submitButtonText: "Disconnect",
          };
        }}
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
          deleteVerb: "Disconnect",
          deleteIcon: IconProp.LinkSlash,
          deleteConfirmationWarning:
            "They are signed out immediately and have to be connected again before they can work with this project. Nothing they created is deleted.",
        }}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showViewIdButton={false}
        showRefreshButton={true}
        cardProps={{
          title: "Connected MCP Clients",
          description:
            "MCP clients that were connected to this project by signing in with OneUptime. Each one acts as the person who connected it. Disconnect a client to sign it out immediately.",
        }}
        noItemsMessage={
          "No MCP clients are connected by sign-in. Clients that use an API key are not listed here."
        }
        searchableFields={["name"]}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Client",
          },
        ]}
        selectMoreFields={{
          clientId: true,
          activatedAt: true,
        }}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Client",
            type: FieldType.Element,
            contentClassName: CLIENT_CELL_WIDTH_CLASS_NAME,
            getElement: (item: McpOAuthGrant): ReactElement => {
              const clientHost: string | null = getMcpClientHost(item.clientId);
              const clientName: string = item.name || "MCP Client";

              return (
                <div className="flex flex-col min-w-0">
                  <span
                    className="text-sm font-medium text-gray-900 truncate"
                    title={clientName}
                  >
                    {clientName}
                  </span>
                  {clientHost ? (
                    <span
                      className="text-xs text-gray-500 truncate"
                      title={clientHost}
                    >
                      {clientHost}
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
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Connected By",
            type: FieldType.Element,
            contentClassName: CONNECTED_BY_CELL_WIDTH_CLASS_NAME,
            getElement: (item: McpOAuthGrant): ReactElement => {
              if (!item.user) {
                return <p>-</p>;
              }

              const user: User = item.user as User;

              return (
                <div
                  title={[user.name?.toString(), user.email?.toString()]
                    .filter(Boolean)
                    .join(" - ")}
                >
                  {/* The name truncates like the email under it already does. */}
                  <UserElement user={user} usernameClassName="block truncate" />
                </div>
              );
            },
          },
          {
            field: {
              scope: true,
            },
            title: "Access",
            type: FieldType.Element,
            getElement: (item: McpOAuthGrant): ReactElement => {
              return <p>{getMcpAccessLabel(item.scope)}</p>;
            },
          },
          {
            /*
             * One column for both dates. Side by side, each a full timestamp,
             * they pushed the row's Disconnect button off the edge of the
             * table at ordinary widths. "Is this still in use" is the
             * question the column is read for, so that leads, as "3 hours
             * ago" (the exact time is the tooltip), and the day the client
             * was connected sits under it.
             */
            field: {
              lastUsedAt: true,
            },
            title: "Last Used",
            type: FieldType.Element,
            getElement: (item: McpOAuthGrant): ReactElement => {
              return (
                <div className="flex flex-col">
                  <span
                    className="text-sm text-gray-900"
                    title={
                      item.lastUsedAt
                        ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                            item.lastUsedAt,
                          )
                        : undefined
                    }
                  >
                    {item.lastUsedAt
                      ? OneUptimeDate.fromNow(item.lastUsedAt)
                      : translator.translateText("Never")}
                  </span>
                  {item.activatedAt ? (
                    <span className="text-xs text-gray-500">
                      {translator.translateTemplate("Connected {{date}}", {
                        date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          item.activatedAt,
                          true,
                        ),
                      })}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      {/*
       * Plain words, one line each where they fit: "full create/read/
       * update/delete tools", "annotated so MCP clients can auto-approve
       * them" and "in a single tool call" were the protocol's words, not
       * the reader's.
       */}
      <Card title="What agents can do">
        <div className="space-y-4 text-sm text-gray-600">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              {translator.translateText(
                "Incident response: acknowledge and resolve incidents and alerts, add notes and post status page updates.",
              )}
            </li>
            <li>
              {translator.translateText(
                "Investigation: search logs, metrics, traces, exceptions and monitor results over a time range.",
              )}
            </li>
            <li>
              {translator.translateText(
                "Management: create, change and delete incidents, alerts, monitors, status pages, on-call policies, teams, labels and more.",
              )}
            </li>
            <li>
              {translator.translateText(
                "Safety: clients may run read-only tools without asking, and ask before anything that deletes. A client connected by sign-in can be limited to read only.",
              )}
            </li>
          </ul>
          <p>
            <TranslatedSentence
              template="See the {{docsLink}} for every tool."
              slots={{
                docsLink: (
                  <Link
                    to={Route.fromString("/docs/ai/mcp-server")}
                    openInNewTab={true}
                    className="underline"
                  >
                    {translator.translateText("MCP server documentation")}
                  </Link>
                ),
              }}
            />
          </p>
          {/*
           * The other way round, one line: this page lets agents use
           * OneUptime's tools, and External MCP Servers lets OneUptime AI use
           * other servers' - a person looking for one finds the other here.
           */}
          <p data-testid="mcp-server-external-servers">
            <TranslatedSentence
              template="To let OneUptime AI use the tools of other MCP servers, such as AWS's or GitHub's, add them in {{externalServersLink}}."
              slots={{
                externalServersLink: (
                  <Link
                    to={externalMcpServersRoute}
                    className="underline"
                    dataTestId="mcp-server-external-servers-link"
                  >
                    {translator.translateText("External MCP Servers")}
                  </Link>
                ),
              }}
            />
          </p>
        </div>
      </Card>
    </div>
  );
};

export default McpServerPage;
