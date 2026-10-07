import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import GlobalOidc from "../../Models/DatabaseModels/GlobalOidc";
import GlobalOidcProject from "../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSso from "../../Models/DatabaseModels/GlobalSso";
import GlobalSsoProject from "../../Models/DatabaseModels/GlobalSsoProject";
import Project from "../../Models/DatabaseModels/Project";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import GlobalConfigService from "../Services/GlobalConfigService";
import GlobalOidcProjectService from "../Services/GlobalOidcProjectService";
import GlobalOidcService from "../Services/GlobalOidcService";
import GlobalSsoProjectService from "../Services/GlobalSsoProjectService";
import GlobalSsoService from "../Services/GlobalSsoService";
import ProjectOidcService from "../Services/ProjectOidcService";
import ProjectService from "../Services/ProjectService";
import ProjectSsoService from "../Services/ProjectSsoService";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";

/*
 * WHO CAN STILL SIGN IN TO A PROJECT THAT REQUIRES SSO, ONCE A CHANGE LANDS.
 *
 * A project that requires SSO - itself, or because the whole server does
 * (UserMiddleware.getUserTenantAccessPermissionWithTenantId) - lets people
 * in only through an SSO provider that signs people in to it:
 *
 *   - one of its own SAML or OIDC providers that is on;
 *   - a global SAML or OIDC provider that is on and reaches it: every
 *     project, unless the provider is restricted to its attached projects
 *     and has attachments, when only the attached projects whose attachment
 *     is on (UserMiddleware.isGlobalSsoTokenAuthorizedForProject);
 *
 * and, when it requires one provider by id (requireSsoWithSsoProviderId),
 * only through that one.
 *
 * Every change that could leave such a project with no way in asks here
 * first, with the change described as what it takes away or asks for:
 *
 *   - a project's own provider turned off or deleted
 *     (ProjectSsoProviderChanges);
 *   - a global provider turned off, deleted or restricted to its attached
 *     projects, or one of its attachments added, turned off, moved or
 *     removed (GlobalSsoProviderChanges);
 *   - Require SSO for Login turned on, or another provider required, for a
 *     project, or Require SSO for Login turned on for the whole server
 *     (SsoRequirementChanges).
 *
 * It answers with the projects the change would leave with no way in. It
 * reads the database, never a cache: the caller holds the locks that keep
 * what it reads true until the change is written (ProjectSsoProviderChanges.
 * lockSignInChange), and keeps them while it reads (keepLocks). A change
 * that only takes something away refuses only what it takes away: a project
 * already left with no way in, or requiring a provider that cannot sign
 * anyone in, by something else is not this change's doing.
 *
 * A change to projects alone asks first whether it can strand one of them
 * whatever the server's sign-in rules are (dependsOnServerRules): only then
 * does it need the lock on those, and this check.
 */

// The projects a global provider signs people in to: every one, or these.
export type SignInReach =
  | { everyProject: true }
  | { everyProject: false; projectIds: Set<string> };

export const REACHES_EVERY_PROJECT: SignInReach = { everyProject: true };

export const REACHES_NO_PROJECT: SignInReach = {
  everyProject: false,
  projectIds: new Set<string>(),
};

export type GlobalSsoProviderType =
  | SsoProviderType.GlobalSSO
  | SsoProviderType.GlobalOIDC;

export type ProjectSsoProviderKind =
  | SsoProviderType.ProjectSSO
  | SsoProviderType.ProjectOIDC;

// A global provider a change narrows, moves or widens: its reach before and after.
export interface GlobalProviderReachChange {
  providerType: GlobalSsoProviderType;
  providerId: string;
  before: SignInReach;
  after: SignInReach;
}

// A project's sign-in rule: whether it requires SSO, and which provider, if one.
export interface ProjectSignInRule {
  requireSsoForLogin: boolean;
  requiredProviderId: string | null;
}

