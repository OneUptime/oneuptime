import NewVersion from "../../Utils/NewVersion/NewVersion";
import React, {
  FunctionComponent,
  ReactElement,
  useLayoutEffect,
  useRef,
} from "react";
import { Location, useLocation } from "react-router-dom";

/*
 * Opening another page once a new version is out: the page is loaded in full
 * from the server - in the new version - instead of in this tab's old one,
 * which would ask the server for code the new version no longer has.
 *
 * A page is another path. A query or a hash that changes on the same page
 * (a filter, a tab, a search typed into the address) is not opening a page,
 * and loading it in full would throw away what the reader is doing.
 *
 * Rendered by each frontend's entry inside its router, beside the app. A
 * layout effect, so the full load starts before the old version paints the
 * new page, and after the page being left has gone (so its unsaved changes
 * no longer hold anything back - what was typed there is gone either way).
 * Every other navigation is a moment to look for a new version.
 */
const NewVersionNavigation: FunctionComponent = (): ReactElement | null => {
  const location: Location = useLocation();
  const previousPathname: React.MutableRefObject<string> = useRef<string>(
    location.pathname,
  );

  useLayoutEffect(() => {
    if (previousPathname.current === location.pathname) {
      return;
    }

    previousPathname.current = location.pathname;

    if (NewVersion.shouldLoadNavigationInFull()) {
      NewVersion.loadNavigationInFull();
      return;
    }

    NewVersion.noteNavigation();
  }, [location.pathname]);

  return null;
};

export default NewVersionNavigation;
