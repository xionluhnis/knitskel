// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const assert = require('./assert.js');
// note: cannot require ./pattern.js since it requires ./env.js
// which would create a cyclic dependency

// - constants
const P = {
  // type of user pattern
  PROGRAM: -1,
  SINGULAR: 0,
  SCALABLE: 1,
  TILEABLE: 2,

  // valid types
  TYPES: [-1, 0, 1, 2 ],

  // sides
  FRONT_SIDE: 0,
  BACK_SIDE:  1,

  // methods
  isScalable: function(instr){
    return instr <= 4; // Empty | Knit | Purl | Tuck | Miss
  }
};

// variable
let layerID = 0;

//
// ### Pattern Layer #########################################################
//

function Layer(type, name){
  this.id = layerID++;
  this.type = type === undefined ? P.PROGRAM : type;
  this.data = this.type == P.PROGRAM ? '' : [];
  this.name = name || '';
}

Layer.isLayer = function(obj){
  return typeof obj == 'object' && ['type', 'data', 'name'].every(name => name in obj);
};
Layer.from = function(...args){
  if(args.length == 1 && typeof args[0] == 'object'){
    assert(Layer.isLayer(args[0]), 'Invalid layer argument');
    const { type, data, name } = args[0];
    return new Layer().update(type, data, name);
  } else {
    assert(args.length > 0 && args.length <= 3, 'Invalid layer arguments');
    const [type, data, name] = args;
    return new Layer().update(type, data, name);
  }
};

Layer.prototype.updateFromGroup = function(grp, newType){
  const type = newType !== undefined ? newType : this.type;
  assert(type != P.PROGRAM, 'Update from group only valid for drawings');
  const shape = grp.first().shape;
  const courses = grp.groups.map(g => g.course);
  const stitchGrid = courses.map(crs => crs.stitches);
  const createSide = arr => {
    return arr.map(row => row.map(s => {
      const instrList = s.meta(this.id, 'pattern');
      const instr = instrList[instrList.length - 1] || 0; // only use stitches from this layer's pass
      if(instr && instr > 4 && type == P.SCALABLE)
        return 0; // reduce to valid scalable patterns
      else
        return instr || 0;
    }));
  };
  if(shape.sided){
    const foreStitches = stitchGrid.map(stitches => stitches.slice(0, stitches.length / 2));
    const backStitches = stitchGrid.map(stitches => stitches.slice(stitches.length/2));
    return this.update(type, [ createSide(foreStitches), createSide(backStitches) ]);
  } else {
    return this.update(type, [ createSide(stitchGrid) ]);
  }
};

Layer.prototype.updateFromString = function(str){
  return this.update(this.type, str);
};

Layer.prototype.update = function(type, data, name){
  this.type = type;
  assert(P.TYPES.includes(type), 'Invalid layer type', type);
  this.data = data;
  if(name)
    this.name = name;
  if(type == P.PROGRAM)
    assert(typeof data == 'string', 'Program pattern must be a string');
  else
    Layer.checkSideData(data);
  return this;
};

Layer.prototype.switchSides = function(){
  if(this.type == P.PROGRAM)
    return; // nothing doable here
  if(this.data.length == 1){
    // add empty layer in front
    this.data.unshift(this.data[0].map(row => row.map(() => 0)));
  } else {
    // reverse side data
    this.data.reverse();
  }
  return this;
};

Layer.checkSideData = function(data){
  assert(Array.isArray(data), 'Drawing pattern must contain array information');
  assert([0, 1, 2].includes(data.length), 'Layer data can have 1 or 2 sides');
  let front = data[P.FRONT_SIDE];
  // test each side (and compare to front)
  for(let s = 0; s < data.length; ++s){
    let side = data[s];
    assert(side.length == front.length, 'Different side dimensions');
    for(let r = 0; r < side.length; ++r){
      let frow = front[r];
      let srow = side[r];
      assert(frow.length == srow.length, 'Different row sizes across sides');
      assert(this.type != P.SCALABLE || srow.every(val => P.isScalable(val)),
        'Invalid instruction for scalable layer');
    }
  }
};

Layer.fromGroup = function(type, grp, name){
  const shape = grp.first().shape;
  const courses = grp.groups.map(g => g.course);
  const stitchGrid = courses.map(crs => crs.stitches);
  const createSide = arr => arr.map(row => row.map(s => s.pattern));
  if(shape.sided){
    const foreStitches = stitchGrid.map(stitches => stitches.slice(0, stitches.length / 2));
    const backStitches = stitchGrid.map(stitches => stitches.slice(stitches.length/2));
    return Layer.from(type, [ createSide(foreStitches), createSide(backStitches) ], name);
  } else {
    return Layer.from(type, [ createSide(stitchGrid) ], name);
  }
};

Layer.prototype.toJSON = function(){
  return { type: this.type, data: this.type == P.PROGRAM ? this.data : this.data.map(row => row.slice()), name: this.name };
};

/**
 * User patterning code for singular layers
 *
 * @param pat the patterning instance
 * @param math the Math object
 * @param data the patterning data
 * @param layerID the layer identifier (to allow stitch inspection a posteriori)
 */
