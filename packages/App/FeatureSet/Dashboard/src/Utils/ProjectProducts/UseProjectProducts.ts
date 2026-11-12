import ProjectProducts, { ProjectProductsState } from "./ProjectProductsStore";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useSyncExternalStore } from "react";

/*
 * The current project's products (ProjectProductsStore), drawn again
 * whenever they change: the server's answer arriving, a product shown or
 * hidden, a pin. Asks the server once per page load, however many
 * components call it.
 */
const useProjectProducts: (
  projectId?: ObjectID | string | null | undefined,
) => ProjectProductsState = (
  projectId?: ObjectID | string | null | undefined,
): ProjectProductsState => {
  const key: string =
    (projectId === undefined
      ? ProjectUtil.getCurrentProjectId()
      : projectId
    )?.toString() || "";

  const state: ProjectProductsState = useSyncExternalStore(
    ProjectProducts.subscribe,
    (): ProjectProductsState => {
      return ProjectProducts.getState(key);
    },
    (): ProjectProductsState => {
      return ProjectProducts.getState(key);
    },
  );

  useEffect(() => {
    ProjectProducts.load(key).catch(() => {
      // The store keeps what it knew; the menu shows every product.
    });
  }, [key]);

  return state;
};

export default useProjectProducts;
