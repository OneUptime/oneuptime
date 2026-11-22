import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_BLOCK_DEFAULT_DURATION,
  SECURITY_BLOCK_MESSAGES,
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorValue,
  isSecurityBlockAddressType,
  isSecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { describeSecurityAddressProtection } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { SecurityCaseMatchesJson } from "../../../Types/SecurityCase/SecurityCaseMatches";
import {
  SecurityEntityType,
  readSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { isCaseBlockableAddress } from "../../../Utils/SecurityCase/ResponsePlan/BlockableAddresses";
import { canonicalAddress } from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import SecurityBlockService, {
  SECURITY_BLOCK_ADMIN_PERMISSIONS,
} from "../../Services/SecurityBlockService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../Services/SecurityPlaybookRunService";
import { Service as SecurityPlaybookService } from "../../Services/SecurityPlaybookService";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import SecurityCaseMatches from "../SecurityCase/Context/SecurityCaseMatches";
import SecurityProtectedAddresses from "../SecurityBlocklist/SecurityProtectedAddresses";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * BLOCKING AN ADDRESS FROM A CASE, IN ONE CLICK (#10342).
 *
 * Block for 24 Hours on a case's Response Plan - Challenge Instead, Block
 * for 7 Days and Block Until Lifted beside it - and Block... on one of the
 * case's addresses start a one-step run of the playbook engine
 * (SecurityPlaybookRunService.startOneStepRun): no playbook written first,
 * and the same approvals, protected checks, timeline entries and audit
 * records as any playbook's block.
 *
 * Before the run is started, the person is told at once why not, in the
 * words the Blocklist page uses:
 *
 *   - the address is none the case may be blocked from: a public address of
 *     the case that its requests did not only claim (BlockableAddresses);
 *   - a block already covers it, and which;
 *   - it is protected - one of the project's own, or on its protected list
 *     - and by what, as they may be told it;
 *   - OneUptime could not tell whether it is one of the project's own;
 *   - a block until someone lifts it takes a Security Admin.
 *
 * The approval rule is a playbook's: a block cuts somebody off, so it waits
 * for someone else's approval - unless the person asking is one who may let
 * a containment step run without one (a Security Admin, a Project Admin or
 * Owner, SecurityPlaybookService.mayTurnOffContainmentApproval), whose
 * click is as a playbook step they saved with Needs Approval off, stamped
 * with who and when.
 */

export interface OneStepBlockRequest {
  securityCaseId: ObjectID;
  value: string;
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
}

export interface OneStepBlockStarted {
  run: SecurityPlaybookRun;
  // The block waits for someone else's approval before it is made.
  needsApproval: boolean;
}

export const NOT_BLOCKABLE_MESSAGE: string =
  "Only a public address the case's requests came from can be blocked from the case. An address the requests only claimed, or a private one, is never blocked from here.";

export const MATCHES_UNREAD_MESSAGE: string =
  "OneUptime could not read the case's requests to check the address. Try again in a minute.";

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export default class SecurityPlaybookOneStepRuns {
  // What a block from a case asks for, read from a request's body.
  public static readBlockRequest(body: JSONObject): OneStepBlockRequest {
    const caseId: string = readText(body["securityCaseId"]);
    const value: string = readText(body["value"]);
    const blockAction: string = readText(body["blockAction"]);
    const duration: string = readText(body["duration"]);

    if (!caseId || !ObjectID.isValidUUID(caseId)) {
      throw new BadDataException("Name the case to block the address from.");
    }

    if (!value || value.length > 100) {
      throw new BadDataException("Name the address to block.");
    }

    if (
      blockAction &&
      blockAction !== SecurityBlockAction.Block &&
      blockAction !== SecurityBlockAction.Challenge
    ) {
      throw new BadDataException("Choose Block or Challenge.");
    }

    if (duration && !isSecurityBlockDuration(duration)) {
      throw new BadDataException(
        "Choose how long the block lasts: 1 hour, 24 hours, 7 days, 30 days, or until someone lifts it.",
      );
    }

    return {
      securityCaseId: new ObjectID(caseId),
      value,
      blockAction:
        blockAction === SecurityBlockAction.Challenge
          ? SecurityBlockAction.Challenge
          : SecurityBlockAction.Block,
      duration: isSecurityBlockDuration(duration)
        ? duration
        : SECURITY_BLOCK_DEFAULT_DURATION,
    };
  }

  /*
   * Starts a person's one-step block of one of the case's addresses, or
   * says why not. The caller checked they may run playbooks and block.
   */
  @CaptureSpan()
  public static async startBlock(data: {
    projectId: ObjectID;
    request: OneStepBlockRequest;
    props: DatabaseCommonInteractionProps;
  }): Promise<OneStepBlockStarted> {
    const { projectId, request, props } = data;

    if (!props.userId) {
      throw new BadDataException("Only a person can block from a case.");
    }

    if (
      request.duration === SecurityBlockDuration.UntilLifted &&
      !props.isMasterAdmin &&
      !CallerPermission.holdsAnyOf(props, SECURITY_BLOCK_ADMIN_PERMISSIONS, {
        projectId,
      })
    ) {
      throw new BadDataException(SECURITY_BLOCK_MESSAGES.untilLiftedTakesAdmin);
    }

    // The case, as the person may read it: one they cannot see is not found.
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: request.securityCaseId, projectId },
        select: { _id: true, entities: true },
        props,
      });

    if (!securityCase?.id) {
      throw new NotFoundException("Security case not found.");
    }

    let matches: SecurityCaseMatchesJson | null;

    try {
      matches = await SecurityCaseMatches.build({
        projectId,
        securityCaseId: securityCase.id,
        props: { isRoot: true },
        now: OneUptimeDate.getCurrentDate(),
      });
    } catch (error) {
      logger.error(
        `SecurityPlaybookOneStepRuns: could not read case ${securityCase.id.toString()}'s requests to check an address:`,
      );
      logger.error(error);
      throw new BadDataException(MATCHES_UNREAD_MESSAGE);
    }

    const address: string | null = canonicalAddress(request.value);

    if (
      !address ||
      !isCaseBlockableAddress({
        value: address,
        entities: readSecurityEntities(securityCase.entities),
        matches,
      })
    ) {
      throw new BadDataException(NOT_BLOCKABLE_MESSAGE);
    }

    await this.assertBlockable({ projectId, address, props });

    const mayRunWithoutApproval: boolean =
      SecurityPlaybookService.mayTurnOffContainmentApproval(props);

    const step: SecurityPlaybookStep = {
      id: ObjectID.generate().toString(),
      action: SecurityPlaybookActionType.BlockAddress,
      config: {
        blockAction: request.blockAction,
        duration: request.duration,
      },
      requiresApproval: !mayRunWithoutApproval,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
      ...(mayRunWithoutApproval
        ? {
            approvalTurnedOff: {
              byUserId: props.userId.toString(),
              at: OneUptimeDate.getCurrentDate().toISOString(),
            },
          }
        : {}),
    };

    const target: SecurityPlaybookTarget = {
      type: SecurityEntityType.IpAddress,
      value: address,
      reason: SecurityPlaybookTargetReason.OnTheCase,
      state: SecurityPlaybookTargetState.Proposed,
    };

    const run: SecurityPlaybookRun =
      await SecurityPlaybookRunService.startOneStepRun({
        projectId,
        securityCaseId: securityCase.id,
        userId: props.userId,
        step,
        targets: [target],
      });

    return { run, needsApproval: !mayRunWithoutApproval };
  }

  /*
   * What a block of the address would meet, asked before the run is started,
   * as the Blocklist page asks it: already blocked, protected, or not known
   * to be safe. The block is checked again when the step makes it.
   */
  private static async assertBlockable(data: {
    projectId: ObjectID;
    address: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const check: Awaited<ReturnType<(typeof SecurityBlockService)["check"]>> =
      await SecurityBlockService.check({
        projectId: data.projectId,
        value: data.address,
        props: data.props,
      });
    const read: SecurityBlockIndicatorValue | null = check.value;

    // An address or a range: a domain or a file is blocked on every machine, never from here (#10346).
    if (
      check.problem ||
      !read ||
      !isSecurityBlockAddressType(read.indicatorType)
    ) {
      throw new BadDataException(
        check.problem || SECURITY_BLOCK_MESSAGES.notAnAddress,
      );
    }

    if (check.coveredBy) {
      throw new BadDataException(
        SECURITY_BLOCK_MESSAGES.alreadyBlocked({
          value: read.value,
          by: check.coveredBy.value || read.value,
        }),
      );
    }

    if (check.protection?.protection) {
      throw new BadDataException(
        describeSecurityAddressProtection({
          value: read.value,
          protection: SecurityProtectedAddresses.asSeenBy({
            protection: check.protection.protection,
            props: data.props,
            projectId: data.projectId,
          }),
        }),
      );
    }

    if (check.protection && check.protection.unreadSources.length > 0) {
      throw new BadDataException(
        SECURITY_BLOCK_MESSAGES.checkFailed({ value: read.value }),
      );
    }
  }
}
