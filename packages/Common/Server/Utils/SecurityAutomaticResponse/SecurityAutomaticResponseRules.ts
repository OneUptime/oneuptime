import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityAutomaticResponseRule,
  SecurityAutomaticResponseRuleState,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SecurityAutomaticResponsePolicyKind,
  isReadySecurityAutomaticResponsePolicyKind,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { DETECTION_REAL_TIME_RULES_MAX } from "../../../Types/SecurityEvent/RealTimeDetection";
import {
  buildDetectionRuleFromLibrary,
  findRuleOfLibraryEntry,
} from "../../../Utils/SecurityEvent/SecurityTemplateRecords";
import DetectionRuleService from "../../Services/DetectionRuleService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE RULES A READY POLICY ACTS ON, IN REAL TIME (#10350).
 *
 * A policy acts as the detection is made, so its detection should be made
 * as the attack's events arrive: a real-time rule screens every batch of
 * events as it is written and fires seconds later, where a scheduled one
 * reads minutes behind (Types/SecurityEvent/RealTimeDetection). So turning
 * a ready policy on - into its trial run, or on - runs the library rules it
 * acts on in real time: each the project has, turned real-time; each it has
 * not, added from the library (on, opening cases, as the Rule Library adds
 * it) and real-time. A project runs at most 50 rules in real time: past
 * that, a rule is left on its schedule and the policy's page says so.
 *
 *   Scanners           SQL injection, path traversal and Log4Shell
 *                      attempts, and many Cloudflare managed rule hits
 *                      from one address (T1190, T1595.002);
 *   Password Guessing  brute force from one address, password spraying,
 *                      and failed sign-ins then a success from the same
 *                      address (T1110);
 *   Known-Bad Addresses acts on the project's threat intel feeds' matches,
 *                      and on any detection about an address they list:
 *                      no rule of its own.
 *
 * A rule grouped on a user rather than an address (repeated failed
 * sign-ins for one account) names no address to act on, so it is none of a
 * policy's.
 */

// The library rules each ready policy acts on, by their Sigma ids.
export const SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES: Readonly<
  Record<
    Exclude<
      SecurityAutomaticResponsePolicyKind,
      SecurityAutomaticResponsePolicyKind.Custom
    >,
    ReadonlyArray<string>
  >
> = {
  [SecurityAutomaticResponsePolicyKind.Scanners]: [
    // SQL injection attempts.
    "cfdf6ad4-7138-4201-8a1c-6bf962335cee",
    // Path traversal attempts.
    "68d61e5d-79d2-4f41-8c1b-c017f6d0bd52",
    // Log4Shell exploit attempt.
    "866b7566-304e-442b-b1ad-ca08264af493",
    // Many Cloudflare managed rule hits from one address.
    "00146e5e-0b2d-4e09-ad97-91f6f54715fc",
  ],
  [SecurityAutomaticResponsePolicyKind.PasswordGuessing]: [
    // Brute force from one IP address.
    "acf2a37e-301a-46de-87c7-d4343f3a8445",
    // Password spraying.
    "c6b500e1-8b3c-4be3-b303-ef90a0355345",
    // Failed sign-ins, then a success from the same address.
    "1e112332-583d-4fd9-b688-9b5d715d5896",
  ],
  [SecurityAutomaticResponsePolicyKind.KnownBadAddresses]: [],
};

const RULE_SELECT: {
  _id: true;
  name: true;
  sigmaRuleYaml: true;
  isEnabled: true;
  isRealTime: true;
} = {
  _id: true,
  name: true,
  sigmaRuleYaml: true,
  isEnabled: true,
  isRealTime: true,
};

// The library entries a ready policy acts on.
export function getSecurityAutomaticResponseLibraryEntries(
  kind: unknown,
): Array<DetectionRuleLibraryEntry> {
  if (
    !isReadySecurityAutomaticResponsePolicyKind(kind) ||
    kind === SecurityAutomaticResponsePolicyKind.Custom
  ) {
    return [];
  }

  return SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES[
    kind as Exclude<
      SecurityAutomaticResponsePolicyKind,
      SecurityAutomaticResponsePolicyKind.Custom
    >
  ]
    .map((id: string): DetectionRuleLibraryEntry | undefined => {
      return getDetectionRuleLibraryEntry(id);
    })
    .filter(
      (
        entry: DetectionRuleLibraryEntry | undefined,
      ): entry is DetectionRuleLibraryEntry => {
        return Boolean(entry);
      },
    );
}

