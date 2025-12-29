import Analytics from "../../Utils/Analytics";
import Breadcrumbs from "../Breadcrumbs/Breadcrumbs";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import PageLoader from "../Loader/PageLoader";
import LabelElement from "../Label/Label";
import Link from "../../../Types/Link";
import LabelModel from "../../../Models/DatabaseModels/Label";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  title?: string | undefined;
  breadcrumbLinks?: Array<Link> | undefined;
  children: Array<ReactElement> | ReactElement;
  sideMenu?: undefined | ReactElement;
  className?: string | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  labels?: Array<LabelModel> | undefined;
}

const Page: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  useEffect(() => {
    if (props.breadcrumbLinks && props.breadcrumbLinks.length > 0) {
      Analytics.capture(
        "Page View: " +
          props.breadcrumbLinks
            .map((link: Link) => {
              return link.title;
            })
            .join(" > ")
            .toString() || "",
      );
    }
  }, [props.breadcrumbLinks]);

  if (props.error) {
    return <ErrorMessage message={props.error} />;
  }

  return (
    <div
      className={
        props.className ||
        "mb-auto max-w-full px-4 sm:px-6 lg:px-8 mt-5 mb-20 h-max"
      }
    >
      {((props.breadcrumbLinks && props.breadcrumbLinks.length > 0) ||
        props.title) && (
        <div className="mb-5">
          {props.breadcrumbLinks && props.breadcrumbLinks.length > 0 && (
            <div className="mt-2">
              <Breadcrumbs links={props.breadcrumbLinks} />
            </div>
          )}
          {props.title && (
            <div className="mt-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap sm:gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <h1 className="text-xl font-semibold leading-7 text-gray-900 sm:text-xl sm:tracking-tight sm:truncate">
                    {props.title}
                  </h1>
                </div>
                {props.labels && props.labels.length > 0 && (
                  <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">
                      Labels
                    </span>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      {props.labels
                        .filter((label: LabelModel | null) => {
                          return Boolean(label && (label.name || label.slug));
                        })
                        .map((label: LabelModel, index: number) => {
                          return (
                            <LabelElement
                              key={
                                label.id?.toString() ||
                                label._id ||
                                label.slug ||
                                `${label.name || "label"}-${index}`
                              }
                              label={label}
                            />
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {props.sideMenu && (
        <main className="mx-auto max-w-full pb-10">
          <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
            {props.sideMenu}

            {!props.isLoading && (
              <div className="space-y-6 flex-1 min-w-0">{props.children}</div>
            )}
            {props.isLoading && (
              <div className="flex-1 min-w-0">
                <PageLoader isVisible={true} />
              </div>
            )}
          </div>
        </main>
      )}

      {!props.sideMenu && !props.isLoading && props.children}
      {!props.sideMenu && props.isLoading && <PageLoader isVisible={true} />}
    </div>
  );
};

export default Page;
