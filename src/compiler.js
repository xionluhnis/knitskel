// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert  = require('./assert.js');
const env     = require('./env.js');
const Caster  = require('./machine/caster.js');
const Castoff = require('./machine/castoff.js');
const Caston  = require('./machine/caston.js');
const Code    = require('./machine/code.js');
const DATFile = require('./machine/datfile.js');
const Transfers = require('./machine/transfers.js');
const Pattern = require('./pattern.js');
const Timer   = require('./timer.js');
const { Action, PassType } = require('./ir.js');

// XXX should use some range above default
// e.g. 80-89 for knit tensions
//      90-99 for xfer tensions
const Tension = {
  TIGHT_START:  33,
  TIGHT_END:    24,
  NORMAL:       5,
  LOOSE:        6,
  LOOSER:       7,
  LOOSEST:      8
};

// single carrier
const carrier = 1;

function processCastOn(nbed, caster, pass){
  // set carrier and tight initial tension
  caster.setOptions({
    [Code.TENSION]: Tension.TIGHT_START
  });
  // specialized caston procedure
  const group = nbed.activeGroup;
  const needles = pass.sequence.map(s => nbed.needleOf(s));
  Caston(caster, {
    circular: group.course.circular, // && group.course.side == BOTH
    nbed, needles,
    type: pass.action,
    starting: pass.yarnStarts
  });

  // set bed state
  for(let { index, side } of needles){
    if(!nbed.states[side][index])
      nbed.states[side][index] = true;
    // else keep back flow
  }
}

function processPartialCastOn(nbed, caster, needles){
  Caston(caster, { type: Caston.PARTIAL, nbed, caster, needles });

  // set bed state
  for(let { index, side } of needles){
    if(!nbed.states[side][index])
      nbed.states[side][index] = true;
  }
}

function processCastOff(nbed, caster, pass){
  // set carrier and tight initial tension
  caster.setOptions({
    [Code.TENSION]: Tension.TIGHT_END
  });
  // specialized castoff/clearoff procedure
  const group = nbed.activeGroup;
  const needles = pass.sequence.map(s => nbed.needleOf(s));
  Castoff(caster, {
    circular: group.course.circular, // && group.course.side == BOTH
    needles,
    type: pass.action,
    ending: pass.yarnEnds
  });

  // explicit bed clearing unless we are the last bed
  // or no needles need clearing (we just needed yarn cutting)
  if(pass.yarnEnds && needles.length && nbed.time < nbed.parent.length - 1){
    caster.clear(needles, 3);
  }
}

function setBedOptions(nbed, caster){
  let grp = nbed.activeGroup;
  let shape = grp.shape;
  let node = shape.node;
  let expansion = node.expansion || 0;
  let expandable = nbed.prev().shape() == shape && nbed.next().shape() == shape;
  let presser = shape.isShortRow(grp.crsId);
  caster.setOptions({
    [Code.REPEAT]: expandable ? expansion : 0,
    [Code.TENSION]: Tension.NORMAL,
    [Code.FABRIC_PRESSER]: presser ? 101 : 0
  });
}

function getTensionFor(pass){
  let maxDelta = 0;
  let crossNum = 0;
  for(let s of pass.sequence){
    let { source, targets } = pass.actionMap[s.id];
    let target = targets[0];

    // record number of cross instructions
    if(s.pattern in Pattern.CROSS_PATTERNS)
      ++crossNum;

    // record delta
    // note: may not have a target!
    if(target)
      maxDelta = Math.max(maxDelta, Math.abs(target.index - source.index));
  }
  // assert(crossNum % 2 === 0, 'Odd number of cross pattern instructions');
  return getTension(maxDelta, Math.round(crossNum / 2));
}

function getTension(maxDelta, crossNum){
  let tension = Tension.NORMAL;
  switch(maxDelta){
    case 0:
      tension = Tension.NORMAL;
      break;
    case 1:
    case 2:
      tension = Tension.LOOSE;
      break;
    case 3:
    case 4:
      tension = Tension.LOOSER;
      break;
    default:
      console.log('Warning, large transfer distance:', maxDelta);
      tension = Tension.LOOSEST;
      break;
  }
  // XXX have actual curve for what tension is needed (and map that to
  // // pre-defined tension numbers that gradually increase looseness)
  if(crossNum > 4){
    tension += Math.ceil(crossNum / 5);
  }
  return tension;
}

