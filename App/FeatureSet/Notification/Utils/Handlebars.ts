import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import fsp from "fs/promises";
import Handlebars from "handlebars";
import Path from "path";

const loadPartials: PromiseVoidFunction = async (): Promise<void> => {
  // get all partials in the partial folder and comile then and register then as partials in handlebars.
  const partialsDir: string = Path.resolve(
    process.cwd(),
    "FeatureSet",
    "Notification",
    "Templates",
    "Partials",
  );
  const filenames: string[] = await fsp.readdir(partialsDir);
  filenames.forEach(async (filename: string) => {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);
    if (!matches) {
      return;
    }

    const name: string = matches[1]!;
    const template: string = await fsp.readFile(
      Path.resolve(partialsDir, filename),
      { encoding: "utf8", flag: "r" },
    );

    const partialTemplate: Handlebars.TemplateDelegate =
      Handlebars.compile(template);

    Handlebars.registerPartial(name, partialTemplate);

    logger.debug(`Loaded partial ${name}`, { service: "notification" });
  });
};

loadPartials().catch((err: Error) => {
  logger.error("Error loading partials", { service: "notification" });
  logger.error(err, { service: "notification" });
});

Handlebars.registerHelper("ifCond", function (v1, v2, options) {
  if (v1 === v2) {
    //@ts-expect-error - Handlebars uses dynamic this context for template helpers
    return options.fn(this);
  }
  //@ts-expect-error - Handlebars uses dynamic this context for template helpers
  return options.inverse(this);
});

/*
 * Join every argument the template passed, not just the first two.
 *
 * The two-argument version silently truncated every caller that passed
 * more. `{{> EmailTitle title=(concat "Alert " alertNumber ": " alertTitle) }}`
 * rendered as "Alert ALT-113" — the separator and the alert title were
 * dropped — so the headline of every alert and incident email was a bare
 * identifier with no indication of what had happened.
 *
 * Handlebars appends its own options object as the final argument to every
 * helper call, so that one is dropped rather than stringified into the
 * output as "[object Object]".
 */
Handlebars.registerHelper("concat", (...args: Array<any>) => {
  const values: Array<any> = args.slice(0, -1);

  return values
    .map((value: any) => {
      return value === null || value === undefined ? "" : String(value);
    })
    .join("");
});

Handlebars.registerHelper("ifNotCond", function (v1, v2, options) {
  if (v1 !== v2) {
    //@ts-expect-error - Handlebars uses dynamic this context for template helpers
    return options.fn(this);
  }
  //@ts-expect-error - Handlebars uses dynamic this context for template helpers
  return options.inverse(this);
});
