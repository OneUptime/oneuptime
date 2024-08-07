import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import HeaderIconDropdownButton from "Common/UI/src/Components/Header/HeaderIconDropdownButton";
import IconDropdownItem from "Common/UI/src/Components/Header/IconDropdown/IconDropdownItem";
import IconDropdownMenu from "Common/UI/src/Components/Header/IconDropdown/IconDropdownMenu";
import { ADMIN_DASHBOARD_URL } from "Common/UI/src/Config";
import BlankProfilePic from "Common/UI/src/Images/users/blank-profile.svg";
import FileUtil from "Common/UI/src/Utils/File";
import GlobalEvents from "Common/UI/src/Utils/GlobalEvents";
import Navigation from "Common/UI/src/Utils/Navigation";
import User from "Common/UI/src/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  onClickUserProfile: () => void;
}

const DashboardUserProfile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

  const [profilePictureId, setProfilePictureId] = useState<ObjectID | null>(
    User.getProfilePicId(),
  );

  type SetPictureFunction = (event: CustomEvent) => void;

  const setPicture: SetPictureFunction = (event: CustomEvent): void => {
    // get data from event.
    const id: ObjectID = event.detail.id as ObjectID;

    setProfilePictureId(id);
  };

  useEffect(() => {
    GlobalEvents.addEventListener(
      EventName.SET_NEW_PROFILE_PICTURE,
      setPicture,
    );

    return () => {
      // on unmount.
      GlobalEvents.removeEventListener(
        EventName.SET_NEW_PROFILE_PICTURE,
        setPicture,
      );
    };
  }, []);

  return (
    <>
      <HeaderIconDropdownButton
        iconImageUrl={
          profilePictureId
            ? FileUtil.getFileRoute(profilePictureId)
            : BlankProfilePic
        }
        name="User Profile"
        showDropdown={isDropdownVisible}
        onClick={() => {
          setIsDropdownVisible(true);
        }}
      >
        <IconDropdownMenu>
          <IconDropdownItem
            title="Profile"
            onClick={() => {
              setIsDropdownVisible(false);
              props.onClickUserProfile();
            }}
            icon={IconProp.User}
          />

          {User.isMasterAdmin() ? (
            <IconDropdownItem
              title="Admin Settings"
              onClick={() => {
                setIsDropdownVisible(false);
                Navigation.navigate(ADMIN_DASHBOARD_URL);
              }}
              icon={IconProp.Settings}
            />
          ) : (
            <></>
          )}

          <IconDropdownItem
            title="Log out"
            onClick={() => {
              setIsDropdownVisible(false);
            }}
            url={RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGOUT] as Route,
            )}
            icon={IconProp.Logout}
          />
        </IconDropdownMenu>
      </HeaderIconDropdownButton>
    </>
  );
};

export default DashboardUserProfile;
