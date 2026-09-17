# Operações de Recursos

O CLI do OneUptime fornece operações CRUD completas (Criar, Ler, Atualizar, Excluir) para todos os recursos suportados. Os recursos são descobertos automaticamente a partir da sua instância do OneUptime.

## Recursos Disponíveis

Execute o seguinte comando para ver todos os tipos de recursos disponíveis:

```bash
oneuptime resources
```

Você pode filtrar por tipo:

```bash
# Mostrar apenas recursos de banco de dados
oneuptime resources --type database

# Mostrar apenas recursos de análise
oneuptime resources --type analytics
```

Os recursos comuns incluem:

| Recurso                         | Comando                                 |
| ------------------------------- | --------------------------------------- |
| Incidente                       | `oneuptime incident`                    |
| Alerta                          | `oneuptime alert`                       |
| Monitor                         | `oneuptime monitor`                     |
| Status do Monitor               | `oneuptime monitor-status`              |
| Estado do Incidente             | `oneuptime incident-state`              |
| Página de Status                | `oneuptime status-page`                 |
| Política de Plantão             | `oneuptime on-call-policy`              |
| Equipe                          | `oneuptime team`                        |
| Evento de Manutenção Programada | `oneuptime scheduled-maintenance-event` |

## Listar Recursos

Recuperar uma lista de recursos com filtragem, paginação e classificação opcionais.

```bash
oneuptime <resource> list [options]
```

**Opções:**

| Opção                   | Descrição                        | Padrão  |
| ----------------------- | -------------------------------- | ------- |
| `--query <json>`        | Critérios de filtro como JSON    | Nenhum  |
| `--limit <n>`           | Número máximo de resultados      | `10`    |
| `--skip <n>`            | Número de resultados a ignorar   | `0`     |
| `--sort <json>`         | Ordem de classificação como JSON | Nenhum  |
| `-o, --output <format>` | Formato de saída                 | `table` |

**Exemplos:**

```bash
# Listar os 10 incidentes mais recentes
oneuptime incident list

# Filtrar incidentes por ID de estado
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Listar com paginação
oneuptime incident list --limit 20 --skip 40

# Classificar por data de criação (decrescente)
oneuptime incident list --sort '{"createdAt":-1}'

# Saída como JSON
oneuptime incident list -o json
```

## Obter um Recurso

Recuperar um único recurso pelo seu ID.

```bash
oneuptime <resource> get <id>
```

**Argumentos:**

| Argumento | Descrição              |
| --------- | ---------------------- |
| `<id>`    | O ID do recurso (UUID) |

**Exemplos:**

```bash
# Obter um incidente específico
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Obter um monitor como JSON
oneuptime monitor get abc-123 -o json
```

## Criar um Recurso

Criar um novo recurso a partir de JSON inline ou de um arquivo.

```bash
oneuptime <resource> create [options]
```

**Opções:**

| Opção                   | Descrição                                              |
| ----------------------- | ------------------------------------------------------ |
| `--data <json>`         | Dados do recurso como objeto JSON                      |
| `--file <path>`         | Caminho para um arquivo JSON contendo dados do recurso |
| `-o, --output <format>` | Formato de saída                                       |

Você deve fornecer `--data` ou `--file`.

**Exemplos:**

```bash
# Criar um incidente com JSON inline
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Criar a partir de um arquivo JSON
oneuptime incident create --file incident.json

# Criar e saída como JSON para capturar o ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Atualizar um Recurso

Atualizar um recurso existente por ID.

```bash
oneuptime <resource> update <id> [options]
```

**Argumentos:**

| Argumento | Descrição       |
| --------- | --------------- |
| `<id>`    | O ID do recurso |

**Opções:**

| Opção                   | Descrição                                  |
| ----------------------- | ------------------------------------------ |
| `--data <json>`         | Campos a atualizar como JSON (obrigatório) |
| `-o, --output <format>` | Formato de saída                           |

**Exemplos:**

```bash
# Alterar estado do incidente (ex.: para resolvido)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Renomear um monitor
oneuptime monitor update abc-123 --data '{"name":"Nome do Monitor Atualizado"}'
```

## Excluir um Recurso

Excluir um recurso por ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Argumentos:**

| Argumento | Descrição       |
| --------- | --------------- |
| `<id>`    | O ID do recurso |

**Opções:**

| Opção     | Descrição           |
| --------- | ------------------- |
| `--force` | Ignorar confirmação |

**Exemplos:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Ignorar confirmação
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Contar Recursos

Contar recursos que correspondem a critérios de filtro opcionais.

```bash
oneuptime <resource> count [options]
```

**Opções:**

| Opção            | Descrição                     |
| ---------------- | ----------------------------- |
| `--query <json>` | Critérios de filtro como JSON |

**Exemplos:**

```bash
# Contar todos os incidentes
oneuptime incident count

# Contar incidentes por estado
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Contar monitores
oneuptime monitor count
```

## Recursos de Análise

Os recursos de análise suportam um conjunto limitado de operações em comparação com os recursos de banco de dados:

| Operação | Suportado |
| -------- | --------- |
| `list`   | Sim       |
| `create` | Sim       |
| `count`  | Sim       |
| `get`    | Não       |
| `update` | Não       |
| `delete` | Não       |

Use `oneuptime resources --type analytics` para ver quais recursos de análise estão disponíveis na sua instância.
