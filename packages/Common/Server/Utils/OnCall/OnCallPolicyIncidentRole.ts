import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import IncidentEpisodeMemberService from "../../Services/IncidentEpisodeMemberService";
import IncidentEpisodeRoleMemberService from "../../Services/IncidentEpisodeRoleMemberService";
import IncidentMemberService from "../../Services/IncidentMemberService";
import IncidentRoleService from "../../Services/IncidentRoleService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import QueryHelper from "../../Types/Database/QueryHelper";
import IncidentRoleFeedText from "../Incident/IncidentRoleFeedText";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE INCIDENT ROLE AN ON-CALL POLICY GIVES THE PEOPLE IT PAGES
 * (OnCallDutyPolicy.incidentRoleId).
 *
 * An incident's Incident Roles say who is on it. Whoever first changes its
 * state becomes its Incident Commander (IncidentStateTimelineService), and a
 * monitor's criteria can name people for roles, but the people on call were
 * never listed: the on-call person of the team that owns a service had to
 * be added by hand, after somebody looked up who that was. A policy can now
 * name a role, and everybody it pages about an incident or an incident
 * episode is given that role on it - the policy's schedules, rotations,
 * overrides and teams already say who is on call, so nobody keeps a second
 * list of it. "Payments Primary" giving the people it pages Service Owner
 * lists the payments team's on-call person as the incident's Service Owner,
 * however the incident was declared: by a monitor, a workflow, the API or
 * by hand, through whatever ran the policy.
 *
 * What it gives, and to whom:
 *
 *   - Everybody the policy pages, at every level, a page again included -
 *     and somebody whose page was merged into their open page from another
 *     run about the same record (OnCallPageMerge): the policy reached them
 *     too. Never somebody paged as an observer (OnCallObserverPage), who is
 *     kept informed, not pulled into the response - the same line the
 *     record's chat channels draw (UserNotificationRuleService).
 *   - Only a member of the project: a person who left is skipped, as every
 *     automatic role is (IncidentMemberService).
 *   - Nothing twice: a person who holds the role already keeps it as it is.
 *   - A role that takes one person (the Incident Commander, or a role whose
 *     Allow Multiple Users is off) goes to the first person paged while
 *     nobody holds it; the people paged after them keep the roles they
 *     have. The role is held one record at a time (Semaphore), so two people
 *     paged at the same moment cannot both take it.
 *   - The incident's feed names the policy ("On-Call Policy Payments
 *     Primary added Deane Looi as Service Owner", IncidentRoleFeedText),
 *     and the person is sent no separate message about the role: their page
 *     told them about the incident already.
 *
 * An episode's role is carried into each of its incidents
 * (IncidentEpisodeRoleMemberService), with the same words.
 *
 * Never throws for the page's sake: the paging code calls it after the page
 * went out, without waiting for it, and logs what failed.
 */

// What a person was paged about, by which policy, in which project.
export interface PagedPerson {
  projectId: ObjectID;
  onCallDutyPolicyId: ObjectID;
  userId: ObjectID;
  // The incident they were paged about, or...
  incidentId?: ObjectID | undefined;
  // ...the incident episode.
  incidentEpisodeId?: ObjectID | undefined;
}

// What came of it: a role given, or why not. Read by the tests.
export enum PagedPersonRoleOutcome {
  // Paged about an alert, an alert episode, or nothing: no incident roles.
  NotAboutAnIncident = "NotAboutAnIncident",
  // The policy gives no role, or it is gone.
  PolicyGivesNoRole = "PolicyGivesNoRole",
  // The person is not a member of the project.
  NotAProjectMember = "NotAProjectMember",
  // They hold the role on it already.
  AlreadyHeld = "AlreadyHeld",
  // The role takes one person, and somebody else holds it.
  HeldBySomebodyElse = "HeldBySomebodyElse",
  Given = "Given",
}

// The role a policy gives, as read for a page.
interface PolicyRole {
  roleId: ObjectID;
  takesOnePerson: boolean;
  policyName: string;
}

// The lock's namespace: one record and one role at a time.
export const ON_CALL_POLICY_INCIDENT_ROLE_LOCK_NAMESPACE: string =
  "OnCallPolicyIncidentRole";

