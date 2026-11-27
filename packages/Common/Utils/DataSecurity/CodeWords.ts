/*
 * THE WORDS CODE WRITES ITS LOG LINES WITH (#11098).
 *
 * A telemetry leak's place carries the text its records hold - a log
 * line, an exception's message, a span's name, a page - as a template
 * (TelemetryLeakTemplate), every value a detector finds replaced by its
 * type's name. A word no detector names - a person's name, a free-text
 * value with no digit in it - is told from the code's own words only by
 * the records: of two records of one line of code read with different
 * words, the words that differ are values (alignTelemetryLeakTemplates,
 * #10367). One record, or records that all read alike, tell nothing: in
 * "Payment declined for Ada Lovelace" read once, "Ada Lovelace" is a word
 * of the code's as much as "Payment" is.
 *
 * So such a template keeps a word only when it is one code writes log
 * lines with: a word of this vocabulary - English's own small words, the
 * verbs and nouns log lines, messages and span names are made of, and
 * technology's names - read with its inflections ("declined", "retries",
 * "handler") and as the parts of an identifier ("PaymentService",
 * "user_id", "order.created"). Every other word is masked. It is no list
 * of names to take out, which could never be whole: a word is kept for
 * being known, never for being unknown.
 *
 * A person's name is written capitalized. So a capitalized word in the
 * middle of a sentence ("for Grace Brown") is kept only when it names a
 * technology (Stripe, Redis, PostgreSQL), however many records read it -
 * an aligned template too, where a name every record holds would read
 * as one of the code's words. And the vocabulary's words that are also
 * people's names (NAME_LIKE_WORDS: "will", "page", "price") are kept only
 * in lower case, or as part of an identifier with a word that is not.
 *
 * The vocabulary holds no person's name but those, and no word that says
 * something about a person - their health, beliefs, family or body:
 * CodeWords.test.ts reads it against a list of people's names in many
 * languages, and against the eval set's and OneUptime's own log lines.
 *
 * Pure, and in time in line with the word's length: a lookup, a few
 * suffixes taken off, and an identifier split once.
 */

// English's own small words: how any sentence is put together.
const FUNCTION_WORDS: string = [
  "a about above according across after afterwards again against ago ahead",
  "all almost alone along already also although always am among amongst an",
  "and another any anybody anymore anyone anything anyway anywhere apart are",
  "around as aside at away back be because become becomes been before",
  "beforehand behind being below beneath beside besides between beyond both",
  "but by can cannot could did do does doing done down during each either",
  "else elsewhere enough even ever every everybody everyone everything",
  "everywhere except few for former formerly from further furthermore had has",
  "have having he hence her here hereby herein hers herself him himself his how",
  "however i if in indeed inside instead into is it its itself just last",
  "latter least less let like likely many me meanwhile mine more moreover most",
  "mostly much must my myself namely neither never nevertheless next no nobody",
  "none nonetheless noone nor not nothing now nowhere of off often on once one",
  "ones only onto or other others otherwise ought our ours ourselves out",
  "outside over overall own per perhaps please quite rather same several shall",
  "she should since so some somebody somehow someone something sometime",
  "sometimes somewhat somewhere soon still such than that the their theirs them",
  "themselves then thence there thereafter thereby therefore therein thereupon",
  "these they this those though through throughout thru thus to together too",
  "toward towards under underneath unless unlike until unto up upon us very",
  "via was we well were what whatever when whence whenever where whereafter",
  "whereas whereby wherein whereupon wherever whether which whichever while",
  "whither who whoever whole whom whomever whose why will with within without",
  "would yet you your yours yourself yourselves",
  // Their contractions, read whole.
  "aren't can't couldn't didn't doesn't don't hadn't hasn't haven't he's i'd",
  "i'll i'm i've isn't it's let's mustn't needn't shan't she's shouldn't",
  "that's there's they'd they'll they're they've wasn't we'd we'll we're",
  "we've weren't what's where's who's won't wouldn't you'd you'll you're",
  "you've",
].join(" ");

/*
 * What code does, as its log lines say it: each in its base form - the
 * forms that end -s, -es, -ed, -ing, -er and -ers are read too
 * (inflectionsOf) - and the forms English makes otherwise.
 */
