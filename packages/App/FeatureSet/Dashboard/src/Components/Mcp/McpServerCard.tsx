import {
  MCP_CLIENTS,
  MCP_CLIENT_CONFIG_FILES,
  MCP_CLIENT_NAMES,
  MCP_SIGN_IN_ANSWERS,
  MCP_SIGN_IN_COPY,
  MCP_SIGN_IN_TITLE,
  McpClient,
  McpConnectSetupStep,
  McpSignIn,
  getMcpConnectSetup,
} from "./McpConnectSetup";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Link from "Common/UI/Components/Link/Link";
import Radio, {
  RadioOption,
  RadioValue,
} from "Common/UI/Components/Radio/Radio";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useState,
} from "react";

export interface ComponentProps {
  // This instance's own /mcp address.
  mcpUrl: string;
  // Project Settings > Advanced > API Keys, for the API key's note.
  apiKeysRoute: Route;
}

export const MCP_SERVER_CARD_DESCRIPTION: string = translationKey(
  "Connect AI agents such as Claude, Cursor and GitHub Copilot to work in this project.",
);

export const MCP_SIGNED_IN_NOTE: string = translationKey(
  "Clients connected this way are listed under Connected MCP Clients, where you can disconnect them.",
);

export const MCP_API_KEY_NOTE: string = translationKey(
  "Create a key in {{apiKeysLink}} with the least access the agent needs. Never give an agent a master API key: it grants admin access to the whole instance.",
);

/*
 * Project Settings > AI > MCP Server: the server's address and how to
 * connect a client to it, in one card. How the client signs in is asked
 * first (McpConnectSetup), then a tab per client shows its setup for that
 * way only.
 *
 * What it says is the card's body, not its description: Card draws a
 * description inside a <p> that phones never show, which hid the address
 * and every setup from a phone, and nested the page's paragraphs and code
 * blocks inside that <p>.
 */
const McpServerCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [signIn, setSignIn] = useState<McpSignIn>(McpSignIn.OneUptime);
  const signInLabelId: string = useId();

  /*
   * What an instruction's {{slots}} draw. A sentence is given only the
   * slots it has: TranslatedSentence falls back to plain text when a slot
   * it was given is not in the sentence.
   */
  const getSlots: (
    setup: McpConnectSetupStep,
    client: McpClient,
  ) => Record<string, ReactNode> = (
    setup: McpConnectSetupStep,
    client: McpClient,
  ): Record<string, ReactNode> => {
    const slots: Record<string, ReactNode> = {
      command: <code>/mcp</code>,
      file: <code>{MCP_CLIENT_CONFIG_FILES[client]}</code>,
      connectorsMenu: (
        <strong>{translator.translateText("Customize → Connectors")}</strong>
      ),
      addConnector: (
        <strong>{translator.translateText("Add custom connector")}</strong>
      ),
    };

    return Object.fromEntries(
      Object.entries(slots).filter(([name]: [string, ReactNode]) => {
        return setup.instruction.includes(`{{${name}}}`);
      }),
    );
  };

  const tabs: Array<Tab> = MCP_CLIENTS.map((client: McpClient): Tab => {
    const setup: McpConnectSetupStep = getMcpConnectSetup({
      client: client,
      signIn: signIn,
      mcpUrl: props.mcpUrl,
    });

    return {
      name: MCP_CLIENT_NAMES[client],
      // A product's name: Japanese has "Cursor" as a text cursor's word.
      isName: true,
      children: (
        <div className="space-y-2" data-testid={`mcp-setup-${client}`}>
          <p className="text-sm text-gray-600">
            <TranslatedSentence
              template={setup.instruction}
              slots={getSlots(setup, client)}
            />
          </p>
          {/*
           * A command is one line, read whole and copied: it wraps rather
           * than running under the copy button on a phone. A file's JSON
           * reads best as written.
           */}
          {setup.code ? (
            <CodeBlock
              language={setup.code.language}
              code={setup.code.text}
              wrapLongLines={setup.code.language === "bash"}
            />
          ) : (
            <></>
          )}
        </div>
      ),
    };
  });

  return (
    <Card title="MCP Server" description={MCP_SERVER_CARD_DESCRIPTION}>
      <div className="space-y-6" data-testid="mcp-server-connect">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-900">
            {translator.translateText("Server URL")}
          </h3>
          <CodeBlock language="text" code={props.mcpUrl} wrapLongLines={true} />
        </div>

        <div>
          <h3 id={signInLabelId} className="text-sm font-medium text-gray-900">
            {translator.translateText(MCP_SIGN_IN_TITLE)}
          </h3>
          <Radio
            className=""
            ariaLabelledby={signInLabelId}
            dataTestId="mcp-sign-in"
            value={signIn}
            options={MCP_SIGN_IN_ANSWERS.map(
              (answer: McpSignIn): RadioOption => {
                const copy: { title: string; description: string } =
                  MCP_SIGN_IN_COPY[answer];

                return {
                  value: answer,
                  label: translator.translateText(copy.title) || copy.title,
                  description:
                    translator.translateText(copy.description) ||
                    copy.description,
                };
              },
            )}
            onChange={(value: RadioValue | null) => {
              if (value === McpSignIn.OneUptime || value === McpSignIn.ApiKey) {
                setSignIn(value);
              }
            }}
          />
          <p
            className="mt-3 text-sm text-gray-500"
            data-testid="mcp-sign-in-note"
          >
            {signIn === McpSignIn.ApiKey ? (
              <TranslatedSentence
                template={MCP_API_KEY_NOTE}
                slots={{
                  apiKeysLink: (
                    <Link to={props.apiKeysRoute} className="underline">
                      {translator.translateText(
                        "Project Settings → Advanced → API Keys",
                      )}
                    </Link>
                  ),
                }}
              />
            ) : (
              translator.translateText(MCP_SIGNED_IN_NOTE)
            )}
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900">
            {translator.translateText("Your client")}
          </h3>
          {/*
           * Four clients do not fit one line on a phone: the row wraps, so
           * Cursor is never scrolled out of sight.
           */}
          <Tabs
            tabs={tabs}
            wrap={true}
            onTabChange={() => {
              // Each tab draws its own setup; nothing else follows the tab.
            }}
          />
        </div>
      </div>
    </Card>
  );
};

export default McpServerCard;
