import React, {
  FunctionComponent,
  ReactElement,
  RefObject,
  createContext,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A HEADING WITH A DEFINED TERM IN IT IS NAMED BY ITS OWN WORDS.
 *
 * A defined term (Glossary/DefinedTerm) draws its definition right after
 * its word, so Tab goes from the word to Read more. In a heading, that is
 * inside the heading, and a heading is named by the words inside it: while
 * the definition showed, the definition - a dialog named by its word - gave
 * the word a second time, and a screen reader's list of headings read
 * "Criteria Criteria" (#7594).
 *
 * DefinitionsDrawnAfter draws a heading, then a place for the definitions
 * of the words inside it: right after the heading, so Tab still goes from
 * the word to Read more, then on to what follows the heading. A word inside
 * asks for the place once it can show its definition, so a heading with no
 * defined term in it is drawn as it was: Card draws every heading through
 * it, whatever its title holds (a table's word beside its plan's badge,
 * Owners' beside its count). A word told its place itself (DefinedTerm's
 * popoverPlace: a form field's title, Forms/Fields/FieldLabel) keeps that.
 */

export interface DefinitionPlace {
  // Where the definitions are drawn, once a word has asked for it.
  element: RefObject<HTMLElement>;
  // A word inside has a definition to show: the place is drawn.
  ask: () => void;
}

export const DefinitionPlaceContext: React.Context<
  DefinitionPlace | undefined
> = createContext<DefinitionPlace | undefined>(undefined);

export interface ComponentProps {
  // The heading: what the words inside it name.
  children: ReactElement;
}

const DefinitionsDrawnAfter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const element: RefObject<HTMLSpanElement> = useRef<HTMLSpanElement>(null);
  const [isAsked, setIsAsked] = useState<boolean>(false);

  const place: DefinitionPlace = useMemo((): DefinitionPlace => {
    return {
      element: element,
      ask: (): void => {
        setIsAsked(true);
      },
    };
  }, []);

  return (
    <>
      <DefinitionPlaceContext.Provider value={place}>
        {props.children}
      </DefinitionPlaceContext.Provider>
      {/* It draws no box: only a definition shown in it is seen. */}
      {isAsked ? <span ref={element} className="contents" /> : <></>}
    </>
  );
};

export default DefinitionsDrawnAfter;
