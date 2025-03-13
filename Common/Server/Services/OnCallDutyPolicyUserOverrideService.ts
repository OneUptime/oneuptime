import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";

export class Service extends DatabaseService<OnCallDutyPolicyUserOverride> {
  public constructor() {
    super(OnCallDutyPolicyUserOverride);
  }

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
