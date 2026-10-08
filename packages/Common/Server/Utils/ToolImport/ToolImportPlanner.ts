import {
  TOOL_IMPORT_MAX_ITEMS,
  TOOL_IMPORT_MAX_ITEMS_PER_KIND,
} from "../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportInviteTeam,
  ToolImportItemSummary,
  ToolImportPlan,
  ToolImportPlanItem,
} from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
  ToolImportResourceKindOrder,
} from "../../../Types/ToolImport/ToolImportResourceKind";
import {
  groupRotationsIntoSchedules,
  isGroupSourceIdOf,
  resolveImportedTimezone,
} from "../../../Types/ToolImport/ToolImportScheduleRules";
import {
  ImportedIncidentCustomField,
  ImportedIncidentRole,
  ImportedIncidentRoleKind,
  ImportedIncidentSeverity,
  ImportedIncidentState,
  ImportedIncidentStateKind,
  ImportedPerson,
  ImportedPolicy,
  ImportedRotation,
  ImportedSchedule,
  ImportedService,
  ImportedTeam,
  ToolImportSnapshot,
} from "../../../Types/ToolImport/ToolImportSnapshot";

/*
 * WHAT AN IMPORT WOULD DO, ITEM BY ITEM.
 *
 * The planner is a pure function of three things: what was read (the
 * snapshot), what the project has (ToolImportProjectState, read by
 * ToolImportProjectStateReader) and what the person may do there
 * (ToolImportAccess: their permissions on the project's plan). The preview
 * shows its answer, and the import works it out again when it starts and
 * does exactly that - so the person is never shown one thing and given
 * another.
 *
 * The rules, for every tool:
 *
 *  - People are matched by email. Someone already in the project (an
 *    invitation they have not accepted yet included) is used as they are;
 *    anyone else is invited, if the person may invite. People who are on a
 *    team, a schedule or a policy being brought over start ticked; the rest
 *    are listed unticked, so an import never invites a whole directory of
 *    stakeholders by default.
 *  - Anything brought over by an earlier import is found by the tool's id
 *    and left alone (AlreadyImported). One deleted in OneUptime since is
 *    created again, with a note.
 *  - Anything whose name is already used in the project is matched to that
 *    record and left as it is. A team matched by name keeps its own members:
 *    adding the tool's members to an existing team would hand them that
 *    team's permissions.
 *  - Anything the person may not create, or the project's plan does not
 *    include, is skipped with that reason - never attempted and refused.
 *  - At most TOOL_IMPORT_MAX_ITEMS_PER_KIND of each kind, and
 *    TOOL_IMPORT_MAX_ITEMS in all, are created by one import; the rest are
 *    skipped with the limit, for the next import to bring over.
 */

// A record already in the project, by id and name.
export interface ToolImportExistingRecord {
  id: string;
  name: string;
}

// A record an earlier import brought over (ToolImportRecord).
export interface ToolImportPreviousRecord {
  kind: ToolImportResourceKind;
  sourceId: string;
  recordId: string;
  isComplete: boolean;
  // Whether the record is still in OneUptime.
  stillExists: boolean;
}

export interface ToolImportProjectState {
  // Members of the project (any team, invitations included) by lowercase email.
  memberUserIdsByEmail: Map<string, string>;
  // What the project has, by kind, for matching by name.
  existingByKind: Map<ToolImportResourceKind, Array<ToolImportExistingRecord>>;
  // The incident states OneUptime starts and ends incidents in.
  createdIncidentState: ToolImportExistingRecord | null;
  resolvedIncidentState: ToolImportExistingRecord | null;
  // The incident role that leads every incident.
  primaryIncidentRole: ToolImportExistingRecord | null;
  // Every record an earlier import of this tool brought over.
  previousRecords: Array<ToolImportPreviousRecord>;
}

export interface ToolImportAccess {
  // Per kind: null when the person may create it, else why not.
  createRefusals: Map<ToolImportResourceKind, ToolImportNote | null>;
  // Null when the person may invite people, else why not.
  inviteRefusal: ToolImportNote | null;
  inviteTeams: Array<ToolImportInviteTeam>;
  defaultInviteTeamId: string | null;
  // The project is on the Free plan of a billed install: one level per policy.
  isLimitedToOneLevelPerPolicy: boolean;
}

