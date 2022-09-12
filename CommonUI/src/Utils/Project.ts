import LocalStorage from './LocalStorage';
import { JSONObject } from 'Common/Types/JSON';
import Project from 'Model/Models/Project';
import BaseModel from 'Common/Models/BaseModel';

export default class ProjectUtil {
    public static getCurrentProject(): Project | null {
        if (!LocalStorage.getItem('current_project')) {
            return null;
        }
        const projectJson: JSONObject = LocalStorage.getItem(
            'current_project'
        ) as JSONObject;
        return Project.fromJSON(projectJson, Project) as Project;
    }

    public static setCurrentProject(project: JSONObject | Project): void {
        if (project instanceof Project) {
            project = BaseModel.toJSON(project, Project);
        }
        LocalStorage.setItem('current_project', project);
    }
}
