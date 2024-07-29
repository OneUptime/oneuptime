import Email from "Common/Types/Email";
import * as OTPAuth from "otpauth";

/**
 * Utility class for handling two-factor authentication.
 */
export default class TwoFactorAuth {
  /**
   * Generates a random secret key for two-factor authentication.
   * @returns The generated secret key.
   */
  public static generateSecret(): string {
    return new OTPAuth.Secret().base32;
  }

  public static getLabel(data: { email: Email }): string {
    return data.email.toString();
  }

  public static getTotp(data: { secret: string; email: Email }): OTPAuth.TOTP {
    const totp: OTPAuth.TOTP = new OTPAuth.TOTP({
      // Provider or service the account is associated with.
      issuer: "OneUptime",
      // Account identifier.
      label: this.getLabel({
        email: data.email,
      }),
      // Algorithm used for the HMAC function.
      algorithm: "SHA256",
      // Length of the generated tokens.
      digits: 6,
      // Interval of time for which a token is valid, in seconds.
      period: 30,
      // Arbitrary key encoded in Base32 or OTPAuth.Secret instance.
      secret: data.secret,
    });

    return totp;
  }

  /**
   * Verifies if a given token matches the provided secret key.
   * @param data - The data object containing the secret key and token.
   * @returns A boolean indicating whether the token is valid or not.
   */
  public static verifyToken(data: {
    secret: string;
    token: string;
    email: Email;
  }): boolean {
    const { secret, token, email } = data;

    const totp: OTPAuth.TOTP = this.getTotp({ secret, email });

    const delta: number | null = totp.validate({ token, window: 3 });

    return delta !== null;
  }

  /**
   * Generates a URI for the given secret key and user email, which can be used to set up two-factor authentication.
   * @param data - The data object containing the secret key and user email.
   * @returns The generated URI for setting up two-factor authentication.
   */
  public static generateUri(data: {
    secret: string;
    userEmail: Email;
  }): string {
    const { secret, userEmail } = data;

    const totp: OTPAuth.TOTP = this.getTotp({ secret, email: userEmail });

    return totp.toString();
  }
}
