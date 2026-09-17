import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ProjectUtil, {
  CURRENT_PROJECT_ID_STORAGE_KEY,
  LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
} from "../../../UI/Utils/Project";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";

/*
 * A user who belongs to more than one project expects the dashboard to reopen
 * on the project they were last working in. Before this was fixed, the only
 * record of "the project I'm on" lived in SESSION storage, which the browser
 * throws away when the tab closes - so every fresh visit to /dashboard silently
 * dropped the user into whichever project happened to sort first in the list.
 *
 * These tests pin down the resolution order that fixes that:
 *
 *   URL  >  this tab's session  >  last project opened on this browser  >  first
 *
 * and the invariant that makes it safe: a remembered project is only honoured
 * while the user still has access to it.
 */

const PROJECT_X_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_Y_ID: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_Z_ID: string = "33333333-3333-4333-8333-333333333333";

type BuildProjectFunction = (id: string, name: string) => Project;

const buildProject: BuildProjectFunction = (
  id: string,
  name: string,
): Project => {
  const project: Project = new Project();
  project._id = id;
  project.name = name;
  return project;
};

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

/**
 * What the browser does when the user closes the tab (or opens the dashboard in
 * a brand new one): session storage is gone, local storage survives.
 */
type CloseTheTabFunction = () => void;

const closeTheTab: CloseTheTabFunction = (): void => {
  window.sessionStorage.clear();
  setUrl("/dashboard");
};

