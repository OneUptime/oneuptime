jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../../Server/Services/WorkflowService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { drawHuntressSigningSecret } from "../../Types/Huntress/HuntressWebhookFixtures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A workflow's webhook signing secret - the endpoint's secret Huntress signs
 * its requests with - as WorkflowService writes it: checked when written, so
 * what is stored can verify a request; write-only, with
 * isWebhookSigningSecretSet following it whatever a request says; an empty
 * one on an edit keeps the saved one (a form never has it to send back);
 * and a new one clears the refusal the old one left.
 *
 * Nobody may write isWebhookSigningSecretSet, so the server writes it in
 * onCreatePermitted / onUpdatePermitted, after the caller's column checks:
 * what onBeforeCreate / onBeforeUpdate leave is never held against them.
 *
 * The hooks are called as DatabaseService calls them, in its order;
 * WorkflowSigningSecretAsMember.test.ts runs the whole write as the members
 * who make it, and the database itself is HuntressPostgres.test.ts's.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
);

const random: SeededRandom = seededRandom(5310);

function svixSecret(): string {
  return drawHuntressSigningSecret(random);
}

interface Hooks {
  onBeforeCreate: (createBy: CreateBy<Workflow>) => Promise<OnCreate<Workflow>>;
  onCreatePermitted: (onCreate: OnCreate<Workflow>) => Promise<void>;
  onBeforeUpdate: (updateBy: UpdateBy<Workflow>) => Promise<OnUpdate<Workflow>>;
  onUpdatePermitted: (updateBy: UpdateBy<Workflow>) => Promise<void>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<Workflow>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<Workflow>>;
}

// The protected hooks, as DatabaseService calls them.
const hooks: Hooks = WorkflowService as unknown as Hooks;

let cleared: Array<{
  id: string;
  data: JSONObject;
  skip: boolean | undefined;
}>;

beforeEach(() => {
  cleared = [];

  jest
    .spyOn(WorkflowService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (updateBy: {
      id: ObjectID;
      data: JSONObject;
      skipUpdateDateColumn?: boolean;
    }): Promise<void> => {
      cleared.push({
        id: updateBy.id.toString(),
        data: updateBy.data,
        skip: updateBy.skipUpdateDateColumn,
      });
    }) as never);

  // The workflow service is told of every saved workflow: not here.
  jest.spyOn(API, "post").mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function create(secret: unknown): Promise<Workflow> {
  const workflow: Workflow = new Workflow();
  workflow.name = "Huntress";

  if (secret !== undefined) {
    (workflow as unknown as JSONObject)["webhookSigningSecret"] =
      secret as never;
  }

  // A request may say a secret is saved: only the secret decides.
  workflow.isWebhookSigningSecretSet = true;

  const result: OnCreate<Workflow> = await hooks.onBeforeCreate({
    data: workflow,
    props: { isRoot: true },
  });

  // What the caller's column checks are held to: no word of the flag.
  expect(
    Object.prototype.hasOwnProperty.call(
      result.createBy.data,
      "isWebhookSigningSecretSet",
    ),
  ).toBe(false);

  await hooks.onCreatePermitted(result);

  return result.createBy.data;
}

async function update(data: JSONObject): Promise<OnUpdate<Workflow>> {
  return await hooks.onBeforeUpdate({
    query: { _id: WORKFLOW_ID.toString() },
    data: data as never,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  });
}

describe("reading a pasted secret", () => {
  test("one Huntress issues is kept, trimmed", () => {
    const secret: string = svixSecret();

    expect(WorkflowServiceClass.readWebhookSigningSecret(`  ${secret}\n`)).toBe(
      secret,
    );
  });

  test("none at all is none", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(WorkflowServiceClass.readWebhookSigningSecret(value)).toBeNull();
    }
  });

  test.each([
    ["a URL", "https://oneuptime.com/workflow/huntress/abc"],
    ["one cut short", "whsec_abc"],
    ["a number", 42],
    ["an object", { secret: "whsec_x" }],
  ])(
    "%s is refused, saying what to copy instead",
    (_name: string, value: unknown) => {
      expect(() => {
        WorkflowServiceClass.readWebhookSigningSecret(value);
      }).toThrow(
        new BadDataException(WorkflowServiceClass.SIGNING_SECRET_PROBLEM),
      );
      expect(WorkflowServiceClass.SIGNING_SECRET_PROBLEM).toContain(
        "View Signing Secret",
      );
    },
  );
});

describe("a workflow created", () => {
  test("with a secret saves it, and says one is saved", async () => {
    const secret: string = svixSecret();
    const data: Workflow = await create(` ${secret} `);

    expect(data.webhookSigningSecret).toBe(secret);
    expect(data.isWebhookSigningSecretSet).toBe(true);
  });

  test("without one says none is saved, whatever the request said", async () => {
    for (const secret of [undefined, ""]) {
      const data: Workflow = await create(secret);

      expect(data.webhookSigningSecret).toBeUndefined();
      expect(data.isWebhookSigningSecretSet).toBe(false);
    }
  });

  test("with one Huntress could not have issued is refused", async () => {
    await expect(create("not a secret")).rejects.toThrow(
      WorkflowServiceClass.SIGNING_SECRET_PROBLEM,
    );
  });
});