const SPACES: RegExp = /\s+/g;

// How names are compared: case, surrounding space and repeated spaces aside.
export function normalizeImportName(name: string): string {
  return (name || "").trim().toLowerCase().replace(SPACES, " ");
}

/*
 * Words a tool adds to a severity's name that OneUptime's own severities
 * spell differently: an imported "Critical" is OneUptime's "Critical
 * Incident".
 */
const SEVERITY_NAME_SUFFIXES: Array<string> = [" incident", " severity"];

function severityNameVariants(name: string): Array<string> {
  const normalized: string = normalizeImportName(name);
  const variants: Array<string> = [normalized];

  for (const suffix of SEVERITY_NAME_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      variants.push(normalized.slice(0, -suffix.length));
    } else {
      variants.push(normalized + suffix);
    }
  }

  return variants;
}

export function buildToolImportPlan(data: {
  snapshot: ToolImportSnapshot;
  state: ToolImportProjectState;
  access: ToolImportAccess;
}): ToolImportPlan {
  return new PlanBuilder(data.snapshot, data.state, data.access).build();
}

class PlanBuilder {
  private snapshot: ToolImportSnapshot;
  private state: ToolImportProjectState;
  private access: ToolImportAccess;
  private items: Array<ToolImportPlanItem> = [];
  // Names this import creates, by kind: a second item of the same name matches the first.
  private plannedNames: Map<ToolImportResourceKind, Map<string, string>> =
    new Map<ToolImportResourceKind, Map<string, string>>();
  private createdCount: number = 0;
  private createdCountByKind: Map<ToolImportResourceKind, number> = new Map<
    ToolImportResourceKind,
    number
  >();
  private referencedPeople: Set<string> = new Set<string>();

  public constructor(
    snapshot: ToolImportSnapshot,
    state: ToolImportProjectState,
    access: ToolImportAccess,
  ) {
    this.snapshot = snapshot;
    this.state = state;
    this.access = access;
  }

  public build(): ToolImportPlan {
    this.collectReferencedPeople();

    for (const kind of ToolImportResourceKindOrder) {
      this.planKind(kind);
    }

    return {
      source: this.snapshot.source,
      accountName: this.snapshot.accountName,
      readAt: this.snapshot.readAt,
      items: this.items,
      inviteTeams: this.access.inviteTeams,
      defaultInviteTeamId: this.access.defaultInviteTeamId,
      notes: [...this.snapshot.notes],
    };
  }

  /*
   * Everyone a team, a schedule or a policy names: they start ticked, as the
   * people the import needs; anyone else starts unticked.
   */
  private collectReferencedPeople(): void {
    for (const team of this.snapshot.teams) {
      team.memberSourceIds.forEach((id: string) => {
        this.referencedPeople.add(id);
      });
    }

    for (const schedule of this.snapshot.schedules) {
      for (const rotation of schedule.rotations) {
        rotation.participantSourceIds.forEach((id: string) => {
          this.referencedPeople.add(id);
        });
      }
    }

    for (const policy of this.snapshot.policies) {
      for (const level of policy.levels) {
        level.personSourceIds.forEach((id: string) => {
          this.referencedPeople.add(id);
        });
      }
    }
  }

