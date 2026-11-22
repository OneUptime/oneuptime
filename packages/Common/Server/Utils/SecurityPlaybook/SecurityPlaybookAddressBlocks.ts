import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_BLOCK_REASON_MAX_LENGTH,
  SecurityBlockAction,
  SecurityBlockSource,
  SecurityBlockState,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockEnforcementShape,
  SecurityBlockEnforcementState,
  getSecurityBlockEnforcementSummary,
  SecurityBlockEnforcementSummary,
} from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { BlockAddressConfig } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import SecurityBlockEnforcementService from "../../Services/SecurityBlockEnforcementService";
import SecurityBlockService, {
  SecurityBlockLiftOutcome,
  SecurityBlockLiftStatus,
  SecurityBlockOutcome,
  SecurityBlockOutcomeStatus,
} from "../../Services/SecurityBlockService";
import logger from "../Logger";
import SecurityBlockDestinations, {
  SecurityBlockDestinationsFound,
} from "../SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistReconciler from "../SecurityBlocklist/SecurityBlocklistReconciler";
import type { PlaybookStepOutcome } from "./SecurityPlaybookActions";
import SecurityPlaybookContainment, {
  ContainmentTargetOutcome,
  describeTarget,
} from "./SecurityPlaybookContainment";

/*
 * BLOCKING AN ADDRESS, AND LIFTING THE BLOCK, AS A PLAYBOOK STEP (#10342).
 *
 * Block the address writes each of the step's targets to the project's
 * blocklist through SecurityBlockService - the one way in, which refuses a
 * protected or own address (and says what protects it), a value a block
 * already covers (and names the block), and expires the block unless a
 * Security Admin's one-step block keeps it. Then it reconciles the
 * blocklist at once, so the step can say where each block is enforced:
 *
 *   - "blocked until 2026-11-21 10:42 UTC, enforced at Cloudflare and AWS
 *     WAF";
 *   - "already blocked (covered by 35.205.11.0/24)";
 *   - protected, with what protects it;
 *   - or failed, with why.
 *
 * Fail toward a person: a block that nothing enforces is a failed step -
 * "Not enforced anywhere: connect Cloudflare, AWS WAF or a firewall." The
 * block is still recorded, so a destination connected later holds it, and
 * its undo (or the plan's Lift) lifts it; but nobody reads the step as the
 * address being blocked.
 *
 * Lift the block on the address, and the undo of a block on the case, lift
 * the active block of exactly the target's value. A range that holds it is
 * left alone: lifting it would let a whole network in, which is a person's
 * call on the Blocklist.
 */

// What a step whose block nothing enforces fails with.
export const NOT_ENFORCED_ANYWHERE_ERROR: string =
  "Not enforced anywhere: connect Cloudflare, AWS WAF or a firewall.";

/*
 * What became of one address: as a containment step's targets go, or
 * Protected - the blocklist refused it as one of the project's own or on
 * its protected list, which is no failure.
 */
interface AddressOutcome {
  state:
    | ContainmentTargetOutcome["state"]
    | SecurityPlaybookTargetState.Protected;
  detail: string;
  protectedBy?: string | undefined;
}

