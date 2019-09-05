// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const Course = require('../course.js');
const { FRONT, BACK, BOTH } = Course;
const Parameter  = require('../param.js');
const { STRING } = Parameter;
// const sk = require('./constants.js');
const { init, register } = require('./node.js');
const DSL = require('../dsl.js');

function Custom(){
  init(this, 'custom', 'custom');
  this.lastCode = null;
  this.lastShape = null;
}
Custom.prototype.getUserParameters = function(){
  return this.parameters.code.extractUserParameters().map(name => {
    return Parameter.getUserParameter(name, true);
  });
};

Custom.prototype.eval = function(verbose, unsafe){
  // check cache
  if(this.lastCode == this.code && this.lastShape){
    return this.lastShape;
  }
  // else we must evaluate the code
  const shape = new CustomShape();
  const args = { FRONT, BACK, BOTH };
  for(let [shortcut, func] of [
    ['T', Course.Tube],
    ['C', Course.CShape],
    ['F', Course.Flat],
    ['Z', Course.ZigZag],
    ['X', Course.ZigZagReturn],
    ['S', Course.Sequence]
  ]){
    args[shortcut] = (...fargs) => {
      return shape.lastContext().push(func(...fargs)).newContext();
    };
  }
  for(let alias of [ 'mask', 'srcmask', 'trgmask', 'binding', 'shaper', 'grid', 'pgrid', 'continuity', 'spread', 'center', 'left', 'right' ]){
    args[alias] = (...fargs) => {
      return shape.lastContext()[alias](...fargs);
    };
  }

  // evaluate
  const code = this.code;
  if(unsafe)
    DSL.eval(code, args, [], verbose);
  else
    DSL.safeEval(code, args, [], verbose);

  // return accumulated shape
  if(!shape.courses.length){
    shape.courses.push(Course.create(10, false, 1));
  }

  // cache information
  this.lastCode = code;
  this.lastShape = shape;
  return shape;
};

Custom.prototype.getSourceCode = function(){
  return this.parameters.code.value;
};

Custom.prototype.clearCache = function(){
  this.lastShape = null;
};

const C = {
  SHAPER_BINDING: 'shaper',
  CONT_BINDING:   'continuity',
  GRID_BINDING:   'grid',
  PGRID_BINDING:  'pgrid',
  SPREAD_BINDING: 'spread'
};

function CustomShape(){
  this.courses = [];
  this.beds = [];
  this.srcmasks = [];
  this.trgmasks = [];
  this.bindings = [];
}
CustomShape.prototype.pushCourse = function(crs){
  this.courses.push(crs);
  this.beds.length = this.srcmasks.length = this.trgmasks.length = this.bindings.length = this.courses.length;
};
CustomShape.prototype.pushBeds = function(beds){
  this.beds.push(beds);
  this.courses.length = this.srcmasks.length = this.trgmasks.length = this.bindings.length = this.beds.length;
};
CustomShape.prototype.lastContext = function(){
  return new CustomContext(this);
};
CustomShape.prototype.first = function(){
  return this.courses[0];
};
CustomShape.prototype.last = function(){
  return this.courses[this.courses.length - 1];
};
function CustomContext(shape, index){
  this.shape = shape;
  this.index  = index === undefined ? shape.courses.length - 1 : index;
  this.target = index === undefined ? shape.last() : shape.courses[index];
}
CustomContext.prototype.newContext = function(){
  return new CustomContext(this.shape);
};
CustomContext.prototype.push = function(...args){
  for(let arg of args){
    if(arg instanceof Course){
      this.shape.pushCourse(arg);
    } else {
      assert(Array.isArray(arg) && arg.length === 2, 'Unsupported argument', arg);
      this.shape.pushBeds(arg);
    }
  }
  return this;
};
CustomContext.prototype.setMask = function(mask, mode){
  assert(this.target, 'Masking empty context');
  if(mode != 'src')
    this.shape.trgmasks[this.index] = mask;
  if(mode != 'trg')
    this.shape.srcmasks[this.index] = mask; // XXX this mode doesn't work as of now
  return this;
};
CustomContext.prototype.mask = function(offset, width, sideMask, mode){
  if(sideMask === undefined)
    sideMask = BOTH;
  const mask = {};
  for(let s of this.target.stitches){
    const { index, side } = this.target.needleOf(s);
    if(index >= offset && index < offset + width && (side == sideMask || sideMask == BOTH)){
      mask[s.id] = true;
    }
  }
  return this.setMask(mask, mode);
};
CustomContext.prototype.srcmask =
CustomContext.prototype.maskSrc = function(offset, width, sideMask){
  return this.mask(offset, width, sideMask, 'src');
};
CustomContext.prototype.trgmask =
CustomContext.prototype.maskTrg = function(offset, width, sideMask){
  return this.mask(offset, width, sideMask, 'trg');
};
CustomContext.prototype.binding = function(type, ...args){
  if(this.target){
    this.shape.bindings[this.index] = { type, args };
  } else {
    this.shape.bindings.push({ type, args });
  }
  return this;
};
CustomContext.prototype.shaper = function(...args){
  return this.binding(C.SHAPER_BINDING, ...args);
};
CustomContext.prototype.continuity = function(...args){
  return this.binding(C.CONT_BINDING, ...args);
};
CustomContext.prototype.grid = function(...args){
  return this.binding(C.GRID_BINDING, ...args);
};
CustomContext.prototype.pgrid = function(...args){
  return this.binding(C.PGRID_BINDING, ...args);
};
CustomContext.prototype.spread = function(...args){
  return this.binding(C.SPREAD_BINDING, ...args);
};
CustomContext.prototype.remap = function(map){
  // XXX implement course remapping (generates bed)
  this.push(this.target.remap(map));
  return this.newContext();
};
CustomContext.prototype.rotate = function( /* n */ ){
  // XXX create remapping that rotates stitches over the bed (may require two beds)
  return this.newContext();
};
function copyCourse(crs){
  const stitches = Course.stitches(crs.length);
  const stitchMap = {};
  for(let i = 0; i < crs.length; ++i)
    stitchMap[stitches[i].id] = Object.assign({}, crs.stitchMap[crs.stitches[i].id]);
  return Course.make(stitches, stitchMap, crs.circular);
}
CustomContext.prototype.times = function(n){
  if(!n || n <= 1)
    return this; // do nothing
  return this.repeat(n - 1);
};
CustomContext.prototype.repeat = function(n){
  assert(n, 'Needs argument n > 0');
  assert(this.target, 'Empty context');
  for(let i = 0; i < n; ++i)
    this.push(copyCourse(this.target));
  return this.newContext();
};
CustomContext.prototype.shift = function(n){
  assert(typeof n == 'number', 'Invalid shift argument');
  this.target.offset += n;
};
CustomContext.prototype.center = function(){
  const width = this.shape.courses.reduce((max, crs) => Math.max(max, crs.width), 0);
  for(let crs of this.shape.courses){
    crs.offset = Math.round((width - crs.width) / 2);
  }
  return this;
};
CustomContext.prototype.left = function(){
  for(let crs of this.shape.courses){
    crs.offset = 0;
  }
  return this;
};
CustomContext.prototype.right = function(){
  const width = this.shape.courses.reduce((max, crs) => Math.max(max, crs.width), 0);
  for(let crs of this.shape.courses){
    crs.offset = width - crs.width;
  }
  return this;
};
register('custom', Custom, {
  inherits:   'default',
  interfaces: 'default',
  params: {
    'code': [STRING,  'T(10).times(5)'],
  },
  toString: ['id', 'name']
});

module.exports = Object.assign(Custom, C);
