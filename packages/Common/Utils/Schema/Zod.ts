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
 * No frontend loads this module. The API schemas are built in this folder
 * (TypeSchemas, MonitorSchemas, ModelSchema ...), which only the server
 * loads, and Tests/Utils/Schema/ZodOutOfBrowserGuard keeps every frontend's
 * imports clear of it. Should zod reach a browser all the same, it turns no
 * string into code there: zod 4 compiles each object schema's parser with
 * new Function, and checks that it may as the first object schema is made,
 * which a status page refuses and reports (StatusPageContentSecurityPolicy
 * has no 'unsafe-eval'). Jitless zod parses the same, without the compiled
 * fast path; on the server zod keeps it. (Common's jest runs in jsdom, so
 * its tests parse jitless.)
 */
if (typeof window !== "undefined" && typeof window.document !== "undefined") {
  config({ jitless: true });
}

/*
 * The zod functions OneUptime builds its schemas with are picked by name,
 * and nothing here hands zod's namespace around as a value. A bundler keeps
 * all of an object that is passed or exported whole, and zod 4's namespace
 * carries every one of its ~45 locales: while the Types built their schemas
 * and every frontend bundled this module, that was about 480 KB of zod on
 * every page. The list below is also all of zod that OneUptime's schemas
 * use, which is where the next zod upgrade starts.
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
