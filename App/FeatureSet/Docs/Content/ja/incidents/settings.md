# インシデントの設定と自動化

インシデントの設定は Project Settings には存在しません。インシデント機能自体の内側、**Incidents → Settings** と **Incidents → Rules** の下、`/dashboard/{projectId}/incidents/settings/` で始まるルートにあります。インシデントテンプレートやカスタムフィールドを探して **Project Settings** をあちこち探し回っていたなら、見つからなかった理由はこれです。

インシデントのサイドメニューにある **Rules** と **Settings** のどちらのセクションも既定で折りたたまれているため、以下の項目を表示するには先に展開する必要があります。ここに出てくるものはすべてプロジェクトスコープです — テンプレート、ロール、カスタムフィールド、ルールは 1 つのプロジェクトに属し、そのプロジェクトで宣言されたすべてのインシデントに適用されます。

このページは、その設定のリファレンスです — 各ページに何があるか、そしてそのうちどれがインシデント作成の瞬間に自動で実行されるかを扱います。

## インシデント設定がある場所

左ナビゲーションで **Incidents** を開き、サイドメニュー下部の **Settings** を展開します。

| ページ                       | そこで行うこと                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Incident State**            | インシデントが経ていく状態を追加、名前変更、色変更、並べ替えします。                                 |
| **Incident Severity**         | 重大度レベルを追加、名前変更、色変更、並べ替えします。                                               |
| **Incident Templates**        | インシデント全体を事前入力します — タイトル、説明、リソース、オンコールポリシー、所有者、ラベル。   |
| **Note Templates**            | パブリックノートとプライベートノート向けの再利用可能なテキスト。                                     |
| **Postmortem Templates**      | 再利用可能なポストモーテムの構成。                                                                   |
| **Custom Fields**             | すべてのインシデントに表示される追加フィールドを定義します。                                         |
| **Incident Roles**            | Incident Commander のような、対応者に割り当てるロールを定義します。                                  |
| **More Settings**             | インシデントとインシデントエピソードの番号プレフィックス。                                           |

**Incident State** と **Incident Severity** は [インシデントの状態と重大度](/docs/incidents/states-and-severities) で詳しく扱われています — このページの残りは **Incident Templates** から続きます。

**Rules** を展開すると、さらに 8 つのページがあります — **Grouping Rules**、**On-Call Rules**、**Owner Rules**、**Runbook Rules**、**Privacy Rules**、**Label Rules**、**SLA Rules**、**Reminder Rules**。これらは以降で扱います。

## インシデントテンプレート

インシデントテンプレートは、保存されたインシデントの雛形です。決済クラスターがぐらつくたびに同じタイトル、同じモニター一覧、同じオンコールポリシーを打ち直す代わりに、一度保存してそこから宣言します。

**Incidents → Settings → Incident Templates**(`/dashboard/{projectId}/incidents/settings/templates`)を開きます。カードのタイトルは **Incident Templates** です。作成すると 6 ステップのウィザードに進みます。

- **Template Info** — **Template Name** と **Template Description**。これらはテンプレート自体の名前であり、インシデントには一切表示されません。
- **Incident Details** — **Title**、**Description**(Markdown)、**Incident Severity**、**Initial Incident State**。**Initial Incident State** は任意で、既定は空です。選択肢は状態の順序どおりに並びます。空のままにすると、このテンプレートから作られるインシデントはプロジェクトの作成状態から始まります。
- **Resources Affected** — インシデントに紐付けるモニター、ホスト、クラスター、サービス、加えて **Change Monitor Status to**。
- **On-Call** — **On-Call Policy**。このテンプレートから作られたインシデントが宣言されたときに実行するポリシーです。
- **Owners** — **Owner - Teams** と **Owner - Users**。
- **Labels** — **Labels**。

いくつか押さえておくべき決まりがあります。

- テンプレート一覧には **Name** と **Description** だけが表示されます。行は一覧から編集も削除もできません — 変更するにはテンプレートを開いてください(`/dashboard/{projectId}/incidents/settings/templates/{modelId}`)。
- テンプレートは JSON インポートとエクスポートに対応しているため、プロジェクト間で移動できます。
- 空の状態には「No incident templates found.」と表示されます。

### テンプレートが適用される仕組み

経路は 2 つあり、どちらも同じように振る舞います。

- **ダッシュボードから** — インシデント一覧の **Create from Template** ボタンで **Select Incident Template** ピッカーが開き、宣言ページはクエリ文字列パラメーター `incidentTemplateId` からテンプレートを読み込み、テンプレートとその所有者チーム、所有者ユーザーでフォームを事前入力します。
- **API から** — `POST /api/incident` に `createdIncidentTemplateId` を渡すと、サーバーがテンプレートからインシデントを埋めます。

