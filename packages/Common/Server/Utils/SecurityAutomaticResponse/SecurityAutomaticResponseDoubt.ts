import SecurityAutomaticResponseAction from "../../../Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Yellow500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES } from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SECURITY_BLOCK_DURATION_IN_MS,
  SecurityBlockDuration,
  SecurityBlockState,
  isSecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  automaticResponseLiftedOnDoubtMarkdown,
  describeSignedInUserNames,
} from "../../../Utils/SecurityAutomaticResponse/SecurityAutomaticResponseMarkdown";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityAutomaticResponseActionService from "../../Services/SecurityAutomaticResponseActionService";
import SecurityBlockService, {
  SecurityBlockLiftOutcome,
  SecurityBlockLiftStatus,
} from "../../Services/SecurityBlockService";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityAutomaticResponseOwners from "./SecurityAutomaticResponseOwners";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressState,
  SecuritySignedInManyCheck,
  SecuritySignedInUser,
} from "./SecuritySignedInAddresses";

/*
 * UNDO ON DOUBT (#10350): when a signed-in user is seen from an address a
 * policy blocked, after it blocked it, the policy lifts its block and tells
 * the project's security owners. A person passes a challenge where a
 * script does not, so a policy's challenge is where this is seen most: a
 * user who signs in from behind it is someone the policy should not have
 * stopped. A sign-in through the identity provider says so for a block too.
 *
 * Every minute, for each project with blocks its policies made still in
 * force, every such address is asked at once whether a signed-in user used
 * it since it was blocked (SecuritySignedInAddresses.checkMany). One that
 * was is lifted - as OneUptime, through the blocklist's one way in, which
 * records it, takes it off every edge and tells its case - and its action
 * says who was seen. A trial run's would-have blocks are asked the same, so
 * its summary can say how many it would have lifted. When OneUptime cannot
 * tell, nothing is lifted: the block ends by itself.
 */

// The longest a policy's block lasts: how far back the sweep looks.
export const SECURITY_AUTOMATIC_RESPONSE_DOUBT_LOOKBACK_IN_MS: number =
  SECURITY_BLOCK_DURATION_IN_MS[SecurityBlockDuration.SevenDays];

// The most actions one pass reads.
export const SECURITY_AUTOMATIC_RESPONSE_DOUBT_LIMIT: number = 2000;

// When an action's block ends, as it was made (or would have been).
function endOf(action: SecurityAutomaticResponseAction): number {
  const start: number = new Date(
    action.blockedAt || action.createdAt || 0,
  ).getTime();
  const duration: SecurityBlockDuration = isSecurityBlockDuration(
    action.duration,
  )
    ? action.duration
    : SecurityBlockDuration.OneHour;

  return duration === SecurityBlockDuration.UntilLifted
    ? Number.MAX_SAFE_INTEGER
    : start + SECURITY_BLOCK_DURATION_IN_MS[duration];
}

