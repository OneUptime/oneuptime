import PageComponentProps from "../PageComponentProps";
import ProductsSettings from "../../Components/ProjectProducts/ProductsSettings";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Settings -> Products (issue #6814): the products this project shows in
 * its menu, on Home and in Search's list. See ProductsSettings.
 */
const Products: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <ProductsSettings />
    </Fragment>
  );
};

export default Products;
