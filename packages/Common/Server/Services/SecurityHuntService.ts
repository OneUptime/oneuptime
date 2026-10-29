import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityHunt";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OneUptimeDate from "../../Types/Date";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  DEFAULT_SECURITY_HUNT_TIME_RANGE,
  SECURITY_HUNTS_PER_PROJECT_MAX,
  SECURITY_HUNT_MESSAGES,
  SECURITY_HUNT_RECIPIENTS_MAX,
  SecurityHuntField,
  SecurityHuntFilters,
  SecurityHuntProblem,
  SecurityHuntSchedule,
  areSecurityHuntFiltersEqual,
  getSecurityHuntIntervalInMinutes,
  getSecurityHuntProblems,
  getSecurityHuntSearchStart,
  isScheduledSecurityHunt,
  isSecurityHuntSchedule,
  isSecurityHuntTimeRange,
  readSecurityHuntFilters,
} from "../../Types/SecurityEvent/SecurityHunt";
import { getSecurityHuntFiltersProblem } from "../../Utils/SecurityEvent/SecurityHuntSearch";

/*
 * A project's hunts (Types/SecurityEvent/SecurityHunt): each checked as the
 * form checks it, at most SECURITY_HUNTS_PER_PROJECT_MAX of them, and the
 * people and teams it tells the project's own (ProjectReferencesService).
 *
 * The schedule is OneUptime's to keep. When a hunt is given a schedule, or
 * a scheduled hunt is given a new search, it starts from that moment: its
 * runs read the events that arrive from then on (searchedUpToAt), the first
 * one interval later (nextRunAt), with the read access of the person who
 * made the change (scheduledByUserId) - a run reads no more than its author
 * could. Those columns are no caller's to write, so they are written once
 * the change has passed every permission check (onCreatePermitted,
 * onUpdatePermitted). A hunt taken off its schedule keeps what its runs
 * found, and runs no more.
 */

// What a create or an update does to the hunt's schedule, decided before its checks.
interface ScheduleStart {
  // The hunt runs on its schedule from now on, as this person.
  schedule: SecurityHuntSchedule;
  scheduledByUserId: ObjectID | null;
}

// How many people or teams a write names; null when it leaves the list as it is.
function countListed(data: JSONObject, key: string): number | null {
  const value: unknown = data[key];

  if (value === undefined) {
    return null;
  }

  return Array.isArray(value) ? value.length : 0;
}

export class Service extends ProjectReferencesService<Model> {
  /*
   * The schedule a create or an update starts, handed from the hook that
   * decides it to the one that writes it, after the permission checks.
   */
  private readonly createScheduleStarts: WeakMap<
    CreateBy<Model>,
    ScheduleStart | null
  > = new WeakMap<CreateBy<Model>, ScheduleStart | null>();

  private readonly updateScheduleStarts: WeakMap<
    UpdateBy<Model>,
    ScheduleStart | null
  > = new WeakMap<UpdateBy<Model>, ScheduleStart | null>();

  public constructor() {
    super(Model);
  }

  // The first problem with a hunt's name, description, search and chips, as a 400.
  public static assertValid(data: {
    name?: string | undefined | null;
    description?: string | undefined | null;
    searchQuery?: string | undefined | null;
    filters?: SecurityHuntFilters | undefined | null;
  }): void {
    const problems: Array<SecurityHuntProblem> = getSecurityHuntProblems(data);

    if (problems.length > 0) {
      throw new BadDataException(problems[0]!.message);
    }

    const filtersProblem: string | null = getSecurityHuntFiltersProblem(
      data.filters,
    );

    if (filtersProblem) {
      throw new BadDataException(filtersProblem);
    }
  }

  // What a hunt searches for: a search or chips, each within its limits.
  public static assertSearch(data: {
    searchQuery: string;
    filters: SecurityHuntFilters;
  }): void {
    const problem: SecurityHuntProblem | undefined = getSecurityHuntProblems({
      name: "",
      searchQuery: data.searchQuery,
      filters: data.filters,
    }).find((item: SecurityHuntProblem): boolean => {
      return item.field === "searchQuery";
    });

    if (problem) {
      throw new BadDataException(problem.message);
    }

    const filtersProblem: string | null = getSecurityHuntFiltersProblem(
      data.filters,
    );

    if (filtersProblem) {
      throw new BadDataException(filtersProblem);
    }
  }

  // A scheduled hunt tells somebody; no hunt tells more than a team's worth.
  public static assertRecipients(data: {
    schedule: SecurityHuntSchedule | string | undefined | null;
    userCount: number;
    teamCount: number;
  }): void {
    const total: number = data.userCount + data.teamCount;

    if (total > SECURITY_HUNT_RECIPIENTS_MAX) {
      throw new BadDataException(
        SECURITY_HUNT_MESSAGES.tooManyRecipients.message,
      );
    }

    if (isScheduledSecurityHunt(data.schedule) && total === 0) {
      throw new BadDataException(
        SECURITY_HUNT_MESSAGES.chooseRecipients.message,
      );
    }
  }

