import VSphereXml, { XmlElement, escapeXml, parseXml } from "./VSphereXml";

/*
 * A minimal client for vSphere's web services API (vim25 SOAP), with just
 * the calls the VMware collection makes - the same ones the VMware agent's
 * vcenter receiver makes through govmomi:
 *
 *   GET  /sdk/vimServiceVersions.xml   which API version vCenter speaks
 *   RetrieveServiceContent             the managed objects to talk to, and
 *                                      what vCenter is (about)
 *   Login / Logout                     a session, kept in its cookie
 *   CreateContainerView / DestroyView  "every X under Y"
 *   RetrievePropertiesEx / Continue... the properties of a view's objects,
 *                                      a page at a time
 *   QueryPerf                          real-time performance counters
 *
 * plus vSAN's VsanPerfQueryPerf on /vsanHealth.
 *
 * The transport is handed in: VSphereHttp sends over a verified TLS socket,
 * and the tests replay answers recorded from a vSphere simulator.
 */

export interface MoRef {
  type: string;
  value: string;
}

export interface VSphereHttpRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

export interface VSphereHttpResponse {
  status: number;
  headers: Record<string, string | Array<string> | undefined>;
  body: string;
}

export type VSphereTransport = (
  request: VSphereHttpRequest,
) => Promise<VSphereHttpResponse>;

export interface VSphereAbout {
  name: string | null;
  fullName: string | null;
  version: string | null;
  build: string | null;
  apiType: string | null;
  apiVersion: string | null;
  instanceUuid: string | null;
}

export interface VSphereServiceContent {
  rootFolder: MoRef;
  propertyCollector: MoRef;
  viewManager: MoRef;
  sessionManager: MoRef;
  perfManager: MoRef | null;
  about: VSphereAbout;
}

// One object a property collector returned, its properties by path.
export interface VSphereObject {
  ref: MoRef;
  properties: Map<string, XmlElement>;
  // Paths it could not read, with the fault's type (NoPermission ...).
  missing: Map<string, string>;
}

export interface PerfCounterInfo {
  key: number;
  // "group.name.rollup", e.g. "net.bytesTx.average".
  name: string;
  unit: string | null;
}

export interface PerfSampleInfo {
  timestamp: string;
  interval: number;
}

export interface PerfSeries {
  counterId: number;
  instance: string;
  values: Array<number>;
}

export interface PerfEntityMetric {
  entity: MoRef;
  sampleInfo: Array<PerfSampleInfo>;
  series: Array<PerfSeries>;
}

export interface PerfQuery {
  entity: MoRef;
  counterIds: Array<number>;
  intervalId: number;
  maxSample: number;
}

// A fault vSphere answered with.
export class VSphereFault extends Error {
  public readonly faultType: string;
  public readonly faultString: string;
  // A managed object the fault names (ManagedObjectNotFound's obj).
  public readonly objectRef: MoRef | null;

  public constructor(data: {
    faultType: string;
    faultString: string;
    objectRef?: MoRef | null | undefined;
  }) {
    super(
      data.faultString
        ? `${data.faultType}: ${data.faultString}`
        : data.faultType,
    );
    this.name = "VSphereFault";
    this.faultType = data.faultType;
    this.faultString = data.faultString;
    this.objectRef = data.objectRef || null;
  }
}

// An answer that is not vSphere's: wrong path, a web page, a proxy.
export class VSphereNotVSphereError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "VSphereNotVSphereError";
  }
}

const SOAP_ENVELOPE_START: string =
  '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body>';
const SOAP_ENVELOPE_END: string = "</soapenv:Body></soapenv:Envelope>";

const SESSION_COOKIE_NAME: string = "vmware_soap_session";

// The API version spoken when vCenter does not say: every vSphere 6.5+ reads it.
export const DEFAULT_VIM_VERSION: string = "6.5";

const VIM_NAMESPACE: string = "urn:vim25";
const VSAN_NAMESPACE: string = "urn:vsan";
const NOT_AUTHENTICATED_PATTERN: RegExp = /not authenticated/i;

