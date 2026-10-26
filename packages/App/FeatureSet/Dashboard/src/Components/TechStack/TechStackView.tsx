import TechStack from "Common/Types/Service/TechStack";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { MORE_TECHNOLOGIES_TEMPLATE } from "../TableColumnList/MoreItemsTemplates";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  techStack: Array<TechStack>;
}

const TechStackView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Convert TechStack enum values to objects for compatibility with TableColumnListComponent
  const techStackItems: {
    id: number;
    value: TechStack;
  }[] = props.techStack.map((techStack: TechStack, index: number) => {
    return {
      id: index,
      value: techStack,
    };
  });

  return (
    <TableColumnListComponent
      items={techStackItems}
      moreTemplate={MORE_TECHNOLOGIES_TEMPLATE}
      getEachElement={(item: { id: number; value: TechStack }) => {
        return <p>{item.value}</p>;
      }}
      noItemsMessage="No tech stack."
    />
  );
};

export default TechStackView;
