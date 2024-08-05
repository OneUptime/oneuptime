import ComponentProps from "../Pages/PageComponentProps";
import Project from "Common/AppModels/Models/Project";

export type RoutesProps = {
  projects: Array<Project>;
  isLoading: boolean;
} & ComponentProps;
