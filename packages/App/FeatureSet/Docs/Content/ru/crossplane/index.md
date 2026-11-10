# Обзор Crossplane

Провайдер Crossplane для OneUptime управляет вашим проектом OneUptime из Kubernetes. Опишите мониторы, страницы состояния, политики дежурства, команды, метки и другие записи проекта как ресурсы Kubernetes, и Crossplane будет поддерживать проект таким, как в них сказано: создавать новое, менять то, что вы отредактировали, откатывать то, что кто-то изменил в другом месте, и удалять то, что вы убрали. Их применяют и Argo CD, Flux, и любой другой инструмент, который применяет манифесты. Провайдер работает с OneUptime Cloud и с OneUptime на собственном хостинге.

:::cards
- [Как работает провайдер](#как-работает-провайдер): Типы, пространства имён и API-ключ за ними.
- [Установка провайдера](#установка-провайдера): Пакет и версия, которую нужно выбрать.
- [Передача API-ключа](#передача-api-ключа): Secret и ProviderConfig в вашем пространстве имён.
- [Создание первых ресурсов](#создание-первых-ресурсов): Монитор, его метка и статусы, которые он выставляет.
:::

## Как работает провайдер

Провайдер — это пакет Crossplane. После установки он добавляет в группу API `crossplane.oneuptime.com` тип для каждого вида записей API OneUptime: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` и ещё более 400. Каждый ресурс этих типов находится в пространстве имён и представляет одну запись вашего проекта. Провайдер читает и изменяет запись через REST API OneUptime с API-ключом вашего проекта и записывает то, что находит, в статус ресурса.

Провайдер собирается из [провайдера Terraform](/docs/terraform/index) выпуск за выпуском: его типы — это ресурсы провайдера Terraform, с теми же полями и теми же запросами к API за ними.

## Перед началом

- **Crossplane 2.0 или новее.** Ресурсы провайдера находятся в пространствах имён — это появилось в Crossplane 2. Как установить Crossplane в кластер, показано в его собственной документации.
- **API-ключ вашего проекта.** [Быстрый старт](/docs/terraform/quick-start#создайте-api-ключ-проекта) для Terraform показывает, как создать его в **Настройки проекта → Расширенный → Ключи API**. Ключ определяет, какому проекту принадлежат ресурсы и что провайдер может в нём менять.
- **В OneUptime Cloud — тариф Growth или выше.** API-ключи проекта работают только на нём.

## Установка провайдера

Установите пакет с помощью `Provider`:

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

Когда и `INSTALLED`, и `HEALTHY` показывают `True`, провайдер работает. Тот же пакет есть на Docker Hub под именем `docker.io/oneuptime/provider-oneuptime`.

### Выбор версии

Версии пакета — это версии OneUptime: `{{CROSSPLANE_PROVIDER_VERSION}}` собран из того выпуска OneUptime, на котором работает эта страница. В OneUptime Cloud используйте самую новую. На OneUptime с собственным хостингом используйте версию вашего OneUptime, чтобы провайдер знал те же поля, что и API вашего OneUptime.

### Активация только нужных типов

Helm-чарт Crossplane по умолчанию активирует все типы всех провайдеров (его значение `provider.defaultActivations`), а для этого провайдера это более 400 определений пользовательских ресурсов. Чтобы активировать только нужные вам типы, установите Crossplane с `--set provider.defaultActivations={}` и перечислите типы в политике:

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

## Передача API-ключа

Поместите ключ в Secret того пространства имён, в котором будут находиться ваши ресурсы, и укажите этот Secret в `ProviderConfig` того же пространства имён. Если создать Secret через `kubectl`, ключ не попадёт в ваши файлы:

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

`ProviderConfig` читает Secret только из своего пространства имён, поэтому ключ одного пространства имён нельзя использовать из другого. Каждый ресурс указывает свой `ProviderConfig` в `spec.providerConfigRef`.

### OneUptime на собственном хостинге

Укажите в `ProviderConfig` адрес вашего OneUptime в поле `url`, без `/api`:

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

### Общий ключ для нескольких пространств имён

`ClusterProviderConfig` читает Secret из любого пространства имён, и на него могут ссылаться ресурсы всех пространств имён. Используйте его, когда ключом для всего кластера занимается одна команда:

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

Ресурс ссылается на него через `kind: ClusterProviderConfig` в своём `providerConfigRef`. Secret содержит только ключ или JSON, в котором указан ещё и адрес: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. `url` в `ClusterProviderConfig` имеет приоритет над адресом из JSON. `ClusterProviderConfig` может также читать ключ из переменной окружения или из файла в поде провайдера: для этого задайте `source: Environment` или `source: Filesystem`.

## Создание первых ресурсов

Монитор вашей главной страницы с меткой, который выставляет статусы проекта **Не в сети** и **Работает**.

:::steps
### Наблюдайте за статусами, которые он выставляет

OneUptime создал статусы вашего проекта вместе с проектом, поэтому их не создают, а только наблюдают за ними: провайдер читает их по ID и никогда не меняет и не удаляет. `oneuptime monitor-status list --fields _id,name` выводит их ID с помощью [CLI OneUptime](/docs/cli/resource-operations#вывод-записей).

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

### Создайте метку и монитор

Монитор ссылается на метку и статусы по их именам в Kubernetes, а провайдер подставляет их ID:

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

### Найдите их в OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Когда `SYNCED` и `READY` показывают `True`, запись уже в вашем проекте. `EXTERNAL-NAME` — это её ID в OneUptime.
:::

## Дальнейшие шаги

- [Управление ресурсами](/docs/crossplane/managing-resources) объясняет типы и их поля, ссылки, импорт того, что у вас уже есть, секреты, которые создаёт OneUptime, и на что смотреть, когда ресурс не готов.
- [Полное руководство по Terraform](/docs/terraform/complete-guide) описывает ресурсы и их поля, общие с типами провайдера.
