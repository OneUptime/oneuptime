import { question } from 'zx';
import ScriptOptions from './Types/ScriptOptions';

import Compile from './Services/Compile';

await (async (): Promise<void> => {
    const token: $TSFixMe = await question('Choose Option: ', {
        choices: [ScriptOptions.CompileTypeScript],
    });

    if (token === ScriptOptions.CompileTypeScript) {
        await Compile.compileAllTypeScriptProjects();
    }
})();