const ACTIONS: string = [
  "abort accept access acknowledge acquire act activate add adjust admit",
  "advance aggregate alert allocate allow alter analyse analyze anonymize",
  "answer append apply approve archive arrive ask assert assign attach attempt",
  "audit authenticate authorize autoscale back backfill backup ban batch begin",
  "bill bind block boot bootstrap bounce break broadcast browse buffer build",
  "bump bundle buy cache calculate call cancel capture change charge check",
  "checkout claim clean cleanup clear click clone close collapse collect",
  "combine come commit compact compare compile complain complete compress",
  "compute concatenate configure confirm connect consume contact contain",
  "continue convert copy correct count crash crawl create cut deactivate",
  "deallocate debit debug decide declare decline decode decommission",
  "decompress decrease decrement decrypt deduplicate default defer define",
  "degrade delay delete deliver deny deploy deprecate dequeue derive describe",
  "deserialize destroy detach detect diff disable disallow discard disconnect",
  "discover dismiss dispatch display dispose distribute divide download drain",
  "drop dump duplicate edit eject elevate email embed emit empty enable encode",
  "encrypt end enforce enqueue enrich enroll ensure enter enumerate error",
  "escalate escape estimate evaluate evict exceed exchange exclude execute",
  "exist exit expand expect expire explain export expose extend extract fail",
  "fall fetch fill filter finalize find finish fire fix flag flip flush",
  "follow force fork format forward free freeze fulfil fulfill gather generate",
  "get give go grant group guard halt handle hang hash have heal hide hit hold",
  "host identify idle ignore import include increase increment index infer",
  "inform ingest inherit init initialise initialize inject insert inspect",
  "install instantiate interrupt invalidate invite invoice invoke isolate",
  "issue iterate join keep kick kill land launch leak lease leave lend limit",
  "link list listen load locate lock log login logout look lookup loop lose",
  "make manage map mark mask match measure merge migrate mint mirror miss",
  "modify monitor mount move multiply mute name navigate need nest normalize",
  "notify observe obtain occur offer omit onboard open optimize order output",
  "overflow overload override overwrite own pack page paginate panic park",
  "parse pass patch pause pay perform permit persist pick ping pin place plan",
  "play poll pop populate post precompute prefetch prepare preserve press",
  "prevent print prioritize proceed process produce profile promote prompt",
  "propagate protect provide provision proxy prune publish pull purchase purge",
  "push put query queue quit raise rank rate reach read rebalance reboot",
  "rebuild recalculate receive recompute reconcile reconnect record recover",
  "recreate redact redeem redeploy redirect reduce refer refetch refresh",
  "refund refuse register reindex reject release reload remind remove rename",
  "render renew reopen reorder repair repeat replace replay replicate reply",
  "report request require reschedule reserve reset resize resolve respond",
  "restart restore restrict resume retain retire retrieve retry return reuse",
  "revert review revoke rewrite roll rollback rotate route run sample sanitize",
  "save scale scan schedule score scrape scrub search seed seek select sell",
  "send serialize serve set settle setup share ship shrink shut shutdown sign",
  "signin signout signup simulate size skip sleep slice snapshot sort spawn",
  "specify split spool stage stall start stash stop store stream strip submit",
  "subscribe succeed suggest summarize supply support suspend swap switch sync",
  "synchronize tag take tap terminate test throttle throw tick time timeout",
  "toggle tokenize touch trace track trade transcode transfer transform",
  "translate transmit trigger trim truncate trust try tune turn unarchive",
  "unassign unban unblock undo unhide uninstall unlink unload unlock unmount",
  "unmute unpack unpause unpin unpublish unregister unschedule unset",
  "unsubscribe unsuspend unwrap update upgrade upload upsert use validate",
  "verify view visit void wait wake walk want warm warn watch wipe withdraw",
  "work wrap write yield zip",
  // Forms English makes its own way.
  "found ate began begun bit blew blown bought bound bred brought built burnt caught",
  "chose chosen came dealt drew drawn drove driven fed fell felt flew flown",
  "forbade forbidden forgot forgotten froze frozen gave given got gotten gone",
  "grew grown had heard held hid hidden hung kept knew known laid led left",
  "lent lost made meant met paid ran rebuilt redone rerun resent rewritten",
  "rewrote said sat saw seen sent shook shot shown shrank shrunk slept slid",
  "sold sought spent spoke spoken spun stole stolen stood stuck swept swung",
  "taken taught thought threw thrown told took tore torn understood undid",
  "undone went withdrew woke woken won wore worn wound wrote written",
].join(" ");

