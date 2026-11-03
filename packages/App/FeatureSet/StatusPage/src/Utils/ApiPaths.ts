import { STATUS_PAGE_IDENTITY_API_URL } from "./Config";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";

export const LOGIN_API_URL: URL = URL.fromURL(
  STATUS_PAGE_IDENTITY_API_URL,
).addRoute(new Route("/login"));

export const LOGIN_CODE_EXCHANGE_API_URL: URL = URL.fromURL(
  STATUS_PAGE_IDENTITY_API_URL,
).addRoute(new Route("/exchange-login-code"));

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(
  STATUS_PAGE_IDENTITY_API_URL,
).addRoute(new Route("/forgot-password"));

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(
  STATUS_PAGE_IDENTITY_API_URL,
).addRoute(new Route("/reset-password"));

// Emails a private user a sign-in link (Types/StatusPage/StatusPageMagicLink).
export const SEND_MAGIC_LINK_API_URL: URL = URL.fromURL(
  STATUS_PAGE_IDENTITY_API_URL,
).addRoute(new Route("/send-magic-link"));

// Signs in with a sign-in link; the status page's id follows.
export const MAGIC_LINK_LOGIN_API_URL: URL = URL.fromURL(
  STATUS_PAGE_IDENTITY_API_URL,
).addRoute(new Route("/login-with-magic-link"));