export function morefXml(tag: string, ref: MoRef): string {
  return `<${tag} type="${escapeXml(ref.type)}">${escapeXml(ref.value)}</${tag}>`;
}

export function readMoRef(
  element: XmlElement | null | undefined,
): MoRef | null {
  if (!element) {
    return null;
  }

  const value: string = element.text.trim();
  const type: string | undefined = element.attributes["type"];

  if (!value || !type) {
    return null;
  }

  return { type: type, value: value };
}

/*
 * The vmware_soap_session cookie from a Set-Cookie header, written back the
 * way vCenter wants it in Cookie (quotes included).
 */
export function readSessionCookie(
  setCookie: string | Array<string> | undefined,
): string | null {
  const headers: Array<string> = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];

  for (const header of headers) {
    const firstPart: string = header.split(";")[0] || "";
    const equals: number = firstPart.indexOf("=");

    if (equals === -1) {
      continue;
    }

    if (firstPart.substring(0, equals).trim() === SESSION_COOKIE_NAME) {
      return firstPart.substring(equals + 1).trim();
    }
  }

  return null;
}

export default class VSphereSoapClient {
  private readonly transport: VSphereTransport;
  private readonly userAgent: string;
  private vimVersion: string = DEFAULT_VIM_VERSION;
  private sessionCookie: string | null;
  private serviceContent: VSphereServiceContent | null = null;
  private perfCounters: Array<PerfCounterInfo> | null = null;
  private credentials: { username: string; password: string } | null = null;

  public constructor(data: {
    transport: VSphereTransport;
    userAgent: string;
    sessionCookie?: string | null | undefined;
  }) {
    this.transport = data.transport;
    this.userAgent = data.userAgent;
    this.sessionCookie = data.sessionCookie || null;
  }

  public getSessionCookie(): string | null {
    return this.sessionCookie;
  }

  public getVimVersion(): string {
    return this.vimVersion;
  }

  public getServiceContent(): VSphereServiceContent {
    if (!this.serviceContent) {
      throw new Error("RetrieveServiceContent has not run.");
    }

    return this.serviceContent;
  }

  /*
   * Which vim25 version vCenter speaks, from /sdk/vimServiceVersions.xml.
   * This is also the first sign the address is vSphere at all: anything else
   * answers that path with a 404 or a web page.
   */
  public async negotiateVersion(): Promise<string> {
    const response: VSphereHttpResponse = await this.transport({
      method: "GET",
      path: "/sdk/vimServiceVersions.xml",
      headers: { "User-Agent": this.userAgent },
    });

    if (response.status !== 200) {
      throw new VSphereNotVSphereError(
        `The address answered HTTP ${response.status} for /sdk/vimServiceVersions.xml, which every vCenter Server and ESXi host serves.`,
      );
    }

    let document: XmlElement;
    try {
      document = parseXml(response.body);
    } catch {
      throw new VSphereNotVSphereError(
        "The address answered /sdk/vimServiceVersions.xml with something that is not vSphere's list of API versions.",
      );
    }

    for (const namespace of VSphereXml.children(document, "namespace")) {
      if (VSphereXml.childText(namespace, "name")?.trim() === VIM_NAMESPACE) {
        const version: string | undefined = VSphereXml.childText(
          namespace,
          "version",
        )?.trim();

        if (version) {
          this.vimVersion = version;
          return version;
        }
      }
    }

    throw new VSphereNotVSphereError(
      "The address's /sdk/vimServiceVersions.xml does not list the vim25 API.",
    );
  }

