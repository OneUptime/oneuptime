# GitLab-Integration

Öffnen Sie automatisch ein [GitLab](https://gitlab.com)-Issue, wenn ein OneUptime-Vorfall erstellt wird – damit technische Nachverfolgung im Projekt landet, das den betroffenen Service besitzt.

Diese Integration ist **ausgehend**: OneUptime ruft die [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html) auf. Sie verwendet einen OneUptime-**[Workflow](/docs/workflows/index)** mit einem **Incident → On Create**-Auslöser und einer **API-Komponente**. Sie funktioniert auf GitLab.com und selbstverwaltetem GitLab gleich.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Voraussetzungen

- Ein GitLab-Projekt und dessen **Project ID** (auf der Übersichtsseite des Projekts unter dem Projektnamen angezeigt).
- Ein Zugriffstoken, das Issues erstellen kann – ein **Projekt-**, **Gruppen-** oder **Personal Access Token** mit dem Scope `api`: **Settings → Access Tokens**.
- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Den Token speichern

1. Gehen Sie zu **Workflows → Global Variables → Create**.
2. Benennen Sie die Variable `GITLAB_TOKEN`, fügen Sie den Token ein und aktivieren Sie **Is Secret**.

## Schritt 2 — Den Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → GitLab Issues`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Incident**-Auslöser mit **On Create** hinzu. Benennen Sie ihn in `Incident` um.
3. Fügen Sie einen **API**-Block verbunden mit dem Auslöser hinzu:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(ersetzen Sie `12345678` durch Ihre Project ID; verwenden Sie für selbstverwaltetes GitLab Ihren eigenen Host)*
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Speichern**, aktivieren und einen Test-Vorfall erstellen. Ein `201 Created` in den Workflow-Logs bedeutet, dass das Issue erstellt wurde; der Response-Body enthält dessen `iid` und `web_url`.

## Tipps

- **Selbstverwaltetes GitLab**: Ersetzen Sie `https://gitlab.com` durch Ihre Instanz-URL; der `/api/v4/...`-Pfad bleibt gleich.
- **Projektpfad statt ID**: Sie können den Pfad URL-kodieren – z. B. `group%2Fproject` – anstelle der numerischen ID.
- **Verantwortlicher / Fälligkeitsdatum**: Fügen Sie `"assignee_ids": [42]` oder `"due_date": "2026-01-31"` zum Body hinzu.
- **Rückverknüpfung**: Lesen Sie `{{CreateIssue.response-body.web_url}}` und speichern Sie es mit einem **Update Incident**-Block am Vorfall.

## Fehlerbehebung

- **`401`** — der Token ist ungültig oder abgelaufen, oder ihm fehlt der Scope `api`.
- **`404`** — die Project ID ist falsch, oder der Token kann nicht auf ein privates Projekt zugreifen.
- **`400`** — ein Pflichtfeld fehlt oder ist fehlerhaft; `title` ist erforderlich.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — Muster und der Authentifizierungs-Spickzettel.
- [GitHub](/docs/integrations/github) — dasselbe Prinzip für GitHub.
- [API-Komponente](/docs/workflows/components#api) — den Response-Body lesen.
