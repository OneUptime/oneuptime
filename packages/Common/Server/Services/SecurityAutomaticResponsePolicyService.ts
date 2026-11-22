import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import SecurityAutomaticResponse from "../Utils/SecurityAutomaticResponse/SecurityAutomaticResponse";
import SecurityAutomaticResponseRules from "../Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRules";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserType from "../../Types/UserType";
import {
  SECURITY_AUTOMATIC_RESPONSE_MESSAGES,
  SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES,
  SECURITY_AUTOMATIC_RESPONSE_TRIAL_IN_MS,
  SecurityAutomaticResponseMatch,
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyDefinition,
  SecurityAutomaticResponsePolicyKind,
  doesSecurityAutomaticResponseMatchNameAnything,
  hasSecurityAutomaticResponseTrialFinished,
  isReadySecurityAutomaticResponsePolicyKind,
  isSecurityAutomaticResponseDuration,
  isSecurityAutomaticResponseMode,
  readSecurityAutomaticResponseMatch,
} from "../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { isSecurityBlockAction } from "../../Types/SecurityBlocklist/SecurityBlock";

/*
 * AUTOMATIC RESPONSE POLICIES (#10350): what a policy is, and who may change
 * it how.
 *
 *   - A project has the three ready policies, made Off as OneUptime first
 *     reads them for it (ensureReadyPolicies), and the policies it makes
 *     from the blank one (kind Custom). A ready policy is switched on as it
 *     is: what it matches, does and for how long never changes. A project's
 *     own says all three, and must match on something - a technique, a
 *     rule, or threat intel.
 *   - Its mode moves Off -> Trial Run -> On, or back Off. Trial Run starts a
 *     week of recording what it would have done (trialStartedAt,
 *     trialEndsAt). On after a whole week keeps that the trial finished;
 *     On before it is the trial skipped, stamped with who and when. Off
 *     after a whole week keeps it finished too.
 *   - Every change is a person's with Security Admin, Project Admin or
 *     Project Owner (the table's write permission: the policy's blocks run
 *     without approval), and OneUptime stamps who changed its mode and who
 *     turned it on: each of its blocks carries that as the approval it ran
 *     without.
 *
 * A mode changes for one policy at a time, so what is stamped is that
 * policy's own: a write that would change several is refused.
 */

// The columns a ready policy keeps as they are.
const READY_POLICY_FIXED_COLUMNS: ReadonlyArray<string> = [
  "name",
  "description",
  "blockAction",
  "duration",
  "matchConditions",
];

// What the update hooks read of the policies a write changes.
const POLICY_SELECT: {
  _id: true;
  projectId: true;
  kind: true;
  mode: true;
  matchConditions: true;
  trialStartedAt: true;
  trialEndsAt: true;
  trialFinishedAt: true;
  trialSkippedAt: true;
} = {
  _id: true,
  projectId: true,
  kind: true,
  mode: true,
  matchConditions: true,
  trialStartedAt: true,
  trialEndsAt: true,
  trialFinishedAt: true,
  trialSkippedAt: true,
};

function isPerson(props: DatabaseCommonInteractionProps): boolean {
  return (
    !props.isRoot &&
    (props.userType === UserType.User ||
      props.userType === UserType.MasterAdmin ||
      (!props.userType && Boolean(props.userId)))
  );
}

/*
 * What OneUptime stamps when a policy's mode changes from `from` to `to`, at
 * `now`, by `userId` (none for OneUptime's own change). Pure, so the rule is
 * pinned in a plain test.
 */
export function getSecurityAutomaticResponseModeStamps(data: {
  policy: Pick<
    Model,
    | "mode"
    | "trialStartedAt"
    | "trialEndsAt"
    | "trialFinishedAt"
    | "trialSkippedAt"
  >;
  to: SecurityAutomaticResponseMode;
  now: Date;
  userId: ObjectID | null;
}): Record<string, unknown> {
  const { policy, to, now, userId } = data;
  const from: SecurityAutomaticResponseMode =
    (policy.mode as SecurityAutomaticResponseMode) ||
    SecurityAutomaticResponseMode.Off;

  if (from === to) {
    return {};
  }

  const stamps: Record<string, unknown> = {
    modeChangedAt: now,
    modeChangedByUserId: userId,
  };
  const finished: boolean = hasSecurityAutomaticResponseTrialFinished(
    policy,
    now,
  );

  // A week of trial run that is over, written down as it leaves it.
  if (finished && !policy.trialFinishedAt && policy.trialEndsAt) {
    stamps["trialFinishedAt"] = new Date(policy.trialEndsAt);
  }

  if (to === SecurityAutomaticResponseMode.TrialRun) {
    stamps["trialStartedAt"] = now;
    stamps["trialEndsAt"] = new Date(
      now.getTime() + SECURITY_AUTOMATIC_RESPONSE_TRIAL_IN_MS,
    );
    stamps["trialSkippedAt"] = null;
    stamps["trialSkippedByUserId"] = null;
  }

  if (to === SecurityAutomaticResponseMode.On) {
    stamps["turnedOnAt"] = now;
    stamps["turnedOnByUserId"] = userId;

    if (!finished) {
      stamps["trialSkippedAt"] = now;
      stamps["trialSkippedByUserId"] = userId;
    }
  }

  return stamps;
}