重要なのはマージのルールです — **テンプレートは、あなたが未指定のままにしたフィールドだけを埋めます。** タイトル、説明、インシデントの重大度、初期のインシデント状態、**Change Monitor Status to** の背後にあるモニターステータス、モニター、ホスト、Kubernetes クラスター、Docker ホスト、Podman ホスト、サービス、オンコールポリシー、ラベルは、呼び出し側やフォームが何も渡さなかった場合にのみテンプレートからコピーされます。明示的に設定したものは常にそちらが優先されます。

**空の状態のダイアログは間違った場所を指しています。** まだテンプレートがない場合、**Create from Template** ボタンは **No Incident Templates** ダイアログを表示します。そのテキストは Project Settings を指していますが、ボタン自体は **Incidents → Settings → Incident Templates** に遷移します — そこが本当の場所です。

## ノートテンプレート

ノートテンプレートは、対応者にインシデント更新用の定型文を与えるものです。午前 3 時のステータスページ更新が、寝ぼけた誰かによってゼロから書かれずに済みます。

**Incidents → Settings → Note Templates**(`/dashboard/{projectId}/incidents/settings/note-templates`)を開きます。カードのタイトルは **Public or Private Note Templates for Incidents** です — 1 つのライブラリが両方のノートタイプに使われます。作成フォームには 2 つのステップがあります。

- **Template Info** — **Template Name** と **Template Description**、どちらも必須です。
- **Note Details** — ノート本体そのもの。Markdown で、必須です。

インシデントテンプレートと同様、行は作成・閲覧はできますがインライン編集はできません。変更するにはテンプレートを開いてください。

ノートテンプレートは、実際に必要な場所に現れます — **Acknowledge Incident** と **Resolve Incident** の確認ダイアログはどちらも、**Public Note** フィールドの隣に **Select Note Template** を提供します。パブリックノートとプライベートノートの違いについては [インシデントのメモ、オーナー、フィード](/docs/incidents/notes-owners-and-feed) を参照してください。

## ポストモーテムテンプレート

ポストモーテムテンプレートは、インシデントの後に作成する書き起こしの骨格です — 見出し、問いかけ、常設の質問 — これによってプロジェクト内のすべてのレビューが同じ形になります。

**Incidents → Settings → Postmortem Templates**(`/dashboard/{projectId}/incidents/settings/postmortem-templates`)を開きます。カードのタイトルは **Postmortem Templates** です。作成フォームには 2 つのステップがあります。

- **Template Info** — **Template Name** と **Template Description**、どちらも必須です。
- **Postmortem Details** — **Postmortem Template**、本体そのもの。Markdown で、必須です。

これを適用するのは設定からではなく、インシデントからです。インシデントを開き、サイドメニューで **Postmortem** を選び(`/dashboard/{projectId}/incidents/{incidentId}/postmortem`)、**Apply Template** を使います。すると **Select Template** ドロップダウンを持つ **Apply Postmortem Template** ダイアログが開き、1 つを選ぶとテンプレート本文が **Postmortem Note** エディターに読み込まれ、保存前に編集できます。インシデントエピソードにも同じ **Postmortem** ページがあり、同じテンプレートライブラリを使います。

## カスタムフィールド

カスタムフィールドを使うと、すべてのインシデントに独自のメタデータを持たせられます — 社内のサービス名、変更チケットの参照番号、顧客のティアなどです。

**Incidents → Settings → Custom Fields**(`/dashboard/{projectId}/incidents/settings/custom-fields`)を開きます。このページのタイトルは **Incident Custom Fields** です。各定義は次を持ちます。

- **Field Name** — 必須、2 文字以上。プレースホルダーは `internal-service` のようなスラッグ風の名前を提案します。
- **Field Description** — 任意です。
- **Field Type** — 必須です。これがデータの入力方法を決めます。ドロップダウンタイプはさらに選択肢の一覧も必要です。
- **Dropdown Options** — ドロップダウンに表示される値。それぞれ任意の色を持てます。

定義は独自のモデルに存在し、値はインシデント自体の `customFields` カラムに存在します。個々のインシデントでは、インシデントのサイドメニューの **Custom Fields**(`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`)で値を入力します。

**知っておくべきギャップが 1 つあります。** インシデントのカスタムフィールド定義は、インシデントファミリーの中で唯一ワークフロートリガーを持たない部分です — 下のワークフローの節を参照してください。

## インシデントの役割

インシデントの役割は、対応中に人に割り当てる、名前の付いた役目です。**Incidents → Settings → Incident Roles**(`/dashboard/{projectId}/incidents/settings/roles`)で定義します。カードの説明では Incident Commander と Responder が例として挙げられています。

