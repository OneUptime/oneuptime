# Schnellstartanleitung für den Terraform-Provider

Diese Anleitung hilft Ihnen, in wenigen Minuten mit dem OneUptime Terraform-Provider loszulegen.

## Voraussetzungen

- Terraform >= 1.0 installiert
- OneUptime-Konto (Cloud oder selbst gehostet)
- OneUptime-API-Schlüssel

## Schritt 1: API-Schlüssel erstellen

### Für OneUptime Cloud

1. Gehen Sie zu [OneUptime Cloud](https://oneuptime.com) und melden Sie sich an
2. Navigieren Sie zu **Einstellungen** → **API-Schlüssel**
3. Klicken Sie auf **API-Schlüssel erstellen**
4. Nennen Sie ihn "Terraform Provider"
5. Wählen Sie erforderliche Berechtigungen
6. Kopieren Sie den generierten API-Schlüssel

## Schritt 2: Terraform-Konfiguration erstellen

Erstellen Sie ein neues Verzeichnis und eine `main.tf`-Datei:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Für Cloud-Kunden
      version = "~> 7.0"

      # Für selbst gehostete Kunden - auf genaue Version pinnen
      # version = "= 7.0.123"  # Durch Ihre OneUptime-Version ersetzen
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Für Cloud-Kunden
  oneuptime_url = "https://oneuptime.com"

  # Für selbst gehostete Kunden - verwenden Sie Ihre Instanz-URL
  # oneuptime_url = "https://oneuptime.yourcompany.com"

  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API Key"
  type        = string
  sensitive   = true
}

# Hinweis: Projekte müssen manuell im OneUptime-Dashboard erstellt werden
variable "project_id" {
  description = "OneUptime-Projekt-ID"
  type        = string
}

# Einfachen Website-Monitor erstellen
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor für Website-Verfügbarkeit"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Monitor-ID ausgeben
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Schritt 3: Variablendatei erstellen

Erstellen Sie `terraform.tfvars`:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # Aus OneUptime-Dashboard erhalten
```

**Wichtig**: Fügen Sie `terraform.tfvars` zu Ihrer `.gitignore`-Datei hinzu, um API-Schlüssel geheim zu halten!

## Schritt 4: Initialisieren und anwenden

```bash
# Terraform initialisieren
terraform init

# Bereitstellung planen
terraform plan

# Konfiguration anwenden
terraform apply
```

## Schritt 5: Ressourcen verifizieren

1. Prüfen Sie Ihr OneUptime-Dashboard
2. Gehen Sie zu Ihrem vorhandenen Projekt
3. Überprüfen Sie, ob der „Website Monitor" erstellt wurde und läuft

## Nächste Schritte

1. **Weitere Ressourcen erkunden**: Prüfen Sie die [vollständige Dokumentation](./complete-guide.md)
2. **Benachrichtigungen einrichten**: Benachrichtigungsrichtlinien hinzufügen
3. **Status-Seiten erstellen**: Öffentliche Status-Seiten einrichten
4. **Mit Teams organisieren**: Teams erstellen und Berechtigungen zuweisen

## Fehlerbehebung beim Schnellstart

### Problem: Provider nicht gefunden

**Lösung**: `terraform init` ausführen, um den Provider herunterzuladen

### Problem: Authentifizierung fehlgeschlagen

**Lösung**:

1. API-Schlüssel im OneUptime-Dashboard überprüfen
2. Prüfen ob der API-Schlüssel ausreichende Berechtigungen hat
3. Sicherstellen, dass `oneuptime_url` korrekt ist

### Problem: Versions-Mismatch (selbst gehostet)

**Lösung**:

1. OneUptime-Version im Dashboard prüfen
2. Provider-Version entsprechend aktualisieren
3. `terraform init -upgrade` ausführen

## Bereinigung

Um alle in diesem Schnellstart erstellten Ressourcen zu entfernen:

```bash
terraform destroy
```
