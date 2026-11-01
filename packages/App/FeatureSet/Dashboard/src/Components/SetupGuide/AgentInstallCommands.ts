import { shellQuote } from "./SetupGuide";
import {
  INSTALL_SCRIPT_FILE,
  InstallScriptName,
  TROUBLESHOOT_SCRIPT_FILE,
  getInstallFileUrl,
  getInstallScriptUrl,
} from "Common/Types/InstallScripts/InstallScripts";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The commands that download an agent's install script and its files. Every
 * OneUptime serves them for its own release (Common/Types/InstallScripts),
 * so each command names the OneUptime the reader uses - the same URL the
 * guide hands the agent as ONEUPTIME_URL - and never GitHub:
 *
 *   curl -fsSL https://oneuptime.com/install/proxmox-agent -o install.sh
 *
 * -f, so an error page is never saved as the script or a config. Pure, so a
 * guide's commands are tested for any URL: Cloud, a self-hosted domain, a
 * path prefix, plain HTTP.
 */

/*
 * How far the run line's continued lines are indented: under the first
 * value, so the lines read as one command.
 */
export const INSTALL_SCRIPT_RUN_CONTINUATION_INDENT: string = "  ";

/*
 * The line that runs a downloaded install script with the values the guide
 * already knows in its environment. With two values or more, each goes on
 * a line of its own, every line but the last ending in a backslash:
 *
 *   ONEUPTIME_URL=https://oneuptime.com \
 *     ONEUPTIME_TELEMETRY_INGESTION_KEY=94245962-5a3e-46a1-ac4c-7d9c1e43e7dc \
 *     bash install.sh
 *
 * On one line the command ran past a laptop's code block (about 100
 * characters beside the side menu at 1280 pixels, far fewer on a
 * self-hosted address), hiding the key and the script it runs behind a
 * sideways scroll. A shell joins the lines into the very same command, and
 * the copy button copies it as shown. One value or none stays on one line.
 */
export function getInstallScriptRunCommand(
  environment: ReadonlyArray<string>,
  run: string,
): string {
  const words: Array<string> = [...environment, run];

  return environment.length < 2
    ? words.join(" ")
    : words.join(` \\\n${INSTALL_SCRIPT_RUN_CONTINUATION_INDENT}`);
}

// Downloads the agent's install.sh into the current folder.
export function getInstallScriptDownloadCommand(
  oneuptimeUrl: string,
  name: InstallScriptName,
): string {
  return `curl -fsSL ${shellQuote(getInstallScriptUrl(oneuptimeUrl, name))} -o ${INSTALL_SCRIPT_FILE}`;
}

// Downloads one of the agent's files into the current folder, under its own name.
export function getAgentFileDownloadCommand(
  oneuptimeUrl: string,
  name: InstallScriptName,
  file: string,
): string {
  return `curl -fsSLO ${shellQuote(getInstallFileUrl(oneuptimeUrl, name, file))}`;
}

// Downloads one of the agent's files to a path of the reader's choice.
export function getAgentFileDownloadToCommand(
  oneuptimeUrl: string,
  name: InstallScriptName,
  file: string,
  destination: string,
): string {
  return `curl -fsSL ${shellQuote(getInstallFileUrl(oneuptimeUrl, name, file))} -o ${destination}`;
}

// Downloads the agent's diagnostic script into the current folder.
export function getTroubleshootScriptDownloadCommand(
  oneuptimeUrl: string,
  name: InstallScriptName,
): string {
  return getAgentFileDownloadToCommand(
    oneuptimeUrl,
    name,
    TROUBLESHOOT_SCRIPT_FILE,
    TROUBLESHOOT_SCRIPT_FILE,
  );
}

/*
 * The note under every step whose command downloads an install script and
 * then runs it: the script is a file first, so whoever runs it as root can
 * read it before it runs. A translation key, shown as the step's note.
 */
export const INSTALL_SCRIPT_READ_FIRST_NOTE: string = translationKey(
  "The first line downloads the script as install.sh, so you can read it before you run it.",
);
