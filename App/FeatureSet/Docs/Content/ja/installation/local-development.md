# ローカル開発

ローカル開発には docker-compose.dev.yml ファイルを使用する必要があります。

以下が必要です。
- Docker および Docker Compose がインストールされていること。
- Node.js および NPM がインストールされていること。

```
# このリポジトリをクローンして cd で移動します。
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env を config.env にコピーします
cp config.example.env config.env

# 開発環境なので、config.env の値を編集する必要はありません。編集することもできますが、任意です。
npm run dev
```
