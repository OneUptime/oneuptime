// Tailwind.
import Navigation from "../Utils/Navigation";
import Button, { ButtonStyleType } from "./Button/Button";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Email from "../../Types/Email";
import { Translator } from "../Utils/TranslateTemplate";
import useTranslator from "../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  homeRoute: Route;
  supportEmail: Email;
}

const NotFound: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="mx-auto max-w-full sm:px-6 lg:px-8 rounded-lg">
      <div className="min-h-full py-16 px-6 sm:py-24 md:grid md:place-items-center lg:px-8">
        <div className="mx-auto">
          <main className="sm:flex">
            <p className="text-4xl  tracking-tight text-indigo-600 sm:text-5xl">
              404
            </p>
            {/*
             * Logical sides (ms, ps, border-s), so the line between the
             * number and the words stays between them right to left too.
             */}
            <div className="sm:ms-6">
              <div className="sm:border-s sm:border-gray-200 sm:ps-6">
                <h1 className="text-4xl  tracking-tight text-gray-900 sm:text-5xl">
                  {translator.translateText("Page not found")}
                </h1>
                <p className="mt-1 text-base text-gray-500">
                  {translator.translateText(
                    "Please check the URL in the address bar and try again.",
                  )}
                </p>
              </div>
              {/*
               * The gap spaces the buttons either way round; a Button's own
               * md:ml-3 (a dialog footer's) would indent the first one and
               * double the gap right to left.
               */}
              <div className="mt-10 flex flex-wrap gap-3 sm:border-s sm:border-transparent sm:ps-6 [&_button]:md:ml-0">
                <Button
                  title="Go Home"
                  buttonStyle={ButtonStyleType.PRIMARY}
                  onClick={() => {
                    Navigation.navigate(props.homeRoute);
                  }}
                />
                <Button
                  title="Contact Support"
                  buttonStyle={ButtonStyleType.NORMAL}
                  onClick={() => {
                    Navigation.navigate(
                      URL.fromString("mailto:" + props.supportEmail.toString()),
                    );
                  }}
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
export default NotFound;
