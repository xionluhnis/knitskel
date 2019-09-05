// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const { BOOLEAN, STRING, LAYOUT } = require('../param.js');
const sk = require('./constants.js');
const { init, register, Interface, loadJSON, toJSON } = require('./node.js');

function Split(){
  init(this, 'split', 'split');
  // interfaces
  this.base     = new Interface(this, 'base');
  this.branches = [];
  this.degree   = 2; // triggers creation of branches
}
Object.defineProperty(Split.prototype, 'degree', {
  get: function() {
    return this._degree || 1;
  },
  set: function(d) {
    if(d < 1)
      return;
    if(this._degree == d)
      return; // no change
    this._degree = d;
    if(d < this.branches.length){
      // we must delete branches
      this.branches.splice(d).forEach(itf => {
        itf.disconnect();
      });
    } else while(this.branches.length < d){
      this.branches.push(new Interface(this, 'branches/' + this.branches.length));
    }
  },
  enumerable: true
});
Split.prototype.getInterfacePaths = function(){
  return ['base'].concat(this.branches.map((_, i) => 'branches/' + i));
};
Split.prototype.remapNodes = function(map){
  this.base = map(this.base);
  this.branches = this.branches.map(map);
  // this.layout = Layout.from(this, this.layout);
};
Split.prototype.toJSON = function(){
  return Object.assign(toJSON(this), {
    base: this.base.id,
    branches: this.branches.map(itf => itf.id),
    degree: this.degree,
  });
};
Split.prototype.loadJSON = function(data){
  loadJSON(this, data);
  // set degree
  if('degree' in data){
    assert(typeof data.degree == 'number', 'Degree must be an integer');
    this.degree = data.degree;
  }
  // load interfaces
  if('base' in data){
    assert(typeof data.base == 'number', 'Interfaces must use integers');
    this.base = data.base;
  }
  if('branches' in data){
    assert(Array.isArray(data.branches), 'Branches must be an array');
    assert(data.branches.length === this.degree, 'Branches do not match the degree');
    for(let i = 0; i < data.branches.length; ++i){
      let itf = data.branches[i];
      assert(typeof itf == 'number', 'JSON interfaces must be integers');
      this.branches[i] = itf;
    }
  }
};

register('split', Split, {
  inherits:   'default',
  params: {
    'folded':     [BOOLEAN, true],
    'alignment':  [STRING,  sk.ALIGN_UNIFORM],
    'layout':     [LAYOUT]
  },
  customParams: [ 'degree' ],
  toString: ['id', 'name']
});

module.exports = Split;