// What code acts on: each in its base form, its plural read too.
const THINGS: string = [
  "access account acl action activity adapter address admin administrator",
  "agent aggregate alarm alert algorithm alias allocation allowance amount",
  "analysis analytics annotation answer app appliance application appointment",
  "approval archive area argument array article artifact asset assignment",
  "attachment attempt attribute audience audit auth authentication author",
  "authorization authority autoscaler avatar backend backlog backoff backup",
  "badge balance bandwidth bank banner barcode base baseline batch beacon",
  "benchmark beta bid billing bin binary binding bit blob block blog board",
  "body bonus booking bookmark boot bot bound boundary box branch breakpoint",
  "broker browser bucket budget buffer bug build bundle burst business button",
  "byte cache calendar call callback campaign cap capacity card cart catalog",
  "category cause cell certificate chain challenge change channel chapter",
  "character charge chart chat check checkbox checkout checkpoint checksum",
  "child chunk cipher claim class clause client clip clock cluster code codec",
  "collection collector column command comment commit company compiler",
  "component condition config configuration conflict connection connector",
  "consent console constraint consumer contact container content context",
  "contract control controller conversation cookie copy core cost count",
  "counter country coupon course credential credit criteria cron cursor",
  "customer cycle daemon dashboard data database dataset date day deadline",
  "deal debit debt decision default delay delivery delta demand dependency",
  "deployment deposit descriptor design destination detail detector device",
  "diagnostic dialog diff digest dimension directory discount disk dispatch",
  "display distribution doc document domain download draft driver duration",
  "edge editor effect element email embed emitter employee endpoint engine",
  "entity entry environment epoch error escalation estimate event evidence",
  "example exception exchange executor exit expiration expiry export",
  "expression extension factor factory failure fault feature fee feed",
  "feedback field file filter fingerprint firewall firmware flag fleet flow",
  "folder font footer form format formula frame framework frequency function",
  "fund gateway generation generator gift goal grade graph grid group guard",
  "guest guide handle handler handshake hash header heap heartbeat height help",
  "hint history hit hook host hostname hour id identifier identity image",
  "impact implementation import incident index info information",
  "infrastructure input insight instance instruction integration intent",
  "interface interval invitation invite invoice issue item iteration job",
  "journal key keyword kind label lag language latency layer layout lead",
  "lease ledger length level library license lifecycle limit line link list",
  "listener literal load loan locale location lock log logger login logo",
  "lookup loop machine mail mailbox maintenance manager manifest map mapping",
  "margin market mask master match matrix maximum media member membership",
  "memory menu merchant message meta metadata meter method metric middleware",
  "migration milestone minimum minute mirror mode model module moment monitor",
  "month mount namespace network node note notice notification number object",
  "offer offset onboarding operation operator option order organization",
  "origin outage outcome output overflow owner package packet page pair panel",
  "parameter parent parser part partition partner password patch path pattern",
  "payload payment payout peer percent percentage period permission phase",
  "phone photo pin pipeline pixel placeholder plan platform player plugin pod",
  "point policy poll pool popup port portal position post preference prefix",
  "premium preview price pricing principal priority privacy probe problem",
  "procedure process processor product profile program progress project",
  "promise promo promotion prompt property protocol provider proxy publisher",
  "purchase purpose push quantity query question queue quota quote range rank",
  "rate ratio reaction reader reason receipt receiver recipient record",
  "redirect reference referral refund region registration registry relation",
  "relationship release reminder replica replication reply report repository",
  "request requirement reservation reset resolution resolver resource",
  "response restriction result retention retry revenue review revision",
  "reward role room root route router row rule run runtime sale sample sandbox",
  "scale schedule schema scope score screen script search second secret",
  "section sector security segment selector seller sender sensor sequence",
  "series server service session setting setup shard share shell shift",
  "shipment shipping shop shortcut signal signature site size skill slot",
  "snapshot socket software solution source space span spec speed spike",
  "sponsor spreadsheet stack stage standard state statement station statistic",
  "status step stock storage store story stream string style subject",
  "submission subscriber subscription subtotal suffix suggestion suite summary",
  "supplier supply support survey switch symbol sync syntax system tab table",
  "tag target task tax team template tenant term terminal test text theme",
  "thread threshold ticket tier time timeline timer timestamp timezone tip",
  "title token tool topic total trace track tracker trade traffic transaction",
  "transcript transfer transport trial trigger trip tunnel type unit update",
  "upgrade upload uptime usage user username value variable variant vault",
  "vendor version video view violation visit visitor volume voucher wallet",
  "warehouse warning watcher web webhook website week weight widget width",
  "window wizard word work worker workflow workload workspace year zone",
  // Words of code joined into one, as code writes them.
  "accountid apikey appid authtoken backend checkout clientid codebase",
  "dataset datetime deviceid downstream email endpoint eventloop filename",
  "filepath filesystem frontend healthcheck hostname keyspace lifecycle",
  "linenumber login logout metadata middleware namespace orderid passcode",
  "passkey password pathname payload projectid requestid runtime sessionid",
  "spanid statuscode subdomain tenantid timestamp traceid upstream userid",
  "username userinfo uuid webhook whitelist blacklist allowlist denylist",
].join(" ");

// How things are: each as it is written, and its -ly form read too.
const STATES: string = [
  "abnormal absent active actual additional alive allowed alternate",
  "anonymous applicable approved archived assigned async asynchronous",
  "attached automatic available average bad banned basic beta big binary",
  "blank blocked boolean broken busy canceled cancelled certain cheap clean",
  "clear closed cold common compatible complete completed compressed",
  "concurrent confidential confirmed conflicting connected consistent",
  "constant corrupt corrupted critical current custom daily dead deep default",
  "degraded delayed deleted dependent deprecated detached different digital",
  "direct dirty disabled disconnected done double draft dry duplicate dynamic",
  "early easy effective elevated empty enabled encrypted entire equal",
  "essential exact excessive exclusive existing expected expensive",
  "experimental expired explicit external extra failed fake false fast fatal",
  "final fine finished first fixed flaky flat foreign formal fresh frozen full",
  "future generic global good graceful green handled hard healthy heavy hidden",
  "high hot huge idle illegal immediate inactive incoming incomplete incorrect",
  "independent individual initial inner insecure insufficient intermediate",
  "internal invalid known large last late latest legacy legal limited linear",
  "live local locked logical long loose lost low main major malformed manual",
  "mandatory matching max maximum medium min minimal minimum minor missing",
  "mixed mobile modern monthly multiple mutable native negative nested new",
  "next nominal normal null numeric offline old online open optional orange",
  "ordinary orphan outbound outdated outer outgoing overdue paid parallel",
  "partial passive past paused pending permanent persistent personal physical",
  "plain popular positive possible premium present previous primary prior",
  "private processed production proper protected public quick random raw",
  "readonly ready real recent recoverable recurring red redundant regular",
  "rejected related relative reliable remote removed repeated required",
  "reserved resolved restricted retryable reverse running safe same scheduled",
  "secondary secure selected sensitive separate sequential serial short silent",
  "similar simple single slow small soft sorted special specific stable stale",
  "standard static sticky stopped strict strong subsequent successful",
  "sufficient suspended suspicious synchronous temporary throttled timed total",
  "transient trusted unable unauthenticated unauthorized unavailable",
  "unchanged undefined unexpected unhandled unhealthy unique unknown unlimited",
  "unpaid unread unreachable unresolved unsafe unsupported unused unusual",
  "unverified upcoming upper urgent usable used valid verbose verified",
  "virtual visible warm weak weekly wrong yearly yellow zero",
  // What a sentence says of them.
  "already anew completely correctly currently directly eventually exactly",
  "fully immediately incorrectly instantly manually newly nearly only",
  "partially possibly previously properly quickly really recently",
  "repeatedly safely slowly successfully temporarily unexpectedly",
  "unsuccessfully",
].join(" ");

