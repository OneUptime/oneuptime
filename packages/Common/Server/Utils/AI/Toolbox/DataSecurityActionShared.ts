import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import {
  AI_ACTION_NAME,
  AIActionEffects,
  AIActionList,
  AIActionSentence,
  aiActionList,
  aiActionSentence,
} from "../../../../Types/AI/AIActionWords";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import TeamMemberService from "../../../Services/TeamMemberService";
import TeamService from "../../../Services/TeamService";
import FeedPersonName from "../../Feed/FeedPersonName";
import { addMemberUsers } from "./SetupPlan";
import { PreparedMutation, ToolArgs, ToolContext } from "./ToolTypes";

/*
 * WHAT ASK AI'S DATA SECURITY ACTIONS SHARE (#10378).
 *
 * How their cards name what they act on - a store, a data type, a place, a
 * person - and the rule every one of them follows for whether it asks in
 * every mode: a call asks when its card says why it asks (its effects'
 * asksBecause), when what it does always asks, and when its prepare could
 * not say what it does - an action that could not be judged is shown to a
 * person, never run unseen (Toolbox/Index asksInEveryMode).
 */

// The most names one card line lists before it says how many more there are.
export const MAX_NAMES_ON_A_CARD: number = 5;

// Data in a sentence: in quotes, as JSON writes it, so it never reads as words.
export function quoted(text: string): string {
  return JSON.stringify(text);
}

// Names as a list a sentence takes, each in quotes.
export function quotedList(names: ReadonlyArray<string>): AIActionList {
  return aiActionList(
    names.map((name: string): AIActionSentence => {
      return aiActionSentence(AI_ACTION_NAME, { name: quoted(name) });
    }),
  );
}

// Names as a list, as written: people, named as FeedPersonName names them.
export function plainList(names: ReadonlyArray<string>): AIActionList {
  return aiActionList(
    names.map((name: string): AIActionSentence => {
      return aiActionSentence(AI_ACTION_NAME, { name });
    }),
  );
}

// The record a call names by `key`, when it names a real one.
export function readIdArgument(
  args: JSONObject,
  key: string,
): ObjectID | null {
  const value: string | undefined = ToolArgs.getString(args, key);

  return value && ObjectID.isValidUUID(value) ? new ObjectID(value) : null;
}

/*
 * Whether a Data Security action's call asks in every mode
 * (ObservabilityTool.asksInEveryMode): when what it does always asks
 * (`always`), when its prepare said why it asks (asksBecause), and when
 * there is no prepare to say what it does.
 */
export function asksWhenItsCardSaysSo(
  always: boolean,
  prepared: PreparedMutation | undefined,
): boolean {
  if (always) {
    return true;
  }

  if (!prepared?.effects) {
    return true;
  }

  return Boolean(prepared.effects.asksBecause);
}

// Effects with only the parts that say something.
export function effectsOf(effects: AIActionEffects): AIActionEffects {
  return {
    ...(effects.changes && effects.changes.length > 0
      ? { changes: effects.changes }
      : {}),
    ...(effects.stopsWorking && effects.stopsWorking.length > 0
      ? { stopsWorking: effects.stopsWorking }
      : {}),
    ...(effects.costs && effects.costs.length > 0
      ? { costs: effects.costs }
      : {}),
    ...(effects.asksBecause ? { asksBecause: effects.asksBecause } : {}),
  };
}

/*
 * People and teams of the project named in a call - "Ana", "ana@acme.com",
 * "payments" - read as the person reads the project's members and teams:
 * each by their name or address, a team by its name, case aside. A person
 * is named on a card as FeedPersonName names them, never by their address.
 */
export interface NamedPerson {
  id: ObjectID;
  // As a card names them.
  name: string;
}

export interface NamedPeople {
  users: Array<NamedPerson>;
  teams: Array<NamedPerson>;
  notFound: Array<string>;
}

// The most members and teams read to find the ones a call names.
const PEOPLE_READ_LIMIT: number = 1000;

export async function findNamedPeople(data: {
  ctx: ToolContext;
  names: ReadonlyArray<string>;
}): Promise<NamedPeople> {
  const found: NamedPeople = { users: [], teams: [], notFound: [] };
  const asked: Array<string> = data.names
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  if (asked.length === 0) {
    return found;
  }

  const members: Array<TeamMember> = await TeamMemberService.findBy({
    query: { projectId: data.ctx.projectId, hasAcceptedInvitation: true },
    select: { _id: true, userId: true },
    limit: PEOPLE_READ_LIMIT,
    skip: 0,
    props: data.ctx.props,
  });

  await addMemberUsers(data.ctx, members);

  const teams: Array<Team> = await TeamService.findBy({
    query: { projectId: data.ctx.projectId },
    select: { _id: true, name: true },
    limit: PEOPLE_READ_LIMIT,
    skip: 0,
    props: data.ctx.props,
  });

  for (const name of asked) {
    const lower: string = name.toLowerCase();
    const member: TeamMember | undefined = members.find(
      (each: TeamMember): boolean => {
        return (
          Boolean(each.userId) &&
          ((each.user?.name?.toString() || "").trim().toLowerCase() === lower ||
            (each.user?.email?.toString() || "").trim().toLowerCase() === lower)
        );
      },
    );

    if (member?.userId) {
      if (
        !found.users.some((user: NamedPerson): boolean => {
          return user.id.toString() === member.userId!.toString();
        })
      ) {
        found.users.push({
          id: member.userId,
          name: await FeedPersonName.getText({
            userId: member.userId,
            projectId: data.ctx.projectId,
          }),
        });
      }
      continue;
    }

    const team: Team | undefined = teams.find((each: Team): boolean => {
      return (each.name || "").trim().toLowerCase() === lower;
    });

    if (team?.id) {
      if (
        !found.teams.some((each: NamedPerson): boolean => {
          return each.id.toString() === team.id!.toString();
        })
      ) {
        found.teams.push({ id: team.id, name: team.name || "" });
      }
      continue;
    }

    found.notFound.push(name);
  }

  return found;
}
