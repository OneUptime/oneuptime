import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// The data-testid of the notice, and of its line saying why.
export const NOTHING_TO_ADD_NOTICE_TEST_ID: string =
  "monitor-group-nothing-to-add";

export interface ComponentProps {
  // Why there is nothing to pick (MonitorGroupMembership.getNothingToAddMessage).
  reason: string;
}

/*
 * Add Monitors with no monitor left to pick: the project has none yet, or
 * the group holds every one. Said in the dialog in place of an empty picker,
 * drawn like the product's other "nothing to add" dialogs (an episode's,
 * NothingToAddToEpisode): an icon, a short title, then the reason.
 */
const NothingToAddNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid={NOTHING_TO_ADD_NOTICE_TEST_ID}
      role="status"
      className="flex flex-col items-center px-4 py-8 text-center"
    >
      <div
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100"
      >
        <Icon icon={IconProp.AltGlobe} className="h-5 w-5 text-gray-500" />
      </div>
      <div className="mt-3 text-sm font-medium text-gray-900">
        {translator.translateText("Nothing to add")}
      </div>
      <p
        data-testid={`${NOTHING_TO_ADD_NOTICE_TEST_ID}-reason`}
        className="mt-1 max-w-md text-balance text-sm leading-6 text-gray-500"
      >
        {translator.translateText(props.reason) || props.reason}
      </p>
    </div>
  );
};

export default NothingToAddNotice;
