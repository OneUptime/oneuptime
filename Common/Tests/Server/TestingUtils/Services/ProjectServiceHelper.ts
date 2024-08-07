import CreateBy from "../../../../Server/Types/Database/CreateBy";
import ObjectID from "Common/Types/ObjectID";
import Faker from "Common/Utils/Faker";
import Project from "Common/Models/DatabaseModels/Project";

export default class ProjectTestService {
  public static generateRandomProject(userId?: ObjectID): CreateBy<Project> {
    const project: Project = new Project();

    // required fields
    project.name = Faker.generateCompanyName();
    project.slug = project.name;
    project.isBlocked = false;
    project.requireSsoForLogin = false;
    project.smsOrCallCurrentBalanceInUSDCents = 0;
    project.autoRechargeSmsOrCallByBalanceInUSD = 0;
    project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD = 0;
    project.enableSmsNotifications = true;
    project.enableCallNotifications = true;
    project.enableAutoRechargeSmsOrCallBalance = true;
    project.lowCallAndSMSBalanceNotificationSentToOwners = true;
    project.failedCallAndSMSBalanceChargeNotificationSentToOwners = true;
    project.notEnabledSmsOrCallNotificationSentToOwners = true;

    return {
      data: project,
      props: { isRoot: true, userId },
    };
  }
}
