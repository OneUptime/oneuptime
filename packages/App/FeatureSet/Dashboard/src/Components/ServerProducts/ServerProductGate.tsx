import ServerProductOffPage from "./ServerProductOffPage";
import {
  OffProductOfPath,
  getOffProductOfPath,
} from "../../Utils/ProjectProducts/ProductOfRoute";
import { ProjectProductsState } from "../../Utils/ProjectProducts/ProjectProductsStore";
import useProjectProducts from "../../Utils/ProjectProducts/UseProjectProducts";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import { useLocation } from "react-router-dom";

/*
 * Draws the page asked for, or - when its product is switched off on the
 * server (#6815) - the page that says so (ServerProductOffPage). Around
 * every route of the Dashboard (App.tsx), so a product's pages, its guided
 * setup and its old addresses all explain themselves the same way.
 *
 * It reads the project's products answer the navbar asks for once per page
 * load (useProjectProducts asks nothing itself).
 */

export interface ComponentProps {
  children: ReactNode;
}

const ServerProductGate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const products: ProjectProductsState = useProjectProducts();

  const off: OffProductOfPath | null = getOffProductOfPath({
    pathname: location.pathname,
    offOnServer: products.answer.offOnServer || {},
  });

  if (off) {
    return (
      <ServerProductOffPage
        product={off.product}
        reason={off.reason}
        pageProduct={off.pageProduct}
      />
    );
  }

  return <>{props.children}</>;
};

export default ServerProductGate;
