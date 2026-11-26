import { BlockValueCheck } from "./BlocklistApi";
import {
  SecurityBlockSentence,
  getSecurityBlockAlreadyBlockedSentence,
  getSecurityBlockCheckFailedSentence,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityAddressProtection,
  getSecurityProtectionLead,
  getSecurityProtectionSentence,
} from "Common/Types/SecurityBlocklist/SecurityProtectedAddress";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";

/*
 * What the Blocklist's dialogs say, in the reader's language, of a block
 * the server would refuse (#10338): the sentences are the shared rules'
 * (Types/SecurityBlocklist), so the Dashboard and the server's English
 * answer say the same thing.
 */

// A shared sentence in the reader's language.
export function writeBlockSentence(
  translator: Translator,
  sentence: SecurityBlockSentence,
): string {
  return translator.translateTemplate(sentence.template, sentence.values);
}

/*
 * Why an address is protected: the sentence of what protects it, after
 * one that says how the block meets it when they are not the same -
 * "35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is the address of host
 * web-3."
 */
export function writeSecurityProtection(
  translator: Translator,
  data: { value: string; protection: SecurityAddressProtection },
): string {
  const values: Record<string, string> = {
    value: data.value,
    address: data.protection.protectedValue,
    name: data.protection.name || data.protection.protectedValue,
    kind: data.protection.kind || "",
    where: data.protection.where || "",
  };

  const sentence: string = translator.translateTemplate(
    getSecurityProtectionSentence(data.protection),
    values,
  );

  // How the block meets what it protects: a range or a domain that holds it, or one inside it (#10346).
  const lead: string | null = getSecurityProtectionLead({
    value: data.value,
    protectedValue: data.protection.protectedValue,
  });

  return lead
    ? joinSentences([translator.translateTemplate(lead, values), sentence])
    : sentence;
}

/*
 * Why a block of what was typed would be refused, from the server's check,
 * or null when it would be made: already blocked, protected, or OneUptime
 * could not tell.
 */
export function writeBlockRefusal(data: {
  translator: Translator;
  typed: string;
  check: BlockValueCheck;
}): string | null {
  const value: string = data.check.value || data.typed.trim();

  if (data.check.coveredBy) {
    return writeBlockSentence(
      data.translator,
      getSecurityBlockAlreadyBlockedSentence({
        value,
        by: data.check.coveredBy.value,
      }),
    );
  }

  if (data.check.protection) {
    return writeSecurityProtection(data.translator, {
      value,
      protection: data.check.protection,
    });
  }

  if (data.check.cannotTell) {
    return writeBlockSentence(
      data.translator,
      getSecurityBlockCheckFailedSentence(value),
    );
  }

  return null;
}
