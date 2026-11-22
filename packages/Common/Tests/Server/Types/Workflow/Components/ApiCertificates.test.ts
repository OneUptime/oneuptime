/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import ApiDelete from "../../../../../Server/Types/Workflow/Components/API/Delete";
import ApiGet from "../../../../../Server/Types/Workflow/Components/API/Get";
import ApiGetById from "../../../../../Server/Types/Workflow/Components/API/GetById";
import ApiPatch from "../../../../../Server/Types/Workflow/Components/API/Patch";
import ApiPost from "../../../../../Server/Types/Workflow/Components/API/Post";
import ApiPut from "../../../../../Server/Types/Workflow/Components/API/Put";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import SafeWebhookRequest, {
  WebhookTarget,
} from "../../../../../Server/Utils/SafeWebhookRequest";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CaCertificateProblem,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE,
  HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE,
  getHttpStepCertificateForAnotherHostMessage,
  getHttpStepProxyCertificateMessage,
} from "../../../../../Types/Runbook/HttpStepCertificates";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  isArgumentShown,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import APIComponents from "../../../../../Types/Workflow/Components/API";
import {
  ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID,
  CA_CERTIFICATE_ARGUMENT_ID,
} from "../../../../../Types/Workflow/Components/ApiCertificates";
import {
  canListenOn,
  clearOutboundProxyEnvironmentForEachTest,
} from "../../../TestingUtils/OutboundProxyFixture";
import {
  LocalHttpsServer,
  TestCertificate,
  TestCertificates,
  TunnelEnd,
  TunnellingProxy,
  generateTestCertificates,
  removeTestCertificates,
  useDefaultCaRestored,
  useSelfSignedHttps,
} from "../../../TestingUtils/SelfSignedHttpsFixture";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A WORKFLOW API STEP CAN TRUST A SELF-SIGNED CERTIFICATE, OR A CA OF ITS
 * OWN (issue #10440).
 *
 * The six API steps take a Runbook HTTP step's two settings (#10277),
 * under More fields, off by default (Types/Workflow/Components/
 * ApiCertificates): Allow self-signed certificates, and CA certificate.
 * These run each step for real, against HTTPS servers on this machine whose
 * certificates nobody trusts (SelfSignedHttpsFixture). The step's URL check
 * is stood in for with the address it would approve - its policy is
 * ApiComponentSsrf's and WorkflowRequestAddressPinning's - so the request
 * reaches the server only at that address.
 */

clearOutboundProxyEnvironmentForEachTest();
useDefaultCaRestored();

const { serve, proxy: startProxy } = useSelfSignedHttps();

const HOST: string = "workflow-tls.example.test";
const OTHER_HOST: string = "workflow-tls-other.example.test";

const STEPS: Array<{
  name: string;
  id: ComponentID;
  make: () => ComponentCode;
}> = [
  { name: "API Get", id: ComponentID.ApiGet, make: () => new ApiGet() },
  {
    name: "API Get By ID",
    id: ComponentID.ApiGetById,
    make: () => new ApiGetById(),
  },
  { name: "API Post", id: ComponentID.ApiPost, make: () => new ApiPost() },
  { name: "API Put", id: ComponentID.ApiPut, make: () => new ApiPut() },
  { name: "API Patch", id: ComponentID.ApiPatch, make: () => new ApiPatch() },
  {
    name: "API Delete",
    id: ComponentID.ApiDelete,
    make: () => new ApiDelete(),
  },
];

let certificates: TestCertificates;
let canUse127002: boolean = false;

beforeAll(async () => {
  certificates = generateTestCertificates(HOST);
  canUse127002 = await canListenOn("127.0.0.2");
});

afterAll(() => {
  removeTestCertificates(certificates);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeOptions(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

// A server with `certificate`, whose made-up names the URL check approves.
async function serverWith(
  certificate: TestCertificate,
): Promise<LocalHttpsServer> {
  const server: LocalHttpsServer = await serve({
    host: canUse127002 ? "127.0.0.2" : "127.0.0.1",
    certificate,
  });

  jest
    .spyOn(SafeWebhookRequest, "resolveTarget")
    .mockImplementation(async (url: unknown): Promise<WebhookTarget> => {
      return {
        url: new globalThis.URL(String(url)),
        addresses: [{ address: server.host, family: 4 }],
      };
    });

  return server;
}

// A step's arguments, as the builder stores them, for a request to `server`.
function argsFor(
  stepId: ComponentID,
  server: LocalHttpsServer,
  settings: JSONObject = {},
  host: string = HOST,
): JSONObject {
  return {
    url:
      stepId === ComponentID.ApiGetById
        ? `https://${host}:${server.port}/items/{id}`
        : `https://${host}:${server.port}/hook`,
    ...(stepId === ComponentID.ApiGetById ? { id: "OPS-12" } : {}),
    ...settings,
  };
}

async function run(
  stepId: ComponentID,
  server: LocalHttpsServer,
  settings: JSONObject = {},
  host: string = HOST,
): Promise<RunReturnType> {
  const step: ComponentCode = STEPS.find((entry: { id: ComponentID }) => {
    return entry.id === stepId;
  })!.make();

  return await step.run(argsFor(stepId, server, settings, host), makeOptions());
}

describe("the two settings, as each API step's settings draw them", () => {
  test.each(STEPS)("$name has both, folded under More fields, off", (entry: {
    id: ComponentID;
  }) => {
    const component: ComponentMetadata = APIComponents.find(
      (candidate: ComponentMetadata) => {
        return candidate.id === entry.id;
      },
    )!;
    const byId: Map<string, Argument> = new Map(
      component.arguments.map((argument: Argument): [string, Argument] => {
        return [argument.id, argument];
      }),
    );
    const allow: Argument = byId.get(ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID)!;
    const ca: Argument = byId.get(CA_CERTIFICATE_ARGUMENT_ID)!;

    expect({
      name: allow.name,
      type: allow.type,
      required: allow.required,
      isAdvanced: allow.isAdvanced,
    }).toEqual({
      name: "Allow self-signed certificates",
      type: ComponentInputType.Boolean,
      required: false,
      isAdvanced: true,
    });
    expect({
      name: ca.name,
      type: ca.type,
      required: ca.required,
      isAdvanced: ca.isAdvanced,
      placeholder: ca.placeholder,
    }).toEqual({
      name: "CA certificate",
      type: ComponentInputType.LongText,
      required: false,
      isAdvanced: true,
      placeholder: "-----BEGIN CERTIFICATE-----",
    });
    // Worded as a Runbook HTTP step's (#10277).
    expect(allow.description).toBe(
      "Skips certificate checks for this step's request, so self-signed certificates work, but anyone on the network path could read or change the request.",
    );
    expect(ca.description).toBe(
      "The step trusts only this certificate (PEM): that of the CA that signed the server's certificate, or the server's own when it is self-signed.",
    );
  });

  test("the CA certificate is shown while the switch is off, and hidden while it is on", () => {
    const ca: Argument = APIComponents[0]!.arguments.find(
      (argument: Argument) => {
        return argument.id === CA_CERTIFICATE_ARGUMENT_ID;
      },
    )!;

    expect(isArgumentShown(ca, {})).toBe(true);
    expect(
      isArgumentShown(ca, { [ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID]: false }),
    ).toBe(true);
    expect(
      isArgumentShown(ca, { [ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID]: true }),
    ).toBe(false);
    // An earlier step's value is known only when the step runs.
    expect(
      isArgumentShown(ca, {
        [ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID]: "{{local.variables.x}}",
      }),
    ).toBe(true);
  });
});

describe.each(STEPS)("$name, to a server whose certificate it signed itself", (entry: {
  id: ComponentID;
}) => {
  test("with neither setting, takes the Error port, saying which setting lets it through, and sends nothing", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: RunReturnType = await run(entry.id, server);

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      HTTP_STEP_UNTRUSTED_CERTIFICATE_MESSAGE,
    );
    expect(server.isUntouched).toBe(true);
  });

  test("with Allow self-signed certificates on, goes through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: RunReturnType = await run(entry.id, server, {
      [ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID]: true,
    });

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["response-status"]).toBe(200);
    expect(server.requests).toHaveLength(1);
  });

  test("with its own certificate as the CA certificate, goes through", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: RunReturnType = await run(entry.id, server, {
      [CA_CERTIFICATE_ARGUMENT_ID]: certificates.selfSigned.certificate,
    });

    expect(result.executePort?.id).toBe("success");
    expect(server.requests).toHaveLength(1);
  });
});

