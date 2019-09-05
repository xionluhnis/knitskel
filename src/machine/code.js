// Alexandre Kaspar
"use strict";

const C = {
  // regular vs reverse stitch
  KNIT: 1,
  PURL: 2,
  REVERSE_KNIT: 2,
  TWOSIDED_KNIT: 3,

  // tubular structure
  FRONT_KNIT: 51,
  BACK_KNIT: 52,
  FRONT_BACK_KNIT: 3,
  FRONT_STITCH: 51,
  BACK_STITCH:  52,
  FRONT_KNIT_KICKBACK: 17,
  BACK_KNIT_KICKBACK: 18,

  // miss
  MISS: 16,
  FLOAT: 16,
  FRONT_MISS: 116,
  BACK_MISS: 117,
  FRONT_MISS_WITHOUT_LINK_PROCESS: 216,
  BACK_MISS_WITHOUT_LINK_PROCESS: 217,
  OTHER_MISS: {
    116: 117, 117: 116
  },
  MISS_FROM_SIDE: [ 116, 117 ],

  // tuck
  TUCK: 11,
  REVERSE_TUCK: 12,
  TWOSIDED_TUCK: 88,
  FRONT_TUCK: 171,
  BACK_TUCK: 172,
  FRONT_BACK_TUCK: 175,

  // front+back mixes
  FRONT_KNIT_BACK_TUCK: 41,
  FRONT_TUCK_BACK_KNIT: 42,

  // cables codes
  CROSS_BELOW: 4,
  CROSS_ABOVE: 5,
  CROSS_BELOW_SECOND: 14,
  CROSS_ABOVE_SECOND: 15,
  CROSS_BEHIND: 10,
  CROSS_BEHIND_SECOND: 100,
  CROSS_JOINT_CODE: 150,

  // cross tests
  IS_CROSS: {
    4: true, 5: true, 14: true, 15: true, 10: true, 100: true
  },
  IS_ABOVE: {
    5: true, 15: true
  },
  IS_BELOW: {
    4: true, 14: true, 10:true, 100: true
  },
  CROSS_COMPLEMENTS_OF: {
    4: [5], 5: [4, 10], 10: [5], 14: [15], 15: [14, 100], 100: [15]
  },

  // directions and base moves
  LEFT: 6,
  RIGHT: 7,
  FRONT_LEFT: 6,
  FRONT_RIGHT: 7,
  BACK_LEFT: 8,
  BACK_RIGHT: 9,

  // all moves
  FRONT_KNIT_MOVE_LEFT:   [61, 62, 63, 64, 65, 66, 67],
  FRONT_KNIT_MOVE_RIGHT:  [71, 72, 73, 74, 75, 76, 77],
  BACK_KNIT_MOVE_LEFT:    [81, 82, 83, 84, 85, 86, 87],
  BACK_KNIT_MOVE_RIGHT:   [91, 92, 93, 94, 95, 96, 97],

  // transfer direction
  TRANSFER: 1,

  // all transfers
  FRONT_KNIT_XFER_LEFT:   [21, 22, 23, 43, 44, 45, 46],
  FRONT_KNIT_XFER_RIGHT:  [24, 25, 26, 47, 48, 49, 68],
  BACK_KNIT_XFER_LEFT:    [31, 32, 33, 53, 54, 55, 56],
  BACK_KNIT_XFER_RIGHT:   [34, 35, 36, 57, 58, 59, 69],
  FRONT_KNIT_XFER:  20,
  BACK_KNIT_XFER:   30,
  FRONT_KNIT_DOUBLE_XFER:   40,
  BACK_KNIT_DOUBLE_XFER:    50,
  KNIT_DOUBLE_XFER: [ 40, 50 ],
  XFER_TO_FRONT_THEN_KNIT:  60,
  XFER_TO_BACK_THEN_KNIT:   70,
  XFER_TO_FRONT:  80,
  XFER_TO_BACK:   90,

  // split
  SPLIT: 101,
  FRONT_SPLIT:  101,
  BACK_SPLIT:   102,
  FRONT_SPLIT_MOVE_LEFT:  [106, 126],
  FRONT_SPLIT_MOVE_RIGHT: [107, 127],
  BACK_SPLIT_MOVE_LEFT:   [108, 128],
  BACK_SPLIT_MOVE_RIGHT:  [109, 129],
  // split map
  SPLIT_FOR: {
    'front': {
      '-2': 126, '-1': 106, '0': 101, '1': 107, '2': 127
    },
    0: {
      '-2': 126, '-1': 106, '0': 101, '1': 107, '2': 127
    },
    'back': {
      '-2': 128, '-1': 108, '0': 102, '1': 109, '2': 129
    },
    1: {
      '-2': 128, '-1': 108, '0': 102, '1': 109, '2': 129
    }
  },

  // link process
  LINK_PROCESS: 99,

  // feeder points
  FEEDER: 13,

  // direction switch
  INV_DIR: {
    6:7, 7: 6
  },
  DIR_FROM_STR: {
    'left': 6, 'right': 7
  },
  DIR_SIGN: {
    6: -1, 7: 1
  },

  // sides
  SIDES: [0, 1],
  FRONT_SIDE: 0,
  BACK_SIDE: 1,
  OTHER_SIDE: {
    0: 1, 1: 0, 'front': 'back', 'back': 'front'
  },
  SIDE_FROM_STR: {
    'front': 0, 'back': 1
  },
  SIDE_STR: ['front', 'back'],

  // options
  // - right
  REPEAT:         'R1',
  CARRIER:        'R3',
  CARRIER_MODE:   'R5',
  CARRIER_MOVE:   'R5',
  TENSION:        'R6',
  HOLDING_HOOK:   'R10',
  FABRIC_PRESSER: 'R11',
  YARN_INSERT:    'R15',
  // - left
  DIGITAL_STITCH_CONTROL: 'L9',
  DSCS:           'L9',
  IDSCS:          'L9',
  A_MISS:         'L12',
  SPLIT_TO_HOOK:  'L12',
  TRANSFER_TYPE:  'L13',

  // insert value for removing yarn
  CARRIER_MANUAL: 10,
  CARRIER_AUTO:   20,
  REMOVE_YARN: Array.from({ length: 11 }).map((_, idx) => 100 + idx),
  EMPTY_CARRIER:  255,

  // carrier movements
  INVERT_DIR:     2,
  CARRIAGE_MOVE:  2,
  TRANSFER_MODE:  1,
  INDEPENDENT_LEFT:   6,
  INDEPENDENT_RIGHT:  7,

  // split to hook value
  TRANSFER_TO_HOOK: 10,

  // transfer types
  DEFAULT: 0,
  TRANSFER_TO_SLIDERS: 1,
  RETURN_FROM_SLIDERS: 3,
  FRONT_BODY: 31,
  BACK_BODY:  32,
  FRONT_BODY_WITH_SLIDERS: 51,
  BACK_BODY_WITH_SLIDERS:  52,
  COMPULSIVE_FRONT_BODY: 81,
  COMPULSIVE_BACK_BODY:  82,
  COMPULSIVE_FRONT_BODY_WITH_SLIDERS: 91,
  COMPULSIVE_BACK_BODY_WITH_SLIDERS:  92,

  // digital stitch control system
  TOGGLE: 1
};

