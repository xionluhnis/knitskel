// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const { FRONT_SIDE, BACK_SIDE, BOTH_SIDES, OTHER_SIDE, empty } = require('../course.js');

// constants
const L = {
  FRONT_SIDE, BACK_SIDE, BOTH_SIDES, OTHER_SIDE,
  // mapping from string
  SIDE_FROM_STR: { 'front' : FRONT_SIDE, 'back': BACK_SIDE }
};

// variables
let __groupID = 0;

function Layout(groups, time, offset, transferOwner){
  // fixed properties
  this.id = __groupID++;
  this.parent = null; // to be changed once only
  this.groups = groups;
  for(let g of groups){
    assert(transferOwner || !g.parent, 'Mixed ownership');
    g.parent = this; // create ownership
  }
  // varying properties
  this.time = time || 0;
  this.offset = offset || 0;
  this.flip = false;
}

/**
 * Return the first group within this layout
 */
Layout.prototype.first = function() {
  return this.groups[0];
};

/**
 * Return the last group within this layout
 */
Layout.prototype.last = function() {
  return this.groups[this.groups.length - 1];
};

/**
 * Return whether this group is empty
 */
Layout.prototype.isEmpty = function(){
  return this.groups.every(g => g.isEmpty());
};

/**
 * Return the hierarchical level of a group as the number of parent groups above it.
 * If this group has no parent, then its level is 0.
 * If this group has one parent that has no parent, then its level is 1.
 * ...
 *
 * @return the number of parents in the hierarchy to the root
 */
Layout.prototype.level = function(){
  let l = 0;
  for(let g = this; g.parent != null; ++l, g = g.parent);
  return l;
};

/**
 * Checks whether a stitch is within this group at least once
 *
 * @param stitch the stitch
 * @return whether a subgroup contains this stitch
 */
Layout.prototype.hasStitch = function(stitch) {
  return this.groups.some(g => g.hasStitch(stitch));
};

/**
 * Check whether this layout type is a leaf
 *
 * @return false for the base implementation
 */
Layout.prototype.isLeaf = function(){
  return false;
};

/**
 * Return whether a stitch group (or layout group)
 * is part of the tree spanned by this group
 *
 * @param group the group to check inclusion of
 * @return true if group is part of this, else false
 */
Layout.prototype.contains = function(group){
  while(group.parent){
    // if group's parent is this, group is included
    if(group.parent == this)
      return true;
    // check parent's inclusion
    group = group.parent;
  }
  // not included
  return false;
};

/**
 * Return all the descendant StitchGroup instances of this layout group
 *
 * @return a list of StitchGroup instances
 */
Layout.prototype.leaves = function(){
  let list = [];
  let queue = this.groups.slice();
  while(queue.length){
    let grp = queue.pop();
    if(grp.isLeaf())
      list.push(grp); // catch leaf
    else
      queue.push(...grp.groups); // queue children
  }
  return list;
};

/**
 * Compute set of children groups that are at the boundary of this layout
 *
 * @param container parent context for recursive call (defaults to this object)
 * @return a list of children from this layout
 */
Layout.prototype.boundaries = function(container){
  if(!container)
    container = this;
  let list = [];
  for(let grp of this.groups){
    // recursive call to children
    let bounds = grp.boundaries(container); // using this as container
    if(bounds.length){
      // if the group layout has boundaries, relative to the container
      // then it is a valid boundary group
      list.push(grp);
    }
  }
  return list;
};

/**
 * Compute set of leaves that are at the boundary of this layout
 *
 * @param container parent context for recursive call (defaults to this object)
 * @param links object to store boundary links into
 * @return a list of leaves of this layout
 */
Layout.prototype.boundaryLeaves = function(container, linkMap){
  if(!container)
    container = this;
  const list = [];
  for(let grp of this.groups){
    // recursive call to children
    let bleaves = grp.boundaryLeaves(container, linkMap); // using this as container
    list.push(...bleaves);
  }
  return list;
};

