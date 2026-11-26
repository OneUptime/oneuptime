import TeamMemberService from "../../Services/TeamMemberService";
import UserService from "../../Services/UserService";
import logger from "../Logger";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import { getUserChosenLanguage } from "../../../Types/UserLanguage";

/*
 * THE LANGUAGE A PROJECT'S PEOPLE READ IN.
 *
 * What OneUptime writes once for everyone in a project to read - OneUptime
 * AI's analysis of a Data Security issue, written before anyone opens it
 * (#10369), and later the reasons of its field suggestions (#6105) - is
 * written in the project's language. A project names no language of its
 * own; its people do (User.language, Types/UserLanguage). So the project's
 * language is the one more than half of its members picked for their
 * account, and English otherwise: a member who picked none reads in their
 * browser's language, which the server does not know, so a language a few
 * picked never overrules the many who did not.
 *
 * Read as OneUptime. A read that fails is English, logged, and never holds
 * back what is being written.
 */

// The most members whose language is read.
export const MAX_PROJECT_LANGUAGE_MEMBERS: number = 1000;

/*
 * The language more than half of the members picked, or English: each
 * member's picked language, "" for one who picked none.
 */
export function getProjectLanguageOf(
  memberLanguages: ReadonlyArray<string>,
): string {
  const counts: Map<string, number> = new Map();

  for (const language of memberLanguages) {
    if (language) {
      counts.set(language, (counts.get(language) || 0) + 1);
    }
  }

  for (const [language, count] of counts) {
    if (count * 2 > memberLanguages.length) {
      return language;
    }
  }

  return DEFAULT_READER_LANGUAGE;
}

export default class ProjectLanguage {
  public static async getLanguage(projectId: ObjectID): Promise<string> {
    try {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: { projectId, hasAcceptedInvitation: true },
        select: { userId: true },
        skip: 0,
        limit: MAX_PROJECT_LANGUAGE_MEMBERS,
        props: { isRoot: true },
      });
      const userIds: Array<string> = [];

      for (const member of members) {
        const id: string = member.userId?.toString() || "";

        if (id && !userIds.includes(id)) {
          userIds.push(id);
        }
      }

      if (userIds.length === 0) {
        return DEFAULT_READER_LANGUAGE;
      }

      const users: Array<User> = await UserService.findBy({
        query: {
          _id: new Includes(
            userIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        },
        select: { language: true },
        skip: 0,
        limit: MAX_PROJECT_LANGUAGE_MEMBERS,
        props: { isRoot: true },
      });

      return getProjectLanguageOf(
        users.map((user: User): string => {
          return getUserChosenLanguage(user);
        }),
      );
    } catch (err) {
      logger.debug(
        `Could not read the language of project ${projectId.toString()}; what is written for it is in English.`,
      );
      logger.debug(err as Error);
      return DEFAULT_READER_LANGUAGE;
    }
  }
}
