import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserProjectSsoConsent";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * See the model for what a row means. Written only from the confirmation link
 * a project-SSO sign-in emails to the account's own address; read on every
 * project-SSO sign-in on the hosted service.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async hasConsent(data: {
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

  /*
   * Idempotent. Two clicks on the same link, or two links for the same
   * project, must end with one row and no error for whoever clicked second.
   */
  @CaptureSpan()
  public async recordConsent(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    if (await this.hasConsent(data)) {
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
      if (await this.hasConsent(data)) {
        return;
      }

      throw err;
    }
  }
}

export default new Service();
