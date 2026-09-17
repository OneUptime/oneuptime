# Referência de Comandos

Referência completa para todos os comandos do CLI do OneUptime.

## Comandos de Autenticação

### `oneuptime login`

Autentique-se com uma instância do OneUptime.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Parâmetro        | Tipo      | Obrigatório | Descrição                              |
| ---------------- | --------- | ----------- | -------------------------------------- |
| `<api-key>`      | argumento | Sim         | Chave de API para autenticação         |
| `<instance-url>` | argumento | Sim         | URL da instância do OneUptime          |
| `--context-name` | opção     | Não         | Nome do contexto (padrão: `"default"`) |

---

### `oneuptime context list`

Listar todos os contextos salvos.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Alternar para um contexto nomeado.

```bash
oneuptime context use <name>
```

| Parâmetro | Tipo      | Obrigatório | Descrição                      |
| --------- | --------- | ----------- | ------------------------------ |
| `<name>`  | argumento | Sim         | Nome do contexto a ser ativado |

---

### `oneuptime context current`

Exibir o contexto ativo com chave de API mascarada.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Remover um contexto salvo.

```bash
oneuptime context delete <name>
```

| Parâmetro | Tipo      | Obrigatório | Descrição                       |
| --------- | --------- | ----------- | ------------------------------- |
| `<name>`  | argumento | Sim         | Nome do contexto a ser excluído |

---

## Comandos de Recursos

Todos os comandos de recursos seguem o mesmo padrão. Substitua `<resource>` por qualquer nome de recurso suportado (ex.: `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

Listar recursos com filtragem e paginação.

```bash
oneuptime <resource> list [options]
```

| Opção            | Tipo   | Padrão  | Descrição                        |
| ---------------- | ------ | ------- | -------------------------------- |
| `--query <json>` | string | Nenhum  | Critérios de filtro como JSON    |
| `--limit <n>`    | number | `10`    | Máximo de resultados             |
| `--skip <n>`     | number | `0`     | Resultados a ignorar             |
| `--sort <json>`  | string | Nenhum  | Ordem de classificação como JSON |
| `-o, --output`   | string | `table` | Formato de saída                 |

---

### `oneuptime <resource> get`

Obter um único recurso por ID.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Parâmetro      | Tipo      | Obrigatório | Descrição            |
| -------------- | --------- | ----------- | -------------------- |
| `<id>`         | argumento | Sim         | ID do recurso (UUID) |
| `-o, --output` | opção     | Não         | Formato de saída     |

---

### `oneuptime <resource> create`

Criar um novo recurso.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Opção           | Tipo   | Obrigatório                | Descrição                  |
| --------------- | ------ | -------------------------- | -------------------------- |
| `--data <json>` | string | Um de `--data` ou `--file` | Dados do recurso como JSON |
| `--file <path>` | string | Um de `--data` ou `--file` | Caminho para arquivo JSON  |
| `-o, --output`  | string | Não                        | Formato de saída           |

---

### `oneuptime <resource> update`

Atualizar um recurso existente.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Parâmetro       | Tipo      | Obrigatório | Descrição                    |
| --------------- | --------- | ----------- | ---------------------------- |
| `<id>`          | argumento | Sim         | ID do recurso                |
| `--data <json>` | opção     | Sim         | Campos a atualizar como JSON |
| `-o, --output`  | opção     | Não         | Formato de saída             |

---

### `oneuptime <resource> delete`

Excluir um recurso.

```bash
oneuptime <resource> delete <id> [--force]
```

| Parâmetro | Tipo      | Obrigatório | Descrição           |
| --------- | --------- | ----------- | ------------------- |
| `<id>`    | argumento | Sim         | ID do recurso       |
| `--force` | opção     | Não         | Ignorar confirmação |

---

### `oneuptime <resource> count`

Contar recursos que correspondem a um filtro.

```bash
oneuptime <resource> count [--query <json>]
```

| Opção            | Tipo   | Padrão | Descrição                     |
| ---------------- | ------ | ------ | ----------------------------- |
| `--query <json>` | string | Nenhum | Critérios de filtro como JSON |

---

## Comandos Utilitários

### `oneuptime version`

Exibir a versão do CLI.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Mostrar detalhes de autenticação atuais.

```bash
oneuptime whoami
```

Exibe a URL da instância e a chave de API mascarada. Se um contexto salvo estiver ativo, o nome do contexto também é exibido.

---

### `oneuptime resources`

Listar todos os tipos de recursos disponíveis.

```bash
oneuptime resources [--type <type>]
```

| Opção           | Tipo   | Padrão | Descrição                             |
| --------------- | ------ | ------ | ------------------------------------- |
| `--type <type>` | string | Nenhum | Filtrar por `database` ou `analytics` |

---

## Opções Globais

Estas flags estão disponíveis em todos os comandos:

| Opção                   | Descrição                                 |
| ----------------------- | ----------------------------------------- |
| `--api-key <key>`       | Substituir chave de API                   |
| `--url <url>`           | Substituir URL da instância               |
| `--context <name>`      | Usar um contexto específico               |
| `-o, --output <format>` | Formato de saída: `json`, `table`, `wide` |
| `--no-color`            | Desativar saída colorida                  |
| `--help`                | Exibir ajuda                              |
| `--version`             | Exibir versão                             |

## Rotas de API

Para referência, o CLI mapeia comandos para estes endpoints de API:

| Comando  | Método | Endpoint                        |
| -------- | ------ | ------------------------------- |
| `list`   | POST   | `/api/<resource>/get-list`      |
| `get`    | POST   | `/api/<resource>/<id>/get-item` |
| `create` | POST   | `/api/<resource>`               |
| `update` | PUT    | `/api/<resource>/<id>/`         |
| `delete` | DELETE | `/api/<resource>/<id>/`         |
| `count`  | POST   | `/api/<resource>/count`         |

Todas as requisições incluem o cabeçalho `APIKey` para autenticação.
