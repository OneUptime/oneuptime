import Icon from "../../Icon/Icon";
import Image from "../../Image/Image";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import IconProp from "../../../../Types/Icon/IconProp";
import Name from "../../../../Types/Name";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  userFullName: Name;
  userProfilePicture: URL | Route;
  onClick: () => void;
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
        aria-expanded="false"
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