  public async retrieveServiceContent(): Promise<VSphereServiceContent> {
    const response: XmlElement = await this.call(
      "RetrieveServiceContent",
      morefXml("_this", { type: "ServiceInstance", value: "ServiceInstance" }),
      { isAuthenticated: false },
    );

    const content: XmlElement | null = VSphereXml.child(response, "returnval");
    const about: XmlElement | null = VSphereXml.child(content, "about");

    const required: (name: string) => MoRef = (name: string): MoRef => {
      const ref: MoRef | null = readMoRef(VSphereXml.child(content, name));

      if (!ref) {
        throw new VSphereNotVSphereError(
          `vSphere's service content has no ${name}.`,
        );
      }

      return ref;
    };

    const aboutText: (name: string) => string | null = (
      name: string,
    ): string | null => {
      const text: string | null = VSphereXml.childText(about, name);
      return text === null ? null : text.trim() || null;
    };

    this.serviceContent = {
      rootFolder: required("rootFolder"),
      propertyCollector: required("propertyCollector"),
      viewManager: required("viewManager"),
      sessionManager: required("sessionManager"),
      perfManager: readMoRef(VSphereXml.child(content, "perfManager")),
      about: {
        name: aboutText("name"),
        fullName: aboutText("fullName"),
        version: aboutText("version"),
        build: aboutText("build"),
        apiType: aboutText("apiType"),
        apiVersion: aboutText("apiVersion"),
        instanceUuid: aboutText("instanceUuid"),
      },
    };

    return this.serviceContent;
  }

  public async login(username: string, password: string): Promise<void> {
    this.credentials = { username: username, password: password };
    await this.loginWithSavedCredentials();
  }

  // Whether the session the client started with (a cached one) is alive.
  public hasSession(): boolean {
    return this.sessionCookie !== null;
  }

  public setCredentials(username: string, password: string): void {
    this.credentials = { username: username, password: password };
  }

  public async logout(): Promise<void> {
    if (!this.sessionCookie || !this.serviceContent) {
      return;
    }

    try {
      await this.call(
        "Logout",
        morefXml("_this", this.serviceContent.sessionManager),
        { isAuthenticated: false },
      );
    } finally {
      this.sessionCookie = null;
    }
  }

  public async createContainerView(data: {
    container: MoRef;
    types: Array<string>;
  }): Promise<MoRef> {
    const content: VSphereServiceContent = this.getServiceContent();
    const response: XmlElement = await this.call(
      "CreateContainerView",
      morefXml("_this", content.viewManager) +
        morefXml("container", data.container) +
        data.types
          .map((type: string): string => {
            return `<type>${escapeXml(type)}</type>`;
          })
          .join("") +
        "<recursive>true</recursive>",
    );

    const view: MoRef | null = readMoRef(
      VSphereXml.child(response, "returnval"),
    );

    if (!view) {
      throw new VSphereNotVSphereError("CreateContainerView returned no view.");
    }

    return view;
  }

  public async destroyView(view: MoRef): Promise<void> {
    await this.call("DestroyView", morefXml("_this", view));
  }

  /*
   * Every object of `type` in a container view with the given properties, a
   * page of `maxObjects` at a time (RetrievePropertiesEx, then
   * ContinueRetrievePropertiesEx while vCenter hands back a token) - so one
   * answer never holds a whole large inventory.
   */
  public async retrieveFromView(data: {
    view: MoRef;
    type: string;
    paths: Array<string>;
    maxObjects: number;
  }): Promise<Array<VSphereObject>> {
    const spec: string =
      "<specSet>" +
      `<propSet><type>${escapeXml(data.type)}</type><all>false</all>` +
      data.paths
        .map((path: string): string => {
          return `<pathSet>${escapeXml(path)}</pathSet>`;
        })
        .join("") +
      "</propSet>" +
      "<objectSet>" +
      morefXml("obj", data.view) +
      "<skip>true</skip>" +
      '<selectSet xsi:type="TraversalSpec"><name>traverseEntities</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet>' +
      "</objectSet>" +
      "</specSet>";

    return await this.retrievePaged(spec, data.maxObjects);
  }

  // The properties of one object, read directly.
  public async retrieveObject(data: {
    ref: MoRef;
    type: string;
    paths: Array<string>;
  }): Promise<VSphereObject | null> {
    const spec: string =
      "<specSet>" +
      `<propSet><type>${escapeXml(data.type)}</type><all>false</all>` +
      data.paths
        .map((path: string): string => {
          return `<pathSet>${escapeXml(path)}</pathSet>`;
        })
        .join("") +
      "</propSet>" +
      "<objectSet>" +
      morefXml("obj", data.ref) +
      "<skip>false</skip>" +
      "</objectSet>" +
      "</specSet>";

    const objects: Array<VSphereObject> = await this.retrievePaged(spec, 1);
    return objects[0] || null;
  }

