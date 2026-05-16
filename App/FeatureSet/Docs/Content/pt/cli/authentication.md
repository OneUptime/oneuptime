# Autenticação

O CLI do OneUptime suporta várias formas de autenticação com sua instância do OneUptime. Você pode usar contextos nomeados, variáveis de ambiente ou passar credenciais diretamente como flags.

## Login

Autentique-se com sua instância do OneUptime usando uma chave de API:

```bash
oneuptime login <api-key> <instance-url>
```

**Argumentos:**

| Argumento | Descrição |
|----------|-------------|
| `<api-key>` | Sua chave de API do OneUptime (ex.: `sk-sua-chave-de-api`) |
| `<instance-url>` | A URL da sua instância do OneUptime (ex.: `https://oneuptime.com`) |

**Opções:**

| Opção | Descrição |
|--------|-------------|
| `--context-name <name>` | Nome para este contexto (padrão: `"default"`) |

**Exemplos:**

```bash
# Login com contexto padrão
oneuptime login sk-abc123 https://oneuptime.com

# Login com um contexto nomeado
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Configurar múltiplos ambientes
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Contextos

Os contextos permitem que você salve e alterne entre múltiplos ambientes do OneUptime (ex.: produção, staging, desenvolvimento).

### Listar Contextos

```bash
oneuptime context list
```

Exibe todos os contextos configurados. O contexto atual é marcado com `*`.

### Alternar Contexto

```bash
oneuptime context use <name>
```

Alterne para um contexto nomeado diferente para todos os comandos subsequentes.

```bash
# Alternar para staging
oneuptime context use staging

# Alternar para produção
oneuptime context use production
```

### Ver Contexto Atual

```bash
oneuptime context current
```

Exibe o contexto ativo atualmente, incluindo a URL da instância e uma chave de API mascarada.

### Excluir um Contexto

```bash
oneuptime context delete <name>
```

Remove um contexto nomeado. Se o contexto excluído for o atual, o CLI alterna automaticamente para o primeiro contexto restante.

## Resolução de Credenciais

As credenciais são resolvidas na seguinte ordem de prioridade:

1. **Flags de CLI** (`--api-key` e `--url`)
2. **Variáveis de ambiente** (`ONEUPTIME_API_KEY` e `ONEUPTIME_URL`)
3. **Contexto nomeado** (via flag `--context`)
4. **Contexto atual** (da configuração salva)

Você pode misturar fontes — por exemplo, usar uma variável de ambiente para a chave de API e um contexto salvo para a URL.

### Usando Flags de CLI

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Usando Variáveis de Ambiente

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Usando um Contexto Específico

```bash
oneuptime --context production incident list
```

## Verificar Autenticação

Verifique seu status de autenticação atual:

```bash
oneuptime whoami
```

Isso exibe:
- URL da instância
- Chave de API mascarada
- Nome do contexto atual (exibido apenas se um contexto salvo estiver ativo)

Se não estiver autenticado, o comando exibe uma mensagem útil sugerindo que você execute `oneuptime login`.

## Arquivo de Configuração

As credenciais são armazenadas em `~/.oneuptime/config.json` com permissões restritas (`0600`).

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
