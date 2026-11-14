import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  Service,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AmazonSesAuthenticationType from "../../../Types/Email/AmazonSesAuthenticationType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW THE SERVER'S OWN AMAZON SES SIGNS IN, AS GLOBALCONFIG TAKES IT
 * (#7000; Types/Email/AmazonSesAuthenticationType.ts):
 *
 *   - a write may set the Authentication Type to an access key or the
 *     server's IAM role, or empty for none - an access key, as every server
 *     signed in before there was a choice; anything else is refused with
 *     what it may be, on create and on update alike, before anything is
 *     written;
 *   - a write that picks the server's IAM role clears the stored access key
 *     in the same write, whatever key it carries: a key nothing uses any
 *     more is only one more to leak;
 *   - a write that picks an access key, or leaves the type alone, keeps the
 *     key it writes.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET_ACCESS_KEY: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

const makeUpdateBy: (
  data: Record<string, unknown>,
) => UpdateBy<GlobalConfig> = (
  data: Record<string, unknown>,
): UpdateBy<GlobalConfig> => {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data,
    limit: 1,
    skip: 0,
    props: MASTER_ADMIN_PROPS,
  } as unknown as UpdateBy<GlobalConfig>;
};

const makeCreateBy: (
  data: Record<string, unknown>,
) => CreateBy<GlobalConfig> = (
  data: Record<string, unknown>,
): CreateBy<GlobalConfig> => {
  const model: GlobalConfig = new GlobalConfig();
  model.id = ObjectID.getZeroObjectID();
  Object.assign(model, data);

  return {
    data: model,
    props: MASTER_ADMIN_PROPS,
  } as unknown as CreateBy<GlobalConfig>;
};

// What an update writes, after the hook.
const updated: (
  data: Record<string, unknown>,
) => Promise<Record<string, unknown>> = async (
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const result: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
    makeUpdateBy(data),
  );

  return result.updateBy.data as unknown as Record<string, unknown>;
};

// What a create writes, after the hook.
const created: (
  data: Record<string, unknown>,
) => Promise<GlobalConfig> = async (
  data: Record<string, unknown>,
): Promise<GlobalConfig> => {
  const result: OnCreate<GlobalConfig> = await hooks.onBeforeCreate(
    makeCreateBy(data),
  );

  return result.createBy.data;
};

const REFUSAL: string =
  'Amazon SES\'s Authentication Type must be "Access Key" or "Server IAM Role".';

describe("picking the server's IAM role", () => {
  test("clears the stored access key in the same write", async () => {
    const data: Record<string, unknown> = await updated({
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
    });

    expect(data).toEqual({
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
      amazonSesAccessKeyId: null,
      amazonSesSecretAccessKey: null,
    });
  });

  test("never keeps a key written alongside it", async () => {
    const data: Record<string, unknown> = await updated({
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesAccessKeyId: ACCESS_KEY_ID,
      amazonSesSecretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(data["amazonSesAccessKeyId"]).toBeNull();
    expect(data["amazonSesSecretAccessKey"]).toBeNull();
  });

  test("on create too", async () => {
    const model: GlobalConfig = await created({
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesAccessKeyId: ACCESS_KEY_ID,
      amazonSesSecretAccessKey: SECRET_ACCESS_KEY,
      amazonSesRegion: "us-east-1",
    });

    expect(model.amazonSesAuthenticationType).toBe(
      AmazonSesAuthenticationType.ServerIamRole,
    );
    expect(model.amazonSesAccessKeyId).toBeNull();
    expect(model.amazonSesSecretAccessKey).toBeNull();
    expect(model.amazonSesRegion).toBe("us-east-1");
  });
});

describe("an access key, or no choice written", () => {
  test("picking an access key keeps the key it writes", async () => {
    const data: Record<string, unknown> = await updated({
      amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
      amazonSesAccessKeyId: ACCESS_KEY_ID,
      amazonSesSecretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(data).toEqual({
      amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
      amazonSesAccessKeyId: ACCESS_KEY_ID,
      amazonSesSecretAccessKey: SECRET_ACCESS_KEY,
    });
  });

  test("a write that leaves the choice alone - a key rotated over the API - is written as it is", async () => {
    const data: Record<string, unknown> = await updated({
      amazonSesAccessKeyId: ACCESS_KEY_ID,
      amazonSesSecretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(data).toEqual({
      amazonSesAccessKeyId: ACCESS_KEY_ID,
      amazonSesSecretAccessKey: SECRET_ACCESS_KEY,
    });

    const model: GlobalConfig = await created({
      amazonSesAccessKeyId: ACCESS_KEY_ID,
      amazonSesSecretAccessKey: SECRET_ACCESS_KEY,
    });

    expect(model.amazonSesAuthenticationType).toBeUndefined();
    expect(model.amazonSesAccessKeyId).toBe(ACCESS_KEY_ID);
  });

  test("an empty choice is none - an access key, as before - and keeps the key", async () => {
    const data: Record<string, unknown> = await updated({
      amazonSesAuthenticationType: "",
      amazonSesAccessKeyId: ACCESS_KEY_ID,
    });

    expect(data).toEqual({
      amazonSesAuthenticationType: null,
      amazonSesAccessKeyId: ACCESS_KEY_ID,
    });

    const cleared: Record<string, unknown> = await updated({
      amazonSesAuthenticationType: null,
    });

    expect(cleared).toEqual({ amazonSesAuthenticationType: null });
  });
});

describe("anything else", () => {
  test.each([
    ["a sign-in it does not know", "Instance Profile"],
    ["an answer in the wrong case", "server iam role"],
    ["a number", 1],
    ["a list", [AmazonSesAuthenticationType.ServerIamRole]],
  ])(
    "%s is refused with what it may be, on update and on create, before the key is touched",
    async (_label: string, value: unknown) => {
      const data: Record<string, unknown> = {
        amazonSesAuthenticationType: value,
        amazonSesAccessKeyId: ACCESS_KEY_ID,
      };

      await expect(hooks.onBeforeUpdate(makeUpdateBy(data))).rejects.toThrow(
        new BadDataException(REFUSAL),
      );
      expect(data["amazonSesAccessKeyId"]).toBe(ACCESS_KEY_ID);

      await expect(hooks.onBeforeCreate(makeCreateBy(data))).rejects.toThrow(
        new BadDataException(REFUSAL),
      );
    },
  );

  test("the rule alone, as both hooks run it", () => {
    const untouched: Record<string, unknown> = { amazonSesRegion: "us-east-1" };

    Service.applyAmazonSesAuthenticationRules(untouched);
    expect(untouched).toEqual({ amazonSesRegion: "us-east-1" });

    expect(() => {
      Service.applyAmazonSesAuthenticationRules({
        amazonSesAuthenticationType: "IAM Role",
      });
    }).toThrow(BadDataException);
  });
});
