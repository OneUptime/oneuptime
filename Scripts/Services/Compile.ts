import Project from '../Utils/Projects';
import { $ } from 'zx';

export default class Compile {
    public static async compileAllTypeScriptProjects(): Promise<void> {
        const projects: $TSFixMe = Project.getProjects();
        for (const project of projects) {
            await $`cd ${project.path}`;
            await $`npm run compile`;
            await $`cd ..`;
        }
    }
}
