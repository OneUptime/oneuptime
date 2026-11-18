# Kubernetes и Helm

Запускайте OneUptime в собственном кластере Kubernetes с помощью Helm-чарта. Ваш сервер OneUptime сам отдаёт эту страницу, поэтому она открывается без выхода в интернет и описывает чарт той версии, которую вы запускаете. Все значения, которые принимает чарт, описаны в документации самого чарта на [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Установите чарт](#установите-чарт): Один файл значений и две команды.
- [Сделайте резервную копию данных](#сделайте-резервную-копию-данных): PostgreSQL и ClickHouse, в хранилище за пределами кластера.
- [Сохраните ключи](#сохраните-ключи): То, без чего резервные копии не прочитать.
:::

## Установите чарт

Создайте `values.yaml` с доменным именем или IP-адресом, по которому будут открывать OneUptime, без `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Затем установите чарт:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Сработало, если** `kubectl get pods` показывает каждый под в состоянии `Running`, а адрес открывает OneUptime. [Руководство по самостоятельному хостингу](/docs/installation/self-hosting-guide) продолжает с этого места: HTTPS, учётная запись администратора, а также почта, SMS и звонки.

## Сделайте резервную копию данных

OneUptime хранит данные на постоянных томах кластера: в PostgreSQL — ваши проекты, мониторы, инциденты, страницы статуса и пользователи, в ClickHouse — ваши логи, трейсы и метрики. Делайте резервные копии обеих баз в хранилище за пределами кластера одним из этих способов:

- **Плановые резервные копии Enterprise Edition.** Настройте их в Admin Dashboard в разделе **Настройки > Резервные копии**. См. [Резервные копии](/docs/installation/backups).
- **Резервные копии постоянных томов у вашего облачного провайдера**, например плановые снимки дисков PostgreSQL и ClickHouse.
- **Резервные копии CloudNativePG на основе снимков томов**, если PostgreSQL работает под оператором CloudNativePG. Включите их в `values.yaml`, затем примените изменение:

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

По этому расписанию резервная копия PostgreSQL делается каждый день в 03:00. CloudNativePG не удаляет старые снимки томов, поэтому удаляйте ненужные сами.

OneUptime не видит резервные копии, сделанные вне OneUptime. Когда ваши заработают, нажмите **Для этого сервера есть резервные копии** в пункте «Резервные копии» на странице **Настройка сервера** в Admin Dashboard.

## Сохраните ключи

То, что шифрует OneUptime, можно прочитать только с тем `encryptionSecret`, которым оно было зашифровано. Задайте `oneuptimeSecret` и `encryptionSecret` сами в `values.yaml`, чтобы ни одно обновление их не заменило, и храните копию вместе с резервными копиями, за пределами кластера:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Дальнейшие шаги

:::cards
- [Руководство по самостоятельному хостингу](/docs/installation/self-hosting-guide): От пустого кластера до сервера, который вызывает вас.
- [Обновление](/docs/installation/upgrading): Делайте резервную копию перед каждым обновлением.
- [Резервные копии](/docs/installation/backups): Плановые резервные копии Enterprise Edition.
:::
