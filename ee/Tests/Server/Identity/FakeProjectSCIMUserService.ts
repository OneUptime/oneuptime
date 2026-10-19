import ProjectSCIMUser from "Common/Models/DatabaseModels/ProjectSCIMUser";
import { ProjectSCIMUserRecordData } from "Common/Server/Services/ProjectSCIMUserService";
import ObjectID from "Common/Types/ObjectID";

/*
 * ProjectSCIMUserService as the SCIM routes use it, in memory: the records a
 * project SCIM connection keeps of the users it provisioned. Route suites
 * mock the service with this so a test can read back what a request wrote -
 * as an identity provider does - without a database:
 *
 *   jest.mock("Common/Server/Services/ProjectSCIMUserService", () => {
 *     const fake = jest.requireActual("./FakeProjectSCIMUserService");
 *     return { __esModule: true, default: fake.fakeProjectSCIMUserService };
 *   });
 *
 * and fakeProjectSCIMUserService.reset() before each test.
 */

const same: (a: ObjectID | undefined, b: ObjectID | undefined) => boolean = (
  a: ObjectID | undefined,
  b: ObjectID | undefined,
): boolean => {
  return (
    Boolean(a) &&
    Boolean(b) &&
    a!.toString().toLowerCase() === b!.toString().toLowerCase()
  );
};

// A copy, as each read from the database is.
const copy: (record: ProjectSCIMUser) => ProjectSCIMUser = (
  record: ProjectSCIMUser,
): ProjectSCIMUser => {
  const clone: ProjectSCIMUser = new ProjectSCIMUser(record.id!);
  clone.projectId = record.projectId!;
  clone.projectScimId = record.projectScimId!;
  clone.userId = record.userId!;
  clone.isActive = record.isActive!;
  clone.userName = record.userName as string;
  clone.externalId = record.externalId as string;
  clone.scimAttributes = record.scimAttributes
    ? JSON.parse(JSON.stringify(record.scimAttributes))
    : record.scimAttributes!;
  clone.createdAt = record.createdAt!;
  clone.updatedAt = record.updatedAt!;
  return clone;
};

export class FakeProjectSCIMUserService {
  public records: Array<ProjectSCIMUser> = [];

  // Every call, by method, for assertions on what a request did.
  public calls: Array<{ method: string; data: unknown }> = [];

  private clock: number = Date.parse("2026-01-01T00:00:00.000Z");

  public reset(): void {
    this.records = [];
    this.calls = [];
  }

  // A record put in place before a request, as an earlier provisioning left it.
  public seed(data: ProjectSCIMUserRecordData): ProjectSCIMUser {
    const record: ProjectSCIMUser = this.build(data);
    this.records.push(record);
    return copy(record);
  }

  public async findRecord(data: {
    projectScimId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectSCIMUser | null> {
    this.calls.push({ method: "findRecord", data });

    const record: ProjectSCIMUser | undefined = this.records.find(
      (item: ProjectSCIMUser): boolean => {
        return (
          same(item.projectScimId, data.projectScimId) &&
          same(item.userId, data.userId)
        );
      },
    );

    return record ? copy(record) : null;
  }

  public async findRecordsOfConnection(
    projectScimId: ObjectID,
  ): Promise<Array<ProjectSCIMUser>> {
    this.calls.push({ method: "findRecordsOfConnection", data: projectScimId });

    return this.records
      .filter((item: ProjectSCIMUser): boolean => {
        return same(item.projectScimId, projectScimId);
      })
      .map(copy);
  }

  public async findRecordsByUserName(data: {
    projectScimId: ObjectID;
    userName: string;
  }): Promise<Array<ProjectSCIMUser>> {
    this.calls.push({ method: "findRecordsByUserName", data });

    return this.records
      .filter((item: ProjectSCIMUser): boolean => {
        return (
          same(item.projectScimId, data.projectScimId) &&
          typeof item.userName === "string" &&
          item.userName.trim().toLowerCase() ===
            data.userName.trim().toLowerCase()
        );
      })
      .map(copy);
  }

  public async findRecordsByExternalId(data: {
    projectScimId: ObjectID;
    externalId: string;
  }): Promise<Array<ProjectSCIMUser>> {
    this.calls.push({ method: "findRecordsByExternalId", data });

    return this.records
      .filter((item: ProjectSCIMUser): boolean => {
        return (
          same(item.projectScimId, data.projectScimId) &&
          item.externalId === data.externalId
        );
      })
      .map(copy);
  }

  public async saveRecord(
    data: ProjectSCIMUserRecordData,
  ): Promise<ProjectSCIMUser> {
    this.calls.push({ method: "saveRecord", data });

    const existing: ProjectSCIMUser | undefined = this.records.find(
      (item: ProjectSCIMUser): boolean => {
        return (
          same(item.projectScimId, data.projectScimId) &&
          same(item.userId, data.userId)
        );
      },
    );

    if (existing) {
      existing.isActive = data.isActive;
      existing.userName = data.userName as string;
      existing.externalId = data.externalId as string;
      existing.scimAttributes = JSON.parse(JSON.stringify(data.scimAttributes));
      existing.updatedAt = this.tick();
      return copy(existing);
    }

    const record: ProjectSCIMUser = this.build(data);
    this.records.push(record);
    return copy(record);
  }

  public async deleteRecord(data: {
    projectScimId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    this.calls.push({ method: "deleteRecord", data });

    this.records = this.records.filter((item: ProjectSCIMUser): boolean => {
      return !(
        same(item.projectScimId, data.projectScimId) &&
        same(item.userId, data.userId)
      );
    });
  }

  private build(data: ProjectSCIMUserRecordData): ProjectSCIMUser {
    const record: ProjectSCIMUser = new ProjectSCIMUser(ObjectID.generate());
    record.projectId = data.projectId;
    record.projectScimId = data.projectScimId;
    record.userId = data.userId;
    record.isActive = data.isActive;
    record.userName = data.userName as string;
    record.externalId = data.externalId as string;
    record.scimAttributes = JSON.parse(JSON.stringify(data.scimAttributes));
    record.createdAt = this.tick();
    record.updatedAt = record.createdAt;
    return record;
  }

  private tick(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }
}

export const fakeProjectSCIMUserService: FakeProjectSCIMUserService =
  new FakeProjectSCIMUserService();
