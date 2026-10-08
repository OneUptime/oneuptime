import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyOwnerTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyScheduleOwnerTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import ServiceModel from "../../../Models/DatabaseModels/Service";
import ServiceOwnerTeam from "../../../Models/DatabaseModels/ServiceOwnerTeam";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import ToolImportRecord from "../../../Models/DatabaseModels/ToolImportRecord";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "../../../Types/Color";
import { serializeCustomFieldDropdownOptions } from "../../../Types/CustomField/CustomFieldDropdownOption";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import {
  TOOL_IMPORT_MAX_LEVELS_PER_POLICY,
  TOOL_IMPORT_MAX_NAME_LENGTH,
} from "../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportProgress,
  ToolImportReport,
  ToolImportReportItem,
  ToolImportSelection,
} from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  ToolImportResourceKindOrder,
} from "../../../Types/ToolImport/ToolImportResourceKind";
import {
  buildLayerFromImportedRotation,
  getGroupScheduleName,
  getGroupSourceId,
  groupRotationsIntoSchedules,
  isGroupSourceIdOf,
  resolveImportedTimezone,
} from "../../../Types/ToolImport/ToolImportScheduleRules";
import {
  ImportedIncidentCustomField,
  ImportedIncidentRole,
  ImportedIncidentSeverity,
  ImportedIncidentState,
  ImportedPerson,
  ImportedPolicy,
  ImportedPolicyLevel,
  ImportedRotation,
  ImportedSchedule,
  ImportedService,
  ImportedTeam,
  ToolImportSnapshot,
} from "../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import { pickColorForName } from "../../../Utils/DistinctColor";
import IncidentCustomFieldService from "../../Services/IncidentCustomFieldService";
import IncidentRoleService from "../../Services/IncidentRoleService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateService from "../../Services/IncidentStateService";
import OnCallDutyPolicyEscalationRuleService from "../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyOwnerTeamService from "../../Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyScheduleLayerService from "../../Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "../../Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ServiceOwnerTeamService from "../../Services/ServiceOwnerTeamService";
import ServiceService from "../../Services/ServiceService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import ToolImportRecordService from "../../Services/ToolImportRecordService";
import Errors from "../Errors";
import ToolImportProjectStateReader from "./ToolImportProjectStateReader";

/*
 * THE IMPORT: WHAT THE PERSON TICKED, CREATED THROUGH ONEUPTIME'S OWN
 * SERVICES, AS THE PERSON.
 *
 * Every record is created with the person's props - their permissions,
 * their project's plan - through the same service a create from the
 * dashboard goes through, so every rule a hand-made record meets (who may
 * create it, what the plan includes, a policy's one level on the Free plan,
 * who may be invited to which team, an invitation's email) holds for an
 * imported one. A refusal fails that item, with OneUptime's own words, and
 * the import goes on with the rest.
 *
 * Order matters and is fixed (ToolImportResourceKindOrder): people first,
 * because everything else names them; teams before what is owned by a team;
 * schedules before the policies that page them. Each item finds what it
 * names among what this import created and what it matched - a schedule's
 * layer is made of the people who were invited or matched, a policy's level
 * pages the schedules that were created or matched. Something it names that
 * was not brought over is left out of it, and the report says who.
 *
 * Every record created is remembered with the tool's id (ToolImportRecord),
 * written as soon as the record exists, so a second import - or this one,
 * should a worker stop and the job run again - never creates it twice. A
 * record with parts (a schedule's layers, a policy's levels) is remembered as
 * incomplete until its parts are made; one found incomplete is reported, not
 * made again.
 */

export interface ToolImportApplyInput {
  runId: ObjectID;
  projectId: ObjectID;
  source: ToolImportSource;
  snapshot: ToolImportSnapshot;
  // The plan worked out for the person when the import starts.
  plan: ToolImportPlan;
  selection: ToolImportSelection;
  // The person's props, with the project's plan.
  props: DatabaseCommonInteractionProps;
  // Whether a policy may have more than one level (not on the Free plan).
  isLimitedToOneLevelPerPolicy: boolean;
  now: Date;
  onProgress?: ((progress: ToolImportProgress) => Promise<void>) | undefined;
}

// The colours severities get, from the most severe down.
const SEVERITY_COLORS: Array<string> = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#3b82f6",
];

const MAX_ERROR_LENGTH: number = 500;

