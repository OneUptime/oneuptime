import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserProjectSsoIdentity";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * See the model for what a row means. Read on every sign-in through a
 * project's SAML provider whose response carries an object ID, and written
 * at the first one that signs the account in.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // The object ID the account is bound to through this provider, or null.
  @CaptureSpan()
  public async getBoundObjectId(data: {
    projectSsoId: ObjectID;
    userId: ObjectID;
  }): Promise<string | null> {
    const row: Model | null = await this.findOneBy({
      query: {
        projectSsoId: data.projectSsoId,
        userId: data.userId,
      },
      select: {
        objectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    return row?.objectId || null;
  }

  /*
   * Binds the account to the object ID through this provider, unless it is
   * bound already, and answers the object ID it is bound to: the one given,
   * or the one an earlier - or a concurrent - sign-in bound it to, which the
   * caller compares. Idempotent.
   */
  @CaptureSpan()
  public async bind(data: {
    projectId: ObjectID;
    projectSsoId: ObjectID;
    userId: ObjectID;
    objectId: string;
  }): Promise<string> {
    const bound: string | null = await this.getBoundObjectId(data);

    if (bound) {
      return bound;
    }

    const identity: Model = new Model();
    identity.projectId = data.projectId;
    identity.projectSsoId = data.projectSsoId;
    identity.userId = data.userId;
    identity.objectId = data.objectId;

    try {
      await this.create({
        data: identity,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      /*
       * Lost a race with a concurrent first sign-in: the unique index turned
       * this insert away, and the row it found is the binding. Anything else
       * is a real failure.
       */
      const raced: string | null = await this.getBoundObjectId(data);

      if (raced) {
        return raced;
      }

      throw err;
    }

    return data.objectId;
  }
}

export default new Service();
