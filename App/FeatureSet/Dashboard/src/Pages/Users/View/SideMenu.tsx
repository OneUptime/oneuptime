import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
  hasCustomFields: boolean;
}

/*
 * Who may look at another member's on-call notification configuration.
 *
 * ReadProjectUserNotificationRule is a brand-new granular permission, and
 * granular permissions are held by NOBODY until an administrator hands them out
 * - existing project teams were seeded with roles, not with individual
 * permissions. Listing the two project-administration roles alongside it is
 * therefore not belt-and-braces, it is the difference between a feature that
 * works on every existing project on upgrade and one that is invisible until
 * somebody edits a team. The same triple gates the page itself and the model's
 * own table access control; this is only the menu entry.
 */
const NOTIFICATION_RULE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

const UserViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "Profile",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_VIEW] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.User,
        },
      ],
    },
    {
      title: "Membership",
      items: [
        {
          link: {
            title: "Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_VIEW_TEAMS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Team,
        },
      ],
    },
  ];

  /*
   * Read straight from the signed-in user's cached permissions rather than
   * being handed down as a prop the way hasCustomFields is. That prop exists
   * because answering it needs a request; this needs none - the permissions are
   * already in local storage - and threading it through Layout would add a
   * round trip to every user page to learn something the browser already knows.
   *
   * Hiding the entry is a convenience, never the boundary: someone who types
   * the URL still reaches the page, which repeats this check, and the API
   * refuses the reads regardless. See NotificationRules.tsx.
   */
  const signedInUserId: string = UserUtil.getUserId().toString();

  const canReadNotificationRules: boolean =
    UserUtil.isMasterAdmin() ||
    /*
     * Your own rules need no grant at all - Permission.CurrentUser already
     * carries them - so the entry stays put when a plain member walks into
     * their own row. The emptiness guard matters: getUserId() answers with an
     * empty ObjectID when the session has no id, and "" === "" would otherwise
     * open the page for a signed-out reader looking at a blank model id.
     */
    (Boolean(signedInUserId) && signedInUserId === props.modelId.toString()) ||
    PermissionHelper.doesPermissionsIntersect(
      PermissionUtil.getAllPermissions(),
      NOTIFICATION_RULE_READ_PERMISSIONS,
    );

  if (canReadNotificationRules) {
    sections.push({
      title: "On-Call",
      items: [
        {
          link: {
            title: "Notification Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_VIEW_NOTIFICATION_RULES] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Bell,
        },
      ],
    });
  }

  const settingsItems: Array<{
    link: { title: string; to: Route };
    icon: IconProp;
    className?: string;
  }> = [];

  if (props.hasCustomFields) {
    settingsItems.push({
      link: {
        title: "Custom Fields",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.USER_VIEW_CUSTOM_FIELDS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.TableCells,
    });
  }

  settingsItems.push({
    link: {
      title: "Remove from Project",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.USER_VIEW_DELETE] as Route,
        { modelId: props.modelId },
      ),
    },
    icon: IconProp.Trash,
    className: "danger-on-hover",
  });

  sections.push({
    title: "Settings",
    items: settingsItems,
  });

  return <SideMenu sections={sections} />;
};

export default UserViewSideMenu;
