import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import KeyboardKey from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement } from "react";
import { useIsAskAiOpen } from "../AIChat/AskAiEvents";
import EventName from "../../Utils/EventName";
import { useIsProductOffOnServer } from "../../Utils/ProjectProducts/UseProjectProducts";
import ProductKey from "Common/Types/Product/ProductKey";

/*
 * The button's words are the reader's, as Search's beside it are: written
 * as the English "Ask AI", it was the one English word left in the header
 * of every page, in every language - while the translated docs already
 * told their readers to click the button by its own name in their language.
 */
export const ASK_AI_BUTTON_LABEL: string = translationKey("Ask AI");

const AskAI: () => JSX.Element = (): ReactElement => {
  const isOpen: boolean = useIsAskAiOpen();
  const translator: Translator = useTranslator();
  const label: string =
    translator.translateText(ASK_AI_BUTTON_LABEL) || ASK_AI_BUTTON_LABEL;

  // Switched off on the server (#6815): no button, as there is no panel.
  const isOffOnServer: boolean = useIsProductOffOnServer(ProductKey.AIChat);

  if (isOffOnServer) {
    return <></>;
  }

  return (
    <HeaderIconDropdownButton
      icon={IconProp.Sparkles}
      name={label}
      title={label}
      iconClassName="text-indigo-500"
      /*
       * The panel stays beside the page, this button in sight: it reads as
       * pressed while the panel is open, and pressing it again closes it.
       */
      isPressed={isOpen}
      /*
       * AskAiPanel listens for meta-or-ctrl + I, so the keycaps follow the
       * platform: ⌘ I on a Mac, Ctrl I on Windows and Linux.
       */
      shortcut={[KeyboardKey.Mod, "I"]}
      showDropdown={false}
      onClick={() => {
        GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE);
      }}
    />
  );
};

export default AskAI;