  private planKind(kind: ToolImportResourceKind): void {
    switch (kind) {
      case ToolImportResourceKind.Person:
        this.snapshot.people.forEach((person: ImportedPerson) => {
          this.planPerson(person);
        });
        return;
      case ToolImportResourceKind.Team:
        this.snapshot.teams.forEach((team: ImportedTeam) => {
          this.planTeam(team);
        });
        return;
      case ToolImportResourceKind.Service:
        this.snapshot.services.forEach((service: ImportedService) => {
          this.planNamed({
            kind: kind,
            sourceId: service.sourceId,
            name: service.name,
            notes: service.notes,
            summary: {},
            references: service.ownerTeamSourceIds.map((id: string) => {
              return getToolImportItemKey(ToolImportResourceKind.Team, id);
            }),
          });
        });
        return;
      case ToolImportResourceKind.IncidentSeverity:
        this.snapshot.incidentSeverities.forEach(
          (severity: ImportedIncidentSeverity) => {
            this.planNamed({
              kind: kind,
              sourceId: severity.sourceId,
              name: severity.name,
              notes: severity.notes,
              summary: {},
              references: [],
              nameVariants: severityNameVariants(severity.name),
            });
          },
        );
        return;
      case ToolImportResourceKind.IncidentState:
        this.snapshot.incidentStates.forEach((state: ImportedIncidentState) => {
          this.planIncidentState(state);
        });
        return;
      case ToolImportResourceKind.IncidentRole:
        this.snapshot.incidentRoles.forEach((role: ImportedIncidentRole) => {
          this.planIncidentRole(role);
        });
        return;
      case ToolImportResourceKind.IncidentCustomField:
        this.snapshot.incidentCustomFields.forEach(
          (field: ImportedIncidentCustomField) => {
            this.planCustomField(field);
          },
        );
        return;
      case ToolImportResourceKind.OnCallSchedule:
        this.snapshot.schedules.forEach((schedule: ImportedSchedule) => {
          this.planSchedule(schedule);
        });
        return;
      case ToolImportResourceKind.OnCallPolicy:
        this.snapshot.policies.forEach((policy: ImportedPolicy) => {
          this.planPolicy(policy);
        });
        return;
    }
  }

  private planPerson(person: ImportedPerson): void {
    const base: ToolImportPlanItem = this.newItem({
      kind: ToolImportResourceKind.Person,
      sourceId: person.sourceId,
      name: person.name,
      notes: person.notes,
      summary: person.email ? { email: person.email } : {},
      references: [],
    });

    if (!person.email) {
      this.skip(base, makeToolImportNote(ToolImportNoteCode.PersonNoEmail));
      return;
    }

    if (!person.isActive) {
      this.skip(base, makeToolImportNote(ToolImportNoteCode.PersonDeactivated));
      return;
    }

    const memberUserId: string | undefined =
      this.state.memberUserIdsByEmail.get(person.email);

    if (memberUserId) {
      this.match(
        base,
        memberUserId,
        makeToolImportNote(ToolImportNoteCode.PersonAlreadyMember),
      );
      return;
    }

    if (this.access.inviteRefusal) {
      this.skip(base, this.access.inviteRefusal);
      return;
    }

    /*
     * Someone new joins the project through a team, and the person may
     * only add people to teams whose permissions they could grant. With
     * no such team, nobody can be invited, and the preview says so rather
     * than offering an invitation the import would not send.
     */
    if (this.access.inviteTeams.length === 0) {
      this.skip(base, makeToolImportNote(ToolImportNoteCode.PersonNotInvited));
      return;
    }

    if (!this.takeCapacity(ToolImportResourceKind.Person)) {
      this.skip(base, this.overLimit(ToolImportResourceKind.Person));
      return;
    }

    const isReferenced: boolean = this.referencedPeople.has(person.sourceId);

    base.action = ToolImportAction.Invite;
    base.isSelectable = true;
    base.isSelectedByDefault = isReferenced;

    if (!isReferenced) {
      base.notes = [
        ...base.notes,
        makeToolImportNote(ToolImportNoteCode.NotOnAnything),
      ];
    }

    this.items.push(base);
  }

  private planTeam(team: ImportedTeam): void {
    this.planNamed({
      kind: ToolImportResourceKind.Team,
      sourceId: team.sourceId,
      name: team.name,
      notes: team.notes,
      summary: { memberCount: team.memberSourceIds.length },
      references: team.memberSourceIds.map((id: string) => {
        return getToolImportItemKey(ToolImportResourceKind.Person, id);
      }),
      matchReason: makeToolImportNote(ToolImportNoteCode.TeamNameExists),
    });
  }

