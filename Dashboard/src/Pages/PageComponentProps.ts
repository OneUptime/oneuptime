import type Project from 'Model/Models/Project';
import type Route from 'Common/Types/API/Route';

export default interface ComponentProps {
    pageRoute: Route;
    currentProject: Project | null;
}
