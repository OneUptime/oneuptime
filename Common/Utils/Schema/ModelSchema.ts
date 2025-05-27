import {z} from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export default z; 

export type ModelSchemaType = z.ZodObject<
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