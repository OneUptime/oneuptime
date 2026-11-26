import type { UserModelClass } from "./UserModelType";

/*
 * The User model for the relation every record has to whoever last changed
 * it, in a browser build, which takes this file in place of UserModelType.ts
 * (the "browser" field of packages/Common/package.json).
 *
 * Here User is never require()d: esbuild would run User, and every module
 * it imports - most of Common - only when first asked for, wrapping each,
 * and every public page downloaded those wrappers first (8 to 13 KiB
 * gzipped, packages/Common/Scripts/first-load-budgets.js). User's file says
 * it is the User model as it loads (setUserModelType), and a page that
 * reads a model has loaded User with it: User comes with the models whose
 * records someone created (createdByUser).
 */
let userModelType: UserModelClass | null = null;

export const setUserModelType: (modelType: UserModelClass) => void = (
  modelType: UserModelClass,
): void => {
  userModelType = modelType;
};

/*
 * Until User has loaded, nothing: the relation is resolved again when it is
 * next read (Types/Database/TableColumn's resolveModelType).
 */
export const getUserModelType: () => UserModelClass = (): UserModelClass => {
  return userModelType as UserModelClass;
};
