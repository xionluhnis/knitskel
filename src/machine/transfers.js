// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
// const sk = require('../skeleton.js');
const Code = require('./code.js');
const Pattern = require('../pattern.js');

// constants
const T = {

};

function *join(...lists){
  for(let i = 0; i < lists.length; ++i)
    yield *lists[i];
}

function processTransfers(caster, actions, sources, targets){
  // general transfer pass
  // - take into account moves + restack
  // - convert cable moves (with action.pairing)
  // - specify correct slider-vs-hook usage in L13
  // - use knit cancel (R5=1)
  // - split into up to multiple bed passes (front+back+cables...)
  //
  //
  // TODO integrate existing approaches
  // - Collapse-Shift-Expand
  //   from "A Compiler for 3D Machine Knitting" [McCann16]
  //   https://s3-us-west-1.amazonaws.com/disneyresearch/wp-content/uploads/20160705213118/A-Compiler-for-3D-Machine-Knitting-Paper.pdf
  // - Schoolbus + Sliders
  //   from "Efficient Transfer Planning for Flat Knitting", [Lin2018]
  //   https://drive.google.com/file/d/18vG0r9QOS3atL5PABGysdzCMV7xKoKVi/view

  // map from stitch to original sequence index
  const indexMap  = actions.reduce((map, { context }, idx) => {
    map[context.id] = idx;
    return map;
  }, {});

  // split into non-conflicting sequences
  // possible conflicts:
  // 1) Different source sides (front vs back) must (i.e. will) happen separately
  // 2) Targets must not overwrite source before they have moved (unless it's a cable pair, happening simultaneously)
  // 3) Direct transfers (switching beds) should not appear with L13 including sliders (invalid combination)
  // TODO also subdivide far moves into sequences of sub-moves (e.g. Left-4 = Left-2 twice)
  //
  // Assumptions:
  // - the input order does not matter (single bed transfer pass)
  // - the input needles only appear once as input

  // 1) split into front/back groups
  let groups = [
    { seq: [], map: {}, side: Code.FRONT_SIDE },
    { seq: [], map: {}, side: Code.BACK_SIDE }
  ];
  for(let i = 0; i < sources.length; ++i){
    const { index, side } = sources[i];
    const target = targets[i];
    const restack = actions[i].restack;
    if(!target || (target.index == index && target.side == side && !restack))
      continue; // non-transfer

    const grp = groups[side];
    assert(!(index in grp.map), 'Sequence moves a same source twice');
    grp.seq.push(i);
    grp.map[index] = i;
  }

  // 2) check for ordering constraints across boundaries
  const constraints = [];
  for(let i of join(groups[0].seq, groups[1].seq)){
    const { index: srcIndex, side: srcSide } = sources[i];
    const { index: trgIndex, side: trgSide } = targets[i];
    // if same side, there is no conflict at this stage
    if(srcSide == trgSide)
      continue;
    // otherwise, check whether the target is also moving,
    // in which case we should move the target before overwritting it
    const j = groups[trgSide].map[trgIndex];
    if(j !== undefined){
      // check that it's not a permutation
      // in which case it's not solvable without using an additional needle
      const src2 = sources[j];
      if(src2.index == srcIndex && src2.side == srcSide){
        assert.error('Cable across boundaries are not supported');
        continue;
      }
      // target must move first
      constraints.push({ before: targets[i], after: sources[i] });
    }
  }
  // if there are constraints, we may need to split into sub groups
  if(constraints.length){
    const firstSide = constraints[0].before.side;
    // check if only same side constraint
    // in which case we just order correctly
    if(constraints.every(({ before }) => before.side === firstSide)){
      // is the back first?
      if(firstSide){
        const [ front, back ] = groups;
        groups = [ back, front ];
      }
      // else already correct
    } else {
      // check that there is no weird constraint loop
      let loop = false;
      for(let { before } of constraints){
        for(let { after } of constraints){
          if(before.index == after.index && before.side == after.side){
            loop = true;
          }
        }
      }
      assert.error(!loop, 'The basic ordering will collapse up to', constraints.length, 'transfer(s) at the boundaries.');

      // if no loop issue, then we can just do all constraints in first passes
      const front = { seq: [], map: {}, side: Code.FRONT_SIDE };
      const back  = { seq: [], map: {}, side: Code.BACK_SIDE };
      const passes = [ front, back ];
      for(let { before } of constraints){
        const { index, side } = before;
        const prevGrp = groups[side];
        const idx = prevGrp.map[index];
        const pairing = actions[idx].pairing;

        // if paired (cable), then we must move all the stitches of the cable
        // together in the same pass
        if(pairing){
          const [firsts, , seconds] = pairing;
          for(let s of join(firsts, seconds)){
            const sidx = indexMap[s.id];
            // - remove from default pass
            prevGrp.seq.splice(prevGrp.seq.indexOf(sidx), 1);
            delete prevGrp.map[sources[sidx].index];
            // - add to first pass
            passes[side].seq.push(sidx);
            passes[side].map[sources[sidx].index] = sidx;
          }
        } else {

          // otherwise we just move the constrained stitch
          //
          // - remove from default pass
          prevGrp.seq.splice(prevGrp.seq.indexOf(idx), 1);
          delete prevGrp.map[index];

          // - add to first pass
          passes[side].seq.push(idx);
          passes[side].map[index] = idx;

        }
      }

      // add non-empty pre-passes
      if(back.seq.length)
        groups.unshift(back);
      if(front.seq.length)
        groups.unshift(front);
    }
  }

  // 3) check for sliders and potential related conflicts
  for(let i = 0; i < groups.length; ++i){
    const grp = groups[i];
    // collect bed switching transfers
    const switchingBeds = grp.seq.filter(idx => {
      return sources[idx].side != targets[idx].side;
    });
    // check if group needs moves with sliders
    const sliders = grp.seq.some(idx => {
      const { index, side } = sources[idx];
      // need slider if moving on same bed, with other side's needle being full
      return side == targets[idx].side
          && caster.getBedState(index, Code.OTHER_SIDE[side]);
    });

    // if both, then we must extract transfers switching bed into their own pass
    if(switchingBeds.length && sliders){
      // add new group before current
      const sgrp = {
        seq: switchingBeds,
        map: switchingBeds.reduce((map, idx) => {
          const { index } = sources[idx];
          map[index] = idx;
          return map;
        }, {}),
        side: grp.side // same side
      };
      groups.splice(i, 0, sgrp);
      // remove stitches from previous
      for(let idx of switchingBeds){
        grp.seq.splice(grp.seq.indexOf(idx), 1);
        delete grp.map[sources[idx].index];
      }
      // and shift iteration
      ++i;
    }
    // else there is no issue

    // anyway, we register the slider need
    grp.sliders = sliders;
  }

  // process each sub-sequence
  for(let grp of groups){
    const sliders = !!grp.sliders;
    // cross state
    let crossPairing = null;
    let crossNum  = 0;
    // create block
    const instrs  = [];
    const needles = [];
    for(let idx of grp.seq){
      needles.push(sources[idx]);
      const { index, side } = sources[idx];
      const target  = targets[idx];
      const pairing = actions[idx].pairing;
      const restack = actions[idx].restack;
      // non-move (either skip or restack)
      let instr;
      if(!target || (index == target.index && side == target.side)){
        assert(!pairing, 'Invalid pairing with itself');
        if(restack){
          assert(!crossPairing, 'Restack within cross pair');
          instr = Code.KNIT_DOUBLE_XFER[side];
        }
        else
          instr = Code.LINK_PROCESS;
      } else {
        assert(!restack, 'Invalid restack with move');
        // cross or move
        if(pairing){
          const stitch = actions[idx].context;
          // let pairIdx = indexMap[pairing.id];
          if(crossPairing){
            /*
            assert(crossPair == stitch,
              'Cross pair not matching!');
            assert(pairing == actions[pairIdx].context,
              'Cross pair not bidirectionally matching');
            */
            // quitting pairing if on last stitch of it
            const [, , second] = crossPairing;
            if(stitch == second[second.length-1])
              crossPairing = null;
            // else we are not done with that pairing
          } else {
            crossPairing = pairing; // expect it
          }
          // let reverse = actions[idx].reverse;
          const pattern = stitch.pattern;
          /*
          assert(pairIdx !== undefined && grp.seq.includes(pairIdx),
            'Cross pair between different subgroups');
          // code depends on odd/even sidedness
          XXX add support for reverse cross pairs (only one side can be reversed)
          if(reverse != actions[pairIdx].reverse){
            // odd side pair
            instr = Code.getOddSideCrossCode(!reverse, crossNum);
          } else {
          */
          // regular stitch pair
          instr = Code.getEvenSideCrossCode(Pattern.CROSS_ABOVE[pattern], crossNum);

          // update pair count
          if(!crossPairing)
            ++crossNum; // null => the pair is complete
        } else {
          // normal move / transfer
          instr = Code.getTransferCode(index, side, target.index, target.side);
        }
      }
      // and instruction
      instrs.push(instr);
    } // endfor idx of grp.seq

    // check cross pair state
    assert(!crossPairing, 'Unpaired cross pair instruction');

    // set transfer type and tension
    // note: tension doesn't impact the transfers
    caster.addOptions({
      [Code.TRANSFER_TYPE]: Code.getTransferType(grp.side, sliders) // XXX compulsive=true?
    });

    // apply block transfer (without changing position / side)
    caster.locally(() => {
      caster.instrBlock(instrs, needles, Code.TRANSFER);
    });

    // update bed state
    // - remove previous stitches
    for(let idx of grp.seq){
      const { index, side } = sources[idx];
      caster.setBedState(index, side, false);
    }
    // - add new stitches
    for(let idx of grp.seq){
      const { index, side } = targets[idx];
      caster.setBedState(index, side, true);
    }
  } // endfor grp of groups
}

module.exports = Object.assign(processTransfers, T);
