/*
 * TeamService (Common/Server/Services/TeamService) as a server on which
 * every team a single sign-on provider names is a team of the project it
 * is asked about.
 *
 * A sign-in adds people only to teams of the project it is for (#11149):
 * SsoTeamMembership.getProjectTeams reads the teams it was handed by their
 * ids and the project, and the suites about something else have no
 * database for that read. They stand the service in with this:
 *
 *   jest.mock("Common/Server/Services/TeamService", () => {
 *     return (
 *       jest.requireActual(
 *         "./SsoProjectTeamsStandIn",
 *       ) as typeof import("./SsoProjectTeamsStandIn")
 *     ).everyTeamInItsProject();
 *   });
 *
 * SsoAutoProvisioningPostgres.test.ts runs the real read, with teams of
 * another project among the ones handed; SsoTeamMembership.test.ts holds
 * what is kept of them.
 *
 * It imports nothing: it is loaded from inside a hoisted jest.mock factory,
 * before any of the test file's own imports exist.
 */

// A team as the stand-in answers it: its id, and the project asked about.
export interface StandInTeam {
  _id: string;
  projectId: unknown;
}

export interface TeamServiceStandInModule {
  __esModule: true;
  default: {
    findBy: (findBy: {
      query: Record<string, unknown>;
    }) => Promise<Array<StandInTeam>>;
  };
}

/*
 * The ids a query's QueryHelper.any(...) names: a Raw operator that keeps
 * them under one parameter. A single id is read as itself.
 */
export const readQueriedIds: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  const parameters: unknown = (
    value as { objectLiteralParameters?: unknown } | null | undefined
  )?.objectLiteralParameters;

  if (parameters && typeof parameters === "object") {
    return Object.values(parameters as Record<string, unknown>)
      .flat()
      .map((id: unknown): string => {
        return String(id);
      });
  }

  return value === undefined || value === null ? [] : [String(value)];
};

export const everyTeamInItsProject: () => TeamServiceStandInModule =
  (): TeamServiceStandInModule => {
    return {
      __esModule: true,
      default: {
        findBy: (findBy: {
          query: Record<string, unknown>;
        }): Promise<Array<StandInTeam>> => {
          return Promise.resolve(
            readQueriedIds(findBy.query["_id"]).map(
              (id: string): StandInTeam => {
                return { _id: id, projectId: findBy.query["projectId"] };
              },
            ),
          );
        },
      },
    };
  };
