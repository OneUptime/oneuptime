import { afterEach, describe, expect, test } from "@jest/globals";
import Response from "../../../Server/Utils/Response";
import { getProductBrandingViewVariables } from "../../../Server/Utils/ProductBrandingViewVariables";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import { JSONObject } from "../../../Types/JSON";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";

/*
 * What a server-rendered page is told about the installation's branding:
 * every frontend's index page and every page Response.render renders (sign-in
 * messages, on-call acknowledgements). OneUptime's name and nothing else
 * unless the installation names or shows itself its own way; a page's own
 * variables always win.
 */

afterEach(() => {
  uninstallEnterpriseModule();
});

describe("getProductBrandingViewVariables", () => {
  test("is OneUptime's name and nothing else on the Community Edition", () => {
    uninstallEnterpriseModule();

    expect(getProductBrandingViewVariables()).toEqual({
      productName: "OneUptime",
    });
  });

  test("is OneUptime's name when the installation may brand but has set nothing", () => {
    installFakeEnterpriseModule({ productBranding: {} });

    expect(getProductBrandingViewVariables()).toEqual({
      productName: "OneUptime",
    });
  });

  test("carries the name, the logo and the tab icon the installation has", () => {
    installFakeEnterpriseModule({
      productBranding: {
        productName: "Acme",
        websiteUrl: "https://acme.example",
        logoUrl: "/api/branding/logo?v=1",
        darkLogoUrl: "/api/branding/dark-logo?v=1",
        faviconUrl: "/api/branding/favicon?v=1",
      },
    });

    expect(getProductBrandingViewVariables()).toEqual({
      productName: "Acme",
      productLogoUrl: "/api/branding/logo?v=1",
      productFaviconUrl: "/api/branding/favicon?v=1",
    });
  });
});

describe("Response.render", () => {
  const renderWith: (vars: JSONObject) => JSONObject = (
    vars: JSONObject,
  ): JSONObject => {
    let rendered: JSONObject = {};

    Response.render(
      {} as ExpressRequest,
      {
        render: (_path: string, variables: JSONObject): void => {
          rendered = variables;
        },
      } as unknown as ExpressResponse,
      "/views/ViewMessage.ejs",
      vars,
    );

    return rendered;
  };

  test("hands every server-rendered page the installation's branding", () => {
    installFakeEnterpriseModule({
      productBranding: {
        productName: "Acme",
        logoUrl: "/api/branding/logo?v=1",
      },
    });

    const rendered: JSONObject = renderWith({ title: "Acknowledged" });

    expect(rendered["productName"]).toBe("Acme");
    expect(rendered["productLogoUrl"]).toBe("/api/branding/logo?v=1");
    expect(rendered["title"]).toBe("Acknowledged");
  });

  test("a page's own variables win", () => {
    installFakeEnterpriseModule({ productBranding: { productName: "Acme" } });

    expect(renderWith({ productName: "Override" })["productName"]).toBe(
      "Override",
    );
  });

  test("is OneUptime on the Community Edition", () => {
    expect(renderWith({})["productName"]).toBe("OneUptime");
    expect(renderWith({})).not.toHaveProperty("productLogoUrl");
  });
});
