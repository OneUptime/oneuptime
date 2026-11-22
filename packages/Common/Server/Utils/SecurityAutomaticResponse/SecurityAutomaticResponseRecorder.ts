import SecurityAutomaticResponseAction from "../../../Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import PartialEntity from "../../../Types/Database/PartialEntity";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Green500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
  SecurityAutomaticResponseOutcome,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  isSecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { canSecurityBlockDestinationChallenge } from "../../../Types/SecurityBlocklist/SecurityBlockChallenge";
import { SecurityBlockEnforcementState } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { automaticResponseBlockedMarkdown } from "../../../Utils/SecurityAutomaticResponse/SecurityAutomaticResponseMarkdown";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityAutomaticResponseActionService from "../../Services/SecurityAutomaticResponseActionService";
import SecurityBlockEnforcementService from "../../Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../Services/SecurityBlockService";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../Services/SecurityPlaybookRunService";
import logger from "../Logger";
import SecurityBlockDestination from "../SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations, {
  SecurityBlockDestinationsFound,
} from "../SecurityBlocklist/SecurityBlockDestinations";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHAT A POLICY'S BLOCK CAME TO (#10350): the block its one-step run made,
 * or why it could not be made, on the policy's action; and once the block
 * takes hold at an edge - when the step made it, if it holds at once, or
 * when the reconciler first confirms it (recordBlocksTakingHold, every
 * minute) - its time to block, from the address's first request to the
 * edge holding it, on the action and on the case, and the case's line:
 *
 *   "OneUptime challenged 35.205.11.131 at Cloudflare for 1 hour (Scanners
 *   policy), 41 seconds after its first request."
 *
 * The line is written once: the action's appliedAt is set compare-and-set,
 * so of the step and a sweep at the same moment only one writes it. The
 * case's Response Plan step for the address is then done by the case, as
 * for any block that holds (#10342).
 */

// How far back the sweep looks for a block still to take hold.
export const SECURITY_AUTOMATIC_RESPONSE_HOLD_LOOKBACK_IN_MS: number =
  24 * 60 * 60 * 1000;

// How long a block may take to be made before its action is failed.
export const SECURITY_AUTOMATIC_RESPONSE_BLOCK_MADE_WITHIN_MS: number =
  30 * 60 * 1000;

// The most actions one sweep reads.
export const SECURITY_AUTOMATIC_RESPONSE_SWEEP_LIMIT: number = 500;

const ACTION_SELECT: {
  _id: true;
  projectId: true;
  securityAutomaticResponsePolicyId: true;
  policyName: true;
  securityCaseId: true;
  value: true;
  outcome: true;
  blockAction: true;
  duration: true;
  priorBlockCount: true;
  firstRequestAt: true;
  appliedAt: true;
  securityBlockId: true;
  securityPlaybookRunId: true;
  createdAt: true;
} = {
  _id: true,
  projectId: true,
  securityAutomaticResponsePolicyId: true,
  policyName: true,
  securityCaseId: true,
  value: true,
  outcome: true,
  blockAction: true,
  duration: true,
  priorBlockCount: true,
  firstRequestAt: true,
  appliedAt: true,
  securityBlockId: true,
  securityPlaybookRunId: true,
  createdAt: true,
};

// Where a block took hold, and whether each holds a challenge as a block.
export interface SecurityAutomaticResponseHeldAt {
  name: string;
  heldAsBlock: boolean;
}

/*
 * When a block first took hold, and where: the destinations that hold it
 * (Applied), the earliest of their applied times. Null while none does.
 */
export function readSecurityBlockHold(data: {
  rows: ReadonlyArray<SecurityBlockEnforcement>;
  canChallenge: (destinationKey: string) => boolean;
  isFallbackChallenge: boolean;
}): { appliedAt: Date; heldAt: Array<SecurityAutomaticResponseHeldAt> } | null {
  let appliedAt: number | null = null;
  const heldAt: Array<SecurityAutomaticResponseHeldAt> = [];

  for (const row of data.rows) {
    if (row.state !== SecurityBlockEnforcementState.Applied) {
      continue;
    }

    const time: number = new Date(
      row.appliedAt || row.lastConfirmedAt || OneUptimeDate.getCurrentDate(),
    ).getTime();

    if (Number.isFinite(time) && (appliedAt === null || time < appliedAt)) {
      appliedAt = time;
    }

    const name: string = (row.destinationName || "").trim();

    if (
      name &&
      !heldAt.some((held: SecurityAutomaticResponseHeldAt) => {
        return held.name === name;
      })
    ) {
      heldAt.push({
        name,
        heldAsBlock:
          data.isFallbackChallenge &&
          !data.canChallenge(row.destinationKey || ""),
      });
    }
  }

  return appliedAt === null ? null : { appliedAt: new Date(appliedAt), heldAt };
}

// Seconds from the first request to the block taking hold; null when the first request is not known.
export function getTimeToBlockInSeconds(data: {
  firstRequestAt?: Date | string | null | undefined;
  appliedAt: Date;
}): number | null {
  if (!data.firstRequestAt) {
    return null;
  }

  const first: number = new Date(data.firstRequestAt).getTime();

  if (!Number.isFinite(first)) {
    return null;
  }

  return Math.max(0, Math.round((data.appliedAt.getTime() - first) / 1000));
}

export default class SecurityAutomaticResponseRecorder {
  /*
   * What a policy's block step did for one address: the block it made, or
   * why it failed; and, when the block already holds somewhere, its time to
   * block and the case's line. Whether it wrote the line. Never throws.
   */
  @CaptureSpan()
  public static async recordBlockStep(data: {
    projectId: ObjectID;
    runId: ObjectID;
    policyId: ObjectID;
    securityCaseId: ObjectID;
    value: string;
    block: SecurityBlock | null;
    failure: string | null;
  }): Promise<boolean> {
    try {
      const action: SecurityAutomaticResponseAction | null =
        await this.findActionOfStep(data);

      if (!action?.id) {
        return false;
      }

      if (!data.block?.id) {
        if (data.failure) {
          await SecurityAutomaticResponseActionService.updateOneById({
            id: action.id,
            data: {
              outcome: SecurityAutomaticResponseOutcome.Failed,
              detail: data.failure,
            },
            props: { isRoot: true },
          });
        }

        return false;
      }

      await SecurityAutomaticResponseActionService.updateOneById({
        id: action.id,
        data: {
          securityBlockId: data.block.id,
          blockedAt: data.block.createdAt
            ? new Date(data.block.createdAt)
            : OneUptimeDate.getCurrentDate(),
          securityPlaybookRunId: data.runId,
        },
        props: { isRoot: true },
      });

      action.securityBlockId = data.block.id;

      return await this.recordIfHeld({
        projectId: data.projectId,
        actions: [action],
      }).then((written: number): boolean => {
        return written > 0;
      });
    } catch (error) {
      logger.error(
        `SecurityAutomaticResponseRecorder: could not record what policy ${data.policyId.toString()}'s block of ${data.value} came to:`,
      );
      logger.error(error);
      return false;
    }
  }

  /*
   * Every minute: the policies' blocks that took hold since, said on their
   * cases with their time to block; and the actions whose block was never
   * made, failed with why. How many took hold.
   */
  @CaptureSpan()
  public static async recordBlocksTakingHold(now?: Date): Promise<number> {
    const at: Date = now || OneUptimeDate.getCurrentDate();
    const actions: Array<SecurityAutomaticResponseAction> =
      await SecurityAutomaticResponseActionService.findBy({
        query: {
          isTrialRun: false,
          outcome: new Includes([
            ...SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
          ]),
          appliedAt: QueryHelper.isNull(),
          createdAt: QueryHelper.greaterThanEqualTo(
            new Date(
              at.getTime() - SECURITY_AUTOMATIC_RESPONSE_HOLD_LOOKBACK_IN_MS,
            ),
          ),
        },
        select: ACTION_SELECT,
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: SECURITY_AUTOMATIC_RESPONSE_SWEEP_LIMIT,
        props: { isRoot: true },
      });

    const byProject: Map<
      string,
      Array<SecurityAutomaticResponseAction>
    > = new Map();

    for (const action of actions) {
      if (!action.projectId) {
        continue;
      }

      if (!action.securityBlockId) {
        await this.failIfNeverMade({ action, now: at });
        continue;
      }

      const key: string = action.projectId.toString();
      byProject.set(key, [...(byProject.get(key) || []), action]);
    }

    let held: number = 0;

    for (const projectActions of byProject.values()) {
      try {
        held += await this.recordIfHeld({
          projectId: projectActions[0]!.projectId!,
          actions: projectActions,
        });
      } catch (error) {
        logger.error(
          `SecurityAutomaticResponseRecorder: could not read where project ${projectActions[0]!.projectId!.toString()}'s automatic blocks hold:`,
        );
        logger.error(error);
      }
    }

    return held;
  }

  // The action a policy's step acts for: by its run, or - if the policy had not named the run yet - its newest for the address.
  private static async findActionOfStep(data: {
    runId: ObjectID;
    policyId: ObjectID;
    value: string;
  }): Promise<SecurityAutomaticResponseAction | null> {
    const byRun: SecurityAutomaticResponseAction | null =
      await SecurityAutomaticResponseActionService.findOneBy({
        query: { securityPlaybookRunId: data.runId, value: data.value },
        select: ACTION_SELECT,
        props: { isRoot: true },
      });

    if (byRun) {
      return byRun;
    }

    return await SecurityAutomaticResponseActionService.findOneBy({
      query: {
        securityAutomaticResponsePolicyId: data.policyId,
        value: data.value,
        isTrialRun: false,
        outcome: new Includes([...SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES]),
        securityBlockId: QueryHelper.isNull(),
      },
      select: ACTION_SELECT,
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });
  }

  /*
   * An action whose block was never made within half an hour - its run
   * failed before the step, or was lost - is failed, with the run's words.
   */
  private static async failIfNeverMade(data: {
    action: SecurityAutomaticResponseAction;
    now: Date;
  }): Promise<void> {
    const { action } = data;

    if (
      !action.id ||
      !action.createdAt ||
      data.now.getTime() - new Date(action.createdAt).getTime() <
        SECURITY_AUTOMATIC_RESPONSE_BLOCK_MADE_WITHIN_MS
    ) {
      return;
    }

    let detail: string = "The block was never made.";

    if (action.securityPlaybookRunId) {
      const run: SecurityPlaybookRun | null =
        await SecurityPlaybookRunService.findOneById({
          id: action.securityPlaybookRunId,
          select: { errorMessage: true },
          props: { isRoot: true },
        });

      if (run?.errorMessage) {
        detail = `The block was never made: ${run.errorMessage}`;
      }
    }

    await SecurityAutomaticResponseActionService.updateOneById({
      id: action.id,
      data: { outcome: SecurityAutomaticResponseOutcome.Failed, detail },
      props: { isRoot: true },
    });
  }

  /*
   * The actions of one project whose block holds now: each stamped once,
   * compare-and-set, with when it took hold, where and its time to block,
   * and its case told. How many were.
   */
  private static async recordIfHeld(data: {
    projectId: ObjectID;
    actions: Array<SecurityAutomaticResponseAction>;
  }): Promise<number> {
    const blockIds: Array<ObjectID> = data.actions
      .map((action: SecurityAutomaticResponseAction): ObjectID | undefined => {
        return action.securityBlockId || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (blockIds.length === 0) {
      return 0;
    }

    const [rows, blocks]: [
      Array<SecurityBlockEnforcement>,
      Array<SecurityBlock>,
    ] = await Promise.all([
      SecurityBlockEnforcementService.findForBlocks({
        projectId: data.projectId,
        securityBlockIds: blockIds,
      }),
      SecurityBlockService.findByIds({
        projectId: data.projectId,
        ids: blockIds,
      }),
    ]);

    if (
      !rows.some((row: SecurityBlockEnforcement): boolean => {
        return row.state === SecurityBlockEnforcementState.Applied;
      })
    ) {
      return 0;
    }

    const canChallenge: (key: string) => boolean = await this.readCanChallenge(
      data.projectId,
    );
    let held: number = 0;

    for (const action of data.actions) {
      const block: SecurityBlock | undefined = blocks.find(
        (candidate: SecurityBlock): boolean => {
          return (
            candidate.id?.toString() === action.securityBlockId?.toString()
          );
        },
      );
      const hold: {
        appliedAt: Date;
        heldAt: Array<SecurityAutomaticResponseHeldAt>;
      } | null = block
        ? readSecurityBlockHold({
            rows: rows.filter((row: SecurityBlockEnforcement): boolean => {
              return row.securityBlockId?.toString() === block.id?.toString();
            }),
            canChallenge,
            isFallbackChallenge:
              block.action === SecurityBlockAction.Challenge &&
              block.challengeFallsBackToBlock === true,
          })
        : null;

      if (!action.id || !block || !hold) {
        continue;
      }

      const timeToBlock: number | null = getTimeToBlockInSeconds({
        firstRequestAt: action.firstRequestAt,
        appliedAt: hold.appliedAt,
      });

      // Built as a plain record: the compiler need not unfold the model's whole payload type.
      const tookHold: Record<string, unknown> = {
        appliedAt: hold.appliedAt,
        enforcedAt: { destinations: hold.heldAt } as unknown as JSONObject,
      };

      if (timeToBlock !== null) {
        tookHold["timeToBlockInSeconds"] = timeToBlock;
      }

      const isFirst: boolean =
        await SecurityAutomaticResponseActionService.compareAndSetColumnsByIdWithoutHooks(
          {
            id: action.id,
            data: tookHold as unknown as PartialEntity<SecurityAutomaticResponseAction>,
            expectedData: { appliedAt: null as unknown as Date },
          },
        );

      if (!isFirst) {
        continue;
      }

      held++;

      const duration: SecurityBlockDuration = isSecurityBlockDuration(
        action.duration,
      )
        ? action.duration
        : SecurityBlockDuration.OneHour;

      if (action.securityCaseId) {
        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId: data.projectId,
          securityCaseId: action.securityCaseId,
          feedInfoInMarkdown: automaticResponseBlockedMarkdown({
            action:
              block.action === SecurityBlockAction.Challenge
                ? SecurityBlockAction.Challenge
                : SecurityBlockAction.Block,
            address: action.value || block.value || "",
            enforcedAt: hold.heldAt.map(
              (heldAt: SecurityAutomaticResponseHeldAt): string => {
                return heldAt.name;
              },
            ),
            heldAsBlockAt: hold.heldAt
              .filter((heldAt: SecurityAutomaticResponseHeldAt): boolean => {
                return heldAt.heldAsBlock;
              })
              .map((heldAt: SecurityAutomaticResponseHeldAt): string => {
                return heldAt.name;
              }),
            duration,
            policyName: action.policyName || "automatic response",
            secondsAfterFirstRequest: timeToBlock,
            priorBlockCount: action.priorBlockCount || 0,
          }).toString(),
          eventType: SecurityCaseFeedEventType.ResponseAction,
          displayColor: Green500,
        });

        // The case's time to block: its first automatic block that took hold.
        const caseBlocked: Record<string, unknown> = {
          blockedAt: hold.appliedAt,
        };

        if (timeToBlock !== null) {
          caseBlocked["timeToBlockInSeconds"] = timeToBlock;
        }

        await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
          id: action.securityCaseId,
          data: caseBlocked as unknown as PartialEntity<SecurityCase>,
          expectedData: { blockedAt: null as unknown as Date },
        });
      }
    }

    return held;
  }

  // Whether each of the project's destinations can challenge, by its key; one it cannot list, can (says nothing more).
  private static async readCanChallenge(
    projectId: ObjectID,
  ): Promise<(key: string) => boolean> {
    try {
      const found: SecurityBlockDestinationsFound =
        await SecurityBlockDestinations.findForProject(projectId);
      const byKey: Map<string, boolean> = new Map(
        found.destinations.map(
          (destination: SecurityBlockDestination): [string, boolean] => {
            return [
              destination.key,
              canSecurityBlockDestinationChallenge(destination),
            ];
          },
        ),
      );

      return (key: string): boolean => {
        return byKey.get(key) ?? true;
      };
    } catch (error) {
      logger.warn(
        `SecurityAutomaticResponseRecorder: could not list project ${projectId.toString()}'s destinations: ${String(error)}`,
      );
      return (): boolean => {
        return true;
      };
    }
  }
}
