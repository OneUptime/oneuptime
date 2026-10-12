/*
 * WHICH STATE CHANGES ARE POSTED TO SLACK AND MICROSOFT TEAMS.
 *
 * Every state an incident, alert, incident or alert episode or scheduled
 * maintenance event moves to is a line in its feed, and a line in its Slack
 * and Microsoft Teams channels - except its first one. A record gets its
 * first state the moment it is created, and the message that announces it
 * names that state already ("Incident State: Identified"), so the
 * "Changed Incident INC-8 State to Identified" posted right under it said
 * the same thing twice. The first state stays in the feed, where the
 * timeline of states is read; chat hears of every change after it.
 *
 * The first state is the one with no state before it and none after it: a
 * state written in the middle of a record's timeline, or before its first
 * state, is a correction somebody made, and is posted like any change.
 */
export default class WorkspaceStateChangePosting {
  public static isFirstStateOfRecord(data: {
    stateBeforeThis: unknown;
    stateAfterThis: unknown;
  }): boolean {
    return !data.stateBeforeThis && !data.stateAfterThis;
  }

  // Whether the state change is posted to Slack and Microsoft Teams.
  public static postsToWorkspace(data: {
    stateBeforeThis: unknown;
    stateAfterThis: unknown;
  }): boolean {
    return !this.isFirstStateOfRecord(data);
  }
}