  // The performance counters this vCenter defines, by name.
  public async getPerfCounters(): Promise<Array<PerfCounterInfo>> {
    if (this.perfCounters) {
      return this.perfCounters;
    }

    const content: VSphereServiceContent = this.getServiceContent();

    if (!content.perfManager) {
      this.perfCounters = [];
      return this.perfCounters;
    }

    const manager: VSphereObject | null = await this.retrieveObject({
      ref: content.perfManager,
      type: "PerformanceManager",
      paths: ["perfCounter"],
    });

    const list: XmlElement | undefined = manager?.properties.get("perfCounter");
    const counters: Array<PerfCounterInfo> = [];

    for (const info of list?.children || []) {
      const key: number = Number.parseInt(
        VSphereXml.childText(info, "key") || "",
        10,
      );
      const group: string | undefined = VSphereXml.path(info, [
        "groupInfo",
        "key",
      ])?.text.trim();
      const name: string | undefined = VSphereXml.path(info, [
        "nameInfo",
        "key",
      ])?.text.trim();
      const rollup: string | undefined = VSphereXml.childText(
        info,
        "rollupType",
      )?.trim();
      const unit: string | null =
        VSphereXml.path(info, ["unitInfo", "key"])?.text.trim() || null;

      if (!Number.isFinite(key) || !group || !name || !rollup) {
        continue;
      }

      counters.push({
        key: key,
        name: `${group}.${name}.${rollup}`,
        unit: unit,
      });
    }

    this.perfCounters = counters;
    return counters;
  }

  // Real-time samples of the given counters, every instance ("*").
  public async queryPerf(
    queries: Array<PerfQuery>,
  ): Promise<Array<PerfEntityMetric>> {
    const content: VSphereServiceContent = this.getServiceContent();

    if (!content.perfManager || queries.length === 0) {
      return [];
    }

    const body: string =
      morefXml("_this", content.perfManager) +
      queries
        .map((query: PerfQuery): string => {
          return (
            "<querySpec>" +
            morefXml("entity", query.entity) +
            `<maxSample>${query.maxSample}</maxSample>` +
            query.counterIds
              .map((counterId: number): string => {
                return `<metricId><counterId>${counterId}</counterId><instance>*</instance></metricId>`;
              })
              .join("") +
            `<intervalId>${query.intervalId}</intervalId>` +
            "<format>normal</format>" +
            "</querySpec>"
          );
        })
        .join("");

    const response: XmlElement = await this.call("QueryPerf", body);
    const results: Array<PerfEntityMetric> = [];

    for (const entityMetric of VSphereXml.children(response, "returnval")) {
      const entity: MoRef | null = readMoRef(
        VSphereXml.child(entityMetric, "entity"),
      );

      if (!entity) {
        continue;
      }

      results.push({
        entity: entity,
        sampleInfo: VSphereXml.children(entityMetric, "sampleInfo").map(
          (sample: XmlElement): PerfSampleInfo => {
            return {
              timestamp: (
                VSphereXml.childText(sample, "timestamp") || ""
              ).trim(),
              interval: Number.parseInt(
                VSphereXml.childText(sample, "interval") || "20",
                10,
              ),
            };
          },
        ),
        series: VSphereXml.children(entityMetric, "value").map(
          (series: XmlElement): PerfSeries => {
            return {
              counterId: Number.parseInt(
                VSphereXml.path(series, ["id", "counterId"])?.text || "",
                10,
              ),
              instance: VSphereXml.path(series, ["id", "instance"])?.text || "",
              values: VSphereXml.children(series, "value").map(
                (value: XmlElement): number => {
                  return Number.parseInt(value.text, 10);
                },
              ),
            };
          },
        ),
      });
    }

    return results;
  }

