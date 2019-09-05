// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const Stitch = require('./stitch.js');
const { FRONT, BACK, BOTH, parseSequence } = require('./sequence.js');

// constants
const C = {
  // sides
  OTHER_SIDE: {
    [FRONT]:  BACK,
    [BACK]:   FRONT,
    [BOTH]:   BOTH,
    'front':  'back',
    'back':   'front',
    'both':   'both'
  },
  FRONT, BACK, BOTH,
  FRONT_SIDE: FRONT,
  BACK_SIDE: BACK,
  BOTH_SIDES: BOTH,
  SIDES: [ FRONT, BACK, BOTH ],
  SIDE_NUM: {
    'front': 0,
    'back':  1
  },

  // orientation
  CW: 1,
  CCW: -1,

  // orientation constraints
  SAME: 1,
  INVERSE: -1,

  // course closing
  COLLAPSE:     'collapse',
  ZIGZAG:       'zigzag',
  ZIGZAGRETURN: 'zigzagreturn'
};

function Course(stitches, stitchMap, width, side, circular){
  this.stitches  = stitches;    // sequence of stitches
  this.stitchMap = stitchMap;   // location of needles { index, side }
  this.width     = width;       // x-extent over needles (integer)
  this.side      = side;        // d-extent over beds (FRONT | BACK | BOTH)
  this.circular  = !!circular;  // whether the courses wraps circularly
  this.offset    = 0;           // x-offset in needle space
  this.pending   = [];          // pending actions (for delayed linking)
  assert(C.SIDES.includes(side), 'Invalid side', side);
}
Object.defineProperty(Course.prototype, 'length', {
  get: function(){
    return this.stitches.length;
  },
  enumerable: true
});
Course.prototype.reset = function(circular, zeroOffset){
  const stitches = this.stitches;
  const stitchMap = this.stitchMap;
  // compute width and two-sidedness
  let min = Infinity, max = -Infinity;
  let sideMask = 0;
  for(let i = 0; i < stitches.length; ++i){
    let { index, side } = stitchMap[stitches[i].id];
    min = Math.min(min, index);
    max = Math.max(max, index);
    sideMask |= 1 << side;
    // FRONT ONLY => sideMask = 1 << 0 = 1 (side=0)
    // BACK ONLY  => sideMask = 1 << 1 = 2 (side=1)
    // BOTH SIDES => sideMask = 1 | 2  = 3 (side=2)
    // with side = sideMask - 1
  }
  // normalize indices so the left is at zero
  for(let i = 0; i < stitches.length; ++i){
    stitchMap[stitches[i].id].index -= min;
  }
  if(zeroOffset)
    this.offset = 0;
  else
    this.offset += min; // add necessary offset
  assert(sideMask, 'No side at all');

  // reset properties
  this.width    = max - min + 1;
  this.side     = sideMask - 1;
  if(circular !== undefined)
    this.circular = circular;
  return this;
};
Course.prototype.compact = function(circular){
  return this.reset(circular, true);
};

Course.prototype.resetFrom = function(stitches, stitchMap, circular){
  this.stitches = stitches;
  this.stitchMap = stitchMap;
  return this.reset(circular);
};

// ###########################################################################
// ##### Constructors ########################################################
// ###########################################################################

/**
 * Create an empty course
 *
 * @param circular whether to mark as circular
 */
Course.empty =
Course.Empty = function(circular){
  return new Course([], {}, 0, FRONT, circular);
};

/**
 * Create a list of N consecutive stitches
 *
 * @param N the number of stitches to create
 * @return a list of stitches
 */
Course.stitches = function(N){
  assert(N > 0, 'Invalid argument');
  let stitch = new Stitch();
  const list = [ stitch ];
  for(let i = 1; i < N; ++i)
    list.push(stitch = stitch.create());
  return list;
};

/**
 * Create a course given a sequence of stitches and their location map
 *
 * @param stitches sequence of stitches
 * @param stitchMap needle location of the stitches
 * @param circular whether to assume course circularity
 * @return a new Course instance
 */
Course.make = function(stitches, stitchMap, circular){
  return new Course(stitches, stitchMap, 0, FRONT, circular).reset(circular);
};

/**
 * Create a course from an unordered layout array of stitches.
 * The layout must provide the location of the stitches on a hypothetical bed.
 * And all stitches must form a continuous sequence whose order gets determined.
 *
 * @param layout an array of stitches (and possibly null values)
 * @param circular whether to treat as circular course
 * @param simple whether the course has both endpoints free
 * @return the corresponding course
 */
Course.fromLayout = function(layout, twosided, circular, simple){
  // accessor map
  const set = new Set(layout.filter(s => !!s));
  if(set.size == 0)
    return Course.empty(circular);
  if(set.size == 1){
    const stitches = [...set];
    return Course.make(stitches, { [stitches[0].id]: { index: 0, side: FRONT } }, circular);
  }
  // find end points
  const endpoints = simple ?
    layout.filter(s => s && s.isEndpoint())
  : layout.filter(s => {
    return s && Array.from(s.courses).find(n => !set.has(n));
  });
  assert(endpoints.length == 2, 'Invalid number of endpoints');
  // create stitch sequence
  const stitches = [ endpoints[0] ];
  const stitchMap = { [endpoints[0].id] : true };
  for(let stitch = endpoints[0]; stitch != endpoints[1];){
    let nexts = [...stitch.courses].filter(n => !(n.id in stitchMap));
    assert(nexts.length === 1, 'Disconnected stitch');
    stitches.push(stitch = nexts[0]);
    stitchMap[stitch.id] = true;
  }
  // create stitch map
  const width = twosided ? layout.length / 2 : layout.length;
  for(let stitch of stitches){
    let index = layout.indexOf(stitch);
    assert(index >= 0, 'Stitch is missing from layout');
    let side  = FRONT;
    if(twosided && index >= width){
      index = 2 * width - index - 1;
      side  = BACK;
    }
    stitchMap[stitch.id] = { index, side };
  }
  return Course.make(stitches, stitchMap, circular);
};

