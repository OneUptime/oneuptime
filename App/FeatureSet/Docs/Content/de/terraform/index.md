# Terraform-Provider-Dokumentation

Der OneUptime Terraform-Provider ermöglicht die Infrastructure-as-Code (IaC)-Verwaltung Ihrer OneUptime-Überwachungs-, Benachrichtigungs- und Observability-Ressourcen.

## Dokumentationsabschnitte

### [Erste Schritte](./quick-start.md)

Schnelleinrichtungsanleitung, um in wenigen Minuten mit dem OneUptime Terraform-Provider loszulegen.

### [Vollständige Provider-Anleitung](./complete-guide.md)

Umfassende Dokumentation zu Installation, Konfiguration, Ressourcen und Best Practices.

### [Selbst gehostete Konfiguration](./self-hosted.md)

**Kritisch für selbst gehostete Kunden**: Versions-Pinning, Kompatibilität und Bereitstellungsstrategien.

### [Beispiele](./examples.md)

Praxisnahe Beispiele und Muster für häufige OneUptime-Terraform-Konfigurationen.

## Schnelllinks

### Für OneUptime-Cloud-Kunden

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

### Für selbst gehostete Kunden

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Muss Ihrer OneUptime-Version entsprechen
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Wichtig für selbst gehostete Benutzer

**Versionskompatibilität ist kritisch**: Pinnen Sie die Terraform-Provider-Version immer exakt auf Ihre OneUptime-Installationsversion. Nicht übereinstimmende Versionen können API-Kompatibilitätsprobleme verursachen.

## Externe Ressourcen

- **Terraform Registry**: [OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Repository**: [OneUptime Source Code](https://github.com/OneUptime/oneuptime)
- **Community**: [OneUptime Community](https://community.oneuptime.com)

## Verfügbare Ressourcen

Der Provider unterstützt umfassendes OneUptime-Ressourcenmanagement:

- **Projekte & Teams**: Ihre Überwachungsstruktur organisieren
- **Monitore**: Website-, API-, Port-, Heartbeat- und benutzerdefinierte Monitore
- **Incident-Management**: Benachrichtigungsrichtlinien, Bereitschaftspläne, Eskalationen
- **Status-Seiten**: Öffentliche und private Status-Seiten
- **Servicekatalog**: Servicedefinitionen und Abhängigkeitszuordnung
- **Workflows**: Automatisierte Reaktions- und Behebungs-Workflows

## Support

Bei Problemen, Fragen oder Beiträgen:

1. **Dokumentationsprobleme**: Issue im [OneUptime Repository](https://github.com/OneUptime/oneuptime/issues) erstellen
2. **Provider-Bugs**: Im Haupt-OneUptime-Repository melden
3. **Feature-Anfragen**: In der OneUptime-Community diskutieren

## Nächste Schritte

1. **Neue Benutzer**: Mit der [Schnellstartanleitung](./quick-start.md) beginnen
2. **Selbst gehostete Instanzen**: [Selbst gehostete Konfiguration](./self-hosted.md) prüfen
3. **Fortgeschrittene Benutzer**: [Beispiele](./examples.md) für komplexe Setups erkunden
