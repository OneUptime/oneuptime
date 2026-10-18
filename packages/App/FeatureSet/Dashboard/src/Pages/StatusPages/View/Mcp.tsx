import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Link from "Common/UI/Components/Link/Link";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

// The data-testid of the MCP Server switch.
export const STATUS_PAGE_MCP_SERVER_SWITCH_TEST_ID: string =
  "status-page-mcp-server-switch";

/*
 * Where the public status page tools are listed, with what the switch turns
 * off: the page used to repeat it in four cards of its own.
 */
export const STATUS_PAGE_MCP_DOCS_PATH: string = "/docs/ai/mcp-server";

const StatusPageMcp: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const mcpUrl: string = `${HTTP_PROTOCOL}${HOST}/mcp`;
  const statusPageId: string = modelId.toString();

  // Security -> Access: who can see the page.
  const accessRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS] as Route,
    { modelId },
  );

  return (
    <Fragment>
      {/* One switch that saves when it is flipped. On by default. */}
      <ModelSwitchCard<StatusPage>
        modelType={StatusPage}
        modelId={modelId}
        column="enableMcpServer"
        cardTitle={translationKey("MCP Server")}
        cardDescription={translationKey(
          "Lets AI assistants such as Claude read this page's status, incidents and announcements.",
        )}
        title="Enable MCP Server"
        getDescription={(): string => {
          return translationKey(
            "AI agents can read this status page over the public OneUptime MCP server.",
          );
        }}
        dataTestId={STATUS_PAGE_MCP_SERVER_SWITCH_TEST_ID}
      />

      {/*
       * What a client needs: the one address every status page is read at,
       * and this page's ID. The tools, and what the switch turns off, are
       * in the MCP Server docs; the page's own visibility is Access's.
       */}
      <Card title="Connect an AI Assistant">
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            {translator.translateText(
              "Add this server to your AI assistant. It needs no API key.",
            )}
          </p>
          <CodeBlock language="text" code={mcpUrl} />
          <p>
            {translator.translateText(
              "The assistant names this page by its ID, or by one of its custom domains:",
            )}
          </p>
          <CodeBlock language="text" code={statusPageId} />
          <p>
            <TranslatedSentence
              template="Turning the server off does not hide the page itself: who can see it is set on {{accessLink}}. The tools are listed in the {{docsLink}}."
              slots={{
                accessLink: (
                  <Link to={accessRoute} className="underline">
                    {translator.translateText("Access")}
                  </Link>
                ),
                docsLink: (
                  <Link
                    to={Route.fromString(STATUS_PAGE_MCP_DOCS_PATH)}
                    openInNewTab={true}
                    className="underline"
                  >
                    {translator.translateText("MCP Server docs")}
                  </Link>
                ),
              }}
            />
          </p>
        </div>
      </Card>

      <Card title="Connect Claude Desktop">
        {/*
         * The card's body, not its description: a description is hidden on
         * a phone, and is a <p> that cannot hold these blocks.
         */}
        <div className="space-y-2 text-sm text-gray-600">
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
      </Card>

      <Card title="Connect Claude Code">
        {/*
         * The card's body, not its description: a description is hidden on
         * a phone, and is a <p> that cannot hold these blocks.
         */}
        <div className="space-y-2 text-sm text-gray-600">
          <CodeBlock
            language="bash"
            code={`claude mcp add --transport http oneuptime ${mcpUrl}`}
          />
        </div>
      </Card>

      <Card title="Connect VS Code or Cursor">
        {/*
         * The card's body, not its description: a description is hidden on
         * a phone, and is a <p> that cannot hold these blocks.
         */}
        <div className="space-y-2 text-sm text-gray-600">
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
      </Card>
    </Fragment>
  );
};

export default StatusPageMcp;
