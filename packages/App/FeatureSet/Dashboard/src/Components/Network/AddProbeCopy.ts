import { getUniqueName } from "Common/UI/Components/Forms/Utils/UniqueName";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the Network area's "Add a probe" dialog (AddProbeModal), and
 * the name it suggests - kept apart from the component so App/Tests can read
 * them without React.
 */

export const ADD_PROBE_DIALOG_DESCRIPTION: string = translationKey(
  "A probe checks your devices from inside your network. Name it, and the next step gives you the command that runs it.",
);

export const ADD_PROBE_NAME_DESCRIPTION: string = translationKey(
  "Name it after where it runs, so you can tell your probes apart.",
);

export const ADD_PROBE_NAME_PLACEHOLDER: string = translationKey(
  "London office probe",
);

/*
 * The name a first probe starts with: the name is required, and a person
 * adding their first probe rarely has one in mind. In the reader's language,
 * since it is the name they keep; taken names are numbered past ("Network
 * probe 2"), as the server compares them.
 */
export const DEFAULT_PROBE_NAME: string = translationKey("Network probe");

export function getDefaultProbeName(existingNames: Array<string>): string {
  return getUniqueName({
    name: translateText(DEFAULT_PROBE_NAME) || DEFAULT_PROBE_NAME,
    existingNames: existingNames,
  });
}

export const RUN_PROBE_INSTRUCTIONS: string = translationKey(
  "Run this on a computer inside your network that can reach your devices, such as a server or a virtual machine with Docker. Leave it running: {{name}} checks your devices from there.",
);

export const RUN_PROBE_KEY_HIDDEN: string = translationKey(
  "Only project owners and admins can see a probe's key. Ask one of them to run {{name}}: it is under Monitors → Settings → Probes.",
);

/*
 * The run step for someone who has no command to run: a role that may add a
 * probe but not read its key, or a key that could not be read. The step
 * still says where the probe has to run, for whoever runs it, and its
 * waiting line asks them to run nothing.
 */
export const RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY: string = translationKey(
  "{{name}} has to run on a computer inside your network that can reach your devices, such as a server or a virtual machine with Docker.",
);

export const RUN_PROBE_WAITING_WITHOUT_KEY: string = translationKey(
  "Waiting for {{name}} to connect. This checks every few seconds and turns green once it is running.",
);

export const RUN_PROBE_OTHER_WAYS: string = translationKey(
  "Other ways to run it: Docker Compose, Kubernetes, and through a proxy",
);

// Where the docs explain the probe and every way to run it.
export const PROBE_DOCS_PATH: string = "/probe/custom-probe";

export const RUN_PROBE_WAITING: string = translationKey(
  "Waiting for {{name}} to connect. This checks every few seconds, so you can leave it open while you run the command.",
);

export const RUN_PROBE_CONNECTED: string = translationKey(
  "{{name}} is connected. Next, bring your devices in.",
);
