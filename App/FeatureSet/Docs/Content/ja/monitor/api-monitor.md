# API モニター

API モニタリングにより、HTTP/REST API の可用性、パフォーマンス、正確性を監視できます。OneUptime は API エンドポイントに定期的に HTTP リクエストを送信し、設定した条件に基づいてレスポンスを評価します。

## 概要

API モニターはエンドポイントに HTTP リクエストを送信し、レスポンスを確認します。これにより以下が可能です。

- API のアップタイムと可用性の監視
- レスポンスタイムとパフォーマンスの追跡
- HTTP ステータスコードとレスポンスボディの確認
- レスポンスヘッダーの検証
- 異なる HTTP メソッドのテスト（GET、POST、PUT、DELETE など）
- カスタムリクエストヘッダーとボディの送信

## API モニターの作成

1. OneUptime ダッシュボードの**モニター**に移動します
2. **モニターを作成**をクリックします
3. モニタータイプとして **API** を選択します
4. API の URL を入力してリクエスト設定を構成します
5. 必要に応じてモニタリング条件を設定します

## 設定オプション

### API URL

監視したい API エンドポイントの完全な URL を入力します（例: `https://api.example.com/v1/health`）。

### 動的 URL プレースホルダー

CDN やキャッシュプロキシの背後にある API を監視する場合、モニターはオリジンサーバーにアクセスする代わりにキャッシュされたレスポンスを受け取ることがあります。各チェックでキャッシュを無効化するために、監視リクエストごとに一意の値に置き換えられる動的 URL プレースホルダーを使用できます。

#### サポートされているプレースホルダー

| プレースホルダー | 説明 | 値の例 |
|-------------|-------------|---------------|
| `{{timestamp}}` | 現在の Unix タイムスタンプ（秒）に置き換えられます | `1719500000` |
| `{{random}}` | ランダムな一意の文字列に置き換えられます | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 例

プレースホルダーを使用してモニターの URL を設定します。

```
https://api.example.com/health?cb={{timestamp}}
```

各モニタリングチェックで、URL は以下のようになります。

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

すべてのリクエストで一意の文字列を使用するために `{{random}}` も使用できます。

```
https://api.example.com/health?nocache={{random}}
```

### API リクエストタイプ

リクエストに使用する HTTP メソッドを選択します。

- **GET**（デフォルト）
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### 詳細オプション

#### リクエストヘッダー

リクエストにカスタム HTTP ヘッダーを追加します。認証トークン、コンテンツタイプの指定、その他の API 固有のヘッダーに役立ちます。

API キーなどの機密データを安全に保存するために、ヘッダーの値に[モニターシークレット](/docs/monitor/monitor-secrets)を使用できます。

#### リクエストボディ（JSON）

POST、PUT、PATCH リクエストの場合、JSON リクエストボディを指定できます。リクエストボディにも[モニターシークレット](/docs/monitor/monitor-secrets)を使用できます。

#### リダイレクトを追わない

デフォルトでは、OneUptime は HTTP リダイレクト（301、302 など）に従います。最終的なリダイレクト先ではなく、リダイレクトレスポンス自体を監視したい場合はこのオプションを有効にします。

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** *(optional)* — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## モニタリング条件

以下に基づいて API がオンライン、低下、またはオフラインと判断される条件を設定できます。

- **レスポンスステータスコード** - HTTP ステータスコードが期待される値（例: 200、201）と一致するか確認します
- **レスポンスタイム** - レスポンスタイムがしきい値を超えているか監視します
- **レスポンスボディ** - レスポンスボディに特定のコンテンツが含まれているか一致するか確認します
- **レスポンスヘッダー** - 特定のレスポンスヘッダーが存在するか期待される値と一致するか確認します
- **JavaScript 式** - レスポンスを評価するカスタム式を記述します。詳細は [JavaScript 式](/docs/monitor/javascript-expression)を参照してください。
