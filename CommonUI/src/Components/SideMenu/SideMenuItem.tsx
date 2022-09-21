import Link from 'Common/Types/Link';
import React, { FunctionComponent } from 'react';
import Navigation from '../../Utils/Navigation';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import UILink from '../Link/Link';
import { Red, Yellow } from 'Common/Types/BrandColors';
import BaseModel from 'Common/Models/BaseModel';
import Badge, { BadgeType } from '../Badge/Badge';


export interface ComponentProps {
    link: Link;
    modelType?: { new(): BaseModel } | undefined;
    showAlert?: undefined | boolean;
    showWarning?: undefined | boolean;
    badge?: undefined | number;
    badgeType?: BadgeType | undefined;
    icon?: undefined | IconProp;
    className?: undefined | string;
}

const SideMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {

   

    return (
        <UILink
            className={`${props.className ? props.className : ''
                } primary-on-hover justify-space-between pointer flex ${Navigation.isOnThisPage(props.link.to) ? 'active' : ''
                }`}
            to={props.link.to}
        >
            <div className="flex">
                <div>
                    {props.icon ? (
                        <>
                            <Icon
                                icon={props.icon}
                                thick={ThickProp.LessThick}
                            />
                        </>
                    ) : (
                        <></>
                    )}
                </div>
                <div
                    style={{
                        marginTop: '1px',
                        marginLeft: '4px',
                    }}
                >
                    {' ' + props.link.title}
                </div>
            </div>
            <div>

                {props.badge ? (
                    <Badge badgeCount={props.badge} badgeType={props.badgeType} />
                ) : (
                    <></>
                )}

                {props.showAlert ? (
                    <>
                        <Icon
                            className="float-end"
                            icon={IconProp.Error}
                            color={Red}
                        />
                    </>
                ) : (
                    <></>
                )}
                {props.showWarning ? (
                    <>
                        <Icon
                            className="float-end"
                            icon={IconProp.Alert}
                            color={Yellow}
                        />
                    </>
                ) : (
                    <></>
                )}
            </div>
        </UILink>
    );
};

export default SideMenuItem;
