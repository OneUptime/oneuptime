import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectCallSMSConfig from "../../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "../../../../../Models/DatabaseModels/ProjectSmtpConfig";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";

/*
 * A PROJECT'S TWILIO AUTH TOKEN AND MAIL SERVER CREDENTIALS ARE READ BY ITS
 * OWNERS AND ADMINS, AND BY A ROLE GIVEN THE CONFIG'S OWN READ PERMISSION,
 * ALONE (#7737).
 *
 * A project's Call and SMS configs and SMTP configs are in the API reference
 * and the Terraform provider now. Every member who may see the project's
 * settings reads a config: its name, its Account SID, its mail server's
 * address. Its credentials - the Twilio auth token, the mail server's
 * password and OAuth client secret, the email providers' keys - are read by
 * the project's owners and admins, and by a custom role with Read Call and
 * SMS or Read SMTP Config, alone. A read that selects one is refused for
 * anybody else, saying who may read it: an API key - Terraform's - that may
 * not read the token gets that error, never a record without the token,
 * which a plan would take for the token being removed.
 *
 * Driven through the real permission layer, no stubs, for a person and for
 * an API key.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

type ModelType = new () => DatabaseBaseModel;

interface Channel {
  name: string;
  modelType: ModelType;
  // Who reads the config: the model's own list.
  readers: Array<Permission>;
  // Who reads its credentials too.
  secretReaders: Array<Permission>;
  secrets: Array<string>;
  // Columns every reader reads.
  configuration: Record<string, boolean>;
}

const SETTINGS_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
];

const CHANNELS: Array<Channel> = [
  {
    name: "Call and SMS Config",
    modelType: ProjectCallSMSConfig,
    readers: [...SETTINGS_READERS, Permission.ReadProjectCallSMSConfig],
    secretReaders: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectCallSMSConfig,
    ],
    secrets: ["twilioAuthToken"],
    configuration: {
      name: true,
      usedFor: true,
      twilioAccountSID: true,
      twilioPrimaryPhoneNumber: true,
      twilioSmsPhoneNumbers: true,
      isProjectDefault: true,
      isProjectDefaultForSms: true,
      isProjectDefaultForCalls: true,
    },
  },
  {
    name: "SMTP Config",
    modelType: ProjectSmtpConfig,
    readers: [...SETTINGS_READERS, Permission.ReadProjectSMTPConfig],
    secretReaders: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectSMTPConfig,
    ],
    secrets: [
      "password",
      "clientSecret",
      "amazonSesSecretAccessKey",
      "sendgridApiKey",
      "mailgunApiKey",
      "postmarkServerToken",
      "resendApiKey",
    ],
    configuration: {
      name: true,
      transportType: true,
      hostname: true,
      port: true,
      username: true,
      fromEmail: true,
      authType: true,
      clientId: true,
    },
  },
];

const CALLERS: Array<UserType> = [UserType.User, UserType.API];

function member(
  permissions: Array<Permission>,
  userType: UserType,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: userType === UserType.API ? undefined : ObjectID.generate(),
    userType: userType,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            } as UserPermission;
          },
        ),
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

async function read(
  channel: Channel,
  props: DatabaseCommonInteractionProps,
  select: Record<string, boolean>,
): Promise<unknown> {
  return await ModelPermission.checkReadQueryPermission(
    channel.modelType,
    {},
    select as never,
    props,
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to be refused, but it was allowed.");
}

function otherReaders(channel: Channel): Array<Permission> {
  return channel.readers.filter((permission: Permission): boolean => {
    return !channel.secretReaders.includes(permission);
  });
}

describe.each(CHANNELS)(
  "$name - who reads its credentials",
  (channel: Channel) => {
    test("the model's read lists are these", () => {
      const model: DatabaseBaseModel = new channel.modelType();

      expect([...model.getReadPermissions()].sort()).toEqual(
        [...channel.readers].sort(),
      );

      for (const secret of channel.secrets) {
        expect({
          column: secret,
          read: [
            ...(model.getColumnAccessControlFor(secret)?.read || []),
          ].sort(),
        }).toEqual({ column: secret, read: [...channel.secretReaders].sort() });
      }

      for (const column of Object.keys(channel.configuration)) {
        expect({
          column: column,
          read: [
            ...(model.getColumnAccessControlFor(column)?.read || []),
          ].sort(),
        }).toEqual({ column: column, read: [...channel.readers].sort() });
      }
    });

    test.each(CALLERS)(
      "every reader reads the configuration, as a %s",
      async (userType: UserType) => {
        for (const permission of channel.readers) {
          await expect(
            read(
              channel,
              member([permission], userType),
              channel.configuration,
            ),
          ).resolves.not.toThrow();
        }
      },
    );

    test.each(CALLERS)(
      "the owners, the admins and the config's own Read permission read each credential, as a %s",
      async (userType: UserType) => {
        for (const permission of channel.secretReaders) {
          for (const secret of channel.secrets) {
            await expect(
              read(channel, member([permission], userType), {
                ...channel.configuration,
                [secret]: true,
              }),
            ).resolves.not.toThrow();
          }
        }
      },
    );

    test.each(CALLERS)(
      "every other reader is refused each credential, told who may read it, as a %s",
      async (userType: UserType) => {
        expect(otherReaders(channel).length).toBeGreaterThan(0);

        for (const permission of otherReaders(channel)) {
          for (const secret of channel.secrets) {
            const error: unknown = await rejectionOf(
              read(channel, member([permission], userType), {
                ...channel.configuration,
                [secret]: true,
              }),
            );

            expect(error).toBeInstanceOf(NotAuthorizedException);
            expect((error as Error).message).toContain(
              `You do not have permissions to select on - ${secret}.`,
            );
            expect((error as Error).message).toContain("Project Owner");
          }
        }
      },
    );

    /*
     * What the narrower roles hold together is still no credential: the
     * project's member, its viewer and every settings role at once.
     */
    test("the narrower roles together read no credential", async () => {
      for (const secret of channel.secrets) {
        await expect(
          rejectionOf(
            read(channel, member(otherReaders(channel), UserType.API), {
              [secret]: true,
            }),
          ),
        ).resolves.toBeInstanceOf(NotAuthorizedException);
      }
    });
  },
);
