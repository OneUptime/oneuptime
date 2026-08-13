import PageComponentProps from "../../PageComponentProps";
import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import {
  InventoryLivenessBadge,
  InventorySourceBadge,
  InventoryTypeBadge,
} from "../../../Components/Inventory/InventoryBadges";
import InventoryAttributes from "../../../Components/Inventory/InventoryAttributes";
import {
  InventorySourceDescriptor,
  getInventorySourceDescriptor,
} from "../../../Components/Inventory/InventorySource";
import {
  TypedRowLink,
  resolveTypedRowLink,
} from "../../../Components/Inventory/ResolveTypedRowLink";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AppLink from "../../../Components/AppLink/AppLink";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import Navigation from "Common/UI/Utils/Navigation";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * An inventory item at a glance: what it is, where it came from, whether it
 * is still reporting, and the attributes it is identified by.
 *
 * The header carries the three badges rather than a wall of key/value rows,
 * because those three facts are what a reader needs before anything else on
 * the page means much — a "last seen 4 months ago" is alarming for a
 * discovered service and meaningless for a hand-registered vendor API, and
 * the source badge is what tells the two apart.
 */

const InventoryItemOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const { item, isLoading, error }: UseInventoryItemResult =
    useInventoryItem(modelId);

  const [typedRowLink, setTypedRowLink] = useState<TypedRowLink | null>(null);

  useEffect(() => {
    if (!item) {
      return;
    }

    let isCancelled: boolean = false;

    resolveTypedRowLink(item)
      .then((link: TypedRowLink | null) => {
        if (!isCancelled) {
          setTypedRowLink(link);
        }
      })
      .catch(() => {
        // Best-effort: a missing cross-link is a missing button, not an error.
      });

    return () => {
      isCancelled = true;
    };
  }, [item]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!item) {
    return <ErrorMessage message="This inventory item could not be found." />;
  }

  const entity: InventoryItem = item;
  const sourceDescriptor: InventorySourceDescriptor | null =
    getInventorySourceDescriptor(entity.source);

  return (
    <Fragment>
      <Card
        title={entity.displayName || entity.entityKey || "Unnamed item"}
        description={entity.description || undefined}
        rightElement={
          typedRowLink ? (
            <AppLink
              to={typedRowLink.route}
              className="inline-flex items-center gap-x-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              <span>{typedRowLink.label}</span>
              <Icon
                icon={IconProp.ArrowRight}
                size={SizeProp.Smaller}
                className="h-4 w-4"
              />
            </AppLink>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <InventoryTypeBadge entityType={entity.entityType} />
            <InventorySourceBadge source={entity.source} />
            <InventoryLivenessBadge
              source={entity.source}
              lastSeenAt={entity.lastSeenAt}
              showAge={true}
            />
          </div>

          {sourceDescriptor ? (
            <p className="text-sm text-gray-500">
              {sourceDescriptor.description}
            </p>
          ) : null}

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                First seen
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {entity.firstSeenAt
                  ? OneUptimeDate.getDateAsLocalFormattedString(
                      entity.firstSeenAt,
                    )
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Last seen
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {entity.lastSeenAt
                  ? OneUptimeDate.getDateAsLocalFormattedString(
                      entity.lastSeenAt,
                    )
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Identity key
              </dt>
              <dd className="mt-1 flex items-center gap-x-2">
                <span className="font-mono text-sm break-all text-gray-900">
                  {entity.entityKey || "-"}
                </span>
                {entity.entityKey ? (
                  <CopyTextButton
                    textToBeCopied={entity.entityKey}
                    iconOnly={true}
                    title="Copy identity key"
                  />
                ) : null}
              </dd>
            </div>
          </dl>

          {entity.labels && entity.labels.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Labels
              </h3>
              <div className="mt-2 flex flex-wrap gap-1">
                {entity.labels.map((label: string): ReactElement => {
                  return (
                    <span
                      key={label}
                      className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-500/20"
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <InventoryAttributes
        identifyingAttributes={entity.identifyingAttributes}
        descriptiveAttributes={entity.descriptiveAttributes}
      />
    </Fragment>
  );
};

export default InventoryItemOverview;
