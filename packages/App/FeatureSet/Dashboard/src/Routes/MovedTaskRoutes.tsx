import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";
import PageMap from "../Utils/PageMap";
import { MOVED_TASK_PATHS } from "./MovedPagePaths";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

/*
 * Tasks (…/ai/agents) became Code (…/code). Bookmarks, links in wikis and
 * chats, GitHub comments the app posted before, and emails all still point
 * at a task's old address, so each forwards to the page that took over its
 * job - keeping the id, the query string and the hash (MovedPageRedirect).
 * An address under it that never was a page lands on Code itself, never on
 * a blank page. Code Repositories' old addresses forward in
 * MovedRepositoryRoutes.
 */

// Mounted at …/ai/agents/*.
const MovedTaskRoutes: FunctionComponent = (): ReactElement => {
  return (
    <Routes>
      <PageRoute index element={<MovedPageRedirect pageMap={PageMap.CODE} />} />
      <PageRoute
        path={MOVED_TASK_PATHS.view}
        element={<MovedPageRedirect pageMap={PageMap.CODE_TASK_VIEW} />}
      />
      <PageRoute
        path={MOVED_TASK_PATHS.logs}
        element={<MovedPageRedirect pageMap={PageMap.CODE_TASK_VIEW_LOG} />}
      />
      <PageRoute
        path={MOVED_TASK_PATHS.pullRequests}
        element={<MovedPageRedirect pageMap={PageMap.CODE_TASK_VIEW} />}
      />
      <PageRoute
        path={MOVED_TASK_PATHS.delete}
        element={<MovedPageRedirect pageMap={PageMap.CODE_TASK_VIEW} />}
      />
      <PageRoute
        path="*"
        element={<MovedPageRedirect pageMap={PageMap.CODE} />}
      />
    </Routes>
  );
};

export default MovedTaskRoutes;
