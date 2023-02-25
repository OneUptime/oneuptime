import LocalStorage from './LocalStorage';
import { JSONObject } from 'Common/Types/JSON';
import Project from 'Model/Models/Project';
import JSONFunctions from 'Common/Types/JSONFunctions';
import SubscriptionPlan, {
    PlanSelect,
} from 'Common/Types/Billing/SubscriptionPlan';
import { BILLING_ENABLED, getAllEnvVars } from '../Config';

export default class ProjectUtil {
    public static getCurrentProject(): Project | null {
        if (!LocalStorage.getItem('current_project')) {
            return null;
        }
        const projectJson: JSONObject = LocalStorage.getItem(
            'current_project'
        ) as JSONObject;
        return JSONFunctions.fromJSON(projectJson, Project) as Project;
    }

    public static setCurrentProject(project: JSONObject | Project): void {
        if (project instanceof Project) {
            project = JSONFunctions.toJSON(project, Project);
        }
        LocalStorage.setItem('current_project', project);
    }

    public static clearCurrentProject(): void {
        LocalStorage.setItem('current_project', null);
    }

    public static getCurrentPlan(): PlanSelect | null {
        if (!BILLING_ENABLED) {
            return null;
        }

        const project: Project | null = this.getCurrentProject();
        if (!project || !project.paymentProviderPlanId) {
            return null;
        }

        return SubscriptionPlan.getPlanSelect(
            project.paymentProviderPlanId,
            getAllEnvVars()
        );
    }
}
