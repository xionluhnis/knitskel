// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const { FRONT_SIDE, BACK_SIDE, BOTH_SIDES } = require('./layout.js');
const { PassType, Pass } = require('../ir.js');

// single empty map reference
const EmptyMap = {};
const SIDE_STR = {
  [FRONT_SIDE]: 'front',
  [BACK_SIDE]:  'back'
};

/**
 * Needle bed constructor
 *
 * @param parent the time needle bed containing this needle bed
 * @param time the time of this bed within its parent
 */
function NeedleBed(parent, time){
  // properties
  this.parent = parent;
  this.time = time;
  this.has = {
    front: false,
    back: false
  };
  this.active = true;
  this.duplicate = false;

  // containers
  this.groups = new Set();
  this.activeGroup = null;
  this.stitchPtr = {};
  this.bed = this.needles = {
    front: new Array(parent.width),
    back:  new Array(parent.width)
  };
  this.beds = [this.bed.front, this.bed.back]; // shared arrays

  // bed interpretation (inter. repr.)
  this.passes = [];
  this.castonMap = EmptyMap;
  this.actionMap = EmptyMap;
  this.transferMap = {};
  this.castoffMap = EmptyMap;
  this.actions = [];

  // simulation
  this.state = {
    front:  new Array(parent.width),
    back:   new Array(parent.width)
  };
  this.states = [ this.state.front, this.state.back ]; // shared arrays

  // local annotations
  this.errors = {};
  this.warnings = {};
}

NeedleBed.prototype.isEmpty = function(){
  return this.groups.size == 0;
};

NeedleBed.prototype.prev = function(){
  return this.parent.at(this.time-1);
};
NeedleBed.prototype.next = function(){
  return this.parent.at(this.time+1);
};
NeedleBed.prototype.shape = function(){
  return this.activeGroup ? this.activeGroup.shape : null;
};
NeedleBed.prototype.node = function(){
  return this.activeGroup ? this.activeGroup.shape.node : null;
};

/**
 * Add an IR pass for this bed
 *
 * @param pass the pass
 */
NeedleBed.prototype.addPass = function(pass, options){
  if(pass instanceof Pass)
    assert(options === undefined, 'No options with direct pass');
  else {
    pass = Pass.from(pass, options);
  }
  this.passes.push(pass);
  switch(pass.type){
    case PassType.CAST_ON:
      assert(this.castonMap == EmptyMap, 'Two caston passes');
      this.castonMap = pass.actionMap;
      break;
    case PassType.CAST_OFF:
      assert(this.castoffMap == EmptyMap, 'Two castoff passes');
      this.castoffMap = pass.actionMap;
      break;
    case PassType.ACTIONS:
      assert(this.actionMap == EmptyMap, 'Two action passes');
      this.actionMap = pass.actionMap;
      this.actions = pass.sequence.map(s => pass.actionMap[s.id]);
      break;
    case PassType.TRANSFER:
      Object.assign(this.transferMap, pass.actionMap);
      break;
    default:
      throw 'Invalid pass type ' + pass.type;
  }
};

/**
 * Extend the size of this bed by a given number of needles on its right
 *
 * @param needles the number of needles
 */
NeedleBed.prototype.extendBy = function(needles){
  if(!needles || needles < 0)
    return;
  this.bed.front.length += needles;
  this.bed.back.length += needles;
  this.state.front.length += needles;
  this.state.back.length += needles;
};

/**
 * Check whether a stitch is within this bed
 *
 * @param stitch the stitch ({ id })
 * @return true if this bed contains it, false otherwise
 */
NeedleBed.prototype.hasStitch = function(stitch){
  for(let g of this.groups)
    if(g.hasStitch(stitch))
      return true;
  return false;
};

/**
 * Return the list of stitches at a given needle
 *
 * @param index the needle index
 * @param side the bed side
 * @return the array of stitches at that needle
 */
NeedleBed.prototype.stitchesAt = function(index, side){
  assert(side === FRONT_SIDE || side === BACK_SIDE, 'Invalid side');
  const s = this.beds[side][index] || [];
  if(Array.isArray(s))
    return s;
  else
    return [ s ];
};

/**
 * Return the stitch information available at a given needle
 *
 * @return the corresponding stitch, array of conflicting stitches, or null
 */
NeedleBed.prototype.stitchAt = function(index, side){
  return this.beds[side][index];
};

/**
 * Iterator over all stitches of this bed
 *
 * @param susp whether to include suspended (true) or non-suspended (false) only (default: all)
 */
NeedleBed.prototype.stitches = function*(){
  for(let grp of this.groups){
    yield* grp.stitches();
  }
};

NeedleBed.prototype.activeStitches = function*(){
  for(let grp of this.groups)
    yield* grp.course.stitches;
};

NeedleBed.prototype.suspendedStitches = function*(){
  for(let grp of this.groups)
    yield* grp.suspended;
};

/**
 * Add a layout leaf group to this bed
 *
 * @param grp the Layout.Leaf group
 * @see LayoutLeaf
 */
