import DataMigrationBase from "./DataMigrationBase";
import SecurityAutomaticResponsePolicy from "Common/Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import Semaphore, { SemaphoreMutex } from "Common/Server/Infrastructure/Semaphore";
import SecurityAutomaticResponsePolicyService from "Common/Server/Services/SecurityAutomaticResponsePolicyService";
import logger from "Common/Server/Utils/Logger";
import SecurityAutomaticResponseRules from "Common/Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRules";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { SCANNING_FOR_SENSITIVE_FILES_RULE_ID } from "Common/Types/SecurityEvent/DetectionRuleLibrary";

// The policies one read takes.
export const SCANNERS_POLICIES_PAGE_SIZE: number = 500;

// Where two runs at once wait for each other, a project at a time.
export const SENSITIVE_FILE_RULE_LOCK_NAMESPACE: string =
  "AddSensitiveFileRuleToScannersPolicies";

/*
 * THE SCANNERS POLICY'S NEW RULE, IN THE PROJECTS THAT TURNED IT ON BEFORE
 * (#10745).
 *
 * Turning the Scanners policy on - into its trial run, or on - runs the
 * Rule Library rules it acts on in real time, adding those the project has
 * not got (SecurityAutomaticResponseRules.runInRealTime). Scanning for
 * sensitive files is one of them now: a project that turned the policy on
 * before it was would only get it by turning the policy off and on again,
 * and its card would say "Not added yet" beside a policy that is on.
 *
 * So every Scanners policy in its trial run or on gets that rule now, in
 * real time, as turning it on would have given it - and nothing else: a
 * rule of the policy's the project turned off, or deleted, since is left
 * as it is. A project already running 50 rules in real time keeps the new
 * one on its schedule, as the policy's card then says.
 *
 * Postgres only. Safe to run twice, and two at once: each project's turn
 * is taken under its lock, and reads the project's rules afresh, so the
 * rule is added once.
 */
export default class AddSensitiveFileRuleToScannersPolicies extends DataMigrationBase {
  public constructor() {
    super("AddSensitiveFileRuleToScannersPolicies");
  }

  public override async migrate(): Promise<void> {
    let skip: number = 0;
    let projects: number = 0;

    for (;;) {
      const policies: Array<SecurityAutomaticResponsePolicy> =
        await SecurityAutomaticResponsePolicyService.findBy({
          query: {
            kind: SecurityAutomaticResponsePolicyKind.Scanners,
            mode: new Includes([
              SecurityAutomaticResponseMode.TrialRun,
              SecurityAutomaticResponseMode.On,
            ]),
          },
          select: { _id: true, projectId: true },
          sort: { createdAt: SortOrder.Ascending },
          skip,
          limit: SCANNERS_POLICIES_PAGE_SIZE,
          props: { isRoot: true },
        });

      for (const policy of policies) {
        if (!policy.projectId) {
          continue;
        }

        await this.addRule(policy.projectId);
        projects++;
      }

      if (policies.length < SCANNERS_POLICIES_PAGE_SIZE) {
        break;
      }

      skip += SCANNERS_POLICIES_PAGE_SIZE;
    }

    logger.info(
      `AddSensitiveFileRuleToScannersPolicies: Scanning for sensitive files runs for the Scanners policies of ${projects} projects.`,
    );
  }

  // One project's turn, under its lock; without it, when the lock cannot be had.
  private async addRule(projectId: ObjectID): Promise<void> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: projectId.toString(),
        namespace: SENSITIVE_FILE_RULE_LOCK_NAMESPACE,
        lockTimeout: 60 * 1000,
        acquireTimeout: 60 * 1000,
      });
    } catch (error) {
      logger.warn(
        `AddSensitiveFileRuleToScannersPolicies: could not take project ${projectId.toString()}'s lock; adding its rule without it. ${String(error)}`,
      );
    }

    try {
      // Never throws: a rule it cannot add stays on its schedule, as the policy's card says.
      await SecurityAutomaticResponseRules.runInRealTime({
        projectId,
        kind: SecurityAutomaticResponsePolicyKind.Scanners,
        libraryRuleIds: [SCANNING_FOR_SENSITIVE_FILES_RULE_ID],
      });
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (error) {
          logger.warn(
            `AddSensitiveFileRuleToScannersPolicies: could not give back project ${projectId.toString()}'s lock; it runs out by itself. ${String(error)}`,
          );
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the rule is the project's now, as one turning the
     * policy on adds is, for it to turn off or delete.
     */
    return;
  }
}