export default class ToolImportApplier {
  public static async apply(
    input: ToolImportApplyInput,
  ): Promise<ToolImportReport> {
    return await new ApplyRun(input).run();
  }
}

class ApplyRun {
  private input: ToolImportApplyInput;
  private selected: Set<string>;
  private reportItems: Map<string, ToolImportReportItem> = new Map<
    string,
    ToolImportReportItem
  >();
  // OneUptime records each source item became or is matched to, by kind.
  private resolved: Map<ToolImportResourceKind, Map<string, Array<string>>> =
    new Map<ToolImportResourceKind, Map<string, Array<string>>>();
  // What earlier imports (and this one, before a restart) remembered.
  private records: Array<ToolImportRecord> = [];
  private done: number = 0;
  private total: number = 0;

  public constructor(input: ToolImportApplyInput) {
    this.input = input;
    this.selected = new Set<string>(input.selection.selectedKeys);
  }

  public async run(): Promise<ToolImportReport> {
    this.records = await ToolImportRecordService.findBy({
      query: {
        projectId: this.input.projectId,
        source: this.input.source,
      },
      select: {
        _id: true,
        kind: true,
        sourceId: true,
        recordId: true,
        isComplete: true,
        toolImportRunId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    /*
     * What is already in OneUptime is what anything created now names:
     * matched records, and what earlier imports brought over - every
     * schedule a schedule of the tool became, so a policy pages them all.
     */
    for (const item of this.input.plan.items) {
      if (
        (item.action === ToolImportAction.Match ||
          item.action === ToolImportAction.AlreadyImported) &&
        item.existingRecordId
      ) {
        this.resolve(item.kind, item.sourceId, [
          item.existingRecordId,
          ...(item.additionalRecordIds || []),
        ]);
      }

      if (this.isToDo(item)) {
        this.total++;
      }
    }

    await this.reportProgress(undefined);

    for (const kind of ToolImportResourceKindOrder) {
      for (const item of this.input.plan.items) {
        if (item.kind === kind) {
          await this.applyItem(item);
        }
      }
    }

    return {
      items: this.input.plan.items
        .map((item: ToolImportPlanItem): ToolImportReportItem | undefined => {
          return this.reportItems.get(item.key);
        })
        .filter(
          (
            item: ToolImportReportItem | undefined,
          ): item is ToolImportReportItem => {
            return Boolean(item);
          },
        ),
    };
  }

  private isToDo(item: ToolImportPlanItem): boolean {
    return (
      (item.action === ToolImportAction.Create ||
        item.action === ToolImportAction.Invite) &&
      this.selected.has(item.key)
    );
  }

  private async applyItem(item: ToolImportPlanItem): Promise<void> {
    if (item.action === ToolImportAction.Skip) {
      this.report(item, ToolImportOutcome.Skipped, [], item.reason);
      return;
    }

    if (item.action === ToolImportAction.Match) {
      let recordIds: Array<string> = item.existingRecordId
        ? [item.existingRecordId]
        : [];

      if (recordIds.length === 0) {
        /*
         * Matched to an item this import creates (a second severity of the
         * same name): it names what that one became.
         */
        const first: ToolImportPlanItem | undefined =
          this.input.plan.items.find(
            (candidate: ToolImportPlanItem): boolean => {
              return (
                candidate.kind === item.kind &&
                candidate.key !== item.key &&
                item.references.includes(candidate.key)
              );
            },
          );

        recordIds = first ? this.getResolved(first.kind, first.sourceId) : [];
        this.resolve(item.kind, item.sourceId, recordIds);
      }

      this.report(item, ToolImportOutcome.Matched, recordIds, item.reason);
      return;
    }

    if (item.action === ToolImportAction.AlreadyImported) {
      this.report(
        item,
        ToolImportOutcome.AlreadyImported,
        this.getResolved(item.kind, item.sourceId),
        item.reason,
      );
      return;
    }

    if (!this.selected.has(item.key)) {
      this.report(
        item,
        ToolImportOutcome.Skipped,
        [],
        makeToolImportNote(ToolImportNoteCode.NotSelected),
      );
      return;
    }

    await this.reportProgress(item.kind);

    try {
      const leftOver: boolean = await this.resumeIfRecorded(item);

      if (!leftOver) {
        await this.create(item);
      }
    } catch (error) {
      this.report(item, ToolImportOutcome.Failed, [], undefined, error);
    }

    this.done++;
    await this.reportProgress(item.kind);
  }

  /*
   * An item this import (before a restart) already created, or left half
   * made: reported from what was remembered, never created again. A
   * remembered record that is gone from OneUptime is forgotten, so it can be
   * created again. True when the item is dealt with.
   */
  private async resumeIfRecorded(item: ToolImportPlanItem): Promise<boolean> {
    const matching: Array<ToolImportRecord> = this.records.filter(
      (record: ToolImportRecord): boolean => {
        return (
          record.kind === item.kind &&
          Boolean(record.sourceId) &&
          (item.kind === ToolImportResourceKind.OnCallSchedule
            ? isGroupSourceIdOf(record.sourceId!, item.sourceId)
            : record.sourceId === item.sourceId)
        );
      },
    );

    if (matching.length === 0) {
      return false;
    }

    const recordIds: Array<string> = matching
      .filter((record: ToolImportRecord): boolean => {
        return Boolean(record.recordId);
      })
      .map((record: ToolImportRecord): string => {
        return record.recordId!.toString();
      });

    const isFromThisRun: boolean = matching.every(
      (record: ToolImportRecord): boolean => {
        return (
          record.toolImportRunId?.toString() === this.input.runId.toString()
        );
      },
    );

    if (!isFromThisRun) {
      /*
       * Remembered by an earlier import, but the plan did not call it
       * already imported: the record was deleted since. Forget it, so it is
       * created again.
       */
      for (const record of matching) {
        if (record.id) {
          await ToolImportRecordService.deleteOneById({
            id: record.id,
            props: { isRoot: true },
          });
        }
      }

      this.records = this.records.filter(
        (record: ToolImportRecord): boolean => {
          return !matching.includes(record);
        },
      );

      return false;
    }

    if (
      matching.some((record: ToolImportRecord): boolean => {
        return record.isComplete === false;
      })
    ) {
      this.report(
        item,
        ToolImportOutcome.Failed,
        recordIds,
        makeToolImportNote(ToolImportNoteCode.StoppedPartWay),
      );
      return true;
    }

    this.resolve(item.kind, item.sourceId, recordIds);
    this.report(
      item,
      item.kind === ToolImportResourceKind.Person
        ? ToolImportOutcome.Invited
        : ToolImportOutcome.Created,
      recordIds,
    );
    return true;
  }

  private async create(item: ToolImportPlanItem): Promise<void> {
    switch (item.kind) {
      case ToolImportResourceKind.Person:
        await this.invitePerson(item);
        return;
      case ToolImportResourceKind.Team:
        await this.createTeam(item);
        return;
      case ToolImportResourceKind.Service:
        await this.createService(item);
        return;
      case ToolImportResourceKind.IncidentSeverity:
        await this.createSeverity(item);
        return;
      case ToolImportResourceKind.IncidentState:
        await this.createIncidentState(item);
        return;
      case ToolImportResourceKind.IncidentRole:
        await this.createIncidentRole(item);
        return;
      case ToolImportResourceKind.IncidentCustomField:
        await this.createCustomField(item);
        return;
      case ToolImportResourceKind.OnCallSchedule:
        await this.createSchedule(item);
        return;
      case ToolImportResourceKind.OnCallPolicy:
        await this.createPolicy(item);
        return;
    }
  }

  // ---- People.

  private async invitePerson(item: ToolImportPlanItem): Promise<void> {
    const person: ImportedPerson | undefined = this.input.snapshot.people.find(
      (candidate: ImportedPerson): boolean => {
        return candidate.sourceId === item.sourceId;
      },
    );

    if (!person || !person.email) {
      this.report(
        item,
        ToolImportOutcome.Skipped,
        [],
        makeToolImportNote(ToolImportNoteCode.PersonNoEmail),
      );
      return;
    }

    const inviteTeamId: string | null = this.input.selection.inviteTeamId;

    if (!inviteTeamId) {
      this.report(
        item,
        ToolImportOutcome.Skipped,
        [],
        makeToolImportNote(ToolImportNoteCode.PersonNotInvited),
      );
      return;
    }

    const member: TeamMember = new TeamMember();
    member.teamId = new ObjectID(inviteTeamId);
    member.projectId = this.input.projectId;

    let userId: string | null = null;

    try {
      const created: TeamMember = await TeamMemberService.create({
        data: member,
        props: this.input.props,
        miscDataProps: {
          email: person.email,
          name: person.name,
        },
      });

      userId = created.userId?.toString() || null;
    } catch (error) {
      /*
       * Someone invited them while the import ran: they are in the project
       * now, which is what the import was for.
       */
      if (
        error instanceof Error &&
        error.message === Errors.TeamMemberService.ALREADY_INVITED
      ) {
        const members: Map<string, string> =
          await ToolImportProjectStateReader.readMembersByEmail(
            this.input.projectId,
          );
        const existing: string | undefined = members.get(person.email);

        if (existing) {
          this.resolve(item.kind, item.sourceId, [existing]);
          this.report(
            item,
            ToolImportOutcome.Matched,
            [existing],
            makeToolImportNote(ToolImportNoteCode.PersonAlreadyMember),
          );
          return;
        }
      }

      throw error;
    }

    if (!userId) {
      throw new Error("The invitation did not name a user.");
    }

    await this.remember(item, userId, true);
    this.resolve(item.kind, item.sourceId, [userId]);
    this.report(item, ToolImportOutcome.Invited, [userId]);
  }

  // ---- Teams.

  private async createTeam(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedTeam = this.find(this.input.snapshot.teams, item);
    const notes: Array<ToolImportNote> = [];

    const team: Team = new Team();
    team.projectId = this.input.projectId;
    team.name = source.name;

    if (source.description) {
      team.description = source.description;
    }

    const created: Team = await TeamService.create({
      data: team,
      props: this.input.props,
    });

    const teamId: string = created.id!.toString();
    const record: ToolImportRecord = await this.remember(item, teamId, false);

    for (const personId of source.memberSourceIds) {
      const userIds: Array<string> = this.getResolved(
        ToolImportResourceKind.Person,
        personId,
      );

      if (userIds.length === 0) {
        notes.push(this.personLeftOut(personId));
        continue;
      }

      for (const userId of userIds) {
        const member: TeamMember = new TeamMember();
        member.teamId = created.id!;
        member.projectId = this.input.projectId;
        member.userId = new ObjectID(userId);

        await this.addPart(notes, this.personName(personId), async () => {
          await TeamMemberService.create({
            data: member,
            props: this.input.props,
          });
        });
      }
    }

    await this.complete(record);
    this.resolve(item.kind, item.sourceId, [teamId]);
    this.report(
      item,
      ToolImportOutcome.Created,
      [teamId],
      undefined,
      null,
      notes,
    );
  }

  // ---- Services.

  private async createService(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedService = this.find(
      this.input.snapshot.services,
      item,
    );
    const notes: Array<ToolImportNote> = [];

    const service: ServiceModel = new ServiceModel();
    service.projectId = this.input.projectId;
    service.name = source.name;

    if (source.description) {
      service.description = source.description;
    }

    const created: ServiceModel = await ServiceService.create({
      data: service,
      props: this.input.props,
    });

    const serviceId: string = created.id!.toString();
    const record: ToolImportRecord = await this.remember(
      item,
      serviceId,
      false,
    );

    for (const teamId of this.resolveOwnerTeams(
      source.ownerTeamSourceIds,
      notes,
    )) {
      const owner: ServiceOwnerTeam = new ServiceOwnerTeam();
      owner.projectId = this.input.projectId;
      owner.serviceId = created.id!;
      owner.teamId = new ObjectID(teamId.id);

      await this.addPart(notes, teamId.name, async () => {
        await ServiceOwnerTeamService.create({
          data: owner,
          props: this.input.props,
        });
      });
    }

    await this.complete(record);
    this.resolve(item.kind, item.sourceId, [serviceId]);
    this.report(
      item,
      ToolImportOutcome.Created,
      [serviceId],
      undefined,
      null,
      notes,
    );
  }

  // ---- Incident settings.

  private async createSeverity(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedIncidentSeverity = this.find(
      this.input.snapshot.incidentSeverities,
      item,
    );

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.projectId = this.input.projectId;
    severity.name = source.name;
    severity.color = new Color(
      SEVERITY_COLORS[Math.min(source.order - 1, SEVERITY_COLORS.length - 1)] ||
        SEVERITY_COLORS[SEVERITY_COLORS.length - 1]!,
    );

    if (source.description) {
      severity.description = source.description;
    }

    const created: IncidentSeverity = await IncidentSeverityService.create({
      data: severity,
      props: this.input.props,
    });

    await this.finishSimple(item, created.id!);
  }

  private async createIncidentState(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedIncidentState = this.find(
      this.input.snapshot.incidentStates,
      item,
    );

    // With no order of its own, a new state goes just above the resolved one.
    const state: IncidentState = new IncidentState();
    state.projectId = this.input.projectId;
    state.name = source.name;
    state.color = pickColorForName(source.name);
    state.isCreatedState = false;
    state.isAcknowledgedState = false;
    state.isResolvedState = false;

    if (source.description) {
      state.description = source.description;
    }

    const created: IncidentState = await IncidentStateService.create({
      data: state,
      props: this.input.props,
    });

    await this.finishSimple(item, created.id!);
  }

  private async createIncidentRole(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedIncidentRole = this.find(
      this.input.snapshot.incidentRoles,
      item,
    );

    const role: IncidentRole = new IncidentRole();
    role.projectId = this.input.projectId;
    role.name = source.name;
    role.color = pickColorForName(source.name);
    role.isPrimaryRole = false;
    role.isDeleteable = true;
    role.canAssignMultipleUsers = false;

    if (source.description) {
      role.description = source.description;
    }

    const created: IncidentRole = await IncidentRoleService.create({
      data: role,
      props: this.input.props,
    });

    await this.finishSimple(item, created.id!);
  }

  private async createCustomField(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedIncidentCustomField = this.find(
      this.input.snapshot.incidentCustomFields,
      item,
    );

    const field: IncidentCustomField = new IncidentCustomField();
    field.projectId = this.input.projectId;
    field.name = source.name;
    field.customFieldType = source.fieldType!;

    if (source.description) {
      field.description = source.description;
    }

    if (source.options.length > 0) {
      field.dropdownOptions = serializeCustomFieldDropdownOptions(
        source.options.map((value: string) => {
          return { value: value };
        }),
      );
    }

    const created: IncidentCustomField =
      await IncidentCustomFieldService.create({
        data: field,
        props: this.input.props,
      });

    await this.finishSimple(item, created.id!);
  }

  private async finishSimple(
    item: ToolImportPlanItem,
    recordId: ObjectID,
  ): Promise<void> {
    await this.remember(item, recordId.toString(), true);
    this.resolve(item.kind, item.sourceId, [recordId.toString()]);
    this.report(item, ToolImportOutcome.Created, [recordId.toString()]);
  }

  // ---- On-call schedules.

  private async createSchedule(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedSchedule = this.find(
      this.input.snapshot.schedules,
      item,
    );
    const notes: Array<ToolImportNote> = [];
    const timezone: Timezone | null = resolveImportedTimezone(source.timezone);
    const scheduleTimezone: string = timezone || Timezone.UTC;
    const groups: Array<Array<ImportedRotation>> =
      source.rotations.length > 0
        ? groupRotationsIntoSchedules(source.rotations)
        : [[]];
    const scheduleIds: Array<string> = [];
    const leftOutPeople: Set<string> = new Set<string>();

    for (let groupIndex: number = 0; groupIndex < groups.length; groupIndex++) {
      const group: Array<ImportedRotation> = groups[groupIndex]!;

      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule.projectId = this.input.projectId;
      schedule.name = getGroupScheduleName({
        scheduleName: source.name,
        groupIndex: groupIndex,
        group: group,
        maxLength: TOOL_IMPORT_MAX_NAME_LENGTH,
      });
      schedule.timezone = scheduleTimezone as Timezone;

      if (source.description) {
        schedule.description = source.description;
      }

      const created: OnCallDutyPolicySchedule =
        await OnCallDutyPolicyScheduleService.create({
          data: schedule,
          props: this.input.props,
        });

      const scheduleId: string = created.id!.toString();
      scheduleIds.push(scheduleId);

      const record: ToolImportRecord = await this.remember(
        item,
        scheduleId,
        false,
        getGroupSourceId(source.sourceId, groupIndex),
        schedule.name,
      );

      let order: number = 1;

      for (const rotation of group) {
        const userIds: Array<string> = [];

        for (const personId of rotation.participantSourceIds) {
          const resolvedUserIds: Array<string> = this.getResolved(
            ToolImportResourceKind.Person,
            personId,
          );

          if (resolvedUserIds.length === 0) {
            leftOutPeople.add(personId);
            continue;
          }

          userIds.push(resolvedUserIds[0]!);
        }

        if (userIds.length === 0) {
          notes.push(
            makeToolImportNote(ToolImportNoteCode.RotationNobody, {
              rotation: rotation.name,
            }),
          );
          continue;
        }

        const layer: OnCallDutyPolicyScheduleLayer =
          buildLayerFromImportedRotation({
            rotation: rotation,
            scheduleId: created.id!,
            projectId: this.input.projectId,
            name: rotation.name,
            order: order,
            timezone: scheduleTimezone,
            reference: this.input.now,
          });

        const createdLayer: OnCallDutyPolicyScheduleLayer =
          await OnCallDutyPolicyScheduleLayerService.create({
            data: layer,
            props: this.input.props,
          });

        order++;

        for (let index: number = 0; index < userIds.length; index++) {
          const layerUser: OnCallDutyPolicyScheduleLayerUser =
            new OnCallDutyPolicyScheduleLayerUser();
          layerUser.projectId = this.input.projectId;
          layerUser.onCallDutyPolicyScheduleId = created.id!;
          layerUser.onCallDutyPolicyScheduleLayerId = createdLayer.id!;
          layerUser.userId = new ObjectID(userIds[index]!);
          layerUser.order = index + 1;

          await OnCallDutyPolicyScheduleLayerUserService.create({
            data: layerUser,
            props: this.input.props,
          });
        }
      }

      for (const team of this.resolveOwnerTeams(
        source.ownerTeamSourceIds,
        groupIndex === 0 ? notes : [],
      )) {
        const owner: OnCallDutyPolicyScheduleOwnerTeam =
          new OnCallDutyPolicyScheduleOwnerTeam();
        owner.projectId = this.input.projectId;
        owner.onCallDutyPolicyScheduleId = created.id!;
        owner.teamId = new ObjectID(team.id);

        await this.addPart(
          groupIndex === 0 ? notes : [],
          team.name,
          async () => {
            await OnCallDutyPolicyScheduleOwnerTeamService.create({
              data: owner,
              props: this.input.props,
            });
          },
        );
      }

      await this.complete(record);
    }

    for (const personId of leftOutPeople) {
      notes.push(this.personLeftOut(personId));
    }

    this.resolve(item.kind, item.sourceId, scheduleIds);
    this.report(
      item,
      ToolImportOutcome.Created,
      scheduleIds,
      undefined,
      null,
      notes,
    );
  }

  // ---- Escalation policies.

  private async createPolicy(item: ToolImportPlanItem): Promise<void> {
    const source: ImportedPolicy = this.find(
      this.input.snapshot.policies,
      item,
    );
    const notes: Array<ToolImportNote> = [];
    const maxLevels: number = this.input.isLimitedToOneLevelPerPolicy
      ? 1
      : TOOL_IMPORT_MAX_LEVELS_PER_POLICY;

    const levels: Array<{
      level: ImportedPolicyLevel;
      userIds: Array<string>;
      teamIds: Array<string>;
      scheduleIds: Array<string>;
    }> = source.levels.slice(0, maxLevels).map((level: ImportedPolicyLevel) => {
      return {
        level: level,
        userIds: this.resolveTargets(
          ToolImportResourceKind.Person,
          level.personSourceIds,
          notes,
        ),
        teamIds: this.resolveTargets(
          ToolImportResourceKind.Team,
          level.teamSourceIds,
          notes,
        ),
        scheduleIds: this.resolveTargets(
          ToolImportResourceKind.OnCallSchedule,
          level.scheduleSourceIds,
          notes,
        ),
      };
    });

    const pagesAnyone: boolean = levels.some(
      (level: {
        userIds: Array<string>;
        teamIds: Array<string>;
        scheduleIds: Array<string>;
      }): boolean => {
        return (
          level.userIds.length +
            level.teamIds.length +
            level.scheduleIds.length >
          0
        );
      },
    );

    if (!pagesAnyone) {
      this.report(
        item,
        ToolImportOutcome.Skipped,
        [],
        makeToolImportNote(ToolImportNoteCode.NothingToPage),
        null,
        notes,
      );
      return;
    }

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.projectId = this.input.projectId;
    policy.name = source.name;
    policy.repeatPolicyIfNoOneAcknowledges = source.repeatTimes > 0;
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = Math.max(
      0,
      source.repeatTimes,
    );

    if (source.description) {
      policy.description = source.description;
    }

    const created: OnCallDutyPolicy = await OnCallDutyPolicyService.create({
      data: policy,
      props: this.input.props,
    });

    const policyId: string = created.id!.toString();
    const record: ToolImportRecord = await this.remember(item, policyId, false);

    let order: number = 1;

    for (let index: number = 0; index < levels.length; index++) {
      const level: {
        level: ImportedPolicyLevel;
        userIds: Array<string>;
        teamIds: Array<string>;
        scheduleIds: Array<string>;
      } = levels[index]!;

      if (
        level.userIds.length +
          level.teamIds.length +
          level.scheduleIds.length ===
        0
      ) {
        notes.push(
          makeToolImportNote(ToolImportNoteCode.PolicyLevelLeftOut, {
            level: index + 1,
          }),
        );
        continue;
      }

      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.projectId = this.input.projectId;
      rule.onCallDutyPolicyId = created.id!;
      rule.escalateAfterInMinutes = Math.max(
        1,
        Math.round(level.level.escalateAfterMinutes),
      );
      rule.order = order;

      await OnCallDutyPolicyEscalationRuleService.create({
        data: rule,
        props: this.input.props,
        miscDataProps: {
          users: level.userIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          teams: level.teamIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          onCallSchedules: level.scheduleIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        },
      });

      order++;
    }

    for (const team of this.resolveOwnerTeams(
      source.ownerTeamSourceIds,
      notes,
    )) {
      const owner: OnCallDutyPolicyOwnerTeam = new OnCallDutyPolicyOwnerTeam();
      owner.projectId = this.input.projectId;
      owner.onCallDutyPolicyId = created.id!;
      owner.teamId = new ObjectID(team.id);

      await this.addPart(notes, team.name, async () => {
        await OnCallDutyPolicyOwnerTeamService.create({
          data: owner,
          props: this.input.props,
        });
      });
    }

    await this.complete(record);
    this.resolve(item.kind, item.sourceId, [policyId]);
    this.report(
      item,
      ToolImportOutcome.Created,
      [policyId],
      undefined,
      null,
      notes,
    );
  }

  // ---- Helpers.

  private find<T extends { sourceId: string }>(
    list: Array<T>,
    item: ToolImportPlanItem,
  ): T {
    const found: T | undefined = list.find((candidate: T): boolean => {
      return candidate.sourceId === item.sourceId;
    });

    if (!found) {
      throw new Error(`${item.name} is no longer in what was read.`);
    }

    return found;
  }

  private resolve(
    kind: ToolImportResourceKind,
    sourceId: string,
    recordIds: Array<string>,
  ): void {
    const byKind: Map<string, Array<string>> = this.resolved.get(kind) ||
    new Map<string, Array<string>>();
    const existing: Array<string> = byKind.get(sourceId) || [];

    for (const id of recordIds) {
      if (!existing.includes(id)) {
        existing.push(id);
      }
    }

    byKind.set(sourceId, existing);
    this.resolved.set(kind, byKind);
  }

  private getResolved(
    kind: ToolImportResourceKind,
    sourceId: string,
  ): Array<string> {
    return [...(this.resolved.get(kind)?.get(sourceId) || [])];
  }

  /*
   * The OneUptime ids of what a level names, of one kind: each source item
   * that was brought over or matched, with a note for each that was not.
   */
  private resolveTargets(
    kind: ToolImportResourceKind,
    sourceIds: Array<string>,
    notes: Array<ToolImportNote>,
  ): Array<string> {
    const ids: Array<string> = [];

    for (const sourceId of sourceIds) {
      const resolved: Array<string> = this.getResolved(kind, sourceId);

      if (resolved.length === 0) {
        const note: ToolImportNote =
          kind === ToolImportResourceKind.Person
            ? this.personLeftOut(sourceId)
            : kind === ToolImportResourceKind.Team
              ? makeToolImportNote(ToolImportNoteCode.TeamLeftOut, {
                  name: this.teamName(sourceId),
                })
              : makeToolImportNote(ToolImportNoteCode.ScheduleLeftOut, {
                  name: this.scheduleName(sourceId),
                });

        if (
          !notes.some((existing: ToolImportNote): boolean => {
            return JSON.stringify(existing) === JSON.stringify(note);
          })
        ) {
          notes.push(note);
        }
        continue;
      }

      for (const id of resolved) {
        if (!ids.includes(id)) {
          ids.push(id);
        }
      }
    }

    return ids;
  }

  private resolveOwnerTeams(
    teamSourceIds: Array<string>,
    notes: Array<ToolImportNote>,
  ): Array<{ id: string; name: string }> {
    const teams: Array<{ id: string; name: string }> = [];

    for (const sourceId of teamSourceIds) {
      const ids: Array<string> = this.getResolved(
        ToolImportResourceKind.Team,
        sourceId,
      );

      if (ids.length === 0) {
        // A team that is not in the snapshot at all was never a team to bring.
        if (
          this.input.snapshot.teams.some((team: ImportedTeam): boolean => {
            return team.sourceId === sourceId;
          })
        ) {
          notes.push(
            makeToolImportNote(ToolImportNoteCode.TeamLeftOut, {
              name: this.teamName(sourceId),
            }),
          );
        }
        continue;
      }

      teams.push({ id: ids[0]!, name: this.teamName(sourceId) });
    }

    return teams;
  }

  /*
   * A part of a record (a member, an owner team) that OneUptime refused is
   * noted on the record; the record itself is kept.
   */
  private async addPart(
    notes: Array<ToolImportNote>,
    name: string,
    add: () => Promise<void>,
  ): Promise<void> {
    try {
      await add();
    } catch (error) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.PartNotAdded, {
          name: name,
          error: toErrorMessage(error),
        }),
      );
    }
  }

