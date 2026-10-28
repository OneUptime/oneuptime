import Icon from "../../Icon/Icon";
import Image from "../../Image/Image";
import URL from "../../../../Types/API/URL";
import IconProp from "../../../../Types/Icon/IconProp";
import Name from "../../../../Types/Name";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  userFullName: Name;
  userProfilePicture: URL | string;
  onClick: () => void;
  /*
   * Whether the menu this button opens is open, which the button says with
   * aria-expanded. It was written as "false" whatever the menu did.
   */
  isMenuOpen?: boolean | undefined;
}

const UserProfile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="d-inline-block dropdown">
      <button
        onClick={() => {
          props.onClick();
        }}
        id="page-header-user-dropdown"
        aria-haspopup="true"
        className="btn header-item bg-soft-light border-start border-end flex"
        aria-expanded={Boolean(props.isMenuOpen)}
        style={{
          alignItems: "center",
        }}
      >
        <Image
          className="rounded-circle header-profile-user"
          imageUrl={props.userProfilePicture}
        />

        <span className="d-none d-xl-inline-block ms-2 me-1">
          {props.userFullName.toString()}
        </span>
        <Icon icon={IconProp.ChevronDown} />
      </button>
    </div>
  );
};

export default UserProfile;
