import Email from "Common/Types/Email";
import speakeasy from "speakeasy";

/**
 * Utility class for handling two-factor authentication.
 */
export default class TwoFactorAuth {
  /**
   * Generates a random secret key for two-factor authentication.
   * @returns The generated secret key.
   */
  public static generateSecret(): string {
    return speakeasy.generateSecret().base32;
  }

  /**
   * Verifies if a given token matches the provided secret key.
   * @param data - The data object containing the secret key and token.
   * @returns A boolean indicating whether the token is valid or not.
   */
  public static verifyToken(data: { secret: string; token: string }): boolean {
    const { secret, token } = data;

    const isVerified: boolean = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token,
      window: 3,
    });

    return isVerified;
  }

  /**
   * Generates a time-based one-time password (TOTP) token using the provided secret key.
   * @param secret - The secret key used to generate the token.
   * @returns The generated TOTP token.
   */
  public static generateToken(secret: string): string {
    return speakeasy.totp({
      secret,
      encoding: "base32",
    });
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
    return speakeasy.otpauthURL({
      secret,
      label: "OneUptime:" + userEmail.toString(),
      issuer: "oneuptime.com",
    });
  }
}
