import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";
import PageMap from "../Utils/PageMap";
import { MOVED_REPOSITORY_PATHS } from "./MovedPagePaths";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

/*
 * Code Repositories (…/code-repository) became Code (…/code). Bookmarks,
 * links in wikis and chats, and GitHub's way back from an installation made
 * before all still point at a repository's old address, so each forwards to
 * the page that took over its job - keeping the id, the query string and
 * the hash (MovedPageRedirect). An address under it that never was a page
 * lands on Code itself, never on a blank page. The old Tasks addresses
 * forward in MovedTaskRoutes.
 */

// Mounted at …/code-repository/*.
const MovedRepositoryRoutes: FunctionComponent = (): ReactElement => {
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

export default MovedRepositoryRoutes;
