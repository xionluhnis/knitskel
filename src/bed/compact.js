// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const Layout = require('./layout.js');
const Timer  = require('../timer.js');

module.exports = {
  compact: function(transferFlow){
    const t = Timer.create();
    // create new meta empty time-needle bed
    const tnb = this.createEmpty();
    // visualization containers
    // NeedleBed:
    // - actions (drawFlow)
    // - bed (drawStitches)
    // - isSuspended (drawStitches, drawYarn)
    // - stitchMap / needleOf / hasStitch (drawSimulation, drawYarn)
    // - activeGroup (drawYarn, drawLabels, drawBeds)
    // - groups (updateSelection)
    //
    // TimeNeedleBed:
    // - errors (drawPreText, drawSimulation)
    // - warnings (drawPreText, drawSimulation)
    // - groupMap (drawLabels, drawNodes)
    //
    // Layout:
    // - nodeOrder (drawNodes) -> groupMap (drawNodes)
    //

    // extract list of layout groups
    // and create clean new group wrappers
    const groups = [];
    const groupMap = {};
    for(let i = 0; i < this.groups.length; ++i){
      const gid = this.groups[i];
      const groupData = this.groupMap[gid];
      const newGroup  = new Layout(groupData.groups, 0, 0, true); // transfer ownership
      groups.push(newGroup);
      groupMap[newGroup.id] = groupData;
    }

    // note: groups are already in time order by construction
    // aggregate into same-time fronts
    const fronts = [ { time: 0, groups: [ groups[0] ] } ];
    for(let i = 1; i < groups.length; ++i){
      const currFront = fronts[fronts.length - 1];
      const currGroup = groups[i];
      // /!\ currGroup.first() may not be within that group anymore
      // this vanishing can happen because of duplicate beds
      // note: the last bed should not vanish though ...
      const grpTime = groupMap[currGroup.id].startTime;
      if(grpTime == currFront.time){
        // add to current front
        currFront.groups.push(currGroup);
      } else {
        assert(grpTime > currFront.time, 'Mixed times');
        // create new front
        fronts.push({ time: grpTime, groups: [ currGroup ] });
      }
    }

    // reset time (because individual times may be offset - duplicate beds)
    let time = 0;
    for(let front of fronts){
      front.time = time;
      time += front.groups[0].groups.length;
    }

    // build new list of layout groups without suspended groups
    // by reducing the fronts one by one and propagating the time information
    let offsetMap = {};
    const newGroups = [];
    // forward pass
    for(let i = 0; i < fronts.length; ++i){
      const front = fronts[i];
      // extract active group (that whose last leaf has a non-empty course)
      let active = front.groups.filter(grp => {
        return !grp.last().course.isEmpty();
      });
      assert(active.length <= 1, 'Multiple active groups');
      active = active[0];

      // compute duration of front
      const duration = active ? active.groups.length : front.groups[0].groups.length;
      assert(front.groups.every(g => {
        return g.groups.length == duration;
      }), 'Different durations');

      // boundary groups
      const sources = i > 0 ? fronts[i-1].groups : [];

      // update time offset map
      for(let grp of front.groups){
        // find previous overlapping neighbors
        // note: links may not be valid anymore
        //    => must use overlap / offsets
        const stitches = Array.from(grp.first().stitches());
        const neighbors = sources.filter(g => {
          const leaf = g.last(); // the leaf that may contain neighboring stitches
          // neighbors share stitches or have neighboring stitches
          return stitches.some(s => {
            return leaf.hasStitch(s) || s.findNeighbor(n => leaf.hasStitch(n));
          });
        });
        // past offset
        let offset = neighbors.reduce((minOffset, g) => {
          return Math.min(minOffset, offsetMap[g.id] || 0);
        }, Infinity);
        if(!isFinite(offset))
          offset = 0;
        if(grp == active){
          grp.time = front.time - offset;
          offsetMap[grp.id] = offset; // active => no extra offset
        } else {
          offsetMap[grp.id] = offset + duration;
        }
      }
      // add new group if active
      if(active){
        newGroups.push(active);
      }
    }
    // backward pass
    offsetMap = {};
    for(let i = fronts.length - 1; i >= 0; --i){
      const front = fronts[i];
      // extract active group
      const active = front.groups.find(grp => {
        return !grp.last().course.isEmpty();
      });

      // compute duration of front
      const duration = active ? active.groups.length : front.groups[0].groups.length;

      // boundary groups
      const targets = i < fronts.length - 1 ? fronts[i+1].groups : [];

      // update time offset map
      for(let grp of front.groups){
        // find next overlapping neighbors
        // note: links may not be valid anymore
        //    => must use overlap / offsets
        const stitches = Array.from(grp.last().stitches());
        const neighbors = targets.filter(g => {
          const leaf = g.first(); // the leaf that may contain neighboring stitches
          // neighbors share stitches or have neighboring stitches
          return stitches.some(s => {
            return leaf.hasStitch(s) || s.findNeighbor(n => leaf.hasStitch(n));
          });
        });
        // future offset
        let offset = neighbors.reduce((minOffset, g) => {
          return Math.min(minOffset, offsetMap[g.id] || 0);
        }, Infinity);
        if(!isFinite(offset))
          offset = 0;
        if(grp == active){
          grp.time += offset;
          offsetMap[grp.id] = offset; // active => no extra offset
        } else {
          offsetMap[grp.id] = offset + duration;
        }
      }
    }

    // transform absolute timings of layout groups into offsets
    // since those get applied to the leaves
    for(let active of newGroups){
      active.time -= active.groups.reduce((min, leaf) => Math.min(min, leaf.time), Infinity);
    }

    // append to new layout while splitting in sub-groups
    // for each independent connected components
    let subGroup = [];
    for(let i = 0; i < newGroups.length; ++i){
      const startTime = groupMap[newGroups[i].id].startTime;
      if(subGroup.length && this.timeline[startTime - 1].isEmpty()){
        // commit previous sub-group
        tnb.appendLayout(subGroup, true);
        // create new sub-group
        subGroup = [ newGroups[i] ];
      } else {
        // append to current sub-group
        subGroup.push(newGroups[i]);
      }
    }
    // commit last sub-group
    tnb.appendLayout(subGroup, true);

    // transfer necessary containers (actions, errors, warnings)
    // - actions
    const timeMap = {};
    for(let t0 = 0; t0 < this.length; ++t0){
      const prevBed = this.timeline[t0];
      if(prevBed.actions.length === 0)
        continue;
      const t1 = prevBed.activeGroup.time; // got updated by appendLayout above
      timeMap[prevBed.activeGroup.id] = t1;
      const currBed = tnb.timeline[t1];
      currBed.actions.push(...prevBed.actions);
      Object.assign(currBed.actionMap, prevBed.actionMap);
    }
    // - errors and warnings
    for(let what of ['errors', 'warnings']){
      for(let i = 0; i < this[what].length; ++i){
        const err = this[what][i];
        if(err.group){
          const time = err.group.time; // got updated by appendLayout before
          if(err.flow){
            for(let entry of err.flow.pointers){
              // remap time using new stitch map
              entry.time = tnb.stitchMap[entry.stitch.id].time;
            }
          }
          tnb[what].push(Object.assign({}, err, { time }));
        }
        /* else {
          tnb[what].push(err);
        } */
      }
    }
    if(transferFlow){
      for(let t = 0; t < tnb.length; ++t){
        const nbed = tnb.timeline[t];
        for(let stitch of nbed.stitches()){
          const obed = this.stitchMap[stitch.id];
          const { index, side } = obed.needleOf(stitch);
          const flow = nbed.states[side][index] = obed.states[side][index];
          if(!flow)
            continue;
          for(let entry of flow.pointers){
            entry.time = tnb.stitchMap[entry.stitch.id].time;
          } // endfor entry
        } // endfor stitch of nbed.stitches()
      } // endfor t
    } // endif transferFlow
    t.measure('run');
    console.log('Compaction', t.toString());

    return tnb;
  } // endfun compact
};
