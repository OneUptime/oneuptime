# Jira 連携

OneUptime のインシデントが宣言されるたびに [Jira](https://www.atlassian.com/software/jira) の課題を開き、インシデントの進行に合わせて課題を同期し、Jira 側のステータス変更を OneUptime に戻す — すべて [ワークフロー](/docs/workflows/index) で実現できます。インストールが必要な Jira 専用ブロックはありません。OneUptime は [API コンポーネント](/docs/workflows/components#api) で Jira の REST API を呼び出し、Jira は [Webhook トリガー](/docs/workflows/triggers#webhook) に対してコールバックします。

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

このページでは両方向を構築します。インバウンドのセクションより前はすべて **Jira Cloud** を前提に書かれています。**Jira Data Center** で変わる点は終盤のセクションにまとめてあります。

> Atlassian は Jira Cloud の用語を変更し続けています。UI の多くの場所で **プロジェクト (project)** は **スペース (space)** に、**課題 (issue)** は **作業アイテム (work item)** になりました。テナントによってどちらの用語も使われているため、以下では表記が重要になる箇所で両方を併記しています。

## 前提条件

- Jira Cloud サイト (`https://your-domain.atlassian.net`) と課題を登録するプロジェクト。その **プロジェクトキー** — `OPS-1234` の `OPS` の部分 — を控えておきます。
- そのプロジェクトで課題を作成できる Jira アカウントと、[id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) で発行したそのアカウントの **API トークン**。個人アカウントではなくサービスアカウントを使ってください。この方法で作成された課題はトークン所有者の作成として記録されます。
- インバウンド側のために、そのプロジェクトで自動化ルールを作成できる権限。
- ワークフローとグローバル変数を作成できる OneUptime プロジェクト。

## ステップ 1 — Jira の認証情報をシークレットとして保存する

Jira Cloud の REST API は、Atlassian アカウントのメールアドレスと API トークンを base64 でまとめてエンコードした **Basic 認証** を使います。

1. `email:api_token` を一度だけエンコードします。

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   `echo` ではなく `printf` を使ってください。`echo` は改行を付け足し、その改行も一緒にエンコードされてしまいます。すると Jira は `401` を返しますが、貼り付けた文字列を見ても原因はまったく分かりません。

2. OneUptime で **ワークフロー → グローバル変数 → 作成** を開きます。名前を `JIRA_AUTH` にし、**Content** に base64 文字列を貼り付け、**Secret** をオンにします。
3. 2 つ目の変数として、シークレットではない `JIRA_URL` を追加し、末尾のスラッシュなしで `https://your-domain.atlassian.net` を設定します。

これで任意のブロックが `Authorization` ヘッダーに `Basic {{global.variables.JIRA_AUTH}}` を使えるようになり、トークンがワークフローにも実行ログにも現れることはありません。[変数](/docs/workflows/variables) を参照してください。

Atlassian の API トークンについて、誰も見ていない連携をいずれ壊すことになる 2 点があります。

- **トークンには有効期限があります。** トークンは 1 日から 1 年の有効期間で作成され、既定は 1 年です。更新の仕組みはなく、期限切れのトークンは同じページで手作業で作り直し、`JIRA_AUTH` にエンコードし直す必要があります。有効期限をどこかのカレンダーに入れておいてください。何か月も動いていたワークフローが突然 `401` を返し始めたら、原因はこれです。
- **スコープ付きトークンは別のベース URL を必要とします。** トークンのページには、従来の **Create API token** に加えて **Create API token with scopes** があります。スコープ付きトークンの方が安全な選択ですが、宛先はあなたのサイトではありません。宛先は `https://api.atlassian.com/ex/jira/<cloudId>` になるため、`JIRA_URL` をそちらに変更します。以下のパスはすべてそのまま後ろに続きます。`cloudId` は `https://your-domain.atlassian.net/_edge/tenant_info` の JSON にあります。スコープ付きトークンを `your-domain.atlassian.net` に送っても、単に失敗します。

組織が Atlassian の集中ユーザー管理を利用している場合、有効期限の問題を回避できる 3 つ目の選択肢があります。[サービスアカウント用の OAuth 2.0 資格情報](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/) です。トークンではなくクライアント ID とシークレットが得られ、ワークフローは実行のたびに、その開始時にそれらを短命のアクセストークンと交換します — [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) のページと同じ 2 ブロック構成で、**API Post (JSON)** ブロックがトークンを取得し、それ以降のブロックが `Bearer <token>` を送ります。1 年後に手作業で差し替えるものは何もありません。正確なトークンリクエストは Atlassian のページにあります。API のベース URL は `https://api.atlassian.com` です。

## ステップ 2 — インシデントごとに Jira の課題を開く

1. **ワークフロー → ワークフローを作成** を開き、`Incidents → Jira` という名前にして **ビルダー** を開きます。
2. 破線のプレースホルダーブロックをクリックして **On Create Incident** トリガーを追加します。その **Select Fields** で、送信したい列を指定します。

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   **Identifier** は `incident-on-create-1` のままにしておきます — 後続のブロックはこの名前で参照します。

3. **コンポーネントを追加** をクリックして **API Post (JSON)** ブロックを追加し、トリガーの **Success** ドットから新しいブロックの入力ドットへドラッグします。ブロックを開き、**Identifier** を `create-issue` に設定して、次のように入力します。

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   `OPS` を自分のプロジェクトキーに、`Bug` をそのプロジェクトに存在する課題タイプに置き換えます。どちらも id で指定することもでき — `{"id": "10000"}` — Atlassian 自身のサンプルはこの形式を使っています。サイト内に同名の課題タイプが 2 つある場合はこちらを選ぶべきです。それらの id は後述の `createmeta` 呼び出しで取得できます。

説明が重たく見えるのは、Jira Cloud の v3 API がリッチテキストを **Atlassian Document Format** — 文字列ではなくドキュメントツリー — として受け取るためです。上記の形は有効な最小のドキュメントで、テキストノードを 1 つ持つ段落 1 つです。同じことが `environment` や複数行テキストのカスタムフィールドにも当てはまります。1 行テキストのカスタムフィールドは今でもプレーン文字列を受け取ります。

ここで **概要 → ワークフローを編集 → 有効** からワークフローを有効にし、テスト用インシデントを宣言して **実行とログ** を開きます。`create-issue` ブロックは `201` と、新しい課題の `id`、`key`、`self` を含むボディを表示するはずです。キャンバス上の変更は自動保存されます — 保存ボタンはありません。また、無効なワークフローは手動実行も含めまったく実行できません。

新しい課題キーは、このブロック以降の任意のブロックから利用できます。

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### フィールドを増やす

`fields` の中によく追加されるものをいくつか挙げます。

- **優先度** — `"priority": { "id": "20000" }`。サイトの優先度 id を使います。OneUptime の重大度を Jira の優先度にマッピングするには、トリガーと API ブロックの間に **If / Else** ブロックを置き、`{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` で分岐させます。
- **担当者** — `"assignee": { "id": "<accountId>" }`。Jira Cloud は Atlassian のアカウント id で人を識別します。`username` と `userKey` は何年も前に Cloud API から削除されました。
- **ラベル** — `"labels": ["oneuptime", "sev1"]`。文字列のフラットな配列です。ラベルにスペースは含められません。
- **コンポーネント** — `"components": [{ "id": "10000" }]`。
- **カスタムフィールド** — `"customfield_10034": "..."`。フィールド自身の id を使います。値の形はフィールドの型によって決まります。単一選択は `{"value": "red"}`、複数選択は id の配列、複数行テキストフィールドは Atlassian Document Format のドキュメントです。

プロジェクトが実際に何を必要としているかは、推測せず Jira に尋ねてください。プロジェクトの課題タイプを一覧し、次にそのうち 1 つのフィールドを一覧します。

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

2 番目の呼び出しは、その課題タイプが受け付けるすべてのフィールド、どれが必須か、そして正確な `customfield_NNNNN` の id を一覧します。すでに手元にある課題から id を読み取るには、`?expand=names` を付けて取得します。

## ステップ 3 — インシデント id を Jira に持ち込む

双方向同期はどちらの向きも、2 つのシステムのどちらか一方が相手側の識別子を保持していることを前提とします。そして保管場所としては Jira の方が適しています。OneUptime の `customFields` 列は単一の JSON ブロブなので、ワークフローから 1 つの値を書き込むと、そのインシデントのすべてのカスタムフィールドが置き換わってしまうためです。

**Jira 管理者がいる場合。** 短いテキストのカスタムフィールド — 名前は *OneUptime Incident ID* とします — をプロジェクトの作成画面に追加し、`createmeta` でその id を調べ、他の項目と一緒に設定します。

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**管理者がいない場合。** 代わりにラベルに入れます。ラベルにスペースは使えませんが、OneUptime の id はただの UUID なので、`oneuptime-<id>` は有効なラベルになります。

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

この場合、インバウンドのワークフローがリストからそのラベルを取り出す必要があり、これは **Run Custom JavaScript** ブロックの数行で書けます。用意できるならカスタムフィールドの方がすっきりします。

ついでに、Jira の課題からインシデントへ戻るリンクを追加しておくと便利です。`create-issue` の後ろに **API Post (JSON)** ブロックを置き、`{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink` を宛先にして、次を送ります。

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

これで Jira にいる全員がワンクリックで戻れるようになります。このためにトリガーの **Select Fields** に `projectId` を追加してください。この呼び出しを繰り返しても安全なのは `globalId` のおかげです。Jira は 2 つ目のリンクを追加するのではなく、その id を持つ既存のリンクを更新します。ただし更新では省略した項目が null になるため、`object` は部分的なパッチではなく常に全体を送ってください。

## ステップ 4 — インシデントの進行に合わせてコメントと遷移を行う

これは **2 つ目の** ワークフローとして構築します。こうしておけば、ここでの失敗が課題の作成を止めることは決してありません。

1. **ワークフローを作成** し、`Incident updates → Jira` という名前にして **On Update Incident** トリガーを追加します。
2. **Listen on** に `{"currentIncidentStateId": true}` を設定します。これでトリガーは編集のたびではなく状態変更のときだけ発火します。**Select Fields** には `{"_id": true, "currentIncidentState": {"name": true}}` を指定します。
3. **If / Else** ブロックを追加します。**Input 1** は `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`、**Operator** は `==`、**Input 2** は `Resolved` — またはプロジェクトの解決済み状態の名前です。[インシデントの状態と重大度](/docs/incidents/states-and-severities) を参照してください。

**Yes** ブランチからは、まずステップ 2 で開いた課題を見つける必要があります。ステップ 3 で保存した id を使って Jira に問い合わせます。**Identifier** が `find-issue` の **API Post (JSON)** ブロックを使います。

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  ラベルではなくカスタムフィールドを使った場合、この句は自分のフィールド id を用いた `cf[10050] ~ \"...\"` になります。

課題 id は `{{local.components.find-issue.returnValues.response-body.issues[0].id}}` で得られます。以下のどのエンドポイントも、キーと同じように id を受け付けます。

このエンドポイントについて知っておくべきことが 3 つあります。**JQL は URL ではなく POST で送ってください** — 値の中に `=` を含むクエリ文字列はワークフローから出る途中で切り詰められますが、JQL は `=` だらけです。**クエリには範囲の限定が必要です**。単なる `order by key desc` は `400` で拒否されます。`project =` の句があるのはそのためです。そして `/rest/api/3/search/jql` が現行のエンドポイントです — 古い `/rest/api/3/search` は非推奨で廃止予定なので、手を出さないでください。

**コメントを残す** のは `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment` への **API Post (JSON)** ブロック 1 つだけです。ボディは説明と同じく Atlassian Document Format です。

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**課題を動かす** には 2 回の呼び出しが必要です。遷移はワークフローごとに、そしてボードによっては課題ごとに異なる id で識別されるためです。

1. `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` に対する **API Get (JSON)** ブロックは、*その課題の現在のステータスから* 利用できる遷移を返します。それぞれに `id` と `name`、そして遷移先のステータスを示す `to` オブジェクトが含まれます。
2. 同じ URL への **API Post (JSON)** ブロックが遷移を実行します。

   ```json
   { "transition": { "id": "31" } }
   ```

遷移が成功すると `204` がボディなしで返ります。実行時に一覧を読みたくない場合は、正しいステータスの課題に対して一度手動で呼び出し、id をハードコードしても構いません — ただしその id はそのワークフローに結び付いているため、管理者が Jira のワークフローを編集すると気付かないうちに壊れます。

## インバウンド — Jira から OneUptime へ

次は逆方向です。誰かが課題を Done に移動したら、OneUptime のインシデントもそれに続くべきです。

### 先に受信側のワークフローを作る

1. **ワークフローを作成** し、`Jira → OneUptime` という名前にして **Webhook** トリガーを追加します。
2. そのワークフローの **設定** を開き、**Webhook Secret Key** をコピーします。URL は次の形です。

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   セルフホストのインストールでは自分のホストになります。この URL はパスワードと同じように扱ってください — 持っている人は誰でもワークフローを起動できます。漏洩した場合は同じページからキーをリセットします。

3. 他の処理より先に共有シークレットを確認する **If / Else** ブロックを追加します。**Input 1** は `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`、**Operator** は `==`、**Input 2** は `{{global.variables.JIRA_WEBHOOK_SECRET}}` — 自分で決めてシークレットのグローバル変数として保存した値です。
4. **Yes** ブランチから **Update One Incident** ブロックを追加します。

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: Jira 側の変更がここで何を意味するか — 通常は状態の変更です。

   インシデントを移動するには対象の状態の id が必要です。クエリ `{"name": "Resolved"}` を指定した **Find One Incident State** ブロックが `{{local.components.incident-state-find-one-1.returnValues.model._id}}` として返してくれます。それを `currentIncidentStateId` に書き込みます。

ワークフローは有効のままにしておきます。次に、Jira に呼び出す相手を用意します。

### Jira の自動化ルールからイベントを送る

1. Jira で、プロジェクトの自動化ルールを開きます。新しいテナントでは **Space settings → Automation**、古いテナントでは **Project settings → Automation** です。複数プロジェクトにまたがるルールには **Settings → System → Global automation** を使いますが、これには *Jira の管理* グローバル権限が必要です。
2. **Create rule** で **Work item transitioned** トリガー — 古いテナントでは **Issue transitioned** — を選びます。ステータスが **Done** *へ* 移動したときに実行するよう設定します。

   *Work item updated* ではなく、このトリガーを使ってください。更新トリガーは意図的にステータス変更を除外しています。

3. **Send web request** アクションを追加して設定します。

   - **Web request URL**: 上で取得した OneUptime の Webhook URL。
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`、および `X-OneUptime-Secret` / 共有シークレット。他のルール編集者に読まれないよう、シークレットの値には **Hide** オプションを使ってください — ただし、その値の非表示化は取り消せず、ルールをエクスポートまたは複製すると非表示の値は失われます。
   - **Web request body**: **Custom format** にして、形を自分で制御します。

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     ステップ 3 でカスタムフィールドではなくラベルを使った場合は `"labels": "{{issue.labels}}"` を送り、OneUptime 側の **Run Custom JavaScript** ブロックで id を取り出します。

4. ルールを有効にし、テスト用の課題を Done に移動して、両側を確認します。Jira 側ではルール自身の監査ログを、OneUptime 側では **実行とログ** を見ます。

これに頼る前に知っておくべきこと。

- **宛先ポートには制限があります。** Send web request が到達できるのはポート 80、8080、443、6017、8443、8444、7990、8090、8085、8060、8900、9900 だけです。OneUptime Cloud は 443 ですが、通常と異なるポートのセルフホストのインストールはこの方法では呼び出せません。
- **リクエストの署名はありません。** このアクションに HMAC のオプションはないため、HTTPS 上でヘッダーに共有シークレットを載せるのが Atlassian の文書化している仕組みです。受信側ワークフローのステップ 3 にある **If / Else** のチェックが、それを意味あるものにしています。
- **ルールの実行回数は計測されます。** Jira Cloud は成功したルール実行をプランに応じた月間上限に対して数えます — Free で 100、Standard で 1,700、Premium でユーザー数 × 1,000、Enterprise は無制限です。忙しいプロジェクトで遷移のたびに発火するルールは、あっという間に積み上がります。
- **値は URL エンコードされません**。これが問題になるのはフォームエンコードのボディを送る場合だけで、上記の JSON なら問題ありません。
- **Atlassian は送信元 IP レンジを公開しています**。OneUptime のインストールが許可リストの背後にある場合は [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) を参照してください。レンジは変わるので、アドレスを固定せずフィードをポーリングしてください。

### あるいは Jira の Webhook を使う

Jira の管理者は **Settings → System → Advanced → WebHooks** から直接 Webhook を登録でき、送信するイベントと、任意でどの課題が発火するかを絞り込む JQL クエリを選べます。自動化ルールと比べると次の違いがあります。

- ペイロードは自分で決めた形ではなく Jira 自身のものです。`webhookEvent`、`issue_event_type_name`、完全な `issue`、そして変更された各フィールドの前後の値を保持する `items` 配列を持つ `changelog` が含まれます。ステータス変更なら `field` が `status` のエントリを見ます。ワークフロー内でそれを読むには、たいてい **Run Custom JavaScript** ブロックが必要になります。
- Webhook は署名 **できます** — Webhook にシークレットを設定すると、Jira はリクエストボディの HMAC を持つ `X-Hub-Signature` ヘッダーを送ります — が、ワークフローはそれを検証できません。署名は Jira が送った正確なバイト列を対象としますが、Webhook トリガーはすでに JSON にパースされたボディをワークフローに渡すため、ハッシュを取る対象が残っていないのです。リクエストを認証したい場合は、共有シークレットのヘッダーを使う自動化ルールを選んでください。
- URL は HTTPS で、かつ Jira 自身のポートリストに含まれるポートでなければなりません。このリストは自動化アクションが使うものとは *別物* で、ここではポート 80 は許可されていません。
- 配信は 5 分から 15 分のバックオフで最大 5 回まで再試行されるため、同じイベントが 2 回届いてもワークフローが耐えられる必要があります。

アプリが `/rest/api/3/webhook` 経由で登録する Webhook はまた別物で、更新しない限り登録から 30 日後に失効します。上記の管理者が登録した Webhook は失効しません。

## Jira Data Center

セルフマネージドの Jira も、いくつかの置き換えをすれば同じように動きます。**Jira Server** は 2024 年 2 月にサポートが終了し修正も提供されないため、セルフマネージドの対象は Data Center と考えてください。

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — Data Center に v3 はありません                            |
| `description` は Atlassian Document Format のドキュメント | `description` は wiki マークアップのプレーン文字列                     |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| id.atlassian.com の API トークン                   | 自分の Jira アカウントの **Profile → Personal access tokens → Create token** |
| 自動化アクション **Send web request**              | 自動化アクション **Send outgoing web request**                                |

したがって create-issue のブロックは `/rest/api/2/issue` への `POST` になり、内容は次のようになります。

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

ドキュメントツリーがない分、テンプレート化は簡単です。

計画に入れておくべきその他の相違点。

- **パーソナルアクセストークン** は Jira Core および Jira Software 8.14、Jira Service Management 4.15 から利用できます。有効期限があり — 既定は 365 日 — UI は期限の 5 日前から *Expires soon* と表示します。Data Center ではユーザー名とパスワードによる Basic 認証も依然として使えますが、ログインに数回失敗すると CAPTCHA が発生し、人間がブラウザで解除するまでそのアカウントは REST API から完全に締め出されます。タイプミスに気付く方法としては最悪です。トークンを使ってください。
- **自動化は Jira Data Center 10.0 から同梱** されています。それ以前は別途インストールする Automation for Jira アプリでした。その送信リクエストの既定タイムアウトは 3000 ms で、`outgoing.webhook.timeout.ms` プロパティで調整できます。
- **Webhook** は **Administration → System → Advanced → WebHooks** で登録し、JQL によるスコープ指定に対応しています。そのフィルターは絞り込んでおいてください。Jira はイベントを発生させたスレッド上で登録済みの全 Webhook の JQL を評価するため、緩いフィルターが十数個あると、それを引き起こしたユーザー操作自体が遅くなります。
- **Data Center 10.0 から Webhook の配信は非同期** になり、同期のオプションはありません。そのためイベントが順不同で届くことがあります。受信側のワークフローは冪等に作ってください。
- **Jira 10 は Webhook URL の変数から `$` を廃止しました** — `${issue.id}` は `{issue.id}` になりました — また Webhook の REST リソースを `/rest/webhooks/1.0/webhook` から `/rest/jira-webhook/1.0/webhooks` に移動しました。

## アラートでも同じことをする

上記はすべて、よくあるケースであるインシデントを軸に書かれていますが、アラートでもまったく同じように動きます — レコードの種類を入れ替えるだけで、他は何も変わりません。

| インシデント                             | アラート                                    |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`、`currentIncidentState`、`incidentSeverity` | `alertNumber`、`currentAlertState`、`alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

ワークフローが持てるトリガーはちょうど 1 つなので、インシデント用とアラート用にワークフローが 1 つずつ必要です。両者が同じ処理をするなら、Jira 側を一度だけ作り、**Execute Workflow** コンポーネントで両方から呼び出してください。

## トラブルシューティング

まず **実行とログ** で失敗したブロックを開きます。Jira は何を拒否したかを正確に示す JSON ボディを返し、API コンポーネントはそれを `response-body` に保持します。

**`401 Unauthorized`。** `email:api_token` を `printf` で再エンコードして `JIRA_AUTH` を更新してください。`echo` が付けた末尾の改行が典型的な原因です。次に、トークンを所有するアカウントがそのプロジェクトで課題を作成できるか確認します。Data Center では、`Basic` ではなく `Bearer` を送っているか確認してください。

**フィールド名を挙げた `400 Bad Request`。** その課題タイプがプロジェクトに存在しないか、プロジェクトに送っていない必須フィールドがあります。そのプロジェクトと課題タイプに対して上記の `createmeta` を実行し、比較してください。

**`description` についての `400`。** Cloud の v3 では description は文字列ではなく Atlassian Document Format のドキュメントでなければなりません。上記のドキュメントを送るか、そのブロックを `/rest/api/2/issue` に切り替えてプレーンテキストを送ってください。

**`404 Not Found`。** ベース URL と API のバージョンを確認してください — Cloud は `/rest/api/3/...`、Data Center は `/rest/api/2/...` です。

**`429 Too Many Requests`。** Jira がレート制限をかけています。レスポンスは秒単位の `Retry-After` と、どの制限に当たったかを示す `RateLimit-Reason` を含みます。単一の課題に対する書き込みは厳しく制限されており — 2 秒間に 20 回程度 — コメントと遷移を立て続けに行うワークフローは 1 つの課題だけでも制限に触れることがあります。呼び出しの間に **Delay** ブロックを入れるか、まとまった処理はスケジュールされたワークフローに移してください。

**遷移の呼び出しが `400` を返す。** その遷移 id は課題の *現在の* ステータスからは有効ではありません。その課題の `/transitions` を取得し、レスポンスにある id を使ってください。

**自動化ルールは成功と表示されるのに OneUptime に何も届かない。** まずポートを確認してください — 上記の制限リストを参照します。次に、自分で `curl` を使って Webhook URL にリクエストを送り、**実行とログ** に現れるか確認します。自分のリクエストは届くのに Jira のものが届かないなら、問題は Jira 側にあります。

**ワークフローは実行されるのにインシデントが変わらない。** **Update One Incident** ブロックは、クエリが何にも一致しなかったとき `Items Updated: 0` と報告し、それはエラーではなく成功として扱われます。ペイロードの id が本当に OneUptime のインシデント id であるか、そして `_id` で問い合わせているかを確認してください。

**Jira の課題に `{{...}}` の参照がそのまま表示される。** 解決されなかった参照は空白にされず、テキストとしてそのまま通されます。実行ログには解決できなかった参照が示されます — たいていはブロック識別子の打ち間違いか、名前を変えた変数です。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — インバウンドとアウトバウンドのパターン、そして認証クイックリファレンス。
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — Dynamics に対する同じ双方向の構築。
- [ワークフロー 概要](/docs/workflows/index) と [ワークフローの作成](/docs/workflows/authoring) — キャンバス、識別子、ワークフローの有効化。
- [コンポーネント](/docs/workflows/components) — API ブロック、If / Else、OneUptime データコンポーネント。
- [変数](/docs/workflows/variables) — シークレットと、あるブロックの出力を次のブロックから読む方法。
- [設定と安全性](/docs/workflows/configuration) — Webhook のセキュリティと外向きのネットワークアクセス。
- [ServiceNow](/docs/integrations/servicenow) と [PagerDuty](/docs/integrations/pagerduty) — 他のツールに対する同じアウトバウンドパターン。
