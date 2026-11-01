import { beforeAll, describe, expect, it } from "@jest/globals";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";

/*
 * A form's own domains (FormDomain) in the published OpenAPI specification,
 * which API clients and the Terraform provider are generated from
 * (Scripts/TerraformProvider builds oneuptime_form_domain from it): the CRUD
 * routes at /form-domain, and fields described exactly as a status page's
 * domain's are - the parent's column aside - so the provider gives the form
 * domain the same schema it gives oneuptime_status_page_domain: the form,
 * the domain and the subdomain set when it is created and then fixed, the
 * full domain and the verification token computed by the server, the
 * certificate's columns changeable.
 *
 * The whole spec is generated once for the suite: it walks every model.
 */

const HTTP_METHODS: Array<string> = ["get", "post", "put", "delete"];

function propertiesOf(schemas: JSONObject, name: string): Array<string> {
  const schema: JSONObject | undefined = schemas[name] as
    | JSONObject
    | undefined;

  expect({ name, registered: Boolean(schema) }).toEqual({
    name,
    registered: true,
  });

  return Object.keys(((schema as JSONObject)["properties"] as JSONObject) || {})
    .filter((property: string): boolean => {
      // The relation objects the parent columns stand for.
      return !["project", "createdByUser", "deletedByUser"].includes(property);
    })
    .sort();
}

/*
 * A status page domain's property names as a form domain's would be: its
 * parent's columns (statusPage, statusPageId) as the form's (form, formId).
 */
function asFormDomainProperties(properties: Array<string>): Array<string> {
  return properties
    .map((property: string): string => {
      if (property === "statusPageId") {
        return "formId";
      }

      if (property === "statusPage") {
        return "form";
      }

      return property;
    })
    .sort();
}

describe("FormDomain in the OpenAPI specification", () => {
  let paths: JSONObject;
  let schemas: JSONObject;

  beforeAll(() => {
    const spec: JSONObject = OpenAPIUtil.generateOpenAPISpec();

    paths = (spec["paths"] || {}) as JSONObject;
    schemas = ((spec["components"] as JSONObject | undefined)?.["schemas"] ||
      {}) as JSONObject;
  });

  it("has the CRUD routes at /form-domain, named as the provider classifies them", () => {
    const operationIds: Array<string> = [];

    for (const path of Object.keys(paths)) {
      if (path !== "/form-domain" && !path.startsWith("/form-domain/")) {
        continue;
      }

      for (const method of HTTP_METHODS) {
        const operation: JSONObject | undefined = (paths[path] as JSONObject)[
          method
        ] as JSONObject | undefined;

        if (operation) {
          operationIds.push(operation["operationId"] as string);
        }
      }
    }

    for (const operationId of [
      "createFormDomain",
      "getFormDomain",
      "updateFormDomain",
      "deleteFormDomain",
      "listFormDomain",
      "countFormDomain",
    ]) {
      expect({
        operationId,
        documented: operationIds.includes(operationId),
      }).toEqual({ operationId, documented: true });
    }

    expect(
      ((paths["/form-domain"] as JSONObject)["post"] as JSONObject)["tags"],
    ).toEqual(["Form Domain"]);
  });

  it("is created with its form, domain and subdomain, and never with what the server works out", () => {
    const create: Array<string> = propertiesOf(
      schemas,
      "FormDomainCreateSchema",
    );

    for (const property of ["formId", "domainId", "subdomain"]) {
      expect(create).toContain(property);
    }

    for (const property of [
      "fullDomain",
      "cnameVerificationToken",
      "isCnameVerified",
      "isSslOrdered",
      "isSslProvisioned",
      "certificateReissueRequestedAt",
    ]) {
      expect(create).not.toContain(property);
    }
  });

  it("keeps its form, domain and subdomain once created: an update changes only its certificate", () => {
    const update: Array<string> = propertiesOf(
      schemas,
      "FormDomainUpdateSchema",
    );

    for (const property of ["formId", "domainId", "subdomain", "fullDomain"]) {
      expect(update).not.toContain(property);
    }

    expect(update).toContain("customCertificate");
    expect(update).toContain("isCustomCertificate");
  });

  it("reads back the full domain the server worked out", () => {
    expect(propertiesOf(schemas, "FormDomainReadSchema")).toContain(
      "fullDomain",
    );
  });

  it("is described exactly as a status page domain is, its parent aside, and its subdomain fixed", () => {
    for (const kind of ["Create", "Update", "Read"]) {
      /*
       * One difference, on purpose: a status page domain's subdomain can be
       * updated (its full name then no longer follows it), a form domain's
       * cannot - a different subdomain is another domain, added and its old
       * one deleted - so the provider replaces it rather than editing it.
       */
      const statusPageDomain: Array<string> = propertiesOf(
        schemas,
        `StatusPageDomain${kind}Schema`,
      ).filter((property: string): boolean => {
        return kind !== "Update" || property !== "subdomain";
      });

      expect({
        kind,
        properties: propertiesOf(schemas, `FormDomain${kind}Schema`),
      }).toEqual({
        kind,
        properties: asFormDomainProperties(statusPageDomain),
      });
    }

    expect(propertiesOf(schemas, "StatusPageDomainUpdateSchema")).toContain(
      "subdomain",
    );
  });
});