// Time, size and how many.
const MEASURES: string = [
  "ms millisecond microsecond nanosecond sec secs second minute min mins hour",
  "hr hrs day week month year today tomorrow yesterday tonight now later",
  "earlier soon morning afternoon evening night weekend daily hourly weekly",
  "monthly annual annually kb kib mb mib gb gib tb tib pb byte kilobyte",
  "megabyte gigabyte bps kbps mbps gbps pct rpm rps qps tps hz khz mhz ghz utc",
  "gmt am pm monday tuesday wednesday thursday friday saturday sunday january",
  "february march april may june july august september october november",
  "december first second third fourth fifth sixth seventh eighth ninth tenth",
  "zero one two three four five six seven eight nine ten eleven twelve",
  "twenty thirty forty fifty hundred thousand million billion half double",
  "triple single once twice",
].join(" ");

/*
 * More of what services say in their log lines: the words of a shop, a
 * sign-in, a queue, a database, a file, a message, an incident - each in
 * its base form, read inflected as the others are.
 */
const SOFTWARE_WORDS: string = [
  "able absolute accessible accidental accumulate accuracy accurate",
  "ack acked adaptive addition adjustment admission advanced advice affect",
  "affected agree aggregation alarm allowlist alpha alright alternative",
  "ambiguous amend anomaly announce announcement anonymous anticipate",
  "apparent appear appearance appropriate approximate arbitrary arrival",
  "aspect assume asterisk attention authenticity authoritative autocomplete",
  "autoscaling availability avoid aware awaiting backward balancer bare",
  "barrier bearer behaviour behavior belong benefit best better bidirectional",
  "blocker boolean bootstrapper bottleneck bounce boundaries brand breach",
  "breaker brief broken buffered bulk burn bypass calculation calendar cap",
  "capability card carrier cascade case cast catch caught cent cert certs",
  "chained characteristic charset checklist choice choose circuit circular",
  "cleaner cleanup clientside clock coalesce cold collision combination",
  "comma common compact comparison compatibility compensation competing",
  "complex compliance comply composite compose comprehensive computation",
  "concern concurrency confidence confirmation conjunction consecutive",
  "consensus consequence consistency constraint construct consult contention",
  "contributor conversion cooldown coordinate coordinator correlation",
  "corruption counterpart coverage crash creation credentials crypto cyclic",
  "dangling db dbs deadlock dealer debounce decimal declaration decrement",
  "dedupe deep defect deferred deficit definition degradation del delimiter",
  "demo denial dependency depth descendant description deserialization",
  "detection deterministic difference digit dimension nonexistent",
  "disaster discrepancy discovery dispute distinct distributed downgrade",
  "downtime draw drift dropdown dup duplex durable eager efficient elapsed",
  "eligible eligibility embedded emergency encounter encryption enrollment",
  "enterprise envelope ephemeral erasure escrow evaluation eviction exact",
  "exhaust exhausted executable execution exist existence exit expectation",
  "expensive explanation exponential expression extensible factor fallback",
  "false far fatal favorite feasible fence fetcher filler fixture flakiness",
  "flight fluent footprint forbid forbidden forcibly forecast forget fraction",
  "fragment fraud frontend fulfillment funnel gap garbage gauge great greater",
  "guarantee guardrail half handoff happen hard hardware head health helper",
  "hierarchy histogram home hop horizontal hotfix hourly human hybrid",
  "idempotency idempotent identical implement implicit impossible improve",
  "inbound inconsistent incremental indicator inference infinite ingestion",
  "inline insight inspection install instance integrity intel interaction",
  "interactive interrupted interval introspection intrusion inventory",
  "investigation irregular irrelevant isolation item jitter jump keepalive",
  "kernel kill kind knowledge latest leader leak learn leftover legitimate",
  "lightweight liveness localhost locator lockout longest lookahead loss",
  "lower magic malicious malware manifest manipulation marketplace",
  "materialize maximal measurement mechanism mention merger mesh mid middle",
  "migrate milestone mirror misc mismatch mitigation modal modification",
  "moderate modular monotonic multipart multiplier mutation nack native",
  "near necessary negotiation net neutral nonce noop normalize notable",
  "novel nullable objective obsolete occurrence odd offline ongoing opaque",
  "operational opportunity opt optimistic optimization ordinal origin",
  "orphaned outlier overflow overhead overview pagination pair paste peak",
  "penalty percentile perimeter permission persistence person pessimistic",
  "phishing pinned playbook plural poison policy portable precision",
  "predicate prediction preferred prefetch premium preprocess prerequisite",
  "presence prevention primitive principle privilege proactive probability",
  "procedure proceed proposal prototype provenance proximity pseudo purge",
  "qualifier quarantine quick quorum race rack radius ranking rare raw",
  "reachable readiness realtime reauthentication rebuild recipe reclaim",
  "recommendation reconciliation recovery recursion recursive redundancy",
  "refresh refusal regression reject rejection relay relevant reliability",
  "remainder remediation remember repeatable replacement representation",
  "reproduce reputation reseller residual resilience resilient resolve",
  "responder responsive restart retention reusable risk robust rollout",
  "rollup rotation round rounding runbook runner safeguard sanity saturation",
  "say scalable scarce scenario schedule scheduler scrubbing seamless",
  "seasonal secondary self semantic sensible sensitivity sentinel serverless",
  "severity shadow shed shortage sibling sidecar silence simulation singular",
  "skew sla slo slug smoke snooze solve sound sparse spillover stack stale",
  "star stars startup stat stateful stateless stats steady sticky",
  "storm strategy stress structure stub success suffix suitable",
  "superseded supported surge suspicious sustained sweep swarm synthetic",
  "tail tamper teardown technical telemetry tell temporal tenancy testing",
  "threat throughput thumbnail tolerance toolbox top topology total",
  "traceroute transactional transient transparent trap treatment triage",
  "trivial truncation tunnel twofold unattended unbounded underlying",
  "unicast unit universal unmatched unsent unterminated upfront upkeep",
  "usability utility utilization validation validity vanish variance",
  "verification vertical viable violation visibility vital vulnerability",
  "vulnerable warmup watchlist weekly welcome whatever wildcard workaround",
  "wraparound yet",
  // A shop's, a bank's and a bill's.
  "acquirer authorization basket bill billing chargeback checkout cashback",
  "currency customer declined discount dispute fulfil installment invoice",
  "issuer ledger loyalty merchant order paid payer payment payout pos",
  "prepaid purchase receipt refund remittance renewal reorder retail",
  "settlement shipping sku statement stock store subscription subtotal",
  "surcharge tax tip transaction transfer trial vat voucher wallet",
  // The words a person's own things are named by in code, never their values.
  "address avatar birthday city country email firstname fullname gender",
  "lastname locale nickname phone postcode profile region street surname",
  "timezone title zip zipcode",
  // What libraries' own log lines are made of.
  "assistant completion constructor cmd decorator direction discriminator",
  "due embedding establish exclusion fractional glob greeting inference",
  "instrument instrumentation interceptor iterable junction math mock msg",
  "normalization orm propagator retrieval scalar scheme see serializable",
  "side str sure tree vector verbatim",
  // English's own odd forms of a word.
  "goes went gone ids pids uids know hand explode episode cloud markdown",
  "stringify screenshot observability parentheses non auto ops req",
].join(" ");

