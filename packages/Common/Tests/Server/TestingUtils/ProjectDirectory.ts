import { jest } from "@jest/globals";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import ObjectID from "../../../Types/ObjectID";

/*
 * Answers the lookups ProjectScopedReferenceValidator makes - which ids are
 * records of a project, who is a member of it, which ids exist at all - the
 * way the database would, without one.
 *
 * Rule and owner services (ProjectReferencesService) and the owner engines
 * (OwnerRuleAssignment.createOwner) check every team, user and record they
 * write against the project. A suite about something else stubs the
 * directory so the references it writes are their project's:
 *
 *   stubProjectDirectory({});
 *
 * and a suite about the check itself names what the project has:
 *
 *   stubProjectDirectory({
 *     projectId: PROJECT_ID,
 *     records: { Team: [PLATFORM_TEAM_ID] },
 *     members: [ADA_ID],
 *   });
 *
 * Ids are compared lower-cased, as Postgres renders a uuid.
 */

export interface ProjectDirectory {
  // The project the records below belong to; any project when left out.
  projectId?: ObjectID | undefined;
  /*
   * The project's records per model, by table name ("Team", "Label"). When
   * left out, every id asked about is the project's.
   */
  records?: Record<string, Array<string>> | undefined;
  /*
   * The users with a membership in the project. When left out, every user
   * asked about is a member.
   */
  members?: Array<string> | undefined;
  // Ids that exist in some other project (for mustExist: false references).
  elsewhere?: Array<string> | undefined;
  /*
   * Ids of rows every project shares (a global probe), by table name. None
   * when left out.
   */
  shared?: Record<string, Array<string>> | undefined;
}

export interface ProjectDirectoryStub {
  // Each findIdsInProject call: the model's table name, project and ids.
  recordLookups: Array<{
    model: string;
    projectId: string;
    ids: Array<string>;
  }>;
  memberLookups: Array<{ projectId: string; userIds: Array<string> }>;
}

const lower: (ids: Array<string>) => Set<string> = (
  ids: Array<string>,
): Set<string> => {
  return new Set<string>(
    ids.map((id: string): string => {
      return id.toLowerCase();
    }),
  );
};

export function stubProjectDirectory(
  directory: ProjectDirectory,
): ProjectDirectoryStub {
  const stub: ProjectDirectoryStub = { recordLookups: [], memberLookups: [] };
  const isTheProject: (id: ObjectID) => boolean = (id: ObjectID): boolean => {
    return (
      !directory.projectId ||
      id.toString().toLowerCase() ===
        directory.projectId.toString().toLowerCase()
    );
  };

  jest
    .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
    .mockImplementation(
      async (data: {
        service: DatabaseService<DatabaseBaseModel>;
        projectId: ObjectID;
        ids: Array<string>;
      }): Promise<Set<string>> => {
        const model: string = data.service.getModel().tableName || "";

        stub.recordLookups.push({
          model: model,
          projectId: data.projectId.toString(),
          ids: [...data.ids],
        });

        if (!isTheProject(data.projectId)) {
          return new Set<string>();
        }

        const known: Set<string> | null = directory.records
          ? lower(directory.records[model] || [])
          : null;

        return new Set<string>(
          data.ids
            .map((id: string): string => {
              return id.toLowerCase();
            })
            .filter((id: string): boolean => {
              return known ? known.has(id) : true;
            }),
        );
      },
    );

  jest
    .spyOn(ProjectScopedReferenceValidator, "findProjectMemberIds")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        userIds: Array<string>;
      }): Promise<Set<string>> => {
        stub.memberLookups.push({
          projectId: data.projectId.toString(),
          userIds: [...data.userIds],
        });

        if (!isTheProject(data.projectId)) {
          return new Set<string>();
        }

        const members: Set<string> | null = directory.members
          ? lower(directory.members)
          : null;

        return new Set<string>(
          data.userIds
            .map((id: string): string => {
              return id.toLowerCase();
            })
            .filter((id: string): boolean => {
              return members ? members.has(id) : true;
            }),
        );
      },
    );

  jest
    .spyOn(ProjectScopedReferenceValidator, "findSharedIds")
    .mockImplementation(
      async (data: {
        service: DatabaseService<DatabaseBaseModel>;
        ids: Array<string>;
      }): Promise<Set<string>> => {
        const model: string = data.service.getModel().tableName || "";
        const shared: Set<string> = lower(
          (directory.shared && directory.shared[model]) || [],
        );

        return new Set<string>(
          data.ids
            .map((id: string): string => {
              return id.toLowerCase();
            })
            .filter((id: string): boolean => {
              return shared.has(id);
            }),
        );
      },
    );

  jest
    .spyOn(ProjectScopedReferenceValidator, "findExistingIds")
    .mockImplementation(
      async (data: {
        service: DatabaseService<DatabaseBaseModel>;
        ids: Array<string>;
      }): Promise<Set<string>> => {
        const model: string = data.service.getModel().tableName || "";
        const existing: Set<string> = lower([
          ...(directory.elsewhere || []),
          ...((directory.records && directory.records[model]) || []),
        ]);

        return new Set<string>(
          data.ids
            .map((id: string): string => {
              return id.toLowerCase();
            })
            .filter((id: string): boolean => {
              return existing.has(id);
            }),
        );
      },
    );

  return stub;
}

/*
 * For a suite about a service's own rules - what it refuses, what it reads,
 * in which order - rather than the references it names: the generic check
 * every ProjectReferencesService runs first is let through, so it adds no
 * lookups of its own. ProjectScopedReferencesEverywhere holds every service
 * to that check.
 */
export function stubGenericReferenceCheck(): void {
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);
}
