import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";

const PROTOCOL: Protocol = window.location.protocol.includes("https")
  ? Protocol.HTTPS
  : Protocol.HTTP;

export const PUBLIC_DASHBOARD_API_URL: URL = new URL(
  PROTOCOL,
  window.location.host,
  new Route("/public-dashboard-api"),
);
