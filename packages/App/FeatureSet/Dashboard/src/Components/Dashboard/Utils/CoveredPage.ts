import { MASTER_PAGE_MAIN_CONTENT_ID } from "Common/UI/Components/MasterPage/MasterPage";
import { PageInertScope } from "Common/UI/Utils/PageInert";

/*
 * The page under a surface that covers the whole window while the person
 * works on it - a dashboard shown full screen (issue #10409), a playlist
 * playing on a screen (issue #5235) - out of reach: its header, product
 * bar, breadcrumbs, side menu and footer are inert, so Tab and a screen
 * reader stay on the surface (Common/UI/Utils/PageInert).
 *
 * Not the app's own layers: the command palette, Ask AI and the dialogs any
 * page opens sit beside the page in its <main> (App.tsx), and the notes
 * beside the app in its root (src/Index.tsx). They still work over the
 * surface.
 */

// The element the Dashboard's app is drawn in (src/Index.tsx, views/index.ejs).
export const DASHBOARD_APP_ROOT_ID: string = "root";

// How far the page under a covering surface goes inert: up to the app's root, past the app's own layers in its <main>.
export function getCoveredPageInertScope(): PageInertScope {
  return {
    boundary: document.getElementById(DASHBOARD_APP_ROOT_ID),
    keepChildrenOf: [document.getElementById(MASTER_PAGE_MAIN_CONTENT_ID)],
  };
}