function singularPattern(pat, math, data, layerID){
  const sided = data.length > 1;
  for(let s = 0; s < data.length; ++s){
    const pattern = data[s];
    const area = sided ? pat.side(s) : pat;
    // assuming only singular stitches
    area.maskdo((y, x, h, w, p) => {
      // select row
      const dy = math.round((h - pattern.length) / 2);
      const r = math.round(y * h) - dy;
      if(r < 0 || r >= pattern.length)
        return; // skip outside boundaries
      const row = pattern[r];
      // select column
      const dx = math.round((w - row.length) / 2);
      const c = math.round(x * w) - dx;
      if(!row[c])
        return; // skip outside boundaries or background
      p.set(row[c], layerID);
    }, true);
  }
}

function scalablePattern(pat, math, data, layerID){
  const sided = data.length > 1;
  for(let s = 0; s < data.length; ++s){
    const pattern = data[s];
    const area = sided ? pat.side(s) : pat;
    // assuming only singular stitches
    area.stretchdo(pattern, (val, p) => val && p.set(val, layerID), true);
  }
}

function tileablePattern(pat, math, data, layerID){
  const sided = data.length > 1;
  for(let s = 0; s < data.length; ++s){
    const pattern = data[s];
    const area = sided ? pat.side(s) : pat;
    // assuming only singular stitches
    area.tiledo(pattern, (val, p) => val && p.set(val, layerID), true);
  }
}

const PatternFunction = {
  0: singularPattern,
  1: scalablePattern,
  2: tileablePattern
};

const PatternFunctionName = {
  0: 'singularPattern',
  1: 'scalablePattern',
  2: 'tileablePattern'
};

/**
 * Transform layer into program
 *
 * @param withoutDep whether to not include the function dependency in the generated code
 */
Layer.prototype.toString = function(withoutDep, varName){
  if(this.type == P.PROGRAM)
    return this.data;
  else {
    if(!varName)
      varName = 'data';
    // program generation from side pattern data
    let prog = '';
    prog += '// user pattern data\n';
    prog += 'const ' + varName + ' = ' + JSON.stringify(this.data) + ';\n';
    if(!withoutDep){
      prog += '// user pattern function\n';
      prog += PatternFunction[this.type].toString() + '\n';
    }
    prog += '// function call\n';
    prog += PatternFunctionName[this.type] + '(pat, math, ' + varName + ', ' + this.id + ');\n';
    return prog;
  }
};

//
// ### Full User Pattern #####################################################
//

function UserPattern(){
  this.layers = [ new Layer() ];
}

UserPattern.from = function(layers){
  return new UserPattern().update(layers);
};

UserPattern.prototype.createLayer = function(type, name){
  let layer = new Layer(type, name);
  this.layers.push(layer);
  return layer;
};

UserPattern.prototype.loadLayer = function(data){
  let layer = Layer.from(data);
  this.layers.push(layer);
  return layer;
};

UserPattern.prototype.removeLayer = function(index){
  let layers = this.layers.splice(index, 1);
  if(this.layers.length == 0)
    this.createLayer(); // add base layer
  return layers.length ? layers[0] : null;
};

UserPattern.prototype.moveLayer = function(from, to){
  from = Math.max(0, Math.min(from, this.layers.length-1));
  to   = Math.max(0, Math.min(to,   this.layers.length-1));
  let layer = this.layers.splice(from, 1)[0];
  this.layers.splice(to, 0, layer);
  return this;
};
UserPattern.prototype.moveLayerUp = function(index){
  return this.moveLayer(index, index + 1);
};
UserPattern.prototype.moveLayerDown = function(index){
  return this.moveLayer(index, index - 1);
};
UserPattern.prototype.duplicateLayer = function(index){
  let layer = this.layers[index];
  let newLayer = this.createLayer(layer.type, layer.name || 'copy');
  newLayer.update(layer.type, layer.toJSON().data);
  return this;
};
UserPattern.prototype.switchSides = function(index){
  if(index >= 0 && index < this.layers.length)
    this.layers[index].switchSides();
};

UserPattern.prototype.update = function(data){
  if(typeof data == 'string') {
    // base program
    this.layers = [ Layer.from(P.PROGRAM, data) ];
  } else if('groups' in data){
    // base drawing from layout group
    this.layers = [ Layer.fromGroup(P.SINGULAR, data) ];
  } else {
    assert(Array.isArray(data), 'Layers must be formed as arrays');
    if(Layer.isLayer(data))
      this.layers = [ Layer.from(data) ];
    else
      this.layers = data.map(obj => Layer.from(obj));
  }
  return this;
};

UserPattern.prototype.toJSON = function(){
  return this.layers.map(layer => layer.toJSON());
};

UserPattern.prototype.toString = function(){
  let prog = '';
  // add function dependencies
  let calls = new Set(this.layers.map(l => l.type));
  for(let type of calls){
    if(type != P.PROGRAM){
      prog += '// type ' + type + ' patterning\n';
      prog += PatternFunction[type].toString() + '\n';
    }
  }
  // generate data and calls
  for(let i = 0; i < this.layers.length; ++i){
    const layer = this.layers[i];
    prog += '// Layer #' + i;
    if(layer.name)
      prog += '- ' + layer.name;
    prog += '\n';
    prog += 'pat.forPass(' + layer.id + ', pat => {\n';
    prog += layer.toString(true, 'data_' + i) + '\n';
    prog += '});\n';
  }
  prog += '// your code:\n\n';
  return prog;
};

module.exports = Object.assign(UserPattern, P, {
  isLayer: Layer.isLayer
});
