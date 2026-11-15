import CacheGenerations from "../../Infrastructure/CacheGenerations";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE ON-CALL POLICIES SOMEONE IS ON DUTY FOR, KEPT A MINUTE PER SERVER.
 *
 * The dashboard's header asks, on every page, which on-call policies the
 * person is on duty for in the project they are looking at
 * (OnCallDutyPolicyService.getOnCallPoliciesWhereUserIsOnCallDuty, behind
 * /on-call-duty-policy/current-on-duty-escalation-policies): the schedules
 * whose roster they are on, their teams, and the escalation rules that page
 * them, their teams or those schedules. Up to five reads for a request that
 * changes nothing from one page to the next - and the one that showed
 * "unable to fetch on-call policies" when a customer's pool was full.
 *
 * Each answer is kept for TTL_MS, by project and person, and built once for
 * the requests that miss together. It is kept under its project's
 * generation (CacheGenerations, as the status page overview and the
 * on-call calendar feeds keep theirs), and a change that can change who is
 * on duty for what starts a new one (forgetProjects): every answer of the
 * project is built again, here at once and on every other server within
 * CacheGenerations.SHARED_READ_TTL_MS:
 *
 *   - a person, a team or a schedule added to or taken off an escalation
 *     rule (OnCallDutyPolicyEscalationRule{User,Team,Schedule}Service);
 *   - an escalation rule renamed, moved or deleted, or a policy deleted
 *     (OnCallDutyPolicyEscalationRuleService, OnCallDutyPolicyService) -
 *     a delete the database carries on to the rule's people, teams and
 *     schedules itself;
 *   - someone's membership of a team made, accepted or ended
 *     (TeamMemberService.refreshTokens).
 *
 * Seen when the entry runs out, within TTL_MS, as no write of a person's
 * marks them: a roster handing over (written by a cron every minute, so the
 * roster it reads is already up to a minute behind the hand-over), and a
 * policy, a schedule or a team renamed, a schedule or a team deleted.
 *
 * An answer is shared between the requests it is handed to and must not be
 * changed.
 */
export default class OnDutyPoliciesCache {
  // How long an answer is kept, at most.
  public static readonly TTL_MS: number = 60_000;

  // The answers, by project, person and the project's generation.
  private static answers: InMemoryTTLCache<unknown> =
    new InMemoryTTLCache<unknown>(10_000);

  // Builds under way, by the same key: requests that miss together share one.
  private static inFlight: Map<string, Promise<unknown>> = new Map();

  private static generations: CacheGenerations = new CacheGenerations({
    namespace: "on-duty-policies-generation",
    ttlSeconds: 24 * 60 * 60,
    maxKeys: 10_000,
    description: "the on-call policies people are on duty for",
  });

  /*
   * The person's answer in the project: the one kept in the project's
   * current generation, else one built now by `build` (shared with any
   * other request for it that arrives meanwhile) and kept. A failed build
   * is never kept.
   */
  public static async getOrBuild<T>(data: {
    projectId: ObjectID;
    userId: ObjectID;
    build: () => Promise<T>;
  }): Promise<T> {
    const projectKey: string = data.projectId.toString().toLowerCase();

    const key: string = [
      projectKey,
      data.userId.toString().toLowerCase(),
      await this.generations.get(projectKey),
    ].join("|");

    const kept: unknown = this.answers.get(key);

    if (kept !== undefined) {
      return kept as T;
    }

    const building: Promise<unknown> | undefined = this.inFlight.get(key);

    if (building) {
      return (await building) as T;
    }

    const built: Promise<T> = data.build();
    this.inFlight.set(key, built);

    try {
      const answer: T = await built;

      /*
       * Kept under the generation it was started in: a change made while
       * it was built started a new one, and this answer is never asked
       * for again.
       */
      this.answers.set(key, answer, this.TTL_MS);

      return answer;
    } finally {
      if (this.inFlight.get(key) === built) {
        this.inFlight.delete(key);
      }
    }
  }

  /*
   * Starts a new generation of the projects' answers: built again on the
   * next request, here at once and on every other server within a second.
   * Never throws.
   */
  public static async forgetProjects(
    projectIds: Array<ObjectID | string | null | undefined>,
  ): Promise<void> {
    const keys: Array<string> = projectIds
      .filter((projectId: ObjectID | string | null | undefined): boolean => {
        return Boolean(projectId);
      })
      .map((projectId: ObjectID | string | null | undefined): string => {
        return projectId!.toString().toLowerCase();
      });

    if (keys.length === 0) {
      return;
    }

    await this.generations.bump(keys);
  }

  // Drops everything this process keeps. For tests.
  public static clear(): void {
    this.answers.clear();
    this.inFlight.clear();
    this.generations.clear();
  }
}
