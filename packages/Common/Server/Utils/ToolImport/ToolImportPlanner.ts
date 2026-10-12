import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import {
  TOOL_IMPORT_KINDS_OUTSIDE_TOTAL,
  TOOL_IMPORT_MAX_ITEMS,
  TOOL_IMPORT_MAX_ITEMS_PER_KIND,
} from "../../../Types/ToolImport/ToolImportLimits";
import {
  getToolImportMonitorMatchKey,
  getToolImportMonitorProblem,
} from "../../../Types/ToolImport/ToolImportMonitorBuilder";
import { toMonitoringInterval } from "../../../Types/ToolImport/ToolImportMonitorRules";
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
  getToolImportSnapshotMonitors,
  getToolImportSnapshotStatusPages,
  getToolImportSnapshotSubscribers,
  ImportedIncidentCustomField,
  ImportedIncidentRole,
  ImportedIncidentRoleKind,
  ImportedIncidentSeverity,
  ImportedIncidentState,
  ImportedIncidentStateKind,
  ImportedMonitor,
  ImportedPerson,
  ImportedPolicy,
  ImportedPolicyLevel,
  ImportedRotation,
  ImportedSchedule,
  ImportedService,
  ImportedStatusPage,
  ImportedStatusPageResource,
  ImportedStatusPageSubscriber,
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
 *
 * And for what uptime and status page tools bring:
 *
 *  - A monitor is matched to one the project has only when its type, its
 *    name and what it checks all match: two monitors called "Homepage"
 *    that check different sites are two monitors. A check OneUptime has no
 *    monitor for, or whose address it cannot read, is named as not brought
 *    over, never dropped.
 *  - The project's plan counts monitors that are checked, status pages and
 *    subscribers as it counts hand-made ones (planRoomByKind): what does
 *    not fit is skipped with the plan's limit. Manual monitors are free.
 *  - A monitor paused in the tool is offered unticked, and status page
 *    subscribers are always offered unticked: they come over only when the
 *    person ticks them and confirms they may move them.
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

/*
 * A monitor already in the project, with what it checks: an imported check
 * is the same monitor only when its type, its name and its address all
 * match (getToolImportMonitorMatchKey).
 */
export interface ToolImportExistingMonitor {
  id: string;
  name: string;
  monitorType: string;
  // getToolImportMonitorMatchKey of what it checks; null when it checks no address.
  addressKey: string | null;
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
  // The project's monitors, with what they check. None read: none matched.
  existingMonitors?: Array<ToolImportExistingMonitor> | undefined;
  // Each status page's email subscribers (lowercase), by the page's id.
  subscriberEmailsByStatusPageId?: Map<string, Set<string>> | undefined;
}

// How many more of a kind the project's plan has room for, and its limit.
export interface ToolImportPlanRoom {
  room: number;
  limit: number;
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
  /*
   * Kinds the project's plan counts (monitors, status pages and
   * subscribers on the Free plan of a billed install): how many more fit.
   * A kind not here has no such limit.
   */
  planRoomByKind?: Map<ToolImportResourceKind, ToolImportPlanRoom> | undefined;
  /*
   * Why no monitor that is checked - every type but Manual - can be
   * created (a billed install's Free plan with no payment method), or
   * null.
   */
  checkedMonitorRefusal?: ToolImportNote | null | undefined;
  /*
   * Why a status page's groups cannot be made - the person may not, or
   * the project's plan does not include them - or null. The page comes
   * over without them, what it shows listed on its own, and says so.
   */
  statusPageGroupRefusal?: ToolImportNote | null | undefined;
  /*
   * Why a status page cannot come over private - only some people may
   * see it, which needs a plan the project is not on - or null. Such a
   * page is never made public instead: it is not brought over.
   */
  privateStatusPageRefusal?: ToolImportNote | null | undefined;
  /*
   * Why a status page's visitors cannot choose the parts they follow on
   * the project's plan (NeedsPlan, naming the plan), or null. The page
   * comes over without the choice, and says so.
   */
  subscriberChoiceRefusal?: ToolImportNote | null | undefined;
}

