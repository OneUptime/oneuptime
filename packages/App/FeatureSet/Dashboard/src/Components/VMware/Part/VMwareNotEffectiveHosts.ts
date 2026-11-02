import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  VMWARE_NOT_EFFECTIVE_HOSTS_WORDS,
  VMwareNotEffectiveHosts,
} from "../../../Pages/VMware/Utils/VMwarePartFacts";

/*
 * Why a cluster's hosts are not effective, in the reader's words, the most
 * urgent first ("1 not responding", "1 in maintenance mode"): the line under
 * the Overview's and a cluster's Effective hosts tile.
 */
export function getVMwareNotEffectiveHostsText(
  counts: VMwareNotEffectiveHosts,
  translator: Translator,
): Array<string> {
  return VMWARE_NOT_EFFECTIVE_HOSTS_WORDS.filter(
    (words: (typeof VMWARE_NOT_EFFECTIVE_HOSTS_WORDS)[number]): boolean => {
      return counts[words.key] > 0;
    },
  ).map((words: (typeof VMWARE_NOT_EFFECTIVE_HOSTS_WORDS)[number]): string => {
    return translator.translatePlural(
      { one: words.one, other: words.other },
      counts[words.key],
    );
  });
}
