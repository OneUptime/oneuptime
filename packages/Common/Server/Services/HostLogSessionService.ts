import ProjectReferencesService from "./ProjectReferencesService";
import HostService from "./HostService";
import Model from "../../Models/DatabaseModels/HostLogSession";
import Host from "../../Models/DatabaseModels/Host";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import HostLogSessionUtil, {
  HOST_LOG_SESSION_ACTIVE_STATUSES,
  HOST_LOG_SESSION_CANCEL_NOTICE_MINUTES,
  HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
  HOST_LOG_SESSION_DURATIONS,
  HOST_LOG_SESSION_REQUEST_VALID_MINUTES,
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "../../Types/Host/HostLogSession";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../Types/JSON";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import HostOperatingSystem from "../../Utils/Host/HostOperatingSystem";
import AndroidAgentLogSessions, {
  CANCELLED_MESSAGE,
  DeviceLogSession,
  DeviceLogSessionChange,
  DeviceLogSessionReport,
  DeviceLogSessionRequest,
} from "../../Utils/Host/AndroidAgentLogSessions";
import { canonicalizeEntityValue } from "../../Utils/Telemetry/EntityKey";

export const NOT_AN_ANDROID_DEVICE_MESSAGE: string =
  "Log sessions are for Android devices that run the OneUptime Android agent. This host is not one.";

export const SESSION_ALREADY_OPEN_MESSAGE: string =
  "This device already has a log session waiting or running. Cancel it, or wait for it to end, before you ask for another.";

export const ONLY_CANCEL_MESSAGE: string =
  "A log session can only be cancelled. The device moves it on by itself.";

export const SESSION_OVER_MESSAGE: string =
  "This log session is already over, so there is nothing to cancel.";

export const DURATION_NOT_OFFERED_MESSAGE: string = `A log session runs for ${HOST_LOG_SESSION_DURATIONS.join(", ")} minutes. Pick one of those.`;

export const LEVEL_NOT_OFFERED_MESSAGE: string =
  "A log session sends info, debug or verbose lines and above. Pick one of those.";

// The most sessions a device is told about at once.
const MAX_SESSIONS_FOR_DEVICE: number = 10;

/*
 * Log sessions (#9806, Types/Host/HostLogSession): asked for on an Android
 * device's host in OneUptime, moved on by the device through the Android
 * agent's route (exchangeWithDevice), and cancelled in OneUptime.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A person asks: on an Android device, for a duration and a level
   * OneUptime offers, while no other session of the device is waiting or
   * running. OneUptime sets everything else - Requested, and how long the
   * person at the device has to allow it.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;
    const projectId: ObjectID | undefined =
      data.projectId || createBy.props.tenantId;
    const hostId: ObjectID | undefined = data.hostId;

    if (!projectId || !hostId) {
      throw new BadDataException(
        "Choose the Android device whose logs the session reads.",
      );
    }

    const host: Host | null = await HostService.findOneBy({
      query: { _id: hostId, projectId: projectId },
      select: { _id: true, osType: true },
      props: { isRoot: true },
    });

    if (!host) {
      throw new BadDataException(
        "The device this log session is for was not found in this project.",
      );
    }

    if (!HostOperatingSystem.isAndroid(host.osType)) {
      throw new BadDataException(NOT_AN_ANDROID_DEVICE_MESSAGE);
    }

    const durationMinutes: number =
      data.durationMinutes ?? HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES;

    if (!HOST_LOG_SESSION_DURATIONS.includes(durationMinutes)) {
      throw new BadDataException(DURATION_NOT_OFFERED_MESSAGE);
    }

    const minimumLevel: HostLogSessionLevel =
      data.minimumLevel || HostLogSessionLevel.Info;

    if (!HostLogSessionUtil.isLevel(minimumLevel)) {
      throw new BadDataException(LEVEL_NOT_OFFERED_MESSAGE);
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    await this.settleStaleSessions({ hostId: hostId, now: now });

    const open: Model | null = await this.findOneBy({
      query: {
        hostId: hostId,
        status: QueryHelper.any([...HOST_LOG_SESSION_ACTIVE_STATUSES]),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (open) {
      throw new BadDataException(SESSION_ALREADY_OPEN_MESSAGE);
    }

    data.projectId = projectId;
    data.durationMinutes = durationMinutes;
    data.minimumLevel = minimumLevel;
    data.status = HostLogSessionStatus.Requested;
    data.expiresAt = OneUptimeDate.addRemoveMinutes(
      now,
      HOST_LOG_SESSION_REQUEST_VALID_MINUTES,
    );

    return { createBy, carryForward: null };
  }

  /*
   * A person's only change is to cancel a session that is waiting or
   * running; the device stops at its next exchange. OneUptime's own writes
   * (the device's reports, isRoot) go through as they are.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.props.isRoot) {
      return { updateBy, carryForward: null };
    }

    const data: Model = updateBy.data as unknown as Model;

    if (data.status !== HostLogSessionStatus.Cancelled) {
      throw new BadDataException(ONLY_CANCEL_MESSAGE);
    }

    /*
     * The sessions the cancel writes, read in its own query and window -
     * those the person may change - and the cancel held to them
     * (findRowsAndHoldUpdateToThem): a session judged still open is the
     * session cancelled.
     */
    const sessions: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, status: true },
    );

    for (const session of sessions) {
      if (!HostLogSessionUtil.isActive(session.status)) {
        throw new BadDataException(SESSION_OVER_MESSAGE);
      }
    }

    data.endedAt = OneUptimeDate.getCurrentDate();
    data.statusMessage = CANCELLED_MESSAGE;

    return { updateBy, carryForward: null };
  }

  /*
   * Ends what the device stopped telling OneUptime about: a request nobody
   * allowed well after it expired, a session well past its end with no word
   * from the device (AndroidAgentLogSessions.staleChange).
   */
  @CaptureSpan()
  public async settleStaleSessions(data: {
    hostId: ObjectID;
    now: Date;
  }): Promise<void> {
    const sessions: Array<Model> = await this.findBy({
      query: {
        hostId: data.hostId,
        status: QueryHelper.any([...HOST_LOG_SESSION_ACTIVE_STATUSES]),
      },
      select: {
        _id: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        startedAt: true,
        endsAt: true,
        durationMinutes: true,
      },
      skip: 0,
      limit: MAX_SESSIONS_FOR_DEVICE,
      props: { isRoot: true },
    });

    for (const session of sessions) {
      const change: DeviceLogSessionChange | null =
        AndroidAgentLogSessions.staleChange({ row: session, now: data.now });

      if (change && session._id) {
        await this.applyChange(new ObjectID(session._id.toString()), change);
      }
    }
  }

  /*
   * One exchange with a device's Android agent: what became of the
   * sessions it has, and the sessions open for it. The device is found by
   * its host.name in the key's project; a device OneUptime has not heard
   * from yet has none.
   */
  @CaptureSpan()
  public async exchangeWithDevice(data: {
    projectId: ObjectID;
    request: DeviceLogSessionRequest;
  }): Promise<JSONObject> {
    const host: Host | null = await HostService.findOneBy({
      query: {
        projectId: data.projectId,
        hostIdentifier: QueryHelper.findWithSameText(
          canonicalizeEntityValue(data.request.hostName),
        ),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!host?._id) {
      return AndroidAgentLogSessions.toAnswer([]);
    }

    const hostId: ObjectID = new ObjectID(host._id.toString());
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const report of data.request.reports) {
      await this.applyReport({
        projectId: data.projectId,
        hostId: hostId,
        report: report,
        now: now,
      });
    }

    await this.settleStaleSessions({ hostId: hostId, now: now });

    const sessions: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        hostId: hostId,
        status: QueryHelper.any([
          ...HOST_LOG_SESSION_ACTIVE_STATUSES,
          HostLogSessionStatus.Cancelled,
        ]),
      },
      select: {
        _id: true,
        status: true,
        durationMinutes: true,
        minimumLevel: true,
        createdAt: true,
        expiresAt: true,
        endedAt: true,
        createdByUser: { name: true },
      },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: MAX_SESSIONS_FOR_DEVICE,
      props: { isRoot: true },
    });

    const cancelNoticeSince: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -HOST_LOG_SESSION_CANCEL_NOTICE_MINUTES,
    );

    const forDevice: Array<DeviceLogSession> = [];

    for (const session of sessions) {
      if (!session._id || !session.status) {
        continue;
      }

      // A cancelled session is told for an hour, so a device that has it stops.
      if (
        session.status === HostLogSessionStatus.Cancelled &&
        (!session.endedAt || session.endedAt < cancelNoticeSince)
      ) {
        continue;
      }

      forDevice.push({
        id: session._id.toString(),
        status: session.status,
        durationMinutes:
          session.durationMinutes || HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
        minimumLevel: session.minimumLevel || HostLogSessionLevel.Info,
        requestedAt: session.createdAt,
        requestedByName:
          session.createdByUser?.name?.toString().trim() || undefined,
        expiresAt: session.expiresAt,
      });
    }

    return AndroidAgentLogSessions.toAnswer(forDevice);
  }

  private async applyReport(data: {
    projectId: ObjectID;
    hostId: ObjectID;
    report: DeviceLogSessionReport;
    now: Date;
  }): Promise<void> {
    // Only a session of this device: a report naming another's is not believed.
    const session: Model | null = await this.findOneBy({
      query: {
        _id: data.report.id,
        projectId: data.projectId,
        hostId: data.hostId,
      },
      select: {
        _id: true,
        status: true,
        startedAt: true,
      },
      props: { isRoot: true },
    });

    if (!session) {
      return;
    }

    const change: DeviceLogSessionChange | null =
      AndroidAgentLogSessions.changeFromReport({
        row: session,
        report: data.report,
        now: data.now,
      });

    if (change) {
      await this.applyChange(data.report.id, change);
    }
  }

  private async applyChange(
    id: ObjectID,
    change: DeviceLogSessionChange,
  ): Promise<void> {
    const update: QueryDeepPartialEntity<Model> = { status: change.status };

    if (change.statusMessage !== undefined) {
      update.statusMessage = change.statusMessage;
    }

    if (change.startedAt) {
      update.startedAt = change.startedAt;
    }

    if (change.endsAt) {
      update.endsAt = change.endsAt;
    }

    if (change.endedAt) {
      update.endedAt = change.endedAt;
    }

    await this.updateOneById({
      id: id,
      data: update,
      props: { isRoot: true },
    });
  }
}

export default new Service();
