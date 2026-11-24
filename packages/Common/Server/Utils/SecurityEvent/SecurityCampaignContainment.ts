import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_REPEAT_OFFENDER_WINDOW_IN_MS,
  SecurityRepeatOffenderBlock,
  SecurityRepeatOffenderRecord,
  SecurityRepeatOffenderSummary,
  isSecurityRepeatOffence,
  summarizeSecurityRepeatOffender,
  writeSecurityRepeatOffenderSummary,
} from "../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SECURITY_BLOCK_MESSAGES,
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockIndicatorValue,
  SecurityBlockReach,
  SecurityBlockSource,
  SecurityBlockState,
  getSecurityBlockValueProblem,
  isWiderThanLargestRange,
  readSecurityBlockIndicator,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityAddressProtection,
  describeSecurityAddressProtection,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { getSecurityAddressSpellings } from "../../../Types/SecurityBlocklist/SecurityAddressSpellings";
import { getSecurityBlockUnheldMessage } from "../../../Types/SecurityBlocklist/SecurityBlockHolders";
import { SecurityAttackCampaign } from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import {
  SECURITY_ATTACK_NETWORK_ADDRESSES_MAX,
  SecurityAttackNetworkKind,
} from "../../../Types/SecurityEvent/SecurityAttackNetwork";
import {
  SECURITY_CAMPAIGN_BLOCK_MAX_ADDRESSES,
  SECURITY_CAMPAIGN_OF_ADDRESS_DAYS,
  SECURITY_CAMPAIGN_OF_ADDRESS_MAX,
  SecurityCampaignAddressCheck,
  SecurityCampaignAddressStanding,
  SecurityCampaignAddressesCheck,
  SecurityCampaignOfAddressRead,
  SecurityCampaignOfAddressRow,
  SecurityCampaignOfCaseAddress,
  SecurityCampaignSignedInUser,
  SecurityNetworkChallengeCheck,
  SecurityNetworkChallengeStanding,
  SecurityNetworkUncheckedReason,
  maySecurityNetworkBeChallenged,
} from "../../../Types/SecurityEvent/SecurityCampaignContainment";
import {
  SecurityEntityType,
  readSecurityEntities,
  SecurityEntity,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityBlockService, {
  SECURITY_BLOCK_ADMIN_PERMISSIONS,
  SecurityBlockOutcome,
  SecurityBlockOutcomeStatus,
} from "../../Services/SecurityBlockService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityEventService from "../../Services/SecurityEventService";
import CallerPermission from "../Permission/CallerPermission";
import SecurityRepeatOffenders from "../SecurityAutomaticResponse/SecurityRepeatOffenders";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressCheck,
  SecuritySignedInAddressState,
  SecuritySignedInManyCheck,
  SecuritySignedInUser,
} from "../SecurityAutomaticResponse/SecuritySignedInAddresses";
import SecurityBlockDestination, {
  isSecurityBlockForDestination,
} from "../SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations, {
  SecurityBlockDestinationsFound,
} from "../SecurityBlocklist/SecurityBlockDestinations";
import SecurityProtectedAddresses from "../SecurityBlocklist/SecurityProtectedAddresses";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { TelemetryServiceFilter } from "../Telemetry/TelemetryReadScope";

/*
 * CONTAINING A CAMPAIGN (#10354): what the Campaigns page's Block Addresses
 * and Challenge This Network check and do, and the campaign a case's
 * Block the Whole Campaign reads.
 *
 * Everything goes through the Blocklist's one way in, as the person
 * (SecurityBlockService.block with their props): the largest range, the
 * protected and own addresses, the audit log and the reconcile hold as for
 * any block - and a campaign has no case, so there is no playbook run to
 * make (#10342 made the row's Block Address the same way). A case's Block
 * the Whole Campaign is a run of the engine, made by
 * SecurityPlaybookOneStepRuns from what this reads.
 *
 * Beside what the Blocklist checks:
 *
 *   - an address a signed-in user used in the last 30 days is left out of
 *     Block Addresses, naming who: a campaign's address is often an
 *     office's NAT or a customer's proxy, as an automatic response knows
 *     (SecuritySignedInAddresses);
 *   - a network that holds such an address is never challenged, naming
 *     who; one OneUptime cannot check - a scrub rule hides addresses, a
 *     read failed, or it is a whole ASN, whose addresses no list names - is
 *     a Security Admin's to challenge knowingly, and refused for anyone
 *     else (fail toward a person).
 */

