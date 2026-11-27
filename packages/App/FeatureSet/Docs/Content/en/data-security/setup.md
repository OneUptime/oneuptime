# Set Up Data Security

Data Security reads only what you let it. Each cloud connection is read at one of three levels, a database or search cluster you run is read with a connection string you give it, and telemetry needs nothing. This page says what each choice lets OneUptime read, the exact permissions it grants, and what OneUptime keeps of what it reads.

:::cards
- [Choose a level](#choose-a-level-for-each-connection): Off, Configuration only, or Configuration and content samples.
- [What each level grants](#what-each-level-grants): The AWS actions, and the Azure and Google Cloud roles.
- [Scan a store you run](#scan-a-store-you-run): A read-only connection string, or a probe in your network.
- [What OneUptime checks on a store you run](#what-oneuptime-checks-on-a-store-you-run): Whether it answers without credentials, asked from where its scan runs.
- [What OneUptime keeps](#what-oneuptime-keeps): Counts, locations and masked samples, never a value.
- [Let Data Security close an exposure](#let-data-security-close-an-exposure): The only writes a connection can be given, off until you turn them on.
:::

## Choose a level for each connection

| Level | In the form | What OneUptime reads |
| --- | --- | --- |
| Off | **Off** | No store's configuration or content. Data Security still lists the stores your cloud inventory knows of, with what inventory says about them: whether an RDS database is encrypted, public, protected from deletion and backed up, and whether a DynamoDB table can be restored to a point in time. |
| Configuration | **Configuration only** | How every data store is set up: who can reach it, and how it is encrypted, backed up, versioned, logged, replicated and tagged. Never data, and never a secret. |
| Content | **Configuration and content samples** | That, and samples of what S3 buckets, Azure storage accounts, Cloud Storage buckets and BigQuery datasets hold. |

Every connection starts at **Off**. [Connect a Cloud Account](/docs/telemetry/cloud-accounts#data-security) shows the command each level runs on each cloud, word for word. To change a connection's level:

:::steps
### Open the connection

Go to **Cloud → Connect**. Choose **Edit** on the connection, or connect a new account.

### Pick the level

Under **More fields**, set **Data security** to the level you want.

### Run the command again

The command the form shows changes with the level. Run it in your cloud's shell, as you did when you connected: it grants what the new level needs, and nothing more. Then select **Save changes**, or **Connect** for a new connection.
:::

Reads at the new level start within the hour, and **Check Now** or **Scan Now** on a store starts one at once. OneUptime reads only what the connection's level says, whatever the role still allows: lower the level, and the reads stop at once. To take the access away as well, run the new command: on AWS it replaces the policy with the lower one. **Off** adds nothing, so it leaves what an earlier command granted. Remove that yourself: on AWS with `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, and on Azure and Google Cloud by removing the roles the content level added.

## What each level grants

### Amazon Web Services

The configuration level puts a second inline policy, `OneUptimeDataSecurity`, on the role, beside the read-only one. It holds exactly the read actions the data security reader calls. Each reads a setting; none reads data or writes anything:

| What OneUptime uses them for | Actions |
| --- | --- |
| List the buckets, and read who can reach each one and how it is encrypted, versioned, logged, copied and tagged | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Read how the databases are reached, encrypted and backed up, and whom their manual snapshots are shared with | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Read how the search domains, caches and file systems are set up | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Tell AWS's own keys (alias/aws/...) from the keys you manage | `kms:ListAliases` |
| Read which users and roles reach each bucket and table through their own IAM policies, who may assume each role, and when each was last used | `iam:GetAccountAuthorizationDetails`, `iam:GenerateCredentialReport`, `iam:GetCredentialReport` |

The IAM actions let **Access** name every role and user that reaches a store through its own policies, and when each was last used. The credential report IAM makes for them holds dates and flags, never a password or a key. A connection set up before Data Security read IAM reads only each store's own policies until its command is run again.

The content level adds three actions to the same policy, each on its own resources:

| Action | Allowed on | What it is for |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | List a bucket's object names |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Read the first bytes of a sampled object |
| `kms:Decrypt` | `*`, only when `kms:ViaService` is `s3.*.amazonaws.com` | Read an object encrypted with a KMS key, through S3 only: never a direct decrypt of anything else the key protects |

With an **Access key** instead of a role, the policy goes on a group, `OneUptimeDataSecurity`, that the key's user is added to: IAM holds a user's own inline policies to 2,048 characters in all, and the read-only policy takes most of them. A connection that reads a whole AWS Organization puts the same policy in every account's role.

:::details The whole policy at the content level
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases",
        "iam:GetAccountAuthorizationDetails",
        "iam:GenerateCredentialReport",
        "iam:GetCredentialReport"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

The configuration level adds nothing: the connection's **Monitoring Reader** role already reads every resource's configuration through Azure Resource Manager. The content level adds the built-in **Storage Blob Data Reader** role, on the same scope as the connection: the subscription, or the tenant's root management group.

### Google Cloud

The configuration level adds nothing: the connection's **Cloud Asset Viewer** role already reads every resource's configuration and IAM policy. The content level adds two roles, `roles/storage.objectViewer` and `roles/bigquery.dataViewer`, on the project or the organization, and turns on the BigQuery API, `bigquery.googleapis.com`.

## Let Data Security close an exposure

Reading is all a connection does until you choose otherwise. **Data security response**, under **More fields** beside **Data security**, also lets Data Security change a store's settings through the connection: block its public access and stop sharing its snapshots, from the store's issue with **Fix it from here** (see [Data Security Checks and Issues](/docs/data-security/checks-and-issues#fix-it-from-here)) and from Security Operations playbooks, and turn on a setting that protects it, such as versioning or secure transfer, from its issue. It is **Off** until you pick **Close exposures and fix settings**, and the command the form shows then grants these narrow writes, on their own:

| Cloud | What the command adds | What it may do |
| --- | --- | --- |
| AWS | A third inline policy, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `s3:GetBucketVersioning`, `s3:PutBucketVersioning`, `s3:GetBucketOwnershipControls`, `s3:PutBucketOwnershipControls`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute`, `rds:ModifyDBClusterSnapshotAttribute`, `dynamodb:DescribeContinuousBackups` and `dynamodb:UpdateContinuousBackups`: a bucket's Block Public Access, versioning and object ownership, whom a manual snapshot is shared with, and a table's point-in-time recovery |
| Azure | A custom role, `OneUptime Data Security Response`, on the connection's scope | `Microsoft.Storage/storageAccounts/read`, `Microsoft.Storage/storageAccounts/write`, `Microsoft.Storage/storageAccounts/blobServices/read` and `Microsoft.Storage/storageAccounts/blobServices/write`: a storage account's settings, such as anonymous blob access and secure transfer, and its blobs' soft delete, never its keys |
| Google Cloud | A custom role, `oneuptimeDataSecurityResponse` | `storage.buckets.get` and `storage.buckets.update`: a bucket's settings, such as public access prevention, uniform access and versioning |

Nothing it grants reads data, deletes anything or changes who may sign in. Set it back to **Off** and Data Security stops using it at once. To take the access away as well on AWS, delete the policy with `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

A connection that turned it on earlier needs its command run again for these settings: until then the cloud refuses the change, and the panel says which permission is missing.

## Why content samples are optional

The configuration level finds what is exposed: a public bucket, a database open to the internet, missing encryption, backups or access logs. It cannot tell what a store holds, so a store with nothing found in it counts as Public, the lowest sensitivity, and its issues are as severe as they would be for public data. A public bucket of website images is no emergency; a public bucket of card numbers is.

Content samples tell the two apart. They set each store's sensitivity from what it holds, so the same problem is Critical on card numbers and Low on images. They also find what only content shows: secrets, card security codes, passwords kept as they were typed, and copies of production data in a test store.

So the order most teams go in is: the configuration level everywhere, then content samples where you need to know what a store holds. Content scanning can also be turned off for one store, with **Scan Content** in the store's **Settings**, or for the whole project.

## What a content scan reads

A scan reads a little of a store, within the project's limits, and stops after 8 minutes whatever is left. The next one goes on from there: it skips an object that has not changed since it was read, unless that was 7 or more days ago.

- **Buckets and containers** are sampled by kind, not by count. Object names are listed first, at most ten times as many as the scan may read and never more than 200,000. Each name becomes its pattern, with dates, UUIDs, long hex runs and numbers made `*`, so `exports/2026-10-27/users-0001.csv` is `exports/*/users-*.csv`. The newest objects of each pattern are read, one of each before a second of any, and at most 5 of one pattern. Each object is read from its start: at most **Bytes Per Object** of it, and **Bytes Per Scan** in all. A scan samples at most 10 containers of an Azure storage account.
- **Files are read as what they are.** CSV and TSV by column, JSON and JSON lines by path, `.env`, `.ini`, `.properties`, TOML and YAML by key, XML and HTML as their text, Word, Excel and PowerPoint files by their text and cells, and anything else as free text. A gzip file is inflated first. Images, Parquet, Avro, PDF and other binary formats are not read, and the scan says so.
- **Datasets and databases** are read table by table: at most **Tables Per Scan** tables, and **Rows Per Table** rows of each.
- **Search clusters** are read index by index, as a database is read table by table: at most **Tables Per Scan** indices, and **Rows Per Table** documents of each, the newest first where the index has a `@timestamp`. A data stream is read as one index, and indices whose names differ only by dates or numbers, such as `logs-2026.11.26` and `logs-2026.11.27`, as one, at the newest that holds documents. The cluster's own indices, whose names start with a dot, are not read. Every request is a GET, so the scan cannot write to the cluster, whatever its user may do.

Each scan keeps a record of what it read, by name: the objects, tables or services, never their contents. What it could not read - a request the cloud refused, the deadline, the byte budget - is a warning on the scan, and the scan is marked **Partly succeeded**.

A store's **Overview** says when its content is scanned next. **Next Content Scan** is the time something scans it, **Due now** while it waits its turn, and **Overdue** once it has been due for an hour. Otherwise it says why nothing will: **Off** while **Scan Content** is off for the store or the project, or while the store is no longer found; **Not scanned** when OneUptime cannot sample its kind of store, or its probe cannot scan it; and **Waiting** while its probe is disconnected. A service's telemetry is scanned **Every hour**, with the project's telemetry scan. **Scan Now** is turned off, with the reason, for a store nothing would scan. A scan under way when content scanning is turned off, or when the project is suspended, keeps nothing it found.

## Scan a store you run

Data Security samples PostgreSQL, MySQL and SQL Server databases, and Elasticsearch and OpenSearch clusters, in one of two ways. A database the Database product monitors, or one your services talk to on the service map, is a store already. Add any other yourself, with **Add a Store You Run** under **Data Stores**: once you pick its **Kind**, the form says what OneUptime will check on it and what it cannot, and asks only for what that kind reads. A kind OneUptime does not sample, such as MongoDB or Redis, takes no connection string: it is listed with its owners, labels and sensitivity, and its exposure reads **Can't be checked**.

- **From OneUptime's workers.** In the store's **Settings**, set **Connection String** to one that can only read, such as `postgresql://reader:password@db.internal:5432/app`, or `https://reader:password@search.internal:9200` for a search cluster. It is encrypted at rest and never returned by the API. Give it a user that can read and do nothing else. On OneUptime Cloud, the workers reach only addresses on the internet.
- **From a probe in your network.** Pick the probe under **Scan From Probe**, and enter in **Probe Connection Variable** the name of the environment variable on that probe that holds the connection string. The probe reads the store from inside your network and sends back only what it found: the connection string never reaches OneUptime. See [Custom Probes](/docs/probe/custom-probe) to run a probe. A probe of an earlier release is handed databases only: update it to scan a search cluster.

### A search cluster's connection string

Elasticsearch and OpenSearch have no connection string of their own, so OneUptime takes the cluster's address, as curl reaches it, with a read-only user in it, or an Elasticsearch API key after it, written `id:key` or as the encoded value Elasticsearch hands out:

```text
https://reader:password@search.internal:9200
https://search.internal:9200?api_key=<id>:<key>
https://reader:password@search.internal:9200?verify_certificate=false
```

`verify_certificate=false` accepts a certificate no authority signed, such as the one Elasticsearch makes when it first starts: use it only on a network you trust. Nothing else may follow the address. For a cluster whose certificate your own authority signed, give the address as JSON, with that authority's certificate:

```json
{
  "url": "https://search.internal:9200",
  "username": "reader",
  "password": "password",
  "caCertificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
}
```

`apiKey` takes the place of `username` and `password`, and `"verifyCertificate": false` the place of the certificate.

Give the user a role that can read and do nothing else. On Elasticsearch:

```bash
curl -u elastic -X PUT "https://search.internal:9200/_security/role/oneuptime_reader" \
  -H "Content-Type: application/json" \
  -d '{"cluster":["monitor"],"indices":[{"names":["*"],"privileges":["read","view_index_metadata","monitor"]}]}'
```

On OpenSearch, with its security plugin:

```bash
curl -u admin -X PUT "https://search.internal:9200/_plugins/_security/api/roles/oneuptime_reader" \
  -H "Content-Type: application/json" \
  -d '{"cluster_permissions":["cluster_monitor"],"index_permissions":[{"index_patterns":["*"],"allowed_actions":["read","indices_monitor","indices:admin/mappings/get","indices:admin/data_stream/get"]}]}'
```

Then give a user that role, and only that role. Narrow `*` to the indices to scan.

### What OneUptime checks on a store you run

A store in a cloud account is checked from the settings its cloud keeps. A store you run has none OneUptime can read, so an Elasticsearch or OpenSearch cluster is checked from what it answers at its own address. With each content scan, from where the scan runs, it is asked without credentials:

| Asked | What it tells |
| --- | --- |
| Who is asking: `/_security/_authenticate` on Elasticsearch, `/_plugins/_security/authinfo` on OpenSearch | Whether it asks for credentials at all |
| A search that returns no documents, only whether there are any | Whether whoever reaches it can read its documents |
| Its address over plain HTTP, when its connection string is HTTPS | Whether it takes connections without TLS |

Nothing is written to it, so a cluster with users and roles cannot be asked whether its anonymous user may write: that line of its **Configuration** reads **Can't be checked**. One with no access control at all takes every request, writes too. A cluster that answers anyone fails [Anyone who reaches it can read it without credentials](/docs/data-security/checks-and-issues#exposure).

Where the scan runs decides what else can be known. OneUptime Cloud's workers reach only addresses on the internet, so a cluster they scan is reachable from the internet, and its exposure says so. From a probe, or from a OneUptime you host, the scan runs inside a network, and whether the internet reaches the cluster can't be known from there: its exposure reads **Unknown**, and its **Overview** says why. Its encryption at rest, backups and access logging are its servers' own, not visible from its address, and are not checked.

A database you run is sampled, not asked, and how it can be reached is not checked: its exposure reads **Can't be checked**, as does that of a kind OneUptime does not sample. Until a store is first checked, its exposure reads **Not checked yet**, so a store waiting for its first check is never taken for one that cannot be checked.

## What OneUptime keeps

For each data type found at each location - a column, a field, an object pattern, a telemetry attribute - a finding keeps:

- how many sampled values held it, out of how many, and how many of them were well-known test values;
- how many different values matched, estimated from hashes that stay in the scanner's memory and are dropped with the scan;
- the confidence, and whether the location's name pointed at the data type;
- at most three masked samples, masked inside the scanner before anything leaves it.

It never keeps a raw value. Each kind of value is masked so that a person can recognize it, never use it:

| Value | Masked sample |
| --- | --- |
| An email address | `j***@e******.com`: the first letter of the name and of the domain, and the top-level label |
| A card number | `**** **** **** 4242`: the last four digits, as PCI DSS allows a card to be shown |
| A secret | Its first four and last four characters when it is long, its first two when it is short, and only the header of a private key |
| A URL or connection string | All of it except the password |
| An IP address | Its first part, the network, with the rest hidden |
| A found-by-name value | Its first character, then `****` |
| A document marking | The marking as written, such as "Confidential": it says what the document is |
| Anything else | Its last two to four characters, with separators kept, such as `***-**-6789` |

Turn **Keep Masked Samples** off in the project's settings to keep counts only: from the next scan of each store, the findings it writes keep no samples.

Copies of data between stores are found by fingerprints, not values: 128 numbers of 16 bits for each data type, hashed with a key of the project's own (see [How fingerprints stay private](/docs/data-security/flows-access-residency#how-fingerprints-stay-private)).

A finding counts toward its store for 30 days after a scan last saw it, since a sample can miss what is still there. One unseen for 90 days is deleted. A store keeps at most 2,000 findings.

## Settings

Data Security's settings are one set per project, in the **Settings** section of Data Security's menu. They start with these defaults:

| Setting | Default | What it does |
| --- | --- | --- |
| **Check Configuration** | On | Runs the checks on every store. Off, no issue opens, changes or closes. |
| **Scan Content** | On | Samples stores' content where the content permission was granted. |
| **Scan Telemetry** | On | Samples the project's logs, traces, metrics, exceptions, replays and AI conversations. |
| **Find Names And Street Addresses** | On | Reads free text for people's names and street addresses with a small model inside the scanner. It is not OneUptime AI, and the text never leaves the scanner. See [Names and street addresses in free text](/docs/data-security/data-types#names-and-street-addresses-in-free-text). |
| **Find Names And Street Addresses In Telemetry** | Off | The hourly telemetry scan reads log bodies, exception messages and AI conversations with the model too, up to a minute each hour. Only while the setting above is on. |
| **Keep Masked Samples** | On | Keeps up to three masked samples with each finding. Off keeps counts only. |
| **Open Security Cases** | On | Opens a security case, grouped by store, when a Critical issue opens. |
| **Raise Alerts** | Off | Raises an alert, which pages whoever is on call, when a Critical issue opens. |
| **Alert Severity** | Empty | The severity of those alerts. Empty is the project's most severe. |
| **Declare Incidents** | Off | Declares an incident, which your incident process runs, when a Critical issue opens. |
| **Incident Severity** | Empty | The severity of those incidents. Empty is the project's most severe. |
| **Notify Owners** | On | Emails a store's owners when an issue opens on it. |
| **Objects Per Scan** | 2,000 | The most objects one scan of a bucket reads, from 10 to 50,000. |
| **Bytes Per Object** | 65,536 (64 KB) | The most bytes read from one object, from 1,024 to 4,194,304. |
| **Bytes Per Scan** | 52,428,800 (50 MB) | The most bytes one content scan reads in all, from 65,536 to 1,073,741,824. |
| **Rows Per Table** | 1,000 | The most rows read from one table, from 10 to 100,000. |
| **Tables Per Scan** | 200 | The most tables one scan reads, from 1 to 5,000. |
| **Telemetry Sample Size** | 500 | How many recent records of each service and signal a telemetry scan reads, from 10 to 10,000. |
| **Scan Every (Hours)** | 24 | How often a store's content is sampled again, from 1 to 720. |
| **Never Sensitive** | Empty | Values that are never findings, such as your own support address. |
| **Data Types Turned Off** | Empty | Built-in data types the project's scans do not look for: the switches under **Built-in Data Types**. |

## Troubleshooting

:::details A store says its content was not scanned
The scan says why: "Content scanning needs the connection's content permission, or a connection string for a store you run." Set the store's connection to **Configuration and content samples** and run its command again, or give the store you run a connection string. Check, too, that **Scan Content** is on for the store and in the project's settings.
:::

:::details A check says it cannot tell
A fact the reader could not read - a permission the role does not have, an API that is not turned on - is unknown, never guessed. Its check reports that it cannot tell, and an issue it opened stays open: nobody may conclude a problem is fixed because OneUptime could not look. The configuration read's warnings say what it could not read. Run the connection's command again to grant what is missing.
:::

:::details A store's exposure says Can't be checked
OneUptime has no way to read how a store of its kind can be reached: a database you run, or a kind it does not sample. It is not a failure, and no issue opens for it. Its **Settings** say what is checked on it, under **What OneUptime Checks**. A store whose exposure says **Not checked yet** is one OneUptime can check and has not yet: a search cluster before its first content scan, or a store in a cloud account before its connection's first configuration read.
:::

:::details No S3 buckets or BigQuery datasets appear
They come from the configuration read, not from cloud inventory. Set the connection to **Configuration only** or above, and run its command again.
:::

:::details A scan is marked Partly succeeded
It reached a limit before it read everything: the 8 minutes, **Bytes Per Scan** or **Objects Per Scan**, or a request the cloud refused. Its warnings say which. The next scan goes on, skipping what has not changed, or raise the limit.
:::

## Next steps

:::cards
- [Sensitive Data Types](/docs/data-security/data-types): What the scanner looks for in what it reads.
- [Data Security Checks and Issues](/docs/data-security/checks-and-issues): What the configuration read is checked for.
- [Sensitive Data in Telemetry](/docs/data-security/telemetry): Your logs, traces and AI conversations, which need no setup.
- [Connect a Cloud Account](/docs/telemetry/cloud-accounts): Connect AWS, Azure or Google Cloud in the first place.
:::
