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
 * hidden, a pin.
 *
 * Reading asks the server nothing. The navbar, which every project page
 * draws, asks once per page load (useLoadedProjectProducts), and the pin
 * beside a product page's title, Home's cards, Search and the keyboard
 * shortcuts draw what it got - the remembered answer until it arrives. So a
 * page drawn on its own makes no request it did not make before.
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
 * The same, and asks the server for them once per page load, however many
 * components call it: for the navbar, and for Project Settings > Products,
 * which shows the latest wherever it is drawn.
 */
export const useLoadedProjectProducts: (
  projectId?: ProjectIdInput,
) => ProjectProductsState = (
  projectId?: ProjectIdInput,
): ProjectProductsState => {
  const key: string = toKey(projectId);
  const state: ProjectProductsState = useProjectProducts(key);

  useEffect(() => {
    ProjectProducts.load(key).catch(() => {
      // The store keeps what it knew; the menu shows every product.
    });
  }, [key]);

  return state;
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