/**
 * Find the instruction for a given transfer
 *
 * @param index0 source needle index
 * @param side0 source needle side
 * @param index1 target needle index
 * @param side1 target needle side
 * @param knitAfter whether the knit should happen after the transfer
 * @return the corresponding knitting instruction
 */
function getTransferCode(index0, side0, index1, side1, knitAfter){
  if(typeof side0 == 'string')
    side0 = C.SIDE_FROM_STR[side0];
  if(typeof side1 == 'string')
    side1 = C.SIDE_FROM_STR[side1];
  // sanity checks
  let delta = index1 - index0;
  let shift = Math.abs(delta);
  console.assert(shift <= 7, 'Cannot transfer beyond 7 needles at once');
  console.assert(side0 != side1 || !knitAfter, 'Cannot knit after when moving on same bed');
  if(knitAfter){
    console.assert(side0 != side1, 'Cannot knit after when moving on same bed');
    console.assert(shift == 0, 'Knit after can only be done for direct transfers without shift');
    if(side1 == 'front')
      return C.XFER_TO_FRONT_THEN_KNIT;
    else
      return C.XFER_TO_BACK_THEN_KNIT;
  }
  if(side0 == side1){
    // knit + stitch move
    if(side0 == C.FRONT_SIDE){
      if(delta > 0)
        return C.FRONT_KNIT_MOVE_RIGHT[shift-1];
      else
        return C.FRONT_KNIT_MOVE_LEFT[shift-1];
    } else {
      if(delta > 0)
        return C.BACK_KNIT_MOVE_RIGHT[shift-1];
      else
        return C.BACK_KNIT_MOVE_LEFT[shift-1];
    }
  } else {
    // knit + stitch transfer
    if(side0 == C.FRONT_SIDE){
      if(delta == 0)
        return C.FRONT_KNIT_XFER;
      else if(delta > 0)
        return C.FRONT_KNIT_XFER_RIGHT[shift-1];
      else
        return C.FRONT_KNIT_XFER_LEFT[shift-1];
    } else {
      if(delta == 0)
        return C.BACK_KNIT_XFER;
      else if(delta > 0)
        return C.BACK_KNIT_XFER_RIGHT[shift-1];
      else
        return C.BACK_KNIT_XFER_LEFT[shift-1];
    }
  }
  throw "Invalid transfer type";
}