/**
 * Create a basic (or general sequence) course
 *
 * Two forms:
 * - Course.create(width, flat, gauge)
 * - Course.create(seq, gauge)
 *
 * @param width the number of stitches over a bed
 * @param flat whether flat (true) or tubular (false)
 * @param gauge the needle gauge
 * @return either a Flat or Tube course, or a Sequence course
 */
Course.create = function(...args){
  assert(args.length >= 1 && args.length <= 3, 'Missing or invalid argument');
  if(args.length == 3){
    assert(typeof args[0] == 'number', 'Invalid width argument');
  }
  if(typeof args[0] == 'string'){
    const [seq, gauge] = args;
    return Course.Sequence(seq, gauge);
  } else {
    const [width, flat, gauge] = args;
    return flat ? Course.Front(width, gauge) : Course.Tube(width, gauge);
  }
};
/**
 * Create a flat course
 *
 * @param side the bed side
 * @param width the number of stitches
 * @param gauge the spacing between stitches
 */
Course.Flat = function(side, width, gauge){
  if(side > 1){
    // called as Course.Flat(width, gauge) ~ Front(width, gauge)
    [width, gauge] = [side, width];
    side = FRONT;
  }
  if(!gauge)  gauge = 1;
  let stitch = new Stitch();
  const stitches = [ stitch ];
  const offset = (gauge > 1 && side == BACK) ? 1 : 0;
  const stitchMap = { [stitch.id]: { index: offset, side: side } };
  for(let i = 0, index = offset + gauge; i < width - 1; ++i, index += gauge){
    stitches.push(stitch = stitch.create());
    stitchMap[stitch.id] = { index, side };
  }
  return new Course(stitches, stitchMap, width * gauge, side);
};
/**
 * Create a front flat course
 *
 * @see Course.Flat
 */
Course.Front = function(width, gauge){
  return Course.Flat(FRONT, width, gauge);
};
/**
 * Create a back flat course
 *
 * @see Course.Flat
 */
Course.Back = function(width, gauge){
  return Course.Flat(BACK, width, gauge);
};
/**
 * Create a C-shaped course
 *
 * @param side the full side
 * @param width the number of stitches along the full side
 * @param pre the number of left stitches on the open side
 * @param post the number of right stitches on the open side
 * @param gauge the needle gauge
 * @return the C-shaped course
 */
Course.CShape = function(side, width, pre, post, gauge){
  if(typeof side == 'number'){
    if(side !== FRONT && side !== BACK){
      // missing first $side argument => front
      [width, pre, post, gauge] = [side, width, pre, post];
      side = FRONT;
    }
  } else {
    assert(typeof side == 'string', 'Invalid argument type');
    side = C.SIDE_NUM[side];
    // [width, pre, post, gauge] = [side, width, pre, post];
  }
  if(!gauge)  gauge = 1;
  if(!post)   post = 0;
  if(!pre)    pre = 0;
  assert(width > 1, 'Width must be larger than 1');
  assert(pre >= 0, 'Pre width must be non-negative');
  assert(post >= 0, 'Post width must be non-negative');
  assert(pre + post <= width, 'Pre and post widths cannot sum larger than full width');
  if(pre !== 0 && post !== 0){
    let B = 'BF'[C.OTHER_SIDE[side]];
    let F = 'BF'[side];
    return Course.Sequence(B + '-' + pre + F + width + B + '-' + post, gauge);
  } else
    return Course.Flat(side, width, gauge);
};
/**
 * Create a tubular course
 *
 * @param width the number of stitches on each bed
 * @param gauge the needle gauge
 * @return the tubular course
 */
Course.Tube = function(width, gauge){
  if(!gauge)
    gauge = 1;
  assert(width > 1, 'Width must be larger than 1');
  let stitch = new Stitch();
  const stitches = [ stitch ];
  const stitchMap = { [stitch.id]: { index: 0, side: FRONT } };
  for(let i = 0, index = gauge; i < width - 1; ++i, index += gauge){
    stitches.push(stitch = stitch.create());
    stitchMap[stitch.id] = { index, side: FRONT };
  }
  for(let i = 0, index = width * gauge - 1; i < width; ++i, index -= gauge){
    stitches.push(stitch = stitch.create());
    stitchMap[stitch.id] = { index, side: BACK };
  }
  return new Course(stitches, stitchMap, width * gauge, BOTH, true);
};
/**
 * Create a closed two-sided course that zigzags between
 * the two beds to create a yarn closure.
 *
 * @param width the course width over each bed
 * @param gauge the needle gauge
 * @return the zigzag course
 */
Course.ZigZag =
Course.FrontBack = function(width, gauge) {
  if(!gauge)
    gauge = 1;
  assert(width > 1, 'Width must be larger than 1');
  let stitch = new Stitch();
  const stitches = [ stitch ];
  const stitchMap = { [stitch.id]: { index: 0, side: FRONT } };
  stitches.push(stitch = stitch.create());
  stitchMap[stitch.id] = { index: gauge > 1 ? 1 : 0, side: BACK };
  for(let i = 0, index = gauge; i < width - 1; ++i, index += gauge){
    stitches.push(stitch = stitch.create());
    stitchMap[stitch.id] = { index, side: FRONT };
    stitches.push(stitch = stitch.create());
    stitchMap[stitch.id] = { index: index + (gauge > 1 ? 1 : 0), side: BACK };
  }
  return new Course(stitches, stitchMap, width * gauge, BOTH);
};
/**
 * Create a closed two-sided course that zigzags between
 * the two beds and comes back to the origin as special yarn closure.
 *
 * @param width the course width over each bed
 * @param gauge the needle gauge
 * @param circular whether to treat the course as circular
 * @return the zigzag course
 */
