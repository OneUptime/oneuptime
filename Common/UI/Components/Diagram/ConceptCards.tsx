import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface ConceptCard {
  title: string;
  description: string;
  icon: IconProp;
  iconColor: Color;
}

export interface ComponentProps {
  cards: ConceptCard[];
  /** Number of columns in the grid (1-4). Default is 2. */
  columns?: 1 | 2 | 3 | 4 | undefined;
}

const ConceptCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: number = props.columns || 2;

  const getGridClasses = (): string => {
    switch (columns) {
      case 1:
        return "grid-cols-1";
      case 2:
        return "grid-cols-1 md:grid-cols-2";
      case 3:
        return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
      case 4:
        return "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";
      default:
        return "grid-cols-1 md:grid-cols-2";
    }
  };

  return (
    <div className={`grid ${getGridClasses()} gap-3`}>
      {props.cards.map((card: ConceptCard, index: number) => {
        return (
          <div
            key={index}
            className="border border-gray-200 rounded-md p-3 bg-white hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start space-x-3">
              <div
                className="flex-shrink-0 w-8 h-8 rounded flex items-center justify-center"
                style={{ backgroundColor: `${card.iconColor.toString()}15` }}
              >
                <Icon
                  icon={card.icon}
                  className="h-4 w-4"
                  style={{ color: card.iconColor.toString() }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-gray-900">
                  {card.title}
                </h4>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  {card.description}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ConceptCards;
