import PageComponentProps from "../PageComponentProps";
import UserElement from "../../Components/User/User";
import {
  getMcpAccessLabel,
  getMcpClientHost,
} from "../../Utils/McpClientAuthorization";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
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
  const host: string = `${HTTP_PROTOCOL}${HOST}`;
  const mcpUrl: string = `${host}/mcp`;

  const apiKeysRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
  );

  return (
    <div>
      <Card
        title="MCP Server"
        description={
          <div className="space-y-4 w-full mt-3">
            <p>
              OneUptime ships a built-in Model Context Protocol (MCP) server, so
              AI agents like Claude, Cursor, and GitHub Copilot can operate
              OneUptime directly: investigate and resolve incidents and alerts,
              query logs, metrics, traces and exceptions, manage monitors and
              status pages, and post public status updates.
            </p>
            <p>
              The server speaks streamable HTTP and is stateless, so it works
              behind load balancers with no session setup. Connect any MCP
              client to:
            </p>
            <CodeBlock language="text" code={mcpUrl} />
          </div>
        }
      />

      <Card
        title="Authentication"
        description={
          <div className="space-y-4 w-full mt-3">
            <p>There are two ways for an MCP client to authenticate.</p>
            <p>
              <strong>Sign in with OneUptime.</strong> Add the server URL to
              your MCP client with no credentials. The first time it needs your
              data, the client opens a OneUptime page where you sign in, choose
              this project and decide whether the client may only read or may
              also make changes. The client then acts as you, with your
              permissions in this project and never more, and nothing has to be
              copied into a configuration file. Clients connected this way are
              listed below, where you can disconnect them.
            </p>
            <p>
              <strong>API key.</strong> For an agent that runs unattended, send
              a OneUptime API key in the <code>x-api-key</code> header (or{" "}
              <code>Authorization: Bearer</code>). The key determines which
              project the agent operates on and what it may do. Create a scoped
              API key with least-privilege permissions in{" "}
              <Link to={apiKeysRoute} className="underline">
                Project Settings &rarr; API Keys
              </Link>
              . Never give an AI agent a master API key — it would grant
              instance-wide admin access across all projects.
            </p>
            <p>
              Either way, project IDs are inferred automatically, so agents
              never need to know them.
            </p>
          </div>
        }
      />

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
            description: `Disconnect ${item.name ? `"${item.name}"` : "this MCP client"}? It is signed out immediately and has to be connected again before it can work with this project. Nothing it created is deleted.`,
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
                      : "Never"}
                  </span>
                  {item.activatedAt ? (
                    <span className="text-xs text-gray-500">
                      Connected{" "}
                      {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        item.activatedAt,
                        true,
                      )}
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

      <Card
        title="Connect Claude Code"
        description={
          <div className="space-y-2 w-full mt-3">
            <p>
              Add the server, then run <code>/mcp</code> inside Claude Code and
              choose OneUptime to sign in:
            </p>
            <CodeBlock
              language="bash"
              code={`claude mcp add --transport http oneuptime ${mcpUrl}`}
            />
            <p>Or connect with an API key instead of signing in:</p>
            <CodeBlock
              language="bash"
              code={`claude mcp add --transport http oneuptime ${mcpUrl} --header "x-api-key: your-api-key-here"`}
            />
          </div>
        }
      />

      <Card
        title="Connect Claude Desktop"
        description={
          <div className="space-y-2 w-full mt-3">
            <p>
              In Claude, open <strong>Customize &rarr; Connectors</strong>,
              choose <strong>Add custom connector</strong> and enter the server
              URL above. Claude asks you to sign in to OneUptime the first time
              it needs your data.
            </p>
            <p>
              To use an API key instead, add this to{" "}
              <code>claude_desktop_config.json</code>:
            </p>
            <CodeBlock
              language="json"
              code={`{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}`}
            />
          </div>
        }
      />

      <Card
        title="Connect VS Code or Cursor"
        description={
          <div className="space-y-2 w-full mt-3">
            <p>
              Add this to <code>.vscode/mcp.json</code> (VS Code) or your MCP
              configuration (Cursor). The editor opens OneUptime for you to sign
              in:
            </p>
            <CodeBlock
              language="json"
              code={`{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}
            />
            <p>
              To use an API key instead, add{" "}
              <code>
                &quot;headers&quot;: {"{"} &quot;x-api-key&quot;:
                &quot;your-api-key-here&quot; {"}"}
              </code>{" "}
              beside the URL.
            </p>
          </div>
        }
      />

      <Card
        title="What agents can do"
        description={
          <div className="space-y-4 w-full mt-3">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Incident response: acknowledge and resolve incidents and alerts,
                add internal notes, and post public status-page updates in a
                single tool call.
              </li>
              <li>
                Investigation: query logs, metrics, traces, exceptions, and
                monitor probe results with time-range filters.
              </li>
              <li>
                Management: full create/read/update/delete tools for incidents,
                alerts, monitors, status pages, on-call policies, scheduled
                maintenance, teams, labels, and more.
              </li>
              <li>
                Safety: read-only tools are annotated so MCP clients can
                auto-approve them, while destructive tools (like deletes)
                require explicit confirmation. A client connected by sign-in can
                also be limited to read-only access when it is authorized.
              </li>
            </ul>
            <p>
              See the{" "}
              <Link
                to={Route.fromString("/docs/ai/mcp-server")}
                openInNewTab={true}
                className="underline"
              >
                MCP server documentation
              </Link>{" "}
              for the full tool catalog and query syntax.
            </p>
          </div>
        }
      />
    </div>
  );
};

export default McpServerPage;
