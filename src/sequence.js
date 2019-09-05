// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const Stitch = require('./stitch.js');

// constants
const FRONT = 0;
const BACK  = 1;
const BOTH  = 2;
const SIDES = [FRONT, BACK];
const OTHER_SIDE = {
  [FRONT]:  BACK,
  [BACK]:   FRONT,
  [BOTH]:   BOTH
};

/**
 * Check if a character is a digit
 *
 * @param ch a character (string with length 1)
 * @return whether it contains a digit
 */
function isDigit(ch){
  return ch >= '0' && ch <= '9';
}

/**
 * Compute the tokens of a course sequence.
 * The split generates tokens:
 * - full numbers and single non-numbers
 * ~ from non-numeric to non-numeric
 *
 * @param str the course sequence
 * @return a list of string tokens
 */
function seqTokens(str){
  //
  // Nice way: (but only works with recent Chrome)
  // @see https://stackoverflow.com/questions/8270784/how-to-split-a-string-between-letters-and-digits-or-between-digits-and-letters
  //
  // const tokens = str.split(/(?<=\D)(?=\d)|(?<=\d)(?=\D)|(?<=\D)(?=\D)/g);
  //
  // Transitions:
  //    (?<=\D)(?=\d) - between non-digit and digit
  //    (?<=\d)(?=\D) - between digit and non-digit
  //    (?<=\D)(?=\D) - between non-digit and non-digit
  //
  const tokens = [];
  for(let i = 0, lastNumber = false; i < str.length; ++i){
    const c = str.charAt(i);
    if(isDigit(c)){
      if(lastNumber){
        tokens[tokens.length-1] += c;
      } else {
        tokens.push(c);
        lastNumber = true;
      }
      // we are now appending to a number
    } else {
      // new non-number
      tokens.push(c);
      lastNumber = false;
    }
  }
  return tokens;
}

/**
 * Parse a stitch sequence
 *
 * Modifiers:
 * - sides
 *    v = F = front
 *    ^ = B = back
 *    | = both
 *    S = opposite
 *    C = circular (flat)
 * - directions
 *    < = L = left
 *    > = R = right
 *    I = inverse
 * - step size
 *    E = A = each / all needles
 *    H = half-gauge (every 2 needles)
 *    / = increase step by 1
 *    \ = decrease step by 1
 *
 * Operations:
 *    +n = n applies a sequence of n stitches, and n-1 moves
 *    -n = applies a sequence of n stitches, and n-1 inverse moves
 *    , = do one step (i.e. move to next needle)
 *    . = ,, = do two steps (i.e. miss one needle)
 *
 * Validity:
 * - the sequence has only valid characters (or spaces)
 * - no stitch is created onto another stitch
 * - the sequence creates at least one stitch
 *
 * @param str the stitch sequence as a string
 * @return { stitches, stitchMap, circular }
 */
function parseSequence(str){
  // check data
  let beds = [[], []];
  // sequence data
  let stitch = null;
  const stitches = [];
  const stitchMap = {};
  let circular;
  const assign = (index, side) => {
    // checks
    assert(SIDES.includes(side), 'Invalid side', side);
    assert(!beds[side][index], 'Assigning stitch over existing stitch');
    // create stitch
    stitch = stitch ? stitch.create() : new Stitch();
    stitches.push(stitch);
    // assign index and side
    stitchMap[stitch.id] = { index, side };
    beds[side][index] = stitch; // for checking collisions
  };
  // state data
  let index = 0;
  let side  = FRONT;
  let step  = 1;
  let dir   = 1;
  const tokens = seqTokens(str);
  for(let i = 0; i < tokens.length; ++i){
    const token = tokens[i];
    switch(token.toUpperCase()){

      // side-related
      case '^':
      case 'F': side = FRONT; break;
      case 'V':
      case 'B': side = BACK;  break;
      case 'S': side = OTHER_SIDE[side]; break;
      case '|': side = BOTH; break;
      case 'C': circular = true; break;

      // direction-related
      case '>':
      case 'R': dir = 1; break;
      case '<':
      case 'L': dir = -1; break;
      case 'I': dir = -dir; break;

      // step-related
      case 'E':
      case 'A': step = 1; break;
      case 'H': step = 2; break;
      case '/': ++step; break;
      case '\\':
        --step;
        assert(step > 0, 'Step must be positive');
        break;

      // move-related
      case ' ': break;
      case ',': index += step * dir; break;
      case '.': index += step * dir * 2; break;

      // temporary direction
      case '+':
      case '-': break;

      // rest = stitch-related
      default: {
        assert(token.length && !isNaN(token), 'Invalid sequence character', token);
        const n = parseInt(token);
        const d = tokens[i-1] == '-' ? -dir : dir;
        for(let j = 0; j < n; ++j){
          // assign stitch(es)
          if(side != BOTH){
            assign(index, side);
          } else {
            assign(index, FRONT);
            assign(index, BACK);
          }
          // move (if not at the end of path)
          if(j < n - 1){
            index += step * d;
          }
        }
      } break;
    }
  }
  assert(stitches.length, 'Sequence did not produce any stitch');
  return { stitches, stitchMap, circular };
}

module.exports = {
  FRONT, BACK, BOTH,
  parseSequence
};
