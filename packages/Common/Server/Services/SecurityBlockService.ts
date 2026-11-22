import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityBlock";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import CallerPermission from "../Utils/Permission/CallerPermission";
import SecurityBlockDestination, {
  isSecurityBlockForDestination,
} from "../Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations, {
  SecurityBlockDestinationsFound,
} from "../Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistJobs from "../Utils/SecurityBlocklist/SecurityBlocklistJobs";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import SecurityBlockTimeline, {
  blockAddedMarkdown,
  blockExtendedMarkdown,
  blockLiftedMarkdown,
} from "../Utils/SecurityBlocklist/SecurityBlockTimeline";
import SecurityProtectedAddresses, {
  SecurityProtectionCheck,
} from "../Utils/SecurityBlocklist/SecurityProtectedAddresses";
import SecurityProtectedIndicators from "../Utils/SecurityBlocklist/SecurityProtectedIndicators";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  SECURITY_BLOCK_DURATION_IN_MS,
  SECURITY_BLOCK_MESSAGES,
  SECURITY_BLOCK_REASON_MAX_LENGTH,
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockIndicatorValue,
  SecurityBlockReach,
  SecurityBlockSource,
  SecurityBlockState,
  findCoveringSecurityBlock,
  getSecurityBlockActionProblem,
  getSecurityBlockExpiry,
  getSecurityBlockExpiryProblem,
  getSecurityBlockReach,
  getSecurityBlockValueProblem,
  isSecurityBlockAction,
  isSecurityBlockAddressType,
  isSecurityBlockInForce,
  isSecurityBlockReach,
  isSecurityBlockSource,
  readSecurityBlockIndicator,
} from "../../Types/SecurityBlocklist/SecurityBlock";
import { getSecurityBlockUnheldMessage } from "../../Types/SecurityBlocklist/SecurityBlockHolders";
import { SecurityBlockEnforcementState } from "../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  SecurityAddressProtection,
  describeSecurityAddressProtection,
} from "../../Types/SecurityBlocklist/SecurityProtectedAddress";
import UserType from "../../Types/UserType";

/*
 * THE BLOCKLIST'S ONE WAY IN (#10338). Every block - a person's on the
 * Blocklist page, an API key's, a playbook's step, an automatic response's,
 * OneUptime AI's - is made here, by block() or by a create through the API,
 * which runs the same checks. Before a block is written:
 *
 *   - its value is written the one way blocks are (an address, or a range
 *     as its first address and length), and a range is no wider than the
 *     largest one - a /24 of IPv4, a /48 of IPv6 - unless a person with
 *     Security Admin (or a Project Owner or Admin) asks for it, and never
 *     wider than a /8 or a /16;
 *   - it expires: in 24 hours unless asked otherwise, and never past a
 *     year; only a Security Admin keeps one until someone lifts it;
 *   - a value an active block already covers is already blocked, and the
 *     answer names the block that covers it;
 *   - a protected address - on the project's Protected Entities list, one of
 *     its own (a host's, a load balancer's, a probe's), OneUptime Cloud's, a
 *     private range, the edge in front of it - is refused, saying what
 *     protects it. When OneUptime cannot read what would protect it, the
 *     block is refused too: it fails toward a person.
 *
 * Once written, it goes on its case's timeline (when it has one) and in the
 * audit log (as every create is), and the project's blocklist is
 * reconciled at once, so a destination holds it within seconds.
 *
 * A block ends by being lifted - its state set to Lifted, with a reason -
 * or by expiring (SecurityBlockExpiry); its end can be moved while it is
 * active, and only a Security Admin removes it. A block is never deleted:
 * the record of it is how a case says an address was blocked before.
 */

// What a block() call is asked.
export interface SecurityBlockRequest {
  projectId: ObjectID;
  /*
   * As typed: an address, a range written as an address and a length, a
   * domain, an http or https URL, or a file's MD5, SHA-1 or SHA-256 hash.
   */
  value: string;
  // Block unless asked to challenge an address, or to block and quarantine a file.
  action?: SecurityBlockAction | undefined;
  /*
   * Where it is enforced: an address at the edge unless asked for
   * everywhere (on every machine too); anything else always everywhere.
   */
  reach?: SecurityBlockReach | undefined;
  /*
   * How long it lasts, from now: 24 hours unless given. Or when it ends
   * (expiresAt), null to keep it until someone lifts it. A duration wins
   * when both are given.
   */
  duration?: SecurityBlockDuration | undefined;
  expiresAt?: Date | null | undefined;
  reason?: string | undefined;
  securityCaseId?: ObjectID | undefined;
  /*
   * Who or what blocks it. OneUptime's own writes (root props) say it
   * themselves; a person's and an API key's are read from their props.
   */
  source?: SecurityBlockSource | undefined;
  securityPlaybookRunId?: ObjectID | undefined;
  props: DatabaseCommonInteractionProps;
}

