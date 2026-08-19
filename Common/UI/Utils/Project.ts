import { BILLING_ENABLED, getAllEnvVars } from "../Config";
import LocalStorage from "./LocalStorage";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../Types/Billing/SubscriptionStatus";
import ModelListCache from "./ModelListCache";
import Navigation from "./Navigation";
import SessionStorage from "./SessionStorage";
import Telemetry from "./Telemetry/Telemetry";

/**
 * Session storage key that pins a browser tab to the project it is showing.
 * Session storage (and not local storage) so two tabs can show two different
 * projects at the same time.
 */
export const CURRENT_PROJECT_ID_STORAGE_KEY: string = "current_project_id";

/**
 * Local storage key that remembers the last project the user opened on this
 * browser. Unlike {@link CURRENT_PROJECT_ID_STORAGE_KEY} this survives closing
 * the tab, which is what makes the dashboard reopen on the project the user
 * left off on instead of always falling back to the first project.
 */
export const LAST_ACCESSED_PROJECT_ID_STORAGE_KEY: string =
  "last_accessed_project_id";

export default class ProjectUtil {
  /**
   * The project the user is currently looking at, resolved in priority order:
   *
   * 1. `/dashboard/:projectId/...` in the URL - the page the user actually
   *    opened, so a deep link always wins over anything we have cached.
   * 2. `current_project_id` in session storage - keeps this tab on the project
   *    it was already showing while the user moves around routes that do not
   *    carry a project id (e.g. `/dashboard`).
   * 3. `last_accessed_project_id` in local storage - the project this user last
   *    opened on this browser, so closing the tab and coming back to
   *    `/dashboard` reopens that project rather than the first one.
   */
  public static getCurrentProjectId(): ObjectID | null {
    const projectIdInUrl: ObjectID | null = this.getProjectIdFromUrl();

    if (projectIdInUrl) {
      return projectIdInUrl;
    }

    const projectIdInSession: ObjectID | null = this.toProjectId(
      SessionStorage.getItem(CURRENT_PROJECT_ID_STORAGE_KEY),
    );

    if (projectIdInSession) {
      return projectIdInSession;
    }

    return this.getLastAccessedProjectId();
  }

  /**
   * The project id in the current URL, if the user is on a project scoped route
   * like `/dashboard/:projectId/...`. Returns null on routes that carry no
   * project id (`/dashboard`, `/dashboard/welcome`, ...).
   */
  public static getProjectIdFromUrl(): ObjectID | null {
    if (Navigation.getFirstParam(1) !== "dashboard") {
      return null;
    }

    const projectId: string | undefined = Navigation.getFirstParam(2);

    if (!projectId || projectId.includes(":projectId")) {
      return null;
    }

    return this.toProjectId(projectId);
  }