  private planIncidentState(state: ImportedIncidentState): void {
    const base: ToolImportPlanItem = this.newItem({
      kind: ToolImportResourceKind.IncidentState,
      sourceId: state.sourceId,
      name: state.name,
      notes: state.notes,
      summary: {},
      references: [],
    });

    if (
      state.kind === ImportedIncidentStateKind.Created &&
      this.state.createdIncidentState
    ) {
      this.match(
        base,
        this.state.createdIncidentState.id,
        makeToolImportNote(ToolImportNoteCode.StateMatchedToCreated, {
          state: this.state.createdIncidentState.name,
        }),
      );
      return;
    }

    if (
      state.kind === ImportedIncidentStateKind.Resolved &&
      this.state.resolvedIncidentState
    ) {
      this.match(
        base,
        this.state.resolvedIncidentState.id,
        makeToolImportNote(ToolImportNoteCode.StateMatchedToResolved, {
          state: this.state.resolvedIncidentState.name,
        }),
      );
      return;
    }

    if (state.kind !== ImportedIncidentStateKind.InProgress) {
      this.skip(
        base,
        makeToolImportNote(ToolImportNoteCode.StateNotNeeded, {
          category: state.sourceCategory,
        }),
      );
      return;
    }

    this.planNamed({
      kind: ToolImportResourceKind.IncidentState,
      sourceId: state.sourceId,
      name: state.name,
      notes: state.notes,
      summary: {},
      references: [],
    });
  }

  private planIncidentRole(role: ImportedIncidentRole): void {
    const base: ToolImportPlanItem = this.newItem({
      kind: ToolImportResourceKind.IncidentRole,
      sourceId: role.sourceId,
      name: role.name,
      notes: role.notes,
      summary: {},
      references: [],
    });

    if (role.kind === ImportedIncidentRoleKind.Reporter) {
      this.skip(base, makeToolImportNote(ToolImportNoteCode.RoleReporter));
      return;
    }

    if (
      role.kind === ImportedIncidentRoleKind.Lead &&
      this.state.primaryIncidentRole
    ) {
      this.match(
        base,
        this.state.primaryIncidentRole.id,
        makeToolImportNote(ToolImportNoteCode.RoleMatchedToPrimary, {
          role: this.state.primaryIncidentRole.name,
        }),
      );
      return;
    }

    this.planNamed({
      kind: ToolImportResourceKind.IncidentRole,
      sourceId: role.sourceId,
      name: role.name,
      notes: role.notes,
      summary: {},
      references: [],
    });
  }

  private planCustomField(field: ImportedIncidentCustomField): void {
    const summary: ToolImportItemSummary = {
      fieldType: field.fieldType || undefined,
      optionCount: field.options.length || undefined,
    };

    if (field.isFromCatalog || !field.fieldType) {
      const base: ToolImportPlanItem = this.newItem({
        kind: ToolImportResourceKind.IncidentCustomField,
        sourceId: field.sourceId,
        name: field.name,
        notes: field.notes,
        summary: summary,
        references: [],
      });
      this.skip(
        base,
        makeToolImportNote(
          field.isFromCatalog
            ? ToolImportNoteCode.CustomFieldFromCatalog
            : ToolImportNoteCode.CustomFieldTypeNotSupported,
        ),
      );
      return;
    }

    this.planNamed({
      kind: ToolImportResourceKind.IncidentCustomField,
      sourceId: field.sourceId,
      name: field.name,
      notes: field.notes,
      summary: summary,
      references: [],
    });
  }

