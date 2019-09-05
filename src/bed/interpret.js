// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const env = require('../env.js');
const sk = require('../skeleton.js');
const { Action, PassType } = require('../ir.js');
const Pattern = require('../pattern.js');
const { FRONT_SIDE }= require('./needlebed.js');
const Timer = require('../timer.js');

function isRegular(stitch, upper, kickback, split){
  // Irregular:
  // - end of bounded course (uwale is course)
  // - |U|>1 <=> multiple uwales
  // - |U|=0 <=> last course (no uwale)
  // - kickback
  // - split
  // XXX does regularity require grid structure (no move?) e.g. not a decrease
  return upper.length == 1 && !stitch.courses.has(upper[0]) && !kickback && !split;
}

function missTargets(nbed, seq, actionMap){
  for(let i = 0; i < seq.length; ++i){
    let action = actionMap[seq[i].id];
    if(action.action == Action.MISS)
      action.targets = [];
  }
}

const CrossState = {
  FIRST_PART:   0,
  RELIEF:       1,
  SECOND_PART:  2,
  INVALID:      3
};

function patternTargets(nbed, seq, actionMap, bounded){
  let moves = seq.filter(s => actionMap[s.id].regular && s.pattern in Pattern.MOVE_PATTERNS);
  let cross = seq.filter(s => actionMap[s.id].regular && s.pattern in Pattern.CROSS_PATTERNS);
  if(!moves.length && !cross.length)
    return missTargets(nbed, seq, actionMap);

  // directionality
  if(seq.length < 2)
    return missTargets(nbed, seq, actionMap); // undefined direction

  // new targets (to be changed all at once)
  let targetMap = {};

  // compute directionality information
  let dir = 0;
  for(let i = 1; i < seq.length && !dir; ++i){
    let n0 = nbed.needleOf(seq[i-1]);
    let n1 = nbed.needleOf(seq[i]);
    // we need two consecutive stitches on the same side
    if(n0.side != n1.side)
      continue;
    // direction depends on side
    if(n0.side == FRONT_SIDE){
      // front side: left-to-right = positive
      dir = n1.index > n0.index ? 1 : -1;
    } else {
      // back side: left-to-right = negative
      dir = n1.index > n0.index ? -1 : 1;
    }
  }
  if(!dir){
    nbed.warning(seq[0], 'Undefined course directionality');
    return missTargets(nbed, seq, actionMap);
  }

  // location shortcut
  let neighborIdxOf = (i, shifts) => {
    if(bounded)
      return i + dir * shifts;
    else
      return (i + dir * shifts + seq.length) % seq.length;
  };
  // find cable targets
  // XXX currently only consider single instruction pairs (not paired groups)
  while(cross.length){
    let s = cross.pop();
    let i0 = seq.indexOf(s);
    let crossDir = Pattern.DIRECTION_OF[s.pattern];
    let compPattern = Pattern.CROSS_COMPLEMENT_OF[s.pattern];
    assert(crossDir, 'Invalid cross direction');
    // find cross pair groups
    let first = [s];
    let relief = [];
    let second = [];
    let crossState = CrossState.FIRST_PART;
    for(let i = 1; i < seq.length && crossState != CrossState.INVALID; ++i){
      let n = seq[neighborIdxOf(i0, i * crossDir)];
      if(!n)
        break; // out of the sequence
      if(n.pattern in Pattern.CROSS_PATTERNS){
        switch(crossState){

          case CrossState.FIRST_PART:
              // staying in first part, going to second part or invalid
              if(n.pattern == s.pattern)
                first.push(n); // increase cross base
              else if(n.pattern == compPattern){
                second.push(n); // switch to second part
                crossState = CrossState.SECOND_PART;
              } else
                crossState = CrossState.INVALID;
            break;

          case CrossState.RELIEF:
              // switching to second part or invalid
              if(n.pattern == compPattern){
                second.push(n); // switch to second part
                crossState = CrossState.SECOND_PART;
              } else
                crossState = CrossState.INVALID;
            break;

          case CrossState.SECOND_PART:
              // staying in second part, or done
              if(n.pattern == compPattern)
                second.push(n);
              else
                crossState = CrossState.INVALID;
            break;
        }
      } else {
        if(crossState == CrossState.RELIEF){
          relief.push(n);
          continue; // extra relief
        } else if(crossState == CrossState.FIRST_PART){
          relief.push(n);
          crossState = CrossState.RELIEF; // switch to relief
        } else {
          break; // out of cross pair
        }
      }
    } // endfor i < seq.length
    if(second.length){
      // discard all if full second side is on different side
      // else discard different-side ones
      let t0 = actionMap[s.id].targets[0];
      let firstTargets = first.map(({ id }) => actionMap[id].targets[0]);
      if(firstTargets.some(n => n.side != t0.side)){
        // invalid first part => skip this one as cross
        nbed.warning(s, 'Cross pairs should be on same bed side');
        moves.push(s);
        continue;
      }

      // filter to valid pair side
      second = second.filter(({ id }) => {
        return actionMap[id].targets[0].side == t0.side;
      });
      if(second.length === 0){
        // invalid second part => skip this one as cross
        moves.push(s); // XXX could skip all rest of base too
        continue;
      }

      // compute cross targets
      let stitches = [...first, ...relief, ...second];
      let targets = stitches.map(({ id }) => actionMap[id].targets[0]);
      // XXX in practice, should do first transfer for increases/decreases,
      // then trigger the cross moves (since these could be combined
      // shaping+cross transfers targets)
      // targets of first part
      const N = targets.length;
      const F = first.length;
      for(let i = 0; i < first.length; ++i){
        let n = first[i];
        targetMap[n.id] = [Object.assign({}, targets[N-F+i])];
      }
      const S = second.length;
      for(let i = 0; i < relief.length; ++i){
        let n = relief[i];
        targetMap[n.id] = [Object.assign({}, targets[S+i])];
      }
      for(let i = 0; i < second.length; ++i){
        let n = second[i];
        targetMap[n.id] = [Object.assign({}, targets[i])];
      }

      // store pairing information
      let firstPairing  = [first.slice(), relief.slice(), second.slice()];
      let secondPairing = [second.slice().reverse(), relief.slice().reverse(), first.slice().reverse()];
      for(let n of first)
        actionMap[n.id].pairing = firstPairing.map(a => a.slice());
      for(let n of second)
        actionMap[n.id].pairing = secondPairing.map(a => a.slice());

      // remove the pairings from the list
      for(let n of first.slice(1))
        cross.splice(cross.indexOf(n), 1);
      for(let n of second)
        cross.splice(cross.indexOf(n), 1);

    } else {
      // invalid => we reduce it to a "move"
      moves.push(s);
    }
  }

  // find move targets
  for(let s of moves){
    let i0 = seq.indexOf(s);
    let moveDir = Pattern.DIRECTION_OF[s.pattern];
    assert(moveDir, 'Invalid move direction');
    let moveSteps = Pattern.STEPS_OF[s.pattern] || 0;
    assert(moveSteps, 'Invalid move steps');
    let n = seq[neighborIdxOf(i0, moveSteps * moveDir)];
    if(n){
      // change target
      let targets = actionMap[n.id].targets;
      targetMap[s.id] = [Object.assign({}, targets[0])];
    }
    // else the move is impossible
    // => no target change
  }

  // apply all target changes
  for(let sid in targetMap){
    actionMap[sid].targets = targetMap[sid];
  }
  // change targets of misses
  missTargets(nbed, seq, actionMap);
}

