import MonitorService from "../../../Server/Services/MonitorService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import Encryption from "../../../Server/Utils/Encryption";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RECORD READ THROUGH A RELATION READS LIKE ONE READ BY ITSELF.
 *
 * Every status page SMS reads the page's Twilio config through the page -
 * `select: { callSmsConfig: { twilioAuthToken: true, ... } }` - and hands
 * ProjectCallSMSConfigService.toTwilioConfig what comes back. Only the
 * columns of the model read were decrypted, so once the auth token was
 * stored encrypted the senders were handed its ciphertext as the token,
 * and Twilio refused every SMS sent through a project's own config.
 *
 * DatabaseService.decrypt now decrypts the encrypted columns of every
 * record a read returns, joined ones included - one record or a list of
 * them - and leaves a value that is not our ciphertext (a token written
 * before its column was encrypted) as it is.
 *
 * No Postgres here: the service's repository is an in-memory table whose
 * rows hold the joined records as Postgres would hand them over, so the
 * real read path - permission check, find, decrypt - runs unchanged. The
 * opt-in Postgres suite (ProjectCallSMSConfigTokenEncryptionPostgres) runs
 * the same reads against real joins.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const CONFIG_ID: string = "33333333-3333-4333-8333-333333333333";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";
const TOKEN: string = "0123456789abcdef0123456789abcdef";
const SID: string = "AC0123456789abcdef0123456789abcde";

let encryptedToken: string;

beforeAll(async () => {
  encryptedToken = await Encryption.encrypt(TOKEN);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A status page row with its Twilio config joined in, as TypeORM hands a
 * relation over: an instance of the related model.
 */
function statusPageRow(twilioAuthToken: string): Record<string, unknown> {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.id = new ObjectID(CONFIG_ID);
  config.twilioAccountSID = SID;
  config.twilioAuthToken = twilioAuthToken;
  config.twilioPrimaryPhoneNumber = new Phone("+15551234567");

  return {
    _id: STATUS_PAGE_ID,
    projectId: PROJECT_ID,
    name: "Status",
    slug: "status",
    callSmsConfigId: CONFIG_ID,
    callSmsConfig: config,
    version: 1,
  };
}

async function readPageWithConfig(): Promise<StatusPage | null> {
  return await StatusPageService.findOneBy({
    query: { _id: STATUS_PAGE_ID },
    select: {
      callSmsConfig: {
        _id: true,
        twilioAccountSID: true,
        twilioAuthToken: true,
        twilioPrimaryPhoneNumber: true,
      },
    },
    props: { isRoot: true, ignoreHooks: true },
  });
}

describe("a record read through a relation", () => {
  test("holds its encrypted columns decrypted: a status page's Twilio token is the token", async () => {
    useInMemoryTable(StatusPageService, [statusPageRow(encryptedToken)]);

    expect(Encryption.looksEncrypted(encryptedToken)).toBe(true);

    const statusPage: StatusPage | null = await readPageWithConfig();

    expect(statusPage?.callSmsConfig?.twilioAuthToken).toBe(TOKEN);
    // A column that is not encrypted is left as it was.
    expect(statusPage?.callSmsConfig?.twilioAccountSID).toBe(SID);

    // What a status page's SMS is sent with.
    const twilioConfig: TwilioConfig | undefined =
      ProjectCallSMSConfigService.toTwilioConfig(statusPage!.callSmsConfig);
    expect(twilioConfig?.authToken).toBe(TOKEN);
  });

  test("a token still stored as plaintext reads as itself (the backfill has not run yet)", async () => {
    useInMemoryTable(StatusPageService, [statusPageRow(TOKEN)]);

    const statusPage: StatusPage | null = await readPageWithConfig();

    expect(statusPage?.callSmsConfig?.twilioAuthToken).toBe(TOKEN);
  });

  test("each record of a list relation is decrypted, not just the first", async () => {
    const passwords: Array<string> = ["first-vcenter-pass", "second-pass"];

    useInMemoryTable(MonitorService, [
      {
        _id: MONITOR_ID,
        projectId: PROJECT_ID,
        name: "Monitor",
        slug: "monitor",
        vmwareVCenters: await Promise.all(
          passwords.map(async (password: string, index: number) => {
            return {
              _id: ObjectID.generate().toString(),
              name: `vCenter ${index}`,
              vcenterPassword: await Encryption.encrypt(password),
            };
          }),
        ),
        version: 1,
      },
    ]);

    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: { _id: MONITOR_ID },
      select: {
        vmwareVCenters: { _id: true, vcenterPassword: true },
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(
      (monitor?.vmwareVCenters || []).map(
        (vcenter: { vcenterPassword?: string | undefined }) => {
          return vcenter.vcenterPassword;
        },
      ),
    ).toEqual(passwords);
  });

  test("a relation to a model with no encrypted column is left as it is", async () => {
    const lookalike: string = encryptedToken;

    useInMemoryTable(StatusPageService, [
      {
        ...statusPageRow(encryptedToken),
        // The project has no encrypted column: nothing of it is decrypted.
        project: { _id: PROJECT_ID, name: lookalike },
      },
    ]);

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: { _id: STATUS_PAGE_ID },
      select: { project: { _id: true, name: true } },
      props: { isRoot: true, ignoreHooks: true },
    });

    expect((statusPage?.project as unknown as { name: string }).name).toBe(
      lookalike,
    );
  });

  test("a record read by itself is decrypted as before", async () => {
    useInMemoryTable(ProjectCallSMSConfigService, [
      {
        _id: CONFIG_ID,
        projectId: PROJECT_ID,
        name: "Production Twilio",
        slug: "production-twilio",
        twilioAccountSID: SID,
        twilioAuthToken: encryptedToken,
        version: 1,
      },
    ]);

    const config: ProjectCallSMSConfig | null =
      await ProjectCallSMSConfigService.findOneBy({
        query: { _id: CONFIG_ID },
        select: { twilioAuthToken: true },
        props: { isRoot: true },
      });

    expect(config?.twilioAuthToken).toBe(TOKEN);
  });
});
