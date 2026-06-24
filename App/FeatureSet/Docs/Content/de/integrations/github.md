# GitHub-Integration

Öffnen Sie automatisch ein [GitHub](https://github.com)-Issue, wenn ein OneUptime-Vorfall erstellt wird – damit technische Nachverfolgung im Repository erfasst wird, das den betroffenen Service besitzt.

Diese Integration ist **ausgehend**: OneUptime ruft die [GitHub REST API](https://docs.github.com/en/rest/issues/issues) auf. Sie verwendet einen OneUptime-**[Workflow](/docs/workflows/index)** mit einem **Incident → On Create**-Auslöser und einer **API-Komponente**.

> **Suchen Sie die tiefere GitHub-Verbindung?** OneUptime hat auch eine native **GitHub App**-Integration zum Verbinden von Code-Repositories (verwendet von der KI-Agent- und Code-Funktion). Diese wird mit Umgebungsvariablen konfiguriert, nicht mit Workflows – siehe [GitHub-Integration (selbst gehostet)](/docs/self-hosted/github-integration). Diese Seite behandelt speziell das _Anlegen von Issues aus Vorfällen_.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Voraussetzungen

- Ein GitHub-Repository, in dem Issues angelegt werden sollen.
- Ein Token, der Issues erstellen kann:

  - **Feingranulares PAT** auf dieses Repository beschränkt mit **Issues: Read and write**, oder
  - ein **klassisches PAT** mit dem Scope `repo`.

  Erstellen Sie eines unter [github.com/settings/tokens](https://github.com/settings/tokens).

- Ein OneUptime-Projekt, in dem Sie Workflows erstellen können.

## Schritt 1 — Den Token speichern

1. Gehen Sie zu **Workflows → Global Variables → Create**.
2. Benennen Sie die Variable `GITHUB_TOKEN`, fügen Sie den Token ein und aktivieren Sie **Is Secret**.

## Schritt 2 — Den Workflow erstellen

1. Öffnen Sie **Workflows → Create Workflow**, benennen Sie ihn `Incidents → GitHub Issues`, und öffnen Sie den **Builder**.
2. Fügen Sie einen **Incident**-Auslöser mit **On Create** hinzu. Benennen Sie ihn in `Incident` um.
3. Fügen Sie einen **API**-Block verbunden mit dem Auslöser hinzu:

   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Speichern**, aktivieren und einen Test-Vorfall erstellen. Ein `201 Created` in den Workflow-Logs bedeutet, dass das Issue erstellt wurde; der Response-Body enthält dessen `number` und `html_url`.

## Tipps

- **GitHub Enterprise Server**: Verwenden Sie `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Verantwortliche / Meilenstein**: Fügen Sie `"assignees": ["octocat"]` oder `"milestone": 3` zum Body hinzu.
- **Rückverknüpfung**: Lesen Sie `{{CreateIssue.response-body.html_url}}` und speichern Sie es mit einem **Update Incident**-Block am Vorfall.

## Fehlerbehebung

- **`401`** — der Token ist falsch oder abgelaufen. Feingranulare Tokens müssen das Repository und die **Issues**-Berechtigung explizit gewähren.
- **`403` / Rate-Limit** — fügen Sie den `User-Agent`-Header hinzu (GitHub lehnt Anfragen ohne diesen ab) und prüfen Sie, ob Sie das Rate-Limit erreicht haben.
- **`404`** — der `owner/repo`-Pfad ist falsch, oder der Token kann ein privates Repository nicht sehen.
- **`422`** — ein nicht vorhandenes Label ist in Ordnung (GitHub erstellt referenzierte Labels), aber ein fehlerhafter Body nicht – prüfen Sie Ihr JSON.

## Weiterführende Themen

- [Integrationen – Überblick](/docs/integrations/index) — Muster und der Authentifizierungs-Spickzettel.
- [GitLab](/docs/integrations/gitlab) — dasselbe Prinzip für GitLab.
- [GitHub-Integration (selbst gehostet)](/docs/self-hosted/github-integration) — die native GitHub App-Verbindung.