export default class OnCallPolicyIncidentRole {
  /*
   * Gives the person the role their policy names on what it paged them
   * about, and says what came of it.
   */
  @CaptureSpan()
  public static async giveRoleToPagedPerson(
    paged: PagedPerson,
  ): Promise<PagedPersonRoleOutcome> {
    const recordId: ObjectID | undefined =
      paged.incidentId || paged.incidentEpisodeId;

    if (!recordId) {
      return PagedPersonRoleOutcome.NotAboutAnIncident;
    }

    const policyRole: PolicyRole | null = await this.readPolicyRole(paged);

    if (!policyRole) {
      return PagedPersonRoleOutcome.PolicyGivesNoRole;
    }

    if (
      !(await TeamMemberService.isUserMemberOfProject({
        projectId: paged.projectId,
        userId: paged.userId,
      }))
    ) {
      return PagedPersonRoleOutcome.NotAProjectMember;
    }

    const mutex: SemaphoreMutex | null = await this.lockRole({
      recordId: recordId,
      roleId: policyRole.roleId,
      paged: paged,
    });

    try {
      if (paged.incidentId) {
        return await this.giveOnIncident({
          paged: paged,
          incidentId: paged.incidentId,
          policyRole: policyRole,
        });
      }

      return await this.giveOnEpisode({
        paged: paged,
        incidentEpisodeId: recordId,
        policyRole: policyRole,
      });
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err, this.logAttributes(paged));
        }
      }
    }
  }

  /*
   * The roles the person was given on the incident by the policies that
   * paged them about it, or about an episode it is in - their roles that a
   * page gave, as far as the pages say: the roles the policies that paged
   * them give. The first
   * person to change an incident's state becomes its Incident Commander
   * only while they hold no role on it (IncidentStateTimelineService); a
   * role a page gave them does not count, so somebody paged as a
   * Responder who acknowledges still takes command.
   */
  @CaptureSpan()
  public static async getRoleIdsGivenByPages(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    userId: ObjectID;
  }): Promise<Set<string>> {
    const pages: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
      query: {
        projectId: data.projectId,
        triggeredByIncidentId: data.incidentId,
        userId: data.userId,
      },
      select: {
        onCallDutyPolicyId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    /*
     * And the pages about the episodes the incident is in: a role given on
     * an episode is carried into each of its incidents
     * (IncidentEpisodeRoleMemberService).
     */
    const episodeIds: Array<string> = (
      await IncidentEpisodeMemberService.findBy({
        query: {
          projectId: data.projectId,
          incidentId: data.incidentId,
        },
        select: {
          incidentEpisodeId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      })
    )
      .map((inEpisode: IncidentEpisodeMember): string => {
        return inEpisode.incidentEpisodeId?.toString() || "";
      })
      .filter((episodeId: string): boolean => {
        return Boolean(episodeId);
      });

    if (episodeIds.length > 0) {
      pages.push(
        ...(await UserOnCallLogService.findBy({
          query: {
            projectId: data.projectId,
            triggeredByIncidentEpisodeId: QueryHelper.any(episodeIds),
            userId: data.userId,
          },
          select: {
            onCallDutyPolicyId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        })),
      );
    }

    const policyIds: Array<string> = Array.from(
      new Set(
        pages
          .map((page: UserOnCallLog): string => {
            return page.onCallDutyPolicyId?.toString() || "";
          })
          .filter((policyId: string): boolean => {
            return Boolean(policyId);
          }),
      ),
    );

    if (policyIds.length === 0) {
      return new Set<string>();
    }

    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {
          _id: QueryHelper.any(policyIds),
          projectId: data.projectId,
        },
        select: {
          incidentRoleId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    return new Set<string>(
      policies
        .map((policy: OnCallDutyPolicy): string => {
          return policy.incidentRoleId?.toString().toLowerCase() || "";
        })
        .filter((roleId: string): boolean => {
          return Boolean(roleId);
        }),
    );
  }

  // The cause a role given by the policy is created with, for its feed.
  public static getMiscDataProps(policyName: string): JSONObject {
    return IncidentRoleFeedText.toMiscDataProps({
      kind: "onCallPolicy",
      policyName: policyName,
    });
  }

  // The role the policy gives, read pinned to the project; null for none.
  private static async readPolicyRole(
    paged: PagedPerson,
  ): Promise<PolicyRole | null> {
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneBy({
        query: {
          _id: paged.onCallDutyPolicyId,
          projectId: paged.projectId,
        },
        select: {
          name: true,
          incidentRoleId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!policy || !policy.incidentRoleId) {
      return null;
    }

    const role: IncidentRole | null = await IncidentRoleService.findOneBy({
      query: {
        _id: policy.incidentRoleId,
        projectId: paged.projectId,
      },
      select: {
        _id: true,
        isPrimaryRole: true,
        canAssignMultipleUsers: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!role || !role.id) {
      return null;
    }

    return {
      roleId: role.id,
      // The Incident Commander is always one person (IncidentRoleService).
      takesOnePerson:
        Boolean(role.isPrimaryRole) || !role.canAssignMultipleUsers,
      policyName: (policy.name || "").toString(),
    };
  }

  /*
   * One page at a time gives a record's role: two people paged at the same
   * moment for a role that takes one person would both find it free.
   * Without the lock - Redis is not there - the role is still given: at
   * worst, two people hold it, as they could by hand.
   */
  private static async lockRole(data: {
    recordId: ObjectID;
    roleId: ObjectID;
    paged: PagedPerson;
  }): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: `${data.recordId.toString()}-${data.roleId.toString()}`,
        namespace: ON_CALL_POLICY_INCIDENT_ROLE_LOCK_NAMESPACE,
        lockTimeout: 15000,
        acquireTimeout: 30000,
      });
    } catch (err) {
      logger.warn(
        `Could not lock incident role ${data.roleId.toString()} on ${data.recordId.toString()}; giving it without the lock.`,
        this.logAttributes(data.paged),
      );
      logger.warn(err, this.logAttributes(data.paged));
      return null;
    }
  }

  private static async giveOnIncident(data: {
    paged: PagedPerson;
    incidentId: ObjectID;
    policyRole: PolicyRole;
  }): Promise<PagedPersonRoleOutcome> {
    const holders: Array<IncidentMember> = await IncidentMemberService.findBy({
      query: {
        projectId: data.paged.projectId,
        incidentId: data.incidentId,
        incidentRoleId: data.policyRole.roleId,
      },
      select: {
        userId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const outcome: PagedPersonRoleOutcome | null = this.getOutcomeForHolders({
      holderUserIds: holders.map((holder: IncidentMember) => {
        return holder.userId;
      }),
      paged: data.paged,
      policyRole: data.policyRole,
    });

    if (outcome) {
      return outcome;
    }

    const member: IncidentMember = new IncidentMember();
    member.projectId = data.paged.projectId;
    member.incidentId = data.incidentId;
    member.userId = data.paged.userId;
    member.incidentRoleId = data.policyRole.roleId;
    // Their page told them about the incident: no second message for the role.
    member.isMemberNotified = true;

    await IncidentMemberService.create({
      data: member,
      miscDataProps: this.getMiscDataProps(data.policyRole.policyName),
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      `On-call policy ${data.paged.onCallDutyPolicyId.toString()} gave user ${data.paged.userId.toString()} incident role ${data.policyRole.roleId.toString()} on incident ${data.incidentId.toString()}`,
      this.logAttributes(data.paged),
    );

    return PagedPersonRoleOutcome.Given;
  }

  private static async giveOnEpisode(data: {
    paged: PagedPerson;
    incidentEpisodeId: ObjectID;
    policyRole: PolicyRole;
  }): Promise<PagedPersonRoleOutcome> {
    const holders: Array<IncidentEpisodeRoleMember> =
      await IncidentEpisodeRoleMemberService.findBy({
        query: {
          projectId: data.paged.projectId,
          incidentEpisodeId: data.incidentEpisodeId,
          incidentRoleId: data.policyRole.roleId,
        },
        select: {
          userId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const outcome: PagedPersonRoleOutcome | null = this.getOutcomeForHolders({
      holderUserIds: holders.map((holder: IncidentEpisodeRoleMember) => {
        return holder.userId;
      }),
      paged: data.paged,
      policyRole: data.policyRole,
    });

    if (outcome) {
      return outcome;
    }

    const member: IncidentEpisodeRoleMember = new IncidentEpisodeRoleMember();
    member.projectId = data.paged.projectId;
    member.incidentEpisodeId = data.incidentEpisodeId;
    member.userId = data.paged.userId;
    member.incidentRoleId = data.policyRole.roleId;

    /*
     * Carried into each incident of the episode, whose feed names the
     * policy too (IncidentEpisodeRoleMemberService).
     */
    await IncidentEpisodeRoleMemberService.create({
      data: member,
      miscDataProps: this.getMiscDataProps(data.policyRole.policyName),
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      `On-call policy ${data.paged.onCallDutyPolicyId.toString()} gave user ${data.paged.userId.toString()} incident role ${data.policyRole.roleId.toString()} on incident episode ${data.incidentEpisodeId.toString()}`,
      this.logAttributes(data.paged),
    );

    return PagedPersonRoleOutcome.Given;
  }

  /*
   * What the role's holders leave to do: nothing when the person holds it
   * already, or when it takes one person and somebody else does; null when
   * it is theirs to be given.
   */
  private static getOutcomeForHolders(data: {
    holderUserIds: Array<ObjectID | undefined>;
    paged: PagedPerson;
    policyRole: PolicyRole;
  }): PagedPersonRoleOutcome | null {
    const pagedUserId: string = data.paged.userId.toString().toLowerCase();
    const holderUserIds: Array<string> = data.holderUserIds
      .map((userId: ObjectID | undefined): string => {
        return userId?.toString().toLowerCase() || "";
      })
      .filter((userId: string): boolean => {
        return Boolean(userId);
      });

    if (holderUserIds.includes(pagedUserId)) {
      return PagedPersonRoleOutcome.AlreadyHeld;
    }

    if (data.policyRole.takesOnePerson && holderUserIds.length > 0) {
      return PagedPersonRoleOutcome.HeldBySomebodyElse;
    }

    return null;
  }

  private static logAttributes(paged: PagedPerson): LogAttributes {
    return {
      projectId: paged.projectId.toString(),
      onCallDutyPolicyId: paged.onCallDutyPolicyId.toString(),
      userId: paged.userId.toString(),
      ...(paged.incidentId ? { incidentId: paged.incidentId.toString() } : {}),
      ...(paged.incidentEpisodeId
        ? { incidentEpisodeId: paged.incidentEpisodeId.toString() }
        : {}),
    } as LogAttributes;
  }
}
