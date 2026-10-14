# Scripts y CI/CD

La CLI funciona igual en un script que en una terminal. Dele una clave de API en variables de entorno, lea sus respuestas como JSON y deje que su código de salida diga al script qué pasó. Esta página muestra cada una de estas cosas, y pipelines completas para GitHub Actions, GitLab CI y Docker.

:::cards
- [Dar a un script su clave de API](#dar-a-un-script-su-clave-de-api): Dos variables de entorno, ningún contexto guardado.
- [Códigos de salida](#códigos-de-salida): 0 cuando funcionó, y por qué no funcionó.
- [Leer respuestas con jq](#leer-respuestas-con-jq): ID, títulos y fechas sacados del JSON.
- [Ejemplos de pipelines](#ejemplos-de-pipelines): GitHub Actions, GitLab CI y Docker.
:::

## Cómo usa un script la CLI

Un despliegue puede preguntar primero a OneUptime si hay un incidente abierto, y detenerse si lo hay:

```mermaid title="Un despliegue que espera mientras haya un incidente abierto"
flowchart TB
    J["El trabajo de CI empieza"] --> S["Sus secretos definen<br/>ONEUPTIME_API_KEY<br/>y ONEUPTIME_URL"]
    S --> Q["oneuptime incident count<br/>de incidentes no resueltos"]
    Q -->|"0"| D["Desplegar"]
    Q -->|"1 o más"| X["Detenerse: hay un<br/>incidente abierto"]
    Q -->|"código de salida 2"| A["Detenerse: revisar<br/>la clave de API"]
```

## Dar a un script su clave de API

Defina `ONEUPTIME_API_KEY` y `ONEUPTIME_URL` a partir de los secretos de su sistema de CI. La CLI no necesita entonces ni `login` ni archivo de configuración. Una opción sigue yendo antes que ellas para un solo comando, y ellas van antes que los contextos guardados.

```bash
export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="https://oneuptime.com"
oneuptime incident count
```

> [!TIP]
> Dé a cada pipeline una clave de API propia, con solo el acceso que necesita: una comprobación que solo lee necesita una clave que solo lea. Elimine la clave en OneUptime cuando la pipeline se retire.

Si una máquina ejecuta trabajos de varios proyectos, guarde un contexto para cada uno y nómbrelo en cada comando, para que un trabajo nunca use el contexto actual de otro:

```bash
oneuptime --context production incident count
oneuptime --context staging monitor count
```

## Códigos de salida

| Código | Significado | Por ejemplo |
| --- | --- | --- |
| `0` | Funcionó | Una lista, incluso una que no encuentra nada |
| `1` | Falló | OneUptime rechazó la solicitud, como `API error (422)`; JSON no válido; una opción que falta o es desconocida; un contexto que no está guardado |
| `2` | Ninguna clave de API utilizable | Credenciales no encontradas; una clave de API no válida; una clave por debajo de su plan (`402`); `401` |
| `3` | No encontrado | OneUptime respondió `404`: el registro no existe, está en otro proyecto, o la clave no puede leerlo |

`whoami` y `context current` terminan con `0` aunque no haya nada guardado: informan de lo que está definido, no lo comprueban. Un script distingue los casos por el código:

```bash
oneuptime incident get "$INCIDENT_ID" -o json > incident.json
case $? in
  0) echo "Saved the incident to incident.json" ;;
  2) echo "Check ONEUPTIME_API_KEY and ONEUPTIME_URL" >&2; exit 1 ;;
  3) echo "There is no incident $INCIDENT_ID" >&2; exit 1 ;;
  *) echo "OneUptime refused the request" >&2; exit 1 ;;
esac
```

Los mensajes de error van a la salida de error estándar, así que `incident.json` contiene solo la respuesta.

## Leer respuestas con jq

Escriba `-o json` en los scripts. En una tubería la CLI imprime JSON de todos modos, pero la opción mantiene el script funcionando dondequiera que se ejecute:

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

Un recuento imprime un solo número, listo para comparar:

```bash
OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
echo "$OPEN incidents are open"
```

## Crear registros a partir de archivos

Guarde los registros como archivos JSON junto a su código, y créelos desde allí:

```json title="monitors/checkout-api.json"
{
  "name": "Checkout API",
  "monitorType": "Manual"
}
```

```bash
oneuptime monitor create --file monitors/checkout-api.json
```

Muchos registros a partir de un array JSON, una creación por cada uno:

```bash
jq -c '.[]' monitors.json | while IFS= read -r monitor; do
  oneuptime monitor create --data "$monitor" -o json | jq -r '._id'
done
```

> [!NOTE]
> Cada ejecución crea registros nuevos. Para mantener monitores y páginas de estado al día con archivos, cambiar solo lo que cambió y quitar lo que ya no está, use el [proveedor de Terraform](/docs/terraform/index).

## Ejemplos de pipelines

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

En GitHub Actions, añada `ONEUPTIME_API_KEY` en **Settings → Secrets and variables → Actions** del repositorio; en GitLab, añádala como variable de CI/CD enmascarada. Con la imagen de Docker, pase las variables a cada ejecución:

```bash
docker build -t oneuptime-cli .
docker run --rm -e ONEUPTIME_API_KEY -e ONEUPTIME_URL oneuptime-cli incident count
```

## Próximos pasos

:::cards
- [Autenticación](/docs/cli/authentication): Qué clave usa un comando cuando hay varias definidas.
- [Formatos de salida](/docs/cli/output-formats): El JSON que leen sus scripts.
- [Operaciones de recursos](/docs/cli/resource-operations): Filtros, paginación y los campos de un registro.
- [Proveedor de Terraform](/docs/terraform/index): Mantener la configuración de OneUptime en archivos.
:::
