import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import SlackComponents from 'Common/Types/Workflow/Components/Slack';
import API from 'Common/Utils/API';
import ComponentCode, { RunOptions, RunReturnType } from '../../ComponentCode';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import APIException from 'Common/Types/Exception/ApiException';

export default class SendMessageToChannel extends ComponentCode {
    public constructor() {
        super();

        const Component: ComponentMetadata | undefined = SlackComponents.find(
            (i: ComponentMetadata) => {
                return i.id === ComponentID.SlackSendMessageToChannel;
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

        if (!args['text']) {
            throw options.onError(
                new BadDataException('Slack message not found')
            );
        }

        if (!args['webhook-url']) {
            throw options.onError(
                new BadDataException('Slack Webhook URL not found')
            );
        }

        args['webhook-url'] = URL.fromString(
            args['webhook-url']?.toString() as string
        );

        let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
            null;

        try {
            apiResult = await API.post(args['webhook-url'] as URL, {
                text: args['text'],
            });

            if (apiResult instanceof HTTPErrorResponse) {
                return Promise.resolve({
                    returnValues: {
                        error: apiResult.message || 'Server Error.',
                    },
                    executePort: errorPort,
                });
            }
            return Promise.resolve({
                returnValues: {},
                executePort: successPort,
            });
        } catch (err) {
            if (err instanceof HTTPErrorResponse) {
                return Promise.resolve({
                    returnValues: {
                        error: err.message || 'Server Error.',
                    },
                    executePort: errorPort,
                });
            }

            throw options.onError(
                new APIException('Something wrong happened.')
            );
        }
    }
}
