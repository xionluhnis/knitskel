// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('./assert.js');
const { inferSidedness } = require('./infer.js');

/**
 * Interface layout (notably for Split and Joint)
 *
 * @param data a scalar or an array of pairs (loc,val)
 */
function Layout(node, data){
  this.node = node;
  this.auto = true;
  this.data = data || [];
}
Object.defineProperty(Layout.prototype, 'degree', {
  get: function() {
    return this.node.degree || 1;
  },
  enumerable: true
});
Layout.from = function(node, value){
  return new Layout(node).update(value);
};
Layout.prototype.getSize = function(){
  return this.node.getInterfaces().reduce((max,itf) => Math.max(max, itf.getSize()), 0);
};
Layout.prototype.values = function(){
  return Array.from({ length: this.degree }).map((_, idx) => this.getPosition(idx));
};
/**
 * Find the layout index that has closest position value
 *
 * @param value the position value query
 * @return the index in { 0, ... this.degree-1 }
 */
Layout.prototype.indexOf = function(value){
  let values = this.values();
  return values.reduce(({ index, val }, newVal, newIdx) => {
    if(Math.abs(newVal - value) < Math.abs(val - value))
      return { index: newIdx, val: newVal };
    else
      return { index, val };
  }, { index:-1, val: Infinity }).index;
};
Layout.prototype.getNeighbors = function(){
  let nodes = new Set();
  this.node.getInterfaces().forEach(itf => {
    let other = itf.otherSide(this.node);
    if(other)
      nodes.add(other.node);
  });
  return Array.from(nodes).filter(n => n.layout).map(n => n.layout);
};
Layout.prototype.getPosition = function(index, forwarded) {
  assert(index >= 0 && index < this.degree, 'Negative index');
  if(this.auto){

    // check if automatic alignment with branches
    let alignment = this.node.alignment;
    if(this.node.branches){
      assert(this.node.branches.length == this.degree, 'Degree does not match branches');

      // single branch => at 0
      if(this.degree == 1){
        return 0;
      }

      let folded = this.node.folded;
      let size = this.getSize();
      // = this.branches.reduce((sum, itf) => sum + itf.getSize(), 0);
      switch(alignment){
        case 'left': {
          let left = this.node.branches.slice(0, index).reduce((sum, itf) => sum + itf.getSize(), 0);
          return Math.max(0, Math.min(1, left / size));
        }
        case 'right': {
          let right = this.node.branches.slice(index).reduce((sum, itf) => sum + itf.getSize(), 0);
          return Math.max(0, Math.min(1, 1 - right / size));
        }
        case 'manual': // default when still "auto"
        case 'uniform': {
          let margin = size - this.node.branches.reduce((sum, itf) => sum + itf.getSize(), 0);
          if(this.degree > 1){
            // folded => pad to have first left-aligned, and last right-aligned
            //        => N-1 paddings
            // circle => first left-aligned, but last padded from first
            //        => N paddings
            margin /= folded ? (this.degree-1) : this.degree;
          }
          let left = this.node.branches.slice(0, index).reduce((sum, itf) => sum + itf.getSize() + margin, 0);
          return Math.max(0, Math.min(1, left / size));
        }
        default:
          throw 'Unsupported alignment ' + alignment;
      }
    } else if(this.degree == 1){
      // infer sidedness to set default to center of front
      if(inferSidedness(this.node, 1)){
        // two-sided node
        // front-center = 1/4
        return 0.25;
      } else {
        // one-sided node
        // front-center = 1/2
        return 0.5;
      }
    }

    // check compatible neighboring layouts
    let layouts = this.getNeighbors().filter(l => l.degree == this.degree);
    for(let l of layouts){
      if(!forwarded)
        return l.getPosition(index, true);
    }

    // assume uniform alignment and use width
    /*
     * joints with degree > 1
    if(this.node.width) {
      let size = this.getSize();
      let margin = size - this.node.width.reduce((sum, f) => sum + f.max(), 0);
      // flat => same as folded case above
      margin /= this.node.isFlat() ? (this.degree-1) : this.degree;
      let left = this.node.width.slice(0, index).reduce((sum, f) => sum + f.max() + margin, 0);
      return Math.max(0, Math.min(1, left / size));
    }
    */

  } else if(index == 0) {
    return this.data[0] || 0;
  } else {
    return this.data[index] || this.getPosition(index-1);
  }
  throw "Could not get position";
};
Layout.prototype.update = function(layout){
  if(layout == 'auto'){
    this.auto = true;
    this.data = [];
  } else if(typeof layout == 'string'){
    layout = layout.replace(/[\[\]]+/g, '');
    // string of an array
    layout = layout.replace(/[ ,]+/g, ' ');
    this.auto = false;
    this.data = layout.split(' ').map(token => parseFloat(token));
    assert(this.data.findIndex(n => Number.isNaN(n)) === -1, 'Layout update failed');
  } else if(typeof layout == 'number'){
    this.auto = false;
    this.data = [layout];
  } else if(Array.isArray(layout)){
    assert(layout.length == this.degree, 'Invalid layout array (degree=' + this.degree + '): ' + layout);
    this.auto = false;
    this.data = layout;
  } else if(layout instanceof Layout){
    this.auto = layout.auto;
    this.data = layout.data;
  } else {
    throw "Unsupported layout update with value " + layout;
  }
  return this;
};
Layout.prototype.toString = function(){
  return this.auto ? 'auto' : this.data.toString();
};
Layout.prototype.toJSON = function(){
  return this.auto ? 'auto' : this.data.slice();
};

module.exports = Layout;
