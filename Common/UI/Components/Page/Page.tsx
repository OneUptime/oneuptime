import Analytics from "../../Utils/Analytics";
import Breadcrumbs from "../Breadcrumbs/Breadcrumbs";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import PageLoader from "../Loader/PageLoader";
import Pill from "../Pill/Pill";
import Link from "../../../Types/Link";
import Label from "../../../Models/DatabaseModels/Label";
import Color from "../../../Types/Color";
import { Black } from "../../../Types/BrandColors";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  title?: string | undefined;
  breadcrumbLinks?: Array<Link> | undefined;
  children: Array<ReactElement> | ReactElement;
  sideMenu?: undefined | ReactElement;
  className?: string | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  labels?: Array<Label> | undefined;
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2">
                  <h1 className="text-lg font-semibold leading-7 text-gray-900 sm:text-3xl sm:tracking-tight sm:truncate">
                    {props.title}
                  </h1>
                  {props.labels && props.labels.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {props.labels
                        .filter((label: Label | null) => {
                          return Boolean(label && (label.name || label.slug));
                        })
                        .map((label: Label, index: number) => {
                          const resolveColor: Color = (() => {
                            if (!label.color) {
                              return Black;
                            }

                            if (typeof label.color === "string") {
                              return Color.fromString(label.color);
                            }

                            return label.color;
                          })();

                          return (
                            <Pill
                              key={
                                label.id?.toString() ||
                                label._id ||
                                label.slug ||
                                `${label.name || "label"}-${index}`
                              }
                              color={resolveColor}
                              text={label.name || label.slug || "Label"}
                              isMinimal={true}
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {props.sideMenu && (
        <main className="mx-auto max-w-full pb-10">
          <div className="lg:grid lg:grid-cols-12 lg:gap-x-5">
            {props.sideMenu}

            {!props.isLoading && (
              <div className="space-y-6 md:px-6 lg:col-span-10 md:col-span-9 lg:px-0">
                {props.children}
              </div>
            )}
            {props.isLoading && (
              <div className="lg:col-span-10 md:col-span-9">
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
