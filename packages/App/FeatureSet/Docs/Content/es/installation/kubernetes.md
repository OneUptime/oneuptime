# Kubernetes y Helm

Ejecuta OneUptime en tu propio clúster de Kubernetes con el chart de Helm. Tu servidor de OneUptime sirve esta página él mismo, así que se abre sin acceso a internet y describe el chart de la versión que ejecutas. Cada valor que acepta el chart está en la documentación del propio chart, en [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Instalar el chart](#instalar-el-chart): Un archivo de valores y dos comandos.
- [Hacer copias de seguridad de tus datos](#hacer-copias-de-seguridad-de-tus-datos): PostgreSQL y ClickHouse, en un almacenamiento fuera del clúster.
- [Guardar tus claves](#guardar-tus-claves): Aquello sin lo que tus copias de seguridad no se pueden leer.
:::

## Instalar el chart

Crea un `values.yaml` con el nombre de dominio o la dirección IP que se usará, sin `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Después instala el chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Ha funcionado cuando** `kubectl get pods` muestra todos los pods `Running` y la dirección abre OneUptime. La [Guía de autoalojamiento](/docs/installation/self-hosting-guide) sigue desde ahí: HTTPS, la cuenta de administración y el correo, los SMS y las llamadas.

## Hacer copias de seguridad de tus datos

OneUptime guarda sus datos en los volúmenes persistentes del clúster: PostgreSQL contiene tus proyectos, monitores, incidentes, páginas de estado y usuarios, y ClickHouse tus logs, trazas y métricas. Haz copias de seguridad de ambos en un almacenamiento fuera del clúster, de una de estas formas:

- **Las copias de seguridad programadas de la Enterprise Edition.** Configúralas en el Admin Dashboard, en **Ajustes > Copias de seguridad**. Consulta [Copias de seguridad](/docs/installation/backups).
- **Las copias de seguridad de los volúmenes persistentes de tu proveedor de nube**, como instantáneas programadas de los discos de PostgreSQL y de ClickHouse.
- **Las copias de seguridad por instantánea de volumen de CloudNativePG**, cuando PostgreSQL se ejecuta en el operador CloudNativePG. Actívalas en `values.yaml` y después aplica el cambio:

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

Con esta programación se hace una copia de seguridad de PostgreSQL cada día a las 03:00. CloudNativePG no borra las instantáneas de volumen antiguas, así que borra tú las que ya no necesites.

OneUptime no ve las copias de seguridad que se hacen fuera de él. Cuando las tuyas estén en marcha, haz clic en **Este servidor tiene copias de seguridad** en el elemento Copias de seguridad de la página **Configuración del servidor** del Admin Dashboard.

## Guardar tus claves

Lo que OneUptime cifra solo se puede leer con el `encryptionSecret` con el que se cifró. Define tú mismo `oneuptimeSecret` y `encryptionSecret` en `values.yaml`, para que ninguna actualización los sustituya, y guarda una copia con tus copias de seguridad, fuera del clúster:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Próximos pasos

:::cards
- [Guía de autoalojamiento](/docs/installation/self-hosting-guide): De un clúster vacío a un servidor que te avisa.
- [Actualización](/docs/installation/upgrading): Haz una copia de seguridad antes de cada actualización.
- [Copias de seguridad](/docs/installation/backups): Las copias de seguridad programadas de la Enterprise Edition.
:::
