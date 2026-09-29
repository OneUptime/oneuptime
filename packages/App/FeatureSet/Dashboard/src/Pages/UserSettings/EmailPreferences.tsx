import EmailNoiseCard from "../../Components/EmailPreferences/EmailNoiseCard";
import EmailRollupCard from "../../Components/EmailPreferences/EmailRollupCard";
import PageComponentProps from "../PageComponentProps";
import { APP_API_URL } from "Common/UI/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * User Settings > Email Preferences: how much email this project sends one
 * person, as opposed to which events reach them at all.
 *
 * The two controls here are the only ones in the product that change the
 * VOLUME of owner email rather than its content. "Fewer routine emails"
 * switches twenty-one informational event types off on the email channel in
 * one press; email rollup decides whether a burst of notifications arrives as
 * one message or as several. Neither is a per-event choice, which is why they
 * are not rows in the Notification Settings matrix - a matrix cell is one
 * event on one channel, and both of these cut across every event a person is
 * subscribed to.
 *
 * They share a page because they are the same question asked twice ("this is
 * too much mail"), and because the answer to it is almost always both: turn
 * the routine ones off, and let the rest arrive together. Splitting them
 * would mean a reader who found one would think they had found the fix.
 *
 * The page chrome - title, breadcrumbs, side menu - comes from
 * UserSettings/Layout.tsx, so this component renders only the cards.
 */
const UserSettingsEmailPreferences: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Keyed by project so switching projects remounts both cards rather than
   * leaving them showing the previous project's answer. Both preferences are
   * per (user, project), and a stale switch here is a switch that disagrees
   * with the mail actually being sent.
   */
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  /*
   * The preset is a server-side bulk edit, not a model write: it rewrites up
   * to twenty-one rows in one transaction under an advisory lock. The body is
   * empty on purpose - the endpoint takes the user from the session and the
   * project from the tenantid header that getCommonHeaders supplies, and
   * ignores anything sent in the body.
   */
  const reduceRoutineEmails: () => Promise<void> = async (): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromURL(APP_API_URL).addRoute(
          new Route("/user-notification-setting/reduce-routine-emails"),
        ),
        data: {},
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || response.isFailure()) {
      throw response;
    }
  };

  return (
    <Fragment key={projectId}>
      <EmailNoiseCard onApply={reduceRoutineEmails} />
      <EmailRollupCard />
    </Fragment>
  );
};

export default UserSettingsEmailPreferences;
