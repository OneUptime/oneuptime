import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import HuntressConnectionService, {
  Service as HuntressConnectionServiceType,
} from "../../../Server/Services/HuntressConnectionService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import { HUNTRESS_MAX_WATCHED_ORGANIZATIONS } from "../../../Types/Huntress/HuntressOrganizationFilter";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import crypto from "crypto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * What a Huntress connection may be saved as. The signing secret is
 * write-only, so the service decides "Signing Secret Saved" from it and keeps
 * a saved secret when an edit sends none; settings the webhook could not use
 * are refused while the person typing them is still looking; and every
 * on-call policy, label and severity it names must be its project's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OWN_POLICY_ID: string = "22222222-2222-4222-8222-222222222221";
const FOREIGN_POLICY_ID: string = "22222222-2222-4222-8222-222222222299";
const SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;

interface ConnectionHooks {
  onBeforeCreate(
    createBy: CreateBy<HuntressConnection>,
  ): Promise<OnCreate<HuntressConnection>>;
  onBeforeUpdate(
    updateBy: UpdateBy<HuntressConnection>,
  ): Promise<OnUpdate<HuntressConnection>>;
  onUpdateSuccess(
    onUpdate: OnUpdate<HuntressConnection>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<HuntressConnection>>;
}

const hooks: ConnectionHooks =
  HuntressConnectionService as unknown as ConnectionHooks;

function connection(
  overrides: Partial<HuntressConnection> = {},
): HuntressConnection {
  const model: HuntressConnection = new HuntressConnection();
  model.projectId = PROJECT_ID;
  model.name = "Huntress";
  Object.assign(model, overrides);
  return model;
}

async function create(
  overrides: Partial<HuntressConnection> = {},
): Promise<HuntressConnection> {
  const result: OnCreate<HuntressConnection> = await hooks.onBeforeCreate({
    data: connection(overrides),
    props: { isRoot: true, tenantId: PROJECT_ID },
  });

  return result.createBy.data;
}

async function beforeUpdate(
  data: JSONObject,
): Promise<OnUpdate<HuntressConnection>> {
  return await hooks.onBeforeUpdate({
    query: { _id: "33333333-3333-4333-8333-333333333333" },
    data: data as never,
    props: { isRoot: true, tenantId: PROJECT_ID },
    limit: 1,
    skip: 0,
  });
}

async function update(data: JSONObject): Promise<JSONObject> {
  const result: OnUpdate<HuntressConnection> = await beforeUpdate(data);

  return result.updateBy.data as unknown as JSONObject;
}

beforeEach(() => {
  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: { OnCallDutyPolicy: [OWN_POLICY_ID] },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("HuntressConnectionService", () => {
  test("holds its references to the project, like every service whose records name another", () => {
    expect(HuntressConnectionService).toBeInstanceOf(ProjectReferencesService);
  });

  describe("the signing secret on create", () => {
    test("a connection made without one says so", async () => {
      const data: HuntressConnection = await create();

      expect(data.isSigningSecretSet).toBe(false);
      expect(data.signingSecret).toBeUndefined();
    });

    test("a pasted secret is saved trimmed, and marked saved", async () => {
      const data: HuntressConnection = await create({
        signingSecret: `  ${SECRET}\n`,
      });

      expect(data.signingSecret).toBe(SECRET);
      expect(data.isSigningSecretSet).toBe(true);
    });

    test("an empty secret is no secret", async () => {
      const data: HuntressConnection = await create({ signingSecret: "   " });

      expect(data.signingSecret).toBeUndefined();
      expect(data.isSigningSecretSet).toBe(false);
    });

    test("a request cannot claim a secret is saved when none is", async () => {
      const data: HuntressConnection = await create({
        isSigningSecretSet: true,
      });

      expect(data.isSigningSecretSet).toBe(false);
    });

    test.each([
      ["the webhook URL", "https://oneuptime.com/api/huntress/webhook/abc"],
      ["a truncated secret", "whsec_abc"],
      ["an API key", "hk_live_1234567890"],
    ])(
      "pasting %s is refused, saying where the secret is",
      async (_name: string, value: string) => {
        await expect(create({ signingSecret: value })).rejects.toThrow(
          new BadDataException(
            HuntressConnectionServiceType.SIGNING_SECRET_PROBLEM,
          ),
        );
        expect(HuntressConnectionServiceType.SIGNING_SECRET_PROBLEM).toBe(
          "The signing secret is not one Huntress issues. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret and copy all of it. It starts with whsec_.",
        );
      },
    );

    test("a secret that is not text is refused", async () => {
      await expect(
        create({ signingSecret: 42 as unknown as string }),
      ).rejects.toThrow(HuntressConnectionServiceType.SIGNING_SECRET_PROBLEM);
    });
  });

  describe("the signing secret on update", () => {
    test("a new secret is saved and marked saved", async () => {
      expect(await update({ signingSecret: ` ${SECRET} ` })).toEqual({
        signingSecret: SECRET,
        isSigningSecretSet: true,
      });
    });

    test("an empty secret sent with other changes keeps the saved one", async () => {
      expect(
        await update({ name: "Huntress (Acme MSP)", signingSecret: "" }),
      ).toEqual({
        name: "Huntress (Acme MSP)",
      });
    });

    test("an edit that names no secret leaves the saved one and its flag alone", async () => {
      expect(await update({ name: "Renamed" })).toEqual({ name: "Renamed" });
    });

    test("a request cannot mark a secret saved by itself", async () => {
      expect(
        await update({ name: "Renamed", isSigningSecretSet: true }),
      ).toEqual({ name: "Renamed" });

      await expect(update({ isSigningSecretSet: false })).rejects.toThrow(
        "Signing Secret Saved follows the signing secret. Save a signing secret instead.",
      );
    });

    test("an empty secret and nothing else asks for the secret", async () => {
      await expect(update({ signingSecret: "" })).rejects.toThrow(
        "Paste the endpoint's signing secret from Huntress to save it.",
      );
      await expect(update({ signingSecret: null })).rejects.toThrow(
        "Paste the endpoint's signing secret from Huntress to save it.",
      );
    });

    test("an invalid secret is refused", async () => {
      await expect(update({ signingSecret: "nope" })).rejects.toThrow(
        HuntressConnectionServiceType.SIGNING_SECRET_PROBLEM,
      );
    });
  });

  describe("Page On-Call For", () => {
    test.each([
      HuntressSeverity.Critical,
      HuntressSeverity.High,
      HuntressSeverity.Low,
    ])("%s is saved", async (severity: HuntressSeverity) => {
      expect((await create({ pageOnCallFor: severity })).pageOnCallFor).toBe(
        severity,
      );
      expect(await update({ pageOnCallFor: severity })).toEqual({
        pageOnCallFor: severity,
      });
    });

    test("left out, the column's default (high) applies", async () => {
      expect((await create()).pageOnCallFor).toBeUndefined();
    });

    test.each(["medium", "High", "", null])(
      "%p is refused",
      async (value: string | null) => {
        await expect(
          create({ pageOnCallFor: value as unknown as HuntressSeverity }),
        ).rejects.toThrow("Page On-Call For must be critical, high or low.");
        await expect(update({ pageOnCallFor: value })).rejects.toThrow(
          "Page On-Call For must be critical, high or low.",
        );
      },
    );
  });

  describe("the organizations it watches", () => {
    test("a list of names and ids is saved as typed", async () => {
      expect(
        (await create({ watchedOrganizations: "Acme Corp\n1234\n" }))
          .watchedOrganizations,
      ).toBe("Acme Corp\n1234\n");
    });

    test("an empty list watches every organization", async () => {
      expect(await update({ watchedOrganizations: null })).toEqual({
        watchedOrganizations: null,
      });
    });

    test(`more than ${HUNTRESS_MAX_WATCHED_ORGANIZATIONS} organizations are refused`, async () => {
      const lines: Array<string> = [];

      for (
        let index: number = 0;
        index <= HUNTRESS_MAX_WATCHED_ORGANIZATIONS;
        index++
      ) {
        lines.push(`Org ${index}`);
      }

      await expect(
        create({ watchedOrganizations: lines.join("\n") }),
      ).rejects.toThrow(
        `List at most ${HUNTRESS_MAX_WATCHED_ORGANIZATIONS} organizations, one per line.`,
      );
    });

    test("organizations not sent as text are refused", async () => {
      await expect(update({ watchedOrganizations: ["Acme"] })).rejects.toThrow(
        "Only These Organizations must be text: one organization name or id per line.",
      );
    });
  });

  /*
   * A refusal recorded before the secret was saved ("no signing secret is
   * saved", a signature that did not match) is about a secret that is gone:
   * saving one starts the connection over, waiting for Huntress.
   */
  describe("saving a new signing secret clears the last refusal", () => {
    const CONNECTION_IDS: Array<ObjectID> = [
      new ObjectID("33333333-3333-4333-8333-333333333333"),
    ];

    let updateOneById: SpyInstance<
      typeof HuntressConnectionService.updateOneById
    >;

    beforeEach(() => {
      updateOneById = jest
        .spyOn(HuntressConnectionService, "updateOneById")
        .mockResolvedValue(undefined as never);
    });

    test("an update with a new secret says so to the next hook", async () => {
      expect(
        (await beforeUpdate({ signingSecret: SECRET })).carryForward,
      ).toEqual({ signingSecretSaved: true });
    });

    test("an update that keeps the saved secret says it did not change", async () => {
      expect(
        (await beforeUpdate({ name: "Acme", signingSecret: "" })).carryForward,
      ).toEqual({ signingSecretSaved: false });
      expect((await beforeUpdate({ name: "Acme" })).carryForward).toEqual({
        signingSecretSaved: false,
      });
    });

    test("after a new secret is saved, the refusal it fixed is cleared, as the server", async () => {
      const onUpdate: OnUpdate<HuntressConnection> = await beforeUpdate({
        signingSecret: SECRET,
      });

      await hooks.onUpdateSuccess(onUpdate, CONNECTION_IDS);

      expect(updateOneById).toHaveBeenCalledTimes(1);
      expect(updateOneById.mock.calls[0]![0]).toEqual({
        id: CONNECTION_IDS[0],
        data: { lastError: null, lastErrorAt: null },
        props: { isRoot: true, ignoreHooks: true },
      });
    });

    test("any other edit leaves the last refusal for the webhook to clear", async () => {
      const onUpdate: OnUpdate<HuntressConnection> = await beforeUpdate({
        name: "Acme",
      });

      await hooks.onUpdateSuccess(onUpdate, CONNECTION_IDS);

      expect(updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("references", () => {
    test("the project's own on-call policy is accepted", async () => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = OWN_POLICY_ID;

      const data: HuntressConnection = await create({
        onCallDutyPolicies: [policy],
      });

      expect(data.onCallDutyPolicies).toHaveLength(1);
    });

    test("another project's on-call policy is refused", async () => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = FOREIGN_POLICY_ID;

      await expect(create({ onCallDutyPolicies: [policy] })).rejects.toThrow(
        FOREIGN_POLICY_ID,
      );
    });
  });
});
