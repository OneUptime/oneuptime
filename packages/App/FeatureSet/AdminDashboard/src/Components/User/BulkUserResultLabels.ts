import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A BULK ACTION ON THE USERS LIST SAYS IT DID.
 *
 * The shared progress dialog ends with a line per outcome, in the action's
 * own words where it has them (BulkActionButtonSchema.resultLabels), else
 * "2 Users succeeded" and "1 User failed" - which, after Add to Project,
 * left the admin to work out what had succeeded. Add to Project adds each
 * user to the team picked; Require and Do Not Require Two Factor Auth
 * update what each user is asked for when they sign in. A user the server
 * refused is listed under the line with the server's reason, as before.
 *
 * The Dashboard says the same sentences ("2 Subscribers added"), and the
 * Admin Dashboard's locale files carry the Dashboard's translation of each
 * (BulkUpdateFormStopAndProgress holds the two to the same words).
 */

export interface BulkUserResultLabels {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
}

// "2 Users added", "1 User not added".
export const ADD_TO_PROJECT_RESULT_LABELS: BulkUserResultLabels = {
  succeeded: {
    one: "{{count}} {{itemName}} added",
    other: "{{count}} {{itemsName}} added",
  },
  failed: {
    one: "{{count}} {{itemName}} not added",
    other: "{{count}} {{itemsName}} not added",
  },
};

// "6 Users updated", "1 User not updated".
export const TWO_FACTOR_AUTH_RESULT_LABELS: BulkUserResultLabels = {
  succeeded: {
    one: "{{count}} {{itemName}} updated",
    other: "{{count}} {{itemsName}} updated",
  },
  failed: {
    one: "{{count}} {{itemName}} not updated",
    other: "{{count}} {{itemsName}} not updated",
  },
};
