/*
 * What a monitor secret holds, and so what a {{monitorSecrets.NAME}} that
 * names it becomes when a check runs (issue #9703):
 *
 *   - Text: the value itself - a password, an API key, a token - filled in
 *     by the server before the probe gets the monitor;
 *   - TOTP: a site's two-factor seed. The seed is never filled in anywhere:
 *     the probe makes the current one-time code from it at the moment the
 *     check uses it (Common/Utils/Monitor/MonitorSecretTotp).
 *
 * Every secret created before types existed is Text, the column's default.
 * A secret keeps the type it was created with.
 */
enum MonitorSecretType {
  Text = "Text",
  TOTP = "TOTP",
}

export class MonitorSecretTypeUtil {
  public static readonly DEFAULT_TYPE: MonitorSecretType =
    MonitorSecretType.Text;

  public static readonly ALL_TYPES: ReadonlyArray<MonitorSecretType> = [
    MonitorSecretType.Text,
    MonitorSecretType.TOTP,
  ];

  public static isValid(value: unknown): value is MonitorSecretType {
    return MonitorSecretTypeUtil.ALL_TYPES.includes(value as MonitorSecretType);
  }

  // A secret read before the column existed has no type: it is Text.
  public static isTotp(value: unknown): boolean {
    return value === MonitorSecretType.TOTP;
  }
}

export default MonitorSecretType;
