import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "وقتی `enable_prometheus` در `/etc/kolla/globals.yml` روشن باشد، که Kolla-Ansible تا وقتی آن را تنظیم نکنید خاموش نگه می‌دارد، Prometheus، Alertmanager و یک اکسپورتر برای هر جزء زیر ابر را اجرا می‌کند و هیچ قاعده هشداری همراه ندارد. این راهنما به‌جای راه‌اندازی نسخه دوم، همان چیزی را می‌خواند که این‌ها اجرا می‌کنند.",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**این راهنما تا کجا آزموده شده است:** مسیرها و پورت‌های آن از کد منبع خود Kolla-Ansible خوانده شد. سپس دستورهای آن روی یک all-in-one واقعی با stable/2026.1 و Open vSwitch اجرا شد، با جانشینی برای OneUptime که آنچه عامل می‌فرستاد را نگه می‌داشت: عامل با اعتبارنامه نمای کامل، بدون Docker، روی اکسپورتر خود Kolla-Ansible و روی اکسپورتر خودتان در نسخه پین‌شده و در 1.7.0، اکسپورتر عامل با اعتبارنامه فقط زیرساخت، اهداف خوانده‌شده از prometheus.yml واقعی آن، و پروفایل لاگ. وقتی Memcached واقعاً آنجا متوقف شد، Alertmanager آن یک Webhook فعال‌شدن و سپس یک Webhook رفع‌شدن فرستاد، و آنچه فرستاد، وقتی به یک OneUptime در حال اجرا رسید، یک حادثه روی ابر درست و نه هیچ ابر دیگری باز کرد و آن را رفع کرد. عامل و یک پراب هر کدام یک DevStack واقعی را تا یک OneUptime در حال اجرا رسانده‌اند، از میان یک nova-compute متوقف‌شده و بازگشت آن، اما نه از این ابزار.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "Docker Engine 20.10+ با افزونه Docker Compose v2، روی ماشینی که عامل را اجرا خواهد کرد (یا `bash install.sh --without-docker`، زیر پیشرفته)",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "ماشینی بیرون از ابری که پایش می‌کند: عاملی که درون یک ابر ازکارافتاده است همراه آن خاموش می‌شود",
  "That machine can reach Keystone and every service's API":
    "آن ماشین به Keystone و API هر سرویس دسترسی دارد",
  "The `openstack` command line, as someone who can create the credential below":
    "خط فرمان `openstack`، به‌عنوان کسی که می‌تواند اعتبارنامه زیر را بسازد",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "هشداری که فعال می‌شود به یک حادثه تبدیل می‌شود، با آنکال و صفحات وضعیت از همان ساعت اول، و وقتی هشدار رفع شود آن هم رفع می‌شود. چیزی برای نصب وجود ندارد.",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. در OneUptime، همان‌طور که [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) می‌گوید یک مانیتور درخواست ورودی بسازید و **نشانی ضربان** آن را کپی کنید. این همان نشانی دارای `<secret key>` در پایین است.",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. **نمای کلی ← منابع پیوندشده** مانیتور را باز کنید و ابر OpenStack با نام `my-openstack-cloud` را اضافه کنید. در این صورت هر حادثه در صفحه **حوادث** آن ابر قرار می‌گیرد، پس Alertmanager هر ابر به مانیتور جداگانه‌ای نیاز دارد. ابر به محض رسیدن نخستین داده‌هایش در آن فهرست ظاهر می‌شود، پس این کار را پس از گام‌های زیر انجام دهید، یا ابتدا ابر را در **OpenStack ← همه ابرها** اضافه کنید.",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "سپس روی میزبانی که از آن مستقر می‌کنید، `/etc/kolla/config/prometheus/prometheus-alertmanager.yml` را بنویسید، که Kolla-Ansible به‌جای فایل خودش می‌خواند، و آن را اعمال کنید:",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- با `source /etc/kolla/admin-openrc.sh` به‌عنوان مدیر وارد شوید، که `kolla-ansible post-deploy` آن را می‌نویسد.",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **نمای کامل** به یک تغییر در Cinder نیاز دارد. قالب‌های Kolla-Ansible از قبل `service_type` را زیر `[keystone_authtoken]` روی Nova، Neutron، Glance و Placement تنظیم می‌کنند، اما Cinder آن `volume` می‌گوید و کاتالوگ آن `block-storage`، و keystonemiddleware اعتبارنامه‌ای را که با قواعد دسترسی محدود شده با `401` رد می‌کند مگر اینکه این دو یکی باشند. `service_type = block-storage` را زیر `[keystone_authtoken]` در `/etc/kolla/config/cinder.conf` اضافه کنید، سپس `kolla-ansible reconfigure -i <inventory> --tags cinder` را اجرا کنید.",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **فقط زیرساخت** بازنویسی‌های خود را در `/etc/kolla/config/nova/policy.yaml` می‌گیرد، و همین‌طور برای `neutron`، `keystone` و `placement`، ادغام‌شده با هر چه از قبل آنجاست. آن‌ها را با `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` اعمال کنید.",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**پیشنهادی.** عامل هر چیزی را که می‌خواند می‌بیند: سرویس‌ها، هایپروایزرها، اینستنس‌ها، حجم‌ها، شبکه‌ها و روترهای هر پروژه، و وضعیت `cinder-volume` و `cinder-scheduler` و استخرهای ذخیره‌سازی، که فقط این سطح آن‌ها را می‌بیند. کاربران و گروه‌های Keystone را عمداً کنار می‌گذارد.",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "این یک اعتبارنامه برنامه روی حسابی با `admin` روی پروژه‌ای مخصوص خودش است، که با قواعد دسترسی به همان فراخوانی‌های `GET` که عامل انجام می‌دهد محدود شده، پس نمی‌تواند بنویسد: در هر نسخه‌ای که ثبت می‌کنیم، هر خواندن با `200` و هر نوشتن با `401` پاسخ گرفت. به‌عنوان مدیر، پروژه و حساب را بسازید:",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "سپس، با ورود به‌عنوان آن حساب روی آن پروژه، اعتبارنامه را بسازید. یک قاعده دسترسی با مسیری که سرویس می‌بیند مقایسه می‌شود، و سرویسی که پشت یک پیشوند مسیر است قواعد همراه را با `401` رد می‌کند، پس این دستورها ابتدا آن‌ها را از روی کاتالوگ با این ابر تطبیق می‌دهند:",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- `id` و `secret` را که چاپ می‌کند کپی کنید: secret فقط یک بار نشان داده می‌شود.",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- هرگز `--unrestricted` را اضافه نکنید، که به آن اجازه می‌دهد اعتبارنامه‌های بیشتری بسازد.",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- قواعد دسترسی فقط جایی کار می‌کنند که هر سرویس `service_type` را در بخش `[keystone_authtoken]` خود تنظیم کرده و از آن پس دوباره راه‌اندازی شده باشد: `compute`، `network`، `block-storage` (قواعد `volume` و `volumev3` را هم دارند، برای Cinder‌ای که این‌طور پیکربندی شده)، `image` و `placement`. Keystone به چیزی نیاز ندارد. بدون آن، سرویس‌ها اعتبارنامه را با `401` رد می‌کنند.",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- اگر نمی‌خواهید آن را تغییر دهید، `--access-rules` را کنار بگذارید. این کار یک اعتبارنامه برنامه مدیر معمولی می‌سازد که هم می‌تواند بنویسد و هم بخواند، پس آن را به اندازه گذرواژه مدیر امن نگه دارید.",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- وقتی منقضی شود دیگر کار نمی‌کند. برای جایگزینی آن، اعتبارنامه دوم را پیش از حذف اولی بسازید.",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "بدون مدیر. عامل همه پروژه‌ها، دامنه‌ها، سرویس‌ها و نقاط پایانی Keystone، کل Nova شامل اینستنس‌های هر پروژه، کل Placement، و عامل‌ها و استخرهای نشانی Neutron را می‌بیند. حجم‌ها، اسنپ‌شات‌ها، شبکه‌ها، زیرشبکه‌ها، روترها، IPهای شناور و پورت‌ها فقط برای پروژه‌هایی ظاهر می‌شوند که نقش روی آن‌ها اختصاص داده شده است، پس روی پروژه‌ای که چیزی ندارد فقط موارد مشترک و خارجی، و OneUptime بقیه را نمی‌بیند.",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "وضعیت `cinder-volume` یا `cinder-scheduler` یا استخرهای ذخیره‌سازی را نمی‌بیند: کد خود Cinder آنجا پس از عبور از سیاست، مدیر می‌خواهد، پس هیچ بازنویسی‌ای آن‌ها را باز نمی‌کند، و فقط **نمای کامل** آن‌ها را می‌بیند.",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "این یک نقش جداگانه است، `oneuptime_monitoring`، با بازنویسی‌های سیاستی که عامل همراه دارد، روی پروژه‌ای مخصوص خودش که چیزی ندارد و سهمیه‌اش صفر است. جایی که Cinder گزینه `enforce_new_defaults` را خاموش دارد، که پیش‌فرض خود Cinder است، هر نقشی روی یک پروژه می‌تواند حجم‌های آن پروژه را بسازد. بی‌آنکه چیزی برای دست زدن باشد و سهمیه‌ای برای ساختن چیزی، چیزی برای نوشتن ندارد: در هر نسخه‌ای که ثبت می‌کنیم، هر نوشتن با `403`، یا به خاطر سهمیه با `409` و `413` پاسخ گرفت. به‌عنوان مدیر، نقش، پروژه و یک حساب را بسازید:",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "بازنویسی‌ها را دانلود کنید و هر کدام را روی هر کنترلر در فایلی ادغام کنید که `[oslo_policy] policy_file` در پیکربندی آن سرویس نام می‌برد. این فایل `/etc/nova/policy.yaml` و مانند آن است، مگر اینکه استقرار شما چیز دیگری بگوید. هر بازنویسی پیش‌فرض سرویس را نگه می‌دارد و نقش را اضافه می‌کند. oslo.policy خودش فایل تغییرکرده را تشخیص می‌دهد، پس چیزی دوباره راه‌اندازی نمی‌شود:",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**برای برداشتن دوباره بازنویسی‌ها، فایل را خالی کنید (`{}`) و هرگز آن را حذف نکنید.** در Flamingo (2025.2) و Epoxy (2025.1)، به محض اینکه فایل سیاستی که oslo.policy خوانده از بین برود، در هر بررسی خطا می‌دهد، پس آن سرویس همه درخواست‌ها را ناموفق می‌کند. وقتی آن سرویس Keystone باشد، اعتبارسنجی توکن‌ها را متوقف می‌کند و کل ابر با `503` پاسخ می‌دهد. اگر از قبل رخ داده است، سرویس را دوباره راه‌اندازی کنید.",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "سپس، با ورود به‌عنوان آن حساب روی آن پروژه، اعتبارنامه را بسازید و `id` و `secret` را که چاپ می‌کند کپی کنید:",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "دادن نقش روی یک پروژه واقعی برای دیدن حجم‌ها و روترهای آن، به حساب اجازه نوشتن در آنجا را هم می‌دهد، روی ابری که Cinder گزینه `enforce_new_defaults` را خاموش دارد. `troubleshoot.sh` وقتی پروژه اعتبارنامه چیزی در خود داشته باشد هشدار می‌دهد.",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "برای تیمی که بخش خودش از ابری را پایش می‌کند که کس دیگری اداره می‌کند. عامل حجم‌ها، شبکه‌ها و روترهای یک پروژه را می‌بیند و هیچ زیرساختی را نه: نه هایپروایزرها، نه سرویس‌ها و نه استخرهای ذخیره‌سازی.",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "از طریق عامل، این سطح اصلاً هیچ اینستنسی نشان نمی‌دهد: اکسپورتر از Nova سرورهای همه پروژه‌ها را می‌خواهد، Nova یک خواننده ساده را رد می‌کند، و آن خواندن به‌کلی شکست می‌خورد. فقط یک پراب OneUptime که بدون این عامل گردآوری می‌کند می‌تواند اینستنس‌های یک پروژه را فهرست کند.",
  "This is the plain `reader` role. Give an account the role on the project:":
    "این نقش ساده `reader` است. نقش را روی پروژه به یک حساب بدهید:",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron و Cinder به یک خواننده با پروژه خودش و بدون خطا پاسخ می‌دهند، پس این فهرست‌ها کامل به نظر می‌رسند و فقط همان پروژه را در بر دارند.",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "ممکن است بتواند بنویسد. روی ابری که Cinder گزینه `enforce_new_defaults` را خاموش دارد، که پیش‌فرض خود Cinder است، `reader` ساده هم می‌تواند در پروژه خودش حجم بسازد. روی Epoxy، Flamingo و Gazpacho این کار را کرد، و روی Hibiscus رد شد، چون DevStack فقط آنجا `enforce_new_defaults` را روشن می‌کند.",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "بدون اعتبارنامه و بدون چیز تازه‌ای برای اجرا: عامل اکسپورتری را می‌خواند که Kolla-Ansible از قبل اجرا می‌کند، از طریق VIP داخلی آن روی `9198`. با دادن نشانی به نصب، پرسش‌های اعتبارنامه آن را رد کنید:",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible اکسپورتر 1.7.0 را پین می‌کند و آن را بدون `--multi-cloud` اجرا می‌کند، پس `/probe` ندارد: عامل هر 2 دقیقه همه چیز را یک‌جا از آن می‌خواهد، علاوه بر Prometheus خود Kolla-Ansible که هر دقیقه می‌پرسد. پاسخ آن هم کمتر می‌گوید. روی پنج ابر واقعی، صفحه‌ها این‌ها را نداشتند:",
  "| Goes without | Because | What it costs |":
    "| چه چیزی ندارد | چون | چه هزینه‌ای دارد |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| همه چیز Cinder | از کاتالوگ `volumev3` را می‌خواهد و جایی که Cinder با نام `block-storage` ثبت شده چنین چیزی نمی‌یابد | **حجم‌ها** و **استخرهای ذخیره‌سازی** خالی می‌مانند، و **سرویس‌ها** هیچ Block Storage API، `cinder-volume` یا `cinder-scheduler` ندارد. **Block Storage API Down**، **Block Storage Service Down**، **Storage Pool Warning**، **Storage Pool Critical**، **Volumes in Error** و **Volume Stuck** ساکت می‌مانند |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| اینکه یک هایپروایزر چند اینستنس دارد، و تجمیع‌های آن | فهرست هایپروایزرهای Nova در جدیدترین میکرونسخه، که Kolla-Ansible آن را می‌خواهد، شکست می‌خورد | آن دو در **هایپروایزرها**، و آنچه یک میزبان ازدست‌رفته می‌گوید با خود می‌برد. vCPU، حافظه و دیسک آن همچنان هست: از Placement می‌آیند |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| دامنه‌ها | چنین سری‌ای ندارد | **دامنه‌ها** خالی می‌ماند |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| وضعیت، دیدپذیری و تاریخ ساخت یک ایمیج | چنین برچسب‌هایی ندارد | آن ستون‌ها در **ایمیج‌ها**. **Image Stuck** ساکت می‌ماند، پس ایمیجی که در راه `active` گیر کرده دیده نمی‌شود |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| MTU یک شبکه | چنین برچسبی ندارد | آن خط در صفحه یک شبکه |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "اگر به این‌ها نیاز دارید، یکی از زبانه‌های دیگر و اکسپورتر خود عامل را به کار ببرید. می‌توانید بعداً نظرتان را عوض کنید: یک ابر هر چه آن را بخواند نامش را نگه می‌دارد.",
  "The script asks for:": "اسکریپت این‌ها را می‌پرسد:",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **نشانی OneUptime و کلید دریافت داده**، هر دو در گام 1 نشان داده شده‌اند. یک کلید را آنجا انتخاب کنید تا این‌ها اینجا پر شوند.",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **نام ابر**: اینکه ابر در OneUptime چگونه نشان داده می‌شود. آن را ثابت نگه دارید: یک نام تازه یک ابر تازه ثبت می‌کند.",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **نشانی احراز هویت Keystone**، مانند `https://keystone.example.com:5000/v3`.",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **نام‌های منطقه**، جداشده با ویرگول (اگر یکی دارید `RegionOne`).",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **اعتبارنامه برنامه**: شناسه و secret گام پیش. هیچ‌کدام روی صفحه نمایش داده نمی‌شوند، و هیچ‌کدام روی خط فرمان نمی‌آیند.",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **فایل CA خصوصی**، فقط اگر گواهی ابر از مرجع صدور گواهی خودش باشد.",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "پیش از نصب هر چیزی اعتبارنامه را با Keystone بررسی می‌کند، در `/opt/oneuptime-openstack-agent` نصب می‌کند (یا اگر روی `/opt` دسترسی ندارید در `oneuptime-openstack-agent` در پوشه خانگی شما، و می‌گوید کدام)، یک فایل `.env` و یک `clouds.yaml` می‌نویسد که فقط مالکشان می‌تواند بخواند، و همه چیز را با Docker Compose راه‌اندازی می‌کند. اجرای دوباره آن به‌جای پرسیدن دوباره همه این‌ها را دوباره به کار می‌برد، پس ارتقا هم همین‌طور انجام می‌شود.",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps` کالکتور (`oneuptime-openstack-agent`)، اکسپورتر همراه (`oneuptime-openstack-exporter`) و عامل هوش مصنوعی OneUptime (`oneuptime-openstack-ai-agent`) را فهرست می‌کند. در لاگ‌های کالکتور به دنبال `Everything is ready. Begin running and processing data.` بگردید. سپس ابر خودبه‌خود در بخش **OpenStack** ظاهر می‌شود. حدود پنج دقیقه به آن فرصت دهید تا پر شود: compute، شبکه، حجم و Placement هر 2 دقیقه خوانده می‌شوند، و هویت و ایمیج‌ها هر 5 دقیقه.",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "روی میزبانی که Prometheus مربوط به Kolla-Ansible را اجرا می‌کند، این دستور اهداف آن را از فایلی که Kolla-Ansible ساخته می‌خواند و آن‌ها را به‌عنوان تنظیمات عامل چاپ می‌کند:",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "آنچه را چاپ می‌کند به `.env` عامل اضافه کنید، سپس `docker compose up -d` را در پوشه عامل اجرا کنید. هر اکسپورتر روی شبکه API گوش می‌دهد، پس ماشین عامل به مسیری تا آنجا نیاز دارد. سپس کارت **صفحه کنترل** ابر می‌گوید هر کدام در چه حالی است، و آشکارا می‌گوید کدام‌ها پایش نمی‌شوند.",
  "| Reads | Port | Setting |": "| چه چیزی را می‌خواند | پورت | تنظیم |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| افزونه Prometheus در RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter، برای MariaDB | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter، برای Memcached | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| اکسپورتر خود HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter، برای OVN و Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter، برای libvirt | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **پایگاه‌داده‌های OVN:** Kolla-Ansible از 2026.1 به بعد openstack-network-exporter را فقط روی گره‌های محاسباتی و شبکه اجرا می‌کند، و یک پایگاه‌داده OVN از میزبانی خوانده می‌شود که روی آن اجرا می‌شود. اگر گره‌های کنترل شما هیچ‌کدام از این دو نیستند، آن‌ها را زیر `[prometheus-openstack-network-exporter:children]` در فهرست موجودی خود اضافه کنید و دوباره پیکربندی کنید، وگرنه پایگاه‌داده‌های Northbound و Southbound پایش‌نشده نشان داده می‌شوند.",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **پیش از 2026.1** هیچ اکسپورتر شبکه‌ای وجود ندارد، پس OVN و Open vSwitch پایش‌نشده نشان داده می‌شوند.",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "پروفایل لاگ عامل روی هر گره اجرا می‌شود و فایل‌های Kolla-Ansible را می‌خواند. همین است که یک خط را به صفحه‌های ابر پیوند می‌دهد:",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Fluentd خود Kolla هم می‌تواند ارسال کند، با یک خروجی در `/etc/kolla/config/fluentd/output/*.conf` همان‌طور که [Fluentd](/docs/telemetry/fluentd) توضیح می‌دهد، اما آن رکوردها با نام یک سرویس به **لاگ‌ها** می‌رسند، و نه به صفحه‌های ابر.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی گذرگاه. OneUptime آن‌ها را از همان‌جا می‌خواند، به محض اینکه **یافتن رویدادهای امنیتی در لاگ‌های شما** در **رویدادهای امنیتی ← اتصال‌ها** روشن باشد. پروفایل لاگ عامل هر دو را از `/var/log/kolla` می‌خواند.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "این کار برای هر ورود یک خط می‌فرستد که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید؛ آن‌گاه آن تشخیص چیزی را می‌خواند که فیلتر ممیزی دیده است.",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "برای اینکه بدانید چه کسی از طریق Nova، Neutron، Cinder و Glance چه کرد، فیلتر ممیزی به یک تنظیم نیاز دارد که هم‌زمان در پیکربندی همه سرویس‌ها قرار می‌گیرد:",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "به یک فایل paste هم نیاز دارد، و وظیفه‌های پیکربندی Kolla-Ansible برای این سرویس‌ها هیچ فایل paste‌ای کپی نمی‌کنند. فایل خودتان را روی هر میزبان API بگذارید و آن را با `nova_api_extra_volumes`، `neutron_server_extra_volumes`، `cinder_api_extra_volumes` و `glance_api_extra_volumes` در `globals.yml` روی فایل درون ایمیج سوار کنید. فایل‌های نگاشت pyCADF در ایمیج در `/var/lib/kolla/venv/etc/pycadf` هستند. [چه کسی چه کرد](/docs/telemetry/openstack#who-did-what) خط‌های فیلتر را دارد.",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "نقش `reader` در OpenStack همه‌جا جز Keystone و Ironic به یک پروژه محدود است، و هایپروایزرها، سرویس‌ها، عامل‌ها، استخرها و Placement به‌طور پیش‌فرض ویژه مدیر هستند. یک بازنویسی سیاست نمی‌تواند فهرست‌های همه پروژه‌ها را در Cinder یا Neutron باز کند، چون آن‌ها این فهرست‌ها را در کد محدود می‌کنند، و کد خود Cinder سرویس‌ها و استخرهای ذخیره‌سازی‌اش را برای مدیر نگه می‌دارد. پس آنچه یک اعتبارنامه می‌تواند بخواند به سطحی بستگی دارد که انتخاب می‌کنید. این پاسخی است که پنج ابر واقعی روی Epoxy، Flamingo، Gazpacho (OVN و OVS) و Hibiscus دادند:",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| خواندن | سطح 1: نمای کامل | سطح 2: فقط زیرساخت | سطح 3: نمای پروژه |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone: پروژه‌ها | همه | همه | ردشده |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone: دامنه‌ها | همه | همه | ردشده |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone: منطقه‌ها | همه | آنچه همه می‌بینند | آنچه همه می‌بینند |",
  "| Keystone: services | all | all | refused |":
    "| Keystone: سرویس‌ها | همه | همه | ردشده |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone: نقاط پایانی | همه | همه | ردشده |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova: سرورها، همه پروژه‌ها | همه | همه | ردشده |",
  "| Nova: services | all | all | refused |":
    "| Nova: سرویس‌ها | همه | همه | ردشده |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova: هایپروایزرها | همه | همه | ردشده |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova: تجمیع‌ها | همه | همه | ردشده |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova: نواحی دسترس‌پذیری، جزئیات | همه | همه | ردشده |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova: فلیورها | همه | آنچه همه می‌بینند | آنچه همه می‌بینند |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova: مصرف به‌ازای هر پروژه | همه | همه | ردشده |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement: فراهم‌کنندگان منابع | همه | همه | ردشده |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron: عامل‌ها | همه | همه | هیچ |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron: شبکه‌ها | همه | فقط پروژه خودش | فقط پروژه خودش |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron: زیرشبکه‌ها | همه | فقط پروژه خودش | فقط پروژه خودش |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron: روترها | همه | فقط پروژه خودش | فقط پروژه خودش |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron: IPهای شناور | همه | فقط پروژه خودش | فقط پروژه خودش |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron: دسترس‌پذیری IP | همه | همه | هیچ |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron: گروه‌های امنیتی | همه | 409، مورد انتظار | فقط پروژه خودش |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron: پورت‌ها | همه | فقط پروژه خودش | فقط پروژه خودش |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron: سهمیه‌ها | همه | ردشده | ردشده |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder: حجم‌ها، همه پروژه‌ها | همه | فقط پروژه خودش | فقط پروژه خودش |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder: سرویس‌ها | همه | ردشده | ردشده |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder: استخرها | همه | ردشده | ردشده |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder: اسنپ‌شات‌ها، همه پروژه‌ها | همه | فقط پروژه خودش | فقط پروژه خودش |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder: پشتیبان‌ها، همه پروژه‌ها | همه | چیزی ثبت نشد | چیزی ثبت نشد |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder: انواع حجم | همه | آنچه همه می‌بینند | آنچه همه می‌بینند |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance: ایمیج‌ها | همه | آنچه همه می‌بینند | آنچه همه می‌بینند |",
  "- **all**: the same rows an admin saw.":
    "- **همه**: همان ردیف‌هایی که یک مدیر دید.",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **فقط پروژه خودش**: ردیف‌های آن پروژه، و هر چیز مشترک یا خارجی. روی پروژه‌ای که چیزی ندارد، فقط همان موارد مشترک و خارجی است.",
  "- **refused**: a `401` or a `403`.": "- **ردشده**: یک `401` یا یک `403`.",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **آنچه همه می‌بینند**: هر اعتبارنامه‌ای هر ردیفی را دید، روی ابرهایی که فقط فلیورها، انواع حجم و ایمیج‌های عمومی دارند. یک مورد خصوصی در پروژه‌ای دیگر **نمای کامل** می‌خواهد.",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **هیچ**: یک `200` بدون هیچ ردیفی، روی پروژه‌ای که شبکه هم دارد. به نظر می‌رسد کار کرده، و نکرده است.",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **چیزی ثبت نشد**: یک `200` بدون هیچ ردیفی جایی که مدیر هم چیزی ندید، پس چیزی برای تشخیص نبود.",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409، مورد انتظار**: Neutron هنگام فهرست کردن گروه‌های امنیتی می‌کوشد گروه امنیتی پیش‌فرض پروژه را بسازد، و سهمیه صفر اجازه نمی‌دهد، پس با `409 Quota exceeded` پاسخ می‌دهد. این بی‌خطر است، و چیزی برای اصلاح نیست.",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "فهرستی که یک اعتبارنامه نمی‌تواند بخواند اینجا خالی به نظر می‌رسد: `troubleshoot.sh` می‌گوید این اعتبارنامه چه چیزی را می‌تواند بخواند و هر کمبود چه هزینه‌ای دارد.",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "پایش هرگز نباید عامل از کار افتادن یک ابر باشد، پس عامل به‌طور پیش‌فرض ملایم است:",
  "| Reads | Every | Gives |": "| چه چیزی را می‌خواند | هر | چه می‌دهد |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **محاسبه (Nova)** | 2 دقیقه | سرویس‌ها، هایپروایزرها، اینستنس‌ها و فلیورها |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2 دقیقه | آنچه هر هایپروایزر می‌تواند وعده دهد، و وعده داده است |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **شبکه (Neutron)** | 2 دقیقه | عامل‌ها، شبکه‌ها، زیرشبکه‌ها، مصرف نشانی، روترها و IPهای شناور |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **ذخیره‌سازی بلوکی (Cinder)** | 2 دقیقه | سرویس‌ها، حجم‌ها، اسنپ‌شات‌ها و استخرهای ذخیره‌سازی |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **هویت (Keystone)** | 5 دقیقه | پروژه‌ها و دامنه‌ها |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **ایمیج‌ها (Glance)** | 5 دقیقه | ایمیج‌ها |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- هر سرویس جداگانه خوانده می‌شود، پس Nova‌ای که از کار افتاده فقط اعداد Nova را از دست می‌دهد و بقیه به گزارش دادن ادامه می‌دهند.",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- یک خواندن هرگز از بازه خود طولانی‌تر نمی‌شود، پس خواندن کُند هرگز روی بعدی انباشته نمی‌شود.",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- سهمیه‌های هر پروژه خاموش است. برای روشن کردن آن‌ها، نصب‌کننده را دوباره با `OPENSTACK_COLLECT_QUOTAS=true` اجرا کنید: یک اکسپورتر دوم آن‌ها را ساعتی یک بار می‌خواند، با چهار فراخوانی برای هر پروژه در هر منطقه. سهمیه‌های Neutron فقط به **نمای کامل** پاسخ می‌دهند.",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- فهرست‌های سهمیه خود Nova و مصرف به‌ازای هر سرور خاموش است. برای روشن کردن یکی، خط `--disable-metric` آن را از `command` اکسپورتر در `docker-compose.yml` حذف کنید. هزینه آن یک فراخوانی برای هر پروژه در هر برداشت است.",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- سری‌های به‌ازای هر پورت خاموش است: فهرست کردن همه پورت‌ها با اعتبارنامه مدیر می‌تواند Neutron را روی یک ابر بزرگ اشباع کند.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "یک ابر یک Keystone است، هر چند منطقه که داشته باشد، و یک عامل همه آن‌ها را می‌خواند. نام هر منطقه را به اسکریپت نصب بدهید. برای هر کدام یک ورودی `clouds.yaml` می‌نویسد. هر ورودی باید به نام منطقه خودش باشد: کالکتور آن نام را به‌صورت `openstack.region.name` روی سری‌های اکسپورتر می‌زند، چون سری‌ها نمی‌گویند از کدام منطقه هستند. آن‌گاه هر فهرست در OneUptime بر اساس منطقه فیلتر می‌شود.",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "منطقه‌هایی که Keystone خودشان را دارند برای OneUptime ابرهای جداگانه‌اند: برای هر کدام یک عامل اجرا کنید.",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "**[ابرهای بسیار بزرگ OpenStack](/docs/telemetry/openstack-very-large-clouds)** می‌گوید هر اندازه چه هزینه‌ای دارد و هر کدام از این‌ها چگونه کار می‌کند.",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**بیش از 5,000 اینستنس، حالت خلاصه.** ابر برای هر بخش یک ردیف و شمارش‌هایی به‌ازای هر هایپروایزر، پروژه و وضعیت نگه می‌دارد، و سری‌های آن به‌ازای هر اینستنس و هر حجم متوقف می‌شوند. از تاریخچه وضعیت هر اینستنس و حجمی که آرام گرفته، و از هر نمودار یا مانیتوری روی آن سری‌ها چشم می‌پوشد. اینستنس یا حجمی که در وضعیتی است که یک هشدار آن را می‌پاید سری‌هایش را نگه می‌دارد، پس هر الگوی هشدار همچنان کار می‌کند. برای نگه داشتن آن‌ها برای برخی، پروژه‌هایشان را زیر **مصرف واقعی به‌ازای هر اینستنس** در صفحه **تنظیمات** ابر انتخاب کنید.",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**تقسیم یک ابر میان عامل‌ها.** برای هر منطقه، یا برای بزرگ‌ترین ابرها برای هر سرویس، یک عامل اجرا کنید، هر کدام با همان `OPENSTACK_CLOUD_NAME`. یک منطقه و یک سرویس متعلق به یک عامل‌اند، و Keystone برای کل ابر متعلق به یک عامل، وگرنه سری‌هایشان دو بار می‌رسند. منطقه‌های یک عامل را در `OPENSTACK_EXPORTER_CLOUDS` فهرست کنید، و سرویس‌هایش را در `OPENSTACK_AGENT_SERVICES`، مانند `compute|placement`.",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**بیش از 1,500 هایپروایزر یا 100,000 اینستنس، مسیر پایگاه‌داده.** عامل می‌تواند به‌جای APIهای ابر، پایگاه‌داده‌های آن را بخواند، که در این اندازه نمی‌توان آن‌ها را در زمان یک برداشت خواند. به یک حساب فقط‌خواندنی روی پایگاه‌داده هر سرویس، مسیری از این ماشین تا آن‌ها، و یک اکسپورتر برای هر منطقه و سلول Nova نیاز دارد. همان سری‌ها را می‌خواند، جز اینکه آیا هر worker در Nova زنده است و هر استخر ذخیره‌سازی چقدر پر است، که هنوز از API می‌خواند، و نمی‌تواند بگوید آیا یک API پاسخ می‌دهد. هنوز روی یک پایگاه‌داده واقعی اجرا نشده است.",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "اسکریپت نصب این‌ها را در `/opt/oneuptime-openstack-agent/.env` می‌نویسد. پس از تغییر هر کدام، آن را با `docker compose up -d` در `/opt/oneuptime-openstack-agent` اعمال کنید.",
  "| Variable | Required | Description |": "| متغیر | الزامی | توضیح |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | بله | نشانی URL نمونه OneUptime شما (مثلاً `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | کلید دریافت داده تله‌متری: همانی که در گام 1 انتخاب شد |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | بله | نام ابر در OneUptime، که به‌صورت ویژگی منبع `openstack.cloud.name` روی هر متریک زده می‌شود. آن را ثابت نگه دارید: تغییر آن یک ابر تازه ثبت می‌کند |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | بله | ورودی‌های `clouds.yaml` برای خواندن، یکی برای هر منطقه و به نام همان منطقه، در کروشه: `[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | اکسپورتر همراه | نشانی احراز هویت Keystone. اگر `/v3` نباشد اضافه می‌شود |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | خیر | `host:port` اکسپورتر خودتان، بدون طرح نشانی. برای اکسپورتر همراه آن را خالی بگذارید |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | خیر | ورودی‌های `clouds.yaml` که سهمیه‌های هر پروژه ساعتی یک بار از آن‌ها خوانده می‌شود. اسکریپت نصب وقتی با `OPENSTACK_COLLECT_QUOTAS=true` اجرا شود آن را تنظیم می‌کند |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | خیر | `host:port` اکسپورتری که آن‌ها را می‌خواند. برای اکسپورتر همراه آن را خالی بگذارید |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | خیر | `uid:gid` که کانتینر اکسپورتر با آن اجرا می‌شود و باید مالک `clouds.yaml` باشد (پیش‌فرض: `65532:65532`) |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | خیر | یک فایل PEM با مرجع صدور گواهی ابری که مرجع خودش را دارد |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | اکسپورتر همراه | `openstack-exporter` اکسپورتر همراه را راه می‌اندازد، و `openstack-ai-agent` عامل هوش مصنوعی OneUptime را |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | خیر | اکسپورتری که از قبل بدون `--multi-cloud` اجرا می‌شود، مانند اکسپورتر Kolla-Ansible: `[10.0.0.254:9198]`. همراه آن `OPENSTACK_EXPORTER_CLOUDS=[]` را تنظیم کنید |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | خیر | افزونه Prometheus در RabbitMQ روی هر گره: `[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | خیر | mysqld_exporter کنار هر گره MariaDB، معمولاً روی `9104` |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | خیر | memcached_exporter کنار هر Memcached، معمولاً روی `9150` |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | خیر | اکسپورتر Prometheus خود HAProxy |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | خیر | openstack-network-exporter روی هر گره، برای OVN و Open vSwitch، معمولاً روی `1981` |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | خیر | prometheus-libvirt-exporter روی هر گره محاسباتی، معمولاً روی `9177`، برای اینکه libvirt پاسخ می‌دهد یا نه، و هیچ چیز به‌ازای هر اینستنس |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | خیر | منطقه هدفی از بالا که منطقه خودش را نمی‌گوید. یک هدف می‌تواند بگوید: `RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | خیر | همان اکسپورتر، برای اینکه هر اینستنس واقعاً چه می‌کند. سری‌های به‌ازای هر اینستنس سریع چند برابر می‌شوند |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | خیر | اکسپورتر Ceilometer روی هر گره محاسباتی، معمولاً روی `9101`، برای همان کار |",
  "`clouds.yaml` alone holds the credential.":
    "فقط `clouds.yaml` اعتبارنامه را در خود دارد.",
  "Only the largest clouds need these, and none is asked for:":
    "فقط بزرگ‌ترین ابرها به این‌ها نیاز دارند، و هیچ‌کدام پرسیده نمی‌شود:",
  "| Variable | Description |": "| متغیر | توضیح |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | اینکه این عامل کدام سرویس‌ها را می‌خواند، به‌صورت یک الگو: اینجا `compute\\|placement` و بقیه روی عامل دوم. به‌طور پیش‌فرض همه سرویس‌ها. هیچ دو عاملی نباید یک سرویس از یک منطقه را بخوانند |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | حافظه‌ای که کالکتور می‌تواند به کار ببرد، بر حسب MiB (پیش‌فرض: `512`). یک برداشت کامل را نگه می‌دارد، پس از ده‌ها هزار اینستنس به بالا آن را افزایش دهید |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | خواندن پایگاه‌داده هر سرویس به‌جای API آن، با یک حساب فقط‌خواندنی: جایی که آن اکسپورتر پاسخ می‌دهد. همراه آن `OPENSTACK_EXPORTER_CLOUDS=[]` را تنظیم کنید، وگرنه هر سری دو بار می‌رسد |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | پایگاه‌داده هر سرویسی که می‌خواند، به‌صورت `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. موردی که خالی بماند سرویسی است که به آن دست نمی‌زند. هر کدام یک گذرواژه دارد، و `.env` فقط برای مالکش خواندنی است |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | آنچه Nova به نام یک میزبان اضافه می‌کند تا نام یک هایپروایزر ساخته شود، مانند `.example.org`، تا یک اینستنس هایپروایزری را که روی آن اجرا می‌شود پیدا کند |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | ورودی‌های `clouds.yaml` برای خواندن آنچه پایگاه‌داده‌های Nova و Cinder نمی‌توانند بگویند، از APIهای آن‌ها: اینکه آیا هر worker زنده است، و هر استخر چقدر پر است |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` اکسپورتری که آن‌ها را می‌خواند. برای اکسپورتر همراه آن را خالی بگذارید |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | ورودی‌های `clouds.yaml` که سهمیه‌های هر پروژه ساعتی یک بار از آن‌ها خوانده می‌شود. خالی یعنی هیچ‌کدام خوانده نمی‌شود، و `OPENSTACK_COLLECT_QUOTAS=true` در اسکریپت نصب آن را پر می‌کند |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "عامل هوش مصنوعی OneUptime اعتبارنامه درون `clouds.yaml` را می‌خواند مگر اینکه این‌ها چیز دیگری بگویند، و هیچ‌کدام پرسیده نمی‌شود:",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false` جلوی بررسی این ابر با عامل توسط OneUptime AI را می‌گیرد |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | `clouds.yaml` که سوار می‌کند. `/dev/null` وقتی اعتبارنامه خودش را دارد و چنین فایلی کنارش نیست |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | ورودی `clouds.yaml` برای استفاده، وقتی نخستین مورد `OPENSTACK_EXPORTER_CLOUDS` نیست |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | یک اعتبارنامه مخصوص خودش، که به‌جای اعتبارنامه `clouds.yaml` به کار می‌رود. هر دو را همراه با `OPENSTACK_AUTH_URL` تنظیم کنید |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | Keystone‌ای که اعتبارنامه مخصوص خودش به آن وارد می‌شود |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | منطقه‌ای که یک دستور وقتی هیچ منطقه‌ای را نام نمی‌برد می‌خواند، اینکه کدام نقاط پایانی را به کار می‌برد (`public`، `internal` یا `admin`)، و یک مرجع صدور گواهی. `clouds.yaml` این‌ها را می‌گوید مگر اینکه این متغیرها بگویند |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | نامی که با آن ثبت می‌شود، وقتی `OPENSTACK_CLOUD_NAME` نیست |",
  "| `LOG_LEVEL` | How much it logs |":
    "| `LOG_LEVEL` | اینکه چقدر لاگ می‌نویسد |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | تا وقتی تنظیم نشوند خاموش‌اند: به آن اجازه می‌دهند از طریق اعتبارنامه مخصوص خودشان تغییر ایجاد کند. راهنمای OpenStack می‌گوید چگونه آن را با کمترین دسترسی لازم بسازید |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | اینکه هوش مصنوعی چگونه می‌تواند یک اصلاح را اعمال کند: off، ask-for-approval، automatic یا bypass-approval. خالی: اصلاح‌ها خاموش می‌مانند تا کسی در این صفحه انتخاب کند |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | آنچه هرگز به آن دست زده نمی‌شود، هر چه دیگر تنظیم شده باشد و هر که آن را تأیید کند: `project:ID`، `host:NAME` یا `instance:ID`، جداشده با ویرگول |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | جایی که تغییرها می‌توانند اعمال شوند، به همان شکل نوشته‌شده. خالی: هر جایی که محافظت‌شده نیست |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "هنگام اجرای اسکریپت نصب `OPENSTACK_EXPORTER_ADDRESS` را تنظیم کنید، مانند `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. آن‌گاه اکسپورتر همراه هرگز راه‌اندازی نمی‌شود، و هیچ نشانی Keystone یا اعتبارنامه‌ای پرسیده نمی‌شود.",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "اکسپورتر شما باید با `--multi-cloud` اجرا شود، و `clouds.yaml` آن برای هر منطقه به یک ورودی به نام همان منطقه نیاز دارد. آنچه را اکسپورتر همراه خاموش می‌کند خاموش کنید: **آنچه عامل جمع‌آوری می‌کند و هزینه آن برای ابر شما** را ببینید. نشانی‌ای را به کار ببرید که کانتینر عامل به آن دسترسی دارد: `localhost` درون کانتینر خود همان کانتینر است.",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**بدون `--multi-cloud` راه‌اندازی شده؟** اکسپورتر Kolla-Ansible این‌طور است، و charm شرکت Canonical هم. `/probe` ندارد، پس به‌جای نشانی بالا `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` را تنظیم کنید، همراه با `OPENSTACK_EXPORTER_CLOUDS=[]` و `OPENSTACK_CONTROL_PLANE_REGION`. آن‌گاه هر 2 دقیقه همه چیز یک‌جا از آن خواسته می‌شود.",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**روی اکسپورتر 1.7.0،** که Kolla-Ansible آن را پین می‌کند، به هر دو شکل پاسخ می‌دهد، و صفحه‌ها آنچه را نمی‌گوید ندارند. روی پنج ابر واقعی این بود:",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "وقتی اسکریپت نصب فایل CA خصوصی را پرسید، فایل را به آن بدهید. آن را در `ca.pem` کپی می‌کند و در `clouds.yaml` نام می‌برد.",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "روی Linux (x86_64 یا arm64) با systemd 235 یا بالاتر و glibc 2.34 یا بالاتر (نه RHEL 8)، اسکریپت نصب می‌تواند به‌جای آن همان نسخه‌های کالکتور و اکسپورتر را به‌صورت سرویس‌های systemd اجرا کند:",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "از نصب Docker کوچ می‌کنید؟ ابتدا `docker compose down` را اجرا کنید، وگرنه هر متریک دو بار می‌رسد. اجرای دوباره اسکریپت همان روشی را که بود نگه می‌دارد، پس `sudo bash install.sh` همان ارتقاست.",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "پردازنده `resource` در `otel-collector-config.yaml` نام ابر را روی هر متریک می‌زند. OneUptime ابر را از روی آن ویژگی ثبت می‌کند، و هر صفحه و مانیتور بر اساس آن محدود می‌شود. دو حذف جلوی ثبت یک سرویس به نام کار برداشت در OneUptime را می‌گیرند، پس اگر فایل را سفارشی می‌کنید آن‌ها را نگه دارید:",
  "The whole file is on this OneUptime:": "کل فایل روی همین OneUptime است:",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "هر ویژگی منبعی که با `oneuptime.label.` آغاز شود به یک برچسب پروژه روی ابر تبدیل می‌شود: `oneuptime.label.<dimension>=<value>` همان برچسب `<dimension>:<value>` است. آن‌ها را به پردازنده `resource` در `otel-collector-config.yaml`، کنار `openstack.cloud.name` اضافه کنید:",
  "Then restart the collector so it reads the new config:":
    "سپس کالکتور را دوباره راه بیندازید تا پیکربندی تازه را بخواند:",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "ابر با برچسب‌های `team:platform` و `env:production` ظاهر می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف مقایسه می‌شوند، پس یک برچسب `Production` موجود دوباره به کار می‌رود؛ برچسب‌هایی که در رابط OneUptime افزوده شده‌اند هرگز توسط عامل حذف نمی‌شوند.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**ارتقا.** ایمیج‌ها در `docker-compose.yml` پین شده‌اند و پیکربندی آن فایلی کنار آن است، پس فقط pull کردن عامل را جلو نمی‌برد. اسکریپت نصب را دوباره اجرا کنید. هر مقدار در `.env` و `clouds.yaml` موجود شما را دوباره به کار می‌برد (چیزی دوباره پرسیده نمی‌شود)، تازه‌ترین فایل‌ها را دانلود می‌کند (فایلی که ویرایش کرده‌اید کنار فایل تازه به‌صورت `<file>.bak.<timestamp>` نگه داشته می‌شود)، ایمیج‌ها را pull می‌کند و عامل را با آن‌ها از نو می‌سازد:",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "پیکربندی نسخه کالکتوری را که پین می‌کند به‌عنوان **نسخه عامل** ابر گزارش می‌دهد. وقتی این OneUptime نسخه تازه‌تری را پین کند، یک نشانه هشدار کنار آن این دستورها را باز می‌کند.",
  "**Uninstall** the agent:": "عامل را **حذف نصب** کنید:",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "سپس `/opt/oneuptime-openstack-agent` را که اعتبارنامه را در خود دارد، و خود اعتبارنامه برنامه را حذف کنید: `openstack application credential delete oneuptime-agent`.",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh` کل زنجیره را بررسی می‌کند، از DNS و TLS تا Keystone، هر سرویس در کاتالوگ و کلید دریافت داده شما، و می‌گوید این اعتبارنامه چه چیزی را می‌تواند بخواند و هر کمبود چه هزینه‌ای دارد.",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "برای خواندن `clouds.yaml` به `sudo` نیاز دارد، وگرنه بررسی‌های اعتبارنامه را رد می‌کند. با حکمی پایان می‌یابد که محتمل‌ترین علت را نام می‌برد.",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. بررسی کنید که عامل در حال اجراست (در `/opt/oneuptime-openstack-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. لاگ‌های عامل را از نظر خطا بررسی کنید: `docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تأیید کنید که نشانی OneUptime و کلید دریافت داده شما درست هستند.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. مطمئن شوید که ماشین عامل از طریق شبکه به نمونه OneUptime دسترسی دارد.",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "اعتبارنامه **نمای پروژه** نمی‌تواند آن‌ها را بخواند، و نقشی بدون بازنویسی‌های سیاست هم نمی‌تواند: Nova، Neutron و Placement آن‌ها را به‌طور پیش‌فرض برای مدیران نگه می‌دارند. **نمای کامل** را به کار ببرید، یا **فقط زیرساخت** را با فایل‌های `access/policy` ادغام‌شده در فایلی که `[oslo_policy] policy_file` هر سرویس نام می‌برد. `troubleshoot.sh` می‌گوید کدام خواندن‌ها رد شدند.",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "فقط **نمای کامل** وضعیت `cinder-volume` و `cinder-scheduler` و استخرهای ذخیره‌سازی را می‌بیند. کد خود Cinder به هر چیز دیگری با `403 User does not have admin privileges` پاسخ می‌دهد، پس از عبور از سیاست، پس هیچ بازنویسی‌ای آن‌ها را باز نمی‌کند.",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron و Cinder به هر چیزی جز مدیر با `200` و فقط پروژه خودش پاسخ می‌دهند، که به نظر می‌رسد کار کرده است. دیدن همه پروژه‌ها **نمای کامل** می‌خواهد. با **فقط زیرساخت**، این‌ها برای پروژه‌هایی ظاهر می‌شوند که نقش روی آن‌ها اختصاص داده شده، و نقشی روی یک پروژه واقعی روی بسیاری از ابرها می‌تواند آنجا بنویسد.",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "اعتبارنامه **نمای پروژه** از طریق عامل هیچ اینستنسی نشان نمی‌دهد: اکسپورتر از Nova سرورهای همه پروژه‌ها را می‌خواهد، Nova یک خواننده ساده را رد می‌کند، و آن خواندن به‌کلی شکست می‌خورد. **نمای کامل** و **فقط زیرساخت** هر دو اینستنس‌های همه پروژه‌ها را می‌بینند.",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "با **فقط زیرساخت** این مورد انتظار است، و بی‌خطر. Neutron هنگام فهرست کردن گروه‌های امنیتی می‌کوشد گروه امنیتی پیش‌فرض پروژه را بسازد، و پروژه‌ای با سهمیه صفر نمی‌تواند یکی داشته باشد. چیزی برای اصلاح نیست.",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "روی Flamingo و Epoxy، به محض اینکه فایل سیاستی که oslo.policy خوانده از بین برود، در هر بررسی خطا می‌دهد، و وقتی آن سرویس Keystone باشد کل ابر با `503` پاسخ می‌دهد. سرویس را دوباره راه‌اندازی کنید. برای برداشتن بازنویسی‌ها، فایل را خالی کنید (`{}`) و هرگز آن را حذف نکنید.",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "عامل هر سرویس را جداگانه می‌خواند، پس سرویسی که از کار افتاده فقط اعداد خودش را از دست می‌دهد. ببینید چرا اکسپورتر نمی‌تواند آن را بخواند (در `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. صفحه **سرویس‌ها** آن API را `down` نشان می‌دهد. اعتبارنامه‌ای با قواعد دسترسی که از نسخه قدیمی‌تری از قواعد ساخته شده هم روی Swift، و روی Octavia پشت یک مسیر، همین کار را می‌کند: یک اعتبارنامه تازه بسازید، همان‌طور که **نمای کامل** می‌گوید.",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "سرویس‌ها اعتبارنامه‌ای را که با قواعد دسترسی محدود شده رد می‌کنند. سرویسی که پشت یک پیشوند مسیر است قواعد همراه را رد می‌کند: آن‌ها را با `access-rules-for-cloud.py` با این ابر تطبیق دهید، همان‌طور که **نمای کامل** می‌گوید. و هر سرویس به `service_type` تنظیم‌شده برای keystonemiddleware، و یک راه‌اندازی دوباره نیاز دارد:",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "اگر نمی‌خواهید آن را تغییر دهید، اعتبارنامه را بدون `--access-rules` بسازید، با علم به اینکه می‌تواند بنویسد.",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "اکسپورتر با uid 65532 اجرا می‌شود، و `clouds.yaml` فقط برای مالکش خواندنی است. فایل را به آن کاربر بدهید، یا `OPENSTACK_EXPORTER_USER` را در `.env` روی `uid:gid` مالک فایل تنظیم کنید، و آن را با `docker compose up -d` اعمال کنید.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "هویت ابر از `OPENSTACK_CLOUD_NAME` می‌آید، که به‌صورت `openstack.cloud.name` روی هر متریک زده می‌شود. آن را در `.env` اصلاح کنید و با `docker compose up -d` در `/opt/oneuptime-openstack-agent` اعمال کنید. یک نام تازه یک ابر تازه ثبت می‌کند.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "هویت ابر از `OPENSTACK_CLOUD_NAME` می‌آید، که به‌صورت `openstack.cloud.name` روی هر متریک زده می‌شود. این ابر **`cloud-1`** است. آن را در `.env` اصلاح کنید و با `docker compose up -d` در `/opt/oneuptime-openstack-agent` اعمال کنید. یک نام تازه یک ابر تازه ثبت می‌کند.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "Docker Engine 20.10+ با افزونه Docker Compose v2، روی ماشینی که عامل را اجرا خواهد کرد",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "`docker-compose.yml` و `otel-collector-config.yaml` را از این OneUptime در یک پوشه تازه دانلود کنید:",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "کنار آن‌ها یک فایل `clouds.yaml` بسازید، با اعتبارنامه گام پیش. برای هر منطقه به یک ورودی نیاز دارد، هر کدام به نام منطقه خودش، چون سری‌های اکسپورتر نمی‌گویند از کدام منطقه هستند:",
  "Create a `.env` file next to them too:":
    "کنار آن‌ها یک فایل `.env` هم بسازید:",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- `my-openstack-cloud` را با نامی برای این ابر جایگزین کنید، مانند `prod-eu`. ابر با همین نام در OneUptime نشان داده می‌شود، پس آن را ثابت نگه دارید: یک نام تازه یک ابر تازه ثبت می‌کند.",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- هر منطقه را در `OPENSTACK_EXPORTER_CLOUDS`، درون کروشه فهرست کنید، مانند `[RegionOne,RegionTwo]`.",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` اکسپورتر همراه را راه می‌اندازد، که ابر را با `clouds.yaml` می‌خواند، و عامل هوش مصنوعی OneUptime را، که هنگام بررسی OneUptime AI ابر را با همان فایل می‌خواند.",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "هر دو فایل رازها را در خود دارند، پس آن‌ها را فقط در دسترس مالکشان بگذارید. اکسپورتر با uid 65532 اجرا می‌شود و باید تنها حسابی باشد که می‌تواند `clouds.yaml` را بخواند. سپس عامل را راه‌اندازی کنید:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در گام 1 یک کلید دریافت داده انتخاب کنید.",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "یک ابر یک Keystone است، هر چند منطقه که داشته باشد، و یک عامل همه آن‌ها را می‌خواند. برای هر منطقه یک ورودی `clouds.yaml` اضافه کنید، و همه را در `OPENSTACK_EXPORTER_CLOUDS` فهرست کنید. هر ورودی باید به نام منطقه خودش باشد: کالکتور آن نام را به‌صورت `openstack.region.name` روی سری‌های اکسپورتر می‌زند، چون سری‌ها نمی‌گویند از کدام منطقه هستند. آن‌گاه هر فهرست در OneUptime بر اساس منطقه فیلتر می‌شود.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "عامل این‌ها را از فایل `.env` کنار `docker-compose.yml` می‌خواند. پس از تغییر هر کدام، آن را با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "`COMPOSE_PROFILES` را از `.env` حذف کنید و عامل را به اکسپورتر خودتان نشانه بگیرید، به‌صورت `host:port` بدون طرح نشانی: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. آن‌گاه اکسپورتر همراه هرگز راه‌اندازی نمی‌شود.",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "فایل را کنار `docker-compose.yml` با نام `ca.pem` بگذارید، `OPENSTACK_CA_FILE=./ca.pem` را در `.env` تنظیم کنید، و `cacert: /etc/openstack/ca.pem` را به هر ورودی `clouds.yaml` اضافه کنید.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "این‌ها را در پوشه عامل اجرا کنید، همان که `docker-compose.yml` در آن است.",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**ارتقا.** ایمیج‌ها در `docker-compose.yml` پین شده‌اند و پیکربندی آن فایلی کنار آن است، پس فقط pull کردن عامل را جلو نمی‌برد. هر دو فایل را دوباره دانلود کنید؛ `.env` و `clouds.yaml` شما می‌مانند، و تغییری که در هر کدام از دو فایل دانلودشده داده بودید باید دوباره انجام شود:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "سپس ایمیج‌ها را pull کنید و عامل را از نو بسازید، تا کالکتور پیکربندی تازه‌اش را بخواند:",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "سپس پوشه‌ای که `docker-compose.yml` در آن است و اعتبارنامه را در خود دارد، و خود اعتبارنامه برنامه را حذف کنید: `openstack application credential delete oneuptime-agent`.",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. بررسی کنید که عامل در حال اجراست (در پوشه عامل): `docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "عامل هر سرویس را جداگانه می‌خواند، پس سرویسی که از کار افتاده فقط اعداد خودش را از دست می‌دهد. ببینید چرا اکسپورتر نمی‌تواند آن را بخواند (در پوشه عامل): `docker compose logs oneuptime-openstack-exporter`. صفحه **سرویس‌ها** آن API را `down` نشان می‌دهد. اعتبارنامه‌ای با قواعد دسترسی که از نسخه قدیمی‌تری از قواعد ساخته شده هم روی Swift، و روی Octavia پشت یک مسیر، همین کار را می‌کند: یک اعتبارنامه تازه بسازید، همان‌طور که **نمای کامل** می‌گوید.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "هویت ابر از `OPENSTACK_CLOUD_NAME` می‌آید، که به‌صورت `openstack.cloud.name` روی هر متریک زده می‌شود. آن را در `.env` اصلاح کنید و با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید. یک نام تازه یک ابر تازه ثبت می‌کند.",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- این کار عامل را برای **`cloud-1`** نصب می‌کند. `OPENSTACK_CLOUD_NAME` را دقیقاً همان‌طور که هست نگه دارید، وگرنه داده‌ها به‌عنوان یک ابر تازه ثبت می‌شوند.",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "هویت ابر از `OPENSTACK_CLOUD_NAME` می‌آید، که به‌صورت `openstack.cloud.name` روی هر متریک زده می‌شود. این ابر **`cloud-1`** است. آن را در `.env` اصلاح کنید و با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید. یک نام تازه یک ابر تازه ثبت می‌کند.",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible لاگ‌های سرویس‌هایش را در journald نگه می‌دارد و هیچ Prometheus خودی اجرا نمی‌کند، پس عامل راه ورود است، و لاگ‌ها مسیر جداگانه خودشان را دارند.",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**این راهنما تا کجا آزموده شده است:** مسیرها و متغیرهای آن از کد منبع و مستندات خود OpenStack-Ansible خوانده شد. سپس دستورهای آن روی یک all-in-one واقعی با stable/2026.1، در کانتینرهای LXC اجرا شد، با جانشینی برای OneUptime که آنچه عامل می‌فرستاد را نگه می‌داشت: عامل با اعتبارنامه نمای کامل، اکسپورتر عامل با اعتبارنامه فقط زیرساخت و بازنویسی‌های سیاست آن، تنظیمات RabbitMQ و HAProxy که عامل هر کدام را می‌خواند، و پروفایل لاگ روی journal. عامل و یک پراب هر کدام یک DevStack واقعی را تا یک OneUptime در حال اجرا رسانده‌اند، از میان یک nova-compute متوقف‌شده و بازگشت آن، اما نه از این ابزار.",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- از کانتینر utility به‌عنوان مدیر وارد شوید: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`، سپس `. ~/openrc`. این کانتینر `curl` ندارد، که دستورهای زیر به کار می‌برند، پس ابتدا `apt-get install -y curl` را آنجا اجرا کنید.",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **نمای کامل** به یک تغییر در Cinder نیاز دارد. نقش‌های OpenStack-Ansible از قبل `service_type` را زیر `[keystone_authtoken]` تنظیم می‌کنند، اما Cinder آن `volumev3` می‌گوید و کاتالوگ آن `block-storage`، و keystonemiddleware اعتبارنامه‌ای را که با قواعد دسترسی محدود شده با `401` رد می‌کند مگر اینکه این دو یکی باشند. `service_type: block-storage` را زیر `keystone_authtoken` در `cinder_cinder_conf_overrides` در `/etc/openstack_deploy/user_variables.yml` تنظیم کنید، سپس `openstack-ansible openstack.osa.cinder --tags cinder-config` را اجرا کنید.",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **فقط زیرساخت** بازنویسی‌هایش را به‌صورت `nova_policy_overrides`، `neutron_policy_overrides`، `keystone_policy_overrides` و `placement_policy_overrides` در `/etc/openstack_deploy/user_variables.yml` می‌گیرد. هر کدام را با playbook و برچسب خودش اعمال کنید، مانند `openstack-ansible openstack.osa.nova --tags nova-policy-override`. برداشتن یکی در آینده به‌جای هیچ فایلی یک فایل خالی بر جا می‌گذارد، پس چیزی شکست نمی‌خورد.",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ:** افزونه Prometheus آن را روشن کنید، سپس نشانی هر کانتینر روی `15692` را به‌عنوان `OPENSTACK_RABBITMQ_TARGETS` در `.env` عامل بنویسید:",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy:** اکسپورتر آن خاموش است، و شنونده آمار آن روی `127.0.0.1` با TLS است، که عامل نمی‌تواند بخواند. آن را جایی روشن کنید که عامل بتواند بخواند، سپس آن نشانی روی `1936` را به‌عنوان `OPENSTACK_HAPROXY_TARGETS` بنویسید:",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB و Memcached:** OpenStack-Ansible برای هیچ‌کدام اکسپورتری همراه ندارد. [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) و [memcached_exporter](https://github.com/prometheus/memcached_exporter) را خودتان اجرا کنید و آن‌ها را به‌عنوان `OPENSTACK_MARIADB_TARGETS` و `OPENSTACK_MEMCACHED_TARGETS` بنویسید، یا کنارشان بگذارید: آن‌گاه کارت **صفحه کنترل** ابر می‌گوید که پایش نمی‌شوند، نه اینکه سالم‌اند.",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "این کار پروفایل لاگ عامل را به‌صورت یک سرویس systemd اجرا می‌کند، و `/var/log/journal/` را می‌خواند، جایی که journalهای کانتینرهای OpenStack-Ansible می‌رسند.",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی گذرگاه. OneUptime آن‌ها را از همان‌جا می‌خواند، به محض اینکه **یافتن رویدادهای امنیتی در لاگ‌های شما** در **رویدادهای امنیتی ← اتصال‌ها** روشن باشد. پروفایل لاگ عامل هر دو را از journal می‌خواند.",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "این کار برای هر ورود یک خط می‌فرستد که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید؛ آن‌گاه آن تشخیص چیزی را می‌خواند که فیلتر ممیزی دیده است. مقدار دوم `notification_opt_out` به‌صورت یک مجموعه YAML وارد می‌شود، همان‌طور که [config_template آن](https://docs.openstack.org/ansible-config_template/latest/) یک کلید تکراری را می‌نویسد.",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "برای اینکه بدانید چه کسی از طریق Nova، Neutron، Cinder و Glance چه کرد، هر API تنظیم فیلتر را در بازنویسی‌های conf خود می‌گیرد، و خود فیلتر را در بازنویسی‌های paste، با `audit` درست پس از `authtoken` و فیلتر زمینه‌ای که در هر pipeline پس از آن می‌آید. این‌ها مربوط به Nova است، و همین در `neutron_neutron_conf_overrides` و `neutron_api_paste_ini_overrides`، `cinder_cinder_conf_overrides` و `cinder_api_paste_ini_overrides`، و `glance_glance_api_conf_overrides` و `glance_glance_api_paste_ini_overrides`:",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm چارت‌هایی برای Prometheus، Alertmanager و اکسپورترها ارائه می‌کند، و اینکه آن‌ها اجرا شوند یا نه با شماست. لایه کنترل آن در Kubernetes اجرا می‌شود، پس یک پراب APIها را می‌خواند و عامل Kubernetes پادها را می‌بیند.",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**این راهنما تا کجا آزموده شده است:** مقادیر چارت آن از کد منبع خود OpenStack-Helm خوانده شد. از ابتدا تا انتها روی یک استقرار واقعی با این ابزار دنبال نشده است. عامل و یک پراب هر کدام یک DevStack واقعی را تا یک OneUptime در حال اجرا رسانده‌اند، از میان یک nova-compute متوقف‌شده و بازگشت آن، اما نه از این ابزار. پراب و عامل Kubernetes هر کدام جداگانه آزموده شده‌اند، نه با هم روی این ابزار.",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "سپس گیرنده را زیر `conf.alertmanager` در مقادیر چارت اضافه کنید، و مسیر خود را به آن بفرستید:",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "**OpenStack ← همه ابرها** را باز کنید، روی **اتصال ابر** کلیک کنید، و نشانی Keystone، یک اعتبارنامه برنامه و پرابی را که باید به کار رود به آن بدهید. یک پراب فقط با HTTPS با یک ابر صحبت می‌کند. [OpenStack بدون عامل](/docs/telemetry/openstack-agentless) می‌گوید هر سطح دسترسی چه چیزی را می‌خواند، و آزمون اتصال می‌گوید سطح شما چه چیزی را می‌تواند بخواند. عامل از هر ماشینی که مسیری تا APIها دارد هم کار می‌کند: برای گام‌های آن، در بالا **مطمئن نیستم، یا چیز دیگری** را انتخاب کنید.",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "**Kubernetes ← مستندات** را برای این خوشه دنبال کنید. آن‌گاه پادها، لاگ‌هایشان و گره‌هایشان به صفحه‌های Kubernetes می‌رسند، و سرویس‌های OpenStack میان آن‌ها همان‌جا پایش می‌شوند.",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "برای اینکه لاگ‌های آن سرویس‌ها در صفحه **لاگ‌ها** این ابر هم باشند، هر stack trace یک رکورد، ابر را در مقادیر عامل نام ببرید، همراه با فضاهای نامی که سرویس‌هایش در آن‌ها اجرا می‌شوند:",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی گذرگاه. OneUptime آن‌ها را از همان‌جا می‌خواند، به محض اینکه **یافتن رویدادهای امنیتی در لاگ‌های شما** در **رویدادهای امنیتی ← اتصال‌ها** روشن باشد. عامل Kubernetes هر دو را از لاگ‌های پادها می‌خواند، با ابری که در مقادیرش نام برده شده.",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "`logging.conf` یک چارت ثبت‌کننده ریشه را روی `WARNING` نگه می‌دارد، و درایور لاگ زیر ثبت‌کننده خودش می‌نویسد، پس بدون ثبت‌کننده‌ای برای آن چیزی نوشته نمی‌شود. یک فهرست در مقادیر جایگزین فهرست چارت می‌شود، پس `keys` آنچه را فهرست چارت دارد در بر دارد، به‌علاوه این:",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "برای اینکه بدانید چه کسی از طریق Nova، Neutron و Cinder چه کرد، `conf.paste` چارت‌هایشان از قبل فیلتر ممیزی را در هر pipeline دارد، و باید به آن گفت کجا بنویسد. هر کدام به همان ثبت‌کننده در `conf.logging` نیاز دارد. چارت Glance نگاشت را دارد، اما نه فیلتر را و نه جایی برای آن در pipelineهایش: هر دو را به `conf.paste` آن اضافه کنید.",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere با قواعد هشدار خودش kube-prometheus-stack را اجرا می‌کند، و Loki را با Vector برای لاگ‌ها. ابتدا هشدارهایش را ارسال کنید، سپس یک پراب APIها را می‌خواند و عامل Kubernetes پادها را می‌بیند.",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**این راهنما تا کجا آزموده شده است:** پیکربندی آن از مستندات و کد منبع خود Atmosphere خوانده شد. از ابتدا تا انتها روی یک استقرار واقعی با این ابزار دنبال نشده است. عامل و یک پراب هر کدام یک DevStack واقعی را تا یک OneUptime در حال اجرا رسانده‌اند، از میان یک nova-compute متوقف‌شده و بازگشت آن، اما نه از این ابزار. پراب و عامل Kubernetes هر کدام جداگانه آزموده شده‌اند، نه با هم روی این ابزار.",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "سپس گیرنده را به پیکربندی Atmosphere خود اضافه کنید، کنار هر گیرنده‌ای که از قبل دارید، و آن را مستقر کنید:",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "برای اینکه بدانید چه کسی از طریق Nova، Neutron و Cinder چه کرد، چارت‌هایی که Atmosphere مستقر می‌کند از قبل فیلتر ممیزی را در هر pipeline دارند، و باید به آن گفت کجا بنویسد، در `nova_helm_values`، `neutron_helm_values` و `cinder_helm_values`. چارت Glance نه فیلتر را دارد و نه جایی برای آن در pipelineهایش: هر دو را به `conf.paste` آن، در `glance_helm_values` اضافه کنید.",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam می‌تواند Canonical Observability Stack را با `sunbeam enable observability embedded` مستقر کند. Canonical یک charm با نام `openstack-exporter` هم دارد، که اگر آن را اجرا کنید عامل می‌تواند بخواند.",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**این راهنما تا کجا آزموده شده است:** دستورهای آن از مستندات Canonical و کد منبع charmهای آن خوانده شد. از ابتدا تا انتها روی یک استقرار واقعی با این ابزار دنبال نشده است. عامل و یک پراب هر کدام یک DevStack واقعی را تا یک OneUptime در حال اجرا رسانده‌اند، از میان یک nova-compute متوقف‌شده و بازگشت آن، اما نه از این ابزار. هیچ چیز اینجا روی Sunbeam اجرا نشده است، و مستندات خود Sunbeam از charm اکسپورتر نامی نمی‌برد.",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "سپس به Alertmanager این پشته پیکربندی‌ای بدهید که گیرنده در آن باشد:",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "اگر charm `openstack-exporter` شرکت Canonical را اجرا می‌کنید، عامل می‌تواند آن را بدون اعتبارنامه‌ای از خودش بخواند. برای یک ابر روی `/metrics` پاسخ می‌دهد، روی پورت `9180` مگر اینکه تنظیم `port` آن را تغییر داده باشید. نشانی آن را با `juju status openstack-exporter` پیدا کنید:",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "اینکه کدام سری‌ها را می‌دهد به نسخه اکسپورتر درون snap آن بستگی دارد، که اینجا ثبت نشد: `bash troubleshoot.sh` می‌گوید آیا ابر را می‌خواند.",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "با روشن بودن observability، Loki این پشته لاگ‌های سرویس‌ها را نگه می‌دارد. OneUptime راهی برای خواندن Loki ندارد، و پروفایل لاگ عامل روی charmهای Sunbeam آزموده نشده است، پس هنوز هیچ چیز اینجا آن‌ها را گردآوری نمی‌کند.",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "charmهای Sunbeam پیکربندی هر سرویس را از قالب‌های خودشان می‌نویسند، و charm مربوط به Keystone هیچ تنظیمی برای مقصد اعلان‌ها ندارد. پس نه رد ممیزی Keystone و نه فیلتر ممیزی را نمی‌توان از بیرون charm روشن کرد، و هیچ چیز اینجا به رویدادهای امنیتی نمی‌رسد.",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "Telemetry Operator آن، اکسپورتر Prometheus مربوط به Ceilometer و یک پشته پایش با Alertmanager را روی OpenShift اجرا می‌کند. پیش‌تنظیم OpenShift در عامل Kubernetes لایه کنترل را پایش می‌کند، و اکسپورتر Ceilometer می‌گوید گره‌های محاسباتی چه می‌کنند.",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**این راهنما تا کجا آزموده شده است:** منابع آن از کد منبع خود Telemetry Operator خوانده شد. از ابتدا تا انتها روی یک استقرار واقعی با این ابزار دنبال نشده است. عامل و یک پراب هر کدام یک DevStack واقعی را تا یک OneUptime در حال اجرا رسانده‌اند، از میان یک nova-compute متوقف‌شده و بازگشت آن، اما نه از این ابزار. پیش‌تنظیم OpenShift و اکسپورتر Ceilometer هر کدام جداگانه آزموده شده‌اند، نه با هم روی این ابزار.",
  "Then apply a receiver the monitoring stack picks up:":
    "سپس گیرنده‌ای را اعمال کنید که پشته پایش آن را برمی‌دارد:",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "**Kubernetes ← مستندات** را برای این خوشه دنبال کنید، با **Red Hat OpenShift** انتخاب‌شده، که `preset=openshift` را تنظیم می‌کند. آن‌گاه پادها، لاگ‌هایشان و گره‌هایشان به صفحه‌های Kubernetes می‌رسند، و سرویس‌های OpenStack میان آن‌ها همان‌جا پایش می‌شوند.",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "یک پراب می‌گوید چه چیزی تخصیص یافته، نه چه چیزی مشغول است. برای خواندن مصرف واقعی، عامل را روی ماشینی اجرا کنید که به گره‌های محاسباتی دسترسی دارد، با `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` که هر گره را روی پورت Ceilometer، یعنی `9101`، نام می‌برد.",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "برای اینکه بدانید چه کسی از طریق Nova و Neutron چه کرد، هر کدام تنظیم فیلتر را در `customServiceConfig` خود می‌گیرد، و فایل paste خود را در `defaultConfigOverwrite`. اپراتورهای Cinder و Glance هیچ فایل paste‌ای نمی‌پذیرند، پس هیچ چیز اینجا به آن‌ها نمی‌رسد.",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight از قبل سرویس‌های OpenStack، MariaDB، Memcached، RabbitMQ و libvirt را با قواعد هشدار خودش پایش می‌کند. ابتدا هشدارهایش را ارسال کنید، سپس یک پراب APIها را می‌خواند.",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**این راهنما تا کجا آزموده شده است:** تنظیمات آن از مستندات Mirantis خوانده شد، که نمونه‌هایش به‌جای یک Webhook گیرنده‌های دیگری را نشان می‌دهند. از ابتدا تا انتها روی یک استقرار واقعی با این ابزار دنبال نشده است. عامل و یک پراب هر کدام یک DevStack واقعی را تا یک OneUptime در حال اجرا رسانده‌اند، از میان یک nova-compute متوقف‌شده و بازگشت آن، اما نه از این ابزار.",
  "Then add the receiver and its route to your StackLight values:":
    "سپس گیرنده و مسیر آن را به مقادیر StackLight خود اضافه کنید:",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "برای اینکه بدانید چه کسی از طریق Nova، Neutron، Cinder و Glance چه کرد، MOSK تنظیمی مخصوص خودش دارد، و فیلتر ممیزی از قبل سر جایش است. با درایور لاگ، هر سرویس در خروجی استاندارد خود می‌نویسد، و عامل Kubernetes آن را از لاگ‌های پادها می‌خواند، با ابری که در مقادیرش نام برده شده. هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی گذرگاه. OneUptime آن‌ها را از همان‌جا می‌خواند، به محض اینکه **یافتن رویدادهای امنیتی در لاگ‌های شما** در **رویدادهای امنیتی ← اتصال‌ها** روشن باشد.",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "آن تنظیم Keystone را پوشش نمی‌دهد. رد ممیزی خود آن `spec:services` را می‌گیرد، که Mirantis آن را اعتبارسنجی نمی‌کند و هیچ مسئولیتی در قبالش نمی‌پذیرد، پس این را با قرارداد پشتیبانی خود بسنجید:",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "رد ممیزی Keystone می‌گوید چه کسی وارد شد و چه کسی چه چیزی را در Keystone تغییر داد، و فیلتر ممیزی می‌گوید چه کسی از طریق Nova، Neutron، Cinder و Glance چه کرد. هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی گذرگاه. OneUptime آن‌ها را از همان‌جا می‌خواند، به محض اینکه **یافتن رویدادهای امنیتی در لاگ‌های شما** در **رویدادهای امنیتی ← اتصال‌ها** روشن باشد.",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "فیلتر ممیزی در فایل paste هر API قرار می‌گیرد، درست پس از `authtoken` و فیلتر زمینه‌ای که در هر pipeline پس از آن می‌آید، همراه با فایل نگاشتی که pyCADF برای آن سرویس دارد، در `etc/pycadf` زیر محیط Python‌ای که سرویس در آن اجرا می‌شود. نه در انتهای یک pipeline: فیلتر `extensions` در Neutron به روترها و گروه‌های امنیتی آن پاسخ می‌دهد، و فیلتر ممیزی هرگز آن‌ها را نمی‌دید.",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "[چه کسی چه کرد](/docs/telemetry/openstack#who-did-what) می‌گوید چه چیزی به رویدادهای امنیتی می‌رسد، و [راهنمای هر ابزار](/docs/telemetry/openstack-deployment-tools) می‌گوید این‌ها روی آن کجا قرار می‌گیرند.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | خیر | نام کانتینر کالکتور (پیش‌فرض: `oneuptime-openstack-agent`). عامل یک ابر دوم روی همان ماشین به نام‌های خودش نیاز دارد: اسکریپت نصب، اگر آن‌ها را تنظیم نکنید، کانتینرهای عامل تازه را به نام پوشه‌اش می‌نامد و وقتی اسکریپت را دوباره اجرا می‌کنید آن‌ها را نگه می‌دارد |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر همراه (پیش‌فرض: `oneuptime-openstack-exporter`). اسکریپت نصب، اگر آن را تنظیم نکنید، اکسپورتر همراه یک ابر دوم را به نام کالکتورش می‌نامد (`oneuptime-openstack-exporter-cloud2` کنار `oneuptime-openstack-agent-cloud2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر سهمیه (پیش‌فرض: `oneuptime-openstack-quota-exporter`). اسکریپت نصب، اگر آن را تنظیم نکنید، اکسپورتر سهمیه یک ابر دوم را به نام کالکتورش می‌نامد (`oneuptime-openstack-quota-exporter-cloud2` کنار `oneuptime-openstack-agent-cloud2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر پایگاه داده (پیش‌فرض: `oneuptime-openstack-database-exporter`). اسکریپت نصب، اگر آن را تنظیم نکنید، اکسپورتر پایگاه داده یک ابر دوم را به نام کالکتورش می‌نامد (`oneuptime-openstack-database-exporter-cloud2` کنار `oneuptime-openstack-agent-cloud2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر وضعیت workerها (پیش‌فرض: `oneuptime-openstack-worker-state-exporter`). اسکریپت نصب، اگر آن را تنظیم نکنید، اکسپورتر وضعیت workerها یک ابر دوم را به نام کالکتورش می‌نامد (`oneuptime-openstack-worker-state-exporter-cloud2` کنار `oneuptime-openstack-agent-cloud2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل هوش مصنوعی (پیش‌فرض: `oneuptime-openstack-ai-agent`). اسکریپت نصب، اگر آن را تنظیم نکنید، عامل هوش مصنوعی یک ابر دوم را به نام کالکتورش می‌نامد (`oneuptime-openstack-ai-agent-cloud2` کنار `oneuptime-openstack-agent-cloud2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "یک عامل یک ابر را می‌خواند. برای ابر دوم، عامل دومی را در پوشه‌ای جداگانه و با نام‌های کانتینر خودش نصب کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند:",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "اسکریپت، اگر متغیرهای کانتینرها را تنظیم نکنید، مثلاً `OPENSTACK_AGENT_CONTAINER_NAME`، کانتینرها را به نام پوشه می‌نامد، مثلاً `oneuptime-openstack-agent-cloud2`. اسکریپت نام‌ها را در `.env` همان عامل نگه می‌دارد، پس اجرای دوباره اسکریپت با همان `INSTALL_DIR` برای ارتقای عامل آن‌ها را حفظ می‌کند، و عاملی که `container_name` آن را زمانی در `docker-compose.yml` ویرایش کرده‌اید همان نام را نگه می‌دارد.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "به هر پوشه نامی از آن خودش بدهید: Docker Compose هر پروژه را فقط به نام پوشه‌اش می‌نامد، پس اسکریپت پوشه‌ای را که هم‌نام پوشه‌ای باشد که در جای دیگری عاملی را اجرا می‌کند نمی‌پذیرد. پوشه را با `-d` به اسکریپت تشخیصی بدهید.",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | خیر | نام کانتینر کالکتور (پیش‌فرض: `oneuptime-openstack-agent`). عامل یک ابر دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر همراه (پیش‌فرض: `oneuptime-openstack-exporter`). عامل یک ابر دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر سهمیه (پیش‌فرض: `oneuptime-openstack-quota-exporter`). عامل یک ابر دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر پایگاه داده (پیش‌فرض: `oneuptime-openstack-database-exporter`). عامل یک ابر دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر وضعیت workerها (پیش‌فرض: `oneuptime-openstack-worker-state-exporter`). عامل یک ابر دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل هوش مصنوعی (پیش‌فرض: `oneuptime-openstack-ai-agent`). عامل یک ابر دوم روی همان ماشین به نام خودش نیاز دارد |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "یک عامل یک ابر را می‌خواند. برای ابر دوم، عامل دومی را در پوشه‌ای جداگانه و با نام‌های کانتینر خودش راه‌اندازی کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند. آن‌ها را در `.env` همان عامل تنظیم کنید:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "به هر پوشه نامی از آن خودش بدهید: Docker Compose هر پروژه را فقط به نام پوشه‌اش می‌نامد، پس پوشه دومی با همان نام جای کانتینرهای عامل اول را می‌گیرد. نام‌ها را در `docker-compose.yml` نگذارید، چون ارتقا این فایل را جایگزین می‌کند.",
};

export default TRANSLATION;
