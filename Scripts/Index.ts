import { question } from 'zx';
import ScriptOptions from './Types/ScriptOptions';

import Compile from './Services/Compile';

(async (): Promise<void> => {
    const token = await question('Choose Option: ', {
        choices: [ScriptOptions.CompileTypeScript],
    });

    if (token === ScriptOptions.CompileTypeScript) {
        await Compile.compileAllTypeScriptProjects();
    }
})();