/**
 * Return the side extents of this group
 */
Layout.prototype.side = function(){
  let has_front = false;
  let has_back  = false;
  for(let grp of this.groups){
    switch(grp.side()){
      case FRONT_SIDE: has_front = true; break;
      case BACK_SIDE:  has_back  = true; break;
      default: return BOTH_SIDES;
    }
    if(has_front && has_back)
      return BOTH_SIDES;
  }
  if(has_front && has_back)
    return BOTH_SIDES;
  else if(has_back)
    return BACK_SIDE;
  else
    return FRONT_SIDE;
};

/**
 * Return the full time of this group given its parents
 */
Layout.prototype.fullTime = function(){
  let time = this.time;
  let parent = this.parent;
  while(parent){
    time += parent.time;
    parent = parent.parent;
  }
  return time;
};

/**
 * Return the full offset of this group given its parents
 */
Layout.prototype.fullOffset = function(){
  let offset = this.offset;
  let parent = this.parent;
  while(parent){
    offset += parent.offset;
    parent = parent.parent;
  }
  return offset;
};

/**
 * Return the absolute side of this group
 */
Layout.prototype.fullFlip = function(){
  let flip = this.flip;
  let parent = this.parent;
  while(parent){
    if(parent.flip)
      flip = !flip;
    parent = parent.parent;
  }
  return flip;
};

/**
 * Apply the time offset recursively up to the leaves
 *
 * @param extraTime parent offset to accumulate
 */
Layout.prototype.applyTime = function(extraTime){
  const time = (extraTime || 0) + this.time;
  this.time = 0;
  for(let g of this.groups)
    g.applyTime(time);
};

/**
 * Apply the needle offset recursively up to the leaves
 *
 * @param extraOffset parent offset to accumulate
 */
Layout.prototype.applyOffset = function(extraOffset){
  const offset = (extraOffset || 0) + this.offset;
  this.offset = 0;
  for(let g of this.groups)
    g.applyOffset(offset);
};

/**
 * Apply a bed flip recursively up to the leaves
 *
 * @param extraFlip parent flip to accumulate
 */
Layout.prototype.applyFlip = function(extraFlip){
  const flip = !!(!!extraFlip ^ this.flip);
  this.flip = false;
  for(let g of this.groups)
    g.applyFlip(flip);
};

/**
 * Create a layout group from a course block.
 * This only considers stitches within the course block.
 * It generates a single layout group, which is comprised of stitch groups
 * for each course of the block, each of which includes
 * - active stitches from each course, as well as
 * - suspended stitch from whithin the course block.
 *
 * @param blk the course block
 * @return a new layout group from the course block
 */
Layout.fromBlock = function(blk){
  const shape = blk.shape;
  let groups = [];
  let time = 0;
  let last = null;
  for(let crsId of blk.courses){
    let leaf;
    if(shape.getCourse(crsId))
      leaf = LayoutLeaf.fromCourse(shape, crsId, time++);
    else
      leaf = LayoutLeaf.fromBeds(shape, crsId, time++);
    groups.push(leaf);
    if(last)
      last.linkTo(leaf);
    last = leaf;
  }
  return new Layout(groups);
};

/**
 * Create a layout group by repeating a stitch group
 *
 * @param leaf the leaf to repeat into a new layout group
 * @param n the number of repetitions (over time)
 * @return the new layout group
 */
Layout.repeat = function(leaf, n){
  let groups = Array.from({ length: n }).map((x, time) => {
    return leaf.filter(() => true, time); // all end up suspended
  });
  // link consecutive groups
  for(let i = 1; i < n; ++i)
    groups[i-1].linkTo(groups[i]);
  // return full layout group
  return new Layout(groups);
};

/**
 * Stringified version
 */
