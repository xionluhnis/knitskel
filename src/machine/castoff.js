// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../skeleton.js');
const Code = require('./code.js');

// constants
const C = {
  AUTO:     sk.CASTOFF_AUTO,
  DIRECT:   sk.CASTOFF_DIRECT,
  REVERSE:  sk.CASTOFF_REVERSE,
  PICKUP:   sk.CASTOFF_PICKUP,
  NONE:     sk.CASTOFF_NONE
};

function tail(caster, n0, n1, ending){
  if(!n1)
    n1 = n0;
  if(caster.hasData())
    caster.flush();
  // make sure initial direction ensures catch
  let dir = Code.getDirectionBetween(caster.current, n1.index);
  // move on correct location
  caster.moveTo(n1.index).switchSide(n1.side);
  if(caster.index != n1.index && caster.dir != dir){
    caster.flip(); // correct direction
  }
  caster.knit().flush();
  let N = 4;
  if(caster.dir == Code.RIGHT)
    N += 1;
  for(let i = 0; i < N; ++i){
    let n = i % 2 ? n1 : n0;
    caster.moveTo(n.index).switchSide(n.side);
    caster.knit();
    if(ending && i == N-1)
      caster.removeYarn(true);
    caster.flush();
  }
}

function oneByOne(caster, needles, reverse, pickup){
  for(let i = 0; i < needles.length - 1; ++i){
    let np = needles[i - 1];
    let n0 = needles[i];
    let n1 = needles[i + 1];
    let dir;
    if(n0.index != n1.index){
      dir = Code.getShiftDirection(
        (reverse ? -1 : 1) * (n1.index - n0.index)
      );
    } else if(i > 0 && np.index != n0.index){
      dir = Code.getShiftDirection(
        (reverse ? -1 : 1) * (n0.index - np.index)
      );
    }
    caster.moveTo(n0.index).switchSide(n0.side);
    if(dir !== undefined && caster.dir != dir)
      caster.flip();
    if(i > 0 && pickup){
      caster.holdAt(np.index, np.side);
    }
    caster.knit();
    caster.flush();
    caster.move(n1);
  }
  let last = needles[needles.length - 1];
  caster.moveTo(last.index).switchSide(last.side);
  caster.knit();
}

function castOff(caster, args){
  let { needles, type, ending } = args;
  if(needles.length < 2){
    type = C.NONE;
  }
  // generic cast-off pass
  // - should start on correct side, with correct direction
  // - should end going right if the yarn gets removed
  // - should fully clear the bed (unless we are the last bed)
  //   because the last bed is the only followed by clearing postamble
  //
  // i) Cast-off procedure
  // ii) Tail procedure ending towards the right
  // iii) Remove yarn
  switch(type){
    case C.PICKUP:
    case C.REVERSE:
    case C.DIRECT:
      oneByOne(caster, needles, type == C.REVERSE, type == C.PICKUP);
      tail(caster, needles[needles.length - 1], needles[needles.length - 2], ending);
      break;
    default:
      if(type != C.NONE)
        console.log('Unsupported castoff', type);
      // remove yarn
      if(ending){
        // needs to be going right
        if(caster.dir != Code.RIGHT)
          caster.flip();
        caster.tuck();
        caster.removeYarn(true);
        caster.flush();
      }
      break;
  }
}


module.exports = Object.assign(castOff, C);