export interface SignInChange {
  /*
   * A project's own providers the change turns off or deletes, each of
   * which was on, by project.
   */
  projectProvidersTakenAway?:
    | Map<string, Array<{ providerType: ProjectSsoProviderKind; id: string }>>
    | undefined;
  // The global providers whose reach the change changes.
  globalProviders?: Array<GlobalProviderReachChange> | undefined;
  /*
   * The projects whose rule the change makes ask for more, each with its
   * rule as the change leaves it.
   */
  projectRules?: Map<string, ProjectSignInRule> | undefined;
  // The change turns on Require SSO for Login for the whole server.
  turnsOnServerRule?: boolean | undefined;
}

export enum StrandReason {
  // It requires one provider, and the change leaves that one unable to sign anyone in to it.
  RequiredProvider = "RequiredProvider",
  // No provider would sign anyone in to it.
  NoProvider = "NoProvider",
}

export interface StrandedProject {
  projectId: string;
  name: string;
  reason: StrandReason;
  // It requires SSO itself; otherwise only because the whole server does.
  requiresSsoItself: boolean;
}

export interface StrandedProjectList {
  // The first few, in the order they were found, for a message to name.
  firstProjects: Array<StrandedProject>;
  // How many there are in all.
  count: number;
}

export interface StrandedProjects extends StrandedProjectList {
  // The same, for each reason: a refusal says what to do about each.
  byReason: Record<StrandReason, StrandedProjectList>;
}

// No project stranded.
export function noStrandedProjects(): StrandedProjects {
  return {
    firstProjects: [],
    count: 0,
    byReason: {
      [StrandReason.RequiredProvider]: { firstProjects: [], count: 0 },
      [StrandReason.NoProvider]: { firstProjects: [], count: 0 },
    },
  };
}

// Counts a stranded project in, naming it while there is room.
function addStrandedProject(
  list: StrandedProjectList,
  project: StrandedProject,
): void {
  list.count++;

  if (list.firstProjects.length < STRANDED_PROJECTS_NAMED) {
    list.firstProjects.push(project);
  }
}

// How many stranded projects a refusal names; the rest are counted.
export const STRANDED_PROJECTS_NAMED: number = 3;

// How many projects are read at a time.
const PROJECT_PAGE_SIZE: number = 500;

interface CandidateProject {
  id: string;
  name: string;
  requireSsoForLogin: boolean;
  requiredProviderId: string | null;
}

interface LoadedGlobalProvider {
  providerType: GlobalSsoProviderType;
  id: string;
  reach: SignInReach;
}

// The lower-case form every id is compared in.
export function toIdString(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const id: string = value.toString().trim().toLowerCase();

  return id ? id : null;
}

// How a provider is named in the ways into a project: by kind and id.
export function wayKey(providerType: SsoProviderType, id: string): string {
  return `${providerType}:${id.toLowerCase()}`;
}

