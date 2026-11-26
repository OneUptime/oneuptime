import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import Route from "../../../../Types/API/Route";
import RecordActorType from "../../../../Types/Database/RecordActor";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import {
  RecordActivity,
  RecordActivityActor,
} from "../../../../UI/Components/Detail/DetailRecordActivity";
import DetailRecordLine, {
  getRecordActorText,
} from "../../../../UI/Components/Detail/DetailRecordLine";
import {
  RecordTime,
  RecordTimeKind,
} from "../../../../UI/Components/Detail/DetailRecordTime";
import {
  getGlobalTranslator,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";

/*
 * THE RECORD LINE SAYS WHO CREATED THE RECORD AND WHO LAST MODIFIED IT
 * (#10290).
 *
 *   ID dafafe92…  Created by Nawaz Dhandala · Sep 30, 2026, 14:25 BST
 *   Last modified by Terraform (API key) · Nov 19, 2026, 09:12 GMT  History
 *
 * Drawn for each kind of "who" - a person, an API key, a workflow, an MCP
 * client, a server admin, OneUptime itself - and with what is missing left
 * out: never a person in place of a key or a workflow, never "someone" for
 * what nobody recorded.
 */

const RECORD_ID: string = "dafafe92-41c3-4f0e-9a8b-2c7d5e1f3a60";
const CREATED: Date = new Date("2026-09-30T13:25:13.000Z");
const MODIFIED: Date = new Date("2026-11-19T09:12:00.000Z");
const UPDATED: Date = new Date("2026-11-20T08:00:00.000Z");

const CREATED_TIME: RecordTime = {
  kind: RecordTimeKind.Created,
  date: CREATED,
};
const UPDATED_TIME: RecordTime = {
  kind: RecordTimeKind.Updated,
  date: UPDATED,
};

let previousTimezone: Timezone | null = null;

beforeEach(() => {
  previousTimezone = OneUptimeDate.getUserTimezone();
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(previousTimezone);
  jest.restoreAllMocks();
});

function pieces(): Array<string> {
  return Array.from(screen.getByTestId("detail-record-line").children).map(
    (child: Element): string => {
      return child.getAttribute("data-testid") || child.tagName;
    },
  );
}

function activity(data: {
  createdBy?: RecordActivityActor | null;
  createdAt?: Date | null;
  modifiedBy?: RecordActivityActor | null;
  modifiedAt?: Date | null;
}): RecordActivity {
  const createdAt: Date | null =
    data.createdAt === undefined ? CREATED : data.createdAt;

  return {
    created:
      createdAt || data.createdBy
        ? { at: createdAt, by: data.createdBy || null }
        : null,
    lastModified: data.modifiedAt
      ? { at: data.modifiedAt, by: data.modifiedBy || null }
      : null,
  };
}

function createdActor(): HTMLElement {
  return screen.getByTestId("detail-created-by-actor");
}

function modifiedActor(): HTMLElement {
  return screen.getByTestId("detail-last-modified-by-actor");
}

describe("who created a record", () => {
  test("a person: by their name, then when", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        activity={activity({
          createdBy: {
            type: RecordActorType.User,
            personName: "Nawaz Dhandala",
          },
        })}
      />,
    );

    expect(pieces()).toEqual(["detail-id-line", "detail-created-by"]);
    expect(screen.getByTestId("detail-created-by")).toHaveTextContent(
      "Created by Nawaz Dhandala·Sep 30, 2026, 14:25 BST",
    );
    expect(createdActor()).toHaveAttribute("data-actor-type", "User");
    expect(screen.getByTestId("detail-created-by-at")).toHaveAttribute(
      "dateTime",
      CREATED.toISOString(),
    );
  });

  test("an API key: by its own name, said to be a key - never a person", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdBy: {
            type: RecordActorType.ApiKey,
            actorId: "0193c0de-eeee-4aaa-8bbb-0000000000a1",
            actorName: "Terraform",
          },
        })}
      />,
    );

    expect(createdActor()).toHaveTextContent("Terraform (API key)");
    expect(createdActor()).toHaveAttribute("data-actor-type", "ApiKey");
  });

  test("an API key the reader may not read: its kind alone", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdBy: {
            type: RecordActorType.ApiKey,
            actorId: "0193c0de-eeee-4aaa-8bbb-0000000000a1",
          },
        })}
      />,
    );

    expect(createdActor()).toHaveTextContent(/^API key$/);
  });

  test("a workflow: by its own name, said to be a workflow - never a person", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdBy: {
            type: RecordActorType.Workflow,
            actorId: "0193c0de-eeee-4aaa-8bbb-0000000000c1",
            actorName: "Nightly import",
          },
        })}
      />,
    );

    expect(createdActor()).toHaveTextContent("Nightly import (workflow)");
    expect(createdActor()).toHaveAttribute("data-actor-type", "Workflow");
  });

  test("a workflow the reader may not read: its kind alone", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdBy: { type: RecordActorType.Workflow },
        })}
      />,
    );

    expect(createdActor()).toHaveTextContent(/^Workflow$/);
  });

  test("OneUptime itself: OneUptime", () => {
    render(
      <DetailRecordLine
        activity={activity({ createdBy: { type: RecordActorType.System } })}
      />,
    );

    expect(screen.getByTestId("detail-created-by")).toHaveTextContent(
      "Created by OneUptime·Sep 30, 2026, 14:25 BST",
    );
  });

  test("an MCP client, for its member: the member, and that a client did it", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdBy: {
            type: RecordActorType.McpClient,
            actorId: "0193c0de-eeee-4aaa-8bbb-0000000000d1",
            personName: "Simon Larsen",
          },
        })}
      />,
    );

    expect(createdActor()).toHaveTextContent("Simon Larsen via an MCP client");
  });

  test("a server admin: the admin, said to be one", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdBy: {
            type: RecordActorType.MasterAdmin,
            personName: "Ada Lovelace",
          },
        })}
      />,
    );

    expect(createdActor()).toHaveTextContent("Ada Lovelace (Master Admin)");
  });

  test("a person no longer in OneUptime: a deleted user, not a blank", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdBy: { type: RecordActorType.User, isPersonGone: true },
        })}
      />,
    );

    expect(createdActor()).toHaveTextContent("Deleted user");
  });

  test("nobody known: when, as the line always said, and no who", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        activity={activity({ createdBy: null })}
      />,
    );

    expect(pieces()).toEqual(["detail-id-line", "detail-created-at"]);
    expect(screen.getByTestId("detail-created-at")).toHaveTextContent(
      "CreatedSep 30, 2026, 14:25 BST",
    );
    expect(screen.queryByTestId("detail-created-by")).toBeNull();
  });

  test("the card's own Created time stands in for a read that had none", () => {
    render(
      <DetailRecordLine
        times={[CREATED_TIME]}
        activity={activity({
          createdAt: null,
          createdBy: { type: RecordActorType.User, personName: "Ada" },
        })}
      />,
    );

    expect(screen.getByTestId("detail-created-by")).toHaveTextContent(
      "Created by Ada·Sep 30, 2026, 14:25 BST",
    );
    // Said once, not as "Created" too.
    expect(screen.queryByTestId("detail-created-at")).toBeNull();
  });

  test("who without when: no dot and no time", () => {
    render(
      <DetailRecordLine
        activity={activity({
          createdAt: null,
          createdBy: { type: RecordActorType.System },
        })}
      />,
    );

    expect(screen.getByTestId("detail-created-by")).toHaveTextContent(
      /^Created by OneUptime$/,
    );
    expect(screen.queryByTestId("detail-created-by-at")).toBeNull();
  });
});

