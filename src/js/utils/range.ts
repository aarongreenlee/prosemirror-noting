import flatMap from "lodash/flatten";
import { Range } from "../interfaces/Validation";
import { ValidationOutput, ValidationInput } from "../interfaces/Validation";
import { Node } from "prosemirror-model";
import { findParentNode } from "prosemirror-utils";
import { Selection, Transaction } from "prosemirror-state";
import clamp from "lodash/clamp";
import compact from "lodash/compact";

export const findOverlappingRangeIndex = (range: Range, ranges: Range[]) => {
  return ranges.findIndex(
    localRange =>
      // Overlaps to the left of the range
      (localRange.from <= range.from && localRange.to >= range.from) ||
      // Overlaps within the range
      (localRange.to >= range.to && localRange.from <= range.to) ||
      // Overlaps to the right of the range
      (localRange.from >= range.from && localRange.to <= range.to)
  );
};

export const mergeRange = (range1: Range, range2: Range): Range => ({
  from: range1.from < range2.from ? range1.from : range2.from,
  to: range1.to > range2.to ? range1.to : range2.to
});

export const mergeRanges = (ranges: Range[]): Range[] =>
  ranges.reduce(
    (acc, range) => {
      const index = findOverlappingRangeIndex(range, acc);
      if (index === -1) {
        return acc.concat(range);
      }
      const newRange = acc.slice();
      newRange.splice(index, 1, mergeRange(range, acc[index]));
      return newRange;
    },
    [] as Range[]
  );

/**
 * Return the first set of ranges with any overlaps removed.
 */
export const diffRanges = (
  firstRanges: Range[],
  secondRanges: Range[]
): Range[] => {
  const firstRangesMerged = mergeRanges(firstRanges);
  const secondRangesMerged = mergeRanges(secondRanges);
  return firstRangesMerged.reduce(
    (acc, range) => {
      const overlap = findOverlappingRangeIndex(range, secondRangesMerged);
      if (overlap === -1) {
        return acc.concat(range);
      }
      const overlappingRange = secondRangesMerged[overlap];
      const firstShortenedRange = {
        from: range.from,
        to: secondRangesMerged[overlap].from
      };
      // If the compared range overlaps our range completely, chop the end off...
      if (overlappingRange.to >= range.to) {
        // (ranges of 0 aren't valid)
        return firstShortenedRange.from === firstShortenedRange.to
          ? acc
          : acc.concat(firstShortenedRange);
      }
      // ... else, split the range and diff the latter segment recursively.
      return acc.concat(
        firstShortenedRange,
        diffRanges(
          [
            {
              from: overlappingRange.to + 1,
              to: range.to
            }
          ],
          secondRangesMerged
        )
      );
    },
    [] as Range[]
  );
};

export const validationInputToRange = (vi: ValidationInput) => ({
  from: vi.from,
  to: vi.from + vi.str.length
});

const getValRangesFromRange = <T extends ValidationInput | ValidationOutput>(
  range: Range,
  valRanges: T[]
): T[] =>
  valRanges.reduce(
    (acc, vi: T) => {
      // If this validation input touches this range, remove it.
      if (range.from >= vi.from && range.from <= vi.from + vi.str.length) {
        const from = range.from - vi.from;
        const to = range.from - vi.from + (range.to - range.from);
        const str = vi.str.slice(from > 0 ? from - 1 : 0, to);
        return str
          ? acc.concat(
              // Why not spread? See https://github.com/Microsoft/TypeScript/pull/13288
              Object.assign({}, vi, {
                from: range.from,
                to: range.to,
                str
              })
            )
          : acc;
      }
      return acc;
    },
    [] as T[]
  );

/**
 * Remove the second validation inputs from the first,
 * producing a new array of validation inputs.
 *
 * This function works on the assumption that all ranges
 * in each set of validation inputs are merged.
 */
export const diffValidationInputs = <
  T extends ValidationInput | ValidationOutput
>(
  firstValInputs: T[],
  secondValInputs: (ValidationInput | ValidationOutput)[]
): T[] =>
  flatMap(
    diffRanges(
      firstValInputs.map(validationInputToRange),
      secondValInputs.map(validationInputToRange)
    ).map(range => getValRangesFromRange(range, firstValInputs))
  );

/**
 * Expand a range in a document to encompass the words adjacent to the range.
 */
export const expandRange = (range: Range, doc: Node): Range => {
  const $fromPos = doc.resolve(range.from);
  const $toPos = doc.resolve(range.to);
  const parentNode = findParentNode(node => node.isBlock)(
    new Selection($fromPos, $toPos)
  );
  if (!parentNode) {
    throw new Error(
      `Parent node not found for position ${$fromPos.start}, ${$fromPos.end}`
    );
  }
  return {
    from: parentNode.start,
    to: parentNode.start + parentNode.node.textContent.length
  };
};

/**
 * Expand the given ranges to include their parent block nodes.
 */
export const getRangesOfParentBlockNodes = (ranges: Range[], doc: Node) => {
  const validationRanges = ranges.reduce((acc, range: Range) => {
    const expandedRange = expandRange({ from: range.from, to: range.to }, doc);
    const validationRanges = [
      {
        from: expandedRange.from,
        to: clamp(expandedRange.to, doc.content.size)
      }
    ];
    return acc.concat(validationRanges);
  }, ranges);
  return mergeRanges(validationRanges);
};

export const mapRangeThroughTransactions = <T extends Range>(
  ranges: T[],
  time: number,
  trs: Transaction[]
): T[] =>
  compact(ranges.map(range => {
    const initialTransactionIndex = trs.findIndex(tr => tr.time === time);
    // If we only have a single transaction in the history, we're dealing with
    // an unaltered document, and so there's no mapping to do.
    if (trs.length === 1) {
      return range;
    }

    if (initialTransactionIndex === -1) {
      return undefined;
    }

    return Object.assign(range, {
      ...trs.slice(initialTransactionIndex).reduce(
        (acc, tr) => ({
          from: tr.mapping.map(acc.from),
          to: tr.mapping.map(acc.to)
        }),
        range
      )
    });
  }));
