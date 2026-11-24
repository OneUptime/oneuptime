import React, { FunctionComponent, ReactElement, useState } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import { XCP_NG_PAGE_DESCRIPTIONS } from "./XcpNgPageDescriptions";
import { XcpNgPartKind } from "../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  getXcpNgDisplayName,
  getXcpNgShortId,
  toXcpNgNumber,
} from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * THE VIRTUAL DISKS OF A VM, OR ON A STORAGE REPOSITORY.
 *
 * Xen Orchestra reports each virtual disk (VDI) with the storage repository
 * it is stored on and, when it is attached, the VM it belongs to. A VM's
 * page lists its disks with where each one lives; a storage repository's
 * page lists what it holds with whose each one is - each a step from that
 * page. A disk's size is what its VM sees; what it uses is what it takes
 * on its repository, less than its size while a thin disk has not filled.
 *
 * Drawn by the product's table, as every list is: sized columns, a page of
 * ten at a time, and each disk a card of its own on a phone.
 */

export const XCP_NG_VIRTUAL_DISKS_PAGE_SIZE: number = 10;

const NOT_ATTACHED: string = translationKey("Not attached");

export interface ComponentProps {
  testId: string;
  // Whose disks these are: a VM's (each names its repository) or a repository's.
  of: Extract<XcpNgPartKind, "VM" | "StorageRepository">;
  rows: Array<XcpNgResource>;
  getPartRoute: (kind: XcpNgPartKind, externalId: string) => Route;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  onRefreshClick?: (() => void) | undefined;
}

const XcpNgVirtualDisksCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(
    XCP_NG_VIRTUAL_DISKS_PAGE_SIZE,
  );

  const linkClassName: string =
    "font-medium text-gray-900 hover:text-indigo-600 hover:underline";

  const formatSize: (value: unknown) => ReactElement = (
    value: unknown,
  ): ReactElement => {
    const bytes: number | null = toXcpNgNumber(value);
    if (bytes === null) {
      return <TableEmptyValue />;
    }
    return (
      <bdi className="tabular-nums">
        {formatStorageBytes(bytes, translator.language)}
      </bdi>
    );
  };

  const placeColumn: Column<XcpNgResource> =
    props.of === "VM"
      ? {
          id: "storageRepository",
          key: "storageRepositoryName",
          title: "Storage Repository",
          type: FieldType.Element,
          disableSort: true,
          hideBelowLargeScreen: true,
          foldInto: "name",
          getElement: (disk: XcpNgResource): ReactElement => {
            const name: string =
              disk.storageRepositoryName ||
              getXcpNgShortId(disk.storageRepositoryExternalId);
            if (!name) {
              return <TableEmptyValue />;
            }
            return disk.storageRepositoryExternalId ? (
              <Link
                to={props.getPartRoute(
                  "StorageRepository",
                  disk.storageRepositoryExternalId,
                )}
                className={linkClassName}
              >
                <bdi>{name}</bdi>
              </Link>
            ) : (
              <bdi>{name}</bdi>
            );
          },
        }
      : {
          id: "vm",
          key: "vmName",
          title: "VM",
          type: FieldType.Element,
          disableSort: true,
          hideBelowLargeScreen: true,
          foldInto: "name",
          getElement: (disk: XcpNgResource): ReactElement => {
            if (!disk.vmExternalId) {
              return (
                <span className="text-sm text-gray-500">
                  {translator.translateText(NOT_ATTACHED) || NOT_ATTACHED}
                </span>
              );
            }
            const name: string =
              disk.vmName || getXcpNgShortId(disk.vmExternalId);
            return (
              <Link
                to={props.getPartRoute("VM", disk.vmExternalId)}
                className={linkClassName}
              >
                <bdi>{name}</bdi>
              </Link>
            );
          },
        };

  const columns: Array<Column<XcpNgResource>> = [
    {
      id: "name",
      key: "name",
      title: "Virtual Disk",
      type: FieldType.Element,
      disableSort: true,
      getElement: (disk: XcpNgResource): ReactElement => {
        return (
          <bdi
            className="font-medium text-gray-900"
            data-testid={`${props.testId}-name`}
          >
            {getXcpNgDisplayName(disk)}
          </bdi>
        );
      },
    },
    placeColumn,
    {
      id: "size",
      key: "maxDiskBytes",
      title: "Size",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: XCP_NG_PAGE_DESCRIPTIONS.virtualDiskSize,
      getElement: (disk: XcpNgResource): ReactElement => {
        return formatSize(disk.maxDiskBytes);
      },
    },
    {
      id: "used",
      key: "latestDiskBytes",
      title: "Used on Storage",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: XCP_NG_PAGE_DESCRIPTIONS.virtualDiskUsed,
      hideBelowLargeScreen: true,
      foldInto: "size",
      showTitleWhenFolded: true,
      getElement: (disk: XcpNgResource): ReactElement => {
        return formatSize(disk.latestDiskBytes);
      },
    },
  ];

  const pages: number = Math.max(1, Math.ceil(props.rows.length / pageSize));
  const currentPage: number = Math.min(page, pages);
  const shown: Array<XcpNgResource> = props.rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  return (
    <Card
      title="Virtual Disks"
      description={
        props.of === "VM"
          ? "This VM's disks, the storage repository each one is on, and how much space it takes there."
          : "The disks stored on this storage repository, the VM each one belongs to, and how much space it takes here."
      }
    >
      <div data-testid={props.testId}>
        <Table<XcpNgResource>
          id={`${props.testId}-table`}
          columnWidthsKey={`${props.testId}-table`}
          data={shown}
          columns={columns}
          singularLabel="Virtual Disk"
          pluralLabel="Virtual Disks"
          currentPageNumber={currentPage}
          totalItemsCount={props.rows.length}
          itemsOnPage={pageSize}
          disablePagination={
            props.rows.length <= XCP_NG_VIRTUAL_DISKS_PAGE_SIZE
          }
          error={props.error || ""}
          isLoading={Boolean(props.isLoading)}
          onRefreshClick={props.onRefreshClick}
          onNavigateToPage={(pageNumber: number, itemsOnPage: number): void => {
            setPage(pageNumber);
            if (itemsOnPage > 0) {
              setPageSize(itemsOnPage);
            }
          }}
          sortOrder={SortOrder.Ascending}
          sortBy={null}
          onSortChanged={(): void => {
            // The disks keep their order: by name, as the inventory sorts them.
          }}
          noItemsMessage={
            props.of === "VM"
              ? "No virtual disks yet. Xen Orchestra reports a VM's disks with the storage repository each one is on."
              : "No virtual disks yet. A disk appears here once Xen Orchestra reports it on this storage repository."
          }
        />
      </div>
    </Card>
  );
};

export default XcpNgVirtualDisksCard;
