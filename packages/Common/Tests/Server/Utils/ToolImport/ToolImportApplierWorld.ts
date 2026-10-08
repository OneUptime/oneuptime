import { jest } from "@jest/globals";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ServiceOwnerTeamService from "../../../../Server/Services/ServiceOwnerTeamService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import ToolImportRecordService from "../../../../Server/Services/ToolImportRecordService";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * OneUptime's services as the applier unit tests see them: every create the
 * import makes is recorded (which service, the record, the props it was made
 * with, its misc data) and answered with the record and a new id, as the
 * service would answer. A test can make one service refuse, to see the
 * import carry on. ToolImportRecord rows live in memory, so a test can
 * start from what an earlier import (or an earlier attempt) remembered.
 *
 * The Postgres suite (ToolImportApplierPostgres) runs the same import
 * against the real services and a real database.
 */

export interface RecordedCreate {
  service: string;
  data: BaseModel;
  props: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject | undefined;
}

type CreateArgs = {
  data: BaseModel;
  props: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject | undefined;
};

interface CreateSpyTarget {
  create: (args: CreateArgs) => Promise<BaseModel>;
}

export class ApplierWorld {
  public creates: Array<RecordedCreate> = [];
  public records: Array<ToolImportRecord> = [];
  public deletedRecordIds: Array<string> = [];
  public members: Map<string, string> = new Map<string, string>();
  private refusals: Map<string, (data: BaseModel) => Error | null> = new Map<
    string,
    (data: BaseModel) => Error | null
  >();

  public constructor() {
    const services: Record<string, unknown> = {
      TeamMember: TeamMemberService,
      Team: TeamService,
      Service: ServiceService,
      ServiceOwnerTeam: ServiceOwnerTeamService,
      IncidentSeverity: IncidentSeverityService,
      IncidentState: IncidentStateService,
      IncidentRole: IncidentRoleService,
      IncidentCustomField: IncidentCustomFieldService,
      OnCallDutyPolicySchedule: OnCallDutyPolicyScheduleService,
      OnCallDutyPolicyScheduleLayer: OnCallDutyPolicyScheduleLayerService,
      OnCallDutyPolicyScheduleLayerUser:
        OnCallDutyPolicyScheduleLayerUserService,
      OnCallDutyPolicyScheduleOwnerTeam:
        OnCallDutyPolicyScheduleOwnerTeamService,
      OnCallDutyPolicy: OnCallDutyPolicyService,
      OnCallDutyPolicyEscalationRule: OnCallDutyPolicyEscalationRuleService,
      OnCallDutyPolicyOwnerTeam: OnCallDutyPolicyOwnerTeamService,
    };

    for (const [name, service] of Object.entries(services)) {
      jest
        .spyOn(service as CreateSpyTarget, "create")
        .mockImplementation(async (args: CreateArgs): Promise<BaseModel> => {
          return await this.create(name, args);
        });
    }

    jest
      .spyOn(ToolImportRecordService, "findBy")
      .mockImplementation((async (): Promise<Array<ToolImportRecord>> => {
        return this.records.map((record: ToolImportRecord) => {
          return record;
        });
      }) as never);

    jest
      .spyOn(ToolImportRecordService, "create")
      .mockImplementation((async (args: {
        data: ToolImportRecord;
      }): Promise<ToolImportRecord> => {
        const record: ToolImportRecord = args.data;
        record.id = ObjectID.generate();
        this.records.push(record);
        return record;
      }) as never);

    jest
      .spyOn(ToolImportRecordService, "updateOneById")
      .mockImplementation((async (args: {
        id: ObjectID;
        data: { isComplete?: boolean };
      }): Promise<void> => {
        const record: ToolImportRecord | undefined = this.records.find(
          (candidate: ToolImportRecord) => {
            return candidate.id?.toString() === args.id.toString();
          },
        );

        if (record && args.data.isComplete !== undefined) {
          record.isComplete = args.data.isComplete;
        }
      }) as never);

    jest
      .spyOn(ToolImportRecordService, "deleteOneById")
      .mockImplementation((async (args: { id: ObjectID }): Promise<number> => {
        this.deletedRecordIds.push(args.id.toString());
        this.records = this.records.filter((record: ToolImportRecord) => {
          return record.id?.toString() !== args.id.toString();
        });
        return 1;
      }) as never);

    jest
      .spyOn(ToolImportProjectStateReader, "readMembersByEmail")
      .mockImplementation(async (): Promise<Map<string, string>> => {
        return new Map(this.members);
      });
  }

  // Makes `service` refuse the creates `refuse` returns an error for.
  public refuse(
    service: string,
    refuse: (data: BaseModel) => Error | null,
  ): ApplierWorld {
    this.refusals.set(service, refuse);
    return this;
  }

  public createsOf(service: string): Array<RecordedCreate> {
    return this.creates.filter((create: RecordedCreate) => {
      return create.service === service;
    });
  }

  public dataOf<T extends BaseModel>(service: string): Array<T> {
    return this.createsOf(service).map((create: RecordedCreate) => {
      return create.data as T;
    });
  }

  private async create(name: string, args: CreateArgs): Promise<BaseModel> {
    const refusal: Error | null = this.refusals.get(name)?.(args.data) || null;

    if (refusal) {
      throw refusal;
    }

    const data: BaseModel = args.data;
    data.id = ObjectID.generate();

    // An invitation by email names the account it created or found.
    if (name === "TeamMember" && args.miscDataProps?.["email"]) {
      (data as unknown as { userId: ObjectID }).userId = new ObjectID(
        this.userIdFor(args.miscDataProps["email"] as string),
      );
    }

    this.creates.push({
      service: name,
      data: data,
      props: args.props,
      miscDataProps: args.miscDataProps,
    });

    return data;
  }

  // A stable user id per invited email, so tests can name who was invited.
  public userIdFor(email: string): string {
    let hash: number = 0;

    for (const char of email) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    const hex: string = hash.toString(16).padStart(8, "0").slice(0, 8);

    return `${hex}-0000-4000-8000-000000000000`;
  }
}
