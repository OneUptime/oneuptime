/*
 * THE AIR-GAPPED PAGES, PRODUCT BY PRODUCT (/enterprise/air-gapped/<product>),
 * AS DATA.
 *
 * /enterprise/air-gapped (Utils/AirGapped.ts) says how to run OneUptime on a
 * network with no route to the internet. These pages take one product at a
 * time and answer what a buyer asks next: what of it runs inside, what changes
 * behind the gap, what to configure, and what needs a route out whatever you
 * do. Views/air-gapped-topic.ejs draws every one of them, their markdown
 * variants (Utils/AIDiscovery.ts) are written from the same entries, and the
 * hub lists them.
 *
 * Every sentence here is something the repository shows, as on the hub.
 * Tests/AirGappedTopicFacts.test.ts holds each one to the file that makes it
 * true, and fails when an entry has no evidence, so a sentence cannot be added
 * here without saying what backs it. Do not add a capability, a certification,
 * a customer or a number that no file in the repository can back. A row that
 * still needs the internet stays on the page, marked as needing a route: a
 * buyer finds those out anyway, and an install planned around one is worse
 * than a sale lost to it.
 *
 * Text may hold code between backticks, as on the hub (Utils/AirGapped.ts,
 * "Code inside a sentence").
 */

/*
 * Every icon these pages draw, as the d of a Heroicons outline path, named for
 * what it shows. Copied from Common/UI/Components/Icon/Icon.tsx where it has
 * the icon, so the site and the product draw the same ones.
 */
export type AirGappedIconName =
  | "arrowRight"
  | "bell"
  | "book"
  | "bolt"
  | "calendar"
  | "chart"
  | "chat"
  | "check"
  | "chip"
  | "cloud"
  | "code"
  | "cube"
  | "database"
  | "filter"
  | "fire"
  | "flag"
  | "globe"
  | "layers"
  | "link"
  | "list"
  | "lock"
  | "logs"
  | "mail"
  | "megaphone"
  | "offline"
  | "phone"
  | "probe"
  | "search"
  | "server"
  | "serverStack"
  | "settings"
  | "shield"
  | "sparkles"
  | "squares"
  | "team"
  | "terminal"
  | "window"
  | "wrench";

export const AirGappedIcons: Record<AirGappedIconName, string> = {
  arrowRight: "M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3",
  bell: "M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0",
  book: "M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25",
  bolt: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z",
  calendar:
    "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5",
  chart:
    "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  chat: "M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z",
  check: "m4.5 12.75 6 6 9-13.5",
  chip: "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z",
  cloud:
    "M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z",
  code: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5",
  cube: "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
  database:
    "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125",
  filter:
    "M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z",
  fire: "M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z",
  flag: "M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5",
  globe:
    "M6.115 5.19l.319 1.913A6 6 0 008.11 10.36L9.75 12l-.387.775c-.217.433-.132.956.21 1.298l1.348 1.348c.21.21.329.497.329.795v1.089c0 .426.24.815.622 1.006l.153.076c.433.217.956.132 1.298-.21l.723-.723a8.7 8.7 0 002.288-4.042 1.087 1.087 0 00-.358-1.099l-1.33-1.108c-.251-.21-.582-.299-.905-.245l-1.17.195a1.125 1.125 0 01-.98-.314l-.295-.295a1.125 1.125 0 010-1.591l.13-.132a1.125 1.125 0 011.3-.21l.603.302a.809.809 0 001.086-1.086L14.25 7.5l1.256-.837a4.5 4.5 0 001.528-1.732l.146-.292M6.115 5.19A9 9 0 1017.18 4.64M6.115 5.19A8.965 8.965 0 0112 3c1.929 0 3.716.607 5.18 1.64",
  layers:
    "M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3",
  link: "M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244",
  list: "M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z",
  lock: "M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z",
  logs: "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z",
  mail: "M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75",
  megaphone:
    "M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 1 8.835-2.535m0 0A23.74 23.74 0 0 1 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46",
  offline:
    "m3 3 8.735 8.735m0 0a.374.374 0 1 1 .53.53m-.53-.53.53.53m0 0L21 21M14.652 9.348a3.75 3.75 0 0 1 0 5.304m2.121-7.425a6.75 6.75 0 0 1 0 9.546m2.121-11.667c3.808 3.807 3.808 9.98 0 13.788m-9.546-4.242a3.733 3.733 0 0 1-1.06-2.122m-1.061 4.243a6.75 6.75 0 0 1-1.625-6.929m-.496 9.05c-3.068-3.067-3.664-7.67-1.79-11.334M12 12h.008v.008H12V12Z",
  phone:
    "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z",
  probe:
    "M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z",
  search:
    "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z",
  server:
    "M21.75 17.25v-.228a4.5 4.5 0 0 0-.12-1.03l-2.268-9.64a3.375 3.375 0 0 0-3.285-2.602H7.923a3.375 3.375 0 0 0-3.285 2.602l-2.268 9.64a4.5 4.5 0 0 0-.12 1.03v.228m19.5 0a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3m19.5 0a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3m16.5 0h.008v.008h-.008v-.008Zm-3 0h.008v.008h-.008v-.008Z",
  serverStack:
    "M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z",
  settings:
    "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  shield:
    "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
  sparkles:
    "M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z",
  squares:
    "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z",
  team: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  terminal:
    "M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z",
  window:
    "M3 8.25V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V8.25m-18 0V6a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 6v2.25m-18 0h18M5.25 6h.008v.008H5.25V6zM7.5 6h.008v.008H7.5V6zm2.25 0h.008v.008H9.75V6z",
  wrench:
    "M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z M4.867 19.125h.008v.008h-.008v-.008z",
};

export interface AirGappedTopicLink {
  label: string;
  href: string;
}

// A thing in the hero's picture: what it is, and a few words about it.
export interface AirGappedTopicFlowItem {
  label: string;
  detail: string;
  icon: AirGappedIconName;
}

export interface AirGappedTopicFlowLane {
  title: string;
  items: Array<AirGappedTopicFlowItem>;
}

/*
 * The hero's picture, inside one boundary - the customer's network: what feeds
 * the product, what OneUptime does with it, and where the result goes.
 */
export interface AirGappedTopicFlow {
  from: AirGappedTopicFlowLane;
  oneUptime: {
    detail: string;
    items: Array<{ label: string; icon: AirGappedIconName }>;
  };
  to: AirGappedTopicFlowLane;
}

export interface AirGappedTopicCapability {
  key: string;
  title: string;
  description: string;
  icon: AirGappedIconName;
  // Where to read more: every capability says.
  link: AirGappedTopicLink;
}

/*
 * What it takes to keep something working behind the gap: a setting, a service
 * of the customer's own, or a route out. The page draws one pill for each
 * (Views/air-gapped-topic.ejs).
 */
export type AirGappedTopicChangeStatus =
  | "change-a-setting"
  | "use-your-own"
  | "needs-a-route";

export interface AirGappedTopicChange {
  key: string;
  // What it is.
  name: string;
  // What it talks to, or how it works, on a network with a route out.
  usually: string;
  // What to do behind the gap.
  inside: string;
  status: AirGappedTopicChangeStatus;
}

export interface AirGappedTopicConfigureStep {
  key: string;
  title: string;
  description: string;
}

export interface AirGappedTopicConfigure {
  title: string;
  lead: string;
  steps: Array<AirGappedTopicConfigureStep>;
  code: {
    // What the block is: a file name, or what it sets.
    label: string;
    ariaLabel: string;
    // How a markdown reader should colour it.
    language: "bash" | "json" | "yaml";
    text: string;
    // What parts a name from its value on a line, to colour the value.
    separator: ": " | "=";
  };
  caption: string;
  link: AirGappedTopicLink;
}

export interface AirGappedTopicFaq {
  question: string;
  answer: string;
}

export type AirGappedTopicSlug =
  | "observability"
  | "log-management"
  | "monitoring"
  | "incident-management"
  | "on-call"
  | "status-pages"
  | "kubernetes"
  | "network-monitoring"
  | "infrastructure"
  | "ai"
  | "security-events"
  | "workflows";

export interface AirGappedTopicPage {
  slug: AirGappedTopicSlug;
  path: string;
  // The product, as a menu names it: "On-Call".
  name: string;
  // The page, as a card names it: "Air-gapped on-call".
  title: string;
  // One sentence for a card on the hub or a page beside this one.
  summary: string;
  icon: AirGappedIconName;
  seo: { title: string; description: string };
  // The heading, in two parts: the second is drawn muted, on its own line.
  headline: string;
  headlineContinued: string;
  lead: string;
  // The four lines under the hero's buttons.
  proofPoints: Array<string>;
  flow: AirGappedTopicFlow;
  inside: {
    title: string;
    lead: string;
    capabilities: Array<AirGappedTopicCapability>;
  };
  changes: {
    title: string;
    lead: string;
    rows: Array<AirGappedTopicChange>;
  };
  configure: AirGappedTopicConfigure;
  // What this product brings to the four steps, beyond the platform itself.
  installNote: string;
  faqs: Array<AirGappedTopicFaq>;
  // The pages shown beside this one.
  relatedSlugs: Array<AirGappedTopicSlug>;
  // The product page this one leads back to, as the page's last link names it.
  product: AirGappedTopicLink;
  // The product pages that lead here (Views/Partials/enterprise-ready.ejs).
  productPaths: Array<string>;
}

// What a card on the hub, or on a page beside this one, draws.
export interface AirGappedTopicCard {
  slug: AirGappedTopicSlug;
  path: string;
  title: string;
  name: string;
  summary: string;
  iconPath: string;
}

