// This script merges config.env.tpl to config.env

import fs from 'fs';

try {
    const tempate = fs.readFileSync('./config.tpl.env', 'utf8');
    const env = fs.readFileSync('./config.env', 'utf8');
    

    const linesInTemplate = tempate.split("\n");
    const linesInEnv = env.split("\n");

   
    for (const line of linesInTemplate) {
        // this is a comment, ignore. 
        if (line.startsWith("//")) {
            continue; 
        }

        // comment. Ignore. 
        if (line.startsWith("#")) {
            continue; 
        }

        // if the line is present in template but is not present in env file then add it to the env file. We assume, values in template file are default values. 
        if (line.split("=").length > 0) {
            if (linesInEnv.filter((envLine) => {
              return envLine.split("=").length > 0 &&   envLine.split("=")[0] === line.split("=")[0]
            }).length === 0) {
                linesInEnv.push(line);
            }
        }

    }

    // write the file back to disk and exit. 
    fs.writeFileSync('./config.env.temp', linesInEnv.join("\n"));

} catch (err) {
    console.error(err);
}