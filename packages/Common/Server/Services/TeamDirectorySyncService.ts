import ProjectUserProfileService from "./ProjectUserProfileService";
import TeamMemberCustomFieldService from "./TeamMemberCustomFieldService";
import TeamMemberService from "./TeamMemberService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../Types/CustomField/CustomFieldType";
import ColumnLength from "../../Types/Database/ColumnLength";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import ProjectUserProfile from "../../Models/DatabaseModels/ProjectUserProfile";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import TeamMemberCustomField from "../../Models/DatabaseModels/TeamMemberCustomField";
import User from "../../Models/DatabaseModels/User";

/*
 * KEEPING ONE TEAM IN STEP WITH AN EXTERNAL DIRECTORY.
 *
 * An external system that already knows who is on call (Better Stack, an
 * HR system) pushes its whole roster here, and the named team is made to
 * match it: every person gets an account with their real name, a membership
 * that is already accepted, and the directory's own facts about them in the
 * project's team member custom fields. People the directory no longer lists
 * can be taken off the team (`removeMissing`).
 *
 * Two things here go further than an invitation does, on purpose, and are
 * why the route that calls this is off unless the installation turns it on
 * (ENABLE_TEAM_DIRECTORY_SYNC):
 *
 * - The membership is created ACCEPTED. An invitation waits for its invitee
 *   (TeamMemberService.onBeforeCreate), but a directory is the source of
 *   truth for who is on the team, and a responder who never clicks the
 *   invitation is never paged.
 * - An address that has never registered is marked verified. Default
 *   notification rules are only added for a verified address, and the
 *   directory is where that address was verified. An account somebody has
 *   registered keeps whatever state its owner left it in.
 *
 * Only the named team is touched: removal is from that team, never from the
 * project, and never deletes an account.
 */

export const MAX_DIRECTORY_MEMBERS: number = 1000;
export const MAX_CUSTOM_FIELDS_PER_MEMBER: number = 50;

export type DirectoryCustomFieldValue = string | number | boolean | null;

export interface DirectoryMember {
  email: string;
  name?: string | undefined;
  customFields?: Record<string, DirectoryCustomFieldValue> | undefined;
}

export interface TeamDirectorySyncRequest {
  projectId: ObjectID;
  teamName: string;
  members: Array<DirectoryMember>;
  removeMissing: boolean;
  dryRun: boolean;
  // Recorded on accounts the sync creates, when the caller is a person.
  actingUserId?: ObjectID | undefined;
}

export type DirectoryMemberAction =
  | "created"
  | "updated"
  | "unchanged"
  | "removed"
  | "failed";

export interface DirectoryMemberResult {
  email: string;
  userId: string | null;
  action: DirectoryMemberAction;
  changes: Array<string>;
  error?: string | undefined;
}

export interface TeamDirectorySyncResult {
  dryRun: boolean;
  team: {
    id: string | null;
    name: string;
    created: boolean;
  };
  customFieldsCreated: Array<string>;
  members: Array<DirectoryMemberResult>;
  summary: Record<DirectoryMemberAction, number>;
}

interface ExistingMembership {
  id: ObjectID;
  userId: ObjectID;
  hasAcceptedInvitation: boolean;
  email: string | null;
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

export class TeamDirectorySyncService {
  /*
   * Reads and checks a request body. Everything a caller sends is held to
   * what the columns it ends up in can store, so a bad roster is refused
   * whole before anything is written, rather than half-applied.
   */
  public static parseMembers(raw: unknown): Array<DirectoryMember> {
    if (!Array.isArray(raw)) {
      throw new BadDataException("members must be an array.");
    }

    if (raw.length > MAX_DIRECTORY_MEMBERS) {
      throw new BadDataException(
        `members may list at most ${MAX_DIRECTORY_MEMBERS} people.`,
      );
    }

    const seen: Set<string> = new Set<string>();
    const members: Array<DirectoryMember> = [];

    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new BadDataException("Every member must be an object.");
      }

      const entry: JSONObject = item as JSONObject;
      const email: string =
        typeof entry["email"] === "string"
          ? entry["email"].trim().toLowerCase()
          : "";

      if (!email || !Email.isValid(email)) {
        throw new BadDataException(
          `Every member needs a valid email (got "${String(entry["email"]).slice(0, 100)}").`,
        );
      }

      if (seen.has(email)) {
        throw new BadDataException(`${email} is listed more than once.`);
      }
      seen.add(email);

      let name: string | undefined = undefined;

