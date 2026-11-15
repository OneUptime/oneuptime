import { Command } from "commander";
import { ResourceInfo, ResolvedCredentials } from "../Types/CLITypes";
import { executeApiRequest } from "../Core/ApiClient";
import { CLIOptions, getResolvedCredentials } from "../Core/ConfigManager";
import { handleError } from "../Core/ErrorHandler";
import {
  createJsonOption,
  createOutputOption,
  formatOutput,
  isJsonOutputRequested,
  printInfo,
  printSuccess,
  resolveOutputFormat,
} from "../Core/OutputFormatter";
import { getParentOptions } from "../Utils/CommandOptions";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import {
  CLI_NOTE_COLUMN,
  CliAction,
  CliNoteTarget,
  CliStateChange,
  CliStateMachine,
  getCliNoteTarget,
  getCliStateMachine,
  getModelApiPathOf,
} from "Common/Utils/DeveloperDocs/CliCommands";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * THE DASHBOARD'S BUTTONS, AS COMMANDS
 *
 *   oneuptime incident acknowledge <id>
 *   oneuptime incident resolve <id>
 *   oneuptime scheduled-maintenance-event start <id>
 *   oneuptime alert add-note <id> --note "Rolled back the 14:05 deploy."
 *
 * The API moves a record to another state by a row of its state timeline,
 * and takes a note as a record of its own: what the dashboard's buttons
 * send, and what the MCP server's acknowledge_incident, resolve_incident
 * and add_incident_note tools do. These do the same, so neither an agent
 * nor a script needs to know which state is the project's acknowledged one
 * (Common/Utils/DeveloperDocs/CliCommands lists the records and states).
 *
 * A record already in the state - or, for acknowledge, past it: in a state
 * after Acknowledged, or resolved (Common/Utils/AcknowledgedState) - is
 * left as it is, and the command still exits with 0: what it was asked for
 * is so. The answer says whether anything changed.
 */

function rowsOf(result: JSONValue): Array<JSONValue> {
  if (Array.isArray(result)) {
    return result as Array<JSONValue>;
  }

  const data: JSONValue | undefined = (result as JSONObject | null)?.["data"];

  return Array.isArray(data) ? (data as Array<JSONValue>) : [];
}

function idOf(value: JSONValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const wrapped: JSONObject = value as JSONObject;

    if (typeof wrapped["value"] === "string") {
      return wrapped["value"] as string;
    }

    if (typeof wrapped["_id"] === "string") {
      return wrapped["_id"] as string;
    }
  }

  return "";
}

const VERBS: Readonly<Record<string, string>> = {
  [CliAction.Acknowledge]: "Acknowledge",
  [CliAction.Resolve]: "Resolve",
  [CliAction.Start]: "Start",
  [CliAction.End]: "End",
};

const DONE: Readonly<Record<string, string>> = {
  [CliAction.Acknowledge]: "acknowledged",
  [CliAction.Resolve]: "resolved",
  [CliAction.Start]: "started",
  [CliAction.End]: "ended",
};

// The flags of a state a record can be in, as its model has them.
function stateFlagsOf(machine: CliStateMachine): Array<string> {
  const flags: Set<string> = new Set<string>(["isResolvedState"]);

  for (const change of machine.changes) {
    flags.add(change.stateFlag);
  }

  if (machine.stateList !== StateListType.ScheduledMaintenanceState) {
    flags.add("isAcknowledgedState");
  }

  return Array.from(flags);
}

function stateSelect(machine: CliStateMachine): JSONObject {
  const select: JSONObject = { _id: true, name: true, order: true };

  for (const flag of stateFlagsOf(machine)) {
    select[flag] = true;
  }

  return select;
}

export interface StateChangeResult {
  // The record's ID.
  _id: string;
  action: string;
  // False when it was in the state, or past it, already.
  changed: boolean;
  // The state it is in now.
  state: { _id: string; name: string };
}

