import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import React, { ReactElement } from "react";
import EventName from "../../Utils/EventName";

const AskAI: () => JSX.Element = (): ReactElement => {
  return (
    <HeaderIconDropdownButton
      icon={IconProp.Sparkles}
      name="Ask AI"
      title="Ask AI"
      showDropdown={false}
      onClick={() => {
        GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE);
      }}
    />
  );
};

export default AskAI;
