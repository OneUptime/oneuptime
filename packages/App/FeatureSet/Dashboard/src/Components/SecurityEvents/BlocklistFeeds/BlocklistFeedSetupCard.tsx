import {
  BLOCKLIST_FEEDS_TEST_IDS,
  CONFIRMATION_WINDOW_SENTENCE,
  FIREWALL_FIELD_TITLE,
  MD5_URL_LABEL,
  OTHER_FIREWALL_LABEL,
  PASSWORD_LABEL,
  PATH_SECRET_SENTENCE,
  READ_THE_GUIDE,
  SCRIPT_LABEL,
  SCRIPT_SECRET_SENTENCE,
  SECRET_PLACEHOLDER_SENTENCE,
  SETUP_CARD_DESCRIPTION,
  SETUP_CARD_TITLE,
  URL_LABEL,
  USERNAME_LABEL,
} from "./BlocklistFeedsCopy";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SECURITY_BLOCKLIST_FEED_FIREWALLS,
  SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES,
  SecurityBlocklistFeedFirewall,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  SECURITY_BLOCKLIST_FEED_BASIC_USERNAME,
  SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER,
  SecurityBlocklistFeedAuthentication,
  SecurityBlocklistFeedSetup,
  SecurityBlocklistFeedUrls,
  buildSecurityBlocklistFeedSnippet,
  buildSecurityBlocklistFeedUrls,
  getSecurityBlocklistFeedSetup,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeedSetup";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * SETTING UP A FIREWALL TO READ A FEED (#10345): for the firewall picked
 * (the feed's own first), the URL to paste - with Cisco's MD5 URL - how it
 * sends the secret, the steps in its own console, filled in, and for a host
 * the commands to run, each to copy; then what it cannot do, if anything,
 * and its section of the guide. The rules are the shared ones
 * (Types/SecurityBlocklist/SecurityBlocklistFeedSetup), the same the docs
 * describe.
 *
 * The secret fills the URL, the password and the commands only while the
 * page holds it - right after the feed was made or its secret rotated.
 * Otherwise each says where the secret goes, and how to get a new one.
 */

export interface ComponentProps {
  feedId: string;
  firewall: SecurityBlocklistFeedFirewall | undefined;
  // The secret, while the page holds it; null once it no longer does.
  secret: string | null;
}

// Each firewall by its maker's name, as written; Other in the reader's words.
export function getFirewallOptions(): Array<DropdownOption> {
  return SECURITY_BLOCKLIST_FEED_FIREWALLS.map(
    (firewall: SecurityBlocklistFeedFirewall): DropdownOption => {
      return firewall === SecurityBlocklistFeedFirewall.Other
        ? { value: firewall, label: OTHER_FIREWALL_LABEL }
        : {
            value: firewall,
            label: SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES[firewall],
            isUserContent: true,
          };
    },
  );
}

const CODE_CLASS_NAME: string =
  "break-all rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-900";

const BlocklistFeedSetupCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [firewall, setFirewall] = useState<SecurityBlocklistFeedFirewall>(
    props.firewall || SecurityBlocklistFeedFirewall.Other,
  );

  const setup: SecurityBlocklistFeedSetup =
    getSecurityBlocklistFeedSetup(firewall);
  const urls: SecurityBlocklistFeedUrls = buildSecurityBlocklistFeedUrls({
    apiUrl: APP_API_URL.toString(),
    feedId: props.feedId,
    setup,
    secret: props.secret,
  });
  const snippet: string | null = buildSecurityBlocklistFeedSnippet({
    setup,
    url: urls.url,
    secret: props.secret,
  });
  const options: Array<DropdownOption> = getFirewallOptions();

  const code: (text: string) => ReactElement = (text: string): ReactElement => {
    return (
      <code className={CODE_CLASS_NAME} dir="ltr">
        {text}
      </code>
    );
  };

  const isPathSecret: boolean =
    setup.authentication === SecurityBlocklistFeedAuthentication.PathSecret;

  return (
    <Card title={SETUP_CARD_TITLE} description={SETUP_CARD_DESCRIPTION}>
      <div
        className="space-y-5"
        data-testid={BLOCKLIST_FEEDS_TEST_IDS.setupCard}
      >
        <div className="max-w-md">
          <label
            className="mb-1 block text-sm font-medium text-gray-700"
            htmlFor={BLOCKLIST_FEEDS_TEST_IDS.firewallPicker}
          >
            {translator.translateText(FIREWALL_FIELD_TITLE)}
          </label>
          <Dropdown
            inputId={BLOCKLIST_FEEDS_TEST_IDS.firewallPicker}
            options={options}
            isClearable={false}
            value={options.find((option: DropdownOption): boolean => {
              return option.value === firewall;
            })}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              if (typeof value === "string") {
                setFirewall(value as SecurityBlocklistFeedFirewall);
              }
            }}
          />
        </div>

        <div>
          <div className="mb-1 text-sm font-medium text-gray-700">
            {translator.translateText(URL_LABEL)}
          </div>
          <div data-testid={BLOCKLIST_FEEDS_TEST_IDS.url}>
            <CodeBlock
              code={urls.url}
              language="text"
              showCopyButton={true}
              wrapLongLines={true}
            />
          </div>
          {isPathSecret && !props.secret ? (
            <p className="mt-1 text-xs text-gray-500">
              {translator.translateText(PATH_SECRET_SENTENCE)}
            </p>
          ) : (
            <></>
          )}
        </div>

        {urls.md5Url ? (
          <div>
            <div className="mb-1 text-sm font-medium text-gray-700">
              {translator.translateText(MD5_URL_LABEL)}
            </div>
            <div data-testid={BLOCKLIST_FEEDS_TEST_IDS.md5Url}>
              <CodeBlock
                code={urls.md5Url}
                language="text"
                showCopyButton={true}
                wrapLongLines={true}
              />
            </div>
          </div>
        ) : (
          <></>
        )}

        {setup.authentication === SecurityBlocklistFeedAuthentication.Basic ? (
          <dl className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-700">
                {translator.translateText(USERNAME_LABEL)}
              </dt>
              <dd className="mt-1">
                {code(SECURITY_BLOCKLIST_FEED_BASIC_USERNAME)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-700">
                {translator.translateText(PASSWORD_LABEL)}
              </dt>
              <dd className="mt-1 text-sm text-gray-600">
                {props.secret
                  ? code(props.secret)
                  : translator.translateText(SECRET_PLACEHOLDER_SENTENCE)}
              </dd>
            </div>
          </dl>
        ) : (
          <></>
        )}

        <ol
          className="list-decimal space-y-2 ps-5 text-sm text-gray-700"
          data-testid={BLOCKLIST_FEEDS_TEST_IDS.steps}
        >
          {setup.steps.map((step: string): ReactElement => {
            return (
              <li key={step}>
                <TranslatedSentence
                  template={step}
                  slots={{
                    url: code(urls.url),
                    md5Url: code(urls.md5Url || ""),
                    username: code(SECURITY_BLOCKLIST_FEED_BASIC_USERNAME),
                  }}
                  values={{
                    minutes: translator.formatNumber(
                      setup.refreshInMinutes || 5,
                    ),
                  }}
                />
              </li>
            );
          })}
        </ol>

        {snippet ? (
          <div>
            <div className="mb-1 text-sm font-medium text-gray-700">
              {translator.translateText(SCRIPT_LABEL)}
            </div>
            <div data-testid={BLOCKLIST_FEEDS_TEST_IDS.script}>
              <CodeBlock
                code={snippet}
                language={
                  firewall === SecurityBlocklistFeedFirewall.WindowsFirewall
                    ? "powershell"
                    : "bash"
                }
                showCopyButton={true}
              />
            </div>
            {props.secret ? (
              <></>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                <TranslatedSentence
                  template={SCRIPT_SECRET_SENTENCE}
                  slots={{
                    placeholder: code(
                      SECURITY_BLOCKLIST_FEED_SECRET_PLACEHOLDER,
                    ),
                  }}
                />
              </p>
            )}
          </div>
        ) : (
          <></>
        )}

        {setup.note ? (
          <p className="text-sm text-gray-600">
            {translator.translateText(setup.note)}
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            {translator.translateText(CONFIRMATION_WINDOW_SENTENCE)}
          </p>
        )}

        <Link
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:text-indigo-900"
          openInNewTab={true}
          to={URL.fromString(
            `${DOCS_URL.toString()}/telemetry/blocklist-feeds#${setup.docsAnchor}`,
          )}
        >
          <>
            <Icon icon={IconProp.Book} className="h-4 w-4" />
            {translator.translateText(READ_THE_GUIDE)}
          </>
        </Link>
      </div>
    </Card>
  );
};

export default BlocklistFeedSetupCard;
