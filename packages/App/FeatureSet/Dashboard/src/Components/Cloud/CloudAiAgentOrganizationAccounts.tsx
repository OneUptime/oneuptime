import {
  CLOUD_AI_AGENT_ORGANIZATION_ALL_CONNECTED,
  CLOUD_AI_AGENT_ORGANIZATION_CONNECTED_COUNT,
  CLOUD_AI_AGENT_ORGANIZATION_LIST_SCROLLS_FROM,
  CLOUD_AI_AGENT_ORGANIZATION_MANAGEMENT_LABEL,
  CLOUD_AI_AGENT_ORGANIZATION_STATE_WORDS,
  CLOUD_AI_AGENT_ORGANIZATION_THIS_ACCOUNT_LABEL,
  CLOUD_AI_AGENT_ORGANIZATION_TRUNCATED,
  isEveryCloudOrganizationAgentConnected,
} from "./CloudAiAgentOrganization";
import {
  CloudOrganizationAccountView,
  CloudOrganizationAgentState,
  CloudOrganizationView,
  countConnectedAccounts,
} from "Common/Types/CloudConnection/CloudOrganizationAgents";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Which accounts of an AWS Organization have a Cloud AI agent connected:
 * the "Wait for them to connect" step of Let AI fix problems, read again
 * every few seconds while the dialog is open. A line says how many are
 * connected, then each account the reader may see - its name, its AWS
 * account id, and its agent: Connected, Offline (it connected once and has
 * been silent since) or Waiting (none yet). The management account is
 * first and marked, and so is the account the dialog was opened on. A
 * short list shows whole - the dialog scrolls, and a frame that scrolls
 * inside it cut a phone's last row in half - and a long one scrolls inside
 * its frame.
 */

export const CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID: string =
  "cloud-ai-agent-organization-accounts";

export interface ComponentProps {
  view: CloudOrganizationView;
  // OneUptime's id of the account the dialog was opened on: marked This account.
  currentCloudAccountId?: string | undefined;
}

// Each state's pill: its colours, and its dot.
const STATE_CLASS_NAMES: Readonly<Record<CloudOrganizationAgentState, string>> =
  {
    connected: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    offline: "bg-amber-50 text-amber-800 ring-amber-600/20",
    none: "bg-gray-50 text-gray-600 ring-gray-500/20",
  };

const DOT_CLASS_NAMES: Readonly<Record<CloudOrganizationAgentState, string>> = {
  connected: "bg-emerald-500",
  offline: "bg-amber-500",
  none: "bg-gray-400",
};

const CloudAiAgentOrganizationAccounts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const total: number = props.view.accounts.length;
  const connected: number = countConnectedAccounts(props.view);
  const isEveryoneConnected: boolean = isEveryCloudOrganizationAgentConnected(
    props.view,
  );
  const isLong: boolean =
    total > CLOUD_AI_AGENT_ORGANIZATION_LIST_SCROLLS_FROM;
  const current: string = (props.currentCloudAccountId || "").toLowerCase();

  return (
    <div
      className="space-y-3"
      data-testid={CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}
    >
      <div
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
          isEveryoneConnected
            ? "border-emerald-200 bg-emerald-50"
            : "border-gray-200 bg-gray-50"
        }`}
        role="status"
        aria-live="polite"
        data-testid={`${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}-summary`}
        data-state={isEveryoneConnected ? "connected" : "waiting"}
      >
        {isEveryoneConnected ? (
          <Icon
            icon={IconProp.CheckCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
          />
        ) : (
          <span className="relative mt-1.5 flex h-2.5 w-2.5 flex-shrink-0">
            {/* The dot's own indigo: a mid-tone reads the same in the dark theme. */}
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
          </span>
        )}
        <div className="min-w-0 space-y-0.5">
          <p
            className={`text-sm font-medium ${
              isEveryoneConnected ? "text-emerald-900" : "text-gray-900"
            }`}
          >
            {translator.translateTemplate(
              CLOUD_AI_AGENT_ORGANIZATION_CONNECTED_COUNT,
              {
                connected: translator.formatNumber(connected),
                total: translator.formatNumber(total),
              },
            )}
          </p>
          {isEveryoneConnected ? (
            <p className="text-sm text-emerald-900">
              {translator.translateText(
                CLOUD_AI_AGENT_ORGANIZATION_ALL_CONNECTED,
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>

      <ul
        className={`divide-y divide-gray-100 rounded-lg border border-gray-200 ${
          isLong ? "max-h-96 overflow-y-auto" : ""
        }`}
        data-testid={`${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}-list`}
        data-scrolls={isLong ? "true" : "false"}
      >
        {props.view.accounts.map(
          (account: CloudOrganizationAccountView): ReactElement => {
            return (
              <li
                key={account.cloudAccountId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
                data-testid={`${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}-account`}
                data-account={account.accountId}
                data-state={account.agent}
              >
                <div className="min-w-0 flex-1">
                  {/*
                   * A long name takes two lines before it is cut, and its
                   * own direction places the cut: a Latin name on a
                   * right-to-left page loses its end, not its start. The
                   * row is a flex line, so a short name keeps to the
                   * reading start.
                   */}
                  <p className="flex text-sm text-gray-900">
                    <span
                      dir="auto"
                      title={account.name}
                      className="line-clamp-2 min-w-0 break-words"
                      data-testid={`${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}-name`}
                    >
                      {account.name}
                    </span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                    <span dir="ltr" className="font-mono">
                      {account.accountId}
                    </span>
                    {account.isManagementAccount ? (
                      <span
                        data-testid={`${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}-management`}
                      >
                        {translator.translateText(
                          CLOUD_AI_AGENT_ORGANIZATION_MANAGEMENT_LABEL,
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                    {current &&
                    account.cloudAccountId.toLowerCase() === current ? (
                      <span
                        className="font-medium text-indigo-700"
                        data-testid={`${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}-this-account`}
                      >
                        {translator.translateText(
                          CLOUD_AI_AGENT_ORGANIZATION_THIS_ACCOUNT_LABEL,
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                  </p>
                </div>
                <span
                  className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    STATE_CLASS_NAMES[account.agent]
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS_NAMES[account.agent]}`}
                    aria-hidden="true"
                  />
                  {translator.translateText(
                    CLOUD_AI_AGENT_ORGANIZATION_STATE_WORDS[account.agent],
                  )}
                </span>
              </li>
            );
          },
        )}
      </ul>

      {props.view.isTruncated ? (
        <p
          className="text-xs text-gray-500"
          data-testid={`${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_TEST_ID}-truncated`}
        >
          {translator.translateTemplate(CLOUD_AI_AGENT_ORGANIZATION_TRUNCATED, {
            count: translator.formatNumber(total),
          })}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudAiAgentOrganizationAccounts;
