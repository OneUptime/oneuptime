import Handlebars from 'handlebars';
import fsp from 'fs/promises';
import Path from 'path';
import logger from 'CommonServer/Utils/Logger';

const loadPartials: () => Promise<void> = async (): Promise<void> => {
    // get all partials in the partial folder and comile then and register then as partials in handlebars.
    const partialsDir: string = Path.resolve(
        process.cwd(),
        'Templates',
        'Partials'
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
            { encoding: 'utf8', flag: 'r' }
        );

        const partialTemplate: Handlebars.TemplateDelegate =
            Handlebars.compile(template);

        Handlebars.registerPartial(name, partialTemplate);

        logger.info(`Loaded partial ${name}`);
    });
};

loadPartials().catch((err: Error) => {
    logger.error('Error loading partials');
    logger.error(err);
});

Handlebars.registerHelper('ifCond', function (v1, v2, options) {
    if (v1 === v2) {
        //@ts-ignore
        return options.fn(this);
    }
    //@ts-ignore
    return options.inverse(this);
});

Handlebars.registerHelper('concat', (v1: any, v2: any) => {
    // contact v1 and v2
    return v1 + v2;
});

Handlebars.registerHelper('ifNotCond', function (v1, v2, options) {
    if (v1 !== v2) {
        //@ts-ignore
        return options.fn(this);
    }
    //@ts-ignore
    return options.inverse(this);
});
