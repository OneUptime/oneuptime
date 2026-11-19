/*
 * THE ONE WORD EACH LANGUAGE SAYS FOR A THING (#8628, #8691).
 *
 * #8229 made every Products-menu title its page's title, word for word
 * (OneNamePerThingGuard). The sentences of several languages still named
 * the same thing with the other word, sometimes more often than the page
 * title did:
 *
 *   - Korean said 알림 (also its word for a notification) for an alert in
 *     600 strings, beside 경고 in 1,100 and in its singular "Alert" key;
 *   - Simplified Chinese said 跟踪 for a trace beside 追踪, Hindi कतार for a
 *     queue beside क्यू;
 *   - Italian said "registro" for a log in 300 strings, beside "log" in 760
 *     and in its docs;
 *   - Danish said "overvågning" and Norwegian "overvåking" and "overvåker"
 *     for a monitor in 500 strings each, and their singular "Monitor" key
 *     read "monitoring", as German's and Swedish's did;
 *   - Danish said "måling" and Swedish "mått" for a metric beside "metrik"
 *     and "mätvärde";
 *   - Swedish named a monitor group "övervakningsgrupp", Russian a runbook
 *     "сценарий" and Traditional Chinese 操作手冊 beside their Runbooks
 *     pages' сборник инструкций and 運行手冊;
 *   - French and Persian titled the SLOs page "SLOs" where their sentences
 *     say "SLO" and "SLOها".
 *
 * And Norwegian named its metrics "metrikker" beside its Metrics page's
 * "Målinger" (#8691). Russian and Traditional Chinese named the runbook
 * Runner three ways, two of them with the runbook word they dropped
 * (агент сценария, 操作手冊代理程式), where 200 of their strings say
 * "Runner" (#8706).
 * Norwegian called two-factor authentication "totrinnsbekreftelse" on
 * the docs page that turns it on, and "totrinnsautentisering" in three
 * Dashboard strings, where the Dashboard's page and 12 strings say
 * "tofaktorautentisering" (#8701).
 *
 * Each language now says one word. A word like 알림 or "overvågning" also
 * has a meaning of its own (a notification, the act of monitoring), so a
 * check reads the texts whose English names the thing, and only those: a
 * text whose English names the thing says the language's word and not the
 * dropped one. The Dashboard's locale files, the docs and every other app's
 * locale folder (LOCALE_FOLDERS: the Admin Dashboard, the status pages, the
 * sign-in pages, the public dashboards, the API reference and the server's
 * emails and messages) are held to these rules (OneWordInSentencesPerThing),
 * and so is every setup guide's words (SetupGuideDocumentationInLocale):
 * one list, so a rename reaches them all.
 */

/*
 * The locale folders beside the Dashboard's that a rule reads (#8828). A
 * thing the Dashboard names is named the same on a status page, a sign-in
 * page or in an email, so a rule reads every folder unless it says
 * otherwise in `folders`: a product's name, say, may rightly read otherwise
 * on a public page than in the Dashboard. No rule narrows them yet.
 */
export type LocaleFolder =
  | "Admin Dashboard"
  | "Status page"
  | "Sign-in pages"
  | "Public dashboards"
  | "API reference"
  | "Server";

// Each folder, from the packages directory.
export const LOCALE_FOLDERS: Readonly<Record<LocaleFolder, string>> = {
  "Admin Dashboard": "App/FeatureSet/AdminDashboard/src/Locales",
  "Status page": "App/FeatureSet/StatusPage/src/Locales",
  "Sign-in pages": "App/FeatureSet/Accounts/src/Locales",
  "Public dashboards": "App/FeatureSet/PublicDashboard/src/Locales",
  "API reference": "App/FeatureSet/APIReference/Locales",
  Server: "Common/Server/Locales",
};

export const EVERY_LOCALE_FOLDER: ReadonlyArray<LocaleFolder> = Object.keys(
  LOCALE_FOLDERS,
) as Array<LocaleFolder>;