describe("API Post's certificate settings, read as a Runbook HTTP step's", () => {
  test("a CA certificate of another key is refused, saying the step's CA certificate did not sign it", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: RunReturnType = await run(ComponentID.ApiPost, server, {
      [CA_CERTIFICATE_ARGUMENT_ID]: certificates.otherSelfSigned.certificate,
    });

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      HTTP_STEP_CERTIFICATE_NOT_FROM_STEP_CA_MESSAGE,
    );
    expect(server.isUntouched).toBe(true);
  });

  test("a private CA's certificate lets its server through, and still refuses a certificate for another host", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.caSigned);

    const trusted: RunReturnType = await run(ComponentID.ApiPost, server, {
      [CA_CERTIFICATE_ARGUMENT_ID]: certificates.caCertificate,
    });
    const otherHost: RunReturnType = await run(
      ComponentID.ApiPost,
      server,
      { [CA_CERTIFICATE_ARGUMENT_ID]: certificates.caCertificate },
      OTHER_HOST,
    );

    expect(trusted.executePort?.id).toBe("success");
    expect(otherHost.executePort?.id).toBe("error");
    expect(otherHost.returnValues["error"]).toBe(
      getHttpStepCertificateForAnotherHostMessage(OTHER_HOST),
    );
    expect(server.requests).toHaveLength(1);
  });

  test.each([
    ["the text 'true'", "true"],
    ["1", 1],
    ["false", false],
  ])(
    "the switch written as %s keeps the checks",
    async (_what: string, value: unknown) => {
      const server: LocalHttpsServer = await serverWith(
        certificates.selfSigned,
      );

      const result: RunReturnType = await run(ComponentID.ApiPost, server, {
        [ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID]: value as JSONObject[string],
      });

      expect(result.executePort?.id).toBe("error");
      expect(server.isUntouched).toBe(true);
    },
  );

  test("with both set, the checks are off and the CA certificate is not used", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);

    const result: RunReturnType = await run(ComponentID.ApiPost, server, {
      [ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID]: true,
      [CA_CERTIFICATE_ARGUMENT_ID]: certificates.otherSelfSigned.certificate,
    });

    expect(result.executePort?.id).toBe("success");
  });

  test.each([
    ["text", "hello", CaCertificateProblem.NotACertificate],
    [
      "PEM markers around something else",
      "-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
      CaCertificateProblem.NotACertificate,
    ],
    [
      "a private key",
      "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----",
      CaCertificateProblem.PrivateKey,
    ],
    [
      "a reference no earlier step filled in",
      "{{local.variables.INTERNAL_CA}}",
      CaCertificateProblem.NotACertificate,
    ],
  ])(
    "a CA certificate that is not one (%s) fails the step before anything is sent",
    async (_what: string, text: string, problem: CaCertificateProblem) => {
      const server: LocalHttpsServer = await serverWith(
        certificates.selfSigned,
      );
      let refusal: unknown = undefined;

      try {
        await run(ComponentID.ApiPost, server, {
          [CA_CERTIFICATE_ARGUMENT_ID]: text,
        });
      } catch (error) {
        refusal = error;
      }

      expect((refusal as Error).message).toBe(
        HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[problem],
      );
      expect(server.isUntouched).toBe(true);
    },
  );
});

