import Team from "../../Models/DatabaseModels/Team";
import TeamMembersByProject, {
  UserProjectMembership,
} from "../../Utils/TeamMembersByProject";

/*
 * How one pending invitation reads on screen.
 *
 * An invitation is a UserProjectMembership - one project, and every team of it
 * the user was invited to - so the things a card has to show (a name, an
 * avatar, the team chips, a stable React key) are all derived from a row that
 * may be missing any of its joined relations. A select that omitted the join,
 * a team deleted between the invite and the render, a project whose relation
 * was nullified: each of those arrives here as an undefined, and none of them
 * may render as "undefined" or crash the list.
 *
 * Kept out of the component so the fallbacks can be pinned by tests without a
 * render, and so the same wording is reused wherever invitations are shown.
 */
export default class ProjectInvitationDisplay {
  /**
   * The name the invitation reads under. Falls back to the project id so a row
   * whose project relation did not come back still names something the user
   * can tell apart from the row above it, rather than rendering blank.
   */
  public static getProjectName(invitation: UserProjectMembership): string {
    return TeamMembersByProject.getProjectName(invitation);
  }

  /**
   * The letters shown in the square avatar next to a project.
   *
   * One letter per word for a multi-word name ("Acme Rockets" -> "AR"), and the
   * first two letters of a single-word name ("Globex" -> "GL") - a lone letter
   * in an 44px square reads as a typo rather than as a monogram.
   *
   * Split with Array.from rather than by index: a name that opens with an emoji
   * or any other astral character would otherwise be cut through the middle of
   * a surrogate pair and render as a replacement box.
   */
  public static getInitials(projectName: string): string {
    const words: Array<string> = (projectName || "")
      .trim()
      .split(/\s+/)
      .filter((word: string) => {
        return Boolean(word);
      });

    if (words.length === 0) {
      // A project with no readable name at all still needs something in the square.
      return "?";
    }

    if (words.length === 1) {
      return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
    }

    return words
      .slice(0, 2)
      .map((word: string) => {
        return Array.from(word)[0] || "";
      })
      .join("")
      .toUpperCase();
  }

  /**
   * The teams this invitation covers, named. Teams whose relation came back
   * without a name are dropped rather than rendered as empty chips - the count
   * of chips is not load-bearing, and a nameless chip is noise.
   *
   * Already sorted: groupByProject sorts a row's teams by name.
   */
  public static getTeamNames(invitation: UserProjectMembership): Array<string> {
    return invitation.teams
      .map((team: Team) => {
        return team.name?.toString() || "";
      })
      .filter((name: string) => {
        return Boolean(name);
      });
  }

  /**
   * What accepting this invitation does, in words - shown under the project
   * name when the teams could not be named, and in the decline confirmation.
   *
   * Counts memberships rather than named teams, so an invitation whose team
   * relations did not come back still says how much is being accepted.
   */
  public static getTeamCountLabel(invitation: UserProjectMembership): string {
    const count: number = invitation.teamMemberIds.length;

    if (count === 1) {
      return "1 team";
    }

    return `${count} teams`;
  }

  /**
   * The React key and the id of the row currently mid-request.
   *
   * `id` is the lowest of the row's membership ids, so it is stable across
   * reloads however the memberships came back ordered. The project id is the
   * fallback for a row that carried no membership id at all; without one of
   * the two, keying by index would make React reuse a row's busy state for
   * whatever row slid into its place after a decline.
   */
  public static getRowKey(invitation: UserProjectMembership): string {
    return (
      invitation.id ||
      invitation.projectId?.toString() ||
      invitation.project?._id?.toString() ||
      ""
    );
  }
}
