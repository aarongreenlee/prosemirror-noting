import { Mark, MarkSpec, Node } from "prosemirror-model";
import { ValidationInput } from "../interfaces/Validation";

/**
 * Get a single string of text, and an array of position mappings,
 * from a Prosemirror document. The mappings can be used to map an
 * index in the text back to a position in the document.
 */
export const getTextMaps = (doc: Node): ValidationInput[] =>
  (doc instanceof Node ? findTextNodes(doc) : [doc]).reduce(
    (
      acc: { positionMap: ValidationInput[]; length: number },
      textNodeWrapper,
      index,
      textNodes
    ) => {
      const previousMap = acc.positionMap[acc.positionMap.length - 1];
      const str = textNodeWrapper.node.text || "";
      const previousNodeWrapper = textNodes[index - 1];
      const sharesParentWithPreviousNode =
        previousNodeWrapper &&
        textNodeWrapper.parent === previousNodeWrapper.parent;
      if (sharesParentWithPreviousNode) {
        // If this node shares a parent with the previous, add its text and
        // mapping to the last node's position map. In this way, contiguous
        // text nodes are treated as single lines of text for validation.
        const previousPositionMaps = acc.positionMap.slice(
          0,
          acc.positionMap.length - 1
        );
        const currentText = (previousMap ? previousMap.str : "") + str;
        return {
          length: acc.length + str.length,
          positionMap: previousPositionMaps.concat({
            str: currentText,
            from: previousMap.from,
            to: previousMap.from + currentText.length
          })
        };
      }
      // Add a new position map.
      return {
        length: acc.length + str.length,
        positionMap: acc.positionMap.concat({
          str: str,
          from: textNodeWrapper.pos,
          to: textNodeWrapper.pos + str.length
        })
      };
    },
    {
      positionMap: [],
      length: 0
    }
  ).positionMap;

export const MarkTypes = {
  legal: "legal",
  warn: "warn"
};

/**
 * Create a validation mark spec for the given mark name.
 */
const createValidationMark = (markName: string) => ({
  attrs: {},
  inclusive: false,
  parseDOM: [
    {
      tag: `span.${markName}`,
      getAttrs: () => ({})
    }
  ],
  toDOM: (mark: Mark, inline: boolean) => [`span.${markName}`]
});

export const validationMarks = Object.keys(MarkTypes).reduce(
  (acc, markName: string) => {
    return {
      ...acc,
      [markName]: createValidationMark(markName)
    };
  },
  {} as { [markName: string]: MarkSpec }
);

/**
 * Flatten a node and its children into a single array of objects, containing
 * the node and the node's position in the document.
 */
export const flatten = (node: Node, descend = true) => {
  if (!node) {
    throw new Error('Invalid "node" parameter');
  }
  const result: { node: Node; parent: Node; pos: number }[] = [];
  node.descendants((child, pos, parent) => {
    result.push({ node: child, parent, pos });
    if (!descend) {
      return false;
    }
  });
  return result;
};

/**
 * Find all children in a node that satisfy the given predicate.
 */
export const findChildren = (
  node: Node,
  predicate: (node: Node) => boolean,
  descend: boolean
): { node: Node; parent: Node; pos: number }[] => {
  if (!node) {
    throw new Error('Invalid "node" parameter');
  } else if (!predicate) {
    throw new Error('Invalid "predicate" parameter');
  }
  return flatten(node, descend).filter(child => predicate(child.node));
};

/**
 * Find any text nodes in the given node.
 */
export const findTextNodes = (
  node: Node,
  descend: boolean = true
): { node: Node; parent: Node; pos: number }[] => {
  return findChildren(node, child => child.isText, descend);
};