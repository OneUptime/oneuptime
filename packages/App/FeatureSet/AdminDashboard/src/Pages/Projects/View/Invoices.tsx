import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  AdminProjectInvoice,
  InvoiceBilledFor,
  isInvoiceVoidable,
  readAdminProjectInvoice,
} from "Common/Types/Billing/AdminProjectInvoice";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { InvoiceStatus } from "Common/Models/DatabaseModels/BillingInvoice";
import Project from "Common/Models/DatabaseModels/Project";
import { formatInvoiceAmount } from "Common/Utils/Billing/InvoiceAmount";
import ActionButtonSchema, {
  RowActionConfirmation,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Pill from "Common/UI/Components/Pill/Pill";
import Table from "Common/UI/Components/Table/Table";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * A project's Invoices page: every invoice the payment provider has raised
 * for the project, newest first, read live (ProjectAPI's admin-invoices) -
 * and Void on the ones still owed, for OneUptime staff waiving a charge: the
 * plan invoice raised as a trial ended, say, once the trial was extended.
 *
 * Voiding cannot be undone, so it asks first, naming the invoice and its
 * amount; the dialog stays open, busy, until the payment provider answers,
 * and says why in place if it refused.
 */

export const PROJECT_INVOICES_TABLE_ID: string = "admin-project-invoices";

// The colour an invoice's status is drawn in: what is owed stands out.
const STATUS_COLORS: Record<string, Color> = {
  [InvoiceStatus.Paid]: Green,
  [InvoiceStatus.Open]: Yellow,
  [InvoiceStatus.Uncollectible]: Red,
};

// The words an invoice's status reads as, by its key in the locales.
const STATUS_KEYS: Record<string, string> = {
  [InvoiceStatus.Paid]: "pages.projectInvoices.statusPaid",
  [InvoiceStatus.Open]: "pages.projectInvoices.statusOpen",
  [InvoiceStatus.Void]: "pages.projectInvoices.statusVoid",
  [InvoiceStatus.Uncollectible]: "pages.projectInvoices.statusUncollectible",
  [InvoiceStatus.Draft]: "pages.projectInvoices.statusDraft",
  [InvoiceStatus.Deleted]: "pages.projectInvoices.statusDeleted",
};

const ProjectInvoices: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const modelIdString: string = Navigation.getLastParamAsString(1);

  // Memoized on the route param, as the Subscription page next door does.
  const modelId: ObjectID = useMemo(() => {
    return new ObjectID(modelIdString);
  }, [modelIdString]);

  const [invoices, setInvoices] = useState<Array<AdminProjectInvoice>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [refreshCount, setRefreshCount] = useState<number>(0);

  const projectRoute: Route = new Project().getCrudApiPath()!;

  const breadcrumbLinks: Array<Link> = [
    {
      title: t("breadcrumbs.adminDashboard"),
      isTitleTranslated: true,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: t("breadcrumbs.projects"),
      isTitleTranslated: true,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
    },
    {
      title: t("breadcrumbs.project"),
      isTitleTranslated: true,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_VIEW] as Route,
        { modelId: modelId },
      ),
    },
    {
      title: t("breadcrumbs.projectInvoices"),
      isTitleTranslated: true,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_INVOICES] as Route,
        { modelId: modelId },
      ),
    },
  ];

  useEffect(() => {
    if (!BILLING_ENABLED) {
      return;
    }

    // A reply for a project or a refresh already left behind is dropped.
    let isCurrent: boolean = true;

    const loadInvoices: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString())
              .addRoute(projectRoute)
              .addRoute(`/${modelId.toString()}/admin-invoices`),
          });

        if (response instanceof HTTPErrorResponse || response.isFailure()) {
          throw response;
        }

        const rows: Array<AdminProjectInvoice> = (
          (response.data["invoices"] as JSONArray | undefined) || []
        )
          .map((invoice: JSONValue): AdminProjectInvoice | null => {
            return readAdminProjectInvoice(invoice);
          })
          .filter((invoice: AdminProjectInvoice | null): boolean => {
            return invoice !== null;
          }) as Array<AdminProjectInvoice>;

        if (isCurrent) {
          setInvoices(rows);
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    void loadInvoices();

    return () => {
      isCurrent = false;
    };
  }, [modelIdString, refreshCount]);

  // An invoice by its number, or by its id until the provider numbers it.
  const getInvoiceName: (invoice: AdminProjectInvoice) => string = (
    invoice: AdminProjectInvoice,
  ): string => {
    return invoice.invoiceNumber || invoice.id;
  };

  const getAmount: (invoice: AdminProjectInvoice) => string = (
    invoice: AdminProjectInvoice,
  ): string => {
    return formatInvoiceAmount({
      amount: invoice.amount,
      currencyCode: invoice.currencyCode,
    });
  };

  type VoidInvoiceFunction = (invoice: AdminProjectInvoice) => Promise<void>;

  const voidInvoice: VoidInvoiceFunction = async (
    invoice: AdminProjectInvoice,
  ): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.put<JSONObject>({
        url: URL.fromString(APP_API_URL.toString())
          .addRoute(projectRoute)
          .addRoute(`/${modelId.toString()}/admin-void-invoice`),
        data: {
          data: {
            paymentProviderInvoiceId: invoice.id,
          },
        },
      });

    if (response instanceof HTTPErrorResponse || response.isFailure()) {
      throw response;
    }
  };

  const columns: Array<Column<AdminProjectInvoice>> = [
    {
      id: "invoiceNumber",
      key: "invoiceNumber",
      title: "Invoice Number",
      type: FieldType.Element,
      disableSort: true,
      getElement: (invoice: AdminProjectInvoice): ReactElement => {
        return invoice.invoiceNumber ? (
          <span className="font-medium text-gray-900">
            {invoice.invoiceNumber}
          </span>
        ) : (
          <TableEmptyValue />
        );
      },
    },
    {
      id: "invoiceDate",
      key: "invoiceDate",
      title: "Invoice Date",
      type: FieldType.Date,
      disableSort: true,
    },
    {
      id: "billedFor",
      key: "billedFor",
      title: "Billed For",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (invoice: AdminProjectInvoice): ReactElement => {
        if (invoice.billedFor === InvoiceBilledFor.Plan) {
          return <span>{t("pages.projectInvoices.billedForPlan")}</span>;
        }

        if (invoice.billedFor === InvoiceBilledFor.Usage) {
          return <span>{t("pages.projectInvoices.billedForUsage")}</span>;
        }

        return <TableEmptyValue />;
      },
    },
    {
      id: "amount",
      key: "amount",
      title: "Amount",
      type: FieldType.Element,
      disableSort: true,
      getElement: (invoice: AdminProjectInvoice): ReactElement => {
        return <span className="tabular-nums">{getAmount(invoice)}</span>;
      },
    },
    {
      id: "status",
      key: "status",
      title: "Status",
      type: FieldType.Element,
      disableSort: true,
      getElement: (invoice: AdminProjectInvoice): ReactElement => {
        const statusKey: string | undefined = STATUS_KEYS[invoice.status];

        return (
          <Pill
            text={
              statusKey ? t(statusKey) : t("pages.projectInvoices.statusOther")
            }
            color={STATUS_COLORS[invoice.status] || Gray500}
          />
        );
      },
    },
    // Where the table draws each row's Download and Void (actionButtons).
    {
      title: "Actions",
      type: FieldType.Actions,
    },
  ];

  const actionButtons: Array<ActionButtonSchema<AdminProjectInvoice>> = [
    {
      title: t("pages.projectInvoices.downloadButton"),
      icon: IconProp.Download,
      buttonStyleType: ButtonStyleType.NORMAL,
      isVisible: (invoice: AdminProjectInvoice): boolean => {
        return Boolean(invoice.downloadableLink);
      },
      onClick: (
        invoice: AdminProjectInvoice,
        onCompleteAction: VoidFunction,
      ) => {
        Navigation.navigate(URL.fromString(invoice.downloadableLink!), {
          openInNewTab: true,
        });
        onCompleteAction();
      },
    },
    {
      title: t("pages.projectInvoices.voidButton"),
      icon: IconProp.NoSymbol,
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      isVisible: (invoice: AdminProjectInvoice): boolean => {
        return isInvoiceVoidable(invoice.status);
      },
      getConfirmation: (
        invoice: AdminProjectInvoice,
      ): RowActionConfirmation => {
        return {
          title: t("pages.projectInvoices.voidTitle"),
          description: t("pages.projectInvoices.voidDescription", {
            number: getInvoiceName(invoice),
            amount: getAmount(invoice),
          }),
          submitButtonText: t("pages.projectInvoices.voidButton"),
          submitButtonType: ButtonStyleType.DANGER,
        };
      },
      onClick: (
        invoice: AdminProjectInvoice,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ) => {
        setSuccess("");

        voidInvoice(invoice)
          .then(() => {
            onCompleteAction();
            setSuccess(
              t("pages.projectInvoices.voidSuccess", {
                number: getInvoiceName(invoice),
              }),
            );
            // Read the list again: the invoice, and its status, as voided.
            setRefreshCount((count: number): number => {
              return count + 1;
            });
          })
          .catch((err: unknown) => {
            onError(new Error(API.getFriendlyMessage(err)));
          });
      },
    },
  ];

  const page: (children: ReactElement) => ReactElement = (
    children: ReactElement,
  ): ReactElement => {
    return (
      <ModelPage<Project>
        modelId={modelId}
        modelNameField="name"
        modelType={Project}
        modelAPI={AdminModelAPI}
        title={t("pages.projectInvoices.title")}
        isTitleTranslated={true}
        breadcrumbLinks={breadcrumbLinks}
        sideMenu={<SideMenuComponent modelId={modelId} />}
      >
        {children}
      </ModelPage>
    );
  };

  /*
   * Invoices only exist on the hosted (billing enabled) edition. The side
   * menu hides the link there, and this covers the address reached directly.
   */
  if (!BILLING_ENABLED) {
    return page(
      <Alert
        type={AlertType.INFO}
        title={t("pages.projectInvoices.billingDisabled")}
      />,
    );
  }

  return page(
    <div>
      {success ? (
        <Alert
          type={AlertType.SUCCESS}
          title={success}
          className="mb-5"
          dataTestId="admin-project-invoices-success"
        />
      ) : (
        <></>
      )}

      <Card
        title={t("pages.projectInvoices.cardTitle")}
        description={t("pages.projectInvoices.cardDescription")}
        buttons={getTableHeaderButtons([
          {
            title: "",
            buttonStyle: ButtonStyleType.ICON,
            icon: IconProp.Refresh,
            onClick: () => {
              setSuccess("");
              setRefreshCount(refreshCount + 1);
            },
          },
        ])}
      >
        {!isLoading && !error && invoices.length === 0 ? (
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.Invoice}
            title={t("pages.projectInvoices.emptyTitle")}
            description={t("pages.projectInvoices.emptyDescription")}
            isCompact={true}
            dataTestId="admin-project-invoices-empty"
          />
        ) : (
          <Table<AdminProjectInvoice>
            id={PROJECT_INVOICES_TABLE_ID}
            columnWidthsKey={PROJECT_INVOICES_TABLE_ID}
            data={invoices}
            columns={columns}
            actionButtons={actionButtons}
            singularLabel="Invoice"
            pluralLabel="Invoices"
            disablePagination={true}
            currentPageNumber={1}
            totalItemsCount={invoices.length}
            itemsOnPage={Math.max(invoices.length, 1)}
            error={error}
            isLoading={isLoading}
            onNavigateToPage={() => {
              // Every invoice is on the one page.
            }}
            sortBy={null}
            sortOrder={SortOrder.Descending}
            onSortChanged={() => {
              // Newest first, as the server orders them.
            }}
            onRefreshClick={() => {
              setRefreshCount(refreshCount + 1);
            }}
          />
        )}
      </Card>
    </div>,
  );
};

export default ProjectInvoices;
