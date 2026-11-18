# Kubernetes و Helm

OneUptime را با چارت Helm روی خوشهٔ Kubernetes خودتان اجرا کنید. این صفحه را خود سرور OneUptime شما ارائه می‌دهد، پس بدون دسترسی به اینترنت هم باز می‌شود و چارتِ همان نسخه‌ای را توضیح می‌دهد که اجرا می‌کنید. هر مقداری که چارت می‌پذیرد در مستندات خود چارت، در [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)، آمده است.

:::cards
- [چارت را نصب کنید](#چارت-را-نصب-کنید): یک فایل مقادیر و دو فرمان.
- [از داده‌هایتان پشتیبان بگیرید](#از-دادههایتان-پشتیبان-بگیرید): PostgreSQL و ClickHouse، در فضای ذخیره‌سازی بیرون از خوشه.
- [کلیدهایتان را نگه دارید](#کلیدهایتان-را-نگه-دارید): آنچه نسخه‌های پشتیبان بدون آن خواندنی نیستند.
:::

## چارت را نصب کنید

یک `values.yaml` با نام دامنه یا نشانی IP که دیگران به کار خواهند برد بسازید، بدون `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

سپس چارت را نصب کنید:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**درست کار کرده وقتی** `kubectl get pods` هر پاد را `Running` نشان دهد و آن نشانی OneUptime را باز کند. [راهنمای خودمیزبانی](/docs/installation/self-hosting-guide) از همین جا ادامه می‌دهد: HTTPS، حساب مدیر، و ایمیل، پیامک و تماس.

## از داده‌هایتان پشتیبان بگیرید

OneUptime داده‌هایش را روی حجم‌های پایدار خوشه نگه می‌دارد: PostgreSQL پروژه‌ها، مانیتورها، رخدادها، صفحه‌های وضعیت و کاربران شما را دارد، و ClickHouse لاگ‌ها، ردگیری‌ها و متریک‌های شما را. از هر دو، به یکی از این روش‌ها، در فضای ذخیره‌سازی بیرون از خوشه پشتیبان بگیرید:

- **پشتیبان‌گیری زمان‌بندی‌شدهٔ نسخه سازمانی.** آن را در Admin Dashboard در **تنظیمات** > **نسخه‌های پشتیبان** راه‌اندازی کنید. [پشتیبان‌گیری](/docs/installation/backups) را ببینید.
- **پشتیبان‌گیری ارائه‌دهندهٔ ابری شما از حجم‌های پایدار**، مانند اسنپ‌شات‌های زمان‌بندی‌شده از دیسک‌های PostgreSQL و ClickHouse.
- **پشتیبان‌گیری CloudNativePG با اسنپ‌شات حجم**، وقتی PostgreSQL روی اپراتور CloudNativePG اجرا می‌شود. آن را در `values.yaml` روشن کنید و سپس تغییر را اعمال کنید:

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

با این زمان‌بندی، هر روز ساعت 03:00 از PostgreSQL پشتیبان گرفته می‌شود. CloudNativePG اسنپ‌شات‌های قدیمی حجم را پاک نمی‌کند، پس آن‌هایی را که دیگر لازم ندارید خودتان پاک کنید.

OneUptime پشتیبان‌هایی را که بیرون از آن گرفته می‌شوند نمی‌بیند. وقتی پشتیبان‌گیری شما راه افتاد، در صفحهٔ **راه‌اندازی سرور** در Admin Dashboard، روی **از این سرور پشتیبان گرفته می‌شود** در بخش پشتیبان‌گیری کلیک کنید.

## کلیدهایتان را نگه دارید

آنچه OneUptime رمزنگاری می‌کند فقط با همان `encryptionSecret` خواندنی است که با آن رمزنگاری شده است. `oneuptimeSecret` و `encryptionSecret` را خودتان در `values.yaml` تعیین کنید تا هیچ ارتقایی آن‌ها را عوض نکند، و نسخه‌ای از آن‌ها را کنار نسخه‌های پشتیبانتان، بیرون از خوشه، نگه دارید:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## گام‌های بعدی

:::cards
- [راهنمای خودمیزبانی](/docs/installation/self-hosting-guide): از یک خوشهٔ خالی تا سروری که شما را فرا می‌خواند.
- [ارتقا](/docs/installation/upgrading): پیش از هر ارتقا پشتیبان بگیرید.
- [پشتیبان‌گیری](/docs/installation/backups): پشتیبان‌گیری زمان‌بندی‌شدهٔ نسخه سازمانی.
:::
