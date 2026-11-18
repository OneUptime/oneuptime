# Kubernetes e Helm

Execute o OneUptime no seu próprio cluster Kubernetes com o chart do Helm. O seu servidor OneUptime serve esta página ele mesmo, por isso ela abre sem acesso à internet e descreve o chart da versão que você executa. Cada valor que o chart aceita está na documentação do próprio chart, no [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Instalar o chart](#instalar-o-chart): Um arquivo de valores e dois comandos.
- [Fazer backup dos seus dados](#fazer-backup-dos-seus-dados): PostgreSQL e ClickHouse, num armazenamento fora do cluster.
- [Guardar as suas chaves](#guardar-as-suas-chaves): Aquilo sem o qual os seus backups não podem ser lidos.
:::

## Instalar o chart

Crie um `values.yaml` com o nome de domínio ou o endereço IP que as pessoas vão usar, sem `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Depois instale o chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Funcionou quando** `kubectl get pods` mostra todos os pods `Running` e o endereço abre o OneUptime. O [Guia de auto-hospedagem](/docs/installation/self-hosting-guide) continua a partir daí: HTTPS, a conta de administração e o e-mail, os SMS e as chamadas.

## Fazer backup dos seus dados

O OneUptime guarda os seus dados nos volumes persistentes do cluster: o PostgreSQL contém os seus projetos, monitores, incidentes, páginas de status e usuários, e o ClickHouse os seus logs, traces e métricas. Faça backup dos dois num armazenamento fora do cluster, de uma destas formas:

- **Os backups agendados da Enterprise Edition.** Configure-os no Admin Dashboard, em **Configurações > Backups**. Veja [Backups](/docs/installation/backups).
- **Os backups dos volumes persistentes do seu provedor de nuvem**, como snapshots agendados dos discos do PostgreSQL e do ClickHouse.
- **Os backups por snapshot de volume do CloudNativePG**, quando o PostgreSQL roda no operador CloudNativePG. Ative-os no `values.yaml` e depois aplique a mudança:

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

Com este agendamento, o backup do PostgreSQL é feito todos os dias às 03:00. O CloudNativePG não apaga os snapshots de volume antigos, por isso apague você mesmo os que já não precisa.

O OneUptime não vê os backups feitos fora dele. Quando os seus estiverem em execução, clique em **Este servidor tem backup** no item Backups da página **Configuração do servidor** do Admin Dashboard.

## Guardar as suas chaves

O que o OneUptime cifra só pode ser lido com o `encryptionSecret` com que foi cifrado. Defina você mesmo `oneuptimeSecret` e `encryptionSecret` no `values.yaml`, para que nenhuma atualização os substitua, e guarde uma cópia com os seus backups, fora do cluster:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Próximos passos

:::cards
- [Guia de auto-hospedagem](/docs/installation/self-hosting-guide): De um cluster vazio a um servidor que avisa você.
- [Atualização](/docs/installation/upgrading): Faça backup antes de cada atualização.
- [Backups](/docs/installation/backups): Os backups agendados da Enterprise Edition.
:::