// Where one of a policy's rules stands in the project.
export function getSecurityAutomaticResponseRuleState(
  rule: Pick<DetectionRule, "isEnabled" | "isRealTime"> | undefined,
): SecurityAutomaticResponseRuleState {
  if (!rule) {
    return SecurityAutomaticResponseRuleState.Missing;
  }

  if (rule.isEnabled === false) {
    return SecurityAutomaticResponseRuleState.Off;
  }

  return rule.isRealTime === true
    ? SecurityAutomaticResponseRuleState.RealTime
    : SecurityAutomaticResponseRuleState.Scheduled;
}

export default class SecurityAutomaticResponseRules {
  // The rules a ready policy acts on, and where each stands in the project.
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    kind: unknown;
  }): Promise<Array<SecurityAutomaticResponseRule>> {
    const entries: Array<DetectionRuleLibraryEntry> =
      getSecurityAutomaticResponseLibraryEntries(data.kind);

    if (entries.length === 0) {
      return [];
    }

    const rules: Array<DetectionRule> = await this.readProjectRules(
      data.projectId,
    );

    return entries.map(
      (entry: DetectionRuleLibraryEntry): SecurityAutomaticResponseRule => {
        const rule: DetectionRule | undefined = findRuleOfLibraryEntry(
          rules,
          entry,
        );

        return {
          libraryRuleId: entry.id,
          title: rule?.name || entry.title,
          detectionRuleId: rule?.id?.toString() || null,
          state: getSecurityAutomaticResponseRuleState(rule),
        };
      },
    );
  }

  /*
   * Runs a ready policy's rules in real time, adding those the project has
   * not got: a rule turned off by the project is left off (someone chose
   * that), and past 50 real-time rules a rule stays on its schedule. Never
   * throws: the policy is on either way, and its page says where each rule
   * stands.
   */
  @CaptureSpan()
  public static async runInRealTime(data: {
    projectId: ObjectID;
    kind: unknown;
  }): Promise<void> {
    try {
      const entries: Array<DetectionRuleLibraryEntry> =
        getSecurityAutomaticResponseLibraryEntries(data.kind);

      if (entries.length === 0) {
        return;
      }

      const rules: Array<DetectionRule> = await this.readProjectRules(
        data.projectId,
      );
      let realTime: number = (
        await DetectionRuleService.countBy({
          query: { projectId: data.projectId, isRealTime: true },
          props: { isRoot: true },
        })
      ).toNumber();

      for (const entry of entries) {
        if (realTime >= DETECTION_REAL_TIME_RULES_MAX) {
          logger.info(
            `SecurityAutomaticResponseRules: project ${data.projectId.toString()} runs ${DETECTION_REAL_TIME_RULES_MAX} rules in real time already; "${entry.title}" stays on its schedule.`,
          );
          return;
        }

        const rule: DetectionRule | undefined = findRuleOfLibraryEntry(
          rules,
          entry,
        );

        try {
          if (!rule) {
            const created: DetectionRule = buildDetectionRuleFromLibrary({
              projectId: data.projectId,
              entry,
            });
            created.isRealTime = true;

            await DetectionRuleService.create({
              data: created,
              props: { isRoot: true },
            });
            realTime++;
            continue;
          }

          if (
            rule.isEnabled === false ||
            rule.isRealTime === true ||
            !rule.id
          ) {
            continue;
          }

          // One at a time: the service checks the cap, refuses what cannot run in real time, and hands it over.
          await DetectionRuleService.updateOneById({
            id: rule.id,
            data: { isRealTime: true },
            props: { isRoot: true },
          });
          realTime++;
        } catch (error) {
          logger.warn(
            `SecurityAutomaticResponseRules: "${entry.title}" of project ${data.projectId.toString()} stays on its schedule: ${String(error)}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `SecurityAutomaticResponseRules: could not run project ${data.projectId.toString()}'s ${String(data.kind)} rules in real time:`,
      );
      logger.error(error);
    }
  }

  private static async readProjectRules(
    projectId: ObjectID,
  ): Promise<Array<DetectionRule>> {
    return await DetectionRuleService.findBy({
      query: { projectId },
      select: RULE_SELECT,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }
}
