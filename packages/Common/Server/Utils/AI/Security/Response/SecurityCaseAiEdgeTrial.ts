import ObjectID from "../../../../../Types/ObjectID";
import SecurityAutomaticResponseTrial from "../../../SecurityAutomaticResponse/SecurityAutomaticResponseTrial";

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
 * Automatic response answers it (SecurityAutomaticResponseTrial): true only
 * for a whole 7-day trial - not for a policy turned on without one, nor one
 * still running - and false when the policy cannot be read, so a doubt
 * still asks a Security Admin.
 */
export default class SecurityCaseAiEdgeTrial {
  public static async hasScannersPolicyFinishedTrial(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<boolean> {
    return await SecurityAutomaticResponseTrial.hasScannersPolicyFinishedTrial(
      data.projectId,
      data.now,
    );
  }
}
