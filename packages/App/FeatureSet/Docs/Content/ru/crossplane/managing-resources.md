# Управление ресурсами

Эта страница посвящена ресурсам провайдера после того, как заработали первые из них: как называются типы и поля, как ресурсы ссылаются друг на друга, как импортировать то, что уже есть в вашем проекте, секреты, которые создаёт OneUptime, что происходит с изменениями, сделанными вне Kubernetes, и на что смотреть, когда ресурс не готов. Чтобы установить провайдер и создать первые ресурсы, начните с раздела [Обзор Crossplane](/docs/crossplane/index).

:::cards
- [Типы и поля](#типы-и-поля): Ресурсы Terraform, из которых они собраны, и как они называются.
- [Ссылки на другие ресурсы](#ссылки-на-другие-ресурсы): Имена вместо ID на любой глубине шагов монитора.
- [Импорт того, что уже есть](#импорт-того-что-уже-есть): Наблюдайте за записью по её ID, а затем возьмите её под управление.
- [Устранение неполадок ресурса](#устранение-неполадок-ресурса): Его условия, события и логи провайдера.
:::

## Типы и поля

Каждый ресурс [провайдера Terraform](/docs/terraform/index) — это тип с именем в CamelCase: `oneuptime_status_page` становится `StatusPage`, а `oneuptime_on_call_policy` — `OnCallPolicy`. К имени, которое заканчивалось бы на Spec, Status или List, добавляется Definition, поэтому `oneuptime_monitor_status` становится `MonitorStatusDefinition`. Некоторые из типов:

| Тип | Запись | Ресурс Terraform |
| --- | --- | --- |
| `Monitor` | Монитор | `oneuptime_monitor` |
| `StatusPage` | Страница статуса | `oneuptime_status_page` |
| `OnCallPolicy` | Политика дежурства | `oneuptime_on_call_policy` |
| `Team` | Команда | `oneuptime_team` |
| `Label` | Метка | `oneuptime_label` |
| `IncidentSeverity` | Серьёзность инцидента | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | Статус монитора | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | Ключ приёма телеметрии | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` выводит все типы, активированные в вашем кластере.

Поля типа — это аргументы ресурса Terraform в camelCase внутри `spec.forProvider`: `monitoring_interval` становится `monitoringInterval`. Поле, которое в Terraform записывается через `jsonencode()`, принимает строку JSON. `kubectl explain` описывает каждое поле так же, как провайдер Terraform, а [Полное руководство по Terraform](/docs/terraform/complete-guide) показывает, как они используются:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` показывает запись такой, какая она в OneUptime, вместе с её `id`. Поле, которое вы не указали, а OneUptime заполнил, например значение по умолчанию, копируется в `spec.forProvider` после создания записи, чтобы при следующей проверке менять было нечего. Поле, которое OneUptime сам поддерживает в актуальном состоянии или тоже меняет, не копируется никогда: см. [Поля, которые ведёт OneUptime](#поля-которые-ведёт-oneuptime).

## Ссылки на другие ресурсы

Каждое поле, которое содержит ID другой записи, принимает и ссылку на ресурс, который эту запись представляет. `<field>Ref` указывает ресурс из того же пространства имён, а `<field>Selector` выбирает ресурс по его меткам Kubernetes. Список ID, например `labels`, принимает `labelsRefs` и `labelsSelector`. Провайдер ждёт, пока ресурс, на который ведёт ссылка, появится в OneUptime, а затем подставляет его ID.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Ссылки работают и внутри шагов монитора: статус критерия (`monitorStatusIdRef`), а также серьёзность, команды-владельцы, политики дежурства и метки инцидентов и оповещений, которые он создаёт (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Типа для человека нет: поле указывает человека по ID пользователя, как это делает `ownerUserIds`, а многие типы принимают рядом с ним и адрес электронной почты, как `TeamMember` в `userEmail` ([Люди и команды](/docs/terraform/people-and-teams)).

## Импорт того, что уже есть

Ресурс, который наблюдает за записью, читает её по ID и никогда не меняет и не удаляет. Задайте ID как внешнее имя ресурса, а `Observe` — как его единственную политику управления:

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

ID записи есть в блоке `import`, который пишет её страница **Для разработчиков → Terraform** в панели управления, а `oneuptime <resource> list` выводит ID записей одного вида с помощью [CLI OneUptime](/docs/cli/resource-operations#вывод-записей). Когда ресурс готов, `status.atProvider` показывает запись. Чтобы дальше управлять ею, впишите её поля в `spec.forProvider` и задайте для `managementPolicies` значение `["*"]`.

## Секреты

### Секреты, которые создаёт OneUptime

У некоторых записей есть секрет, который создаёт OneUptime, например у ключа приёма телеметрии. Провайдер никогда не помещает его в ресурс: он записывает его в Secret в пространстве имён ресурса, указанный в `writeConnectionSecretToRef`, под ключом, который состоит из `attribute.` и имени атрибута Terraform:

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

При удалении ресурса удаляется и Secret.

### Секреты, которые передаёте вы

Поле, которое содержит секрет, например парольную фразу закрытого ключа клиента TLS в шаге монитора, принимает вместо значения Secret из пространства имён ресурса: `tlsClientKeyPassphraseSecretRef` с `name` и `key` этого Secret.

## Изменения вне Kubernetes

Провайдер каждые 10 минут сверяет каждый ресурс с его записью и откатывает всё, что кто-то изменил в OneUptime, кроме изменений в поле, которое OneUptime тоже меняет (см. ниже). Чтобы проверять чаще, задайте провайдеру конфигурацию среды выполнения с `--poll`:

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

Чтобы после создания записи полем распоряжалась панель управления, укажите его в `spec.initProvider` вместо `spec.forProvider`: запись создаётся с ним, а провайдер никогда не копирует его в `spec.forProvider` и не откатывает. Это работает для любого необязательного поля; обязательное поле, например `name` монитора, указывается в `spec.forProvider`. Чтобы панели управления принадлежала вся запись, уберите `Update` из политик управления ресурса: `["Observe", "Create", "Delete", "LateInitialize"]`.

### Поля, которые ведёт OneUptime

Некоторые поля OneUptime поддерживает в актуальном состоянии сам или тоже меняет, и провайдер не трогает изменения OneUptime: он никогда не копирует эти поля в `spec.forProvider` и никогда не откатывает.

- Поле, в которое пишет только OneUptime, например когда последний раз запускался монитор телеметрии (`telemetryMonitorLastMonitorAt`) или сколько узлов в Kubernetes-кластере (`nodeCount`), есть только в `status.atProvider`.
- Поле с начальным значением, например `currentMonitorStatusId` монитора или `currentIncidentStateId` инцидента, можно задать при создании записи, в `spec.initProvider` или в `spec.forProvider`. После этого значение меняет OneUptime, как проверки монитора меняют его статус, а `status.atProvider` показывает, каково оно сейчас.
- Поле, которое меняете и вы, и OneUptime, например `labels` записи, в которые правила меток добавляют метки, `isResolved` исключения или `siteId` сетевого устройства, который меняется при обнаружении, вы задаёте в `spec.forProvider` сами. Провайдер отправляет его при создании записи и снова каждый раз, когда значение в манифесте меняется, а изменение, которое OneUptime тем временем вносит, не трогает. Список, например `labels`, сохраняет элементы, которые добавил OneUptime, получает обратно элемент, который есть в манифесте, но который кто-то убрал, и теряет элемент, который вы убираете из манифеста.

`kubectl explain` говорит об этом в описании каждого поля с начальным значением или поля, которое OneUptime тоже меняет. Ресурс, у которого более ранняя версия провайдера заполнила `spec.forProvider` этими полями, сам перестаёт бороться с OneUptime, и править ничего не нужно.

Провайдер хранит в аннотации `crossplane.oneuptime.com/last-applied` ресурса то, что манифест в последний раз применил к полям, которые OneUptime тоже меняет. В списке, который заполнила более ранняя версия провайдера, например в `labels`, элемент, который вы убираете, остаётся в записи как элемент OneUptime; элемент, который есть в манифесте после того, как вы впервые изменили список, принадлежит вам и убирается из записи, когда вы его убираете.

## Удаление ресурса

Удаление ресурса удаляет его запись в OneUptime. Чтобы сохранить запись, уберите `Delete` из политик управления ресурса до его удаления: `["Observe", "Create", "Update", "LateInitialize"]`. Ресурс, который только наблюдает, никогда не удаляет свою запись.

## Устранение неполадок ресурса

`kubectl -n team-a get managed` показывает `SYNCED` и `READY` каждого ресурса. Если одно из них не `True`, причину объясняют условия и события ресурса, а если API отклонил запрос, там же есть ответ OneUptime:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Сообщение | Что проверить |
| --- | --- |
| `cannot read the API key` | Secret, который указан в `ProviderConfig`, или ключ в нём. |
| `cannot get referenced ProviderConfig` | Ресурс указывает `ProviderConfig`, которого нет в его пространстве имён. Для конфигурации уровня кластера используйте `kind: ClusterProviderConfig`. |
| Ссылка, которую не удаётся разрешить | Ресурса, на который она указывает, нет в пространстве имён, или он ещё не готов. |
| Ошибка API OneUptime | Разрешения API-ключа и значение поля, которое называет ошибка. |

Логи провайдера расскажут больше, а ещё больше — если добавить `--debug` в его `args`, как `--poll` выше:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Проверка пакета

Каждый выпуск подписывает пакет утилитой cosign от Sigstore в режиме keyless, так же как образы OneUptime. Чтобы проверить пакет перед установкой:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