Course.ZigZagReturn =
Course.FrontBackReturn = function(width, gauge, circular) {
  assert(width > 1, 'Width must be larger than 1');
  let stitch = new Stitch();
  const stitches = [ stitch ];
  const stitchMap = { [stitch.id]: { index: 0, side: FRONT } };
  let side = BACK;
  for(let i = 0, index = 1; i < width - 1; ++i, side = C.OTHER_SIDE[side], ++index){
    stitches.push(stitch = stitch.create());
    stitchMap[stitch.id] = { index, side };
  }
  for(let i = 0, index = width - 1; i < width; ++i, side = C.OTHER_SIDE[side], --index){
    stitches.push(stitch = stitch.create());
    stitchMap[stitch.id] = { index, side };
  }
  return new Course(stitches, stitchMap, width, BOTH, circular).gauged(gauge);
};
/**
 * Create a course using a general knitting sequence
 *
 * @param str the knitting sequence as a string of operations
 * @param gauge the needle gauge
 * @param circular whether to treat the sequence as circular (overwrites sequence flag)
 * @return the custom course
 * @see sequence.js - parseSequence
 */
Course.Sequence = function(str, gauge, circular){
  const { stitches, stitchMap, circular: circ } = parseSequence(str);
  return Course.make(stitches, stitchMap, circular === undefined ? circ : circular).gauged(gauge);
};

// ###########################################################################
// ##### Modifiers ###########################################################
// ###########################################################################

/**
 * Return a course with scaled gauge spacing
 *
 * @param gauge the space scale
 * @return the new course
 */
Course.prototype.gauged = function(gauge){
  if(!gauge || gauge === 1)
    return this;
  assert(gauge >= 1, 'Gauge must be a positive integer');
  // else, we must rescale all stitch locations and shift the back by 1
  const stitchMap = {};
  for(let i = 0; i < this.stitches.length; ++i){
    const { index, side } = this.stitchMap[this.stitch.id];
    stitchMap[this.stitch.id] = {
      index: index * gauge + (side ? 1 : 0), side
    };
  }
  return new Course(this.stitches, stitchMap, this.width * gauge, this.side, this.circular);
};
/**
 * Return a copy of this course
 *
 * @return a new identical course
 */
Course.prototype.copy = function(){
  const stitches = [];
  const stitchMap = {};
  for(let i = 0; i < this.stitches.length; ++i){
    stitches.push(this.stitches[i]);
    const id = this.stitches[i].id;
    const { index, side } = this.stitchMap[id];
    stitchMap[id] = { index, side };
  }
  return new Course(stitches, stitchMap, this.width, this.side, this.circular);
};
/**
 * Mirror the stitch location of the current course (along the needle indices)
 *
 * @return this updated course
 */
Course.prototype.mirror = function(){
  const width = this.width;
  for(let i = 0; i < this.stitches.length; ++i){
    let id = this.stitches[i].id;
    this.stitchMap[id].index = width - this.stitchMap[id].index - 1;
  }
  return this;
};
/**
 * Create a mirrored copy of this course
 *
 * @see Course::copy
 * @see Course::mirror
 * @return a new mirrored version of this course
 */
Course.prototype.mirrored = function(){
  return this.copy().mirror();
};
/**
 * Flip the needle bed of each stitch
 *
 * @return this updated course
 */
Course.prototype.flipBeds = function(){
  for(let i = 0; i < this.stitches.length; ++i){
    let id = this.stitches[i].id;
    this.stitchMap[id].side = BACK - this.stitchMap[id].side;
  }
  switch(this.side){
    case FRONT: this.side = BACK;   break;
    case BACK:  this.side = FRONT;  break;
    case BOTH:  break;
    default: assert.error('Invalid side metadata');
  }
  return this;
};

// ###########################################################################
// ##### Accessors ###########################################################
// ###########################################################################

/**
 * Stitch iterator
 */
Course.prototype[Symbol.iterator] = function*(){
  yield* this.stitches;
};

/**
 * Yarn sequence (creates a copy of the stitch sequence)
 */
Course.prototype.yarnSequence = function(startStitch){
  if(!startStitch)
    return this.stitches.slice();
  assert(this.hasStitch(startStitch), 'Starting from missing stitch');
  assert(this.isEndpoint(startStitch), 'Starting from non-endpoint stitch');
  if(startStitch == this.stitches[0])
    return this.stitches.slice();
  else {
    assert(startStitch == this.stitches[this.stitches.length - 1], 'Invalid endpoint');
    return this.stitches.slice().reverse();
  }
};

/**
 * Returns the first stitch of the course
 */
Course.prototype.first = function() {
  return this.stitches[0];
};
/**
 * Returns the last stitch of the course
 */
Course.prototype.last = function() {
  return this.stitches[this.stitches.length - 1];
};

/**
 * Returns whether this courses takes both sides
 */
Course.prototype.isTwoSided = function(){
  return this.side == BOTH;
};

/**
 * Check whether a stitch is within this course
 *
 * @param stitch the stitch with identifier
 * @return whether contained in the course
 */
Course.prototype.hasStitch = function(stitch){
  return stitch.id in this.stitchMap;
};

/**
 * Check whether an index falls within the course extent
 *
 * @param index the needle index in this course's frame
 * @param side the needle side
 */
Course.prototype.isWithin = function(index, side){
  return this.stitches.length // this course is not empty
      && (this.side === BOTH || this.side === side) // matching side
      && index >= this.offset // index is from offset
      && index < this.offset + this.width; // index is before course's end
};

/**
 * Check whether this course is empty
 */
Course.prototype.isEmpty = function(){
  return this.stitches.length === 0;
};

/**
 * Return the location of a stitch's needle taking the course offset into account
 *
 * @param stitch the stitch of interest
 * @return { index, side }
 */
