import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { ACCOUNTS_URL } from "Common/UI/Config";

/*
 * Where a form's public page lives. The Accounts app is the part of
 * OneUptime anyone can open without signing in, so a form's link is
 * <ACCOUNTS_URL>/form/<shareKey> - the route the Accounts app mounts for it.
 * The key is the form's shareKey, never its _id: resetting the link replaces
 * the key, and the old link stops working, while the form (and every
 * reference to it) keeps its id.
 */
export const FORM_PUBLIC_ROUTE_SEGMENT: string = "form";

export type GetFormShareLinkFunction = (shareKey: ObjectID | string) => URL;

export const getFormShareLink: GetFormShareLinkFunction = (
  shareKey: ObjectID | string,
): URL => {
  /*
   * From a copy: addRoute changes the URL it is called on, and ACCOUNTS_URL
   * is shared by the whole app.
   */
  return URL.fromString(ACCOUNTS_URL.toString()).addRoute(
    `/${FORM_PUBLIC_ROUTE_SEGMENT}/${shareKey.toString()}`,
  );
};
