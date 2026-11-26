import React, { FunctionComponent, ReactElement } from "react";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { DOCS_URL } from "Common/UI/Config";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayAgentConfig,
  StorageArrayPlatform,
} from "Common/Types/StorageArray/StorageArrayPlatform";

/*
 * The Documentation tab of an array whose platform the in-app guide has no
 * steps for yet (NetApp ONTAP: #11123 gives each platform a guide of its
 * own). Rather than walk the reader through another vendor's steps, it
 * says in three lines how this platform's agent is set up, from the
 * platform's own agent config, and opens the docs page that has every
 * command.
 */

export interface ComponentProps {
  storageSystem: string;
}

const LINE_CLASS_NAME: string = "text-sm leading-6 text-gray-700";

const DESCRIPTION: string = translationKey(
  "Install or reconfigure the Storage Array Agent for this {{noun}}.",
);
const STEP_USER: string = translationKey(
  "Create a read-only user for the agent on the {{noun}}. The guide has the commands.",
);
const STEP_INSTALL: string = translationKey(
  "Run the install script on a host that can reach the {{noun}}, and choose {{option}}.",
);
const STEP_WAIT: string = translationKey(
  "Its inventory and metrics appear here a few minutes after the agent starts.",
);
const GUIDE_LINK: string = translationKey("Read the Storage Array Agent guide");

const StorageArrayPlatformGuideCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const platform: StorageArrayPlatform | null =
    StorageArrayPlatformRegistry.getPlatform(props.storageSystem);
  const config: StorageArrayAgentConfig | undefined =
    platform?.agentConfigs[0];

  const words: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const noun: string = config
    ? words(config.arrayNoun)
    : platform?.displayName || props.storageSystem;

  return (
    <Card
      title={translationKey("Storage Array Agent Installation Guide")}
      description={translator.translateTemplate(DESCRIPTION, { noun })}
    >
      <div className="space-y-5" data-testid="storage-array-platform-guide">
        {config ? (
          <ol className="list-decimal space-y-3 ps-5">
            <li className={LINE_CLASS_NAME}>
              {translator.translateTemplate(STEP_USER, { noun })}
            </li>
            <li className={LINE_CLASS_NAME}>
              <p>
                {translator.translateTemplate(STEP_INSTALL, {
                  noun,
                  option: words(config.label),
                })}
              </p>
              <p
                className="mt-0.5 text-gray-500"
                data-testid="storage-array-platform-guide-option"
              >
                {words(config.description)}
              </p>
            </li>
            <li className={LINE_CLASS_NAME}>{words(STEP_WAIT)}</li>
          </ol>
        ) : (
          <></>
        )}
        <Link
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          openInNewTab={true}
          to={URL.fromString(`${DOCS_URL.toString()}/telemetry/storage-arrays`)}
          dataTestId="storage-array-platform-guide-link"
        >
          <>
            <Icon icon={IconProp.Book} className="h-4 w-4" />
            <span>{words(GUIDE_LINK)}</span>
          </>
        </Link>
      </div>
    </Card>
  );
};

export default StorageArrayPlatformGuideCard;