Layout.prototype.toString = function(){
  let str = 'Layout(';
  if(this.groups.length){
    if(this.first().shape){
      str += 'shape=' + this.first().shape.node.toString();
      str += ', from=' + this.first().crsId;
      if(this.last().shape)
        str += ', to=' + this.last().crsId;
    } else {
      str += '#grps=' + this.groups.length;
    }
  }
  return str + ') @ (t=' + this.time + ', off=' + this.offset + ', flip=' + this.flip + ')';
};

// ###########################################################################
// ##### Layout Leaf #########################################################
// ###########################################################################

/**
 * Create a layout leaf
 *
 * @param time the group's time
 * @param shape the associated shape (can be null)
 * @param crsId the associated course id (can be null)
 * @param suspended the list of suspended stitches (def [])
 * @param suspMap the needles of the suspended stitches (def {})
 */
function LayoutLeaf(time, shape, crsId, suspended, suspMap){
  Layout.call(this, [], time);

  // initialize leaf information
  this.shape  = shape;
  this.crsId  = crsId;
  this.course = shape && crsId !== undefined ? shape.getCourse(crsId) : empty();
  this.suspended = suspended || [];
  this.suspMap  = suspMap || {};
  this.suspMeta = { has_side: [false, false], min: Infinity, max: -Infinity, width: 0 };
  this.links  = new Set();
}
LayoutLeaf.prototype = Object.create(Layout.prototype);
LayoutLeaf.prototype.constructor = LayoutLeaf;

/**
 * Length is the number of stitches of the leaf group
 * including both course stitches as well as suspended stitches
 */
Object.defineProperty(LayoutLeaf.prototype, 'length', {
  get: function(){
    return this.course.length + this.suspended.length;
  },
  enumerable: true
});

/**
 * Return the side mask corresponding to side flags
 *
 * @param front whether the front is included
 * @param back whether the back is included
 * @return the mask from FRONT_SIDE, BACK_SIDE or BOTH_SIDES, defaulting to FRONT_SIDE
 */
function sideMaskFromFlags(front, back){
  if(front && back)
    return BOTH_SIDES;
  else if(back)
    return BACK_SIDE;
  else
    return FRONT_SIDE;
  // return Math.max(0, (Number(front) | (Number(back) << 1)) - 1);
}

/**
 * Return the side mask of this group
 *
 * @return one of FRONT_SIDE, BACK_SIDE or BOTH_SIDES
 */
LayoutLeaf.prototype.side = function(){
  let has_front = false;
  let has_back  = false;
  if(this.course.length){
    switch(this.course.side){
      case FRONT_SIDE:  has_front = true; break;
      case BACK_SIDE:   has_back  = true; break;
      case BOTH_SIDES:  has_front = has_back = true; break;
      default: assert.error('Invalid course side', this.course.side);
    }
  }
  const side = sideMaskFromFlags(
    has_front || this.suspMeta.has_side[0],
    has_back  || this.suspMeta.has_side[1]
  );
  if(side != BOTH_SIDES && this.flip)
    return 1 - side;
  else
    return side;
};

/**
 * Left needle extent
 */
LayoutLeaf.prototype.min = function(){
  return this.course.length ? Math.min(this.suspMeta.min, this.course.offset + this.offset) : this.suspMeta.min;
};

/**
 * Right needle extent
 */
LayoutLeaf.prototype.max = function(){
  return this.course.length ? Math.max(this.suspMeta.max, this.course.offset + this.offset + this.course.width - 1) : this.suspMeta.max;
};

/**
 * Return the extents of this group over the needle bed
 *
 * @param width whether to include width computation (max - min + 1)
 * @return { min, max } or { min, max, width }
 */
LayoutLeaf.prototype.extents = function(width){
  let min = this.suspMeta.min;
  let max = this.suspMeta.max;
  if(this.course.length){
    min = Math.min(min, this.course.offset + this.offset);
    max = Math.max(max, this.course.offset + this.offset + this.course.width - 1);
  }
  return width ? { min, max, width: max - min + 1 } : { min, max };
};

