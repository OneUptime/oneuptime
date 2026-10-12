import { describe, expect, test } from "@jest/globals";
import {
  getApiReferencePagePath,
  isInApiReference,
} from "../../Utils/ApiReferencePage";
import AnalyticsModels from "../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";
import Profile from "../../Models/AnalyticsModels/Profile";
import Span from "../../Models/AnalyticsModels/Span";
import DatabaseModels from "../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Project from "../../Models/DatabaseModels/Project";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import User from "../../Models/DatabaseModels/User";
import Route from "../../Types/API/Route";

/*
 * Whether the API Reference has a page for a model, and where.
 *
 * The Show ID dialog offers "Go to API Docs" from this rule, and the API
 * Reference lists its pages from it (APIReference/Utils/Resources.ts - the
 * App suite ApiReferencePagesMatchShowId holds the two together). The dialog
 * used to offer the button for every model, so on a Profile, an Enterprise
 * license or, in SaaS, a project or a user, it led to "Page not found".
 */

const SELF_HOSTED: { isBillingEnabled: boolean } = { isBillingEnabled: false };
const SAAS: { isBillingEnabled: boolean } = { isBillingEnabled: true };

describe("the models Show ID is offered on", () => {
  test("an LLM call or a span: the span API's page", () => {
    expect(getApiReferencePagePath(new Span(), SELF_HOSTED)).toBe("span");
    expect(getApiReferencePagePath(new Span(), SAAS)).toBe("span");
  });

  test("an exception occurrence: the exceptions API's page", () => {
    expect(getApiReferencePagePath(new ExceptionInstance(), SAAS)).toBe(
      "exceptions",
    );
  });

  test("a profile: none, the API Reference does not document profiles", () => {
    expect(isInApiReference(new Profile(), SELF_HOSTED)).toBe(false);
    expect(getApiReferencePagePath(new Profile(), SELF_HOSTED)).toBeNull();
    expect(getApiReferencePagePath(new Profile(), SAAS)).toBeNull();
  });

  test("database models with pages keep them, in both builds", () => {
    for (const model of [
      new Monitor(),
      new IncidentState(),
      new StatusPageResource(),
      new StatusPageGroup(),
    ]) {
      const path: string | null = getApiReferencePagePath(model, SAAS);

      expect(path).toBe(model.getAPIDocumentationPath());
      expect(getApiReferencePagePath(model, SELF_HOSTED)).toBe(path);
    }

    expect(getApiReferencePagePath(new Monitor(), SAAS)).toBe("monitor");
  });

  test("master-admin APIs are documented on a self-hosted install, not in SaaS", () => {
    for (const model of [new Project(), new User()]) {
      expect(model.isMasterAdminApiDocs).toBe(true);
      expect(getApiReferencePagePath(model, SELF_HOSTED)).toBe(
        model.getAPIDocumentationPath(),
      );
      expect(getApiReferencePagePath(model, SAAS)).toBeNull();
    }
  });
});

describe("the rule", () => {
  test("a model that does not opt in has no page", () => {
    const monitor: Monitor = new Monitor();
    monitor.enableDocumentation = false;

    expect(isInApiReference(monitor, SELF_HOSTED)).toBe(false);
    expect(getApiReferencePagePath(monitor, SELF_HOSTED)).toBeNull();
  });

  test("an analytics model needs a CRUD route as well", () => {
    const span: Span = new Span();
    expect(isInApiReference(span, SAAS)).toBe(true);

    span.crudApiPath = undefined;

    expect(isInApiReference(span, SAAS)).toBe(false);
  });

  test("a database model is documented without one, as the API Reference always had it", () => {
    const monitor: Monitor = new Monitor();
    monitor.crudApiPath = null;

    expect(isInApiReference(monitor, SAAS)).toBe(true);
  });

  test("the page is the model's documentation path", () => {
    const span: Span = new Span();
    span.crudApiPath = new Route("/span");

    expect(getApiReferencePagePath(span, SAAS)).toBe(
      span.getAPIDocumentationPath(),
    );
  });

  test("every database model answers, and a documented one with a path", () => {
    for (const modelType of DatabaseModels) {
      const model: DatabaseBaseModel = new modelType();

      for (const options of [SELF_HOSTED, SAAS]) {
        const path: string | null = getApiReferencePagePath(model, options);

        if (isInApiReference(model, options)) {
          expect({ model: model.tableName, path }).toEqual({
            model: model.tableName,
            path: model.getAPIDocumentationPath(),
          });
          expect(path).toBeTruthy();
        } else {
          expect({ model: model.tableName, path }).toEqual({
            model: model.tableName,
            path: null,
          });
        }
      }
    }
  });

  test("every analytics model answers, and a documented one has a CRUD route", () => {
    for (const modelType of AnalyticsModels) {
      const model: AnalyticsBaseModel = new modelType();

      for (const options of [SELF_HOSTED, SAAS]) {
        if (isInApiReference(model, options)) {
          expect(model.enableDocumentation).toBe(true);
          expect(model.crudApiPath).toBeTruthy();
          expect(getApiReferencePagePath(model, options)).toBe(
            model.getAPIDocumentationPath(),
          );
        } else {
          expect(getApiReferencePagePath(model, options)).toBeNull();
        }
      }
    }
  });
});
