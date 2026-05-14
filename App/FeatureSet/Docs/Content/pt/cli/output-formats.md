# Formatos de Saída

O CLI do OneUptime suporta três formatos de saída: **tabela**, **JSON** e **wide**. Você pode definir o formato com a flag `-o` ou `--output` em qualquer comando.

## Tabela (Padrão)

O formato padrão ao executar em um terminal interativo. Exibe os resultados como uma tabela ASCII com colunas selecionadas de forma inteligente.

```bash
oneuptime incident list
```

```
┌──────────────────┬───────────────────────┬─────────────────────┬─────────────────────┐
│ _id              │ title                 │ createdAt           │ updatedAt           │
├──────────────────┼───────────────────────┼─────────────────────┼─────────────────────┤
│ abc-123          │ API Outage            │ 2025-01-15T10:30:00 │ 2025-01-15T12:00:00 │
│ def-456          │ Database Slowdown     │ 2025-01-14T08:15:00 │ 2025-01-14T09:30:00 │
└──────────────────┴───────────────────────┴─────────────────────┴─────────────────────┘
```

Comportamento do formato de tabela:
- Seleciona até 6 colunas, priorizando: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Trunca valores com mais de 60 caracteres com `...`
- Usa cabeçalhos codificados por cores (desative com `--no-color`)

## JSON

Saída JSON bruta, formatada com indentação de 2 espaços. Este é o melhor formato para scripting e encaminhamento para outras ferramentas.

```bash
oneuptime incident list -o json
```

```json
[
  {
    "_id": "abc-123",
    "title": "API Outage",
    "currentIncidentStateId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

O formato JSON é usado automaticamente quando a saída é encaminhada para outro comando (modo não-TTY):

```bash
# JSON é usado automaticamente ao encaminhar
oneuptime incident list | jq '.[].title'
```

## Wide

Exibe todas as colunas sem truncamento. Útil para inspeção detalhada, mas pode produzir saída muito larga.

```bash
oneuptime incident list -o wide
```

## Desativando Cores

A saída colorida pode ser desativada de várias formas:

```bash
# Usando a flag --no-color
oneuptime --no-color incident list

# Usando a variável de ambiente NO_COLOR
NO_COLOR=1 oneuptime incident list
```

## Casos Especiais de Saída

| Cenário | Saída |
|----------|--------|
| Conjunto de resultados vazio | `"No results found."` |
| Nenhum dado retornado | `"No data returned."` |
| Objeto único (ex.: `get`) | Formato de tabela chave-valor |
| Comando `count` | Valor numérico simples |
