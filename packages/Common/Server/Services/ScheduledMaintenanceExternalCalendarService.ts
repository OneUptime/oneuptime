import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import ScheduledMaintenanceExternalCalendarEventService from "./ScheduledMaintenanceExternalCalendarEventService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES,
  EXTERNAL_CALENDARS_PER_PROJECT,
  ExternalCalendarLinkResult,
  getExternalCalendarRefreshInterval,
  normalizeExternalCalendarLink,
} from "../../Types/ScheduledMaintenance/ExternalCalendar";
import { pickDistinctColor } from "../../Utils/DistinctColor";

export const EXTERNAL_CALENDAR_LIMIT_MESSAGE: string = `A project can show up to ${EXTERNAL_CALENDARS_PER_PROJECT} calendars on its maintenance calendar. Delete one to add another.`;

/*
 * The calendars from outside a project drawn on its maintenance calendar
 * (ScheduledMaintenanceExternalCalendar).
 *
 *   - A link is checked and written the one way OneUptime reads it
 *     (normalizeExternalCalendarLink: webcal:// as https://), on create and
 *     on Change link alike, and a link that cannot be one is refused with a
 *     sentence saying why. Its host is kept beside it, readable.
 *   - A calendar added without a colour gets one the project's other
 *     calendars do not use, and a refresh interval that is not one of the
 *     choices reads as the nearest longer one.
 *   - Changing the link forgets what the old one held: its events, its
 *     status, and when it is next read - it is read again at once. Turning a
 *     calendar on, or changing how often it is read, has it read at once too.
 *   - At most EXTERNAL_CALENDARS_PER_PROJECT calendars per project.
 *
 * The status columns are the Workers' alone (ExternalCalendarRefresher):
 * computed, so no request writes them, and the resets above are written as
 * root after the caller's own update has passed every check.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // The link as stored, or a refusal saying why it cannot be one.
  public static checkLink(value: unknown): { url: string; host: string } {
    const result: ExternalCalendarLinkResult = normalizeExternalCalendarLink(
      typeof value === "string" ? value : "",
    );

    if ("problem" in result) {
      throw new BadDataException(
        EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES[result.problem],
      );
    }

    return result;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException("projectId is required");
    }

    createBy.data.projectId = projectId;

    const existing: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
      },
      props: {
        isRoot: true,
      },
    });

    if (existing.toNumber() >= EXTERNAL_CALENDARS_PER_PROJECT) {
      throw new BadDataException(EXTERNAL_CALENDAR_LIMIT_MESSAGE);
    }

    const link: { url: string; host: string } = Service.checkLink(
      createBy.data.calendarUrl,
    );

    createBy.data.calendarUrl = link.url;
    // Computed: written by OneUptime, never by the request.
    createBy.data.calendarHost = link.host;
    // Read at the next run of the Workers' job.
    createBy.data.nextReadAt = OneUptimeDate.getCurrentDate();

    if (typeof createBy.data.name === "string") {
      createBy.data.name = createBy.data.name.trim();
    }

    if (createBy.data.refreshIntervalInMinutes !== undefined) {
      createBy.data.refreshIntervalInMinutes =
        getExternalCalendarRefreshInterval(
          createBy.data.refreshIntervalInMinutes,
        );
    }

    if (!createBy.data.color) {
      createBy.data.color = await this.pickColor(projectId);
    }

    return { createBy, carryForward: null };
  }

  // A colour none of the project's calendars uses yet, where there is one.
  private async pickColor(projectId: ObjectID): Promise<Color> {
    const calendars: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        color: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return pickDistinctColor(
      calendars
        .map((calendar: Model): Color | undefined => {
          return calendar.color;
        })
        .filter((color: Color | undefined): color is Color => {
          return Boolean(color);
        }),
    );
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    let linkHost: string | null = null;

    if (updateBy.data.calendarUrl !== undefined) {
      const link: { url: string; host: string } = Service.checkLink(
        updateBy.data.calendarUrl,
      );

      updateBy.data.calendarUrl = link.url;
      linkHost = link.host;
    }

    if (typeof updateBy.data.name === "string") {
      updateBy.data.name = updateBy.data.name.trim();
    }

    if (updateBy.data.refreshIntervalInMinutes !== undefined) {
      updateBy.data.refreshIntervalInMinutes =
        getExternalCalendarRefreshInterval(
          updateBy.data.refreshIntervalInMinutes as number,
        );
    }

    /*
     * What the update means for when the calendar is next read, flagged
     * here and written in onUpdateSuccess as root: the status columns are
     * computed, and refused to a request that writes them.
     */
    const readAgainNow: boolean =
      linkHost !== null ||
      updateBy.data.isEnabled === true ||
      updateBy.data.refreshIntervalInMinutes !== undefined;

    return {
      updateBy,
      carryForward: { linkHost: linkHost, readAgainNow: readAgainNow },
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: { linkHost: string | null; readAgainNow: boolean } =
      onUpdate.carryForward || { linkHost: null, readAgainNow: false };

    if (!carryForward.readAgainNow) {
      return onUpdate;
    }

    for (const id of updatedItemIds) {
      if (carryForward.linkHost !== null) {
        // A new link: nothing the old one held still applies.
        await this.updateColumnsByIdWithoutHooks({
          id: id,
          data: {
            calendarHost: carryForward.linkHost,
            nextReadAt: OneUptimeDate.getCurrentDate(),
            lastReadAt: null as unknown as Date,
            lastReadAttemptAt: null as unknown as Date,
            lastReadError: null as unknown as string,
            lastReadHttpStatus: null as unknown as number,
            eventCount: 0,
            hasMoreEvents: false,
            contentDigest: null as unknown as string,
          },
        });

        await ScheduledMaintenanceExternalCalendarEventService.deleteEventsOfCalendar(
          id,
        );

        continue;
      }

      await this.updateColumnsByIdWithoutHooks({
        id: id,
        data: {
          nextReadAt: OneUptimeDate.getCurrentDate(),
        },
      });
    }

    return onUpdate;
  }

  /*
   * Claims a calendar for a read: moves its next read to `leaseUntil` if it
   * is still `expectedNextReadAt`, so of two readers that race for it - the
   * Workers' job and Read now - exactly one wins.
   */
  @CaptureSpan()
  public async claimForRead(data: {
    id: ObjectID;
    expectedNextReadAt: Date | null;
    leaseUntil: Date;
  }): Promise<boolean> {
    return await this.compareAndSetColumnsByIdWithoutHooks({
      id: data.id,
      data: {
        nextReadAt: data.leaseUntil,
      },
      expectedData: {
        nextReadAt: data.expectedNextReadAt as unknown as Date,
      },
      skipUpdateDateColumn: true,
    });
  }
}

export default new Service();
