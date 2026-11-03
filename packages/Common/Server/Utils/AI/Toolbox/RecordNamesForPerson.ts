import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import RunbookService from "../../../Services/RunbookService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import SecurityPlaybookService from "../../../Services/SecurityPlaybookService";
import { AIActionSentence } from "../../../../Types/AI/AIActionWords";
import { PreparedMutation, ToolArgs, ToolContext } from "./ToolTypes";

/*
 * HOW THE PERSON KNOWS WHAT AN ACTION ACTS ON.
 *
 * An AI action names its record by ID - the model passes incidentId,
 * runbookId - and an approval card that said "Acknowledge incident
 * 7d1c9a2e-0b3c-4b5e-9d7f-1a2b3c4d5e6f" told the person approving it
 * nothing, in any language. So before the card is shown, the action's
 * prepare (ObservabilityTool.prepareMutation) reads the record the way the
 * person knows it - an incident by its number ("INC-42", or "#42" with no
 * prefix), a runbook or a policy by its name, in quotes - with the
 * person's own props, and the card names it so (Types/AI/AIActionWords:
 * data in the sentence, never a sentence of its own).
 *
 * Every reader answers null when the call names no record, when the
 * person may not read it, or when the read fails: the card then keeps the
 * title built from the arguments, and running the action says why. None
 * ever throws - a prepare must never stand between the person and the
 * card.
 */

// The record a call names by `key`, when it names a real one.
function getNamedId(args: JSONObject, key: string): ObjectID | null {
  const value: string | undefined = ToolArgs.getString(args, key);

  return value && ObjectID.isValidUUID(value) ? new ObjectID(value) : null;
}

// "INC-42", or "#42" when the project gives its numbers no prefix.
function numbered(
  withPrefix: string | undefined,
  number: number | undefined,
): string | null {
  if (withPrefix) {
    return withPrefix;
  }

  return typeof number === "number" ? `#${number}` : null;
}

export async function getIncidentNumberForPerson(data: {
  incidentId: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
      props: data.ctx.props,
    });

    return numbered(
      incident?.incidentNumberWithPrefix,
      incident?.incidentNumber,
    );
  } catch {
    return null;
  }
}

export async function getAlertNumberForPerson(data: {
  alertId: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
      props: data.ctx.props,
    });

    return numbered(alert?.alertNumberWithPrefix, alert?.alertNumber);
  } catch {
    return null;
  }
}

export async function getSecurityCaseNumberForPerson(data: {
  securityCaseId: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneById({
        id: data.securityCaseId,
        select: {
          _id: true,
          caseNumber: true,
          caseNumberWithPrefix: true,
        },
        props: data.ctx.props,
      });

    return numbered(
      securityCase?.caseNumberWithPrefix,
      securityCase?.caseNumber,
    );
  } catch {
    return null;
  }
}

export async function getOnCallPolicyNameForPerson(data: {
  onCallDutyPolicyId: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: data.onCallDutyPolicyId,
        select: { _id: true, name: true },
        props: data.ctx.props,
      });

    return policy?.name?.trim() || null;
  } catch {
    return null;
  }
}

export async function getRunbookNameForPerson(data: {
  runbookId: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const runbook: Runbook | null = await RunbookService.findOneById({
      id: data.runbookId,
      select: { _id: true, name: true },
      props: data.ctx.props,
    });

    return runbook?.name?.trim() || null;
  } catch {
    return null;
  }
}

