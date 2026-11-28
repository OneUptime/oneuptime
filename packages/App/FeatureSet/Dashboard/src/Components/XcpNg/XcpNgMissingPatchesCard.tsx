import React, { FunctionComponent, ReactElement } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import IconProp from "Common/Types/Icon/IconProp";
import { XcpNgMissingPatch } from "Common/Types/XcpNg/XcpNgPoolEvents";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getXcpNgMissingPatchCount } from "../../Pages/XcpNg/Utils/XcpNgEventFacts";

/*
 * THE UPDATES AN XCP-NG HOST HAS NOT INSTALLED (#10997), on its page: each
 * package Xen Orchestra lists as missing for it, with its version and what
 * it is, as Xen Orchestra checks them every six hours. A host whose check
 * found none, or that no check has counted, draws no card: its details
 * card says "Up to date", or nothing.
 */

// The most patches the card lists; the count above says how many in all.
export const XCP_NG_PATCHES_SHOWN: number = 50;

export interface ComponentProps {
  row: XcpNgResource;
}

function readPatches(value: unknown): Array<XcpNgMissingPatch> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry: unknown): entry is XcpNgMissingPatch => {
    return (
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as XcpNgMissingPatch).name === "string"
    );
  });
}

const XcpNgMissingPatchesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const count: number | null = getXcpNgMissingPatchCount(props.row);
  const patches: Array<XcpNgMissingPatch> = readPatches(
    props.row.missingPatches,
  );

  if (count === null || count === 0) {
    return <></>;
  }

  const shown: Array<XcpNgMissingPatch> = patches.slice(
    0,
    XCP_NG_PATCHES_SHOWN,
  );

  return (
    <div className="mb-6" data-testid="xcp-ng-host-patches">
      <Card
        title="Missing Patches"
        description="Updates Xen Orchestra lists for this host that it has not installed yet. Install them from Xen Orchestra's Patches tab, host by host or for the whole pool."
      >
        {shown.length > 0 ? (
          <ul className={listClassName}>
            {shown.map(
              (patch: XcpNgMissingPatch, index: number): ReactElement => {
                const version: string = [patch.version, patch.release]
                  .filter((part: string | undefined): boolean => {
                    return Boolean(part);
                  })
                  .join("-");
                return (
                  <li
                    key={`${patch.name}-${version}-${index}`}
                    className="flex items-start gap-3 py-2.5"
                    data-testid="xcp-ng-host-patch"
                  >
                    <Icon
                      icon={IconProp.ArrowCircleUp}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                        <span>{patch.name}</span>
                        {version ? (
                          <span className="ml-2 font-mono text-xs font-normal text-gray-500">
                            {version}
                          </span>
                        ) : (
                          <></>
                        )}
                      </div>
                      {patch.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">
                          {patch.description}
                        </p>
                      ) : (
                        <></>
                      )}
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Xen Orchestra counted them without naming them: its Patches tab lists each one.",
            )}
          </p>
        )}
      </Card>
    </div>
  );
};

export default XcpNgMissingPatchesCard;
