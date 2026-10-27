/*
 * What the fixture answers the sign-in pages with (MockApi.js): the
 * server's instance-wide single sign-on providers, the providers an email
 * lookup finds, the person a sign-in signs in, an MCP client asking for
 * access, a marketplace purchase and a public form. Real uuids for every
 * id, as the API sends them.
 */

// The server's instance-wide providers, as GET /identity/sign-in-methods lists them.
export const PROVIDERS = [
  {
    type: "GlobalSSO",
    id: "33333333-3333-4333-8333-333333333333",
    name: "Okta",
    description: "Everyone at Acme",
  },
  {
    type: "GlobalOIDC",
    id: "44444444-4444-4444-8444-444444444444",
    name: "Google Workspace",
    description: "",
  },
];

const ACME = { _id: "66666666-6666-4666-8666-666666666666", name: "Acme" };
const GLOBEX = {
  _id: "77777777-7777-4777-8777-777777777777",
  name: "Globex Corporation",
};

const projectProvider = (id, name, description, project) => {
  return {
    _id: id,
    name: name,
    description: description,
    projectId: project._id,
    project: project,
  };
};

/*
 * What the email lookups find for an address with lookup=found: SAML
 * providers in two projects (GET /identity/service-provider-login), and an
 * OpenID Connect one in the first (.../service-provider-login-oidc).
 */
export const lookupProviders = (isOidc) => {
  if (isOidc) {
    return [
      projectProvider(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "Acme Google Workspace",
        "Sign in with Acme Google Workspace",
        ACME,
      ),
    ];
  }

  return [
    projectProvider(
      "88888888-8888-4888-8888-888888888888",
      "Acme Okta",
      "Sign in with Acme Okta",
      ACME,
    ),
    projectProvider(
      "99999999-9999-4999-8999-999999999999",
      "Globex Microsoft Entra ID",
      "Use the email address your Globex manager gave you",
      GLOBEX,
    ),
  ];
};

// The person a sign-in signs in.
export const SIGNED_IN_USER = {
  _id: "55555555-5555-4555-8555-555555555555",
  email: "jane@acme.example",
  name: "Jane Doe",
};

/*
 * An MCP client asking for access (POST /mcp/oauth/consent/details), as the
 * consent screen is told it: read for `read`, read and write for `write`, a
 * client on this device for `loopback`, and a person in no project for
 * `noprojects`.
 */
export const MCP_DETAILS = (kind) => {
  const isLoopback = kind === "loopback";

  return {
    client: {
      name: "Claude Desktop",
      verifiedHost: isLoopback ? null : "claude.ai",
      uri: isLoopback ? null : "https://claude.ai",
      redirectTarget: isLoopback ? "127.0.0.1:53682" : "claude.ai",
      isLoopbackRedirect: isLoopback,
    },
    requestedAccess: kind === "write" ? "write" : "read",
    user: { email: SIGNED_IN_USER.email, name: SIGNED_IN_USER.name },
    projects:
      kind === "noprojects"
        ? []
        : [
            {
              id: ACME._id,
              name: "Acme Production",
              isEligible: true,
              refusal: null,
            },
            {
              id: GLOBEX._id,
              name: "Globex Staging",
              isEligible: false,
              refusal: "NotPermitted",
            },
          ],
  };
};

// A purchase from AWS Marketplace waiting for its project.
export const MARKETPLACE_DETAILS = {
  marketplace: "AWS",
  marketplaceName: "AWS Marketplace",
  status: "Pending",
  buyerId: "buyer-7f3a",
  buyerEmail: SIGNED_IN_USER.email,
  marketplacePlan: "OneUptime Growth",
  isFreeTrial: false,
  linkedProjectId: null,
  signedInEmail: SIGNED_IN_USER.email,
  projects: [
    { id: ACME._id, name: "Acme Production", isEligible: true },
    {
      id: GLOBEX._id,
      name: "Globex Staging",
      isEligible: false,
      refusal: "AlreadyLinked",
    },
  ],
  plans: [
    {
      planId: "growth",
      name: "Growth",
      monthlyPricePerUserInUSD: 22,
      isCustomPricing: false,
    },
    {
      planId: "scale",
      name: "Scale",
      monthlyPricePerUserInUSD: 99,
      isCustomPricing: false,
    },
  ],
  canCreateProject: true,
};

// A public form (GET /form/public/<key>).
export const FORM = {
  name: "Report a problem",
  description: "Tell the Acme operations team what is wrong.",
  isCaptchaRequired: false,
  fields: [
    { id: "summary", label: "Summary", type: "Text", isRequired: true },
    {
      id: "details",
      label: "What happened",
      type: "LongText",
      helpText: "Steps, times and anything you saw on screen.",
    },
    { id: "email", label: "Your email", type: "Email" },
  ],
};
