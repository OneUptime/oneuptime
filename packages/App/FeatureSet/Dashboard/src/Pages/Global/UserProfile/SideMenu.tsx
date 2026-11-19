import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import { SignInManagementState } from "../../../Components/UserProfile/SignInManagement";
import React, { ReactElement } from "react";

export interface ComponentProps {
  /*
   * Who manages the person's sign-in (#9688), as the layout read it: null
   * while it is on its way. Left out, the person manages their own.
   */
  signInManagement?: SignInManagementState | undefined;
}

const DashboardSideMenu: (props: ComponentProps) => JSX.Element = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Security is the person's own sign-in settings: a password, passkeys and
   * two-factor authentication. Somebody whose organization manages their
   * sign-in has none of them to set, so the section is not drawn for them -
   * nor while the answer is on its way, so it never shows and then goes.
   * Their Overview says who manages their sign-in instead.
   */
  const showsSecurity: boolean =
    props.signInManagement === undefined ||
    (props.signInManagement !== null && !props.signInManagement.isManagedBySso);

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route,
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Profile Picture",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_PROFILE_PICTURE] as Route,
            ),
          }}
          icon={IconProp.Image}
        />
      </SideMenuSection>
      {showsSecurity ? (
        <SideMenuSection title="Security">
          <SideMenuItem
            link={{
              title: "Password Management",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_PROFILE_PASSWORD] as Route,
              ),
            }}
            icon={IconProp.Lock}
          />

          <SideMenuItem
            link={{
              title: "Passkeys",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_PASSKEYS] as Route,
              ),
            }}
            icon={IconProp.Fingerprint}
          />

          <SideMenuItem
            link={{
              title: "Two-factor authentication",
              to: RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_TWO_FACTOR_AUTH] as Route,
              ),
            }}
            icon={IconProp.ShieldCheck}
          />
        </SideMenuSection>
      ) : (
        <></>
      )}
      <SideMenuSection title="Danger Zone">
        <SideMenuItem
          link={{
            title: "Delete Account",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_PROFILE_DELETE] as Route,
            ),
          }}
          icon={IconProp.Trash}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