export interface SentenceRule {
  language: string;
  thing: string;
  // The English keys that name the thing.
  english: RegExp;
  // English keys that name it beside something the other word is right for.
  except?: RegExp;
  // The language's one word for the thing.
  word: RegExp;
  // The word the language no longer says for it.
  dropped: RegExp;
  /*
   * English docs lines that name the thing beside something the other word
   * is right for (a Korean line about push notifications or reminders).
   */
  docsExcept?: RegExp;
  /*
   * The English docs lines that name the thing, where they read otherwise
   * than its keys: the docs write OneUptime's Runner with a capital R, and
   * a workflow's or a CI's runner in lower case.
   */
  docsEnglish?: RegExp;
  /*
   * The locale folders beside the Dashboard's it reads: every one
   * (EVERY_LOCALE_FOLDER) unless it names fewer, with why.
   */
  folders?: ReadonlyArray<LocaleFolder>;
}

// The locale folders a rule reads.
export function foldersOf(rule: SentenceRule): ReadonlyArray<LocaleFolder> {
  return rule.folders || EVERY_LOCALE_FOLDER;
}

// English that names an ingestion key.
const INGESTION_KEY: RegExp = /\bingestion[ -]keys?\b/i;

// A Runner's English that names another agent, AWS's App Runner or the migrations' runner.
const NOT_THE_RUNNER: RegExp = /\bagent|app runner|proxy|migration/i;

