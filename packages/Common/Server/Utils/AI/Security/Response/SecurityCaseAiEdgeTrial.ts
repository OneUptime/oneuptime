import ObjectID from "../../../../../Types/ObjectID";

/*
 * WHETHER EDGE'S ON ITS OWN IS CLEARED BY THE SCANNERS POLICY (#10352,
 * #10350): the one place the responder asks it.
 *
 * Edge set to On its own blocks an address with nobody looking, so it
 * counts only once someone has vouched for it - a Security Admin confirmed
 * it, or the project's Scanners policy of automatic response (#10350)
 * finished a whole trial run: a week of blocks proposed and proven on the
 * project's own traffic first (Types/SecurityCase/SecurityCaseAi's
 * getEdgeOnItsOwnClearance).
 *
 * #10350's trial is not on main yet (its pull request #10678 adds
 * SecurityAutomaticResponseTrial). Until it is, no trial has finished, and
 * Edge's On its own takes a Security Admin's confirmation.
 *
 * TODO(#10350): once #10678 is on main, return
 * SecurityAutomaticResponseTrial.hasScannersPolicyFinishedTrial(projectId,
 * now) here - it reads true only for a whole 7-day trial, and false on a
 * read failure, so a doubt still asks a Security Admin.
 */
export default class SecurityCaseAiEdgeTrial {
  public static async hasScannersPolicyFinishedTrial(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<boolean> {
    void data;
    return false;
  }
}