Course.prototype.needleOf = function(stitch, extraOffset, flipSide){
  const { index, side } = this.stitchMap[stitch.id];
  return {
    index: index + this.offset + (extraOffset || 0),
    side: flipSide ? C.OTHER_SIDE[side] : side
  };
};

/**
 * Return whether a stitch is an endpoint from this course's perspective.
 * This only makes sens for stitches within this course. Do not try passing a stitch
 * that is not contained in this course as it will then always return true.
 *
 * @param stitch a stitch from this course
 * @param free whether to check for free endpoints only
 * @return whether it is an endpoint stitch w.r.t. this course
 */
Course.prototype.isEndpoint = function(stitch, free){
  if(free)
    return stitch.isEndpoint();
  else
    return stitch.isEndpoint() || Array.from(stitch.courses).some(n => !this.hasStitch(n));
};

/**
 * Return the number of free endpoints of the course
 *
 * @return the number of free endpoints
 */
Course.prototype.dof = function(){
  return this.endpoints(true).length;
};

/**
 * Return the list of endpoint stitches of this course.
 * This includes stitches that have less than 2 course connections
 * as well as stitches with course connections outside of this course.
 *
 * @param free whether to check for free endpoints only
 * @return a list of stitches
 */
Course.prototype.endpoints = function(free){
  let list = [];
  if(this.stitches.length)
    list.push(this.first());
  if(this.stitches.length > 1)
    list.push(this.last());
  return list.filter(s => this.isEndpoint(s, free));
};

/**
 * Return the first available endpoint
 *
 * @param free whether to check for free endpoints only
 * @return the first available endpoint or null
 */
Course.prototype.firstEndpoint = function(free){
  if(this.stitches.length){
    if(this.isEndpoint(this.stitches[0], free))
      return this.stitches[0];
    if(this.isEndpoint(this.stitches[this.stitches.length - 1], free))
      return this.stitches[this.stitches.length - 1];
  }
  assert.error('Could not get valid first endpoint', free);
  return null;
};

/**
 * Return the index of an endpoint
 *
 * @param free whether the endpoint must be free
 * @param last whether taking the last (false = taking the first)
 * @return -1 if none available, else 0 or (this.stitches.length - 1)
 */
Course.prototype.endpointIndex = function(free, last){
  const endpoints = this.endpoints(free);
  if(!endpoints.length)
    return -1;
  const stitch = endpoints[last ? endpoints.length - 1 : 0];
  if(stitch === this.stitches[0])
    return 0;
  else {
    assert(stitch === this.stitches[this.stitches.length - 1], 'Invalid last endpoint');
    return this.stitches.length - 1;
  }
};

/**
 * Return the index of the last endpoint
 *
 * @param free whether the endpoint must be free
 * @return its index or -1 if none available
 */
Course.prototype.lastEndpointIndex = function(free){
  return this.endpointIndex(free, true);
};

/**
 * Check whether a needle sequence is sufficient for orientability
 *
 * @param ...needles sequence of needles
 * @return true if it has enough needles for finding an orientation, false otherwise
 */
Course.isOriented = function(...needles){
  if(needles.length < 2)
    return false;
  return needles[0].side != needles[1].side || needles.length >= 2;
};

/**
 * Compute a direction (CW or CCW) from a needle sequence
 *
 * @param needles a sequence of at least 2 needles
 * @return CW=1 | CCW=-1 | 0 if invalid needle sequence
 */
Course.seqDirection = function(...needles){
  assert(needles.length >= 2, 'Direction requires at least two needles');
  // compare needle indices to get direction
  // /!\ may require looking for more than one pair of stitches
  //     if the first pair is spread across beds
  for(let i = 1; i < needles.length; ++i){
    const curr = needles[i-1];
    const next = needles[i];

    // compare needle indices to get direction
    const { index: currIndex, side: currSide } = curr; // this.needleOf(curr);
    const { index: nextIndex, side: nextSide } = next; // this.needleOf(next);

    // but changing side may invalidate the needle comparison (because of side offsets from gauge)
    // => check sides are the same
    // If sides are different, we cannot trust the pair
    if(currSide == nextSide){
      assert(currIndex !== nextIndex, 'Invalid state, same index and same side, or switching to same side');
      const sideFactor = curr.side == FRONT ? 1 : -1;
      return Math.sign(nextIndex - currIndex) * sideFactor;
    }
    // we'll look at the next one
    assert(needles.length >= 3, 'Direction inference with switching needles require at least 3 needles');
  }
  assert.error('Not a valid needle configuration to infer direction');
  return 0;
};

/**
 * Return the physical yarn direction when starting from a given stitch.
 * The starting stitch must be an endpoint (first or last stitch of course).
 * However, the endpoint doesn't need to be "free".
 *
 * @param stitch the stitch to measure yarn direction from
 * @return the yarn direction sign (CW or CCW) within this course
 */
Course.prototype.yarnDirection = function(stitch){
  if(stitch === undefined)
    stitch = this.stitches[0]; // get default orientation
  assert(stitch && this.isEndpoint(stitch), 'Start stitch is not a valid endpoint');

  // figure out the stitch indexing
  let stitches;
  if(stitch == this.stitches[0]){
    stitches = [stitch, this.stitches[1], this.stitches[2]];
  } else {
    const N = this.stitches.length;
    assert(this.stitches[N - 1] == stitch, 'Yarn direction only meaningful at course endpoint');
    stitches = [stitch, this.stitches[N-2], this.stitches[N-3]];
  }
  return Course.seqDirection(...stitches.map(s => this.needleOf(s)));
};

/**
 * Return the extents over the absolute bed
 *
 * @return { min, max }
 */
Course.prototype.extents = function(){
  return {
    min: this.offset,
    max: this.offset + this.width - 1
  };
};

/**
 * Computes the extents of multiple beds together
 *
 * @return { min, max }
 */