export async function getSecurityPlaybookNameForPerson(data: {
  securityPlaybookId: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  try {
    const playbook: SecurityPlaybook | null =
      await SecurityPlaybookService.findOneById({
        id: data.securityPlaybookId,
        select: { _id: true, name: true },
        props: data.ctx.props,
      });

    return playbook?.name?.trim() || null;
  } catch {
    return null;
  }
}

/*
 * What a call names, the way the person knows each: the record behind each
 * of `keys` it names by a real ID ("incidentId" -> "INC-42", "runbookId"
 * -> '"Restart checkout"', a name in quotes), read with the person's
 * props. A key it does not name, or names a record the person may not
 * read, is left out.
 */
export type RecordNameKey =
  | "incidentId"
  | "alertId"
  | "securityCaseId"
  | "onCallDutyPolicyId"
  | "runbookId"
  | "securityPlaybookId";

export async function getRecordNamesForPerson(data: {
  args: JSONObject;
  ctx: ToolContext;
  keys: Array<RecordNameKey>;
}): Promise<RecordNames> {
  const names: RecordNames = {};

  for (const key of data.keys) {
    const id: ObjectID | null = getNamedId(data.args, key);

    if (!id) {
      continue;
    }

    const name: string | null = await readRecordName({
      key,
      id,
      ctx: data.ctx,
    });

    if (name) {
      names[key] = name;
    }
  }

  return names;
}

/*
 * A name in a title, in quotes - 'Run runbook "Restart checkout"' - as the
 * card's line writes a resource's (aiActionResourceByName): a name runs on
 * into the sentence otherwise ("Run runbook Restart checkout"), in every
 * language. Written as a JSON string, so a quote in the name can never
 * read as its end. A number ("INC-42") needs none.
 */
export function quoteRecordName(name: string | null): string | null {
  return name ? JSON.stringify(name) : null;
}

async function readRecordName(data: {
  key: RecordNameKey;
  id: ObjectID;
  ctx: ToolContext;
}): Promise<string | null> {
  switch (data.key) {
    case "incidentId":
      return getIncidentNumberForPerson({ incidentId: data.id, ctx: data.ctx });
    case "alertId":
      return getAlertNumberForPerson({ alertId: data.id, ctx: data.ctx });
    case "securityCaseId":
      return getSecurityCaseNumberForPerson({
        securityCaseId: data.id,
        ctx: data.ctx,
      });
    case "onCallDutyPolicyId":
      return quoteRecordName(
        await getOnCallPolicyNameForPerson({
          onCallDutyPolicyId: data.id,
          ctx: data.ctx,
        }),
      );
    case "runbookId":
      return quoteRecordName(
        await getRunbookNameForPerson({ runbookId: data.id, ctx: data.ctx }),
      );
    case "securityPlaybookId":
      return quoteRecordName(
        await getSecurityPlaybookNameForPerson({
          securityPlaybookId: data.id,
          ctx: data.ctx,
        }),
      );
  }
}

// The names a call's records go by, for the person, by the key naming each.
export type RecordNames = Partial<Record<RecordNameKey, string>>;

/*
 * How a title names the record behind `key`: the way the person knows it,
 * once the prepare read it, else by what the call names it by - its ID -
 * or undefined when the call names none.
 */
export function getRecordTitleName(
  args: JSONObject,
  names: RecordNames,
  key: RecordNameKey,
): string | undefined {
  return names[key] || ToolArgs.getString(args, key);
}

/*
 * The prepare of an action that changes nothing about its arguments and
 * names records by ID: its arguments as they are, and its title with the
 * records named the way the person knows them - when they may read at
 * least one. buildActionTitle is the same builder with no names, so the
 * two titles say the same, by ID or by name.
 */
export function prepareRecordNamesInTitle(data: {
  keys: Array<RecordNameKey>;
  buildTitle: (args: JSONObject, names: RecordNames) => AIActionSentence;
}): (args: JSONObject, ctx: ToolContext) => Promise<PreparedMutation> {
  return async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const names: RecordNames = await getRecordNamesForPerson({
      args,
      ctx,
      keys: data.keys,
    });

    const namedArguments: Array<string> = Object.keys(names);

    return {
      arguments: args,
      ...(namedArguments.length > 0
        ? { title: data.buildTitle(args, names), namedArguments }
        : {}),
    };
  };
}
