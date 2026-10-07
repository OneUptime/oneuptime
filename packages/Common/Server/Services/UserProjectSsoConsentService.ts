import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserProjectSsoConsent";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * See the model for what a row means. Written only from the confirmation link
 * a project-SSO sign-in emails to the account's own address; read on every
 * project-SSO sign-in on the hosted service, and by SCIM when it adds an
 * existing account to a team.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Whether the account's owner agreed that this project's single sign-on
   * may sign them in - and they are still in the project.
   *
   * The confirmation link records the consent only once the person has
   * joined the project (ProjectSsoSignInConfirmation.confirm), so a consent
   * with no accepted membership beside it belongs to somebody who has left.
   * Their agreement was to be in the project; once they have left it, the
   * project's SSO cannot sign them in, nor its SCIM add them back as a
   * member, without asking again. Leaving removes the row as well
   * (ProjectLeaveAccessCleanup); this condition rides on the same read
   * (ProjectMembership.userIdWhileMember), so a row a failed cleanup left
   * behind is never honoured either.
   */
  @CaptureSpan()
  public async hasConsent(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const count: PositiveNumber = await this.countBy({
      query: {
        userId: ProjectMembership.userIdWhileMember({
          userId: data.userId,
          projectId: data.projectId,
        }),
        projectId: data.projectId,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber() > 0;
  }

  /*
   * Idempotent. Two clicks on the same link, or two links for the same
   * project, must end with one row and no error for whoever clicked second.
   */
  @CaptureSpan()
  public async recordConsent(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    if (await this.hasConsentRow(data)) {
      return;
    }

    const consent: Model = new Model();
    consent.userId = data.userId;
    consent.projectId = data.projectId;

    try {
      await this.create({
        data: consent,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      /*
       * Lost a race with a concurrent click: the unique index turned the
       * second insert away, and the row it wanted is there. Anything else is
       * a real failure.
       */
      if (await this.hasConsentRow(data)) {
        return;
      }

      throw err;
    }
  }

  /*
   * Whether the row exists at all, membership aside: what the unique index
   * on (userId, projectId) allows one of.
   */
  private async hasConsentRow(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const count: PositiveNumber = await this.countBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber() > 0;
  }
}

export default new Service();