  /*
   * vSAN's performance service (VsanPerfQueryPerf on /vsanHealth) for one
   * cluster: CSV samples per entity. Answers [] when the call is not
   * supported there.
   */
  public async queryVsanPerf(data: {
    cluster: MoRef;
    entityRefId: string;
    labels: Array<string>;
    startTime: string;
    endTime: string;
  }): Promise<Array<XmlElement>> {
    const body: string =
      morefXml("_this", {
        type: "VsanPerformanceManager",
        value: "vsan-performance-manager",
      }) +
      "<querySpecs>" +
      `<entityRefId>${escapeXml(data.entityRefId)}</entityRefId>` +
      `<startTime>${escapeXml(data.startTime)}</startTime>` +
      `<endTime>${escapeXml(data.endTime)}</endTime>` +
      data.labels
        .map((label: string): string => {
          return `<labels>${escapeXml(label)}</labels>`;
        })
        .join("") +
      "</querySpecs>" +
      morefXml("cluster", data.cluster);

    const response: XmlElement = await this.call("VsanPerfQueryPerf", body, {
      path: "/vsanHealth",
      namespace: VSAN_NAMESPACE,
    });

    return VSphereXml.children(response, "returnval");
  }

  private async retrievePaged(
    specSet: string,
    maxObjects: number,
  ): Promise<Array<VSphereObject>> {
    const content: VSphereServiceContent = this.getServiceContent();
    const objects: Array<VSphereObject> = [];

    let response: XmlElement = await this.call(
      "RetrievePropertiesEx",
      morefXml("_this", content.propertyCollector) +
        specSet +
        `<options><maxObjects>${Math.max(1, Math.floor(maxObjects))}</maxObjects></options>`,
    );

    for (let page: number = 0; page < 100_000; page++) {
      const result: XmlElement | null = VSphereXml.child(response, "returnval");

      if (!result) {
        break;
      }

      for (const objectContent of VSphereXml.children(result, "objects")) {
        const ref: MoRef | null = readMoRef(
          VSphereXml.child(objectContent, "obj"),
        );

        if (!ref) {
          continue;
        }

        const properties: Map<string, XmlElement> = new Map();

        for (const property of VSphereXml.children(objectContent, "propSet")) {
          const name: string | null = VSphereXml.childText(property, "name");
          const value: XmlElement | null = VSphereXml.child(property, "val");

          if (name && value) {
            properties.set(name.trim(), value);
          }
        }

        const missing: Map<string, string> = new Map();

        for (const missingProperty of VSphereXml.children(
          objectContent,
          "missingSet",
        )) {
          const path: string | null = VSphereXml.childText(
            missingProperty,
            "path",
          );
          const fault: XmlElement | null = VSphereXml.child(
            missingProperty,
            "fault",
          );
          const faultType: string =
            VSphereXml.xsiType(VSphereXml.child(fault, "fault")) ||
            VSphereXml.xsiType(fault) ||
            "Fault";

          if (path) {
            missing.set(path.trim(), faultType);
          }
        }

        objects.push({ ref: ref, properties: properties, missing: missing });
      }

      const token: string | null = VSphereXml.childText(result, "token");

      if (!token || !token.trim()) {
        break;
      }

      response = await this.call(
        "ContinueRetrievePropertiesEx",
        morefXml("_this", content.propertyCollector) +
          `<token>${escapeXml(token.trim())}</token>`,
      );
    }

    return objects;
  }

  private async loginWithSavedCredentials(): Promise<void> {
    const content: VSphereServiceContent = this.getServiceContent();

    if (!this.credentials) {
      throw new Error("No credentials to log in with.");
    }

    this.sessionCookie = null;

    await this.call(
      "Login",
      morefXml("_this", content.sessionManager) +
        `<userName>${escapeXml(this.credentials.username)}</userName>` +
        `<password>${escapeXml(this.credentials.password)}</password>`,
      { isAuthenticated: false, isLogin: true },
    );

    if (!this.sessionCookie) {
      throw new VSphereNotVSphereError(
        "vSphere accepted the login but set no session cookie.",
      );
    }
  }

