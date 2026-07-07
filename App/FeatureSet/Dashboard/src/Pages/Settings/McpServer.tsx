import PageComponentProps from "../PageComponentProps";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Link from "Common/UI/Components/Link/Link";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

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
            <p>
              Every request is authenticated with a OneUptime API key sent via
              the <code>x-api-key</code> header (or{" "}
              <code>Authorization: Bearer</code>). The key determines which
              project the agent operates on — project IDs are inferred
              automatically, so agents never need to know them.
            </p>
            <p>
              Create a scoped API key with least-privilege permissions in{" "}
              <Link to={apiKeysRoute} className="underline">
                Project Settings &rarr; API Keys
              </Link>
              . Never give an AI agent a master API key — it would grant
              instance-wide admin access across all projects.
            </p>
          </div>
        }
      />

      <Card
        title="Connect Claude Desktop"
        description={
          <div className="space-y-2 w-full mt-3">
            <p>
              Add this to <code>claude_desktop_config.json</code>:
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
        title="Connect Claude Code"
        description={
          <div className="space-y-2 w-full mt-3">
            <CodeBlock
              language="bash"
              code={`claude mcp add --transport http oneuptime ${mcpUrl} --header "x-api-key: your-api-key-here"`}
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
              configuration (Cursor):
            </p>
            <CodeBlock
              language="json"
              code={`{
  "servers": {
    "oneuptime": {
      "type": "http",
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
                require explicit confirmation.
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
