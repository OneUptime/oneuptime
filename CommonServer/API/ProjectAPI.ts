import Project from 'Model/Models/Project';
import ProjectService, {
    Service as ProjectServiceType,
} from '../Services/ProjectService';
import BaseAPI from './BaseAPI';

export default class UserAPI extends BaseAPI<Project, ProjectServiceType> {
    public constructor() {
        super(Project, ProjectService);
    }
}
