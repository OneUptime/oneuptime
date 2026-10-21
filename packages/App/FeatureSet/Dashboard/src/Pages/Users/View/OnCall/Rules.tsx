import OnCallRulesTabs from "../../../../Components/NotificationRule/OnCallRulesTabs";
import PageComponentProps from "../../../PageComponentProps";
import {
  ADMIN_TABLE_PREFERENCES_PREFIX,
  UserOnCallContextValue,
  useUserOnCallContext,
} from "./Context";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Users > (a member) > On-Call > On-Call Rules: another member's on-call
 * notification rules, on the same one page with a tab per kind that the
 * member has under User Settings - the same component, pointed at them.
 *
 * This section used to be one page that drew all four kinds at once, a card
 * per severity each: on a project with six incident and six alert
 * severities, some fifty cards under a diagnosis nobody could still see. It
 * was split into a page per kind, and those four pages are the tabs here now.
 * Only the open tab is drawn, so the page is never fifty cards again; their
 * old addresses forward to their tab (UsersRoutes.tsx).
 */
const UserViewOnCallRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const context: UserOnCallContextValue = useUserOnCallContext();

  const { isSelf, firstName, displayName, fallbackState, canEdit } = context;

  /*
   * What a missing rule COSTS, said at the moment somebody decides whether a
   * hole is worth filling. Three states, not two: a readiness read that failed
   * has to read as unknown rather than as "your pages are dropped", which would
   * be a specific and possibly false claim about this project made because a
   * request timed out.
   */
  const getNoRuleMessage: () => string = (): string => {
    const opening: string = isSelf
      ? "You have no rule here."
      : `${displayName || "This user"} has no rule here.`;
    const owner: string = isSelf ? "you" : "they";

    if (fallbackState === "off") {
      return `${opening} Add one - with no rule these pages are dropped rather than delivered on another channel, because this project has on-call notification fallback switched off.`;
    }

    if (fallbackState === "unknown") {
      return `${opening} Add one. Whether these pages fall back to another verified method depends on a project setting that could not be read just now.`;
    }

    return `${opening} Add one, or these pages fall back to whatever verified method ${owner} have.`;
  };

  /*
   * `isEditable` decides whether the add, edit and remove controls are drawn
   * at all; it is a convenience over the server's own check, not a substitute
   * for it, so a member who reaches this page without the edit permission
   * simply sees the configuration rather than a set of buttons that would be
   * refused.
   *
   * `person` is what carries the context INTO each card and modal. The
   * section banner is sticky, but a modal covers it, and the moment a modal
   * is open is precisely the moment an admin is about to rewrite how a
   * colleague gets paged. Passing it only when this is not the viewer's own
   * page keeps the copy in the first person there, where it belongs.
   *
   * `notificationMethods` is what stops the tables doing what your own page
   * does - listing the seven method models to fill the dropdown, and
   * selecting the seven method RELATIONS to fill the method cell. The first
   * is refused for anybody but the owner; the second is not refused at all,
   * which is why it has to be closed here rather than left to the server. The
   * masked choices from the readiness payload replace both.
   */
  return (
    <OnCallRulesTabs
      userId={context.userId}
      person={isSelf ? undefined : { displayName, firstName }}
      notificationMethods={context.methodChoices}
      isEditable={canEdit}
      userPreferencesKeyPrefix={ADMIN_TABLE_PREFERENCES_PREFIX}
      noItemsMessage={getNoRuleMessage()}
    />
  );
};

export default UserViewOnCallRules;
