# OneUptime aktualisieren

Diese Anleitung beschreibt, wie Sie Ihre selbst gehostete OneUptime-Installation sicher aktualisieren können.

## Allgemeine Hinweise

- Führen Sie Upgrades schrittweise über Hauptversionen durch (z. B. 6 → 7 → 8). Überspringen Sie keine Hauptversionen.
- Sie können Neben-/Patch-Versionen überspringen (z. B. 8.1 → 8.4), sofern Sie die Release-Notes beachten.
- Erstellen Sie immer Backups vor dem Upgrade und überprüfen Sie, ob Sie diese wiederherstellen können.

## Upgrade von OneUptime 8 → 9

Das Helm-Chart stellt keine Kubernetes Ingress-Ressource mehr bereit. OneUptime enthält einen Ingress-Gateway-Container, der bereits TLS terminiert, Status-Seiten-Domains verwaltet und den Datenverkehr für die Plattform routed – ein Cluster-Ingress-Controller ist daher nicht mehr erforderlich.

- Entfernen Sie alle `oneuptimeIngress`-Überschreibungen aus Ihren benutzerdefinierten `values.yaml`-Dateien vor dem Upgrade. Diese Schlüssel werden jetzt ignoriert und verursachen Validierungsfehler, wenn sie vorhanden bleiben.
- Stellen Sie sicher, dass `nginx.service.type` widerspiegelt, wie Sie das enthaltene Ingress-Gateway bereitstellen möchten (z. B. `LoadBalancer`, `NodePort` oder `ClusterIP` mit einem externen Load Balancer).
- Überprüfen Sie, ob DNS-Einträge für Status-Seiten oder primäre Hosts weiterhin auf den Service oder Load Balancer verweisen, der das OneUptime Ingress-Gateway bedient.
- Bestätigen Sie nach dem Upgrade, dass TLS-Zertifikate über das eingebettete Gateway weiterhin erneuert werden und dass Status-Seiten-Domains korrekt aufgelöst werden.


## Upgrade von OneUptime 7 → 8

Wenn Sie auf Kubernetes betreiben, gibt es wichtige Breaking Changes:

- Wir verwenden keine Bitnami-Charts mehr für Postgres, Redis und ClickHouse aufgrund von [Bitnami-Lizenzänderungen](https://github.com/bitnami/charts/issues/35164)
- Diese Änderungen sind nicht rückwärtskompatibel. Sie müssen die neue Struktur im Helm-Chart `values.yaml` befolgen.
- Sichern Sie Ihre Daten (Postgres, ClickHouse und alle persistenten Volumes) vor dem Upgrade.


> Tipp: Testen Sie das Upgrade zuerst in einer Staging-Umgebung. Bestätigen Sie, dass Ihre Workloads fehlerfrei sind und die Daten intakt sind, bevor Sie die Produktion upgraden.
