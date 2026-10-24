# Runbook 概要

Runbook は再利用できる対応手順です。インシデント、アラート、定期メンテナンスイベントに対して実行する、手動ステップと自動ステップの順序付きリストです。「次は何をすればいい？」というやり取りを、オンコール担当者なら誰でも午前 3 時にたどれるチェックリストに変え、スクリプト、API 呼び出し、承認はあらかじめ書かれています。Runbook は、インシデントに対応するオンコールエンジニアと、その対応を自動化するプラットフォームチームのためのものです。

:::cards
- [Runbook を作成する](/docs/runbooks/authoring): Runbook を作成し、そのステップを書きます。
- [Runbook ルール](/docs/runbooks/rules): 新しいインシデント、アラート、メンテナンスイベントで Runbook を開始します。
- [Runbook を実行する](/docs/runbooks/running): 実行を開始し、ステップを完了・承認し、キャンセルします。
- [Runbook のトリガー](/docs/runbooks/triggers): スケジュールに従って、またはほかのツールから Webhook URL 経由で Runbook を実行します。
- [Runbook の変数](/docs/runbooks/variables): ステップが名前で使うホスト、鍵、パスワード、kubeconfig。
- [Runbook エージェント](/docs/runbooks/agents): 自社インフラでスクリプトを実行する Runner をインストールします。
:::

## Runbook の実行の流れ

```mermaid title="トリガーから記録された結果まで"
flowchart TB
    subgraph triggers["実行を開始するもの"]
        direction LR
        rule["Runbook ルール"]
        manual["イベントで<br/>Runbook を実行"]
        runnow["Runbook で<br/>今すぐ実行"]
    end
    rule --> execution["実行: ステップの<br/>スナップショット"]
    manual --> execution
    runnow --> execution
    execution --> worker["OneUptime Worker が<br/>ステップを順に処理"]
    worker -->|"手動ステッ<br/>プまたは承認"| person["人の対応を待つ"]
    worker -->|"HTTP と<br/>AI のステップ"| onworker["Worker で実行"]
    worker -->|"JavaScript、<br/>Bash、SSH、<br/>kubectl"| runner["自社インフラの<br/>Runner"]
    person --> record["ステータス、<br/>出力、エラーを記録"]
    onworker --> record
    runner --> record
    record --> history["イベントの<br/>Runbook ページと<br/>Runbook の実行一覧"]
```

Runbook を実行するたびに **実行** が作成されます。開始時に Runbook のステップがコピーされ、OneUptime はそれを順に処理します。Manual ステップや承認が必要なステップは、誰かが対応するまで実行を一時停止します。

