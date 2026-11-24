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
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_CAMPAIGN_OF_ADDRESS_MAX,
  SecurityCampaignAddressCheck,
  SecurityCampaignAddressStanding,
  SecurityCampaignAddressesCheck,
  SecurityCampaignOfCaseAddress,
} from "../../../Types/SecurityEvent/SecurityCampaignContainment";
import SecurityCampaignContainment, {
  readCampaignValues,
} from "../SecurityEvent/SecurityCampaignContainment";
import { TelemetryServiceFilter } from "../Telemetry/TelemetryReadScope";
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

export const NOTHING_LEFT_IN_CAMPAIGN_MESSAGE: string =
  "Every address of the campaign is left out: each is already blocked, one of your own or protected, or used by a signed-in user lately. Nothing was blocked.";

/*
 * Block the Whole Campaign from a case (#10354): the case's address and
 * the other addresses of its campaign the person kept - none named: every
 * one - blocked together, in one run and one approval.
 */
export interface CampaignBlockRequest {
  securityCaseId: ObjectID;
  // The case's address whose campaign it is.
  value: string;
  // The campaign's other addresses the person kept; empty: every one.
  values: Array<string>;
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
}

export interface CampaignBlockStarted {
  run: SecurityPlaybookRun;
  needsApproval: boolean;
  // The addresses blocked, as targets of the run.
  blocking: Array<string>;
  // Every address asked about that is left out, with why.
  leftOut: Array<SecurityCampaignAddressCheck>;
}

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

    const step: SecurityPlaybookStep = this.blockStep({
      blockAction: request.blockAction,
      duration: request.duration,
      mayRunWithoutApproval,
      userId: props.userId,
    });

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

  // What Block the Whole Campaign asks for, read from a request's body.
  public static readCampaignBlockRequest(
    body: JSONObject,
  ): CampaignBlockRequest {
    const single: OneStepBlockRequest = this.readBlockRequest(body);

    return {
      ...single,
      values: readCampaignValues(
        body["values"],
        SECURITY_CAMPAIGN_OF_ADDRESS_MAX,
      ),
    };
  }

  /*
   * Starts Block the Whole Campaign: one run of the engine, one step, whose
   * targets are the case's address (On the Case) and its campaign's other
   * addresses (In the Campaign) - one approval lists them all, and the
   * approver may leave any out. The campaign is read again here, as the
   * person may read it, and only its addresses are taken. A protected or
   * own address is a target marked Protected, so the approval names it and
   * nothing acts on it; one already blocked, one a signed-in user used
   * lately, and one OneUptime could not check are left out and said.
   */
  @CaptureSpan()
  public static async startCampaignBlock(data: {
    projectId: ObjectID;
    request: CampaignBlockRequest;
    props: DatabaseCommonInteractionProps;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<CampaignBlockStarted> {
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

    const campaign: SecurityCampaignOfCaseAddress =
      await SecurityCampaignContainment.findCampaignOfCaseAddress({
        projectId,
        securityCaseId: securityCase.id,
        address,
        props,
        serviceFilter: data.serviceFilter,
      });
    const own: SecurityCampaignAddressesCheck =
      await SecurityCampaignContainment.checkAddresses({
        projectId,
        values: [campaign.address],
        props,
      });
    const picked: Set<string> = new Set(
      request.values.map((value: string): string => {
        return readSecurityBlockValue(value)?.value || value;
      }),
    );
    const others: Array<SecurityCampaignAddressCheck> =
      campaign.addresses.filter((check: SecurityCampaignAddressCheck) => {
        return picked.size === 0 || picked.has(check.value || check.typed);
      });

    const targets: Array<SecurityPlaybookTarget> = [];
    const blocking: Array<string> = [];
    const leftOut: Array<SecurityCampaignAddressCheck> = [];

    for (const [check, reason] of [
      ...own.addresses.map(
        (
          check: SecurityCampaignAddressCheck,
        ): [SecurityCampaignAddressCheck, SecurityPlaybookTargetReason] => {
          return [check, SecurityPlaybookTargetReason.OnTheCase];
        },
      ),
      ...others.map(
        (
          check: SecurityCampaignAddressCheck,
        ): [SecurityCampaignAddressCheck, SecurityPlaybookTargetReason] => {
          return [check, SecurityPlaybookTargetReason.InTheCampaign];
        },
      ),
    ]) {
      const value: string = check.value || check.typed;

      if (check.standing === SecurityCampaignAddressStanding.Blockable) {
        targets.push({
          type: SecurityEntityType.IpAddress,
          value,
          reason,
          state: SecurityPlaybookTargetState.Proposed,
        });
        blocking.push(value);
        continue;
      }

      if (
        check.standing === SecurityCampaignAddressStanding.Protected &&
        check.protection
      ) {
        targets.push({
          type: SecurityEntityType.IpAddress,
          value,
          reason,
          state: SecurityPlaybookTargetState.Protected,
          detail: describeSecurityAddressProtection({
            value,
            protection: check.protection,
          }),
        });
      }

      leftOut.push(check);
    }

    if (blocking.length === 0) {
      throw new BadDataException(NOTHING_LEFT_IN_CAMPAIGN_MESSAGE);
    }

    const mayRunWithoutApproval: boolean =
      SecurityPlaybookService.mayTurnOffContainmentApproval(props);

    const run: SecurityPlaybookRun =
      await SecurityPlaybookRunService.startOneStepRun({
        projectId,
        securityCaseId: securityCase.id,
        userId: props.userId,
        step: this.blockStep({
          blockAction: request.blockAction,
          duration: request.duration,
          mayRunWithoutApproval,
          userId: props.userId,
        }),
        targets,
      });

    return {
      run,
      needsApproval: !mayRunWithoutApproval,
      blocking,
      leftOut,
    };
  }

  // The one step of a person's block from a case: approval as a playbook's, unless they may turn it off.
  private static blockStep(data: {
    blockAction: SecurityBlockAction;
    duration: SecurityBlockDuration;
    mayRunWithoutApproval: boolean;
    userId: ObjectID;
  }): SecurityPlaybookStep {
    return {
      id: ObjectID.generate().toString(),
      action: SecurityPlaybookActionType.BlockAddress,
      config: {
        blockAction: data.blockAction,
        duration: data.duration,
      },
      requiresApproval: !data.mayRunWithoutApproval,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
      ...(data.mayRunWithoutApproval
        ? {
            approvalTurnedOff: {
              byUserId: data.userId.toString(),
              at: OneUptimeDate.getCurrentDate().toISOString(),
            },
          }
        : {}),
    };
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
