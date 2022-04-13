import { question } from 'zx';
import ScriptOptions from './types/script-options';

import Compile from './services/compile';

(async (): Promise<void> => {
    const token = await question('Choose Option: ', {
        choices: [ScriptOptions.CompileTypeScript],
    });

    if (token === ScriptOptions.CompileTypeScript) {
        await Compile.compileAllTypeScriptProjects();
    }
})();
