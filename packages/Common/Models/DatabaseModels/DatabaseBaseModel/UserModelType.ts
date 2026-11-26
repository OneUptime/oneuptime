import type DatabaseBaseModel from "./DatabaseBaseModel";

export type UserModelClass = { new (): DatabaseBaseModel };

/*
 * THE USER MODEL, FOR THE RELATION EVERY RECORD HAS TO WHOEVER LAST CHANGED
 * IT (DatabaseBaseModel.lastModifiedByUser, #10290).
 *
 * Read when that relation is first resolved, and never imported at the top
 * of DatabaseBaseModel: User extends it, so a top-level import of User there
 * makes an import cycle in which, whenever DatabaseBaseModel is loaded first,
 * User's file runs while the class it extends is still undefined, and
 * `class User extends undefined` throws. DatabaseService reads
 * AuditLogService the same way, for the same reason.
 *
 * User's file says it is the User model as it loads (setUserModelType), and
 * here, on a server, User is required when nothing has loaded it yet.
 *
 * A browser build takes UserModelType.browser.ts in this file's place (the
 * "browser" field of packages/Common/package.json), which has no require:
 * esbuild runs a module that is require()d, and every module it imports,
 * only when it is first asked for, and User imports most of Common - the
 * wrappers that took cost every public page 8 to 13 KiB of its first load
 * (packages/Common/Scripts/first-load-budgets.js).
 */
let userModelType: UserModelClass | null = null;

export const setUserModelType: (modelType: UserModelClass) => void = (
  modelType: UserModelClass,
): void => {
  userModelType = modelType;
};

export const getUserModelType: () => UserModelClass = (): UserModelClass => {
  if (userModelType) {
    return userModelType;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require("../User").default;
};
