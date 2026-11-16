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
];