describe("who last modified a record", () => {
  test("follows who created it, with its own icon and time", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        activity={activity({
          createdBy: { type: RecordActorType.User, personName: "Nawaz" },
          modifiedAt: MODIFIED,
          modifiedBy: {
            type: RecordActorType.ApiKey,
            actorName: "Terraform",
          },
        })}
      />,
    );

    expect(pieces()).toEqual([
      "detail-id-line",
      "detail-created-by",
      "detail-last-modified-by",
    ]);
    expect(screen.getByTestId("detail-last-modified-by")).toHaveTextContent(
      "Last modified by Terraform (API key)·Nov 19, 2026, 09:12 GMT",
    );
    expect(
      screen.getByTestId("detail-last-modified-by").querySelectorAll("svg"),
    ).toHaveLength(1);
  });

  test("takes the place of Updated, which OneUptime's own writes move", () => {
    render(
      <DetailRecordLine
        times={[CREATED_TIME, UPDATED_TIME]}
        activity={activity({
          modifiedAt: MODIFIED,
          modifiedBy: { type: RecordActorType.User, personName: "Simon" },
        })}
      />,
    );

    expect(screen.queryByTestId("detail-updated-at")).toBeNull();
    expect(modifiedActor()).toHaveTextContent("Simon");
  });

  test("never modified since it was created, or not since this was kept: the card's Updated stays", () => {
    render(
      <DetailRecordLine
        times={[CREATED_TIME, UPDATED_TIME]}
        activity={activity({})}
      />,
    );

    expect(pieces()).toEqual(["detail-created-at", "detail-updated-at"]);
    expect(screen.queryByTestId("detail-last-modified-by")).toBeNull();
  });

  test("a time with nobody named: Last modified, and when", () => {
    render(
      <DetailRecordLine
        activity={activity({ createdAt: null, modifiedAt: MODIFIED })}
      />,
    );

    expect(screen.getByTestId("detail-last-modified-by")).toHaveTextContent(
      "Last modified·Nov 19, 2026, 09:12 GMT",
    );
    expect(screen.queryByTestId("detail-last-modified-by-actor")).toBeNull();
  });
});

