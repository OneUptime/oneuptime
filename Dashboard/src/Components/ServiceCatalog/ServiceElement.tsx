import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import ColorSquareCube from "CommonUI/src/Components/ColorSquareCube/ColorSquareCube";
import Link from "CommonUI/src/Components/Link/Link";
import { GetReactElementFunction } from "CommonUI/src/Types/FunctionTypes";
import ServiceCatalog from "Common/AppModels/Models/ServiceCatalog";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  serviceCatalog: ServiceCatalog;
  onNavigateComplete?: (() => void) | undefined;
  serviceCatalogNameClassName?: string;
}

const ServiceCatalogElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getServiceElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="flex space-x-2">
        <div className="mt-1">
          <ColorSquareCube
            color={props.serviceCatalog.serviceColor || Black}
            tooltip={`${props.serviceCatalog.name?.toString()} Service Color`}
          />
        </div>
        <div className={props.serviceCatalogNameClassName}>
          {props.serviceCatalog.name?.toString()}
        </div>
      </div>
    );
  };

  if (props.serviceCatalog._id) {
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SERVICE_CATALOG_VIEW] as Route,
          {
            modelId: new ObjectID(props.serviceCatalog._id as string),
          },
        )}
      >
        {getServiceElement()}
      </Link>
    );
  }

  return <div>{getServiceElement()}</div>;
};

export default ServiceCatalogElement;