  /*
   * One SOAP call: the method's response element, or the fault vSphere
   * answered with. A call made with a session that has expired logs in again
   * once, with the saved credentials, and is made again.
   */
  public async call(
    method: string,
    bodyXml: string,
    options: {
      isAuthenticated?: boolean | undefined;
      isLogin?: boolean | undefined;
      path?: string | undefined;
      namespace?: string | undefined;
    } = {},
  ): Promise<XmlElement> {
    try {
      return await this.callOnce(method, bodyXml, options);
    } catch (error) {
      const canRetry: boolean =
        options.isAuthenticated !== false &&
        !options.isLogin &&
        error instanceof VSphereFault &&
        error.faultType === "NotAuthenticated" &&
        this.credentials !== null;

      if (!canRetry) {
        throw error;
      }

      await this.loginWithSavedCredentials();
      return await this.callOnce(method, bodyXml, options);
    }
  }

  private async callOnce(
    method: string,
    bodyXml: string,
    options: {
      isAuthenticated?: boolean | undefined;
      isLogin?: boolean | undefined;
      path?: string | undefined;
      namespace?: string | undefined;
    },
  ): Promise<XmlElement> {
    const namespace: string = options.namespace || VIM_NAMESPACE;

    const headers: Record<string, string> = {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `"${namespace}/${this.vimVersion}"`,
      "User-Agent": this.userAgent,
    };

    if (this.sessionCookie) {
      headers["Cookie"] = `${SESSION_COOKIE_NAME}=${this.sessionCookie}`;
    }

    const response: VSphereHttpResponse = await this.transport({
      method: "POST",
      path: options.path || "/sdk",
      headers: headers,
      body: `${SOAP_ENVELOPE_START}<${method} xmlns="${namespace}">${bodyXml}</${method}>${SOAP_ENVELOPE_END}`,
    });

    const cookie: string | null = readSessionCookie(
      response.headers["set-cookie"],
    );

    if (cookie) {
      this.sessionCookie = cookie;
    }

    let envelope: XmlElement;

    try {
      envelope = parseXml(response.body);
    } catch {
      throw new VSphereNotVSphereError(
        `The address answered ${method} with HTTP ${response.status} and no SOAP envelope: it is not a vSphere API.`,
      );
    }

    const body: XmlElement | null = VSphereXml.child(envelope, "Body");

    if (envelope.name !== "Envelope" || !body) {
      throw new VSphereNotVSphereError(
        `The address answered ${method} with something that is not a SOAP envelope.`,
      );
    }

    const fault: XmlElement | null = VSphereXml.child(body, "Fault");

    if (fault) {
      throw VSphereSoapClient.readFault(fault);
    }

    const result: XmlElement | null = VSphereXml.child(
      body,
      `${method}Response`,
    );

    if (!result) {
      throw new VSphereNotVSphereError(
        `vSphere answered ${method} without a ${method}Response.`,
      );
    }

    return result;
  }

  public static readFault(fault: XmlElement): VSphereFault {
    const faultString: string = (
      VSphereXml.childText(fault, "faultstring") || ""
    ).trim();
    const detail: XmlElement | null = VSphereXml.child(fault, "detail");
    const detailFault: XmlElement | undefined = detail?.children[0];

    /*
     * The fault's type is its detail element's xsi:type ("InvalidLogin"),
     * or the element's name less its "Fault" suffix.
     */
    let faultType: string =
      VSphereXml.xsiType(detailFault) ||
      (detailFault?.name.endsWith("Fault")
        ? detailFault.name.substring(0, detailFault.name.length - 5)
        : detailFault?.name) ||
      "";

    if (!faultType) {
      faultType = NOT_AUTHENTICATED_PATTERN.test(faultString)
        ? "NotAuthenticated"
        : "Fault";
    }

    return new VSphereFault({
      faultType: faultType,
      faultString: faultString,
      objectRef: readMoRef(VSphereXml.child(detailFault, "obj")),
    });
  }
}