HTTP と AI のステップは OneUptime Worker で実行されます。Bash、SSH、kubectl のステップは自社インフラにインストールした [Runner](/docs/runbooks/agents) で実行されるため、それらのスクリプトが OneUptime のサーバーで実行されることはありません。JavaScript のステップも自社の Runner で実行されるか、Runner を選ばずプロジェクトに [デフォルト Runner](/docs/runbooks/agents#プロジェクトのデフォルト-runner) もない場合は、インターネットにしかアクセスできないサンドボックスで [グローバル Runner](/docs/runbooks/agents#グローバル-runner) によって実行されます。各ステップのステータス、出力、エラーメッセージは実行に記録され、実行は対象のインシデント、アラート、イベントに残ります。

## 主な概念

| 概念 | 意味 |
| --- | --- |
| **Runbook** | テンプレートです。名前の付いた再利用可能な手順で、ステップの順序付きリストと **この Runbook を実行** スイッチを持ちます。 |
| **ステップ** | Runbook の 1 項目です。種類（Manual、JavaScript、HTTP request、Bash、SSH、kubectl、AI）、タイトル、説明、種類ごとの設定を持ちます。 |
| **Runbook ルール** | 条件（モニター、重大度、ラベル、モニターのラベル、タイトル、説明）を満たすインシデント、アラート、定期メンテナンスイベントに、1 つ以上の Runbook を自動で関連付けるルールです。 |
| **実行** | Runbook の 1 回の実行です。ルールが発火したとき、誰かがイベントで **Runbook を実行** をクリックしたとき、または Runbook 自体で **今すぐ実行** をクリックしたときに作成されます。ステップのスナップショットと、各ステップのステータスと出力を保持します。 |
| **スナップショット** | 各実行に保存される、Runbook のステップの固定されたコピーです。後から Runbook を編集しても、過去の実行の履歴は書き換わりません。 |
| **Runner** | 自社インフラのホストで動かす小さなエージェントです。自分を指定した JavaScript、Bash、SSH、kubectl のステップを実行します。Runbook エージェントとも呼ばれます。 OneUptime がすべてのプロジェクトのために動かすグローバル Runner は、プロジェクトにデフォルト Runner がない限り、Runner を指定しない JavaScript のステップを実行します。 |
| **変数** | ステップが名前で使う値です。ホストや URL などで、すべての Runbook が使えるプロジェクトの変数は `{{global.variables.NAME}}`、Runbook 自身の変数は `{{local.variables.NAME}}` と書きます。 |
| **シークレット** | 値が保存時に暗号化され、二度と表示されず、ステップの出力では隠される変数です。SSH の鍵、パスワード、kubeconfig、API トークンなどに使います。使用を許可した Runner にだけ渡され、グローバル Runner には許可した場合にだけ渡されます。 |

## ステップの種類

各ステップに合う種類を選びます。[Runbook を作成する](/docs/runbooks/authoring) で各種類の設定を説明しています。

| ステップの種類 | 実行場所 | 使う場面 | 例 |
| --- | --- | --- | --- |
| **Manual** | 人 | OneUptime にはできない確認、判断、操作を人が行う必要がある。 | 「トラフィックがセカンダリリージョンに切り替わったことを確認する。」 |
| **JavaScript** | Runner | サンドボックスで小さく限定された計算が必要。 | レプリカの遅延を計算し、続行するかどうかを決める。 |
| **HTTP request** | OneUptime Worker | 既存の API（クラウドプロバイダー、PagerDuty、Slack の Webhook、自社サービス）を呼び出す。 | フェイルオーバーオーケストレーターへの `POST`。 |
| **Bash** | Runner | 自社インフラでシェルコマンドが必要。 | 復旧スクリプトを実行する、または自社のネットワークからしか届かないサービスを `curl` で呼び出す。 |
| **SSH** | Runner | シークレット変数でサインインして、リモートマシンで bash スクリプトを実行する必要がある。 | Web サーバーでサービスを再起動する。 |
| **kubectl** | Runner | クラスターに kubectl コマンドを実行する必要がある。 | `production` の `checkout-api` を再起動し、新しい Pod を待つ。 |
| **AI** | OneUptime Worker | 実行の途中で、プロジェクトの LLM プロバイダーによる分析、要約、判断がほしい。 | 「上の診断結果を確認してください。フェイルオーバーしても安全ですか？」 |

1 つの Runbook にすべてを混在させられます。人による確認と自動化と AI の分析を織り交ぜられることが Runbook の強みです。

## 実行を開始するもの

| 方法 | 場所 | 実行の関連付け先 |
| --- | --- | --- |
| Runbook ルール | **インシデント**、**アラート**、**定期メンテナンス** → **ルール** → **Runbook ルール** | 新しいインシデント、アラート、イベント |
| **Runbook を実行** | インシデント、アラート、定期メンテナンスイベントの **Runbook** ページ | そのイベント |
| **今すぐ実行** | Runbook の **概要** ページ | なし（その場限りの実行） |
| AI ルール | [AI SRE](/docs/ai/ai-sre) を参照 | インシデントまたはアラート |
| Runbook のスケジュール | Runbook の **トリガー** ページ。[Runbook のトリガー](/docs/runbooks/triggers#スケジュールで実行する) を参照 | なし: 無人の実行 |
| Runbook の Webhook URL の呼び出し | Runbook の **トリガー** ページ。[Runbook のトリガー](/docs/runbooks/triggers#webhook-を呼び出す) を参照 | なし: 実行は呼び出しが送った値を保持します |

**設定** ページで **この Runbook を実行** スイッチがオフになっている Runbook は、どの方法でも開始されません。すでに開始した実行は続行します。

## ダッシュボードでの Runbook の場所

Runbook は **製品** の **ダッシュボードと自動化** グループにあります。

| ページ | そこで行うこと |
| --- | --- |
| **製品 → Runbook** | Runbook を一覧、作成、表示します。 |
| Runbook の **ステップ** | ステップを書いて並べ替え、 **ステップを保存** を選びます。 |
| Runbook の **概要** | 最新の実行と結果を確認し、 **今すぐ実行** をクリックします。 |
| Runbook の **実行** | この Runbook のすべての実行を、ステータスや開始日で絞り込んで表示します。 |
| Runbook の **トリガー** | [スケジュール](/docs/runbooks/triggers#スケジュールで実行する) で、またはほかのツールから [Webhook URL](/docs/runbooks/triggers#webhook-を呼び出す) 経由で実行します。 |
| Runbook の **変数** | その Runbook のステップだけが使う [変数](/docs/runbooks/variables) を管理します。 |
| Runbook の **所有者** | 担当する人とチームを追加します。 |
| Runbook の **設定** | Runbook を削除せずに **この Runbook を実行** をオフにします。 |
| **Runbook → 実行** | プロジェクト内のすべての Runbook のすべての実行です。 |
| **Runbook → Runner** | Runbook のステップが実行される [Runner](/docs/runbooks/agents) をインストールします。 |
| **Runbook → 設定** | すべての Runbook が [使える](/docs/runbooks/variables) **グローバル変数** と、新しい Runbook に所有者とラベルを追加する **所有者ルール** と **ラベルルール** を管理します。 |
| **インシデント / アラート / 定期メンテナンス → ルール → Runbook ルール** | Runbook を自動で開始するルールを作成します。 |
| インシデント、アラート、メンテナンスイベント → **Runbook** | 関連付けられた実行を確認し、 **Runbook を実行** をクリックして新しく開始します。 |

Runbook 自身のサイドメニューは、ページを次のようにまとめています。最初に開いているのは **基本** だけです。セクションのタイトルをクリックすると開きます。セクション内のどのページでも、そのセクションは自動的に開きます。

| セクション | ページ |
| --- | --- |
| **基本** | **概要**、**ステップ** |
| **ログ** | **実行** |
| **所有者** | **所有者** |
| **設定** | **トリガー**、**変数**、**設定** |
| **開発者** | **Terraform**、**API**、**AI アシスタント** |
| **詳細** | **監査ログ**、**Runbook を削除** |

## 実例

タイトルに「db-primary」を含むインシデントごとに、5 ステップのデータベースフェイルオーバー Runbook を開始したいとします。

:::steps
### Runbook を作成する

**Runbook** で **Runbookを作成** をクリックし、「DB primary failover」と名前を付けます。Runbook は **ステップ** で開くので、次のステップを追加して **ステップを保存** をクリックします。

| # | 種類 | タイトル |
| --- | --- | --- |
| 1 | JavaScript | フェイルオーバー前のレプリカ遅延を記録する |
| 2 | Manual | DBA ダッシュボードでレプリカが正常であることを確認する |
| 3 | HTTP request | フェイルオーバーオーケストレーターへの `POST` |
| 4 | Manual | 書き込みが新しいプライマリに向かっていることを確認する |
| 5 | HTTP request | Slack の `#db-incidents` に解除通知を送る |

### ルールを追加する

**インシデント → ルール → Runbook ルール** で、条件 1 つと開始する Runbook を指定したルールを作成します。

```text
Conditions:  Incident Title starts with db-primary
Runbooks:    [DB primary failover]
```

### 実行させる

モニターがインシデント `INC-4821 · db-primary connection timeout` を開きます。ルールが一致し、実行が始まります。

- ステップ 1（JavaScript）は、そのステップ用に選んだ Runner で実行されます。`{ lagMs: 412 }` のような戻り値が記録されます。 Runner を選ばないステップは、プロジェクトのデフォルト Runner で、それがなければグローバル Runner で実行されます。
- ステップ 2（Manual）で実行が一時停止し、 **あなたの対応待ち** と表示されます。オンコール担当者がダッシュボードを確認して **完了にする** をクリックします。
- ステップ 3（HTTP request）が実行され、`POST` のレスポンスが記録されます。
- ステップ 4（Manual）で、誰かが完了するまで実行が再び一時停止します。
- ステップ 5（HTTP request）が実行され、実行は **完了** になります。

### 振り返る

実行はインシデントの **Runbook** ページに残ります。ポストモーテムを書くとき、各ステップの出力、エラー、所要時間をワンクリックで確認できます。
:::

## よくある使い方

- **データベースのフェイルオーバー**: JavaScript で状態を記録し、オンコールの DBA にレプリカの正常性を確認してもらい（Manual）、オーケストレーターを呼び出し（HTTP request）、DNS を確認し（Manual）、解除通知を送ります（HTTP request）。
- **キャッシュのパージ**: HTTP リクエストを 1 回送り、続いて Manual ステップで「キャッシュヒット率が回復していることを確認する」。
- **顧客に影響するインシデント**: Manual で「ステータスページに更新を投稿する」、HTTP リクエストでサポートチームに通知、JavaScript で影響を受けたアカウントの一覧を取得します。
- **定期メンテナンス前の事前確認**: メトリクスのスナップショットを取り、関係者と変更時間帯を確認し（Manual）、ロードバランサーでメンテナンスモードを有効にします（HTTP request）。
- **診断してから修正**: Bash ステップで診断情報を集め、AI ステップがそれを読んで修正を提案し、 **承認を要求** を付けた kubectl ステップは、人が承認して初めてワークロードを再起動します。
- **常に実行する衛生管理**: 条件のないルールで、インシデントごとにシステムの状態をポストモーテム用に記録します。

## Runbook と OneUptime のほかの機能との関係

- **モニター** がインシデントとアラートを開き、 **Runbook ルール** がそれを Runbook の実行に変えます。検知、トリガー、対応、記録です。
- **[オンコールポリシー](/docs/on-call/schedules)** は誰を呼び出すかを決めます。Runbook は、その人が起きてから何をするかを決めます。
- Slack や Microsoft Teams などの **[ワークスペース接続](/docs/workspace-connections/slack)** は、更新を投稿する HTTP リクエストステップの自然な送り先です。
- **[ステータスページ](/docs/status-pages/index)** は、顧客向け Runbook の Manual ステップとして更新されることがよくあります。

## 次のステップ

:::cards
- [Runbook を作成する](/docs/runbooks/authoring): 最初の Runbook とそのステップを作成します。
- [Runbook エージェント](/docs/runbooks/agents): Bash、SSH、kubectl のステップを書く前に Runner をインストールします。
- [Runbook ルール](/docs/runbooks/rules): インシデントが作成されたときに Runbook を自動で開始します。
- [Runbook の設定と安全性](/docs/runbooks/configuration): 上限、タイムアウト、権限、堅牢化。
:::