  /*
   * Who a schedule set now runs as: the person making the change. OneUptime
   * itself may set one with nobody to run as (a run then has no read access
   * to use, and says so); an API key may not, as no person stands behind it.
   */
  private static getScheduler(
    props: DatabaseCommonInteractionProps,
  ): ObjectID | null {
    if (props.userId) {
      return props.userId;
    }

    if (props.isRoot || props.isMasterAdmin) {
      return null;
    }

    throw new BadDataException(
      SECURITY_HUNT_MESSAGES.scheduleNeedsPerson.message,
    );
  }

  private async assertProjectHasRoom(projectId: ObjectID): Promise<void> {
    const count: PositiveNumber = await this.countBy({
      query: {
        projectId,
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() >= SECURITY_HUNTS_PER_PROJECT_MAX) {
      throw new BadDataException(SECURITY_HUNT_MESSAGES.tooManyHunts.message);
    }
  }

  // A search as it is kept: trimmed; a name and a description the same.
  private static normalize(data: JSONObject): void {
    for (const key of ["name", "description", "searchQuery"]) {
      if (typeof data[key] === "string") {
        data[key] = (data[key] as string).trim();
      }
    }

    if (data["filters"] !== undefined) {
      data["filters"] = readSecurityHuntFilters(data["filters"]) as JSONObject;
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: JSONObject = createBy.data as unknown as JSONObject;

    Service.normalize(data);

    if (createBy.data.schedule === undefined || createBy.data.schedule === null) {
      createBy.data.schedule = SecurityHuntSchedule.NotScheduled;
    }

    if (
      createBy.data.timeRange === undefined ||
      createBy.data.timeRange === null
    ) {
      createBy.data.timeRange = DEFAULT_SECURITY_HUNT_TIME_RANGE;
    }

    if (!isSecurityHuntSchedule(createBy.data.schedule)) {
      throw new BadDataException(
        SECURITY_HUNT_MESSAGES.unknownSchedule.message,
      );
    }

    if (!isSecurityHuntTimeRange(createBy.data.timeRange)) {
      throw new BadDataException(
        SECURITY_HUNT_MESSAGES.unknownTimeRange.message,
      );
    }

    Service.assertValid({
      name: createBy.data.name,
      description: createBy.data.description,
      searchQuery: createBy.data.searchQuery,
      filters: readSecurityHuntFilters(createBy.data.filters),
    });

    Service.assertRecipients({
      schedule: createBy.data.schedule,
      userCount: countListed(data, "notifyUsers") || 0,
      teamCount: countListed(data, "notifyTeams") || 0,
    });

    this.createScheduleStarts.set(
      createBy,
      isScheduledSecurityHunt(createBy.data.schedule)
        ? {
            schedule: createBy.data.schedule,
            scheduledByUserId: Service.getScheduler(createBy.props),
          }
        : null,
    );

    const projectId: ObjectID | undefined =
      createBy.data.projectId ||
      (createBy.props.tenantId as ObjectID | undefined);

    if (projectId) {
      await this.assertProjectHasRoom(projectId);
    }

    return { createBy, carryForward: null };
  }

  /*
   * A hunt's schedule, once the create has passed every check: from now on,
   * as the person who saved it.
   */
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const start: ScheduleStart | null | undefined =
      this.createScheduleStarts.get(onCreate.createBy);

    this.createScheduleStarts.delete(onCreate.createBy);

    Service.writeScheduleStart(
      onCreate.createBy.data as unknown as JSONObject,
      start || null,
    );
  }

  /*
   * An update is checked as the hunt it leaves behind. One that changes
   * what a scheduled hunt searches for, or its schedule, starts the
   * schedule again from now (see the top of this file) - for one hunt at a
   * time, as it is written with its own moment and its author.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    Service.normalize(data);

    // The name and the description as sent; the search below, as the hunt it leaves.
    const sentFields: Array<SecurityHuntField> = (
      ["name", "description"] as Array<SecurityHuntField>
    ).filter((field: SecurityHuntField): boolean => {
      return data[field] !== undefined;
    });

    const fieldProblem: SecurityHuntProblem | undefined =
      getSecurityHuntProblems({
        name: (data["name"] as string | undefined) || "",
        description: (data["description"] as string | undefined) || "",
      }).find((problem: SecurityHuntProblem): boolean => {
        return sentFields.includes(problem.field);
      });

    if (fieldProblem) {
      throw new BadDataException(fieldProblem.message);
    }

    if (
      data["schedule"] !== undefined &&
      !isSecurityHuntSchedule(data["schedule"])
    ) {
      throw new BadDataException(
        SECURITY_HUNT_MESSAGES.unknownSchedule.message,
      );
    }

    if (
      data["timeRange"] !== undefined &&
      !isSecurityHuntTimeRange(data["timeRange"])
    ) {
      throw new BadDataException(
        SECURITY_HUNT_MESSAGES.unknownTimeRange.message,
      );
    }

    const userCount: number | null = countListed(data, "notifyUsers");
    const teamCount: number | null = countListed(data, "notifyTeams");
    const touchesSearch: boolean =
      data["searchQuery"] !== undefined || data["filters"] !== undefined;
    const touchesSchedule: boolean =
      data["schedule"] !== undefined ||
      userCount !== null ||
      teamCount !== null;

    if (!touchesSearch && !touchesSchedule) {
      return { updateBy, carryForward: null };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        schedule: true,
        searchQuery: true,
        filters: true,
        notifyUsers: {
          _id: true,
        },
        notifyTeams: {
          _id: true,
        },
      },
    );

    let start: ScheduleStart | null | undefined = undefined;

    for (const row of rows) {
      const schedule: SecurityHuntSchedule =
        (data["schedule"] as SecurityHuntSchedule | undefined) ||
        row.schedule ||
        SecurityHuntSchedule.NotScheduled;
      const searchQuery: string =
        data["searchQuery"] !== undefined
          ? (data["searchQuery"] as string) || ""
          : row.searchQuery || "";
      const filters: SecurityHuntFilters =
        data["filters"] !== undefined
          ? readSecurityHuntFilters(data["filters"])
          : readSecurityHuntFilters(row.filters);

      Service.assertSearch({ searchQuery, filters });

      Service.assertRecipients({
        schedule,
        userCount: userCount ?? (row.notifyUsers || []).length,
        teamCount: teamCount ?? (row.notifyTeams || []).length,
      });

      const scheduleChanged: boolean =
        data["schedule"] !== undefined &&
        schedule !== (row.schedule || SecurityHuntSchedule.NotScheduled);
      const searchChanged: boolean =
        (data["searchQuery"] !== undefined &&
          searchQuery !== (row.searchQuery || "")) ||
        (data["filters"] !== undefined &&
          !areSecurityHuntFiltersEqual(
            filters,
            readSecurityHuntFilters(row.filters),
          ));
      const restarts: boolean =
        scheduleChanged || (searchChanged && isScheduledSecurityHunt(schedule));

      if (!restarts) {
        continue;
      }

      if (rows.length > 1) {
        throw new BadDataException(
          SECURITY_HUNT_MESSAGES.oneHuntAtATime.message,
        );
      }

      start = isScheduledSecurityHunt(schedule)
        ? {
            schedule,
            scheduledByUserId: Service.getScheduler(updateBy.props),
          }
        : null;
    }

    if (start !== undefined) {
      this.updateScheduleStarts.set(updateBy, start);
    }

    return { updateBy, carryForward: null };
  }

  // The schedule an update starts (or stops), once it has passed every check.
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    if (!this.updateScheduleStarts.has(updateBy)) {
      return;
    }

    const start: ScheduleStart | null | undefined =
      this.updateScheduleStarts.get(updateBy);

    this.updateScheduleStarts.delete(updateBy);

    Service.writeScheduleStart(
      updateBy.data as unknown as JSONObject,
      start || null,
    );
  }

  /*
   * The columns a schedule's start writes: from now on, its first run one
   * interval away, as `scheduledByUserId`, with no error left from before.
   * Taken off its schedule, a hunt runs no more and runs as nobody; what its
   * runs found stays.
   */
  public static writeScheduleStart(
    data: JSONObject,
    start: ScheduleStart | null,
  ): void {
    const now: Date = OneUptimeDate.getCurrentDate();
    const interval: number | null = start
      ? getSecurityHuntIntervalInMinutes(start.schedule)
      : null;

    if (!start || interval === null) {
      data["nextRunAt"] = null;
      data["searchedUpToAt"] = null;
      data["lastRunError"] = null;
      RelationIdUtil.stamp(
        data as unknown as Record<string, unknown>,
        ["scheduledByUserId", "scheduledByUser"],
        null,
      );
      return;
    }

    data["searchedUpToAt"] = getSecurityHuntSearchStart(now);
    data["nextRunAt"] = OneUptimeDate.addRemoveMinutes(now, interval);
    data["lastRunError"] = null;
    RelationIdUtil.stamp(
      data as unknown as Record<string, unknown>,
      ["scheduledByUserId", "scheduledByUser"],
      start.scheduledByUserId,
    );
  }
}

export default new Service();
