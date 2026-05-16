# Documentación del proveedor Terraform

El Proveedor Terraform de OneUptime permite la gestión de Infraestructura como Código (IaC) de tus recursos de monitoreo, alerta y observabilidad en OneUptime.

## Secciones de la documentación

### [Primeros pasos](./quick-start.md)
Guía de configuración rápida para comenzar a usar el Proveedor Terraform de OneUptime en minutos.

### [Guía completa del proveedor](./README.md)
Documentación completa que cubre instalación, configuración, recursos y buenas prácticas.

### [Configuración auto-alojada](./self-hosted.md)
**Crítico para clientes auto-alojados**: Fijación de versiones, compatibilidad y estrategias de implementación.

### [Ejemplos](./examples.md)
Ejemplos del mundo real y patrones para configuraciones comunes de Terraform en OneUptime.

## Accesos directos

### Para clientes de OneUptime Cloud
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Para clientes auto-alojados
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Debe coincidir con tu versión de OneUptime
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Importante para usuarios auto-alojados

**La compatibilidad de versiones es crítica**: Siempre fija la versión del proveedor Terraform para que coincida exactamente con la versión de tu instalación de OneUptime. Las versiones que no coincidan pueden causar problemas de compatibilidad de API.

## Recursos externos

- **Registro de Terraform**: [Proveedor de OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **Repositorio de GitHub**: [Código fuente de OneUptime](https://github.com/OneUptime/oneuptime)
- **Soporte de la comunidad**: [Comunidad de OneUptime](https://community.oneuptime.com)

## Recursos disponibles

El proveedor admite una gestión completa de recursos de OneUptime:

- **Proyectos y equipos**: Organiza tu estructura de monitoreo
- **Monitores**: Monitores de sitios web, API, puertos, latidos y personalizados
- **Gestión de incidentes**: Políticas de alertas, horarios de guardia, escaladas
- **Páginas de estado**: Páginas de estado públicas y privadas con marca personalizada
- **Catálogo de servicios**: Definiciones de servicios y mapeo de dependencias
- **Flujos de trabajo**: Respuesta automatizada y flujos de trabajo de remediación

## Soporte

Para problemas, preguntas o contribuciones:

1. **Problemas de documentación**: Crea un problema en el [repositorio de OneUptime](https://github.com/OneUptime/oneuptime/issues)
2. **Errores del proveedor**: Reporta en el repositorio principal de OneUptime
3. **Solicitudes de función**: Discute en la comunidad de OneUptime
4. **Preguntas generales**: Usa los foros de la comunidad

## Próximos pasos

1. **Nuevos usuarios**: Comienza con la [Guía de inicio rápido](./quick-start.md)
2. **Auto-alojados**: Revisa la [Configuración auto-alojada](./self-hosted.md)
3. **Usuarios avanzados**: Explora los [Ejemplos](./examples.md) para configuraciones complejas
4. **Referencia completa**: Consulta la [Guía completa](./README.md) para todas las características
