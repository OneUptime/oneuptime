# عامل VMware در OneUptime

## نمای کلی

عامل VMware در OneUptime جمع‌کننده‌ای از پیش پیکربندی‌شده از OpenTelemetry است که VMware vSphere را زیر نظر می‌گیرد — vCenter Server، میزبان‌های ESXi، ماشین‌های مجازی، دیتااستورها، خوشه‌ها، استخرهای منبع و vSAN. فقط پیکربندی است: کانتینر خام `otel/opentelemetry-collector-contrib` که [گیرنده بومی `vcenter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/vcenterreceiver) آن با کاربری فقط‌خواندنی از SDK ‏vSphere نظرسنجی می‌کند، هر سنجه‌ای را با هویت vCenter شما مهر می‌زند، و همه‌چیز را روی OTLP به OneUptime می‌فرستد. بدون صادرکننده کناری، بدون افزونه روی vCenter، بدون عامل درون ماشین‌های مجازی. یک فایل `.env`، یک `docker compose up`.

هر عامل یک نقطه پایانی vSphere را زیر نظر می‌گیرد — یک **vCenter Server** (حالت معمول، که هر دیتاسنتر، خوشه و میزبانی را که مدیریت می‌کند پوشش می‌دهد) یا یک **میزبان ESXi مستقل** که vCenter مدیریتش نمی‌کند. به ازای هر vCenter یک عامل اجرا کنید.

این صفحه **راهنمای نصب** است. برای پیکربندی مانیتورها و هشدارهای VMware روی داده‌ای که عامل جمع می‌کند، [مانیتور VMware](/docs/monitor/vmware-monitor) را ببینید.

## پیش‌نیازها

- ‏Docker Engine ‏20.10 به بالا با افزونه Docker Compose v2، روی هر ماشینی که بتواند روی HTTPS (‏TCP ‏443) به vCenter برسد
- ‏vCenter Server / ESXi نسخه **۷٫۰ به بالا** (گیرنده از vSphere ‏۷ و ۸ پشتیبانی می‌کند)
- کاربری در vSphere با نقش توکار **Read-Only**، منتشرشده از شیء بالادستی vCenter (پایین را ببینید)
- یک **توکن دریافت تله‌متری OneUptime** — از _Project Settings → Telemetry & APM → Ingestion Keys_ یکی بسازید و مقدارش را کپی کنید

### ساخت کاربر فقط‌خواندنی vSphere

عامل فقط می‌خواند: فهرست موجودی، شمارنده‌های کارایی و آمار vSAN. حسابی اختصاصی با نقش توکار **Read-Only** به آن بدهید — هرگز مدیر نه.

**از راه vSphere Client:**

1. حساب را بسازید: _Menu → Administration → Single Sign On → Users and Groups_، دامنه `vsphere.local` (یا منبع هویت خودتان) را برگزینید، روی **Add** کلیک کنید، نام کاربر را `oneuptime` بگذارید و گذرواژه‌ای تعیین کنید. این اصل `oneuptime@vsphere.local` را می‌دهد.
2. نقش را اعطا کنید: شیء بالادستی **vCenter Server** را در فهرست موجودی _Hosts and Clusters_ برگزینید، زبانه **Permissions** را باز کنید، روی **Add** کلیک کنید، کاربر را برگزینید، نقش را روی **Read-Only** بگذارید و **Propagate to children** را تیک بزنید.

انتشار همان بخشی است که از قلم می‌افتد. گیرنده دیتاسنترها → خوشه‌ها → میزبان‌ها → ماشین‌های مجازی → دیتااستورها → استخرهای منبع را می‌پیماید، و هر شیئی که کاربر نمی‌تواند ببیند بی‌صدا از سنجه‌ها غایب است — نقش Read-Only که روی شیء vCenter _بدون_ انتشار اعطا شده باشد فهرست موجودی‌ای خالی و داشبوردی پر از صفر می‌دهد.

**یا با `govc`** (از ماشینی با اعتبارنامه مدیر):

```bash
govc sso.user.create -p 'a-strong-password' -R ReadOnly oneuptime
govc permissions.set -principal oneuptime@vsphere.local -role ReadOnly -propagate=true /
```

**یا با PowerCLI:**

```powershell
New-SsoPersonUser -UserName oneuptime -Password 'a-strong-password'
New-VIPermission -Entity (Get-Folder -NoRecursion) -Principal 'VSPHERE.LOCAL\oneuptime' -Role ReadOnly -Propagate:$true
```

برای **میزبان ESXi مستقل** (بدون vCenter)، کاربر را زیر _Host → Manage → Security & Users → Users_ در ESXi Host Client بسازید و نقش Read-Only را زیر _Host → Manage → Security & Users → Permissions_ اختصاص دهید (یا `esxcli system account add` و سپس `esxcli system permission set --id oneuptime --role ReadOnly`).

### عامل را کجا اجرا کنیم

عامل روی HTTPS با vCenter حرف می‌زند، پس لازم نیست نزدیک آن باشد — و در حالت ایده‌آل نباید **روی** vCenter Server Appliance یا درون ماشین مجازی‌ای روی همان خوشه‌ای که می‌پاید اجرا شود: اگر آن خوشه بیفتد، مانیتورینگ شما هم با آن می‌افتد. ماشین مجازی مدیریتی کوچکی روی سخت‌افزار جدا، میزبانی برای مانیتورینگ، یا هر ماشین Docker‌داری با مسیری به vCenter روی TCP ‏443 خانه درستی است. (شنونده اختیاری syslog افزون بر آن نیاز دارد میزبان‌های ESXi روی درگاه syslog به عامل برسند — [فرستادن syslog ‏ESXi](#اختیاری-فرستادن-syslog-esxi) را ببینید.)

## شروع سریع (اسکریپت نصب)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/install.sh -o install.sh
bash install.sh
```

اسکریپت نشانی OneUptime، توکن دریافت تله‌متری، نامی پایدار برای vCenter، نقطه پایانی vCenter و اعتبارنامه فقط‌خواندنی شما را می‌پرسد (گذرواژه بدون بازتاب خوانده می‌شود)، در `/opt/oneuptime-vmware-agent` نصب می‌کند، با دسترسی `0600` فایل `.env` می‌نویسد، و عامل را با Docker Compose آغاز می‌کند. مقدارها هنگام نوشتن برای Docker Compose نقل‌قول‌گذاری می‌شوند، پس گذرواژه‌ای که `$`، `#`، فاصله یا نقل‌قول دارد دقیقاً همان‌طور که تایپ شده کار می‌کند، و اجرای دوباره اسکریپت به‌جای پرسیدن دوباره، همه‌چیز را از `.env` موجود بازاستفاده می‌کند.

## جایگزین — Docker Compose

دو فایل را از [پوشه VMwareAgent](https://github.com/OneUptime/oneuptime/tree/master/VMwareAgent) — ‏`docker-compose.yml` و `otel-collector-config.yaml` — در پوشه‌ای دانلود کنید، سپس کنارشان فایلی `.env` بسازید (`chmod 600 .env` — گذرواژه‌ای در آن است):

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
VMWARE_VCENTER_NAME=my-vcenter
VCENTER_ENDPOINT=https://vcsa.example.com
VCENTER_USERNAME=oneuptime@vsphere.local
VCENTER_PASSWORD=a-strong-password
VCENTER_INSECURE_SKIP_VERIFY=true
VCENTER_COLLECTION_INTERVAL=2m
```

آغازش کنید:

```bash
docker compose up -d
```

همین. پس از نخستین جمع‌آوری (حدود یک `VCENTER_COLLECTION_INTERVAL`) ‏vCenter خودکار در بخش **VMware** داشبورد OneUptime پدیدار می‌شود، با دیتاسنترها، خوشه‌ها، میزبان‌های ESXi، ماشین‌های مجازی، دیتااستورها و استخرهای منبعش فهرست‌شده.

## متغیرهای محیطی

| متغیر | الزامی | توضیح |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (برای نمونه `https://oneuptime.com` یا میزبان خودمیزبانتان) |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | توکن دریافت تله‌متری از _Project Settings → Telemetry & APM → Ingestion Keys_ |
| `VMWARE_VCENTER_NAME` | بله | نامی که این vCenter زیر آن در OneUptime ثبت می‌شود، روی هر سنجه‌ای به‌عنوان ویژگی منبع `vmware.vcenter.name` مهر می‌خورد. پایدار نگهش دارید — تغییرش بعداً vCenter دومی ثبت می‌کند. پیش‌فرض `vmware-vcenter` |
| `VCENTER_ENDPOINT` | بله | طرح + میزبان vCenter Server یا میزبان ESXi مستقل، **بدون** `/sdk`، برای نمونه `https://vcsa.example.com` |
| `VCENTER_USERNAME` | بله | کاربر vSphere با نقش Read-Only، برای نمونه `oneuptime@vsphere.local` (یا `DOMAIN\user` برای منبع هویت Active Directory) |
| `VCENTER_PASSWORD` | بله | گذرواژه آن کاربر. اگر `$`، `#`، فاصله یا نقل‌قول دارد، در `.env` تک‌نقل‌قولش کنید (`install.sh` این کار را برایتان می‌کند) — عیب‌یابی را ببینید |
| `VCENTER_INSECURE_SKIP_VERIFY` | خیر | `true` برای پذیرفتن گواهی پیش‌فرض خودامضای (VMCA) ‏vCenter؛ `false` تأیید TLS را روشن نگه می‌دارد. پیش‌فرض `false` |
| `VCENTER_COLLECTION_INTERVAL` | خیر | اینکه کل فهرست موجودی هر چند وقت نظرسنجی شود. برای vCenterهای بسیار بزرگ به `5m` یا `10m` بالا ببرید. پیش‌فرض `2m` |

## تأیید نصب

بررسی کنید عامل در حال اجراست:

```bash
docker compose ps
```

گزارش‌های جمع‌کننده را بررسی کنید:

```bash
docker logs -f oneuptime-vmware-agent
```

دنبال این بگردید: `"Everything is ready. Begin running and processing data."`

تا پایان نخستین پیمایش کامل فهرست موجودی چیزی صادر نمی‌شود، پس یک بازه جمع‌آوری (به‌طور پیش‌فرض ۲ دقیقه) به آن فرصت بدهید؛ سپس vCenter در داشبورد OneUptime با سنجه‌های جاری پدیدار می‌شود.

## چه چیزی جمع می‌شود

در هر `VCENTER_COLLECTION_INTERVAL` گیرنده کل فهرست موجودی vSphere را می‌پیماید و به ازای هر شیء یک منبع OpenTelemetry منتشر می‌کند. هویت در **ویژگی‌های منبع** زندگی می‌کند — `vcenter.datacenter.name`، `vcenter.cluster.name`، `vcenter.host.name`، `vcenter.vm.name` / `vcenter.vm.id`، `vcenter.datastore.name`، `vcenter.resource_pool.name` / `vcenter.resource_pool.inventory_path` — و عامل `vmware.vcenter.name` را رویش می‌افزاید تا OneUptime بتواند همه‌چیز را به vCenter شما مسیریابی کند:

| شیء vSphere | هویت (ویژگی‌های منبع) | سنجه‌ها |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **دیتاسنتر** | `vcenter.datacenter.name` | `vcenter.datacenter.cluster.count`، `vcenter.datacenter.host.count`، `vcenter.datacenter.vm.count`، `vcenter.datacenter.datastore.count`، `vcenter.datacenter.disk.space`، `vcenter.datacenter.cpu.limit`، `vcenter.datacenter.memory.limit` |
| **خوشه** | + `vcenter.cluster.name` | `vcenter.cluster.cpu.effective`، `vcenter.cluster.cpu.limit`، `vcenter.cluster.memory.effective`، `vcenter.cluster.memory.limit`، `vcenter.cluster.host.count`، `vcenter.cluster.vm.count`، `vcenter.cluster.vm_template.count`، `vcenter.cluster.vsan.*` (توان عملیاتی، عملیات، تأخیر، ازدحام) |
| **میزبان ESXi** | + `vcenter.host.name` (و `vcenter.cluster.name` وقتی میزبان در خوشه‌ای است) | `vcenter.host.cpu.usage` / `.capacity` / `.utilization` / `.reserved`، `vcenter.host.memory.usage` / `.utilization` / `.capacity`، `vcenter.host.disk.latency.avg` / `.latency.max` / `.throughput`، `vcenter.host.network.usage` / `.throughput` / `.packet.rate` / `.packet.drop.rate` / `.packet.error.rate`، `vcenter.host.vsan.*` |
| **ماشین مجازی** | + `vcenter.host.name`، `vcenter.vm.name`، `vcenter.vm.id` (شناسه یکتای نمونه)؛ `vcenter.resource_pool.*` یا `vcenter.virtual_app.*` | `vcenter.vm.disk.usage`، `vcenter.vm.disk.utilization`، `vcenter.vm.memory.usage` / `.utilization` / `.ballooned` / `.swapped` / `.swapped_ssd`؛ **فقط ماشین‌های مجازی روشن:** `vcenter.vm.cpu.usage`، `vcenter.vm.cpu.readiness`، `vcenter.vm.cpu.utilization`، `vcenter.vm.disk.latency.avg` / `.latency.max` / `.throughput`، `vcenter.vm.network.*`، `vcenter.vm.vsan.*` |
| **قالب ماشین مجازی** | `vcenter.vm_template.name`، `vcenter.vm_template.id` | فقط `vcenter.vm.disk.usage` |
| **دیتااستور** | + `vcenter.datastore.name` | `vcenter.datastore.disk.usage`، `vcenter.datastore.disk.utilization` |
| **استخر منبع** | + `vcenter.resource_pool.name`، `vcenter.resource_pool.inventory_path` | `vcenter.resource_pool.cpu.usage` / `.cpu.shares`، `vcenter.resource_pool.memory.usage` / `.memory.shares` / `.memory.ballooned` / `.memory.swapped` / `.memory.granted` |

سنجه‌های شمارش و ظرفیت روی **ویژگی‌های نقطه داده** پخش می‌شوند، که دقیقاً همان چیزی‌اند که در معیارهای مانیتور OneUptime رویشان می‌پالایید و گروه‌بندی می‌کنید:

| ویژگی | مقادیر | حمل‌شده توسط |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `direction` | `read` / `write` برای دیسک، `transmitted` / `received` برای شبکه | تأخیر و توان عملیاتی دیسک، توان عملیاتی شبکه و نرخ بسته‌ها |
| `disk_state` | `available` / `used` | `vcenter.datastore.disk.usage`، `vcenter.vm.disk.usage`، `vcenter.datacenter.disk.space` |
| `status` | `red` / `yellow` / `green` / `gray` (وضعیت کلی شیء از دید vSphere) | `vcenter.datacenter.cluster.count` / `.host.count` / `.vm.count` |
| `power_state` | میزبان‌ها: `on` / `off` / `standby` / `unknown`؛ ماشین‌های مجازی: `on` / `off` / `suspended` / `unknown` | `vcenter.datacenter.host.count` / `.vm.count`، `vcenter.cluster.vm.count` |
| `effective` | `true` / `false` (به‌صورت رشته ذخیره می‌شوند) | `vcenter.cluster.host.count` |
| `object` | نمونه NIC، دیسک یا vCPU (برای نمونه `vmnic0`) | سری‌های دیسک / شبکه به ازای هر دستگاه در میزبان و ماشین مجازی |
| `cpu_reservation_type` | `total` / `used` | `vcenter.host.cpu.reserved` |
| `type` | حافظه: `guest` / `host` / `overhead`، `private` / `shared`؛ vSAN: `read` / `write` / `unmap` | سری‌های حافظه استخر منبع، تأخیر و IOPS ‏vSAN |

واحدها فراداده واحد OTLP خود گیرنده‌اند، پس OneUptime برای نمایش بازمقیاسشان می‌کند: `MHz` برای مصرف و ظرفیت CPU، `%` برای بهره‌برداری و آمادگی CPU، `MiBy` برای حافظه میزبان / ماشین مجازی / استخر منبع، `By` برای حافظه خوشه و دیتاسنتر و همه فضای دیسک، `ms` برای تأخیر دیسک میزبان و ماشین مجازی، و `us` (میکروثانیه) برای تأخیر vSAN. در ClickHouse — و در نتیجه در معیارهای مانیتور — ویژگی‌های هویت با پیشوند `resource.` هستند (`resource.vcenter.host.name`، `resource.vmware.vcenter.name`) در حالی که ویژگی‌های نقطه داده خام می‌مانند (`disk_state`، `power_state`، `status`).

`vcenter.host.memory.capacity` در بالادست به‌طور پیش‌فرض خاموش است؛ پیکربندی عرضه‌شده روشنش می‌کند چون OneUptime آن را به‌عنوان مخرج بهره‌برداری حافظه میزبان به کار می‌برد. توضیحی در `otel-collector-config.yaml` باقی سنجه‌های اختیاری را فهرست می‌کند (`vcenter.vm.cpu.time`، `vcenter.vm.memory.granted`، `vcenter.host.memory.active`، `vcenter.host.memory.ballooned`، `vcenter.host.memory.granted`، `vcenter.vm.network.broadcast.packet.rate`، `vcenter.vm.network.multicast.packet.rate`) اگر بخواهیدشان — هرکدام را به همان شیوه فعال کنید.

### وضعیت روشن/خاموش ماشین مجازی

گیرنده سنجه‌ای برای وضعیت روشن/خاموش هر ماشین مجازی صادر نمی‌کند. به‌جایش `vcenter.vm.cpu.*` را **فقط برای ماشین‌های مجازی روشن** منتشر می‌کند، پس OneUptime وضعیت را از آنچه در هر جمع‌آوری رسیده استنباط می‌کند: ماشین مجازی‌ای که سنجه‌های CPU گزارش کرده **روشن** است؛ آنکه فقط مصرف حافظه و دیسک گزارش کرده **خاموش** است (یا معلق — vSphere اینجا این دو را از هم جدا نمی‌کند). قالب‌های ماشین مجازی وضعیت روشن/خاموش ندارند. این استنباط **هر بار یک جمع‌آوری کامل** را می‌خواند، و به همین دلیل پردازشگر `batch` عرضه‌شده `send_batch_size` بزرگی دارد و عمداً `send_batch_max_size` ندارد: جمع‌آوری‌ای که بین دو صادرات تقسیم شود شمارش‌های فهرست موجودی را صفر می‌کند و ماشین‌های مجازی را به «خاموش» برمی‌گرداند. تنظیمات batch را همان‌طور که عرضه شده نگه دارید.

## اختیاری — فرستادن syslog ‏ESXi

به‌طور پیش‌فرض عامل **فقط سنجه** می‌فرستد، پس زبانه Logs داشبورد vCenter خالی می‌ماند. میزبان‌های ESXi (و خود vCenter) می‌توانند syslog خود را به هر شنونده‌ای ارسال کنند، و فایل عرضه‌شده `otel-collector-config.yaml` جفتی گیرنده `syslog` را به‌صورت توضیح دربر دارد (‏TCP و UDP روی درگاه ۵۵۱۴، RFC 3164 — قالب بومی ESXi) که به خط لوله‌ای `logs` به‌صورت توضیح سیم‌کشی شده و `vmware.vcenter.name` را مهر می‌زند تا گزارش‌ها روی vCenter شما بنشینند.

برای فعال کردنش:

1. **دو گیرنده `syslog/*` و خط لوله `logs` را** در `otel-collector-config.yaml` از حالت توضیح درآورید.
2. **بلوک `ports:` را** در `docker-compose.yml` از حالت توضیح درآورید تا میزبان `5514/tcp` و `5514/udp` را منتشر کند، سپس `docker compose up -d`. درگاه را روی دیوار آتش ماشین برای شبکه مدیریت ESXi باز کنید.
3. **هر میزبان ESXi را به عامل نشانه بگیرید.** در vSphere Client میزبان را برگزینید، _Configure → System → Advanced System Settings_ را باز کنید، `Syslog.global.logHost` را ویرایش کنید و روی `udp://<agent-host>:5514` بگذارید (یا `tcp://<agent-host>:5514`؛ چند هدف را می‌توان با ویرگول جدا کرد). سپس ترافیک خروجی را زیر _Configure → System → Firewall → Edit → syslog_ مجاز کنید. یا با `esxcli` در یک خط به ازای هر میزبان:

   ```bash
   esxcli system syslog config set --loghost='udp://<agent-host>:5514'
   esxcli system syslog reload
   esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true
   ```

   با PowerCLI در سراسر یک خوشه: `Get-VMHost | Get-AdvancedSetting -Name Syslog.global.logHost | Set-AdvancedSetting -Value 'udp://<agent-host>:5514' -Confirm:$false`.

گیرنده syslog به ازای هر گیرنده فقط یک انتقال را می‌پذیرد، و به همین دلیل TCP و UDP گیرنده‌های نام‌دار جدایی هستند — اگر فقط یکی را لازم دارید دیگری را در حالت توضیح بگذارید. اگر syslog با TLS (‏`ssl://`) را ترجیح می‌دهید، آن را جلوی عامل خاتمه دهید؛ خود گیرنده TCP/UDP ساده حرف می‌زند. برخلاف مسیر journald در عامل Proxmox، ایمیج سفارشی جمع‌کننده لازم نیست — ایمیج خام syslog را پشتیبانی می‌کند.

## برچسب‌گذاری خودکار با برچسب‌های پروژه

هر ویژگی منبعی با پیشوند `oneuptime.label.` به برچسبی در پروژه ارتقا می‌یابد و به vCenter پیوست می‌شود. الگو: `oneuptime.label.<dimension>=<value>` برچسبی به نام `<dimension>:<value>` می‌شود.

ویژگی‌ها را به پردازشگر `resource` در `otel-collector-config.yaml` بیفزایید (کنار `vmware.vcenter.name`):

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: platform
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

‏vCenter با برچسب‌های `team:platform` و `env:production` پدیدار می‌شود. برچسب‌ها بدون حساسیت به بزرگی حروف تطبیق می‌شوند، پس برچسب `Production` که پیش‌تر دستی ساخته شده به‌جای تکرار دوباره به کار می‌رود؛ برچسب‌هایی که دستی در رابط OneUptime افزوده شده‌اند هرگز توسط عامل حذف نمی‌شوند.

## اجرا به‌عنوان سرویس systemd

```bash
sudo cp systemd/oneuptime-vmware-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-vmware-agent
```

واحد فرض می‌گیرد عامل در `/opt/oneuptime-vmware-agent` زندگی می‌کند (پیش‌فرض اسکریپت نصب).

## ارتقای عامل

```bash
cd /opt/oneuptime-vmware-agent
docker compose pull
docker compose up -d
```

ایمیج جمع‌کننده در `docker-compose.yml` سنجاق شده است؛ وقتی انتشار تازه‌تری از OneUptime سنجاق را بالا می‌برد، پیش از pull فایل‌های `docker-compose.yml` و `otel-collector-config.yaml` را دوباره از پوشه VMwareAgent دانلود کنید — یا `install.sh` را دوباره اجرا کنید، که هر مقدار `.env` موجود شما را بازاستفاده می‌کند (چیزی دوباره پرسیده نمی‌شود) و فقط همان دو فایل را تازه می‌کند.

## حذف نصب عامل

```bash
cd /opt/oneuptime-vmware-agent
docker compose down
```

سپس اگر دیگر لازمش ندارید، دسترسی کاربر `oneuptime` را در vCenter حذف کنید.

## ‏OneUptime خودمیزبان

اگر OneUptime را خودمیزبان می‌کنید، `ONEUPTIME_URL` را روی نمونه خودتان بگذارید:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

اگر نمونه شما فقط HTTP است، از `http://` و درگاه مناسب استفاده کنید.

## رفع اشکال

### نخست اسکریپت تشخیص را اجرا کنید

عامل با اسکریپت دکتری، [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/VMwareAgent/troubleshoot.sh)، عرضه می‌شود که کل زنجیره را بررسی می‌کند: زمان اجرای کانتینر، دسترس‌پذیری و اعتبارنامه vCenter، مهر خوردن نام vCenter، شکل توکن دریافت، سنجه‌های خودی جمع‌کننده، و **اعتبارسنجی قطعی توکن در سمت کارساز**. بررسی توکن مهم‌ترین است — نقطه‌های پایانی OTLP در OneUptime عمداً روی توکن دریافت بد `200` خاموشی برمی‌گردانند (تا جمع‌کننده‌ای بد پیکربندی‌شده نتواند کارساز را با تلاش دوباره غرق کند)، که یعنی گزارش‌های جمع‌کننده حتی وقتی هر نقطه داده‌ای انداخته می‌شود تمیز به نظر می‌رسند. اسکریپت `GET <url>/otlp/v1/validate` را از درون فضای‌نام شبکه عامل فرا می‌خواند تا رأی واقعی `200` (معتبر) / `401` (نامعتبر) بگیرد، روی کارسازهای قدیمی‌تر به `POST /fluentd/v1/logs` بازمی‌گردد، و `<VCENTER_ENDPOINT>/sdk/vimServiceVersions.xml` را هم به همان شیوه می‌آزماید تا شکست‌های DNS، دیوار آتش و TLS دقیقاً همان‌طور که جمع‌کننده با آن‌ها روبه‌رو می‌شود پدیدار شوند.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-vmware-agent
```

با بخشی به نام VERDICT پایان می‌یابد که محتمل‌ترین ریشه علت را نام می‌برد. بخش‌های زیر همان زمین را دستی پوشش می‌دهند.

### هیچ vCenterای در OneUptime پدیدار نمی‌شود

1. گزارش‌های جمع‌کننده را بررسی کنید: `docker logs oneuptime-vmware-agent` — خطای ورود (`incorrect user name or password`، `InvalidLogin`) یعنی اعتبارنامه بد، `x509: certificate signed by unknown authority` یعنی تأیید TLS در برابر گواهی خودامضا روشن است، `connection refused` / `no such host` یعنی `VCENTER_ENDPOINT` اشتباه، و `401` هنگام صادرات یعنی توکن دریافت بد.
2. تأیید کنید نقطه پایانی از شبکه عامل در دسترس است. ایمیج جمع‌کننده distroless است (بدون پوسته، بدون curl)، پس از کانتینری هم‌نشین در فضای‌نام شبکه‌اش بیازمایید: `docker run --rm --network container:oneuptime-vmware-agent curlimages/curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml` باید سندی XML چاپ کند که `urn:vim25` را اعلام می‌کند.
3. مطمئن شوید `VMWARE_VCENTER_NAME` تنظیم شده — کشف بر ویژگی منبع `vmware.vcenter.name` کلید می‌خورد.
4. یک بازه جمع‌آوری فرصت بدهید: تا پایان نخستین پیمایش کامل فهرست موجودی چیزی فرستاده نمی‌شود.

### خطاهای `x509` / TLS

دستگاه‌های vCenter گواهی‌ای صادرشده توسط VMCA خودشان ارائه می‌دهند، که هیچ ایمیج Dockerای به آن اعتماد ندارد. یا `VCENTER_INSECURE_SKIP_VERIFY=true` را بگذارید (انتخاب عمل‌گرایانه روی شبکه مدیریتی خصوصی) یا گواهی ماشین vCenter را با گواهی‌ای صادرشده از CAای که ایمیج جمع‌کننده به آن اعتماد دارد جایگزین کنید. نقطه پایانی را به نشانی `http://` نشانه **نگیرید** — vCenter فقط روی HTTPS به SDK سرویس می‌دهد.

### ‏vCenter ورود را رد می‌کند (۴۰۱ / `InvalidLogin`)

اصل کامل را به کار ببرید — `oneuptime@vsphere.local`، یا `DOMAIN\user` / `user@domain.example` برای منبع هویت Active Directory — و بررسی کنید گذرواژه در `.env` چگونه نوشته شده است. ‏Docker Compose v2 ارجاع‌های `$VAR` را در مقدارهای بدون نقل‌قول و با نقل‌قول دوتایی بسط می‌دهد و فاصله‌ای را که پس از آن `#` بیاید آغاز توضیح می‌شمارد، پس گذرواژه‌ای که `$`، `#`، فاصله یا نقل‌قول دارد باید **تک‌نقل‌قول** شود — `VCENTER_PASSWORD='p@ss$word'` — که همان چیزی است که `install.sh` می‌نویسد؛ گذرواژه‌ای که خودش تک‌نقل‌قول دارد در نقل‌قول دوتایی می‌رود، با هر `$` به‌صورت `$$` و `"` / `\` با بک‌اسلش گریزداده‌شده. حسابی قفل‌شده (تلاش‌های ناموفق زیاد) گذرواژه درست را هم رد می‌کند؛ _Administration → Single Sign On → Users and Groups_ را بررسی کنید.

### میزبان‌ها پدیدار می‌شوند اما ماشین مجازی، دیتااستور یا خوشه‌ای نیست (`NoPermission`)

نقش Read-Only روی شیء vCenter بدون **Propagate to children** اعطا شده، یا روی شیئی تنگ‌تر از ریشه vCenter. اشیایی که کاربر نمی‌تواند ببیند بی‌صدا غایب‌اند. دسترسی را روی شیء بالادستی vCenter با انتشار فعال درست کنید؛ جمع‌آوری بعدی فهرست موجودی را پر می‌کند.

### هر ماشین مجازی خاموش نشان داده می‌شود

وضعیت روشن/خاموش ماشین مجازی از حضور نقاط داده `vcenter.vm.cpu.*` در همان جمع‌آوری‌ای که نقاط داده حافظه و دیسک ماشین مجازی در آن هستند استنباط می‌شود ([وضعیت روشن/خاموش ماشین مجازی](#وضعیت-روشنخاموش-ماشین-مجازی) را ببینید). اگر پردازشگر `batch` را سفارشی کرده و `send_batch_max_size` افزوده‌اید، فهرست موجودی بزرگی بین صادرات‌ها تقسیم می‌شود و نقاط داده CPU در درخواستی جدا از بقیه می‌نشینند — تنظیمات batch عرضه‌شده را بازگردانید.

### فهرست‌های موجودی بزرگ: جمع‌آوری‌های کند، خطاهای `vpxd.stats.maxQueryMetrics`

هر جمع‌آوری پیمایش کامل فهرست موجودی است به‌علاوه یک پرس‌وجوی کارایی به ازای هر دسته شیء. برای vCenterهایی با هزاران ماشین مجازی:

- `VCENTER_COLLECTION_INTERVAL` را به `5m` یا `10m` بالا ببرید. جمع‌آوری‌ای که بیش از بازه طول بکشد رد می‌شود نه همپوشان، پس بازه‌ای بیش از حد کوتاه فقط شکاف می‌سازد.
- گیرنده تا `max_query_metrics: 256` موجودیت به ازای هر پرس‌وجوی کارایی می‌خواهد. vCenter این را در سمت کارساز با `vpxd.stats.maxQueryMetrics` محدود می‌کند (پیش‌فرض ۲۵۶ در vCenter ‏۷/۸). اگر مدیر vCenter آن تنظیم را پایین آورده باشد، `The maximum number of performance metrics per query exceeded` را در گزارش جمع‌کننده می‌بینید — `max_query_metrics` را در `otel-collector-config.yaml` پایین بیاورید تا مطابق شود، یا تنظیم vCenter را زیر _vCenter → Configure → Advanced Settings_ بالا ببرید.
- حافظه جمع‌کننده را بپایید: `memory_limiter` عرضه‌شده ۵۱۲ مبی‌بایت مجاز می‌داند. اگر گزارش نشان می‌دهد محدودکننده داده می‌اندازد، `limit_mib` را بالا ببرید (و به کانتینر حافظه بیشتری بدهید).

### مانیتورینگ میزبان ESXi مستقل (بدون vCenter)

`VCENTER_ENDPOINT` را به خود میزبان (`https://esxi01.example.com`) با کاربری محلی ESXi با نقش Read-Only نشانه بگیرید. هر چیزی که یک میزبان می‌داند جمع می‌شود: میزبان، ماشین‌های مجازی، دیتااستورها و استخرهای منبعش. روی میزبان مستقل شیء دیتاسنتر یا خوشه‌ای وجود ندارد، پس آن صفحه‌ها خالی می‌مانند، و REST API ‏vCenter غایب است، پس اسکریپت دکتر بررسی اعتبارنامه را غیرقطعی گزارش می‌کند (آنجا گزارش جمع‌کننده مرجع است).

### سنجه‌ها زیر vCenter اشتباه می‌نشینند

‏OneUptime ‏vCenterها را بر پایه `vmware.vcenter.name` خودکار ثبت می‌کند، که از متغیر محیطی `VMWARE_VCENTER_NAME` گرفته می‌شود. تغییرش پس از نخستین دسته تله‌متری به‌جای تغییر نام موجود، سطر vCenter دومی می‌سازد.

### فرستادن سنجه‌ها بدون عامل

در vSphere ارسال بومی OTLP وجود ندارد — vCenter خودش OpenTelemetry صادر نمی‌کند، پس عامل (یا هر جمع‌کننده OpenTelemetry با گیرنده `vcenter`) راه ورود است. اگر از پیش ناوگانی از جمع‌کننده‌ها اجرا می‌کنید، می‌توانید به‌جای اجرای این عامل گیرنده `vcenter` را به آن بیفزایید: بلوک گیرنده `vcenter` و پردازشگر `resource` را از `otel-collector-config.yaml` عرضه‌شده در پیکربندی خودتان کپی کنید. ویژگی منبع `vmware.vcenter.name` همان چیزی است که vCenter را در OneUptime ثبت می‌کند، و حذف‌های `service.name` / `service.instance.id` جلوی مسیریابی داده به سرویسی خیالی را می‌گیرند — هر دو را نگه دارید.

## گام‌های بعدی

- **مانیتورهای VMware** را برای هشدار بر شرایط میزبان، ماشین مجازی، دیتااستور، خوشه، دیتاسنتر و vSAN پیکربندی کنید — [مانیتور VMware](/docs/monitor/vmware-monitor) را ببینید.
- برای نمای سطح سیستم‌عامل درون ماشین‌های مجازی منفرد یا خود ماشین عامل، از [جمع‌کننده OpenTelemetry میزبان](/docs/telemetry/host-otel-collector) استفاده کنید.
