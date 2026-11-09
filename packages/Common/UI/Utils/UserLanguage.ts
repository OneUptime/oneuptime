import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";
import UserUtil from "./User";
import { Logger } from "./Logger";
import User from "../../Models/DatabaseModels/User";
import {
  getUserChosenLanguage,
  normalizeUserLanguageToStore,
} from "../../Types/UserLanguage";

/*
 * A SIGNED-IN PERSON'S LANGUAGE, AS THE DASHBOARDS READ AND SAVE IT.
 *
 * A person's language is part of their account (Types/UserLanguage): what
 * OneUptime writes to them is in it - their on-call pages - and the
 * Dashboard starts in it on every browser. It is theirs to pick: on User
 * Profile, or with the language menu at the bottom of the Dashboard and the
 * Admin Dashboard, which saves the pick here while they are signed in.
 *
 * Both are best effort and never throw: a language that cannot be saved or
 * read leaves the page in the language it shows, and is logged.
 */
export default class UserLanguageUtil {
  /*
   * Saves `language` as the signed-in person's own - one of the codes
   * OneUptime writes in. Nothing for a visitor who is not signed in, or a
   * code OneUptime does not write in. Resolves whether it was saved.
   */
  public static async saveSignedInUserLanguage(
    language: string,
  ): Promise<boolean> {
    if (!UserUtil.isLoggedIn()) {
      return false;
    }

    const code: string | null | undefined =
      normalizeUserLanguageToStore(language);

    if (!code) {
      return false;
    }

    try {
      await ModelAPI.updateById({
        modelType: User,
        id: UserUtil.getUserId(),
        data: {
          language: code,
        },
      });

      return true;
    } catch (err) {
      Logger.error(
        `Error saving your language: ${API.getFriendlyErrorMessage(err as Error)}`,
      );
      return false;
    }
  }

  /*
   * The signed-in person's own language - one of the codes OneUptime writes
   * in - or "" when they picked none, are not signed in, or it cannot be
   * read.
   */
  public static async readSignedInUserLanguage(): Promise<string> {
    if (!UserUtil.isLoggedIn()) {
      return "";
    }

    try {
      const user: User | null = await ModelAPI.getItem({
        modelType: User,
        id: UserUtil.getUserId(),
        select: {
          language: true,
        },
      });

      return getUserChosenLanguage(user);
    } catch (err) {
      Logger.error(
        `Error reading your language: ${API.getFriendlyErrorMessage(err as Error)}`,
      );
      return "";
    }
  }
}