function processActions(nbed, caster, pass){
  // set options
  setBedOptions(nbed, caster);
  caster.addOptions({
    [Code.TENSION]: getTensionFor(pass)
  });

  // split sequence into casted and casting sub-sequences (and sides?)
  // - casted => just go over the sequence normally
  // - casting => first interlock cast back-and-forth, then go over sequence
  const subseqs = [];
  let cast = null;
  for(let i = 0; i < pass.sequence.length; ++i){
    const stitch = pass.sequence[i];
    const { action, source } = pass.actionMap[stitch.id];
    const { index, side } = source;
    // only do partial pre-cast if set for the pass
    // and we are not dealing with a miss action (which should not be cast upon)
    const doNotCast = !pass.safeCast
      || action == Action.MISS || action == Action.SPLIT_MISS;
    // depending on casting situation
    if(doNotCast || nbed.states[side][index]){
      // done with any previous partial cast
      cast = null;
    } else {
      // need to do partial cast
      // since needles are not supported
      if(cast)
        cast.push(source);
      else
        subseqs.push(cast = [ source ]);
    }
    // do action
    subseqs.push(i);
  }

  // go over subsequences
  for(let k = 0; k < subseqs.length; ++k){
    const subSeq = subseqs[k];
    // if a subsequence, precast it
    if(Array.isArray(subSeq)){
      processPartialCastOn(nbed, caster, subSeq);
      continue;
    }
    // else a stitch => execute action (unless none)
    assert(typeof subSeq == 'number', 'Subseq either array or number');
    const i = subSeq;
    const s = pass.sequence[subSeq];

    const { action, source, reverse, increaseTarget } = pass.actionMap[s.id];
    if(action == Action.None)
      continue; // skip no action

    // check necessary direction
    let dir;
    const s2 = pass.sequence[i + 1];
    if(s2){
      let { source: src2 } = pass.actionMap[s2.id];
      if(src2.side == source.side && src2.index != source.index){
        dir = src2.index > source.index ? Code.RIGHT : Code.LEFT;
      }
    }

    // move to source needle
    const { index, side } = source;
    caster.moveTo(index, Code.SIDE_STR[side], dir);
    caster.addOptions({
      [Code.TRANSFER_TYPE]: Code.getTransferType(side)
    });

    // apply action
    switch(action){
      case Action.KNIT:
        caster.pknit(reverse);
        break;
      case Action.TUCK:
        caster.ptuck(reverse);
        break;
      case Action.SPLIT_MISS:
      case Action.MISS:
        caster.miss();
        break;
      case Action.FB_KNIT:
        caster.fbknit();
        break;
      case Action.SPLIT:
        caster.splitInto(increaseTarget.index);
        break;
      case Action.KICKBACK:
        caster.kbknit();
        break;
    }
  }
}

function processTransfers(nbed, caster, pass){
  // repeat options from action pass
  setBedOptions(nbed, caster);

  // general transfer pass
  // - take into account moves + restack
  // - convert cable moves (with action.pairing)
  // - specify correct slider-vs-hook usage in L13
  // - use knit cancel (R5=1)
  // - split into multiple bed passes (front+back+cables...)
  const actions   = pass.sequence.map(s => pass.actionMap[s.id]);
  const sources   = actions.map(({ source }) => source);
  const targets   = actions.map(({ targets }) => targets[0]);

  // delegate to generic transfer algorithm
  Transfers(caster, actions, sources, targets);
}

/**
 * Generate instructions from a time needle bed.
 * Global options are within env.global.
 *
 * @param bed the time needle bed
 */
function generate(bed){
  let t = Timer.create();

  const width = bed.width;
  let dat = new DATFile();
  dat.create(width);
  dat.writePreamble();
  // XXX use settings in env.global.needlePos
  dat.setPosition(-20); // env.global.needlePos || 0);
  if(env.global.useDSCS)
    dat.startDSCS();

  // yarn + caster
  let caster = Caster.empty(dat, width, {
    carrier, mode: Caster.LINK_PROCESS
  });

  // process bed over time
  for(let t = 0; t < bed.length; ++t){
    let nbed = bed.timeline[t];

    // process all passes sequentially
    for(let pass of nbed.passes){
      switch(pass.type){
        case PassType.CAST_ON:  processCastOn(nbed, caster, pass); break;
        case PassType.CAST_OFF: processCastOff(nbed, caster, pass); break;
        case PassType.ACTIONS:  processActions(nbed, caster, pass); break;
        case PassType.TRANSFER: processTransfers(nbed, caster, pass); break;
        default:
          console.log('Warning: invalid pass type ', pass);
          break;
      }
      // flush if needed
      if(caster.hasData())
        caster.flush();
    } // endfor pass
  } // endfor t

  // flush caster
  // /!\ needed so that options are written
  if(caster.hasData())
    caster.flush();

  // stop DSCS if used
  if(env.global.useDSCS)
    dat.stopDSCS(dat.current - 1);

  // write necessary information
  dat.writePostamble();
  dat.setLineDirections();
  dat.setCarrierPositions();
  dat.writeOptionBars();
  t.measure('gen');
  console.log('Compiler', t.toString());

  return dat;
}


module.exports = {
  generate
};
