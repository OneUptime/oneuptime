# Architecture auto-hébergée de OneUptime

Ce diagramme montre à quoi ressemble généralement OneUptime lorsqu'il est auto-hébergé dans votre environnement (par exemple, dans votre cluster Kubernetes), y compris comment les sondes surveillent les ressources internes et externes.

```mermaid
flowchart TB
  %% DISPOSITION
  %% Haut : Utilisateurs -> Ingress -> Web / API
  %% Milieu : Services core + Pipeline d'ingestion
  %% Bas : Stockages de données

  %% UTILISATEURS / PÉRIPHÉRIE
  U["Utilisateurs finaux / Navigateurs"]

  %% FRONTIÈRE DU CLUSTER
  subgraph C["Réseau client (Cluster Kubernetes auto-hébergé)"]
    direction TB

    subgraph Edge["Ingress & Routage"]
      NGINX["Ingress NGINX (TLS)"]
    end

    subgraph Web["Web & API"]
      direction TB
      HOME["Accueil / Tableau de bord (UI)"]
      STATUS["Pages de statut (UI)"]
      API["Serveur API"]
      WORKER["Worker en arrière-plan"]
    end

    subgraph Ingest["Pipeline d'ingestion"]
      direction TB
      PROBEINGEST["Ingestion des sondes"]
      OTELINGEST["Ingestion OpenTelemetry"]
      FLUENTLOGS["Ingestion des journaux (Fluent Bit)"]
      SERVERMONINGEST["Ingestion du moniteur de serveur"]
      INCOMINGREQINGEST["Ingestion des requêtes entrantes"]
    end

    subgraph Probes["Sondes OneUptime"]
      direction TB
      P1["Pod(s) de sonde dans votre cluster"]
      P2["VM/Conteneur de sonde optionnel sur votre réseau"]
    end

    %% STOCKAGES DE DONNÉES
    subgraph Data["Stockages de données"]
      direction LR
      PG[("PostgreSQL\n(config, état, métadonnées)")]
      CH[("ClickHouse\n(métriques, traces, journaux)")]
      REDIS[("Redis\n(cache, files, sessions)")]
    end

  end

  %% CIBLES EXTERNES / INTERNES
  EXT["Ressources externes\n(sites web/API publics, SaaS)"]
  INT["Ressources internes\n(apps privées, BDD, services)"]

  %% FLUX : Périphérie
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% FLUX : Services core -> Données
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% FLUX : Ingestion
  P1 -->|résultats de surveillance| PROBEINGEST
  P2 -->|résultats de surveillance| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Personnalisé| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Personnalisé| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Personnalisé| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Personnalisé| P2

  OTELCOLL["Collecteur/Agents OTel"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Agents de surveillance serveur"] --> SERVERMONINGEST

  %% Flux d'ingestion vers le traitement core
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% Les workers consomment depuis les files et écrivent dans les stockages
  REDIS --> WORKER

  %% Notes / Légende
  classDef store fill:#fef6e4,stroke:#d4a373,color:#333;
  classDef edge fill:#e3f2fd,stroke:#64b5f6,color:#333;
  classDef web fill:#e8f5e9,stroke:#81c784,color:#333;
  classDef ingest fill:#f3e5f5,stroke:#ba68c8,color:#333;
  classDef probe fill:#fff3e0,stroke:#ffb74d,color:#333;
  classDef outside fill:#f5f5f5,stroke:#bdbdbd,color:#333,stroke-dasharray: 3 3;

  class NGINX edge;
  class HOME,STATUS,API,WORKER web;
  class PROBEINGEST,OTELINGEST,FLUENTLOGS,SERVERMONINGEST,INCOMINGREQINGEST ingest;
  class P1,P2 probe;
  class PG,CH,REDIS store;
  class EXT,INT,OTELCOLL,FLUENT,SERVERAGENTS outside;
```

## Ce que cela montre
- Les utilisateurs finaux accèdent à OneUptime via l'Ingress de votre cluster (NGINX), qui achemine vers l'UI et l'API.
- Les services core lisent/écrivent l'état dans PostgreSQL, Redis et ClickHouse.
- Les sondes peuvent s'exécuter dans votre cluster (recommandé) et/ou ailleurs sur votre réseau. Elles peuvent surveiller :
  - Les services internes/privés derrière votre pare-feu.
  - Les ressources externes/publiques sur Internet.
- Les résultats des sondes sont envoyés à l'ingestion des sondes dans votre cluster, mis en file d'attente via Redis, et traités par le worker en arrière-plan dans vos stockages de données.
- La télémétrie (métriques/traces/journaux) et les données de serveur/agent peuvent être ingérées via des services d'ingestion dédiés et stockées dans ClickHouse.

> Remarque : Si vous utilisez PostgreSQL, Redis ou ClickHouse externes au lieu des versions intégrées, les connexions depuis API/Worker/Ingest pointent vers vos points d'accès externes. Le flux logique reste le même.
