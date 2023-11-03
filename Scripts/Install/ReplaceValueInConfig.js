// This script merges config.env.tpl to config.env

const fs = require('fs');

const init = () => {
    let env = '';
    try {
        env = fs.readFileSync('./config.env', 'utf8');
    } catch (err) {
        // do nothing.
    }
    const envValToReplace = process.argv[2];

    if (!envValToReplace) {
        // eslint-disable-next-line
        console.log('Please have env var to replace');
        return;
    }

    const envValToReplaceWith= process.argv[3];

    if (!envValToReplaceWith) {
        // eslint-disable-next-line
        console.log('Please have env var to replace with');
        return;
    }

    const linesInEnv = env.split('\n');
    const linesToRender = [];
    let found = false;

    for (let line of linesInEnv) {
        // this is a comment, ignore.
        if (!line.startsWith(envValToReplace)) {
            linesToRender.push(line);
        } else {
            found = true;
            const items = line.split('=');
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