export default class SecurityAutomaticResponseDoubt {
  // One pass: how many blocks were lifted (or, in a trial run, would have been).
  @CaptureSpan()
  public static async liftOnDoubt(now?: Date): Promise<number> {
    const at: Date = now || OneUptimeDate.getCurrentDate();
    const actions: Array<SecurityAutomaticResponseAction> =
      await SecurityAutomaticResponseActionService.findBy({
        query: {
          outcome: new Includes([
            ...SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
          ]),
          doubtSeenAt: QueryHelper.isNull(),
          createdAt: QueryHelper.greaterThanEqualTo(
            new Date(
              at.getTime() - SECURITY_AUTOMATIC_RESPONSE_DOUBT_LOOKBACK_IN_MS,
            ),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          securityCaseId: true,
          policyName: true,
          value: true,
          isTrialRun: true,
          duration: true,
          blockedAt: true,
          createdAt: true,
          securityBlockId: true,
        },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: SECURITY_AUTOMATIC_RESPONSE_DOUBT_LIMIT,
        props: { isRoot: true },
      });

    const byProject: Map<
      string,
      Array<SecurityAutomaticResponseAction>
    > = new Map();

    for (const action of actions) {
      // A live action is asked once its block is made; any one, until its block (or would-be block) ends.
      if (
        !action.projectId ||
        !action.value ||
        (!action.isTrialRun && !action.securityBlockId) ||
        endOf(action) <= at.getTime()
      ) {
        continue;
      }

      const key: string = action.projectId.toString();
      byProject.set(key, [...(byProject.get(key) || []), action]);
    }

    let lifted: number = 0;

    for (const projectActions of byProject.values()) {
      try {
        lifted += await this.checkProject({
          projectId: projectActions[0]!.projectId!,
          actions: projectActions,
          now: at,
        });
      } catch (error) {
        logger.error(
          `SecurityAutomaticResponseDoubt: could not check project ${projectActions[0]!.projectId!.toString()}'s automatic blocks for signed-in users:`,
        );
        logger.error(error);
      }
    }

    return lifted;
  }

  private static async checkProject(data: {
    projectId: ObjectID;
    actions: Array<SecurityAutomaticResponseAction>;
    now: Date;
  }): Promise<number> {
    // A live block lifted or ended meanwhile is no longer the policy's to lift.
    const blockIds: Array<ObjectID> = data.actions
      .filter((action: SecurityAutomaticResponseAction): boolean => {
        return !action.isTrialRun && Boolean(action.securityBlockId);
      })
      .map((action: SecurityAutomaticResponseAction): ObjectID => {
        return action.securityBlockId!;
      });
    const blocks: Array<SecurityBlock> = await SecurityBlockService.findByIds({
      projectId: data.projectId,
      ids: blockIds,
    });
    const activeBlockIds: Set<string> = new Set(
      blocks
        .filter((block: SecurityBlock): boolean => {
          return block.state === SecurityBlockState.Active;
        })
        .map((block: SecurityBlock): string => {
          return block.id!.toString();
        }),
    );
    const asked: Array<SecurityAutomaticResponseAction> = data.actions.filter(
      (action: SecurityAutomaticResponseAction): boolean => {
        return (
          action.isTrialRun === true ||
          activeBlockIds.has(action.securityBlockId!.toString())
        );
      },
    );

    if (asked.length === 0) {
      return 0;
    }

    const check: SecuritySignedInManyCheck =
      await SecuritySignedInAddresses.checkMany({
        projectId: data.projectId,
        addresses: asked.map((action: SecurityAutomaticResponseAction) => {
          return {
            value: action.value!,
            since: new Date(action.blockedAt || action.createdAt!),
          };
        }),
        now: data.now,
      });

    if (check.state !== SecuritySignedInAddressState.SignedIn) {
      logger.debug(
        `SecurityAutomaticResponseDoubt: project ${data.projectId.toString()}: ${check.reason}`,
      );
      return 0;
    }

    let lifted: number = 0;

    for (const action of asked) {
      const users: Array<SecuritySignedInUser> | undefined =
        check.usersByAddress.get(action.value!);
      const since: number = new Date(
        action.blockedAt || action.createdAt!,
      ).getTime();
      const seen: Array<SecuritySignedInUser> = (users || []).filter(
        (user: SecuritySignedInUser): boolean => {
          return Boolean(user.lastSeenAt && user.lastSeenAt.getTime() >= since);
        },
      );

      if (seen.length === 0) {
        continue;
      }

      if (
        await this.recordDoubt({
          projectId: data.projectId,
          action,
          seen,
          now: data.now,
        })
      ) {
        lifted++;
      }
    }

    return lifted;
  }

  // One address a signed-in user was seen from: the doubt recorded, and - for a live block - the block lifted and people told.
  private static async recordDoubt(data: {
    projectId: ObjectID;
    action: SecurityAutomaticResponseAction;
    seen: Array<SecuritySignedInUser>;
    now: Date;
  }): Promise<boolean> {
    const { action, seen } = data;
    const names: Array<string> = seen.map(
      (user: SecuritySignedInUser): string => {
        return user.name;
      },
    );
    const doubtDetail: string = `A signed-in user was seen from ${action.value} after the policy acted on it: ${describeSignedInUserNames(names)}.`;

    // Once: of two passes at the same moment, one records it.
    const isFirst: boolean =
      await SecurityAutomaticResponseActionService.compareAndSetColumnsByIdWithoutHooks(
        {
          id: action.id!,
          data: { doubtSeenAt: data.now, doubtDetail },
          expectedData: { doubtSeenAt: null as unknown as Date },
        },
      );

    if (!isFirst || action.isTrialRun) {
      return isFirst;
    }

    const lifted: SecurityBlockLiftOutcome = await SecurityBlockService.lift({
      projectId: data.projectId,
      securityBlockId: action.securityBlockId!,
      reason: `A signed-in user (${describeSignedInUserNames(names)}) was seen from ${action.value}, so the ${action.policyName || "automatic response"} policy lifted its block.`,
      props: { isRoot: true },
    });

    if (lifted.status !== SecurityBlockLiftStatus.Lifted) {
      return false;
    }

    const told: number = await SecurityAutomaticResponseOwners.tell({
      projectId: data.projectId,
      subject: `${action.policyName || "Automatic response"} policy lifted its block of ${action.value}`,
      messageInMarkdown: [
        `The ${action.policyName || "automatic response"} policy blocked \`${action.value}\`, and a signed-in user was seen from it since: ${describeSignedInUserNames(names)}.`,
        ``,
        `It lifted the block at once. An address someone signed in uses, such as an office's or a customer's, should not be blocked automatically. Open the case to see what the address did, and Security Events -> Playbooks -> Automatic Response to see what the policy does.`,
      ].join("\n"),
    });

    if (action.securityCaseId) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: data.projectId,
        securityCaseId: action.securityCaseId,
        feedInfoInMarkdown: automaticResponseLiftedOnDoubtMarkdown({
          address: action.value || "",
          policyName: action.policyName || "automatic response",
          users: names,
          wasTold: told > 0,
        }).toString(),
        eventType: SecurityCaseFeedEventType.ResponseAction,
        displayColor: Yellow500,
      });
    }

    return true;
  }
}
