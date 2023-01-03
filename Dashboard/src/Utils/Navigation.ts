import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';

export default class DashboardNavigation {
    public static getProjectId(): ObjectID | null {
        const projectId: string | undefined = Navigation.getFirstParam(2);
        if (projectId) {
            return new ObjectID(projectId);
        }
        return null;
    }
}
