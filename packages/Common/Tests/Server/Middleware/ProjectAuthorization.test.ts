import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import { ExpressRequest } from "../../../Server/Utils/Express";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

type ObjectIdOrNull = ObjectID | null;

describe("ProjectMiddleware", () => {
  const mockedObjectId: ObjectID = ObjectID.generate();

  describe("getProjectId", () => {
    describe("should return value when tenantid is passed in the request's", () => {
      const reqFields: string[] = ["params", "query", "headers"];
      test.each(reqFields)("%s", (field: string) => {
        const req: Partial<ExpressRequest> = {
          [field]: { tenantid: mockedObjectId.toString() },
        };

        const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
          req as ExpressRequest,
        );

        expect(result).toEqual(mockedObjectId);
      });
    });

    test("should return value when projectid is passed in the request's header", () => {
      const req: Partial<ExpressRequest> = {
        headers: { projectid: mockedObjectId.toString() },
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
        req as ExpressRequest,
      );

      expect(result).toEqual(mockedObjectId);
    });

    test("should return value when projectId is passed in the request's body", () => {
      const req: Partial<ExpressRequest> = {
        body: { projectId: mockedObjectId.toString() },
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
        req as ExpressRequest,
      );

      expect(result).toEqual(mockedObjectId);
    });

    test("should return null when projectId is not passed in the request", () => {
      const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
        {} as ExpressRequest,
      );

      expect(result).toBeNull();
    });

    test("should handle empty headers object", () => {
      const req: Partial<ExpressRequest> = {
        headers: {},
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
        req as ExpressRequest,
      );

      expect(result).toBeNull();
    });

    test("should handle empty params object", () => {
      const req: Partial<ExpressRequest> = {
        params: {},
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
        req as ExpressRequest,
      );

      expect(result).toBeNull();
    });
  });

  describe("getApiKey", () => {
    test("should return apiKey when apikey is passed in the request's header", () => {
      const req: Partial<ExpressRequest> = {
        headers: { apikey: mockedObjectId.toString() },
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getApiKey(
        req as ExpressRequest,
      );

      expect(result).toEqual(mockedObjectId);
    });

    test("should return null when apikey is not passed in the request's header", () => {
      const result: ObjectIdOrNull = ProjectMiddleware.getApiKey(
        {} as ExpressRequest,
      );

      expect(result).toBeNull();
    });

    test("should handle empty headers", () => {
      const req: Partial<ExpressRequest> = {
        headers: {},
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getApiKey(
        req as ExpressRequest,
      );

      expect(result).toBeNull();
    });

    test("should handle undefined apikey header", () => {
      const req: Partial<ExpressRequest> = {
        headers: { apikey: undefined },
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getApiKey(
        req as ExpressRequest,
      );

      expect(result).toBeNull();
    });
  });

  describe("hasApiKey", () => {
    test("should return true when getApiKey returns a non-null value", () => {
      const req: Partial<ExpressRequest> = {
        headers: { apikey: mockedObjectId.toString() },
      };

      const result: boolean = ProjectMiddleware.hasApiKey(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(true);
    });

    test("should return false when getApiKey returns null", () => {
      const req: Partial<ExpressRequest> = { headers: {} };

      const result: boolean = ProjectMiddleware.hasApiKey(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(false);
    });

    test("should return false for empty request", () => {
      const req: Partial<ExpressRequest> = {};

      const result: boolean = ProjectMiddleware.hasApiKey(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(false);
    });
  });

  describe("hasProjectID", () => {
    test("should return true when getProjectId returns a non-null value", () => {
      const req: Partial<ExpressRequest> = {
        headers: { tenantid: mockedObjectId.toString() },
      };

      const result: boolean = ProjectMiddleware.hasProjectID(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(true);
    });

    test("should return false when getProjectId returns null", () => {
      const req: Partial<ExpressRequest> = { headers: {} };

      const result: boolean = ProjectMiddleware.hasProjectID(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(false);
    });

    test("should return true when projectid is in header", () => {
      const req: Partial<ExpressRequest> = {
        headers: { projectid: mockedObjectId.toString() },
      };

      const result: boolean = ProjectMiddleware.hasProjectID(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(true);
    });

    test("should return true when projectId is in body", () => {
      const req: Partial<ExpressRequest> = {
        body: { projectId: mockedObjectId.toString() },
      };

      const result: boolean = ProjectMiddleware.hasProjectID(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(true);
    });

    test("should return true when tenantid is in params", () => {
      const req: Partial<ExpressRequest> = {
        params: { tenantid: mockedObjectId.toString() },
      };

      const result: boolean = ProjectMiddleware.hasProjectID(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(true);
    });

    test("should return true when tenantid is in query", () => {
      const req: Partial<ExpressRequest> = {
        query: { tenantid: mockedObjectId.toString() },
      };

      const result: boolean = ProjectMiddleware.hasProjectID(
        req as ExpressRequest,
      );

      expect(result).toStrictEqual(true);
    });
  });

  describe("ObjectID handling", () => {
    test("should handle valid ObjectID string", () => {
      const validId: ObjectID = ObjectID.generate();
      const req: Partial<ExpressRequest> = {
        headers: { tenantid: validId.toString() },
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
        req as ExpressRequest,
      );

      expect(result?.toString()).toBe(validId.toString());
    });

    test("should handle multiple ID sources with priority", () => {
      const headerId: ObjectID = ObjectID.generate();
      const bodyId: ObjectID = ObjectID.generate();
      const req: Partial<ExpressRequest> = {
        headers: { tenantid: headerId.toString() },
        body: { projectId: bodyId.toString() },
      };

      const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
        req as ExpressRequest,
      );

      // Headers should take priority
      expect(result?.toString()).toBe(headerId.toString());
    });
  });
});
