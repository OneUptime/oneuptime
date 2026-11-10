# نمای کلی Crossplane

ارائه‌دهندهٔ Crossplane برای OneUptime پروژهٔ OneUptime شما را از Kubernetes مدیریت می‌کند. مانیتورها، صفحه‌های وضعیت، سیاست‌های آنکال، تیم‌ها، برچسب‌ها و دیگر رکوردهای پروژه‌تان را به‌صورت منابع Kubernetes تعریف کنید، و Crossplane پروژهٔ شما را همان‌گونه نگه می‌دارد که آن‌ها می‌گویند: آنچه را تازه است می‌سازد، آنچه را ویرایش می‌کنید تغییر می‌دهد، آنچه را کسی جای دیگری تغییر داده است برمی‌گرداند، و آنچه را حذف می‌کنید حذف می‌کند. Argo CD، Flux و هر ابزار دیگری که مانیفست‌ها را اعمال می‌کند این‌ها را هم اعمال می‌کنند. این ارائه‌دهنده هم با OneUptime Cloud و هم با OneUptime خودمیزبان کار می‌کند.

:::cards
- [ارائه‌دهنده چگونه کار می‌کند](#ارائهدهنده-چگونه-کار-میکند): kindها، namespaceها، و کلید API پشت آن‌ها.
- [نصب ارائه‌دهنده](#نصب-ارائهدهنده): بسته، و نسخه‌ای که باید انتخاب کنید.
- [دادن کلید API به ارائه‌دهنده](#دادن-کلید-api-به-ارائهدهنده): یک Secret و یک ProviderConfig در namespace شما.
- [ساختن نخستین منابعتان](#ساختن-نخستین-منابعتان): یک مانیتور، برچسبی که دارد و وضعیت‌هایی که تنظیم می‌کند.
:::

## ارائه‌دهنده چگونه کار می‌کند

ارائه‌دهنده یک بستهٔ Crossplane است. پس از نصب، برای هر نوع رکورد در API OneUptime یک kind به گروه API `crossplane.oneuptime.com` می‌افزاید: `Monitor`، `StatusPage`، `OnCallPolicy`، `Team`، `Label` و بیش از ۴۰۰ kind دیگر. هر منبع از این kindها در یک namespace قرار دارد و نمایندهٔ یک رکورد از پروژهٔ شماست. ارائه‌دهنده رکورد را از راه REST API OneUptime، با یک کلید API از پروژهٔ شما، می‌خواند و تغییر می‌دهد، و آنچه را می‌یابد در status منبع می‌نویسد.

ارائه‌دهنده نسخه به نسخه از [ارائه‌دهندهٔ Terraform](/docs/terraform/index) ساخته می‌شود: kindهای آن همان منابع ارائه‌دهندهٔ Terraform هستند، با همان فیلدها و همان درخواست‌های API پشت آن‌ها.

## پیش از شروع

- **Crossplane 2.0 یا جدیدتر.** منابع ارائه‌دهنده در namespaceها قرار دارند، قابلیتی که Crossplane 2 آورد. مستندات خود Crossplane نشان می‌دهد چگونه آن را در خوشهٔ خود نصب کنید.
- **یک کلید API از پروژهٔ شما.** [شروع سریع Terraform](/docs/terraform/quick-start#ساخت-کلید-api-پروژه) نشان می‌دهد چگونه یکی را در **تنظیمات پروژه** > **پیشرفته** > **کلیدهای API** بسازید. کلید تعیین می‌کند منابع به کدام پروژه تعلق دارند و ارائه‌دهنده چه چیزی را در آن می‌تواند تغییر دهد.
- **در OneUptime Cloud، طرح Growth یا بالاتر.** کلیدهای API یک پروژه فقط روی آن کار می‌کنند.

## نصب ارائه‌دهنده

بسته را با یک `Provider` نصب کنید:

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

وقتی `INSTALLED` و `HEALTHY` هر دو `True` باشند، ارائه‌دهنده در حال اجراست. همین بسته در Docker Hub هم هست، با نام `docker.io/oneuptime/provider-oneuptime`.

### انتخاب نسخه

نسخه‌های بسته همان نسخه‌های OneUptime هستند: `{{CROSSPLANE_PROVIDER_VERSION}}` از همان نسخهٔ OneUptime ساخته شده است که این صفحه را نمایش می‌دهد. در OneUptime Cloud، جدیدترین نسخه را به کار ببرید. روی OneUptime خودمیزبان، نسخهٔ OneUptime خودتان را به کار ببرید، تا ارائه‌دهنده همان فیلدهایی را بشناسد که API OneUptime شما می‌شناسد.

### فعال کردن فقط kindهایی که به کار می‌برید

چارت Helm برای Crossplane به‌طور پیش‌فرض هر kind از هر ارائه‌دهنده را فعال می‌کند (مقدار `provider.defaultActivations` آن)، که برای این ارائه‌دهنده یعنی بیش از ۴۰۰ تعریف منبع سفارشی (CRD). برای فعال کردن فقط kindهایی که به کار می‌برید، Crossplane را با `--set provider.defaultActivations={}` نصب کنید و kindها را در یک سیاست نام ببرید:

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## دادن کلید API به ارائه‌دهنده

کلید را در یک Secret در همان namespaceی بگذارید که منابعتان در آن خواهند بود، و در همان namespace یک `ProviderConfig` بسازید که به آن اشاره کند. ساختن Secret با `kubectl` کلید را بیرون از فایل‌هایتان نگه می‌دارد:

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

یک `ProviderConfig` فقط Secretهای namespace خودش را می‌خواند، پس کلید یک namespace را نمی‌توان از namespace دیگری به کار برد. هر منبع `ProviderConfig` خود را در `spec.providerConfigRef` نام می‌برد.

### استفاده از OneUptime خودمیزبان

نشانی OneUptime خود را، بدون `/api`، به‌عنوان `url` به `ProviderConfig` بدهید:

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### اشتراک یک کلید میان namespaceها

یک `ClusterProviderConfig` یک Secret از هر namespaceی را می‌خواند، و منابع همهٔ namespaceها می‌توانند آن را نام ببرند. وقتی یک تیم به‌تنهایی کلید کل خوشه را نگه‌داری می‌کند، از آن استفاده کنید:

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

منبع با `kind: ClusterProviderConfig` در `providerConfigRef` خود آن را نام می‌برد. Secret یا فقط کلید را نگه می‌دارد، یا یک JSON که نشانی را هم در خود دارد: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. یک `url` در `ClusterProviderConfig` بر نشانی درون JSON برتری دارد. یک `ClusterProviderConfig` همچنین می‌تواند کلید را از یک متغیر محیطی یا یک فایل در پاد ارائه‌دهنده بخواند، با `source: Environment` یا `source: Filesystem`.

## ساختن نخستین منابعتان

یک مانیتور برای صفحهٔ اصلی شما، با یک برچسب، که وضعیت‌های **آفلاین** و **عملیاتی** پروژهٔ شما را تنظیم می‌کند.

:::steps
### وضعیت‌هایی را که تنظیم می‌کند مشاهده کنید

OneUptime وضعیت‌های پروژهٔ شما را همراه با خود پروژه ساخته است، پس این وضعیت‌ها به‌جای ساخته شدن، مشاهده می‌شوند: ارائه‌دهنده آن‌ها را با شناسه‌هایشان می‌خواند و هرگز تغییرشان نمی‌دهد یا حذفشان نمی‌کند. `oneuptime monitor-status list --fields _id,name` شناسه‌ها را با [OneUptime CLI](/docs/cli/resource-operations#فهرست-کردن-رکوردها) فهرست می‌کند.

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### برچسب و مانیتور را بسازید

مانیتور با نام‌های Kubernetes به برچسب و وضعیت‌ها ارجاع می‌دهد، و ارائه‌دهنده شناسه‌هایشان را پر می‌کند:

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### آن‌ها را در OneUptime ببینید

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

وقتی `SYNCED` و `READY` مقدار `True` را نشان دهند، رکورد در پروژهٔ شماست. `EXTERNAL-NAME` شناسهٔ آن در OneUptime است.
:::

## گام‌های بعدی

- [مدیریت منابع](/docs/crossplane/managing-resources) این‌ها را توضیح می‌دهد: kindها و فیلدهایشان، ارجاع‌ها، وارد کردن آنچه از قبل دارید، رازهایی که OneUptime می‌سازد، و اینکه وقتی منبعی آماده نیست به چه چیزی نگاه کنید.
- [راهنمای کامل Terraform](/docs/terraform/complete-guide) منابع و فیلدهایشان را شرح می‌دهد، که kindهای ارائه‌دهنده هم همان‌ها را دارند.
