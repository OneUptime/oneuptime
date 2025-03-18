import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
