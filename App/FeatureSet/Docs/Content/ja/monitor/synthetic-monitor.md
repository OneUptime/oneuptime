# 合成モニター

合成モニタリングは、ユーザーのインタラクションをシミュレートすることでアプリケーションをプロアクティブに監視する方法です。合成モニターを作成して、世界中のさまざまな場所からアプリケーションの可用性とパフォーマンスを確認できます。

#### 使用例

以下の例は、合成モニターの使用方法を示しています。

```javascript

// スクリプトのコンテキストで利用可能なオブジェクト：

// - axios: HTTPリクエストを作成するためのAxiosモジュール
// - page: ブラウザと対話するためのPlaywright Pageオブジェクト
// - browserType: 現在の実行コンテキストのブラウザタイプ - Chromium、Firefox、Webkit
// - screenSizeType: 現在の実行コンテキストの画面サイズタイプ - Mobile、Tablet、Desktop

// これらのオブジェクトを使用してブラウザと対話し、HTTPリクエストを実行できます。

await page.goto('https://playwright.dev/');

// Playwrightのドキュメントはこちら: https://playwright.dev/docs/intro

// 監視対象オブジェクトのコンテキストで使用できる変数の例：

console.log(browserType) // 現在の実行コンテキストのブラウザタイプ - Chromium、Firefox、Webkit

console.log(screenSizeType) // 現在の実行コンテキストの画面サイズタイプ - Mobile、Tablet、Desktop

// pageオブジェクトは特定のブラウザコンテキストに属しているため、ブラウザと対話するために使用できます。

// スクリーンショットを撮るには、スクリプトのコンテキストで提供されている`screenshots`オブジェクトに割り当てます。
// この方法でキャプチャされたスクリーンショットは、スクリプトが後で例外をスローした場合でも保持されます。失敗したテストのデバッグに役立ちます。

screenshots['screenshot-name'] = await page.screenshot(); // 複数のスクリーンショットを異なる名前で保存できます。

// 値を返したい場合は、dataプロパティを持つreturnステートメントを使用します。

// データをログに記録するには、console.logを使用します
// console.log('Hello World');

// 必要に応じてpage.context()でブラウザコンテキストにアクセスできます（新しいページの作成やポップアップの処理など）。


return {
    data: 'Hello World'
};
```

### Playwrightの使用

Playwrightを使用してユーザーのインタラクションをシミュレートします。Playwright の `page` オブジェクトを使用してブラウザと対話し、ボタンのクリック、フォームの入力、スクリーンショットの取得などのアクションを実行できます。

### スクリーンショット

事前に宣言された `screenshots` オブジェクトがスクリプトのコンテキストで利用できます。スクリプトの任意の時点でそれにスクリーンショットを割り当てます。これらのスクリーンショットはスクリプトが例外をスロー（アサーション失敗、タイムアウト、予期しないエラーを含む）した場合でもキャプチャされるため、実行が失敗したときのページの状態を正確に確認できます。キャプチャされたスクリーンショットは、その特定のモニター実行のOneUptime ダッシュボードに表示されます。

```javascript

// `screenshots`サイドチャネルを介してスクリーンショットをキャプチャします。成功と失敗の両方で保持されます。

await page.goto('https://app.example.com/login');
screenshots['login-page'] = await page.screenshot();

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'wrong');
await page.click('button[type=submit]');

// 次のアサーションが例外をスローした場合でも、上の`login-page`スクリーンショットはキャプチャされます。
await page.waitForSelector('.dashboard', { timeout: 5000 });

screenshots['dashboard'] = await page.screenshot();

return {
    data: 'Login succeeded'
};

```

#### スクリーンショットを返す（レガシー）

下位互換性のために、戻り値の一部としてスクリプトからスクリーンショットを返すこともできます。この方法でのスクリーンショットはスクリプトが正常に完了した場合にのみキャプチャされ、スクリプトが例外をスローした場合は失われます。失敗の証拠が必要な場合は、上記のサイドチャネルパターンを優先してください。

```javascript
// レガシーパターン — スクリーンショットは正常なreturn時のみキャプチャされます。
const screenshots = {};
screenshots['screenshot-name'] = await page.screenshot();

return {
    data: 'Hello World',
    screenshots: screenshots
};
```


### モニターシークレットの使用

#### シークレットの追加

シークレットを追加するには、OneUptime Dashboard -> プロジェクト設定 -> モニターシークレット -> モニターシークレットの作成 に移動してください。

![シークレットの作成](/docs/static/images/CreateMonitorSecret.png)

どのモニターがシークレットにアクセスできるかを選択できます。この例では `ApiKey` シークレットを追加し、アクセスを許可するモニターを選択しました。

**ご注意**: シークレットは暗号化され、安全に保存されます。シークレットを紛失した場合は、新しいシークレットを作成する必要があります。保存後はシークレットを表示または更新することはできません。

#### シークレットの使用方法

