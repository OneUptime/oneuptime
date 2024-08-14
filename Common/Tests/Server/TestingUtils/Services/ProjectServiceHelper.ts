import Faker from "Common/Utils/Faker";
import Project from "Common/Models/DatabaseModels/Project";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";

export default class ProjectTestService {
  public static generateRandomProject(data?: { seatLimit?: number } | undefined): Project {
    const project: Project = new Project();

    // required fields
    project.name = Faker.generateCompanyName();
    project.slug = project.name;
    project.isBlocked = false;
    project.requireSsoForLogin = false;

    if(data && data.seatLimit){
      project.seatLimit = data.seatLimit;
    }

    project.smsOrCallCurrentBalanceInUSDCents = 0;
    project.autoRechargeSmsOrCallByBalanceInUSD = 0;
    project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD = 0;
    project.enableSmsNotifications = true;
    project.enableCallNotifications = true;
    project.planName = PlanType.Enterprise;
    project.paymentProviderPlanId = "price_1M4niQANuQdJ93r7AVjhnik5";
    project.enableAutoRechargeSmsOrCallBalance = true;
    project.lowCallAndSMSBalanceNotificationSentToOwners = true;
    project.failedCallAndSMSBalanceChargeNotificationSentToOwners = true;
    project.notEnabledSmsOrCallNotificationSentToOwners = true;

    return project;
  }
}
