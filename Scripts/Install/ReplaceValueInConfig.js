// This script merges config.env.tpl to config.env

import fs from 'fs';

try {

    const env = fs.readFileSync('./config.env', 'utf8');
    const envValToReplace = process.argv[2];

    if (!envValToReplace) {
        console.log("Please have env var to replace");
    }

    const envValToReplaceWith = process.argv[3];

    if (!envValToReplaceWith) {
        console.log("Please have env var to replace with");
    }

    const linesInEnv = env.split("\n");
    const linesToRender = [];
   
    for (const line of linesInEnv) {
        // this is a comment, ignore. 
        if (!line.startsWith(envValToReplace)) {
            linesToRender.push(line);
        } else {
            const items = line.split("=");
            items[1] = envValToReplaceWith;
            line = items.join("=");
            linesToRender.push(line);
        }
    }

    // write the file back to disk and exit. 
    fs.writeFileSync('./config.env', linesToRender.join("\n"));

} catch (err) {
    console.error(err);
}