describe("the record's history", () => {
  test("a link to it ends the line, where the front end has one for this reader", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        activity={activity({
          createdBy: { type: RecordActorType.User, personName: "Nawaz" },
        })}
        historyRoute={new Route("/dashboard/p/monitors/m/audit-logs")}
      />,
    );

    const link: HTMLElement = screen.getByTestId("detail-record-history");

    expect(pieces()[pieces().length - 1]).toBe("detail-record-history");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/dashboard/p/monitors/m/audit-logs");
    expect(within(link).getByText("History")).toBeInTheDocument();
  });

  test("no link where there is none", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        activity={activity({})}
        historyRoute={null}
      />,
    );

    expect(screen.queryByTestId("detail-record-history")).toBeNull();
  });
});

describe("the line as it was, where the read says nothing", () => {
  test("no activity at all: ID, Created, Updated, exactly as before", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        times={[CREATED_TIME, UPDATED_TIME]}
      />,
    );

    expect(pieces()).toEqual([
      "detail-id-line",
      "detail-created-at",
      "detail-updated-at",
    ]);
  });

  test("an activity with nothing in it: the ID alone", () => {
    render(
      <DetailRecordLine
        recordId={RECORD_ID}
        activity={{ created: null, lastModified: null }}
      />,
    );

    expect(pieces()).toEqual(["detail-id-line"]);
  });
});

describe("who acted, in words", () => {
  const translator: Translator = getGlobalTranslator();

  test.each([
    [{ type: RecordActorType.User, personName: "Nawaz" }, "Nawaz"],
    [{ type: RecordActorType.User, isPersonGone: true }, "Deleted user"],
    [{ type: RecordActorType.ApiKey, actorName: "CI" }, "CI (API key)"],
    [{ type: RecordActorType.ApiKey }, "API key"],
    [{ type: RecordActorType.Workflow, actorName: "Sync" }, "Sync (workflow)"],
    [{ type: RecordActorType.Workflow }, "Workflow"],
    [
      { type: RecordActorType.McpClient, personName: "Simon" },
      "Simon via an MCP client",
    ],
    [{ type: RecordActorType.McpClient }, "An MCP client"],
    [
      { type: RecordActorType.MasterAdmin, personName: "Ada" },
      "Ada (Master Admin)",
    ],
    [{ type: RecordActorType.MasterAdmin }, "Master Admin"],
    [{ type: RecordActorType.System }, "OneUptime"],
  ])("%p reads %p", (actor: RecordActivityActor, words: string) => {
    expect(getRecordActorText(actor, translator)).toBe(words);
  });

  test("a person's name is never what an API key or a workflow is called", () => {
    expect(
      getRecordActorText(
        { type: RecordActorType.ApiKey, personName: "Nawaz" },
        translator,
      ),
    ).toBe("API key");
    expect(
      getRecordActorText(
        { type: RecordActorType.Workflow, personName: "Nawaz" },
        translator,
      ),
    ).toBe("Workflow");
  });
});
