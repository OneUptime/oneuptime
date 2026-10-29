import IconProp from "../../../Types/Icon/IconProp";
import React, { useCallback, useContext, useMemo, useState } from "react";

/*
 * Options that what a card holds adds to the card's ⋯ menu.
 *
 * A table puts "Reset column widths" there once a person has sized its
 * columns (Table/ColumnResize): the ⋯ is where a table keeps its other
 * options - Refresh, Filter, Columns - whether a ModelTable drew it or a
 * page did for a table of its own (getTableHeaderButtons). The card holds
 * the list, its ⋯ (CardMoreMenu) draws it after its own items, and a table
 * in a card with no ⋯ - or in no card - draws its reset at its own header's
 * end instead (it reads menuCount).
 *
 * Something opened over a card - a dialog, a side panel - starts afresh
 * (Modal, SideOver): a table in it is not the card's.
 */
export interface CardMenuExtraItem {
  /*
   * Items under one key are one item: two tables in a card are reset by
   * one "Reset column widths".
   */
  key: string;
  // In English: the menu looks it up in the reader's language.
  text: string;
  icon: IconProp;
  onClick: () => void;
  dataTestId?: string | undefined;
}

export interface CardMenuExtras {
  // What the card's ⋯ adds, one item a key.
  items: ReadonlyArray<CardMenuExtraItem>;
  // A part of the card adds its item, or takes it back (null).
  setItem: (ownerId: string, item: CardMenuExtraItem | null) => void;
  // How many ⋯ menus the card's header draws now.
  menuCount: number;
  // A ⋯ says it is there, and gives back what it returns when it goes.
  addMenu: () => () => void;
}

export const CardMenuExtrasContext: React.Context<CardMenuExtras | null> =
  React.createContext<CardMenuExtras | null>(null);

// The card an element is drawn in, as its ⋯ menu's extras; null outside one.
export const useCardMenuExtras: () => CardMenuExtras | null =
  (): CardMenuExtras | null => {
    return useContext(CardMenuExtrasContext);
  };

/*
 * Items as the ⋯ draws them: one a key, in the order their keys were first
 * added, each running every owner's onClick.
 */
export const mergeCardMenuExtraItems: (
  itemsByOwner: ReadonlyArray<[string, CardMenuExtraItem]>,
) => Array<CardMenuExtraItem> = (
  itemsByOwner: ReadonlyArray<[string, CardMenuExtraItem]>,
): Array<CardMenuExtraItem> => {
  const byKey: Map<string, Array<CardMenuExtraItem>> = new Map();

  for (const [, item] of itemsByOwner) {
    const same: Array<CardMenuExtraItem> = byKey.get(item.key) || [];

    same.push(item);
    byKey.set(item.key, same);
  }

  return Array.from(byKey.values()).map(
    (same: Array<CardMenuExtraItem>): CardMenuExtraItem => {
      const first: CardMenuExtraItem = same[0] as CardMenuExtraItem;

      if (same.length === 1) {
        return first;
      }

      return {
        ...first,
        onClick: (): void => {
          for (const item of same) {
            item.onClick();
          }
        },
      };
    },
  );
};

// What a card keeps for its ⋯ menu's extras (Card provides it).
export const useCardMenuExtrasState: () => CardMenuExtras =
  (): CardMenuExtras => {
    const [itemsByOwner, setItemsByOwner] = useState<
      Array<[string, CardMenuExtraItem]>
    >([]);
    const [menuCount, setMenuCount] = useState<number>(0);

    const setItem: (ownerId: string, item: CardMenuExtraItem | null) => void =
      useCallback((ownerId: string, item: CardMenuExtraItem | null): void => {
        setItemsByOwner(
          (
            current: Array<[string, CardMenuExtraItem]>,
          ): Array<[string, CardMenuExtraItem]> => {
            const index: number = current.findIndex(
              (entry: [string, CardMenuExtraItem]): boolean => {
                return entry[0] === ownerId;
              },
            );

            if (!item) {
              return index === -1
                ? current
                : current.filter(
                    (entry: [string, CardMenuExtraItem]): boolean => {
                      return entry[0] !== ownerId;
                    },
                  );
            }

            if (index === -1) {
              return [...current, [ownerId, item]];
            }

            const next: Array<[string, CardMenuExtraItem]> = [...current];

            next[index] = [ownerId, item];

            return next;
          },
        );
      }, []);

    const addMenu: () => () => void = useCallback((): (() => void) => {
      setMenuCount((count: number): number => {
        return count + 1;
      });

      return (): void => {
        setMenuCount((count: number): number => {
          return Math.max(0, count - 1);
        });
      };
    }, []);

    const items: Array<CardMenuExtraItem> = useMemo(() => {
      return mergeCardMenuExtraItems(itemsByOwner);
    }, [itemsByOwner]);

    return useMemo((): CardMenuExtras => {
      return {
        items: items,
        setItem: setItem,
        menuCount: menuCount,
        addMenu: addMenu,
      };
    }, [items, setItem, menuCount, addMenu]);
  };
