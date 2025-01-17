import { BILLING_ENABLED, getAllEnvVars } from "../Config";
import LocalStorage from "./LocalStorage";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../Types/Billing/SubscriptionStatus";

export default class ProjectUtil {
  public static setIsSubscriptionInactive(data: {
    paymentProviderMeteredSubscriptionStatus: SubscriptionStatus;
    paymentProviderSubscriptionStatus: SubscriptionStatus;
  }): boolean {
    const isSubscriptionInactive =
      SubscriptionStatusUtil.isSubscriptionInactive(
        data.paymentProviderMeteredSubscriptionStatus,
      ) ||
      SubscriptionStatusUtil.isSubscriptionInactive(
        data.paymentProviderSubscriptionStatus,
      );

    // save this to local storage
    LocalStorage.setItem("isSubscriptionInactive", isSubscriptionInactive);

    return isSubscriptionInactive;
  }

  public static isSubscriptionInactive(): boolean {
    return Boolean(LocalStorage.getItem("isSubscriptionInactive")) || false;
  }

  public static getCurrentProject(): Project | null {
    if (!LocalStorage.getItem("current_project")) {
      return null;
    }
    const projectJson: JSONObject = LocalStorage.getItem(
      "current_project",
    ) as JSONObject;
    return BaseModel.fromJSON(projectJson, Project) as Project;
  }

  public static getCurrentProjectId(): ObjectID | null {
    return this.getCurrentProject()?.id || null;
  }

  public static setCurrentProject(project: JSONObject | Project): void {
    if (project instanceof Project) {
      project = BaseModel.toJSON(project, Project);
    }
    LocalStorage.setItem("current_project", project);
  }

  public static clearCurrentProject(): void {
    LocalStorage.setItem("current_project", null);
  }

  public static getCurrentPlan(): PlanType | null {
    if (!BILLING_ENABLED) {
      return null;
    }

    const project: Project | null = this.getCurrentProject();
    if (!project || !project.paymentProviderPlanId) {
      return null;
    }

    return SubscriptionPlan.getPlanType(
      project.paymentProviderPlanId,
      getAllEnvVars(),
    );
  }
}
