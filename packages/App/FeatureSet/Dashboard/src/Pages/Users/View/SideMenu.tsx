import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import SideMenu, {
  SideMenuSectionProps,
  SideMenuItemProps,
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
 * ReadProjectUserNotificationRule is a granular permission, and granular
 * permissions are held by NOBODY until an administrator hands them out —
 * existing project teams were seeded with roles, not with individual
 * permissions. Listing the two project-administration roles alongside it is
 * therefore not belt-and-braces, it is the difference between a feature that
 * works on every existing project on upgrade and one that is invisible until
 * somebody edits a team. The same triple gates the pages themselves and the
 * models' own table access control; this is only the menu.
 */
const NOTIFICATION_RULE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

/*
 * The six pages of the On-Call section, in the order somebody diagnosing and
 * then repairing a responder needs them.
 *
 * Readiness first because it is the page that says whether anything is wrong at
 * all. Notification methods second because a rule with nothing to point at is
 * not a rule — a responder with no verified method cannot be fixed by any
 * amount of rule editing. Then the four rule types, in the same order and under
 * the same names the self-serve settings menu uses, so an administrator
 * repairing somebody else's configuration navigates the shape they already know
 * from their own.
 */
interface OnCallMenuEntry {
  pageMapKey: PageMap;
  title: string;
  icon: IconProp;
}

const ON_CALL_MENU_ENTRIES: Array<OnCallMenuEntry> = [
  {
    pageMapKey: PageMap.USER_VIEW_ON_CALL_READINESS,
    title: "Readiness",
    icon: IconProp.CheckCircle,
  },
  {
    pageMapKey: PageMap.USER_VIEW_NOTIFICATION_METHODS,
    title: "Notification Methods",
    icon: IconProp.Bell,
  },
  {
    pageMapKey: PageMap.USER_VIEW_INCIDENT_ON_CALL_RULES,
    title: "Incident On-Call Rules",
    icon: IconProp.Alert,
  },
  {
    pageMapKey: PageMap.USER_VIEW_INCIDENT_EPISODE_ON_CALL_RULES,
    title: "Incident Episode On-Call Rules",
    icon: IconProp.Squares,
  },
  {
    pageMapKey: PageMap.USER_VIEW_ALERT_ON_CALL_RULES,
    title: "Alert On-Call Rules",
    icon: IconProp.ExclaimationCircle,
  },
  {
    pageMapKey: PageMap.USER_VIEW_ALERT_EPISODE_ON_CALL_RULES,
    title: "Alert Episode On-Call Rules",
    icon: IconProp.Squares,
  },
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
   * because answering it needs a request; this needs none — the permissions are
   * already in local storage — and threading it through Layout would add a
   * round trip to every user page to learn something the browser already knows.
   *
   * Hiding the entries is a convenience, never the boundary: somebody who types
   * a URL still reaches the page, which repeats this check, and the API refuses
   * the reads regardless. See Pages/Users/View/OnCall/Context.tsx.
   */
  const signedInUserId: string = UserUtil.getUserId().toString();

  const canReadNotificationRules: boolean =
    UserUtil.isMasterAdmin() ||
    /*
     * Your own configuration needs no grant at all — Permission.CurrentUser
     * already carries it — so the section stays put when a plain member walks
     * into their own row. The emptiness guard matters: getUserId() answers with
     * an empty ObjectID when the session has no id, and "" === "" would
     * otherwise open the section for a signed-out reader looking at a blank
     * model id.
     */
    (Boolean(signedInUserId) && signedInUserId === props.modelId.toString()) ||
    PermissionHelper.doesPermissionsIntersect(
      PermissionUtil.getAllPermissions(),
      NOTIFICATION_RULE_READ_PERMISSIONS,
    );

  if (canReadNotificationRules) {
    sections.push({
      title: "On-Call",
      items: ON_CALL_MENU_ENTRIES.map(
        (entry: OnCallMenuEntry): SideMenuItemProps => {
          return {
            link: {
              title: entry.title,
              to: RouteUtil.populateRouteParams(
                RouteMap[entry.pageMapKey] as Route,
                { modelId: props.modelId },
              ),
            },
            icon: entry.icon,
          };
        },
      ),
    });
  }

  const settingsItems: Array<SideMenuItemProps> = [];

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