describe("a workflow edited", () => {
  test("with a new secret saves it, says so, and hands on that one was saved", async () => {
    const secret: string = svixSecret();
    const result: OnUpdate<Workflow> = await update({
      webhookSigningSecret: secret,
    });

    // What the caller's column checks are held to: the secret alone.
    expect(result.updateBy.data).toEqual({ webhookSigningSecret: secret });
    expect(result.carryForward).toEqual({ signingSecretSaved: true });

    // Then, once they have passed, the server says it is saved.
    await hooks.onUpdatePermitted(result.updateBy);

    expect(result.updateBy.data).toEqual({
      webhookSigningSecret: secret,
      isWebhookSigningSecretSet: true,
    });
  });

  test("with an empty secret and other changes keeps the saved secret", async () => {
    const result: OnUpdate<Workflow> = await update({
      webhookSigningSecret: "",
      description: "Pages the SOC.",
    });

    expect(result.updateBy.data).toEqual({ description: "Pages the SOC." });
    expect(result.carryForward).toEqual({ signingSecretSaved: false });

    await hooks.onUpdatePermitted(result.updateBy);

    expect(result.updateBy.data).toEqual({ description: "Pages the SOC." });
  });

  test("with only an empty secret says to paste one, rather than that nothing changed", async () => {
    await expect(update({ webhookSigningSecret: "  " })).rejects.toThrow(
      WorkflowServiceClass.EMPTY_SIGNING_SECRET_PROBLEM,
    );
  });

  test("never takes whether a secret is saved from the request", async () => {
    const result: OnUpdate<Workflow> = await update({
      isWebhookSigningSecretSet: true,
      name: "Renamed",
    });

    expect(result.updateBy.data).toEqual({ name: "Renamed" });

    await hooks.onUpdatePermitted(result.updateBy);

    expect(result.updateBy.data).toEqual({ name: "Renamed" });

    await expect(update({ isWebhookSigningSecretSet: false })).rejects.toThrow(
      WorkflowServiceClass.SIGNING_SECRET_SAVED_PROBLEM,
    );
  });

  test("a new secret clears the refusal the old one left, without touching Updated At", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { webhookSigningSecret: svixSecret() },
          props: { isRoot: true },
        } as unknown as UpdateBy<Workflow>,
        carryForward: { signingSecretSaved: true },
      },
      [WORKFLOW_ID],
    );

    expect(cleared).toEqual([
      {
        id: WORKFLOW_ID.toString(),
        data: { lastWebhookError: null, lastWebhookErrorAt: null },
        skip: true,
      },
    ]);
  });

  test("an edit that saved no secret leaves the last refusal as it is", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { name: "Renamed" },
          props: { isRoot: true },
        } as unknown as UpdateBy<Workflow>,
        carryForward: { signingSecretSaved: false },
      },
      [WORKFLOW_ID],
    );

    expect(cleared).toEqual([]);
  });
});

describe("who may touch it", () => {
  const access: (column: string) => ColumnAccessControl | null = (
    column: string,
  ): ColumnAccessControl | null => {
    return new Workflow().getColumnAccessControlFor(column);
  };

  test("nobody reads the secret back: not even who may write it", () => {
    expect(access("webhookSigningSecret")?.read).toEqual([]);
    expect(access("webhookSigningSecret")?.update?.length).toBeGreaterThan(0);
  });

  test("whether one is saved, and what the last request did, are read by whoever reads the workflow; written by the server only", () => {
    const readers: string = JSON.stringify(
      [...(access("name")?.read || [])].sort(),
    );

    for (const column of [
      "isWebhookSigningSecretSet",
      "lastWebhookRequestAt",
      "lastWebhookError",
      "lastWebhookErrorAt",
    ]) {
      expect({
        column,
        readers: JSON.stringify([...(access(column)?.read || [])].sort()),
      }).toEqual({ column, readers });
    }

    /*
     * Whether one is saved too, as VMwareVCenter.isVCenterPasswordSet is:
     * so the API reference, the MCP tools and the Terraform provider show it
     * read-only, and a configuration never sets what only the secret
     * decides.
     */
    for (const column of [
      "isWebhookSigningSecretSet",
      "lastWebhookRequestAt",
      "lastWebhookError",
      "lastWebhookErrorAt",
    ]) {
      expect({
        column,
        create: access(column)?.create,
        update: access(column)?.update,
      }).toEqual({
        column,
        create: [],
        update: [],
      });
    }
  });

  test("the secret is encrypted where it is stored", () => {
    const workflow: Workflow = new Workflow();

    expect(
      workflow.getEncryptedColumns().columns.includes("webhookSigningSecret"),
    ).toBe(true);
  });
});
