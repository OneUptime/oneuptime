import { TemplateValue, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE DESCRIPTION OF A PROBE-COLLECTED CLOUD'S OR VCENTER'S DATA COLLECTION
 * CARD: A PROMISE ONLY WHILE A PROBE COMES FOR IT.
 *
 * The OpenStack and VMware Overview cards read "Collected by Datacenter probe
 * from https://keystone.example.com:5000, every 5 minutes." beside a badge
 * that said Not collecting and a line that said no probe collects it, and
 * "Collected by its probe" for a row with no probe at all (OneUptime issue
 * #8326). So:
 *
 * - While a probe comes for it: "Collected by {{probe}} from {{address}},
 *   every {{count}} minutes. No agent runs for it."
 * - While no probe may, or none has come (the card's Not collecting, from
 *   getOpenStackCollectionStop / getVMwareCollectionStop, or overdue): what
 *   it is set to, "Set to be collected by {{probe}} from {{address}},
 *   every {{count}} minutes."
 * - With no probe named, or no address, there is no setting to say: no
 *   description, and the card's body says what is missing.
 */

export interface ProbeCollectionDescriptionFacts {
  // Whether a probe comes for it: nothing stops the claim, and it is not overdue.
  isCollected: boolean;
  // Whether it names a probe to collect it.
  hasProbe: boolean;
  // The probe's name, or "its probe" for one the reader may not read.
  probeName: TemplateValue;
  // Keystone's address, or vCenter's.
  address: string | null | undefined;
  intervalInMinutes: number;
}

export function getProbeCollectionDescription(
  facts: ProbeCollectionDescriptionFacts,
  translator: Translator,
): string | undefined {
  const values: Record<string, TemplateValue> = {
    probe: facts.probeName,
    address: facts.address || "",
  };

  if (facts.isCollected) {
    return translator.translatePlural(
      {
        /*
         * The one form names the count too: Russian's "one" is 1, 21, 31, 41
         * and 51 as well, and a cloud may be collected every 21 minutes.
         */
        one: "Collected by {{probe}} from {{address}}, every {{count}} minute. No agent runs for it.",
        other:
          "Collected by {{probe}} from {{address}}, every {{count}} minutes. No agent runs for it.",
      },
      facts.intervalInMinutes,
      values,
    );
  }

  if (!facts.hasProbe || !facts.address) {
    return undefined;
  }

  return translator.translatePlural(
    {
      one: "Set to be collected by {{probe}} from {{address}}, every {{count}} minute.",
      other:
        "Set to be collected by {{probe}} from {{address}}, every {{count}} minutes.",
    },
    facts.intervalInMinutes,
    values,
  );
}
