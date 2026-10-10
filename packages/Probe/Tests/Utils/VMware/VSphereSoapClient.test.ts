import { describe, expect, test } from "@jest/globals";
import VSphereSoapClient, {
  MoRef,
  PerfCounterInfo,
  PerfEntityMetric,
  VSphereFault,
  VSphereHttpRequest,
  VSphereHttpResponse,
  VSphereNotVSphereError,
  VSphereObject,
  VSphereServiceContent,
  readSessionCookie,
} from "../../../Utils/VMware/VSphereSoapClient";
import {
  createReplayTransport,
  loadExchanges,
  ReplayTransport,
  soapEnvelope,
  soapFault,
  soapMethodOf,
} from "./Helpers/ReplayTransport";

const SERVICE_CONTENT: string = soapEnvelope(
  `<RetrieveServiceContentResponse xmlns="urn:vim25"><returnval><rootFolder type="Folder">group-d1</rootFolder><propertyCollector type="PropertyCollector">propertyCollector</propertyCollector><viewManager type="ViewManager">ViewManager</viewManager><about><name>VMware vCenter Server</name><fullName>VMware vCenter Server 8.0.2 build-22617221</fullName><version>8.0.2</version><build>22617221</build><apiType>VirtualCenter</apiType><apiVersion>8.0.2.0</apiVersion><instanceUuid>u-1</instanceUuid></about><sessionManager type="SessionManager">SessionManager</sessionManager><perfManager type="PerformanceManager">PerfMgr</perfManager></returnval></RetrieveServiceContentResponse>`,
);

const VERSIONS: string =
  '<?xml version="1.0" encoding="UTF-8"?><namespaces version="1.0"><namespace><name>urn:vim25</name><version>8.0.2.0</version></namespace></namespaces>';

/*
 * A transport answering from a list of handlers in order, recording each
 * request - for the calls the simulator recordings do not cover.
 */
function scripted(
  answers: Array<(request: VSphereHttpRequest) => VSphereHttpResponse>,
): {
  transport: (request: VSphereHttpRequest) => Promise<VSphereHttpResponse>;
  requests: Array<VSphereHttpRequest>;
} {
  const requests: Array<VSphereHttpRequest> = [];
  const queue: Array<(request: VSphereHttpRequest) => VSphereHttpResponse> = [
    ...answers,
  ];

  return {
    requests: requests,
    transport: async (
      request: VSphereHttpRequest,
    ): Promise<VSphereHttpResponse> => {
      requests.push(request);
      const next:
        | ((request: VSphereHttpRequest) => VSphereHttpResponse)
        | undefined = queue.shift();

      if (!next) {
        throw new Error(`unexpected ${soapMethodOf(request.body)}`);
      }

      return next(request);
    },
  };
}

function ok(body: string, setCookie?: string): VSphereHttpResponse {
  return {
    status: 200,
    headers: setCookie ? { "set-cookie": [setCookie] } : {},
    body: body,
  };
}

function fault(
  faultType: string,
  faultString: string,
  detailXml?: string,
): VSphereHttpResponse {
  return {
    status: 500,
    headers: {},
    body: soapFault({ faultType, faultString, detailXml }),
  };
}

async function connectedClient(
  answers: Array<(request: VSphereHttpRequest) => VSphereHttpResponse>,
): Promise<{ client: VSphereSoapClient; requests: Array<VSphereHttpRequest> }> {
  const transport: ReturnType<typeof scripted> = scripted([
    () => {
      return ok(VERSIONS);
    },
    () => {
      return ok(SERVICE_CONTENT);
    },
    () => {
      return ok(
        soapEnvelope(
          '<LoginResponse xmlns="urn:vim25"><returnval><key>s</key></returnval></LoginResponse>',
        ),
        'vmware_soap_session="session-1"; Path=/; HttpOnly; Secure;',
      );
    },
    ...answers,
  ]);
  const client: VSphereSoapClient = new VSphereSoapClient({
    transport: transport.transport,
    userAgent: "test",
  });

  await client.negotiateVersion();
  await client.retrieveServiceContent();
  await client.login("oneuptime@vsphere.local", "secret");

  return { client: client, requests: transport.requests };
}

