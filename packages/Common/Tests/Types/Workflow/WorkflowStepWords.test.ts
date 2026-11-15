// The step catalogue imports the database-model registry, which nothing here reads.
jest.mock("../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import {
  AFFECTED_RESOURCES_ARGUMENT_ID,
  getAffectedResourcesArgument,
} from "../../../Types/Workflow/AffectedResourcesSetting";
import ComponentMetadata, {
  Argument,
  Port,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import { API_GET_BY_ID_PLACEHOLDER } from "../../../Types/Workflow/Components/ApiGetById";
import {
  ALERT_FROM_ANOTHER_TOOL,
  FROM_ANOTHER_TOOL_KINDS,
  FromAnotherToolKind,
  FromAnotherToolWords,
  INCIDENT_FROM_ANOTHER_TOOL,
} from "../../../Types/Workflow/Components/FromAnotherTool";
import {
  IRC_DEFAULT_NICKNAME,
  IRC_DEFAULT_PLAIN_TEXT_PORT,
  IRC_DEFAULT_TLS_PORT,
  IRC_MAX_LINES,
} from "../../../Types/Workflow/Components/IRC";
import {
  ZABBIX_MESSAGE_MAX_LENGTH,
  ZABBIX_UPDATE_ARGUMENT_IDS,
} from "../../../Types/Workflow/Components/Zabbix";
import {
  HuntressTriggerEvent,
  HuntressTriggerValue,
} from "../../../Types/Workflow/HuntressTrigger";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A BUILT-IN STEP'S WORDS, WRITTEN OUT (#8359).
 *
 * The Dashboard's extractor reads a step's words where the catalogue marks
 * them with translationKey(), and it can only read a whole sentence: one
 * glued from pieces in code has no key, and draws in English in every
 * language. So the help lines that named a constant (the IRC step's 15
 * lines and default ports, API Get By ID's {id}, Huntress's events,
 * Zabbix's 2048 characters), and the incident and alert steps' sentences
 * that named their kind, are written out now. These hold each one to what
 * it used to be built from, so the words and the code cannot drift apart.
 */

function stepOf(id: ComponentID): ComponentMetadata {
  const step: ComponentMetadata | undefined = (
    Components as Array<ComponentMetadata>
  ).find((component: ComponentMetadata): boolean => {
    return component.id === id;
  });

  if (!step) {
    throw new Error(`No step ${id}`);
  }

  return step;
}

function argumentOf(step: ComponentMetadata, id: string): Argument {
  const argument: Argument | undefined = [
    ...step.arguments,
    ...(step.runWorkflowManuallyArguments || []),
  ].find((candidate: Argument): boolean => {
    return candidate.id === id;
  });

  if (!argument) {
    throw new Error(`No setting ${id} on ${step.id}`);
  }

  return argument;
}

function returnValueOf(step: ComponentMetadata, id: string): ReturnValue {
  const returnValue: ReturnValue | undefined = step.returnValues.find(
    (candidate: ReturnValue): boolean => {
      return candidate.id === id;
    },
  );

  if (!returnValue) {
    throw new Error(`No returned value ${id} on ${step.id}`);
  }

  return returnValue;
}

function outPortOf(step: ComponentMetadata, id: string): Port {
  return step.outPorts.find((port: Port): boolean => {
    return port.id === id;
  }) as Port;
}

describe("the help lines that name a constant", () => {
  const irc: ComponentMetadata = stepOf(ComponentID.IRCSendMessageToChannel);

  test("the IRC step's message names how many lines it sends", () => {
    expect(argumentOf(irc, "text").description).toBe(
      `Message to send. Each line is sent as an IRC message of its own, at most ${IRC_MAX_LINES} of them, and IRC formatting codes work.`,
    );
  });

  test("its nickname names the nickname it posts as by default", () => {
    expect(argumentOf(irc, "nickname").description).toBe(
      `Nickname to post as. Defaults to ${IRC_DEFAULT_NICKNAME}. If it is taken, an underscore or a number is added.`,
    );
    expect(argumentOf(irc, "nickname").placeholder).toBe(IRC_DEFAULT_NICKNAME);
  });

  test("its port names both ports it falls back to", () => {
    expect(argumentOf(irc, "port").description).toBe(
      `Port of the IRC server. Defaults to ${IRC_DEFAULT_TLS_PORT}, or to ${IRC_DEFAULT_PLAIN_TEXT_PORT} with Disable TLS on.`,
    );
    expect(argumentOf(irc, "port").placeholder).toBe(
      String(IRC_DEFAULT_TLS_PORT),
    );
  });

  test("API Get By ID's address names the mark its ID goes in", () => {
    const step: ComponentMetadata = stepOf(ComponentID.ApiGetById);
    const url: Argument = argumentOf(step, "url");

    expect(url.description).toBe(
      `The item's address, with ${API_GET_BY_ID_PLACEHOLDER} where its ID goes.`,
    );
    expect(url.placeholder).toContain(API_GET_BY_ID_PLACEHOLDER);
  });

  test("Huntress's event names every event it can be, the empty one first", () => {
    const step: ComponentMetadata = stepOf(ComponentID.HuntressIncidentReport);
    const asked: Argument = argumentOf(step, HuntressTriggerValue.Event);

    expect(asked.description).toBe(
      `What happened: ${HuntressTriggerEvent.Created}, ${HuntressTriggerEvent.CommentAdded} or ${HuntressTriggerEvent.Closed}. Empty: ${HuntressTriggerEvent.Created}.`,
    );
    expect(asked.placeholder).toBe(HuntressTriggerEvent.Created);
    expect(argumentOf(step, HuntressTriggerValue.Comment).description).toBe(
      `The comment, for a ${HuntressTriggerEvent.CommentAdded} event.`,
    );
    expect(returnValueOf(step, HuntressTriggerValue.Event).description).toBe(
      `What happened: ${HuntressTriggerEvent.Created} for a new report, ${HuntressTriggerEvent.CommentAdded} when someone commented on it, ${HuntressTriggerEvent.Closed} when it was closed or dismissed.`,
    );
    expect(returnValueOf(step, HuntressTriggerValue.Comment).description).toBe(
      `The comment someone added in Huntress. Empty unless Event is ${HuntressTriggerEvent.CommentAdded}.`,
    );
    // Every event Huntress sends is one of the three the lines name.
    expect(Object.values(HuntressTriggerEvent).sort()).toEqual(
      [
        HuntressTriggerEvent.Closed,
        HuntressTriggerEvent.CommentAdded,
        HuntressTriggerEvent.Created,
      ].sort(),
    );
  });

  test("Zabbix's message names the most it keeps", () => {
    const step: ComponentMetadata = stepOf(ComponentID.ZabbixUpdateProblem);

    expect(
      argumentOf(step, ZABBIX_UPDATE_ARGUMENT_IDS.message).description,
    ).toBe(
      `The message Zabbix keeps on the problem, at most ${ZABBIX_MESSAGE_MAX_LENGTH} characters.`,
    );
  });
});

describe("the incident and the alert step, each in its own words", () => {
  // What the sentences were built from before they were written out.
  const WORDS_OF: Record<
    string,
    {
      n: string;
      opens: string;
      Opens: string;
      opened: string;
    }
  > = {
    [INCIDENT_FROM_ANOTHER_TOOL.componentId]: {
      n: "incident",
      opens: "opens",
      Opens: "Open",
      opened: "opened",
    },
    [ALERT_FROM_ANOTHER_TOOL.componentId]: {
      n: "alert",
      opens: "creates",
      Opens: "Create",
      opened: "created",
    },
  };

  test.each(
    FROM_ANOTHER_TOOL_KINDS.map(
      (kind: FromAnotherToolKind): [string, FromAnotherToolKind] => {
        return [kind.Noun, kind];
      },
    ),
  )(
    "%s From Another Tool says what it said, for its kind",
    (_noun: string, kind: FromAnotherToolKind) => {
      const old: { n: string; opens: string; Opens: string; opened: string } =
        WORDS_OF[kind.componentId]!;
      const n: string = old.n;
      const step: ComponentMetadata = stepOf(kind.componentId as ComponentID);

      expect(step.title).toBe(`${kind.Noun} From Another Tool`);
      expect(step.description).toBe(
        `${old.Opens}, acknowledge or resolve an ${n} for a problem in another tool, or add a note to it, matched by that tool's ID.`,
      );
      expect(argumentOf(step, "what-happened").description).toBe(
        `One of open, acknowledge, resolve or note. The tool's own words work too, such as problem, firing or recovery, and a state's name moves the ${n} there.`,
      );
      expect(argumentOf(step, "outside-id").description).toBe(
        `The other tool's ID for the problem, such as a Zabbix event ID. Every event with the same ID acts on the same ${n}.`,
      );
      expect(argumentOf(step, "title").description).toBe(
        `The ${n}'s title. Needed when the step ${old.opens} one.`,
      );
      expect(argumentOf(step, "description").description).toBe(
        `Markdown for the new ${n}'s description.`,
      );
      expect(argumentOf(step, "severity").description).toBe(
        `A new ${n}'s severity: one of yours by name or ID, or most severe, middle or least severe. Otherwise your most severe.`,
      );
      expect(argumentOf(step, "note").description).toBe(
        `Markdown about the event: why, on the timeline, when the ${n} changes state, or a private note when What Happened is note.`,
      );
      expect(argumentOf(step, "reason").description).toBe(
        `Why the ${n} changes state, on its timeline. When set, the Note is added as a private note as well.`,
      );
      expect(argumentOf(step, "record-id").name).toBe(`${kind.Noun} ID`);
      expect(argumentOf(step, "record-id").description).toBe(
        `Act on the ${n} with this ID instead of the one Outside ID finds, when the other tool keeps the ${n}'s ID.`,
      );
      expect(argumentOf(step, "outside-id-field").description).toBe(
        `The ${n} custom field that keeps the Outside ID, so later events find it. Left empty, externalId.`,
      );
      expect(argumentOf(step, "custom-fields").description).toBe(
        `More custom fields a new ${n} gets. The Outside ID is added to them.`,
      );
      expect(argumentOf(step, "labels").description).toBe(
        `IDs of the labels a new ${n} gets, separated by commas.`,
      );
      expect(argumentOf(step, "note-instead-of-resolving").description).toBe(
        `When the tool says the problem is over, add the Note and leave the ${n} for people to resolve.`,
      );
      expect(returnValueOf(step, "record").name).toBe(kind.Noun);
      expect(returnValueOf(step, "record").description).toBe(
        `The ${n} the step ${old.opened} or found: its ID, number, title, state and severity.`,
      );
      expect(outPortOf(step, "opened").title).toBe(kind.Opened);
      expect(outPortOf(step, "opened").description).toBe(
        `Runs next when the step ${old.opens} a new ${n}.`,
      );
      expect(outPortOf(step, "updated").description).toBe(
        `Runs next when the step moved the ${n} or added a note.`,
      );
      expect(outPortOf(step, "unchanged").description).toBe(
        `Runs next when there was nothing to do: no ${n} has the ID, or it is there already.`,
      );
      expect(outPortOf(step, "error").description).toBe(
        `Runs next when the step could not read or change the ${n}.`,
      );
    },
  );

  test("each sentence of one kind names that kind, never the other", () => {
    for (const [kind, other] of [
      [INCIDENT_FROM_ANOTHER_TOOL, ALERT_FROM_ANOTHER_TOOL],
      [ALERT_FROM_ANOTHER_TOOL, INCIDENT_FROM_ANOTHER_TOOL],
    ] as Array<[FromAnotherToolKind, FromAnotherToolKind]>) {
      for (const [field, sentence] of Object.entries(
        kind.words as FromAnotherToolWords,
      )) {
        expect({
          field,
          names: sentence.toLowerCase().includes(kind.noun),
        }).toEqual({ field, names: true });
        expect({
          field,
          namesOther: new RegExp(`\\b${other.noun}\\b`, "i").test(sentence),
        }).toEqual({ field, namesOther: false });
      }
    }
  });

  test("the two kinds say every sentence, and no two the same", () => {
    const incident: Array<string> = Object.values(
      INCIDENT_FROM_ANOTHER_TOOL.words,
    );
    const alert: Array<string> = Object.values(ALERT_FROM_ANOTHER_TOOL.words);

    expect(Object.keys(INCIDENT_FROM_ANOTHER_TOOL.words)).toEqual(
      Object.keys(ALERT_FROM_ANOTHER_TOOL.words),
    );
    expect(incident.length).toBeGreaterThan(15);
    expect(new Set(incident).size).toBe(incident.length);
    expect(
      incident.filter((sentence: string): boolean => {
        return alert.includes(sentence);
      }),
    ).toEqual([]);
  });
});

describe("the Affected Resources setting", () => {
  test("says which record it is for, for an incident and for an alert", () => {
    const incident: Argument | null = getAffectedResourcesArgument("Incident");
    const alert: Argument | null = getAffectedResourcesArgument("Alert");

    expect(incident?.id).toBe(AFFECTED_RESOURCES_ARGUMENT_ID);
    expect(incident?.name).toBe("Affected Resources");
    expect(incident?.description).toBe(
      "Names, addresses or IDs of the hosts, network devices, clusters, databases or services this incident is about, separated by commas. Each one found is linked. Monitors go in JSON Object.",
    );
    expect(alert?.description).toBe(
      "Names, addresses or IDs of the hosts, network devices, clusters, databases or services this alert is about, separated by commas. Each one found is linked. Monitors go in JSON Object.",
    );
  });

  test("is not a setting of any other table's step", () => {
    expect(getAffectedResourcesArgument("Monitor")).toBeNull();
    expect(getAffectedResourcesArgument(undefined)).toBeNull();
  });
});

describe("marking a word changes nothing a workflow reads", () => {
  test("titles, groups and names read as they always did", () => {
    expect(stepOf(ComponentID.SlackSendMessageToChannel).title).toBe(
      "Send Message to Slack",
    );
    expect(stepOf(ComponentID.SlackSendMessageToChannel).category).toBe(
      "Slack",
    );
    expect(stepOf(ComponentID.ApiPost).title).toBe("API Post (JSON)");
    expect(
      returnValueOf(stepOf(ComponentID.ApiPost), "response-status").name,
    ).toBe("Response Status");
    expect(
      argumentOf(stepOf(ComponentID.IRCSendMessageToChannel), "server").name,
    ).toBe("IRC Server");
  });
});
