// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const assert = require('./assert.js');
const Layout = require('./bed/layout.js');
const optimizeLayout = require('./bed/optimizer.js');
const TimeNeedleBed = require('./bed/timeneedlebed.js');
const Timer = require('./timer.js');

/**
 * Create the base global layout from a course schedule
 *
 * @param schedule the course schedule
 * @return the base unoptimized global layout
 */
function createLayout(schedule){
  let groups = [];
  let history = {};
  let suspended = []; // list of pending suspended groups
  let lastGrp = null;
  let time = 0;
  for(let block of schedule){
    let grp = Layout.fromBlock(block);
    if(grp.isEmpty())
      continue; // skip empty blocks
    grp.time = time;
    groups.push(grp);

    // fill stitch history while suspending block's stitches
    for(let i = 0; i < grp.groups.length; ++i){
      const g = grp.groups[i];
      for(let s of g.stitches())
        history[s.id] = true;
      if(i > 0){
        // suspend previous stitches that have a missing wale
        // and are not part of the current course
        const susp = grp.groups[i-1].filterStitches(s => {
          return s.findWale(n => !(n.id in history))
              && !g.hasStitch(s);
        });
        if(susp.length){
          const map = {};
          for(let s of susp){
            map[s.id] = grp.groups[i-1].needleOf(s);
          }
          g.suspend(susp, map);
        } // endif susp.length
      } // endif i > 0
    } // endfor i < grp.groups.length

    // linking backward
    // last group:
    // - sheet => last course only
    // - joint => last course only
    // - split => [base-to-branch]=continuity | [branch-to-base]=base
    //         => last course only (from which suspended groups get created)
    if(lastGrp)
      grp.first().linkTo(lastGrp.last());
    for(let suspGrp of suspended)
      grp.first().linkTo(suspGrp.last()); // when grp=[branch-to-base] or branch

    // time duration of current group
    const duration = grp.groups.length;

    // update suspended groups
    for(let i = 0; i < suspended.length; ++i){
      const susp = suspended[i].last().filter(s => {
        // suspend unfinished stitches, unless they are in the current group
        return s.findWale(n => !(n.id in history))
            && !grp.hasStitch(s);
      });
      if(!susp.isEmpty()){
        // create layout group
        let sg = Layout.repeat(susp, duration);
        sg.time = time;
        groups.push(sg);
        // link to previous
        sg.first().linkTo(suspended[i].last());
        // store new suspended stitch group
        suspended[i] = sg;
      } else {
        // remove suspended stitch group
        suspended.splice(i, 1);
        --i;
      }
    }

    // generate supplementary suspended group
    if(lastGrp){
      let susp = lastGrp.last().filter(s => {
        return s.findWale(n => !(n.id in history))
            && !grp.hasStitch(s);
      });
      if(!susp.isEmpty()){
        // create layout group
        let sg = Layout.repeat(susp, duration);
        sg.time = time;
        groups.push(sg);
        // link to previous
        sg.first().linkTo(lastGrp.last());
        // register
        suspended.push(sg);
      }
    }

    // remember group and increment time
    lastGrp = grp;
    time += duration;
  }

  // shouldn't have any remaining suspended group
  assert(!suspended.length, 'Still some suspended group(s)');

  return groups; // new Layout(null, groups);
}

/**
 * Allocate needle beds for a given schedule.
 * The allocation returns the first needle bed
 * and further beds can be accessed through it.
 *
 * @param schedule the block schedule
 * @param optLevel the level of optimizations to go through
 * @param prevBed the current bed to append the layout onto
 * @return the first needle bed group of a full sequence
 */
function allocate(schedule, optLevel, prevBed){
  // const debug = optLevel == 'debug';
  let t = Timer.create();

  // 1 = create layout from schedule
  let groups = createLayout(schedule);
  t.measure('create');

  // 2 = optimize layout
  let layout = optimizeLayout(groups, optLevel);
  t.measure('opt');

  // 3 = pack final time-needle grid
  let bed;
  if(prevBed){
    bed = prevBed.appendLayout(layout);
  } else
    bed = new TimeNeedleBed(layout);
  t.measure('pack');

  // output timing information
  console.log('Layout timing:', t.toString());
  return bed;
}

module.exports = {
  allocate, 
  // export constants
  FRONT_SIDE: Layout.FRONT_SIDE,
  BACK_SIDE:  Layout.BACK_SIDE,
  BOTH_SIDES: Layout.BOTH_SIDES,
  SIDE_FROM_STR: Layout.SIDE_FROM_STR
};
