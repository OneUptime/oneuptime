import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface ConceptCard {
  title: string;
  description: string;
  icon: IconProp;
  iconColor: Color;
  iconBackgroundColor: Color;
  cardBackgroundColor: Color;
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
    <div className={`grid ${getGridClasses()} gap-6`}>
      {props.cards.map((card: ConceptCard, index: number) => {
        return (
          <div
            key={index}
            className="rounded-lg p-4"
            style={{ backgroundColor: card.cardBackgroundColor.toString() }}
          >
            <div className="flex items-center space-x-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: card.iconBackgroundColor.toString() }}
              >
                <Icon
                  icon={card.icon}
                  className="h-5 w-5"
                  style={{ color: card.iconColor.toString() }}
                />
              </div>
              <h4 className="font-semibold text-gray-900">{card.title}</h4>
            </div>
            <p className="text-sm text-gray-600">{card.description}</p>
          </div>
        );
      })}
    </div>
  );
};

export default ConceptCards;