Course.extentsOf = function(...courses){
  return courses.reduce(({ min, max }, crs) => {
    const { min: m, max: M } = crs.extents();
    return {
      min: Math.min(min, m),
      max: Math.max(max, M)
    };
  }, { min: Infinity, max: -Infinity });
};

// ############################################################################
// ##### Course Bindings ######################################################
// ############################################################################

/**
 * Link two consecutive courses by creating
 * a course connection across their boundaries.
 *
 * The choice of endpoints depends on their degree of freedom
 * while matching the yarn direction to the circularity.
 *
 * @param next the following course
 * @see Course::dof
 * @see Course::endpoints
 * @see Course::yarnDirection
 * @see Course.seqDirection
 */
Course.prototype.link = function(next){
  // link from most restricted course
  if(this.dof() > next.dof()){
    next.link(this);
    return this;
  }

  // get both sides endpoint(s)
  const thisEnds = this.endpoints(true);
  const nextEnds = next.endpoints(true);
  assert(thisEnds.length && nextEnds.length, 'Course linking is not possible');
  assert(nextEnds.length === 2, 'Both courses have single degree of freedom');

  // two-sidedness
  const thisTS = this.side == BOTH;
  const nextTS = next.side == BOTH;

  // select endpoints
  let thisEnd;
  let nextEnd;
  if(thisEnds.length === 2){
    // check if difference in needle distances
    // between two pairs options
    const pairings = [
      [thisEnds[0], nextEnds[1]],
      [thisEnds[0], nextEnds[0]],
      [thisEnds[1], nextEnds[0]],
      [thisEnds[1], nextEnds[1]]
    ].map(([ts, ns]) => {
      const thisNeedle = this.needleOf(ts);
      const nextNeedle = next.needleOf(ns);
      return {
        thisEnd: ts, nextEnd: ns,
        thisNeedle,  nextNeedle,
        dist: Math.abs(thisNeedle.index - nextNeedle.index)
      };
    })
    // if circular, filter
    .filter(({ thisNeedle, nextNeedle }) => {
      if(thisTS && this.circular){
        return thisNeedle.side != nextNeedle.side;
      } else
        return true;
    });
    assert(pairings.length, 'Not valid pairing found');

    // sort by distance between needles
    pairings.sort(({ dist: d1 }, { dist: d2 }) => d1 - d2);

    // use closest match
    // @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment
    ({ thisEnd, nextEnd } = pairings[0]);

  } else {
    // choose next endpoints only
    assert(thisEnds.length === 1, 'Invalid number of free endpoints');
    thisEnd = thisEnds[0];
    const { index: thisIndex, side: thisSide } = this.needleOf(thisEnd);

    // order by distance over needles
    nextEnds.sort((s1, s2) => {
      const d1 = Math.abs(next.needleOf(s1).index - thisIndex);
      const d2 = Math.abs(next.needleOf(s2).index - thisIndex);
      return d1 - d2;
    });

    if(!nextTS){
      // the closest one
      nextEnd = nextEnds[0];

    } else {

      // choice based on circularity
      if(this.circular){
        // the closest one that is on the other bed
        // or just the closest one if none available
        nextEnd = nextEnds.find(s => next.needleOf(s).side != thisSide) || nextEnds[0];
      } else {
        // the closest one that matches yarn direction (since not circular)
        // or just the closest one if none available
        const thisYarnDir = this.yarnDirection(thisEnd);
        nextEnd = nextEnds.find(s => next.yarnDirection(s) == thisYarnDir) || nextEnds[0];
      }
    }
  }

  if(thisEnd && nextEnd)
    thisEnd.course(nextEnd);
  else
    assert.error("Could not find valid endpoint stitches for linking");

  return this;
};

/**
 * Iterator on possible continuity paths
 *
 * @param basePath the base path to extract subpaths from
 * @param circular whether to look for circular paths
 * @param lastIdx the index of the last stitch of this course (computed if not passed)
 * @param outDir the orientation of the yarn exiting the current course
 */
Course.prototype.continuityPaths = function*(basePath, circular, lastIdx, outDir){
  if(lastIdx === undefined)
    lastIdx = this.lastEndpointIndex(true);
  const { index: lastIndex, side: lastSide } = this.needleOf(this.stitches[lastIdx]);
  // additional circular paths
  if(circular){
    // paths using non-last stitch
    const firstIdx = lastIdx === 0 ? this.stitches.length - 1 : 0;
    const { index: firstIndex, side: firstSide } = this.needleOf(this.stitches[firstIdx]);
    // look for existence of paths
    const firstPathIdx = basePath.findIndex(({index, side}) => index === firstIndex && side === firstSide);
    if(firstPathIdx !== -1){
      // two halves from first stitch (including it)
      for(let p of [
        basePath.slice(firstPathIdx),
        basePath.slice(0, firstPathIdx + 1).reverse()
      ]){
        // skip degenerate paths
        if(p.length >= 2)
          yield p;
      }
    }
  }
  // non-circular paths
  // paths using last stitch
  const lastPathIdx = basePath.findIndex(({index, side}) => index === lastIndex && side === lastSide);
  if(lastPathIdx !== -1){
    if(outDir === undefined)
      outDir = -this.yarnDirection(this.stitches[lastIdx]);
    for(let p of [
      basePath.slice(lastPathIdx),
      basePath.slice(0, lastPathIdx + 1).reverse()
    ]){
      // skip degenerate paths
      if(Course.isOriented(...p)){
        const pdir = Course.seqDirection(...p);
        if(pdir === outDir)
          yield p.slice(1); // remove last stitch
        else
          yield p; // do not remove last stitch (since reversing direction)
      }
    }
  }
  // hopefully yielded by now
};