// The plan-limit note of each kind the plan counts.
const PLAN_LIMIT_NOTE_CODES: Partial<
  Record<ToolImportResourceKind, ToolImportNoteCode>
> = {
  [ToolImportResourceKind.Monitor]: ToolImportNoteCode.MonitorPlanLimit,
  [ToolImportResourceKind.StatusPage]: ToolImportNoteCode.StatusPagePlanLimit,
  [ToolImportResourceKind.StatusPageSubscriber]:
    ToolImportNoteCode.SubscriberPlanLimit,
};

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
  // How many of each kind the plan counts this import has taken room for.
  private planRoomUsedByKind: Map<ToolImportResourceKind, number> = new Map<
    ToolImportResourceKind,
    number
  >();
  private referencedPeople: Set<string> = new Set<string>();
  // The plan item of each status page read, by its source id.
  private statusPageItems: Map<string, ToolImportPlanItem> = new Map<
    string,
    ToolImportPlanItem
  >();
  // The addresses this import subscribes to each page, by the page's source id.
  private plannedSubscriberEmails: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

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
          const item: ToolImportPlanItem | null = this.planNamed({
            kind: kind,
            sourceId: service.sourceId,
            name: service.name,
            notes: service.notes,
            summary: {},
            references: service.ownerTeamSourceIds.map((id: string) => {
              return getToolImportItemKey(ToolImportResourceKind.Team, id);
            }),
          });

          // A service the tool has turned off is offered, not ticked.
          if (
            item &&
            item.action === ToolImportAction.Create &&
            service.isEnabled === false
          ) {
            item.isSelectedByDefault = false;
          }
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
      case ToolImportResourceKind.Monitor:
        this.planMonitors(getToolImportSnapshotMonitors(this.snapshot));
        return;
      case ToolImportResourceKind.StatusPage:
        getToolImportSnapshotStatusPages(this.snapshot).forEach(
          (statusPage: ImportedStatusPage) => {
            this.planStatusPage(statusPage);
          },
        );
        return;
      case ToolImportResourceKind.StatusPageSubscriber:
        getToolImportSnapshotSubscribers(this.snapshot).forEach(
          (subscriber: ImportedStatusPageSubscriber) => {
            this.planSubscriber(subscriber);
          },
        );
        return;
    }
  }

  /*
   * The monitors, in the tool's order. The ones that start ticked are
   * planned first, so a paused monitor - offered unticked - never takes
   * the plan's last room from one that is on.
   */
  private planMonitors(monitors: Array<ImportedMonitor>): void {
    const start: number = this.items.length;

    for (const isPaused of [false, true]) {
      for (const monitor of monitors) {
        if (Boolean(monitor.isPaused) === isPaused) {
          this.planMonitor(monitor);
        }
      }
    }

    const order: Map<string, number> = new Map<string, number>();

    monitors.forEach((monitor: ImportedMonitor, index: number) => {
      if (!order.has(monitor.sourceId)) {
        order.set(monitor.sourceId, index);
      }
    });

    const planned: Array<ToolImportPlanItem> = this.items.splice(start);

    planned.sort((a: ToolImportPlanItem, b: ToolImportPlanItem): number => {
      return (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0);
    });

    this.items.push(...planned);
  }

  /*
   * A monitor. It comes over when OneUptime has a monitor that checks the
   * same thing at an address it can read; it is the monitor the project
   * already has when one of the same type and name checks the same
   * address; and a monitor that is checked counts towards the plan's
   * monitors, as one made by hand does. A monitor paused in the tool is
   * offered unticked, and comes over paused.
   */
  private planMonitor(monitor: ImportedMonitor): void {
    const isChecked: boolean = Boolean(
      monitor.monitorType && monitor.monitorType !== MonitorType.Manual,
    );
    const summary: ToolImportItemSummary = {
      monitorType: monitor.monitorType || undefined,
      destination: monitor.destination || undefined,
      intervalSeconds:
        monitor.monitorType &&
        MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
          ? toMonitoringInterval(monitor.intervalSeconds).seconds
          : undefined,
    };

    const item: ToolImportPlanItem = this.newItem({
      kind: ToolImportResourceKind.Monitor,
      sourceId: monitor.sourceId,
      name: monitor.name,
      notes: monitor.notes,
      summary: summary,
      references: [],
    });

    if (monitor.skipReason) {
      this.skip(item, monitor.skipReason);
      return;
    }

    const problem: "type" | "address" | null =
      getToolImportMonitorProblem(monitor);

    if (problem === "type") {
      this.skip(
        item,
        makeToolImportNote(ToolImportNoteCode.MonitorTypeNotSupported, {
          type: monitor.sourceType,
        }),
      );
      return;
    }

    if (problem === "address") {
      this.skip(
        item,
        makeToolImportNote(ToolImportNoteCode.MonitorAddressUnreadable, {
          address: monitor.destination || "",
        }),
      );
      return;
    }

    if (this.takePrevious(item)) {
      return;
    }

    const addressKey: string | null = getToolImportMonitorMatchKey(monitor);
    const existing: ToolImportExistingMonitor | undefined = (
      this.state.existingMonitors || []
    ).find((candidate: ToolImportExistingMonitor): boolean => {
      return (
        candidate.monitorType === monitor.monitorType &&
        candidate.addressKey === addressKey &&
        normalizeImportName(candidate.name) ===
          normalizeImportName(monitor.name)
      );
    });

    if (existing) {
      this.match(
        item,
        existing.id,
        makeToolImportNote(ToolImportNoteCode.MonitorAlreadyChecked, {
          name: existing.name,
        }),
      );
      return;
    }

    const refusal: ToolImportNote | null | undefined =
      this.access.createRefusals.get(ToolImportResourceKind.Monitor) ||
      (isChecked ? this.access.checkedMonitorRefusal : null);

    if (refusal) {
      this.skip(item, refusal);
      return;
    }

    // Manual monitors are free: the plan counts the ones that are checked.
    const planLimit: ToolImportNote | null = isChecked
      ? this.takePlanRoom(ToolImportResourceKind.Monitor)
      : null;

    if (planLimit) {
      this.skip(item, planLimit);
      return;
    }

    if (!this.takeCapacity(ToolImportResourceKind.Monitor)) {
      this.skip(item, this.overLimit(ToolImportResourceKind.Monitor));
      return;
    }

    item.action = ToolImportAction.Create;
    item.isSelectable = true;
    item.isSelectedByDefault = !monitor.isPaused;
    this.items.push(item);
  }

  /*
   * A status page, with the monitors it shows. It is the page the project
   * already has when one has its name, and counts towards the plan's
   * status pages.
   */
  private planStatusPage(statusPage: ImportedStatusPage): void {
    const notes: Array<ToolImportNote> = [...statusPage.notes];
    const choiceRefusal: ToolImportNote | null | undefined =
      this.access.subscriberChoiceRefusal;
    const groupRefusal: ToolImportNote | null | undefined =
      this.access.statusPageGroupRefusal;
    const hasGroups: boolean = statusPage.groups.length > 0 && !groupRefusal;

    // Its visitors chose what to follow: a choice the plan may not include.
    if (statusPage.allowsSubscribersToChooseResources && choiceRefusal) {
      notes.push(
        makeToolImportNote(
          ToolImportNoteCode.StatusPageSubscriberChoiceNeedsPlan,
          { plan: planOf(choiceRefusal) },
        ),
      );
    }

    // Groups the person or the plan may not make: everything shown ungrouped.
    if (statusPage.groups.length > 0 && groupRefusal) {
      notes.push(
        groupRefusal.code === ToolImportNoteCode.NeedsPlan
          ? makeToolImportNote(ToolImportNoteCode.StatusPageGroupsNeedPlan, {
              plan: planOf(groupRefusal),
            })
          : makeToolImportNote(ToolImportNoteCode.StatusPageGroupsNotAllowed),
      );
    }

    const item: ToolImportPlanItem | null = this.planNamed({
      kind: ToolImportResourceKind.StatusPage,
      sourceId: statusPage.sourceId,
      name: statusPage.name,
      notes: notes,
      // A private page comes over private, or not at all: never public.
      createRefusal: statusPage.isPublic
        ? null
        : this.access.privateStatusPageRefusal,
      summary: {
        resourceCount: statusPage.resources.length,
        groupCount: hasGroups ? statusPage.groups.length : undefined,
      },
      references: uniqueKeys(
        statusPage.resources.map(
          (resource: ImportedStatusPageResource): string => {
            return getToolImportItemKey(
              ToolImportResourceKind.Monitor,
              resource.monitorSourceId,
            );
          },
        ),
      ),
    });

    if (item) {
      this.statusPageItems.set(statusPage.sourceId, item);
    }
  }

  /*
   * Someone who gets a status page's updates by email. They follow the page
   * the import brings over (or the one the project has of that name), and
   * are offered unticked: subscribers come over only when the person ticks
   * them and confirms they may move them (assertToolImportSubscribersConsent).
   */
  private planSubscriber(subscriber: ImportedStatusPageSubscriber): void {
    const pageItem: ToolImportPlanItem | undefined = this.statusPageItems.get(
      subscriber.statusPageSourceId,
    );

    const item: ToolImportPlanItem = this.newItem({
      kind: ToolImportResourceKind.StatusPageSubscriber,
      sourceId: subscriber.sourceId,
      name: subscriber.email,
      notes: subscriber.notes,
      // The email is the item's name; the summary says whose page.
      summary: {
        statusPageName: pageItem?.name,
      },
      references: [
        getToolImportItemKey(
          ToolImportResourceKind.StatusPage,
          subscriber.statusPageSourceId,
        ),
      ],
    });

    if (subscriber.skipReason) {
      this.skip(item, subscriber.skipReason);
      return;
    }

    if (!pageItem || pageItem.action === ToolImportAction.Skip) {
      this.skip(
        item,
        makeToolImportNote(ToolImportNoteCode.SubscriberPageLeftOut),
      );
      return;
    }

    if (this.takePrevious(item)) {
      return;
    }

    // Already following the page the project has: used as they are.
    const pageId: string | undefined = pageItem.existingRecordId;

    if (
      pageId &&
      this.state.subscriberEmailsByStatusPageId
        ?.get(pageId.toLowerCase())
        ?.has(subscriber.email)
    ) {
      this.match(
        item,
        pageId,
        makeToolImportNote(ToolImportNoteCode.SubscriberAlreadySubscribed),
      );
      return;
    }

    // The same address twice on one page: the first one brings them over.
    const email: string = subscriber.email.toLowerCase();
    const plannedEmails: Set<string> =
      this.plannedSubscriberEmails.get(subscriber.statusPageSourceId) ||
      new Set<string>();

    if (plannedEmails.has(email)) {
      this.skip(
        item,
        makeToolImportNote(ToolImportNoteCode.SubscriberAlreadySubscribed),
      );
      return;
    }

    const refusal: ToolImportNote | null | undefined =
      this.access.createRefusals.get(
        ToolImportResourceKind.StatusPageSubscriber,
      );

    if (refusal) {
      this.skip(item, refusal);
      return;
    }

    const planLimit: ToolImportNote | null = this.takePlanRoom(
      ToolImportResourceKind.StatusPageSubscriber,
    );

    if (planLimit) {
      this.skip(item, planLimit);
      return;
    }

    if (!this.takeCapacity(ToolImportResourceKind.StatusPageSubscriber)) {
      this.skip(
        item,
        this.overLimit(ToolImportResourceKind.StatusPageSubscriber),
      );
      return;
    }

    plannedEmails.add(email);
    this.plannedSubscriberEmails.set(
      subscriber.statusPageSourceId,
      plannedEmails,
    );

    item.action = ToolImportAction.Create;
    item.isSelectable = true;
    item.isSelectedByDefault = false;
    this.items.push(item);
  }

  /*
   * An item an earlier import brought over: shown as such when its record
   * is still there (true: it is dealt with), with a note when it was
   * deleted since and will be made again.
   */
  private takePrevious(item: ToolImportPlanItem): boolean {
    const previous: ToolImportPreviousRecord | undefined =
      this.state.previousRecords.find(
        (record: ToolImportPreviousRecord): boolean => {
          return record.kind === item.kind && record.sourceId === item.sourceId;
        },
      );

    if (previous && previous.stillExists) {
      item.action = ToolImportAction.AlreadyImported;
      item.existingRecordId = previous.recordId;
      item.reason = makeToolImportNote(ToolImportNoteCode.AlreadyImported);
      this.items.push(item);
      return true;
    }

    if (previous && !previous.stillExists) {
      item.notes = [
        ...item.notes,
        makeToolImportNote(ToolImportNoteCode.ImportedBeforeDeletedSince),
      ];
    }

    return false;
  }

  /*
   * Room in the project's plan for one more of a kind it counts: null when
   * there is (and it is taken), else the note saying the plan is full.
   */
  private takePlanRoom(kind: ToolImportResourceKind): ToolImportNote | null {
    const room: ToolImportPlanRoom | undefined =
      this.access.planRoomByKind?.get(kind);

    if (!room) {
      return null;
    }

    const used: number = this.planRoomUsedByKind.get(kind) || 0;

    if (used >= room.room) {
      return makeToolImportNote(
        PLAN_LIMIT_NOTE_CODES[kind] || ToolImportNoteCode.OverLimit,
        { limit: room.limit },
      );
    }

    this.planRoomUsedByKind.set(kind, used + 1);
    return null;
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

    /*
     * A policy none of whose levels names anyone - every step pages what
     * OneUptime cannot (a channel, a webhook, a schedule the tool's API does
     * not give) - would page nobody: the import skips it, so the preview
     * says so up front rather than offering it as new.
     */
    const namesNobody: boolean = policy.levels.every(
      (level: ImportedPolicyLevel): boolean => {
        return (
          level.personSourceIds.length === 0 &&
          level.teamSourceIds.length === 0 &&
          level.scheduleSourceIds.length === 0
        );
      },
    );

    if (policy.isUnreadable || policy.levels.length === 0 || namesNobody) {
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
    // Why this one item cannot be created, besides the kind's own refusal.
    createRefusal?: ToolImportNote | null | undefined;
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
      this.access.createRefusals.get(data.kind) || data.createRefusal;

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

    const planLimit: ToolImportNote | null = this.takePlanRoom(data.kind);

    if (planLimit) {
      this.skip(item, planLimit);
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
    const countsTowardsTotal: boolean =
      !TOOL_IMPORT_KINDS_OUTSIDE_TOTAL.includes(kind);

    if (
      usedByKind >= TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind] ||
      (countsTowardsTotal && this.createdCount >= TOOL_IMPORT_MAX_ITEMS)
    ) {
      return false;
    }

    this.createdCountByKind.set(kind, usedByKind + 1);

    if (countsTowardsTotal) {
      this.createdCount++;
    }

    return true;
  }

  private overLimit(kind: ToolImportResourceKind): ToolImportNote {
    const usedByKind: number = this.createdCountByKind.get(kind) || 0;

    return makeToolImportNote(ToolImportNoteCode.OverLimit, {
      limit:
        usedByKind >= TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind] ||
        TOOL_IMPORT_KINDS_OUTSIDE_TOTAL.includes(kind)
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

// The plan a NeedsPlan refusal names.
function planOf(refusal: ToolImportNote): string {
  return String(refusal.values?.["plan"] || "");
}

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
