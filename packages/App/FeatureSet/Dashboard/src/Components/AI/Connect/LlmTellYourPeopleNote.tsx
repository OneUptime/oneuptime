import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What to do before reading people's AI chats: tell them. Shown where a
 * company AI tool is connected and where its privacy is set. Not legal
 * advice - a reminder of what the people whose chats arrive are owed.
 */
const LlmTellYourPeopleNote: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid="llm-tell-your-people"
      className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-gray-700 ring-1 ring-inset ring-amber-200"
    >
      <Icon
        icon={IconProp.InformationCircle}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
      />
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-gray-900">
          {translator.translateText("Tell your people first")}
        </div>
        <div>
          {translator.translateText(
            "These are your people's own words. Tell them their chats with this tool are kept and who can read them, and check with your legal or HR team what your policies and local law ask for.",
          )}
        </div>
      </div>
    </div>
  );
};

export default LlmTellYourPeopleNote;