NeedleBed.prototype.addGroup = function(grp) {
  // add group
  assert(!this.groups.has(grp), 'Adding group twice');
  this.groups.add(grp);
  // register the stitches
  for(let s of grp.stitches()) {
    // global stitch map
    const origin = this.parent.stitchMap[s.id];
    if(!origin || origin.time > this.time){
      // either first time, or earlier in time
      this.parent.stitchMap[s.id] = this;
    }

    // group pointer
    assert(!(s.id in this.stitchPtr), 'Stitch appears twice on same bed');
    this.stitchPtr[s.id] = grp;

    // needle location
    const { index, side } = grp.needleOf(s);

    // bed information
    assert(side === FRONT_SIDE || side === BACK_SIDE, 'Invalid side');
    this.has[SIDE_STR[side]] = true;

    // bed occupancy
    const curr = this.beds[side][index];
    if(curr){
      if(Array.isArray(curr))
        curr.push(s);
      else
        this.beds[side][index] = [curr, s];
      // add conflict information
      this.error(s, 'Invalid overlapping stitch layout');
    } else {
      this.beds[side][index] = s;
    }
  }
};

/**
 * Record an error for a given stitch of this bed
 *
 * @param stitch the stitch related to the error
 * @param message the error message
 */
NeedleBed.prototype.error = function(stitch, message, flow){
  let { index, side } = this.needleOf(stitch);
  this.errors[stitch.id] = message;
  this.parent.errors.push({
    time: this.time, index, side, message, flow, group: this.stitchPtr[stitch.id]
  });
};
// Warning version of error
NeedleBed.prototype.warning = function(stitch, message, flow){
  let { index, side } = this.needleOf(stitch);
  this.warnings[stitch.id] = message;
  this.parent.warnings.push({
    time: this.time, index, side, message, flow, group: this.stitchPtr[stitch.id]
  });
};

/**
 * Check whether a stitch is suspended within this bed.
 *
 * This is currently computed as this stitch being in the previous bed.
 * Since stitches are only active on their first bed and they do not
 * disappear and then reappear on a later bed (but continuously stay
 * suspended until they are cast off).
 *
 * @param stitch { id }
 * @return true if the stitch is not active within this bed
 */
NeedleBed.prototype.isSuspended = function(stitch){
  if(this.time)
    return this.parent.timeline[this.time - 1].hasStitch(stitch);
  else
    return false;
};

/**
 * Return the parent group of a stitch of this bed
 *
 * @param stitch { id }
 * @return its parent group for this bed
 */
NeedleBed.prototype.groupOf = function(stitch){
  return this.stitchPtr[stitch.id];
};

/**
 * Return the needle of a given stitch of this bed
 *
 * @param stitch { id }
 * @return its needle { index, side }
 */
NeedleBed.prototype.needleOf = function(stitch){
  return this.groupOf(stitch).needleOf(stitch);
};

/**
 * Return the list of groups on a given needle
 *
 * @param index the needle index
 * @param side the needle side
 * @return a list of Layout groups instances
 */
NeedleBed.prototype.groupsAt = function(index, side){
  // check for pointers of matching stitches
  let groups = this.stitchesAt(index, side).map(s => this.groupOf(s));
  if(groups.length)
    return groups;

  // otherwise look for group extents
  for(let g of this.groups){
    if(g.isWithin(index, side))
      groups.push(g);
  }
  return groups;
};

/**
 * Return the list of upper-bed stitches that are
 * wale-connected to a given stitch of this bed
 * The wale connections are prior to patterning.
 *
 * @param stitch the stitch of this bed
 * @return a list of stitches in the upper bed
 */
NeedleBed.prototype.upperStitchesOf = function(stitch){
  if(this.time + 1 < this.parent.timeline.length){
    let nextBed = this.parent.timeline[this.time + 1];
    let upper = [];
    // XXX we assume that no upper wale goes beyond the next bed
    //     this could be wrong in a general but should be ok for our
    //     primitives and their tracing way
    for(let waleStitch of stitch.wales){
      if(nextBed.hasStitch(waleStitch))
        upper.push(waleStitch);
    }
    return upper;
  }
  return [];
};
// lower version of upperStitchesOf
NeedleBed.prototype.lowerStitchesOf = function(stitch){
  if(this.time > 0){
    let prevBed = this.parent.timeline[this.time - 1];
    let lower = [];
    // similar assumptions as for ::upperWalesOf
    for(let waleStitch of stitch.wales){
      if(prevBed.hasStitch(waleStitch))
        lower.push(waleStitch);
    }
    return lower;
  }
  return [];
};

/**
 * Return the needles of the upper stitches of a stitch of this bed
 *
 * @param stitch the stitch of this bed
 * @param upper the pre-computed upper stitches (or none, to compute them)
 * @return a list of needles [ { index, side } ]
 */
NeedleBed.prototype.upperNeedlesOf = function(stitch, upper){
  if(!upper)
    upper = this.upperStitchesOf(stitch);
  return upper.map(upperStitch => {
    return this.parent.timeline[this.time + 1].needleOf(upperStitch);
  });
};
// lower verison of upperNeedlesOf
NeedleBed.prototype.lowerNeedlesOf = function(stitch, lower){
  if(!lower)
    lower = this.lowerStitchesOf(stitch);
  return lower.map(lowerStitch => {
    return this.parent.timeline[this.time - 1].needleOf(lowerStitch);
  });
};

module.exports = Object.assign(NeedleBed, { BOTH_SIDES, FRONT_SIDE, BACK_SIDE, MAX_WIDTH: 541 });