describe("VSphereSoapClient", () => {
  test("negotiates vim25's version and speaks it in every SOAPAction", async () => {
    const { client, requests } = await connectedClient([]);

    expect(client.getVimVersion()).toBe("8.0.2.0");
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.path).toBe("/sdk/vimServiceVersions.xml");
    expect(requests[1]!.headers["SOAPAction"]).toBe('"urn:vim25/8.0.2.0"');
    expect(requests[1]!.path).toBe("/sdk");
  });

  test("an address that is not vSphere is said to be so, from the versions file", async () => {
    const notFound: VSphereSoapClient = new VSphereSoapClient({
      transport: scripted([
        () => {
          return { status: 404, headers: {}, body: "<html>Not found</html>" };
        },
      ]).transport,
      userAgent: "test",
    });

    await expect(notFound.negotiateVersion()).rejects.toThrow(
      VSphereNotVSphereError,
    );

    const webPage: VSphereSoapClient = new VSphereSoapClient({
      transport: scripted([
        () => {
          return ok("<!DOCTYPE html><html><body>Welcome</body></html>");
        },
      ]).transport,
      userAgent: "test",
    });

    await expect(webPage.negotiateVersion()).rejects.toThrow(
      "not vSphere's list of API versions",
    );
  });

  test("reads the service content: the managed objects and what vCenter is", async () => {
    const { client } = await connectedClient([]);
    const content: VSphereServiceContent = client.getServiceContent();

    expect(content.rootFolder).toEqual({ type: "Folder", value: "group-d1" });
    expect(content.perfManager).toEqual({
      type: "PerformanceManager",
      value: "PerfMgr",
    });
    expect(content.about).toEqual({
      name: "VMware vCenter Server",
      fullName: "VMware vCenter Server 8.0.2 build-22617221",
      version: "8.0.2",
      build: "22617221",
      apiType: "VirtualCenter",
      apiVersion: "8.0.2.0",
      instanceUuid: "u-1",
    });
  });

  test("logs in with the user name and password escaped, and keeps the session cookie", async () => {
    const transport: ReturnType<typeof scripted> = scripted([
      () => {
        return ok(VERSIONS);
      },
      () => {
        return ok(SERVICE_CONTENT);
      },
      () => {
        return ok(
          soapEnvelope(
            '<LoginResponse xmlns="urn:vim25"><returnval/></LoginResponse>',
          ),
          'vmware_soap_session="abc-123"; Path=/; HttpOnly',
        );
      },
      () => {
        return ok(
          soapEnvelope(
            '<DestroyViewResponse xmlns="urn:vim25"></DestroyViewResponse>',
          ),
        );
      },
    ]);
    const client: VSphereSoapClient = new VSphereSoapClient({
      transport: transport.transport,
      userAgent: "test",
    });

    await client.negotiateVersion();
    await client.retrieveServiceContent();
    await client.login("DOMAIN\\o&u<>", `p"a'ss&<>`);
    await client.destroyView({ type: "ContainerView", value: "v1" });

    const login: VSphereHttpRequest = transport.requests[2]!;
    expect(login.body).toContain(
      "<userName>DOMAIN\\o&amp;u&lt;&gt;</userName>",
    );
    expect(login.body).toContain(
      "<password>p&quot;a&apos;ss&amp;&lt;&gt;</password>",
    );
    expect(login.headers["Cookie"]).toBeUndefined();
    expect(client.getSessionCookie()).toBe('"abc-123"');
    expect(transport.requests[3]!.headers["Cookie"]).toBe(
      'vmware_soap_session="abc-123"',
    );
  });

  test("a refused login is an InvalidLogin fault", async () => {
    const replay: ReplayTransport = createReplayTransport(
      loadExchanges("vcsim-invalid-login.json"),
    );
    const client: VSphereSoapClient = new VSphereSoapClient({
      transport: replay.transport,
      userAgent: "test",
    });

    await client.negotiateVersion();
    await client.retrieveServiceContent();

    const error: unknown = await client
      .login("oneuptime", "wrong")
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(VSphereFault);
    expect((error as VSphereFault).faultType).toBe("InvalidLogin");
    expect((error as VSphereFault).faultString).toBe("Login failure");
    expect(client.getSessionCookie()).toBeNull();
  });

  test("an expired session logs in again once and repeats the call", async () => {
    const { client, requests } = await connectedClient([
      () => {
        return fault("NotAuthenticated", "The session is not authenticated.");
      },
      () => {
        return ok(
          soapEnvelope(
            '<LoginResponse xmlns="urn:vim25"><returnval/></LoginResponse>',
          ),
          'vmware_soap_session="session-2"; Path=/',
        );
      },
      () => {
        return ok(
          soapEnvelope(
            '<CreateContainerViewResponse xmlns="urn:vim25"><returnval type="ContainerView">view-9</returnval></CreateContainerViewResponse>',
          ),
        );
      },
    ]);

    const view: MoRef = await client.createContainerView({
      container: { type: "Folder", value: "group-d1" },
      types: ["HostSystem"],
    });

    expect(view).toEqual({ type: "ContainerView", value: "view-9" });
    expect(
      requests.slice(3).map((request: VSphereHttpRequest) => {
        return soapMethodOf(request.body);
      }),
    ).toEqual(["CreateContainerView", "Login", "CreateContainerView"]);
    expect(requests[5]!.headers["Cookie"]).toBe(
      'vmware_soap_session="session-2"',
    );
  });

  test("a session that cannot be renewed fails, and is not retried forever", async () => {
    const { client } = await connectedClient([
      () => {
        return fault("NotAuthenticated", "The session is not authenticated.");
      },
      () => {
        return fault("InvalidLogin", "Login failure");
      },
    ]);

    await expect(
      client.createContainerView({
        container: { type: "Folder", value: "group-d1" },
        types: ["HostSystem"],
      }),
    ).rejects.toThrow("InvalidLogin");
  });

  test("pages a property read with ContinueRetrievePropertiesEx while vCenter hands back a token", async () => {
    const page: (token: string | null, name: string) => string = (
      token: string | null,
      name: string,
    ): string => {
      return `<returnval>${token ? `<token>${token}</token>` : ""}<objects><obj type="HostSystem">${name}</obj><propSet><name>name</name><val xsi:type="xsd:string">${name}</val></propSet></objects></returnval>`;
    };
    const { client, requests } = await connectedClient([
      () => {
        return ok(
          soapEnvelope(
            `<RetrievePropertiesExResponse xmlns="urn:vim25">${page("t1", "host-1")}</RetrievePropertiesExResponse>`,
          ),
        );
      },
      () => {
        return ok(
          soapEnvelope(
            `<ContinueRetrievePropertiesExResponse xmlns="urn:vim25">${page("t2", "host-2")}</ContinueRetrievePropertiesExResponse>`,
          ),
        );
      },
      () => {
        return ok(
          soapEnvelope(
            `<ContinueRetrievePropertiesExResponse xmlns="urn:vim25">${page(null, "host-3")}</ContinueRetrievePropertiesExResponse>`,
          ),
        );
      },
    ]);

    const objects: Array<VSphereObject> = await client.retrieveFromView({
      view: { type: "ContainerView", value: "v" },
      type: "HostSystem",
      paths: ["name"],
      maxObjects: 1,
    });

    expect(
      objects.map((object: VSphereObject) => {
        return object.ref.value;
      }),
    ).toEqual(["host-1", "host-2", "host-3"]);
    expect(requests[3]!.body).toContain("<maxObjects>1</maxObjects>");
    expect(requests[4]!.body).toContain("<token>t1</token>");
    expect(requests[5]!.body).toContain("<token>t2</token>");
  });

  test("writes the property spec in vim25's element order, with the traversal", async () => {
    const { client, requests } = await connectedClient([
      () => {
        return ok(
          soapEnvelope(
            '<RetrievePropertiesExResponse xmlns="urn:vim25"></RetrievePropertiesExResponse>',
          ),
        );
      },
    ]);

    await client.retrieveFromView({
      view: { type: "ContainerView", value: "v" },
      type: "VirtualMachine",
      paths: ["name", "runtime.powerState"],
      maxObjects: 500,
    });

    const body: string = requests[3]!.body || "";
    expect(body).toContain(
      '<specSet><propSet><type>VirtualMachine</type><all>false</all><pathSet>name</pathSet><pathSet>runtime.powerState</pathSet></propSet><objectSet><obj type="ContainerView">v</obj><skip>true</skip><selectSet xsi:type="TraversalSpec"><name>traverseEntities</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet></objectSet></specSet><options><maxObjects>500</maxObjects></options>',
    );
  });

  test("reads the properties a user may not read as missing, with the fault", async () => {
    const { client } = await connectedClient([
      () => {
        return ok(
          soapEnvelope(
            `<RetrievePropertiesExResponse xmlns="urn:vim25"><returnval><objects><obj type="VirtualMachine">vm-1</obj><propSet><name>name</name><val xsi:type="xsd:string">web-1</val></propSet><missingSet><path>config.instanceUuid</path><fault><fault xsi:type="NoPermission"><privilegeId>System.Read</privilegeId></fault><localizedMessage></localizedMessage></fault></missingSet></objects></returnval></RetrievePropertiesExResponse>`,
          ),
        );
      },
    ]);

    const objects: Array<VSphereObject> = await client.retrieveFromView({
      view: { type: "ContainerView", value: "v" },
      type: "VirtualMachine",
      paths: ["name", "config.instanceUuid"],
      maxObjects: 500,
    });

    expect(objects[0]!.properties.get("name")?.text).toBe("web-1");
    expect(objects[0]!.missing.get("config.instanceUuid")).toBe("NoPermission");
  });

  test("names performance counters group.name.rollup, and caches them", async () => {
    const counter: (
      key: number,
      group: string,
      name: string,
      rollup: string,
    ) => string = (
      key: number,
      group: string,
      name: string,
      rollup: string,
    ): string => {
      return `<PerfCounterInfo><key>${key}</key><nameInfo><key>${name}</key></nameInfo><groupInfo><key>${group}</key></groupInfo><unitInfo><key>kiloBytesPerSecond</key></unitInfo><rollupType>${rollup}</rollupType></PerfCounterInfo>`;
    };
    const { client, requests } = await connectedClient([
      () => {
        return ok(
          soapEnvelope(
            `<RetrievePropertiesExResponse xmlns="urn:vim25"><returnval><objects><obj type="PerformanceManager">PerfMgr</obj><propSet><name>perfCounter</name><val xsi:type="ArrayOfPerfCounterInfo">${counter(
              143,
              "net",
              "usage",
              "average",
            )}${counter(147, "net", "bytesTx", "average")}<PerfCounterInfo><key>x</key></PerfCounterInfo></val></propSet></objects></returnval></RetrievePropertiesExResponse>`,
          ),
        );
      },
    ]);

    const counters: Array<PerfCounterInfo> = await client.getPerfCounters();

    expect(counters).toEqual([
      { key: 143, name: "net.usage.average", unit: "kiloBytesPerSecond" },
      { key: 147, name: "net.bytesTx.average", unit: "kiloBytesPerSecond" },
    ]);

    // Asked once per client.
    expect(await client.getPerfCounters()).toBe(counters);
    expect(requests).toHaveLength(4);
  });

  test("asks QueryPerf in vim25's order and reads every instance's series", async () => {
    const { client, requests } = await connectedClient([
      () => {
        return ok(
          soapEnvelope(
            `<QueryPerfResponse xmlns="urn:vim25"><returnval xsi:type="PerfEntityMetric"><entity type="HostSystem">host-1</entity><sampleInfo><timestamp>2026-10-10T12:00:00Z</timestamp><interval>20</interval></sampleInfo><value xsi:type="PerfMetricIntSeries"><id><counterId>143</counterId><instance></instance></id><value>1200</value></value><value xsi:type="PerfMetricIntSeries"><id><counterId>143</counterId><instance>vmnic0</instance></id><value>700</value></value><value xsi:type="PerfMetricIntSeries"><id><counterId>147</counterId><instance>vmnic0</instance></id></value></returnval></QueryPerfResponse>`,
          ),
        );
      },
    ]);

    const results: Array<PerfEntityMetric> = await client.queryPerf([
      {
        entity: { type: "HostSystem", value: "host-1" },
        counterIds: [143, 147],
        intervalId: 20,
        maxSample: 1,
      },
    ]);

    expect(requests[3]!.body).toContain(
      '<querySpec><entity type="HostSystem">host-1</entity><maxSample>1</maxSample><metricId><counterId>143</counterId><instance>*</instance></metricId><metricId><counterId>147</counterId><instance>*</instance></metricId><intervalId>20</intervalId><format>normal</format></querySpec>',
    );
    expect(results).toEqual([
      {
        entity: { type: "HostSystem", value: "host-1" },
        sampleInfo: [{ timestamp: "2026-10-10T12:00:00Z", interval: 20 }],
        series: [
          { counterId: 143, instance: "", values: [1200] },
          { counterId: 143, instance: "vmnic0", values: [700] },
          { counterId: 147, instance: "vmnic0", values: [] },
        ],
      },
    ]);
  });

  test("a fault naming a managed object hands its reference on", async () => {
    const { client } = await connectedClient([
      () => {
        return fault(
          "ManagedObjectNotFound",
          "The object has already been deleted or has not been completely created",
          '<obj type="VirtualMachine">vm-77</obj>',
        );
      },
    ]);

    const error: unknown = await client
      .queryPerf([
        {
          entity: { type: "VirtualMachine", value: "vm-77" },
          counterIds: [1],
          intervalId: 20,
          maxSample: 1,
        },
      ])
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(VSphereFault);
    expect((error as VSphereFault).faultType).toBe("ManagedObjectNotFound");
    expect((error as VSphereFault).objectRef).toEqual({
      type: "VirtualMachine",
      value: "vm-77",
    });
  });

  test("vSAN's query goes to /vsanHealth in urn:vsan, with the cluster", async () => {
    const { client, requests } = await connectedClient([
      () => {
        return ok(
          soapEnvelope(
            '<VsanPerfQueryPerfResponse xmlns="urn:vsan"><returnval><entityRefId>cluster-domclient:52a1</entityRefId></returnval></VsanPerfQueryPerfResponse>',
          ),
        );
      },
    ]);

    const results: Array<unknown> = await client.queryVsanPerf({
      cluster: { type: "ClusterComputeResource", value: "domain-c8" },
      entityRefId: "cluster-domclient:*",
      labels: ["iopsRead", "congestion"],
      startTime: "2026-10-10T12:00:00.000Z",
      endTime: "2026-10-10T12:00:00.000Z",
    });

    expect(results).toHaveLength(1);
    expect(requests[3]!.path).toBe("/vsanHealth");
    expect(requests[3]!.headers["SOAPAction"]).toBe('"urn:vsan/8.0.2.0"');
    expect(requests[3]!.body).toContain(
      '<VsanPerfQueryPerf xmlns="urn:vsan"><_this type="VsanPerformanceManager">vsan-performance-manager</_this><querySpecs><entityRefId>cluster-domclient:*</entityRefId><startTime>2026-10-10T12:00:00.000Z</startTime><endTime>2026-10-10T12:00:00.000Z</endTime><labels>iopsRead</labels><labels>congestion</labels></querySpecs><cluster type="ClusterComputeResource">domain-c8</cluster></VsanPerfQueryPerf>',
    );
  });

  test("an answer that is not a SOAP envelope is not vSphere", async () => {
    const { client } = await connectedClient([
      () => {
        return { status: 502, headers: {}, body: "Bad gateway" };
      },
    ]);

    await expect(
      client.destroyView({ type: "ContainerView", value: "v" }),
    ).rejects.toThrow(VSphereNotVSphereError);
  });

  test("logout forgets the session even when vCenter refuses it", async () => {
    const { client } = await connectedClient([
      () => {
        return fault("NotAuthenticated", "gone");
      },
    ]);

    await expect(client.logout()).rejects.toThrow(VSphereFault);
    expect(client.getSessionCookie()).toBeNull();
  });

  test("readSessionCookie finds vmware_soap_session among other cookies", () => {
    expect(
      readSessionCookie([
        "other=1; Path=/",
        'vmware_soap_session="xyz"; Path=/; HttpOnly',
      ]),
    ).toBe('"xyz"');
    expect(readSessionCookie("vmware_soap_session=plain; Path=/")).toBe(
      "plain",
    );
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie(["broken"])).toBeNull();
  });
});
