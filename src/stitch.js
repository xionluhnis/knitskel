// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');

// constants
const S = {

  // connection mode
  WALE:   0,
  COURSE: 1
};

// internal
let __stitchID = 0;

/**
 * Knitting unit
 *
 * The main properties of the unit include
 * - a unique identifier (for equality testing)
 * - wale and course connections
 * - a pattern identifier (see pattern.js)
 * - a pattern modifier (see userpattern.js)
 *
 * Currently, there is the notion of parent and child,
 * but this probably is too arbitrary and should be simplified.
 *
 * There is also the notion of "previous" and "next" units for the course direction,
 * which is also arbitrary when generating complex structures because one can often
 * go over the units in either directions.
 *
 * Ideas:
 * - use wales and courses sets (unordered arrays)
 * - wales.length can be arbitrary (0 to infinity)
 * - courses.length can be
 *   - 0 (only for temporary structures),
 *   - 1 (start or end of yarn) or
 *   - 2 (general yarn)
 *
 */
function Stitch(type){
  this.id = __stitchID++;
  this.wales = new Set();
  this.courses = new Set();
  this.pattern = type || 1; // default pattern
  this.modifier = 0; // singular by default
  this.mark = 0;
  this.metadata = {};
  this.unrestricted = false;
}
Stitch.prototype.connect = function(target, mode){
  if(mode == S.COURSE){
    // course link => prev or next => only 2 at most
    this.courses.add(target);
    target.courses.add(this);
    assert(this.courses.size <= 2, 'Too many course nodes for ' + this);
    assert(target.courses.size <= 2, 'Too many course nodes for ' + target);
  } else {
    // wale link => child or parent => unconstrained
    this.wales.add(target);
    target.wales.add(this);
  }
  return this;
};
Stitch.prototype.wale = function(target){
  return this.connect(target, S.WALE);
};
Stitch.prototype.course = function(target){
  return this.connect(target, S.COURSE);
};
Stitch.prototype.disconnect = function(target, mode){
  if(mode == S.COURSE){
    // assert(this.courses.has(target) && target.courses.has(this), 'Invalid unlink');
    this.courses.delete(target);
    target.courses.delete(this);
  } else {
    // assert(this.wales.has(target) && target.wales.has(this), 'Invalid unlink');
    this.wales.delete(target);
    target.wales.delete(this);
  }
  return this;
};
Stitch.prototype.unwale = function(target){
  return this.disconnect(target, S.WALE);
};
Stitch.prototype.uncourse = function(target){
  return this.disconnect(target, S.COURSE);
};
Stitch.prototype.restrict = function(){
  this.unrestricted = false;
  return this;
};
Stitch.prototype.unrestrict = function(){
  this.unrestricted = true;
  return this;
};
Stitch.prototype.isBoundary = function(){
  return this.wales.size == 1;
};
Stitch.prototype.isEndpoint = function(){
  return this.courses.size < 2;
};
Stitch.prototype.isInternal = function(){
  return this.courses.size == 2;
};
Stitch.prototype.create = function(type){
  return new Stitch(type || this.pattern).course(this);
};
Stitch.prototype.clear = function(mode){
  if(mode === S.COURSE || mode === S.WALE){
    const self = this;
    const copy = new Set(mode == S.COURSE ? this.courses : this.wales);
    copy.forEach(c => {
      self.disconnect(c, mode);
    });
    return this;
  } else {
    // clear both by default
    this.clear(S.WALE);
    this.clear(S.COURSE);
  }
};
/**
 * Store or retrieve metadata on this stitch
 * Multiple forms of calls exist:
 * - meta(ctx, name, value) to set a value with a context
 * - meta(ctx, name) to get a contextualized value
 * - meta(name, value) to set a value without a context
 * - meta(name) to get a value without context
 *
 * @param ctx a node context
 * @param name the metadata name
 * @param value the metadata value (string, number or boolean)
 * @return the requested value as an array (if retrieving) or this
 */
