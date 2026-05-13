# Actualización de OneUptime

Esta guía explica cómo actualizar de forma segura tu instalación auto-alojada de OneUptime.

## Orientación general

- Actualiza paso a paso entre versiones principales (por ejemplo, 6 → 7 → 8). No omitas versiones principales.
- Puedes saltar versiones menores/de parche (por ejemplo, 8.1 → 8.4) siempre que sigas las notas de la versión.
- Siempre realiza copias de seguridad antes de actualizar y valida que puedas restaurarlas.

## Actualización de OneUptime 8 → 9

El gráfico Helm ya no aprovisiona un recurso Kubernetes Ingress. OneUptime incluye un contenedor de puerta de enlace de ingreso que ya termina TLS, gestiona los dominios de las páginas de estado y enruta el tráfico para la plataforma, por lo que ya no es necesario un controlador de ingreso del clúster.

- Elimina cualquier anulación de `oneuptimeIngress` de tus archivos `values.yaml` personalizados antes de actualizar. Esas claves ahora se ignoran y causarán errores de validación si se dejan en su lugar.
- Asegúrate de que `nginx.service.type` refleje cómo deseas exponer la puerta de enlace de ingreso incluida (por ejemplo, `LoadBalancer`, `NodePort` o `ClusterIP` con un balanceador de carga externo).
- Verifica que cualquier registro DNS para páginas de estado o hosts principales aún apunte al Servicio o balanceador de carga que está frente a la puerta de enlace de ingreso de OneUptime.
- Después de la actualización, confirma que los certificados TLS continúen renovándose a través de la puerta de enlace integrada y que los dominios de las páginas de estado se resuelvan correctamente.


## Actualización de OneUptime 7 → 8

Si estás ejecutando en Kubernetes, hay cambios importantes que rompen la compatibilidad:

- Ya no usamos gráficos de Bitnami para Postgres, Redis y ClickHouse debido a [cambios en la licencia de Bitnami](https://github.com/bitnami/charts/issues/35164)
- Estos cambios no son compatibles con versiones anteriores. Debes seguir la nueva estructura en el `values.yaml` del gráfico Helm.
- Realiza una copia de seguridad de tus datos (Postgres, ClickHouse y cualquier volumen persistente) antes de actualizar.


> Consejo: Prueba la actualización en un entorno de staging primero. Confirma que tus cargas de trabajo están saludables y que los datos están intactos antes de actualizar en producción.