/**
 * Bind this course to another one by creating necessary continuity stitches
 * that follow the paths of either courses.
 * This course must have lower (or equal) degree of freedom than the next
 *
 * @param next the next course to bind to
 * @param cont the continuity course to use
 * @param path the course to follow the path of
 * @param dirConstr the last direction constraint
 */
Course.prototype.continuityBind = function(next, cont, path, dirConstr){
  assert(this.dof() <= next.dof(), 'This course has larger dof than next');

  // yarn location and direction
  const lastIdx = this.lastEndpointIndex(true);
  assert(lastIdx !== -1, 'No last endpoint available');
  const circular = this.circular && next.circular;
  const outDir = -this.yarnDirection(this.stitches[lastIdx]);

  // endpoints of next course
  const endpoints = next.endpoints(true);
  assert(endpoints.length, 'No possible connection');
  const endNeedles = endpoints.map(s => next.needleOf(s));

  // first check for trivial connection
  const { index: lastIndex, side: lastSide } = this.needleOf(this.stitches[lastIdx]);
  const trivialEndIdx = endNeedles.findIndex(({index, side}) => {
    return index == lastIndex // direct connection
        || (side == C.OTHER_SIDE[lastSide] && Math.abs(index - lastIndex) === 1); // direct diagonal connection (from gauge)
  });
  if(trivialEndIdx !== -1){
    // there is a trivial connection => use it!
    const lastStitch = this.stitches[lastIdx];
    if(circular && endpoints.length > 1){
      // connect to the other endpoint
      assert(endpoints.length === 2, 'More than two endpoints!');
      lastStitch.course(endpoints[1 - trivialEndIdx]);
    } else {
      // connect to that endpoint
      lastStitch.course(endpoints[trivialEndIdx]);
    }
    return this;
  }

  // for non-circular cases, check for simpler direct binding
  if(!circular){
    const nextNeedles = next.stitches.map(s => next.needleOf(s));
    if(nextNeedles.every(({index, side}) => index != lastIndex || side != lastSide)){
      return this.directBind(next);
    }
  }

  // pre-condition path
  const basePath = path.stitches.map(s => path.needleOf(s));
  let contPath;
  // two options: use path or reversed path
  // try both and choose first that "works" as one may not work
  // - trim the initial stitches until we reach the current last needle
  // - check for valid path and matching direction
  for(let p of this.continuityPaths(basePath, circular, lastIdx, outDir)){
    if(circular){
      // save as tentative path
      contPath = p;

      // only surely keep if yarn direction matches
      if(outDir == Course.seqDirection(...p)){
        // valid direction => take it
        break;
      }
      // else path direction reverses
      // => try other if possible
    } else {
      // non-circular, no constraint
      contPath = p;
      break;
    }
  }
  assert(contPath, 'Did not find a valid path');

  // continuity data
  const stitches = [];
  const stitchMap = {};

  // connection endpoints
  let found = false;
  for(let i = 0, lastStitch = this.stitches[lastIdx]; i < contPath.length && !found; ++i){
    const { index, side } = contPath[i];
    const endIdx = endNeedles.findIndex(n => n.index == index && n.side == side);
    // create continuity stitch
    // - if not there yet
    // - if there, but not circular
    // const create = endIdx == -1 // not there yet
                // || !circular;   // maybe there, but not circular
    // if(create){
    stitches.push(lastStitch = lastStitch.create());
    stitchMap[lastStitch.id] = { index, side };
    // }
    // link to next course if we reached an endpoint
    if(endIdx != -1){
      // unless we have a constraint
      if(dirConstr !== undefined){
        // check constraint passes
        const nextDir = next.yarnDirection(endpoints[endIdx]);
        if(outDir * nextDir != dirConstr){
          continue; // not valid
        }
      }
      if(circular && endpoints.length === 2){
        const circIdx = endNeedles.findIndex(n => n.index != index || n.side != side);
        lastStitch.course(endpoints[circIdx]);
      } else {
        lastStitch.course(endpoints[endIdx]);
      }
      found = true; // and we mark it as found
    }
  }
  assert(found, 'Could not create valid simple continuity course');

  // apply continuity data
  cont.resetFrom(stitches, stitchMap, circular);

  return this;
};

/**
 * Create a direct binding between this and the next course
 * by potentially adding missing stitches between the two
 * to create the shortest path between available endpoints.
 *
 * /!\ Implementation detail: needle indices are in global scope,
 * they must be inserted while removing the course's offset (to be relative to it).
 *
 * @param next the course to bind to
 */