export const ONE_WORD_RULES: ReadonlyArray<SentenceRule> = [
  {
    language: "ko",
    thing: "Alerts",
    english: /\balerts?\b/i,
    /*
     * A notification's 알림 stays: a notification itself, iOS's critical
     * alerts (중요 알림, a kind of notification) and a warning alert, which
     * would read 경고 경고.
     */
    except:
      /notif|\bnotice|\bnotify|\balert(?:ing)? (?:channel|rule|polic)|alertmanager|e-?mail alert|sms alert|critical(?: on-call)? alerts?|warning alerts?|warnings raise alerts/i,
    word: /경고/,
    dropped: /알림/,
    docsExcept:
      /notification|\bnotify|\bpush|reminder|critical(?: on-call)? alerts?|warning alerts?|alertmanager|e-?mail alert|sms alert/i,
  },
  {
    language: "zh-CN",
    thing: "Traces",
    english: /\btraces?\b|^Trace$/i,
    except: /track/i,
    word: /追踪/,
    dropped: /跟踪/,
  },
  {
    language: "hi",
    thing: "Queues",
    english: /\bqueues?\b/i,
    word: /क्यू/,
    dropped: /कतार/,
  },
  {
    language: "it",
    thing: "Logs",
    english: /\blogs?\b/i,
    except: /log ?in\b|log ?out\b|login|logout|\bblog/i,
    word: /\blog\b/i,
    dropped: /\bregistr[oi]\b/i,
  },
  {
    language: "da",
    thing: "Monitors",
    english: /\bmonitors?\b|^Monitor$/i,
    except: /\bmonitoring\b|watchlist/i,
    word: /monitor/i,
    dropped: /overvågning/i,
  },
  {
    language: "no",
    thing: "Monitors",
    english: /\bmonitors?\b|^Monitor$/i,
    except: /\bmonitoring\b|watchlist/i,
    word: /monitor/i,
    // The noun's forms; "overvåker" alone is also the verb (it monitors).
    dropped: /overvåking|overvåker(?=\p{L})/iu,
  },
  {
    language: "da",
    thing: "Metrics",
    english: /\bmetrics?\b/i,
    except: /measurement|reading/i,
    word: /metrik/i,
    dropped: /måling/i,
  },
  {
    language: "sv",
    thing: "Metrics",
    english: /\bmetrics?\b/i,
    word: /mätvärde/i,
    dropped: /mått/i,
  },
  {
    language: "sv",
    thing: "Monitor Groups",
    english: /\bmonitor groups?\b/i,
    word: /monitorgrupp/i,
    dropped: /övervakningsgrupp/i,
  },
  {
    language: "ru",
    thing: "Runbooks",
    english: /\brunbooks?\b/i,
    word: /сборник\p{L}* инструкций/iu,
    dropped: /сценари/i,
  },
  {
    language: "zh-TW",
    thing: "Runbooks",
    english: /\brunbooks?\b/i,
    word: /運行手冊/,
    dropped: /操作手冊|執行手冊/,
  },
  {
    // Its Metrics page and its sentences say målinger (#8691).
    language: "no",
    thing: "Metrics",
    english: /\bmetrics?\b/i,
    word: /måling/i,
    dropped: /metrikk/i,
  },
  {
    /*
     * Its Dashboard draws "tofaktorautentisering" (Two Factor
     * Authentication) in 12 strings; three said "totrinnsautentisering",
     * and the docs' account page, whose step says how to turn it on, said
     * "totrinnsbekreftelse" (#8701). Google's own "2-Step Verification",
     * which the Google Workspace page names as Google does, is not
     * OneUptime's two-factor authentication.
     */
    language: "no",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /tofaktor/i,
    dropped: /totrinn/i,
  },
  /*
   * Seven more languages named two-factor authentication two or three ways
   * (#8774). Each now says the word the Dashboard's Two Factor
   * Authentication page is named with, and Korean the one its Dashboard,
   * Admin Dashboard and docs say 49 times to the page title's 10. Google's
   * own 2-Step Verification, on the Google Workspace page, keeps Google's
   * name for it.
   */
  {
    // Tofaktorgodkendelse (the page, the Admin Dashboard) over totrinsgodkendelse (the docs).
    language: "da",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /tofaktor/i,
    dropped: /totrins|to-faktor/i,
  },
  {
    // दो-कारक प्रमाणीकरण over the transliterated टू-फ़ैक्टर ऑथेंटिकेशन and दो-चरणीय प्रमाणीकरण.
    language: "hi",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /दो-कारक/,
    dropped: /टू[- ]फ़?ैक्टर|टू फैक्टर|दो-चरणीय/,
  },
  {
    language: "ko",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /2단계 인증/,
    dropped: /이중 인증/,
  },
  {
    // Tweefactorauthenticatie (the page, the Admin Dashboard) over tweestapsverificatie (the docs).
    language: "nl",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /tweefactor/i,
    dropped: /tweestaps|tweefactor-authenticatie/i,
  },
  {
    // 双因素身份验证 (the page, the docs) over 双重身份验证 (the Admin Dashboard) and 双因素认证.
    language: "zh-CN",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /双因素身份验证|双因素验证码/,
    dropped: /双重(?:身份)?验证|双因素认证/,
  },
  {
    language: "zh-TW",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /雙重驗證/,
    dropped: /雙因素驗證/,
  },
  {
    // "de dois fatores", as the Dashboard says it, over the docs' "em dois fatores".
    language: "pt",
    thing: "Two-factor authentication",
    english: /\btwo[- ]factor\b/i,
    word: /de dois fatores/i,
    dropped: /em dois fatores/i,
  },
  /*
   * The Security pages around it read in English in those languages, and
   * named a passkey and a backup code two ways once they were translated
   * (#8796): the Dashboard's passkey errors said "passkey" (and Traditional
   * Chinese 通行金鑰) where the sign-in page and the docs say each
   * language's word for it; the Chinese docs said 备用码 and 備用碼 where
   * the sign-in page, the Admin Dashboard and the Dashboard say 备用代码
   * and 備用代碼; the Norwegian app docs called a passkey "tilgangsnøkkel",
   * Norwegian's word for an AWS access key, and the Swedish ones "passkey".
   * Each now says the sign-in page's word.
   */
  {
    language: "da",
    thing: "Passkeys",
    english: /\bpasskeys?\b/i,
    word: /adgangsnøgle/i,
    dropped: /\bpasskey/i,
  },
  {
    language: "fr",
    thing: "Passkeys",
    english: /\bpasskeys?\b/i,
    word: /clés? d['’]accès/i,
    dropped: /\bpasskey/i,
  },
  {
    language: "no",
    thing: "Passkeys",
    english: /\bpasskeys?\b/i,
    word: /passnøk(?:kel|ler)/i,
    dropped: /\bpasskey|tilgangsnøk/i,
  },
  {
    language: "pt",
    thing: "Passkeys",
    english: /\bpasskeys?\b/i,
    word: /chaves? de acesso/i,
    dropped: /\bpasskey/i,
  },
  {
    language: "ru",
    thing: "Passkeys",
    english: /\bpasskeys?\b/i,
    word: /ключ(?:и|а|ом|ей|ам|ами|ах)? доступа/i,
    dropped: /\bpasskey/i,
  },
  {
    language: "sv",
    thing: "Passkeys",
    english: /\bpasskeys?\b/i,
    word: /passnyck(?:el|lar)/i,
    dropped: /\bpasskey/i,
  },
  {
    language: "zh-TW",
    thing: "Passkeys",
    english: /\bpasskeys?\b/i,
    word: /通行密鑰/,
    dropped: /通行金鑰/,
  },
  {
    language: "zh-CN",
    thing: "Backup codes",
    english: /\bbackup codes?\b/i,
    word: /备用代码/,
    dropped: /备用码/,
  },
  {
    language: "zh-TW",
    thing: "Backup codes",
    english: /\bbackup codes?\b/i,
    word: /備用代碼/,
    dropped: /備用碼/,
  },
  {
    // Runner, declined as its other strings decline it: Runner-а, Runner-ы.
    language: "ru",
    thing: "Runners",
    english: /\brunners?\b/i,
    except: NOT_THE_RUNNER,
    word: /Runner/,
    // The AI agent is a thing of its own, named as the Dashboard names it.
    dropped: /(?<!ИИ-)агент(?![а-яё]*\s+ИИ)|раннер/i,
    docsEnglish: /\bRunners?\b/,
  },
  {
    language: "zh-TW",
    thing: "Runners",
    english: /\brunners?\b/i,
    except: NOT_THE_RUNNER,
    word: /Runner/,
    // The AI agent (AI 代理) is a thing of its own, named as the Dashboard names it.
    dropped: /(?<!AI )代理|執行器/,
    docsEnglish: /\bRunners?\b/,
  },
  /*
   * A node or a host that stopped reporting is Offline, and a cluster or an
   * agent whose connection dropped is Disconnected: two states the Proxmox
   * pages draw side by side. Norwegian said both Frakoblet; Offline is now
   * offline, as Online is Online, and Frakoblet stays Disconnected's (#8767).
   */
  {
    language: "no",
    thing: "Offline",
    english: /\boffline\b/i,
    except: /disconnect|not connected/i,
    word: /offline/i,
    dropped: /frakobl/i,
  },
  // Arabic said غير متصل for all three: Offline keeps it (#8767).
  {
    language: "ar",
    thing: "Disconnected",
    english: /disconnect/i,
    except: /\boffline\b|not connected/i,
    word: /منقطع/,
    dropped: /غير متصل/,
  },
  {
    language: "ar",
    thing: "Not connected",
    english: /not connected/i,
    except: /\boffline\b|disconnect/i,
    word: /غير مرتبط/,
    dropped: /غير متصل/,
  },
  /*
   * Italian spelled the abbreviation two ways: IA, as its AI key and the
   * AI agent's pages do, and AI (Agente AI di OneUptime). It says IA. Names
   * stay as written: the product's, OneUptime AI and AI SRE, and Ask AI and
   * the AI Agent, which every language's docs name in English; other
   * products' (Vertex AI, Vercel AI SDK, Azure AI Inference, Azure's AI
   * Search, Zoom AI Companion, JetBrains AI, Mistral AI) and code's
   * (Microsoft.Extensions.AI); and the permissions', which every language
   * keeps in English (Edit AI Rule, Read AI Agent Task, the Service AI Note
   * ones), as are the labels
   * the Italian Dashboard still draws in English (Generate with AI) and a
   * runbook's AI step, which its editor draws in English (#8768).
   */
  {
    language: "it",
    thing: "AI",
    english: /\bAI\b/,
    word: /\bIA\b/,
    dropped:
      /(?<!OneUptime |Vertex |Vercel |Azure |JetBrains |Mistral |Acme |Ask |with |\.)\bAI\b(?! (?:SDK|Companion|Inference|Agent|Rule|SRE|Search|Note))(?!\.\w)/,
    // A runbook's AI step and the workflow builder's AI section: their headings, their links, their table rows, the list of step types.
    docsExcept: /^#{1,6} AI$|^AI$|^\| AI \||kubectl,? (?:and|or) AI\b/,
  },
  /*
   * An alert, as the Dashboard says it in most strings (#8769): Simplified
   * Chinese 警报, not 告警; Swedish larm, not avisering, the word Swedish
   * says a notification with, so a text that names a notification too
   * keeps it.
   */
  {
    language: "zh-CN",
    thing: "Alerts",
    english: /\balert/i,
    word: /警报/,
    // 警告警报, a warning alert, holds 告警 across its two words.
    dropped: /(?<!警)告警/,
  },
  /*
   * German says an alert eine Warnung, as 2,000 of its strings and the docs
   * 3,500 times do; the noun der Alarm goes. The verb alarmieren and its
   * Alarmierung (paging) stay, and so does a real alarm the English names
   * (an optic's alarm threshold, the phone's alarm sound, a CloudWatch alarm).
   */
  {
    language: "de",
    thing: "Alerts",
    english: /\balerts?\b/i,
    except: /alertmanager|\balarm/i,
    word: /Warnung/,
    dropped: /\bAlarm(?!ier)/,
  },
  {
    language: "sv",
    thing: "Alerts",
    english: /\balert/i,
    except:
      /notif|notify|notified|remind|notice|announce|\bpush|critical alert/i,
    word: /\blarm/i,
    dropped: /\bavisering/i,
  },
  {
    /*
     * Its Broker health section, its broker metrics and its docs say
     * بروکر; the Queues pages' broker column and picker said کارگزار, so
     * one setup guide named the broker both ways (#8799).
     */
    language: "fa",
    thing: "Brokers",
    english: /\bbrokers?\b/i,
    word: /بروکر/,
    dropped: /کارگزار/,
  },
  /*
   * The docs suites hold a page's bold labels to its Dashboard's words, but
   * the same names still read otherwise in headings and prose (#8812).
   * Persian names the control plane صفحه کنترل, as its Dashboard's Control
   * Plane and Control plane do: the Kubernetes and OpenStack pages and
   * cards, and the control plane they read. (Code such as
   * control-plane-targets.py and OpenStackControlPlane is no word.)
   */
  {
    language: "fa",
    thing: "Control Plane",
    english: /\bcontrol[ -]plane/i,
    word: /صفحه کنترل/,
    dropped: /\bcontrol[ -]plane/i,
  },
  /*
   * A database's engine metrics: Danish calls an engine Motor, so they are
   * motormetrikker, not engine-metrikker; Dutch keeps Engine and says
   * Metrieken, so engine-metrieken, not enginemetrics, enginemetrieken or
   * engine-metrics. A monitor template's name, Engine Metrics Stopped,
   * reads as every language writes it, in bold, which the docs suites hold
   * to the template (#8812).
   */
  {
    language: "da",
    thing: "Engine metrics",
    english: /\bengine metrics?\b/i,
    word: /motormetrik/i,
    dropped: /\bengine[ -]?metri/i,
  },
  {
    language: "nl",
    thing: "Engine metrics",
    english: /\bengine metrics?\b/i,
    word: /engine-metrie[kc]/i,
    dropped: /\bengine ?metri|\bengine-metrics/i,
  },
  /*
   * An ingestion key: the Ingestion Keys page's title, its Create button and
   * every sentence about one say the same word, the one the page's title and
   * the docs say (#8806). Swedish titled the card Intagningsnycklar over a
   * Skapa ingestion-nyckel button, Danish Indtagelsesnøgler over Opret
   * ingestion-nøgle, Italian Chiavi di acquisizione over Crea chiave di
   * ingestione. The seven other languages said one word already
   * (INGESTION_KEY_WORDS).
   */
  {
    language: "da",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /indtagelsesnøgl/i,
    dropped:
      /ingestion-?nøgl|ingestionsnøgl|indlæsningsnøgl|nøgle til telemetri-indtagelse/i,
  },
  {
    language: "de",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /Ingestion-Schlüssel/i,
    dropped: /Aufnahme-?schlüssel|Erfassungs-?schlüssel|Ingestion-?Key/i,
  },
  {
    language: "hi",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /इंजेशन/,
    dropped: /इन्जेशन|इनजेशन/,
  },
  {
    language: "it",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /chiav[ei] di acquisizione/i,
    dropped: /chiav[ei] di ingestione/i,
  },
  {
    language: "ja",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /取り込みキー/,
    dropped: /インジェス(?:ト|ション)キー/,
  },
  {
    language: "nl",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /ingestiesleutel/i,
    dropped: /inname-?sleutel|opnamesleutel/i,
  },
  {
    language: "no",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /inntaksnøk/i,
    dropped:
      /ingestion-?nøk|innhentingsnøk|innsamlingsnøk|nøkkel for telemetri-inntak/i,
  },
  {
    language: "ru",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /ключ\p{L}* приёма/iu,
    dropped: /приема/i,
  },
  {
    language: "sv",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /intagningsnyck/i,
    dropped:
      /ingestion-?nyck|inmatningsnyck|intagsnyck|nyckel för telemetriinmatning|telemetrinyckel för inmatning/i,
  },
  {
    language: "zh-CN",
    thing: "Ingestion Keys",
    english: INGESTION_KEY,
    word: /摄取密钥/,
    dropped: /引入密钥|采集密钥/,
  },
  /*
   * Hindi spells an event इवेंट, as its Event and Events keys, its glossary,
   * 1,059 Dashboard strings and its docs do. 18 strings (Event Labels,
   * Event Title, the trace's event attributes ...) and a few docs lines
   * spelled it ईवेंट (#8824).
   */
  {
    language: "hi",
    thing: "Events",
    english: /\bevents?\b/i,
    word: /इवेंट/,
    dropped: /ईवेंट/,
  },
];

/*
 * Each language's word for an ingestion key, in all 17: every Dashboard and
 * Admin Dashboard string whose English names an ingestion key says it
 * (OneWordInSentencesPerThing).
 */
export const INGESTION_KEY_WORDS: Readonly<Record<string, RegExp>> = {
  ar: /استيعاب/,
  da: /indtagelsesnøgl/i,
  de: /Ingestion-Schlüssel/i,
  es: /claves? de ingesta/i,
  fa: /کلید(?:های)? دریافت/,
  fr: /clés? d['’]ingestion/i,
  hi: /इंजेशन/,
  it: /chiav[ei] di acquisizione/i,
  ja: /取り込みキー/,
  ko: /수집 키/,
  nl: /ingestiesleutel/i,
  no: /inntaksnøk/i,
  pt: /chaves? de ingestão/i,
  ru: /ключ\p{L}* приёма/iu,
  sv: /intagningsnyck/i,
  "zh-CN": /摄取密钥/,
  "zh-TW": /擷取金鑰/,
};
