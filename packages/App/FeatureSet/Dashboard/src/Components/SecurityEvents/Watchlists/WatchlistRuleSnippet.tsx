import {
  OPEN_DETECTION_RULES,
  USE_IN_RULE_DESCRIPTION,
  USE_IN_RULE_TITLE,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { getSecurityWatchlistRuleSnippet } from "Common/Types/SecurityEvent/SecurityWatchlist";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  name: string;
  entityType: unknown;
}

/*
 * USE IT IN A RULE: the selection that reads this list, to copy into a
 * detection or correlation rule - matched against the field a list of its
 * kind is usually matched against (getSecurityWatchlistRuleSnippet) - and
 * the way to Detection Rules, where it goes. The rules that read the list
 * already are named in About This List, with its other facts.
 */
const WatchlistRuleSnippet: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const detectionRules: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_DETECTION_RULES] as Route,
  );

  return (
    <Card title={USE_IN_RULE_TITLE} description={USE_IN_RULE_DESCRIPTION}>
      <div className="space-y-3">
        <div data-testid={WATCHLISTS_TEST_IDS.ruleSnippet} dir="ltr">
          <CodeBlock
            code={getSecurityWatchlistRuleSnippet({
              name: props.name,
              entityType: props.entityType,
            })}
            language="yaml"
            showCopyButton={true}
          />
        </div>

        <p className="text-sm">
          <Link
            to={detectionRules}
            className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {translator.translateText(OPEN_DETECTION_RULES)}
          </Link>
        </p>
      </div>
    </Card>
  );
};

export default WatchlistRuleSnippet;