  private personLeftOut(personId: string): ToolImportNote {
    return makeToolImportNote(ToolImportNoteCode.PersonLeftOut, {
      name: this.personName(personId),
    });
  }

  private personName(personId: string): string {
    const person: ImportedPerson | undefined = this.input.snapshot.people.find(
      (candidate: ImportedPerson): boolean => {
        return candidate.sourceId === personId;
      },
    );

    return person?.email || person?.name || personId;
  }

  private teamName(teamId: string): string {
    return (
      this.input.snapshot.teams.find((team: ImportedTeam): boolean => {
        return team.sourceId === teamId;
      })?.name || teamId
    );
  }

  private scheduleName(scheduleId: string): string {
    return (
      this.input.snapshot.schedules.find(
        (schedule: ImportedSchedule): boolean => {
          return schedule.sourceId === scheduleId;
        },
      )?.name || scheduleId
    );
  }

  // Remembers what an item became, as soon as the record exists.
  private async remember(
    item: ToolImportPlanItem,
    recordId: string,
    isComplete: boolean,
    sourceId?: string | undefined,
    name?: string | undefined,
  ): Promise<ToolImportRecord> {
    const record: ToolImportRecord = new ToolImportRecord();
    record.projectId = this.input.projectId;
    record.source = this.input.source;
    record.kind = item.kind;
    record.sourceId = sourceId || item.sourceId;
    record.recordId = new ObjectID(recordId);
    record.name = (name || item.name).slice(0, TOOL_IMPORT_MAX_NAME_LENGTH);
    record.isComplete = isComplete;
    record.toolImportRunId = this.input.runId;

    const created: ToolImportRecord = await ToolImportRecordService.create({
      data: record,
      props: { isRoot: true },
    });

    this.records.push(created);
    return created;
  }

