# Installationsanleitung für den Terraform-Provider

## Installation aus dem Terraform Registry

Der OneUptime Terraform-Provider ist im offiziellen [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) verfügbar.

### Für OneUptime-Cloud-Benutzer

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Neueste kompatible Version verwenden
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Für selbst gehostete OneUptime-Benutzer

⚠️ **Kritisch**: Selbst gehostete Kunden müssen die Provider-Version exakt auf ihre OneUptime-Installation pinnen.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Durch Ihre genaue OneUptime-Version ersetzen
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Ihre selbst gehostete URL
  api_key       = var.oneuptime_api_key
}
```

## Warum Versions-Pinning für selbst gehostete Instanzen?

Der OneUptime Terraform-Provider wird automatisch aus der OneUptime-API-Spezifikation generiert. Jede OneUptime-Version kann haben:

- Unterschiedliche API-Endpunkte
- Aktualisierte Ressourcenschemata
- Neue oder entfernte Funktionen
- Geänderte Validierungsregeln

Die Verwendung einer Provider-Version, die nicht mit Ihrer OneUptime-Installation übereinstimmt, kann zu API-Kompatibilitätsfehlern führen.

## Ihre OneUptime-Version finden

### Methode 1: Dashboard
1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Gehen Sie zu **Einstellungen** → **Über**
3. Notieren Sie die Versionsnummer (z. B. "7.0.123")

### Methode 2: API
```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### Methode 3: Docker
```bash
docker images | grep oneuptime
# Nach dem Tag suchen, z. B. oneuptime/dashboard:7.0.123
```

## Provider Registry-Informationen

- **Registry-URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Quell-Repository**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Dokumentation**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs

## Versionskompatibilitätsmatrix

| OneUptime-Version | Provider-Version | Terraform-Konfiguration |
|-------------------|------------------|------------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| Neueste Cloud | Neuester Provider | `version = "~> 7.0"` |

## Registry-Updates

Der Provider wird automatisch im Terraform Registry veröffentlicht, wenn neue OneUptime-Versionen erscheinen. Cloud-Benutzer können semantische Versionierung (`~> 7.0`) verwenden, um automatisch kompatible Updates zu erhalten, während selbst gehostete Benutzer auf genaue Versionen pinnen sollten.
