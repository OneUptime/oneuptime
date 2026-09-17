import Route from "Common/Types/API/Route";
import Project from "Common/Models/DatabaseModels/Project";

export default interface ComponentProps {
  pageRoute: Route;
  currentProject: Project | null;
  hasPaymentMethod: boolean;
}