describe("ProjectUtil", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setUrl("/dashboard");
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  describe("the reported bug: reopening the dashboard", () => {
    test("reopens the project the user was last in, not the first project", () => {
      const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
      const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");
      const projectZ: Project = buildProject(PROJECT_Z_ID, "Project Z");

      // The user is working in Project Y.
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(projectY);

      // ... and closes the dashboard, then comes back to /dashboard.
      closeTheTab();

      const projectToLoad: Project | null = ProjectUtil.getProjectToLoad([
        projectX,
        projectY,
        projectZ,
      ]);

      expect(projectToLoad?._id).toBe(PROJECT_Y_ID);
      expect(projectToLoad?.name).toBe("Project Y");
    });

    test("keeps reopening the same project across repeated visits", () => {
      const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
      const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");
      const projects: Array<Project> = [projectX, projectY];

      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(projectY);

      for (let visit: number = 0; visit < 3; visit++) {
        closeTheTab();
        expect(ProjectUtil.getProjectToLoad(projects)?._id).toBe(PROJECT_Y_ID);
      }
    });

    test("switching projects updates what gets reopened", () => {
      const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
      const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");
      const projects: Array<Project> = [projectX, projectY];

      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(projectY);

      // The user now switches to Project X.
      setUrl(`/dashboard/${PROJECT_X_ID}/home`);
      ProjectUtil.setCurrentProject(projectX);

      closeTheTab();

      expect(ProjectUtil.getProjectToLoad(projects)?._id).toBe(PROJECT_X_ID);
    });

    test("falls back to the first project when the remembered one is gone", () => {
      const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
      const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");

      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(projectY);

      closeTheTab();

      // The user has since been removed from Project Y.
      expect(ProjectUtil.getProjectToLoad([projectX])?._id).toBe(PROJECT_X_ID);
    });

    test("a user with a single project is unaffected", () => {
      const projectX: Project = buildProject(PROJECT_X_ID, "Project X");

      closeTheTab();

      expect(ProjectUtil.getProjectToLoad([projectX])?._id).toBe(PROJECT_X_ID);
    });
  });

  describe("getProjectIdFromUrl", () => {
    test("reads the project id off a project scoped route", () => {
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);

      expect(ProjectUtil.getProjectIdFromUrl()?.toString()).toBe(PROJECT_Y_ID);
    });

    test("reads the project id off a deeply nested route", () => {
      setUrl(
        `/dashboard/${PROJECT_Y_ID}/monitors/44444444-4444-4444-4444-444444444444/criteria`,
      );

      expect(ProjectUtil.getProjectIdFromUrl()?.toString()).toBe(PROJECT_Y_ID);
    });

    test("survives a query string and a hash", () => {
      setUrl(`/dashboard/${PROJECT_Y_ID}/logs?query=error#tail`);

      expect(ProjectUtil.getProjectIdFromUrl()?.toString()).toBe(PROJECT_Y_ID);
    });

    test("returns null on routes that carry no project id", () => {
      setUrl("/dashboard");
      expect(ProjectUtil.getProjectIdFromUrl()).toBeNull();

      setUrl("/dashboard/");
      expect(ProjectUtil.getProjectIdFromUrl()).toBeNull();

      setUrl("/dashboard/welcome");
      expect(ProjectUtil.getProjectIdFromUrl()).toBeNull();
    });

    test("returns null for an unpopulated route template", () => {
      setUrl("/dashboard/:projectId/home");

      expect(ProjectUtil.getProjectIdFromUrl()).toBeNull();
    });

    test("returns null when the segment is not a uuid", () => {
      setUrl("/dashboard/not-a-uuid/home");

      expect(ProjectUtil.getProjectIdFromUrl()).toBeNull();
    });

    test.each([
      ["the overview", `/status-page/${PROJECT_Y_ID}`],
      [
        "a nested subscribe page",
        `/status-page/${PROJECT_Y_ID}/subscribe/email`,
      ],
    ])(
      "does not mistake a status-page id for a project id on %s",
      (_description: string, url: string) => {
        setUrl(url);

        expect(ProjectUtil.getProjectIdFromUrl()).toBeNull();
      },
    );
  });

  describe("getCurrentProjectId precedence", () => {
    test("the URL wins over everything else", () => {
      window.sessionStorage.setItem(
        CURRENT_PROJECT_ID_STORAGE_KEY,
        PROJECT_X_ID,
      );
      window.localStorage.setItem(
        LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
        PROJECT_Z_ID,
      );
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);

      expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(PROJECT_Y_ID);
    });

    test("this tab's session wins when the route has no project id", () => {
      window.sessionStorage.setItem(
        CURRENT_PROJECT_ID_STORAGE_KEY,
        PROJECT_X_ID,
      );
      window.localStorage.setItem(
        LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
        PROJECT_Z_ID,
      );
      setUrl("/dashboard");

      expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(PROJECT_X_ID);
    });

    test("the last accessed project is used once the session is gone", () => {
      window.localStorage.setItem(
        LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
        PROJECT_Z_ID,
      );
      setUrl("/dashboard");

      expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(PROJECT_Z_ID);
    });

    test("returns null when nothing is known", () => {
      expect(ProjectUtil.getCurrentProjectId()).toBeNull();
    });

    test("ignores a corrupt session value and falls through", () => {
      window.sessionStorage.setItem(
        CURRENT_PROJECT_ID_STORAGE_KEY,
        "not-a-uuid",
      );
      window.localStorage.setItem(
        LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
        PROJECT_Z_ID,
      );

      expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(PROJECT_Z_ID);
    });

    test("ignores a corrupt last accessed value", () => {
      window.localStorage.setItem(
        LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
        "not-a-uuid",
      );

      expect(ProjectUtil.getCurrentProjectId()).toBeNull();
    });

    test("a second tab on another project does not disturb the first", () => {
      /*
       * Session storage is per tab, so tab 1 stays on X even though the last
       * project opened on this browser is Z.
       */
      window.localStorage.setItem(
        LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
        PROJECT_Z_ID,
      );
      window.sessionStorage.setItem(
        CURRENT_PROJECT_ID_STORAGE_KEY,
        PROJECT_X_ID,
      );

      expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(PROJECT_X_ID);
    });

    test("a deep link into another project is not hijacked by a stale session", () => {
      // The classic case: an alert email opened in a tab already on Project X.
      window.sessionStorage.setItem(
        CURRENT_PROJECT_ID_STORAGE_KEY,
        PROJECT_X_ID,
      );
      setUrl(`/dashboard/${PROJECT_Y_ID}/alerts`);

      expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(PROJECT_Y_ID);
    });

    test("a status-page preview does not override this tab's dashboard project", () => {
      window.sessionStorage.setItem(
        CURRENT_PROJECT_ID_STORAGE_KEY,
        PROJECT_X_ID,
      );
      setUrl(`/status-page/${PROJECT_Y_ID}/subscribe/email`);

      expect(ProjectUtil.getCurrentProjectId()?.toString()).toBe(PROJECT_X_ID);
    });

    test("a status-page preview is not project-scoped when no project is stored", () => {
      setUrl(`/status-page/${PROJECT_Y_ID}/subscribe/email`);

      expect(ProjectUtil.getCurrentProjectId()).toBeNull();
    });
  });

  describe("last accessed project id", () => {
    test("round trips an ObjectID", () => {
      ProjectUtil.setLastAccessedProjectId(new ObjectID(PROJECT_Y_ID));

      expect(ProjectUtil.getLastAccessedProjectId()?.toString()).toBe(
        PROJECT_Y_ID,
      );
    });

    test("round trips a string", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      expect(ProjectUtil.getLastAccessedProjectId()?.toString()).toBe(
        PROJECT_Y_ID,
      );
    });

    test("is persisted in local storage so it outlives the tab", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      expect(
        window.localStorage.getItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY),
      ).toBe(PROJECT_Y_ID);

      window.sessionStorage.clear();

      expect(ProjectUtil.getLastAccessedProjectId()?.toString()).toBe(
        PROJECT_Y_ID,
      );
    });

    test("returns null when nothing was ever stored", () => {
      expect(ProjectUtil.getLastAccessedProjectId()).toBeNull();
    });

    test.each([
      ["null", null],
      ["undefined", undefined],
      ["an empty string", ""],
      ["a non-uuid", "not-a-uuid"],
      ["an unpopulated route param", ":projectId"],
    ])("clears rather than persisting %s", (_label: string, value: unknown) => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      ProjectUtil.setLastAccessedProjectId(
        value as ObjectID | string | null | undefined,
      );

      expect(ProjectUtil.getLastAccessedProjectId()).toBeNull();
      expect(
        window.localStorage.getItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY),
      ).toBeNull();
    });

    test("clearLastAccessedProjectId removes the key", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      ProjectUtil.clearLastAccessedProjectId();

      expect(ProjectUtil.getLastAccessedProjectId()).toBeNull();
      expect(
        window.localStorage.getItem(LAST_ACCESSED_PROJECT_ID_STORAGE_KEY),
      ).toBeNull();
    });

    test("clearing it is safe when nothing was stored", () => {
      expect(() => {
        return ProjectUtil.clearLastAccessedProjectId();
      }).not.toThrow();
      expect(ProjectUtil.getLastAccessedProjectId()).toBeNull();
    });
  });

  describe("setCurrentProject", () => {
    test("records the project as both current and last accessed", () => {
      ProjectUtil.setCurrentProject(buildProject(PROJECT_Y_ID, "Project Y"));

      expect(
        window.sessionStorage.getItem(CURRENT_PROJECT_ID_STORAGE_KEY),
      ).toBe(PROJECT_Y_ID);
      expect(ProjectUtil.getLastAccessedProjectId()?.toString()).toBe(
        PROJECT_Y_ID,
      );
    });

    test("accepts a plain JSON project", () => {
      ProjectUtil.setCurrentProject({
        _id: PROJECT_Y_ID,
        name: "Project Y",
      });

      expect(ProjectUtil.getLastAccessedProjectId()?.toString()).toBe(
        PROJECT_Y_ID,
      );
      expect(ProjectUtil.getCurrentProject()?._id).toBe(PROJECT_Y_ID);
    });

    test("caches the project so it can be read back", () => {
      ProjectUtil.setCurrentProject(buildProject(PROJECT_Y_ID, "Project Y"));

      const currentProject: Project | null = ProjectUtil.getCurrentProject();

      expect(currentProject).toBeInstanceOf(Project);
      expect(currentProject?._id).toBe(PROJECT_Y_ID);
      expect(currentProject?.name).toBe("Project Y");
    });

    test("the cached project is still readable after the tab is closed", () => {
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(buildProject(PROJECT_Y_ID, "Project Y"));

      closeTheTab();

      expect(ProjectUtil.getCurrentProject()?._id).toBe(PROJECT_Y_ID);
    });

    test("does not clobber the remembered project when the payload has no id", () => {
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);

      ProjectUtil.setCurrentProject({ name: "Project Y" });

      expect(ProjectUtil.getLastAccessedProjectId()?.toString()).toBe(
        PROJECT_Y_ID,
      );
    });

    test("switching projects overwrites the previous one", () => {
      ProjectUtil.setCurrentProject(buildProject(PROJECT_Y_ID, "Project Y"));
      ProjectUtil.setCurrentProject(buildProject(PROJECT_X_ID, "Project X"));

      expect(ProjectUtil.getLastAccessedProjectId()?.toString()).toBe(
        PROJECT_X_ID,
      );
    });
  });

  describe("clearCurrentProject", () => {
    test("forgets the project everywhere", () => {
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(buildProject(PROJECT_Y_ID, "Project Y"));

      setUrl("/dashboard");
      ProjectUtil.clearCurrentProject();

      expect(ProjectUtil.getLastAccessedProjectId()).toBeNull();
      expect(ProjectUtil.getCurrentProjectId()).toBeNull();
      expect(ProjectUtil.getCurrentProject()).toBeNull();
    });

    test("a deleted project is not reopened on the next visit", () => {
      const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
      const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");

      setUrl(`/dashboard/${PROJECT_Y_ID}/settings/danger-zone`);
      ProjectUtil.setCurrentProject(projectY);

      // The user deletes Project Y from the danger zone.
      ProjectUtil.clearCurrentProject();
      closeTheTab();

      expect(ProjectUtil.getProjectToLoad([projectX])?._id).toBe(PROJECT_X_ID);
    });

    test("is safe to call when nothing is stored", () => {
      expect(() => {
        return ProjectUtil.clearCurrentProject();
      }).not.toThrow();
    });
  });

  describe("getCurrentProject", () => {
    test("returns null when no project is known", () => {
      expect(ProjectUtil.getCurrentProject()).toBeNull();
    });

    test("returns null when the id is known but nothing was cached", () => {
      window.localStorage.setItem(
        LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
        PROJECT_Y_ID,
      );

      expect(ProjectUtil.getCurrentProject()).toBeNull();
    });

    test("resolves the cached project through the last accessed id", () => {
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(buildProject(PROJECT_Y_ID, "Project Y"));

      closeTheTab();

      const currentProject: Project | null = ProjectUtil.getCurrentProject();

      expect(currentProject?._id).toBe(PROJECT_Y_ID);
      expect(currentProject?.name).toBe("Project Y");
    });
  });

  describe("getProjectToSelect", () => {
    const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
    const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");
    const projectZ: Project = buildProject(PROJECT_Z_ID, "Project Z");
    const projects: Array<Project> = [projectX, projectY, projectZ];

    test("prefers the current project", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: projects,
          currentProjectId: new ObjectID(PROJECT_Z_ID),
          lastAccessedProjectId: new ObjectID(PROJECT_Y_ID),
        })?._id,
      ).toBe(PROJECT_Z_ID);
    });

    test("falls back to the last accessed project", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: projects,
          currentProjectId: null,
          lastAccessedProjectId: new ObjectID(PROJECT_Y_ID),
        })?._id,
      ).toBe(PROJECT_Y_ID);
    });

    test("skips a current project the user no longer has access to", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: [projectX, projectY],
          currentProjectId: new ObjectID(PROJECT_Z_ID),
          lastAccessedProjectId: new ObjectID(PROJECT_Y_ID),
        })?._id,
      ).toBe(PROJECT_Y_ID);
    });

    test("falls back to the first project when no candidate is accessible", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: [projectX],
          currentProjectId: new ObjectID(PROJECT_Z_ID),
          lastAccessedProjectId: new ObjectID(PROJECT_Y_ID),
        })?._id,
      ).toBe(PROJECT_X_ID);
    });

    test("falls back to the first project when there are no candidates", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: projects,
        })?._id,
      ).toBe(PROJECT_X_ID);
    });

    test("returns null when the user has no projects", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: [],
          currentProjectId: new ObjectID(PROJECT_Y_ID),
          lastAccessedProjectId: new ObjectID(PROJECT_Z_ID),
        }),
      ).toBeNull();
    });

    test("returns the project object from the list, not a stale copy", () => {
      const freshProjectY: Project = buildProject(
        PROJECT_Y_ID,
        "Project Y (renamed)",
      );

      expect(
        ProjectUtil.getProjectToSelect({
          projects: [projectX, freshProjectY],
          lastAccessedProjectId: new ObjectID(PROJECT_Y_ID),
        })?.name,
      ).toBe("Project Y (renamed)");
    });

    test("tolerates holes in the project list", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: [
            null as unknown as Project,
            undefined as unknown as Project,
            projectY,
          ],
          currentProjectId: null,
        })?._id,
      ).toBe(PROJECT_Y_ID);
    });

    test("tolerates a project list that is entirely holes", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: [null as unknown as Project],
        }),
      ).toBeNull();
    });

    test("tolerates a missing project list", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: undefined as unknown as Array<Project>,
          lastAccessedProjectId: new ObjectID(PROJECT_Y_ID),
        }),
      ).toBeNull();
    });

    test("ignores projects without an id", () => {
      const projectWithoutId: Project = new Project();
      projectWithoutId.name = "Broken";

      expect(
        ProjectUtil.getProjectToSelect({
          projects: [projectWithoutId, projectY],
          lastAccessedProjectId: new ObjectID(PROJECT_Y_ID),
        })?._id,
      ).toBe(PROJECT_Y_ID);
    });

    test("never falls back to a project without an id", () => {
      /*
       * The dashboard routes by project id, so an id-less project would send
       * the user to /dashboard/undefined.
       */
      const projectWithoutId: Project = new Project();
      projectWithoutId.name = "Broken";

      expect(
        ProjectUtil.getProjectToSelect({
          projects: [projectWithoutId, projectY],
        })?._id,
      ).toBe(PROJECT_Y_ID);
    });

    test("returns null when no project has an id", () => {
      expect(
        ProjectUtil.getProjectToSelect({
          projects: [new Project(), new Project()],
        }),
      ).toBeNull();
    });
  });

  /*
   * This is the decision the dashboard's project picker makes every time the
   * list of projects the user has access to lands.
   */
  describe("getProjectToSelectOnProjectsLoaded", () => {
    const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
    const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");
    const projects: Array<Project> = [projectX, projectY];

    test("opens the last accessed project when nothing is selected yet", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: projects,
          selectedProject: null,
        })?._id,
      ).toBe(PROJECT_Y_ID);
    });

    test("opens the first project when nothing is selected and nothing is remembered", () => {
      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: projects,
          selectedProject: null,
        })?._id,
      ).toBe(PROJECT_X_ID);
    });

    test("leaves an already selected project alone", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: projects,
          selectedProject: projectX,
        }),
      ).toBeNull();
    });

    test("does not overrule a project the user just created", () => {
      /*
       * Creating a project selects it and appends it to the list, which
       * re-triggers this decision. The remembered project must not win.
       */
      const newProject: Project = buildProject(PROJECT_Z_ID, "Brand New");
      ProjectUtil.setLastAccessedProjectId(PROJECT_X_ID);

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: [...projects, newProject],
          selectedProject: newProject,
        }),
      ).toBeNull();
    });

    test("corrects a selection the user no longer has access to", () => {
      const removedProject: Project = buildProject(PROJECT_Z_ID, "Project Z");

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: projects,
          selectedProject: removedProject,
        })?._id,
      ).toBe(PROJECT_X_ID);
    });

    test("matches the selection by id, not by object identity", () => {
      const sameProjectDifferentInstance: Project = buildProject(
        PROJECT_Y_ID,
        "Project Y",
      );

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: projects,
          selectedProject: sameProjectDifferentInstance,
        }),
      ).toBeNull();
    });

    test("waits while the project list is still loading", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: [],
          selectedProject: null,
        }),
      ).toBeNull();
    });

    test("does nothing for a user with no projects", () => {
      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: [],
          selectedProject: null,
        }),
      ).toBeNull();
    });

    test("does not treat an id-less selection as a match", () => {
      const projectWithoutId: Project = new Project();
      projectWithoutId.name = "Half loaded";

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: [new Project(), projectY],
          selectedProject: projectWithoutId,
        })?._id,
      ).toBe(PROJECT_Y_ID);
    });

    test("settles after one pass - the picked project is then left alone", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      const firstPass: Project | null =
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: projects,
          selectedProject: null,
        });

      expect(firstPass?._id).toBe(PROJECT_Y_ID);

      expect(
        ProjectUtil.getProjectToSelectOnProjectsLoaded({
          projects: projects,
          selectedProject: firstPass,
        }),
      ).toBeNull();
    });
  });

  describe("getProjectToLoad", () => {
    const projectX: Project = buildProject(PROJECT_X_ID, "Project X");
    const projectY: Project = buildProject(PROJECT_Y_ID, "Project Y");
    const projects: Array<Project> = [projectX, projectY];

    test("loads the project in the URL", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_X_ID);
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);

      expect(ProjectUtil.getProjectToLoad(projects)?._id).toBe(PROJECT_Y_ID);
    });

    test("loads this tab's project when the route has no project id", () => {
      window.sessionStorage.setItem(
        CURRENT_PROJECT_ID_STORAGE_KEY,
        PROJECT_Y_ID,
      );
      ProjectUtil.setLastAccessedProjectId(PROJECT_X_ID);

      expect(ProjectUtil.getProjectToLoad(projects)?._id).toBe(PROJECT_Y_ID);
    });

    test("loads the last accessed project on a fresh session", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      expect(ProjectUtil.getProjectToLoad(projects)?._id).toBe(PROJECT_Y_ID);
    });

    test("loads the first project for a brand new user", () => {
      expect(ProjectUtil.getProjectToLoad(projects)?._id).toBe(PROJECT_X_ID);
    });

    test("returns null while the project list is still loading", () => {
      ProjectUtil.setLastAccessedProjectId(PROJECT_Y_ID);

      expect(ProjectUtil.getProjectToLoad([])).toBeNull();
    });

    test("does not resurrect another user's project after a logout", () => {
      setUrl(`/dashboard/${PROJECT_Y_ID}/home`);
      ProjectUtil.setCurrentProject(projectY);

      // Logout clears all of local and session storage.
      window.localStorage.clear();
      window.sessionStorage.clear();
      setUrl("/dashboard");

      expect(ProjectUtil.getLastAccessedProjectId()).toBeNull();
      expect(ProjectUtil.getProjectToLoad(projects)?._id).toBe(PROJECT_X_ID);
    });
  });
});
