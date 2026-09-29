import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import KeyboardKey from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import React, { ReactElement } from "react";
import EventName from "../../Utils/EventName";

const AskAI: () => JSX.Element = (): ReactElement => {
  return (
    <HeaderIconDropdownButton
      icon={IconProp.Sparkles}
      name="Ask AI"
      title="Ask AI"
      iconClassName="text-indigo-500"
      /*
       * AIChatPanel listens for meta-or-ctrl + I, so the keycaps follow the
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