describe("API Post behind an outbound proxy", () => {
  async function proxyTo(
    server: LocalHttpsServer,
    certificate?: TestCertificate | undefined,
  ): Promise<TunnellingProxy> {
    return await startProxy({
      certificate,
      route: (authority: string): TunnelEnd | null => {
        return authority === `${HOST}:${server.port}`
          ? { host: server.host, port: server.port }
          : null;
      },
    });
  }

  test("an http:// proxy: the CA certificate reaches the server through the tunnel", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server);
    process.env["HTTPS_PROXY"] = proxy.url;

    const result: RunReturnType = await run(ComponentID.ApiPost, server, {
      [CA_CERTIFICATE_ARGUMENT_ID]: certificates.selfSigned.certificate,
    });

    expect(result.executePort?.id).toBe("success");
    expect(proxy.connects).toEqual([`${HOST}:${server.port}`]);
  });

  test("an https:// proxy nobody trusts: Allow self-signed certificates never loosens the proxy's connection", async () => {
    const server: LocalHttpsServer = await serverWith(certificates.selfSigned);
    const proxy: TunnellingProxy = await proxyTo(server, certificates.proxy);
    process.env["HTTPS_PROXY"] = proxy.url;

    const result: RunReturnType = await run(ComponentID.ApiPost, server, {
      [ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID]: true,
    });

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      getHttpStepProxyCertificateMessage("DEPTH_ZERO_SELF_SIGNED_CERT"),
    );
    expect(proxy.connects).toEqual([]);
    expect(server.isUntouched).toBe(true);
  });
});
