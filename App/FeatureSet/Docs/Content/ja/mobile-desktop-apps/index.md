# OneUptime モバイル・デスクトップアプリ

OneUptime では、ブラウザ以外でプラットフォームを利用する方法を 2 つご用意しています:

- **ネイティブモバイルアプリ**(iOS および Android 向け)。**Apple App Store** および **Google Play** で公開されています。これらのアプリにより、オンコールのページ、インシデントアラート、確認応答操作を直接スマートフォンへ届けます。
- **インストール可能なデスクトップアプリ**(Windows、macOS、Linux 向け)。プログレッシブ ウェブ アプリ(PWA)としてブラウザから直接インストールできます。OneUptime のダッシュボードに専用のウィンドウ、アイコン、通知領域をコンピューター上で提供します。

## モバイル(ネイティブアプリ)

**OneUptime On-Call** アプリは、React Native で構築されたネイティブアプリケーションです。公式ストアを通じて配信されるため、自動アップデート、プッシュ通知、生体認証によるロック解除を利用できます。

- **iOS** — [App Store からダウンロード](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)。iOS 15.0 以降が必要です。[iOS インストールガイド](./ios-installation.md)をご覧ください。
- **Android** — [Google Play で入手](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)。Android 8.0 以降が必要です。Google Play を利用できないデバイス向けに、[APK の直接ダウンロード](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)も提供しています。[Android インストールガイド](./android-installation.md)をご覧ください。

## デスクトップ(プログレッシブ ウェブ アプリ)

OneUptime のウェブダッシュボードはプログレッシブ ウェブ アプリ(PWA)であるため、ストアを経由せずに最新のブラウザからデスクトップアプリケーションとしてインストールできます。

- [Windows へのインストール](./windows-installation.md)
- [macOS へのインストール](./macos-installation.md)
- [Linux へのインストール](./linux-installation.md)

### デスクトップ版のはじめ方

1. Chromium ベースのブラウザ(Chrome、Edge)または Safari で OneUptime のインスタンスを開きます。
2. アドレスバーの **インストール** ボタン、または **ファイル → Dock に追加 / アプリ → このサイトをアプリとしてインストール** を探します。
3. インストールしたアプリをスタートメニュー、Launchpad、またはアプリケーションランチャーから起動します。

### デスクトップ版のトラブルシューティング

**インストールオプションが表示されない:**
- サポートされているブラウザを使用しているか確認してください。
- OneUptime インスタンスが HTTPS で配信されていることを確認してください。
- ページを再読み込みするか、ブラウザのキャッシュをクリアしてください。

**プッシュ通知が機能しない:**
- ブラウザからプロンプトが表示されたら通知の権限を許可してください。
- オペレーティングシステムのブラウザに関する通知設定を確認してください。
- セルフホスティング利用者向け: OneUptime インスタンスでプッシュ通知が設定されていることを確認してください。

## サポート

- モバイル固有の問題: [iOS](./ios-installation.md) または [Android](./android-installation.md) のインストールガイドをご確認ください。
- デスクトップ固有の問題: [Windows](./windows-installation.md)、[macOS](./macos-installation.md)、または [Linux](./linux-installation.md) のインストールガイドをご確認ください。
- 一般的な質問: [FAQ およびトラブルシューティング](./faq-troubleshooting.md)のページをご覧ください。
- バグ報告や機能リクエストは、[GitHub リポジトリ](https://github.com/OneUptime/oneuptime)にてお願いします。
