// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const NeedleBed = require('./needlebed.js');
const env = require('../env.js');

function TimeNeedleBed(groups){
  // containers
  this.timeline = [];
  this.groups = [];
  this.nodes = [];
  this.groupMap = {};
  this.nodeMap = {};
  this.stitchMap = {};
  // properties
  this.length = 0;
  this.width = 0;
  // information
  this.errors = [];
  this.warnings = [];
  // append to empty bed
  if(groups)
    this.appendLayout(groups);
}
Object.assign(TimeNeedleBed, {
  BOTH_SIDES: NeedleBed.BOTH_SIDES,
  FRONT_SIDE: NeedleBed.FRONT_SIDE,
  BACK_SIDE:  NeedleBed.BACK_SIDE,
  MAX_WIDTH:  NeedleBed.MAX_WIDTH
});

TimeNeedleBed.prototype.createEmpty = function() {
  return new TimeNeedleBed();
};

TimeNeedleBed.prototype.check = function(){
  // const maxShift = 3;
  // check tension between stitches
  // for(let t = 0; t < this.length; ++t){
    // let nb = this.timeline[t];
  // }
  if(this.width > TimeNeedleBed.MAX_WIDTH){
    this.warnings.push({
      message: 'Bed width is larger than maximum ' + TimeNeedleBed.MAX_WIDTH
    });
  }
};

TimeNeedleBed.prototype.at = function(t){
  if(t >= 0 && t < this.length)
    return this.timeline[t];
  else {
    let nb = new NeedleBed(this, t);
    nb.active = false;
    return nb;
  }
};

TimeNeedleBed.prototype.appendLayout = function(groups, doNotInterpret){
  // find extents for compaction
  let time = { min: Infinity, max: -Infinity };
  let offset = { min: Infinity, max: -Infinity };
  for(let g of groups){
    let leaves = g.leaves();
    for(let l of leaves){
      let t = l.fullTime();
      let o = l.fullOffset();
      // l.full.side = l.fullSide();
      time.min = Math.min(time.min, t);
      time.max = Math.max(time.max, t);
      offset.min = Math.min(offset.min, o);
      if(l.course)
        offset.max = Math.max(offset.max, o + l.course.offset + l.course.width - 1);
    }
  }
  let newWidth = offset.max - offset.min + 1;
  if(this.width < newWidth){
    // update current beds
    for(let t = 0; t < this.timeline.length; ++t){
      this.timeline[t].extendBy(newWidth - this.width);
    }
    this.width = newWidth;
  }
  // if there were already beds, add an empty padding bed in between
  let t0 = 0;
  const duration = time.max - time.min + 1;
  if(this.length){
    t0 = this.length + 1;
    this.timeline.push(new NeedleBed(this, this.length));
    t0 = this.length + 1;
    this.length += 1 + duration;
    this.timeline.push(...Array.from({ length: duration }).map((_, t) => new NeedleBed(this, t0 + t)));
  } else {
    this.length = duration;
    this.timeline = Array.from({ length: duration }).map((_, t) => new NeedleBed(this, t));
  }

  // enable linear access
  for(let g of groups){
    // apply all offsets recursively
    // (time, needle and flip)
    g.applyTime(t0 - time.min);
    g.applyOffset(-offset.min);
    g.applyFlip();

    // add leaves to timeline
    for(let l of g.leaves()){
      this.timeline[l.time].addGroup(l);
    }
  }
  // mark bed types (active | inactive | duplicate)
  // default = active
  for(let t = t0; t < this.length; ++t){
    let prev = this.at(t-1);
    let curr = this.timeline[t];
    // check for duplicate beds
    let isActive = false;
    let hasMove  = false;
    for(let stitch of curr.stitches()){
      // check stitch existence
      if(!prev.hasStitch(stitch)){
        isActive = true;
        curr.activeGroup = curr.groupOf(stitch); // store active group
        break; // no need to check for stitch moves
      } else {
        // check stitch locations match
        let nc = curr.needleOf(stitch);
        let np = prev.needleOf(stitch);
        if(nc.index !== np.index || nc.side !== np.side){
          hasMove = true; // still need to check for new stitches
        }
      }
    }
    // default = active
    if(!isActive){
      // else not active
      curr.active = false;
      // either duplicate
      if(!hasMove)
        curr.duplicate = true;
      // else non-active, non-duplicate = passive
    }
  }

  // remove duplicates (unless we must keep them)
  if(!env.keepDuplicates){
    // filter timeline and update the respective bed times
    this.timeline = this.timeline.filter((bed, t) => t < t0 || !bed.duplicate).map((bed, t) => {
      bed.time = t; // update bed time
      for(let g of bed.groups)
        g.time = t; // update groups time
      return bed;
    });
    this.length = this.timeline.length;
  }

  // compute block information
  for(let t = t0; t < this.timeline.length; ++t){
    let nb = this.timeline[t];
    for(let g of nb.groups){
      // group accessor
      let gid = g.parent.id;
      let shape = g.shape;
      if(gid in this.groupMap){
        this.groupMap[gid].groups.push(g);
        this.groupMap[gid].times.push(t);
      } else {
        this.groupMap[gid] = {
          shape, // can be empty
          groups: [ g ],
          times:  [ t ],
          startTime: t
        };
        this.groups.push(gid);
      }
      // node accessor
      if(!shape)
        continue;
      let nid = shape.node.id;
      if(nid in this.nodeMap) {
        this.nodeMap[nid].groups.push(g);
      } else {
        this.nodeMap[nid] = {
          shape, // is not empty
          groups: [ g ],
          times:  [ t ],
          startTime: t
        };
        this.nodes.push(nid);
      }
    }
  }

  // interpret yarn path
  if(!doNotInterpret)
    this.interpret(t0);

  // compute warnings
  this.check();
  return this;
};

// IR interpretation
Object.assign(TimeNeedleBed.prototype, require('./interpret.js'));
// Backward flow simulation
Object.assign(TimeNeedleBed.prototype, require('./simulate.js'));
// Compaction
Object.assign(TimeNeedleBed.prototype, require('./compact.js'));

module.exports = TimeNeedleBed;
