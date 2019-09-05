// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('./assert.js');

const F = {
  // no inference
  ABSOLUTE:           0,
  // infer bottom
  BOT_RELATIVE:       1,
  RELATIVE_TO_BOTTOM: 1,
  // infer top
  TOP_RELATIVE:       2,
  RELATIVE_TO_TOP:    2,
  // infer both sides
  RELATIVE:           3,
  RELATIVE_TO_BOTH:   3
};

const RelativeValue = Symbol('relative');

/**
 * One dimentional function
 *
 * @param data a scalar or an array of pairs (loc,val)
 * @param parent the context parent (necessary for relative values)
 */
function Function1D(data, parent){
  this.data = data;
  this.parent = parent;
  if(Array.isArray(data))
    assert(data.length >= 4 && data.length % 2 == 0, 'Invalid function array: ' + data);
}
Function1D.from = function(value, parent){
  return new Function1D(2, parent).update(value);
};
Function1D.prototype.hasRelativeBottom = function(){
  return Array.isArray(this.data) && this.data[1] == RelativeValue;
};
Function1D.prototype.hasRelativeTop = function(){
  return Array.isArray(this.data) && this.data[this.data.length-1] == RelativeValue;
};
Function1D.prototype.isRelative = function(){
  return this.hasRelativeBottom() || this.hasRelativeTop();
};
Function1D.prototype.eval = function(t){
  if(!Array.isArray(this.data))
    return this.data; // constant
  if(this.data.length == 1)
    return this.data[0]; // constant wrapped in array
  if(t <= 0)
    return this.data[1];
  if(t >= 1)
    return this.data[this.data.length-1];
  // search location
  for(let i = 2; i < this.data.length; i += 2){
    let x_p = this.data[i-2];
    let x_i = this.data[i+0];
    if(t == x_i)
      return this.data[i+1];
    if(t > x_p && t < x_i){
      let y_p = this.data[i-1];
      let y_i = this.data[i+1];
      return y_p + (y_i-y_p) * (t-x_p) / (x_i-x_p);
    }
  }
  throw "Invalid state";
};
Function1D.prototype.first = function(){
  return this.eval(0);
};
Function1D.prototype.last = function(){
  return this.eval(1);
};
Function1D.prototype.isConstant = function(){
  return typeof this.data == 'number';
};
Function1D.prototype.scaled = function(scale) {
  if(this.isConstant())
    return Function1D.from(this.data * scale);
  else {
    return Function1D.from(this.data.map((val, idx) => {
      return idx % 2 ? val * scale : val;
    }));
  }
};
Function1D.prototype.keys = function(){
  if(Array.isArray(this.data))
    return this.data.filter((_, idx) => idx % 2 == 0);
  else
    return [ 0, 1 ];
};
Function1D.prototype.values = function() {
  // XXX take relative positioning into account
  if(Array.isArray(this.data))
    return this.data.filter((v,i) => i % 2 == 1);
  else
    return [this.data, this.data]; // constant value over interval
};
Function1D.prototype.getPoints = function(){
  return this.keys().reduce((pts, x) => {
    pts.push(x, this.eval(x));
    return pts;
  }, []);
  /*
  if(Array.isArray(this.data))
    return this.data.slice(); // create copy for dereferencing
  else
    return [0, this.data, 1, this.data]; // two constant points
  */
};
Function1D.prototype.max = function(){
  return this.values().reduce((max, val) => Math.max(max, val), -Infinity);
};
Function1D.prototype.min = function(){
  return this.values().reduce((min, val) => Math.min(min, val), Infinity);
};
Function1D.prototype.update = function(fun){
  if(typeof fun === 'string'){
    fun = fun.replace(/[\[\]]+/g, '');
    // string of an array
    if(fun.indexOf(',') > -1){
      fun = fun.replace(/[ ,]+/g, ' ');
      this.data = fun.split(' ').map(token => parseFloat(token));
      assert(this.data.findIndex(n => Number.isNaN(n)) === -1, 'Function update failed');
    } else {
      // simply a stringified constant
      this.data = parseFloat(fun);
      assert(!Number.isNaN(this.data), 'Function update failed');
    }
  } else if(typeof fun === 'number'){
    this.data = fun;
  } else if(Array.isArray(fun)){
    if(fun.length === 1)
      this.data = fun[0];
    else {
      assert(fun.length >= 4 && fun.length % 2 == 0, 'Invalid function array: ' + fun);
      
      // check if constant
      let constant = true;
      for(let i = 3; i < fun.length && constant; i += 2)
        constant = fun[i] == fun[1];
      
      if(constant)
        this.data = fun[1];
      else
        this.data = fun;
    }
  } else if(fun instanceof Function1D){
    this.data = fun.data;
  } else {
    throw "Unsupported function update with value " + fun;
  }
  // ensure values are at least 2 (else we can get into trouble with yarn)
  if(typeof this.data == 'number')
    this.data = Math.max(2, this.data);
  else if(Array.isArray(this.data)){
    this.data = this.data.map((val, idx) => {
      if(idx % 2)
        return Math.max(val, 2);
      else
        return val;
    });
  }
  return this;
};
Function1D.prototype.toJSON = function(){
  return Array.isArray(this.data) ? this.data.slice() : this.data;
};
Function1D.prototype.toString = function(){
  return this.data.toString();
};

module.exports = Object.assign(Function1D, F, {
  RelativeValue
});
