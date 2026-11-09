import UserService from "../../Services/UserService";
import logger from "../Logger";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import { getUserWritingLanguage } from "../../../Types/UserLanguage";

/*
 * THE LANGUAGE A MESSAGE TO A PERSON IS WRITTEN IN.
 *
 * A person's language is part of their account (Types/UserLanguage): the
 * one they picked on User Profile or in the Dashboard's language menu, or
 * none - English. Their on-call pages are written in it
 * (UserNotificationRuleService.deliverNotificationForRule), read once per
 * page they are sent.
 *
 * Read as OneUptime: a page goes out whoever triggered it. A read that
 * fails - the person is gone, the database is slow - is English, and is
 * logged as the page's other best-effort reads are (whether it pages
 * again, who paged, an observer's page): a page is never held back for the
 * language it is written in, and the page itself is no error.
 */
export default class UserLanguage {
  public static async getLanguage(
    userId: ObjectID | null | undefined,
  ): Promise<string> {
    if (!userId) {
      return DEFAULT_READER_LANGUAGE;
    }

    try {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          language: true,
        },
        props: {
          isRoot: true,
        },
      });

      return getUserWritingLanguage(user);
    } catch (err) {
      logger.debug(
        `Could not read the language of user ${userId.toString()}; their messages are written in English.`,
      );
      logger.debug(err as Error);
      return DEFAULT_READER_LANGUAGE;
    }
  }
}
