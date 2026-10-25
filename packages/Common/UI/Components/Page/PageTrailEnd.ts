import Link from "../../../Types/Link";
import React from "react";

/*
 * The page's own entry in its trail (the last breadcrumb), which a Page
 * hands the side menu it draws. On a phone the side menu folds into a
 * button that names the page the reader is on. An entry the menu cannot
 * read - one an Enterprise plugin draws as a component of its own, or a
 * page the menu does not list - is named by this instead of the bare word
 * "Navigation" (SideMenu). Outside a Page there is none.
 */
const PageTrailEndContext: React.Context<Link | null> =
  React.createContext<Link | null>(null);

export default PageTrailEndContext;