export enum SecurityBlockOutcomeStatus {
  Blocked = "Blocked",
  AlreadyBlocked = "AlreadyBlocked",
  Protected = "Protected",
  Refused = "Refused",
}

export type SecurityBlockOutcome =
  | { status: SecurityBlockOutcomeStatus.Blocked; block: Model }
  | {
      status: SecurityBlockOutcomeStatus.AlreadyBlocked;
      // The active block that covers the value: the same one, or a range holding it.
      block: Model;
      message: string;
    }
  | {
      status: SecurityBlockOutcomeStatus.Protected;
      protection: SecurityAddressProtection;
      message: string;
    }
  | { status: SecurityBlockOutcomeStatus.Refused; message: string };

export enum SecurityBlockLiftStatus {
  Lifted = "Lifted",
  AlreadyEnded = "AlreadyEnded",
  NotFound = "NotFound",
}

export interface SecurityBlockLiftOutcome {
  status: SecurityBlockLiftStatus;
  block?: Model | undefined;
}

/*
 * The roles that may go past what everyone may: block a range wider than
 * the largest one, and keep a block until someone lifts it.
 */
export const SECURITY_BLOCK_ADMIN_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
];

// What a block's checks read of it.
const BLOCK_SELECT: {
  _id: true;
  projectId: true;
  value: true;
  indicatorType: true;
  action: true;
  reach: true;
  state: true;
  expiresAt: true;
  createdAt: true;
  securityCaseId: true;
} = {
  _id: true,
  projectId: true,
  value: true,
  indicatorType: true,
  action: true,
  reach: true,
  state: true,
  expiresAt: true,
  createdAt: true,
  securityCaseId: true,
};

// What one update did to its rows, for its timeline lines once it is written.
interface UpdateCarry {
  rows: Array<Model>;
  isLift: boolean;
  expiresAt?: Date | null | undefined;
  liftReason?: string | undefined;
  userId?: ObjectID | undefined;
}

function isPerson(props: DatabaseCommonInteractionProps): boolean {
  return (
    !props.isRoot &&
    (props.userType === UserType.User ||
      props.userType === UserType.MasterAdmin ||
      (!props.userType && Boolean(props.userId)))
  );
}

export class Service extends ProjectReferencesService<Model> {
  /*
   * The records block() checked already: their create skips the checks it
   * just ran. Only this service adds to it, so a create through the API is
   * always checked.
   */
  private readonly checkedRecords: WeakSet<Model> = new WeakSet<Model>();

  public constructor() {
    super(Model);
  }

  // ---------- What other code calls ----------

  /*
   * Blocks an address, a range, a domain, a URL or a file, or says why not:
   * already blocked (and by what), protected (and by what), or refused (and
   * why) - a domain, a URL or a file nothing the project connected could
   * hold among them. Throws only when the caller may not block at all, or
   * the write itself fails.
   */
  @CaptureSpan()
  public async block(
    data: SecurityBlockRequest,
  ): Promise<SecurityBlockOutcome> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const record: Model = new Model();

    record.projectId = data.projectId;
    record.value = data.value;
    record.action = data.action || SecurityBlockAction.Block;

    if (data.reach !== undefined) {
      record.reach = data.reach;
    }

    record.expiresAt =
      data.duration !== undefined
        ? (getSecurityBlockExpiry(data.duration, now) as Date)
        : (data.expiresAt as Date);

    if (data.reason !== undefined) {
      record.reason = data.reason;
    }

    if (data.securityCaseId) {
      record.securityCaseId = data.securityCaseId;
    }

    if (data.props.isRoot) {
      record.source = data.source || SecurityBlockSource.Api;

      if (data.securityPlaybookRunId) {
        record.securityPlaybookRunId = data.securityPlaybookRunId;
      }
    }

