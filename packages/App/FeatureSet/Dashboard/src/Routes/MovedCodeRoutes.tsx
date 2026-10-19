import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";
import PageMap from "../Utils/PageMap";
import { MOVED_REPOSITORY_PATHS, MOVED_TASK_PATHS } from "./MovedPagePaths";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

/*
 * Tasks (…/ai/agents) and Code Repositories (…/code-repository) became
 * Code (…/code). Bookmarks, links in wikis and chats, GitHub comments the
 * app posted before, and emails all still point at the old addresses, so
 * each forwards to the page that took over its job - keeping the id, the
 * query string and the hash (MovedPageRedirect). An address under them
 * that never was a page lands on Code itself, never on a blank page.
 */

// Mounted at …/ai/agents/*.
export const MovedTaskRoutes: FunctionComponent = (): ReactElement => {
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

// Mounted at …/code-repository/*.
export const MovedRepositoryRoutes: FunctionComponent = (): ReactElement => {
  return (
    <Routes>
      <PageRoute index element={<MovedPageRedirect pageMap={PageMap.CODE} />} />
      <PageRoute
        path={MOVED_REPOSITORY_PATHS.view}
        element={<MovedPageRedirect pageMap={PageMap.CODE_REPOSITORY_VIEW} />}
      />
      <PageRoute
        path={MOVED_REPOSITORY_PATHS.settings}
        element={
          <MovedPageRedirect pageMap={PageMap.CODE_REPOSITORY_VIEW_SETTINGS} />
        }
      />
      <PageRoute
        path={MOVED_REPOSITORY_PATHS.delete}
        element={
          <MovedPageRedirect pageMap={PageMap.CODE_REPOSITORY_VIEW_DELETE} />
        }
      />
      <PageRoute
        path="*"
        element={<MovedPageRedirect pageMap={PageMap.CODE} />}
      />
    </Routes>
  );
};
