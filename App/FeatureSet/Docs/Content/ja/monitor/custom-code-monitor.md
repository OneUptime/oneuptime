# カスタムコードモニター

カスタムコードモニターを使用すると、アプリケーションを監視するためのカスタムスクリプトを記述できます。この機能を使用することで、既存のモニターでは実現できない方法でアプリケーションを監視できます。たとえば、複数ステップのAPIリクエストを実行することが可能です。

#### 使用例

以下の例は、カスタムコードモニターの使用方法を示しています。

```javascript
// axiosモジュールを使用できます。

await axios.get("https://api.example.com/");

// Axiosのドキュメントはこちら: https://axios-http.com/docs/intro

return {
  data: "Hello World", // ここに返したいデータを記述してください。
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

- `name`（文字列、必須）：メトリクス名（例：`"api.response.time"`）。自動的に `custom.monitor.` プレフィックスが付加されます。
- `value`（数値、必須）：数値メトリクス値。
- `attributes`（オブジェクト、任意）：追加コンテキスト用のキーと値のペア。

#### 使用例

```javascript
const response = await axios.get("https://api.example.com/health");

// シンプルなメトリクスをキャプチャ
oneuptime.captureMetric("api.response.time", response.data.latency);

// 属性付きでメトリクスをキャプチャ
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

キャプチャされたメトリクスは、`custom.monitor.api.response.time` のような名前でメトリクスエクスプローラーに表示されます。ダッシュボードのチャートに追加したり、アラートを設定したり、モニター、プローブ、または指定したカスタム属性でフィルタリングしたりできます。

**制限事項：**

- スクリプト実行ごとに最大100個のメトリクス。
- メトリクス名は200文字以内。
- 値は数値である必要があります。

### スクリプトで利用可能なモジュール

- `axios`：HTTPリクエストを実行するためのモジュール。ブラウザおよびNode.js向けのPromiseベースのHTTPクライアントです。
- `crypto`：暗号化処理を実行するためのモジュール。OpenSSLのハッシュ、HMAC、暗号化、復号化、署名、検証関数のラッパーセットを提供するNode.js組み込みモジュールです。
- `console.log`：コンソールにデータを記録するためのモジュール。デバッグ目的で使用します。
- `oneuptime.captureMetric`：スクリプトからカスタムメトリクスをキャプチャするために使用します。上記のカスタムメトリクスセクションを参照してください。
- `http`：HTTPリクエストを実行するためのモジュール。HTTPクライアントとサーバーを提供するNode.js組み込みモジュールです。
- `https`：HTTPSリクエストを実行するためのモジュール。HTTPSクライアントとサーバーを提供するNode.js組み込みモジュールです。

### 注意事項

- `console.log` を使用してコンソールにデータを記録できます。これはモニターのログセクション（プローブ > ログの表示）で確認できます。
- `return` ステートメントを使用して、スクリプトからデータを返すことができます。
- これはJavaScriptスクリプトなので、スクリプト内ですべてのJavaScript機能を使用できます。
- スクリプトのタイムアウトは2分です。スクリプトが2分以上かかる場合は、強制終了されます。
