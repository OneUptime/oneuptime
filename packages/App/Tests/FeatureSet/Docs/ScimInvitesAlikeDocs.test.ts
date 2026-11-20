import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THE SCIM GUIDE SAYS OF WHO JOINS AT ONCE, HELD TO THE CODE (#9899).
 *
 * On OneUptime Cloud a SCIM create or a group add used to make an account
 * the connection had just created a member, and invite one that existed:
 * the project's list of users - Member or Invited - said which addresses
 * already had an account. Now everybody who has not joined the project is
 * invited, whoever made their account, and shows by the name the identity
 * provider sent until they accept; only someone who has joined already is
 * added at once. A self-hosted install adds both. The English guide says
 * so wherever it said the old rule (IdentityDocsTranslations holds every
 * other language to it, and FormerMemberAccessDocs to the paragraph's
 * place), and ProjectSCIMAccountPolicy does what it says.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const GUIDE: string =
  "packages/App/FeatureSet/Docs/Content/en/identity/scim.md";
const POLICY: string = "ee/Server/Identity/Utils/ProjectSCIMAccountPolicy.ts";
const SCIM_API: string = "ee/Server/Identity/API/SCIM.ts";

function read(relativeToRepository: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativeToRepository), "utf8");
}

describe("the SCIM guide's rule for who joins at once (#9899)", () => {
  it("the diagram says anyone not in the project yet is invited on OneUptime Cloud", () => {
    expect(read(GUIDE)).toContain(
      "Note over O: Added to the default teams.<br/>On OneUptime Cloud, anyone not<br/>in the project yet is invited instead",
    );
  });

  it("the paragraph under it says whoever made the account does not matter", () => {
    expect(read(GUIDE)).toContain(
      "On OneUptime Cloud, someone who is not in your project yet joins once they accept the invitation, whether SCIM made their OneUptime account or they already had one (see the [FAQ](#frequently-asked-questions)).",
    );
  });

  it("the FAQ says an existing user is invited as a user SCIM creates is, and shows by the provider's name until they join", () => {
    const guide: string = read(GUIDE);

    expect(guide).toContain(
      "The existing user is **invited** to the teams instead, and receives the usual invitation email, as a user SCIM creates is.",
    );
    expect(guide).toContain(
      "Until then they are listed as pending, by the name your identity provider sent, so your project's list of users reads the same whether or not someone already had a OneUptime account.",
    );
  });

  it("the FAQ says only members are added at once everywhere, and users SCIM creates too on a self-hosted installation", () => {
    const guide: string = read(GUIDE);

    expect(guide).toContain(
      "Users who are members of your project are added straight away everywhere, and on a self-hosted installation so are the users SCIM creates itself.",
    );
    // The old rule, which said which addresses had an account.
    expect(guide).not.toContain(
      "Users SCIM creates itself and users who are members of your project are added straight away everywhere.",
    );
    expect(guide).not.toContain("an existing<br/>account is invited instead");
  });

  it("and the policy does what the guide says: no member at once for an account the connection made, the provider's name on every membership", () => {
    const policy: string = read(POLICY);

    expect(policy).not.toContain("userWasCreatedByScim");
    expect(read(SCIM_API)).not.toContain("userWasCreatedByScim");

    // A self-hosted install adds everyone; OneUptime Cloud only a member already.
    expect(policy).toMatch(
      /if \(!this\.isHostedService\(\)\) \{\s*return await this\.createAcceptedMembership\(teamMember\);\s*\}/,
    );
    expect(policy).toMatch(
      /if \(standing === ProjectSCIMAccountStanding\.Member\) \{\s*return await this\.createAcceptedMembership\(teamMember\);\s*\}/,
    );
    expect(policy).toContain("teamMember.inviteeName = inviteeName;");
  });
});
