# مدیریت منابع

این صفحه به منابع ارائه‌دهنده، پس از راه افتادن نخستین آن‌ها، می‌پردازد: kindها و فیلدها چگونه نام‌گذاری می‌شوند، منابع چگونه به یکدیگر ارجاع می‌دهند، چگونه آنچه را پروژهٔ شما از قبل دارد وارد کنید، رازهایی که OneUptime می‌سازد، چه بر سر تغییرهایی می‌آید که بیرون از Kubernetes انجام می‌شوند، و وقتی یک منبع آماده نیست به چه چیزی نگاه کنید. برای نصب ارائه‌دهنده و ساختن نخستین منابعتان، از [نمای کلی Crossplane](/docs/crossplane/index) شروع کنید.

:::cards
- [kindها و فیلدها](#kindها-و-فیلدها): منابع Terraform که از آن‌ها ساخته می‌شوند، و اینکه چگونه نام‌گذاری می‌شوند.
- [ارجاع به منابع دیگر](#ارجاع-به-منابع-دیگر): نام به‌جای شناسه، در هر عمقی از مراحل یک مانیتور.
- [وارد کردن آنچه از قبل دارید](#وارد-کردن-آنچه-از-قبل-دارید): یک رکورد را با شناسه‌اش مشاهده کنید، سپس مدیریتش را به دست بگیرید.
- [رفع اشکال یک منبع](#رفع-اشکال-یک-منبع): conditionهای آن، رویدادهایش و لاگ‌های ارائه‌دهنده.
:::

## kindها و فیلدها

هر منبع [ارائه‌دهندهٔ Terraform](/docs/terraform/index) یک kind است که به شیوهٔ CamelCase نام‌گذاری می‌شود: `oneuptime_status_page` می‌شود `StatusPage`، و `oneuptime_on_call_policy` می‌شود `OnCallPolicy`. نامی که به Spec، Status یا List ختم می‌شد، یک Definition هم در انتها می‌گیرد، پس `oneuptime_monitor_status` می‌شود `MonitorStatusDefinition`. چند نمونه از kindها:

| kind | نوع رکورد | منبع Terraform |
| --- | --- | --- |
| `Monitor` | مانیتور | `oneuptime_monitor` |
| `StatusPage` | صفحهٔ وضعیت | `oneuptime_status_page` |
| `OnCallPolicy` | سیاست آنکال | `oneuptime_on_call_policy` |
| `Team` | تیم | `oneuptime_team` |
| `Label` | برچسب | `oneuptime_label` |
| `IncidentSeverity` | شدت حادثه | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | وضعیت مانیتور | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | کلید دریافت دادهٔ تله‌متری | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` همهٔ kindهایی را که خوشهٔ شما فعال کرده است فهرست می‌کند.

فیلدهای یک kind همان آرگومان‌های منبع Terraform هستند، به شیوهٔ camelCase و زیر `spec.forProvider`: `monitoring_interval` می‌شود `monitoringInterval`. فیلدی که Terraform آن را با `jsonencode()` می‌نویسد، یک رشتهٔ JSON می‌گیرد. `kubectl explain` هر فیلد را با همان توضیح ارائه‌دهندهٔ Terraform شرح می‌دهد، و [راهنمای کامل Terraform](/docs/terraform/complete-guide) نشان می‌دهد چگونه به کار می‌روند:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` رکورد را همان‌طور که در OneUptime هست، همراه با `id` آن، نشان می‌دهد. فیلدی که آن را نمی‌نویسید و OneUptime مقدارش را پر می‌کند، مانند یک مقدار پیش‌فرض، پس از ساخته شدن رکورد در `spec.forProvider` کپی می‌شود، تا بررسی بعدی چیزی برای تغییر پیدا نکند.

## ارجاع به منابع دیگر

هر فیلدی که شناسهٔ رکورد دیگری را نگه می‌دارد، ارجاع به منبعی را هم که نمایندهٔ آن رکورد است می‌پذیرد. `<field>Ref` منبعی از همان namespace را نام می‌برد، و `<field>Selector` یکی را با برچسب‌های Kubernetes آن انتخاب می‌کند. فهرستی از شناسه‌ها، مانند `labels`، ارجاع را با `labelsRefs` و `labelsSelector` می‌پذیرد. ارائه‌دهنده صبر می‌کند تا منبعی که به آن ارجاع شده است در OneUptime وجود داشته باشد، سپس شناسهٔ آن را پر می‌کند.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

ارجاع‌ها به درون مراحل یک مانیتور هم می‌رسند: وضعیت یک معیار (`monitorStatusIdRef`)، و شدت، تیم‌های مالک، سیاست‌های آنکال و برچسب‌های حادثه‌ها و هشدارهایی که می‌سازد (`incidentSeverityIdRef`، `alertSeverityIdRef`، `ownerTeamIdsRefs`، `onCallPolicyIdsRefs`، `labelIdsRefs`). هیچ kindی برای یک شخص وجود ندارد: یک فیلد هر کس را با شناسهٔ کاربری‌اش نام می‌برد، همان‌طور که `ownerUserIds` این کار را می‌کند، و بسیاری از kindها نشانی ایمیل او را هم کنار آن می‌پذیرند، همان‌طور که `TeamMember` در `userEmail` می‌پذیرد ([افراد و تیم‌ها](/docs/terraform/people-and-teams)).

## وارد کردن آنچه از قبل دارید

منبعی که یک رکورد را مشاهده می‌کند، آن را با شناسه‌اش می‌خواند و هرگز تغییرش نمی‌دهد یا حذفش نمی‌کند. شناسه را نام خارجی منبع قرار دهید، و `Observe` را تنها سیاست مدیریت آن:

```yaml title="team.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Team
metadata:
  name: sre
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the team's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

شناسهٔ رکورد در همان بلوک `import` است که صفحهٔ **توسعه‌دهنده** > **Terraform** آن در داشبورد می‌نویسد، و `oneuptime <resource> list` شناسه‌های یک نوع رکورد را با [OneUptime CLI](/docs/cli/resource-operations#فهرست-کردن-رکوردها) فهرست می‌کند. وقتی منبع آماده شد، `status.atProvider` رکورد را نشان می‌دهد. برای مدیریت آن از آن پس، فیلدهایش را در `spec.forProvider` بنویسید و `managementPolicies` را روی `["*"]` بگذارید.

## رازها

### رازهایی که OneUptime می‌سازد

برخی رکوردها با رازی همراه‌اند که OneUptime می‌سازد، مانند راز یک کلید دریافت دادهٔ تله‌متری. ارائه‌دهنده هرگز چنین رازی را در منبع نمی‌گذارد: آن را در یک Secret در namespace منبع می‌نویسد که `writeConnectionSecretToRef` نامش را تعیین می‌کند، زیر `attribute.` و به دنبالش نام ویژگی Terraform:

```yaml title="telemetry-key.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: TelemetryIngestionKey
metadata:
  name: collector
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  writeConnectionSecretToRef:
    name: collector-telemetry-key
  forProvider:
    name: Collector
```

```bash
kubectl -n team-a get secret collector-telemetry-key -o jsonpath='{.data.attribute\.secret_key}' | base64 -d
```

حذف منبع، Secret را هم حذف می‌کند.

### رازهایی که شما می‌دهید

فیلدی که یک راز را نگه می‌دارد، مانند عبارت عبور کلید کلاینت TLS در یک مرحلهٔ مانیتور، به‌جای یک مقدار، یک Secret از namespace منبع را می‌پذیرد: `tlsClientKeyPassphraseSecretRef`، با `name` و `key` آن Secret.

## تغییرهایی که بیرون از Kubernetes انجام می‌شوند

ارائه‌دهنده هر ۱۰ دقیقه هر منبع را با رکوردش مقایسه می‌کند و هر چیزی را که کسی در OneUptime تغییر داده باشد برمی‌گرداند. برای بررسی در فاصله‌های کوتاه‌تر، یک پیکربندی زمان اجرا با `--poll` به ارائه‌دهنده بدهید:

```yaml title="runtime-config.yaml"
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: oneuptime
spec:
  deploymentTemplate:
    spec:
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              args:
                - --poll=1m
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
  runtimeConfigRef:
    name: oneuptime
```

برای اینکه پس از ساخته شدن رکورد، اختیار یک فیلد با داشبورد باشد، آن را به‌جای `spec.forProvider` در `spec.initProvider` بنویسید: برای ساختن رکورد به کار می‌رود و هرگز برگردانده نمی‌شود. برای اینکه اختیار کل رکورد با داشبورد باشد، `Update` را از سیاست‌های مدیریت آن کنار بگذارید: `["Observe", "Create", "Delete", "LateInitialize"]`.

## حذف یک منبع

حذف یک منبع، رکورد آن را در OneUptime حذف می‌کند. برای نگه داشتن رکورد، پیش از حذف منبع، `Delete` را از سیاست‌های مدیریت آن کنار بگذارید: `["Observe", "Create", "Update", "LateInitialize"]`. منبعی که فقط مشاهده می‌کند هرگز رکوردش را حذف نمی‌کند.

## رفع اشکال یک منبع

`kubectl -n team-a get managed` مقدار `SYNCED` و `READY` هر منبع را نشان می‌دهد. وقتی یکی از آن‌ها `True` نیست، conditionها و رویدادهای آن منبع علت را می‌گویند، و وقتی API درخواستی را رد کرده باشد، پاسخ OneUptime را هم:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| چه می‌گوید | چه چیزی را بررسی کنید |
| --- | --- |
| `cannot read the API key` | همان Secret، یا کلید درون آن، که `ProviderConfig` نام می‌برد. |
| `cannot get referenced ProviderConfig` | منبع یک `ProviderConfig` را نام می‌برد که در namespace آن نیست. برای پیکربندی‌ای در سطح خوشه، `kind: ClusterProviderConfig` را به کار ببرید. |
| ارجاعی که حل نمی‌شود | منبعی که نام می‌برد در namespace نیست، یا هنوز آماده نیست. |
| خطایی از API OneUptime | دسترسی‌های کلید API، و مقدار فیلدی که خطا نام می‌برد. |

لاگ‌های ارائه‌دهنده بیشتر می‌گویند، و با افزودن `--debug` به `args` آن، همان‌طور که `--poll` در بالا افزوده شده است، باز هم بیشتر:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## راستی‌آزمایی بسته

در هر نسخه، بسته با cosign از Sigstore و به روش keyless امضا می‌شود، همان‌طور که ایمیج‌های OneUptime امضا می‌شوند. برای بررسی یک بسته پیش از نصب آن:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
