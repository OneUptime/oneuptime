import SecurityAutomaticResponsePolicy from "../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
  getSecurityAutomaticResponseTrialState,
  hasSecurityAutomaticResponseTrialFinished,
  isSecurityAutomaticResponseMode,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import SecurityAutomaticResponsePolicyService from "../../Services/SecurityAutomaticResponsePolicyService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHERE A POLICY'S TRIAL RUN STANDS (#10350), for code beside the policies
 * that needs it: OneUptime AI working a case (#10352) lets its Edge row act
 * on its own only once the project's Scanners policy has finished a week
 * of trial run - the week that showed what automatic edge blocks would have
 * done to the project's own traffic - or once a Security Admin confirms.
 *
 * A finished trial is a whole week of recording (trialStartedAt to
 * trialEndsAt): one the policy is still in once its week is up, or one it
 * finished and was then turned on, or off, after. A trial skipped (turned
 * on before its week was up) or stopped part way never finished.
 */

export interface SecurityAutomaticResponseTrialRead {
  // The project's policy of that kind; null when it has none yet (it never opened its Automatic Response page).
  policyId: ObjectID | null;
  mode: SecurityAutomaticResponseMode;
  state: SecurityAutomaticResponseTrialState;
  // A whole week of trial run is behind it.
  hasFinishedTrial: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialFinishedAt: Date | null;
  trialSkippedAt: Date | null;
}

function readDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

export default class SecurityAutomaticResponseTrial {
  /*
   * Where the project's policy of `kind` stands in its trial run. Throws
   * when the policy cannot be read; hasScannersPolicyFinishedTrial does not.
   */
  @CaptureSpan()
  public static async readTrial(data: {
    projectId: ObjectID;
    kind: SecurityAutomaticResponsePolicyKind;
    now?: Date | undefined;
  }): Promise<SecurityAutomaticResponseTrialRead> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const policy: SecurityAutomaticResponsePolicy | null =
      await SecurityAutomaticResponsePolicyService.findOneBy({
        query: { projectId: data.projectId, kind: data.kind },
        select: {
          _id: true,
          mode: true,
          trialStartedAt: true,
          trialEndsAt: true,
          trialFinishedAt: true,
          trialSkippedAt: true,
        },
        props: { isRoot: true },
      });

    if (!policy) {
      return {
        policyId: null,
        mode: SecurityAutomaticResponseMode.Off,
        state: SecurityAutomaticResponseTrialState.NotStarted,
        hasFinishedTrial: false,
        trialStartedAt: null,
        trialEndsAt: null,
        trialFinishedAt: null,
        trialSkippedAt: null,
      };
    }

    return {
      policyId: policy.id || null,
      mode: isSecurityAutomaticResponseMode(policy.mode)
        ? policy.mode
        : SecurityAutomaticResponseMode.Off,
      state: getSecurityAutomaticResponseTrialState(policy, now),
      hasFinishedTrial: hasSecurityAutomaticResponseTrialFinished(policy, now),
      trialStartedAt: readDate(policy.trialStartedAt),
      trialEndsAt: readDate(policy.trialEndsAt),
      trialFinishedAt: readDate(policy.trialFinishedAt),
      trialSkippedAt: readDate(policy.trialSkippedAt),
    };
  }

  /*
   * Whether the project's Scanners policy has finished a whole week of trial
   * run. Never throws: a policy that cannot be read has not, so the caller
   * asks a Security Admin instead - fail toward a person.
   */
  @CaptureSpan()
  public static async hasScannersPolicyFinishedTrial(
    projectId: ObjectID,
    now?: Date,
  ): Promise<boolean> {
    try {
      const read: SecurityAutomaticResponseTrialRead = await this.readTrial({
        projectId,
        kind: SecurityAutomaticResponsePolicyKind.Scanners,
        now,
      });

      return read.hasFinishedTrial;
    } catch (error) {
      logger.warn(
        `SecurityAutomaticResponseTrial: could not read project ${projectId.toString()}'s Scanners policy, so its trial is read as not finished: ${String(error)}`,
      );
      return false;
    }
  }
}
