import { getRoleCardSelectOptions } from "../Permission/RoleCardSelectOptions";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * THE ROLES EVERY PROJECT HAS, READ-ONLY, under the project's custom roles
 * on the Roles page: what each can do, in the groups and words Add Role
 * shows them in (RoleCardSelectOptions), so a role reads the same wherever it
 * is met.
 *
 * They are what a custom role is made of, so they are here to look up, not
 * to work through: the card starts folded, saying how many there are, and
 * opens to the list. A built-in role cannot be changed; it is given to a team
 * on the team's Permissions page, or bundled into a custom role.
 */

export const BUILT_IN_ROLES_CARD_TEST_ID: string = "built-in-roles";
export const BUILT_IN_ROLES_LIST_TEST_ID: string = "built-in-roles-list";

const BuiltInRolesCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // What each role can do in full: this card is for looking roles up.
  const groups: Array<CardSelectOptionGroup> = useMemo(() => {
    return getRoleCardSelectOptions({ fullDescriptions: true });
  }, []);

  const roleCount: number = groups.reduce(
    (count: number, group: CardSelectOptionGroup): number => {
      return count + group.options.length;
    },
    0,
  );

  return (
    <div data-testid={BUILT_IN_ROLES_CARD_TEST_ID}>
      <Card
        title="Built-in Roles"
        description={translator.translatePlural(
          {
            one: "Every project has this {{count}} role. It can't be changed: give it to a team on the team's Permissions page, or bundle it into a custom role.",
            other:
              "Every project has these {{count}} roles. They can't be changed: give one to a team on the team's Permissions page, or bundle several into a custom role.",
          },
          roleCount,
        )}
        buttons={[
          {
            title: isOpen ? "Hide Built-in Roles" : "Show Built-in Roles",
            icon: isOpen ? IconProp.ChevronUp : IconProp.ChevronDown,
            buttonStyle: ButtonStyleType.OUTLINE,
            onClick: () => {
              setIsOpen(!isOpen);
            },
          },
        ]}
      >
        {isOpen ? (
          <div className="space-y-6" data-testid={BUILT_IN_ROLES_LIST_TEST_ID}>
            {groups.map((group: CardSelectOptionGroup): ReactElement => {
              return (
                <section key={group.label}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {translator.translateText(group.label)}
                  </h3>
                  <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {group.options.map(
                      (option: CardSelectOption): ReactElement => {
                        return (
                          <li
                            key={String(option.value)}
                            className="flex min-w-0 items-start gap-3 rounded-lg border border-gray-200 p-3"
                          >
                            {option.icon ? (
                              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-gray-100">
                                <Icon
                                  icon={option.icon}
                                  className="h-4 w-4 text-gray-600"
                                />
                              </div>
                            ) : (
                              <></>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-900 break-words">
                                {translator.translateText(option.title)}
                              </div>
                              {option.description ? (
                                <div className="mt-0.5 text-sm text-gray-500 break-words">
                                  {translator.translateText(option.description)}
                                </div>
                              ) : (
                                <></>
                              )}
                            </div>
                          </li>
                        );
                      },
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default BuiltInRolesCard;
