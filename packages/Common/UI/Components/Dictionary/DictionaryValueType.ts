/*
 * The kinds of value a key/value editor's row holds (Dictionary). A module of
 * its own, so a form that names them for its Dictionary field (FormField)
 * does not load the editor, which is a file of its own (LazyDictionary).
 */
export enum ValueType {
  Text = "Text",
  Number = "Number",
  Boolean = "Boolean",
}

export default ValueType;