/*
 * Moves a record to the project's state with the change's flag, unless it
 * is there (or, for acknowledge, past it) already.
 */
export async function changeRecordState(data: {
  credentials: ResolvedCredentials;
  resource: ResourceInfo;
  machine: CliStateMachine;
  change: CliStateChange;
  id: string;
}): Promise<StateChangeResult> {
  const { credentials, resource, machine, change } = data;

  if (!ObjectID.isValidUUID(data.id)) {
    throw new Error(
      `"${data.id}" is not an ID. IDs look like 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11: \`oneuptime ${resource.name} list\` shows them.`,
    );
  }

  const states: Array<JSONValue> = rowsOf(
    await executeApiRequest({
      apiUrl: credentials.apiUrl,
      apiKey: credentials.apiKey,
      apiPath: getModelApiPathOf(machine.stateModelType),
      operation: "list",
      query: { [change.stateFlag]: true },
      select: stateSelect(machine),
      sort: { order: "ASC" },
      skip: 0,
      limit: 1,
    }),
  );
  const target: JSONObject | undefined = states[0] as JSONObject | undefined;
  const targetId: string = idOf(target?.["_id"]);

  if (!target || !targetId) {
    throw new Error(
      `This project has no state for "${change.action}" that this key may read. Give the key a permission that reads ${new machine.stateModelType().pluralName || "states"}.`,
    );
  }

  const targetName: string = String(target["name"] || "");
  const record: JSONValue = await executeApiRequest({
    apiUrl: credentials.apiUrl,
    apiKey: credentials.apiKey,
    apiPath: resource.apiPath,
    operation: "read",
    id: data.id,
    select: { _id: true, [machine.currentStateRelation]: stateSelect(machine) },
  });
  const current: JSONObject | undefined = (record as JSONObject | null)?.[
    machine.currentStateRelation
  ] as JSONObject | undefined;

  const isThereAlready: boolean = Boolean(
    current &&
      (current[change.stateFlag] === true ||
        (change.action === CliAction.Acknowledge &&
          AcknowledgedStateUtil.isStateAcknowledged({
            list:
              machine.stateList === StateListType.AlertState
                ? StateListType.AlertState
                : StateListType.IncidentState,
            states: [
              {
                _id: targetId,
                order: target["order"],
                isAcknowledgedState: true,
              },
            ],
            state: current,
          }))),
  );

  if (current && isThereAlready) {
    return {
      _id: data.id,
      action: change.action,
      changed: false,
      state: {
        _id: idOf(current["_id"]),
        name: String(current["name"] || ""),
      },
    };
  }

  await executeApiRequest({
    apiUrl: credentials.apiUrl,
    apiKey: credentials.apiKey,
    apiPath: getModelApiPathOf(machine.timelineModelType),
    operation: "create",
    data: {
      [machine.recordColumn]: data.id,
      [machine.stateColumn]: targetId,
    },
  });

  return {
    _id: data.id,
    action: change.action,
    changed: true,
    state: { _id: targetId, name: targetName },
  };
}

function registerStateChangeCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
  machine: CliStateMachine,
  change: CliStateChange,
): void {
  resourceCmd
    .command(`${change.action} <id>`)
    .description(
      `${VERBS[change.action]} ${resource.singularName === resource.pluralName ? "it" : `the ${resource.singularName}`}: ${change.description}`,
    )
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (id: string, _options: unknown, cmd: Command) => {
      try {
        const parentOpts: CLIOptions = getParentOptions(resourceCmd);
        const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);
        const result: StateChangeResult = await changeRecordState({
          credentials: creds,
          resource,
          machine,
          change,
          id,
        });

        if (isJsonOutputRequested(cmd)) {
          // eslint-disable-next-line no-console
          console.log(
            formatOutput(
              result as unknown as JSONObject,
              resolveOutputFormat(cmd),
            ),
          );
          return;
        }

        if (result.changed) {
          printSuccess(
            `${resource.singularName} ${id} ${DONE[change.action]}: it is in ${result.state.name} now.`,
          );
          return;
        }

        printInfo(
          `${resource.singularName} ${id} is ${DONE[change.action]} already: it is in ${result.state.name}. Nothing changed.`,
        );
      } catch (error) {
        handleError(error, {
          resource: resource.name,
          operation: change.action,
        });
      }
    });
}

