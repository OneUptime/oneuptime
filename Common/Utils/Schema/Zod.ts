import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export type ZodSchema = z.ZodObject<
  Record<string, any>,
  "strip",
  z.ZodTypeAny,
  {
    [x: string]: any;
  },
  {
    [x: string]: any;
  }
>;

const Zod: typeof z = z;

export default Zod;
