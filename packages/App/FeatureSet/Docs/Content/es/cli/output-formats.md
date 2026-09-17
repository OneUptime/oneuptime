# Formatos de salida

La CLI de OneUptime admite tres formatos de salida: **table**, **JSON** y **wide**. Puedes establecer el formato con el indicador `-o` o `--output` en cualquier comando.

## Tabla (predeterminado)

El formato predeterminado cuando se ejecuta en una terminal interactiva. Muestra los resultados como una tabla ASCII con columnas seleccionadas de forma inteligente.

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

Comportamiento del formato tabla:

- Selecciona hasta 6 columnas, priorizando: `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Trunca valores de más de 60 caracteres con `...`
- Usa encabezados con código de colores (deshabilitado con `--no-color`)

## JSON

Salida JSON sin procesar, formateada con indentación de 2 espacios. Este es el mejor formato para scripting y transmisión a otras herramientas.

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

El formato JSON se usa automáticamente cuando la salida se redirige a otro comando (modo no-TTY):

```bash
# JSON se usa automáticamente al redirigir
oneuptime incident list | jq '.[].title'
```

## Wide

Muestra todas las columnas sin truncado. Útil para inspección detallada, aunque puede producir una salida muy ancha.

```bash
oneuptime incident list -o wide
```

## Deshabilitar colores

La salida con colores puede deshabilitarse de varias formas:

```bash
# Usando el indicador --no-color
oneuptime --no-color incident list

# Usando la variable de entorno NO_COLOR
NO_COLOR=1 oneuptime incident list
```

## Casos de salida especiales

| Escenario                         | Salida                       |
| --------------------------------- | ---------------------------- |
| Conjunto de resultados vacío      | `"No results found."`        |
| No se devolvieron datos           | `"No data returned."`        |
| Objeto único (por ejemplo, `get`) | Formato de tabla clave-valor |
| Comando `count`                   | Valor numérico simple        |