Stitch.prototype.meta = function(ctx, name, value){
  let ctxId = -1;
  let set;
  if(ctx && typeof ctx == 'object'){
    // specific node context
    // meta(ctx, name, value) or meta(ctx, name)
    assert('id' in ctx, 'Context must have a unique identifier');
    ctxId = ctx.id;
    set = arguments.length === 3;
    assert(arguments.length === 2 || arguments.length === 3, 'Wrong number of arguments with context');
  } else if(ctx !== undefined && typeof ctx == 'number'){
    // number context
    // meta(id, name, value) or meta(id, name)
    ctxId = ctx;
    set = arguments.length === 3;
    assert(arguments.length === 2 || arguments.length === 3, 'Wrong number of argument with number context');
  } else if(!ctx){
    // specified global context
    // meta(null, name, value) or meta(null, name)
    set = arguments.length === 3;
    assert(arguments.length === 2 || arguments.length === 3, 'Wrong number of arguments with null context');
  } else {
    // no context
    // meta(name, value) or meta(name)
    if(arguments.length === 2){
      value = name;
      name = ctx;
      set = true;
    } else if(arguments.length === 1){
      name = ctx;
      set = false;
    } else
      throw "Invalid number of arguments without context";
  }
  if(set){
    // meta(ctx, name, value) or meta(name, value)
    assert(['string', 'number', 'boolean'].includes(typeof value),
      'Metadata must be one of: string, number, boolean (was ' + typeof value + ')');
    if(name in this.metadata)
      this.metadata[name].push([ctxId, value]);
    else
      this.metadata[name] = [ [ctxId, value] ];
    // return this to allow chaining
    return this;
  } else {
    // meta(ctx, name) or meta(name)
    let values = this.metadata[name] || []; // always an array
    if(ctxId != -1)
      values = values.filter(p => p[0] == ctxId);
    // return array of values (without context information)
    return values.map(p => p[1]);
  }
};
Stitch.prototype.merge = function(cell){
  // remove from wales and courses (as safety)
  this.disconnect(cell, false); // wales
  this.disconnect(cell, true);  // courses

  // transfer wales
  for(let w of cell.wales){
    this.wale(w);
  }
  cell.clear(S.WALE);

  // do no transfer courses, but return and remove from merged cell
  const res = cell.courses;
  cell.courses = new Set();
  res.forEach(c => {
    c.uncourse(cell); // remove from course neighbors
  });

  // transfer metadata
  for(let name in cell.metadata){
    for(let pair of cell.metadata[name]){
      const ctx = pair[0] == -1 ? null : pair[0];
      const val = pair[1];
      this.meta(ctx, name, val);
    }
  }

  return res;
};
Stitch.prototype.neighbors = function(){
  // return [...this.wales, ...this.courses];
  return Array.from(this.wales).concat(Array.from(this.courses));
};
Stitch.prototype.isWale = function(stitch){
  return this.wales.has(stitch);
};
Stitch.prototype.isCourse = function(stitch){
  return this.courses.has(stitch);
};
Stitch.prototype.isNeighbor = function(stitch){
  return this.wales.has(stitch) || this.courses.has(stitch);
};
Stitch.prototype.allNeighbors = function(pred){
  return !this.someNeighbor(s => !pred(s));
};
Stitch.prototype.findNeighbor = function(pred){
  for(let s of this.wales)
    if(pred(s))
      return s;
  for(let s of this.courses)
    if(pred(s))
      return s;
  return null;
};
Stitch.prototype.findCourse = function(pred){
  for(let s of this.courses)
    if(pred(s))
      return s;
  return null;
};
Stitch.prototype.findWale = function(pred){
  for(let s of this.wales)
    if(pred(s))
      return s;
  return null;
};
Stitch.prototype.all = function(){
  const nodes = [];
  const nodeMap = {};
  const queue = [ this ];
  while(queue.length){
    let n = queue.pop();
    if(n.id in nodeMap)
      continue;

    // register in map and stitch list
    nodeMap[n.id] = n;
    nodes.push(n);

    // queue its unseen neighbors
    for(let o of n.neighbors()){
      if(o.id in nodeMap)
        continue;
      else
        queue.push(o);
    }
  }
  return nodes;
};

module.exports = Object.assign(Stitch, S);
