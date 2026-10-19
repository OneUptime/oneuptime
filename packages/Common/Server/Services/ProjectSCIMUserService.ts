import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProjectSCIMUser";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * See the model for what a row means. Read and written only by the project
 * SCIM server (ee/Server/Identity), as root.
 */

// Everything a record holds, as the SCIM server reads it.
export const PROJECT_SCIM_USER_SELECT: Select<Model> = {
  _id: true,
  projectId: true,
  projectScimId: true,
  userId: true,
  isActive: true,
  userName: true,
  externalId: true,
  scimAttributes: true,
  createdAt: true,
  updatedAt: true,
};

export interface ProjectSCIMUserRecordData {
  projectId: ObjectID;
  projectScimId: ObjectID;
  userId: ObjectID;
  isActive: boolean;
  userName: string | null;
  externalId: string | null;
  scimAttributes: JSONObject;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // The record this connection keeps for this account, or null.
  @CaptureSpan()
  public async findRecord(data: {
    projectScimId: ObjectID;
    userId: ObjectID;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectScimId: data.projectScimId,
        userId: data.userId,
      },
      select: PROJECT_SCIM_USER_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  // Every record this connection keeps, oldest first.
  @CaptureSpan()
  public async findRecordsOfConnection(
    projectScimId: ObjectID,
  ): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectScimId: projectScimId,
      },
      select: PROJECT_SCIM_USER_SELECT,
      sort: {
        createdAt: SortOrder.Ascending,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The records whose userName is `userName`, whatever its case: SCIM's
   * userName is not case-exact (RFC 7643, section 4.1.1), and identity
   * providers look users up with it in the case they hold it in.
   */
  @CaptureSpan()
  public async findRecordsByUserName(data: {
    projectScimId: ObjectID;
    userName: string;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectScimId: data.projectScimId,
        userName: QueryHelper.findWithSameText(data.userName),
      },
      select: PROJECT_SCIM_USER_SELECT,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  // The records with this externalId, which is case-exact (RFC 7643, 3.1).
  @CaptureSpan()
  public async findRecordsByExternalId(data: {
    projectScimId: ObjectID;
    externalId: string;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectScimId: data.projectScimId,
        externalId: data.externalId,
      },
      select: PROJECT_SCIM_USER_SELECT,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Writes what the connection now holds for the account: a new record, or
   * the one it has, replaced. Two requests racing to create the same record
   * end with one: the unique index on (projectScimId, userId) turns the
   * second insert away, and it updates the row the first wrote instead.
   */
  @CaptureSpan()
  public async saveRecord(data: ProjectSCIMUserRecordData): Promise<Model> {
    const existing: Model | null = await this.findRecord(data);

    if (existing) {
      return await this.replaceRecord(existing, data);
    }

    const record: Model = new Model();
    record.projectId = data.projectId;
    record.projectScimId = data.projectScimId;
    record.userId = data.userId;
    record.isActive = data.isActive;
    record.userName = data.userName as string;
    record.externalId = data.externalId as string;
    record.scimAttributes = data.scimAttributes;

    try {
      return await this.create({
        data: record,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      const written: Model | null = await this.findRecord(data);

      if (written) {
        return await this.replaceRecord(written, data);
      }

      throw err;
    }
  }

  // Removes the connection's record of the account, if it has one.
  @CaptureSpan()
  public async deleteRecord(data: {
    projectScimId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    await this.deleteBy({
      query: {
        projectScimId: data.projectScimId,
        userId: data.userId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  private async replaceRecord(
    existing: Model,
    data: ProjectSCIMUserRecordData,
  ): Promise<Model> {
    await this.updateOneById({
      id: existing.id!,
      data: {
        isActive: data.isActive,
        userName: data.userName,
        externalId: data.externalId,
        scimAttributes: data.scimAttributes,
      } as any,
      props: {
        isRoot: true,
      },
    });

    existing.isActive = data.isActive;
    existing.userName = data.userName as string;
    existing.externalId = data.externalId as string;
    existing.scimAttributes = data.scimAttributes;

    return existing;
  }
}

export default new Service();
