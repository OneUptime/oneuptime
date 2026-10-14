/*
 * What the website's CLI page (/tool/cli, Views/cli.ejs) tells a visitor to
 * type, and what the CLI answers: how to install it, the first three
 * commands, and the terminal transcripts. Everything here is the real CLI's
 * (packages/CLI, published to npm as @oneuptime/cli), held to it twice:
 *
 *   - Tests/CliPage.test.ts reads the CLI's Commander definitions from its
 *     sources and holds every command here to them: the command, its
 *     arguments, its options and their values, the fields its JSON names,
 *     and the install lines to the package's name and bin.
 *   - packages/CLI/Tests/HomeCliPage.test.ts runs every command here through
 *     the real program and compares what it prints - through jq, where a
 *     transcript pipes to it - with the lines the transcript shows.
 *
 * So a renamed command or flag, or a changed message, fails one of them
 * until this page says the new thing. Placeholders are written as the docs
 * write them: <api-key>, <resolved-state-id>.
 */

// The npm package the CLI is published as: packages/CLI/package.json's name.
export const CliPackageName: string = "@oneuptime/cli";

// The command the package installs: the key of packages/CLI/package.json's bin.
export const CliCommandName: string = "oneuptime";

export interface CliTerminalStep {
  /*
   * The command as typed, one string per line on screen. Every line but the
   * last ends in " \", as a shell continues a command on the next line.
   */
  command: Array<string>;
  // What the terminal shows after the command, one string per line.
  output: Array<string>;
  // The CLI prints the output as a success message, in green.
  isSuccessMessage?: boolean | undefined;
}

export interface CliTerminals {
  // The hero's: what is monitored, and what is open.
  overview: Array<CliTerminalStep>;
  // Create and Manage Monitors.
  monitors: Array<CliTerminalStep>;
  // Respond to Incidents Faster.
  incidents: Array<CliTerminalStep>;
}

export interface CliFirstCommands {
  install: string;
  login: string;
  run: string;
}

export interface CliPageContent {
  packageName: string;
  commandName: string;
  // OneUptime Cloud, and the newest self-hosted OneUptime.
  installCommand: string;
  // The CLI is released with OneUptime, under its version.
  selfHostedInstallCommand: string;
  // An image of your own, as the scripting docs build one.
  dockerfile: Array<string>;
  firstCommands: CliFirstCommands;
  terminals: CliTerminals;
}

const INSTALL_COMMAND: string = `npm install -g ${CliPackageName}`;

// A filter the API reads: the incidents whose state is not a resolved one.
const OPEN_INCIDENTS_QUERY: string =
  '{"currentIncidentState":{"isResolvedState":false}}';

// The incident the incident transcript resolves.
const OPEN_INCIDENT_ID: string = "0b7d5e2c-8f4a-4d1b-9c3e-5a6f7b8c9d0e";

export const CliTerminalTranscripts: CliTerminals = {
  overview: [
    {
      command: [`${CliCommandName} monitor list -o json | jq -r '.[].name'`],
      output: ["API Gateway", "Web App", "Payment Service", "Database"],
    },
    {
      command: [
        `${CliCommandName} incident list -o json --query \\`,
        `  '${OPEN_INCIDENTS_QUERY}' \\`,
        "  | jq -r '.[].title'",
      ],
      output: ["Payment Service Down"],
    },
  ],
  monitors: [
    {
      command: [
        `${CliCommandName} monitor create --file checkout-api.json \\`,
        "  -o json | jq -r '._id'",
      ],
      output: ["6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11"],
    },
    {
      command: [`${CliCommandName} monitor list -o json | jq -r '.[].name'`],
      output: [
        "Checkout API",
        "API Gateway",
        "Web App",
        "Payment Service",
        "Database",
      ],
    },
    {
      command: [`${CliCommandName} monitor count`],
      output: ["5"],
    },
  ],
  incidents: [
    {
      command: [
        `${CliCommandName} incident list -o json --query \\`,
        `  '${OPEN_INCIDENTS_QUERY}' \\`,
        `  | jq -r '.[] | "\\(._id) \\(.title)"'`,
      ],
      output: [`${OPEN_INCIDENT_ID} Payment Service Down`],
    },
    {
      command: [
        `${CliCommandName} incident update \\`,
        `  ${OPEN_INCIDENT_ID} --data \\`,
        `  '{"currentIncidentStateId":"<resolved-state-id>"}'`,
      ],
      // A table of the empty object OneUptime answers an update with.
      output: [],
    },
    {
      command: [
        `${CliCommandName} incident count --query \\`,
        `  '${OPEN_INCIDENTS_QUERY}'`,
      ],
      output: ["0"],
    },
  ],
};

export const getCliPageContent: () => CliPageContent = (): CliPageContent => {
  return {
    packageName: CliPackageName,
    commandName: CliCommandName,
    installCommand: INSTALL_COMMAND,
    selfHostedInstallCommand: `${INSTALL_COMMAND}@<your-oneuptime-version>`,
    dockerfile: [
      "FROM node:lts-slim",
      `RUN ${INSTALL_COMMAND}`,
      `ENTRYPOINT ["${CliCommandName}"]`,
    ],
    firstCommands: {
      install: INSTALL_COMMAND,
      login: `${CliCommandName} login <api-key> <instance-url>`,
      run: `${CliCommandName} incident list`,
    },
    terminals: CliTerminalTranscripts,
  };
};
