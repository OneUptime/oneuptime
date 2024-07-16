import TechStack from "Common/Types/ServiceCatalog/TechStack";
import TableColumnListComponent from "CommonUI/src/Components/TableColumnList/TableColumnListComponent";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  techStack: Array<TechStack>;
}

const TechStackView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.techStack}
      moreText="more"
      getEachElement={(techStack: TechStack) => {
        return (
          <p>{techStack}</p>
        );
      }}
      noItemsMessage="No tech stack."
    />
  );
};

export default TechStackView;
