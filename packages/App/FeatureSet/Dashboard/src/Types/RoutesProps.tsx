import ComponentProps from "../Pages/PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";

export type RoutesProps = {
  projects: Array<Project>;
  isLoading: boolean;
} & ComponentProps;