スクリプト内でモニターシークレットを使用するには、スクリプトのコンテキスト内で `monitorSecrets` オブジェクトを使用します。このオブジェクトを使用して、モニターに追加したシークレットにアクセスできます。

```javascript
// シークレットが文字列型の場合は、引用符で囲む必要があります
let stringSecret = '{{monitorSecrets.StringSecret}}';

// シークレットが数値型またはブール型の場合は、直接使用できます
let numberSecret = {{monitorSecrets.NumberSecret}};

// シークレットがブール型の場合は、直接使用できます
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// console.logを使用してシークレットが正しく取得されているか確認できます
console.log(stringSecret); 
```

### カスタムメトリクス

`oneuptime.captureMetric()` 関数を使用して、スクリプトからカスタムメトリクスをキャプチャできます。これらのメトリクスはOneUptimeに保存され、メトリクスエクスプローラーを使用してダッシュボードのチャートに表示できます。

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name`（文字列、必須）：メトリクス名（例：`"dashboard.load.time"`）。自動的に `custom.monitor.` プレフィックスが付加されます。
- `value`（数値、必須）：数値メトリクス値。
- `attributes`（オブジェクト、任意）：追加コンテキスト用のキーと値のペア。

#### 使用例

```javascript
await page.goto('https://app.example.com');

const startTime = Date.now();
await page.waitForSelector('#dashboard-loaded');
const loadTime = Date.now() - startTime;

// ページ読み込み時間をカスタムメトリクスとしてキャプチャ
oneuptime.captureMetric('dashboard.load.time', loadTime, {
    page: 'dashboard'
});

screenshots['dashboard'] = await page.screenshot();

return {
    data: { loadTime }
};
```

キャプチャされたメトリクスは、`custom.monitor.dashboard.load.time` のような名前でメトリクスエクスプローラーに表示されます。ダッシュボードのチャートに追加したり、アラートを設定したり、モニター、プローブ、ブラウザタイプ、画面サイズ、または指定したカスタム属性でフィルタリングしたりできます。

**制限事項：**
- スクリプト実行ごとに最大100個のメトリクス。
- メトリクス名は200文字以内。
- 値は数値である必要があります。

### スクリプトで利用可能なモジュール
- `page`：ブラウザと対話するためのモジュール。ボタンのクリック、フォームの入力、スクリーンショットの取得などのアクションを実行できるPlaywright Pageオブジェクト。必要に応じて `page.context()` でブラウザコンテキストにアクセスできます（新しいページの作成やポップアップの処理など）。
- `screenshots`：スクリーンショットを割り当てる事前宣言済みオブジェクト（例：`screenshots['login-page'] = await page.screenshot()`）。ここに割り当てられたスクリーンショットはスクリプトが後で例外をスローした場合でもキャプチャされます。
- `axios`：HTTPリクエストを実行するためのモジュール。ブラウザおよびNode.js向けのPromiseベースのHTTPクライアントです。
- `crypto`：暗号化処理を実行するためのモジュール。OpenSSLのハッシュ、HMAC、暗号化、復号化、署名、検証関数のラッパーセットを提供するNode.js組み込みモジュールです。
- `console.log`：コンソールにデータを記録するためのモジュール。デバッグ目的で使用します。
- `oneuptime.captureMetric`：スクリプトからカスタムメトリクスをキャプチャするために使用します。上記のカスタムメトリクスセクションを参照してください。
- `http`：HTTPリクエストを実行するためのモジュール。HTTPクライアントとサーバーを提供するNode.js組み込みモジュールです。
- `https`：HTTPSリクエストを実行するためのモジュール。HTTPSクライアントとサーバーを提供するNode.js組み込みモジュールです。

### 注意事項

- `page` オブジェクトはブラウザと対話するための主要なインターフェースです。Playwright Pageクラスのオブジェクトです。必要に応じて `page.context()` でブラウザコンテキストにアクセスできます。
- `console.log` を使用してコンソールにデータを記録できます。これはモニターのログセクションで確認できます。
- `return` ステートメントを使用してスクリプトからデータを返すことができます。スクリプトが例外をスローした場合でも保持されるよう、スクリーンショットは提供された `screenshots` オブジェクトに割り当ててください。
- `browserType` と `screenSizeType` 変数を使用して、現在の実行コンテキストのブラウザタイプと画面サイズタイプを取得できます。
- これはJavaScriptスクリプトなので、スクリプト内ですべてのJavaScript機能を使用できます。
- スクリプト内でHTTPリクエストを実行するために `axios` モジュールを使用できます。APIコールを実行するために使用できます。
- oneuptime.comを使用している場合、スクリプトのコンテキストで常に最新バージョンのPlaywrightとブラウザが利用できます。セルフホストの場合は、プローブを更新して最新バージョンのPlaywrightとブラウザを使用するようにしてください。
- スクリプトのタイムアウトは2分です。スクリプトが2分以上かかる場合は、強制終了されます。
