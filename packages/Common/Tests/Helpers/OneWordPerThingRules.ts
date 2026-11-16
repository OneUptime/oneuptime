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
 *
 * Each language now says one word. A word like 알림 or "overvågning" also
 * has a meaning of its own (a notification, the act of monitoring), so a
 * check reads the texts whose English names the thing, and only those: a
 * text whose English names the thing says the language's word and not the
 * dropped one. The Dashboard's and the Admin Dashboard's locale files and
 * the docs are held to these rules (OneWordInSentencesPerThing), and so is
 * every setup guide's words (SetupGuideDocumentationInLocale): one list,
 * so a rename reaches them all.
 */

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
}

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
    // Runner, declined as its other strings decline it: Runner-а, Runner-ы.
    language: "ru",
    thing: "Runners",
    english: /\brunners?\b/i,
    except: NOT_THE_RUNNER,
    word: /Runner/,
    dropped: /агент|раннер/i,
    docsEnglish: /\bRunners?\b/,
  },
  {
    language: "zh-TW",
    thing: "Runners",
    english: /\brunners?\b/i,
    except: NOT_THE_RUNNER,
    word: /Runner/,
    dropped: /代理|執行器/,
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
   * keeps in English (Edit AI Rule, Read AI Agent Task), as are the labels
   * the Italian Dashboard still draws in English (Generate with AI) and a
   * runbook's AI step, which its editor draws in English (#8768).
   */
  {
    language: "it",
    thing: "AI",
    english: /\bAI\b/,
    word: /\bIA\b/,
    dropped:
      /(?<!OneUptime |Vertex |Vercel |Azure |JetBrains |Mistral |Acme |Ask |with |\.)\bAI\b(?! (?:SDK|Companion|Inference|Agent|Rule|SRE|Search))(?!\.\w)/,
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
];
