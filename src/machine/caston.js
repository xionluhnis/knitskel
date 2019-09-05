// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../skeleton.js');
const Code = require('./code.js');

// constants
const C = {
  AUTO:       sk.CASTON_AUTO,
  INTERLOCK:  sk.CASTON_INTERLOCK,
  KICKBACK:   sk.CASTON_KICKBACK,
  TUCK:       sk.CASTON_TUCK,
  PARTIAL:    'partial',
  PRECAST:    sk.CASTON_PRECAST,
  NONE:       sk.CASTON_NONE
};
const NONE  = 0;
const FRONT = 1;
const BACK  = 2;
const BOTH  = FRONT | BACK;

function tucks(caster, needles){
  let [n0, ...ns] = needles;
  caster.resetIndex(n0.index).switchSide(n0.side);
  // caster.moveTo(n0.index, n0.side);
  caster.tuck();
  for(let n of ns){
    caster.missTo(n.index, n.side);
    caster.tuck();
  }
}
function nearTucks(caster, needles){
  let n0 = needles[0];
  let n1 = needles[needles.length > 2 ? 2 : 1];
  let dir;
  if(n1.index != n0.index)
    dir = n1.index > n0.index ? Code.RIGHT : Code.LEFT;
  tucks(caster, dir && caster.dir != dir ? [n1, n0, n1] : [n0, n1]);
  caster.missTo(n0.index, n0.side).miss();
}
function farTucks(caster, needles){
  let n0 = needles[needles.length - 1];
  let n1 = needles[needles.length - needles.length > 2 ? 3 : 2];
  let dir;
  if(n1.index != n0.index)
    dir = n1.index > n0.index ? Code.RIGHT : Code.LEFT;
  tucks(caster, dir && caster.dir != dir ? [n1, n0, n1] : [n0, n1]);
}

function returnInterlock(caster, needles){
  let first = needles[0];
  let last  = needles[needles.length - 1];
  // forward pass
  for(let i = 0; i < needles.length; i += 2){
    let { index, side } = needles[i];
    caster.missTo(index, side);
    caster.knit();
  }
  caster.missTo(last.index).miss();
  // backward pass
  for(let i = needles.length - 1; i >= 0; i -= 2){
    let { index, side } = needles[i];
    caster.missTo(index, side);
    caster.knit();
  }
  caster.missTo(first.index).miss();
}
function circularInterlock(caster, needles){
  // two passes on every other needles, switch the offset after each pass
  for(let pass = 0; pass < 2; ++pass){
    for(let i = 1 - pass; i < needles.length; i += 2){
      let { index, side } = needles[i];
      caster.missTo(index, side);
      caster.knit();
    }
  }
  // final miss
  caster.missTo(needles[0].index).miss();
}

function returnKickback(){
  console.log('Kickback cast-on not implemented yet');
}
function circularKickback(){
  console.log('Kickback cast-on not implemented yet');
}

function precastCover(nbed){
  const needleMap = {};
  const assign = (index, side) => {
    if(!needleMap[index])
      needleMap[index] = { index, side: side ? BACK : FRONT };
    else
      needleMap[index].side |= side ? BACK : FRONT;
  };
  let curr = nbed;
  while(curr.activeGroup && curr.activeGroup.parent == nbed.activeGroup.parent){
    // cover current group's needles
    for(let stitch of curr.activeGroup.stitches){
      const { index, side } = curr.needleOf(stitch);
      assign(index, side);
    }
    // go to next
    curr = curr.next();
  }
  return Object.values(needleMap);
}

function precast(caster, cover, needles){
  // cast cover
  let castBack = false;
  let twosided = false;
  let cast = cover.map(() => false);
  let prev = NONE;
  for(let i = 0; i < cover.length; ++i){
    let { index, side } = cover[i];
    caster.moveTo(index).switchSide(side == BACK ? 'back' : 'front');
    if(side == BOTH) {
      caster.fbknit();
      cast[i] = true;
      prev = side;
      twosided = true;
    } else if(side != prev) {
      caster.knit();
      cast[i] = true;
      prev = side;
      if(prev != NONE)
        twosided = true;
    } else {
      prev = NONE; // to allow next casting
      castBack = true; // needs another pass
    }
  }

  // cast missing needles in inverse direction
  if(castBack){
    for(let i = cover.length - 1; i >= 0; --i){
      let { index, side } = cover[i];
      caster.moveTo(index).switchSide(side == BACK ? 'back' : 'front');
      if(!cast[i])
        caster.knit();
      else
        caster.miss();
    }
  }

  // cast back up to first needle
  // using its side
  let index0 = needles[0].index;
  let side0 = needles[0].side ? BACK : FRONT;
  if(twosided)
    side0 = side0 ^ BOTH; // the other side
  let sideStr = side0 == BACK ? 'back' : 'front';
  let start, delta;
  if(!castBack){
    start = cover.length - 1;
    delta = -1;
  } else {
    start = 0;
    delta = 1;
  }
  for(let i = start; cover[i].index != index0; i += delta){
    let { index, side } = cover[i];
    caster.moveTo(index).switchSide(sideStr);
    if(side == BOTH || side == side0)
      caster.knit();
  }
  caster.moveTo(index0).switchSide(needles[0].side);
}

function castOn(caster, args){

  // actual cast on
  let { circular, needles, type, starting } = args;

  // i) Insert yarn with manual procedure
  if(starting) // || type != C.PARTIAL)
    caster.insertYarn(true);

  // do nothing if fewer than two needles to cast
  if(needles.length < 2){
    // console.log('Cannot cast on fewer than two needles');
    return;
  }

  // - should start on correct side, with correct direction
  // - direction can be modulated with the catching procedure (tucks)
  //   use 2 + (dir ok ? 0 : 1) passes when catching the yarn
  // - expected direction can be found from needle sequence
  //
  // ii) Catch yarn with tuck procedure
  // iii) Cast-on procedure
  switch(type){

    case C.PARTIAL:
      returnInterlock(caster, needles);
      break;

    case C.AUTO:
    case C.INTERLOCK:
      nearTucks(caster, needles);
      if(circular)
        circularInterlock(caster, needles);
      else
        returnInterlock(caster, needles);
      break;

    case C.KICKBACK:
      if(circular){
        farTucks(caster, needles);
        circularKickback(caster, needles);
      } else {
        nearTucks(caster, needles);
        returnKickback(caster, needles);
      }
      break;

    case C.TUCK:
      nearTucks(caster, needles);
      break;

    case C.PRECAST: {
      let { nbed } = args;
      let cover = precastCover(nbed);
      // ensure cover order is from left to right
      cover.sort((n1, n2) => n1.index - n2.index);
      // reverse cover direction if caster going right
      if(caster.dir == Code.LEFT)
        cover.reverse();
      // use near tucks from cover, on front
      nearTucks(caster, cover.map(n => {
        return { index: n.index, side: 0 }; // needed on front
      }));
      precast(caster, cover, needles);
    } break;

    case C.NONE:
      break;

    default:
      console.log('Warning: invalid cast-on type', type);
      return;
  }
}



module.exports = Object.assign(castOn, C);
