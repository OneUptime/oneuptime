import axios, { AxiosError, AxiosResponse } from "axios";
import BadDataException from "../../Types/Exception/BadDataException";
import logger from "./Logger";
import { CaptchaEnabled, CaptchaSecretKey } from "../EnvironmentConfig";

export interface VerifyCaptchaOptions {
  token: string | null | undefined;
  remoteIp?: string | null;
}

const REQUEST_TIMEOUT_MS: number = 5000;
const GENERIC_ERROR_MESSAGE: string =
  "Captcha verification failed. Please try again.";

type HCaptchaResponse = {
  success?: boolean;
  [key: string]: unknown;
};

class CaptchaUtil {
  public static isCaptchaEnabled(): boolean {
    return CaptchaEnabled && Boolean(CaptchaSecretKey);
  }

  public static async verifyCaptcha(
    options: VerifyCaptchaOptions,
  ): Promise<void> {
    if (!CaptchaEnabled) {
      return;
    }

    if (!CaptchaSecretKey) {
      logger.error(
        "Captcha is enabled but CAPTCHA_SECRET_KEY is not configured.",
      );
      throw new BadDataException(GENERIC_ERROR_MESSAGE);
    }

    const token: string = (options.token || "").trim();

    if (!token) {
      throw new BadDataException(
        "Captcha token is missing. Please complete the verification challenge.",
      );
    }

    try {
      await this.verifyHCaptcha(token, options.remoteIp || undefined);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axiosError: AxiosError = err as AxiosError;
        logger.error(
          `Captcha provider verification failure: ${axiosError.message}`,
        );
      } else {
        logger.error(
          `Captcha provider verification failure: ${(err as Error).message}`,
        );
      }

      throw new BadDataException(GENERIC_ERROR_MESSAGE);
    }
  }

  private static async verifyHCaptcha(
    token: string,
    remoteIp?: string,
  ): Promise<void> {
    const params: URLSearchParams = new URLSearchParams();
    params.append("secret", CaptchaSecretKey);
    params.append("response", token);

    if (remoteIp) {
      params.append("remoteip", remoteIp);
    }

    const response: AxiosResponse<HCaptchaResponse> =
      await axios.post<HCaptchaResponse>(
        "https://hcaptcha.com/siteverify",
        params.toString(),
        {
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
      );

    if (!response.data?.success) {
      logger.warn(
        `hCaptcha verification failed: ${JSON.stringify(response.data || {})}`,
      );
      throw new BadDataException(GENERIC_ERROR_MESSAGE);
    }
  }
}

export default CaptchaUtil;