// Technology's words: protocols, formats, languages, and what code is written in.
const TECHNOLOGY: string = [
  "api apis sdk cli gui ui ux url urls uri urn http https http2 http3 grpc",
  "rest restful graphql soap websocket websockets tcp udp ip ipv4 ipv6 icmp",
  "dns dhcp ntp tls ssl ssh sftp ftp smtp imap mime json jsonl ndjson xml",
  "yaml yml toml csv tsv html css js ts jsx tsx mjs cjs sql nosql pdf png jpg",
  "jpeg gif svg webp ico mp4 mp3 wav zip gzip tar tgz base64 base32 utf utf8",
  "utf16 ascii unicode hex uuid guid ulid jwt jws jwe jwk jwks oauth oauth2",
  "oidc saml sso ldap mfa otp totp hotp rsa ecdsa aes sha sha1 sha256 sha512",
  "md5 hmac pem der x509 csr crl ocsp cors csrf xss waf cdn vpn nat lan wan",
  "vlan cpu gpu ram ssd hdd io os vm vms vps k8s dev prod staging qa uat ci",
  "cd src lib dist bin tmp etc usr",
  // What a database is asked in.
  "select insert upsert from where join inner outer cross having asc desc",
  "distinct union intersect returning savepoint truncate alter",
  // What code is written in.
  "nil nan infinity true false yes ok okay void struct enum tuple dict",
  "dictionary bool int integer float decimal bigint char regex regexp typeof",
  "instanceof func fn lambda closure async await coroutine goroutine mutex",
  "semaphore atomic volatile const var getter setter param params arg args",
  "argv env stdin stdout stderr errno sigterm sigint sigkill sighup segfault",
  "assertion stacktrace traceback iterator",
  // What a socket answers when it cannot.
  "econnrefused econnreset econnaborted etimedout esockettimedout enotfound",
  "eaddrinuse eaddrnotavail epipe enoent eacces eperm emfile enfile",
  "ehostunreach enetunreach enetdown eexist eisdir enotdir enotempty einval",
  "enomem eagain ewouldblock eproto ecanceled eai etimeout eservfail",
  "getaddrinfo nosuchname",
  // What a log says it is.
  "trace debug info notice warn warning err error crit critical fatal panic",
  "emerg alert ok fail failure success",
  // OneUptime's own marks, left where a value was.
  "redacted hashed masked scrubbed",
].join(" ");

/*
 * The names of technology - platforms, products, the services code talks
 * to - none of them a person's: kept capitalized anywhere, "Calling
 * Stripe", "Connected to Redis", "PostgreSQL".
 */
