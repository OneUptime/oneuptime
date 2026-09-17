import UserCall from "../../../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../../../Models/DatabaseModels/UserEmail";
import UserIncomingCallNumber from "../../../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../../../Models/DatabaseModels/UserSMS";
import UserWhatsApp from "../../../../../Models/DatabaseModels/UserWhatsApp";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import { describe, expect, it } from "@jest/globals";

/*
 * GHSA-5cr8-vph4-3hrf, the parts of the fix that live in model metadata
 * rather than in code.
 *
 * Two properties, both of which a later well-meaning edit could remove
 * without breaking a single functional test:
 *
 * 1. THE IDENTITY IS IMMUTABLE. The advisory's remediation list ends with
 *    "invalidate outstanding codes when contact details change". There is no
 *    such code path here, and that is not an oversight — the address or number
 *    on a channel row cannot be changed at all, because its column grants
 *    nobody update. A code is therefore bound to the contact detail it was
 *    sent to for the whole life of the row. Make one of these columns
 *    updatable and that stops being true: a caller verifies their own address,
 *    then rewrites the row to point at somebody else's, and arrives at a
 *    verified channel they do not own.
 *
 * 2. THE VERIFICATION STATE IS NOT WRITABLE BY THE CALLER. isVerified, the
 *    stored digest, its expiry and the attempt counter are all server-owned.
 *    A caller who could write any of them would not need to guess a code:
 *    they could set isVerified directly, or push the expiry out, or reset the
 *    attempt counter between guesses and never hit the limit.
 */

interface ChannelUnderTest {
  name: string;
  model: BaseModel;
  identityColumn: string;
}

const CHANNELS: Array<ChannelUnderTest> = [
  { name: "UserEmail", model: new UserEmail(), identityColumn: "email" },
  { name: "UserSMS", model: new UserSMS(), identityColumn: "phone" },
  { name: "UserCall", model: new UserCall(), identityColumn: "phone" },
  { name: "UserWhatsApp", model: new UserWhatsApp(), identityColumn: "phone" },
  {
    name: "UserIncomingCallNumber",
    model: new UserIncomingCallNumber(),
    identityColumn: "phone",
  },
];

/* Server-owned: writable by nobody through the API, at any point. */
const SERVER_OWNED_COLUMNS: Array<string> = [
  "isVerified",
  "verificationCode",
  "verificationCodeExpiresAt",
  "verificationFailedAttempts",
  "verificationCodeSentAt",
];

describe.each(CHANNELS)(
  "$name verification column metadata",
  (channel: ChannelUnderTest) => {
    const accessControlFor: (columnName: string) => ColumnAccessControl = (
      columnName: string,
    ) => {
      const accessControl: ColumnAccessControl | null =
        channel.model.getColumnAccessControlFor(columnName);

      expect(accessControl).not.toBeNull();

      return accessControl as ColumnAccessControl;
    };

    it("does not let anybody change the address or number after creation", () => {
      expect(accessControlFor(channel.identityColumn).update).toEqual([]);
    });

    it.each(SERVER_OWNED_COLUMNS)(
      "does not let anybody create or update %s",
      (columnName: string) => {
        const accessControl: ColumnAccessControl = accessControlFor(columnName);

        expect(accessControl.create).toEqual([]);
        expect(accessControl.update).toEqual([]);
      },
    );

    it.each([
      "verificationCode",
      "verificationCodeExpiresAt",
      "verificationFailedAttempts",
      "verificationCodeSentAt",
    ])("does not expose %s to any reader", (columnName: string) => {
      expect(accessControlFor(columnName).read).toEqual([]);
    });

    /*
     * The row is born with a placeholder no six-digit code can hash to; the
     * real code is issued by the service once the insert has assigned an id,
     * because the id is part of the hashed message. A default that produced
     * something SHORT would be a live guessable code sitting on every new row
     * for the moment before the service overwrote it.
     */
    it("defaults verificationCode to a value no code can hash to", () => {
      const metadata: TableColumnMetadata =
        channel.model.getTableColumnMetadata("verificationCode");

      expect(metadata.forceGetDefaultValueOnCreate).toBeDefined();

      const generated: string = (
        metadata.forceGetDefaultValueOnCreate as () => string
      )();

      expect(generated).toHaveLength(64);
      expect(generated).not.toMatch(/^[0-9]{1,10}$/);
    });

    it("generates a different placeholder for every row", () => {
      const metadata: TableColumnMetadata =
        channel.model.getTableColumnMetadata("verificationCode");

      const generated: Set<string> = new Set<string>();

      for (let i: number = 0; i < 50; i++) {
        generated.add(
          (metadata.forceGetDefaultValueOnCreate as () => string)(),
        );
      }

      expect(generated.size).toBe(50);
    });
  },
);
