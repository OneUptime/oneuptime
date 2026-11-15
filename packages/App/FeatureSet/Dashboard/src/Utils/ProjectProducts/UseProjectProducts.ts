import ProjectProducts, { ProjectProductsState } from "./ProjectProductsStore";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useSyncExternalStore } from "react";

type ProjectIdInput = ObjectID | string | null | undefined;

const toKey: (projectId: ProjectIdInput | undefined) => string = (
  projectId: ProjectIdInput | undefined,
): string => {
  return (
    (projectId === undefined
      ? ProjectUtil.getCurrentProjectId()
      : projectId
    )?.toString() || ""
  );
};

/*
 * The current project's products (ProjectProductsStore), drawn again
 * whenever they change: the server's answer arriving, a product shown or
 * hidden, a pin, a product's first record made on this page, a newer answer
 * another tab of this browser got.
 *
 * Reading asks the server nothing. The navbar, which every project page
 * draws, asks when it is drawn and when its menus open
 * (useLoadedProjectProducts), the App when the page changes or the tab is
 * shown again (useProjectProductsKeptUpToDate) - each only once the answer
 * is older than REFRESH_AFTER_MS - and the pin beside a product page's
 * title, Home's cards, Search and the keyboard shortcuts draw what they
 * got: the remembered answer until it arrives. So a page drawn on its own
 * makes no request it did not make before.
 */
const useProjectProducts: (
  projectId?: ProjectIdInput,
) => ProjectProductsState = (
  projectId?: ProjectIdInput,
): ProjectProductsState => {
  const key: string = toKey(projectId);

  return useSyncExternalStore(
    ProjectProducts.subscribe,
    (): ProjectProductsState => {
      return ProjectProducts.getState(key);
    },
    (): ProjectProductsState => {
      return ProjectProducts.getState(key);
    },
  );
};

/*
 * The same, and asks the server for them when they are drawn (unless the
 * answer is younger than REFRESH_AFTER_MS), however many components call
 * it: for the navbar, and for Project Settings > Products, which shows the
 * latest wherever it is drawn.
 */
export const useLoadedProjectProducts: (
  projectId?: ProjectIdInput,
) => ProjectProductsState = (
  projectId?: ProjectIdInput,
): ProjectProductsState => {
  const key: string = toKey(projectId);
  const state: ProjectProductsState = useProjectProducts(key);

  useEffect(() => {
    loadQuietly(key);
  }, [key]);

  return state;
};

// Asks the store to read the project's products; a failure keeps what it knew.
export const loadQuietly: (projectId?: ProjectIdInput) => void = (
  projectId?: ProjectIdInput,
): void => {
  ProjectProducts.load(toKey(projectId)).catch(() => {
    // The store keeps what it knew; the menu shows every product.
  });
};

/*
 * Keeps the current project's products up to date while the person works
 * (#7465): asks again - once the answer is older than REFRESH_AFTER_MS -
 * whenever they move to another page (`pathname`) or come back to the tab.
 * A product set up meanwhile somewhere else (its first logs, a host an
 * agent reports, a teammate's monitor) then stops saying "Not set up".
 * The Dashboard's App draws it once, with the page's path.
 */
export const useProjectProductsKeptUpToDate: (pathname: string) => void = (
  pathname: string,
): void => {
  const key: string = toKey(undefined);

  useEffect(() => {
    loadQuietly(key);
  }, [key, pathname]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const onVisibilityChange: () => void = (): void => {
      if (document.visibilityState === "visible") {
        loadQuietly(key);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [key]);
};

export default useProjectProducts;

/*
 * Whether a product is switched off on the whole server (#6815), from the
 * current project's products answer: a place that offers it - the Ask AI
 * button, a Search action - draws nothing for it.
 */
export const useIsProductOffOnServer: (product: ProductKey) => boolean = (
  product: ProductKey,
): boolean => {
  const state: ProjectProductsState = useProjectProducts();

  return Boolean((state.answer.offOnServer || {})[product]);
};