/**
 * Returns the transfer type (option L13) for a given scenario
 *
 * @param side the side of the knitting body
 * @param sliders whether sliders need to be used for moves
 * @param compulsive whether transfers are compulsive
 */
function getTransferType(side, sliders, compulsive){
  if(typeof side == 'string')
    side = C.SIDE_FROM_STR[side];
  console.assert(C.SIDES.includes(side), 'Invalid side', side);
  if(compulsive){
    if(sliders){
      return side == C.FRONT_SIDE ? C.COMPULSIVE_FRONT_BODY_WITH_SLIDERS : C.COMPULSIVE_BACK_BODY_WITH_SLIDERS;
    } else {
      return side == C.FRONT_SIDE ? C.COMPULSIVE_FRONT_BODY : C.COMPULSIVE_BACK_BODY;
    }
  } else {
    if(sliders){
      return side == C.FRONT_SIDE ? C.FRONT_BODY_WITH_SLIDERS : C.BACK_BODY_WITH_SLIDERS;
    } else {
      return side == C.FRONT_SIDE ? C.FRONT_BODY : C.BACK_BODY;
    }
  }
}

function getShiftDirection(shift){
  console.assert(shift, 'Shift cannot be null');
  return shift > 0 ? C.RIGHT : C.LEFT;
}
function getDirectionBetween(i0, i1){
  console.assert(typeof i0 == 'number' && typeof i1 == 'number',
    'Needle indices must be numbers');
  if(i0 == i1)
    return C.TRANSFER;
  else
    return getShiftDirection(i1 - i0);
}
function getEvenSideCrossCode(above, pairCount){
  let second = pairCount % 2;
  if(above)
    return second ? C.CROSS_ABOVE_SECOND : C.CROSS_ABOVE;
  else
    return second ? C.CROSS_BELOW_SECOND : C.CROSS_BELOW;
}

function getOddSideCrossCode(front, pairCount){
  let second = pairCount % 2;
  if(front)
    return second ? C.CROSS_ABOVE_SECOND : C.CROSS_ABOVE;
  else
    return second ? C.CROSS_BEHIND_SECOND : C.CROSS_BEHIND;
}

module.exports = Object.assign({
  getTransferCode,
  getTransferType,
  getShiftDirection,
  getDirectionBetween,
  getEvenSideCrossCode,
  getOddSideCrossCode
}, C);
