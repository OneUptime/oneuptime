import { KeptPhrase } from "./OneNamePerThing";

/*
 * EACH LANGUAGE'S WORD FOR A PROBE (#7976).
 *
 * A probe is the OneUptime agent that runs a monitor's checks from a
 * place. The Dashboard names it on its Probes page, in the side menu and on
 * a monitor's Probes card: Sonde (Danish and Dutch), 探测器 (Simplified
 * Chinese), 探測器 (Traditional Chinese) and پراب (Persian), the
 * translation of its "Probe" key. The docs of these languages, and some of
 * the Dashboard's own sentences, also said another word for it:
 *
 *   - Danish and Dutch the English probe, probes, proben and prober, about a
 *     thousand times beside sonde;
 *   - Simplified Chinese 探针, and 探测点 on the OpenStack monitor page;
 *     Traditional Chinese 探針 and 探測點;
 *   - Persian کاوشگر, which is the Dashboard's word for an explorer
 *     (کاوشگر لاگ, the Logs Explorer), پروب, and the English probe.
 *
 * ProbeWordPerLanguage holds every translated string of the apps' locale
 * files and every docs page of these languages to the Dashboard's word,
 * with these patterns:
 *
 *   - others: the words the language no longer says for a probe;
 *   - keptPhrases: phrases whose other word names something that is not a
 *     OneUptime probe (a cloud's startup or health probe, the eBPF probe
 *     OBI attaches to a system call) or names an option the Dashboard
 *     draws in English, each with why. They are taken out of a text before
 *     it is read;
 *   - explorer: a word the language says for an explorer, which a block
 *     may say only where its English says explorer (Persian کاوشگر).
 *
 * The word itself is read from the Dashboard's locale (its "Probe" key), so
 * a rename of the Dashboard's word moves the docs with it.
 */

export interface ExplorerWord {
  // The Dashboard's word for an explorer, in any form a sentence takes.
  word: RegExp;
  // Phrases with the word that name neither an explorer nor a probe.
  keptPhrases: ReadonlyArray<KeptPhrase>;
}

export interface ProbeWords {
  // The words the language no longer says for a OneUptime probe.
  others: RegExp;
  // Phrases whose other word names something else, taken out first.
  keptPhrases: ReadonlyArray<KeptPhrase>;
  // The language's word for an explorer, if it is also a word for a probe.
  explorer?: ExplorerWord | undefined;
}

const STARTUP_PROBE: string =
  "a Cloud Run or Kubernetes startup probe: the platform's own health check of a container, which its docs name so, not a OneUptime probe";

const EBPF_PROBE: string =
  "the eBPF probe OBI attaches to the write() system call: a kernel probe, not a OneUptime probe";

const HEALTH_PROBES: string =
  "an Azure load balancer's health probes, which a cloud resource's health reason names: the cloud's checks, not OneUptime probes";

const PROBE_OPTION: string =
  "the network device's Probe option, which the Dashboard draws in English in this language (Probe — pinged by the assigned probe ...), named as drawn";

export const PROBE_WORDS: Readonly<Record<string, ProbeWords>> = {
  fa: {
    others: /پروب|(?<![\p{L}\p{N}_-])probes?(?![\p{L}\p{N}_-])/iu,
    keptPhrases: [
      { phrase: /پروب راه‌اندازی/u, why: STARTUP_PROBE },
      { phrase: /OBI یک probe/u, why: EBPF_PROBE },
    ],
    explorer: {
      word: /کاوشگر/u,
      keptPhrases: [{ phrase: /کاوشگرهای سلامت/u, why: HEALTH_PROBES }],
    },
  },
  "zh-CN": {
    others: /探针|探测点/u,
    keptPhrases: [
      { phrase: /启动探针/u, why: STARTUP_PROBE },
      { phrase: /系统调用上挂载一个探针/u, why: EBPF_PROBE },
    ],
  },
  "zh-TW": {
    // A startup probe is 啟動探查 here, as the Traditional Chinese Dashboard's Cloud Run guide says it.
    others: /探針|探測點/u,
    keptPhrases: [{ phrase: /系統呼叫上掛載一個探針/u, why: EBPF_PROBE }],
  },
  da: {
    // Every form and compound of the English word: probe, proben, prober, probes, probestatus.
    others: /probe/iu,
    keptPhrases: [
      { phrase: /opstartsprobe\p{L}*/iu, why: STARTUP_PROBE },
      { phrase: /sætter OBI en probe/u, why: EBPF_PROBE },
      { phrase: /sundhedsprober/iu, why: HEALTH_PROBES },
      {
        phrase: /Skift til Probe ovenfor|Probe er det normale valg/u,
        why: PROBE_OPTION,
      },
    ],
  },
  nl: {
    // Every form and compound of the English word, but the verb proberen (to try): probeer, probeerde, geprobeerd.
    others: /probe(?!e?r)/iu,
    keptPhrases: [
      { phrase: /opstartprobe\p{L}*/iu, why: STARTUP_PROBE },
      { phrase: /koppelt OBI een probe/u, why: EBPF_PROBE },
      { phrase: /statusprobes/iu, why: HEALTH_PROBES },
      {
        phrase: /datastore-probes/iu,
        why: "the master admin API's checks of each datastore, which its example response names: not OneUptime probes",
      },
      {
        phrase: /naar Probe om|Probe is de normale keuze/u,
        why: PROBE_OPTION,
      },
    ],
  },
};

export const PROBE_LANGUAGES: ReadonlyArray<string> = Object.keys(PROBE_WORDS);
