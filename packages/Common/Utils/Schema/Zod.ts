import {
  extendZodWithOpenApi,
  zodToOpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { holdOpenApiMetadataWeakly } from "./OpenApiMetadataRegistry";
import {
  any,
  array,
  boolean,
  config,
  date,
  enum as zodEnum,
  lazy,
  literal,
  number,
  object,
  string,
  union,
  type z,
  ZodType,
} from "zod";

/*
 * In a browser, zod turns no string into code. zod 4 compiles each object
 * schema's parser with new Function, and checks that it may by calling new
 * Function as the first object schema is made - which the monitor criteria
 * Types do as their modules load, so on every page of every frontend. Status
 * pages forbid that (StatusPageContentSecurityPolicy has no 'unsafe-eval'),
 * and the browser refused it and reported a violation on each load. No
 * frontend parses with zod; jitless zod parses the same, without the
 * compiled fast path. On the server zod keeps it.
 */
if (typeof window !== "undefined" && typeof window.document !== "undefined") {
  config({ jitless: true });
}

/*
 * Every frontend bundles this module: Common's Types (Email, ObjectID,
 * Color, MonitorStep and the rest) build their OpenAPI schema with it, and
 * the Dashboard, Accounts, Admin Dashboard, Status Page and public
 * dashboards all load those Types. So nothing here hands zod's namespace
 * around as a value. A bundler keeps all of an object that is passed or
 * exported whole, and zod 4's namespace carries every one of its ~45 locales:
 * that put about 480 KB of zod (100 KB gzipped) into every frontend, where
 * zod 3 cost 66 KB. Picked by name, zod costs what the schemas below use
 * (Tests/Utils/Schema/ZodBrowserBundle holds the bundle to it).
 *
 * zod-to-openapi's .openapi(): extendZodWithOpenApi adds it to ZodType's
 * prototype and reads nothing else of the zod it is given, so it is given
 * that alone (Tests/Utils/Schema/Zod holds it to reading only ZodType).
 */
extendZodWithOpenApi({ ZodType: ZodType } as unknown as typeof z);

/*
 * And what .openapi() is given lives as long as its schema, not as long as
 * the process (OpenApiMetadataRegistry.ts says why).
 */
holdOpenApiMetadataWeakly(zodToOpenAPIRegistry);

/*
 * The object schema every model schema is: a shape of named fields, and
 * zod's default for keys it does not know (strip them).
 */
export type ZodSchema = z.ZodObject<Record<string, any>, z.core.$strip>;

/*
 * The zod functions OneUptime builds its schemas with. Something else of
 * zod's - a class for instanceof, a type - comes from "zod" itself, after
 * this module has been imported (it adds .openapi()).
 */
const Zod: {
  any: typeof any;
  array: typeof array;
  boolean: typeof boolean;
  date: typeof date;
  enum: typeof zodEnum;
  lazy: typeof lazy;
  literal: typeof literal;
  number: typeof number;
  object: typeof object;
  string: typeof string;
  union: typeof union;
} = {
  any: any,
  array: array,
  boolean: boolean,
  date: date,
  enum: zodEnum,
  lazy: lazy,
  literal: literal,
  number: number,
  object: object,
  string: string,
  union: union,
};

export default Zod;
