import User from "../../../Models/DatabaseModels/User";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UserService from "../../../Server/Services/UserService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import Email from "../../../Types/Email";
import { MaxAttributionValueLength } from "../../../Types/Marketing/Attribution";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A paid click whose landing address is longer than the column it is stored
 * in must still be able to sign up.
 *
 * The browser stored the address the visitor landed on as it was, however
 * long, and the signup sent it on. DatabaseService refuses a value wider than
 * its column instead of cutting it (checkMaxLengthOfFields), so the visitor
 * was told "utmUrl length cannot be more than 500 characters" - and was told
 * it every time they tried, because the address stayed in their browser.
 *
 * The two steps are the real ones, in the order a create runs them.
 */

interface UserServiceCreateSteps {
  onBeforeCreate: (createBy: CreateBy<User>) => Promise<OnCreate<User>>;
  checkMaxLengthOfFields: (data: User) => User;
}

const service: UserServiceCreateSteps =
  UserService as unknown as UserServiceCreateSteps;

// What Google Ads and a tracking template put on a click, and it adds up.
const LONG_AD_URL: string = [
  "https://oneuptime.com/compare/pagerduty?utm_source=google&utm_medium=cpc",
  "&utm_campaign=emea-search-competitor-pagerduty-alternative-exact-2026-q4",
  "&utm_term=pagerduty%20alternative%20open%20source&utm_content=781234567890",
  "&utm_id=23145678901&hsa_acc=1234567890&hsa_cam=23145678901",
  "&hsa_grp=178912345678&hsa_ad=781234567890&hsa_src=g&hsa_tgt=kwd-301234567890",
  "&hsa_kw=pagerduty%20alternative&hsa_mt=e&hsa_net=adwords&hsa_ver=3",
  "&gad_source=1&gad_campaignid=23145678901&gbraid=0AAAAA9xYzAbCdEfGhIjKlMnOp",
  "&gclid=Cj0KCQjw8cHEBhC8ARIsAEPn2VfExampleExampleExampleExampleExampleExample",
].join("");

const makeSignup: (utmUrl: string) => User = (utmUrl: string): User => {
  const user: User = new User();
  user.email = new Email("buyer@acme.example");
  user.utmSource = "google";
  user.utmUrl = utmUrl;
  return user;
};

const runCreateSteps: (user: User) => Promise<User> = async (
  user: User,
): Promise<User> => {
  const onCreate: OnCreate<User> = await service.onBeforeCreate({
    data: user,
    props: { isRoot: true },
  });

  return service.checkMaxLengthOfFields(onCreate.createBy.data);
};

describe("a signup from a long ad address", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const stubSeatLimit: () => void = (): void => {
    jest
      .spyOn(EnterpriseEdition, "assertSeatAvailableForNewUser")
      .mockResolvedValue(undefined);
  };

  test("the address really is wider than the column, which refuses it whole", () => {
    expect(LONG_AD_URL.length).toBeGreaterThan(MaxAttributionValueLength);

    expect(() => {
      service.checkMaxLengthOfFields(makeSignup(LONG_AD_URL));
    }).toThrow("utmUrl length cannot be more than 500 characters");
  });

  test("signs up, keeping as much of the address as the column holds", async () => {
    stubSeatLimit();

    const user: User = await runCreateSteps(makeSignup(LONG_AD_URL));

    expect(user.utmUrl).toBe(LONG_AD_URL.slice(0, MaxAttributionValueLength));
    expect(user.utmSource).toBe("google");
  });

  test("an address that fits is stored as it came", async () => {
    stubSeatLimit();

    const address: string = "https://oneuptime.com/pricing?gclid=abc";

    expect((await runCreateSteps(makeSignup(address))).utmUrl).toBe(address);
  });

  test("every campaign column is held to its width, not only the address", async () => {
    stubSeatLimit();

    const user: User = makeSignup("https://oneuptime.com/");
    user.utmCampaign = "c".repeat(MaxAttributionValueLength + 1);

    expect((await runCreateSteps(user)).utmCampaign).toHaveLength(
      MaxAttributionValueLength,
    );
  });
});

describe("createByEmail, for a signup that posts no form", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the attribution it is given onto the new user", async () => {
    const create: jest.SpiedFunction<typeof UserService.create> = jest
      .spyOn(UserService, "create")
      .mockImplementation(async (createBy: CreateBy<User>): Promise<User> => {
        return createBy.data;
      });

    await UserService.createByEmail({
      email: new Email("buyer@acme.example"),
      name: undefined,
      attribution: {
        utm: { utmSource: "google", utmUrl: "https://oneuptime.com/?gclid=a" },
        clickIds: { gclid: "a" },
        firstTouch: { utmSource: "linkedin" },
      },
      props: { isRoot: true },
    });

    const user: User = create.mock.calls[0]![0].data;

    expect(user.utmSource).toBe("google");
    expect(user.utmUrl).toBe("https://oneuptime.com/?gclid=a");
    expect(user.clickIds).toEqual({ gclid: "a" });
    expect(user.firstTouchAttribution).toEqual({ utmSource: "linkedin" });
  });

  test("writes none where it is given none: an invitation is not an acquisition", async () => {
    const create: jest.SpiedFunction<typeof UserService.create> = jest
      .spyOn(UserService, "create")
      .mockImplementation(async (createBy: CreateBy<User>): Promise<User> => {
        return createBy.data;
      });

    await UserService.createByEmail({
      email: new Email("teammate@acme.example"),
      name: undefined,
      props: { isRoot: true },
    });

    const user: User = create.mock.calls[0]![0].data;

    expect(user.utmSource).toBeUndefined();
    expect(user.clickIds).toBeUndefined();
  });
});