  /**
   * The last project this user opened on this browser. Persisted in local
   * storage so it outlives the tab. It is cleared on logout (which clears all
   * of local storage) and when the project is deleted.
   */
  public static getLastAccessedProjectId(): ObjectID | null {
    return this.toProjectId(
      LocalStorage.getItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY),
    );
  }

  public static setLastAccessedProjectId(
    projectId: ObjectID | string | null | undefined,
  ): void {
    const id: ObjectID | null = this.toProjectId(projectId);

    if (!id) {
      // Never persist junk - an unusable value would only shadow the fallbacks.
      this.clearLastAccessedProjectId();
      return;
    }

    LocalStorage.setItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY, id.toString());
  }

  public static clearLastAccessedProjectId(): void {
    LocalStorage.removeItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY);
  }

  /**
   * Picks the project the dashboard should load out of the projects the user
   * has access to.
   *
   * Candidates are tried in order - current project (URL / this tab), then the
   * last project opened on this browser, then the first project the user has
   * access to. A candidate that is not in `projects` is skipped, because the
   * user may have left, lost access to, or deleted it since.
   */
  public static getProjectToSelect(data: {
    projects: Array<Project>;
    currentProjectId?: ObjectID | null | undefined;
    lastAccessedProjectId?: ObjectID | null | undefined;
  }): Project | null {
    const projects: Array<Project> = this.getSelectableProjects(data.projects);

    const candidateIds: Array<ObjectID | null | undefined> = [
      data.currentProjectId,
      data.lastAccessedProjectId,
    ];

    for (const candidateId of candidateIds) {
      if (!candidateId) {
        continue;
      }

      const project: Project | undefined = projects.find((project: Project) => {
        return project._id?.toString() === candidateId.toString();
      });

      if (project) {
        return project;
      }
    }

    return projects[0] || null;
  }

  /**
   * {@link getProjectToSelect} with the candidates read off storage / the URL.
   */
  public static getProjectToLoad(projects: Array<Project>): Project | null {
    return this.getProjectToSelect({
      projects: projects,
      currentProjectId: this.getCurrentProjectId(),
      lastAccessedProjectId: this.getLastAccessedProjectId(),
    });
  }

  /**
   * The project the dashboard should switch to now that the list of projects
   * the user has access to has (re)loaded, or null when whatever is already
   * selected should stand.
   *
   * A selection is left alone as long as the user still has access to it -
   * otherwise a project the user just picked (or just created) would be
   * overruled by whatever we happened to have remembered.
   */
  public static getProjectToSelectOnProjectsLoaded(data: {
    projects: Array<Project>;
    selectedProject?: Project | null | undefined;
  }): Project | null {
    const projects: Array<Project> = this.getSelectableProjects(data.projects);

    if (projects.length === 0) {
      // Nothing to select yet - the list is still loading, or the user has no projects.
      return null;
    }

    const selectedProjectId: string | undefined =
      data.selectedProject?._id?.toString();

    const isSelectionStillAccessible: boolean = Boolean(
      selectedProjectId &&
        projects.some((project: Project) => {
          return project._id?.toString() === selectedProjectId;
        }),
    );

    if (isSelectionStillAccessible) {
      return null;
    }

    return this.getProjectToLoad(projects);
  }

  /**
   * The projects that can actually be opened - a project without an id cannot
   * be navigated to (`/dashboard/undefined`), so it is never a candidate.
   */
  private static getSelectableProjects(
    projects: Array<Project> | null | undefined,
  ): Array<Project> {
    return (projects || []).filter((project: Project) => {
      return Boolean(project?._id);
    });
  }

  public static setIsSubscriptionInactiveOrOverdue(data: {
    paymentProviderMeteredSubscriptionStatus: SubscriptionStatus;
    paymentProviderSubscriptionStatus: SubscriptionStatus;
  }): boolean {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();

    const isSubscriptionInactive: boolean =
      SubscriptionStatusUtil.isSubscriptionInactive(
        data.paymentProviderMeteredSubscriptionStatus,
      ) ||
      SubscriptionStatusUtil.isSubscriptionInactive(
        data.paymentProviderSubscriptionStatus,
      );

    const isSubscriptionOverdue: boolean =
      SubscriptionStatusUtil.isSubscriptionOverdue(
        data.paymentProviderMeteredSubscriptionStatus,
      ) ||
      SubscriptionStatusUtil.isSubscriptionOverdue(
        data.paymentProviderSubscriptionStatus,
      );

    // save this to local storage
    LocalStorage.setItem(
      currentProjectId?.toString() + "_isSubscriptionInactive",
      isSubscriptionInactive,
    );

    LocalStorage.setItem(
      currentProjectId?.toString() + "_isSubscriptionOverdue",
      isSubscriptionOverdue,
    );

    return isSubscriptionInactive || isSubscriptionOverdue;
  }

  public static isSubscriptionInactive(): boolean {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();
    return (
      Boolean(
        LocalStorage.getItem(
          currentProjectId?.toString() + "_isSubscriptionInactive",
        ),
      ) || false
    );
  }

  public static getCurrentProject(): Project | null {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();

    if (!currentProjectId) {
      return null;
    }

    const projectJson: JSONObject = LocalStorage.getItem(
      `project_${currentProjectId}`,
    ) as JSONObject;

    if (!projectJson) {
      return null;
    }

    return BaseModel.fromJSON(projectJson, Project) as Project;
  }

  public static setCurrentProject(project: JSONObject | Project): void {
    const currentProjectId: string | undefined =
      project._id?.toString() || this.getCurrentProjectId()?.toString();
    if (project instanceof Project) {
      project = BaseModel.toJSON(project, Project);
    }
    LocalStorage.setItem(`project_${currentProjectId}`, project);
    SessionStorage.setItem(CURRENT_PROJECT_ID_STORAGE_KEY, currentProjectId);

    /*
     * Cached reference lists (incident/alert states, custom fields...) are
     * keyed by project id, so a switch could never serve another project's
     * rows — this just guarantees fresh reads and frees the old entries now
     * that project selection can happen without a full page reload.
     */
    ModelListCache.invalidateAll();

    // Remember this project for the next time the user opens the dashboard.
    this.setLastAccessedProjectId(currentProjectId);

    // Keep RUM span context in sync with the project being viewed.
    if (currentProjectId) {
      Telemetry.setGlobalAttributes({ projectId: currentProjectId });
    }
  }

  public static clearCurrentProject(): void {
    const currentProjectId: string | undefined =
      this.getCurrentProjectId()?.toString();

    if (currentProjectId) {
      LocalStorage.removeItem(`project_${currentProjectId}`);
    }

    SessionStorage.removeItem(CURRENT_PROJECT_ID_STORAGE_KEY);

    // Project-scoped cached reference lists must not outlive the project.
    ModelListCache.invalidateAll();

    /*
     * The project is gone (or the user is leaving it), so it must not be
     * reopened the next time the dashboard loads.
     */
    this.clearLastAccessedProjectId();
  }

  public static getCurrentPlan(): PlanType | null {
    if (!BILLING_ENABLED) {
      return null;
    }

    const project: Project | null = this.getCurrentProject();
    if (!project || !project.paymentProviderPlanId) {
      return null;
    }

    return SubscriptionPlan.getPlanType(
      project.paymentProviderPlanId,
      getAllEnvVars(),
    );
  }

  private static toProjectId(
    value: JSONValue | ObjectID | string | null | undefined,
  ): ObjectID | null {
    const id: string | undefined = value?.toString();

    if (id && ObjectID.isValidUUID(id)) {
      return new ObjectID(id);
    }

    return null;
  }
}