      if (entry["name"] !== undefined && entry["name"] !== null) {
        if (typeof entry["name"] !== "string") {
          throw new BadDataException(`The name of ${email} must be text.`);
        }

        name = entry["name"].trim().replace(/\s+/g, " ") || undefined;

        if (name && name.length > ColumnLength.Name) {
          name = name.slice(0, ColumnLength.Name).trim();
        }
      }

      members.push({
        email: email,
        name: name,
        customFields: TeamDirectorySyncService.parseCustomFields(
          email,
          entry["customFields"],
        ),
      });
    }

    return members;
  }

  private static parseCustomFields(
    email: string,
    raw: JSONValue | undefined,
  ): Record<string, DirectoryCustomFieldValue> | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }

    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadDataException(`customFields of ${email} must be an object.`);
    }

    const keys: Array<string> = Object.keys(raw);

    if (keys.length > MAX_CUSTOM_FIELDS_PER_MEMBER) {
      throw new BadDataException(
        `customFields of ${email} may hold at most ${MAX_CUSTOM_FIELDS_PER_MEMBER} fields.`,
      );
    }

    const fields: Record<string, DirectoryCustomFieldValue> = {};

    for (const key of keys) {
      const fieldName: string = key.trim();

      if (!fieldName || fieldName.length > ColumnLength.ShortText) {
        throw new BadDataException(
          `customFields of ${email} has a field name that is empty or longer than ${ColumnLength.ShortText} characters.`,
        );
      }

      const value: JSONValue = (raw as JSONObject)[key] as JSONValue;

      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new BadDataException(
          `customFields.${fieldName} of ${email} must be text, a number, a boolean or null.`,
        );
      }

      fields[fieldName] =
        typeof value === "string"
          ? value.slice(0, ColumnLength.LongText)
          : value;
    }

    return fields;
  }

  @CaptureSpan()
  public static async sync(
    request: TeamDirectorySyncRequest,
  ): Promise<TeamDirectorySyncResult> {
    const teamName: string = request.teamName.trim();

    if (!teamName || teamName.length > ColumnLength.ShortText) {
      throw new BadDataException(
        `teamName is required and may be at most ${ColumnLength.ShortText} characters.`,
      );
    }

    /*
     * An empty roster with removeMissing would empty the team. That is far
     * more often a directory that failed to answer than a team that really
     * has nobody left on it, so it is refused rather than obeyed.
     */
    if (request.removeMissing && request.members.length === 0) {
      throw new BadDataException(
        "Refusing to remove every member: the directory listed nobody.",
      );
    }

    const result: TeamDirectorySyncResult = {
      dryRun: request.dryRun,
      team: { id: null, name: teamName, created: false },
      customFieldsCreated: [],
      members: [],
      summary: {
        created: 0,
        updated: 0,
        unchanged: 0,
        removed: 0,
        failed: 0,
      },
    };

    const { team, created } = await this.findOrCreateTeam({
      projectId: request.projectId,
      teamName: teamName,
      dryRun: request.dryRun,
    });

    result.team.created = created;
    result.team.id = team?.id?.toString() || null;

    result.customFieldsCreated = await this.ensureCustomFieldDefinitions({
      projectId: request.projectId,
      members: request.members,
      dryRun: request.dryRun,
    });

    const memberships: Map<string, ExistingMembership> = team?.id
      ? await this.readMemberships(request.projectId, team.id)
      : new Map<string, ExistingMembership>();

    const keptUserIds: Set<string> = new Set<string>();

    for (const member of request.members) {
      let memberResult: DirectoryMemberResult;

      try {
        memberResult = await this.syncMember({
          projectId: request.projectId,
          teamId: team?.id || null,
          member: member,
          memberships: memberships,
          dryRun: request.dryRun,
          actingUserId: request.actingUserId,
        });
      } catch (err) {
        logger.error(
          err as Error,
          {
            projectId: request.projectId.toString(),
          } as LogAttributes,
        );

        memberResult = {
          email: member.email,
          userId: null,
          action: "failed",
          changes: [],
          error: (err as Error).message || "Unknown error",
        };
      }

      if (memberResult.userId) {
        keptUserIds.add(memberResult.userId);
      }

      result.members.push(memberResult);
    }

    if (request.removeMissing) {
      for (const membership of memberships.values()) {
        if (keptUserIds.has(membership.userId.toString())) {
          continue;
        }

        /*
         * A member whose sync failed is not "missing": the directory did
         * list them. Their address is how they are told apart.
         */
        if (
          membership.email &&
          request.members.some((member: DirectoryMember) => {
            return member.email === membership.email;
          })
        ) {
          continue;
        }

        const removal: DirectoryMemberResult = {
          email: membership.email || "",
          userId: membership.userId.toString(),
          action: "removed",
          changes: ["membership_removed"],
        };

        if (!request.dryRun) {
          try {
            await TeamMemberService.deleteOneById({
              id: membership.id,
              props: ROOT,
            });
          } catch (err) {
            removal.action = "failed";
            removal.changes = [];
            removal.error = (err as Error).message || "Unknown error";
          }
        }

        result.members.push(removal);
      }
    }

    for (const member of result.members) {
      result.summary[member.action] += 1;
    }

    return result;
  }

  private static async findOrCreateTeam(data: {
    projectId: ObjectID;
    teamName: string;
    dryRun: boolean;
  }): Promise<{ team: Team | null; created: boolean }> {
    const existing: Team | null = await TeamService.findOneBy({
      query: {
        projectId: data.projectId,
        name: data.teamName,
      },
      select: {
        _id: true,
        name: true,
      },
      props: ROOT,
    });

    if (existing) {
      return { team: existing, created: false };
    }

    // A dry run reports the team as one that would be created.
    if (data.dryRun) {
      return { team: null, created: true };
    }

    const team: Team = new Team();
    team.projectId = data.projectId;
    team.name = data.teamName;
    team.description =
      "Kept in step with an external directory by the team directory sync. Members added or removed here by hand are changed back on the next sync.";

    const created: Team = await TeamService.create({
      data: team,
      props: { ...ROOT, tenantId: data.projectId },
    });

    return { team: created, created: true };
  }

  /*
   * Custom field values only show on a member's page once the project has a
   * definition of that name, so a field the directory sends for the first
   * time gets one, as text.
   */
  private static async ensureCustomFieldDefinitions(data: {
    projectId: ObjectID;
    members: Array<DirectoryMember>;
    dryRun: boolean;
  }): Promise<Array<string>> {
    const wanted: Set<string> = new Set<string>();

    for (const member of data.members) {
      for (const key of Object.keys(member.customFields || {})) {
        wanted.add(key);
      }
    }

    if (wanted.size === 0) {
      return [];
    }

    const existing: Array<TeamMemberCustomField> =
      await TeamMemberCustomFieldService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: ROOT,
      });

    const existingNames: Set<string> = new Set<string>(
      existing.map((field: TeamMemberCustomField) => {
        return field.name || "";
      }),
    );

    const missing: Array<string> = Array.from(wanted).filter((name: string) => {
      return !existingNames.has(name);
    });

    if (!data.dryRun) {
      for (const name of missing) {
        const field: TeamMemberCustomField = new TeamMemberCustomField();
        field.projectId = data.projectId;
        field.name = name;
        field.customFieldType = CustomFieldType.Text;
        field.description = "Set by the team directory sync.";

        await TeamMemberCustomFieldService.create({
          data: field,
          props: { ...ROOT, tenantId: data.projectId },
        });
      }
    }

    return missing;
  }

  private static async readMemberships(
    projectId: ObjectID,
    teamId: ObjectID,
  ): Promise<Map<string, ExistingMembership>> {
    const rows: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: projectId,
        teamId: teamId,
      },
      select: {
        _id: true,
        userId: true,
        hasAcceptedInvitation: true,
        user: {
          email: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ROOT,
    });

    const memberships: Map<string, ExistingMembership> = new Map();

    for (const row of rows) {
      if (!row.id || !row.userId) {
        continue;
      }

      memberships.set(row.userId.toString(), {
        id: row.id,
        userId: row.userId,
        hasAcceptedInvitation: Boolean(row.hasAcceptedInvitation),
        email: row.user?.email?.toString().toLowerCase() || null,
      });
    }

    return memberships;
  }

  private static async syncMember(data: {
    projectId: ObjectID;
    teamId: ObjectID | null;
    member: DirectoryMember;
    memberships: Map<string, ExistingMembership>;
    dryRun: boolean;
    actingUserId?: ObjectID | undefined;
  }): Promise<DirectoryMemberResult> {
    const { member, dryRun } = data;
    const changes: Array<string> = [];

    let user: User | null = await UserService.findOneBy({
      query: {
        email: new Email(member.email),
      },
      select: {
        _id: true,
        name: true,
        isEmailVerified: true,
        password: true,
      },
      props: ROOT,
    });

    let created: boolean = false;

    if (!user) {
      created = true;
      changes.push("user_created");

      if (!dryRun) {
        user = await UserService.createByEmail({
          email: new Email(member.email),
          name: member.name ? new Name(member.name) : undefined,
          isEmailVerified: true,
          createdByUserId: data.actingUserId,
          props: ROOT,
        });
      }
    } else {
      const isNameChanged: boolean = Boolean(
        member.name && user.name?.toString() !== member.name,
      );

      // Never registered: the directory is the proof the address works.
      const isVerifying: boolean = !user.isEmailVerified && !user.password;

      if (isNameChanged) {
        changes.push("name");
      }

      if (isVerifying) {
        changes.push("email_verified");
      }

      if (!dryRun && isNameChanged) {
        await UserService.updateOneById({
          id: user.id!,
          data: {
            name: new Name(member.name!),
          },
          props: ROOT,
        });
      }

      // On its own, so UserService adds the notification defaults it adds on verification.
      if (!dryRun && isVerifying) {
        await UserService.updateOneById({
          id: user.id!,
          data: {
            isEmailVerified: true,
          },
          props: ROOT,
        });
      }
    }

    const userId: ObjectID | null = user?.id || null;

    // Membership of the team, accepted.
    const membership: ExistingMembership | undefined = userId
      ? data.memberships.get(userId.toString())
      : undefined;

    if (!membership) {
      changes.push("membership_created");

      if (!dryRun && data.teamId && userId) {
        const teamMember: TeamMember = new TeamMember();
        teamMember.projectId = data.projectId;
        teamMember.teamId = data.teamId;
        teamMember.userId = userId;
        teamMember.hasAcceptedInvitation = true;

        await TeamMemberService.create({
          data: teamMember,
          props: { ...ROOT, tenantId: data.projectId },
        });
      }
    } else if (!membership.hasAcceptedInvitation) {
      changes.push("invitation_accepted");

      if (!dryRun) {
        await TeamMemberService.updateOneById({
          id: membership.id,
          data: {
            hasAcceptedInvitation: true,
          },
          props: ROOT,
        });
      }
    }

    if (member.customFields && Object.keys(member.customFields).length > 0) {
      const changed: boolean = await this.syncCustomFields({
        projectId: data.projectId,
        userId: userId,
        customFields: member.customFields,
        dryRun: dryRun,
      });

      if (changed) {
        changes.push("custom_fields");
      }
    }

    return {
      email: member.email,
      userId: userId?.toString() || null,
      action: created
        ? "created"
        : changes.length > 0
          ? "updated"
          : "unchanged",
      changes: changes,
    };
  }

  /*
   * The directory's fields are merged into the member's profile: a field it
   * does not send - one somebody set by hand, say - is left as it is.
   */
  private static async syncCustomFields(data: {
    projectId: ObjectID;
    userId: ObjectID | null;
    customFields: Record<string, DirectoryCustomFieldValue>;
    dryRun: boolean;
  }): Promise<boolean> {
    const profile: ProjectUserProfile | null = data.userId
      ? await ProjectUserProfileService.findOneBy({
          query: {
            projectId: data.projectId,
            userId: data.userId,
          },
          select: {
            _id: true,
            customFields: true,
          },
          props: ROOT,
        })
      : null;

    const current: JSONObject = (profile?.customFields || {}) as JSONObject;

    const isChanged: boolean = Object.entries(data.customFields).some(
      ([key, value]: [string, DirectoryCustomFieldValue]) => {
        return (current[key] ?? null) !== value;
      },
    );

    if (!isChanged || data.dryRun || !data.userId) {
      return isChanged;
    }

    const merged: JSONObject = { ...current, ...data.customFields };

    if (profile?.id) {
      /*
       * Typed through unknown: checking a JSONObject against the deep
       * partial of a JSON column is more than the compiler will instantiate.
       */
      const update: QueryDeepPartialEntity<ProjectUserProfile> = {
        customFields: merged,
      } as unknown as QueryDeepPartialEntity<ProjectUserProfile>;

      await ProjectUserProfileService.updateOneById({
        id: profile.id,
        data: update,
        props: ROOT,
      });
    } else {
      const newProfile: ProjectUserProfile = new ProjectUserProfile();
      newProfile.projectId = data.projectId;
      newProfile.userId = data.userId;
      newProfile.customFields = merged;

      await ProjectUserProfileService.create({
        data: newProfile,
        props: { ...ROOT, tenantId: data.projectId },
      });
    }

    return true;
  }
}

export default TeamDirectorySyncService;
