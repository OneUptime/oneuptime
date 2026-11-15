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
 * to them offline. The same list is what to run against a model (the
 * whole conversation, with a provider) to check the answers themselves:
 * a citation of `docsPage`, and a button for `dashboardPage`.
 */

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
    dashboardPage: "Create Scheduled Maintenance",
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
