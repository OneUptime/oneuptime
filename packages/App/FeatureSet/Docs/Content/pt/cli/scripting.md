# Scripts e CI/CD

A CLI funciona em um script do mesmo jeito que em um terminal. Dê a ela uma chave de API em variáveis de ambiente, leia as respostas dela como JSON e deixe o código de saída dela dizer ao script o que aconteceu. Esta página mostra cada uma dessas coisas, e pipelines completos para GitHub Actions, GitLab CI e Docker.

:::cards
- [Dar a um script sua chave de API](#dar-a-um-script-sua-chave-de-api): Duas variáveis de ambiente, nenhum contexto salvo.
- [Códigos de saída](#códigos-de-saída): 0 quando funcionou, e por que não funcionou.
- [Ler respostas com jq](#ler-respostas-com-jq): IDs, títulos e datas tirados do JSON.
- [Exemplos de pipelines](#exemplos-de-pipelines): GitHub Actions, GitLab CI e Docker.
:::

## Como um script usa a CLI

Uma implantação pode primeiro perguntar ao OneUptime se há um incidente aberto, e parar se houver:

```mermaid title="Uma implantação que espera enquanto há um incidente aberto"
flowchart TB
    J["O job de CI começa"] --> S["Os segredos dele definem<br/>ONEUPTIME_API_KEY<br/>e ONEUPTIME_URL"]
    S --> Q["oneuptime incident count<br/>dos incidentes não resolvidos"]
    Q -->|"0"| D["Implantar"]
    Q -->|"1 ou mais"| X["Parar: há um<br/>incidente aberto"]
    Q -->|"código de saída 2"| A["Parar: verificar<br/>a chave de API"]
```

## Dar a um script sua chave de API

Defina `ONEUPTIME_API_KEY` e `ONEUPTIME_URL` a partir dos segredos do seu sistema de CI. A CLI então não precisa de `login` nem de arquivo de configuração. Uma flag ainda vem antes delas para um único comando, e elas vêm antes dos contextos salvos.

```bash
export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="https://oneuptime.com"
oneuptime incident count
```

> [!TIP]
> Dê a cada pipeline uma chave de API própria, com só o acesso de que ele precisa: uma verificação que só lê precisa de uma chave que só lê. Exclua a chave no OneUptime quando o pipeline for desativado.

Se uma máquina executa jobs de vários projetos, salve um contexto para cada um e nomeie-o em cada comando, para que um job nunca use o contexto atual de outro:

```bash
oneuptime --context production incident count
oneuptime --context staging monitor count
```

## Códigos de saída

| Código | Significado | Por exemplo |
| --- | --- | --- |
| `0` | Funcionou | Uma listagem, mesmo uma que não encontra nada |
| `1` | Falhou | O OneUptime recusou a requisição, como `API error (422)`; JSON inválido; uma opção ausente ou desconhecida; um contexto que não está salvo |
| `2` | Nenhuma chave de API utilizável | Credenciais não encontradas; uma chave de API inválida; uma chave abaixo do seu plano (`402`); `401` |
| `3` | Não encontrado | O OneUptime respondeu `404`: o registro não existe, está em outro projeto, ou a chave não pode lê-lo |

`whoami` e `context current` terminam com `0` mesmo quando nada está salvo: eles informam o que está definido, não o verificam. Um script distingue os casos pelo código:

```bash
oneuptime incident get "$INCIDENT_ID" -o json > incident.json
case $? in
  0) echo "Saved the incident to incident.json" ;;
  2) echo "Check ONEUPTIME_API_KEY and ONEUPTIME_URL" >&2; exit 1 ;;
  3) echo "There is no incident $INCIDENT_ID" >&2; exit 1 ;;
  *) echo "OneUptime refused the request" >&2; exit 1 ;;
esac
```

As mensagens de erro vão para a saída de erro padrão, então `incident.json` contém só a resposta.

## Ler respostas com jq

Escreva `-o json` nos scripts. Em um pipe a CLI imprime JSON de qualquer forma, mas a flag mantém o script funcionando onde quer que ele rode:

```bash
# The title of each incident
oneuptime incident list -o json | jq -r '.[].title'

# The ID of a new monitor
MONITOR_ID=$(oneuptime monitor create --data '{"name":"Checkout API","monitorType":"Manual"}' -o json | jq -r '._id')

# When each incident was created: dates come as objects
oneuptime incident list -o json | jq -r '.[] | "\(.createdAt.value)  \(.title)"'

# The newest 100 incidents as CSV
oneuptime incident list --limit 100 -o json | jq -r '.[] | [._id, .title, .createdAt.value] | @csv'
```

Uma contagem imprime um único número, pronto para comparar:

```bash
OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
echo "$OPEN incidents are open"
```

## Criar registros a partir de arquivos

Mantenha os registros como arquivos JSON ao lado do seu código, e crie-os a partir dali:

```json title="monitors/checkout-api.json"
{
  "name": "Checkout API",
  "monitorType": "Manual"
}
```

```bash
oneuptime monitor create --file monitors/checkout-api.json
```

Muitos registros a partir de um array JSON, uma criação para cada um:

```bash
jq -c '.[]' monitors.json | while IFS= read -r monitor; do
  oneuptime monitor create --data "$monitor" -o json | jq -r '._id'
done
```

> [!NOTE]
> Cada execução cria registros novos. Para manter monitores e páginas de status em sincronia com arquivos, alterar só o que mudou e remover o que saiu, use o [provedor Terraform](/docs/terraform/index).

## Exemplos de pipelines

:::tabs
@tab GitHub Actions
```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - name: Install the OneUptime CLI
        run: npm install -g @oneuptime/cli
      - name: Stop while an incident is open
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
          if [ "$OPEN" -gt 0 ]; then
            echo "$OPEN incidents are open: not deploying."
            exit 1
          fi
      - name: Deploy
        run: ./deploy.sh
```
@tab GitLab CI
```yaml title=".gitlab-ci.yml"
check-incidents:
  stage: test
  image: node:lts
  variables:
    ONEUPTIME_URL: https://oneuptime.com
  script:
    - npm install -g @oneuptime/cli
    - OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
    - echo "$OPEN incidents are open"
    - test "$OPEN" -eq 0
```
@tab Docker
```dockerfile title="Dockerfile"
FROM node:lts-slim
RUN npm install -g @oneuptime/cli
ENTRYPOINT ["oneuptime"]
```
:::

No GitHub Actions, adicione `ONEUPTIME_API_KEY` em **Settings → Secrets and variables → Actions** do repositório; no GitLab, adicione-a como uma variável de CI/CD mascarada. Com a imagem Docker, passe as variáveis a cada execução:

```bash
docker build -t oneuptime-cli .
docker run --rm -e ONEUPTIME_API_KEY -e ONEUPTIME_URL oneuptime-cli incident count
```

## Próximos passos

:::cards
- [Autenticação](/docs/cli/authentication): Qual chave um comando usa quando várias estão definidas.
- [Formatos de saída](/docs/cli/output-formats): O JSON que seus scripts leem.
- [Operações de recursos](/docs/cli/resource-operations): Filtros, paginação e os campos de um registro.
- [Provedor Terraform](/docs/terraform/index): Manter a configuração do OneUptime em arquivos.
:::
