import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import Components from 'Common/Types/Workflow/Components/Email';
import ComponentCode, { RunOptions, RunReturnType } from '../ComponentCode';
import nodemailer, { Transporter } from 'nodemailer';

export default class Email extends ComponentCode {
    public constructor() {
        super();

        const Component: ComponentMetadata | undefined = Components.find(
            (i: ComponentMetadata) => {
                return i.id === ComponentID.SendEmail;
            }
        );

        if (!Component) {
            throw new BadDataException('Component not found.');
        }

        this.setMetadata(Component);
    }

    public override async run(
        args: JSONObject,
        options: RunOptions
    ): Promise<RunReturnType> {


        const successPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'success';
            }
        );

        if (!successPort) {
            throw options.onError(
                new BadDataException('Success port not found')
            );
        }

        const errorPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'error';
            }
        );

        if (!errorPort) {
            throw options.onError(new BadDataException('Error port not found'));
        }

        if (!args['to']) {
            throw options.onError(
                new BadDataException('to not found')
            );
        }

        if (args['to'] && typeof args["to"] !== "string") {
            throw options.onError(
                new BadDataException('to is not type of string')
            );
        }

        if (!args['from']) {
            throw options.onError(
                new BadDataException('from not found')
            );
        }

        if (args['from'] && typeof args["from"] !== "string") {
            throw options.onError(
                new BadDataException('from is not type of string')
            );
        }


        if (!args['smtp-username']) {
            throw options.onError(
                new BadDataException('email not found')
            );
        }

        if (args['smtp-username'] && typeof args["smtp-username"] !== "string") {
            throw options.onError(
                new BadDataException('smtp-username is not type of string')
            );
        }


        if (!args['smtp-password']) {
            throw options.onError(
                new BadDataException('email not found')
            );
        }

        if (args['smtp-password'] && typeof args["smtp-password"] !== "string") {
            throw options.onError(
                new BadDataException('smtp-username is not type of string')
            );
        }

        if (!args['smtp-host']) {
            throw options.onError(
                new BadDataException('email not found')
            );
        }

        if (args['smtp-host'] && typeof args["smtp-host"] !== "string") {
            throw options.onError(
                new BadDataException('smtp-host is not type of string')
            );
        }

        if (!args['smtp-port']) {
            throw options.onError(
                new BadDataException('email not found')
            );
        }

        if (args['smtp-port'] && typeof args["smtp-port"] === "string") {
            args['smtp-port'] = parseInt(args['smtp-port']);
        }

        if (args['smtp-port'] && typeof args["smtp-port"] !== "number") {
            throw options.onError(
                new BadDataException('smtp-host is not type of number')
            );
        }

        try {

            const mailer: Transporter = nodemailer.createTransport({
                host: args['smtp-host']?.toString(),
                port: args['smtp-port'] as number,
                secure: !!args['secure'],
                auth: {
                    user: args['smtp-username'] as string,
                    pass: args['smtp-password'] as string,
                }
            });

            await mailer.sendMail({
                from: args['from'].toString(),
                to: args['to'].toString(),
                subject: args['subject']?.toString() || '',
                html: args['body']?.toString() || '',
            });

            options.log("Email sent."); 
            
            return Promise.resolve({
                returnValues: {},
                executePort: successPort,
            });

        } catch (err) {
            options.log(err); 
            return Promise.resolve({
                returnValues: {},
                executePort: successPort,
            });
        }
    }
}
