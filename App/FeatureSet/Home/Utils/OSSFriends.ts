import URL from "Common/Types/API/URL";

export interface OSSFriend {
  name: string;
  description: string;
  repositoryUrl: URL;
}

const OSSFriends: OSSFriend[] = [
  {
    name: "Airbyte",
    description:
      "Airbyte is an open-source EL(T) platform that helps you replicate your data in your warehouses, lakes, and databases.",
    repositoryUrl: URL.fromString("https://github.com/airbytehq/airbyte"),
  },
  {
    name: "Cal.com",
    description:
      "Open Source Scheduling: Send a link and meet or build an entire marketplace for humans to connect.",
    repositoryUrl: URL.fromString("https://github.com/calcom/cal.com"),
  },
  {
    name: "Infiscal",
    description:
      "Infisical is an open-source end-to-end platform to manage secrets and configuration across your team and infrastructure.",
    repositoryUrl: URL.fromString("https://github.com/Infisical/infisical"),
  },
  {
    name: "Metabase",
    description:
      "Metabase is the easy, open-source way for everyone in your company to ask questions and learn from data.",
    repositoryUrl: URL.fromString("https://github.com/metabase/metabase"),
  },
  {
    name: "Posthog",
    description:
      "PostHog is open-source product analytics, built for developers.",
    repositoryUrl: URL.fromString("https://github.com/PostHog/posthog"),
  },
];

export default OSSFriends;
