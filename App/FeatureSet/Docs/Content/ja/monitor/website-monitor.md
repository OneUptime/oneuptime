# ウェブサイトモニター

ウェブサイトモニタリングを使用すると、任意のウェブサイトやウェブページの可用性、パフォーマンス、レスポンスを監視できます。OneUptimeは定期的にウェブサイトのURLにHTTPリクエストを送信し、正しく応答するかを確認します。

## 概要

ウェブサイトモニターはHTTPリクエストを実行してレスポンスを評価することでウェブページを確認します。これにより、以下のことが可能になります。

- ウェブサイトの稼働時間と可用性の監視
- レスポンスタイムとパフォーマンスの追跡
- HTTPステータスコードの確認
- レスポンスヘッダーの確認
- ユーザーよりも早くダウンタイムを検出

## ウェブサイトモニターの作成

1. OneUptime ダッシュボードで **モニター** を開きます
2. **モニターの作成** をクリックします
3. モニタータイプとして **ウェブサイト** を選択します
4. 監視するウェブサイトのURLを入力します
5. 必要に応じて監視条件を設定します

## 設定オプション

### ウェブサイトURL

監視するウェブサイトの完全なURL（プロトコルを含む）を入力します（例：`https://example.com`）。

### 動的URLプレースホルダー

CDNやキャッシュプロキシの背後にあるURLを監視する場合、モニターはオリジンサーバーにアクセスせずにキャッシュされたレスポンスを受け取ることがあります。監視リクエストのたびにキャッシュを無効化するために、動的URLプレースホルダーを使用できます。これらのプレースホルダーは監視リクエストごとに一意の値に置き換えられます。

#### サポートされるプレースホルダー

| プレースホルダー | 説明 | 値の例 |
|-------------|-------------|---------------|
| `{{timestamp}}` | 現在のUnixタイムスタンプ（秒）に置き換えられる | `1719500000` |
| `{{random}}` | ランダムな一意の文字列に置き換えられる | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 使用例

プレースホルダーを使ってモニターURLを設定します：

```
https://example.com/health?cb={{timestamp}}
```

監視チェックのたびに、URLは次のようになります：

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

リクエストのたびに一意の文字列を使用する場合は `{{random}}` も使用できます：

```
https://example.com/health?nocache={{random}}
```

### 詳細オプション

#### リダイレクトに従わない

デフォルトでは、OneUptimeはHTTPリダイレクト（301、302など）に従います。リダイレクト後の最終的な宛先ではなく、リダイレクトレスポンス自体を監視したい場合は、このオプションを有効にします。

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

## 監視条件

以下の条件に基づいて、ウェブサイトがオンライン、パフォーマンス低下、またはオフラインと判定されるタイミングを設定できます。

- **レスポンスステータスコード** — HTTPステータスコードが期待値と一致するか確認（例：200、301）
- **レスポンスタイム** — レスポンスタイムがしきい値を超えているか監視
- **レスポンス本文** — レスポンス本文が特定の内容を含むまたは一致するか確認
- **レスポンスヘッダー** — 特定のレスポンスヘッダーが存在し、期待値と一致するか確認
