import yargs from 'yargs';
import URL from 'Common/Types/API/URL';
import Dictionary from 'Common/Types/Dictionary';
import MonitorInfrastructure from './Jobs/MonitorInfrastructure';

const usage = "\nUsage: oneuptime-infrastructure-agent --secret-key <secret-key>";

const argv: Dictionary<string> = yargs  
      .usage(usage)  
      .option("k", {alias:"secret-key", describe: "Secret Key for this agent. You will find this on OneUptime Dashboard", type: "string", demandOption
: true })
    .option("h", {alias:"oneuptime-host", describe: "OneUptime Host. By default this is https://oneupime.com", type: "string", demandOption
    : false })                                                                                                     
      .help(true)  
      .argv as Dictionary<string>;

const secretKey: string | undefined = argv["secret-key"];
const oneuptimeHost: URL = URL.fromString(argv["oneuptime-host"] || "https://oneuptime.com");


if(!secretKey) {
    throw new Error("No secret-key argument found. You can find secret key for this monitor on OneUptime Dashboard");
}

MonitorInfrastructure.initJob(secretKey, oneuptimeHost);
