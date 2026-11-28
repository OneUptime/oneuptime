import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 یا جدیدتر، متصل به استخرهایی که می‌خواهید پایش کنید. افزونه OpenMetrics آن روی XOA به مجوز Premium نیاز دارد؛ Xen Orchestra ساخته‌شده از کد منبع آن را دارد",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 یا جدیدتر با افزونه Docker Compose v2، روی ماشینی که از طریق HTTPS به Xen Orchestra دسترسی داشته باشد",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "گواهی‌ای روی Xen Orchestra که نشانی‌ای را که عامل به آن وصل می‌شود نام ببرد. گواهی خودامضایی که Xen Orchestra برای خودش می‌سازد هیچ نامی ندارد، پس هیچ کلاینت TLS امروزی نمی‌تواند آن را بررسی کند — **گواهی Xen Orchestra** را در پیشرفته ببینید",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. در Xen Orchestra، *Settings → Plugins* را باز کنید و **openmetrics** را پیدا کنید.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. آن را روشن کنید. بار اولی که راه می‌افتد، یک راز می‌سازد و نگه می‌دارد، و Xen Orchestra آن را پس از راه‌اندازی‌های دوباره هم نگه می‌دارد.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. تنظیمات افزونه را باز کنید و **Prometheus secret** آن را کپی کنید — آن را در مرحله بعد به عامل می‌دهید. همچنین می‌توانید رازی از خودتان آن‌جا بنویسید و ذخیره کنید.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "افزونه روی نشانی و با گواهی خود Xen Orchestra، در `/openmetrics/metrics` پاسخ می‌دهد، و فقط به درخواستی که راز آن را همراه داشته باشد. هر استخری را که Xen Orchestra به آن متصل است ارائه می‌کند، پس یک عامل همه را پوشش می‌دهد.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "اسکریپت نشانی OneUptime و کلید دریافت داده شما را می‌پرسد که هر دو در مرحله 1 نشان داده می‌شوند (یک کلید را آن‌جا انتخاب کنید تا این‌جا پر شوند)، و سپس این‌ها را:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **نشانی Xen Orchestra** — همان‌طور که آن را در مرورگر باز می‌کنید، مثلاً `https://xo.example.com` یا `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **راز افزونه OpenMetrics** — از مرحله قبل. هنگام تایپ نمایش داده نمی‌شود.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **نام این Xen Orchestra** — نامی که هر یک از استخرهایش در تنظیماتش نشان می‌دهد. برای استفاده از نشانی آن، Enter را بزنید.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "سپس اسکریپت گواهی Xen Orchestra را می‌خواند. اگر این ماشین از قبل به آن اعتماد دارد، عامل به همان بسته CA اعتماد می‌کند. اگر ندارد، اسکریپت اثر انگشت SHA-256 گواهی را نشان می‌دهد: آن را با اثر انگشت روی ماشین Xen Orchestra مقایسه کنید و برای اعتماد به همان گواهی و نه هیچ چیز دیگر، **y** را پاسخ دهید. هرگز بررسی را خاموش نمی‌کند. پیش از نصب هر چیزی، با راز متریک‌های افزونه را می‌خواهد و می‌گوید Xen Orchestra کدام استخرها را گزارش می‌کند.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "در `/opt/oneuptime-xcp-ng-agent` نصب می‌شود، یک فایل `.env` با `0600` می‌نویسد و عامل را با Docker Compose راه می‌اندازد. اجرای دوباره اسکریپت به‌جای پرسیدن دوباره، همه‌چیز را از همان `.env` دوباره به کار می‌برد، پس ارتقا هم همین‌طور انجام می‌شود.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps`، `oneuptime-xcp-ng-agent` را نشان می‌دهد. در لاگ‌های آن به دنبال `Everything is ready. Begin running and processing data.` بگردید. عامل هر دقیقه Xen Orchestra را می‌خواند، و هر استخری که گزارش می‌کند سپس با نامی که Xen Orchestra به آن می‌دهد، همراه با میزبان‌ها، VMها و ذخیره‌سازی‌اش، در بخش **XCP-ng** نمایان می‌شود.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "اسکریپت نصب این‌ها را در `/opt/oneuptime-xcp-ng-agent/.env` می‌نویسد. پس از تغییر هر کدام، آن را با `docker compose up -d` در `/opt/oneuptime-xcp-ng-agent` اعمال کنید.",
  "| Variable | Required | Description |": "| متغیر | الزامی | توضیح |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (مثلاً `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | کلید دریافت داده تله‌متری، همانی که در مرحله 1 انتخاب شد |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | بله | `host` یا `host:port` مربوط به Xen Orchestra، بدون طرح‌واره |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | خیر | `https` (پیش‌فرض). `http` فقط در محیط آزمایشی: آن‌گاه راز به‌صورت رمزنشده از شبکه می‌گذرد |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | بله | راز افزونه OpenMetrics که به‌عنوان توکن Bearer فرستاده می‌شود. هر `$` در آن به شکل `$$` نوشته می‌شود |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | خیر | نام این Xen Orchestra در OneUptime که در تنظیمات هر یک از استخرهایش نشان داده می‌شود (پیش‌فرض: نشانی آن) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | خیر | نامی که گواهی Xen Orchestra با آن بررسی می‌شود، وقتی `XO_ADDRESS` نشانی‌ای است که در گواهی نیامده |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل (پیش‌فرض: `oneuptime-xcp-ng-agent`). عامل یک Xen Orchestra دوم روی همان ماشین به نام خودش نیاز دارد: اسکریپت نصب، اگر آن را تنظیم نکنید، عامل تازه را به نام پوشه‌اش می‌نامد و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | اسکریپت نصب | نشانی Xen Orchestra همان‌طور که تایپ شده؛ اسکریپت `XO_SCHEME` و `XO_ADDRESS` را از آن به دست می‌آورد |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | اسکریپت نصب | اثر انگشت SHA-256 گواهی خود Xen Orchestra، وقتی عامل فقط به همان گواهی اعتماد می‌کند |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | اسکریپت نصب | بسته CA که گواهی Xen Orchestra را صادر کرده و اسکریپت آن را در `xo-ca.pem` کپی می‌کند |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | خیر | توکن یک کاربر Xen Orchestra که یک کپی از نقش داخلی **Read only** را دارد و هیچ چیز دیگری: وقتی تنظیم شده باشد، عامل هوش مصنوعی XCP-ng اجرا می‌شود و با آن می‌خواند |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | خیر | فقط برای اصلاح‌ها: توکن کاربری دیگر که نقشش آن‌ها را مجاز می‌کند. بدون آن، عامل هوش مصنوعی هیچ چیزی را تغییر نمی‌دهد |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | خیر | UUID مربوط به XAPI برای استخری که عامل هوش مصنوعی به آن خدمت می‌دهد (پیش‌فرض: تنها استخری که توکن خواندنش می‌بیند) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | خیر | `XCP_NG_POOL_ID` را به‌عنوان استخری که عامل هوش مصنوعی با آن ثبت می‌شود بازنویسی می‌کند |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | خیر | `true` یا `false`: اینکه OneUptime AI در حین بررسی می‌تواند فرمان‌های فقط‌خواندنی عامل هوش مصنوعی را اجرا کند یا نه (پیش‌فرض: روشن) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | خیر | `off`، `ask-for-approval`، `automatic` یا `bypass-approval`: اینکه OneUptime AI چگونه می‌تواند یک اصلاح را اعمال کند |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | خیر | `true` به عامل هوش مصنوعی اجازه می‌دهد با توکن تغییرها اصلاح‌ها را اعمال کند. هر چیز دیگری آن را فقط‌خواندنی نگه می‌دارد |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | خیر | `vm/<uuid>`، `host/<uuid>`، `pbd/<uuid>` یا `schedule/<uuid>` که یک اصلاح می‌تواند به آن‌ها دست بزند، جداشده با ویرگول (پیش‌فرض: همه) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | خیر | همین، برای آنچه OneUptime AI هرگز نباید تغییر دهد: ماشین مجازی‌ای که عامل هوش مصنوعی در آن اجرا می‌شود، و ماشین مجازی خودِ Xen Orchestra |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | خیر | سطح لاگ عامل هوش مصنوعی: `debug`، `info` (پیش‌فرض)، `warn` یا `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | خیر | `xcp-ng-ai-agent` عامل هوش مصنوعی را راه می‌اندازد؛ اسکریپت نصب آن را وقتی توکن خواندن تنظیم شده باشد می‌نویسد |",
  "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-xcp-ng-ai-agent`). The install script names a second Xen Orchestra's AI agent after its collector (`oneuptime-xcp-ng-ai-agent-lab` beside `oneuptime-xcp-ng-agent-lab`) unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل هوش مصنوعی (پیش‌فرض: `oneuptime-xcp-ng-ai-agent`). اسکریپت نصب، اگر آن را تنظیم نکنید، عامل هوش مصنوعی یک Xen Orchestra دوم را به نام کالکتورش می‌نامد (`oneuptime-xcp-ng-ai-agent-lab` کنار `oneuptime-xcp-ng-agent-lab`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "عامل گواهی Xen Orchestra را با `xo-ca.pem` کنار `docker-compose.yml` بررسی می‌کند.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "عامل گواهی Xen Orchestra را در هر خواندن فقط با `xo-ca.pem` بررسی می‌کند. آن فایل یکی از این سه را در خود دارد:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **گواهی خود Xen Orchestra**، که با اثر انگشت SHA-256 آن (`XO_TLS_FINGERPRINT`) پین شده است: عامل فقط به همان گواهی اعتماد می‌کند و نه هیچ گواهی دیگر.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **CA صادرکننده آن** (`XO_CA_FILE`)، برای گواهی‌ای از CA خودتان.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **بسته CA این ماشین**، برای گواهی‌ای که این ماشین از قبل به آن اعتماد دارد.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "در هر حال، گواهی باید نشانی‌ای را که عامل به آن وصل می‌شود نام ببرد: عامل، مانند هر کلاینت TLS امروزی، نام‌هایی را که گواهی برایشان صادر شده بررسی می‌کند، نه subject آن را. گواهی خودامضایی که Xen Orchestra برای خودش می‌سازد هیچ نامی ندارد، پس عامل چه پین شده باشد چه نه، نمی‌تواند به آن اعتماد کند و با `x509: certificate is not valid for any names` شکست می‌خورد. به Xen Orchestra گواهی‌ای بدهید که نشانی‌اش را نام ببرد — از CA خودتان، یا یک گواهی خودامضا با نام جایگزین subject (subject alternative name) — همان‌طور که [گواهی Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate) نشان می‌دهد.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "وقتی گواهی، Xen Orchestra را با نامی غیر از نشانی موجود در `XO_ADDRESS` نام می‌برد، `XO_TLS_SERVER_NAME` را روی همان نام بگذارید. وقتی گواهی پین‌شده تمدید شود، عامل خواندن Xen Orchestra را متوقف می‌کند تا به گواهی تازه اعتماد کند. اسکریپت نصب را دوباره اجرا کنید: اثر انگشت تازه را نشان می‌دهد و بدون تغییر چیزی متوقف می‌شود. آن اثر انگشت را روی ماشین Xen Orchestra بررسی کنید، سپس اسکریپت را یک بار دیگر با آن اجرا کنید: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "عامل هر دقیقه افزونه را می‌خواند، که پایگاه‌داده‌های round-robin هر میزبان را از طریق XAPI با تفکیک 60 ثانیه می‌خواند. عامل سری‌های `xcp_*` را نگه می‌دارد و استخر هر سری را به دسته‌ای که می‌فرستد منتقل می‌کند، به شکل `xcp_ng.pool.id` (UUID استخر که هرگز تغییر نمی‌کند) و `xcp_ng.pool.name`:",
  "| Category | Series |": "| دسته | سری‌ها |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **استخر** | `xcp_pool_connected` — تا وقتی Xen Orchestra به استخر متصل است وجود دارد |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **میزبان‌ها** | `xcp_host_status` (وضعیت برق و اینکه فعال است یا نه)، `xcp_host_uptime_seconds`، `xcp_host_cpu_average`، `xcp_host_load_average`، `xcp_host_memory_*`، `xcp_host_running_vcpus`، `xcp_host_network_*` برای هر رابط، `xcp_host_disk_*` برای هر مخزن ذخیره‌سازی |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VMها** | `xcp_vm_status`، `xcp_vm_uptime_seconds`، `xcp_vm_cpu_usage`، `xcp_vm_runstate_*` (رقابت بر سر CPU)، `xcp_vm_memory_*`، `xcp_vm_network_*` برای هر رابط، `xcp_vm_disk_*` برای هر دیسک، `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **ذخیره‌سازی** | `xcp_sr_physical_size_bytes`، `xcp_sr_physical_usage_bytes`، `xcp_sr_virtual_size_bytes`، `xcp_vdi_virtual_size_bytes`، `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`، روی استخرهایی که XOSTOR را اجرا می‌کنند |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'دامنه‌های کنترل به‌صورت VMهایی با `is_control_domain="true"` گزارش می‌شوند؛ صفحه‌ها آن‌ها را پنهان می‌کنند مگر اینکه خودتان بخواهید.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra هشت سری توان عملیاتی را از نوع شمارنده تعریف می‌کند، هرچند هر کدام نرخ بر ثانیه XAPI را در خود دارد: `xcp_host_network_receive_bytes_total`، `xcp_host_network_transmit_bytes_total`، و سری‌های شبکه، خطای شبکه و خواندن و نوشتن دیسک VMها. عامل آن‌ها را بدون دست زدن به مقدارهایشان به gauge تبدیل می‌کند، پس OneUptime آن‌ها را همان نرخ‌هایی که هستند ذخیره می‌کند، بر حسب بایت یا خطا در ثانیه.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime برای هر استخر چهار سری 0/1 می‌افزاید که قالب‌های هشدار آن‌ها را می‌خوانند: `xcp_ng.host.running`، `xcp_ng.host.enabled`، `xcp_ng.vm.running` و `xcp_ng.vm.stopped_after_running` (VM متوقف یا مکث‌شده‌ای که در روز گذشته اجرا شده بود). همچنین روی هر نقطه `xcp_ng.scope` (`pool`، `host`، `vm`، `sr`، `vdi` یا `xostor`) و `xcp_ng.id` (UUID آن شیء) را می‌زند که مانیتورها و داشبوردها بر اساس آن‌ها فیلتر می‌کنند.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "نگه داشته نمی‌شود: سری‌های فرایند خود Xen Orchestra (`xo_*`)، که به هیچ استخری تعلق ندارند، و توان میزبان که از طریق IPMI خوانده می‌شود و افزونه آن را بدون استخرش می‌فرستد. سهم برآوردشده هر VM از آن نگه داشته می‌شود.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "یک عامل یک Xen Orchestra و هر استخری را که آن مدیریت می‌کند می‌خواند. برای Xen Orchestra دوم، عامل دومی را در پوشه‌ای جداگانه و با نام کانتینر خودش نصب کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "بدون `XCP_NG_AGENT_CONTAINER_NAME`، اسکریپت نام کانتینر را از روی پوشه می‌گذارد. اسکریپت این نام را در `.env` همان عامل نگه می‌دارد، پس اجرای دوباره اسکریپت برای ارتقای عامل آن را حفظ می‌کند، و عاملی که `container_name` آن را زمانی در `docker-compose.yml` ویرایش کرده‌اید همان نام را نگه می‌دارد. با Docker Compose، به‌جای آن `XCP_NG_AGENT_CONTAINER_NAME` را در `.env` هر عامل تنظیم کنید.",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "نگذارید دو Xen Orchestra که یک استخر را مدیریت می‌کنند هر دو خوانده شوند: آن استخر بر اساس UUID خود در OneUptime یک استخر است و دو بار گزارش می‌شد.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "هر ویژگی منبعی که با پیشوند `oneuptime.label.` شروع شود، برچسب پروژه‌ای روی هر استخری که عامل می‌خواند می‌شود: `oneuptime.label.<dimension>=<value>` همان برچسب `<dimension>:<value>` است. آن‌ها را در `otel-collector-config.yaml` به پردازنده `resource`، کنار `oneuptime.agent.version`، اضافه کنید:",
  "Then restart the collector so it reads the new config:":
    "سپس کالکتور را دوباره راه بیندازید تا پیکربندی تازه را بخواند:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "استخرها با برچسب‌های `team:platform` و `env:production` نمایان می‌شوند. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف مقایسه می‌شوند، پس برچسب موجود `Production` دوباره به کار می‌رود؛ برچسب‌هایی که در رابط کاربری OneUptime افزوده شده‌اند هرگز به دست عامل حذف نمی‌شوند. اجرای دوباره اسکریپت نصب، `otel-collector-config.yaml` ویرایش‌شده را جایگزین می‌کند و نسخه شما را کنار آن با نام `otel-collector-config.yaml.bak.<timestamp>` نگه می‌دارد.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**ارتقا** — ایمیج کالکتور در `docker-compose.yml` ثابت شده و پیکربندی‌اش فایلی کنار آن است، پس فقط کشیدن ایمیج عامل را جلو نمی‌برد. اسکریپت نصب را دوباره اجرا کنید. هر مقدار `.env` موجود شما را دوباره به کار می‌برد (چیزی دوباره پرسیده نمی‌شود)، گواهی Xen Orchestra را به همان شیوه بررسی می‌کند، آخرین `docker-compose.yml` و `otel-collector-config.yaml` را دانلود می‌کند — فایلی که ویرایش کرده‌اید کنار فایل تازه با نام `<file>.bak.<timestamp>` نگه داشته می‌شود —، ایمیج را می‌کشد و عامل را با آن از نو می‌سازد:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "پیکربندی نسخه کالکتوری را که ثابت می‌کند به‌عنوان **نسخه عامل** هر استخر گزارش می‌دهد. وقتی این OneUptime نسخه تازه‌تری را ثابت کند، یک نشانه هشدار کنار آن این دستورها را باز می‌کند.",
  "**Uninstall** the agent:": "عامل را **حذف نصب** کنید:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "سپس اگر چیز دیگری افزونه OpenMetrics را نمی‌خواند، آن را در Xen Orchestra خاموش کنید.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` کل زنجیره را بررسی می‌کند — کانتینر، گواهی Xen Orchestra با `xo-ca.pem`، افزونه و راز آن، استخرهایی که گزارش می‌کند — و مستقیم از OneUptime می‌پرسد که آیا کلید دریافت داده شما را می‌پذیرد. همین بررسی آخر از همه مهم‌تر است: نقطه‌های پایانی OTLP در OneUptime کلید نادرست را با `401` یا `422` رد می‌کنند، که کالکتور آن را برای هر دسته فقط با یک خط `Exporting failed` ثبت می‌کند که به‌آسانی از چشم می‌افتد.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "در پایان حکمی می‌دهد که محتمل‌ترین علت را نام می‌برد. هرگز راز را چاپ نمی‌کند.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime استخری را که 15 دقیقه هیچ چیزی برایش خوانده نشده باشد «قطع‌شده» علامت می‌زند.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. اگر همه استخرهای این Xen Orchestra «قطع‌شده» هستند، عامل را بررسی کنید (در `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` و `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. اگر فقط یکی چنین است، Xen Orchestra گزارش آن را متوقف کرده است: در *Settings → Servers* در Xen Orchestra، سرور آن استخر باید متصل باشد. میزبان‌ها، VMها و ذخیره‌سازی استخر همان‌طور می‌مانند که Xen Orchestra آخرین بار گزارش کرده است.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "کالکتور `server returned HTTP status 401 Unauthorized` را ثبت می‌کند. راز را دوباره از *Settings → Plugins → openmetrics* کپی کنید، `XO_OPENMETRICS_SECRET` را در `.env` روی آن بگذارید — میان تک‌نقل‌قول، با هر `$` به شکل `$$` — و آن را با `docker compose up -d` در `/opt/oneuptime-xcp-ng-agent` اعمال کنید. پیش از 6.8، Xen Orchestra با هر راه‌اندازی دوباره راز تازه‌ای می‌ساخت.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra پاسخ می‌دهد، اما افزونه OpenMetrics آن نه. افزونه را در *Settings → Plugins → openmetrics* روشن کنید (XOA برای آن به مجوز Premium نیاز دارد)، و بررسی کنید که Xen Orchestra نسخه 6.9 یا جدیدتر باشد. تا وقتی افزونه در حال اجراست، `/openmetrics/health` بدون راز با `{"status":"ok"}` پاسخ می‌دهد.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — گواهی هیچ نشانی‌ای را نام نمی‌برد، همان‌طور که گواهی خودامضای خود Xen Orchestra. به Xen Orchestra گواهی‌ای بدهید که نشانی‌اش را نام ببرد.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — به یکی از آن نام‌ها وصل شوید، یا `XO_TLS_SERVER_NAME` را روی یکی از آن‌ها بگذارید.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` نه این گواهی را دارد و نه CA صادرکننده آن را. گواهی تمدید شده، یا فایل گواهی نادرستی دارد: آن را دوباره بنویسید، همان‌طور که **گواهی Xen Orchestra** در پیشرفته می‌گوید.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra فقط استخرهایی را گزارش می‌کند که به آن‌ها متصل است، و عامل فقط همان Xen Orchestra را می‌خواند. سرور استخر را در *Settings → Servers* در Xen Orchestra متصل کنید؛ استخر با خواندن بعدی در OneUptime نمایان می‌شود. استخری که Xen Orchestra دیگری آن را می‌خواند، کنار همان Xen Orchestra به عامل جداگانه‌ای نیاز دارد.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **نام این Xen Orchestra** — فرمان از پیش آن را **`xo-paris`** نام می‌دهد، همان‌طور که تنظیمات این استخر نشان می‌دهد.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "فرمان از پیش نشانی OneUptime و کلید دریافت داده شما را در خود دارد. بقیه را اسکریپت می‌پرسد:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "`docker-compose.yml` و `otel-collector-config.yaml` را از این OneUptime در یک پوشه تازه دانلود کنید:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "یک فایل `.env` کنار آن‌ها بسازید؛ راز افزونه در آن است، پس آن را با `chmod 600 .env` خصوصی نگه دارید:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- `XO_ADDRESS` را روی `host` یا `host:port` مربوط به Xen Orchestra بگذارید، بدون `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- راز افزونه را میان تک‌نقل‌قول بگذارید. اگر `$` دارد، هر کدام را به شکل `$$` بنویسید: کالکتور مقدار را یک بار دیگر می‌خواند.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` همان نامی است که تنظیمات هر استخر به این Xen Orchestra می‌دهد.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "سپس گواهی Xen Orchestra را به‌صورت `xo-ca.pem` کنار `docker-compose.yml` به عامل بدهید — عامل Xen Orchestra را فقط با این فایل بررسی می‌کند. برای اعتماد به گواهی خود Xen Orchestra، آن را بخوانید و اثر انگشتش را با اثر انگشت روی ماشین Xen Orchestra مقایسه کنید:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "اگر CA خودتان آن را صادر کرده، به‌جای آن گواهی همان CA را در `xo-ca.pem` کپی کنید؛ اگر یک CA عمومی صادر کرده، بسته CA این ماشین را کپی کنید (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "عامل را راه بیندازید:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "عامل این‌ها را از فایل `.env` کنار `docker-compose.yml` می‌خواند. پس از تغییر هر کدام، آن را با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "وقتی گواهی، Xen Orchestra را با نامی غیر از نشانی موجود در `XO_ADDRESS` نام می‌برد، `XO_TLS_SERVER_NAME` را روی همان نام بگذارید. وقتی گواهی موجود در `xo-ca.pem` تمدید شود، آن را مانند مرحله 3 دوباره بخوانید، سپس `docker compose up -d --force-recreate` را اجرا کنید.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "این‌ها را در پوشه عامل اجرا کنید، همان که `docker-compose.yml` در آن است.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**ارتقا** — ایمیج کالکتور در `docker-compose.yml` ثابت شده و پیکربندی‌اش فایلی کنار آن است، پس فقط کشیدن ایمیج عامل را جلو نمی‌برد. هر دو فایل را دوباره دانلود کنید؛ `.env` و `xo-ca.pem` شما می‌مانند، و تغییری که در هر یک از فایل‌ها داده بودید باید دوباره انجام شود:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "سپس ایمیج را بکشید و عامل را از نو بسازید تا کالکتور پیکربندی تازه‌اش را بخواند:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. اگر همه استخرهای این Xen Orchestra «قطع‌شده» هستند، عامل را بررسی کنید (در پوشه عامل): `docker compose ps` و `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "کالکتور `server returned HTTP status 401 Unauthorized` را ثبت می‌کند. راز را دوباره از *Settings → Plugins → openmetrics* کپی کنید، `XO_OPENMETRICS_SECRET` را در `.env` روی آن بگذارید — میان تک‌نقل‌قول، با هر `$` به شکل `$$` — و آن را با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید. پیش از 6.8، Xen Orchestra با هر راه‌اندازی دوباره راز تازه‌ای می‌ساخت.",
};

export default TRANSLATION;