const PRODUCTS: string = [
  "kubernetes kubectl helm docker podman containerd nginx haproxy envoy istio",
  "linux unix macos ios android chrome chromium firefox safari node nodejs",
  "deno npm yarn pnpm python pip java jvm kotlin scala golang php dotnet",
  "csharp typescript javascript elixir erlang haskell react vue angular",
  "svelte nextjs nuxt express fastify koa nestjs django flask fastapi rails",
  "laravel symfony spring hibernate aspnet aws gcp azure s3 sqs sns ses ec2",
  "ecs eks fargate rds lambda dynamodb kinesis cloudwatch cloudfront route53",
  "iam kms sts vpc elb alb nlb bigquery pubsub gcs firestore firebase",
  "cosmosdb postgres postgresql pg mysql mariadb sqlite mongodb mongo redis",
  "valkey memcached cassandra scylla clickhouse elasticsearch opensearch solr",
  "kafka",
  "rabbitmq amqp nats mqtt zeromq zookeeper etcd consul terraform ansible",
  "pulumi stripe paypal braintree adyen klarna twilio sendgrid mailgun",
  "mailchimp slack discord teams zoom github gitlab bitbucket jira confluence",
  "notion trello okta auth0 cognito keycloak google microsoft amazon facebook",
  "twitter linkedin whatsapp telegram cloudflare akamai fastly vercel netlify",
  "heroku digitalocean linode openai anthropic gpt chatgpt llm llms ai ml",
  "huggingface ollama sentry datadog newrelic splunk grafana prometheus loki",
  "zipkin opentelemetry otel otlp oneuptime pagerduty opsgenie webpack vite",
  "babel eslint jest mocha cypress playwright puppeteer selenium axios lodash",
  "prisma typeorm sequelize knex mongoose oracle mssql odbc jdbc snmp syslog",
  "cron systemd wasm webassembly proxmox vmware vcenter openstack ceph",
  "mattermost expo git rpc sms iso iot cname dnssec scim irc mcp",
].join(" ");

/*
 * The vocabulary's words that are also people's names, given or family -
 * and the inflections of its words that are ("Banks", "Walker", "Weber"):
 * kept only in lower case ("will retry", "next page"), or as a part of an
 * identifier beside a word that is none ("getPrice", "willRetry"). Never
 * capitalized, nor in capitals, nor as an identifier of their own: "Will",
 * "PAGE", "bill_price". CodeWords.test.ts reads every name of its list
 * against the vocabulary, so a name the vocabulary would keep is listed
 * here or fails it.
 */
export const NAME_LIKE_WORDS: ReadonlySet<string> = new Set<string>(
  [
    "april august banks bill carter cassandra dev fields fuller green grant",
    "harding holder hooker hopper hung june lan lander lister long mark",
    "masters max may mayer min packer page park parker ping porter price ram",
    "sellers short turner walker weber webber will",
  ]
    .join(" ")
    .split(" "),
);

/*
 * Of NAME_LIKE_WORDS, those code writes in capitals as an acronym or a
 * command: kept so, "RAM", "MAX", "PING". Capitalized they are names
 * ("Ram", "Max", "Ping").
 */
export const NAME_LIKE_ACRONYMS: ReadonlySet<string> = new Set<string>([
  "dev",
  "lan",
  "max",
  "min",
  "ping",
  "ram",
]);

function wordsOf(...lists: Array<string>): Set<string> {
  const words: Set<string> = new Set<string>();

  for (const list of lists) {
    for (const word of list.split(" ")) {
      if (word) {
        words.add(word);
      }
    }
  }

  return words;
}

export const CODE_VOCABULARY: ReadonlySet<string> = wordsOf(
  FUNCTION_WORDS,
  ACTIONS,
  THINGS,
  STATES,
  MEASURES,
  SOFTWARE_WORDS,
  TECHNOLOGY,
  PRODUCTS,
);

/*
 * The words read inflected: what code does and acts on, and how things
 * are - never English's small words ("Anders" is no "and"), and a
 * technology's word only of four letters or more ("Nils" is no "nil").
 */
const INFLECTED_WORDS: ReadonlySet<string> = wordsOf(
  ACTIONS,
  THINGS,
  STATES,
  MEASURES,
  SOFTWARE_WORDS,
);
const INFLECTED_TECHNOLOGY: ReadonlySet<string> = new Set<string>(
  Array.from(wordsOf(TECHNOLOGY, PRODUCTS)).filter((word: string): boolean => {
    return word.length >= 4;
  }),
);

/*
 * The prefixes a word of the vocabulary is read under ("unmatched",
 * "resend", "nonexistent", "autoresolve"), each before a word of four
 * letters at least - never "in", "im" or "co", which begin people's names
 * as often as words ("Ingrid", "Colin").
 */
const PREFIXES: ReadonlyArray<string> = [
  "auto",
  "cross",
  "de",
  "dis",
  "inter",
  "mis",
  "multi",
  "non",
  "out",
  "over",
  "post",
  "pre",
  "re",
  "self",
  "semi",
  "sub",
  "super",
  "un",
  "under",
];

// The shortest word a prefix is read before.
const MIN_PREFIXED_LENGTH: number = 4;

// The names of technology: kept capitalized anywhere.
export const TECHNOLOGY_NAMES: ReadonlySet<string> = wordsOf(PRODUCTS);

// The shortest stem an ending is taken off down to: "used" is "use", "red" no "r".
const MIN_STEM_LENGTH: number = 3;

/*
 * The base forms a word could be an inflection of: "retries" of "retry",
 * "declined" of "decline", "stopped" of "stop", "handlers" of "handle",
 * "successfully" of "successful". Each only when what is left is long
 * enough to be a word.
 */