module.exports = {
  interpret: function(t0){
    let t = Timer.create();
    let stitch = null;
    let hasKickback = {}, hasSplit = {}, hasSplitted = {};
    let setKickback = {}, setSplit = {}, setSplitted = {};
    for(let t = t0; t < this.length; ++t){
      let nbed = this.timeline[t];

      // duplicate beds require no pass at all
      if(nbed.duplicate)
        continue;

      // 1 = initial transfer pass for suspended groups
      if(t > 0 && (nbed.groups.size > 1 || !nbed.activeGroup)){
        let prev = nbed.prev();
        let transfers = {};
        let stitches = [];
        for(let s of nbed.stitches()){
          if(nbed.isSuspended(s)){
            let { index, side } = nbed.needleOf(s);
            let { index: pIndex, side: pSide } = prev.needleOf(s);
            // only consider changes
            if(index != pIndex || side != pSide){
              stitches.push(s);
              transfers[s.id] = Action.from(s, {
                source: { index: pIndex, side: pSide },
                target: { index, side }
              });
            }
          }
        } // end for s
        if(stitches.length){
          // re-order sequence by side
          stitches.sort((s1, s2) => transfers[s1.id].source.side - transfers[s2.id].source.side);
          nbed.addPass(PassType.TRANSFER, { actionMap: transfers });
        }
      }

      // remaining passes only tackle the active group
      let grp = nbed.activeGroup;
      if(!grp)
        continue;

      const shape = grp.shape;
      const crs = grp.course;
      const shortrow = shape.isShortRow(grp.crsId);
      const node = shape.node;

      // 2 = cast on needles
      //  a) Introduce yarn if needed
      //  b) Cast on new needles
      let caston = false;
      let seq;
      if(!stitch){
        caston = true;
        stitch = crs.firstEndpoint(true); // must be free
        // cast-on type
        const itfName = shape.getCourseName(grp.crsId);
        const itf = node.getInterface(itfName);
        assert(itf, 'Casting on from a non-interface course');
        let castOnType = (itf || {}).caston || sk.CASTON_AUTO;
        if(castOnType == sk.CASTON_AUTO)
          castOnType = env.global.castOnType;
        seq = crs.yarnSequence(stitch);
        nbed.addPass(PassType.CAST_ON, {
          yarnStarts: true, // starting new yarn
          sequence: seq,
          action: castOnType
        });
      } else {
        assert(nbed.hasStitch(stitch), 'Cannot start with a stitch that does not exist');
        assert(crs.isEndpoint(stitch), 'Starting stitch is not an endpoint');
        seq = crs.yarnSequence(stitch);
      }

      // 3 = cast instructions
      //  a) Follow yarn over bed and create knit/tuck/miss instructions
      //     while casting intermediary needles as necessary
      //  b) Apply transfers / cables / moves / restack instructions

      // per-node increase type
      let increase = node.increase;
      if(increase == sk.INCREASE_AUTO)
        increase = env.global.increase;

      let actionMap = {};
      // { regular: true|false
      //   action: K|T|M or FB-Knit|Split|Kickback
      //   reverse: true|false (only true possible for regular K|T|M)
      //   source: n0 (source needle { index, side })
      //   targets: [ n1, n2 ] (typically one target, or two for split / fb-knit)
      // }
      for(let i = 0; i <  seq.length; ++i){
        let s = seq[i];
        let source = nbed.needleOf(s);

        // Does the stitch require intermediate casting?
        let casting = !caston && nbed.lowerStitchesOf(s).length === 0;

        // What are the transfer targets?
        //    at least n1, possibly also n2
        let trgStitches = nbed.upperStitchesOf(s);
        let targets = nbed.upperNeedlesOf(s, trgStitches);

        // Does the stitch require kickback or split?
        let kickback = hasKickback[s.id];
        let split = hasSplit[s.id];
        let splitted = hasSplitted[s.id];
        if(splitted && targets.length > 1){
          nbed.warning(s, 'Unstable split increase on split stitch');
        }

        // Is it a regular stitch?
        //    (Regular|Irregular)
        let regular = isRegular(s, targets, kickback, split) && !splitted;

        // Which action is required?
        //    (Knit|Tuck|Miss|FB-Knit|Split|Kickback)
        // Which side does the action happen on?
        //    (Normal or Reverse)
        // Do we restack the stitch?
        //    (true|false)
        let action;
        let reverse;
        let restack = false;
        let increaseType, increaseTarget;
        if(regular){
          // regular stitch
          //
          // action from pattern: K|T|M
          //
          if(s.pattern == Pattern.TUCK)
            action = Action.TUCK;
          else if(s.pattern == Pattern.MISS){
            action = Action.MISS;
          } else
            action = Action.KNIT;
          if(s.pattern == Pattern.STACK)
            restack = true;
          reverse = s.pattern in Pattern.REVERSE_PATTERNS;

        } else {

          // irregular stitch
          //
          // action from targets: Knit|FB-Knit|Split|Kickback
          //
          if(targets.length < 2){
            if(splitted){
              action = Action.SPLIT_MISS;
            } else if(kickback){
              action = Action.KICKBACK;
              increaseTarget = kickback;
            } else if(split){
              action = Action.SPLIT;
              increaseTarget = split;
            } else if(shortrow && s.pattern == Pattern.TUCK){
              action = Action.TUCK; // special short-row tuck
            } else
              action = Action.KNIT;
          } else {
            if(targets.length > 2)
              nbed.error(s, 'Cannot have more than two upper wales');
            // select type of action depending on target location
            // is it a FB-Knit action? else it's an increase, which type?
            let { index: idx0, side: side0 } = targets[0];
            let { index: idx1, side: side1 } = targets[1];
            if(idx0 == idx1 && side0 == 1 - side1 && crs.bounded){
              casting = false; // no need for intermediate casting
              action = Action.FB_KNIT;
            } else {
              // check if we can use split increase
              let usingSplit = increase == sk.INCREASE_SPLIT;
              // sort targets by distance on bed
              let ordered = targets.slice().sort((t1, t2) => {
                let d1 = Math.abs(t1.index - source.index) + Math.abs(t1.side - source.side);
                let d2 = Math.abs(t2.index - source.index) + Math.abs(t2.side - source.side);
                return d1 - d2;
              });
              let closeIdx = targets.indexOf(ordered[0]);
              let farIdx = targets.indexOf(ordered[1]);
              let closeTrg = ordered[0];
              let farTrg = ordered[1];
              if(usingSplit) {
                // only if first target is the same as source
                // and second target is within 2 needles
                if(closeTrg.index != source.index
                || closeTrg.side != source.side
                || (farTrg.side != source.side && farTrg.index !== source.index)
                || (Math.abs(farTrg.index - source.index) > 2)){
                  nbed.warning(s, 'Cannot use split given move constraints');
                  usingSplit = false;
                } else if(splitted)
                  usingSplit = false;
              }
              // generate default knit, and trigger increase on next pass
              if(splitted)
                action = Action.SPLIT_MISS;
              else if(kickback){
                action = Action.KICKBACK;
                increaseTarget = kickback;
              } else if(split){
                action = Action.SPLIT;
                increaseTarget = split;
              } else
                action = Action.KNIT;
              if(usingSplit){
                setSplit[trgStitches[closeIdx].id] = farTrg;
                setSplitted[trgStitches[farIdx].id] = farTrg;
                targets = ordered;
                increaseType = Action.SPLIT;
              } else {
                setKickback[trgStitches[closeIdx].id] = closeTrg;
                targets = ordered.reverse();
                increaseType = Action.KICKBACK;
              }
            }
          }
          reverse = false;
        }

        // check if bed conflict with reverse bed actions
        if(reverse){
          let revNeedle = nbed.beds[1 - source.side][source.index];
          if(revNeedle){
            // reverse action creates a conflict!
            if(node.gauge == sk.FULL_GAUGE)
              nbed.warning(s, 'Reverse stitch conflict: maybe use half-gauge?');
            else
              nbed.warning(s, 'Reverse stitch conflict');
          }
        }

        // store context information for instruction
        actionMap[s.id] = Action.from(s, {
          action, regular, reverse, source, targets, casting, restack, increaseType, increaseTarget
        });
      } // endfor s of seq
      // change targets of regular patterned stitches for
      // - Cross patterns first
      // - Move patterns second
      // - Miss patterns last
      patternTargets(nbed, seq, actionMap, crs.bounded);
      // casting type
      let safeCast;
      if(node.casting == sk.CASTING_AUTO){
        // safe cast for splits by default
        safeCast = node.category == sk.NODE_SPLIT;
      } else {
        safeCast = node.casting == sk.CASTING_SAFE;
      }
      // create actual action pass
      nbed.addPass(PassType.ACTION, {
        sequence: seq, actionMap, safeCast
      });

      // 4 = Apply transfers / cables / moves / restack instructions
      let transfers = [];
      let transferMap = {};
      for(let s of seq){
        let act = actionMap[s.id];
        // no target => no transfer
        if(!act.targets.length)
          continue; // no transfer
        // FB-knit => targets are part of action
        if(act.action == Action.FB_KNIT)
          continue;
        let curr = nbed.needleOf(s);
        let next = act.targets[0];
        if(curr.index != next.index || curr.side != next.side){
          // must transfer
          transfers.push(s);
          transferMap[s.id] = Action.from(s, {
            source: curr, target: next, restack: act.restack, pairing: act.pairing
          });
        }
      }
      if(transfers.length){
        nbed.addPass(PassType.TRANSFER, {
          sequence: transfers, actionMap: transferMap
        });
      }

      // 5 = cast off / clear off + yarn removal
      //  a) Cast off needles that have no further wales
      //  b) Remove yarn if needed
      // select starting stitch for next bed
      stitch = seq[seq.length-1].findCourse(courseStitch => {
        return !nbed.hasStitch(courseStitch);
      });
      let nextBed = this.at(t + 1);
      if(!stitch){
        // we may need to cast off some needles
        // unless we are suspending all stitches
        seq = seq.slice().reverse().filter(s => {
          return !nextBed.hasStitch(s);
        });
        const itfName = shape.getCourseName(grp.crsId);
        const itf = node.getInterface(itfName);
        assert(itfName, 'Casting off a non-interface course');
        // note: itf may not exist (e.g. branch interface of split)
        let castOffType = (itf || {}).castoff || sk.CASTOFF_AUTO;
        if(castOffType == sk.CASTOFF_AUTO)
          castOffType = env.global.castOffType;
        if(!seq.length)
          castOffType = sk.CASTOFF_NONE;
        nbed.addPass(PassType.CAST_OFF, {
          yarnEnds: true, // remove the yarn
          sequence: seq,
          action: castOffType
        });

      } else {
        // confirm the next bed has that stitch
        assert(nextBed.hasStitch(stitch), 'Vanishing stitch');
        // check whether we must clear off some needles
        const clearStitches = seq.filter(s => {
          const act = actionMap[s.id];
          // clear if:
          // - has an action
          // - has no direct next targets
          // - has no further targets (i.e. not suspended on next bed)
          // /!\ suspended/-ing stitches have no direct targets
          //     but they should not be cleared!
          return act && act.targets.length === 0 && !nextBed.hasStitch(s);
        });
        if(clearStitches.length){
          nbed.addPass(PassType.CAST_OFF, {
            sequence: clearStitches, action: sk.CASTOFF_NONE
          });
        }
      }

      // update increase information
      hasKickback = setKickback;
      setKickback = {};
      hasSplit = setSplit;
      setSplit = {};
      hasSplitted = setSplitted;
      setSplitted = {};
    } // endfor t
    t.measure('run');
    console.log('Interpret', t.toString());
  } // endfun interpret
};
