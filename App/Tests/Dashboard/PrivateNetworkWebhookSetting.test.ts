import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The project half of the private-network webhook opt-in (issue #3424) is a
 * card on Settings -> Project.
 *
 * Pinned against the source rather than by rendering, for the same reason as
 * AISettingsSeparation: the page is a React component and react is a
 * dependency of the Dashboard package alone, so importing it here would pull
 * react into App's program and break `npm run compile`.
 *
 * Two properties matter and neither is visible on screen:
 *
 *  - The card is gated on PRIVATE_NETWORK_WEBHOOKS_ALLOWED_ON_INSTANCE. Ungated,
 *    every SaaS tenant would see a toggle that changes nothing, and turning it
 *    on would read as "my webhooks can reach private networks now" when the
 *    server will still refuse them.
 *
 *  - The card carries ONLY allowPrivateNetworkWebhooks. A CardModelDetail
 *    writes every field it is given on Update, so a stray field here would be
 *    silently overwritten whenever someone saves this card.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const source: string = fs.readFileSync(
  path.join(DASHBOARD_SRC, "Pages", "Settings", "ProjectSettings.tsx"),
  "utf8",
);

/*
 * The source between two markers. Throwing rather than returning empty
 * matters: a card that lost its formFields entirely would otherwise satisfy
 * every "does not contain" assertion below.
 */
function sectionBetween(text: string, start: string, end: string): string {
  const startsAt: number = text.indexOf(start);

  if (startsAt < 0) {
    throw new Error(`Expected to find ${start} in ProjectSettings.tsx.`);
  }

  const from: number = startsAt + start.length;
  const to: number = text.indexOf(end, from);

  if (to < 0) {
    throw new Error(`Expected to find ${end} after ${start}.`);
  }

  return text.slice(from, to);
}

describe("Project Settings — private network webhooks card", () => {
  test("imports the instance flag from the shared UI config", () => {
    expect(source).toContain("PRIVATE_NETWORK_WEBHOOKS_ALLOWED_ON_INSTANCE");
    expect(source).toContain('from "Common/UI/Config"');
  });

  test("renders the card only when the instance permits the exception", () => {
    expect(source).toMatch(
      /\{PRIVATE_NETWORK_WEBHOOKS_ALLOWED_ON_INSTANCE\s*&&\s*\(/,
    );
  });

  test("the gate sits before the card, not inside it", () => {
    const gateAt: number = source.indexOf(
      "{PRIVATE_NETWORK_WEBHOOKS_ALLOWED_ON_INSTANCE &&",
    );
    const cardAt: number = source.indexOf('name="Private Network Webhooks"');

    expect(gateAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(gateAt);
  });

  test("edits exactly one field", () => {
    const cardAt: number = source.indexOf('name="Private Network Webhooks"');
    const card: string = source.slice(cardAt);
    const formFields: string = sectionBetween(card, "formFields={[", "]}");

    expect(formFields).toContain("allowPrivateNetworkWebhooks: true");

    /*
     * Any other model field appearing here would be written on save. The
     * settings this page can otherwise touch are the ones to check for.
     */
    expect(formFields).not.toContain("name: true");
    expect(formFields).not.toContain("letCustomerSupportAccessProject");
  });

  test("does not appear on the always-rendered project details card", () => {
    const detailsCard: string = sectionBetween(
      source,
      'name="Project Details"',
      'name="Private Network Webhooks"',
    );

    expect(detailsCard).not.toContain("allowPrivateNetworkWebhooks");
  });

  test("uses its own model-detail id", () => {
    /*
     * CardModelDetail ids are used as DOM ids; two cards on one page sharing
     * "model-detail-project" makes the second one unaddressable.
     */
    expect(source).toContain(
      'id: "model-detail-project-private-network-webhooks"',
    );
  });
});
