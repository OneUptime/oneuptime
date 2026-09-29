import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import UserService from "./UserService";
import Model from "../../Models/DatabaseModels/DeletedProject";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Records a project that has just been deleted so the team can follow up with
   * the customer. The project row is already gone by the time this runs, so
   * everything written here has to come from the snapshot the caller took
   * before the delete (ProjectService.onBeforeDelete).
   *
   * SaaS only. Self-hosted installs have no one to reach out to, and the
   * gate lives here rather than at the call site so every caller gets it.
   *
   * Returns the row it wrote, or null when logging was skipped.
   */
  @CaptureSpan()
  public async logProjectDeletion(data: {
    project: Project;
    deletedByUserId?: ObjectID | undefined;
    deletionReason?: string | undefined;
  }): Promise<Model | null> {
    if (!IsBillingEnabled) {
      return null;
    }

    const project: Project = data.project;

    if (!project.id) {
      return null;
    }

    /*
     * Who to reach out to. The user who deleted the project is usually also
     * the one who created it - reuse the snapshot in that case instead of
     * spending a query on it.
     */
    let deletedByUser: User | null = null;

    if (data.deletedByUserId) {
      if (
        project.createdByUser &&
        project.createdByUserId?.toString() === data.deletedByUserId.toString()
      ) {
        deletedByUser = project.createdByUser;
      } else {
        deletedByUser = await UserService.findOneById({
          id: data.deletedByUserId,
          select: {
            _id: true,
            name: true,
            email: true,
            companyName: true,
            companyPhoneNumber: true,
            companySize: true,
            jobRole: true,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    const createdByUser: User | undefined = project.createdByUser;

    const deletedProject: Model = new Model();

    deletedProject.projectId = project.id;
    deletedProject.projectName = project.name || "";
    deletedProject.projectSlug = project.slug;
    deletedProject.projectCreatedAt = project.createdAt;
    deletedProject.projectDeletedAt = OneUptimeDate.getCurrentDate();
    deletedProject.deletionReason = data.deletionReason;

    deletedProject.projectDeletedByUserId = data.deletedByUserId;
    deletedProject.projectDeletedByUserName = deletedByUser?.name?.toString();
    deletedProject.projectDeletedByUserEmail = deletedByUser?.email;

    deletedProject.projectCreatedByUserId = project.createdByUserId;
    deletedProject.projectCreatedByUserName = createdByUser?.name?.toString();
    deletedProject.projectCreatedByUserEmail = createdByUser?.email;

    /*
     * Company details are collected at signup and hang off the User, so take
     * them from whoever created the project and fall back to whoever deleted
     * it - between the two there is usually one filled-in answer.
     */
    const companyName: string | undefined =
      createdByUser?.companyName || deletedByUser?.companyName;
    const companyPhoneNumber: Phone | undefined =
      createdByUser?.companyPhoneNumber || deletedByUser?.companyPhoneNumber;
    const companySize: string | undefined =
      createdByUser?.companySize || deletedByUser?.companySize;
    const jobRole: string | undefined =
      createdByUser?.jobRole || deletedByUser?.jobRole;

    deletedProject.companyName = companyName;
    deletedProject.companyPhoneNumber = companyPhoneNumber;
    deletedProject.companySize = companySize;
    deletedProject.jobRole = jobRole;

    deletedProject.planName = project.planName;
    deletedProject.paymentProviderPlanId = project.paymentProviderPlanId;
    deletedProject.paymentProviderCustomerId =
      project.paymentProviderCustomerId;
    deletedProject.paymentProviderSubscriptionId =
      project.paymentProviderSubscriptionId;
    deletedProject.paymentProviderSubscriptionStatus =
      project.paymentProviderSubscriptionStatus;
    deletedProject.paymentProviderSubscriptionSeats =
      project.paymentProviderSubscriptionSeats;
    deletedProject.trialEndsAt = project.trialEndsAt;

    deletedProject.activeMonitorCount = project.currentActiveMonitorsCount;
    deletedProject.wasProjectBlocked = project.isBlocked ?? false;

    return await this.create({
      data: deletedProject,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