export interface AddedNote {
  // The note's ID.
  _id: string;
  // The record's ID.
  recordId: string;
  visibility: "internal" | "public";
}

function registerAddNoteCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
  target: CliNoteTarget,
): void {
  /*
   * Who reads the note: an internal one only the people who can see the
   * record - a note is read through its record - and a public one its
   * status pages. Never "your team", which reads as one of OneUptime's
   * Teams (#7595).
   */
  const command: Command = resourceCmd
    .command(`${CliAction.AddNote} <id>`)
    .description(
      target.publicNoteModelType
        ? `Add a note to the ${resource.singularName}: internal, for the people who can see it, or --public, on its status pages`
        : `Add an internal note to the ${resource.singularName}, for the people who can see it`,
    )
    .requiredOption("--note <markdown>", "Required. The note, in Markdown");

  if (target.publicNoteModelType) {
    command.option(
      "--public",
      "Post it on the status pages that show it, where its subscribers are told",
    );
  }

  command
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(
      async (
        id: string,
        options: { note: string; public?: boolean },
        cmd: Command,
      ) => {
        try {
          if (!ObjectID.isValidUUID(id)) {
            throw new Error(
              `"${id}" is not an ID. IDs look like 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11: \`oneuptime ${resource.name} list\` shows them.`,
            );
          }

          if (!options.note.trim()) {
            throw new Error("--note needs the note's text.");
          }

          const parentOpts: CLIOptions = getParentOptions(resourceCmd);
          const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);
          const isPublic: boolean = Boolean(
            options.public && target.publicNoteModelType,
          );
          const created: JSONValue = await executeApiRequest({
            apiUrl: creds.apiUrl,
            apiKey: creds.apiKey,
            apiPath: getModelApiPathOf(
              isPublic && target.publicNoteModelType
                ? target.publicNoteModelType
                : target.internalNoteModelType,
            ),
            operation: "create",
            data: {
              [target.recordColumn]: id,
              [CLI_NOTE_COLUMN]: options.note,
            },
          });
          const result: AddedNote = {
            _id: idOf((created as JSONObject | null)?.["_id"]),
            recordId: id,
            visibility: isPublic ? "public" : "internal",
          };

          if (isJsonOutputRequested(cmd)) {
            // eslint-disable-next-line no-console
            console.log(
              formatOutput(
                result as unknown as JSONObject,
                resolveOutputFormat(cmd),
              ),
            );
            return;
          }

          printSuccess(
            isPublic
              ? `Posted the note on the status pages that show ${resource.singularName} ${id}.`
              : `Added the note to ${resource.singularName} ${id}. Only the people who can see the ${resource.singularName} can read it.`,
          );
        } catch (error) {
          handleError(error, {
            resource: resource.name,
            operation: CliAction.AddNote,
          });
        }
      },
    );
}

// The actions a record has (ResourceInfo.actions), as its subcommands.
export function registerActionCommands(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  const machine: CliStateMachine | undefined = getCliStateMachine(
    resource.tableName,
  );
  const notes: CliNoteTarget | undefined = getCliNoteTarget(resource.tableName);

  for (const action of resource.actions) {
    if (action === CliAction.AddNote) {
      if (notes) {
        registerAddNoteCommand(resourceCmd, resource, notes);
      }
      continue;
    }

    const change: CliStateChange | undefined = machine?.changes.find(
      (candidate: CliStateChange): boolean => {
        return candidate.action === action;
      },
    );

    if (machine && change) {
      registerStateChangeCommand(resourceCmd, resource, machine, change);
    }
  }
}