export function inflectionsOf(lower: string): Array<string> {
  const stems: Array<string> = [];

  const add: (stem: string) => void = (stem: string): void => {
    if (stem.length >= MIN_STEM_LENGTH) {
      stems.push(stem);
    }
  };

  // stopp -> stop, committ -> commit.
  const undouble: (stem: string) => void = (stem: string): void => {
    const length: number = stem.length;

    if (
      length >= MIN_STEM_LENGTH + 1 &&
      stem[length - 1] === stem[length - 2]
    ) {
      add(stem.slice(0, -1));
    }
  };

  if (lower.endsWith("ies")) {
    add(`${lower.slice(0, -3)}y`);
  }

  if (lower.endsWith("es")) {
    add(lower.slice(0, -2));
  }

  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    add(lower.slice(0, -1));
  }

  if (lower.endsWith("ied")) {
    add(`${lower.slice(0, -3)}y`);
  }

  if (lower.endsWith("ed")) {
    const stem: string = lower.slice(0, -2);

    add(stem);
    add(lower.slice(0, -1));
    undouble(stem);
  }

  if (lower.endsWith("ing")) {
    const stem: string = lower.slice(0, -3);

    add(stem);
    add(`${stem}e`);
    undouble(stem);
  }

  if (lower.endsWith("ers")) {
    add(lower.slice(0, -3));
    add(lower.slice(0, -2));
    undouble(lower.slice(0, -3));
  } else if (lower.endsWith("er")) {
    add(lower.slice(0, -2));
    add(lower.slice(0, -1));
    undouble(lower.slice(0, -2));
  }

  if (lower.endsWith("ly")) {
    add(lower.slice(0, -2));
  }

  return stems;
}

// Whether a lower-case word is a word code acts with or on, as written or inflected.
function isInflectedContentWord(lower: string): boolean {
  if (INFLECTED_WORDS.has(lower) || INFLECTED_TECHNOLOGY.has(lower)) {
    return true;
  }

  for (const stem of inflectionsOf(lower)) {
    if (INFLECTED_WORDS.has(stem) || INFLECTED_TECHNOLOGY.has(stem)) {
      return true;
    }
  }

  return false;
}

/*
 * What the inflections and prefixes would make of the vocabulary's words
 * that says something of a person's body or health - "depressed" of
 * "press", "overweight" of "weight", "disorder" of "order" - never kept
 * however it is made.
 */
const NEVER_KEPT: ReadonlySet<string> = new Set<string>([
  "depressed",
  "depressing",
  "disabilities",
  "disability",
  "disorder",
  "disorders",
  "overweight",
  "underweight",
  "unwell",
]);

/*
 * Whether a lower-case word is the vocabulary's: as written, inflected, or
 * a word code acts with or on under one of PREFIXES.
 */
export function isVocabularyWord(lower: string): boolean {
  if (NEVER_KEPT.has(lower)) {
    return false;
  }

  if (CODE_VOCABULARY.has(lower) || isInflectedContentWord(lower)) {
    return true;
  }

  for (const prefix of PREFIXES) {
    if (
      lower.length >= prefix.length + MIN_PREFIXED_LENGTH &&
      lower.startsWith(prefix) &&
      isInflectedContentWord(lower.slice(prefix.length))
    ) {
      return true;
    }
  }

  return false;
}

/*
 * Whether a lower-case word is a person's name the vocabulary would keep:
 * one of NAME_LIKE_WORDS, or its -s or -er form ("Wills", "Parker").
 */
export function isNameLike(lower: string): boolean {
  if (NAME_LIKE_WORDS.has(lower)) {
    return true;
  }

  if (CODE_VOCABULARY.has(lower)) {
    return false;
  }

  const stems: Array<string> = [];

  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    stems.push(lower.slice(0, -1));
  }

  if (lower.endsWith("er")) {
    stems.push(lower.slice(0, -2), lower.slice(0, -1));
  }

  return stems.some((stem: string): boolean => {
    return NAME_LIKE_WORDS.has(stem);
  });
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isUpper(code: number): boolean {
  return code >= 65 && code <= 90;
}

// How a word is written: what tells a name from code's words.
enum Casing {
  Lower = "Lower",
  Upper = "Upper",
  // Its first letter alone: "Payment", "Grace".
  Capitalized = "Capitalized",
  // Anything else: "GitHub", "iOS", "McDonald".
  Mixed = "Mixed",
}

function casingOf(part: string): Casing {
  let letters: number = 0;
  let uppers: number = 0;

  for (let index: number = 0; index < part.length; index++) {
    const code: number = part.charCodeAt(index);

    if (isAsciiLetter(code)) {
      letters++;

      if (isUpper(code)) {
        uppers++;
      }
    }
  }

  if (uppers === 0) {
    return Casing.Lower;
  }

  if (uppers === letters) {
    return Casing.Upper;
  }

  return uppers === 1 && isUpper(part.charCodeAt(0))
    ? Casing.Capitalized
    : Casing.Mixed;
}

/*
 * A word's letters in the runs an identifier is written in: at its
 * separators (_ - . : / '), between letters and digits, and where its
 * case turns ("processPayment", "XMLHttpRequest", "user_id"). Digits are
 * left out: a number is no word to judge.
 */
export function identifierParts(word: string): Array<string> {
  const parts: Array<string> = [];
  let start: number = -1;

  const end: (at: number) => void = (at: number): void => {
    if (start >= 0 && at > start) {
      parts.push(word.slice(start, at));
    }

    start = -1;
  };

  for (let index: number = 0; index < word.length; index++) {
    const code: number = word.charCodeAt(index);

    if (!isAsciiLetter(code)) {
      end(index);
      continue;
    }

    if (start < 0) {
      start = index;
      continue;
    }

    const previous: number = word.charCodeAt(index - 1);
    const next: number =
      index + 1 < word.length ? word.charCodeAt(index + 1) : 0;

    if (
      isUpper(code) &&
      (!isUpper(previous) ||
        // UPPER then Upper-lower: XMLHttp's "H".
        (isAsciiLetter(next) && !isUpper(next)))
    ) {
      end(index);
      start = index;
    }
  }

  end(word.length);

  return parts;
}

