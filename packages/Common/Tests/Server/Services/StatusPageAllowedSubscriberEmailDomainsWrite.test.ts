import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageService, {
  assertStatusPageWriteValues,
} from "../../../Server/Services/StatusPageService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS,
  SubscriberRestrictionMessages,
} from "../../../Types/StatusPage/SubscriberRestrictions";
import { describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * Allowed Email Domains as a status page write stores it
 * (StatusPage.allowedSubscriberEmailDomains, checked by
 * assertStatusPageWriteValues on every create and update - the dashboard,
 * the API, Terraform): a list with an entry that is no domain, or too many
 * domains, is refused with what is wrong; any other is stored as every
 * reader of it reads it - its domains, lower-cased, one a line - and a list
 * of none as nothing.
 */

const refusal: (data: Record<string, unknown>) => string | null = (
  data: Record<string, unknown>,
): string | null => {
  try {
    assertStatusPageWriteValues(data);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }
};

describe("Allowed Email Domains, as a write stores it", () => {
  test("is stored one domain a line, lower-cased, without an @ or repeats", () => {
    const data: Record<string, unknown> = {
      allowedSubscriberEmailDomains:
        " @ACME.com, acme.de;\n\nacme.com eu.acme.com ",
    };

    expect(refusal(data)).toBeNull();
    expect(data["allowedSubscriberEmailDomains"]).toBe(
      "acme.com\nacme.de\neu.acme.com",
    );
  });

  test.each([null, "", "   ", "\n \n"])(
    "%p is stored as none: any domain may subscribe",
    (value: string | null) => {
      const data: Record<string, unknown> = {
        allowedSubscriberEmailDomains: value,
      };

      expect(refusal(data)).toBeNull();
      expect(data["allowedSubscriberEmailDomains"]).toBeNull();
    },
  );

  test("a write that does not name it leaves it alone", () => {
    const data: Record<string, unknown> = { name: "Acme Status" };

    expect(refusal(data)).toBeNull();
    expect("allowedSubscriberEmailDomains" in data).toBe(false);
  });

  test.each([
    ["acme.com\nhttps://acme.de", "https://acme.de"],
    ["user@acme.com", "user@acme.com"],
    ["acme", "acme"],
    ["*.acme.com", "*.acme.com"],
  ])("%j is refused, naming %j", (value: string, entry: string) => {
    const data: Record<string, unknown> = {
      allowedSubscriberEmailDomains: value,
    };

    expect(refusal(data)).toBe(
      SubscriberRestrictionMessages.invalidDomain.replace("{{domain}}", entry),
    );
    // Left as it was sent: nothing is saved.
    expect(data["allowedSubscriberEmailDomains"]).toBe(value);
  });

  test("a value that is not text is refused", () => {
    expect(refusal({ allowedSubscriberEmailDomains: 42 })).toContain("42");
    expect(
      refusal({ allowedSubscriberEmailDomains: ["acme.com"] }),
    ).not.toBeNull();
  });

  test(`more than ${MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS} domains are refused`, () => {
    const domains: Array<string> = Array.from(
      { length: MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS + 1 },
      (_value: unknown, index: number): string => {
        return `d${index}.example.com`;
      },
    );

    expect(refusal({ allowedSubscriberEmailDomains: domains.join("\n") })).toBe(
      SubscriberRestrictionMessages.tooManyDomains,
    );
    expect(
      refusal({
        allowedSubscriberEmailDomains: domains.slice(1).join("\n"),
      }),
    ).toBeNull();
  });
});

describe("every write of a status page is checked", () => {
  type Check = (write: unknown) => Promise<void>;

  const hooks: {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  } = StatusPageService as unknown as {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  };

  test("a create", async () => {
    const page: StatusPage = new StatusPage();
    page.allowedSubscriberEmailDomains = "not a domain";

    await expect(
      hooks.checkCreateBeforeReferences({
        data: page,
        props: { isRoot: true },
      } as CreateBy<StatusPage>),
    ).rejects.toThrow("is not a valid domain");

    page.allowedSubscriberEmailDomains = "ACME.com";
    await hooks.checkCreateBeforeReferences({
      data: page,
      props: { isRoot: true },
    } as CreateBy<StatusPage>);
    expect(page.allowedSubscriberEmailDomains).toBe("acme.com");
  });

  test("an update", async () => {
    const update: UpdateBy<StatusPage> = {
      query: {},
      data: { allowedSubscriberEmailDomains: "acme.com, ACME.de" },
      props: { isRoot: true },
    } as unknown as UpdateBy<StatusPage>;

    await hooks.checkUpdateBeforeReferences(update);
    expect(
      (update.data as unknown as Record<string, unknown>)[
        "allowedSubscriberEmailDomains"
      ],
    ).toBe("acme.com\nacme.de");

    await expect(
      hooks.checkUpdateBeforeReferences({
        query: {},
        data: { allowedSubscriberEmailDomains: "https://acme.com" },
        props: { isRoot: true },
      } as unknown as UpdateBy<StatusPage>),
    ).rejects.toThrow("is not a valid domain");
  });
});