    /*
     * Asked first, as the create would ask it: a caller who may not block
     * learns nothing of the project's addresses from the answer.
     */
    if (!data.props.isRoot) {
      const asked: Model = new Model();
      asked.projectId = data.projectId;
      asked.value = data.value;
      asked.action = record.action;

      if (record.reach !== undefined) {
        asked.reach = record.reach;
      }

      if (data.securityCaseId) {
        asked.securityCaseId = data.securityCaseId;
      }

      await this.checkCallerMayCreate({ data: asked, props: data.props });
    }

    const refusal: SecurityBlockOutcome | null =
      this.normalize({ record, props: data.props, now }) ||
      (await this.checkTargets({ record, props: data.props, now }));

    if (refusal) {
      return refusal;
    }

    this.checkedRecords.add(record);

    try {
      const block: Model = await this.create({
        data: record,
        props: data.props,
      });

      return { status: SecurityBlockOutcomeStatus.Blocked, block };
    } catch (error) {
      /*
       * Two blocks of one value at once: the second insert meets the index
       * that keeps one active block per value and reach, and is already
       * blocked.
       */
      // normalize() wrote where it is enforced.
      const covering: Model | null = await this.findCoveringBlock({
        projectId: data.projectId,
        value: readSecurityBlockIndicator(record.value)!,
        reach: record.reach || SecurityBlockReach.Edge,
        now,
      });

      if (covering) {
        return this.alreadyBlocked(record.value || data.value, covering);
      }

      throw error;
    }
  }

  // Lifts one active block, with why. Read as the caller reads blocks.
  @CaptureSpan()
  public async lift(data: {
    projectId: ObjectID;
    securityBlockId: ObjectID;
    reason?: string | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityBlockLiftOutcome> {
    const block: Model | null = await this.findOneBy({
      query: { _id: data.securityBlockId, projectId: data.projectId },
      select: BLOCK_SELECT,
      props: data.props,
    });

    if (!block) {
      return { status: SecurityBlockLiftStatus.NotFound };
    }

    if (block.state !== SecurityBlockState.Active) {
      return { status: SecurityBlockLiftStatus.AlreadyEnded, block };
    }

    await this.updateOneById({
      id: data.securityBlockId,
      data: {
        state: SecurityBlockState.Lifted,
        ...(data.reason !== undefined ? { liftReason: data.reason } : {}),
      },
      props: data.props,
    });

    return { status: SecurityBlockLiftStatus.Lifted, block };
  }

  /*
   * Moves an active block's end: to `expiresAt`, or - null - until someone
   * lifts it, which takes a Security Admin.
   */
  @CaptureSpan()
  public async extend(data: {
    projectId: ObjectID;
    securityBlockId: ObjectID;
    expiresAt: Date | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    await this.updateOneBy({
      query: { _id: data.securityBlockId, projectId: data.projectId },
      data: { expiresAt: data.expiresAt as Date },
      props: data.props,
    });
  }

  // The project's blocks in force at `now`: active, and not past their expiry.
  @CaptureSpan()
  public async findActiveBlocks(data: {
    projectId: ObjectID;
    now?: Date | undefined;
    limit?: number | undefined;
  }): Promise<Array<Model>> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const blocks: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        state: SecurityBlockState.Active,
      },
      select: BLOCK_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: data.limit || LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    return blocks.filter((block: Model): boolean => {
      return isSecurityBlockInForce(block, now);
    });
  }

  /*
   * The active block that covers a value where it is to be enforced: one of
   * the same value, else - for an address - the narrowest active range that
   * holds it. A block everywhere covers one at the edge, never the other way
   * round (findCoveringSecurityBlock).
   */
  @CaptureSpan()
  public async findCoveringBlock(data: {
    projectId: ObjectID;
    value: SecurityBlockIndicatorValue;
    reach?: SecurityBlockReach | undefined;
    now?: Date | undefined;
  }): Promise<Model | null> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const [same, ranges]: [Array<Model>, Array<Model>] = await Promise.all([
      // At most one at each reach.
      this.findBy({
        query: {
          projectId: data.projectId,
          state: SecurityBlockState.Active,
          value: data.value.value,
        },
        select: BLOCK_SELECT,
        skip: 0,
        limit: 2,
        props: { isRoot: true },
      }),
      data.value.block
        ? this.findBy({
            query: {
              projectId: data.projectId,
              state: SecurityBlockState.Active,
              indicatorType: SecurityBlockIndicatorType.IpRange,
            },
            select: BLOCK_SELECT,
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const inForce: Array<Model> = [...same, ...ranges].filter(
      (block: Model): boolean => {
        return Boolean(block.value) && isSecurityBlockInForce(block, now);
      },
    );

    return findCoveringSecurityBlock(
      data.value,
      inForce as Array<Model & { value: string }>,
      data.reach || SecurityBlockReach.Edge,
    );
  }

  /*
   * What a block of `value` would meet, asked without blocking: the value as
   * it would be kept, what is wrong with it, the block that covers it and
   * what protects it - what the Blocklist page says before it sends one.
   */
  @CaptureSpan()
  public async check(data: {
    projectId: ObjectID;
    value: string;
    reach?: SecurityBlockReach | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    value: SecurityBlockIndicatorValue | null;
    problem: string | null;
    coveredBy: Model | null;
    protection: SecurityProtectionCheck | null;
  }> {
    const read: SecurityBlockIndicatorValue | null = readSecurityBlockIndicator(
      data.value,
    );
    const problem: string | null = getSecurityBlockValueProblem({
      value: data.value,
      mayBlockWideRanges: this.mayGoPastLimits(data.props, data.projectId),
    });

    if (!read || problem) {
      return { value: read, problem, coveredBy: null, protection: null };
    }

    const [coveredBy, protection]: [Model | null, SecurityProtectionCheck] =
      await Promise.all([
        this.findCoveringBlock({
          projectId: data.projectId,
          value: read,
          reach: getSecurityBlockReach({
            indicatorType: read.indicatorType,
            reach: data.reach,
          }),
        }),
        this.findProtection({ projectId: data.projectId, value: read }),
      ]);

    return { value: read, problem: null, coveredBy, protection };
  }

  // ---------- The checks ----------

  /*
   * Whether the caller may go past what everyone may: a person (or API key)
   * with Security Admin, Project Admin or Project Owner. Never OneUptime's
   * own writes - a playbook, a policy, OneUptime AI - whatever they act for.
   */
  private mayGoPastLimits(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): boolean {
    if (props.isRoot) {
      return false;
    }

    if (props.isMasterAdmin) {
      return true;
    }

    return CallerPermission.holdsAnyOf(
      props,
      SECURITY_BLOCK_ADMIN_PERMISSIONS,
      {
        projectId,
      },
    );
  }

  private alreadyBlocked(value: string, covering: Model): SecurityBlockOutcome {
    return {
      status: SecurityBlockOutcomeStatus.AlreadyBlocked,
      block: covering,
      message: SECURITY_BLOCK_MESSAGES.alreadyBlocked({
        value,
        by: covering.value || value,
      }),
    };
  }

  /*
   * Readies a record for its write: its value as kept, its action and its
   * end - and says why not, when it is not to be written. Null when it may
   * be. Reads nothing, so a create runs it again on the record as the
   * caller's create left it. What only OneUptime writes - the kind of value,
   * who made it - is written once the create is permitted
   * (onCreatePermitted): written here, a person's create would be held to
   * them and refused.
   */
  private normalize(data: {
    record: Model;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): SecurityBlockOutcome | null {
    const { record, props, now } = data;
    const refused: (message: string) => SecurityBlockOutcome = (
      message: string,
    ): SecurityBlockOutcome => {
      return { status: SecurityBlockOutcomeStatus.Refused, message };
    };

    if (!record.projectId) {
      return refused("A block needs a project.");
    }

    /*
     * Past the largest range only for a person or a key with Security Admin:
     * OneUptime's own writes keep to it, whatever they act for.
     */
    const mayGoPastLimits: boolean = this.mayGoPastLimits(
      props,
      record.projectId,
    );

    const problem: string | null = getSecurityBlockValueProblem({
      value: record.value,
      mayBlockWideRanges: mayGoPastLimits,
    });

    if (problem) {
      return refused(problem);
    }

    const read: SecurityBlockIndicatorValue = readSecurityBlockIndicator(
      record.value,
    )!;
    record.value = read.value;

    if (record.action === undefined || record.action === null) {
      record.action = SecurityBlockAction.Block;
    }

    if (!isSecurityBlockAction(record.action)) {
      return refused(SECURITY_BLOCK_MESSAGES.chooseAction);
    }

    if (
      record.reach !== undefined &&
      record.reach !== null &&
      !isSecurityBlockReach(record.reach)
    ) {
      return refused(
        "Choose where the block is enforced: Edge, or Everywhere for every machine too.",
      );
    }

    // An address where it was asked for, at the edge unless said; anything else everywhere.
    record.reach = getSecurityBlockReach({
      indicatorType: read.indicatorType,
      reach: record.reach,
    });

    const actionProblem: string | null = getSecurityBlockActionProblem({
      indicatorType: read.indicatorType,
      action: record.action,
      reach: record.reach,
    });

    if (actionProblem) {
      return refused(actionProblem);
    }

    // Every block expires unless someone who may asks for one that does not.
    if (record.expiresAt === undefined) {
      record.expiresAt = new Date(
        now.getTime() +
          SECURITY_BLOCK_DURATION_IN_MS[SecurityBlockDuration.OneDay],
      );
    } else if (record.expiresAt === null) {
      if (!props.isRoot && !mayGoPastLimits) {
        return refused(SECURITY_BLOCK_MESSAGES.untilLiftedTakesAdmin);
      }
    } else {
      const expiresAt: Date = new Date(record.expiresAt);
      const expiryProblem: string | null = getSecurityBlockExpiryProblem({
        expiresAt,
        now,
      });

      if (expiryProblem) {
        return refused(expiryProblem);
      }

      record.expiresAt = expiresAt;
    }

    if (
      typeof record.reason === "string" &&
      record.reason.trim().length > SECURITY_BLOCK_REASON_MAX_LENGTH
    ) {
      return refused(SECURITY_BLOCK_MESSAGES.reasonTooLong);
    }

    if (typeof record.reason === "string") {
      const reason: string = record.reason.trim();

      if (reason) {
        record.reason = reason;
      } else {
        delete record.reason;
      }
    }

    return null;
  }

  /*
   * What protects a value, read as OneUptime: an address's or a range's
   * sources (SecurityProtectedAddresses), or a domain's, a URL's or a
   * file's (SecurityProtectedIndicators). Never throws.
   */
  private async findProtection(data: {
    projectId: ObjectID;
    value: SecurityBlockIndicatorValue;
  }): Promise<SecurityProtectionCheck> {
    return data.value.block
      ? await SecurityProtectedAddresses.findProtection({
          projectId: data.projectId,
          block: data.value.block,
        })
      : await SecurityProtectedIndicators.findProtection({
          projectId: data.projectId,
          indicator: data.value,
        });
  }

  /*
   * Why a domain, a URL, a file - or an address everywhere - would be
   * refused because nothing the project connected could hold it, or null.
   * An address at the edge is kept whatever is connected, and says it is
   * not enforced anywhere until something is (#10338). While a kind of
   * destination cannot be listed, nobody can tell: the block is made, and
   * the reconciler says where it holds.
   */
  private async checkHolders(data: {
    record: Model;
    read: SecurityBlockIndicatorValue;
  }): Promise<SecurityBlockOutcome | null> {
    const reach: SecurityBlockReach =
      data.record.reach || SecurityBlockReach.Edge;
    const action: SecurityBlockAction =
      data.record.action || SecurityBlockAction.Block;

    if (
      isSecurityBlockAddressType(data.read.indicatorType) &&
      reach === SecurityBlockReach.Edge
    ) {
      return null;
    }

    const found: SecurityBlockDestinationsFound =
      await SecurityBlockDestinations.findForProject(data.record.projectId!);

    if (found.failedProviders.length > 0) {
      return null;
    }

    const isHeld: boolean = found.destinations.some(
      (destination: SecurityBlockDestination): boolean => {
        return (
          isSecurityBlockForDestination({
            destination,
            block: { indicatorType: data.read.indicatorType, reach },
          }) &&
          destination.supports({
            indicatorType: data.read.indicatorType,
            action,
            value: data.read.value,
          }).isSupported
        );
      },
    );

    if (isHeld) {
      return null;
    }

    const message: string | null = getSecurityBlockUnheldMessage({
      indicatorType: data.read.indicatorType,
      action,
      reach,
    });

    return message
      ? { status: SecurityBlockOutcomeStatus.Refused, message }
      : null;
  }

  /*
   * What the block would meet, read as OneUptime: an active block that
   * covers it already, a value it must never touch, or - for a domain, a
   * URL, a file or an address everywhere - nothing connected that could
   * hold it. Null when there is none of them. Run on a normalized record.
   * What protects it is told the caller as the caller may be told it
   * (asSeenBy): a record they may not read is named as one of the
   * project's own, never by name.
   */
  private async checkTargets(data: {
    record: Model;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<SecurityBlockOutcome | null> {
    const { record, now } = data;
    const read: SecurityBlockIndicatorValue | null = readSecurityBlockIndicator(
      record.value,
    );

    if (!record.projectId || !read) {
      return {
        status: SecurityBlockOutcomeStatus.Refused,
        message: SECURITY_BLOCK_MESSAGES.notAValue,
      };
    }

    const covering: Model | null = await this.findCoveringBlock({
      projectId: record.projectId,
      value: read,
      reach: record.reach || SecurityBlockReach.Edge,
      now,
    });

    if (covering) {
      return this.alreadyBlocked(read.value, covering);
    }

    const check: SecurityProtectionCheck = await this.findProtection({
      projectId: record.projectId,
      value: read,
    });

    if (check.protection) {
      const protection: SecurityAddressProtection =
        SecurityProtectedAddresses.asSeenBy({
          protection: check.protection,
          props: data.props,
          projectId: record.projectId,
        });

      return {
        status: SecurityBlockOutcomeStatus.Protected,
        protection,
        message: describeSecurityAddressProtection({
          value: read.value,
          protection,
        }),
      };
    }

    // What would protect it could not be read: fail toward a person.
    if (check.unreadSources.length > 0) {
      return {
        status: SecurityBlockOutcomeStatus.Refused,
        message: SECURITY_BLOCK_MESSAGES.checkFailed({ value: read.value }),
      };
    }

    return await this.checkHolders({ record, read });
  }

  /*
   * Who makes the block: OneUptime's own writes say it themselves (a
   * playbook, a policy, OneUptime AI); an API key, a workflow and a person
   * are read from their props.
   */
  private getSource(
    record: Model,
    props: DatabaseCommonInteractionProps,
  ): SecurityBlockSource {
    if (props.isRoot) {
      return isSecurityBlockSource(record.source)
        ? record.source
        : SecurityBlockSource.Api;
    }

    return isPerson(props)
      ? SecurityBlockSource.Person
      : SecurityBlockSource.Api;
  }

  // ---------- The hooks ----------

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);
    const now: Date = OneUptimeDate.getCurrentDate();

    /*
     * Normalized again, as the create left the caller's record. A block()
     * call has read what the block would meet already; a create through the
     * API reads it here.
     */
    const refusal: SecurityBlockOutcome | null =
      this.normalize({ record: createBy.data, props: createBy.props, now }) ||
      (this.checkedRecords.has(createBy.data)
        ? null
        : await this.checkTargets({
            record: createBy.data,
            props: createBy.props,
            now,
          }));

    this.checkedRecords.delete(createBy.data);

    if (refusal && refusal.status !== SecurityBlockOutcomeStatus.Blocked) {
      throw new BadDataException(refusal.message);
    }

    return onCreate;
  }

  /*
   * What OneUptime records about the block itself, which no caller writes:
   * the kind of value it holds, and who or what made it - written once the
   * caller's create has passed every check, so it is never held against
   * their column permissions. A new block is Active.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const record: Model = onCreate.createBy.data;
    const read: SecurityBlockIndicatorValue | null = readSecurityBlockIndicator(
      record.value,
    );

    if (read) {
      record.indicatorType = read.indicatorType;
    }

    record.source = this.getSource(record, onCreate.createBy.props);
    record.state = SecurityBlockState.Active;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const projectId: ObjectID | undefined =
      createdItem.projectId || onCreate.createBy.data.projectId;

    if (!projectId) {
      return createdItem;
    }

    // The case, whichever name the create gave it by (one column).
    const securityCaseId: ObjectID | null =
      RelationIdUtil.readConsistent(
        createdItem as unknown as Record<string, unknown>,
        ["securityCaseId", "securityCase"],
        "Case",
      ) ||
      RelationIdUtil.readConsistent(
        onCreate.createBy.data as unknown as Record<string, unknown>,
        ["securityCaseId", "securityCase"],
        "Case",
      );

    if (securityCaseId) {
      const found: SecurityBlockDestinationsFound =
        await SecurityBlockDestinations.findForProject(projectId);
      const source: SecurityBlockSource =
        onCreate.createBy.data.source || SecurityBlockSource.Person;
      const indicatorType: SecurityBlockIndicatorType =
        onCreate.createBy.data.indicatorType ||
        SecurityBlockIndicatorType.IpAddress;
      const reach: SecurityBlockReach =
        onCreate.createBy.data.reach || SecurityBlockReach.Edge;

      await SecurityBlockTimeline.write({
        projectId,
        securityCaseId,
        markdown: blockAddedMarkdown({
          value: onCreate.createBy.data.value || "",
          indicatorType,
          action: onCreate.createBy.data.action || SecurityBlockAction.Block,
          reach,
          source,
          createdAt: createdItem.createdAt || OneUptimeDate.getCurrentDate(),
          expiresAt: onCreate.createBy.data.expiresAt,
          reason: onCreate.createBy.data.reason,
          // Whether anything is asked to hold this block: a destination of its reach.
          hasDestinations:
            found.failedProviders.length > 0 ||
            found.destinations.some(
              (destination: SecurityBlockDestination): boolean => {
                return isSecurityBlockForDestination({
                  destination,
                  block: { indicatorType, reach },
                });
              },
            ),
        }),
        color: SecurityBlockTimeline.colors.added,
        userId:
          source === SecurityBlockSource.Person
            ? onCreate.createBy.props.userId
            : undefined,
      });
    }

    await SecurityBlocklistJobs.queueReconcile(projectId);

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const onUpdate: OnUpdate<Model> = await super.onBeforeUpdate(updateBy);
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const now: Date = OneUptimeDate.getCurrentDate();

    if (data["value"] !== undefined || data["indicatorType"] !== undefined) {
      throw new BadDataException(SECURITY_BLOCK_MESSAGES.valueNeverChanges);
    }

    if (data["action"] !== undefined) {
      throw new BadDataException(SECURITY_BLOCK_MESSAGES.actionNeverChanges);
    }

    if (data["reach"] !== undefined) {
      throw new BadDataException(SECURITY_BLOCK_MESSAGES.reachNeverChanges);
    }

    const isLift: boolean = data["state"] !== undefined;

    if (isLift && data["state"] !== SecurityBlockState.Lifted) {
      throw new BadDataException(SECURITY_BLOCK_MESSAGES.liftOnly);
    }

    const changesExpiry: boolean = data["expiresAt"] !== undefined;
    let expiresAt: Date | null | undefined = undefined;

    if (changesExpiry && data["expiresAt"] !== null) {
      const given: Date = new Date(data["expiresAt"] as string);
      const problem: string | null = getSecurityBlockExpiryProblem({
        expiresAt: given,
        now,
      });

      if (problem) {
        throw new BadDataException(problem);
      }

      expiresAt = given;
      data["expiresAt"] = given;
    } else if (changesExpiry) {
      expiresAt = null;
    }

    for (const column of ["reason", "liftReason"]) {
      const text: unknown = data[column];

      if (typeof text === "string") {
        if (text.trim().length > SECURITY_BLOCK_REASON_MAX_LENGTH) {
          throw new BadDataException(SECURITY_BLOCK_MESSAGES.reasonTooLong);
        }

        data[column] = text.trim() || null;
      }
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      BLOCK_SELECT,
    );

    for (const row of rows) {
      // An ended block stays as it ended: lifting it again or moving its end changes nothing true.
      if (
        (isLift || changesExpiry) &&
        row.state !== SecurityBlockState.Active
      ) {
        throw new BadDataException(
          SECURITY_BLOCK_MESSAGES.notActive({
            value: row.value || "",
            state: row.state || SecurityBlockState.Lifted,
          }),
        );
      }

      // Kept until someone lifts it: only a Security Admin says so.
      if (
        expiresAt === null &&
        row.projectId &&
        !updateBy.props.isRoot &&
        !this.mayGoPastLimits(updateBy.props, row.projectId)
      ) {
        throw new BadDataException(
          SECURITY_BLOCK_MESSAGES.untilLiftedTakesAdmin,
        );
      }
    }

    const userId: ObjectID | undefined = isPerson(updateBy.props)
      ? updateBy.props.userId
      : undefined;

    const carry: UpdateCarry = {
      rows,
      isLift,
      ...(changesExpiry ? { expiresAt } : {}),
      ...(typeof data["liftReason"] === "string"
        ? { liftReason: data["liftReason"] as string }
        : {}),
      ...(userId ? { userId } : {}),
    };

    return { updateBy: onUpdate.updateBy, carryForward: carry };
  }

  /*
   * A lift records when, and by whom - a person, or nobody for OneUptime's
   * own lift (a playbook's undo, OneUptime AI) and an API key's - written
   * once the update has passed every check, as no caller writes them.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (data["state"] !== SecurityBlockState.Lifted) {
      return;
    }

    data["liftedAt"] = OneUptimeDate.getCurrentDate();
    data["liftedByUserId"] = isPerson(updateBy.props)
      ? updateBy.props.userId || null
      : null;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carry: UpdateCarry | null = onUpdate.carryForward as UpdateCarry;

    if (!carry || (!carry.isLift && carry.expiresAt === undefined)) {
      return onUpdate;
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const projects: Map<string, ObjectID> = new Map();

    for (const row of carry.rows) {
      if (!row.projectId) {
        continue;
      }

      // One spelling of the project, however the row was read.
      const projectId: ObjectID = new ObjectID(row.projectId.toString());
      projects.set(projectId.toString(), projectId);

      await SecurityBlockTimeline.write({
        projectId,
        securityCaseId: row.securityCaseId
          ? new ObjectID(row.securityCaseId.toString())
          : null,
        markdown: carry.isLift
          ? blockLiftedMarkdown({
              value: row.value || "",
              isByPerson: Boolean(carry.userId),
              reason: carry.liftReason,
            })
          : blockExtendedMarkdown({
              value: row.value || "",
              now,
              expiresAt: carry.expiresAt || null,
            }),
        color: carry.isLift
          ? SecurityBlockTimeline.colors.ended
          : SecurityBlockTimeline.colors.added,
        userId: carry.userId,
      });
    }

    for (const projectId of projects.values()) {
      await SecurityBlocklistJobs.queueReconcile(projectId);
    }

    return onUpdate;
  }

  /*
   * A block is never deleted: it is lifted, and its record is how a case and
   * the next block of the address say it was blocked before. Nobody holds
   * the permission; this says so in words, should OneUptime's own code try.
   * A project's deletion removes them with it, in the database.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.props.isRoot) {
      throw new BadDataException(SECURITY_BLOCK_MESSAGES.notDeletable);
    }

    return { deleteBy, carryForward: null };
  }

  /*
   * The projects whose blocklist has something to keep: an active block, or
   * a block's enforcement row not yet removed (an ended block a destination
   * may still hold). One read of each table, by their indexes.
   */
  @CaptureSpan()
  public async findProjectIdsWithWork(data: {
    limit: number;
  }): Promise<Array<ObjectID>> {
    const rows: unknown = await this.getRepository().manager.query(
      `SELECT "projectId" FROM (
          SELECT DISTINCT "projectId" FROM "SecurityBlock"
            WHERE "state" = $1 AND "deletedAt" IS NULL
          UNION
          SELECT DISTINCT "projectId" FROM "SecurityBlockEnforcement"
            WHERE "state" <> $2 AND "deletedAt" IS NULL
        ) AS "projects"
        ORDER BY "projectId"
        LIMIT $3`,
      [
        SecurityBlockState.Active,
        SecurityBlockEnforcementState.Removed,
        data.limit,
      ],
    );

    return (Array.isArray(rows) ? rows : [])
      .map((row: unknown): string => {
        return String(
          (row && typeof row === "object"
            ? (row as Record<string, unknown>)["projectId"]
            : "") || "",
        );
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  // The blocks of a list of ids, as the reconciler and the routes read them.
  @CaptureSpan()
  public async findByIds(data: {
    projectId: ObjectID;
    ids: Array<ObjectID>;
  }): Promise<Array<Model>> {
    if (data.ids.length === 0) {
      return [];
    }

    return await this.findBy({
      query: { projectId: data.projectId, _id: QueryHelper.any(data.ids) },
      select: BLOCK_SELECT,
      skip: 0,
      limit: data.ids.length,
      props: { isRoot: true },
    });
  }
}

export default new Service();
