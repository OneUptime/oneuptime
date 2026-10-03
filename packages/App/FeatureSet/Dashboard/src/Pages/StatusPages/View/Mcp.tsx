import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Link from "Common/UI/Components/Link/Link";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

const StatusPageMcp: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const mcpUrl: string = `${HTTP_PROTOCOL}${HOST}/mcp`;
  const statusPageId: string = modelId.toString();

  const domainsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
    { modelId },
  );

  const authenticationSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS] as Route,
    { modelId },
  );

  return (
    <Fragment>
      <CardModelDetail<StatusPage>
        name="Status Page > MCP Server"
        cardProps={{
          title: "MCP Server",
          description:
            "Control whether AI agents can read this status page over the OneUptime MCP server",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              enableMcpServer: true,
            },
            title: "Enable MCP Server",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When enabled, AI agents can read this status page over the public OneUptime MCP server. Turning this off does not hide the status page website, its RSS feed, or its public JSON API.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-mcp-server",
          fields: [
            {
              field: {
                enableMcpServer: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable MCP Server",
              description:
                "When enabled, AI agents can read this status page over the public OneUptime MCP server. Turning this off does not hide the status page website, its RSS feed, or its public JSON API.",
            },
          ],
          modelId: modelId,
        }}
      />

      <Card
        title="How this status page is read over MCP"
        description={
          <div className="space-y-4 w-full mt-3">
            <p>
              {translator.translateText(
                "The Model Context Protocol (MCP) lets AI agents like Claude, Cursor, and GitHub Copilot read this status page as structured data instead of scraping the website. Once the toggle above is on, anyone can point an MCP client at the server below and ask about this page's current status, incidents, scheduled maintenance, and announcements.",
              )}
            </p>
            <p>
              <TranslatedSentence
                template="These status page tools are read-only and need {{noApiKey}} — the data they return is the same data your status page already publishes publicly. Connect any MCP client to:"
                slots={{
                  noApiKey: (
                    <strong>{translator.translateText("no API key")}</strong>
                  ),
                }}
              />
            </p>
            <CodeBlock language="text" code={mcpUrl} />
            <p>
              <TranslatedSentence
                template="This one endpoint serves every status page, so it is the URL to connect to no matter which page you want. Agents pick out this page by passing a {{argument}} argument on each tool call. Use this page's ID:"
                slots={{ argument: <code>statusPageIdOrDomain</code> }}
              />
            </p>
            <CodeBlock language="text" code={statusPageId} />
            <p>
              <TranslatedSentence
                template="If you have set up a {{customDomainLink}} for this status page, you can pass that as the argument value instead of the ID — for example {{exampleDomain}}. A domain is easier for an agent to remember than a UUID. Note that this only changes the argument: MCP clients still connect to the endpoint above, not to {{domainEndpoint}}."
                slots={{
                  customDomainLink: (
                    <Link to={domainsRoute} className="underline">
                      {translator.translateText("custom domain")}
                    </Link>
                  ),
                  exampleDomain: <code>status.company.com</code>,
                  domainEndpoint: <code>your-domain/mcp</code>,
                }}
              />
            </p>
          </div>
        }
      />

      <Card
        title="Connect Claude Desktop"
        description={
          <div className="space-y-2 w-full mt-3">
            <p>
              <TranslatedSentence
                template="Add this to {{file}}:"
                slots={{ file: <code>claude_desktop_config.json</code> }}
              />
            </p>
            <CodeBlock
              language="json"
              code={`{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "${mcpUrl}"
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
              code={`claude mcp add --transport http oneuptime ${mcpUrl}`}
            />
          </div>
        }
      />

      <Card
        title="Connect VS Code or Cursor"
        description={
          <div className="space-y-2 w-full mt-3">
            <p>
              <TranslatedSentence
                template="Add this to {{file}} (VS Code) or your MCP configuration (Cursor):"
                slots={{ file: <code>.vscode/mcp.json</code> }}
              />
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
          </div>
        }
      />

      <Card
        title="Try it"
        description={
          <div className="space-y-4 w-full mt-3">
            <p>
              {translator.translateText(
                "Once the server is connected, ask your agent questions in plain language. It will pick the right tool and fill in this status page's identifier for you:",
              )}
            </p>
            <CodeBlock
              language="text"
              code={`Is ${statusPageId} reporting any outages right now?

Summarize the open incidents on status page ${statusPageId}.

Is there any maintenance scheduled on ${statusPageId} this week?`}
            />
            <p>
              <TranslatedSentence
                template="Agents can also call the tools directly. Every tool takes {{argument}}, and the three list tools accept an optional ID to fetch a single record:"
                slots={{ argument: <code>statusPageIdOrDomain</code> }}
              />
            </p>
            <CodeBlock
              language="json"
              code={`{
  "tool": "get_public_status_page_overview",
  "arguments": {
    "statusPageIdOrDomain": "${statusPageId}"
  }
}`}
            />
          </div>
        }
      />

      <Card
        title="Available tools"
        description={
          <div className="space-y-4 w-full mt-3">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <TranslatedSentence
                  template="{{tool}} — the whole page in one call: name and branding, every resource and its current status, active incidents, upcoming maintenance, announcements, and monitor status history."
                  slots={{ tool: <code>get_public_status_page_overview</code> }}
                />
              </li>
              <li>
                <TranslatedSentence
                  template="{{tool}} — active and recent incidents with severity, timeline, state changes, and public notes. Pass {{idArgument}} for one incident."
                  slots={{
                    tool: <code>get_public_status_page_incidents</code>,
                    idArgument: <code>incidentId</code>,
                  }}
                />
              </li>
              <li>
                <TranslatedSentence
                  template="{{tool}} — upcoming and ongoing maintenance with scheduled times, timeline, and public notes. Pass {{idArgument}} for one event."
                  slots={{
                    tool: (
                      <code>get_public_status_page_scheduled_maintenance</code>
                    ),
                    idArgument: <code>scheduledMaintenanceId</code>,
                  }}
                />
              </li>
              <li>
                <TranslatedSentence
                  template="{{tool}} — active announcements with titles, descriptions, and dates. Pass {{idArgument}} for one announcement."
                  slots={{
                    tool: <code>get_public_status_page_announcements</code>,
                    idArgument: <code>announcementId</code>,
                  }}
                />
              </li>
            </ul>
            <p>
              {translator.translateText(
                "All four are marked read-only, so MCP clients can auto-approve them without prompting on every call. They expose only what this status page already shows publicly — they cannot change anything, and they never reach private resources or other status pages.",
              )}
            </p>
          </div>
        }
      />

      <Card
        title="When the toggle is off"
        description={
          <div className="space-y-4 w-full mt-3">
            <p>
              <TranslatedSentence
                template="MCP access is on by default. Turning off {{toggle}} gates all four tools for this status page at once, and agents get back {{message}} — deliberately the same message they would get for a status page that does not exist, so no one can use MCP to discover that this page is here."
                slots={{
                  toggle: (
                    <strong>
                      {translator.translateText("Enable MCP Server")}
                    </strong>
                  ),
                  message: (
                    <code>
                      Status page &apos;{statusPageId}&apos; is not available
                      over MCP.
                    </code>
                  ),
                }}
              />
            </p>
            <p>
              <TranslatedSentence
                template="This only affects the four unauthenticated tools above. Your status page website, its RSS feed, and its public JSON API keep working exactly as before, so turning this off does not make a public status page private. To restrict who can see the page itself, use {{authenticationSettingsLink}} instead."
                slots={{
                  authenticationSettingsLink: (
                    <Link
                      to={authenticationSettingsRoute}
                      className="underline"
                    >
                      {translator.translateText("Authentication Settings")}
                    </Link>
                  ),
                }}
              />
            </p>
            <p>
              {translator.translateText(
                "Your own team is unaffected either way: the toggle does not apply to the API-key-authenticated status page tools, so project members with an API key can still read and manage this status page over MCP with it switched off.",
              )}
            </p>
          </div>
        }
      />
    </Fragment>
  );
};

export default StatusPageMcp;