export const AirGappedTopicPages: Array<AirGappedTopicPage> = [
  {
    slug: "observability",
    path: "/enterprise/air-gapped/observability",
    name: "Observability",
    title: "Air-gapped observability",
    summary:
      "Logs, metrics, traces, exceptions and profiles, sent over OpenTelemetry to your own install and kept in your own ClickHouse.",
    icon: "chart",
    seo: {
      title: "Air-Gapped Observability | Logs, Metrics, Traces | OneUptime",
      description:
        "Logs, metrics, traces, exceptions and profiles with no internet. Send OpenTelemetry to your own install, and keep every record in your own ClickHouse.",
    },
    headline: "Logs, metrics and traces",
    headlineContinued: "that never leave your network.",
    lead: "Send OpenTelemetry from your services to your own install, and keep every log, metric, trace, exception and profile in ClickHouse in your cluster.",
    proofPoints: [
      "OpenTelemetry to your own URL",
      "Stored in your own ClickHouse",
      "No object store to run",
      "Recorder served by your install",
    ],
    flow: {
      from: {
        title: "What sends",
        items: [
          {
            label: "Your services",
            detail: "OpenTelemetry SDKs",
            icon: "code",
          },
          {
            label: "Collectors",
            detail: "OpenTelemetry Collector, Fluent Bit, Fluentd",
            icon: "layers",
          },
          {
            label: "Hosts and clusters",
            detail: "OneUptime's agents",
            icon: "server",
          },
          {
            label: "Network devices",
            detail: "Syslog through a probe",
            icon: "probe",
          },
        ],
      },
      oneUptime: {
        detail:
          "Takes every signal in at your own address, and keeps it in your cluster.",
        items: [
          { label: "Telemetry ingest", icon: "bolt" },
          { label: "Pipelines", icon: "filter" },
          { label: "ClickHouse", icon: "database" },
        ],
      },
      to: {
        title: "What your people use",
        items: [
          {
            label: "Explorers",
            detail: "Logs, metrics, traces and exceptions",
            icon: "search",
          },
          {
            label: "Dashboards",
            detail: "Your telemetry beside your own data sources",
            icon: "squares",
          },
          {
            label: "Monitors",
            detail: "Alerts on any signal",
            icon: "bell",
          },
        ],
      },
    },
    inside: {
      title: "Every signal stays in your cluster",
      lead: "Ingest, storage and search all run on your install. Nothing here waits on the internet.",
      capabilities: [
        {
          key: "logs",
          title: "Logs",
          description:
            "Search the logs your services, hosts and agents send, and transform them with pipelines as they arrive, before they are stored.",
          icon: "logs",
          link: {
            label: "Log pipelines",
            href: "/docs/telemetry/log-pipelines",
          },
        },
        {
          key: "metrics",
          title: "Metrics",
          description:
            "Explore metrics, and change them as they arrive, before they are stored.",
          icon: "chart",
          link: {
            label: "Metrics explorer",
            href: "/docs/telemetry/metrics-explorer",
          },
        },
        {
          key: "traces",
          title: "Traces",
          description:
            "Open a trace to see every step of the request as a waterfall, a flame graph or a service map.",
          icon: "layers",
          link: {
            label: "Traces explorer",
            href: "/docs/telemetry/traces-explorer",
          },
        },
        {
          key: "exceptions-and-profiles",
          title: "Exceptions and profiles",
          description:
            "Errors from traces and logs roll into one Exceptions view, and continuous profiling shows how your application spends CPU time and memory, function by function.",
          icon: "fire",
          link: { label: "Exceptions", href: "/docs/telemetry/exceptions" },
        },
        {
          key: "dashboards",
          title: "Dashboards",
          description:
            "Chart your own telemetry beside Prometheus, a SQL database, Loki or Elasticsearch on your network. Each widget runs a read-only query.",
          icon: "squares",
          link: {
            label: "External data sources",
            href: "/docs/dashboards/data-sources",
          },
        },
        {
          key: "rum",
          title: "Real user monitoring",
          description:
            "Point an OpenTelemetry browser or mobile SDK at your install, for your internal apps too. Session replay's recorder is served by your install, and recordings stay in ClickHouse.",
          icon: "window",
          link: {
            label: "Session replay when self-hosted",
            href: "/docs/telemetry/session-replay#self-hosted-notes",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Very little. One protocol choice, and what you bring across yourself.",
      rows: [
        {
          key: "otlp-grpc",
          name: "OTLP over gRPC",
          usually:
            "An ingress that ends TLS itself, with a certificate from Let's Encrypt",
          inside:
            "Send over OTLP/HTTP to `/otlp`. It works behind your own proxy, where gRPC does not.",
          status: "change-a-setting",
        },
        {
          key: "build-time",
          name: "SDKs, collectors and agents",
          usually: "npm, GitHub and Docker Hub, when you build or install them",
          inside:
            "OneUptime does not ship these. Mirror them with your other dependencies, and point them at your install.",
          status: "use-your-own",
        },
        {
          key: "replay-assets",
          name: "Images and fonts in session replay",
          usually: "The addresses your pages loaded them from",
          inside:
            "Playback loads them from their original addresses, in the viewer's browser, so a file on a public CDN does not load. Stylesheets the recorder can read are kept in the recording.",
          status: "needs-a-route",
        },
        {
          key: "cloud-accounts",
          name: "Cloud accounts",
          usually: "Your AWS, Azure and Google Cloud accounts",
          inside:
            "Connecting a cloud account reads your provider's own service, so it needs a route. Nothing else on this page depends on it.",
          status: "needs-a-route",
        },
      ],
    },
    configure: {
      title: "Point OpenTelemetry at your own install",
      lead: "Everything in the OpenTelemetry docs works the same against your own install: use your OneUptime URL wherever they say `https://oneuptime.com`.",
      steps: [
        {
          key: "ingestion-key",
          title: "Create an ingestion key",
          description:
            "Under Project Settings > Telemetry & APM > Ingestion Keys.",
        },
        {
          key: "endpoint",
          title: "Set the endpoint",
          description:
            "Point `OTEL_EXPORTER_OTLP_ENDPOINT` at your install's `/otlp` address, and send the key in the `x-oneuptime-token` header.",
        },
        {
          key: "protocol",
          title: "Send over HTTP",
          description: "Set `OTEL_EXPORTER_OTLP_PROTOCOL` to `http/protobuf`.",
        },
      ],
      code: {
        label: "Your service's environment",
        ariaLabel: "OpenTelemetry settings for your own install",
        language: "bash",
        text: [
          'export OTEL_EXPORTER_OTLP_ENDPOINT="https://YOUR-ONEUPTIME-HOST/otlp"',
          'export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_ONEUPTIME_INGESTION_KEY"',
          'export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"',
        ].join("\n"),
        separator: "=",
      },
      caption:
        "The bundled ingress accepts requests of up to 4 MB on `/otlp`. A proxy you run in front of it may have a lower limit, so raise it for `/otlp` as well.",
      link: {
        label: "OpenTelemetry on a self-hosted install",
        href: "/docs/telemetry/open-telemetry#self-hosted-oneuptime",
      },
    },
    installNote:
      "Observability comes with the install. Your SDKs and collectors are yours to bring across, as they are today.",
    faqs: [
      {
        question: "Does telemetry ever leave the install?",
        answer:
          "No. Your services send to your install, and ClickHouse in your cluster keeps it. No monitoring data, telemetry, logs or configuration leave the install.",
      },
      {
        question: "Can we send OTLP over gRPC?",
        answer:
          "Use OTLP/HTTP. On a self-hosted install, gRPC reaches OneUptime only over HTTPS, and only when its own ingress ends TLS, which orders its certificate from Let's Encrypt. OTLP/HTTP works behind your own proxy, and over plain HTTP.",
      },
      {
        question: "Do we need object storage?",
        answer:
          "No. Telemetry is kept in ClickHouse, and OneUptime does not archive or move old telemetry to object storage. Decide your retention first, and size ClickHouse storage to match.",
      },
      {
        question: "How long is telemetry kept?",
        answer:
          "15 days unless you change it. The project's default retention is in every edition. Keeping some telemetry longer or shorter than the rest needs an Enterprise license.",
      },
    ],
    relatedSlugs: ["log-management", "kubernetes", "ai"],
    product: {
      label: "See the Observability product",
      href: "/product/observability",
    },
    productPaths: [
      "/product/observability",
      "/product/metrics",
      "/product/traces",
      "/product/exceptions",
      "/product/profiles",
      "/product/dashboards",
      "/product/rum",
    ],
  },
  {
    slug: "log-management",
    path: "/enterprise/air-gapped/log-management",
    name: "Log Management",
    title: "Air-gapped log management",
    summary:
      "Fluent Bit, Fluentd, syslog and OpenTelemetry into your own install, shaped and scrubbed before anything is stored.",
    icon: "logs",
    seo: {
      title: "Air-Gapped Log Management | Syslog, Fluent Bit | OneUptime",
      description:
        "Centralize logs with no internet. Fluent Bit, Fluentd, syslog and OpenTelemetry send to your own install, and secrets are scrubbed before anything is stored.",
    },
    headline: "Every log line",
    headlineContinued: "stays behind your air gap.",
    lead: "Collect logs with the shippers you already run, shape and scrub them as they arrive, and search them in your own cluster.",
    proofPoints: [
      "Fluent Bit, Fluentd and syslog",
      "Pipelines before storage",
      "Secrets masked as logs arrive",
      "Kept in your own ClickHouse",
    ],
    flow: {
      from: {
        title: "What sends logs",
        items: [
          { label: "Fluent Bit", detail: "Over OTLP/HTTP", icon: "logs" },
          { label: "Fluentd", detail: "To its own endpoint", icon: "logs" },
          {
            label: "Syslog",
            detail: "To a probe, or over HTTPS",
            icon: "probe",
          },
          {
            label: "OpenTelemetry",
            detail: "From your services",
            icon: "code",
          },
        ],
      },
      oneUptime: {
        detail:
          "Filters, scrubs and shapes each log as it arrives, before it is stored.",
        items: [
          { label: "Drop filters", icon: "filter" },
          { label: "Scrub rules", icon: "shield" },
          { label: "Log pipelines", icon: "layers" },
        ],
      },
      to: {
        title: "What your people do",
        items: [
          {
            label: "Search",
            detail: "One query language, in your cluster",
            icon: "search",
          },
          {
            label: "Alert",
            detail: "On a count of matching logs",
            icon: "bell",
          },
          {
            label: "Detect",
            detail: "Security events from your logs",
            icon: "shield",
          },
        ],
      },
    },
    inside: {
      title: "From the first line to the alert",
      lead: "Everything between a log leaving a device and someone being told about it runs on your install.",
      capabilities: [
        {
          key: "shippers",
          title: "The shippers you run",
          description:
            "Fluent Bit sends over OTLP/HTTP, Fluentd posts to `/fluentd/logs`, and your services send OpenTelemetry, each with your own ingestion key.",
          icon: "layers",
          link: {
            label: "Fluent Bit on a self-hosted install",
            href: "/docs/telemetry/fluentbit#self-hosted-oneuptime",
          },
        },
        {
          key: "syslog",
          title: "Syslog from anything",
          description:
            "OneUptime accepts RFC 5424 and RFC 3164 messages over HTTPS, and every probe listens for syslog on port 5140, over UDP and over TCP.",
          icon: "probe",
          link: { label: "Syslog", href: "/docs/telemetry/syslog" },
        },
        {
          key: "pipelines",
          title: "Log pipelines",
          description:
            "Transform logs as they arrive, before they are stored, with parsers for formats such as `key=value` pairs.",
          icon: "filter",
          link: {
            label: "Log pipelines",
            href: "/docs/telemetry/log-pipelines",
          },
        },
        {
          key: "scrub",
          title: "Drop filters and scrub rules",
          description:
            "Throw away the records you never need, and mask personal data and secrets, as logs arrive and before anything is stored.",
          icon: "shield",
          link: {
            label: "Drop filters and scrub rules",
            href: "/docs/telemetry/drop-filters-and-scrub-rules",
          },
        },
        {
          key: "search",
          title: "Search and follow",
          description:
            "Narrow millions of lines down to the few that matter, follow new ones as they arrive, and save the views your team comes back to.",
          icon: "search",
          link: {
            label: "Logs explorer",
            href: "/docs/telemetry/logs-explorer",
          },
        },
        {
          key: "alerts",
          title: "Alerts and metrics from logs",
          description:
            "A Logs monitor counts matching logs and can create an alert or declare an incident. A recording rule turns logs into a metric.",
          icon: "bell",
          link: { label: "Logs monitor", href: "/docs/monitor/logs-monitor" },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Mostly where syslog goes. Devices that only speak UDP or TCP need somewhere on their own network to send to.",
      rows: [
        {
          key: "syslog-senders",
          name: "Syslog from devices you do not poll",
          usually:
            "The chart's global probe, which drops what it cannot match to a device",
          inside:
            "Run your own probe on the device network. It keeps those messages until you say which device they belong to.",
          status: "use-your-own",
        },
        {
          key: "syslog-tls",
          name: "Syslog over TLS",
          usually: "The probe takes plain UDP and TCP",
          inside:
            "Keep the path between devices and the probe on a network you trust, or point devices at an rsyslog relay that forwards over HTTPS.",
          status: "use-your-own",
        },
        {
          key: "shipper-images",
          name: "Fluent Bit and Fluentd",
          usually: "Their own images and packages",
          inside:
            "OneUptime does not ship these. Mirror them with your other dependencies, and set their output to your install.",
          status: "use-your-own",
        },
      ],
    },
    configure: {
      title: "Send Fluent Bit to your own install",
      lead: "Fluent Bit's OpenTelemetry output takes your host and your ingestion key, and nothing else about it changes.",
      steps: [
        {
          key: "ingestion-key",
          title: "Create an ingestion key",
          description:
            "Under Project Settings > Telemetry & APM > Ingestion Keys.",
        },
        {
          key: "host",
          title: "Set the host",
          description: "Set `host` to the host of your OneUptime install.",
        },
        {
          key: "header",
          title: "Send the key",
          description: "Send it in the `x-oneuptime-token` header.",
        },
      ],
      code: {
        label: "fluent-bit.yaml",
        ariaLabel: "Fluent Bit output for your own install",
        language: "yaml",
        text: [
          "pipeline:",
          "  outputs:",
          "    - name: opentelemetry",
          '      match: "*"',
          '      host: "your-oneuptime-instance.com"',
          "      port: 80",
          '      metrics_uri: "/otlp/v1/metrics"',
          '      logs_uri: "/otlp/v1/logs"',
          '      traces_uri: "/otlp/v1/traces"',
          "      header:",
          "        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN",
        ].join("\n"),
        separator: ": ",
      },
      caption:
        "This is for an install served over plain HTTP. Served over HTTPS, it keeps `tls` on instead of setting `port`.",
      link: {
        label: "Fluent Bit on a self-hosted install",
        href: "/docs/telemetry/fluentbit#self-hosted-oneuptime",
      },
    },
    installNote:
      "Log management comes with the install. Your shippers are yours to bring across, as they are today.",
    faqs: [
      {
        question: "Can network devices send syslog without HTTPS?",
        answer:
          "Yes, to a probe: every probe listens on port 5140, over UDP and over TCP. Run your own probe on the device network, because a global probe drops messages from senders it does not poll. The path to the probe is not encrypted, so keep it on a network you trust.",
      },
      {
        question: "Can we mask secrets before they are stored?",
        answer:
          "Yes. A scrub rule masks personal data and secrets, such as email addresses, card numbers and passwords, as logs arrive and before anything is stored.",
      },
      {
        question: "How long can we keep logs?",
        answer:
          "15 days unless you change it, and the project's default retention is in every edition. OneUptime does not archive or move old telemetry to object storage, so for multi-year retention, extend the window and size ClickHouse storage to match.",
      },
    ],
    relatedSlugs: ["observability", "security-events", "network-monitoring"],
    product: {
      label: "See the Logs product",
      href: "/product/logs-management",
    },
    productPaths: ["/product/logs-management"],
  },
  {
    slug: "monitoring",
    path: "/enterprise/air-gapped/monitoring",
    name: "Monitoring",
    title: "Air-gapped monitoring",
    summary:
      "Probes inside your network check websites, APIs, ports, certificates, databases and browser journeys nothing outside can reach.",
    icon: "probe",
    seo: {
      title: "Air-Gapped Uptime & Synthetic Monitoring | OneUptime",
      description:
        "Run probes inside your network to check websites, APIs, ports, certificates, SQL databases and browser journeys, with no internet and no browser to download.",
    },
    headline: "Monitor what only",
    headlineContinued: "your network can see.",
    lead: "Probes run in your cluster and anywhere else on your network, and check what nothing outside can reach. A probe connects out to your own install, and nothing has to reach it from outside.",
    proofPoints: [
      "Probes anywhere on your network",
      "Chromium and Firefox in the probe image",
      "Private certificate authorities trusted",
      "Monitoring in every edition",
    ],
    flow: {
      from: {
        title: "What probes check",
        items: [
          {
            label: "Websites and APIs",
            detail: "On your own network",
            icon: "globe",
          },
          {
            label: "Ping, ports and DNS",
            detail: "Hosts, services and resolvers",
            icon: "probe",
          },
          {
            label: "SQL databases",
            detail: "From a probe that can reach them",
            icon: "database",
          },
          {
            label: "Browser journeys",
            detail: "Chromium and Firefox",
            icon: "window",
          },
        ],
      },
      oneUptime: {
        detail:
          "Runs each check from a probe on your network, and decides each monitor's status.",
        items: [
          { label: "Probes", icon: "probe" },
          { label: "Monitors", icon: "chart" },
          { label: "Criteria", icon: "filter" },
        ],
      },
      to: {
        title: "What it drives",
        items: [
          {
            label: "Incidents",
            detail: "Declared when criteria match",
            icon: "fire",
          },
          {
            label: "Alerts",
            detail: "Sent to the right people",
            icon: "bell",
          },
          {
            label: "Status pages",
            detail: "On your own network",
            icon: "megaphone",
          },
        ],
      },
    },
    inside: {
      title: "Every check runs from inside your network",
      lead: "A probe runs each check where it sits, so a monitor can watch anything that probe can reach.",
      capabilities: [
        {
          key: "web-and-api",
          title: "Websites and APIs",
          description:
            "Website and API monitors check internal sites and services, once the probe may reach private addresses.",
          icon: "globe",
          link: {
            label: "Website monitor",
            href: "/docs/monitor/website-monitor",
          },
        },
        {
          key: "network-checks",
          title: "Ping, ports, DNS and time",
          description:
            "Ping hosts, check ports, query internal DNS servers and check time servers on your own network.",
          icon: "probe",
          link: { label: "Port monitor", href: "/docs/monitor/port-monitor" },
        },
        {
          key: "certificates",
          title: "SSL certificates",
          description:
            "SSL monitors read the certificate a service on your network presents, from a probe that can reach it.",
          icon: "lock",
          link: {
            label: "SSL certificate monitor",
            href: "/docs/monitor/ssl-certificate-monitor",
          },
        },
        {
          key: "databases",
          title: "SQL and database health",
          description:
            "Run checks from inside your network. The database only has to be reachable from the probe.",
          icon: "database",
          link: { label: "SQL monitor", href: "/docs/monitor/sql-monitor" },
        },
        {
          key: "synthetic",
          title: "Synthetic browser tests",
          description:
            "The browsers ship inside the probe's Docker image, so a test downloads nothing when it runs.",
          icon: "window",
          link: {
            label: "Synthetic monitor",
            href: "/docs/monitor/synthetic-monitor",
          },
        },
        {
          key: "heartbeats",
          title: "Heartbeats from isolated segments",
          description:
            "Incoming Request monitors take heartbeats from your jobs and services. A probe can listen for them, for segments with no outbound HTTPS access.",
          icon: "bolt",
          link: {
            label: "Incoming request ingress",
            href: "/docs/probe/incoming-request-ingress",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Two settings to change, three swaps, and one monitor that needs the public internet whatever you do.",
      rows: [
        {
          key: "private-addresses",
          name: "Website and API monitors",
          usually: "A stock probe refuses private addresses",
          inside:
            "Set `probes.one.allowPrivateNetworkMonitors: true`, or `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` on a probe you run.",
          status: "change-a-setting",
        },
        {
          key: "private-ca",
          name: "Certificates from your own CA",
          usually: "Public certificate authorities",
          inside:
            "Mount your CA bundle and point `NODE_EXTRA_CA_CERTS` at it. Chromium reads the OS trust store instead, so synthetic tests of internally signed sites need the certificate baked into the image.",
          status: "change-a-setting",
        },
        {
          key: "dnssec",
          name: "DNSSEC checks",
          usually: "`1.1.1.1`, `8.8.8.8` and `9.9.9.9`",
          inside:
            "List your own validating resolvers on a DNSSEC monitor, and in `DNS Server` on a DNS monitor.",
          status: "use-your-own",
        },
        {
          key: "external-status-page",
          name: "External Status Page monitors",
          usually: "The public status page of a service you depend on",
          inside:
            "Point them at status pages on your own network, with the same private-address setting.",
          status: "use-your-own",
        },
        {
          key: "incoming-email",
          name: "Incoming Email monitors",
          usually: "SendGrid, which has to connect to your install",
          inside:
            "Receive heartbeats and webhooks over HTTP with an Incoming Request monitor instead.",
          status: "use-your-own",
        },
        {
          key: "domain",
          name: "Domain monitors",
          usually: "IANA's RDAP registry, RDAP and WHOIS servers",
          inside:
            "They read the public registries, and there is no internal equivalent. They need a route, or stay off.",
          status: "needs-a-route",
        },
      ],
    },
    configure: {
      title: "Put a probe on every network you want to see",
      lead: "The chart runs a probe in your cluster. Add one wherever a network stands apart, from the image you mirrored.",
      steps: [
        {
          key: "add-probe",
          title: "Add a probe",
          description:
            "In OneUptime, add a custom probe and copy its ID and key from Show ID and Key.",
        },
        {
          key: "run-probe",
          title: "Run it from your registry",
          description:
            "Start the probe from your own registry, with `ONEUPTIME_URL` set to your install.",
        },
        {
          key: "private-addresses",
          title: "Let it reach private addresses",
          description:
            "Set `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`, so its website and API monitors can check your own network.",
        },
      ],
      code: {
        label: "docker run",
        ariaLabel: "Run a probe from your own registry",
        language: "bash",
        text: [
          "docker run --name oneuptime-probe --network host \\",
          "  -e PROBE_KEY=<probe-key> \\",
          "  -e PROBE_ID=<probe-id> \\",
          "  -e ONEUPTIME_URL=https://oneuptime.example.com \\",
          "  -e PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true \\",
          "  -d registry.example.com/oneuptime/probe:release",
        ].join("\n"),
        separator: "=",
      },
      caption:
        "A probe connects out to `ONEUPTIME_URL`, and nothing has to reach it from outside your network.",
      link: { label: "Custom probes", href: "/docs/probe/custom-probe" },
    },
    installNote:
      "Monitoring comes with the install, and the chart runs a probe in your cluster. A probe anywhere else runs the image you mirrored.",
    faqs: [
      {
        question: "Do probes need the internet?",
        answer:
          "No. A self-hosted probe does not need public internet connectivity. It connects out to your own install and runs every check from where it sits, and nothing has to reach it from outside your network.",
      },
      {
        question: "Do synthetic tests download a browser when they run?",
        answer:
          "No. Chromium and Firefox ship inside the probe's Docker image, so bringing that image across brings them too.",
      },
      {
        question: "Can a probe check a site signed by our own CA?",
        answer:
          "Yes. Pointing `NODE_EXTRA_CA_CERTS` at a mounted bundle covers every outbound TLS call OneUptime's own code makes, the probes' included. Chromium reads the OS trust store instead, so synthetic tests of those sites need the certificate baked into the image.",
      },
      {
        question: "Which monitors do not work with no internet?",
        answer:
          "Domain monitors read the public registries, so they need a route. Incoming Email monitors need SendGrid to reach your install, so use an Incoming Request monitor. External Status Page monitors and DNSSEC checks work once you point them at what runs on your network.",
      },
    ],
    relatedSlugs: [
      "network-monitoring",
      "infrastructure",
      "incident-management",
    ],
    product: {
      label: "See the Monitoring product",
      href: "/product/monitoring",
    },
    productPaths: ["/product/monitoring"],
  },
  {
    slug: "incident-management",
    path: "/enterprise/air-gapped/incident-management",
    name: "Incident Management",
    title: "Air-gapped incident management",
    summary:
      "Declare, page, work and write up incidents on a closed network, with chat on a server you run and AI on a model you run.",
    icon: "fire",
    seo: {
      title: "Air-Gapped Incident Management | No Internet | OneUptime",
      description:
        "Declare, page, work and write up incidents with no internet. Incidents, postmortems, runbooks and AI drafts all run inside your own network.",
    },
    headline: "Run every incident",
    headlineContinued: "from inside your network.",
    lead: "Declare incidents by hand or from a monitor, page the people on call, keep the record and write the postmortem, with nothing leaving your network.",
    proofPoints: [
      "Declared by monitors or people",
      "Postmortems on the incident itself",
      "Runbooks on a Runner you host",
      "AI drafts on a model you run",
    ],
    flow: {
      from: {
        title: "What declares it",
        items: [
          {
            label: "Monitors",
            detail: "The moment criteria match",
            icon: "chart",
          },
          {
            label: "People",
            detail: "By hand, or from a template",
            icon: "team",
          },
          {
            label: "Your tools",
            detail: "Through the API",
            icon: "code",
          },
          {
            label: "Forms",
            detail: "Reported by anyone you share one with",
            icon: "list",
          },
        ],
      },
      oneUptime: {
        detail:
          "Keeps one record of the incident, and pages the people who need to know.",
        items: [
          { label: "Incident record", icon: "list" },
          { label: "On-call paging", icon: "phone" },
          { label: "Postmortems", icon: "book" },
        ],
      },
      to: {
        title: "Who hears about it",
        items: [
          {
            label: "Responders",
            detail: "By the methods they chose",
            icon: "phone",
          },
          {
            label: "Status page readers",
            detail: "On your own status page",
            icon: "megaphone",
          },
          {
            label: "Your channels",
            detail: "Mattermost or IRC on your network",
            icon: "chat",
          },
        ],
      },
    },
    inside: {
      title: "The whole incident runs on your install",
      lead: "From the moment it is declared to the postmortem, every step happens inside your network.",
      capabilities: [
        {
          key: "declare",
          title: "Declared by a monitor or a person",
          description:
            "Declare an incident by hand at 3am, or let a monitor declare it the moment its criteria match. Its on-call policies page people from there.",
          icon: "fire",
          link: {
            label: "Declaring an incident",
            href: "/docs/incidents/declaring-incidents",
          },
        },
        {
          key: "record",
          title: "One written record",
          description:
            "Updates for your readers, working notes for your team, and an activity feed of everything that happened.",
          icon: "list",
          link: {
            label: "Notes, owners and feed",
            href: "/docs/incidents/notes-owners-and-feed",
          },
        },
        {
          key: "episodes",
          title: "Episodes",
          description:
            "An episode groups related incidents, so your team works on them as one, with one set of owners and one state.",
          icon: "layers",
          link: { label: "Episodes", href: "/docs/incidents/episodes" },
        },
        {
          key: "postmortems",
          title: "Postmortems on the incident",
          description:
            "Write the postmortem on the incident itself, from your own template, and publish it on your status page.",
          icon: "book",
          link: { label: "Postmortems", href: "/docs/incidents/postmortems" },
        },
        {
          key: "runbooks",
          title: "Runbooks on your own Runner",
          description:
            "Run your response procedure on a Runner you host. It only needs outbound HTTPS to your install, and accepts no inbound connections.",
          icon: "terminal",
          link: { label: "Runners", href: "/docs/runbooks/agents" },
        },
        {
          key: "ai-drafts",
          title: "AI drafts on a model you run",
          description:
            "OneUptime AI can draft a postmortem with Ollama or another model on your own machines, so the draft stays on your network.",
          icon: "sparkles",
          link: {
            label: "Ollama",
            href: "/docs/ai/llm-provider#ollama-self-hosted",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "The record, the paging and the postmortem stay as they are. What changes is the chat and the video around them.",
      rows: [
        {
          key: "chat",
          name: "Slack and Microsoft Teams channels",
          usually: "Their cloud services, which have to reach your install",
          inside:
            "Post to Mattermost or IRC on your network through a workflow. These post messages: OneUptime does not create a channel per incident there.",
          status: "use-your-own",
        },
        {
          key: "video",
          name: "Video calls",
          usually: "Zoom, Google Meet, Microsoft Teams and Slack huddles",
          inside:
            "Save a standing `https` meeting link, such as a Jitsi room, and start the call from the incident by hand. Every incident shares that room.",
          status: "use-your-own",
        },
        {
          key: "jira",
          name: "Jira",
          usually: "Jira Cloud, through workflow templates",
          inside:
            "Self-managed Jira works the same way with a handful of substitutions, once workflows may reach private addresses.",
          status: "use-your-own",
        },
        {
          key: "cloud-tools",
          name: "PagerDuty, Opsgenie and ServiceNow",
          usually: "Their cloud services",
          inside:
            "These need a route to their service. OneUptime's own on-call does the paging inside your network.",
          status: "needs-a-route",
        },
      ],
    },
    configure: {
      title: "Reach your team on a chat server you run",
      lead: "Workflows post to Mattermost and IRC on your network. Once they may reach private addresses, one workflow carries every new incident to your channel.",
      steps: [
        {
          key: "allow-private",
          title: "Allow private addresses",
          description:
            "Set `webhooks.allowPrivateNetwork: true`, or name your server in `webhooks.privateNetworkAllowlist`.",
        },
        {
          key: "trigger",
          title: "Start a workflow from an incident",
          description:
            "Pick a OneUptime event trigger, so the workflow runs when an incident is created.",
        },
        {
          key: "post",
          title: "Post to your channel",
          description:
            "Add the Mattermost block with your incoming webhook, or the IRC block with your server and channel.",
        },
      ],
      code: {
        label: "values.yaml",
        ariaLabel: "Let workflows reach a chat server on your network",
        language: "yaml",
        text: [
          "webhooks:",
          "  allowPrivateNetwork: true",
          '  privateNetworkAllowlist: "mattermost.internal,10.20.0.0/16"',
        ].join("\n"),
        separator: ": ",
      },
      caption:
        "Set one or both: the first allows every private address, and the second only the hosts and ranges it names.",
      link: {
        label: "Webhooks and workflows",
        href: "/docs/self-hosted/private-network-access#webhooks-and-workflows",
      },
    },
    installNote:
      "Incident management comes with the install: there is no separate edition, image or chart to bring in for it.",
    faqs: [
      {
        question: "Does incident management need the internet?",
        answer:
          "No. Declaring, paging, notes, postmortems and runbooks all run on your install. Only what you connect reaches out: Slack, Microsoft Teams, video calls and other cloud services.",
      },
      {
        question: "Can we keep using Slack or Microsoft Teams?",
        answer:
          "Not on a closed network: both need a public HTTPS hostname for your install. Post to Mattermost or IRC on your network through a workflow instead.",
      },
      {
        question: "Does it work with Jira Data Center?",
        answer:
          "Yes. Self-managed Jira works the same way with a handful of substitutions, which the docs list. Workflow templates are written for Jira Cloud, so make those substitutions in each API block.",
      },
      {
        question: "How do we run a call for an incident?",
        answer:
          "Save a standing meeting link, an `https` address such as a Jitsi room, as a connection. Start the call from the incident's Video Call card. Every incident started with that connection shares the room, and automatic calls need a Slack or Microsoft Teams rule.",
      },
    ],
    relatedSlugs: ["on-call", "status-pages", "ai"],
    product: {
      label: "See the Incident Management product",
      href: "/product/incident-management",
    },
    productPaths: ["/product/incident-management"],
  },
  {
    slug: "on-call",
    path: "/enterprise/air-gapped/on-call",
    name: "On-Call",
    title: "Air-gapped on-call",
    summary:
      "Schedules and escalation on your install, with pages through your own mail server, webhooks, and a gateway you run for SMS and calls.",
    icon: "phone",
    seo: {
      title: "Air-Gapped On-Call | Paging With No Internet | OneUptime",
      description:
        "On-call schedules and escalation with no internet. Page people through your own mail server, your webhooks, and a gateway you run for SMS and calls.",
    },
    headline: "Page the right person",
    headlineContinued: "with no route to the internet.",
    lead: "Schedules, escalation policies and overrides run inside your network. Pages go out through your own mail server, your own webhooks, and a gateway you run for SMS and calls.",
    proofPoints: [
      "Schedules and escalation on your install",
      "SMS and calls through your own gateway",
      "The gateway is in every edition",
      "Acknowledge from a link, a call or a reply",
    ],
    flow: {
      from: {
        title: "What pages",
        items: [
          {
            label: "Incidents",
            detail: "Declared by a monitor or a person",
            icon: "fire",
          },
          {
            label: "Alerts",
            detail: "From your monitors",
            icon: "bell",
          },
          {
            label: "Episodes",
            detail: "Related incidents or alerts, as one",
            icon: "layers",
          },
        ],
      },
      oneUptime: {
        detail:
          "Works out who is on call, and pages level by level until somebody acknowledges.",
        items: [
          { label: "On-call schedules", icon: "calendar" },
          { label: "Escalation rules", icon: "list" },
          { label: "Personal rules", icon: "settings" },
        ],
      },
      to: {
        title: "How people are reached",
        items: [
          {
            label: "Your mail server",
            detail: "Email",
            icon: "mail",
          },
          {
            label: "Your gateway",
            detail: "SMS and calls",
            icon: "phone",
          },
          {
            label: "Your webhooks",
            detail: "Your own tools",
            icon: "link",
          },
          {
            label: "Your own app",
            detail: "Custom channels, Enterprise Edition",
            icon: "chat",
          },
        ],
      },
    },
    inside: {
      title: "Who gets paged is worked out on your install",
      lead: "Who is on call, who covers for whom and how long to wait for an acknowledgement all run inside your network.",
      capabilities: [
        {
          key: "schedules",
          title: "On-call schedules",
          description:
            "A schedule decides who is on call at any moment, and a user override covers for someone who is away.",
          icon: "calendar",
          link: { label: "On-call schedules", href: "/docs/on-call/schedules" },
        },
        {
          key: "escalation",
          title: "Escalation policies",
          description:
            "A policy pages level by level until somebody acknowledges, and records each run, rule by rule.",
          icon: "list",
          link: { label: "On-call policies", href: "/docs/on-call/policies" },
        },
        {
          key: "personal-rules",
          title: "How to Reach Me",
          description:
            "Each person chooses which of their methods is tried, and after how long.",
          icon: "settings",
          link: {
            label: "How to Reach Me",
            href: "/docs/notifications/on-call-rules",
          },
        },
        {
          key: "readiness",
          title: "Readiness",
          description:
            "Lists everyone your policies can page as Ready, Needs setup or Unreachable, with what is missing, before an incident asks.",
          icon: "check",
          link: { label: "Readiness", href: "/docs/on-call/readiness" },
        },
        {
          key: "email",
          title: "Email through your mail server",
          description:
            "Set Email Server Type to Custom SMTP in the Admin Dashboard, and every page and notification goes through your own server.",
          icon: "mail",
          link: {
            label: "SMTP",
            href: "/docs/emails/smtp#adding-an-smtp-server",
          },
        },
        {
          key: "custom-channels",
          title: "Your own app or pager",
          description:
            "With the Enterprise Edition, a custom channel sends every page to a service you run, which can acknowledge, escalate or resolve it.",
          icon: "chat",
          link: {
            label: "Custom channels",
            href: "/docs/self-hosted/custom-notification-channels",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Email and webhooks keep working. SMS and calls move to a gateway you run. Push, WhatsApp, Telegram and incoming calls need a route to their service.",
      rows: [
        {
          key: "sms-and-calls",
          name: "SMS and phone calls",
          usually: "Twilio",
          inside:
            "Send them through a gateway you run. OneUptime posts each one as a signed JSON request, and the Gateway URL can be on your private network.",
          status: "use-your-own",
        },
        {
          key: "acknowledge",
          name: "Pressing 1 on a call",
          usually: "Twilio, reporting the key press back",
          inside:
            "Your gateway offers the actions its own way, such as key presses or a reply, and calls the link OneUptime sent with the page.",
          status: "use-your-own",
        },
        {
          key: "webhooks",
          name: "Webhooks to your own tools",
          usually: "Private addresses refused",
          inside:
            "Set `webhooks.allowPrivateNetwork: true`, so on-call user webhooks reach your network.",
          status: "change-a-setting",
        },
        {
          key: "calendars",
          name: "Calendar feeds",
          usually:
            "Google Calendar and Outlook on the web fetch from their own servers",
          inside:
            "Subscribe from a device instead: Apple Calendar, Thunderbird and classic Outlook fetch from the device.",
          status: "use-your-own",
        },
        {
          key: "push",
          name: "Mobile and browser push",
          usually:
            "OneUptime's push relay or Expo, then Apple and Google, and browsers' push services",
          inside:
            "There is no internal equivalent. Page by SMS through your gateway, email or webhook, and turn push off for the whole server.",
          status: "needs-a-route",
        },
        {
          key: "whatsapp-telegram",
          name: "WhatsApp and Telegram",
          usually: "Meta and `api.telegram.org`",
          inside:
            "These need a route to their service. Page by another method.",
          status: "needs-a-route",
        },
        {
          key: "incoming-calls",
          name: "Incoming call policies",
          usually: "A phone number on your own Twilio account",
          inside:
            "These run on Twilio alone, and Twilio has to reach your install. They need a route, or stay off.",
          status: "needs-a-route",
        },
      ],
    },
    configure: {
      title: "Send SMS and calls through your own gateway",
      lead: "There is no chart value to set. It takes a few minutes in the Admin Dashboard, and it is in every edition.",
      steps: [
        {
          key: "choose",
          title: "Choose your gateway",
          description:
            "In the Admin Dashboard, go to Settings > Call and SMS, click Edit Provider, and choose Your own gateway.",
        },
        {
          key: "url",
          title: "Enter its address",
          description:
            "Enter the Gateway URL, which can be on your private network. OneUptime makes a signing secret for you to copy into your gateway.",
        },
        {
          key: "test",
          title: "Send a test",
          description:
            "Click Send Test. Your gateway should answer with a 2xx status and send nothing.",
        },
      ],
      code: {
        label: "What your gateway receives",
        ariaLabel: "An on-call page by SMS, as your gateway receives it",
        language: "json",
        text: [
          "{",
          '  "version": 1,',
          '  "event": "sms",',
          '  "to": "+15551234567",',
          '  "message": "OneUptime: A new alert has been created. Alert #42: Database is down…",',
          '  "isSensitive": false,',
          '  "actions": {',
          '    "acknowledge": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…",',
          '    "escalate": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/escalate?token=…",',
          '    "resolve": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/resolve?token=…"',
          "  }",
          "}",
        ].join("\n"),
        separator: ": ",
      },
      caption:
        "Each request carries an HMAC-SHA256 signature of its body. A 2xx answer within 10 seconds counts as delivered, and OneUptime does not learn whether the message reached the phone.",
      link: {
        label: "SMS and call gateway",
        href: "/docs/self-hosted/sms-and-call-gateway",
      },
    },
    installNote:
      "On-call comes with the install: there is no separate edition, image or chart to bring in for it.",
    faqs: [
      {
        question: "Can we send SMS and calls with no Twilio account?",
        answer:
          "Yes. Choose Your own gateway in the Admin Dashboard, and OneUptime posts each SMS and call to it as a signed JSON request. It takes the place of the server's own Twilio account for on-call pages, notifications, verification codes and status page subscriber SMS.",
      },
      {
        question: "Does the gateway need the Enterprise Edition?",
        answer:
          "No. The gateway is in the Community Edition. Custom channels, which page people through your own app, are part of the Enterprise Edition and need an Enterprise license that includes them.",
      },
      {
        question: "Does the OneUptime On-Call app work behind an air gap?",
        answer:
          "A phone on your VPN can open your install in the app, but pages cannot reach it: a phone needs Apple's or Google's push service. Page those people by SMS through your gateway, or by email.",
      },
      {
        question: "How does someone acknowledge a page?",
        answer:
          "From the link in an email or SMS, on a device that can reach your install. Through your gateway, when the person answers a call or a reply, the gateway calls the matching link OneUptime sent with the page.",
      },
      {
        question: "What happens if our gateway is down?",
        answer:
          "OneUptime sends a request again after 1 second and after 4 seconds more: three attempts in all. The person's on-call log says why it was not delivered. If nobody acknowledges before the rule's wait runs out, the next rule pages.",
      },
    ],
    relatedSlugs: ["incident-management", "status-pages", "monitoring"],
    product: {
      label: "See the On-Call product",
      href: "/product/on-call",
    },
    productPaths: ["/product/on-call"],
  },
  {
    slug: "status-pages",
    path: "/enterprise/air-gapped/status-pages",
    name: "Status Pages",
    title: "Air-gapped status pages",
    summary:
      "Status pages for a network nobody outside can reach, behind your own sign-in, on your own domain and certificate.",
    icon: "megaphone",
    seo: {
      title: "Air-Gapped Status Pages | Private Status Pages | OneUptime",
      description:
        "Status pages with no internet. Sign people in with your own identity provider, upload your own certificates, and tell subscribers through your own mail server.",
    },
    headline: "One place to see what is running,",
    headlineContinued: "on a network nobody outside can reach.",
    lead: "Serve status pages from your own install, on your own domain and behind your own sign-in, and tell subscribers through your own mail server.",
    proofPoints: [
      "Served from your own install",
      "SAML and OpenID Connect in every edition",
      "Certificates you upload",
      "Subscribers by email and SMS",
    ],
    flow: {
      from: {
        title: "What it shows",
        items: [
          {
            label: "Monitors",
            detail: "The resources you choose",
            icon: "chart",
          },
          {
            label: "Incidents",
            detail: "With the notes you publish",
            icon: "fire",
          },
          {
            label: "Scheduled maintenance",
            detail: "Before it starts",
            icon: "calendar",
          },
          {
            label: "Announcements",
            detail: "Whatever people need to know",
            icon: "megaphone",
          },
        ],
      },
      oneUptime: {
        detail:
          "Serves each status page from your install, on your own domain.",
        items: [
          { label: "Status pages", icon: "window" },
          { label: "Sign-in", icon: "lock" },
          { label: "Subscribers", icon: "team" },
        ],
      },
      to: {
        title: "Who it reaches",
        items: [
          {
            label: "Readers",
            detail: "On your network, in a browser",
            icon: "team",
          },
          {
            label: "Email subscribers",
            detail: "Through your mail server",
            icon: "mail",
          },
          {
            label: "SMS subscribers",
            detail: "Through your gateway",
            icon: "phone",
          },
        ],
      },
    },
    inside: {
      title: "Your page, your sign-in, your certificate",
      lead: "A status page is served by your install, so a reader only needs a route to you.",
      capabilities: [
        {
          key: "access",
          title: "Open, password or sign-in",
          description:
            "Open a page to anyone with the link, keep it to people who sign in, or unlock it with one password you share.",
          icon: "lock",
          link: {
            label: "Who can see a page",
            href: "/docs/status-pages/index#restricting-who-can-see-the-page",
          },
        },
        {
          key: "sso",
          title: "Your identity provider",
          description:
            "A private page takes SAML and OpenID Connect sign-in, in every edition, and can require it for everyone.",
          icon: "team",
          link: {
            label: "SSO and OIDC",
            href: "/docs/status-pages/index#sso-and-oidc",
          },
        },
        {
          key: "domain",
          title: "Your domain, your certificate",
          description:
            "Upload a certificate for a custom domain, and OneUptime serves it within 15 minutes of saving.",
          icon: "globe",
          link: {
            label: "SSL certificates",
            href: "/docs/status-pages/branding-and-domains#ssl-certificates",
          },
        },
        {
          key: "email-subscribers",
          title: "Email subscribers",
          description:
            "Subscribers hear about incidents, announcements and scheduled maintenance through your own mail server.",
          icon: "mail",
          link: {
            label: "Subscribers",
            href: "/docs/status-pages/subscribers",
          },
        },
        {
          key: "sms-subscribers",
          title: "SMS subscribers",
          description:
            "Status page subscriber SMS goes through the gateway you run, as on-call pages do.",
          icon: "phone",
          link: {
            label: "SMS and call gateway",
            href: "/docs/self-hosted/sms-and-call-gateway",
          },
        },
        {
          key: "maintenance",
          title: "Scheduled maintenance",
          description:
            "Announce maintenance on the page, and read it from a calendar on your own network.",
          icon: "calendar",
          link: {
            label: "Maintenance calendars",
            href: "/docs/scheduled-maintenance/calendar",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Certificates become yours, and subscribers reach people through what you run.",
      rows: [
        {
          key: "certificates",
          name: "Free certificates",
          usually: "Let's Encrypt, which checks your server on port 80",
          inside:
            "Upload your own for each domain, or serve HTTPS at your own proxy. With no Let's Encrypt account key, a domain is live as soon as its CNAME record is verified.",
          status: "use-your-own",
        },
        {
          key: "sms-signup",
          name: "People subscribing themselves by SMS",
          usually: "A text with a link to open",
          inside:
            "The link has to open on their phone, so it needs a route to your install. Subscribers your team adds skip that step.",
          status: "change-a-setting",
        },
        {
          key: "private-feeds",
          name: "RSS and calendars on a private page",
          usually: "Apps that read the feed with no sign-in",
          inside:
            "A private page's feed lists nothing and its calendar is empty, since an app cannot sign in. On a closed network, a page open to anyone with the link is still open only to your network.",
          status: "change-a-setting",
        },
        {
          key: "chat-subscribers",
          name: "Slack and Microsoft Teams subscribers",
          usually: "`hooks.slack.com` and Microsoft's own addresses",
          inside:
            "OneUptime takes webhooks on those hosts alone, so these need a route. Use email or SMS subscribers.",
          status: "needs-a-route",
        },
        {
          key: "webhook-subscribers",
          name: "Webhook subscribers",
          usually: "Any address that is not private",
          inside:
            "Ones your team adds reach your own tools once webhooks may reach private addresses. People who subscribe themselves on the page still need a public address.",
          status: "change-a-setting",
        },
      ],
    },
    configure: {
      title: "Serve a status page on your own domain",
      lead: "Set the record once for the install, then add each domain and its certificate.",
      steps: [
        {
          key: "cname",
          title: "Set the CNAME record",
          description:
            "Set `statusPage.cnameRecord` to a hostname that points at your OneUptime server.",
        },
        {
          key: "domain",
          title: "Add the domain",
          description:
            "Verify the parent domain under Project Settings > Advanced > Domains, then add the domain to the status page.",
        },
        {
          key: "certificate",
          title: "Upload your certificate",
          description:
            "Under More fields, switch Upload Custom Certificate on and paste the certificate and its key.",
        },
      ],
      code: {
        label: "values.yaml",
        ariaLabel: "The status page CNAME record for your own install",
        language: "yaml",
        text: ["statusPage:", "  cnameRecord: oneuptime.yourcompany.com"].join(
          "\n",
        ),
        separator: ": ",
      },
      caption:
        "Leave `letsEncrypt.accountKey` empty: a self-hosted install without one issues no free certificates.",
      link: {
        label: "SSL certificates",
        href: "/docs/status-pages/branding-and-domains#ssl-certificates",
      },
    },
    installNote:
      "Status pages come with the install: there is no separate edition, image or chart to bring in for them.",
    faqs: [
      {
        question: "Can a status page be kept to people who sign in?",
        answer:
          "Yes. Choose Only people who sign in, and visitors sign in as a private user or with your SSO or OIDC provider. Every edition has both. IP allowlists and reader session length are part of the Enterprise Edition.",
      },
      {
        question: "Do we need the Enterprise Edition for SSO on a status page?",
        answer:
          "No. Single sign-on is in every edition, status pages included.",
      },
      {
        question: "Can subscribers get updates in our own tools?",
        answer:
          "Not through a webhook subscriber: those never reach a private address, and no setting changes that. Project webhooks and workflows do, once you allow private addresses, so use one of those.",
      },
      {
        question: "Can we use our own proxy for HTTPS?",
        answer:
          "Yes. On a self-hosted install with no Let's Encrypt account key, a domain is live as soon as its CNAME record is verified, and you serve its HTTPS at your own proxy or load balancer.",
      },
    ],
    relatedSlugs: ["incident-management", "on-call", "monitoring"],
    product: {
      label: "See the Status Page product",
      href: "/product/status-page",
    },
    productPaths: ["/product/status-page", "/product/scheduled-maintenance"],
  },
  {
    slug: "kubernetes",
    path: "/enterprise/air-gapped/kubernetes",
    name: "Kubernetes",
    title: "Air-gapped Kubernetes monitoring",
    summary:
      "The Kubernetes agent from images in your own registry, on OpenShift too, sending to your own install alone.",
    icon: "cube",
    seo: {
      title: "Air-Gapped Kubernetes Monitoring | OneUptime",
      description:
        "Monitor Kubernetes clusters with no internet. Run the OneUptime agent chart from images in your own registry, on OpenShift too, and send to your own install.",
    },
    headline: "Kubernetes monitoring",
    headlineContinued: "for clusters with no way out.",
    lead: "Run the Kubernetes agent from images in your own registry. Each part of it sends what it collects to your own OneUptime URL over OTLP, with the ingestion key you give it.",
    proofPoints: [
      "Every image takes your registry",
      "Sends to your own URL",
      "OpenShift presets",
      "Cost from a rate card of your own",
    ],
    flow: {
      from: {
        title: "In each cluster",
        items: [
          {
            label: "Node collector",
            detail: "On every Linux node",
            icon: "server",
          },
          {
            label: "eBPF",
            detail: "Application traces",
            icon: "bolt",
          },
          {
            label: "Cluster collector",
            detail: "Cluster metrics and events",
            icon: "layers",
          },
          {
            label: "AI agent",
            detail: "Investigates from inside",
            icon: "sparkles",
          },
        ],
      },
      oneUptime: {
        detail:
          "Receives it all at your own URL, with the ingestion key you give the chart.",
        items: [
          { label: "Cluster views", icon: "cube" },
          { label: "Kubernetes monitors", icon: "bell" },
          { label: "ClickHouse", icon: "database" },
        ],
      },
      to: {
        title: "What your people use",
        items: [
          {
            label: "Logs and traces",
            detail: "Beside the cluster they came from",
            icon: "search",
          },
          {
            label: "Ready-made alerts",
            detail: "Twenty-one templates",
            icon: "bell",
          },
          {
            label: "Incidents",
            detail: "Declared when criteria match",
            icon: "fire",
          },
        ],
      },
    },
    inside: {
      title: "A whole cluster, reported to your own install",
      lead: "The agent chart runs a few workloads in its own namespace. None of them needs a public address.",
      capabilities: [
        {
          key: "signals",
          title: "Metrics, events, logs and traces",
          description:
            "The agent collects cluster metrics, events, pod logs, application traces through eBPF, and OS-level node metrics.",
          icon: "chart",
          link: {
            label: "Install the Kubernetes agent",
            href: "/docs/monitor/kubernetes-agent",
          },
        },
        {
          key: "your-url",
          title: "Sent to your own URL",
          description:
            "Each workload sends what it collects to your OneUptime URL over OTLP, with the ingestion key you give it.",
          icon: "link",
          link: {
            label: "What the chart installs",
            href: "/docs/monitor/kubernetes-agent#what-the-chart-installs",
          },
        },
        {
          key: "alerts",
          title: "Twenty-one ready-made alerts",
          description:
            "Start from a template, from a silent cluster to etcd, on the metrics the agent sends.",
          icon: "bell",
          link: {
            label: "Alert templates",
            href: "/docs/monitor/kubernetes-monitor#pre-built-alert-templates",
          },
        },
        {
          key: "openshift",
          title: "OpenShift",
          description:
            "Presets for OpenShift Container Platform, ROSA, ARO and OKD, one of them for clusters where an admin will not add an SCC.",
          icon: "shield",
          link: {
            label: "Pick a preset",
            href: "/docs/monitor/kubernetes-agent#pick-a-preset",
          },
        },
        {
          key: "ai-agent",
          title: "AI investigations from inside",
          description:
            "The Kubernetes AI agent runs in your cluster, and its calls are HTTPS requests to your own install.",
          icon: "sparkles",
          link: {
            label: "AI agent values",
            href: "/docs/telemetry/kubernetes-agent#ai-agent-values",
          },
        },
        {
          key: "cost",
          title: "Cost with no cloud price list",
          description:
            "Clusters with no public list price set a rate card, in USD per resource-hour, and OpenCost prices every resource from it.",
          icon: "chart",
          link: {
            label: "On-prem and bare-metal pricing",
            href: "/docs/telemetry/kubernetes-cost#on-prem-and-bare-metal-pricing",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Mostly where images come from. The chart names each image on its own, with no one registry setting.",
      rows: [
        {
          key: "images",
          name: "Agent images",
          usually: "Docker Hub, `registry.k8s.io`, `ghcr.io` and `quay.io`",
          inside:
            "Mirror each one, and set its `repository` in your values. Images you turn on later, such as cost or profiling, take theirs the same way.",
          status: "change-a-setting",
        },
        {
          key: "pull-secrets",
          name: "Registry credentials",
          usually: "`aiAgent.imagePullSecrets` alone",
          inside:
            "That key reaches the AI agent's pod and no other, so your nodes need to pull the other images from your mirror without a pull secret from the chart.",
          status: "use-your-own",
        },
        {
          key: "chart",
          name: "The Helm chart",
          usually: "`helm repo add` against `helm-chart.oneuptime.com`",
          inside:
            "Download the chart on a connected machine and bring it across, as you do the main chart. It is signed with the same key.",
          status: "use-your-own",
        },
        {
          key: "private-ca",
          name: "A certificate from your own CA",
          usually: "The collector image's trust store",
          inside:
            "The collector image's trust store has to accept your install's certificate, and the chart has no setting for a CA bundle. Plan for it in the image you mirror.",
          status: "use-your-own",
        },
        {
          key: "cost-prices",
          name: "Cost",
          usually: "Your cloud provider's public list prices",
          inside:
            "Set a rate card under `cost.opencost.customPricing`, and OpenCost prices every resource from it.",
          status: "use-your-own",
        },
      ],
    },
    configure: {
      title: "Point the agent chart at your registry",
      lead: "Every image has its own `repository`, so a mirror takes one line an image.",
      steps: [
        {
          key: "mirror",
          title: "Mirror the images",
          description:
            "Copy each image into your registry, and pin the ones that track `release`, such as `aiAgent.image.tag`.",
        },
        {
          key: "values",
          title: "Name your registry",
          description: "Set each image's `repository` in your values.",
        },
        {
          key: "install",
          title: "Install the chart you brought in",
          description:
            "Run `helm install` with `oneuptime.url` set to your install, and your ingestion key and cluster name.",
        },
      ],
      code: {
        label: "values.yaml",
        ariaLabel: "The Kubernetes agent's images from your own registry",
        language: "yaml",
        text: [
          "image:",
          "  repository: registry.example.com/otel/opentelemetry-collector-contrib",
          "ebpf:",
          "  image:",
          "    repository: registry.example.com/otel/ebpf-instrument",
          "aiAgent:",
          "  image:",
          "    repository: registry.example.com/oneuptime/kubernetes-ai-agent",
        ].join("\n"),
        separator: ": ",
      },
      caption:
        "These are the images a default install runs. A test renders the chart with exactly these values: every image comes from your registry.",
      link: {
        label: "Install the Kubernetes agent",
        href: "/docs/monitor/kubernetes-agent",
      },
    },
    installNote:
      "Install the platform first. The Kubernetes agent has a chart and images of its own, which cross the gap the same way.",
    faqs: [
      {
        question: "Does the agent send anything anywhere but our install?",
        answer:
          "No. Each workload sends what it collects to your OneUptime URL, and the Kubernetes AI agent's calls go to that URL too.",
      },
      {
        question: "Is there one setting for our registry?",
        answer:
          "No. The agent chart names each image on its own, so set each image's `repository`. Its one pull-secret key, `aiAgent.imagePullSecrets`, reaches the AI agent's pod alone.",
      },
      {
        question: "Does it work on OpenShift behind an air gap?",
        answer:
          "Yes. Set `preset=openshift`, or `preset=openshift-restricted` where an admin will not add an SCC. Images mirror the same way as on any other cluster.",
      },
      {
        question: "Can our install use a certificate from our own CA?",
        answer:
          "The collector image's trust store has to accept the certificate, and the chart has no setting for a CA bundle, so plan for it in the image you mirror.",
      },
    ],
    relatedSlugs: ["observability", "infrastructure", "ai"],
    product: {
      label: "See the Kubernetes product",
      href: "/product/kubernetes",
    },
    productPaths: ["/product/kubernetes"],
  },
  {
    slug: "network-monitoring",
    path: "/enterprise/air-gapped/network-monitoring",
    name: "Network Monitoring",
    title: "Air-gapped network monitoring",
    summary:
      "SNMP polling, traps, syslog, flows and topology from a probe on your network, with nothing to download and no vendor cloud to reach.",
    icon: "globe",
    seo: {
      title: "Air-Gapped Network Monitoring | SNMP & Flows | OneUptime",
      description:
        "Monitor switches, routers and firewalls with no internet. A probe on your network polls SNMP and takes traps, syslog and flows, with no vendor cloud to reach.",
    },
    headline: "See every device",
    headlineContinued: "on networks that never touch the internet.",
    lead: "A probe on your network polls devices over SNMP, takes traps, syslog and flows, and builds your topology from LLDP. Its OID names and map outlines ship with OneUptime, so there is nothing to download.",
    proofPoints: [
      "SNMP v1, v2c and v3",
      "NetFlow, IPFIX and sFlow",
      "OID names built in",
      "No map service to reach",
    ],
    flow: {
      from: {
        title: "On your network",
        items: [
          {
            label: "Switches and routers",
            detail: "SNMP v1, v2c and v3",
            icon: "serverStack",
          },
          {
            label: "Firewalls and appliances",
            detail: "Syslog and traps",
            icon: "shield",
          },
          {
            label: "Flow exporters",
            detail: "NetFlow, IPFIX and sFlow",
            icon: "chart",
          },
          {
            label: "Anything with an address",
            detail: "Ping",
            icon: "globe",
          },
        ],
      },
      oneUptime: {
        detail:
          "A probe on each network polls your devices, and listens for what they send.",
        items: [
          { label: "SNMP polling", icon: "probe" },
          { label: "Trap, syslog and flow listeners", icon: "bolt" },
          { label: "Network topology", icon: "link" },
        ],
      },
      to: {
        title: "What your people see",
        items: [
          {
            label: "Device health",
            detail: "Up or down, from the probe",
            icon: "chart",
          },
          {
            label: "Network map",
            detail: "From LLDP neighbours",
            icon: "globe",
          },
          {
            label: "Sites",
            detail: "A tree of your locations",
            icon: "layers",
          },
        ],
      },
    },
    inside: {
      title: "Everything is read from your own devices",
      lead: "Nothing here depends on a vendor's cloud. The probe talks to the device, and the device talks to the probe.",
      capabilities: [
        {
          key: "snmp",
          title: "SNMP polling",
          description:
            "Add anything with an address on your network, whether or not it speaks SNMP. Give it SNMP v1, v2c or v3 credentials, and the probe walks it too.",
          icon: "probe",
          link: {
            label: "Network device monitor",
            href: "/docs/monitor/network-device-monitor",
          },
        },
        {
          key: "traps",
          title: "SNMP traps",
          description:
            "A probe takes v1 and v2c traps and informs, on UDP 162 by default.",
          icon: "bell",
          link: {
            label: "SNMP traps",
            href: "/docs/monitor/network-device-monitor#snmp-traps",
          },
        },
        {
          key: "syslog",
          title: "Syslog events",
          description:
            "Every probe listens for syslog on port 5140, over UDP and over TCP, and matches each message to a device.",
          icon: "logs",
          link: {
            label: "Network events",
            href: "/docs/monitor/network-events",
          },
        },
        {
          key: "flows",
          title: "NetFlow, IPFIX and sFlow",
          description:
            "Every probe runs a flow collector, on three UDP ports that each read every format.",
          icon: "chart",
          link: {
            label: "Network traffic",
            href: "/docs/monitor/network-traffic",
          },
        },
        {
          key: "topology",
          title: "Discovery and topology",
          description:
            "A scan is a plain ICMP sweep, and the network map is built from the LLDP neighbours that interface walks collect.",
          icon: "link",
          link: {
            label: "Network device monitor",
            href: "/docs/monitor/network-device-monitor",
          },
        },
        {
          key: "sites",
          title: "Sites",
          description:
            "Sites form a tree of your locations, drawn on a world map from outlines that ship with OneUptime.",
          icon: "layers",
          link: { label: "Network sites", href: "/docs/monitor/network-sites" },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Very little changes for the devices. What matters is where the probe that listens to them runs.",
      rows: [
        {
          key: "unknown-senders",
          name: "Syslog and flows from unknown senders",
          usually: "A global probe drops them",
          inside:
            "Run your own probe on the device network. It keeps them until you say which device they belong to.",
          status: "use-your-own",
        },
        {
          key: "container-ports",
          name: "Listeners inside a container",
          usually: "Reachable only with host networking, or when published",
          inside:
            "Run the probe with host networking on the device network, so devices can reach its listeners.",
          status: "change-a-setting",
        },
        {
          key: "packet-capture",
          name: "Packet capture",
          usually: "The probes that come with an install never capture",
          inside: "Run a custom probe in the network you want to capture in.",
          status: "use-your-own",
        },
        {
          key: "meraki",
          name: "Cisco Meraki's dashboard API",
          usually: "`api.meraki.com`",
          inside: "Send NetFlow from the MX appliances to a probe instead.",
          status: "use-your-own",
        },
      ],
    },
    configure: {
      title: "Run a probe with its listeners on your network",
      lead: "A probe you run listens for traps, syslog and flows from the moment it starts.",
      steps: [
        {
          key: "add-probe",
          title: "Add a probe",
          description:
            "In OneUptime, add a custom probe and copy its ID and key from Show ID and Key.",
        },
        {
          key: "host-network",
          title: "Run it on host networking",
          description:
            "Start it on the device network from the image you mirrored, so devices can reach its ports.",
        },
        {
          key: "point-devices",
          title: "Point your devices at it",
          description:
            "Send traps to UDP 162, syslog to port 5140, and flows to UDP 2055, 4739 or 6343.",
        },
      ],
      code: {
        label: "docker-compose.yml",
        ariaLabel: "A probe with host networking, from your own registry",
        language: "yaml",
        text: [
          "services:",
          "  oneuptime-probe:",
          "    image: registry.example.com/oneuptime/probe:release",
          "    container_name: oneuptime-probe",
          "    environment:",
          "      - PROBE_KEY=<probe-key>",
          "      - PROBE_ID=<probe-id>",
          "      - ONEUPTIME_URL=https://oneuptime.example.com",
          "    network_mode: host",
          "    restart: always",
        ].join("\n"),
        separator: ": ",
      },
      caption:
        "Syslog takes plain UDP and TCP, so keep the path between your devices and the probe on a network you trust.",
      link: {
        label: "What the probe listens on",
        href: "/docs/probe/custom-probe#what-the-probe-listens-on",
      },
    },
    installNote:
      "Network monitoring comes with the install. A probe on the device network runs the image you mirrored.",
    faqs: [
      {
        question: "Do we have to download MIBs or vendor data?",
        answer:
          "No. OneUptime names OIDs from data it ships with, and an OID no known object covers is named after the nearest group it sits in, the way snmpwalk names one whose MIB it lacks.",
      },
      {
        question: "Does the network map need a map service?",
        answer:
          "No. The world map of your sites is drawn from country outlines that ship with OneUptime, so it loads no map tiles.",
      },
      {
        question: "Can the probe in the Helm chart do this?",
        answer:
          "Use a probe of your own on the device network. The probes that come with an install are global, so they drop syslog and flows from senders they do not poll, and they never capture packets.",
      },
      {
        question: "Is syslog encrypted?",
        answer:
          "No. The probe takes plain UDP and TCP, and syslog over TLS is not included. Keep the path between devices and the probe on a network you trust.",
      },
    ],
    relatedSlugs: ["monitoring", "infrastructure", "log-management"],
    product: {
      label: "See the Network Devices product",
      href: "/product/network-monitoring",
    },
    productPaths: ["/product/network-monitoring"],
  },
  {
    slug: "infrastructure",
    path: "/enterprise/air-gapped/infrastructure",
    name: "Infrastructure",
    title: "Air-gapped infrastructure monitoring",
    summary:
      "Hosts, VMware, Proxmox, Ceph, OpenStack, storage arrays and containers, each read from a machine on your own network.",
    icon: "serverStack",
    seo: {
      title: "Air-Gapped Infrastructure Monitoring | OneUptime",
      description:
        "Monitor hosts, VMware, Proxmox, Ceph, OpenStack and storage arrays with no internet. A collector or probe on your network reports to your own install.",
    },
    headline: "Hosts, hypervisors and storage,",
    headlineContinued: "watched from inside your network.",
    lead: "Add hosts with one command from your own install, and read vCenter, Proxmox, Ceph and storage arrays from a machine on your own network.",
    proofPoints: [
      "Installers served by your install",
      "Downloads from a mirror you run",
      "VMware with no agent",
      "Read-only accounts and tokens",
    ],
    flow: {
      from: {
        title: "What you run",
        items: [
          {
            label: "Hosts",
            detail: "Linux, Windows and macOS",
            icon: "server",
          },
          {
            label: "VMware",
            detail: "vCenter or a standalone ESXi host",
            icon: "serverStack",
          },
          {
            label: "Proxmox and Ceph",
            detail: "Through their own APIs",
            icon: "cube",
          },
          {
            label: "Storage arrays",
            detail: "Over their management interface",
            icon: "database",
          },
        ],
      },
      oneUptime: {
        detail:
          "Collectors and probes on your network report to your own install.",
        items: [
          { label: "Host collector", icon: "server" },
          { label: "Probes", icon: "probe" },
          { label: "Agents", icon: "cube" },
        ],
      },
      to: {
        title: "What your people use",
        items: [
          {
            label: "Host metrics and logs",
            detail: "From every machine",
            icon: "chart",
          },
          {
            label: "Monitors",
            detail: "Alerts on what each one reports",
            icon: "bell",
          },
          {
            label: "Incidents",
            detail: "Declared when criteria match",
            icon: "fire",
          },
        ],
      },
    },
    inside: {
      title: "Read from a machine on your own network",
      lead: "Nothing is probed from outside. Each of these reads what it needs over your own network.",
      capabilities: [
        {
          key: "hosts",
          title: "Hosts",
          description:
            "Add a Linux, Windows or macOS machine with one command, and OneUptime sends the collector its config and keeps it up to date.",
          icon: "server",
          link: { label: "Hosts", href: "/docs/telemetry/hosts" },
        },
        {
          key: "vmware",
          title: "VMware with no agent",
          description:
            "Enter vCenter's address and a read-only account, pick the probe that can reach it, and the probe collects the data.",
          icon: "serverStack",
          link: {
            label: "VMware without an agent",
            href: "/docs/telemetry/vmware-agentless",
          },
        },
        {
          key: "proxmox",
          title: "Proxmox VE",
          description:
            "An agent on a machine that can reach every node's API on port 8006 reads the cluster with a read-only token.",
          icon: "cube",
          link: { label: "Proxmox agent", href: "/docs/telemetry/proxmox" },
        },
        {
          key: "openstack",
          title: "OpenStack",
          description:
            "An agent on a machine that can reach Keystone and each service's endpoint, or a probe with nothing to install, reads the cloud with a credential you choose.",
          icon: "serverStack",
          link: { label: "OpenStack agent", href: "/docs/telemetry/openstack" },
        },
        {
          key: "storage",
          title: "Ceph and storage arrays",
          description:
            "An agent on a machine that can reach your mgr daemons on port 9283, or the array's management interface over HTTPS, reads cluster health, capacity, latency and hardware health.",
          icon: "database",
          link: {
            label: "Storage array agent",
            href: "/docs/telemetry/storage-arrays",
          },
        },
        {
          key: "containers",
          title: "Docker and Podman",
          description:
            "An agent on the host reads its containers, so nothing is probed from outside.",
          icon: "cube",
          link: {
            label: "Docker monitor",
            href: "/docs/monitor/docker-monitor",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Your install serves the installers. What they download is what you have to bring across.",
      rows: [
        {
          key: "host-collector",
          name: "Host collector downloads",
          usually: "GitHub, the OpenTelemetry Collector's releases",
          inside:
            "Pass `--download-url` a mirror with the same folder layout as GitHub's, with its `.sha256` files.",
          status: "use-your-own",
        },
        {
          key: "agent-images",
          name: "Agent images",
          usually: "Docker Hub, `ghcr.io` and `quay.io`",
          inside:
            "The Proxmox, Ceph, OpenStack and storage array agents run stock images named in their `docker-compose.yml`. Their files come from your install: mirror each image, and change its name there.",
          status: "use-your-own",
        },
        {
          key: "infrastructure-agent",
          name: "The older infrastructure agent",
          usually: "GitHub, and `packages.oneuptime.com` for apt and yum",
          inside:
            "It has no mirror option, and Create Monitor no longer offers it. Use the host collector for new hosts.",
          status: "use-your-own",
        },
      ],
    },
    configure: {
      title: "Add a host from your own install",
      lead: "Every OneUptime serves its own installers, so a host only needs to reach your install, and a mirror of the collector's releases.",
      steps: [
        {
          key: "mirror",
          title: "Mirror the collector's releases",
          description:
            "Copy them to a server of your own, with the same folder layout as GitHub's and their `.sha256` files.",
        },
        {
          key: "ingestion-key",
          title: "Pick an ingestion key",
          description:
            "Add Host creates one for you, or pick one from Project Settings > Telemetry & APM > Ingestion Keys.",
        },
        {
          key: "run",
          title: "Run the command on the host",
          description:
            "Use your OneUptime URL in place of the example, in both places, and add `--download-url`.",
        },
      ],
      code: {
        label: "On each host",
        ariaLabel:
          "Install the host collector from your own install and mirror",
        language: "bash",
        text: [
          "curl -fsSL https://oneuptime.example.com/docs/static/scripts/host-collector/install.sh \\",
          "  | sudo sh -s -- \\",
          "  --url https://oneuptime.example.com \\",
          "  --key YOUR_INGESTION_KEY \\",
          "  --download-url https://mirror.example.com/opentelemetry-collector-releases/releases/download",
        ].join("\n"),
        separator: "=",
      },
      caption:
        "A host needs outbound HTTPS to your OneUptime URL, and to your mirror. Nothing has to reach it from outside.",
      link: {
        label: "Install options",
        href: "/docs/telemetry/hosts#install-options",
      },
    },
    installNote:
      "Install the platform first. Your install then serves the installers, and the collector releases and agent images cross the gap the same way.",
    faqs: [
      {
        question: "How does the collector get onto a host with no internet?",
        answer:
          "Your install serves the installer. The releases it downloads come from GitHub by default, so pass `--download-url` a mirror with the same folder layout, with its `.sha256` files.",
      },
      {
        question: "Does VMware monitoring need an agent?",
        answer:
          "No. Enter vCenter's address and a read-only account in OneUptime, and pick the probe that can reach it. There is no agent to install, upgrade or look after.",
      },
      {
        question: "Can we use the older infrastructure agent?",
        answer:
          "Server / VM monitors you already have keep working, but its downloads come from GitHub, with no mirror option, and Create Monitor no longer offers it. Use a Host monitor and the host collector for new hosts.",
      },
      {
        question:
          "What do the Proxmox, Ceph, OpenStack and storage array agents need?",
        answer:
          "A machine on your network that can reach what they read, with Docker to run them. Mirror the images their `docker-compose.yml` names, because those are not on your install. The OpenStack agent's installer has no option to download from a mirror, so behind a gap run it with Docker.",
      },
    ],
    relatedSlugs: ["monitoring", "kubernetes", "network-monitoring"],
    product: {
      label: "See the Hosts product",
      href: "/product/host",
    },
    productPaths: [
      "/product/host",
      "/product/vmware",
      "/product/proxmox",
      "/product/ceph",
      "/product/openstack",
      "/product/docker",
      "/product/podman",
    ],
  },
  {
    slug: "ai",
    path: "/enterprise/air-gapped/ai",
    name: "AI",
    title: "Air-gapped AI",
    summary:
      "Investigations, Ask AI, drafts and fixes on a model you run, read-only and with secrets redacted before anything reaches it.",
    icon: "sparkles",
    seo: {
      title: "Air-Gapped AI for Incidents | Your Own Model | OneUptime",
      description:
        "OneUptime AI with no internet: investigations, Ask AI, drafts and fixes on a model you run with Ollama or vLLM, so telemetry never leaves your infrastructure.",
    },
    headline: "AI for your incidents,",
    headlineContinued: "on a model you run.",
    lead: "Investigations, Ask AI, drafts and fixes work with a model on your own network, so no prompt leaves it. Investigations are read-only, and secrets are redacted before anything reaches the model.",
    proofPoints: [
      "Ollama or any OpenAI-compatible server",
      "vLLM in the Helm chart",
      "Investigations are read-only",
      "Secrets redacted before the model",
    ],
    flow: {
      from: {
        title: "What it reads",
        items: [
          {
            label: "Incidents and alerts",
            detail: "The moment one is declared",
            icon: "fire",
          },
          {
            label: "Your telemetry",
            detail: "Logs, metrics, traces and exceptions",
            icon: "chart",
          },
          {
            label: "Your code",
            detail: "On your own Git server",
            icon: "code",
          },
        ],
      },
      oneUptime: {
        detail:
          "Investigates with read-only tools, and redacts secrets from what it sends the model.",
        items: [
          { label: "Investigations", icon: "search" },
          { label: "Ask AI", icon: "chat" },
          { label: "Drafts and fixes", icon: "wrench" },
        ],
      },
      to: {
        title: "The model you run",
        items: [
          {
            label: "Ollama",
            detail: "Open models on your own machines",
            icon: "chip",
          },
          {
            label: "vLLM",
            detail: "In your cluster, on your GPUs",
            icon: "serverStack",
          },
          {
            label: "OpenAI-compatible servers",
            detail: "LocalAI, LM Studio and others",
            icon: "server",
          },
        ],
      },
    },
    inside: {
      title: "Every AI feature works on your model",
      lead: "An LLM provider is the model behind every AI feature, and yours can be on your own network.",
      capabilities: [
        {
          key: "investigations",
          title: "Investigations",
          description:
            "The moment a new incident or alert is declared, OneUptime AI investigates it across your own telemetry and posts a cited root cause analysis.",
          icon: "search",
          link: { label: "AI SRE", href: "/docs/ai/ai-sre" },
        },
        {
          key: "ask-ai",
          title: "Ask AI",
          description:
            "Chat over your project's data, with a citation on every claim.",
          icon: "chat",
          link: { label: "Ask AI", href: "/docs/ai/ask-ai" },
        },
        {
          key: "drafts",
          title: "Drafts",
          description:
            "Start a postmortem from a draft by OneUptime AI, written on your own model.",
          icon: "book",
          link: {
            label: "Start from an AI draft",
            href: "/docs/incidents/postmortems#start-from-a-template-or-an-ai-draft",
          },
        },
        {
          key: "fixes",
          title: "Fixes on your own Git server",
          description:
            "A self-hosted OneUptime, and its global Runner, reach the Git servers of its own network, so a fix can land where your code is.",
          icon: "code",
          link: {
            label: "A Git server on a private network",
            href: "/docs/ai/ai-agent#a-git-server-on-a-private-network",
          },
        },
        {
          key: "read-only",
          title: "Read-only investigations",
          description:
            "An investigation cannot acknowledge, resolve, page or modify anything, and three independent checks keep it read-only.",
          icon: "lock",
          link: {
            label: "Trust and safety",
            href: "/docs/ai/ai-sre#trust-and-safety",
          },
        },
        {
          key: "redaction",
          title: "Secrets redacted",
          description:
            "Tokens, credentials and key patterns are redacted from tool results before anything is sent to the model.",
          icon: "shield",
          link: {
            label: "Trust and safety",
            href: "/docs/ai/ai-sre#trust-and-safety",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Everything works on a model you run. What you have to plan for is getting that model onto your network.",
      rows: [
        {
          key: "hosted-models",
          name: "Hosted models",
          usually: "OpenAI, Anthropic, Groq, Mistral and Azure OpenAI",
          inside:
            "Use Ollama or any OpenAI-compatible server on your network, or run vLLM in your cluster from the Helm chart.",
          status: "use-your-own",
        },
        {
          key: "git-provider",
          name: "GitHub fix pull requests",
          usually: "The GitHub App, which needs a public hostname for webhooks",
          inside:
            "Connect GitLab, Forgejo or Gitea on your network with an access token, or any Git server over HTTPS.",
          status: "use-your-own",
        },
        {
          key: "external-mcp",
          name: "External MCP servers",
          usually: "Servers on the internet",
          inside:
            "A self-hosted install reaches MCP servers on private addresses, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` is set.",
          status: "use-your-own",
        },
        {
          key: "mcp-sign-in",
          name: "MCP client sign-in",
          usually: "A URL that OneUptime fetches for a client",
          inside:
            "Set `mcpOAuth.disableClientIdMetadataDocuments: true` on an instance that cannot reach the internet.",
          status: "change-a-setting",
        },
        {
          key: "model-weights",
          name: "Downloading a model",
          usually: "`ollama pull`, or vLLM's first start",
          inside:
            "The docs give no offline step for either, so a machine with a route has to fetch the model. Plan how it crosses the gap before you install.",
          status: "needs-a-route",
        },
      ],
    },
    configure: {
      title: "Run a model in your cluster",
      lead: "The Helm chart can run vLLM beside OneUptime, on your own GPUs, and registers it for every project.",
      steps: [
        {
          key: "model",
          title: "Plan for the model",
          description:
            "The first start downloads the model, so settle how it reaches your network first.",
        },
        {
          key: "values",
          title: "Turn vLLM on",
          description:
            "Set `vllm.enabled` and `vllm.model` in your Helm values, on NVIDIA GPU nodes.",
        },
        {
          key: "upgrade",
          title: "Run helm upgrade",
          description:
            "vLLM is registered automatically as a Global LLM Provider at startup, so AI features work for all projects.",
        },
      ],
      code: {
        label: "values.yaml",
        ariaLabel: "vLLM in your own cluster",
        language: "yaml",
        text: [
          "vllm:",
          "  enabled: true",
          "  model: Qwen/Qwen2.5-1.5B-Instruct",
        ].join("\n"),
        separator: ": ",
      },
      caption:
        "A GPU is mandatory for the official vLLM image. The default model is small, about 3 GB.",
      link: {
        label: "vLLM on Kubernetes",
        href: "/docs/ai/llm-provider#self-hosted-vllm-on-kubernetes-helm",
      },
    },
    installNote:
      "AI comes with the install. The model is yours to bring across, and with no provider, no AI feature runs.",
    faqs: [
      {
        question: "Which AI features work with no internet?",
        answer:
          "Every one, on a model you run: investigations, Ask AI, drafts and fix pull requests. With no provider, no AI feature runs, and nothing else depends on one.",
      },
      {
        question: "Does anything leave our network?",
        answer:
          "No. With your own LLM provider, local Ollama included, telemetry never leaves your infrastructure.",
      },
      {
        question: "How do we get a model onto a closed network?",
        answer:
          "Plan for this one yourself. `ollama pull` and vLLM's first start both fetch the model, and the docs give no offline step for either, so a machine with a route has to fetch it.",
      },
      {
        question: "How big a model do we need?",
        answer:
          "Use one with reliable tool calling: a small self-hosted model without it answers poorly. For Ollama, 65,536 tokens is what Ollama recommends for agents.",
      },
      {
        question: "Can the AI change anything on its own?",
        answer:
          "Not during an investigation: it runs read-only tools, and cannot acknowledge, resolve, page or modify anything.",
      },
    ],
    relatedSlugs: ["incident-management", "observability", "workflows"],
    product: {
      label: "See the AI product",
      href: "/product/ai-agent",
    },
    productPaths: ["/product/ai-agent"],
  },
  {
    slug: "security-events",
    path: "/enterprise/air-gapped/security-events",
    name: "Security Events",
    title: "Air-gapped security events",
    summary:
      "A SIEM on your own network: detection rules in the product, threat feeds from your own server, and cases that stay inside.",
    icon: "shield",
    seo: {
      title: "Air-Gapped SIEM | Security Events | OneUptime",
      description:
        "A SIEM with no internet. Detection rules ship with the install, threat feeds come from your own MISP or OpenCTI server, and every case stays on your network.",
    },
    headline: "Detect threats",
    headlineContinued: "on a network that stays closed.",
    lead: "OneUptime reads your logs and turns the lines it recognizes into security events. Detection rules ship with the install, so nothing has to be fetched before you start.",
    proofPoints: [
      "Detection rules in the product",
      "MITRE ATT&CK data built in",
      "Feeds from your own server",
      "Cases and entity risk stay inside",
    ],
    flow: {
      from: {
        title: "What feeds it",
        items: [
          {
            label: "Your logs",
            detail: "Read every minute",
            icon: "logs",
          },
          {
            label: "Your sources",
            detail: "An HTTPS POST from anything",
            icon: "code",
          },
          {
            label: "Splunk and Elastic",
            detail: "On your own network",
            icon: "database",
          },
          {
            label: "Threat intelligence",
            detail: "From your own server",
            icon: "shield",
          },
        ],
      },
      oneUptime: {
        detail:
          "Gives every event the same shape, and finds the ones that matter.",
        items: [
          { label: "OCSF events", icon: "list" },
          { label: "Detection rules", icon: "filter" },
          { label: "Cases", icon: "flag" },
        ],
      },
      to: {
        title: "What your people do",
        items: [
          {
            label: "Work the case",
            detail: "Grouped by user, host or address",
            icon: "team",
          },
          {
            label: "Page on-call",
            detail: "An escalation step",
            icon: "phone",
          },
          {
            label: "Declare an incident",
            detail: "Linked to the case",
            icon: "fire",
          },
        ],
      },
    },
    inside: {
      title: "Detection, cases and risk run on your install",
      lead: "Rules and technique data are part of the product, not a feed to subscribe to.",
      capabilities: [
        {
          key: "logs",
          title: "Events from your logs",
          description:
            "OneUptime reads the project's new logs every minute and turns the lines it recognizes into security events.",
          icon: "logs",
          link: {
            label: "Get started",
            href: "/docs/telemetry/security-getting-started#find-security-events-in-your-logs",
          },
        },
        {
          key: "rules",
          title: "Detection rules in the product",
          description:
            "Ready-made rules for identity, endpoint, cloud, network, web and Kubernetes threats ship with the install.",
          icon: "filter",
          link: {
            label: "Detection rules",
            href: "/docs/telemetry/security-events#detection-rules",
          },
        },
        {
          key: "cases",
          title: "Cases",
          description:
            "Every detection about the same user, host or address is grouped into one case.",
          icon: "flag",
          link: { label: "Cases", href: "/docs/telemetry/security-cases" },
        },
        {
          key: "entity-risk",
          title: "Entity risk",
          description:
            "Adds up what your detection rules, threat intelligence, connected products and Data Security find.",
          icon: "chart",
          link: {
            label: "Entity risk",
            href: "/docs/telemetry/security-entity-risk",
          },
        },
        {
          key: "threat-intel",
          title: "Threat intelligence you host",
          description:
            "Read indicators from your own MISP, OpenCTI or OpenTAXII server, or a list at an `https` address.",
          icon: "shield",
          link: {
            label: "Threat intelligence",
            href: "/docs/telemetry/threat-intelligence",
          },
        },
        {
          key: "on-network-sources",
          title: "Splunk and Elastic on your network",
          description:
            "A connection reads Splunk Enterprise Security from a search head on your private network, and Elastic Security from your own Elastic stack.",
          icon: "database",
          link: {
            label: "Connect a security product",
            href: "/docs/telemetry/security-events#connect-a-security-product",
          },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "Detection does not change. What changes is what it connects to.",
      rows: [
        {
          key: "cloud-connections",
          name: "Connections to cloud products",
          usually:
            "Microsoft Sentinel, Defender XDR, CrowdStrike Falcon, Okta, Entra ID, Google and AWS",
          inside:
            "These poll the product's own service, so they need a route. Send your own sources over HTTPS instead.",
          status: "needs-a-route",
        },
        {
          key: "containment",
          name: "Contain steps",
          usually: "Okta, CrowdStrike, Microsoft Defender, Entra ID and Google",
          inside:
            "They act through those products, so they need a route too. Use Page on-call, Email people or Declare an incident.",
          status: "needs-a-route",
        },
        {
          key: "free-lists",
          name: "Free threat lists",
          usually: "Public lists at their own addresses",
          inside:
            "Host a list yourself at an `https` address, or subscribe your own MISP, OpenCTI or OpenTAXII server.",
          status: "use-your-own",
        },
        {
          key: "chat-steps",
          name: "Slack and Microsoft Teams steps",
          usually: "Post to Slack, Post to Microsoft Teams",
          inside: "Use Email people or Page on-call from a playbook instead.",
          status: "use-your-own",
        },
        {
          key: "mitre-links",
          name: "Links to MITRE ATT&CK",
          usually: "`attack.mitre.org`",
          inside:
            "Cases still name each tactic and technique, from data built into the product. Only the link out needs a route.",
          status: "needs-a-route",
        },
      ],
    },
    configure: {
      title: "Send events from any source",
      lead: "Post JSON to `/security-events/v1/ingest` on your own install, with your ingestion key.",
      steps: [
        {
          key: "ingestion-key",
          title: "Create an ingestion key",
          description:
            "Under Project Settings > Telemetry & APM > Ingestion Keys.",
        },
        {
          key: "format",
          title: "Pick a format",
          description: "OCSF, Google UDM or generic JSON.",
        },
        {
          key: "post",
          title: "Post your events",
          description: "Send the key in the `x-oneuptime-token` header.",
        },
      ],
      code: {
        label: "Post your events",
        ariaLabel: "Post OCSF events to your own install",
        language: "bash",
        text: [
          'curl -X POST "https://oneuptime.example.com/security-events/v1/ingest?format=ocsf" \\',
          '  -H "Content-Type: application/json" \\',
          '  -H "x-oneuptime-token: YOUR_INGESTION_TOKEN" \\',
          '  -H "x-oneuptime-service-name: my-security-source" \\',
          "  -d @events.json",
        ].join("\n"),
        separator: ": ",
      },
      caption:
        "OneUptime gives every event the same shape, OCSF, whatever format it arrived in.",
      link: {
        label: "Send security events",
        href: "/docs/telemetry/security-events#send-security-events",
      },
    },
    installNote:
      "Security events come with the install: there is no separate edition, image or chart to bring in for them.",
    faqs: [
      {
        question: "Do detection rules need a download?",
        answer:
          "No. The rule library and the MITRE ATT&CK data ship with the install, so nothing is fetched to start detecting.",
      },
      {
        question: "Can we use threat intelligence with no internet?",
        answer:
          "Yes, from a server you run: MISP, OpenCTI or OpenTAXII, or a list at an `https` address. Servers that require a TLS client certificate are not supported.",
      },
      {
        question: "Which security products can we connect?",
        answer:
          "Splunk Enterprise Security and Elastic Security can be on your own network. The other connections poll a cloud service, so they need a route.",
      },
      {
        question: "Can we contain a threat from a closed network?",
        answer:
          "The Contain steps act through Okta, CrowdStrike, Microsoft and Google, so they need a route. Inside the gap, use Page on-call, Email people or Declare an incident from a playbook.",
      },
    ],
    relatedSlugs: ["log-management", "observability", "workflows"],
    product: {
      label: "See the Security Events product",
      href: "/product/security-events",
    },
    productPaths: ["/product/security-events"],
  },
  {
    slug: "workflows",
    path: "/enterprise/air-gapped/workflows",
    name: "Workflows",
    title: "Air-gapped workflows and runbooks",
    summary:
      "Workflows that reach your own tools, and runbooks on a Runner you host, over SSH, Bash and HTTP.",
    icon: "wrench",
    seo: {
      title: "Air-Gapped Workflows & Runbooks | Automation | OneUptime",
      description:
        "Automate incident response with no internet. Workflows post to Mattermost and IRC on your network, and runbooks run on a Runner you host, over SSH and Bash.",
    },
    headline: "Automate the response",
    headlineContinued: "without leaving your network.",
    lead: "Workflows react to what happens in OneUptime, and runbooks run your scripts on a Runner you host. Both reach the systems on your own network.",
    proofPoints: [
      "Runner needs outbound HTTPS alone",
      "Mattermost and IRC on your network",
      "SSH, Bash and kubectl steps",
      "No run limits when self-hosted",
    ],
    flow: {
      from: {
        title: "What starts it",
        items: [
          {
            label: "Events",
            detail: "A record is created, updated or deleted",
            icon: "bolt",
          },
          {
            label: "Schedules",
            detail: "A cron expression",
            icon: "calendar",
          },
          {
            label: "Webhooks",
            detail: "Another system calls a URL",
            icon: "link",
          },
          {
            label: "People",
            detail: "On an incident, at 3am",
            icon: "team",
          },
        ],
      },
      oneUptime: {
        detail:
          "Runs workflows on your install, and hands runbook steps to your Runner.",
        items: [
          { label: "Workflows", icon: "layers" },
          { label: "Runbooks", icon: "book" },
          { label: "Your Runner", icon: "terminal" },
        ],
      },
      to: {
        title: "What it reaches",
        items: [
          {
            label: "Chat servers",
            detail: "Mattermost and IRC",
            icon: "chat",
          },
          {
            label: "Machines",
            detail: "Over SSH, from the Runner",
            icon: "server",
          },
          {
            label: "Your tools",
            detail: "APIs on your network",
            icon: "code",
          },
        ],
      },
    },
    inside: {
      title: "Automation that reaches your own systems",
      lead: "Nothing here needs a service on the internet. The Runner is yours, and it runs where your systems are.",
      capabilities: [
        {
          key: "triggers",
          title: "Triggers",
          description:
            "A workflow runs when a record is created, updated or deleted, on a schedule, or when another system calls its URL.",
          icon: "bolt",
          link: { label: "Triggers", href: "/docs/workflows/triggers" },
        },
        {
          key: "chat",
          title: "Mattermost and IRC",
          description:
            "Post to a Mattermost channel through an incoming webhook, or to an IRC channel, on a server of your own.",
          icon: "chat",
          link: {
            label: "Mattermost",
            href: "/docs/workflows/components#mattermost",
          },
        },
        {
          key: "runner",
          title: "A Runner you host",
          description:
            "It only needs outbound HTTPS to your install, and does not accept any inbound connections.",
          icon: "terminal",
          link: { label: "Runners", href: "/docs/runbooks/agents" },
        },
        {
          key: "ssh",
          title: "SSH and Bash",
          description:
            "The Runner opens the connection, so a machine only has to be reachable from the Runner.",
          icon: "server",
          link: {
            label: "Authoring a runbook",
            href: "/docs/runbooks/authoring",
          },
        },
        {
          key: "http",
          title: "HTTP steps",
          description:
            "A runbook's HTTP steps reach private networks on a self-hosted install, unless you block them.",
          icon: "link",
          link: {
            label: "HTTP request",
            href: "/docs/runbooks/authoring#http-request",
          },
        },
        {
          key: "no-limits",
          title: "No run limits",
          description:
            "Self-hosted installations without billing have no limit on workflows or runs.",
          icon: "check",
          link: { label: "Workflows", href: "/docs/workflows/index" },
        },
      ],
    },
    changes: {
      title: "What changes behind the gap",
      lead: "One setting opens your network to workflows. The rest is choosing the step that stays inside it.",
      rows: [
        {
          key: "private-webhooks",
          name: "Workflow API, Mattermost and JavaScript requests",
          usually: "Private addresses refused",
          inside:
            "Set `webhooks.allowPrivateNetwork: true`, or name your hosts in `webhooks.privateNetworkAllowlist`.",
          status: "change-a-setting",
        },
        {
          key: "global-runner",
          name: "The global Runner",
          usually: "Reaches public internet addresses only",
          inside:
            "Run your own Runner on your network, from the image you mirrored, and bind steps to it.",
          status: "use-your-own",
        },
        {
          key: "javascript-steps",
          name: "Runbook JavaScript steps",
          usually: "Public HTTP APIs",
          inside:
            "A JavaScript step cannot reach a private address, even on your own Runner. Use a Bash step with `curl`.",
          status: "use-your-own",
        },
        {
          key: "cloud-chat-steps",
          name: "Slack, Microsoft Teams and Discord steps",
          usually: "Their cloud services",
          inside: "Use the Mattermost or IRC block on a server of your own.",
          status: "use-your-own",
        },
        {
          key: "email-trigger",
          name: "Incoming Email trigger",
          usually: "SendGrid, which has to connect to your install",
          inside:
            "Use the Webhook trigger, and let the other system call a URL.",
          status: "use-your-own",
        },
      ],
    },
    configure: {
      title: "Run a Runner on your network",
      lead: "A Runner holds its ID and key, and receives everything else with the job it claims.",
      steps: [
        {
          key: "create",
          title: "Create a Runner",
          description:
            "On the Runner's row, Show setup instructions gives you a command with its ID and key.",
        },
        {
          key: "run",
          title: "Run it inside your network",
          description:
            "On a host that can reach your install over HTTPS, and do what your steps need, such as reach other hosts over SSH.",
        },
        {
          key: "bind",
          title: "Bind steps to it",
          description:
            "Pick the Runner under a step's More fields, or make it the project's default.",
        },
      ],
      code: {
        label: "docker run",
        ariaLabel: "Run a Runner from your own registry",
        language: "bash",
        text: [
          "docker run --name oneuptime-runner --restart unless-stopped \\",
          "  -e ONEUPTIME_RUNNER_ID=<runner-id> \\",
          "  -e ONEUPTIME_RUNNER_KEY=<runner-key> \\",
          "  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \\",
          "  -d registry.example.com/oneuptime/runner:release",
        ].join("\n"),
        separator: "=",
      },
      caption:
        "The Runner asks your install for work every 5 seconds. Nothing has to reach it.",
      link: { label: "Runners", href: "/docs/runbooks/agents" },
    },
    installNote:
      "Workflows and runbooks come with the install. A Runner of your own runs the image you mirrored.",
    faqs: [
      {
        question: "Do workflows need the internet?",
        answer:
          "No. Workflows run on your install. A block reaches out only if you add one that does, and API, Mattermost and JavaScript blocks reach private addresses once you allow them.",
      },
      {
        question: "Can a runbook reach a machine on a private network?",
        answer:
          "Yes, from a Runner you host. A Bash, SSH or kubectl step runs on it, and the machine only has to be reachable from the Runner. A global Runner never reaches your network.",
      },
      {
        question: "Can a JavaScript step call an internal API?",
        answer:
          "No. A request to a private network is refused, even on your own Runner. Use a Bash step with `curl`.",
      },
      {
        question: "How do outside systems start a workflow?",
        answer:
          "With the Webhook trigger: another system on your network calls the workflow's URL. The Incoming Email trigger needs SendGrid to reach your install, so it does not work on a closed network.",
      },
    ],
    relatedSlugs: ["incident-management", "ai", "security-events"],
    product: {
      label: "See the Workflows product",
      href: "/product/workflows",
    },
    productPaths: ["/product/workflows", "/product/runbooks"],
  },
];

// Every page's address: Routes.ts registers each, and Utils/Sitemap.ts lists each.
export const AIR_GAPPED_TOPIC_PATHS: ReadonlyArray<string> =
  AirGappedTopicPages.map((page: AirGappedTopicPage): string => {
    return page.path;
  });

export const getAirGappedTopicPage: (
  slug: AirGappedTopicSlug,
) => AirGappedTopicPage = (slug: AirGappedTopicSlug): AirGappedTopicPage => {
  const page: AirGappedTopicPage | undefined = AirGappedTopicPages.find(
    (candidate: AirGappedTopicPage): boolean => {
      return candidate.slug === slug;
    },
  );

  if (!page) {
    throw new Error(`No air-gapped page for ${slug}`);
  }

  return page;
};

// The page at an address, or undefined: Routes.ts asks for a markdown variant.
export const getAirGappedTopicSlugForPath: (
  path: string,
) => AirGappedTopicSlug | undefined = (
  path: string,
): AirGappedTopicSlug | undefined => {
  return AirGappedTopicPages.find((page: AirGappedTopicPage): boolean => {
    return page.path === path;
  })?.slug;
};

const toCard: (page: AirGappedTopicPage) => AirGappedTopicCard = (
  page: AirGappedTopicPage,
): AirGappedTopicCard => {
  return {
    slug: page.slug,
    path: page.path,
    title: page.title,
    name: page.name,
    summary: page.summary,
    iconPath: AirGappedIcons[page.icon],
  };
};

export const getAirGappedTopicCard: (
  slug: AirGappedTopicSlug,
) => AirGappedTopicCard = (slug: AirGappedTopicSlug): AirGappedTopicCard => {
  return toCard(getAirGappedTopicPage(slug));
};

export const getAirGappedTopicCards: () => Array<AirGappedTopicCard> =
  (): Array<AirGappedTopicCard> => {
    return AirGappedTopicPages.map(toCard);
  };

/*
 * What a product page says it can do with no internet
 * (Views/Partials/enterprise-ready.ejs), by that page's address.
 */
export interface AirGappedProductLink {
  href: string;
  title: string;
}

export const getAirGappedProductLinks: () => Record<
  string,
  AirGappedProductLink
> = (): Record<string, AirGappedProductLink> => {
  const links: Record<string, AirGappedProductLink> = {};

  for (const page of AirGappedTopicPages) {
    for (const productPath of page.productPaths) {
      links[productPath] = { href: page.path, title: page.title };
    }
  }

  return links;
};
