import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import React, { FunctionComponent, ReactElement } from 'react';
import Image from '../Image/Image';
import URL from 'Common/Types/API/URL';
import { FILE_URL } from '../../Config';
import Probe from 'Model/Models/Probe';
import Icon from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    probe?: Probe | JSONObject | undefined | null;
}

const ProbeElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let probe: JSONObject | null | undefined = null;

    if (props.probe instanceof Probe) {
        probe = JSONFunctions.toJSONObject(props.probe, Probe);
    } else {
        probe = props.probe;
    }

    if (!probe) {
        return (
            <div className="flex">
                <div className="bold" data-testid="probe-not-found">
                    No probe found.
                </div>
            </div>
        );
    }

    return (
        <div className="flex">
            <div>
                {props.probe?.iconFileId && (
                    <Image
                        className="h-6 w-6 rounded-full"
                        data-testid="probe-image"
                        imageUrl={URL.fromString(FILE_URL.toString()).addRoute(
                            '/image/' + props.probe?.iconFileId.toString()
                        )}
                        alt={probe['name']?.toString() || 'Probe'}
                    />
                )}
                {!props.probe?.iconFileId && (
                    <Icon
                        data-testid="probe-icon"
                        icon={IconProp.Signal}
                        className="text-gray-400 group-hover:text-gray-500 flex-shrink-0 -ml-0.5 mt-0.5 h-6 w-6"
                    />
                )}
            </div>
            <div className="mt-1 mr-1 ml-3">
                <div>
                    <span data-testid="probe-name">{`${
                        (probe['name']?.toString() as string) || ''
                    }`}</span>{' '}
                </div>
            </div>
        </div>
    );
};

export default ProbeElement;
