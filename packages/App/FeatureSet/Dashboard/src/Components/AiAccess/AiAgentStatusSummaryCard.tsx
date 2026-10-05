import {
  AI_ACCESS_FIXES_ROW_TITLE,
  AI_ACCESS_INVESTIGATION_ROW_TITLE,
  AiAccessBadge,
} from "./AiAccessModes";
import { AiAccessRow, AiAccessRows } from "./AiAccessRow";
import {
  AI_AGENT_CONNECTION_ROW_TITLE,
  AI_AGENT_STATUS_SUMMARY_ATTENTION_LABEL,
  AI_AGENT_STATUS_SUMMARY_OPEN_TEXT,
  AI_AGENT_STATUS_SUMMARY_TITLE,
  AI_AGENT_STATUS_UNAVAILABLE_TEXT,
  AI_AGENT_VERSION_DETAIL,
  AiAgentStatusSummary,
} from "./AiAgentStatusSummary";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The "AI agent" card at the bottom of a resource's Overview: three rows —
 * Connection, Investigation and Fixes — drawn like the "What AI may do"
 * rows of the AI agent page (AiAccessRow), a "Needs attention" line when
 * OneUptime AI cannot do its job there, and a link to the AI agent page,
 * where all of it is changed.
 *
 * Read-only on purpose: who may change what is the AI agent page's
 * business, so whoever can see the Overview sees the same card, and
 * nothing here needs a permission the status route does not. What it says
 * comes from an AiAgentStatusSummary (a cluster's or a resource's); null
 * means the status could not be read.
 */

export const AI_AGENT_STATUS_SUMMARY_TEST_ID: string =
  "ai-agent-status-summary";

export interface ComponentProps {
  // The AI agent page's subtitle, for this resource.
  description: string;
  // The resource's AI → AI agent page.
  agentPageRoute: Route;
  summary: AiAgentStatusSummary | null;
  isLoading: boolean;
  /*
   * The agent's version, drawn by the caller with the shared AgentVersion
   * (which knows the kind of agent), for the place the summary keeps for it
   * in the Connection row's details. Undefined: no version to show.
   */
  versionElement?: ReactElement | undefined;
}

const AiAgentStatusSummaryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const translateBadge: (badge: AiAccessBadge) => AiAccessBadge = (
    badge: AiAccessBadge,
  ): AiAccessBadge => {
    return {
      text: translator.translateText(badge.text) || badge.text,
      tone: badge.tone,
    };
  };

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  // The details line's parts, the version drawn where the summary keeps it.
  const renderConnectionDetails: (
    details: Array<string>,
  ) => Array<ReactElement> = (details: Array<string>): Array<ReactElement> => {
    return details.flatMap((part: string): Array<ReactElement> => {
      if (part !== AI_AGENT_VERSION_DETAIL) {
        return [<span key={`detail-${part}`}>{part}</span>];
      }

      return props.versionElement
        ? [
            <span
              key="agent-version"
              data-testid={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-agent-version`}
            >
              <TranslatedSentence
                template="agent {{version}}"
                slots={{ version: props.versionElement }}
              />
            </span>,
          ]
        : [];
    });
  };

  const openLink: ReactElement = (
    <span
      key="open-ai-agent"
      className="inline-flex"
      data-testid={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-open`}
    >
      <Link
        to={props.agentPageRoute}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <Icon
          icon={IconProp.Automation}
          className="h-4 w-4 flex-shrink-0 text-gray-500"
        />
        <span>{translate(AI_AGENT_STATUS_SUMMARY_OPEN_TEXT)}</span>
      </Link>
    </span>
  );

  const renderBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      return <ComponentLoader />;
    }

    const summary: AiAgentStatusSummary | null = props.summary;

    if (!summary) {
      return (
        <p
          className="text-sm text-gray-500"
          data-testid={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`}
        >
          {translate(AI_AGENT_STATUS_UNAVAILABLE_TEXT)}
        </p>
      );
    }

    const connectionDetails: Array<ReactElement> = renderConnectionDetails(
      summary.connectionDetails,
    );

    return (
      <div className="space-y-5">
        {summary.attention ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3"
            data-testid={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention`}
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-gray-900">
                {translate(AI_AGENT_STATUS_SUMMARY_ATTENTION_LABEL)}
              </p>
              <p
                className="mt-0.5 text-gray-700"
                data-testid={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention-title`}
              >
                {translate(summary.attention)}
              </p>
            </div>
          </div>
        ) : (
          <></>
        )}

        <AiAccessRows>
          <AiAccessRow
            icon={IconProp.Automation}
            title={translate(AI_AGENT_CONNECTION_ROW_TITLE)}
            badge={translateBadge(summary.connection)}
            sentence={translate(summary.connectionSentence)}
            dataTestId={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection`}
          >
            {connectionDetails.length > 0 ? (
              <div
                className="text-xs text-gray-500"
                data-testid={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`}
              >
                {connectionDetails.map(
                  (part: ReactElement, index: number): ReactElement => {
                    return (
                      <Fragment key={`connection-detail-${index}`}>
                        {index > 0 ? " · " : ""}
                        {part}
                      </Fragment>
                    );
                  },
                )}
              </div>
            ) : null}
          </AiAccessRow>
          <AiAccessRow
            icon={IconProp.MagnifyingGlass}
            title={translate(AI_ACCESS_INVESTIGATION_ROW_TITLE)}
            badge={translateBadge(summary.investigation)}
            sentence={translate(summary.investigationSentence)}
            dataTestId={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-investigation`}
          />
          <AiAccessRow
            icon={IconProp.WrenchScrewdriver}
            title={translate(AI_ACCESS_FIXES_ROW_TITLE)}
            badge={translateBadge(summary.fixes)}
            sentence={translate(summary.fixesSentence)}
            dataTestId={`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes`}
          />
        </AiAccessRows>
      </div>
    );
  };

  return (
    <div data-testid={AI_AGENT_STATUS_SUMMARY_TEST_ID}>
      <Card
        title={AI_AGENT_STATUS_SUMMARY_TITLE}
        description={props.description}
        buttons={[openLink]}
      >
        {renderBody()}
      </Card>
    </div>
  );
};

export default AiAgentStatusSummaryCard;
