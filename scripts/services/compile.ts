import Project from '../utils/projects';
import { $ } from 'zx';

export default class Compile {
    static async compileAllTypeScriptProjects() {
        const projects = Project.getProjects();
        for (const project of projects) {
            await $`cd ${project.path}`;
            await $`npm run compile`;
            await $`cd ..`;
        }
    }
}
