import Route from 'Common/Types/API/Route';
import Project from 'Model/Models/Project';

export default interface ComponentProps {
    pageRoute: Route;
    currentProject: Project | null;
    hasPaymentMethod: boolean;
}
