import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Protected Entities' Protected Automatically card (#10338):
 * the addresses OneUptime never blocks because they are the project's own.
 * Each is an en.json key, looked up where it is drawn. React-free, so the
 * docs' facts and a plain test can read them.
 */

export const AUTOMATIC_PROTECTIONS_TITLE: string = translationKey(
  "Protected Automatically",
);

export const AUTOMATIC_PROTECTIONS_DESCRIPTION: string = translationKey(
  "Addresses OneUptime never blocks because they are your project's own, worked out from what it knows. They change only when what they come from does.",
);

export const AUTOMATIC_PROTECTIONS_MORE: string = translationKey(
  "Not every one is listed here. OneUptime protects them all the same.",
);

export const AUTOMATIC_PROTECTIONS_UNREAD: string = translationKey(
  "Some could not be listed, because you cannot read them or they could not be read. They are protected all the same.",
);

export const AUTOMATIC_PROTECTIONS_TEST_ID: string =
  "protected-entities-automatic";
