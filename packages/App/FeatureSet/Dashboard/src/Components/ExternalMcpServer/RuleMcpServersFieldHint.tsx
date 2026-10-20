import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  EXTERNAL_MCP_SERVERS_PAGE_COPY,
  RULE_MCP_SERVERS_FIELD_COPY,
} from "./ExternalMcpServerCopy";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Under a rule's "MCP Servers" field (investigation rules and auto
 * remediation rules, both under More fields): where the servers it lists
 * are added, as a link - so a project with none yet finds the page.
 */
const RuleMcpServersFieldHint: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      className="mt-1.5 text-xs text-gray-500"
      data-testid="rule-mcp-servers-hint"
    >
      <TranslatedSentence
        template={RULE_MCP_SERVERS_FIELD_COPY.manageHint}
        slots={{
          externalMcpServersLink: (
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS] as Route,
              )}
              className="underline"
              dataTestId="rule-mcp-servers-link"
            >
              {translator.translateText(EXTERNAL_MCP_SERVERS_PAGE_COPY.title)}
            </Link>
          ),
        }}
      />
    </p>
  );
};

export default RuleMcpServersFieldHint;