ロールは定義だけです。人をロールに割り当てるのはインシデントごとです — 宣言ウィザードには **Assign Incident Roles** フィールドを持つ **Incident Roles** ステップがあり、各インシデントはサイドメニューに **Roles** ページを持ちます。

## 番号プレフィックス

すべてのインシデントには番号が付きます。既定では `#42` のように表示されます。チームが口頭で「INC-42」と言っているなら、製品にもそう言わせましょう。

**Incidents → Settings → More Settings**(`/dashboard/{projectId}/incidents/settings/more`)を開きます。カードは **Number Prefix** で、プロジェクトに対して 2 つのフィールドを持ちます。

- **Incident Number Prefix** — 最大 20 文字、プレースホルダーは `INC-`。設定すると、インシデント `#42` は `INC-42` と表示されます。
- **Incident Episode Number Prefix** — インシデントエピソード番号に対する同じ考え方で、プレースホルダーは `IE-`。

どちらかを空のままにすると既定の `#` プレフィックスが使われます。未設定のフィールドは `# (default)` と表示されます。**Update** で保存します。プレフィックス付きの値はインシデントに `incidentNumberWithPrefix` として保存され、これがインシデント一覧とインシデントヘッダーが表示する値です。

## インシデント作成時に実行されるルール

**Incidents → Rules** には 8 つのルールエンジンがあります。どれも同じ仕事をします — インシデントが作成された瞬間にそれを見て、一致すれば動作する — ただし、何をするか、そして複数の一致ルールがどう解決されるかが異なります。

- **Grouping Rules** — 関連するインシデントをエピソードにグループ化します。ルールは優先度順に評価され、優先度番号が小さいものが先に評価されます。
- **On-Call Rules** — 一致したインシデントに対してオンコール当番ポリシーを実行します。詳細は後述します。
- **Owner Rules** — 所有者を自動で割り当てます。
- **Runbook Rules** — インシデントが一致したときに [Runbook](/docs/runbooks/index) を開始します。
- **Privacy Rules** — 一致したインシデントをプライベートにするかどうかを決めます。
- **Label Rules** — ラベルを自動で適用します。
- **SLA Rules** — 応答時間と解決時間を追跡します。ルールは順番に評価され、順序番号が小さいものが先に評価されます。
- **Reminder Rules** — インシデントがまだ開いている間、インシデントの所有者に定期的にリマインドします。ルールは順番に評価され、最初に一致したルールが勝ちます。

**順序の意味はすべて同じではありません。** Grouping Rules、SLA Rules、Reminder Rules は順序評価です。On-Call Rules はそうではありません — 一致するすべてのルールが発火します。8 つすべてに 1 つのモデルが当てはまると思い込まないでください。

**On-Call Rules**、**Owner Rules**、**Label Rules**、**Privacy Rules** の各ページはタブ分けされています — **Incident Rules** タブと **Episode Rules** タブがあり、それぞれ独自のテーブルを持ちます。特にエピソードを意図していない限り、**Incident Rules** タブを設定してください。**Grouping Rules**、**Runbook Rules**、**SLA Rules**、**Reminder Rules** は単一のテーブルです。

## インシデントのオンコールルール

**Incidents → Rules → On-Call Rules**(`/dashboard/{projectId}/incidents/settings/on-call-rules`)は、ページングを自動化する場所です。カードのタイトルは **Incident On-Call Rules** で、一致するインシデントが作成されたときにオンコール当番ポリシーを自動で実行するルールと説明されています。ページには **Incident Rules** と **Episode Rules** の 2 つのタブがあります。

作成フォームには 3 つのステップがあります。

- **Basic Info** — **Name**(プレースホルダーは、あらゆる DB インシデントに対してデータベースチームをページングするといった例を提案します)、**Description**、そして **Enabled** トグル。一覧には各ルールについて緑の **Enabled** または赤の **Disabled** ピルが表示されます。
- **Match Criteria** — **Monitors**、**Incident Severities**、**Incident Labels**、**Monitor Labels**、さらにインシデントのタイトル、インシデントの説明、モニター名、モニターの説明に対する大文字小文字を区別しない正規表現フィールド。
- **On-Call Policies** — このルールが実行するポリシー。

### 一致の解決の仕方

このページ自体が最初から備えているルールは、頭に入れておく価値があります。

- ルールが一致するのは、入力した**すべての**条件が通ったときだけです。空のままにした条件はスキップされ、失敗にはなりません。
- 単一のリスト条件の中では — **Monitors**、**Incident Severities**、**Incident Labels**、**Monitor Labels** — いずれか 1 つに一致すれば OK です。
- パターンフィールドは大文字小文字を区別しない正規表現です。
- **一致するすべてのルールが発火します。** 優先度もショートサーキットもありません。
- 実際に実行されるポリシーの集合は、一致したすべてのルールのポリシーと、手作業またはテンプレートでインシデントに直接紐付けられたポリシーとの和集合で、各ポリシーが最大 1 回だけ実行されるよう重複排除されます。

