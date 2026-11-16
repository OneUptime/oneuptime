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
 * My On-Call Policies asks across every project the person may open
 * (getOrBuildMany): the projects whose answers are kept are answered from
 * here, and the rest are built together, by one build that reads them all
 * at once (#8124) - and kept one by one, as a project's own request keeps
 * it. A project's request and a request across projects that miss together
 * share the build.
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
    const projectKey: string = this.projectKeyOf(data.projectId);

    const answers: Map<string, T> = await this.getOrBuildMany<T>({
      projectIds: [data.projectId],
      userId: data.userId,
      build: async (): Promise<Map<string, T>> => {
        return new Map<string, T>([[projectKey, await data.build()]]);
      },
    });

    return answers.get(projectKey) as T;
  }

  /*
   * The person's answer in each of the projects, by lower-cased project id:
   * each kept in its project's current generation, else built now. The
   * projects with nothing kept and nothing under way are handed to one call
   * of `build`, which answers every project it is handed, keyed the same
   * way; a project another request is building meanwhile is waited for.
   * Each answer is kept on its own, under its project's generation, as
   * getOrBuild keeps it. A failed build is never kept, and fails the call.
   */
  public static async getOrBuildMany<T>(data: {
    projectIds: Array<ObjectID>;
    userId: ObjectID;
    build: (projectIds: Array<ObjectID>) => Promise<Map<string, T>>;
  }): Promise<Map<string, T>> {
    const userKey: string = data.userId.toString().toLowerCase();

    // Each project once, however it is written.
    const projects: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const projectId of data.projectIds) {
      projects.set(this.projectKeyOf(projectId), projectId);
    }

    // Each project's key under its generation now, read side by side.
    const keys: Map<string, string> = new Map<string, string>();

    await Promise.all(
      Array.from(projects.keys()).map(
        async (projectKey: string): Promise<void> => {
          keys.set(
            projectKey,
            [projectKey, userKey, await this.generations.get(projectKey)].join(
              "|",
            ),
          );
        },
      ),
    );

    const answers: Map<string, T> = new Map<string, T>();
    const waits: Array<Promise<void>> = [];
    const missing: Array<string> = [];

    for (const projectKey of projects.keys()) {
      const key: string = keys.get(projectKey)!;
      const kept: unknown = this.answers.get(key);

      if (kept !== undefined) {
        answers.set(projectKey, kept as T);
        continue;
      }

      const building: Promise<unknown> | undefined = this.inFlight.get(key);

      if (building) {
        waits.push(
          building.then((answer: unknown): void => {
            answers.set(projectKey, answer as T);
          }),
        );
        continue;
      }

      missing.push(projectKey);
    }

    if (missing.length > 0) {
      waits.push(
        this.buildTogether<T>({
          missing,
          projects,
          keys,
          answers,
          build: data.build,
        }),
      );
    }

    await Promise.all(waits);

    // In the order the projects were asked for.
    const ordered: Map<string, T> = new Map<string, T>();

    for (const projectKey of projects.keys()) {
      ordered.set(projectKey, answers.get(projectKey) as T);
    }

    return ordered;
  }

  /*
   * One build for the projects nothing kept or built: each project's part of
   * it is what another request asking for that project meanwhile waits for.
   */
  private static async buildTogether<T>(data: {
    missing: Array<string>;
    projects: Map<string, ObjectID>;
    keys: Map<string, string>;
    answers: Map<string, T>;
    build: (projectIds: Array<ObjectID>) => Promise<Map<string, T>>;
  }): Promise<void> {
    const built: Promise<Map<string, T>> = data.build(
      data.missing.map((projectKey: string): ObjectID => {
        return data.projects.get(projectKey)!;
      }),
    );

    const parts: Map<string, Promise<T>> = new Map<string, Promise<T>>();

    for (const projectKey of data.missing) {
      const part: Promise<T> = built.then((answers: Map<string, T>): T => {
        if (!answers.has(projectKey)) {
          throw new Error(
            "The on-call policies someone is on duty for were not built for every project asked for.",
          );
        }

        return answers.get(projectKey) as T;
      });

      // Its failure is the build's, which this call throws; nobody else need catch it.
      part.catch((): void => {
        return undefined;
      });

      parts.set(projectKey, part);
      this.inFlight.set(data.keys.get(projectKey)!, part);
    }

    try {
      for (const projectKey of data.missing) {
        const answer: T = await parts.get(projectKey)!;

        /*
         * Kept under the generation it was started in: a change made while
         * it was built started a new one, and this answer is never asked
         * for again.
         */
        this.answers.set(data.keys.get(projectKey)!, answer, this.TTL_MS);
        data.answers.set(projectKey, answer);
      }
    } finally {
      for (const projectKey of data.missing) {
        const key: string = data.keys.get(projectKey)!;

        if (this.inFlight.get(key) === parts.get(projectKey)) {
          this.inFlight.delete(key);
        }
      }
    }
  }

  private static projectKeyOf(projectId: ObjectID): string {
    return projectId.toString().toLowerCase();
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
