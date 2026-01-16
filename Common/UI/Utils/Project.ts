import { BILLING_ENABLED, getAllEnvVars } from "../Config";
import LocalStorage from "./LocalStorage";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../Types/Billing/SubscriptionStatus";
import Navigation from "./Navigation";
import SessionStorage from "./SessionStorage";

export default class ProjectUtil {
  public static getCurrentProjectId(): ObjectID | null {
    // if this is not available in the url, check the session storage
    const currentProjectId: string | undefined = SessionStorage.getItem(
      `current_project_id`,
    ) as string;

    if (currentProjectId && ObjectID.isValidUUID(currentProjectId)) {
      return new ObjectID(currentProjectId);
    }

    let projectId: string | undefined = Navigation.getFirstParam(2);

    if (projectId && projectId.includes(":projectId")) {
      projectId = undefined;
    }

    // Only return the projectId if it's a valid UUID
    // This prevents URL path segments like "email", "subscribe" etc. from being used as project IDs
    if (projectId && ObjectID.isValidUUID(projectId)) {
      return new ObjectID(projectId);
    }

    return null;
  }

  public static setIsSubscriptionInactiveOrOverdue(data: {
    paymentProviderMeteredSubscriptionStatus: SubscriptionStatus;
    paymentProviderSubscriptionStatus: SubscriptionStatus;
  }): boolean {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();

    const isSubscriptionInactive: boolean =
      SubscriptionStatusUtil.isSubscriptionInactive(
        data.paymentProviderMeteredSubscriptionStatus,
      ) ||
      SubscriptionStatusUtil.isSubscriptionInactive(
        data.paymentProviderSubscriptionStatus,
      );

    const isSubscriptionOverdue: boolean =
      SubscriptionStatusUtil.isSubscriptionOverdue(
        data.paymentProviderMeteredSubscriptionStatus,
      ) ||
      SubscriptionStatusUtil.isSubscriptionOverdue(
        data.paymentProviderSubscriptionStatus,
      );

    // save this to local storage
    LocalStorage.setItem(
      currentProjectId?.toString() + "_isSubscriptionInactive",
      isSubscriptionInactive,
    );

    LocalStorage.setItem(
      currentProjectId?.toString() + "_isSubscriptionOverdue",
      isSubscriptionOverdue,
    );

    return isSubscriptionInactive || isSubscriptionOverdue;
  }

  public static isSubscriptionInactive(): boolean {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();
    return (
      Boolean(
        LocalStorage.getItem(
          currentProjectId?.toString() + "_isSubscriptionInactive",
        ),
      ) || false
    );
  }

  public static getCurrentProject(): Project | null {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();
    if (!LocalStorage.getItem(`project_${currentProjectId}`)) {
      return null;
    }
    const projectJson: JSONObject = LocalStorage.getItem(
      `project_${currentProjectId}`,
    ) as JSONObject;
    return BaseModel.fromJSON(projectJson, Project) as Project;
  }

  public static setCurrentProject(project: JSONObject | Project): void {
    const currentProjectId: string | undefined =
      project._id?.toString() || this.getCurrentProjectId()?.toString();
    if (project instanceof Project) {
      project = BaseModel.toJSON(project, Project);
    }
    LocalStorage.setItem(`project_${currentProjectId}`, project);
    SessionStorage.setItem(`current_project_id`, currentProjectId);
  }

  public static clearCurrentProject(): void {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();
    LocalStorage.setItem(`project_${currentProjectId}`, null);
    SessionStorage.setItem(`current_project_id`, null);
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
