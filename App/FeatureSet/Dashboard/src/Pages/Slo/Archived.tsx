import PageComponentProps from "../PageComponentProps";
import Card from "Common/UI/Components/Card/Card";
import React, { FunctionComponent, ReactElement } from "react";

const SlosArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Card
      title="Archived SLOs"
      description="SLOs you have archived. They are hidden from the SLO list and are not evaluated until you unarchive them."
    />
  );
};

export default SlosArchived;