// What a block of the step is, once made: where it is enforced, and whether anything holds it.
export interface AddressBlockMade {
  block: SecurityBlock;
  summary: SecurityBlockEnforcementSummary;
  // Destinations asked to hold it that have not said yet.
  pendingAt: Array<string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

// "a", "a and b", "a, b and c": the names of the destinations, in English.
export function joinNames(names: ReadonlyArray<string>): string {
  const kept: Array<string> = names.filter((name: string): boolean => {
    return Boolean(name.trim());
  });

  if (kept.length <= 1) {
    return kept[0] || "";
  }

  return `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
}

// A moment as the blocklist writes it at a provider: "2026-11-21 10:42 UTC".
export function formatBlockTime(time: Date): string {
  return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/*
 * What a block made by the step says of itself: what it does, until when,
 * and where it is enforced - or why it is enforced nowhere.
 */
export function describeAddressBlockMade(data: {
  made: AddressBlockMade;
  hasDestinations: boolean;
}): { detail: string; isEnforcedSomewhere: boolean } {
  const { block, summary, pendingAt } = data.made;
  const verb: string =
    block.action === SecurityBlockAction.Challenge ? "challenged" : "blocked";
  const until: string = block.expiresAt
    ? `until ${formatBlockTime(new Date(block.expiresAt))}`
    : "until someone lifts it";
  const notApplied: Array<string> = summary.notEnforcedAt
    .filter((entry: { name: string; reason: string | null }): boolean => {
      return !pendingAt.includes(entry.name);
    })
    .map((entry: { name: string; reason: string | null }): string => {
      return entry.reason
        ? `not applied at ${entry.name}: ${entry.reason.replace(/[.\s]+$/, "")}`
        : `not applied at ${entry.name}`;
    });

  if (!data.hasDestinations) {
    return {
      detail: `${verb} ${until}, but nothing enforces your blocklist`,
      isEnforcedSomewhere: false,
    };
  }

  if (summary.enforcedAt.length > 0) {
    return {
      detail: [
        `${verb} ${until}, enforced at ${joinNames(summary.enforcedAt)}`,
        ...notApplied,
      ].join("; "),
      isEnforcedSomewhere: true,
    };
  }

  // On its way: the destination holds it once its next read back confirms it.
  if (pendingAt.length > 0) {
    return {
      detail: [
        `${verb} ${until}, being applied at ${joinNames(pendingAt)}`,
        ...notApplied,
      ].join("; "),
      isEnforcedSomewhere: true,
    };
  }

  return {
    detail:
      notApplied.length > 0
        ? `${verb} ${until}, but ${notApplied.join("; ")}`
        : `${verb} ${until}, but no destination holds it yet`,
    isEnforcedSomewhere: false,
  };
}

export default class SecurityPlaybookAddressBlocks {
  /*
   * Blocks each target the step is still to act on, as the step's settings
   * say, and says where each block is enforced. A person's one-step block
   * from a case is theirs (personId): it names them as who blocked it. A
   * playbook's names the playbook.
   */
  public static async block(data: {
    projectId: ObjectID;
    runId: ObjectID;
    securityCaseId: ObjectID;
    // Why the address is blocked, for whoever reads the Blocklist later: the case's title.
    reason?: string | undefined;
    config: BlockAddressConfig;
    targets: Array<SecurityPlaybookTarget>;
    personId?: ObjectID | undefined;
    // Who made it, when not a person or a playbook: OneUptime AI (#10352).
    source?: SecurityBlockSource | undefined;
  }): Promise<PlaybookStepOutcome> {
    const definition: SecurityPlaybookActionDefinition =
      getSecurityPlaybookAction(SecurityPlaybookActionType.BlockAddress)!;

    const toActOn: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Proposed;
      },
    );

    if (toActOn.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Skipped,
        summary: SecurityPlaybookContainment.describeNothingToActOn({
          entityType: SecurityEntityType.IpAddress,
          targets: data.targets,
        }),
        targets: data.targets,
      };
    }

    const found: SecurityBlockDestinationsFound =
      await SecurityBlockDestinations.findForProject(data.projectId);
    const hasDestinations: boolean =
      found.destinations.length > 0 || found.failedProviders.length > 0;
    const reason: string | undefined = data.reason?.trim()
      ? data.reason.trim().slice(0, SECURITY_BLOCK_REASON_MAX_LENGTH)
      : undefined;
    const props: DatabaseCommonInteractionProps = data.personId
      ? { isRoot: true, userId: data.personId }
      : { isRoot: true };

    const outcomes: Map<string, AddressOutcome> = new Map();
    const made: Map<string, SecurityBlock> = new Map();

    for (const target of toActOn) {
      let outcome: SecurityBlockOutcome;

      try {
        outcome = await SecurityBlockService.block({
          projectId: data.projectId,
          value: target.value,
          action: data.config.blockAction,
          duration: data.config.duration,
          reason,
          securityCaseId: data.securityCaseId,
          source:
            data.source ||
            (data.personId
              ? SecurityBlockSource.Person
              : SecurityBlockSource.Playbook),
          securityPlaybookRunId: data.runId,
          props,
        });
      } catch (error) {
        outcomes.set(target.value, {
          state: SecurityPlaybookTargetState.Failed,
          detail: errorMessage(error),
        });
        continue;
      }

      switch (outcome.status) {
        case SecurityBlockOutcomeStatus.Blocked:
          made.set(target.value, outcome.block);
          break;
        case SecurityBlockOutcomeStatus.AlreadyBlocked: {
          const by: string = outcome.block.value || "";
          const read: SecurityBlockValue | null = readSecurityBlockValue(
            target.value,
          );

          outcomes.set(target.value, {
            state: SecurityPlaybookTargetState.AlreadyDone,
            detail:
              by && read && by !== read.value
                ? `already blocked (covered by ${by})`
                : "already blocked",
          });
          break;
        }
        // What protects it, as the blocklist said it: the step never touched it.
        case SecurityBlockOutcomeStatus.Protected:
          outcomes.set(target.value, {
            state: SecurityPlaybookTargetState.Protected,
            detail: outcome.message,
            protectedBy: outcome.protection.protectedValue,
          });
          break;
        default:
          outcomes.set(target.value, {
            state: SecurityPlaybookTargetState.Failed,
            detail: outcome.message,
          });
      }
    }

    const enforcement: Map<string, AddressBlockMade> =
      await this.readWhereEnforced({
        projectId: data.projectId,
        blocks: Array.from(made.values()),
        hasDestinations: found.destinations.length > 0,
      });

    const notEnforced: Array<string> = [];

    for (const [value, block] of made) {
      const read: AddressBlockMade = enforcement.get(block.id!.toString()) || {
        block,
        summary: { isEnforced: false, enforcedAt: [], notEnforcedAt: [] },
        pendingAt: [],
      };
      const described: { detail: string; isEnforcedSomewhere: boolean } =
        describeAddressBlockMade({ made: read, hasDestinations });

      if (!described.isEnforcedSomewhere) {
        notEnforced.push(value);
      }

      outcomes.set(value, {
        state: SecurityPlaybookTargetState.Done,
        detail: described.detail,
      });
    }

    const targets: Array<SecurityPlaybookTarget> = data.targets.map(
      (target: SecurityPlaybookTarget): SecurityPlaybookTarget => {
        const outcome: AddressOutcome | undefined =
          target.state === SecurityPlaybookTargetState.Proposed
            ? outcomes.get(target.value)
            : undefined;

        if (!outcome) {
          return target;
        }

        return {
          ...target,
          state: outcome.state,
          detail: outcome.detail,
          ...(outcome.protectedBy ? { protectedBy: outcome.protectedBy } : {}),
        };
      },
    );

    return this.summarize({
      definition,
      targets,
      notEnforced,
      hasDestinations,
    });
  }

  /*
   * Where each block the step made is enforced, after a reconcile of the
   * project's blocklist run here, so the step says it rather than "pending".
   * A reconcile that fails leaves the blocks as the queued one will apply
   * them: each then reads as being applied.
   */
  private static async readWhereEnforced(data: {
    projectId: ObjectID;
    blocks: Array<SecurityBlock>;
    hasDestinations: boolean;
  }): Promise<Map<string, AddressBlockMade>> {
    const read: Map<string, AddressBlockMade> = new Map();

    if (data.blocks.length === 0 || !data.hasDestinations) {
      return read;
    }

    try {
      await SecurityBlocklistReconciler.reconcileProject({
        projectId: data.projectId,
      });
    } catch (error) {
      logger.error(
        `SecurityPlaybookAddressBlocks: could not reconcile project ${data.projectId.toString()}'s blocklist after a block; the queued reconcile applies it:`,
      );
      logger.error(error);
    }

    let rows: Array<SecurityBlockEnforcement> = [];

    try {
      rows = await SecurityBlockEnforcementService.findForBlocks({
        projectId: data.projectId,
        securityBlockIds: data.blocks.map((block: SecurityBlock): ObjectID => {
          return block.id!;
        }),
      });
    } catch (error) {
      logger.error(
        `SecurityPlaybookAddressBlocks: could not read where project ${data.projectId.toString()}'s new blocks are enforced:`,
      );
      logger.error(error);
    }

    const now: Date = new Date();

    for (const block of data.blocks) {
      const ofBlock: Array<SecurityBlockEnforcement> = rows.filter(
        (row: SecurityBlockEnforcement): boolean => {
          return row.securityBlockId?.toString() === block.id!.toString();
        },
      );

      read.set(block.id!.toString(), {
        block,
        summary: getSecurityBlockEnforcementSummary(
          ofBlock as Array<SecurityBlockEnforcementShape>,
          now,
        ),
        pendingAt: ofBlock
          .filter((row: SecurityBlockEnforcement): boolean => {
            return row.state === SecurityBlockEnforcementState.Pending;
          })
          .map((row: SecurityBlockEnforcement): string => {
            return (row.destinationName || "").trim();
          })
          .filter((name: string): boolean => {
            return Boolean(name);
          }),
      });
    }

    return read;
  }

  /*
   * Lifts the block on each target the step is still to act on: Lift the
   * block on the address, run by a playbook as OneUptime.
   */
  public static async lift(data: {
    projectId: ObjectID;
    targets: Array<SecurityPlaybookTarget>;
    reason?: string | undefined;
  }): Promise<PlaybookStepOutcome> {
    const definition: SecurityPlaybookActionDefinition =
      getSecurityPlaybookAction(SecurityPlaybookActionType.LiftAddressBlock)!;

    const toActOn: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Proposed;
      },
    );

    if (toActOn.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Skipped,
        summary: SecurityPlaybookContainment.describeNothingToActOn({
          entityType: SecurityEntityType.IpAddress,
          targets: data.targets,
        }),
        targets: data.targets,
      };
    }

    const outcomes: Map<string, ContainmentTargetOutcome> = new Map();

    for (const target of toActOn) {
      outcomes.set(
        target.value,
        await this.liftOne({
          projectId: data.projectId,
          value: target.value,
          reason: data.reason,
          props: { isRoot: true },
        }),
      );
    }

    return this.summarize({
      definition,
      targets: data.targets.map(
        (target: SecurityPlaybookTarget): SecurityPlaybookTarget => {
          const outcome: ContainmentTargetOutcome | undefined =
            target.state === SecurityPlaybookTargetState.Proposed
              ? outcomes.get(target.value)
              : undefined;

          return outcome
            ? { ...target, state: outcome.state, detail: outcome.detail }
            : target;
        },
      ),
      notEnforced: [],
      hasDestinations: true,
    });
  }

  /*
   * Lifts the active block of exactly `value`: the one a step's run made,
   * when `securityPlaybookRunId` names the run (its undo). As `props`: a
   * person's undo is theirs, and held to their permission to lift.
   */
  public static async liftOne(data: {
    projectId: ObjectID;
    value: string;
    props: DatabaseCommonInteractionProps;
    reason?: string | undefined;
    securityPlaybookRunId?: ObjectID | undefined;
  }): Promise<ContainmentTargetOutcome> {
    const read: SecurityBlockValue | null = readSecurityBlockValue(data.value);

    if (!read) {
      return {
        state: SecurityPlaybookTargetState.NotFound,
        detail: "not an address the blocklist holds",
      };
    }

    try {
      const blocks: Array<SecurityBlock> = await SecurityBlockService.findBy({
        query: {
          projectId: data.projectId,
          state: SecurityBlockState.Active,
          value: read.value,
          ...(data.securityPlaybookRunId
            ? { securityPlaybookRunId: data.securityPlaybookRunId }
            : {}),
        },
        select: { _id: true, value: true, state: true },
        skip: 0,
        limit: 1,
        props: { isRoot: true },
      });
      const block: SecurityBlock | undefined = blocks[0];

      if (!block?.id) {
        // A range may hold it: lifting that lets a whole network in, a person's call.
        const covering: SecurityBlock | null =
          await SecurityBlockService.findCoveringBlock({
            projectId: data.projectId,
            value: read,
          });

        if (covering?.value && covering.value !== read.value) {
          return {
            state: SecurityPlaybookTargetState.Failed,
            detail: `blocked by the range ${covering.value}, which this step leaves alone: lift it on the Blocklist`,
          };
        }

        return {
          state: SecurityPlaybookTargetState.AlreadyDone,
          detail: "not blocked",
        };
      }

      const lifted: SecurityBlockLiftOutcome = await SecurityBlockService.lift({
        projectId: data.projectId,
        securityBlockId: block.id,
        reason: data.reason,
        props: data.props,
      });

      switch (lifted.status) {
        case SecurityBlockLiftStatus.Lifted:
          return { state: SecurityPlaybookTargetState.Done, detail: "lifted" };
        case SecurityBlockLiftStatus.AlreadyEnded:
          return {
            state: SecurityPlaybookTargetState.AlreadyDone,
            detail: "not blocked",
          };
        default:
          return {
            state: SecurityPlaybookTargetState.NotFound,
            detail: "not on the blocklist",
          };
      }
    } catch (error) {
      return {
        state: SecurityPlaybookTargetState.Failed,
        detail: errorMessage(error),
      };
    }
  }

  /*
   * What the step says, as a containment step says it (one line, each
   * target's outcome under it): failed when any target failed, when none
   * could be acted on, or when a block it made is enforced nowhere.
   */
  private static summarize(data: {
    definition: SecurityPlaybookActionDefinition;
    targets: Array<SecurityPlaybookTarget>;
    notEnforced: Array<string>;
    hasDestinations: boolean;
  }): PlaybookStepOutcome {
    const actedOn: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return (
          target.state === SecurityPlaybookTargetState.Done ||
          target.state === SecurityPlaybookTargetState.AlreadyDone
        );
      },
    );
    const failures: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return (
          target.state === SecurityPlaybookTargetState.Failed ||
          target.state === SecurityPlaybookTargetState.NotFound
        );
      },
    );

    const details: MarkdownText = FeedMarkdown.bulletList(
      data.targets.map((target: SecurityPlaybookTarget): MarkdownValue => {
        return mdText`${FeedMarkdown.code(target.value)}: ${describeTarget(target)}`;
      }),
    );

    const summary: MarkdownText =
      actedOn.length > 0
        ? mdText`${data.definition.title}: done for ${FeedMarkdown.join(
            actedOn.map((target: SecurityPlaybookTarget): MarkdownText => {
              return FeedMarkdown.code(target.value);
            }),
          )}${failures.length > 0 ? mdText`; ${String(failures.length)} could not be` : FeedMarkdown.empty()}.`
        : mdText`${data.definition.title}: no address of the case could be acted on.`;

    const errors: Array<string> = failures.map(
      (target: SecurityPlaybookTarget): string => {
        return `${target.value}: ${describeTarget(target)}`;
      },
    );

    if (data.notEnforced.length > 0) {
      errors.push(
        data.hasDestinations
          ? `Not enforced anywhere: ${data.notEnforced.join(", ")} is blocked on your blocklist, and no destination holds it yet.`
          : NOT_ENFORCED_ANYWHERE_ERROR,
      );
    }

    if (errors.length > 0 || actedOn.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Failed,
        summary,
        detailsInMarkdown: details,
        feedEventType: SecurityCaseFeedEventType.ResponseAction,
        targets: data.targets,
        error:
          errors.join(" ") ||
          `${data.definition.title}: no address of the case could be acted on.`,
      };
    }

    return {
      status: SecurityPlaybookStepStatus.Succeeded,
      summary,
      detailsInMarkdown: details,
      feedEventType: SecurityCaseFeedEventType.ResponseAction,
      targets: data.targets,
    };
  }
}
