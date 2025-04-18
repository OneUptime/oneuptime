import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import Timezone from "../../Types/Timezone";
import DeleteBy from "../Types/Database/DeleteBy";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<OnCallDutyPolicyUserOverride> {
  public constructor() {
    super(OnCallDutyPolicyUserOverride);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnCreate<OnCallDutyPolicyUserOverride>> {
    if (!createBy.data.startsAt || !createBy.data.endsAt) {
      throw new BadDataException("Start time and end time are required");
    }

    // make sure start time is before end time
    if (OneUptimeDate.isAfter(createBy.data.startsAt, createBy.data.endsAt)) {
      throw new BadDataException("Start time must be before end time");
    }

    // make sure overrideUser and routealertsToUser are not the same
    const overrideUserId: ObjectID | undefined | null =
      createBy.data.overrideUserId || createBy.data.overrideUser?.id;

    if (!overrideUserId) {
      throw new BadDataException("Override user is required");
    }

    const routeAlertsToUserId: ObjectID | undefined | null =
      createBy.data.routeAlertsToUserId || createBy.data.routeAlertsToUser?.id;

    if (!routeAlertsToUserId) {
      throw new BadDataException("Route alerts to user is required");
    }

    if (overrideUserId.toString() === routeAlertsToUserId.toString()) {
      throw new BadDataException(
        "Override user and route alerts to user cannot be the same",
      );
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<OnCallDutyPolicyUserOverride>,
    createdItem: OnCallDutyPolicyUserOverride,
  ): Promise<OnCallDutyPolicyUserOverride> {
    // add to on call feed.
    const onCallDutyPolicyId: ObjectID | undefined | null =
      createdItem.onCallDutyPolicyId || createdItem.onCallDutyPolicy?.id;

    const projectId: ObjectID | undefined | null =
      createdItem.projectId || createdItem.project?.id;

    const overrideUserId: ObjectID | undefined | null =
      createdItem.overrideUserId || createdItem.overrideUser?.id;

    const routeAlertsToUserId: ObjectID | undefined | null =
      createdItem.routeAlertsToUserId || createdItem.routeAlertsToUser?.id;

    if (
      onCallDutyPolicyId &&
      projectId &&
      overrideUserId &&
      routeAlertsToUserId
    ) {
      const onCallPolicyName: string | null =
        await OnCallDutyPolicyService.getOnCallDutyPolicyName({
          onCallDutyPolicyId: onCallDutyPolicyId,
        });

      const overrideUserTimezone: Timezone | null =
        await UserService.getTimezoneForUser(overrideUserId);

      const routeAlertsToUserTimezone: Timezone | null =
        await UserService.getTimezoneForUser(routeAlertsToUserId);

      const timezones: Timezone[] = [];
      if (overrideUserTimezone) {
        timezones.push(overrideUserTimezone);
      }

      if (routeAlertsToUserTimezone) {
        timezones.push(routeAlertsToUserTimezone);
      }

      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: onCallDutyPolicyId,
        projectId: projectId!,
        onCallDutyPolicyFeedEventType:
          OnCallDutyPolicyFeedEventType.UserOverrideAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `🔁 Added a User Override Rule for user **${await UserService.getUserMarkdownString(
          {
            userId: overrideUserId,
            projectId: projectId!,
          },
        )}** for the [On-Call Policy ${onCallPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}). All alerts will be routed to **${await UserService.getUserMarkdownString(
          {
            userId: routeAlertsToUserId,
            projectId: projectId!,
          },
        )}** from **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
          {
            date: createdItem.startsAt!,
            timezones: timezones,
          },
        )}**  to **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
          date: createdItem.endsAt!,
          timezones: timezones,
        })}**. `,

        userId: createdItem.createdByUserId! || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: createdItem.createdByUserId! || undefined,
        },
      });
    }

    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnDelete<OnCallDutyPolicyUserOverride>> {
    const itemsToDelete: OnCallDutyPolicyUserOverride[] = await this.findBy({
      query: deleteBy.query,
      select: {
        onCallDutyPolicyId: true,
        projectId: true,
        overrideUserId: true,
        routeAlertsToUserId: true,
        startsAt: true,
        endsAt: true,
        createdByUserId: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    for (const item of itemsToDelete) {
      const onCallDutyPolicyId: ObjectID | undefined | null =
        item.onCallDutyPolicyId || item.onCallDutyPolicy?.id;

      const projectId: ObjectID | undefined | null =
        item.projectId || item.project?.id;

      const overrideUserId: ObjectID | undefined | null =
        item.overrideUserId || item.overrideUser?.id;

      const routeAlertsToUserId: ObjectID | undefined | null =
        item.routeAlertsToUserId || item.routeAlertsToUser?.id;

      if (
        onCallDutyPolicyId &&
        projectId &&
        overrideUserId &&
        routeAlertsToUserId
      ) {
        const onCallPolicyName: string | null =
          await OnCallDutyPolicyService.getOnCallDutyPolicyName({
            onCallDutyPolicyId: onCallDutyPolicyId,
          });

        const overrideUserTimezone: Timezone | null =
          await UserService.getTimezoneForUser(overrideUserId);

        const routeAlertsToUserTimezone: Timezone | null =
          await UserService.getTimezoneForUser(routeAlertsToUserId);

        const timezones: Timezone[] = [];
        if (overrideUserTimezone) {
          timezones.push(overrideUserTimezone);
        }

        if (routeAlertsToUserTimezone) {
          timezones.push(routeAlertsToUserTimezone);
        }

        const deleteByUserId: ObjectID | undefined | null =
          deleteBy.props.userId;

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId!,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.UserOverrideRemoved,
          displayColor: Gray500,
          feedInfoInMarkdown: `❌ Removed a User Override Rule for user **${await UserService.getUserMarkdownString(
            {
              userId: overrideUserId,
              projectId: projectId!,
            },
          )}** for the [On-Call Policy ${onCallPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}). All alerts will be routed back to **${await UserService.getUserMarkdownString(
            {
              userId: overrideUserId,
              projectId: projectId!,
            },
          )}**`,
          userId: deleteByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: deleteByUserId || undefined,
          },
        });
      }
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async getOnCallDutyPolicyUserOverrideLinkInDashboard(data: {
    projectId: ObjectID;
    onCallDutyPolicyId?: ObjectID | undefined; // if this is null then this is a global override
    onCallDutyPolicyUserOverrideId: ObjectID;
  }): Promise<URL> {
    const projectId: ObjectID = data.projectId;
    const onCallDutyPolicyId: ObjectID | undefined = data.onCallDutyPolicyId;
    const onCallDutyPolicyUserOverrideId: ObjectID =
      data.onCallDutyPolicyUserOverrideId;

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (!onCallDutyPolicyId) {
      return URL.fromString(dashboardUrl.toString()).addRoute(
        `/${projectId.toString()}/on-call-duty/user-overrides/${onCallDutyPolicyUserOverrideId.toString()}`,
      );
    }
    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/policies/${onCallDutyPolicyId.toString()}/user-overrides/${onCallDutyPolicyUserOverrideId.toString()}`,
    );
  }
}
export default new Service();