// Whether any way in is the provider with this id, of whatever kind.
function hasProviderId(ways: Set<string>, providerId: string): boolean {
  const suffix: string = `:${providerId.toLowerCase()}`;

  for (const way of ways) {
    if (way.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

export function reaches(reach: SignInReach, projectId: string): boolean {
  return reach.everyProject || reach.projectIds.has(projectId);
}

// Whether a provider that reaches `before` and then `after` stops reaching this project.
export function stopsReaching(
  change: GlobalProviderReachChange,
  projectId: string,
): boolean {
  return reaches(change.before, projectId) && !reaches(change.after, projectId);
}

/*
 * The projects a provider stops reaching: none, these, or every project
 * but these.
 */
export function getLostReach(
  before: SignInReach,
  after: SignInReach,
):
  | { kind: "none" }
  | { kind: "only"; projectIds: Set<string> }
  | { kind: "allExcept"; projectIds: Set<string> } {
  if (after.everyProject) {
    return { kind: "none" };
  }

  if (before.everyProject) {
    return { kind: "allExcept", projectIds: new Set(after.projectIds) };
  }

  const lost: Set<string> = new Set<string>();

  for (const projectId of before.projectIds) {
    if (!after.projectIds.has(projectId)) {
      lost.add(projectId);
    }
  }

  return lost.size > 0 ? { kind: "only", projectIds: lost } : { kind: "none" };
}

/*
 * Where a global provider signs people in to, from its switches and its
 * attachments: nowhere while it is off; every project unless it is
 * restricted to its attached projects and has some; else the attached
 * projects whose attachment is on. An attachment that names no project
 * counts as an attachment and reaches nothing.
 */
export function getGlobalProviderReach(data: {
  isEnabled: boolean;
  restrictToAttachedProjects: boolean;
  attachments: Array<{ projectId: string | null; isEnabled: boolean }>;
}): SignInReach {
  if (!data.isEnabled) {
    return REACHES_NO_PROJECT;
  }

  if (!data.restrictToAttachedProjects || data.attachments.length === 0) {
    return REACHES_EVERY_PROJECT;
  }

  const projectIds: Set<string> = new Set<string>();

  for (const attachment of data.attachments) {
    if (attachment.isEnabled && attachment.projectId) {
      projectIds.add(attachment.projectId);
    }
  }

  return { everyProject: false, projectIds };
}

/*
 * What a project's own rule decides, given what is known about it. Pure:
 * the reads happen in findStrandedProjects.
 */
export function decideStrandReason(data: {
  // The project's rule as the change leaves it.
  rule: ProjectSignInRule;
  // Whether the whole server requires SSO, as the change leaves it.
  serverRequiresSso: boolean;
  // The change makes the project's rule ask for more.
  isTightened: boolean;
  // The providers (wayKey) the change takes away from the project.
  takenAway: Set<string>;
  // The providers (wayKey) that sign people in to it once the change lands.
  waysAfter: () => Set<string>;
}): StrandReason | null {
  if (!data.rule.requireSsoForLogin && !data.serverRequiresSso) {
    return null;
  }

  if (!data.isTightened && data.takenAway.size === 0) {
    return null;
  }

  const requiredProviderId: string | null = data.rule.requiredProviderId;

  if (requiredProviderId) {
    if (data.isTightened) {
      return hasProviderId(data.waysAfter(), requiredProviderId)
        ? null
        : StrandReason.RequiredProvider;
    }

    // Only that provider lets anyone in: the change stops it, or not.
    return hasProviderId(data.takenAway, requiredProviderId)
      ? StrandReason.RequiredProvider
      : null;
  }

  return data.waysAfter().size > 0 ? null : StrandReason.NoProvider;
}

/*
 * The projects a refusal names: "the project \"Acme\"", "the projects
 * \"Acme\" and \"Beta\"", or "12 projects (\"Acme\", \"Beta\", \"Gamma\" and 9
 * more)".
 */
export function describeStrandedProjects(
  stranded: StrandedProjectList,
): string {
  const names: Array<string> = stranded.firstProjects.map(
    (project: StrandedProject): string => {
      return `"${project.name}"`;
    },
  );

  if (stranded.count <= 1) {
    return `the project ${names[0] || ""}`.trim();
  }

  if (stranded.count === names.length) {
    return `the projects ${joinWithAnd(names)}`;
  }

  return `${stranded.count} projects (${names.join(", ")} and ${
    stranded.count - names.length
  } more)`;
}

function joinWithAnd(items: Array<string>): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface FindStrandedProjectsOptions {
  /*
   * Keeps the locks the caller holds (ProjectSsoProviderChanges.
   * keepSignInChange), asked before each page of projects is read: a check
   * that reads every project never outlives them.
   */
  keepLocks?: (() => Promise<void>) | undefined;
}

export default class SsoSignInWays {
  /*
   * The projects that require SSO and that the change would leave with no
   * provider to sign in with: the first few, and how many in all.
   */
  public static async findStrandedProjects(
    change: SignInChange,
    options?: FindStrandedProjectsOptions | undefined,
  ): Promise<StrandedProjects> {
    const takenAwayByProject: Map<
      string,
      Set<string>
    > = SsoSignInWays.getTakenAwayByProject(change);

    const reachChanges: Array<GlobalProviderReachChange> =
      change.globalProviders || [];
    const projectRules: Map<string, ProjectSignInRule> =
      SsoSignInWays.getProjectRules(change);

    const turnsOnServerRule: boolean = Boolean(change.turnsOnServerRule);

    const explicitProjectIds: Set<string> = new Set<string>([
      ...takenAwayByProject.keys(),
      ...projectRules.keys(),
    ]);
    let losesEverywhere: boolean = false;

    for (const reachChange of reachChanges) {
      const lost: ReturnType<typeof getLostReach> = getLostReach(
        reachChange.before,
        reachChange.after,
      );

      if (lost.kind === "only") {
        for (const projectId of lost.projectIds) {
          explicitProjectIds.add(projectId);
        }
      }

      if (lost.kind === "allExcept") {
        losesEverywhere = true;
      }
    }

    const result: StrandedProjects = noStrandedProjects();

    if (
      explicitProjectIds.size === 0 &&
      !losesEverywhere &&
      !turnsOnServerRule
    ) {
      return result;
    }

    const facts: SignInFacts = new SignInFacts({
      reachChanges,
      turnsOnServerRule,
    });

    const seen: Set<string> = new Set<string>();

    // Before each page is read: the caller's locks last another while.
    const keepLocks: () => Promise<void> = async (): Promise<void> => {
      if (options?.keepLocks) {
        await options.keepLocks();
      }
    };

    const evaluate: (
      projects: Array<CandidateProject>,
    ) => Promise<void> = async (
      projects: Array<CandidateProject>,
    ): Promise<void> => {
      const fresh: Array<CandidateProject> = projects.filter(
        (project: CandidateProject): boolean => {
          if (seen.has(project.id)) {
            return false;
          }

          seen.add(project.id);
          return true;
        },
      );

      await SsoSignInWays.evaluateProjects({
        projects: fresh,
        facts,
        takenAwayByProject,
        reachChanges,
        projectRules,
        turnsOnServerRule,
        result,
      });
    };

    const explicitIds: Array<string> = Array.from(explicitProjectIds);

    for (
      let start: number = 0;
      start < explicitIds.length;
      start += PROJECT_PAGE_SIZE
    ) {
      await keepLocks();
      await evaluate(
        await SsoSignInWays.readProjectsById(
          explicitIds.slice(start, start + PROJECT_PAGE_SIZE),
        ),
      );
    }

    if (losesEverywhere) {
      // Every project that requires SSO: itself, or every project when the server does.
      const query: Query<Project> = (await facts.getServerRequiresSso())
        ? {}
        : { requireSsoForLogin: true };

      await SsoSignInWays.forEachPage(query, evaluate, keepLocks);
    }

    if (turnsOnServerRule) {
      // The projects the server's rule now reaches: those that do not require SSO themselves.
      await SsoSignInWays.forEachPage(
        { requireSsoForLogin: false },
        evaluate,
        keepLocks,
      );
    }

    return result;
  }

  /*
   * Whether a change to projects alone - their own providers taken away,
   * or their rules asking for more - could leave one of them with no way in
   * depending on the server's sign-in rules: the global providers and the
   * server's Require SSO for Login, which only the lock on those keeps
   * still (ProjectSsoProviderChanges.lockSignInChange).
   *
   * It cannot when every project it touches keeps one of its own providers
   * on, and the change neither takes away the provider a project requires
   * nor asks for one that is not among those: the project keeps a way in
   * whatever the server's rules are or become, and whatever its own rule
   * says - clearing the provider it requires, or turning Require SSO off,
   * leaves that provider counting. Then the projects' own locks are enough,
   * and no check is needed. A change that touches the global providers or
   * the server's rule always depends on them. Read from the database, like
   * the check.
   */
  public static async dependsOnServerRules(
    change: SignInChange,
  ): Promise<boolean> {
    if ((change.globalProviders || []).length > 0 || change.turnsOnServerRule) {
      return true;
    }

    const takenAwayByProject: Map<
      string,
      Set<string>
    > = SsoSignInWays.getTakenAwayByProject(change);
    const projectRules: Map<string, ProjectSignInRule> =
      SsoSignInWays.getProjectRules(change);

    const projectIds: Array<string> = Array.from(
      new Set<string>([...takenAwayByProject.keys(), ...projectRules.keys()]),
    );

    for (
      let start: number = 0;
      start < projectIds.length;
      start += PROJECT_PAGE_SIZE
    ) {
      const slice: Array<string> = projectIds.slice(
        start,
        start + PROJECT_PAGE_SIZE,
      );

      const [projects, ownWays]: [
        Array<CandidateProject>,
        Map<string, Set<string>>,
      ] = await Promise.all([
        SsoSignInWays.readProjectsById(slice),
        SsoSignInWays.readOwnProvidersOn(slice),
      ]);

      for (const project of projects) {
        const takenAway: Set<string> =
          takenAwayByProject.get(project.id) || new Set<string>();
        const isTightened: boolean = projectRules.has(project.id);
        const rule: ProjectSignInRule = projectRules.get(project.id) || {
          requireSsoForLogin: project.requireSsoForLogin,
          requiredProviderId: project.requiredProviderId,
        };

        const ownWaysAfter: Set<string> = new Set<string>();

        for (const way of ownWays.get(project.id) || []) {
          if (!takenAway.has(way)) {
            ownWaysAfter.add(way);
          }
        }

        if (ownWaysAfter.size === 0) {
          return true;
        }

        const requiredProviderId: string | null = rule.requiredProviderId;

        if (
          requiredProviderId &&
          (hasProviderId(takenAway, requiredProviderId) ||
            (isTightened && !hasProviderId(ownWaysAfter, requiredProviderId)))
        ) {
          return true;
        }
      }
    }

    return false;
  }

  // The providers a change takes away, as ways in (wayKey), by project.
  private static getTakenAwayByProject(
    change: SignInChange,
  ): Map<string, Set<string>> {
    const takenAwayByProject: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const [projectId, providers] of change.projectProvidersTakenAway ||
      new Map()) {
      const keys: Set<string> = new Set<string>();

      for (const provider of providers) {
        keys.add(wayKey(provider.providerType, provider.id));
      }

      if (keys.size > 0) {
        takenAwayByProject.set(projectId.toLowerCase(), keys);
      }
    }

    return takenAwayByProject;
  }

  // The rules a change asks of projects, by project.
  private static getProjectRules(
    change: SignInChange,
  ): Map<string, ProjectSignInRule> {
    const projectRules: Map<string, ProjectSignInRule> = new Map<
      string,
      ProjectSignInRule
    >();

    for (const [projectId, rule] of change.projectRules || new Map()) {
      projectRules.set(projectId.toLowerCase(), rule);
    }

    return projectRules;
  }

  private static async evaluateProjects(data: {
    projects: Array<CandidateProject>;
    facts: SignInFacts;
    takenAwayByProject: Map<string, Set<string>>;
    reachChanges: Array<GlobalProviderReachChange>;
    projectRules: Map<string, ProjectSignInRule>;
    turnsOnServerRule: boolean;
    result: StrandedProjects;
  }): Promise<void> {
    interface Pending {
      project: CandidateProject;
      rule: ProjectSignInRule;
      serverRequiresSso: boolean;
      isTightened: boolean;
      takenAway: Set<string>;
    }

    const pending: Array<Pending> = [];

    for (const project of data.projects) {
      const rule: ProjectSignInRule = data.projectRules.get(project.id) || {
        requireSsoForLogin: project.requireSsoForLogin,
        requiredProviderId: project.requiredProviderId,
      };

      const takenAway: Set<string> = new Set<string>(
        data.takenAwayByProject.get(project.id) || [],
      );

      for (const reachChange of data.reachChanges) {
        if (stopsReaching(reachChange, project.id)) {
          takenAway.add(
            wayKey(reachChange.providerType, reachChange.providerId),
          );
        }
      }

      const isTightened: boolean =
        data.projectRules.has(project.id) ||
        (data.turnsOnServerRule && !project.requireSsoForLogin);

      if (!isTightened && takenAway.size === 0) {
        continue;
      }

      // Read only when the project's own rule does not settle it.
      const serverRequiresSso: boolean = rule.requireSsoForLogin
        ? false
        : await data.facts.getServerRequiresSso();

      if (!rule.requireSsoForLogin && !serverRequiresSso) {
        continue;
      }

      pending.push({
        project,
        rule,
        serverRequiresSso,
        isTightened,
        takenAway,
      });
    }

    if (pending.length === 0) {
      return;
    }

    /*
     * The project's own providers matter unless a global provider that
     * reaches every project settles it: one that requires a provider by id
     * when the change asks for more is checked against all of them.
     */
    const everyProjectIsReached: boolean =
      await data.facts.doesAGlobalProviderReachEveryProject();

    const needOwnWays: Array<string> = pending
      .filter((entry: Pending): boolean => {
        return (
          !everyProjectIsReached ||
          (entry.isTightened && Boolean(entry.rule.requiredProviderId))
        );
      })
      .map((entry: Pending): string => {
        return entry.project.id;
      });

    const ownWays: Map<
      string,
      Set<string>
    > = await SsoSignInWays.readOwnProvidersOn(needOwnWays);

    for (const entry of pending) {
      const reason: StrandReason | null = decideStrandReason({
        rule: entry.rule,
        serverRequiresSso: entry.serverRequiresSso,
        isTightened: entry.isTightened,
        takenAway: entry.takenAway,
        waysAfter: (): Set<string> => {
          const ways: Set<string> = new Set<string>();

          for (const way of ownWays.get(entry.project.id) || []) {
            if (!entry.takenAway.has(way)) {
              ways.add(way);
            }
          }

          for (const way of data.facts.getGlobalWaysAfter(entry.project.id)) {
            ways.add(way);
          }

          return ways;
        },
      });

      if (!reason) {
        continue;
      }

      const stranded: StrandedProject = {
        projectId: entry.project.id,
        name: entry.project.name,
        reason,
        requiresSsoItself: entry.rule.requireSsoForLogin,
      };

      addStrandedProject(data.result, stranded);
      addStrandedProject(data.result.byReason[reason], stranded);
    }
  }

  // Every project the query names, a page at a time, the locks kept before each.
  private static async forEachPage(
    query: Query<Project>,
    evaluate: (projects: Array<CandidateProject>) => Promise<void>,
    keepLocks: () => Promise<void>,
  ): Promise<void> {
    for (let skip: number = 0; ; skip += PROJECT_PAGE_SIZE) {
      await keepLocks();

      const projects: Array<CandidateProject> =
        await SsoSignInWays.readProjects({
          query,
          skip,
          limit: PROJECT_PAGE_SIZE,
        });

      await evaluate(projects);

      if (projects.length < PROJECT_PAGE_SIZE) {
        return;
      }
    }
  }

  /*
   * The projects a change names, by id, in one read (the callers read at
   * most a page of them at a time): a project that is gone is left out.
   */
  private static async readProjectsById(
    projectIds: Array<string>,
  ): Promise<Array<CandidateProject>> {
    if (projectIds.length === 0) {
      return [];
    }

    return await SsoSignInWays.readProjects({
      query: {
        _id: QueryHelper.any(
          projectIds.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      skip: 0,
      limit: projectIds.length,
    });
  }

  private static toCandidate(project: Project): CandidateProject | null {
    const id: string | null = toIdString(project.id);

    if (!id) {
      return null;
    }

    return {
      id: id.toLowerCase(),
      name: project.name || id,
      requireSsoForLogin: project.requireSsoForLogin === true,
      requiredProviderId: toIdString(project.requireSsoWithSsoProviderId),
    };
  }

  private static async readProjects(data: {
    query: Query<Project>;
    skip: number;
    limit: number;
  }): Promise<Array<CandidateProject>> {
    const projects: Array<Project> = await ProjectService.findBy({
      query: data.query,
      select: {
        _id: true,
        name: true,
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      skip: data.skip,
      limit: data.limit,
      props: {
        isRoot: true,
      },
    });

    const candidates: Array<CandidateProject> = [];

    for (const project of projects) {
      const candidate: CandidateProject | null =
        SsoSignInWays.toCandidate(project);

      if (candidate) {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  // The projects' own SAML and OIDC providers that are on, by project.
  private static async readOwnProvidersOn(
    projectIds: Array<string>,
  ): Promise<Map<string, Set<string>>> {
    const ways: Map<string, Set<string>> = new Map<string, Set<string>>();

    if (projectIds.length === 0) {
      return ways;
    }

    const query: Query<BaseModel> = {
      projectId: QueryHelper.any(
        projectIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      ),
      isEnabled: true,
    } as unknown as Query<BaseModel>;

    const [samlRows, oidcRows]: [Array<BaseModel>, Array<BaseModel>] =
      await Promise.all([
        ProjectSsoService.findAllBy({
          query: query as never,
          select: { _id: true, projectId: true },
          props: { isRoot: true },
        }),
        ProjectOidcService.findAllBy({
          query: query as never,
          select: { _id: true, projectId: true },
          props: { isRoot: true },
        }),
      ]);

    const add: (
      providerType: ProjectSsoProviderKind,
      rows: Array<BaseModel>,
    ) => void = (
      providerType: ProjectSsoProviderKind,
      rows: Array<BaseModel>,
    ): void => {
      for (const row of rows) {
        const id: string | null = toIdString(row.id);
        const projectId: string | null = toIdString(
          (row as unknown as Record<string, unknown>)["projectId"],
        );

        if (!id || !projectId) {
          continue;
        }

        const projectWays: Set<string> =
          ways.get(projectId) || new Set<string>();
        projectWays.add(wayKey(providerType, id));
        ways.set(projectId, projectWays);
      }
    };

    add(SsoProviderType.ProjectSSO, samlRows);
    add(SsoProviderType.ProjectOIDC, oidcRows);

    return ways;
  }
}

/*
 * What a check reads once, when it first needs it: the server's rule and
 * the global providers that are on, with where each reaches once the
 * change lands.
 */
class SignInFacts {
  private readonly reachChanges: Array<GlobalProviderReachChange>;
  private readonly turnsOnServerRule: boolean;
  private serverRequiresSso: Promise<boolean> | null = null;
  private globalProviders: Array<LoadedGlobalProvider> | null = null;
  private globalProvidersLoading: Promise<Array<LoadedGlobalProvider>> | null =
    null;

  public constructor(data: {
    reachChanges: Array<GlobalProviderReachChange>;
    turnsOnServerRule: boolean;
  }) {
    this.reachChanges = data.reachChanges;
    this.turnsOnServerRule = data.turnsOnServerRule;
  }

  // Whether the whole server requires SSO, as the change leaves it.
  public getServerRequiresSso(): Promise<boolean> {
    if (this.turnsOnServerRule) {
      return Promise.resolve(true);
    }

    if (!this.serverRequiresSso) {
      this.serverRequiresSso = GlobalConfigService.findOneBy({
        query: {},
        select: {
          requireSsoForLogin: true,
        },
        props: {
          isRoot: true,
        },
      }).then((config: GlobalConfig | null): boolean => {
        return Boolean(config?.requireSsoForLogin);
      });
    }

    return this.serverRequiresSso;
  }

  // Whether, once the change lands, a global provider reaches every project.
  public async doesAGlobalProviderReachEveryProject(): Promise<boolean> {
    for (const provider of await this.loadGlobalProviders()) {
      if (provider.reach.everyProject) {
        return true;
      }
    }

    return false;
  }

  // The global providers (wayKey) that reach the project once the change lands.
  public getGlobalWaysAfter(projectId: string): Array<string> {
    const ways: Array<string> = [];

    for (const provider of this.globalProviders || []) {
      if (reaches(provider.reach, projectId)) {
        ways.push(wayKey(provider.providerType, provider.id));
      }
    }

    return ways;
  }

  private loadGlobalProviders(): Promise<Array<LoadedGlobalProvider>> {
    if (this.globalProviders) {
      return Promise.resolve(this.globalProviders);
    }

    if (!this.globalProvidersLoading) {
      this.globalProvidersLoading = this.readGlobalProviders().then(
        (providers: Array<LoadedGlobalProvider>) => {
          this.globalProviders = providers;
          return providers;
        },
      );
    }

    return this.globalProvidersLoading;
  }

  /*
   * The global providers that are on, read from the database, each with
   * where it reaches once the change lands: the change's own word for the
   * providers it changes, the attachments as they are for the rest.
   */
  private async readGlobalProviders(): Promise<Array<LoadedGlobalProvider>> {
    const [samlProviders, oidcProviders]: [
      Array<GlobalSso>,
      Array<GlobalOidc>,
    ] = await Promise.all([
      GlobalSsoService.findBy({
        query: { isEnabled: true },
        select: { _id: true, restrictToAttachedProjects: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      GlobalOidcService.findBy({
        query: { isEnabled: true },
        select: { _id: true, restrictToAttachedProjects: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const providers: Array<LoadedGlobalProvider> = [];

    const changed: Map<string, GlobalProviderReachChange> = new Map<
      string,
      GlobalProviderReachChange
    >();

    for (const reachChange of this.reachChanges) {
      changed.set(
        wayKey(reachChange.providerType, reachChange.providerId),
        reachChange,
      );
    }

    const restrictedSaml: Array<string> = [];
    const restrictedOidc: Array<string> = [];

    const collect: (
      providerType: GlobalSsoProviderType,
      rows: Array<GlobalSso | GlobalOidc>,
      restricted: Array<string>,
    ) => void = (
      providerType: GlobalSsoProviderType,
      rows: Array<GlobalSso | GlobalOidc>,
      restricted: Array<string>,
    ): void => {
      for (const row of rows) {
        const id: string | null = toIdString(row.id);

        if (!id || changed.has(wayKey(providerType, id))) {
          continue;
        }

        if (row.restrictToAttachedProjects) {
          restricted.push(id);
          continue;
        }

        providers.push({
          providerType,
          id,
          reach: REACHES_EVERY_PROJECT,
        });
      }
    };

    collect(SsoProviderType.GlobalSSO, samlProviders, restrictedSaml);
    collect(SsoProviderType.GlobalOIDC, oidcProviders, restrictedOidc);

    for (const [providerType, ids] of [
      [SsoProviderType.GlobalSSO, restrictedSaml],
      [SsoProviderType.GlobalOIDC, restrictedOidc],
    ] as Array<[GlobalSsoProviderType, Array<string>]>) {
      const attachments: Map<
        string,
        Array<{ projectId: string | null; isEnabled: boolean }>
      > = await GlobalProviderAttachmentRows.read({ providerType, ids });

      for (const id of ids) {
        providers.push({
          providerType,
          id,
          reach: getGlobalProviderReach({
            isEnabled: true,
            restrictToAttachedProjects: true,
            attachments: attachments.get(id) || [],
          }),
        });
      }
    }

    // The providers the change changes, where they reach once it lands.
    for (const reachChange of this.reachChanges) {
      providers.push({
        providerType: reachChange.providerType,
        id: reachChange.providerId.toLowerCase(),
        reach: reachChange.after,
      });
    }

    return providers;
  }
}

/*
 * The attachment rows of global providers, read from the database: every
 * row, on or off, so a provider whose attachments are all off still counts
 * as one that has attachments (doAttachmentsGovernProject).
 */
export class GlobalProviderAttachmentRows {
  public static async read(data: {
    providerType: GlobalSsoProviderType;
    ids: Array<string>;
  }): Promise<
    Map<
      string,
      Array<{ id: string; projectId: string | null; isEnabled: boolean }>
    >
  > {
    const byProvider: Map<
      string,
      Array<{ id: string; projectId: string | null; isEnabled: boolean }>
    > = new Map();

    if (data.ids.length === 0) {
      return byProvider;
    }

    const providerIds: Array<ObjectID> = data.ids.map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    const rows: Array<GlobalSsoProject | GlobalOidcProject> =
      data.providerType === SsoProviderType.GlobalSSO
        ? await GlobalSsoProjectService.findAllBy({
            query: { globalSsoId: QueryHelper.any(providerIds) },
            select: {
              _id: true,
              globalSsoId: true,
              projectId: true,
              isEnabled: true,
            },
            props: { isRoot: true },
          })
        : await GlobalOidcProjectService.findAllBy({
            query: { globalOidcId: QueryHelper.any(providerIds) },
            select: {
              _id: true,
              globalOidcId: true,
              projectId: true,
              isEnabled: true,
            },
            props: { isRoot: true },
          });

    for (const row of rows) {
      const record: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      const providerId: string | null = toIdString(
        record["globalSsoId"] || record["globalOidcId"],
      );
      const id: string | null = toIdString(row.id);

      if (!providerId || !id) {
        continue;
      }

      const list: Array<{
        id: string;
        projectId: string | null;
        isEnabled: boolean;
      }> = byProvider.get(providerId) || [];

      list.push({
        id,
        projectId: toIdString(record["projectId"]),
        isEnabled: record["isEnabled"] === true,
      });

      byProvider.set(providerId, list);
    }

    return byProvider;
  }
}
