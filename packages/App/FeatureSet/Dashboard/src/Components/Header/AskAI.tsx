import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import KeyboardKey from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import React, { ReactElement } from "react";
import { useIsAskAiOpen } from "../AIChat/AskAiEvents";
import EventName from "../../Utils/EventName";

const AskAI: () => JSX.Element = (): ReactElement => {
  const isOpen: boolean = useIsAskAiOpen();

  return (
    <HeaderIconDropdownButton
      icon={IconProp.Sparkles}
      name="Ask AI"
      title="Ask AI"
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
