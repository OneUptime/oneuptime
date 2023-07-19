// This script merges config.env.tpl to config.env

import fs from 'fs';

const init: Function = (): void => {
    let env: string = '';
    try {
        env = fs.readFileSync('./config.env', 'utf8');
    } catch (err) {
        // do nothing.
    }
    const envValToReplace: string | undefined = process.argv[2];

    if (!envValToReplace) {
        // eslint-disable-next-line
        console.log('Please have env var to replace');
        return;
    }

    const envValToReplaceWith: string | undefined = process.argv[3];

    if (!envValToReplaceWith) {
        // eslint-disable-next-line
        console.log('Please have env var to replace with');
        return;
    }

    const linesInEnv: Array<string> = env.split('\n');
    const linesToRender: Array<string> = [];
    let found: boolean = false;

    for (let line of linesInEnv) {
        // this is a comment, ignore.
        if (!line.startsWith(envValToReplace)) {
            linesToRender.push(line);
        } else {
            found = true;
            const items: Array<string> = line.split('=');
            items[1] = envValToReplaceWith;
            line = items.join('=');
            linesToRender.push(line);
        }
    }

    if (!found) {
        linesToRender.push(envValToReplace + '=' + envValToReplaceWith);
    }

    // write the file back to disk and exit.
    fs.writeFileSync('./config.env', linesToRender.join('\n'));
};

init();