/**
 * Create a leaf group from a shape and course identifier
 */
LayoutLeaf.fromCourse = function(shape, crsId, time){
  return new LayoutLeaf(time, shape, crsId);
};

/**
 * Create a leaf group from a set of suspended stitches
 */
LayoutLeaf.fromStitches = function(stitches, stitchMap, time){
  return new LayoutLeaf(time, null, undefined, stitches, stitchMap).suspend();
};

LayoutLeaf.fromBeds = function(shape, bedsName, time){
  const [front, back] = shape.getBeds(bedsName);
  assert(front.length || back.length, 'Empty beds');
  const stitches = front.concat(back).filter(s => !!s); // skip empty ones
  const stitchMap = {};
  for(let i = 0; i < front.length; ++i){
    if(front[i]){
      stitchMap[front[i].id] = { index: i, side: FRONT_SIDE };
    }
    if(back[i]){
      stitchMap[back[i].id]  = { index: i, side: BACK_SIDE };
    }
  }
  return new LayoutLeaf(time, shape, undefined, stitches, stitchMap).suspend();
};

/**
 * Return an iterator over the stitches of this group
 */
LayoutLeaf.prototype.stitches = function*() {
  yield* this.course.stitches;
  yield* this.suspended;
};

/**
 * Return the needle of a stitch from this group
 *
 * @param stitch the stitch
 * @return { index, side }
 */
LayoutLeaf.prototype.needleOf = function(stitch){
  if(this.course.hasStitch(stitch)){
    return this.course.needleOf(stitch, this.offset, this.flip);
  } else {
    assert(stitch.id in this.suspMap, 'Needle of missing stitch');
    const { index, side } = this.suspMap[stitch.id];
    return {
      index: index + this.offset,
      side: this.flip ? OTHER_SIDE[side] : side
    };
  }
};

/**
 * Filter the stitches from this group to create a new suspended group
 *
 * @param pred the filter predicate
 * @param time the new group's time
 * @return a new LayoutLeaf from filtered stitches as suspended stitches
 */
LayoutLeaf.prototype.filter = function(pred, time){
  const stitches = [];
  const stitchMap = {};
  for(let stitch of this.stitches()){
    if(pred(stitch)){
      stitches.push(stitch);
      stitchMap[stitch.id] = this.needleOf(stitch);
    }
  }
  return LayoutLeaf.fromStitches(stitches, stitchMap, time);
};

/**
 * Filter the stitches from this group and return the passing ones
 *
 * @param pred the stitch predicate
 * @return an array of stitches passing the predicate
 */
LayoutLeaf.prototype.filterStitches = function(pred){
  const stitches = [];
  for(let stitch of this.stitches()){
    if(pred(stitch)){
      stitches.push(stitch);
    }
  }
  return stitches;
};

/**
 * Return true since this is a leaf
 */
LayoutLeaf.prototype.isLeaf = function() {
  return true;
};

/**
 * Returns whether both the course is empty and not suspended stitch is in this group
 */
LayoutLeaf.prototype.isEmpty = function() {
  return this.course.length === 0 && this.suspended.length === 0;
};

/**
 * Checks whether a stitches is within this group
 */
LayoutLeaf.prototype.hasStitch = function(stitch){
  return this.course.hasStitch(stitch) || stitch.id in this.suspMap;
};

/**
 * Checks whether a needle falls within this group's extents
 */
LayoutLeaf.prototype.isWithin = function(index, side){
  // move index and side to group's frame
  index -= this.offset;
  if(this.flip)
    side = OTHER_SIDE[side];
  // check course
  if(this.course.isWithin(index, side))
    return true;
  // check suspended extents
  return this.suspMeta.has_side[side]
      && index >= this.suspMeta.min
      && index <= this.suspMeta.max;
};

/**
 * Check whether a stitch is suspended within this group
 */
LayoutLeaf.prototype.isSuspended = function(stitch){
  return stitch.id in this.suspMap;
};

