/*
 * "HOW DO I...?" - THE QUESTIONS ASK AI MUST ANSWER FROM THE DOCS (issue
 * #6828).
 *
 * Real questions: the ones the issue names, the Quickstart's steps, and
 * the ones customers filed as feature requests for something OneUptime
 * already did. Each names the docs page that answers it and, for a "how do
 * I", the Dashboard page where it is done, by the name Search gives it.
 *
 * AskAiHowDoIRetrieval.test.ts holds the docs search and the page finder
 * to them offline. `npm run ask-ai-eval -- --suite=how-do-i
 * --llm-type=<type> --model=<name>` asks a live model each question
 * through Ask AI's chat turn and grades the answer (#7066): a citation of
 * `docsPage` (or of a page `alsoAnswers` names), a Go to button for
 * `dashboardPage`, and "The docs do not cover this." for the questions of
 * ASK_AI_NOT_COVERED_QUESTIONS. It asks these, the German and Persian ones
 * below (ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED), those, and the ones asked
 * on a page (ASK_AI_PAGE_CONTEXT_QUESTIONS, #7062, #7065). The runner is
 * App's scripts/ask-ai-eval.ts, documented in Docs/ai/evals.md.
 */

import AIChatPageContextType, {
  AIChatPageContext,
} from "Common/Types/AI/AIChatPageContext";
import {
  AskAiEvalNamedRecord,
  AskAiEvalProject,
  AskAiEvalProjectKind,
  getAskAiEvalProject,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalProject";

export interface AskAiHowDoIQuestion {
  question: string;
  // The page under /docs/<lang>/ that answers it.
  docsPage: string;
  // Other pages that answer it as well.
  alsoAnswers?: Array<string> | undefined;
  /*
   * The words the model searches with, where the question's own are not
   * the docs' words ("a text" for an SMS): the model rephrases, the
   * search does not.
   */
  searchWords?: string | undefined;
  // The Dashboard page or setting where it is done, as Search names it.
  dashboardPage?: string | undefined;
  // Its route, as find_dashboard_page's citation carries it.
  dashboardPath?: string | undefined;
}

export const ASK_AI_HOW_DO_I_QUESTIONS: ReadonlyArray<AskAiHowDoIQuestion> = [
  {
    question: "How do I get a text when my site is down?",
    searchWords: "SMS notification when a monitor is down",
    docsPage: "notifications/notification-methods",
    // The guide (#6821) walks it from nothing to a tested page.
    alsoAnswers: ["guides/paging"],
    dashboardPage: "Phone Numbers for SMS Notifications",
    dashboardPath: "/dashboard/:projectId/user-settings/notification-methods",
  },
  {
    question: "How do I get paged on my phone when something breaks?",
    docsPage: "guides/paging",
    alsoAnswers: ["on-call/index", "notifications/notification-methods"],
    dashboardPage: "Page the right person when something breaks",
    dashboardPath: "/dashboard/:projectId/on-call-duty/setup",
  },
  {
    question: "What is an episode?",
    docsPage: "incidents/episodes",
  },
  {
    question: "Where do I add a second phone number?",
    docsPage: "notifications/notification-methods",
    dashboardPage: "Notification Methods",
    dashboardPath: "/dashboard/:projectId/user-settings/notification-methods",
  },
  {
    question: "How do I monitor my website?",
    docsPage: "monitor/website-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I create a monitor?",
    docsPage: "monitor/create-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I set up an on-call schedule?",
    docsPage: "on-call/schedules",
    dashboardPage: "On-Call Schedules",
    dashboardPath: "/dashboard/:projectId/on-call-duty/schedules",
  },
  {
    question: "How do I create an on-call policy?",
    docsPage: "on-call/policies",
    dashboardPage: "On-Call Policies",
    dashboardPath: "/dashboard/:projectId/on-call-duty/policies",
  },
  {
    question:
      "How do I escalate to someone else when the first person does not answer?",
    docsPage: "on-call/escalation-rules",
    alsoAnswers: ["guides/paging"],
    dashboardPage: "On-Call Policies",
    dashboardPath: "/dashboard/:projectId/on-call-duty/policies",
  },
  {
    question:
      "How do I cover someone's on-call shift while they are on vacation?",
    docsPage: "on-call/user-overrides",
    dashboardPage: "User Overrides",
  },
  {
    question: "How do I create a status page?",
    docsPage: "status-pages/index",
    alsoAnswers: ["guides/status-page"],
    dashboardPage: "All Status Pages",
    dashboardPath: "/dashboard/:projectId/status-pages",
  },
  {
    question: "How do I use my own domain for my status page?",
    docsPage: "status-pages/branding-and-domains",
    alsoAnswers: ["guides/status-page"],
  },
  {
    question: "How do I publish a status page on my own domain, with HTTPS?",
    docsPage: "guides/status-page",
    alsoAnswers: ["status-pages/branding-and-domains"],
    dashboardPage: "Publish a status page",
    dashboardPath: "/dashboard/:projectId/status-pages/setup",
  },
  {
    question: "How can my customers subscribe to status page updates?",
    docsPage: "status-pages/subscribers",
  },
  {
    question: "How do I schedule maintenance?",
    docsPage: "scheduled-maintenance/creating-events",
    // As the page's own button and the docs name it (#8834).
    dashboardPage: "Create Maintenance Event",
    dashboardPath: "/dashboard/:projectId/scheduled-maintenance-events/create",
  },
  {
    question: "How do I declare an incident?",
    docsPage: "incidents/declaring-incidents",
    dashboardPage: "Declare Incident",
    dashboardPath: "/dashboard/:projectId/incidents/create",
  },
  {
    question: "How do I write a postmortem?",
    docsPage: "incidents/postmortems",
    dashboardPage: "Postmortems",
  },
  {
    question: "How do I add my own incident severities?",
    docsPage: "incidents/states-and-severities",
    dashboardPage: "Incident Severity",
  },
  {
    question: "How do I connect Slack?",
    docsPage: "workspace-connections/slack",
  },
  {
    question: "How do I connect Microsoft Teams?",
    docsPage: "workspace-connections/microsoft-teams",
  },
  {
    question: "How do I invite a teammate to my project?",
    docsPage: "permissions/inviting-people",
    dashboardPage: "All Users",
  },
  {
    question: "How do I set up SSO with SAML?",
    docsPage: "identity/sso",
    dashboardPage: "SSO",
  },
  {
    question: "How do I create an API key?",
    docsPage: "api-reference/api-reference",
    dashboardPage: "API Keys",
    dashboardPath: "/dashboard/:projectId/settings/api-keys",
  },
  {
    question: "How do I send my logs and traces with OpenTelemetry?",
    docsPage: "telemetry/open-telemetry",
  },
  {
    question: "Where do I get a telemetry ingestion key?",
    docsPage: "telemetry/ingestion-keys",
    dashboardPage: "Ingestion Keys",
    dashboardPath: "/dashboard/:projectId/settings/telemetry-ingestion-keys",
  },
  {
    question: "How do I get warned before my SSL certificate expires?",
    docsPage: "monitor/ssl-certificate-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I monitor a server's CPU, memory and disk?",
    docsPage: "monitor/server-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I know when my cron job stops sending a heartbeat?",
    docsPage: "monitor/incoming-request-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I run checks from inside my private network?",
    docsPage: "probe/custom-probe",
    dashboardPage: "Probes",
  },
  {
    question: "How do I check that my API returns the right response?",
    docsPage: "monitor/api-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I run a Playwright synthetic check of my login page?",
    docsPage: "monitor/synthetic-monitor",
    dashboardPage: "Create Monitor",
    dashboardPath: "/dashboard/:projectId/monitors/create",
  },
  {
    question: "How do I turn on two-factor authentication?",
    docsPage: "introduction/your-account",
    dashboardPage: "Two-factor authentication",
  },
  {
    question: "How do I move my on-call setup over from PagerDuty?",
    docsPage: "moving-to-oneuptime/pagerduty",
    dashboardPage: "Import from PagerDuty",
  },
  {
    question: "How do I set up an SLO and its error budget?",
    docsPage: "slo/introduction",
    dashboardPage: "SLOs",
  },
  {
    question: "How do I build a dashboard with charts?",
    docsPage: "dashboards/authoring",
    dashboardPage: "Dashboards",
  },
  {
    question: "How do I run a workflow when an incident is created?",
    docsPage: "workflows/triggers",
    alsoAnswers: [
      "workflows/index",
      "workflows/authoring",
      "incidents/settings",
    ],
    dashboardPage: "Workflows",
  },
  {
    question: "How do I write a runbook?",
    docsPage: "runbooks/authoring",
    dashboardPage: "Runbooks",
  },
  {
    question: "How do I connect my own LLM provider for Ask AI?",
    docsPage: "ai/llm-provider",
    dashboardPage: "LLM Providers",
  },
  {
    question: "How do I give someone a custom role with only some permissions?",
    docsPage: "permissions/index",
    dashboardPage: "Custom Roles",
  },
  {
    question: "How do I get my on-call shifts in my calendar?",
    docsPage: "on-call/calendar-feeds",
    dashboardPage: "Calendar Feed",
  },
  {
    question: "How do I keep logs for longer?",
    searchWords: "log data retention",
    docsPage: "telemetry/data-retention",
    dashboardPage: "Telemetry Data Retention",
  },
  {
    question: "How do I store a password a monitor uses without showing it?",
    docsPage: "monitor/monitor-secrets",
    dashboardPage: "Secrets",
  },
];

export interface AskAiHowDoIQuestionTranslated {
  language: string;
  question: string;
  docsPage: string;
  alsoAnswers?: Array<string> | undefined;
}

/*
 * "How do I monitor my website?" in every docs language (#7875), each
 * phrased as a newcomer there would ask it, and a second common way where
 * the issue measured one. Each finds Website Monitor itself: "Know When
 * Your Website or API Is Down" (guides/website-down) walks the same steps,
 * but it is not counted here, since it came first in Norwegian while
 * Website Monitor, the page named for what is asked, was 9th.
 *
 * Written for this list, not checked by a native speaker.
 */
export const ASK_AI_WEBSITE_QUESTIONS: ReadonlyArray<AskAiHowDoIQuestionTranslated> =
  [
    ["en", "How do I monitor my website?"],
    ["de", "Wie überwache ich meine Website?"],
    ["fr", "Comment surveiller mon site web ?"],
    ["fr", "Comment puis-je surveiller mon site web ?"],
    ["es", "¿Cómo puedo monitorear mi sitio web?"],
    ["it", "Come posso monitorare il mio sito web?"],
    ["pt", "Como faço para monitorar meu site?"],
    ["nl", "Hoe monitor ik mijn website?"],
    ["da", "Hvordan overvåger jeg mit websted?"],
    // The Danish docs never say "hjemmeside": they say "websted" (a synonym).
    ["da", "Hvordan overvåger jeg min hjemmeside?"],
    // "nettstedet" (the website) is "nettsted", the name's word.
    ["no", "Hvordan overvåker jeg nettstedet mitt?"],
    ["no", "Hvordan overvåker jeg mitt nettsted?"],
    // The page's name is one word: "Webbplatsövervakning".
    ["sv", "Hur övervakar jag min webbplats?"],
    ["sv", "Hur kan jag övervaka min webbplats?"],
    ["ru", "Как настроить мониторинг моего сайта?"],
    // "сайт" is the name's "сайта"; the rest are other common ways to ask.
    ["ru", "Как отслеживать мой сайт?"],
    ["ru", "Как мне отслеживать мой веб-сайт?"],
    ["ru", "Как мониторить мой сайт?"],
    ["ru", "Как я могу отслеживать свой сайт?"],
    ["ru", "Как следить за моим сайтом?"],
    ["ru", "Как мне мониторить мой веб-сайт?"],
    ["ru", "Как отслеживать работу моего сайта?"],
    ["ru", "Как мне отслеживать свой веб-сайт?"],
    ["ja", "ウェブサイトを監視するにはどうすればいいですか？"],
    // "웹사이트를" is "웹사이트" with its object's mark.
    ["ko", "내 웹사이트를 어떻게 모니터링하나요?"],
    ["ko", "웹사이트를 모니터링하려면 어떻게 해야 하나요?"],
    ["zh-CN", "如何监控我的网站？"],
    ["zh-TW", "如何監控我的網站？"],
    ["hi", "मैं अपनी वेबसाइट को मॉनिटर कैसे करूँ?"],
    ["hi", "मैं अपनी वेबसाइट की निगरानी कैसे करूँ?"],
    // "سایتم" (my site) is "سایت".
    ["fa", "چطور وب‌سایتم را پایش کنم؟"],
  ].map(
    ([language, question]: Array<string>): AskAiHowDoIQuestionTranslated => {
      return {
        language: language!,
        question: question!,
        docsPage: "monitor/website-monitor",
      };
    },
  );

/*
 * Other questions asked in each docs language, as a newcomer there would
 * ask them: a status page, an on-call schedule, an incident, maintenance
 * and a monitor (#7875). Written for this list, not checked by a native
 * speaker.
 */
const STATUS_PAGE: Array<string> = [
  "status-pages/index",
  "status-pages/one-status-page-per-audience",
];
const MAINTENANCE: Array<string> = [
  "scheduled-maintenance/creating-events",
  "scheduled-maintenance/index",
];

export const ASK_AI_HOW_DO_I_QUESTIONS_IN_EVERY_LANGUAGE: ReadonlyArray<AskAiHowDoIQuestionTranslated> =
  [
    ["fr", "Comment créer une page de statut ?", STATUS_PAGE],
    [
      "fr",
      "Comment configurer un planning d'astreinte ?",
      ["on-call/schedules"],
    ],
    ["fr", "Comment déclarer un incident ?", ["incidents/declaring-incidents"]],
    ["fr", "Comment planifier une maintenance ?", MAINTENANCE],
    ["fr", "Comment créer un moniteur ?", ["monitor/create-monitor"]],
    ["es", "¿Cómo creo una página de estado?", STATUS_PAGE],
    [
      "es",
      "¿Cómo configuro una programación de guardia?",
      ["on-call/schedules"],
    ],
    ["es", "¿Cómo declaro un incidente?", ["incidents/declaring-incidents"]],
    ["es", "¿Cómo programo un mantenimiento?", MAINTENANCE],
    ["es", "¿Cómo creo un monitor?", ["monitor/create-monitor"]],
    ["it", "Come creo una pagina di stato?", STATUS_PAGE],
    [
      "it",
      "Come imposto una pianificazione di reperibilità?",
      ["on-call/schedules"],
    ],
    ["it", "Come dichiaro un incidente?", ["incidents/declaring-incidents"]],
    ["it", "Come pianifico una manutenzione?", MAINTENANCE],
    ["it", "Come creo un monitor?", ["monitor/create-monitor"]],
    ["pt", "Como crio uma página de status?", STATUS_PAGE],
    ["pt", "Como configuro um agendamento de plantão?", ["on-call/schedules"]],
    ["pt", "Como declaro um incidente?", ["incidents/declaring-incidents"]],
    ["pt", "Como agendo uma manutenção?", MAINTENANCE],
    ["pt", "Como crio um monitor?", ["monitor/create-monitor"]],
    ["nl", "Hoe maak ik een statuspagina?", STATUS_PAGE],
    ["nl", "Hoe stel ik een bereikbaarheidsschema in?", ["on-call/schedules"]],
    ["nl", "Hoe meld ik een incident?", ["incidents/declaring-incidents"]],
    ["nl", "Hoe plan ik onderhoud?", MAINTENANCE],
    ["nl", "Hoe maak ik een monitor?", ["monitor/create-monitor"]],
    ["da", "Hvordan opretter jeg en statusside?", STATUS_PAGE],
    ["da", "Hvordan opsætter jeg en vagtplan?", ["on-call/schedules"]],
    [
      "da",
      "Hvordan opretter jeg en hændelse?",
      ["incidents/declaring-incidents"],
    ],
    ["da", "Hvordan planlægger jeg vedligeholdelse?", MAINTENANCE],
    ["da", "Hvordan opretter jeg en monitor?", ["monitor/create-monitor"]],
    ["no", "Hvordan lager jeg en statusside?", STATUS_PAGE],
    ["no", "Hvordan setter jeg opp en vaktplan?", ["on-call/schedules"]],
    [
      "no",
      "Hvordan oppretter jeg en hendelse?",
      ["incidents/declaring-incidents"],
    ],
    ["no", "Hvordan planlegger jeg vedlikehold?", MAINTENANCE],
    ["no", "Hvordan oppretter jeg en monitor?", ["monitor/create-monitor"]],
    ["sv", "Hur skapar jag en statussida?", STATUS_PAGE],
    ["sv", "Hur ställer jag in ett jourschema?", ["on-call/schedules"]],
    [
      "sv",
      "Hur deklarerar jag en incident?",
      ["incidents/declaring-incidents"],
    ],
    ["sv", "Hur planerar jag underhåll?", MAINTENANCE],
    ["sv", "Hur skapar jag en monitor?", ["monitor/create-monitor"]],
    ["ru", "Как создать страницу статуса?", STATUS_PAGE],
    ["ru", "Как настроить расписание дежурств?", ["on-call/schedules"]],
    ["ru", "Как объявить инцидент?", ["incidents/declaring-incidents"]],
    ["ru", "Как запланировать обслуживание?", MAINTENANCE],
    ["ru", "Как создать монитор?", ["monitor/create-monitor"]],
    ["ja", "ステータスページを作成するにはどうすればいいですか？", STATUS_PAGE],
    [
      "ja",
      "オンコールスケジュールを設定するにはどうすればいいですか？",
      ["on-call/schedules"],
    ],
    [
      "ja",
      "インシデントを宣言するにはどうすればいいですか？",
      ["incidents/declaring-incidents"],
    ],
    ["ja", "メンテナンスを予定するにはどうすればいいですか？", MAINTENANCE],
    [
      "ja",
      "モニターを作成するにはどうすればいいですか？",
      ["monitor/create-monitor"],
    ],
    ["ko", "상태 페이지를 어떻게 만드나요?", STATUS_PAGE],
    ["ko", "온콜 스케줄을 어떻게 설정하나요?", ["on-call/schedules"]],
    ["ko", "인시던트를 어떻게 선언하나요?", ["incidents/declaring-incidents"]],
    ["ko", "유지 관리를 어떻게 예약하나요?", MAINTENANCE],
    ["ko", "모니터를 어떻게 만드나요?", ["monitor/create-monitor"]],
    ["zh-CN", "如何创建状态页？", STATUS_PAGE],
    ["zh-CN", "如何设置值班计划？", ["on-call/schedules"]],
    ["zh-CN", "如何声明事件？", ["incidents/declaring-incidents"]],
    ["zh-CN", "如何安排维护？", MAINTENANCE],
    ["zh-CN", "如何创建监视器？", ["monitor/create-monitor"]],
    ["zh-TW", "如何建立狀態頁？", STATUS_PAGE],
    ["zh-TW", "如何設定待命排程？", ["on-call/schedules"]],
    ["zh-TW", "如何宣告事件？", ["incidents/declaring-incidents"]],
    ["zh-TW", "如何安排維護？", MAINTENANCE],
    ["zh-TW", "如何建立監測器？", ["monitor/create-monitor"]],
    ["hi", "मैं स्थिति पृष्ठ कैसे बनाऊँ?", STATUS_PAGE],
    ["hi", "मैं ऑन-कॉल अनुसूची कैसे सेट करूँ?", ["on-call/schedules"]],
    ["hi", "मैं घटना कैसे घोषित करूँ?", ["incidents/declaring-incidents"]],
    ["hi", "मैं रखरखाव कैसे शेड्यूल करूँ?", MAINTENANCE],
    ["hi", "मैं मॉनिटर कैसे बनाऊँ?", ["monitor/create-monitor"]],
    ["fa", "چطور زمان‌بندی آنکال را تنظیم کنم؟", ["on-call/schedules"]],
    ["fa", "چطور تعمیر و نگهداری را زمان‌بندی کنم؟", MAINTENANCE],
    ["de", "Wie erstelle ich einen Monitor?", ["monitor/create-monitor"]],
    [
      "de",
      "Wie erstelle ich eine Bereitschaftsrichtlinie?",
      ["on-call/policies"],
    ],
  ].map(
    ([language, question, pages]: Array<
      string | Array<string>
    >): AskAiHowDoIQuestionTranslated => {
      const answering: Array<string> = pages as Array<string>;

      return {
        language: language as string,
        question: question as string,
        docsPage: answering[0]!,
        ...(answering.length > 1 ? { alsoAnswers: answering.slice(1) } : {}),
      };
    },
  );

/*
 * The same questions asked in German and in Persian (written right to
 * left), as a newcomer there would ask them. Their website questions are
 * in ASK_AI_WEBSITE_QUESTIONS.
 */
export const ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED: ReadonlyArray<AskAiHowDoIQuestionTranslated> =
  [
    {
      language: "de",
      question: "Wie erstelle ich eine Statusseite?",
      docsPage: "status-pages/index",
    },
    {
      language: "de",
      question: "Wie richte ich einen Bereitschaftsplan ein?",
      docsPage: "on-call/schedules",
    },
    {
      language: "de",
      question: "Wie plane ich eine Wartung?",
      docsPage: "scheduled-maintenance/creating-events",
      alsoAnswers: ["scheduled-maintenance/index"],
    },
    /*
     * The product's button is "API-Schlüssel erstellen" (#7876). While the
     * API reference called its step "anlegen", these found it 8th, after six
     * migration guides whose "erstellen" step makes a key in the other tool.
     */
    {
      language: "de",
      question: "Wie erstelle ich einen API-Schlüssel?",
      docsPage: "api-reference/api-reference",
    },
    {
      language: "de",
      question: "Wie kann ich einen API-Schlüssel erstellen?",
      docsPage: "api-reference/api-reference",
    },
    {
      language: "fa",
      question: "چطور یک صفحه وضعیت بسازم؟",
      docsPage: "status-pages/index",
      alsoAnswers: ["status-pages/one-status-page-per-audience"],
    },
    {
      language: "fa",
      question: "چطور یک حادثه اعلام کنم؟",
      docsPage: "incidents/declaring-incidents",
    },
  ];

/*
 * QUESTIONS AS EACH LANGUAGE ASKS THEM (#8335): ten or so in every docs
 * language but English, each with the page it must find, typed the way
 * someone who speaks the language asks: inviting a colleague, an on-call
 * policy, an API key, a backup, a runbook, a dashboard, a postmortem,
 * two-factor authentication, the audit log export, escalation and status
 * page subscribers. Each asks with the verb forms a question takes, not
 * the ones the docs name a page with: Persian "بسازم" (may I make) for
 * "ساخت" (making), Korean "만드나요" (do I make?) for "만들기", Hindi
 * "नीति" (policy) for "नीतियां" (policies), Russian "настроить" (set up)
 * for "Настройки" (settings), Danish "inviterer" for "Inviter".
 *
 * AskAiHowDoIRetrieval holds Ask AI's search to them (the 6 it shows the
 * model) and DocsSearchRealDocs the docs search box (its first 10), but
 * for the ones each lists as not found yet, with why.
 *
 * Written for #8335 without a native reviewer: each was checked against
 * the forms the docs of its language use, and the pull request says how.
 */
export const ASK_AI_QUESTIONS_BY_LANGUAGE: ReadonlyArray<AskAiHowDoIQuestionTranslated> =
  [
    [
      "de",
      "Wie lade ich jemanden in mein Projekt ein?",
      ["permissions/inviting-people"],
    ],
    ["de", "Wie mache ich ein Backup von OneUptime?", ["installation/backups"]],
    ["de", "Wie schreibe ich ein Runbook?", ["runbooks/authoring"]],
    ["de", "Wie erstelle ich ein Dashboard?", ["dashboards/authoring"]],
    [
      "de",
      "Wie schreibe ich eine Postmortem-Analyse?",
      ["incidents/postmortems"],
    ],
    [
      "de",
      "Wie aktiviere ich die Zwei-Faktor-Authentifizierung?",
      ["introduction/your-account"],
    ],
    [
      "de",
      "Wie exportiere ich das Audit-Protokoll?",
      ["configuration/audit-log-export"],
    ],
    [
      "de",
      "Wie eskaliere ich, wenn niemand antwortet?",
      ["on-call/escalation-rules"],
    ],
    [
      "de",
      "Wie können Kunden meine Statusseite abonnieren?",
      ["status-pages/subscribers"],
    ],

    [
      "fr",
      "Comment inviter un collègue dans mon projet ?",
      ["permissions/inviting-people"],
    ],
    ["fr", "Comment créer une politique d'astreinte ?", ["on-call/policies"]],
    ["fr", "Comment créer une clé API ?", ["api-reference/api-reference"]],
    ["fr", "Comment sauvegarder OneUptime ?", ["installation/backups"]],
    ["fr", "Comment rédiger un runbook ?", ["runbooks/authoring"]],
    ["fr", "Comment créer un tableau de bord ?", ["dashboards/authoring"]],
    ["fr", "Comment rédiger un post-mortem ?", ["incidents/postmortems"]],
    [
      "fr",
      "Comment activer l'authentification à deux facteurs ?",
      ["introduction/your-account"],
    ],
    [
      "fr",
      "Comment exporter le journal d'audit ?",
      ["configuration/audit-log-export"],
    ],
    [
      "fr",
      "Comment mes clients peuvent-ils s'abonner à ma page de statut ?",
      ["status-pages/subscribers"],
    ],

    [
      "es",
      "¿Cómo invito a un compañero a mi proyecto?",
      ["permissions/inviting-people"],
    ],
    ["es", "¿Cómo creo una política de guardia?", ["on-call/policies"]],
    ["es", "¿Cómo creo una clave de API?", ["api-reference/api-reference"]],
    [
      "es",
      "¿Cómo hago una copia de seguridad de OneUptime?",
      ["installation/backups"],
    ],
    ["es", "¿Cómo escribo un runbook?", ["runbooks/authoring"]],
    ["es", "¿Cómo creo un panel?", ["dashboards/authoring"]],
    ["es", "¿Cómo redacto un informe post mortem?", ["incidents/postmortems"]],
    [
      "es",
      "¿Cómo activo la autenticación de dos factores?",
      ["introduction/your-account"],
    ],
    [
      "es",
      "¿Cómo exporto el registro de auditoría?",
      ["configuration/audit-log-export"],
    ],
    [
      "es",
      "¿Cómo se suscriben mis clientes a la página de estado?",
      ["status-pages/subscribers"],
    ],
    // "suscribirse" is "suscrib", as "suscribo" is: a verb with its "self" on it.
    [
      "es",
      "¿Cómo pueden mis clientes suscribirse a mi página de estado?",
      ["status-pages/subscribers"],
    ],

    [
      "it",
      "Come invito un collega nel mio progetto?",
      ["permissions/inviting-people"],
    ],
    ["it", "Come creo una policy di reperibilità?", ["on-call/policies"]],
    ["it", "Come creo una chiave API?", ["api-reference/api-reference"]],
    ["it", "Come faccio il backup di OneUptime?", ["installation/backups"]],
    ["it", "Come scrivo un runbook?", ["runbooks/authoring"]],
    ["it", "Come creo una dashboard?", ["dashboards/authoring"]],
    ["it", "Come scrivo un post-mortem?", ["incidents/postmortems"]],
    [
      "it",
      "Come attivo l'autenticazione a due fattori?",
      ["introduction/your-account"],
    ],
    [
      "it",
      "Come esporto il registro di audit?",
      ["configuration/audit-log-export"],
    ],
    [
      "it",
      "Come si iscrivono i clienti alla pagina di stato?",
      ["status-pages/subscribers"],
    ],

    [
      "pt",
      "Como convido um colega para o meu projeto?",
      ["permissions/inviting-people"],
    ],
    ["pt", "Como crio uma política de plantão?", ["on-call/policies"]],
    ["pt", "Como crio uma chave de API?", ["api-reference/api-reference"]],
    ["pt", "Como faço backup do OneUptime?", ["installation/backups"]],
    ["pt", "Como escrevo um runbook?", ["runbooks/authoring"]],
    ["pt", "Como crio um painel?", ["dashboards/authoring"]],
    ["pt", "Como escrevo um post-mortem?", ["incidents/postmortems"]],
    [
      "pt",
      "Como ativo a autenticação de dois fatores?",
      ["introduction/your-account"],
    ],
    [
      "pt",
      "Como exporto o registro de auditoria?",
      ["configuration/audit-log-export"],
    ],
    [
      "pt",
      "Como meus clientes assinam a página de status?",
      ["status-pages/subscribers"],
    ],

    // "nodig ... uit" is the name's "uitnodigen" (invite), written apart.
    [
      "nl",
      "Hoe nodig ik een collega uit voor mijn project?",
      ["permissions/inviting-people"],
    ],
    ["nl", "Hoe maak ik een bereikbaarheidsbeleid?", ["on-call/policies"]],
    ["nl", "Hoe maak ik een API-sleutel aan?", ["api-reference/api-reference"]],
    ["nl", "Hoe maak ik een back-up van OneUptime?", ["installation/backups"]],
    ["nl", "Hoe schrijf ik een runbook?", ["runbooks/authoring"]],
    ["nl", "Hoe maak ik een dashboard?", ["dashboards/authoring"]],
    ["nl", "Hoe schrijf ik een postmortem?", ["incidents/postmortems"]],
    [
      "nl",
      "Hoe zet ik tweestapsverificatie aan?",
      ["introduction/your-account"],
    ],
    [
      "nl",
      "Hoe exporteer ik het auditlogboek?",
      ["configuration/audit-log-export"],
    ],
    [
      "nl",
      "Hoe kunnen klanten zich abonneren op mijn statuspagina?",
      ["status-pages/subscribers"],
    ],

    // "inviterer" (invite) is the name's "Inviter" (invite!).
    [
      "da",
      "Hvordan inviterer jeg en kollega til mit projekt?",
      ["permissions/inviting-people"],
    ],
    ["da", "Hvordan opretter jeg en vagtpolitik?", ["on-call/policies"]],
    [
      "da",
      "Hvordan opretter jeg en API-nøgle?",
      ["api-reference/api-reference"],
    ],
    [
      "da",
      "Hvordan tager jeg en sikkerhedskopi af OneUptime?",
      ["installation/backups"],
    ],
    ["da", "Hvordan skriver jeg et runbook?", ["runbooks/authoring"]],
    ["da", "Hvordan opretter jeg et dashboard?", ["dashboards/authoring"]],
    [
      "da",
      "Hvordan skriver jeg en postmortem-analyse?",
      ["incidents/postmortems"],
    ],
    [
      "da",
      "Hvordan slår jeg totrinsgodkendelse til?",
      ["introduction/your-account"],
    ],
    [
      "da",
      "Hvordan eksporterer jeg auditloggen?",
      ["configuration/audit-log-export"],
    ],
    [
      "da",
      "Hvordan kan kunder abonnere på min statusside?",
      ["status-pages/subscribers"],
    ],

    // "inviterer" (invite) is the name's "Inviter" (invite!).
    [
      "no",
      "Hvordan inviterer jeg en kollega til prosjektet mitt?",
      ["permissions/inviting-people"],
    ],
    ["no", "Hvordan oppretter jeg en vaktpolicy?", ["on-call/policies"]],
    ["no", "Hvordan lager jeg en API-nøkkel?", ["api-reference/api-reference"]],
    [
      "no",
      "Hvordan tar jeg sikkerhetskopi av OneUptime?",
      ["installation/backups"],
    ],
    ["no", "Hvordan skriver jeg et runbook?", ["runbooks/authoring"]],
    ["no", "Hvordan lager jeg et dashbord?", ["dashboards/authoring"]],
    ["no", "Hvordan skriver jeg en etteranalyse?", ["incidents/postmortems"]],
    // Said as the Norwegian Dashboard and docs say it (#8701).
    [
      "no",
      "Hvordan slår jeg på tofaktorautentisering?",
      ["introduction/your-account"],
    ],
    [
      "no",
      "Hvordan eksporterer jeg revisjonsloggen?",
      ["configuration/audit-log-export"],
    ],
    [
      "no",
      "Hvordan kan kunder abonnere på statussiden min?",
      ["status-pages/subscribers"],
    ],

    [
      "sv",
      "Hur bjuder jag in en kollega till mitt projekt?",
      ["permissions/inviting-people"],
    ],
    ["sv", "Hur skapar jag en jourpolicy?", ["on-call/policies"]],
    ["sv", "Hur skapar jag en API-nyckel?", ["api-reference/api-reference"]],
    [
      "sv",
      "Hur tar jag en säkerhetskopia av OneUptime?",
      ["installation/backups"],
    ],
    ["sv", "Hur skriver jag ett runbook?", ["runbooks/authoring"]],
    ["sv", "Hur skapar jag en instrumentpanel?", ["dashboards/authoring"]],
    ["sv", "Hur skriver jag en efteranalys?", ["incidents/postmortems"]],
    [
      "sv",
      "Hur aktiverar jag tvåfaktorsautentisering?",
      ["introduction/your-account"],
    ],
    [
      "sv",
      "Hur exporterar jag granskningsloggen?",
      ["configuration/audit-log-export"],
    ],
    [
      "sv",
      "Hur kan kunder prenumerera på min statussida?",
      ["status-pages/subscribers"],
    ],

    // "пригласить" (invite) is the name's "Приглашение" (invitation).
    ["ru", "Как пригласить коллегу в проект?", ["permissions/inviting-people"]],
    ["ru", "Как создать политику дежурств?", ["on-call/policies"]],
    ["ru", "Как создать API-ключ?", ["api-reference/api-reference"]],
    ["ru", "Как сделать резервную копию OneUptime?", ["installation/backups"]],
    ["ru", "Как написать runbook?", ["runbooks/authoring"]],
    ["ru", "Как создать панель мониторинга?", ["dashboards/authoring"]],
    ["ru", "Как написать постмортем?", ["incidents/postmortems"]],
    // "включить" (turn on) is the step's "Включите" (turn on!).
    [
      "ru",
      "Как включить двухфакторную аутентификацию?",
      ["introduction/your-account"],
    ],
    [
      "ru",
      "Как экспортировать журнал аудита?",
      ["configuration/audit-log-export"],
    ],
    [
      "ru",
      "Как клиенты могут подписаться на страницу статуса?",
      ["status-pages/subscribers"],
    ],
    // "настроить" (set up) is the name's "Настройки" (settings).
    [
      "ru",
      "Как настроить уведомления?",
      [
        "notifications/notification-settings",
        "notifications/notification-methods",
        "notifications/index",
      ],
    ],

    [
      "ja",
      "プロジェクトにメンバーを招待するにはどうすればいいですか？",
      ["permissions/inviting-people"],
    ],
    [
      "ja",
      "オンコールポリシーを作成するにはどうすればいいですか？",
      ["on-call/policies"],
    ],
    [
      "ja",
      "API キーを作成するにはどうすればいいですか？",
      ["api-reference/api-reference"],
    ],
    [
      "ja",
      "OneUptime をバックアップするにはどうすればいいですか？",
      ["installation/backups"],
    ],
    ["ja", "Runbook はどうやって書けばいいですか？", ["runbooks/authoring"]],
    [
      "ja",
      "ダッシュボードを作成するにはどうすればいいですか？",
      ["dashboards/authoring"],
    ],
    [
      "ja",
      "ポストモーテムを書くにはどうすればいいですか？",
      ["incidents/postmortems"],
    ],
    [
      "ja",
      "二要素認証を有効にするにはどうすればいいですか？",
      ["introduction/your-account"],
    ],
    [
      "ja",
      "監査ログをエクスポートするにはどうすればいいですか？",
      ["configuration/audit-log-export"],
    ],
    [
      "ja",
      "顧客がステータスページを購読するにはどうすればいいですか？",
      ["status-pages/subscribers"],
    ],

    [
      "ko",
      "팀원을 프로젝트에 어떻게 초대하나요?",
      ["permissions/inviting-people"],
    ],
    // "만드나요" (do I make?) is "만들기" (making): 만들다 drops its ㄹ.
    ["ko", "온콜 정책은 어떻게 만드나요?", ["on-call/policies"]],
    ["ko", "API 키는 어떻게 만드나요?", ["api-reference/api-reference"]],
    ["ko", "OneUptime을 어떻게 백업하나요?", ["installation/backups"]],
    ["ko", "Runbook은 어떻게 작성하나요?", ["runbooks/authoring"]],
    ["ko", "대시보드는 어떻게 만드나요?", ["dashboards/authoring"]],
    ["ko", "포스트모템은 어떻게 작성하나요?", ["incidents/postmortems"]],
    // "켜나요" (do I turn on?) is the heading's "켜기" (turning on).
    ["ko", "2단계 인증은 어떻게 켜나요?", ["introduction/your-account"]],
    // "내보내나요" (do I export?) is the name's "내보내기" (exporting).
    [
      "ko",
      "감사 로그를 어떻게 내보내나요?",
      ["configuration/audit-log-export"],
    ],
    [
      "ko",
      "고객이 상태 페이지를 어떻게 구독하나요?",
      ["status-pages/subscribers"],
    ],
    // "Slack을" is "Slack" with its object's mark.
    ["ko", "Slack을 어떻게 연결하나요?", ["workspace-connections/slack"]],
    // "가져오나요" (do I import?) is the name's "가져오기" (importing).
    ["ko", "리소스를 어떻게 가져오나요?", ["terraform/importing-resources"]],
    ["ko", "모니터를 만들려면 어떻게 해야 하나요?", ["monitor/create-monitor"]],

    ["zh-CN", "如何邀请同事加入我的项目？", ["permissions/inviting-people"]],
    ["zh-CN", "如何创建值班策略？", ["on-call/policies"]],
    ["zh-CN", "如何创建 API 密钥？", ["api-reference/api-reference"]],
    ["zh-CN", "如何备份 OneUptime？", ["installation/backups"]],
    ["zh-CN", "如何编写 Runbook？", ["runbooks/authoring"]],
    ["zh-CN", "如何创建仪表板？", ["dashboards/authoring"]],
    ["zh-CN", "怎么写事后分析？", ["incidents/postmortems"]],
    ["zh-CN", "如何开启双因素认证？", ["introduction/your-account"]],
    ["zh-CN", "如何导出审计日志？", ["configuration/audit-log-export"]],
    ["zh-CN", "客户如何订阅状态页？", ["status-pages/subscribers"]],

    ["zh-TW", "如何邀請同事加入我的專案？", ["permissions/inviting-people"]],
    ["zh-TW", "如何建立待命策略？", ["on-call/policies"]],
    ["zh-TW", "如何建立 API 金鑰？", ["api-reference/api-reference"]],
    ["zh-TW", "如何備份 OneUptime？", ["installation/backups"]],
    ["zh-TW", "如何撰寫 Runbook？", ["runbooks/authoring"]],
    ["zh-TW", "如何建立儀表板？", ["dashboards/authoring"]],
    ["zh-TW", "怎麼寫事後分析？", ["incidents/postmortems"]],
    ["zh-TW", "如何啟用雙重驗證？", ["introduction/your-account"]],
    ["zh-TW", "如何匯出稽核日誌？", ["configuration/audit-log-export"]],
    ["zh-TW", "客戶如何訂閱狀態頁？", ["status-pages/subscribers"]],

    [
      "hi",
      "मैं अपने सहकर्मी को प्रोजेक्ट में कैसे आमंत्रित करूँ?",
      ["permissions/inviting-people"],
    ],
    // "नीति" (policy) is the name's "नीतियां" (policies).
    ["hi", "मैं ऑन-कॉल नीति कैसे बनाऊँ?", ["on-call/policies"]],
    // "कुंजी" (key) is "कुंजियाँ" (keys).
    ["hi", "मैं API कुंजी कैसे बनाऊँ?", ["api-reference/api-reference"]],
    ["hi", "मैं OneUptime का बैकअप कैसे लूँ?", ["installation/backups"]],
    ["hi", "मैं Runbook कैसे लिखूँ?", ["runbooks/authoring"]],
    ["hi", "मैं डैशबोर्ड कैसे बनाऊँ?", ["dashboards/authoring"]],
    ["hi", "मैं पोस्टमॉर्टम कैसे लिखूँ?", ["incidents/postmortems"]],
    [
      "hi",
      "मैं टू-फ़ैक्टर ऑथेंटिकेशन कैसे चालू करूँ?",
      ["introduction/your-account"],
    ],
    [
      "hi",
      "मैं ऑडिट लॉग कैसे एक्सपोर्ट करूँ?",
      ["configuration/audit-log-export"],
    ],
    [
      "hi",
      "ग्राहक मेरे स्थिति पृष्ठ की सदस्यता कैसे लें?",
      ["status-pages/subscribers"],
    ],
    // "नीतियाँ" and the name's "नीतियां" are one plural, written two ways.
    ["hi", "ऑन-कॉल नीतियाँ कैसे काम करती हैं?", ["on-call/policies"]],
    [
      "hi",
      "मैं अनुमति कैसे दूँ?",
      ["permissions/index", "permissions/reference"],
    ],

    [
      "fa",
      "چطور یک هم‌تیمی را به پروژه دعوت کنم؟",
      ["permissions/inviting-people"],
    ],
    ["fa", "چطور یک سیاست آنکال بسازم؟", ["on-call/policies"]],
    ["fa", "چطور یک کلید API بسازم؟", ["api-reference/api-reference"]],
    // "بگیرم" (may I take) is the name's "گیری" (taking): "پشتیبان‌گیری", backing up.
    ["fa", "چطور از OneUptime پشتیبان بگیرم؟", ["installation/backups"]],
    // "بنویسم" (may I write) is the name's "نوشتن" (writing).
    ["fa", "چطور یک رانبوک بنویسم؟", ["runbooks/authoring"]],
    ["fa", "چطور یک داشبورد بسازم؟", ["dashboards/authoring"]],
    ["fa", "چطور گزارش پس از حادثه بنویسم؟", ["incidents/postmortems"]],
    [
      "fa",
      "چطور احراز هویت دومرحله‌ای را فعال کنم؟",
      ["introduction/your-account"],
    ],
    [
      "fa",
      "چطور از گزارش ممیزی خروجی بگیرم؟",
      ["configuration/audit-log-export"],
    ],
    [
      "fa",
      "مشتریان چطور در صفحه وضعیت مشترک شوند؟",
      ["status-pages/subscribers"],
    ],
    // "بسازم" (may I make) is the name's "ساخت" (making): a verb's present and past stems.
    ["fa", "چطور یک مانیتور بسازم؟", ["monitor/create-monitor"]],
    ["fa", "چطور می‌توانم یک مانیتور بسازم؟", ["monitor/create-monitor"]],
    // As it is spoken and typed: "چطوری", "میشه" and "یه".
    ["fa", "چطوری میشه یه مانیتور ساخت؟", ["monitor/create-monitor"]],
  ].map(
    ([language, question, pages]: Array<
      string | Array<string>
    >): AskAiHowDoIQuestionTranslated => {
      const answering: Array<string> = pages as Array<string>;

      return {
        language: language as string,
        question: question as string,
        docsPage: answering[0]!,
        ...(answering.length > 1 ? { alsoAnswers: answering.slice(1) } : {}),
      };
    },
  );

/*
 * Questions the docs do not answer, about something OneUptime does not do:
 * the answer must say "The docs do not cover this." and name the pages it
 * read, never a menu or a setting from memory (#7066).
 */
export const ASK_AI_NOT_COVERED_QUESTIONS: ReadonlyArray<string> = [
  "How do I pay my OneUptime invoice in Bitcoin?",
  "How do I get OneUptime to send me a fax when a monitor goes down?",
  "How do I change the OneUptime app's icon on my phone's home screen?",
];

/*
 * QUESTIONS ASKED ON A PAGE (#7062, #7065).
 *
 * "How do I put this on my own domain?" means nothing without the page it
 * is asked on: Ask AI reads "this" from the page context the Dashboard
 * sends. Each question here is asked on one page - one of the project's
 * records, a setup page, a create form - with the context that page sends,
 * in the eval's project that pages people (its records are the ones the
 * contexts name). Asked on a record, the Go to button must open that
 * record's own page: this status page's Custom Domains, not the list of
 * status pages.
 */
export interface AskAiPageContextQuestion extends AskAiHowDoIQuestion {
  // Where it is asked, as a person would say it: "the Acme Status status page".
  where: string;
  // The context that page sends (PageContext.ts in the Dashboard).
  pageContext: AIChatPageContext;
  /*
   * The page's place, as the server names it in the prompt. None where the
   * context names no page (a monitor's says only which monitor), or one
   * the server's catalogs do not hold (Home).
   */
  onPage?: string | undefined;
  /*
   * The model searches the docs with the page's subject and the question:
   * "this" is not a word the docs index.
   */
  searchWords: string;
}

// The project the questions are asked in, and the records they are asked on.
export const ASK_AI_PAGE_CONTEXT_PROJECT: AskAiEvalProjectKind =
  AskAiEvalProjectKind.PagesPeople;

const PROJECT: AskAiEvalProject = getAskAiEvalProject(
  ASK_AI_PAGE_CONTEXT_PROJECT,
);

const recordOf: (
  records: ReadonlyArray<AskAiEvalNamedRecord>,
  name: string,
) => AskAiEvalNamedRecord = (
  records: ReadonlyArray<AskAiEvalNamedRecord>,
  name: string,
): AskAiEvalNamedRecord => {
  const record: AskAiEvalNamedRecord | undefined = records.find(
    (candidate: AskAiEvalNamedRecord): boolean => {
      return candidate.name === name;
    },
  );

  if (!record) {
    throw new Error(`The eval's project has no record named ${name}.`);
  }

  return record;
};

const ACME_STATUS: AskAiEvalNamedRecord = recordOf(
  PROJECT.statusPages,
  "Acme Status",
);
const WEBSITE_MONITOR: AskAiEvalNamedRecord = recordOf(
  PROJECT.monitors,
  "Website",
);
const DEFAULT_POLICY: AskAiEvalNamedRecord = recordOf(
  PROJECT.policies,
  "Default on-call policy",
);
// The records whose own pages a question is asked on since #10104.
const PRIMARY_ROTATION: AskAiEvalNamedRecord = recordOf(
  PROJECT.onCallSchedules,
  "Primary rotation",
);
const SUPPORT_LINE: AskAiEvalNamedRecord = recordOf(
  PROJECT.incomingCallPolicies,
  "Support line",
);
const PLATFORM_TEAM: AskAiEvalNamedRecord = recordOf(PROJECT.teams, "Platform");
const CHECKOUT_HEALTH: AskAiEvalNamedRecord = recordOf(
  PROJECT.dashboards,
  "Checkout health",
);
const RESTART_THE_API: AskAiEvalNamedRecord = recordOf(
  PROJECT.runbooks,
  "Restart the API",
);
const CHECKOUT_AVAILABILITY: AskAiEvalNamedRecord = recordOf(
  PROJECT.slos,
  "Checkout availability",
);
const REPORT_A_PROBLEM: AskAiEvalNamedRecord = recordOf(
  PROJECT.forms,
  "Report a problem",
);

export const ASK_AI_PAGE_CONTEXT_QUESTIONS: ReadonlyArray<AskAiPageContextQuestion> =
  [
    // On a record: the button opens that record's own page (#7065).
    {
      where: "the Acme Status status page",
      question: "How do I put this on my own domain?",
      pageContext: {
        type: AIChatPageContextType.StatusPage,
        entityId: ACME_STATUS.id,
        entityTitle: ACME_STATUS.name,
        page: "/dashboard/:projectId/status-pages/:id",
      },
      onPage: "Status Page > Overview",
      searchWords: "status page custom domain",
      docsPage: "status-pages/branding-and-domains",
      alsoAnswers: ["guides/status-page"],
      dashboardPage: "Custom Domains",
      dashboardPath: "/dashboard/:projectId/status-pages/:id/domains",
    },
    {
      where: "the Acme Status status page's Subscribers",
      question: "How do I let people subscribe by SMS?",
      pageContext: {
        type: AIChatPageContextType.StatusPage,
        entityId: ACME_STATUS.id,
        entityTitle: ACME_STATUS.name,
        page: "/dashboard/:projectId/status-pages/:id/subscribers",
      },
      onPage: "Status Page > Subscribers",
      searchWords: "status page SMS subscribers",
      docsPage: "status-pages/subscribers",
      dashboardPage: "Subscriber Settings",
      dashboardPath:
        "/dashboard/:projectId/status-pages/:id/subscriber-settings",
    },
    {
      where: "the Website monitor",
      question: "How do I check this from more places, more often?",
      // A monitor's pages say which of them is on screen too (#10104).
      pageContext: {
        type: AIChatPageContextType.Monitor,
        entityId: WEBSITE_MONITOR.id,
        entityTitle: WEBSITE_MONITOR.name,
        page: "/dashboard/:projectId/monitors/:id",
      },
      onPage: "Monitor > Overview",
      searchWords: "monitor probes and interval",
      docsPage: "monitor/create-monitor",
      dashboardPage: "Probes & Interval",
      dashboardPath: "/dashboard/:projectId/monitors/:id/probes",
    },
    {
      where: "the Default on-call policy",
      question: "How do I page someone else when nobody answers?",
      pageContext: {
        type: AIChatPageContextType.OnCallPolicy,
        entityId: DEFAULT_POLICY.id,
        entityTitle: DEFAULT_POLICY.name,
        page: "/dashboard/:projectId/on-call-duty/policies/:id",
      },
      onPage: "On-Call Policy > Basic > Overview",
      searchWords: "on-call policy escalation rules",
      docsPage: "on-call/escalation-rules",
      alsoAnswers: ["on-call/policies", "guides/paging"],
      dashboardPage: "Escalation Rules",
      dashboardPath:
        "/dashboard/:projectId/on-call-duty/policies/:id/escalation",
    },

    /*
     * On the records whose pages sent no context before #10104: each ends
     * at that record's own page, as a status page's does.
     */
    {
      where: "the Primary rotation on-call schedule",
      question: "How do I add a layer to this schedule?",
      pageContext: {
        type: AIChatPageContextType.OnCallSchedule,
        entityId: PRIMARY_ROTATION.id,
        entityTitle: PRIMARY_ROTATION.name,
        page: "/dashboard/:projectId/on-call-duty/schedules/:id",
      },
      onPage: "On-Call Schedule > Basic > Overview",
      searchWords: "on-call schedule layers rotation",
      docsPage: "on-call/schedules",
      dashboardPage: "Layers",
      dashboardPath: "/dashboard/:projectId/on-call-duty/schedules/:id/layers",
    },
    {
      where: "the Support line incoming call policy",
      question: "How do I make this ring someone else when nobody answers?",
      pageContext: {
        type: AIChatPageContextType.IncomingCallPolicy,
        entityId: SUPPORT_LINE.id,
        entityTitle: SUPPORT_LINE.name,
        page: "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id",
      },
      onPage: "Incoming Call Policy > Basic > Overview",
      searchWords: "incoming call policy escalation rules",
      docsPage: "on-call/incoming-call-policy",
      dashboardPage: "Escalation Rules",
      dashboardPath:
        "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/escalation",
    },
    {
      where: "the Platform team",
      question: "How do I add someone to this team?",
      pageContext: {
        type: AIChatPageContextType.Team,
        entityId: PLATFORM_TEAM.id,
        entityTitle: PLATFORM_TEAM.name,
        page: "/dashboard/:projectId/teams/:id",
      },
      onPage: "Team > Overview > Team Details",
      searchWords: "add a member to a team",
      docsPage: "permissions/index",
      alsoAnswers: ["permissions/inviting-people"],
      dashboardPage: "Members",
      dashboardPath: "/dashboard/:projectId/teams/:id/members",
    },
    {
      where: "the Checkout health dashboard",
      question: "How do I share this with people outside my project?",
      pageContext: {
        type: AIChatPageContextType.Dashboard,
        entityId: CHECKOUT_HEALTH.id,
        entityTitle: CHECKOUT_HEALTH.name,
        page: "/dashboard/:projectId/dashboards/:id",
      },
      onPage: "Dashboard > Basic > Dashboard",
      searchWords: "share a dashboard public link",
      docsPage: "dashboards/sharing",
      dashboardPage: "Sharing",
      dashboardPath:
        "/dashboard/:projectId/dashboards/:id/authentication-settings",
    },
    {
      where: "the Restart the API runbook",
      question: "How do I make this run on its own when an incident starts?",
      pageContext: {
        type: AIChatPageContextType.Runbook,
        entityId: RESTART_THE_API.id,
        entityTitle: RESTART_THE_API.name,
        page: "/dashboard/:projectId/runbooks/:id",
      },
      onPage: "Runbook > Basic > Overview",
      searchWords: "runbook triggers run automatically",
      docsPage: "runbooks/triggers",
      alsoAnswers: ["runbooks/rules"],
      dashboardPage: "Triggers",
      dashboardPath: "/dashboard/:projectId/runbooks/:id/triggers",
    },
    {
      where: "the Checkout availability SLO",
      question:
        "How do I get alerted when this burns its error budget too fast?",
      pageContext: {
        type: AIChatPageContextType.Slo,
        entityId: CHECKOUT_AVAILABILITY.id,
        entityTitle: CHECKOUT_AVAILABILITY.name,
        page: "/dashboard/:projectId/slos/:id",
      },
      onPage: "SLO > Overview",
      searchWords: "SLO burn rate alerts",
      docsPage: "slo/burn-rate-alerts",
      dashboardPage: "Burn Rate Rules",
      dashboardPath: "/dashboard/:projectId/slos/:id/burn-rate-rules",
    },
    {
      where: "the Report a problem form",
      question: "How do I add a question to this form?",
      pageContext: {
        type: AIChatPageContextType.Form,
        entityId: REPORT_A_PROBLEM.id,
        entityTitle: REPORT_A_PROBLEM.name,
        page: "/dashboard/:projectId/forms/:id/share",
      },
      onPage: "Form > Form > Share",
      searchWords: "build a form questions",
      docsPage: "forms/building",
      dashboardPage: "Build",
      dashboardPath: "/dashboard/:projectId/forms/:id",
    },

    // On a setup page or a create form (#7062).
    {
      where: "Home",
      question: "Where do I start?",
      pageContext: {
        type: AIChatPageContextType.Home,
        page: "/dashboard/:projectId/home",
      },
      searchWords: "quickstart create a project monitor your website",
      docsPage: "introduction/quickstart",
      alsoAnswers: ["introduction/getting-started"],
    },
    {
      where: "API Keys",
      question: "How do I make a new one here?",
      pageContext: {
        type: AIChatPageContextType.ProjectSettings,
        page: "/dashboard/:projectId/settings/api-keys",
      },
      onPage: "Project Settings > Advanced > API Keys",
      searchWords: "create API key",
      docsPage: "api-reference/api-reference",
      dashboardPage: "API Keys",
      dashboardPath: "/dashboard/:projectId/settings/api-keys",
    },
    {
      where: "Notification Methods",
      question: "How do I add my phone number here?",
      pageContext: {
        type: AIChatPageContextType.UserSettings,
        page: "/dashboard/:projectId/user-settings/notification-methods",
      },
      onPage: "User Settings > Alerts & Notifications > Notification Methods",
      searchWords: "add a phone number notification methods",
      docsPage: "notifications/notification-methods",
      dashboardPage: "Notification Methods",
      dashboardPath: "/dashboard/:projectId/user-settings/notification-methods",
    },
    {
      where: "On-Call Schedules",
      question: "How do I make people take turns each week?",
      pageContext: {
        type: AIChatPageContextType.OnCall,
        page: "/dashboard/:projectId/on-call-duty/schedules",
      },
      onPage: "On-Call > Schedules > On-Call Schedules",
      searchWords: "on-call schedule rotation",
      docsPage: "on-call/schedules",
      dashboardPage: "On-Call Schedules",
      dashboardPath: "/dashboard/:projectId/on-call-duty/schedules",
    },
    {
      where: "Status Pages",
      question: "How do I add one here?",
      pageContext: {
        type: AIChatPageContextType.StatusPagesList,
        page: "/dashboard/:projectId/status-pages",
      },
      onPage: "Status Pages > All Status Pages",
      searchWords: "create a status page",
      docsPage: "status-pages/index",
      alsoAnswers: ["guides/status-page"],
      dashboardPage: "Create Status Page",
      dashboardPath: "/dashboard/:projectId/status-pages?create=1",
    },
    {
      where: "Create Monitor",
      question: "Which type do I pick to check my website?",
      pageContext: {
        type: AIChatPageContextType.CreateForm,
        page: "/dashboard/:projectId/monitors/create",
      },
      onPage: "Monitors > Create Monitor",
      searchWords: "website monitor type",
      docsPage: "monitor/website-monitor",
      alsoAnswers: ["monitor/create-monitor"],
      dashboardPage: "Create Monitor",
      dashboardPath: "/dashboard/:projectId/monitors/create",
    },
  ];
