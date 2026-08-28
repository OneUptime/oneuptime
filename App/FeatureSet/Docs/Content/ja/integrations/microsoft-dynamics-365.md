# Microsoft Dynamics 365 連携

OneUptime のインシデントが宣言されるたびに [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) で **ケース** を開き、インシデントの進行に合わせてそのケースを同期し、Dynamics 側のケース変更を OneUptime に戻す — すべて [ワークフロー](/docs/workflows/index) で実現できます。インストールが必要な Dynamics 専用ブロックはありません。OneUptime は [API コンポーネント](/docs/workflows/components#api) で **Dataverse Web API** と通信し、Dynamics は [Webhook トリガー](/docs/workflows/triggers#webhook) 経由で応答します。

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

このページは両方向を扱います。まずアウトバウンド側から作ってください。Microsoft Entra ID の設定が必要なのはそちらで、それさえ動けばインバウンド側はフロー 1 つで済みます。

## 前提条件

- **ケース** テーブルを含む **Dynamics 365** 環境。ケースは Dynamics 365 Customer Service に由来するもので、それがない Dataverse 環境には書き込み先となる `incident` テーブルがありません。
- 環境の **Web API エンドポイント**。[Power Platform 管理センター](https://admin.powerplatform.microsoft.com/) で環境の **設定 → 開発者リソース**、または **make.powerapps.com → 設定 → 開発者リソース** で確認できます。`https://yourorg.crm.dynamics.com/api/data/v9.2/` のような形で、リージョンの部分は変わります (北米は `crm`、南米は `crm2`、日本は `crm7` など)。
- **Microsoft Entra ID** でアプリケーションを登録する権限と、Dynamics 環境で **アプリケーションユーザー** を作成する権限。この 2 つはたいてい別々の管理者が持っています。
- ワークフローとグローバル変数を作成できる OneUptime プロジェクト。

> 以下ではすべて、Dynamics のフォーム上のラベルではなく Dataverse のテーブル名を使います。ケースは **`incident`** テーブル、URL 内のコレクション名は **`incidents`**、主キーは **`incidentid`**、タイトル列は **`title`** です。UI に表示されるケース番号は **`ticketnumber`** です。

## ステップ 1 — Microsoft Entra ID でアプリケーションを登録する

OneUptime は人ではなくアプリケーションとして認証するため、OAuth 2.0 の **クライアント資格情報** フローを使います。

1. Dynamics 環境と同じテナントの管理者として [Azure ポータル](https://portal.azure.com) にサインインし、**Microsoft Entra ID** を開きます。
2. **アプリの登録 → 新規登録** に進みます。`OneUptime Integration` のような名前を付け、**サポートされているアカウントの種類** は **この組織ディレクトリのみに含まれるアカウント** のままにして、**登録** を選びます。
3. アプリの **概要** ページから **アプリケーション (クライアント) ID** と **ディレクトリ (テナント) ID** をコピーします。
4. **証明書とシークレット → クライアント シークレット → 新しいクライアント シークレット** に進みます。画面を離れる前に、シークレットの ID ではなく **値** をコピーしてください。二度と表示されません。クライアントシークレットの寿命は最長 24 か月なので、期限を必ず目に入る場所に控えておきます。

ここで追加されがちですが、必要のないものが 2 つあります。

- **API のアクセス許可は不要です。** クライアント資格情報フローではサインインしたユーザーが存在しないため、委任されたアクセス許可は何もしません。**Dataverse** の下にある `user_impersonation` は委任されたアクセス許可で、対話型アプリ専用です。Microsoft Entra ID は、アクセス許可がまったく設定されていなくても Dataverse 向けのトークンを問題なく発行します — アクセスの可否は Dynamics 側、つまりステップ 2 で決まります。
- **管理者の同意も不要です。** 理由は同じです。

Microsoft は本番アプリケーションではクライアントシークレットより証明書を推奨しています。ただしその方式は呼び出し側自身が JWT アサーションを構築して署名する必要があり、ワークフローにはできません。そのためここではクライアントシークレットが現実的な選択です — それに応じた扱いをしてください。シークレット変数に保管し、期限が切れる前にローテーションします。

## ステップ 2 — Dynamics でアプリケーションユーザーを作成する

これは飛ばされがちなステップで、飛ばすとこの連携全体で最も分かりにくい失敗が起きます。トークンの取得は成功するのに、Dataverse の呼び出しがすべて `403 Forbidden` とエラーコード `0x80072560` — *「ユーザーが組織のメンバーではありません」* — で失敗するのです。Entra ID は Dynamics のことを何も知らないままトークンを発行します。そして Dynamics はそのアプリケーションに対応するユーザー行を探しますが、存在しないのです。

1. [Power Platform 管理センター](https://admin.powerplatform.microsoft.com/) を開き、**管理 → 環境** から自分の環境を選びます。
2. **設定 → ユーザーとアクセス許可 → アプリケーション ユーザー** を選びます。
3. **+ 新しいアプリ ユーザー** を選び、**+ アプリの追加** からステップ 1 の登録を選んで **追加** を選びます。
4. **事業部門** を選び、**メール アドレス** を入力してから、**セキュリティ ロール** の横にある編集アイコンを使います。
5. **ケース** テーブルに対する作成・読み取り・書き込みの権限を持つ **カスタム** セキュリティロールを割り当てます。アプリケーションユーザーには組み込みロールを付与できません — Microsoft はカスタムロールを要求します。適したロールがない場合は、既存のものをコピーして絞り込んでください。
6. **保存**、続いて **作成** を選びます。

1 つの環境で、登録済みアプリケーション 1 つにつきアプリケーションユーザーは 1 つだけです。アプリケーションユーザーにはライセンスが不要で、環境のセキュリティグループのメンバーシップ規則も適用されません。

## ステップ 3 — 認証情報を OneUptime に保存する

**ワークフロー → グローバル変数 → 作成** を開いて次を追加します。マークの付いたものは **Secret** をオンにしてください。

| Name                     | Value                                                       | Secret |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | ステップ 1 のディレクトリ (テナント) ID                     | いいえ |
| `DYNAMICS_CLIENT_ID`     | ステップ 1 のアプリケーション (クライアント) ID             | いいえ |
| `DYNAMICS_CLIENT_SECRET` | ステップ 1 のクライアントシークレットの **値**              | はい   |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — 末尾のスラッシュなし   | いいえ |

クライアントシークレットは Entra ID が示したとおり正確に貼り付けてください。フォームのボディは OneUptime がエンコードするので、手作業で URL エンコードしないでください。

ブロックからは `{{global.variables.DYNAMICS_CLIENT_ID}}` のように参照します。シークレットが実行ログからどのように除去されるかは [変数](/docs/workflows/variables) を参照してください。

## ステップ 4 — アクセストークンを取得する

実行のたびに自前のトークンを取得します。トークンの寿命は 60〜90 分で、クライアント資格情報フローはリフレッシュトークンを発行しないため、キャッシュするものも更新するものもありません — 実行ごとの HTTP 呼び出し 1 回がコストのすべてです。

1. **ワークフロー → ワークフローを作成** を開き、`Incidents → Dynamics 365` という名前にして **ビルダー** を開きます。
2. 破線のプレースホルダーをクリックして **On Create Incident** トリガーを追加し、その **Select Fields** で送信したい列を指定します。

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   **Identifier** は `incident-on-create-1` のままにしておきます。

3. **Add Component** をクリックして **API Post (JSON)** ブロックを追加し、トリガーの **Success** ドットを接続してから設定を開きます。**Identifier** を `get-token` に設定して、次のように入力します。

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**ヘッダー名は `Content-Type` と、この大文字小文字のとおりに入力してください。** これが、ボディを JSON ではなくフォームポストとして送るよう OneUptime に指示するものであり、Microsoft のトークンエンドポイントが受け付ける唯一の形です。小文字の `content-type` は一致せず、リクエストは JSON として送信されて `400` が返ります。

`scope` は環境 URL に `/.default` を付けたものでなければなりません — これが機密クライアント向けの形式です。ここで環境 URL を間違えるのが `AADSTS70011: The provided value for the input parameter 'scope' is not valid` のよくある原因です。

トークンは以降のブロックから次のように利用できます。

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## ステップ 5 — ケースを作成する

2 つ目の **API Post (JSON)** ブロックを追加し、`get-token` の **Success** ドットを接続して、**Identifier** を `create-case` に設定します。

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

アカウントの GUID は、これらのケースが属するアカウントのものに置き換えてください。**ケースでは `customerid` が本当に必須です** — プログラムからの書き込みで Dataverse が強制する列の 1 つなので、これを欠いた作成は拒否されます。この列はアカウントとコンタクトのどちらも指せるため、`customerid@odata.bind` とは書きません。`customerid_account@odata.bind` または `customerid_contact@odata.bind` と書き、これらの名前は大文字小文字を区別します。`title` の必須性は種類が違います。Dynamics のフォームは要求しますが API は要求しません — それでも送っておいてください。

`Prefer: return=representation` が、これをワークフローから使えるものにしています。これがないと作成の成功は `204 No Content` を返し、新しいレコードの URI は `OData-EntityId` レスポンスヘッダーに入るため、そこから GUID を取り出す必要が生じます。これがあれば、レスポンスは `201 Created` となりレコード自体を含むので、次のブロックが次を読めます。

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

ここでワークフローを有効にし — **Overview → Edit Workflow → Enabled** — テスト用インシデントを宣言して **Runs & Logs** で実行を確認します。`create-case` ブロックは `201` と、新しい `incidentid` を含むボディを表示するはずです。キャンバス上の変更は自動保存されます。保存ボタンはありません。

### 重大度とステータスのマッピング

Dynamics の `severitycode` は既定で「Default Value」という選択肢が 1 つしかないため、そのままマッピングできる重大度の尺度は存在しません。代わりに **`prioritycode`** を使い、重大度ごとの優先度を設定したい場合は **If / Else** ブロックで `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` を分岐させてください。

| Column           | Values                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` 高、`2` 標準、`3` 低                                                                                                          |
| `caseorigincode` | `1` 電話、`2` メール、`3` Web、`2483` Facebook、`3986` Twitter、`700610000` IoT                                                   |
| `casetypecode`   | `1` 質問、`2` 問題、`3` 要求                                                                                                      |
| `statecode`      | `0` アクティブ、`1` 解決済み、`2` キャンセル                                                                                      |
| `statuscode`     | `1` 進行中、`2` 保留中、`3` 詳細待ち、`4` 調査中、`5` 問題解決済み、`6` キャンセル、`1000` 情報提供済み、`2000` マージ済み        |

`statuscode` はカスタマイズ可能なので、テナントが独自の値を追加している場合があります。ラベルではなく整数を送ってください。

## ステップ 6 — インシデントとケースを互いに見つけられるようにする

後から何をするにせよ — コメント、解決、同期 — 2 つのシステムのどちらか一方が相手の識別子を保持している必要があります。それは Dynamics 側に置きましょう。

ケーステーブルに **単一行テキスト** の列、たとえば `new_oneuptimeincidentid` を追加し、ケース作成時に設定します。

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

これで後続のどのワークフローも、フィルターでケースを見つけられます。

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

その列をケーステーブルの **代替キー** として定義すれば、検索を完全に省いて `incidents(new_oneuptimeincidentid='<id>')` に直接 `PATCH` できます — ケースがなければ作成し、あれば更新する upsert です。代替キーは構築が完了し状態が **アクティブ** になるまで使えません。また代替キーの値には `/ < > * % & : \ ? + #` を含められません。OneUptime の id はただの UUID なので安全です。

逆方向 — Dynamics のケース id を OneUptime のインシデントに保存する — も、`customFields` に書き込む **Update One Incident** ブロックで可能です。ただし注意してください。`customFields` は単一の JSON 列なので、書き込むと自分の分だけでなくそのインシデントのすべてのカスタムフィールドの値が置き換わります。リンクを Dynamics 側に持たせれば、この問題は完全に避けられます。

## ステップ 7 — インシデントが解決したらケースを解決する

これは **2 つ目の** ワークフローとして作ってください。そうすればここでの失敗がケースの作成を止めることはありません。

1. **ワークフローを作成** し、`Incident resolved → Close Dynamics case` という名前にして **On Update Incident** トリガーを追加します。
2. トリガーの **Listen on** に `{"currentIncidentStateId": true}` を設定し、編集のたびではなく状態変更のときだけワークフローが起きるようにします。**Select Fields** には `{"_id": true, "currentIncidentState": {"name": true}}` を指定します。
3. **If / Else** ブロックを追加します。**Input 1** は `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`、**Operator** は `==`、**Input 2** は `Resolved` — またはプロジェクトの解決済み状態の名前です。[インシデントの状態と重大度](/docs/incidents/states-and-severities) を参照してください。
4. **Yes** ブランチから、ステップ 4 の `get-token` ブロックを繰り返します。
5. **API Get (JSON)** ブロックを追加し、**Identifier** を `find-case` にして、ステップ 6 の `$filter` URL を指定します。Dataverse のクエリは `value` 配列で応答し、ワークフローの参照は角かっこで配列に添字を付けられるので、ケース id は `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}` になります。
6. ケースをクローズする **API Post (JSON)** ブロックを追加します。

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: ステップ 5 と同じもの (`Prefer` を除く)。
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` は解決済み状態における `statuscode` の値です — `5` は *問題解決済み* です。

     **これに頼る前に、自分の環境でこのボディを試してください。** `CloseIncident` は `IncidentResolution` と `Status` の 2 つのパラメーターを取りますが、Microsoft は HTTP の例を公開しておらず、公式サンプルはすべて C# です。上記の形は慣例的な翻案です。環境がこれを拒否する場合は、`@odata.bind` 形式の代わりに単純な `"incidentid": "<the case id>"` プロパティでケースを指定してみてください。これは Microsoft の他のアクション例が既存レコードを参照する際の書き方です。

**単にケースを `statecode: 1` に `PATCH` してはいけないのか？** できます。Microsoft は `statecode` と `statuscode` の `PATCH` を、旧来の SetState メッセージに相当する Web API の方法として文書化しており、ケースをアクティブなステータス間で動かすにはこれが適切な手段です。ただしこの方法では、Dynamics 365 Customer Service で解決済みのケースが持つべき **ケースの解決** アクティビティが作成されません。また、管理者がカスタムのステータス遷移を設定している環境では、そのまま拒否されます。解決には `CloseIncident` を、それ以外には `PATCH` を使ってください。そして `statecode` を書き込むときは常に、同じリクエストで `statuscode` も設定してください。そうしないと Dynamics はその状態の既定のステータスを黙って適用します。

`CloseIncident` は基本の Dataverse ではなく Dynamics 365 Customer Service に由来するもので、Dataverse のアクションリファレンスには載っていません。`404` が返る場合は、`{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` を取得して `CloseIncident` を検索し、自分の環境に存在するか確認してください。

ケースのクローズに満たない操作 — メモ、優先度の引き上げ、タイトルの変更 — には、`{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` に対する **API Patch (JSON)** ブロックを `If-Match: *` ヘッダー付きで使います。このヘッダーは、意図しない upsert が新しいケースを作ってしまうのを防ぎます。変更する列だけを送ってください。

## インバウンド — Dynamics 365 から OneUptime へ

次は逆方向です。誰かが Dynamics でケースをクローズしたり、担当者がメモを追加したりしたときに、OneUptime がそれを知るべきです。

### 先に受信側のワークフローを作る

1. **ワークフローを作成** し、`Dynamics 365 → OneUptime` という名前にして **Webhook** トリガーを追加します。
2. そのワークフローの **Settings** を開いて **Webhook Secret Key** をコピーします。URL は次の形です。

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   セルフホストのインストールでは自分のホストに置き換えます。この URL はパスワードと同じように扱ってください — 持っている人は誰でもワークフローを起動できます。キーは同じページからリセットできます。

3. 他の処理が始まる前に共有シークレットを確認する **If / Else** ブロックを追加します。**Input 1** は `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`、**Operator** は `==`、**Input 2** は `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — 自分で決めてシークレットのグローバル変数として保存した値です。
4. **Yes** ブランチから **Update One Incident** ブロックを追加します。

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: そのケース変更が OneUptime で意味すべきこと — 状態の変更、メモ、ラベルなど。

   インシデントを別の状態に移すにはその状態の id が必要です。クエリ `{"name": "Resolved"}` を指定した **Find One Incident State** ブロックが `{{local.components.incident-state-find-one-1.returnValues.model._id}}` を返すので、それを `currentIncidentStateId` に書き込みます。

これを有効にしたまま準備しておきます。次に、Dynamics に呼び出す相手を用意します。

### オプション A — Power Automate フロー (推奨)

ほとんどのチームが選ぶべき経路です。ペイロードを自分で制御でき、インストールするものもありません。

1. [Power Automate](https://make.powerautomate.com) で **自動化されたクラウド フロー** を作成します。
2. トリガー: **Microsoft Dataverse → 行が追加、変更、または削除されたとき**。

   - **変更の種類**: `Modified`
   - **テーブル名**: `Cases`
   - **スコープ**: `Organization` — これより狭いスコープでは、自分または自分の事業部門が所有する行でしか発火しません。
   - **列の選択**: `statecode,statuscode`。これは更新時にのみ効くフィルターで、正しく設定する価値があります。ここでは参照列は使えません。また、主キーのようにすべての更新に含まれる列を挙げてはいけません。挙げると保存のたびにフローが発火します。

3. **Microsoft Dataverse → ID による行の取得** を追加し、テーブルは `Cases`、行 id はトリガーから、**列の選択** は `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid` とします。

   この 2 回目の呼び出しはコストに見合います。更新時のトリガーは変更された列しか運ばないため、照合に必要な識別子がそもそも含まれていないことがあるからです。

4. 組み込みの **HTTP** アクションを追加します。

   - **メソッド**: `POST`
   - **URI**: 上で取得した OneUptime の Webhook URL
   - **ヘッダー**: `Content-Type: application/json` と `X-OneUptime-Secret: <the same secret>`
   - **本文**: *ID による行の取得* の出力から組み立てます。例:

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. 保存してフローを有効にします。

この経路を選ぶ前に知っておくべきこと。

- **Microsoft Dataverse コネクタはプレミアムです。** 自動化フローの場合、ライセンスが必要なのはフローの所有者だけで、ケースに関わる全員ではありません — ただし所有者のライセンスが失効すると、フローは黙って止まります。
- Dataverse のトリガーは **ポーリングではなくプッシュ** です。Dynamics がコールバックを登録して発火させます。配信は通常数秒以内で、5 分を超える場合は非同期サービスが滞留しています。管理センターの **設定 → システム ジョブ** で確認できます。
- カスタムヘッダーは通ります。Power Automate は HTTP アクションからいくつかの標準ヘッダー群 (ほとんどの `Accept-*` と `Content-*` ヘッダー、`Host`、`Origin`、`Cookie`) を取り除きますが、`X-OneUptime-Secret` のような独自ヘッダーはそのまま渡されます。
- フローは、監視対象のテーブルと同じ環境に存在しなければなりません。
- リクエストはテナントの Power Platform リクエスト割り当てに計上され、コネクタのスロットリングはフロー実行内で `429` として現れます。

### オプション B — ネイティブの Dataverse Webhook

Power Automate が使えない場合、Dataverse から OneUptime を直接呼び出せます。[プラグイン登録ツール](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook) でエンドポイントを登録します。**Register New WebHook** で OneUptime の URL を指定し、認証に **HttpHeader** を選んで `X-OneUptime-Secret` とシークレットを追加します。次に **incident** テーブルの **Update** メッセージに対してステップを登録し、**Filtering Attributes** を必要な列だけに限定して、ステージは **PostOperation**、実行モードは **Asynchronous** にします。

この経路を選ぶなら、次を承知の上で。

- **ポートは 80 と 443 のみ。** 他のポートで動くセルフホストの OneUptime は登録できません。
- **Dataverse はシークレットを検証しません。** ヘッダーを送るだけで、それを持たないリクエストを拒否するのは完全にあなたのワークフローの仕事です — 受信側ワークフローの **If / Else** ブロックはそのためにあります。
- **ペイロードは扱いやすい JSON オブジェクトではありません。** シリアライズされた `RemoteExecutionContext` で、`InputParameters` は `{key, value}` ペアの *配列* であり、変更された行は `Target` というキーの下に、その列がさらに `Attributes` 配列に入っています。他の処理が読める形にするため、**Run Custom JavaScript** ブロックで平坦化することになると考えてください。
- 更新では **変更された列しか含まれない** ため、`ticketnumber` や OneUptime の id 列が必要なら **Post Image** を登録してください。
- **256 KB を超えると重要な部分が取り除かれます** — `InputParameters`、`PreEntityImages`、`PostEntityImages` がすべて失われ、リクエストには `x-ms-dynamics-msg-size-exceeded` ヘッダーが付きます。`PrimaryEntityId` と `PrimaryEntityName` は残るので、代替手段は Web API で行を読み直すことです。
- **配信はほとんど容赦がありません。** Dataverse は `2xx` を 60 秒待ち、再試行はちょうど 1 回、しかも `502`、`503`、`504` のときだけです。それ以外 — あなた側の `500` を含めて — は再試行されず、失敗したシステムジョブとして残ります。
- **Asynchronous** を選んでください。同期ステップは担当者の保存操作をあなたのエンドポイントで待たせますし、その後にトランザクションがロールバックしても、リクエストはすでに送信済みで取り消せません。

従来の Dynamics のバックグラウンドワークフローには HTTP や Webhook のステップがまったくないため、ここでの第 3 の選択肢にはなりません。

## アラートでも同じことをする

上記はすべて、よくあるケースであるインシデントを軸に書かれていますが、アラートでもまったく同じように動きます — レコードの種類を入れ替えるだけで、他は何も変わりません。

| インシデント                                                 | アラート                                            |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`、`currentIncidentState`、`incidentSeverity`  | `alertNumber`、`currentAlertState`、`alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

ワークフローが持てるトリガーはちょうど 1 つなので、インシデント用とアラート用にワークフローが 1 つずつ必要です。両者が同じ処理をするなら、Dynamics 側を一度だけ作り、**Execute Workflow** コンポーネントで両方から呼び出してください。

## トラブルシューティング

まず **Runs & Logs** で失敗したブロックを読んでください — Microsoft のどちらのエンドポイントも説明的な JSON ボディを返し、API コンポーネントはそれを `response-body` に保持します。

**トークンのリクエストが `400` と `invalid_request` またはサポートされない grant type で失敗する。** `Content-Type` ヘッダーが厳密に `Content-Type: application/x-www-form-urlencoded` になっておらず、ボディが JSON として送信されています。大文字小文字を確認してください。

**`400` と `AADSTS70011: The provided value for the input parameter 'scope' is not valid`。** `scope` が環境 URL + `/.default` になっていません。**開発者リソース** から URL をコピーし、末尾のスラッシュと `/api/data/...` のパスを取り除いてください。

**Dynamics からの `401 Unauthorized`。** `Authorization` ヘッダーがないか、形式が誤っているか、実行の途中でトークンが期限切れになりました。ヘッダーはスペース 1 つを挟んだ `Bearer <token>` でなければなりません。

**`403 Forbidden` と `0x80072560`「ユーザーが組織のメンバーではありません」。** ステップ 2 が飛ばされたか、アプリケーションユーザーが別のアプリ登録に紐付いています。トークンは正常で、Dynamics 側のユーザーが存在しないのです。

**特権に関するエラーを伴う `403 Forbidden`。** アプリケーションユーザーは存在しますが、そのカスタムセキュリティロールに **ケース** の作成・読み取り・書き込み権限がありません。

**顧客に言及する `400 Bad Request`。** `customerid` が必須です。`customerid_account@odata.bind` または `customerid_contact@odata.bind` を正確に綴り、`/accounts(<guid>)` のように先頭スラッシュ付きの URI を設定してください。

**`/CloseIncident` での `404 Not Found`。** このアクションは Dynamics 365 Customer Service のアクションです。利用可能だと決めつける前に、環境の `$metadata` を検索して確認してください。

**`DuplicateRecord` を伴う `412 Precondition Failed`。** 重複検出ルールに一致しました。ルールを絞り込むか、一致対象のフィールドを送るのをやめてください。

**`429 Too Many Requests`。** Dataverse のサービス保護制限です — おおよそ 5 分間のウィンドウごとに、Web サーバー単位・ユーザー単位で 6,000 リクエストおよび 20 分の実行時間です。レスポンスには秒単位の `Retry-After` が含まれます。ワークフローがバーストしている場合は **Delay** ブロックを入れるか、まとめて処理するスケジュール実行のワークフローに移してください。

**OneUptime 側に何も届かない。** 自分で `curl` を使って Webhook URL にリクエストを送り、ワークフローの **Runs & Logs** を確認してください。自分のリクエストは現れるのに Dynamics のものが現れないなら、問題は上流にあります。Power Automate ならフロー自身の実行履歴を、ネイティブ Webhook なら **設定 → システム ジョブ** を失敗で絞り込んで見てください。

**ワークフローは実行されるのにインシデントが変わらない。** **Update One Incident** ブロックは、クエリが何にも一致しなかったとき `Items Updated: 0` と報告します — それはエラーではなく成功です。ペイロードの id が OneUptime のインシデント id であるか、そして `_id` で問い合わせているかを確認してください。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — インバウンドとアウトバウンドのパターン、そして認証クイックリファレンス。
- [Jira](/docs/integrations/jira) — Jira に対する同じ双方向の構築。
- [ワークフロー 概要](/docs/workflows/index) と [ワークフローの作成](/docs/workflows/authoring) — キャンバス、識別子、ワークフローの有効化。
- [コンポーネント](/docs/workflows/components) — API ブロック、If / Else、OneUptime データコンポーネント。
- [変数](/docs/workflows/variables) — シークレットと、あるブロックの出力を次のブロックから読む方法。
- [設定と安全性](/docs/workflows/configuration) — Webhook のセキュリティと外向きのネットワークアクセス。
- [IP アドレス](/docs/configuration/ip-addresses) — Dynamics が許可リストの背後にある場合の、OneUptime の送信元レンジ。