/**
 * Return the list of boundary groups from this group's link
 * with respect to a given parent container of this group
 *
 * @param container the parent container (or this)
 * @return a list of boundary groups
 */
LayoutLeaf.prototype.boundaries = function(container){
  if(!container)
    container = this;
  // group is at boundary if it has a link
  // that the container doesn't contain
  const list = [];
  for(let lnk of this.links){
    if(!container.contains(lnk)){
      list.push(lnk);
      // break; // XXX can we break?
    }
  }
  return list;
};

/**
 * Return an empty list if this group's links are within the container
 * else return a singleton list containing this group
 */
LayoutLeaf.prototype.boundaryLeaves = function(container, linkMap){
  if(!container)
    container = this;
  // group is at boundary if it has a link
  // that the container doesn't contain
  const outsiders = [];
  for(let lnk of this.links){
    if(!container.contains(lnk)){
      outsiders.push(lnk);
      if(!linkMap)
        break;
    }
  }
  // add leaf to list
  if(outsiders.length){
    if(linkMap)
      linkMap[this.id] = outsiders;
    return [ this ];
  } else {
    return [];
  }
};

/**
 * Add a set of suspended stitches to this group
 * or update the actual suspended meta information
 *
 * Two valid forms:
 * - LayoutLeaf::suspend(stitches, stitchMap) suspends new stitches
 * - LayoutLeaf::suspend() only updates the suspended metadata
 *
 * @param stitches the stitches
 * @param stitchMap their needles
 */
LayoutLeaf.prototype.suspend = function(stitches, stitchMap){
  if(stitches){
    this.suspended.push(...stitches);
    Object.assign(this.suspMap, stitchMap);
  } else {
    stitches = this.suspended;
    stitchMap = this.suspMap;
  }
  // update meta information
  for(let s of stitches){
    const { index, side } = this.suspMap[s.id];
    this.suspMeta.has_side[side] = true;
    this.suspMeta.max = Math.max(this.suspMeta.max, index);
    this.suspMeta.min = Math.min(this.suspMeta.min, index);
  }
  // update meta width
  this.suspMeta.width = this.suspMeta.max - this.suspMeta.min - 1;
  return this;
};

/**
 * Create a link to another group (which gets a link too)
 *
 * @param leaf the related leaf group
 */
LayoutLeaf.prototype.linkTo = function(leaf){
  // check that group is related
  if(this.length > leaf.length){
    leaf.linkTo(this);
    return;
  }
  // related = sharing stitch || sharing connected stitches
  for(let s of this.stitches()){
    if(leaf.hasStitch(s)
    || s.findNeighbor(n => leaf.hasStitch(n))){
      // if so, then add to links and reciprocally
      this.links.add(leaf);
      leaf.links.add(this);
      return;
    }
  }
};

/**
 * Apply an additional time offset to this leaf
 */
LayoutLeaf.prototype.applyTime = function(extraTime){
  this.time += extraTime || 0;
};

/**
 * Apply an additional needle offset to this leaf
 */
LayoutLeaf.prototype.applyOffset = function(extraOffset){
  this.offset += extraOffset || 0;
};

/**
 * Apply an additional bed flip to this leaf
 */
LayoutLeaf.prototype.applyFlip = function(extraFlip){
  this.flip = !!(this.flip ^ !!extraFlip);
};

/**
 * Stringified version
 */
LayoutLeaf.prototype.toString = function(){
  let str = 'Leaf(';
  if(this.shape){
    str += 'node=' + this.shape.node.toString();
    if(this.course.length)
      str += ', crs=' + this.crsId;
    if(this.suspended.length)
      str += ', #susp=' + this.suspended.length;
  } else {
    str += '#susp=' + this.suspended.length;
  }
  return str + ') @ (t=' + this.time + ', off=' + this.offset + ', flip=' + this.flip + ')';
};

module.exports = Object.assign(Layout, L, { Leaf: LayoutLeaf });
