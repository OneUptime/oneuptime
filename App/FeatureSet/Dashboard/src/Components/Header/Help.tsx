import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import IconDropdownItem from "Common/UI/Components/Header/IconDropdown/IconDropdownItem";
import IconDropdownMenu from "Common/UI/Components/Header/IconDropdown/IconDropdownMenu";
import IconDropdownRow from "Common/UI/Components/Header/IconDropdown/IconDropdownRow";
import React, { ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

const Help: () => JSX.Element = (): ReactElement => {
  const { t } = useTranslation();
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

  return (
    <HeaderIconDropdownButton
      icon={IconProp.Help}
      name={t("help.label")}
      showDropdown={isDropdownVisible}
      onClick={() => {
        setIsDropdownVisible(true);
      }}
    >
      <IconDropdownMenu>
        <IconDropdownRow>
          <IconDropdownItem
            title={t("help.supportEmail")}
            icon={IconProp.Email}
            openInNewTab={true}
            url={URL.fromString("mailto:support@oneuptime.com")}
            onClick={() => {
              setIsDropdownVisible(false);
            }}
          />
          <IconDropdownItem
            title={t("help.chatSlack")}
            icon={IconProp.Slack}
            openInNewTab={true}
            onClick={() => {
              setIsDropdownVisible(false);
            }}
            url={URL.fromString(
              "https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA",
            )}
          />
          <IconDropdownItem
            title={t("help.requestDemo")}
            icon={IconProp.Window}
            onClick={() => {
              setIsDropdownVisible(false);
            }}
            openInNewTab={true}
            url={URL.fromString("https://oneuptime.com/enterprise/demo")}
          />
        </IconDropdownRow>
      </IconDropdownMenu>
    </HeaderIconDropdownButton>
  );
};

export default Help;