// How many checks or blocks run at once.
const CONCURRENCY: number = 5;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function eachInBatches<T, R>(
  items: ReadonlyArray<T>,
  work: (item: T) => Promise<R>,
): Promise<Array<R>> {
  const results: Array<R> = [];

  for (let index: number = 0; index < items.length; index += CONCURRENCY) {
    results.push(
      ...(await Promise.all(items.slice(index, index + CONCURRENCY).map(work))),
    );
  }

  return results;
}

function toUser(user: SecuritySignedInUser): SecurityCampaignSignedInUser {
  return {
    name: user.name,
    source: user.source,
    lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
  };
}

// The values asked for, each once by how blocks write it, in the order asked, at most `max`.
export function readCampaignValues(
  values: unknown,
  max: number,
): Array<string> {
  const seen: Set<string> = new Set();
  const kept: Array<string> = [];

  for (const value of Array.isArray(values) ? values : []) {
    const text: string = readText(value).slice(0, 100);
    const key: string = readSecurityBlockValue(text)?.value || text;

    if (!text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    kept.push(text);

    if (kept.length >= max) {
      break;
    }
  }

  return kept;
}

export interface SecurityNetworkChallengeRequest {
  value: string;
  duration: SecurityBlockDuration;
  reason?: string | undefined;
  // The person knows OneUptime cannot check who is in the network (Unchecked).
  acknowledgesUnchecked: boolean;
}

export default class SecurityCampaignContainment {
  // Whether the person may go past the largest range: a Security Admin, a Project Admin or Owner.
  public static isAdmin(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): boolean {
    if (props.isRoot) {
      return false;
    }

    return (
      Boolean(props.isMasterAdmin) ||
      CallerPermission.holdsAnyOf(props, SECURITY_BLOCK_ADMIN_PERMISSIONS, {
        projectId,
      })
    );
  }

  /*
   * Who used each address in the last 30 days, or why OneUptime cannot
   * tell: one read per source for them all. Never throws.
   */
  private static async findSignedIn(data: {
    projectId: ObjectID;
    values: Array<string>;
    now: Date;
  }): Promise<SecuritySignedInManyCheck> {
    const since: Date = new Date(
      data.now.getTime() - SECURITY_REPEAT_OFFENDER_WINDOW_IN_MS,
    );

    return await SecuritySignedInAddresses.checkMany({
      projectId: data.projectId,
      addresses: data.values.map((value: string) => {
        return { value, since };
      }),
      now: data.now,
    });
  }

  /*
   * Block Addresses' check: what a block of each address would meet, as
   * the person, before anything is blocked.
   */
  @CaptureSpan()
  public static async checkAddresses(data: {
    projectId: ObjectID;
    values: Array<string>;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityCampaignAddressesCheck> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const values: Array<string> = data.values.slice(
      0,
      SECURITY_CAMPAIGN_BLOCK_MAX_ADDRESSES,
    );
    const signedIn: SecuritySignedInManyCheck = await this.findSignedIn({
      projectId: data.projectId,
      values,
      now,
    });

    const addresses: Array<SecurityCampaignAddressCheck> = await eachInBatches(
      values,
      (value: string): Promise<SecurityCampaignAddressCheck> => {
        return this.checkAddress({
          projectId: data.projectId,
          typed: value,
          signedIn,
          props: data.props,
        });
      },
    );

    return {
      addresses,
      ...(signedIn.state === SecuritySignedInAddressState.CannotTell
        ? { signedInUnknownReason: signedIn.reason }
        : {}),
    };
  }

  private static async checkAddress(data: {
    projectId: ObjectID;
    typed: string;
    signedIn: SecuritySignedInManyCheck;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityCampaignAddressCheck> {
    const read: SecurityBlockIndicatorValue | null = readSecurityBlockIndicator(
      data.typed,
    );

    // Block Addresses blocks addresses: a range or a network is Challenge This Network's.
    if (!read || read.indicatorType !== SecurityBlockIndicatorType.IpAddress) {
      return {
        typed: data.typed,
        value: read?.value || null,
        standing: SecurityCampaignAddressStanding.Refused,
        problem: SECURITY_BLOCK_MESSAGES.notAnAddress,
      };
    }

    const check: Awaited<ReturnType<(typeof SecurityBlockService)["check"]>> =
      await SecurityBlockService.check({
        projectId: data.projectId,
        value: read.value,
        reach: SecurityBlockReach.Edge,
        props: data.props,
      });

    if (check.problem) {
      return {
        typed: data.typed,
        value: read.value,
        standing: SecurityCampaignAddressStanding.Refused,
        problem: check.problem,
      };
    }

    if (check.coveredBy) {
      return {
        typed: data.typed,
        value: read.value,
        standing: SecurityCampaignAddressStanding.AlreadyBlocked,
        coveredBy: check.coveredBy.value || read.value,
      };
    }

    if (check.protection?.protection) {
      const protection: SecurityAddressProtection =
        SecurityProtectedAddresses.asSeenBy({
          protection: check.protection.protection,
          props: data.props,
          projectId: data.projectId,
        });

      return {
        typed: data.typed,
        value: read.value,
        standing: SecurityCampaignAddressStanding.Protected,
        protection,
        problem: describeSecurityAddressProtection({
          value: read.value,
          protection,
        }),
      };
    }

    if (check.protection && check.protection.unreadSources.length > 0) {
      return {
        typed: data.typed,
        value: read.value,
        standing: SecurityCampaignAddressStanding.CannotTell,
        problem: SECURITY_BLOCK_MESSAGES.checkFailed({ value: read.value }),
      };
    }

    const users: Array<SecuritySignedInUser> =
      data.signedIn.state === SecuritySignedInAddressState.SignedIn
        ? data.signedIn.usersByAddress.get(read.value) || []
        : [];

    if (users.length > 0) {
      return {
        typed: data.typed,
        value: read.value,
        standing: SecurityCampaignAddressStanding.SignedIn,
        users: users.map(toUser),
        problem: `${users[0]!.name} signed in from ${read.value} in the last 30 days, so OneUptime left it out.`,
      };
    }

    return {
      typed: data.typed,
      value: read.value,
      standing: SecurityCampaignAddressStanding.Blockable,
    };
  }

  /*
   * Block Addresses: blocks each address as the person - or says why it
   * was left out - in one go. An address a signed-in user used lately is
   * left out first; the Blocklist checks the rest again as it blocks them.
   */
  @CaptureSpan()
  public static async blockAddresses(data: {
    projectId: ObjectID;
    values: Array<string>;
    action: SecurityBlockAction;
    duration: SecurityBlockDuration;
    reason?: string | undefined;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityCampaignAddressesCheck> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const values: Array<string> = data.values.slice(
      0,
      SECURITY_CAMPAIGN_BLOCK_MAX_ADDRESSES,
    );
    const signedIn: SecuritySignedInManyCheck = await this.findSignedIn({
      projectId: data.projectId,
      values,
      now,
    });

    const addresses: Array<SecurityCampaignAddressCheck> = [];

    // One at a time: a range made by one is the next one's "already blocked".
    for (const typed of values) {
      const read: SecurityBlockIndicatorValue | null =
        readSecurityBlockIndicator(typed);

      if (
        !read ||
        read.indicatorType !== SecurityBlockIndicatorType.IpAddress
      ) {
        addresses.push({
          typed,
          value: read?.value || null,
          standing: SecurityCampaignAddressStanding.Refused,
          problem: SECURITY_BLOCK_MESSAGES.notAnAddress,
        });
        continue;
      }

      const users: Array<SecuritySignedInUser> =
        signedIn.state === SecuritySignedInAddressState.SignedIn
          ? signedIn.usersByAddress.get(read.value) || []
          : [];

      if (users.length > 0) {
        addresses.push({
          typed,
          value: read.value,
          standing: SecurityCampaignAddressStanding.SignedIn,
          users: users.map(toUser),
          problem: `${users[0]!.name} signed in from ${read.value} in the last 30 days, so OneUptime left it out.`,
        });
        continue;
      }

      const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
        projectId: data.projectId,
        value: read.value,
        action: data.action,
        reach: SecurityBlockReach.Edge,
        duration: data.duration,
        ...(data.reason ? { reason: data.reason } : {}),
        props: data.props,
      });

      addresses.push(this.readOutcome({ typed, value: read.value, outcome }));
    }

    return {
      addresses,
      ...(signedIn.state === SecuritySignedInAddressState.CannotTell
        ? { signedInUnknownReason: signedIn.reason }
        : {}),
    };
  }

  private static readOutcome(data: {
    typed: string;
    value: string;
    outcome: SecurityBlockOutcome;
  }): SecurityCampaignAddressCheck {
    const { outcome } = data;

    switch (outcome.status) {
      case SecurityBlockOutcomeStatus.Blocked:
        return {
          typed: data.typed,
          value: outcome.block.value || data.value,
          standing: SecurityCampaignAddressStanding.Blocked,
        };
      case SecurityBlockOutcomeStatus.AlreadyBlocked:
        return {
          typed: data.typed,
          value: data.value,
          standing: SecurityCampaignAddressStanding.AlreadyBlocked,
          coveredBy: outcome.block.value || data.value,
          problem: outcome.message,
        };
      case SecurityBlockOutcomeStatus.Protected:
        return {
          typed: data.typed,
          value: data.value,
          standing: SecurityCampaignAddressStanding.Protected,
          protection: outcome.protection,
          problem: outcome.message,
        };
      default:
        return {
          typed: data.typed,
          value: data.value,
          standing:
            outcome.message ===
            SECURITY_BLOCK_MESSAGES.checkFailed({ value: data.value })
              ? SecurityCampaignAddressStanding.CannotTell
              : SecurityCampaignAddressStanding.Refused,
          problem: outcome.message,
        };
    }
  }

  // ---------- Challenge This Network ----------

  /*
   * Every block of a network by its ASN in the 30 days before `now`, the
   * latest first: SecurityRepeatOffenders reads addresses and ranges, and
   * an ASN is blocked by its own value alone.
   */
  private static async readAsnRecord(data: {
    projectId: ObjectID;
    value: string;
    now: Date;
  }): Promise<SecurityRepeatOffenderRecord> {
    const since: Date = new Date(
      data.now.getTime() - SECURITY_REPEAT_OFFENDER_WINDOW_IN_MS,
    );
    const blocks: Array<SecurityBlock> = await SecurityBlockService.findBy({
      query: {
        projectId: data.projectId,
        value: data.value,
        createdAt: QueryHelper.greaterThanEqualTo(since),
      },
      select: {
        _id: true,
        value: true,
        action: true,
        source: true,
        state: true,
        createdAt: true,
        securityCaseId: true,
        securityCase: { caseNumberWithPrefix: true },
      },
      sort: { createdAt: SortOrder.Descending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
    const records: Array<SecurityRepeatOffenderBlock> = blocks.map(
      (block: SecurityBlock): SecurityRepeatOffenderBlock => {
        return {
          securityBlockId: block.id?.toString() || "",
          value: block.value || data.value,
          action:
            block.action === SecurityBlockAction.Challenge
              ? SecurityBlockAction.Challenge
              : SecurityBlockAction.Block,
          source: block.source || SecurityBlockSource.Person,
          state: block.state || SecurityBlockState.Active,
          createdAt: block.createdAt ? new Date(block.createdAt) : data.now,
          securityCaseId: block.securityCaseId?.toString() || null,
          caseNumber: block.securityCase?.caseNumberWithPrefix || null,
        };
      },
    );
    const offences: Array<SecurityRepeatOffenderBlock> = records.filter(
      isSecurityRepeatOffence,
    );

    return {
      value: data.value,
      since,
      blocks: records,
      offenceCount: offences.length,
      last: offences[0] || null,
    };
  }

  // Blocked or challenged before, in the last 30 days; null when the blocklist could not be read.
  private static async readRepeat(data: {
    projectId: ObjectID;
    read: SecurityBlockIndicatorValue;
    now: Date;
  }): Promise<SecurityRepeatOffenderSummary | null> {
    try {
      const record: SecurityRepeatOffenderRecord =
        data.read.indicatorType === SecurityBlockIndicatorType.Asn
          ? await this.readAsnRecord({
              projectId: data.projectId,
              value: data.read.value,
              now: data.now,
            })
          : await SecurityRepeatOffenders.read({
              projectId: data.projectId,
              value: data.read.value,
              now: data.now,
            });

      return summarizeSecurityRepeatOffender(record);
    } catch {
      return null;
    }
  }

  /*
   * The edges a challenge of the network would hold at, by name: each
   * destination that challenges at the edge and holds such a value.
   */
  private static async findHolders(data: {
    projectId: ObjectID;
    read: SecurityBlockIndicatorValue;
  }): Promise<Array<string>> {
    const found: SecurityBlockDestinationsFound =
      await SecurityBlockDestinations.findForProject(data.projectId);
    const names: Array<string> = [];

    for (const destination of found.destinations as Array<SecurityBlockDestination>) {
      if (
        !isSecurityBlockForDestination({
          destination,
          block: {
            indicatorType: data.read.indicatorType,
            reach: SecurityBlockReach.Edge,
          },
        }) ||
        !destination.supports({
          indicatorType: data.read.indicatorType,
          action: SecurityBlockAction.Challenge,
          value: data.read.value,
        }).isSupported
      ) {
        continue;
      }

      const name: string = destination.name.trim();

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }

    return names;
  }

  /*
   * The addresses of an ASN that sent attacks over the window, as the
   * Campaigns page grouped them: what OneUptime knows of who is in it.
   */
  private static async readAsnAddresses(data: {
    projectId: ObjectID;
    asn: string;
    startTime: Date;
    endTime: Date;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<Array<string>> {
    const campaigns: Array<SecurityAttackCampaign> =
      await SecurityEventService.findAttackCampaigns({
        projectId: data.projectId,
        startTime: data.startTime,
        endTime: data.endTime,
        limit: SECURITY_ATTACK_NETWORK_ADDRESSES_MAX,
        maxLimit: SECURITY_ATTACK_NETWORK_ADDRESSES_MAX,
        serviceFilter: data.serviceFilter,
      });
    const addresses: Array<string> = [];

    for (const campaign of campaigns) {
      const address: string | null =
        campaign.asn === data.asn
          ? readSecurityBlockValue(campaign.sourceIp)?.value || null
          : null;

      if (address && !addresses.includes(address)) {
        addresses.push(address);
      }
    }

    return addresses;
  }

  /*
   * Challenge This Network's check: whether the person may challenge the
   * network now, and if not, why - with where it would hold, and whether
   * it was blocked or challenged before.
   */
  @CaptureSpan()
  public static async checkNetwork(data: {
    projectId: ObjectID;
    value: string;
    props: DatabaseCommonInteractionProps;
    // The window the page read: what OneUptime knows of an ASN's addresses.
    startTime: Date;
    endTime: Date;
    serviceFilter?: TelemetryServiceFilter | undefined;
    now?: Date | undefined;
  }): Promise<SecurityNetworkChallengeCheck> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const isAdmin: boolean = this.isAdmin(data.props, data.projectId);
    const read: SecurityBlockIndicatorValue | null = readSecurityBlockIndicator(
      data.value,
    );
    const kind: SecurityAttackNetworkKind =
      read?.indicatorType === SecurityBlockIndicatorType.Asn
        ? SecurityAttackNetworkKind.Asn
        : SecurityAttackNetworkKind.Range;

    const base: Pick<
      SecurityNetworkChallengeCheck,
      "value" | "kind" | "isAdmin" | "holders" | "repeat" | "suggestedDuration"
    > = {
      value: read?.value || readText(data.value),
      kind,
      isAdmin,
      holders: [],
      repeat: null,
      suggestedDuration: SecurityBlockDuration.OneDay,
    };

    if (
      !read ||
      (read.indicatorType !== SecurityBlockIndicatorType.IpRange &&
        read.indicatorType !== SecurityBlockIndicatorType.Asn)
    ) {
      return {
        ...base,
        standing: SecurityNetworkChallengeStanding.Refused,
        problem:
          "Name the network to challenge: a range, such as 203.0.113.0/24, or an ASN, such as AS64500.",
      };
    }

    // Nobody challenges a range wider than the widest one.
    const tooWide: string | null = getSecurityBlockValueProblem({
      value: read.value,
      mayBlockWideRanges: true,
    });

    if (tooWide) {
      return {
        ...base,
        standing: SecurityNetworkChallengeStanding.Refused,
        problem: tooWide,
      };
    }

    const [holders, repeat, coveredBy]: [
      Array<string>,
      SecurityRepeatOffenderSummary | null,
      SecurityBlock | null,
    ] = await Promise.all([
      this.findHolders({ projectId: data.projectId, read }),
      this.readRepeat({ projectId: data.projectId, read, now }),
      SecurityBlockService.findCoveringBlock({
        projectId: data.projectId,
        value: read,
        reach: SecurityBlockReach.Edge,
        now,
      }),
    ]);

    const checked: Pick<
      SecurityNetworkChallengeCheck,
      "value" | "kind" | "isAdmin" | "holders" | "repeat" | "suggestedDuration"
    > = {
      ...base,
      holders,
      repeat,
      suggestedDuration: repeat
        ? repeat.suggestedDuration
        : SecurityBlockDuration.OneDay,
    };

    if (holders.length === 0) {
      return {
        ...checked,
        standing: SecurityNetworkChallengeStanding.NotHeld,
        problem:
          getSecurityBlockUnheldMessage({
            indicatorType: read.indicatorType,
            action: SecurityBlockAction.Challenge,
            reach: SecurityBlockReach.Edge,
          }) ||
          "Nothing you have connected challenges a network. Turn on Block Addresses on your Cloudflare connection.",
      };
    }

    if (coveredBy) {
      return {
        ...checked,
        standing: SecurityNetworkChallengeStanding.AlreadyCovered,
        coveredBy: {
          value: coveredBy.value || read.value,
          action:
            coveredBy.action === SecurityBlockAction.Challenge
              ? SecurityBlockAction.Challenge
              : SecurityBlockAction.Block,
          expiresAt: coveredBy.expiresAt
            ? new Date(coveredBy.expiresAt).toISOString()
            : null,
        },
        problem: SECURITY_BLOCK_MESSAGES.alreadyBlocked({
          value: read.value,
          by: coveredBy.value || read.value,
        }),
      };
    }

    // A range: what the project protects in it, and who signed in from it.
    if (read.block) {
      const protection: Awaited<
        ReturnType<(typeof SecurityProtectedAddresses)["findProtection"]>
      > = await SecurityProtectedAddresses.findProtection({
        projectId: data.projectId,
        block: read.block,
      });

      if (protection.protection) {
        const seen: SecurityAddressProtection =
          SecurityProtectedAddresses.asSeenBy({
            protection: protection.protection,
            props: data.props,
            projectId: data.projectId,
          });

        return {
          ...checked,
          standing: SecurityNetworkChallengeStanding.Protected,
          protection: seen,
          problem: describeSecurityAddressProtection({
            value: read.value,
            protection: seen,
          }),
        };
      }

      if (protection.unreadSources.length > 0) {
        return {
          ...checked,
          standing: SecurityNetworkChallengeStanding.Refused,
          problem: SECURITY_BLOCK_MESSAGES.checkFailed({ value: read.value }),
        };
      }

      const signedIn: SecuritySignedInAddressCheck =
        await SecuritySignedInAddresses.check({
          projectId: data.projectId,
          value: read.value,
          now,
        });

      if (signedIn.state === SecuritySignedInAddressState.SignedIn) {
        return {
          ...checked,
          standing: SecurityNetworkChallengeStanding.SignedIn,
          users: signedIn.users.map(toUser),
          problem: `${signedIn.users[0]!.name} signed in from ${read.value} in the last 30 days, so OneUptime will not challenge it.`,
        };
      }

      if (!isAdmin && isWiderThanLargestRange(read.block)) {
        return {
          ...checked,
          standing: SecurityNetworkChallengeStanding.NeedsSecurityAdmin,
          problem:
            getSecurityBlockValueProblem({
              value: read.value,
              mayBlockWideRanges: false,
            }) || undefined,
        };
      }

      if (signedIn.state === SecuritySignedInAddressState.CannotTell) {
        return {
          ...checked,
          standing: SecurityNetworkChallengeStanding.Unchecked,
          uncheckedReason: SecurityNetworkUncheckedReason.SignedInCheck,
          uncheckedReasonText: signedIn.reason,
          problem: signedIn.reason,
        };
      }

      return {
        ...checked,
        standing: SecurityNetworkChallengeStanding.Challengeable,
      };
    }

    /*
     * An ASN: no list says which addresses it holds. OneUptime knows only
     * the addresses it saw attack from it: one of those a signed-in user
     * used refuses it; otherwise it cannot tell, and only a Security Admin
     * challenges it, knowingly.
     */
    const seen: Array<string> = await this.readAsnAddresses({
      projectId: data.projectId,
      asn: read.value,
      startTime: data.startTime,
      endTime: data.endTime,
      serviceFilter: data.serviceFilter,
    });
    const signedIn: SecuritySignedInManyCheck =
      seen.length > 0
        ? await this.findSignedIn({
            projectId: data.projectId,
            values: seen,
            now,
          })
        : {
            state: SecuritySignedInAddressState.SignedIn,
            usersByAddress: new Map(),
          };

    if (signedIn.state === SecuritySignedInAddressState.SignedIn) {
      const users: Array<SecuritySignedInUser> = Array.from(
        signedIn.usersByAddress.values(),
      ).flat();

      if (users.length > 0) {
        return {
          ...checked,
          standing: SecurityNetworkChallengeStanding.SignedIn,
          users: users.map(toUser),
          seenAddressCount: seen.length,
          problem: `${users[0]!.name} signed in from ${read.value} in the last 30 days, so OneUptime will not challenge it.`,
        };
      }
    }

    if (!isAdmin) {
      return {
        ...checked,
        standing: SecurityNetworkChallengeStanding.NeedsSecurityAdmin,
        seenAddressCount: seen.length,
        problem:
          getSecurityBlockValueProblem({
            value: read.value,
            mayBlockWideRanges: false,
          }) || undefined,
      };
    }

    return {
      ...checked,
      standing: SecurityNetworkChallengeStanding.Unchecked,
      uncheckedReason: SecurityNetworkUncheckedReason.Asn,
      seenAddressCount: seen.length,
      ...(signedIn.state === SecuritySignedInAddressState.CannotTell
        ? { uncheckedReasonText: signedIn.reason }
        : {}),
      problem: SECURITY_BLOCK_MESSAGES.asnUnchecked({ value: read.value }),
    };
  }

  /*
   * Challenge This Network: checked again, then challenged as the person
   * through the Blocklist. One OneUptime cannot check is challenged only by
   * a Security Admin who said they know (acknowledgesUnchecked).
   */
  @CaptureSpan()
  public static async challengeNetwork(data: {
    projectId: ObjectID;
    request: SecurityNetworkChallengeRequest;
    props: DatabaseCommonInteractionProps;
    startTime: Date;
    endTime: Date;
    serviceFilter?: TelemetryServiceFilter | undefined;
    now?: Date | undefined;
  }): Promise<{ check: SecurityNetworkChallengeCheck; block: SecurityBlock }> {
    const check: SecurityNetworkChallengeCheck = await this.checkNetwork({
      projectId: data.projectId,
      value: data.request.value,
      props: data.props,
      startTime: data.startTime,
      endTime: data.endTime,
      serviceFilter: data.serviceFilter,
      now: data.now,
    });

    if (!maySecurityNetworkBeChallenged(check)) {
      throw new BadDataException(
        check.standing === SecurityNetworkChallengeStanding.Unchecked
          ? `${check.problem || ""} Only a Security Admin, a Project Admin or a Project Owner can challenge it anyway.`.trim()
          : check.problem || `${check.value} cannot be challenged.`,
      );
    }

    if (
      check.standing === SecurityNetworkChallengeStanding.Unchecked &&
      !data.request.acknowledgesUnchecked
    ) {
      throw new BadDataException(
        `${check.problem || ""} Confirm that you know this to challenge it anyway.`.trim(),
      );
    }

    const outcome: SecurityBlockOutcome = await SecurityBlockService.block({
      projectId: data.projectId,
      value: check.value,
      action: SecurityBlockAction.Challenge,
      reach: SecurityBlockReach.Edge,
      duration: data.request.duration,
      ...(data.request.reason ? { reason: data.request.reason } : {}),
      acknowledgesUncheckedNetwork:
        check.standing === SecurityNetworkChallengeStanding.Unchecked &&
        data.request.acknowledgesUnchecked,
      props: data.props,
    });

    if (outcome.status !== SecurityBlockOutcomeStatus.Blocked) {
      throw new BadDataException(outcome.message);
    }

    return { check, block: outcome.block };
  }

  // ---------- A case's Block the Whole Campaign ----------

  /*
   * The campaign of one of a case's public addresses, as the person may
   * read it: the other addresses that sent the same requests with the same
   * tools over the Campaigns page's window, each with what a block of it
   * would meet. Throws when the case is not theirs to read, or the address
   * is none of its public ones.
   */
  @CaptureSpan()
  public static async findCampaignOfCaseAddress(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    address: string;
    props: DatabaseCommonInteractionProps;
    serviceFilter?: TelemetryServiceFilter | undefined;
    now?: Date | undefined;
  }): Promise<SecurityCampaignOfCaseAddress> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const address: string = await this.readCaseAddress(data);
    const read: SecurityCampaignOfAddressRead =
      await SecurityEventService.findCampaignOfAddress({
        projectId: data.projectId,
        spellings: getSecurityAddressSpellings(address),
        startTime: new Date(
          now.getTime() - SECURITY_CAMPAIGN_OF_ADDRESS_DAYS * 24 * 3600 * 1000,
        ),
        endTime: now,
        limit: SECURITY_CAMPAIGN_OF_ADDRESS_MAX,
        serviceFilter: data.serviceFilter,
      });

    const rows: Array<SecurityCampaignOfAddressRow> = this.foldCampaignRows({
      address,
      rows: read.addresses,
    });
    const isTruncated: boolean = rows.length > SECURITY_CAMPAIGN_OF_ADDRESS_MAX;
    const kept: Array<SecurityCampaignOfAddressRow> = rows.slice(
      0,
      SECURITY_CAMPAIGN_OF_ADDRESS_MAX,
    );
    const checked: SecurityCampaignAddressesCheck = await this.checkAddresses({
      projectId: data.projectId,
      values: kept.map((row: SecurityCampaignOfAddressRow): string => {
        return row.address;
      }),
      props: data.props,
      now,
    });

    return {
      address,
      userAgents: read.userAgents,
      addresses: kept.map(
        (row: SecurityCampaignOfAddressRow, index: number) => {
          return {
            ...checked.addresses[index]!,
            requestCount: row.requestCount,
            sharedTargetCount: row.sharedTargetCount,
          };
        },
      ),
      isTruncated,
      ...(checked.signedInUnknownReason
        ? { signedInUnknownReason: checked.signedInUnknownReason }
        : {}),
      windowInDays: SECURITY_CAMPAIGN_OF_ADDRESS_DAYS,
    };
  }

  /*
   * The case's address, as blocks write it, when it is one of the case's
   * public addresses the person may read; throws otherwise.
   */
  public static async readCaseAddress(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    address: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<string> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, entities: true },
        props: data.props,
      });

    if (!securityCase?.id) {
      throw new NotFoundException("Security case not found.");
    }

    const address: string | null = canonicalAddress(data.address);
    const isTheCases: boolean = Boolean(
      address &&
        readSecurityEntities(securityCase.entities).some(
          (entity: SecurityEntity): boolean => {
            return (
              entity.type === SecurityEntityType.IpAddress &&
              canonicalAddress(entity.value) === address
            );
          },
        ),
    );

    if (
      !address ||
      !isTheCases ||
      getSecurityAddressScope(address) !== SecurityAddressScope.Public
    ) {
      throw new BadDataException(
        "Name one of the case's public addresses to read its campaign.",
      );
    }

    return readSecurityBlockValue(address)?.value || address;
  }

  /*
   * The campaign's other addresses, each once by how blocks write it -
   * spellings of one address added up - public ones only (a private or
   * local address never reaches the app from the internet), never the
   * case's own, the most requests first.
   */
  public static foldCampaignRows(data: {
    address: string;
    rows: ReadonlyArray<SecurityCampaignOfAddressRow>;
  }): Array<SecurityCampaignOfAddressRow> {
    const byAddress: Map<string, SecurityCampaignOfAddressRow> = new Map();

    for (const row of data.rows) {
      const value: string | null =
        readSecurityBlockValue(row.address)?.value || null;

      if (
        !value ||
        value === data.address ||
        !NetworkAddressBlockUtil.parse(value) ||
        getSecurityAddressScope(value) !== SecurityAddressScope.Public
      ) {
        continue;
      }

      const known: SecurityCampaignOfAddressRow | undefined =
        byAddress.get(value);

      byAddress.set(
        value,
        known
          ? {
              address: value,
              requestCount: known.requestCount + row.requestCount,
              sharedTargetCount: Math.max(
                known.sharedTargetCount,
                row.sharedTargetCount,
              ),
              lastSeen:
                known.lastSeen > row.lastSeen ? known.lastSeen : row.lastSeen,
            }
          : { ...row, address: value },
      );
    }

    return Array.from(byAddress.values()).sort(
      (
        a: SecurityCampaignOfAddressRow,
        b: SecurityCampaignOfAddressRow,
      ): number => {
        return (
          b.requestCount - a.requestCount || a.address.localeCompare(b.address)
        );
      },
    );
  }

  // ---------- The wire ----------

  public static writeAddressesCheck(
    check: SecurityCampaignAddressesCheck,
  ): JSONObject {
    return check as unknown as JSONObject;
  }

  public static writeNetworkCheck(
    check: SecurityNetworkChallengeCheck,
  ): JSONObject {
    return {
      ...(check as unknown as JSONObject),
      repeat: check.repeat
        ? writeSecurityRepeatOffenderSummary(check.repeat)
        : null,
    };
  }
}