  private planSchedule(schedule: ImportedSchedule): void {
    const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules(
      schedule.rotations,
    );
    const notes: Array<ToolImportNote> = [...schedule.notes];

    for (const rotation of schedule.rotations) {
      notes.push(...rotation.notes);
    }

    if (groups.length > 1) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.ScheduleSplit, {
          count: groups.length,
        }),
      );
    }

    if (!resolveImportedTimezone(schedule.timezone)) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.TimezoneUnknown, {
          timezone: schedule.timezone,
        }),
      );
    }

    const references: Array<string> = [];

    for (const rotation of schedule.rotations) {
      for (const personId of rotation.participantSourceIds) {
        references.push(
          getToolImportItemKey(ToolImportResourceKind.Person, personId),
        );
      }
    }

    for (const teamId of schedule.ownerTeamSourceIds) {
      references.push(
        getToolImportItemKey(ToolImportResourceKind.Team, teamId),
      );
    }

    const item: ToolImportPlanItem | null = this.planNamed({
      kind: ToolImportResourceKind.OnCallSchedule,
      sourceId: schedule.sourceId,
      name: schedule.name,
      notes: notes,
      summary: {
        scheduleCount: Math.max(1, groups.length),
        layerCount: schedule.rotations.length,
        timezone: resolveImportedTimezone(schedule.timezone) || "UTC",
      },
      references: uniqueKeys(references),
    });

    if (
      item &&
      item.action === ToolImportAction.Create &&
      !schedule.isEnabled
    ) {
      item.isSelectedByDefault = false;
    }
  }

  private planPolicy(policy: ImportedPolicy): void {
    const notes: Array<ToolImportNote> = [...policy.notes];

    if (policy.isUnreadable || policy.levels.length === 0) {
      const base: ToolImportPlanItem = this.newItem({
        kind: ToolImportResourceKind.OnCallPolicy,
        sourceId: policy.sourceId,
        name: policy.name,
        notes: notes,
        summary: { levelCount: policy.levels.length },
        references: [],
      });
      this.skip(
        base,
        makeToolImportNote(
          policy.isUnreadable
            ? ToolImportNoteCode.PolicyTemplated
            : ToolImportNoteCode.NothingToPage,
        ),
      );
      return;
    }

    if (this.access.isLimitedToOneLevelPerPolicy && policy.levels.length > 1) {
      notes.push(makeToolImportNote(ToolImportNoteCode.PolicyFreePlanOneLevel));
    }

    const references: Array<string> = [];

    for (const level of policy.levels) {
      for (const id of level.personSourceIds) {
        references.push(
          getToolImportItemKey(ToolImportResourceKind.Person, id),
        );
      }
      for (const id of level.teamSourceIds) {
        references.push(getToolImportItemKey(ToolImportResourceKind.Team, id));
      }
      for (const id of level.scheduleSourceIds) {
        references.push(
          getToolImportItemKey(ToolImportResourceKind.OnCallSchedule, id),
        );
      }
    }

    for (const teamId of policy.ownerTeamSourceIds) {
      references.push(
        getToolImportItemKey(ToolImportResourceKind.Team, teamId),
      );
    }

    this.planNamed({
      kind: ToolImportResourceKind.OnCallPolicy,
      sourceId: policy.sourceId,
      name: policy.name,
      notes: notes,
      summary: {
        levelCount: policy.levels.length,
        repeatTimes: policy.repeatTimes || undefined,
      },
      references: uniqueKeys(references),
    });
  }

  /*
   * The steps every kind but people goes through: already imported, already
   * in the project by name, refused, over the limit - or created.
   */
  private planNamed(data: {
    kind: ToolImportResourceKind;
    sourceId: string;
    name: string;
    notes: Array<ToolImportNote>;
    summary: ToolImportItemSummary;
    references: Array<string>;
    nameVariants?: Array<string> | undefined;
    matchReason?: ToolImportNote | undefined;
  }): ToolImportPlanItem | null {
    const item: ToolImportPlanItem = this.newItem(data);

    const previous: ToolImportPreviousRecord | undefined =
      this.state.previousRecords.find(
        (record: ToolImportPreviousRecord): boolean => {
          return record.kind === data.kind && record.sourceId === data.sourceId;
        },
      );

    if (previous && previous.stillExists) {
      item.action = ToolImportAction.AlreadyImported;
      item.existingRecordId = previous.recordId;
      item.reason = makeToolImportNote(ToolImportNoteCode.AlreadyImported);

      // The other schedules a schedule became, those still in the project.
      const others: Array<string> = this.state.previousRecords
        .filter((record: ToolImportPreviousRecord): boolean => {
          return (
            record.kind === data.kind &&
            record.stillExists &&
            record.sourceId !== data.sourceId &&
            isGroupSourceIdOf(record.sourceId, data.sourceId)
          );
        })
        .map((record: ToolImportPreviousRecord): string => {
          return record.recordId;
        });

      if (others.length > 0) {
        item.additionalRecordIds = others;
      }

      this.items.push(item);
      return item;
    }

    if (previous && !previous.stillExists) {
      item.notes = [
        ...item.notes,
        makeToolImportNote(ToolImportNoteCode.ImportedBeforeDeletedSince),
      ];
    }

    const variants: Array<string> = data.nameVariants || [
      normalizeImportName(data.name),
    ];

    const existing: ToolImportExistingRecord | undefined = (
      this.state.existingByKind.get(data.kind) || []
    ).find((record: ToolImportExistingRecord): boolean => {
      return variants.includes(normalizeImportName(record.name));
    });

    if (existing) {
      this.match(
        item,
        existing.id,
        data.matchReason ||
          makeToolImportNote(ToolImportNoteCode.NameExists, {
            name: existing.name,
          }),
      );
      return item;
    }

    const refusal: ToolImportNote | null | undefined =
      this.access.createRefusals.get(data.kind);

    if (refusal) {
      this.skip(item, refusal);
      return item;
    }

    const planned: Map<string, string> =
      this.plannedNames.get(data.kind) || new Map<string, string>();
    const plannedKey: string = normalizeImportName(data.name);

    if (UNIQUE_NAME_KINDS.includes(data.kind) && planned.has(plannedKey)) {
      /*
       * Two items of a kind whose names are unique in a project (two
       * severities both called "Major"): the second would be refused, so it
       * is matched to the first, which this import creates.
       */
      item.action = ToolImportAction.Match;
      item.reason = makeToolImportNote(ToolImportNoteCode.NameExists, {
        name: data.name,
      });
      item.references = [...item.references, planned.get(plannedKey)!];
      this.items.push(item);
      return item;
    }

    if (!this.takeCapacity(data.kind)) {
      this.skip(item, this.overLimit(data.kind));
      return item;
    }

    planned.set(plannedKey, item.key);
    this.plannedNames.set(data.kind, planned);

    item.action = ToolImportAction.Create;
    item.isSelectable = true;
    item.isSelectedByDefault = true;
    this.items.push(item);
    return item;
  }

  private newItem(data: {
    kind: ToolImportResourceKind;
    sourceId: string;
    name: string;
    notes: Array<ToolImportNote>;
    summary: ToolImportItemSummary;
    references: Array<string>;
  }): ToolImportPlanItem {
    return {
      key: getToolImportItemKey(data.kind, data.sourceId),
      kind: data.kind,
      sourceId: data.sourceId,
      name: data.name,
      action: ToolImportAction.Skip,
      notes: [...data.notes],
      isSelectable: false,
      isSelectedByDefault: false,
      summary: stripUndefined(data.summary),
      references: data.references,
    };
  }

  private skip(item: ToolImportPlanItem, reason: ToolImportNote): void {
    item.action = ToolImportAction.Skip;
    item.reason = reason;
    item.isSelectable = false;
    item.isSelectedByDefault = false;
    this.items.push(item);
  }

  private match(
    item: ToolImportPlanItem,
    recordId: string,
    reason: ToolImportNote,
  ): void {
    item.action = ToolImportAction.Match;
    item.existingRecordId = recordId;
    item.reason = reason;
    item.isSelectable = false;
    item.isSelectedByDefault = false;
    this.items.push(item);
  }

  private takeCapacity(kind: ToolImportResourceKind): boolean {
    const usedByKind: number = this.createdCountByKind.get(kind) || 0;

    if (
      usedByKind >= TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind] ||
      this.createdCount >= TOOL_IMPORT_MAX_ITEMS
    ) {
      return false;
    }

    this.createdCountByKind.set(kind, usedByKind + 1);
    this.createdCount++;
    return true;
  }

  private overLimit(kind: ToolImportResourceKind): ToolImportNote {
    const usedByKind: number = this.createdCountByKind.get(kind) || 0;

    return makeToolImportNote(ToolImportNoteCode.OverLimit, {
      limit:
        usedByKind >= TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind]
          ? TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind]
          : TOOL_IMPORT_MAX_ITEMS,
    });
  }
}

// Kinds whose names a project may hold only once.
const UNIQUE_NAME_KINDS: Array<ToolImportResourceKind> = [
  ToolImportResourceKind.Service,
  ToolImportResourceKind.IncidentSeverity,
  ToolImportResourceKind.IncidentState,
  ToolImportResourceKind.IncidentRole,
  ToolImportResourceKind.IncidentCustomField,
];

function uniqueKeys(keys: Array<string>): Array<string> {
  return [...new Set<string>(keys)];
}

function stripUndefined(summary: ToolImportItemSummary): ToolImportItemSummary {
  const stripped: ToolImportItemSummary = {};

  for (const [key, value] of Object.entries(summary)) {
    if (value !== undefined) {
      (stripped as Record<string, unknown>)[key] = value;
    }
  }

  return stripped;
}