Course.prototype.directBind = function(next){
  const lastIdx = this.lastEndpointIndex(true);
  assert(lastIdx !== -1, 'No last endpoint available');
  const { index: lastIndex, side: lastSide } = this.needleOf(this.stitches[lastIdx]);
  const outDir = -this.yarnDirection(this.stitches[lastIdx]);

  // find stitch in next course at same location
  const nextStitchIdx = next.stitches.findIndex(s => {
    const { index, side } = next.needleOf(s);
    return index == lastIndex && side == lastSide;
  });
  let basePath;
  if(nextStitchIdx != -1){
    // if endpoint, directly connect
    if(nextStitchIdx == 0 || nextStitchIdx == next.stitches.length - 1){
      this.stitches[lastIdx].course(next.stitches[nextStitchIdx]);
      return; // we are done!
    }
    // else extend current course, following the next one
    // until we reach an endpoint
    // ... but direct or reverse path?
    const directDir = next.yarnDirection();
    const forward = directDir == outDir;
    let nextStitch;
    if(forward){
      // skip current stitch and go beyond
      basePath = next.stitches.slice(nextStitchIdx + 1).map(s => next.needleOf(s));
      nextStitch = next.last();
    } else {
      // skip current stitch and go before, in reverse direction
      basePath = next.stitches.slice(0, nextStitchIdx).reverse().map(s => next.needleOf(s));
      nextStitch = next.first();
    }
    // go over remaining path
    let lastStitch = this.stitches[lastIdx];
    for(let i = 0; i < basePath.length; ++i){
      // forward => append at end
      if(forward)
        this.stitches.push(lastStitch = lastStitch.create());
      else // backward => prepend at front
        this.stitches.unshift(lastStitch = lastStitch.create());
      const { index, side } = basePath[i]; // need needle relative to this course's offset
      this.stitchMap[lastStitch.id] = { index: index - this.offset, side }; // => remove this course's offset
    }
    // connect with next sequence
    lastStitch.course(nextStitch);

    // reset current course information
    this.reset();
  } else {
    // restart on next course, following the current one backward
    let basePath;
    if(lastIdx){
      // reverse path (/!\ modifies the array it is applied onto => apply last)
      basePath = this.stitches.map(s => this.needleOf(s)).reverse();
    } else {
      // reverse of currently reversed
      basePath = this.stitches.map(s => this.needleOf(s));
    }

    // go until we reach an endpoint
    const nextStitches  = next.endpoints();
    const nextNeedles   = nextStitches.map(s => next.needleOf(s));
    const stitches      = [];
    const stitchMap     = {};

    // go over basePath until reaching one of nextNeedles
    // then prepend stitches (or append reversed)
    // and extend the stitch map
    //
    // /!\ indexes must take into account offset difference between courses
    //
    let lastStitch = this.stitches[lastIdx];
    let found = false;
    while(basePath.length){
      const curr = basePath.shift();
      const endIdx = nextNeedles.findIndex(n => n.index == curr.index && n.side == curr.side);
      if(endIdx == -1){
        stitches.push(lastStitch = lastStitch.create());
        // store index relative to next's offset
        stitchMap[lastStitch.id] = { index: curr.index - next.offset, side: curr.side };
      } else {
        // connect to endpoint
        lastStitch.course(nextStitches[endIdx]);
        if(endIdx == 0){
          // connecting to first stitch
          // => prepend normally
          next.stitches.unshift(...stitches);
        } else {
          // connecting to last stitch
          // => append, but reversed
          next.stitches.push(...stitches.reverse());
        }
        Object.assign(next.stitchMap, stitchMap);
        // nothing else to do
        found = true;
        break;
      }
    }
    assert(found, 'Could not connect directly');

    // reset next course information
    next.reset();
  }

  return this;
};

/**
 * Close a two-sided circular course onto itself,
 * thus resulting in a non-circular course of half size.
 *
 * This can only be done on two-sided circular courses.
 *
 * @param type the closing type (collapse | zigzag | zigzagreturn)
 */
Course.prototype.close = function(type){
  assert(this.side == BOTH, 'Cannot close a single-sided course');
  assert(this.circular, 'Cannot close an already-bounded course');
  const length = this.length;
  assert(length % 2 == 0, 'Cannot close odd courses');
  const halfLength = length / 2;

  if(!type)
    type = C.COLLAPSE;

  // multiple closing strategies:
  // - merge back to front
  //   => half-size, wales indicating the merge
  //   = good for endings, where we want to transfer back to front
  // - re-route as zigzag
  //   => same-size, stitch layout already set
  //   = good for starts (two variants, zigzag and zigzagreturn)
  //
  // /!\ merge back to front is NOT a solution for starting the yarn
  //     => COLLAPSE same as ZIGZAG for opening
  // /!\ zigzag may be a solution for closing an end, it's just "longer" to cast off

  // nothing to do if the course is empty
  if(!this.length)
    return;

  switch(type){

    case C.ZIGZAG: {
      // change traversal order:
      // 9,8,7,6,5           1,2,5,6,9
      // 0,1,2,3,4  becomes  0,3,4,7,8
      //
      const stitches = new Array(length);
      for(let i = 0, j = 0, front = 0; i < halfLength; ++i, j += 2, front = 1 - front){
        stitches[j + front]     = this.stitches[i];
        stitches[j + 1 - front] = this.stitches[length - 1 - i];
      }
      this.stitches = stitches;
    } break;


    case C.ZIGZAGRETURN:
      // swap sides for every other FB pair:
      // 9,8,7,6,5           9,1,7,3,5
      // 0,1,2,3,4  becomes  0,8,2,6,4
      //   ^   ^               ^   ^
      //
      for(let i = 1; i < halfLength; i += 2){
        const front = this.stitches[i];
        const back  = this.stitches[length - 1 - i];
        // swap
        this.stitches[i] = back;
        this.stitches[length - 1 - i] = front;
      }
      break;

    default:
      assert.error('Invalid closing type', type);
      /* fall through */
    case C.COLLAPSE:
      // merge back to front:
      // 9,8,7,6,5           -,-,-,-,-
      // 0,1,2,3,4  becomes  0,1,2,3,4 (with double wales)
      //
      for(let i = 0; i < halfLength; ++i){
        const front = this.stitches[i];
        const back  = this.stitches.pop(); // remove last stitch
        front.merge(back);
      }
      break;
  }

  // recreate layout information from stitches
  // circularity only stays for zigzagreturn
  // - zigzag => straight = non-circular
  // - collapse => half and straight = non-circular
  this.reset(type == C.ZIGZAGRETURN);

  // mark stitches as closed
  for(let st of this.stitches)
    st.meta('closed', true);

  return this;
};

/**
 * Merge another course with this one, resulting in the two courses sharing the same stitches
 * whose wale and course connections are correspondingly updated.
 *
 * @param other the course whose stitches to merge with this one
 */
Course.prototype.merge = function(other){
  const length = this.length;
  assert(length === other.length, 'Binding two courses of different sizes');

  // the courses shouldn't have linkings yet => 2 DOFs each
  assert(this.dof() === 2 && other.dof() === 2, 'Merging constrained courses');

  // merge individual stitches one by one
  for(let i = 0; i < length; ++i){
    const tStitch = this.stitches[i];
    const oStitch = other.stitches[i];
    // merge wale connections
    tStitch.merge(oStitch);
    // replace stitch (and re-link to past location, to be kept)
    other.stitches[i] = tStitch;
    other.stitchMap[tStitch.id] = other.stitchMap[oStitch.id];
    delete other.stitchMap[oStitch.id]; // remove older link
  }

  return this;
};

