import SearchBox from "Common/UI/Components/Header/SearchBox";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onChange: (search: string) => void;
  selectedProject: Project | null;
}

const Search: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.selectedProject) {
    return <></>;
  }

  return <SearchBox key={2} onChange={props.onChange} />;
};

export default Search;
