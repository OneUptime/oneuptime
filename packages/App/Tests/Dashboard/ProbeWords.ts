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
 *     OBI attaches to a system call), each with why. They are taken out of
 *     a text before it is read. A network device's Monitoring method
 *     options are drawn in every language's words since #8308, so the
 *     sentences that name them ("Skift til Sonde ovenfor") need none;
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

const POD_PROBES: string =
  "a pod's own liveness, readiness and startup probes and lifecycle hooks, which the Pod Security Standards' Host Probes / Lifecycle Hooks control reads on a cluster's Compliance page (#9877): Kubernetes' checks of a container, not OneUptime probes";

// The five languages PR #8305 held to their Dashboard's word first.
const FIRST_PROBE_WORDS: Readonly<Record<string, ProbeWords>> = {
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
      {
        phrase: /主机探针|探针和生命周期钩子|tcpSocket 探针及钩子/u,
        why: POD_PROBES,
      },
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
        phrase:
          /værtsprober|prober og livscyklus-hooks|prober og hooks af typen httpGet/iu,
        why: POD_PROBES,
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
        phrase: /hostprobes|probes en lifecycle-hooks|tcpSocket-probes/iu,
        why: POD_PROBES,
      },
    ],
  },
};

// The English word as a word of its own, for the languages whose own word is another script's.
const ENGLISH_PROBE_WORD: RegExp =
  /(?<![\p{L}\p{N}_-])probes?(?![\p{L}\p{N}_-])/iu;

const PROBES_OF_A_SCANNER: string =
  "a network scanner's probes, the requests a security case counts: not OneUptime probes";

/*
 * The other eleven docs languages (#8306). German, Norwegian and Swedish
 * keep the article (die Sonde, en sonde, en sond); Italian and Portuguese
 * already said "la probe", "uma probe"; Russian said проба (feminine) beside
 * its Dashboard's зонд (masculine), and the sentences agree with зонд now.
 * German keeps its own Probe for a sample or a trial (Stichprobe, Probelauf).
 */
const MORE_PROBE_WORDS: Readonly<Record<string, ProbeWords>> = {
  de: {
    others: /(?<!stich|profil)probe(?!lauf|läuf|fahrt)/iu,
    keptPhrases: [
      { phrase: /Startup-Probe\p{L}*/u, why: STARTUP_PROBE },
      { phrase: /hängt OBI eine Probe/u, why: EBPF_PROBE },
      {
        phrase: /Host-Probes|Probes und Lifecycle-Hooks|tcpSocket-Probes/u,
        why: POD_PROBES,
      },
    ],
  },
  no: {
    others: /probe/iu,
    keptPhrases: [
      { phrase: /oppstartsprobe\p{L}*/iu, why: STARTUP_PROBE },
      { phrase: /fester OBI en probe/u, why: EBPF_PROBE },
      { phrase: /helseprober/iu, why: HEALTH_PROBES },
      {
        phrase:
          /vertsprober|prober og livssyklus-hooks|prober og hooks av typen httpGet/iu,
        why: POD_PROBES,
      },
    ],
  },
  sv: {
    // The English word and the Swedish docs' own prob, but problem and probera (to try on).
    others: /prob(?!lem|ab|era)/iu,
    keptPhrases: [
      { phrase: /startprob\p{L}*/iu, why: STARTUP_PROBE },
      { phrase: /fäster OBI en probe/u, why: EBPF_PROBE },
      {
        phrase:
          /värdprober|prober och livscykel-hooks|prober och hooks av typen httpGet/iu,
        why: POD_PROBES,
      },
    ],
  },
  it: {
    others: /probe/iu,
    keptPhrases: [
      { phrase: /probe di avvio/iu, why: STARTUP_PROBE },
      {
        phrase:
          /probe dell'host|probe e hook del ciclo di vita|dalle probe e dagli hook/iu,
        why: POD_PROBES,
      },
    ],
  },
  pt: {
    others: /probe/iu,
    keptPhrases: [],
  },
  ru: {
    // The English word, and проба in every case, but пробел (a space), пробный (a trial) and the rest.
    others: /probe|(?<!\p{L})проб(?:а|ы|е|у|ой|ам|ами|ах)?(?!\p{L})/iu,
    keptPhrases: [
      { phrase: /проб\p{L}* работоспособности/iu, why: HEALTH_PROBES },
      { phrase: /проб\p{L}* запуска/iu, why: STARTUP_PROBE },
      {
        phrase: /проб\p{L}* (?:одного )?сканер\p{L}*/iu,
        why: PROBES_OF_A_SCANNER,
      },
      {
        phrase: /Если это была проба/u,
        why: "a trial run of a Terraform configuration: проба is Russian for a trial, not a OneUptime probe",
      },
      {
        phrase: /пробах и хуках|пробы и хуки|проб и хуков/iu,
        why: POD_PROBES,
      },
    ],
  },
  fr: {
    others: /probe/iu,
    keptPhrases: [],
  },
  es: { others: /probe/iu, keptPhrases: [] },
  ko: { others: ENGLISH_PROBE_WORD, keptPhrases: [] },
  ja: {
    others: ENGLISH_PROBE_WORD,
    keptPhrases: [
      {
        phrase: /This probe could not/u,
        why: "the check's own message, which the product writes in English and the page quotes as written",
      },
    ],
  },
  hi: {
    others: ENGLISH_PROBE_WORD,
    keptPhrases: [],
  },
};

export const PROBE_WORDS: Readonly<Record<string, ProbeWords>> = {
  ...FIRST_PROBE_WORDS,
  ...MORE_PROBE_WORDS,
};

export const PROBE_LANGUAGES: ReadonlyArray<string> = Object.keys(PROBE_WORDS);
