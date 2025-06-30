import Dictionary from "../../../Types/Dictionary";
import GenericObject from "../../../Types/GenericObject";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import axios from "axios";
import http from "http";
import https from "https";
import crypto from "crypto";
import vm, { Context } from "node:vm";
import CaptureSpan from "../Telemetry/CaptureSpan";

export default class VMRunner {
  @CaptureSpan()
  public static async runCodeInSandbox(data: {
    code: string;
    options: {
      timeout?: number;
      args?: JSONObject | undefined;
      context?: Dictionary<GenericObject | string> | undefined;
    };
  }): Promise<ReturnResult> {
    const { code, options } = data;

    const logMessages: string[] = [];

    let sandbox: Context = {
      console: {
        log: (...args: JSONValue[]) => {
          logMessages.push(args.join(" "));
        },
      },
      http: http,
      https: https,
      axios: axios,
      crypto: crypto,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      ...options.context,
    };

    if (options.args) {
      sandbox = {
        ...sandbox,
        args: options.args,
      };
    }

    vm.createContext(sandbox); // Contextify the object.

    const script: string =
      `(async()=>{
            ${code}
        })()` || "";

    const returnVal: any = await vm.runInContext(script, sandbox, {
      timeout: options.timeout || 5000,
    }); // run the script

    return {
      returnValue: returnVal,
      logMessages,
    };
  }
}
