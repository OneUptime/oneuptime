import ComponentProps from "../Pages/PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";

/*
 * A page that lists every project the person belongs to at once - Active
 * Incidents, Active Alerts and their episodes: handed the person's projects
 * (App.tsx), so its list hears each one's changes (Utils/LiveProjects).
 */
export type CrossProjectPageProps = {
  projects: Array<Project>;
} & ComponentProps;
