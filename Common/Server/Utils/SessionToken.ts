import OneUptimeDate from "../../Types/Date";
import { createHash, randomBytes } from "crypto";

export const ACCESS_TOKEN_TTL_SECONDS: number = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS: number = 30 * 24 * 60 * 60; // 30 days

export type SessionMetadata = {
  ipAddress?: string;
  userAgent?: string;
  device?: string;
};

export type GeneratedAuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
  refreshTokenExpiresAt: Date;
};

export const generateRefreshToken = (): string => {
  return randomBytes(48).toString("hex");
};

export const hashRefreshToken = (token: string): string => {
  return createHash("sha256").update(token).digest("hex");
};

export const computeRefreshTokenExpiryDate = (): Date => {
  return OneUptimeDate.addRemoveSeconds(
    OneUptimeDate.getCurrentDate(),
    REFRESH_TOKEN_TTL_SECONDS,
  );
};

export const getRefreshTokenExpiresInSeconds = (): number => {
  return REFRESH_TOKEN_TTL_SECONDS;
};

export const getAccessTokenExpiresInSeconds = (): number => {
  return ACCESS_TOKEN_TTL_SECONDS;
};