  private async complete(record: ToolImportRecord): Promise<void> {
    if (!record.id) {
      return;
    }

    await ToolImportRecordService.updateOneById({
      id: record.id,
      data: { isComplete: true },
      props: { isRoot: true },
    });

    record.isComplete = true;
  }

  private report(
    item: ToolImportPlanItem,
    outcome: ToolImportOutcome,
    recordIds: Array<string>,
    reason?: ToolImportNote | undefined,
    error?: unknown,
    extraNotes?: Array<ToolImportNote> | undefined,
  ): void {
    const reportItem: ToolImportReportItem = {
      key: item.key,
      kind: item.kind,
      sourceId: item.sourceId,
      name: item.name,
      outcome: outcome,
      recordIds: recordIds,
      notes: [...item.notes, ...(extraNotes || [])],
    };

    if (reason) {
      reportItem.reason = reason;
    }

    if (error) {
      reportItem.error = toErrorMessage(error);
    }

    this.reportItems.set(item.key, reportItem);
  }

  private async reportProgress(
    kind: ToolImportResourceKind | undefined,
  ): Promise<void> {
    if (!this.input.onProgress) {
      return;
    }

    await this.input.onProgress({
      done: this.done,
      total: this.total,
      kind: kind,
    });
  }
}

// OneUptime's own words for a refusal, short, for the report.
export function toErrorMessage(error: unknown): string {
  const message: string =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Something went wrong.";

  const trimmed: string = (message || "Something went wrong.").trim();

  return trimmed.length > MAX_ERROR_LENGTH
    ? `${trimmed.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : trimmed;
}
