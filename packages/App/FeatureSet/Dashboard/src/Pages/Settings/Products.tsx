import PageComponentProps from "../PageComponentProps";
import ProductsSettings from "../../Components/ProjectProducts/ProductsSettings";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Settings -> Products (issue #6814): the products this project shows in
 * its menu, on Home and in Search's list, and under Monitors the switch
 * that adds Monitor Groups to its menu (#7324). See ProductsSettings.
 */
const Products: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ProductsSettings currentProject={props.currentProject} />
    </Fragment>
  );
};

export default Products;