/**
 * Create binding with another course of different size or gauge
 * by spreading wale connections according to some factor
 *
 * @param course the other course
 * @param factor the spread factor from this course to the other one
 */
Course.prototype.spread = function (course, factor){
  assert(factor > 0, 'Spread factor must be strictly positive');
  if(factor < 1){
    course.spread(this, 1/factor);
    return this;
  } else if(factor === 1 && this.length > course.length){
    course.spread(this, 1);
    return this;
  }
  assert(this.length <= course.length, 'Invalid binding transition');
  assert(factor >= 1, 'Normalized spread factor must be at least 1');

  // integer spread factor
  factor = Math.round(factor);

  // create wales
  const thisLength = this.length;
  const crsLength  = course.length;
  for(let i = 0, j = Math.round(- factor / 2); i < thisLength; ++i, j += factor){
    const s1 = this.stitches[i];
    for(let k = 0; k < factor; ++k){
      const j2 = (j + k + crsLength) % crsLength;
      const s2 = course.stitches[j2];
      s1.wale(s2);
    }
  }

  // store pending course connection
  this.linkLater(course); // dofs are too high right now

  return this;
};

// ############################################################################
// ##### Pending Operations ###################################################
// ############################################################################

/**
 * Create a pending course linking to be resolved at tracing time
 *
 * @param other the other course to link to (or from)
 */
Course.prototype.linkLater = function(other){
  this.pending.push({ action: 'link', target: other });
  other.pending.push({ action: 'link', target: this });

  return this;
};

/**
 * Apply pending links, binds and merges
 */
Course.prototype.applyPending = function(){

  const courses = this.pending.map(({ target }) => target);
  // one course cannot appear twice
  const uniq = [...new Set(courses)];
  assert(courses.length === uniq.length, 'Multiple pending actions for a same target');

  const dofOrder = (csr1, csr2) => csr1.dof() - csr2.dof();
  while(courses.length){
    // sort by increasing degree of freedom
    courses.sort(dofOrder);

    // take most constrained first, and order with this one
    const other = courses.shift();

    // extract actions
    // note: from both sides since we want the action to happen only once
    const thisIdx = this.pending.findIndex(({ target }) => target == other);
    const thisAction = this.pending.splice(thisIdx, 1)[0];
    const otherIdx = other.pending.findIndex(({ target }) => target == this);
    const otherAction = other.pending.splice(otherIdx, 1)[0];

    // use most constrained one as base
    if(this.dof() < other.dof()){
      const args = thisAction.args || [];
      this[thisAction.action](other, ...args);
    } else {
      const args = otherAction.args || [];
      other[otherAction.action](this, ...args);
    }
  }
  return this;
};

// ############################################################################
// ##### Data Export ##########################################################
// ############################################################################

/**
 * Return a bed representation of the course
 *
 * @param width the absolute width to use (defaults to Course::width + offset)
 * @param offset the absolute offset to use (defaults to Course::offset)
 * @return [[front stitches], [back stitches]]
 */
Course.prototype.toBeds = function(width, offset){
  if(offset === undefined)
    offset = this.offset;
  if(width === undefined)
    width = this.width + offset;
  const beds = [
    Array.from({ length: width }),
    Array.from({ length: width })
  ];
  for(let i = 0; i < this.stitches.length; ++i){
    const stitch = this.stitches[i];
    const { index, side } = this.stitchMap[stitch.id];
    assert(!beds[side][index + offset], 'Stitch over stitch');
    assert(index >= 0 && index < this.width, 'Invalid stitch index or course width');
    beds[side][index + offset] = stitch;
  }
  return beds;
};

/**
 * Return a single bed view of the course
 *
 * @param width
 * @param offset
 * @see Course::toBeds(width, offset)
 */
Course.prototype.toFlatBed = function(width, offset){
  const [ front, back ] = this.toBeds(width, offset);
  return front.concat(back.reverse());
};

/**
 * Return the character representing a stitch type (free, endpoint, stitch, -)
 *
 * @param stitch the stitch which must be within this bed
 * @return 'f' | 'e' | 's' | '-'
 */
Course.prototype.stitchType = function(stitch){
  if(stitch){
    if(this.isEndpoint(stitch, true))
      return 'f';
    else if(this.isEndpoint(stitch))
      return 'e';
    else
      return 's';
  } else
    return '-';
};

/**
 * Convert course into a flattened textual representation
 *
 * The symbols:
 *    | = limit between front (first) and back (second) beds
 *    s = a normal stitch
 *    - = an empty spot
 *    f = free endpoint
 *    e = non-free endpoint
 */
Course.prototype.flatStr = function(width, offset){
  const beds = this.toBeds(width, offset);
  return beds[0].map(s => this.stitchType(s)).join('')
       + '|'
       + beds[1].map(s => this.stitchType(s)).join('');
};

/**
 * Convert the course beds into a flattened textual representation
 *
 * The symbols:
 *    x = stitch on both beds
 *    ^ = stitch only on back bed
 *    v = stitch only on front bed
 *    - = no stitch on either beds
 */
Course.prototype.bedStr = function(width, offset){
  const beds = this.toBeds(width, offset);
  return beds[0].map((_, idx) => {
    const front = beds[FRONT][idx];
    const back  = beds[BACK][idx];
    if(front){
      if(back)
        return 'x';
      else
        return 'v';
    } else {
      if(back)
        return '^';
      else
        return '-';
    }
  }).join('');
};


module.exports = Object.assign(Course, C);