重大度が一致条件になるのはここだけです。インシデントの重大度自体にはオンコールフィールドはありません — 「Critical Incident」を選んだだけでは、それ自体は誰もページングしません。重大度でページングを駆動したいなら、それに一致するオンコールルールを書いてください。

## オンコールポリシーを直接紐付ける

ルールだけが唯一の経路ではありません。すべてのインシデントは独自のオンコールポリシー一覧を持っており、宣言ウィザードの **On-Call** ステップと、インシデントテンプレートの **On-Call** ステップの **On-Call Policy** フィールドとして現れます。フィールドの説明はそのままです — このインシデントが作成されたときに実行するオンコール当番ポリシーです。

インシデントが作成されると、OneUptime はラベルルール、次にオンコールルール(一致したポリシーをインシデントの一覧にマージします)、その次に Runbook ルールを実行します — 結果として得られる一覧が空でなければ、その中のすべてのポリシーが実行されます。実行は並列で行われ、それぞれ独立して結果が確定するため、1 つのポリシーが失敗しても他は止まりません。各実行には、それを引き起こしたインシデントと、インシデント作成の通知イベントタイプがタグ付けされます。

何が起きたかを確認するには、インシデントを開いてサイドメニューで **On-Call Executions**(`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`)を選びます。

## ワークフローからインシデントを動かす

インシデント向けのワークフロートリガーは手書きではありません — OneUptime がデータモデルから生成しているため、インシデントファミリーのすべてのモデルが、モデルの単数形の名前から命名された **On Create X**、**On Update X**、**On Delete X** コンポーネントを持ちます。中心となる 3 つは **On Create Incident**、**On Update Incident**、**On Delete Incident** で、`/dashboard/{projectId}/workflows` のワークフローコンポーネントパレットの **Incident** カテゴリーにあります。

同じ生成の仕組みは、設定自体に対するトリガーも与えます — **On Create Incident State**、**On Update Incident Severity**、**On Create Incident Template**、**On Create Incident Note Template**、**On Create Incident State Timeline**、**On Create Incident Public Note**、**On Create Incident Internal Note**、**On Create Incident On-Call Rule**、**On Create Incident Role**、**On Create Incident Member** など。各モデルは対応するアクションコンポーネントも持ちます — **Find One Incident**、**Create One Incident**、**Update One Incident**、**Delete One Incident**、そしてそれぞれの複数行版 — そのため、名前の似たトリガーとアクションが同じカテゴリーに並んでいます。**On Create Incident** はワークフローを開始し、**Create One Incident** はワークフローを開くものです。

これらを組み合わせる際に重要な点がいくつかあります。

- **On Update X** は任意の **Listen on** 引数を取り、トリガーを特定のフィールドの更新に絞り込みます。空のままにすると、あらゆる変更で発火します。どのフィールドが動いたかの記録なしに更新が届いた場合、フィルターはスキップされ、ワークフローはそのまま実行されます。
- **On Create X** と **On Update X** はどちらも必須の **Select Fields** 引数を取ります。**On Delete X** は引数を取りません。
- 3 つとも単一の **Success** アウトポートを公開し、それぞれ ID 引数を受け取るため、1 つのレコードに対して手動でワークフローを実行できます。
- 名前はモデルのテーブル名ではなく単数形の名前に由来します — そのため、テーブルの形をした名前ではなく **On Create Incident Team Owner** や **On Create Incident User Owner** が表示されるのはそのためです。
- インシデントのカスタムフィールド定義に対するトリガーはありません。このモデルは、インシデントファミリーの中でワークフローが無効化されている唯一のメンバーです。

ワークフローの残りの部分を組み立てる方法については、[ワークフローを作成する](/docs/workflows/authoring) と [変数](/docs/workflows/variables) を参照してください。

## 次に読むべきページ

- [インシデント 概要](/docs/incidents/index) — インシデント機能がどう組み合わさっているか。
- [インシデントの宣言](/docs/incidents/declaring-incidents) — 宣言ウィザード、テンプレート、API。
- [インシデントの状態と重大度](/docs/incidents/states-and-severities) — 状態と重大度の設定ページ、各フラグの働き。
- [インシデントのメモ、オーナー、フィード](/docs/incidents/notes-owners-and-feed) — ノートテンプレートが使われる場所。
- [購読者とお知らせ](/docs/status-pages/subscribers) — チームの外でインシデントについて誰が聞くか。
- [ワークフロー 概要](/docs/workflows/index) — インシデントトリガーの上に自動化を組み立てる。
- [Runbook 概要](/docs/runbooks/index) — Runbook ルールが紐付ける手順。