// Whether a word holds a character beyond ASCII: no word of the vocabulary does.
function hasCharacterBeyondAscii(word: string): boolean {
  for (let index: number = 0; index < word.length; index++) {
    if (word.charCodeAt(index) > 0x7f) {
      return true;
    }
  }

  return false;
}

export interface WordPlace {
  /*
   * The word starts a sentence: the text's first, or after a full stop, a
   * colon, a closing bracket, an "=" - where code capitalizes its own
   * words.
   */
  atSentenceStart: boolean;
}

/*
 * Whether a word of the vocabulary is written as code writes it: in lower
 * case; in capitals, or capitalized where a sentence starts or inside an
 * identifier, unless it is also a person's name; or, a technology's name,
 * however it is capitalized. `isWhole`: the word is all of what the
 * template holds there, not one part of an identifier.
 */
function isWrittenAsCodeWritesIt(
  word: string,
  lower: string,
  place: WordPlace,
  isWhole: boolean,
): boolean {
  const casing: Casing = casingOf(word);

  if (casing === Casing.Lower) {
    return true;
  }

  if (isNameLike(lower)) {
    return casing === Casing.Upper && NAME_LIKE_ACRONYMS.has(lower);
  }

  if (TECHNOLOGY_NAMES.has(lower)) {
    return true;
  }

  switch (casing) {
    case Casing.Upper:
      return true;
    case Casing.Capitalized:
      return place.atSentenceStart || !isWhole;
    default:
      return false;
  }
}

/*
 * Whether a whole word, as a template holds it, is one code writes: every
 * word of it the vocabulary's, written as code writes it
 * (isWrittenAsCodeWritesIt) - never capitalized in the middle of a
 * sentence unless it names a technology. Of an identifier
 * ("PaymentService", "user_id", "XMLHttpRequest"), each part the
 * vocabulary's, in any case, and one of them no person's name. A single
 * letter is kept: it names no one. A word beyond ASCII is no word of the
 * vocabulary's.
 */
export function isCodeWord(word: string, place: WordPlace): boolean {
  if (!word || hasCharacterBeyondAscii(word)) {
    return false;
  }

  const lower: string = word.toLowerCase();

  /*
   * A contraction, or a word written whole: "don't", "PostgreSQL",
   * "signup". One whose case turns inside it, and no technology's name
   * ("userId"), is read as the identifier it is, below.
   */
  if (
    lower.length > 1 &&
    CODE_VOCABULARY.has(lower) &&
    (casingOf(word) !== Casing.Mixed || TECHNOLOGY_NAMES.has(lower))
  ) {
    return isWrittenAsCodeWritesIt(word, lower, place, true);
  }

  const parts: Array<string> = identifierParts(word);

  if (parts.length === 0) {
    // Digits and separators alone: no word to judge.
    return true;
  }

  if (parts.length === 1) {
    const part: string = parts[0]!;

    if (part.length === 1) {
      return true;
    }

    const partLower: string = part.toLowerCase();

    return (
      isVocabularyWord(partLower) &&
      isWrittenAsCodeWritesIt(
        part,
        partLower,
        place,
        part.length === word.length,
      )
    );
  }

  // An identifier: every part a word of the vocabulary's, one of them no name.
  let hasPlainWord: boolean = false;

  for (const part of parts) {
    if (part.length === 1) {
      continue;
    }

    const partLower: string = part.toLowerCase();

    if (!isVocabularyWord(partLower)) {
      return false;
    }

    if (!isNameLike(partLower)) {
      hasPlainWord = true;
    }
  }

  // "bill_price", "Grant-Page": names, however they are joined.
  return (
    hasPlainWord ||
    parts.every((part: string): boolean => {
      return part.length === 1;
    })
  );
}

// What a name never holds: a digit, an "_".
const DIGIT_OR_UNDERSCORE: RegExp = /[0-9_]/;

// A lower-case letter before a capital: an identifier's turn of case.
const TURN_OF_CASE: RegExp = /[a-z][A-Z]/;

/*
 * Whether a word is written as a person's name is: its first letter a
 * capital and its others not, in the middle of a sentence, and no
 * technology's name - "for Grace Brown", "for José", "for O'Brien". An
 * identifier ("PaymentService"), a word in capitals, and one with a digit
 * or an "_" in it are code's.
 */
export function isWrittenAsName(word: string, place: WordPlace): boolean {
  if (!word || place.atSentenceStart || DIGIT_OR_UNDERSCORE.test(word)) {
    return false;
  }

  const first: string = word[0]!;

  // A capital letter, of any script.
  if (first === first.toLowerCase() || word === word.toUpperCase()) {
    return false;
  }

  // processPayment's turn of case: an identifier, not a name.
  if (TURN_OF_CASE.test(word)) {
    return false;
  }

  const lower: string = word.toLowerCase();
  const firstPart: string = identifierParts(word)[0] || "";

  return (
    !TECHNOLOGY_NAMES.has(lower) &&
    !TECHNOLOGY_NAMES.has(firstPart.toLowerCase())
  );
}
