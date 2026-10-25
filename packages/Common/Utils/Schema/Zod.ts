import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

/*
 * The object schema every model schema is: a shape of named fields, and
 * zod's default for keys it does not know (strip them).
 */
export type ZodSchema = z.ZodObject<Record<string, any>, z.core.$strip>;

const Zod: typeof z = z;

export default Zod;