/*
 * What is wrong with a project's own policy as it would be written, or null:
 * an action, a first length and conditions it can run with, that match on
 * something.
 */
export function getSecurityAutomaticResponsePolicyProblem(data: {
  name?: unknown;
  blockAction?: unknown;
  duration?: unknown;
  matchConditions?: unknown;
  // The columns the write sets; a create sets them all.
  writes: ReadonlyArray<string>;
}): string | null {
  if (
    data.writes.includes("name") &&
    (typeof data.name !== "string" || !data.name.trim())
  ) {
    return SECURITY_AUTOMATIC_RESPONSE_MESSAGES.nameRequired;
  }

  if (
    data.writes.includes("blockAction") &&
    data.blockAction !== undefined &&
    !isSecurityBlockAction(data.blockAction)
  ) {
    return SECURITY_AUTOMATIC_RESPONSE_MESSAGES.notAnAction;
  }

  if (
    data.writes.includes("duration") &&
    data.duration !== undefined &&
    !isSecurityAutomaticResponseDuration(data.duration)
  ) {
    return SECURITY_AUTOMATIC_RESPONSE_MESSAGES.notADuration;
  }

  if (data.writes.includes("matchConditions")) {
    const match: SecurityAutomaticResponseMatch =
      readSecurityAutomaticResponseMatch(data.matchConditions);

    if (!doesSecurityAutomaticResponseMatchNameAnything(match)) {
      return SECURITY_AUTOMATIC_RESPONSE_MESSAGES.matchNamesNothing;
    }
  }

  return null;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // ---------- What other code calls ----------

  /*
   * The ready policies a project has not got yet, made Off as OneUptime.
   * Two readers at once may both try: the second meets the index that keeps
   * one of each ready policy, and the policy is there.
   */
  @CaptureSpan()
  public async ensureReadyPolicies(projectId: ObjectID): Promise<void> {
    const existing: Array<Model> = await this.findBy({
      query: {
        projectId,
        kind: new Includes(
          SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES.map(
            (
              policy: SecurityAutomaticResponsePolicyDefinition,
            ): SecurityAutomaticResponsePolicyKind => {
              return policy.kind;
            },
          ),
        ),
      },
      select: { _id: true, kind: true },
      skip: 0,
      limit: SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES.length + 1,
      props: { isRoot: true },
    });
    const kinds: Set<string> = new Set(
      existing.map((policy: Model): string => {
        return policy.kind || "";
      }),
    );

    for (const ready of SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES) {
      if (kinds.has(ready.kind)) {
        continue;
      }

      const policy: Model = new Model();
      policy.projectId = projectId;
      policy.kind = ready.kind;
      policy.name = ready.name;
      policy.description = ready.description;
      policy.mode = SecurityAutomaticResponseMode.Off;
      policy.blockAction = ready.blockAction;
      policy.duration = ready.duration;
      policy.matchConditions = ready.match as unknown as JSONObject;

      try {
        await this.create({ data: policy, props: { isRoot: true } });
      } catch (error) {
        // Made by another reader at the same moment, or failed: read again on the next look.
        logger.debug(
          `SecurityAutomaticResponsePolicyService: the ${ready.kind} policy of project ${projectId.toString()} was not made just now: ${String(error)}`,
        );
      }
    }
  }

  /*
   * The project's policies that act on detections: those in their trial
   * run, and those on.
   */
  @CaptureSpan()
  public async findActivePolicies(projectId: ObjectID): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId,
        mode: new Includes([
          SecurityAutomaticResponseMode.TrialRun,
          SecurityAutomaticResponseMode.On,
        ]),
      },
      select: {
        _id: true,
        projectId: true,
        kind: true,
        name: true,
        mode: true,
        blockAction: true,
        duration: true,
        matchConditions: true,
        trialStartedAt: true,
        trialEndsAt: true,
        trialFinishedAt: true,
        trialSkippedAt: true,
        turnedOnAt: true,
        turnedOnByUserId: true,
      },
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });
  }

  // The trial runs whose week is up but are not written down as finished yet.
  @CaptureSpan()
  public async findTrialsDue(data: {
    now: Date;
    limit: number;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        mode: SecurityAutomaticResponseMode.TrialRun,
        trialEndsAt: QueryHelper.lessThanEqualTo(data.now),
        trialFinishedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        projectId: true,
        kind: true,
        name: true,
        mode: true,
        blockAction: true,
        trialStartedAt: true,
        trialEndsAt: true,
        modeChangedByUserId: true,
      },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });
  }

  // ---------- The hooks ----------

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);
    const data: Model = onCreate.createBy.data;

    // OneUptime makes the ready policies; a person makes their own, Off.
    if (!createBy.props.isRoot) {
      data.kind = SecurityAutomaticResponsePolicyKind.Custom;
      data.mode = SecurityAutomaticResponseMode.Off;

      const problem: string | null = getSecurityAutomaticResponsePolicyProblem({
        name: data.name,
        blockAction: data.blockAction,
        duration: data.duration,
        matchConditions: data.matchConditions,
        writes: ["name", "blockAction", "duration", "matchConditions"],
      });

      if (problem) {
        throw new BadDataException(problem);
      }

      data.matchConditions = readSecurityAutomaticResponseMatch(
        data.matchConditions,
      ) as unknown as JSONObject;
    }

    if (typeof data.name === "string") {
      data.name = data.name.trim();
    }

    return onCreate;
  }

  // Who made it: written once the create is permitted, as no caller writes it.
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps = onCreate.createBy.props;

    if (isPerson(props) && props.userId) {
      onCreate.createBy.data.createdByUserId = props.userId;
    }
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

    if (updateBy.props.isRoot) {
      return onUpdate;
    }

    if (data["kind"] !== undefined) {
      throw new BadDataException(
        "A policy's kind never changes. Create a policy from the blank one instead.",
      );
    }

    if (
      data["mode"] !== undefined &&
      !isSecurityAutomaticResponseMode(data["mode"])
    ) {
      throw new BadDataException("Choose Off, Trial Run or On for the policy.");
    }

    const writes: Array<string> = Object.keys(data);
    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      POLICY_SELECT,
    );

    if (data["mode"] !== undefined && rows.length > 1) {
      throw new BadDataException(
        "Turn automatic response policies on or off one at a time.",
      );
    }

    for (const row of rows) {
      const fixedWrites: Array<string> = writes.filter((column: string) => {
        return READY_POLICY_FIXED_COLUMNS.includes(column);
      });

      if (
        isReadySecurityAutomaticResponsePolicyKind(row.kind) &&
        fixedWrites.length > 0
      ) {
        throw new BadDataException(
          SECURITY_AUTOMATIC_RESPONSE_MESSAGES.readyPolicyFixed,
        );
      }
    }

    const problem: string | null = getSecurityAutomaticResponsePolicyProblem({
      name: data["name"],
      blockAction: data["blockAction"],
      duration: data["duration"],
      matchConditions: data["matchConditions"],
      writes,
    });

    if (problem) {
      throw new BadDataException(problem);
    }

    if (data["matchConditions"] !== undefined) {
      data["matchConditions"] = readSecurityAutomaticResponseMatch(
        data["matchConditions"],
      );
    }

    if (typeof data["name"] === "string") {
      data["name"] = (data["name"] as string).trim();
    }

    return onUpdate;
  }

  /*
   * A change of mode is stamped - when, by whom, the trial's week, who
   * turned it on and whether that skipped the trial - once the update has
   * passed every check, as no caller writes those columns.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const to: unknown = data["mode"];

    if (!isSecurityAutomaticResponseMode(to)) {
      return;
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      POLICY_SELECT,
    );
    const row: Model | undefined = rows[0];

    if (!row || rows.length > 1) {
      return;
    }

    Object.assign(
      data,
      getSecurityAutomaticResponseModeStamps({
        policy: row,
        to,
        now: OneUptimeDate.getCurrentDate(),
        userId: isPerson(updateBy.props) ? updateBy.props.userId || null : null,
      }),
    );
  }

  /*
   * A policy's change is read by the next detection at once on this server
   * (and within half a minute on the others), and a ready policy turned
   * into its trial run or on runs the rules it acts on in real time
   * (SecurityAutomaticResponseRules): it acts as the detection is made.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const mode: unknown = (
      onUpdate.updateBy.data as unknown as Record<string, unknown>
    )["mode"];

    for (const id of updatedItemIds) {
      try {
        const policy: Model | null = await this.findOneById({
          id,
          select: { _id: true, projectId: true, kind: true },
          props: { isRoot: true },
        });

        if (!policy?.projectId) {
          continue;
        }

        SecurityAutomaticResponse.clearCache(policy.projectId);

        if (
          mode === SecurityAutomaticResponseMode.TrialRun ||
          mode === SecurityAutomaticResponseMode.On
        ) {
          await SecurityAutomaticResponseRules.runInRealTime({
            projectId: policy.projectId,
            kind: policy.kind,
          });
        }
      } catch (error) {
        logger.error(
          `SecurityAutomaticResponsePolicyService: could not ready policy ${id.toString()} after its change:`,
        );
        logger.error(error);
      }
    }

    return onUpdate;
  }
}

export default new Service();
