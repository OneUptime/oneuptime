# Scripting e CI/CD

O CLI do OneUptime é projetado para automação. Suporta autenticação baseada em variáveis de ambiente, saída JSON para análise programática e códigos de saída apropriados para integração em pipelines.

## Variáveis de Ambiente

Defina estas variáveis de ambiente para autenticar sem contextos salvos:

```bash
export ONEUPTIME_API_KEY=sk-sua-chave-de-api
export ONEUPTIME_URL=https://oneuptime.com
```

Estas têm precedência sobre contextos salvos, mas são substituídas por flags de CLI.

## Códigos de Saída

| Código | Significado |
|------|---------|
| `0` | Sucesso |
| `1` | Erro geral |
| `2` | Erro de autenticação (credenciais ausentes ou inválidas) |
| `3` | Não encontrado (404) |

Use códigos de saída em scripts para lidar com erros:

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Falha ao listar monitores"
  exit 1
fi
```

## Processamento JSON com jq

Use `-o json` para produzir saída legível por máquina:

```bash
# Extrair todos os títulos de incidentes
oneuptime incident list -o json | jq '.[].title'

# Obter o ID de um monitor recém-criado
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Monitor criado: $NEW_ID"

# Contar incidentes por severidade
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## Criando Recursos a Partir de Arquivos

Use `--file` para criar recursos a partir de arquivos JSON, útil para infraestrutura controlada por versão:

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## Operações em Lote

Processar múltiplos recursos em um loop:

```bash
# Criar múltiplos monitores a partir de um arquivo de array JSON
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## Exemplos de Pipeline de CI/CD

### GitHub Actions

```yaml
name: Check Active Incidents
on:
  schedule:
    - cron: '*/5 * * * *'

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Install OneUptime CLI
        run: npm install -g @oneuptime/cli

      - name: Check for active incidents
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          INCIDENT_COUNT=$(oneuptime incident count)
          if [ "$INCIDENT_COUNT" -gt 0 ]; then
            echo "WARNING: $INCIDENT_COUNT incidents found"
            exit 1
          fi
```

### Script Genérico de CI/CD

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Criar um incidente de implantação e capturar o ID
# Nota: currentIncidentStateId e incidentSeverityId devem referenciar IDs de estado/severidade existentes no seu projeto
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Execute as etapas de implantação aqui...

# Resolver o incidente após implantação bem-sucedida
oneuptime incident update "$INCIDENT_ID" --data '{"currentIncidentStateId":"'"$RESOLVED_STATE_ID"'"}'
```

### Docker

```dockerfile
FROM node:26-slim
RUN npm install -g @oneuptime/cli
ENV ONEUPTIME_API_KEY=""
ENV ONEUPTIME_URL=""
ENTRYPOINT ["oneuptime"]
```

```bash
docker run --rm \
  -e ONEUPTIME_API_KEY=sk-abc123 \
  -e ONEUPTIME_URL=https://oneuptime.com \
  oneuptime-cli incident list
```

## Usando um Contexto Específico em Scripts

Se você tiver múltiplos contextos salvos, direcione para um específico:

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
